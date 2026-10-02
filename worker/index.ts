// Worker do Cloudflare: publica o site (dist/) e atende /api/boletos/* (integração com o Sicoob).
// As chamadas usam o login do usuário (JWT do Supabase): RLS e eh_admin_ti() valem aqui como na tela,
// e as credenciais do banco ficam só no Worker (Settings › Variables and secrets), nunca no navegador.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ErroSicoob, Sicoob, montarInclusao, pdfDeBase64, type Ambiente, type ConfigCobranca, type Fetcher } from './sicoob'

export interface Env {
  ASSETS: { fetch: (req: Request) => Promise<Response> }
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  /** SANDBOX (padrão) ou PRODUCAO */
  SICOOB_AMBIENTE?: string
  SICOOB_CLIENT_ID?: string
  /** Só no sandbox: "Access token (Bearer)" do portal */
  SICOOB_TOKEN?: string
  /** Produção: binding mtls_certificates com o certificado ICP-Brasil */
  SICOOB_CERT?: { fetch: Fetcher }
}

const BUCKET = 'boletos'
const MAX_CONCILIAR = 10   // boletos por chamada (limite de subrequisições do Worker)

class ErroHttp extends Error { constructor(public status: number, message: string) { super(message) } }

const json = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })

/** Data de hoje no fuso de Brasília (YYYY-MM-DD) */
export const hojeBrasilia = (agora = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora)

const ambienteDe = (env: Env): Ambiente => (env.SICOOB_AMBIENTE?.toUpperCase() === 'PRODUCAO' ? 'PRODUCAO' : 'SANDBOX')

function sicoobDe(env: Env) {
  const ambiente = ambienteDe(env)
  if (ambiente === 'PRODUCAO' && !env.SICOOB_CERT) throw new ErroHttp(500, 'Produção exige o certificado (binding SICOOB_CERT) no Worker.')
  return new Sicoob({
    ambiente, clientId: env.SICOOB_CLIENT_ID ?? '', tokenSandbox: env.SICOOB_TOKEN,
    fetcher: env.SICOOB_CERT ? (i, init) => env.SICOOB_CERT!.fetch(i, init) : undefined,
  })
}

function falha(r: { error: { message: string } | null }, contexto: string) {
  if (r.error) throw new ErroHttp(500, `${contexto}: ${r.error.message}`)
}

async function cliente(req: Request, env: Env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) throw new ErroHttp(500, 'SUPABASE_URL / SUPABASE_ANON_KEY não configurados no Worker.')
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) throw new ErroHttp(401, 'Faça login novamente.')
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  // boletos são exclusivos do administrador TI (as tabelas também: RLS com eh_admin_ti())
  const { data, error } = await sb.rpc('eh_admin_ti')
  if (error || data !== true) throw new ErroHttp(403, 'Boletos: somente administrador TI.')
  return sb
}

async function config(sb: SupabaseClient): Promise<ConfigCobranca> {
  const r = await sb.from('cobranca_config').select('*').eq('id', 1).maybeSingle()
  falha(r, 'Configuração da cobrança')
  if (!r.data) throw new ErroHttp(500, 'Configuração da cobrança não encontrada (rode a migração 0011).')
  return r.data as ConfigCobranca
}

/** Guarda o PDF no Storage; nunca falha a operação: sem o PDF o boleto continua válido e a 2ª via busca de novo */
async function guardarPdf(sb: SupabaseClient, tituloId: number, boletoId: number, pdfBase64: string | null) {
  try {
    const bytes = pdfDeBase64(pdfBase64)
    if (!bytes) {
      if (pdfBase64) console.log(JSON.stringify({ sicoob: { aviso: 'pdfBoleto não é um PDF em base64', inicio: pdfBase64.slice(0, 60) } }))
      return null
    }
    const caminho = `${tituloId}/${boletoId}.pdf`
    const up = await sb.storage.from(BUCKET).upload(caminho, bytes, { contentType: 'application/pdf', upsert: true })
    return up.error ? null : caminho
  } catch { return null }
}

// ---------------------------------------------------------------------------------------------------------------

async function emitir(sb: SupabaseClient, env: Env, corpo: any) {
  const tituloId = Number(corpo?.titulo_id)
  if (!tituloId) throw new ErroHttp(400, 'Informe o título.')
  const rt = await sb.from('titulo')
    .select('id, valor, data_referencia, data_vencimento, situacao, cliente:cliente(cnpj_cpf, razao_social, endereco, bairro, cidade, cep, uf, email)')
    .eq('id', tituloId).maybeSingle()
  falha(rt, 'Título')
  const titulo: any = rt.data
  if (!titulo) throw new ErroHttp(404, 'Título não encontrado.')
  if (titulo.situacao !== 'PENDENTE') throw new ErroHttp(409, 'Só título pendente pode ter boleto.')

  const cfg = await config(sb)
  const hoje = hojeBrasilia()
  const vencimento: string = corpo?.vencimento || titulo.data_vencimento
  let inclusao
  try {
    inclusao = montarInclusao({ config: cfg, titulo, cliente: titulo.cliente, vencimento, hoje })
  } catch (e: any) { throw new ErroHttp(422, e.message) }

  const ambiente = ambienteDe(env)
  const sicoob = sicoobDe(env)
  const novo = { titulo_id: tituloId, ambiente, valor: inclusao.valor, data_vencimento: vencimento, seu_numero: inclusao.seuNumero }
  let ins = await sb.from('boleto').insert(novo).select('id').single()
  if (ins.error?.code === '23505' && ambiente === 'SANDBOX') {
    // sandbox: emissão de teste interrompida (ficou "emitindo") não bloqueia nova tentativa
    const travado = await sb.from('boleto').update({ situacao: 'ERRO', erro: 'Emissão interrompida' })
      .eq('titulo_id', tituloId).eq('situacao', 'EMITINDO').eq('ambiente', 'SANDBOX').select('id')
    if (travado.data?.length) ins = await sb.from('boleto').insert(novo).select('id').single()
  }
  if (ins.error) {
    if (ins.error.code === '23505') throw new ErroHttp(409, 'Este título já tem boleto emitido (ou uma emissão em andamento).')
    throw new ErroHttp(500, `Boleto: ${ins.error.message}`)
  }
  const boletoId = (ins.data as any).id as number

  let reg
  try {
    reg = await sicoob.incluir(inclusao)
  } catch (e: any) {
    await sb.from('boleto').update({ situacao: 'ERRO', erro: String(e.message).slice(0, 500) }).eq('id', boletoId)
    throw new ErroHttp(e instanceof ErroSicoob && e.status < 500 ? 422 : 502, `Sicoob: ${e.message}`)
  }
  // grava primeiro o boleto emitido; o PDF vem depois e não pode desfazer a emissão
  const up = await sb.from('boleto').update({
    situacao: 'EMITIDO', nosso_numero: reg.nossoNumero, linha_digitavel: reg.linhaDigitavel, codigo_barras: reg.codigoBarras,
    pix_copia_cola: reg.pixCopiaCola, resposta: reg.resposta, erro: null,
  }).eq('id', boletoId).select('*').single()
  falha(up, 'Boleto emitido no banco, mas não foi gravado (nosso número ' + reg.nossoNumero + ')')
  if (vencimento !== titulo.data_vencimento) await sb.from('titulo').update({ data_vencimento: vencimento }).eq('id', tituloId)
  const pdf_caminho = await guardarPdf(sb, tituloId, boletoId, reg.pdfBase64)
  if (pdf_caminho) await sb.from('boleto').update({ pdf_caminho }).eq('id', boletoId)
  return { ...(up.data as any), pdf_caminho }
}

async function boletoPorId(sb: SupabaseClient, id: unknown) {
  const r = await sb.from('boleto').select('*').eq('id', Number(id)).maybeSingle()
  falha(r, 'Boleto')
  if (!r.data) throw new ErroHttp(404, 'Boleto não encontrado.')
  return r.data as any
}

async function pdf(sb: SupabaseClient, env: Env, corpo: any) {
  const b = await boletoPorId(sb, corpo?.boleto_id)
  // no sandbox busca sempre de novo (o PDF guardado pode ser o exemplo simulado e quebrado)
  if (b.pdf_caminho && !corpo?.atualizar && b.ambiente === 'PRODUCAO') return { caminho: b.pdf_caminho }
  if (b.nosso_numero == null) throw new ErroHttp(409, 'Boleto sem nosso número.')
  if (b.ambiente !== ambienteDe(env)) throw new ErroHttp(409, `Boleto emitido em ${b.ambiente}; o Worker está em ${ambienteDe(env)}.`)
  const reg = await sicoobDe(env).segundaVia(await config(sb), b.nosso_numero)
  const caminho = await guardarPdf(sb, b.titulo_id, b.id, reg.pdfBase64)
  if (!caminho) throw new ErroHttp(502, b.ambiente === 'SANDBOX'
    ? 'O sandbox do Sicoob não devolve um PDF de verdade (dados simulados); em produção o PDF vem do banco.'
    : 'O banco não devolveu o PDF do boleto.')
  await sb.from('boleto').update({ pdf_caminho: caminho }).eq('id', b.id)
  return { caminho }
}

async function baixar(sb: SupabaseClient, env: Env, corpo: any) {
  const b = await boletoPorId(sb, corpo?.boleto_id)
  if (!['EMITIDO', 'A_BAIXAR'].includes(b.situacao)) throw new ErroHttp(409, 'Só boleto em aberto pode ser baixado.')
  if (b.ambiente !== ambienteDe(env)) throw new ErroHttp(409, `Boleto emitido em ${b.ambiente}; o Worker está em ${ambienteDe(env)}.`)
  await sicoobDe(env).baixar(await config(sb), b.nosso_numero)
  const up = await sb.from('boleto').update({ situacao: 'BAIXADO' }).eq('id', b.id).select('*').single()
  falha(up, 'Boleto baixado no banco, mas não foi gravado')
  return up.data
}

/** Consulta no banco os boletos informados e baixa os títulos pagos */
async function conciliar(sb: SupabaseClient, env: Env, corpo: any) {
  const ids: number[] = (Array.isArray(corpo?.boleto_ids) ? corpo.boleto_ids : []).map(Number).filter(Boolean)
  if (!ids.length) return { liquidados: 0, baixados: 0, abertos: 0, erros: [] }
  if (ids.length > MAX_CONCILIAR) throw new ErroHttp(400, `No máximo ${MAX_CONCILIAR} boletos por vez.`)
  const ambiente = ambienteDe(env)
  const r = await sb.from('boleto').select('id, nosso_numero, situacao').in('id', ids)
    .in('situacao', ['EMITIDO', 'A_BAIXAR']).eq('ambiente', ambiente).not('nosso_numero', 'is', null)
  falha(r, 'Boletos')
  const cfg = await config(sb)
  const sicoob = sicoobDe(env)
  const hoje = hojeBrasilia()
  const res = { liquidados: 0, baixados: 0, abertos: 0, erros: [] as string[] }
  for (const b of (r.data ?? []) as any[]) {
    try {
      const s = await sicoob.consultar(cfg, b.nosso_numero)
      if (s.situacao === 'LIQUIDADO') {
        const l = await sb.rpc('liquidar_boleto', { p_boleto_id: b.id, p_data: s.dataLiquidacao ?? hoje, p_valor: s.valorPago })
        falha(l, 'Liquidação')
        res.liquidados++
      } else if (s.situacao === 'BAIXADO') {
        falha(await sb.from('boleto').update({ situacao: 'BAIXADO' }).eq('id', b.id), 'Baixa')
        res.baixados++
      } else res.abertos++
    } catch (e: any) { res.erros.push(`nosso número ${b.nosso_numero}: ${e.message}`) }
  }
  return res
}

// ---------------------------------------------------------------------------------------------------------------

const ROTAS: Record<string, (sb: SupabaseClient, env: Env, corpo: any) => Promise<unknown>> = {
  '/api/boletos/emitir': emitir,
  '/api/boletos/pdf': pdf,
  '/api/boletos/baixar': baixar,
  '/api/boletos/conciliar': conciliar,
}

export async function tratarApi(req: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(req.url)
  try {
    if (pathname === '/api/boletos/status' && req.method === 'GET') {
      await cliente(req, env)
      return json(200, { ambiente: ambienteDe(env), configurado: Boolean(env.SICOOB_CLIENT_ID && (env.SICOOB_TOKEN || env.SICOOB_CERT)) })
    }
    const fn = ROTAS[pathname]
    if (!fn) return json(404, { erro: 'Rota não encontrada.' })
    if (req.method !== 'POST') return json(405, { erro: 'Use POST.' })
    const sb = await cliente(req, env)
    const corpo = await req.json().catch(() => ({}))
    return json(200, await fn(sb, env, corpo))
  } catch (e: any) {
    const status = e instanceof ErroHttp ? e.status : e instanceof ErroSicoob ? 502 : 500
    return json(status, { erro: e instanceof ErroSicoob ? `Sicoob: ${e.message}` : e?.message ?? 'Erro inesperado' })
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (new URL(req.url).pathname.startsWith('/api/')) return tratarApi(req, env)
    return env.ASSETS.fetch(req)
  },
}
