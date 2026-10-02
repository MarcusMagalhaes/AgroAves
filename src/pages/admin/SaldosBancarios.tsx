// Saldos bancários e extrato (exclusivo do administrador TI): importação de OFX por conta, saldo informado à mão
// e consulta dos lançamentos importados. Somente leitura do banco: nada aqui movimenta conta.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, ok } from '@/lib/supabase'
import { rpc } from '@/lib/dados'
import { fmtData, fmtDataHora, fmtMoeda, hojeISO, mascaraPreco, parsePreco } from '@/lib/format'
import { interpretarOfx, lerArquivoOfx, mesmoNumero, type ExtratoOfx } from '@/lib/ofx'
import type { ContaBancaria, SaldoConta } from '@/lib/types'
import { Campo, Carregando, Chip, Modal, Titulo, useToast } from '@/components/ui'

type Lancamento = { id: number; data: string; valor: number; tipo: string | null; descricao: string | null; documento: string | null }
type Importacao = { id: number; arquivo_nome: string | null; data_inicio: string | null; data_fim: string | null; saldo: number | null; saldo_data: string | null; qtd_lancamentos: number; qtd_novos: number; criado_em: string }
type Leitura = { arquivo: File; extrato: ExtratoOfx; confirmado: boolean }

const diasAtras = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const corValor = (v: number | null | undefined) => (Number(v) < 0 ? 'text-red-700' : 'text-slate-900')

export default function SaldosBancarios() {
  const { toast } = useToast()
  const [saldos, setSaldos] = useState<SaldoConta[] | null>(null)
  const [contas, setContas] = useState<ContaBancaria[]>([])
  const [contaId, setContaId] = useState<number | null>(null)
  const [de, setDe] = useState(diasAtras(30))
  const [ate, setAte] = useState(hojeISO())
  const [lancs, setLancs] = useState<Lancamento[] | null>(null)
  const [importacoes, setImportacoes] = useState<Importacao[]>([])
  const [importar, setImportar] = useState<{ contaId: number | ''; leitura: Leitura | null; lendo: boolean; enviando: boolean } | null>(null)
  const [manual, setManual] = useState<{ contaId: number | ''; data: string; saldo: string } | null>(null)
  const [ajuda, setAjuda] = useState(false)

  async function carregarSaldos() {
    try {
      const [s, c] = await Promise.all([
        rpc<SaldoConta[]>('saldos_bancarios', {}),
        supabase.from('conta_bancaria').select('*').eq('ativo', true).order('apelido'),
      ])
      setSaldos(s ?? []); setContas(ok(c) as ContaBancaria[])
      if (contaId == null && s?.length) setContaId(s[0].conta_bancaria_id)
    } catch (e: any) { toast(e.message, 'erro'); setSaldos([]) }
  }
  async function carregarExtrato() {
    if (contaId == null) return
    setLancs(null)
    try {
      const [l, i] = await Promise.all([
        supabase.from('extrato_lancamento').select('id, data, valor, tipo, descricao, documento').eq('conta_bancaria_id', contaId)
          .gte('data', de).lte('data', ate).order('data', { ascending: false }).order('id', { ascending: false }).limit(1000),
        supabase.from('extrato_importacao').select('*').eq('conta_bancaria_id', contaId).order('criado_em', { ascending: false }).limit(8),
      ])
      setLancs(ok(l) as Lancamento[]); setImportacoes(ok(i) as Importacao[])
    } catch (e: any) { toast(e.message, 'erro'); setLancs([]) }
  }
  useEffect(() => { carregarSaldos() }, [])
  useEffect(() => { carregarExtrato() }, [contaId, de, ate])

  const total = (saldos ?? []).reduce((s, c) => s + Number(c.saldo ?? 0), 0)
  const semSaldo = (saldos ?? []).filter((c) => c.saldo == null).length
  const conta = contas.find((c) => c.id === contaId)
  const entradas = useMemo(() => (lancs ?? []).filter((l) => l.valor > 0).reduce((s, l) => s + Number(l.valor), 0), [lancs])
  const saidas = useMemo(() => (lancs ?? []).filter((l) => l.valor < 0).reduce((s, l) => s + Number(l.valor), 0), [lancs])

  async function lerArquivo(arquivo: File | undefined) {
    if (!arquivo || !importar) return
    setImportar({ ...importar, lendo: true, leitura: null })
    try {
      const extrato = interpretarOfx(await lerArquivoOfx(arquivo))
      setImportar((i) => i && { ...i, lendo: false, leitura: { arquivo, extrato, confirmado: false } })
    } catch (e: any) { toast(e.message, 'erro'); setImportar((i) => i && { ...i, lendo: false }) }
  }
  // divergências entre o arquivo e a conta escolhida (banco, agência, conta)
  const divergencias = (() => {
    const c = contas.find((x) => x.id === importar?.contaId); const x = importar?.leitura?.extrato
    if (!c || !x) return []
    const d: string[] = []
    if (x.bancoId && !mesmoNumero(x.bancoId, c.banco_codigo)) d.push(`banco do arquivo ${x.bancoId} ≠ ${c.banco_codigo} (${c.banco_nome})`)
    if (x.agencia && c.agencia && !mesmoNumero(x.agencia, c.agencia)) d.push(`agência do arquivo ${x.agencia} ≠ ${c.agencia}`)
    if (x.conta && c.numero && !mesmoNumero(x.conta, c.numero)) d.push(`conta do arquivo ${x.conta} ≠ ${c.numero}`)
    return d
  })()

  async function confirmarImportacao() {
    const imp = importar; const l = imp?.leitura
    if (!imp || !l || imp.contaId === '') return
    if (divergencias.length && !l.confirmado) { toast('Confirme que o arquivo é desta conta', 'erro'); return }
    setImportar({ ...imp, enviando: true })
    try {
      const r = await rpc<{ lancamentos: number; novos: number }>('importar_extrato', {
        p_conta: imp.contaId, p_arquivo: l.arquivo.name, p_inicio: l.extrato.inicio, p_fim: l.extrato.fim,
        p_saldo: l.extrato.saldo, p_saldo_data: l.extrato.saldoData, p_lancamentos: l.extrato.lancamentos,
      })
      toast(`Extrato importado: ${r.novos} lançamento(s) novo(s) de ${r.lancamentos}${l.extrato.saldo != null ? ' · saldo atualizado' : ''}`)
      setImportar(null); setContaId(imp.contaId); carregarSaldos(); carregarExtrato()
    } catch (e: any) { toast(e.message, 'erro'); setImportar((i) => i && { ...i, enviando: false }) }
  }

  async function salvarManual() {
    if (!manual || manual.contaId === '') { toast('Escolha a conta', 'erro'); return }
    const v = parsePreco(manual.saldo)
    if (v == null || !manual.data) { toast('Informe data e saldo', 'erro'); return }
    try {
      ok(await supabase.from('saldo_bancario').upsert({ conta_bancaria_id: manual.contaId, data: manual.data, saldo: v, origem: 'MANUAL', importacao_id: null }, { onConflict: 'conta_bancaria_id,data' }))
      toast('Saldo registrado'); setManual(null); carregarSaldos()
    } catch (e: any) { toast(e.message, 'erro') }
  }

  if (!saldos) return <Carregando />
  if (!contas.length) return (
    <div className="mx-auto max-w-3xl"><Titulo>Saldos bancários</Titulo>
      <div className="card p-6 text-center text-sm text-slate-500">Nenhuma conta bancária cadastrada. <Link to="/contas-bancarias" className="font-semibold text-leaf-700 underline">Cadastrar conta</Link></div>
    </div>
  )
  const hoje = hojeISO()
  const leitura = importar?.leitura

  return (
    <div className="mx-auto max-w-6xl space-y-3">
      <Titulo acoes={<>
        <button className="btn-secondary" onClick={() => setAjuda(true)}>Como baixar o OFX?</button>
        <button className="btn-secondary" onClick={() => setManual({ contaId: contaId ?? '', data: hoje, saldo: '' })}>Informar saldo</button>
        <button className="btn-primary" onClick={() => setImportar({ contaId: contaId ?? '', leitura: null, lendo: false, enviando: false })}>Importar extrato (OFX)</button>
      </>}>Saldos bancários</Titulo>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="card border-l-4 border-l-leaf-700 px-3 py-2">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Saldo geral</div>
          <div className={`text-xl font-extrabold tabular-nums ${corValor(total)}`}>{fmtMoeda(total)}</div>
          <div className="text-[11px] text-slate-500">{saldos.length} conta(s){semSaldo ? ` · ${semSaldo} sem saldo` : ''}</div>
        </div>
        {saldos.map((s) => {
          const velho = !s.data || s.data < diasAtras(1)
          return (
            <button key={s.conta_bancaria_id} onClick={() => setContaId(s.conta_bancaria_id)}
              className={`card px-3 py-2 text-left transition hover:border-leaf-400 ${s.conta_bancaria_id === contaId ? 'ring-2 ring-leaf-600' : ''}`}>
              <div className="flex items-center justify-between gap-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                <span className="truncate">🏦 {s.apelido}</span>{s.data && velho && <Chip cor="amarelo">desatualizado</Chip>}
              </div>
              <div className={`text-xl font-extrabold tabular-nums ${corValor(s.saldo)}`}>{s.saldo == null ? '—' : fmtMoeda(s.saldo)}</div>
              <div className="text-[11px] text-slate-500">{s.data ? `em ${fmtData(s.data)} · ${s.origem === 'MANUAL' ? 'informado' : 'OFX'}` : 'nenhum saldo importado'}</div>
            </button>
          )
        })}
      </div>

      {conta && (
        <section className="card p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-extrabold uppercase tracking-wide text-leaf-900">Extrato — {conta.apelido} <span className="font-normal normal-case text-slate-500">({conta.banco_codigo} {conta.banco_nome}{conta.numero ? ` · ${conta.numero}` : ''})</span></h2>
            <div className="flex items-center gap-2 text-xs">
              de <input className="input w-auto py-1 text-xs" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
              até <input className="input w-auto py-1 text-xs" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
            </div>
          </div>
          {lancs === null ? <Carregando /> : !lancs.length ? <div className="py-6 text-center text-xs text-slate-400">Nenhum lançamento importado neste período.</div> : (
            <>
              <div className="mb-1 text-xs"><b>{lancs.length}</b> lançamentos · entradas <b className="text-green-700">{fmtMoeda(entradas)}</b> · saídas <b className="text-red-700">{fmtMoeda(Math.abs(saidas))}</b>{lancs.length >= 1000 && ' · mostrando os 1.000 mais recentes'}</div>
              <div className="max-h-[50vh] overflow-auto">
                <table className="tabela">
                  <thead><tr><th>Data</th><th>Histórico</th><th>Documento</th><th className="text-right">Valor</th></tr></thead>
                  <tbody>
                    {lancs.map((l) => (
                      <tr key={l.id}>
                        <td className="whitespace-nowrap">{fmtData(l.data)}</td>
                        <td>{l.descricao}</td>
                        <td className="text-slate-500">{l.documento}</td>
                        <td className={`text-right font-semibold tabular-nums whitespace-nowrap ${corValor(l.valor)}`}>{l.valor > 0 ? '+ ' : '− '}{fmtMoeda(Math.abs(l.valor))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {!!importacoes.length && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer font-semibold text-slate-600">Últimas importações desta conta</summary>
              <ul className="mt-1 divide-y divide-slate-100">
                {importacoes.map((i) => (
                  <li key={i.id} className="flex flex-wrap gap-x-3 py-1 text-slate-600">
                    <span>{fmtDataHora(i.criado_em)}</span><span className="font-semibold">{i.arquivo_nome}</span>
                    <span>{i.data_inicio ? `${fmtData(i.data_inicio)} a ${fmtData(i.data_fim)}` : ''}</span>
                    <span>{i.qtd_novos} novo(s) de {i.qtd_lancamentos}</span>
                    {i.saldo != null && <span>saldo {fmtMoeda(i.saldo)} em {fmtData(i.saldo_data)}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      <Modal aberto={!!importar} titulo="Importar extrato (OFX)" onFechar={() => setImportar(null)} largura="max-w-xl">
        {importar && (
          <div className="grid gap-3 text-sm">
            <Campo label="Conta bancária">
              <select className="input" value={importar.contaId} onChange={(e) => setImportar({ ...importar, contaId: e.target.value ? Number(e.target.value) : '' })}>
                <option value="">— escolha —</option>
                {contas.map((c) => <option key={c.id} value={c.id}>{c.apelido} ({c.banco_codigo} {c.banco_nome})</option>)}
              </select>
            </Campo>
            <Campo label="Arquivo OFX"><input className="input" type="file" accept=".ofx,.OFX" onChange={(e) => lerArquivo(e.target.files?.[0])} /></Campo>
            {importar.lendo && <div className="text-xs text-slate-500">Lendo arquivo…</div>}
            {leitura && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
                <div className="grid grid-cols-2 gap-1">
                  <span>Banco / agência / conta do arquivo:</span><b>{leitura.extrato.bancoId ?? '—'} / {leitura.extrato.agencia ?? '—'} / {leitura.extrato.conta ?? '—'}</b>
                  <span>Período:</span><b>{leitura.extrato.inicio ? `${fmtData(leitura.extrato.inicio)} a ${fmtData(leitura.extrato.fim)}` : '—'}</b>
                  <span>Saldo:</span><b className={corValor(leitura.extrato.saldo)}>{leitura.extrato.saldo != null ? `${fmtMoeda(leitura.extrato.saldo)} em ${fmtData(leitura.extrato.saldoData)}` : 'não informado no arquivo'}</b>
                  <span>Lançamentos:</span><b>{leitura.extrato.lancamentos.length} (entradas {fmtMoeda(leitura.extrato.lancamentos.filter((l) => l.valor > 0).reduce((s, l) => s + l.valor, 0))} · saídas {fmtMoeda(Math.abs(leitura.extrato.lancamentos.filter((l) => l.valor < 0).reduce((s, l) => s + l.valor, 0)))})</b>
                </div>
                {leitura.extrato.avisos.map((a) => <div key={a} className="mt-1 text-amber-700">⚠ {a}</div>)}
                {!!divergencias.length && (
                  <div className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-red-800">
                    <b>O arquivo parece ser de outra conta:</b> {divergencias.join('; ')}.
                    <label className="mt-1 flex items-center gap-2"><input type="checkbox" checked={leitura.confirmado} onChange={(e) => setImportar({ ...importar, leitura: { ...leitura, confirmado: e.target.checked } })} /> Importar mesmo assim nesta conta</label>
                  </div>
                )}
                <p className="mt-2 text-slate-500">Lançamentos já importados antes não se repetem. Se já houver saldo deste dia, ele é substituído.</p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setImportar(null)}>Cancelar</button>
              <button className="btn-primary" disabled={!leitura || importar.contaId === '' || importar.enviando || (divergencias.length > 0 && !leitura.confirmado)} onClick={confirmarImportacao}>
                {importar.enviando ? 'Importando…' : 'Importar'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal aberto={!!manual} titulo="Informar saldo" onFechar={() => setManual(null)} largura="max-w-md">
        {manual && (
          <div className="grid gap-2 sm:grid-cols-2">
            <Campo label="Conta bancária" className="sm:col-span-2">
              <select className="input" value={manual.contaId} onChange={(e) => setManual({ ...manual, contaId: e.target.value ? Number(e.target.value) : '' })}>
                <option value="">— escolha —</option>
                {contas.map((c) => <option key={c.id} value={c.id}>{c.apelido}</option>)}
              </select>
            </Campo>
            <Campo label="Data"><input className="input" type="date" value={manual.data} onChange={(e) => setManual({ ...manual, data: e.target.value })} /></Campo>
            <Campo label="Saldo (R$)">
              <div className="flex gap-1">
                <button type="button" className="btn-secondary px-2" title="Trocar sinal (saldo negativo)" onClick={() => setManual({ ...manual, saldo: manual.saldo.startsWith('-') ? manual.saldo.slice(1) : '-' + manual.saldo })}>±</button>
                <input className="input text-right" inputMode="decimal" placeholder="0,00" value={manual.saldo} onChange={(e) => { const neg = e.target.value.trim().startsWith('-'); setManual({ ...manual, saldo: (neg ? '-' : '') + mascaraPreco(e.target.value) }) }} />
              </div>
            </Campo>
            <p className="sm:col-span-2 text-xs text-slate-500">Use quando o banco não exportar o saldo no OFX. Se já houver saldo nesta data, ele é substituído.</p>
            <div className="sm:col-span-2 flex justify-end gap-2"><button className="btn-secondary" onClick={() => setManual(null)}>Cancelar</button><button className="btn-primary" onClick={salvarManual}>Salvar</button></div>
          </div>
        )}
      </Modal>

      <Modal aberto={ajuda} titulo="Como baixar o extrato em OFX" onFechar={() => setAjuda(false)} largura="max-w-xl">
        <div className="space-y-3 text-sm text-slate-700">
          <p>OFX é o arquivo de extrato que todo banco exporta (às vezes aparece como <b>"Money"</b>, <b>"Quicken"</b> ou <b>"OFX/Money"</b>). Importe <b>uma vez por dia</b>, de preferência no começo do expediente, com o período dos últimos dias: o que já foi importado não se repete e o saldo do dia é atualizado.</p>
          <div><b>Sicoob</b> (internet banking ou app Sicoob): Conta corrente › <b>Extrato</b> › escolha o período › <b>Exportar / Salvar</b> › formato <b>OFX</b>.</div>
          <div><b>Cora</b> (app ou web): <b>Extrato</b> › escolha o período › <b>Exportar</b> › formato <b>OFX</b>.</div>
          <div><b>Outros bancos</b>: no extrato da conta corrente, procure "Exportar", "Baixar" ou "Salvar como" e escolha OFX. Não use o extrato de cartão de crédito.</div>
          <p className="text-xs text-slate-500">Os nomes dos menus variam conforme a versão do app do banco. Depois de baixar, aqui em Saldos bancários clique em <b>Importar extrato (OFX)</b>, escolha a conta e o arquivo e confira o resumo antes de importar.</p>
        </div>
      </Modal>
    </div>
  )
}
