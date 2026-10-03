// Completar endereços de clientes (bairro, CEP, UF) a partir de fontes públicas, no navegador do usuário:
//  - CNPJ → BrasilAPI (dados da Receita Federal): endereço completo do estabelecimento
//  - rua + cidade → ViaCEP (base dos Correios): CEP e bairro; escolhe pela numeração quando a rua tem vários CEPs
// CPF nunca é enviado a serviços externos. Só bairro, CEP e UF vazios são completados, depois da revisão do usuário.
import { UFS, cnpjValido } from './boleto'

export type Fetcher = (url: string) => Promise<Response>

export interface ClienteEndereco {
  id: number; codigo: number; razao_social: string; cnpj_cpf: string | null; endereco: string | null
  bairro: string | null; cidade: string | null; cep: string | null; uf: string | null
}

/** Endereço encontrado numa fonte */
export interface Achado { endereco?: string; bairro?: string; cidade?: string; cep: string; uf: string }

export type Resultado =
  | { status: 'OK'; fonte: string; achado: Achado }
  | { status: 'AMBIGUO'; fonte: string; opcoes: Achado[] }
  | { status: 'NAO_ENCONTRADO'; motivo: string }

const digitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')
const vazio = (s: string | null | undefined) => !(s ?? '').trim()
export const fmtCep = (s: string) => { const d = digitos(s); return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : d }
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
const titulo = (s: string) => s.trim().replace(/\s+/g, ' ')

/** Cliente precisa de complemento? (bairro, CEP ou UF vazio) */
export const faltaEndereco = (c: ClienteEndereco) => vazio(c.bairro) || vazio(c.cep) || vazio(c.uf)

const TIPOS = ['AVENIDA', 'AV', 'RUA', 'R', 'TRAVESSA', 'TV', 'TRAV', 'ALAMEDA', 'AL', 'PRACA', 'PCA', 'PC', 'RODOVIA', 'ROD',
  'ESTRADA', 'EST', 'BECO', 'LARGO', 'VIA', 'VILA', 'SITIO', 'FAZENDA', 'FAZ', 'CHACARA', 'LOTEAMENTO', 'CONJUNTO']

/** Separa logradouro (sem o tipo) e número de um endereço livre: "AV. MONSENHOR ARISTIDES ROCHA, 525, GRACA" */
export function partesEndereco(endereco: string | null | undefined): { logradouro: string; numero: number | null; cep: string | null } {
  const txt = semAcento(endereco ?? '').toUpperCase()
  const cepNoTexto = txt.match(/\b(\d{5})-?(\d{3})\b/)
  const semCep = (cepNoTexto ? txt.replace(cepNoTexto[0], ' ') : txt).replace(/\s+/g, ' ').trim()
  let logradouro: string; let numero: number | null = null
  const virgula = semCep.search(/[,;]/)
  if (virgula >= 0) {
    // "RUA 7 DE SETEMBRO, 100, CENTRO": rua antes da vírgula, número logo depois
    logradouro = semCep.slice(0, virgula)
    const n = semCep.slice(virgula).match(/\d+/)
    numero = n ? Number(n[0]) : null
  } else {
    // "RUA 7 DE SETEMBRO 100 CENTRO": o último número solto é o da casa
    const m = semCep.match(/^(.*?)\s+(?:N[º°O.]?\s*)?(\d+)(?!.*\s\d)/)
    logradouro = m ? m[1] : semCep
    numero = m ? Number(m[2]) : null
  }
  logradouro = logradouro.replace(/[.]/g, ' ').replace(/\s+(N[º°O]?)$/, '').replace(/\s+/g, ' ').trim()
  const palavras = logradouro.split(' ')
  if (palavras.length > 1 && TIPOS.includes(palavras[0])) logradouro = palavras.slice(1).join(' ')
  return { logradouro, numero, cep: cepNoTexto ? cepNoTexto[1] + cepNoTexto[2] : null }
}

/** O número está na faixa descrita no complemento do ViaCEP? ("até 499/500", "de 501/502 ao fim", "lado ímpar") */
export function numeroNaFaixa(numero: number | null, complemento: string | null | undefined): boolean | null {
  const c = semAcento(complemento ?? '').toLowerCase()
  if (!c.trim()) return null
  if (numero == null) return null
  if (/lado par/.test(c) && numero % 2 !== 0) return false
  if (/lado impar/.test(c) && numero % 2 === 0) return false
  const ate = c.match(/^ate (\d+)/)
  if (ate) return numero <= Number(ate[1].split('/')[0]) + 1
  const deAo = c.match(/^de (\d+)(?:\/\d+)? (?:ao fim|a\b)/)
  const deA = c.match(/^de (\d+)(?:\/\d+)? a (\d+)/)
  if (deA) return numero >= Number(deA[1]) && numero <= Number(deA[2]) + 1
  if (deAo) return numero >= Number(deAo[1])
  return null
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function obterJson(fetcher: Fetcher, url: string): Promise<{ status: number; json: any }> {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const r = await fetcher(url)
    if (r.status === 429 || r.status >= 500) { await espera(1500 * (tentativa + 1)); continue }
    return { status: r.status, json: await r.json().catch(() => null) }
  }
  return { status: 429, json: null }
}

/** Endereço do estabelecimento pelo CNPJ (BrasilAPI / Receita Federal) */
export async function porCnpj(fetcher: Fetcher, cnpj: string): Promise<Achado | null> {
  const { status, json } = await obterJson(fetcher, `https://brasilapi.com.br/api/cnpj/v1/${digitos(cnpj)}`)
  if (status !== 200 || !json || digitos(json.cep).length !== 8) return null
  const rua = [json.descricao_tipo_de_logradouro, json.logradouro].filter(Boolean).join(' ')
  const numero = json.numero && json.numero !== 'S/N' ? json.numero : 'S/N'
  return {
    endereco: rua ? titulo(`${rua}, ${numero}${json.complemento ? ` - ${json.complemento}` : ''}`) : undefined,
    bairro: json.bairro ? titulo(json.bairro) : undefined,
    cidade: json.municipio ? titulo(json.municipio) : undefined,
    cep: digitos(json.cep), uf: String(json.uf ?? '').toUpperCase(),
  }
}

/** Confere um CEP (ViaCEP) */
export async function porCep(fetcher: Fetcher, cep: string): Promise<Achado | null> {
  const { status, json } = await obterJson(fetcher, `https://viacep.com.br/ws/${digitos(cep)}/json/`)
  if (status !== 200 || !json || json.erro) return null
  return { bairro: json.bairro || undefined, cidade: json.localidade, cep: digitos(json.cep), uf: json.uf }
}

/** CEPs de uma rua numa cidade (ViaCEP); devolve os candidatos já filtrados pela numeração */
export async function porRua(fetcher: Fetcher, uf: string, cidade: string, endereco: string): Promise<Resultado> {
  const { logradouro, numero } = partesEndereco(endereco)
  if (logradouro.length < 3) return { status: 'NAO_ENCONTRADO', motivo: 'endereço sem nome de rua' }
  const url = `https://viacep.com.br/ws/${uf}/${encodeURIComponent(semAcento(cidade).trim())}/${encodeURIComponent(logradouro)}/json/`
  const { status, json } = await obterJson(fetcher, url)
  if (status !== 200 || !Array.isArray(json) || !json.length) return { status: 'NAO_ENCONTRADO', motivo: 'rua não encontrada nos Correios' }
  const achados = json.map((j: any) => ({ achado: { bairro: j.bairro || undefined, cidade: j.localidade, cep: digitos(j.cep), uf: j.uf } as Achado, faixa: numeroNaFaixa(numero, j.complemento) }))
  // mesma rua pode aparecer em vários bairros/CEPs: fica com os da faixa do número; sem número, todos
  const naFaixa = achados.filter((a) => a.faixa === true)
  const candidatos = (naFaixa.length ? naFaixa : achados.filter((a) => a.faixa !== false)).map((a) => a.achado)
  const unicos = [...new Map(candidatos.map((a) => [a.cep, a])).values()]
  if (unicos.length === 1) return { status: 'OK', fonte: 'Correios (rua)', achado: unicos[0] }
  if (!unicos.length) return { status: 'NAO_ENCONTRADO', motivo: 'número fora das faixas da rua' }
  return { status: 'AMBIGUO', fonte: 'Correios (rua)', opcoes: unicos.slice(0, 15) }
}

/** Procura o endereço do cliente: CNPJ → CEP escrito no endereço → rua + cidade */
export async function buscarEndereco(fetcher: Fetcher, c: ClienteEndereco, ufPadrao: string): Promise<Resultado> {
  if (cnpjValido(c.cnpj_cpf)) {
    const a = await porCnpj(fetcher, c.cnpj_cpf!)
    if (a) return { status: 'OK', fonte: 'Receita (CNPJ)', achado: a }
  }
  const { cep } = partesEndereco(c.endereco)
  const cepInformado = digitos(c.cep).length === 8 ? digitos(c.cep) : cep
  if (cepInformado) {
    const a = await porCep(fetcher, cepInformado)
    if (a) return { status: 'OK', fonte: 'Correios (CEP)', achado: a }
  }
  if (vazio(c.endereco) || vazio(c.cidade)) return { status: 'NAO_ENCONTRADO', motivo: 'sem CNPJ e sem endereço/cidade' }
  const uf = (c.uf ?? '').toUpperCase()
  return porRua(fetcher, UFS.includes(uf as (typeof UFS)[number]) ? uf : ufPadrao, c.cidade!, c.endereco!)
}

/** Campos a gravar: só bairro, CEP e UF, e só os que estão vazios (nunca altera o que já está preenchido) */
export function camposParaGravar(c: ClienteEndereco, a: Achado) {
  const out: Partial<Record<'bairro' | 'cep' | 'uf', string>> = {}
  if (vazio(c.bairro) && a.bairro) out.bairro = a.bairro
  if (vazio(c.cep) && digitos(a.cep).length === 8) out.cep = fmtCep(a.cep)
  if (vazio(c.uf) && a.uf) out.uf = a.uf.toUpperCase()
  return out
}
