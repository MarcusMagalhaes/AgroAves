// Leitura de extrato OFX (formato que os bancos exportam: 1.x SGML, sem fechar as tags, ou 2.x XML)
// Extrai banco/agência/conta, período, saldo (LEDGERBAL) e os lançamentos (STMTTRN). Roda no navegador.

export interface LancamentoOfx { fitid: string; data: string; valor: number; tipo: string | null; descricao: string | null; documento: string | null }
export interface ExtratoOfx {
  bancoId: string | null; agencia: string | null; conta: string | null; moeda: string | null
  inicio: string | null; fim: string | null; saldo: number | null; saldoData: string | null; saldoDisponivel: number | null
  lancamentos: LancamentoOfx[]; avisos: string[]
}

/** Lê o arquivo respeitando a codificação declarada (bancos brasileiros costumam usar windows-1252) */
export async function lerArquivoOfx(arquivo: File): Promise<string> {
  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  const cabecalho = new TextDecoder('ascii').decode(bytes.slice(0, 600)).toUpperCase()
  const latin = /CHARSET:\s*(1252|ISO-8859-1|8859-1)|ENCODING="?(ISO-8859-1|WINDOWS-1252)/.test(cabecalho)
  if (latin) return new TextDecoder('windows-1252').decode(bytes)
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(bytes) : utf8
}

/** Valor de uma tag folha: <TAG>valor (SGML) ou <TAG>valor</TAG> (XML) */
function tag(bloco: string, nome: string): string | null {
  const m = new RegExp(`<${nome}>\\s*([^<\\r\\n]*)`, 'i').exec(bloco)
  const v = m?.[1]?.trim()
  return v ? v.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : null
}
/** Conteúdo de um agregado <NOME>…</NOME> (agregados são fechados também no SGML) */
function blocos(texto: string, nome: string): string[] {
  const re = new RegExp(`<${nome}>([\\s\\S]*?)</${nome}>`, 'gi')
  return [...texto.matchAll(re)].map((m) => m[1])
}
/** 20261002 ou 20261002120000 com fuso (-3:BRT) → 2026-10-02 */
function data(v: string | null): string | null {
  const m = v && /^(\d{4})(\d{2})(\d{2})/.exec(v)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}
/** "-1234.56", "1234,56", "+10.00" → número */
function numero(v: string | null): number | null {
  if (!v) return null
  let t = v.replace(/\s/g, '')
  if (t.includes(',') && !t.includes('.')) t = t.replace(',', '.')
  else if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.')
  const n = Number(t)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

export function interpretarOfx(texto: string): ExtratoOfx {
  const avisos: string[] = []
  if (!/<OFX>/i.test(texto)) throw new Error('O arquivo não parece ser um OFX (não encontrei a marca <OFX>).')
  const stmts = blocos(texto, 'STMTRS')
  const cartao = blocos(texto, 'CCSTMTRS')
  if (!stmts.length && cartao.length) throw new Error('Este OFX é de cartão de crédito; importe o extrato da conta corrente.')
  if (!stmts.length) throw new Error('Não encontrei o extrato da conta (<STMTRS>) no arquivo.')
  if (stmts.length > 1) avisos.push(`O arquivo tem ${stmts.length} contas; foi lida só a primeira.`)
  const s = stmts[0]
  const contaBloco = blocos(s, 'BANKACCTFROM')[0] ?? s
  const lista = blocos(s, 'BANKTRANLIST')[0] ?? ''
  const ledger = blocos(s, 'LEDGERBAL')[0] ?? ''
  const avail = blocos(s, 'AVAILBAL')[0] ?? ''

  const vistos = new Map<string, number>()
  const lancamentos: LancamentoOfx[] = []
  for (const [i, t] of blocos(lista, 'STMTTRN').entries()) {
    const d = data(tag(t, 'DTPOSTED'))
    const v = numero(tag(t, 'TRNAMT'))
    if (!d || v == null) { avisos.push(`Lançamento ${i + 1} ignorado (sem data ou valor).`); continue }
    const memo = tag(t, 'MEMO') ?? tag(t, 'NAME')
    const doc = tag(t, 'CHECKNUM') ?? tag(t, 'REFNUM')
    // sem FITID (ou repetido no arquivo): monta um identificador estável com data, valor, histórico e ordem
    let fitid = tag(t, 'FITID') ?? `${d}|${v}|${memo ?? ''}|${doc ?? ''}`
    const n = vistos.get(fitid) ?? 0
    vistos.set(fitid, n + 1)
    if (n > 0) fitid = `${fitid}#${n + 1}`
    lancamentos.push({ fitid, data: d, valor: v, tipo: tag(t, 'TRNTYPE'), descricao: memo, documento: doc })
  }

  const saldo = numero(tag(ledger, 'BALAMT'))
  if (saldo == null) avisos.push('O arquivo não traz o saldo (LEDGERBAL); informe o saldo à mão se precisar.')
  return {
    bancoId: tag(contaBloco, 'BANKID'), agencia: tag(contaBloco, 'BRANCHID'), conta: tag(contaBloco, 'ACCTID'), moeda: tag(s, 'CURDEF'),
    inicio: data(tag(lista, 'DTSTART')), fim: data(tag(lista, 'DTEND')),
    saldo, saldoData: data(tag(ledger, 'DTASOF')) ?? data(tag(lista, 'DTEND')), saldoDisponivel: numero(tag(avail, 'BALAMT')),
    lancamentos, avisos,
  }
}

/** Compara só os dígitos, sem zeros à esquerda (bancos formatam agência/conta de jeitos diferentes) */
export const mesmoNumero = (a: string | null | undefined, b: string | null | undefined) => {
  const n = (x: string) => x.replace(/\D/g, '').replace(/^0+/, '')
  return !a || !b || n(a) === n(b) || n(a).startsWith(n(b)) || n(b).startsWith(n(a))
}
