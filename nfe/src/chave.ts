// Chave de acesso da NF-e (44 dígitos) e dígito verificador (módulo 11, pesos 2..9 da direita para a esquerda)

export function dvModulo11(base: string): string {
  let soma = 0, peso = 2
  for (let i = base.length - 1; i >= 0; i--) {
    soma += Number(base[i]) * peso
    peso = peso === 9 ? 2 : peso + 1
  }
  const resto = soma % 11
  return String(resto < 2 ? 0 : 11 - resto)
}

export interface PartesChave {
  cUF: string; aamm: string; cnpj: string; mod: string; serie: number; nNF: number; tpEmis: string; cNF: string
}

export function montarChave(p: PartesChave): { chave: string; cDV: string } {
  const base = p.cUF + p.aamm + p.cnpj.padStart(14, '0') + p.mod + String(p.serie).padStart(3, '0') +
    String(p.nNF).padStart(9, '0') + p.tpEmis + p.cNF.padStart(8, '0')
  if (base.length !== 43 || !/^\d+$/.test(base)) throw new Error(`Base da chave inválida: ${base}`)
  const cDV = dvModulo11(base)
  return { chave: base + cDV, cDV }
}

/** Código numérico aleatório da chave (cNF). Não pode ser igual ao nNF. */
export function gerarCNF(nNF: number): string {
  let c: string
  do { c = String(Math.floor(Math.random() * 1e8)).padStart(8, '0') } while (Number(c) === nNF)
  return c
}
