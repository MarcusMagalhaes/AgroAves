// Regras do boleto compartilhadas entre a tela e o Worker (worker/): validação do pagador e situações.
// Sem dependências do navegador nem do Supabase, para rodar nos dois lados.

const digitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

export function cpfValido(v: string | null | undefined) {
  const d = digitos(v)
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false
  const dv = (n: number) => {
    let s = 0
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i)
    const r = (s * 10) % 11
    return r === 10 ? 0 : r
  }
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10])
}

export function cnpjValido(v: string | null | undefined) {
  const d = digitos(v)
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const s = pesos.reduce((acc, p, i) => acc + Number(d[i]) * p, 0)
    const r = s % 11
    return r < 2 ? 0 : 11 - r
  }
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13])
}

export const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE',
  'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'] as const

/** Dados do cliente usados como pagador do boleto */
export interface ClientePagador {
  cnpj_cpf: string | null; razao_social: string; endereco: string | null; bairro: string | null
  cidade: string | null; cep: string | null; uf: string | null; email: string | null
}

/** Pagador no formato da API Cobrança Bancária v3 */
export interface Pagador {
  numeroCpfCnpj: string; nome: string; endereco: string; bairro: string; cidade: string; cep: string; uf: string; email?: string
}

/** Lista o que falta no cadastro do cliente para emitir boleto (vazia = pode emitir) */
export function pendenciasPagador(c: ClientePagador): string[] {
  const p: string[] = []
  const doc = digitos(c.cnpj_cpf)
  if (!doc) p.push('CNPJ/CPF')
  else if (doc.length === 11 ? !cpfValido(doc) : doc.length === 14 ? !cnpjValido(doc) : true) p.push('CNPJ/CPF inválido')
  if (!c.razao_social?.trim()) p.push('razão social')
  if (!c.endereco?.trim()) p.push('endereço')
  if (!c.bairro?.trim()) p.push('bairro')
  if (!c.cidade?.trim()) p.push('cidade')
  if (digitos(c.cep).length !== 8) p.push('CEP')
  if (!UFS.includes((c.uf ?? '').toUpperCase() as (typeof UFS)[number])) p.push('UF')
  return p
}

// limites de tamanho dos campos do pagador na API
const corta = (s: string | null | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

export function montarPagador(c: ClientePagador): Pagador {
  const falta = pendenciasPagador(c)
  if (falta.length) throw new Error(`Cadastro do cliente incompleto para boleto: ${falta.join(', ')}`)
  const email = corta(c.email, 50)
  return {
    numeroCpfCnpj: digitos(c.cnpj_cpf),
    nome: corta(c.razao_social, 50),
    endereco: corta(c.endereco, 40),
    bairro: corta(c.bairro, 30),
    cidade: corta(c.cidade, 40),
    cep: digitos(c.cep),
    uf: (c.uf ?? '').toUpperCase(),
    ...(email ? { email } : {}),
  }
}

export type SituacaoBoleto = 'EMITINDO' | 'EMITIDO' | 'LIQUIDADO' | 'A_BAIXAR' | 'BAIXADO' | 'ERRO'
export const SITUACOES_BOLETO: Record<SituacaoBoleto, string> = {
  EMITINDO: 'Emitindo', EMITIDO: 'Emitido', LIQUIDADO: 'Pago', A_BAIXAR: 'Baixar no banco', BAIXADO: 'Baixado', ERRO: 'Erro',
}
