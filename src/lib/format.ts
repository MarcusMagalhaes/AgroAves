export const fmtMoeda = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export const fmtNum = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR')

/** 'YYYY-MM-DD' -> 'DD/MM/YYYY' (sem conversão de fuso) */
export const fmtData = (iso: string | null | undefined) => {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export const fmtDataHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''

export const hojeISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const dataExtenso = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro']
  return `${d} de ${meses[m - 1]} de ${y}`
}

export const normalizar = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export const somenteDigitos = (s: string) => s.replace(/\D/g, '')

/** Número → texto de preço com vírgula e 2 casas ('4,95'); vazio para null */
export const fmtPreco = (v: number | string | null | undefined) => {
  if (v === null || v === undefined || v === '') return ''
  const n = typeof v === 'number' ? v : parsePreco(v)
  return n == null ? '' : n.toFixed(2).replace('.', ',')
}
/** Texto digitado ('4,95', '4.95', 'R$ 1.256,10') → número ou null */
export const parsePreco = (s: string | number | null | undefined): number | null => {
  if (s === null || s === undefined || s === '') return null
  if (typeof s === 'number') return s
  const t = s.replace(/[^\d,.-]/g, '')
  const semMilhar = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  const n = Number(semMilhar)
  return Number.isFinite(n) ? n : null
}
/** Mantém só dígitos e uma vírgula enquanto digita */
export const mascaraPreco = (s: string) => {
  const t = s.replace(/\./g, ',').replace(/[^\d,]/g, '')
  const i = t.indexOf(',')
  return i < 0 ? t : t.slice(0, i + 1) + t.slice(i + 1).replace(/,/g, '').slice(0, 2)
}
