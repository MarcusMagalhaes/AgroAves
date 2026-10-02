// Programação da semana em formato de planilha (RF-20): célula a célula, filtros, salvamento automático
import { useEffect, useMemo, useRef, useState } from 'react'
import { DataGrid, type Column, type DataGridHandle, type RenderEditCellProps, type RowsChangeData } from 'react-data-grid'
import { supabase, ok } from '@/lib/supabase'
import { listarProdutos, listarRotasSemana, rpc } from '@/lib/dados'
import { fmtData, fmtMoeda, fmtNum, normalizar } from '@/lib/format'
import { FORMAS, corProduto, gruposDeProdutos, tom, type PedidoItem, type PedidoView, type Produto, type RotaSemana } from '@/lib/types'
import { Campo, Carregando, Confirmar, Modal, Titulo, useToast } from '@/components/ui'

interface Linha {
  id: number; data: string; rota: string; semana_rota_id: number; cliente_id: number | null; cliente: string; nome: string; contato: string
  pagto: string; tipo: string; ordem: number; R: number; total: number; busca: string
  [sigla: string]: any  // quantidades por sigla
}
type Resumo = { id: string; cliente: string; [k: string]: any }

// Editor de célula que aceita somente dígitos (sem letras, vírgula ou ponto)
function EditorNumero({ row, column, onRowChange, onClose }: RenderEditCellProps<Linha, Resumo>) {
  return (
    <input autoFocus inputMode="numeric" pattern="[0-9]*" maxLength={6}
      className="h-full w-full bg-white px-0.5 text-center text-xs font-bold outline-none ring-2 ring-leaf-500"
      value={row[column.key] ?? ''}
      onChange={(e) => onRowChange({ ...row, [column.key]: e.target.value.replace(/\D/g, '') })}
      onKeyDown={(e) => { if (e.key.length === 1 && !/[0-9]/.test(e.key) && !e.ctrlKey && !e.metaKey) e.preventDefault() }}
      onBlur={() => onClose(true, false)}
      onFocus={(e) => e.target.select()} />
  )
}
const LARG_FIXA_ESQ = 110 + 190  // rota + cliente (congeladas); +78 da Data no histórico

export interface FiltroFixo { data: string; cidadeId: number; produtoId: number }
export default function Programacao({ historico = false, fixo, aoMudar }: { historico?: boolean; fixo?: FiltroFixo; aoMudar?: () => void }) {
  const { toast } = useToast()
  const [rotas, setRotas] = useState<RotaSemana[]>([])
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [data, setData] = useState<string>('')
  const [rotaF, setRotaF] = useState<number | ''>('')
  const [texto, setTexto] = useState('')
  const [prodF, setProdF] = useState<string[]>([])
  const [linhas, setLinhas] = useState<Linha[] | null>(null)
  const [estado, setEstado] = useState<Record<string, 'salvando' | 'ok' | 'erro'>>({})
  const [incluir, setIncluir] = useState(false)
  const [excluir, setExcluir] = useState<Linha | null>(null)
  const [detalhes, setDetalhes] = useState(false)
  const [prodAberto, setProdAberto] = useState(false)
  const gridRef = useRef<DataGridHandle>(null)
  const faixaRef = useRef<HTMLDivElement>(null)

  const [datasFechadas, setDatasFechadas] = useState<string[]>([])
  const datas = useMemo(() => historico ? datasFechadas : [...new Set(rotas.map((r) => r.data_entrega).filter(Boolean))].sort() as string[], [rotas, datasFechadas, historico])

  useEffect(() => {
    Promise.all([listarRotasSemana(), listarProdutos()]).then(async ([r, p]) => {
      setRotas(r); setProdutos(p)
      if (historico) {
        const sem = ok(await supabase.from('semana_rota').select('data_entrega').eq('status', 'FECHADA').order('data_entrega', { ascending: false })) as { data_entrega: string }[]
        const d = [...new Set(sem.map((x) => x.data_entrega))]
        setDatasFechadas(d); if (d[0]) setData(d[0])
      } else if (fixo) {
        setData(fixo.data)
      } else {
        const d = [...new Set(r.map((x) => x.data_entrega))].filter(Boolean).sort(); if (d[0]) setData(d[0] as string)
      }
    }).catch((e) => toast(e.message, 'erro'))
  }, [])

  async function carregar() {
    if (!data) return
    setLinhas(null)
    try {
      let q = supabase.from('v_pedido').select('*').eq('data_entrega', data).neq('status', 'EXCLUIDO').eq('semana_status', historico ? 'FECHADA' : 'ABERTA').order('rota').order('ordem_visita')
      if (rotaF !== '') q = q.eq('rota_id', rotaF)
      if (fixo) q = q.eq('cidade_distribuicao_id', fixo.cidadeId)
      let pedidos = ok(await q) as PedidoView[]
      const ids = pedidos.map((p) => p.id)
      const itens = ids.length ? ok(await supabase.from('pedido_item').select('*').in('pedido_id', ids)) as PedidoItem[] : []
      const porSigla = Object.fromEntries(produtos.map((p) => [p.id, p.sigla]))
      const m: Record<number, Record<string, number>> = {}
      for (const i of itens) (m[i.pedido_id] ??= {})[porSigla[i.produto_id]] = i.quantidade
      if (fixo) { const sg = porSigla[fixo.produtoId]; pedidos = pedidos.filter((p) => (m[p.id]?.[sg] ?? 0) > 0) }
      setLinhas(pedidos.map((p) => ({
        id: p.id, data: p.data_entrega, rota: p.rota, semana_rota_id: p.semana_rota_id, cliente_id: p.cliente_id,
        cliente: p.tipo === 'CLIENTE' ? p.razao_social ?? '' : `(${p.tipo} da rota)`, nome: p.nome_fantasia ?? '', contato: p.contato ?? '',
        pagto: p.forma_pagamento ? FORMAS[p.forma_pagamento] : '', tipo: p.tipo, ordem: p.ordem_visita, R: p.reposicao, total: Number(p.total),
        busca: normalizar(`${p.razao_social} ${p.nome_fantasia} ${p.cidade} ${p.contato} ${p.cliente_codigo}`),
        ...(m[p.id] ?? {}),
      })))
    } catch (e: any) { toast(e.message, 'erro'); setLinhas([]) }
  }
  useEffect(() => { carregar() }, [data, rotaF, produtos])

  const visiveis = useMemo(() => {
    const t = normalizar(texto)
    return (linhas ?? []).filter((l) => (!t || l.busca.includes(t)) && (prodF.length === 0 || prodF.some((s) => Number(l[s]) > 0)))
  }, [linhas, texto, prodF])

  const colsProd = prodF.length ? produtos.filter((p) => prodF.includes(p.sigla)) : produtos

  const [larguras, setLarguras] = useState<number[]>([])
  useEffect(() => {
    const el = gridRef.current?.element
    if (!el) return
    const medir = () => {
      const arr: number[] = []
      el.querySelectorAll<HTMLElement>('[role="columnheader"]').forEach((c) => {
        const i = Number(c.getAttribute('aria-colindex')) - 1
        if (i >= 0) arr[i] = c.getBoundingClientRect().width
      })
      setLarguras((old) => (old.length === arr.length && old.every((v, i) => Math.abs(v - arr[i]) < 0.5) ? old : arr))
    }
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [colsProd, detalhes, historico, linhas])
  // posições das colunas na grade: [data?] rota cliente [nome contato pagto?] produtos… R total [acoes?]
  const nFixEsq = (historico ? 1 : 0) + 2
  const nDet = detalhes ? 3 : 0
  const larg = (i: number, padrao: number) => larguras[i] ?? padrao
  const soma = (de: number, ate: number, padrao: number) => { let t = 0; for (let i = de; i < ate; i++) t += larg(i, padrao); return t }

  const resumo: Resumo[] = useMemo(() => {
    const r: Resumo = { id: 'tot', cliente: 'TOTAL' }
    for (const p of colsProd) r[p.sigla] = visiveis.reduce((s, l) => s + (Number(l[p.sigla]) || 0), 0)
    r.R = visiveis.reduce((s, l) => s + (l.R || 0), 0)
    r.total = visiveis.reduce((s, l) => s + (l.total || 0), 0)
    return [r]
  }, [visiveis, colsProd])

  const colunas: Column<Linha, Resumo>[] = useMemo(() => [
    ...(historico ? [{ key: 'data', name: 'Data', width: 82, frozen: 'start' as const, renderCell: ({ row }: { row: Linha }) => <>{fmtData(row.data)}</>, renderSummaryCell: () => <b>TOTAL</b> }] : []),
    { key: 'rota', name: 'Rota', width: 115, frozen: 'start', renderSummaryCell: ({ row }) => <b>{historico ? '' : row.cliente}</b> },
    { key: 'cliente', name: 'Cliente', width: 190, frozen: 'start', renderCell: ({ row }) => <span title={row.cliente} className={row.tipo !== 'CLIENTE' ? 'italic text-slate-500' : ''}>{row.cliente}</span> },
    ...(detalhes ? [{ key: 'nome', name: 'Nome', width: 130 }, { key: 'contato', name: 'Contato', width: 110 }, { key: 'pagto', name: 'Pagto', width: 80 }] as Column<Linha, Resumo>[] : []),
    ...colsProd.map((p): Column<Linha, Resumo> => ({
      key: p.sigla, name: p.nome, width: 55, minWidth: 55, editable: !historico, renderEditCell: EditorNumero,
      renderHeaderCell: () => <span className="cab-vertical" title={p.nome}>{p.nome}</span>,
      cellClass: (row) => `cell-centro cor-p${p.id} ${estado[`${row.id}:${p.sigla}`] === 'salvando' ? 'cell-dirty' : estado[`${row.id}:${p.sigla}`] === 'ok' ? 'cell-saved' : estado[`${row.id}:${p.sigla}`] === 'erro' ? 'cell-error' : ''}`,
      renderCell: ({ row }) => <>{row[p.sigla] || ''}</>,
      renderSummaryCell: ({ row }) => <b>{row[p.sigla] ? fmtNum(row[p.sigla]) : ''}</b>,
      summaryCellClass: `cell-centro cor-p${p.id}`,
      headerCellClass: `text-center cor-p${p.id}`,
    })),
    { key: 'R', name: 'Reposição', width: 40, minWidth: 40, editable: !historico, summaryCellClass: 'cell-centro', renderHeaderCell: () => <span className="cab-vertical">Reposição</span>, renderEditCell: EditorNumero, cellClass: (row) => `cell-centro ${estado[`${row.id}:R`] === 'ok' ? 'cell-saved' : estado[`${row.id}:R`] === 'erro' ? 'cell-error' : ''}`,
      renderCell: ({ row }) => <>{row.R || ''}</>, renderSummaryCell: ({ row }) => <b>{row.R ? fmtNum(row.R) : ''}</b> },
    { key: 'total', name: 'Total R$', width: 85, minWidth: 85, frozen: 'end', cellClass: 'cell-num font-semibold', summaryCellClass: 'cell-num', headerCellClass: 'cab-direita', renderCell: ({ row }) => <>{row.tipo === 'CLIENTE' ? fmtMoeda(row.total) : ''}</>, renderSummaryCell: () => null },
    ...(historico ? [] : [{ key: 'acoes', name: '', width: 30, frozen: 'end' as const, renderCell: ({ row }: { row: Linha }) => <button className="text-red-600 font-bold" title="Excluir pedido" onClick={() => setExcluir(row)}>✕</button> }]),
  ], [colsProd, estado, detalhes, historico])

  async function onRowsChange(rows: Linha[], { indexes, column }: RowsChangeData<Linha, Resumo>) {
    const row = rows[indexes[0]]
    const key = column.key
    const chave = `${row.id}:${key}`
    const valor = Math.max(0, Math.floor(Number(String(row[key] ?? '').replace(',', '.')) || 0))
    // reflete na grade (filtrada → precisamos atualizar em `linhas`)
    const atualizar = (patch: Partial<Linha>) => setLinhas((ls) => (ls ?? []).map((l) => (l.id === row.id ? { ...l, ...patch } : l)))
    atualizar({ [key]: valor })
    setEstado((e) => ({ ...e, [chave]: 'salvando' }))
    try {
      if (key === 'R') {
        ok(await supabase.from('pedido').update({ reposicao: valor }).eq('id', row.id))
      } else {
        const prod = produtos.find((p) => p.sigla === key)!
        const total = await rpc<number>('atualizar_item_pedido', { p_pedido_id: row.id, p_produto_id: prod.id, p_quantidade: valor })
        atualizar({ total: Number(total) })
      }
      setEstado((e) => ({ ...e, [chave]: 'ok' }))
      aoMudar?.()
      setTimeout(() => setEstado((e) => { const { [chave]: _, ...r } = e; return r }), 1500)
    } catch (err: any) {
      setEstado((e) => ({ ...e, [chave]: 'erro' })); toast(err.message, 'erro')
    }
  }

  async function confirmarExcluir() {
    if (!excluir) return
    try { await rpc('excluir_pedido', { p_pedido_id: excluir.id }); toast('Pedido excluído'); setExcluir(null); carregar() } catch (e: any) { toast(e.message, 'erro') }
  }

  return (
    <div className="flex h-full flex-col text-xs">
      {/* filtros numa linha fina */}
      <div className="card px-3 py-1.5 mb-1.5 bg-rose-50/60 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {!fixo && <span className="font-extrabold text-sm text-leaf-900 mr-1">{historico ? 'Fechamento geral' : 'Programação'}</span>}
        <label className="flex items-center gap-1.5"><span className="font-bold text-slate-500 uppercase text-[10px]">Semana</span>
          {fixo ? <span className="font-bold">{fmtData(data)}</span> : <select className="input py-1 px-2 text-xs bg-yellow-50 font-bold" value={data} onChange={(e) => setData(e.target.value)}>{datas.map((d) => <option key={d} value={d}>{fmtData(d)}</option>)}</select>}</label>
        <label className="flex items-center gap-1.5"><span className="font-bold text-slate-500 uppercase text-[10px]">Rota</span>
          <select className="input py-1 px-2 text-xs bg-yellow-50 font-bold" value={rotaF} onChange={(e) => setRotaF(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Todas</option>{rotas.filter((r) => historico || (r.data_entrega === data && (!fixo || r.cidade_distribuicao_id === fixo.cidadeId))).map((r) => <option key={r.rota_id} value={r.rota_id}>{r.rota}</option>)}
          </select></label>
        <label className="flex items-center gap-1.5 flex-1 min-w-[160px]"><span className="font-bold text-slate-500 uppercase text-[10px]">Filtrar</span>
          <input className="input py-1 px-2 text-xs bg-yellow-50" placeholder="cliente, cidade, contato…" value={texto} onChange={(e) => setTexto(e.target.value)} /></label>
        <div className="relative">
          <button className={`btn-secondary py-1 text-xs ${prodF.length ? 'bg-yellow-50 border-amber-400' : ''}`} onClick={() => setProdAberto(!prodAberto)}>
            Produtos{prodF.length ? ` (${prodF.length})` : ''} ▾
          </button>
          {prodAberto && (
            <div className="absolute z-30 mt-1 w-64 max-h-80 overflow-auto rounded-lg border border-slate-300 bg-white shadow-lg p-1" onMouseLeave={() => setProdAberto(false)}>
              <div className="text-[10px] text-slate-500 px-2 py-1">Mostrar só estes produtos (e só clientes que os pediram)</div>
              {produtos.map((p) => (
                <label key={p.id} className="flex items-center gap-2 px-2 py-0.5 hover:bg-leaf-50 cursor-pointer">
                  <input type="checkbox" checked={prodF.includes(p.sigla)} onChange={(e) => setProdF(e.target.checked ? [...prodF, p.sigla] : prodF.filter((s) => s !== p.sigla))} />{p.nome}
                </label>
              ))}
              {prodF.length > 0 && <button className="btn-secondary w-full mt-1 py-1 text-xs" onClick={() => setProdF([])}>Mostrar todos</button>}
            </div>
          )}
        </div>
        <label className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={detalhes} onChange={(e) => setDetalhes(e.target.checked)} /> nome/contato/pagto</label>
        <span className="text-[11px] text-slate-500">{visiveis.length} pedidos · {fmtMoeda(resumo[0]?.total ?? 0)}</span>
        {!historico && !fixo && <button className="btn-primary py-1 text-xs ml-auto" onClick={() => setIncluir(true)}>+ Incluir pedido</button>}
      </div>
      {linhas === null ? <Carregando /> : (
        <div className="card flex-1 min-h-0 overflow-hidden flex flex-col">
          {/* estilos de cor por produto (coluna inteira) */}
          <style>{colsProd.map((p) => { const c = corProduto(p); return `.rdg-row.linha-impar .rdg-cell.cor-p${p.id}{background-color:${tom(c, 0.10)}}.rdg-row.linha-par .rdg-cell.cor-p${p.id}{background-color:${tom(c, 0.19, '#eef2f7')}}.rdg-header-row .rdg-cell.cor-p${p.id}{background-color:${tom(c, 0.40)}}.rdg-summary-row .rdg-cell.cor-p${p.id}{background-color:${tom(c, 0.25)}}` }).join('\n')}</style>
          {/* faixa de categorias, alinhada às colunas e sincronizada com a rolagem horizontal */}
          <div className="flex h-5 shrink-0 border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-wide overflow-hidden">
            <div style={{ width: soma(0, nFixEsq, 150), flex: 'none' }} className="px-2 leading-5 text-slate-500">Categorias</div>
            <div className="flex-1 overflow-hidden">
              <div ref={faixaRef} className="flex h-full will-change-transform">
                {detalhes && <div style={{ width: soma(nFixEsq, nFixEsq + nDet, 107), flex: 'none' }} />}
                {(() => { let pos = nFixEsq + nDet; return gruposDeProdutos(colsProd).map((g) => { const w = soma(pos, pos + g.itens.length, 40); pos += g.itens.length; return (
                  <div key={g.grupo} style={{ width: w, flex: 'none', backgroundColor: tom(corProduto(g.itens[0]), 0.5) }}
                    className="leading-5 text-center text-slate-900 border-r border-white overflow-hidden whitespace-nowrap text-ellipsis px-0.5" title={g.grupo}>{g.grupo}</div>
                ) }) })()}
                <div style={{ width: larg(nFixEsq + nDet + colsProd.length, 40), flex: 'none' }} />
              </div>
            </div>
            <div style={{ width: soma(nFixEsq + nDet + colsProd.length + 1, colunas.length, 60), flex: 'none' }} />
          </div>
          <div className="flex-1 min-h-0">
            <DataGrid ref={gridRef} className="rdg-light" columns={colunas} rows={visiveis} topSummaryRows={resumo} rowKeyGetter={(r) => r.id}
              onRowsChange={onRowsChange} rowHeight={24} headerRowHeight={92} summaryRowHeight={26} rowClass={(_, i) => (i % 2 ? 'linha-par' : 'linha-impar')}
              onScroll={(e) => { if (faixaRef.current) faixaRef.current.style.transform = `translateX(-${(e.currentTarget as HTMLDivElement).scrollLeft}px)` }} />
          </div>
        </div>
      )}
      <div className="text-[10px] text-slate-400 mt-0.5">{historico ? 'Histórico das programações fechadas — somente leitura.' : 'Enter ou duplo clique edita a célula; salva ao sair. Amarelo = salvando · verde = salvo · vermelho = erro.'}</div>

      {incluir && <IncluirPedido data={data} rotas={rotas.filter((r) => r.data_entrega === data)} onFechar={(mudou) => { setIncluir(false); if (mudou) carregar() }} />}
      <Confirmar aberto={!!excluir} titulo="Excluir pedido" perigo texto={`Excluir o pedido de ${excluir?.cliente} (${excluir?.rota})?`} onSim={confirmarExcluir} onNao={() => setExcluir(null)} />
    </div>
  )
}

// Inclui um pedido vazio para um cliente da rota (ou reposição/sobra da rota) para edição na grade
function IncluirPedido({ data, rotas, onFechar }: { data: string; rotas: RotaSemana[]; onFechar: (mudou: boolean) => void }) {
  const { toast } = useToast()
  const [rotaId, setRotaId] = useState<number>(rotas[0]?.rota_id)
  const [tipo, setTipo] = useState<'CLIENTE' | 'REPOSICAO' | 'SOBRA'>('CLIENTE')
  const [clientes, setClientes] = useState<any[]>([])
  const [busca, setBusca] = useState('')
  const rota = rotas.find((r) => r.rota_id === rotaId)

  useEffect(() => { if (rotaId) rpc<any[]>('clientes_rota_semana', { p_rota_id: rotaId }).then(setClientes).catch((e) => toast(e.message, 'erro')) }, [rotaId])

  async function criar(clienteId: number | null) {
    if (!rota?.semana_rota_id) return
    try {
      ok(await supabase.from('pedido').insert({ semana_rota_id: rota.semana_rota_id, cliente_id: clienteId, tipo, cidade_distribuicao_id: rota.cidade_distribuicao_id,
        forma_pagamento: clienteId ? clientes.find((c) => c.cliente_id === clienteId)?.forma_pagamento : null }))
      if (clienteId) ok(await supabase.from('contato_cliente').upsert({ semana_rota_id: rota.semana_rota_id, cliente_id: clienteId, resultado: 'PEDIDO' }, { onConflict: 'semana_rota_id,cliente_id' }))
      toast('Pedido incluído — preencha as quantidades na grade'); onFechar(true)
    } catch (e: any) { toast(e.message, 'erro') }
  }
  const t = normalizar(busca)
  return (
    <Modal aberto titulo={`Incluir pedido — semana ${fmtData(data)}`} onFechar={() => onFechar(false)}>
      <div className="grid gap-2 sm:grid-cols-3">
        <Campo label="Rota"><select className="input" value={rotaId} onChange={(e) => setRotaId(Number(e.target.value))}>{rotas.map((r) => <option key={r.rota_id} value={r.rota_id}>{r.rota}</option>)}</select></Campo>
        <Campo label="Tipo">
          <select className="input" value={tipo} onChange={(e) => setTipo(e.target.value as any)}>
            <option value="CLIENTE">Pedido de cliente</option><option value="REPOSICAO">Reposição da rota (sem cliente, sem valor)</option><option value="SOBRA">Sobra da rota (sem cliente, sem valor)</option>
          </select>
        </Campo>
        {tipo !== 'CLIENTE' ? <button className="btn-primary" onClick={() => criar(null)}>Incluir {tipo.toLowerCase()} da rota</button> : (
          <>
            <Campo label="Cliente (sem pedido na semana)"><input className="input" placeholder="buscar…" value={busca} onChange={(e) => setBusca(e.target.value)} /></Campo>
            <div className="max-h-64 overflow-auto divide-y divide-slate-100 border rounded-lg">
              {clientes.filter((c) => !c.pedido_id && (!t || c.busca.includes(t))).map((c) => (
                <button key={c.cliente_id} className="w-full text-left px-3 py-2 text-sm hover:bg-leaf-50" onClick={() => criar(c.cliente_id)}>
                  <b>{c.razao_social}</b> <span className="text-slate-500">· {c.nome_fantasia} · {c.cidade}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
