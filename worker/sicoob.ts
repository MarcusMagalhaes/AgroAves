// Cliente da API Cobrança Bancária v3 do Sicoob.
// Sandbox: token fixo + client_id do portal (respostas simuladas). Produção: OAuth2 client_credentials com
// certificado ICP-Brasil (mTLS) — o certificado entra no Worker como binding mtls_certificates (ver README).
// Caminhos e campos conforme o Catálogo de APIs do portal developers.sicoob.com.br; confira lá ao trocar de versão.
import { montarPagador, type ClientePagador, type Pagador } from '../src/lib/boleto'

export type Ambiente = 'SANDBOX' | 'PRODUCAO'
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

export const URL_BASE: Record<Ambiente, string> = {
  SANDBOX: 'https://sandbox.sicoob.com.br/sicoob/sandbox/cobranca-bancaria/v3',
  PRODUCAO: 'https://api.sicoob.com.br/cobranca-bancaria/v3',
}
const URL_TOKEN = 'https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token'
const ESCOPOS = ['boletos_inclusao', 'boletos_consulta', 'boletos_alteracao'].join(' ')

export class ErroSicoob extends Error {
  constructor(message: string, public status: number, public corpo?: unknown) { super(message) }
}

/** Configuração da cobrança (tabela cobranca_config) */
export interface ConfigCobranca {
  numero_cliente: number | null; codigo_modalidade: number; numero_conta_corrente: number | null
  numero_contrato_cobranca: number | null; especie_documento: string; multa_percentual: number
  juros_mes_percentual: number; com_pix: boolean; mensagem: string | null
}

export interface TituloBoleto { id: number; valor: number; data_referencia: string }

/** Dados de um boleto registrado (o que guardamos na tabela boleto) */
export interface BoletoRegistrado {
  nossoNumero: number; linhaDigitavel: string | null; codigoBarras: string | null; pixCopiaCola: string | null
  pdfBase64: string | null; resposta: Record<string, unknown>
}

export interface SituacaoNoBanco { situacao: 'ABERTO' | 'LIQUIDADO' | 'BAIXADO'; dataLiquidacao: string | null; valorPago: number | null }

export const somaDias = (iso: string, dias: number) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** Corpo do POST /boletos para um título */
export function montarInclusao(p: {
  config: ConfigCobranca; titulo: TituloBoleto; cliente: ClientePagador; vencimento: string; hoje: string
}) {
  const { config, titulo, vencimento, hoje } = p
  if (!config.numero_cliente) throw new Error('Configure o número do cliente (beneficiário) Sicoob em Contas a receber › Cobrança.')
  if (!(Number(titulo.valor) > 0)) throw new Error('Só é possível emitir boleto de título com valor positivo.')
  if (vencimento < hoje) throw new Error('O vencimento não pode ser anterior a hoje.')
  const pagador: Pagador = montarPagador(p.cliente)
  const multa = Number(config.multa_percentual) || 0
  const juros = Number(config.juros_mes_percentual) || 0
  const depois = somaDias(vencimento, 1)
  const mensagens = (config.mensagem ?? '').split('\n').map((m) => m.trim()).filter(Boolean).slice(0, 5).map((m) => m.slice(0, 40))
  return {
    numeroCliente: Number(config.numero_cliente),
    codigoModalidade: config.codigo_modalidade,
    numeroContaCorrente: Number(config.numero_conta_corrente ?? 0),
    ...(config.numero_contrato_cobranca ? { numeroContratoCobranca: Number(config.numero_contrato_cobranca) } : {}),
    codigoEspecieDocumento: config.especie_documento,
    dataEmissao: hoje,
    seuNumero: String(titulo.id),
    identificacaoEmissaoBoleto: 1,        // banco emite
    identificacaoDistribuicaoBoleto: 2,   // empresa entrega ao cliente
    valor: Math.round(Number(titulo.valor) * 100) / 100,
    dataVencimento: vencimento,
    tipoDesconto: 0,
    ...(multa > 0 ? { tipoMulta: 2, dataMulta: depois, valorMulta: multa } : { tipoMulta: 0 }),
    ...(juros > 0 ? { tipoJurosMora: 2, dataJurosMora: depois, valorJurosMora: juros } : { tipoJurosMora: 3 }),
    numeroParcela: 1,
    aceite: true,
    pagador,
    ...(mensagens.length ? { mensagensInstrucao: { mensagens } } : {}),
    gerarPdf: true,
    codigoCadastrarPIX: config.com_pix ? 1 : 2,
  }
}

// "string" é o valor-exemplo da documentação, devolvido pelo sandbox no lugar dos dados
const texto = (v: unknown) => (typeof v === 'string' && v.trim() && v.trim() !== 'string' ? v.trim() : null)

/** Lê o retorno da inclusão / 2ª via */
export function lerBoleto(retorno: any, sandbox = false): BoletoRegistrado {
  // v3: { resultado: {...} }; aceita também o formato em lista da v2 ({ resultado: [{ boleto: {...} }] })
  let resultado: Record<string, any> = retorno?.resultado ?? retorno ?? {}
  if (Array.isArray(resultado)) resultado = resultado[0]?.boleto ?? resultado[0] ?? {}
  let nossoNumero = Number(resultado.nossoNumero)
  if (!Number.isFinite(nossoNumero) || nossoNumero <= 0) {
    console.log(JSON.stringify({ sicoob: { aviso: 'retorno sem nosso número', sandbox, campos: Object.keys(resultado), nossoNumero: resultado.nossoNumero } }))
    // o sandbox devolve dados simulados (nosso número 0): aceita para o teste seguir
    if (!sandbox) throw new ErroSicoob('O banco não devolveu o nosso número do boleto.', 200, resultado)
    nossoNumero = 0
  }
  const { pdfBoleto, ...resto } = resultado
  return {
    nossoNumero,
    linhaDigitavel: texto(resultado.linhaDigitavel),
    codigoBarras: texto(resultado.codigoBarras),
    pixCopiaCola: texto(resultado.qrCode),
    pdfBase64: texto(pdfBoleto),
    resposta: resto,
  }
}

/** Interpreta a consulta do boleto: aberto, liquidado (com data e valor) ou baixado */
export function lerSituacao(resultado: Record<string, any>): SituacaoNoBanco {
  const s = String(resultado.situacaoBoleto ?? '').toLowerCase()
  const historico: any[] = Array.isArray(resultado.listaHistorico) ? resultado.listaHistorico : []
  const evLiq = historico.find((h) => /liquid|pagament|pago/i.test(String(h?.descricaoHistorico ?? '')))
  const data = texto(resultado.dataLiquidacao) ?? texto(evLiq?.dataHistorico)
  const valor = Number(resultado.valorLiquidado ?? resultado.valorPago ?? NaN)
  if (s.includes('liquid') || s.includes('pago')) {
    return { situacao: 'LIQUIDADO', dataLiquidacao: data ? data.slice(0, 10) : null, valorPago: Number.isFinite(valor) ? valor : null }
  }
  if (s.includes('baixa')) return { situacao: 'BAIXADO', dataLiquidacao: null, valorPago: null }
  return { situacao: 'ABERTO', dataLiquidacao: null, valorPago: null }
}

function mensagemErro(corpo: any, status: number) {
  const msgs: string[] = Array.isArray(corpo?.mensagens)
    ? corpo.mensagens.map((m: any) => [m?.codigo, m?.mensagem].filter((x) => x != null && x !== 'string').join(' ')).filter(Boolean)
    : []
  const texto = msgs.length ? msgs.join(' · ')
    : typeof corpo?.message === 'string' ? corpo.message
    : typeof corpo?.error_description === 'string' ? corpo.error_description
    : ''
  // o sandbox responde com o exemplo da documentação ("string"): mostra o retorno bruto para diagnóstico
  const bruto = corpo == null ? '' : JSON.stringify(corpo).slice(0, 300)
  return `HTTP ${status}: ${texto || bruto || 'sem detalhes'}`
}

export interface OpcoesSicoob {
  ambiente: Ambiente
  clientId: string
  /** Sandbox: o "Access token (Bearer)" do portal */
  tokenSandbox?: string
  /** fetch com o certificado (binding mTLS); sem ele usa o fetch comum (sandbox) */
  fetcher?: Fetcher
}

export class Sicoob {
  private base: string
  private fetcher: Fetcher
  private token: { valor: string; expira: number } | null = null

  constructor(private o: OpcoesSicoob) {
    if (!o.clientId) throw new Error('SICOOB_CLIENT_ID não configurado no Worker.')
    if (o.ambiente === 'SANDBOX' && !o.tokenSandbox) throw new Error('SICOOB_TOKEN (sandbox) não configurado no Worker.')
    this.base = URL_BASE[o.ambiente]
    this.fetcher = o.fetcher ?? ((i, init) => fetch(i, init))
  }

  private async bearer() {
    if (this.o.ambiente === 'SANDBOX') return this.o.tokenSandbox!
    if (this.token && this.token.expira > Date.now() + 30_000) return this.token.valor
    const r = await this.fetcher(URL_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.o.clientId, scope: ESCOPOS }).toString(),
    })
    const corpo: any = await r.json().catch(() => null)
    if (!r.ok || !corpo?.access_token) throw new ErroSicoob(`Falha na autenticação no Sicoob: ${mensagemErro(corpo, r.status)}`, r.status, corpo)
    this.token = { valor: corpo.access_token, expira: Date.now() + Number(corpo.expires_in ?? 300) * 1000 }
    return this.token.valor
  }

  private async chamar(metodo: string, caminho: string, corpo?: unknown): Promise<any> {
    const r = await this.fetcher(`${this.base}${caminho}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${await this.bearer()}`,
        client_id: this.o.clientId,
        Accept: 'application/json',
        ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    })
    const txt = await r.text()
    let json: any = null
    try { json = txt ? JSON.parse(txt) : null } catch { json = { message: txt.slice(0, 300) } }
    if (!r.ok) {
      // aparece em Cloudflare › agroaves › Observability › Logs
      console.log(JSON.stringify({ sicoob: { metodo, caminho: caminho.split('?')[0], status: r.status, enviado: corpo, resposta: json } }))
      throw new ErroSicoob(mensagemErro(json, r.status), r.status, json)
    }
    return json
  }

  private chave(config: ConfigCobranca, nossoNumero: number) {
    const q = new URLSearchParams({
      numeroCliente: String(config.numero_cliente), codigoModalidade: String(config.codigo_modalidade), nossoNumero: String(nossoNumero),
    })
    if (config.numero_contrato_cobranca) q.set('numeroContratoCobranca', String(config.numero_contrato_cobranca))
    return q
  }

  async incluir(corpo: ReturnType<typeof montarInclusao>) {
    const r = await this.chamar('POST', '/boletos', corpo)
    return lerBoleto(r, this.o.ambiente === 'SANDBOX')
  }

  async consultar(config: ConfigCobranca, nossoNumero: number) {
    const r = await this.chamar('GET', `/boletos?${this.chave(config, nossoNumero)}`)
    return lerSituacao(r?.resultado ?? r ?? {})
  }

  async segundaVia(config: ConfigCobranca, nossoNumero: number) {
    const q = this.chave(config, nossoNumero); q.set('gerarPdf', 'true')
    const r = await this.chamar('GET', `/boletos/segunda-via?${q}`)
    return lerBoleto(r, this.o.ambiente === 'SANDBOX')
  }

  async baixar(config: ConfigCobranca, nossoNumero: number) {
    await this.chamar('POST', `/boletos/${nossoNumero}/baixar`, {
      numeroCliente: Number(config.numero_cliente), codigoModalidade: config.codigo_modalidade,
      ...(config.numero_contrato_cobranca ? { numeroContratoCobranca: Number(config.numero_contrato_cobranca) } : {}),
    })
  }
}
