// Configuração do emissor. Dados do emitente vêm do cadastro atual da AgroAves (sistema de NF que o cliente usa hoje).
// Certificado e senha NUNCA ficam no código nem no repositório: só em variáveis de ambiente (.env, fora do git).
import { readFileSync, existsSync } from 'node:fs'

export type Ambiente = 1 | 2 // 1 = produção, 2 = homologação

export interface Emitente {
  cnpj: string; ie: string; razao: string; fantasia: string; crt: '1' | '2' | '3' | '4'
  logradouro: string; numero: string; complemento?: string; bairro: string
  cMun: string; xMun: string; uf: string; cep: string; fone?: string
}

export const EMITENTE: Emitente = {
  cnpj: '51071556000100',
  ie: '0046416040000',
  razao: 'AGROAVES DISTRIBUIDORA PINTINHOS DE UM DIA LTDA',
  fantasia: 'AGROAVES DISTRIBUIDORA',
  crt: '1', // Simples Nacional
  logradouro: 'AVENIDA JOAQUIM AVELINO DOS REIS',
  numero: '634',
  bairro: 'Industrial',
  cMun: '3158953',
  xMun: 'Santana do Paraiso',
  uf: 'MG',
  cep: '35179000',
  // fone: '3138223630', // o cadastro veio com 7 dígitos ("31 3822-363"): confirmar antes de usar
}

/** Código IBGE da UF (cUF) */
export const UF_IBGE: Record<string, string> = {
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17', MA: '21', PI: '22', CE: '23', RN: '24', PB: '25', PE: '26',
  AL: '27', SE: '28', BA: '29', MG: '31', ES: '32', RJ: '33', SP: '35', PR: '41', SC: '42', RS: '43', MS: '50', MT: '51', GO: '52', DF: '53',
}

/** Web services da SEFAZ-MG (NF-e 4.00). Fonte: lista de autorizadores do Portal Nacional da NF-e. */
export const WS_MG = {
  2: {
    status: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeStatusServico4',
    autorizacao: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeAutorizacao4',
    retAutorizacao: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeRetAutorizacao4',
    consulta: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeConsultaProtocolo4',
  },
  1: {
    status: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeStatusServico4',
    autorizacao: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeAutorizacao4',
    retAutorizacao: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeRetAutorizacao4',
    consulta: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeConsultaProtocolo4',
  },
} as const

export const VER_PROC = 'AgroAves-NFe 0.1'

/** Carrega o .env da pasta nfe/ (sem dependência externa) */
export function carregarEnv(caminho = new URL('../.env', import.meta.url)) {
  if (!existsSync(caminho)) return
  for (const linha of readFileSync(caminho, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

export interface Config { ambiente: Ambiente; pfxPath: string; pfxSenha: string; serie: number; caFile?: string }

export function lerConfig(): Config {
  carregarEnv()
  const ambiente = Number(process.env.NFE_AMBIENTE ?? 2) as Ambiente
  // Trava do protótipo: produção não é permitida. Remover só quando o projeto for aprovado para produção.
  if (ambiente !== 2) throw new Error('Protótipo: somente homologação (NFE_AMBIENTE=2). Produção está bloqueada no código.')
  const pfxPath = process.env.NFE_PFX ?? ''
  const pfxSenha = process.env.NFE_PFX_SENHA ?? ''
  if (!pfxPath || !existsSync(pfxPath)) throw new Error('Defina NFE_PFX com o caminho do certificado A1 (.pfx) no arquivo nfe/.env')
  if (!pfxSenha) throw new Error('Defina NFE_PFX_SENHA no arquivo nfe/.env')
  return { ambiente, pfxPath, pfxSenha, serie: Number(process.env.NFE_SERIE ?? 99), caFile: process.env.NFE_CA_FILE || undefined }
}
