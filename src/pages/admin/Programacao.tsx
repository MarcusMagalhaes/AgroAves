// Programação da semana em formato de planilha (RF-20): célula a célula, filtros, salvamento automático
import { useEffect, useMemo, useState } from 'react'
import { DataGrid, renderTextEditor, type Column, type RowsChangeData } from 'react-data-grid'
import { supabase, ok } from '@/lib/supabase'
import { listarProdutos, listarRotasSemana, rpc } from '@/lib/dados'
import { fmtData, fmtMoeda, fmtNum, normalizar } from '@/lib/format'
import { FORMAS, type PedidoItem, type PedidoView, type Produto, type RotaSemana } from '@/lib/types'
import { Campo, Carregando, Confirmar, Modal, Titulo, useToast } from '@/components/ui'

interface Linha {
  id: number; rota: string; semana_rota_id: number; cliente_id: number | null; cliente: string; nome: string; contato: string
  pagto: string; tipo: string; ordem: number; R: number; total: number; busca: string
  [sigla: string]: any  // quantidades por sigla
}
type Resumo = { id: string; cliente: string; [k: string]: any }

export default function Programacao() {
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

  const datas = useMemo(() => [...new Set(rotas.map((r) => r.data_entrega).filter(Boolean))].sort() as string[], [rotas])

  useEffect(() => {
    Promise.all([listarRotasSemana(), listarProdutos()]).then(([r, p]) => { setRotas(r); setProdutos(p); const d = [...new Set(r.map((x) => x.data_entrega))].filter(Boolean).sort(); if (d[0]) setData(d[0] as string) })
      .catch((e) => toast(e.message, 'erro'))
  }, [])

  async function carregar() {
    if (!data) return
    setLinhas(null)
    try {
      let q = supabase.from('v_pedido').select('*').eq('data_entrega', data).neq('status', 'EXCLUIDO').eq('semana_status', 'ABERTA').order('rota').order('ordem_visita')
      if (rotaF !== '') q = q.eq('rota_id', rotaF)
      const pedidos = ok(await q) as PedidoView[]
      const ids = pedidos.map((p) => p.id)
      const itens = ids.length ? ok(await supabase.from('pedido_item').select('*').in('pedido_id', ids)) as PedidoItem[] : []
      const porSigla = Object.fromEntries(produtos.map((p) => [p.id, p.sigla]))
      const m: Record<number, Record<string, number>> = {}
      for (const i of itens) (m[i.pedido_id] ??= {})[porSigla[i.produto_id]] = i.quantidade
      setLinhas(pedidos.map((p) => ({
        id: p.id, rota: p.rota, semana_rota_id: p.semana_rota_id, cliente_id: p.cliente_id,
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

  const resumo: Resumo[] = useMemo(() => {
    const r: Resumo = { id: 'tot', cliente: `TOTAL (${visiveis.length} pedidos)` }
    for (const p of colsProd) r[p.sigla] = visiveis.reduce((s, l) => s + (Number(l[p.sigla]) || 0), 0)
    r.R = visiveis.reduce((s, l) => s + (l.R || 0), 0)
    r.total = visiveis.reduce((s, l) => s + (l.total || 0), 0)
    return [r]
  }, [visiveis, colsProd])

  const colunas: Column<Linha, Resumo>[] = useMemo(() => [
    { key: 'rota', name: 'Rota', width: 130, frozen: true, renderSummaryCell: ({ row }) => <b>{row.cliente}</b> },
    { key: 'cliente', name: 'Cliente', width: 220, frozen: true, renderCell: ({ row }) => <span title={row.cliente} className={row.tipo !== 'CLIENTE' ? 'italic text-slate-500' : ''}>{row.cliente}</span> },
    { key: 'nome', name: 'Nome', width: 140 },
    { key: 'contato', name: 'Contato', width: 120 },
    { key: 'pagto', name: 'Pagto', width: 90 },
    ...colsProd.map((p): Column<Linha, Resumo> => ({
      key: p.sigla, name: p.nome, width: 92, editable: true, renderEditCell: renderTextEditor,
      renderHeaderCell: () => <span className="block text-[11px] leading-tight whitespace-normal text-center" title={p.nome}>{p.nome}</span>,
      cellClass: (row) => `cell-num cell-edit ${estado[`${row.id}:${p.sigla}`] === 'salvando' ? 'cell-dirty' : estado[`${row.id}:${p.sigla}`] === 'ok' ? 'cell-saved' : estado[`${row.id}:${p.sigla}`] === 'erro' ? 'cell-error' : ''}`,
      renderCell: ({ row }) => <>{row[p.sigla] || ''}</>,
      renderSummaryCell: ({ row }) => <b>{row[p.sigla] ? fmtNum(row[p.sigla]) : ''}</b>,
      headerCellClass: 'text-center',
    })),
    { key: 'R', name: 'Reposição', width: 72, editable: true, renderEditCell: renderTextEditor, cellClass: (row) => `cell-num cell-edit ${estado[`${row.id}:R`] === 'ok' ? 'cell-saved' : estado[`${row.id}:R`] === 'erro' ? 'cell-error' : ''}`,
      renderCell: ({ row }) => <>{row.R || ''}</>, renderSummaryCell: ({ row }) => <b>{row.R ? fmtNum(row.R) : ''}</b> },
    { key: 'total', name: 'Total R$', width: 110, cellClass: 'cell-num font-semibold', renderCell: ({ row }) => <>{row.tipo === 'CLIENTE' ? fmtMoeda(row.total) : ''}</>, renderSummaryCell: ({ row }) => <b>{fmtMoeda(row.total)}</b> },
    { key: 'acoes', name: '', width: 40, renderCell: ({ row }) => <button className="text-red-600 font-bold" title="Excluir pedido" onClick={() => setExcluir(row)}>✕</button> },
  ], [colsProd, estado])

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
    <div className="flex h-full flex-col">
      <Titulo acoes={<button className="btn-primary" onClick={() => setIncluir(true)}>+ Incluir pedido</button>}>Programação da semana</Titulo>
      <div className="card p-3 mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Campo label="Semana (data de entrega)">
          <select className="input" value={data} onChange={(e) => setData(e.target.value)}>{datas.map((d) => <option key={d} value={d}>{fmtData(d)}</option>)}</select>
        </Campo>
        <Campo label="Rota">
          <select className="input" value={rotaF} onChange={(e) => setRotaF(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Todas</option>{rotas.filter((r) => r.data_entrega === data).map((r) => <option key={r.rota_id} value={r.rota_id}>{r.rota}</option>)}
          </select>
        </Campo>
        <Campo label="Cliente"><input className="input" placeholder="buscar…" value={texto} onChange={(e) => setTexto(e.target.value)} /></Campo>
        <Campo label="Produtos (mostrar só)">
          <div className="flex flex-wrap gap-1 max-h-20 overflow-auto">
            {produtos.map((p) => (
              <button key={p.id} onClick={() => setProdF(prodF.includes(p.sigla) ? prodF.filter((s) => s !== p.sigla) : [...prodF, p.sigla])}
                className={`chip border ${prodF.includes(p.sigla) ? 'bg-leaf-600 text-white border-leaf-600' : 'bg-white border-slate-300 text-slate-600'}`}>{p.nome}</button>
            ))}
            {prodF.length > 0 && <button className="chip bg-slate-200" onClick={() => setProdF([])}>limpar</button>}
          </div>
        </Campo>
      </div>
      <div className="text-xs text-slate-500 mb-1">Clique duas vezes (ou Enter) numa célula para editar. Salva automaticamente ao sair da célula. Amarelo = salvando, verde = salvo, vermelho = erro.</div>
      {linhas === null ? <Carregando /> : (
        <div className="card flex-1 min-h-[420px] overflow-hidden">
          <DataGrid className="rdg-light" columns={colunas} rows={visiveis} topSummaryRows={resumo} rowKeyGetter={(r) => r.id}
            onRowsChange={onRowsChange} rowHeight={32} headerRowHeight={52} summaryRowHeight={34} />
        </div>
      )}

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
    <Modal aberto titulo={`Incluir pedido — semana ${fmtData(data)}`} onFechar={() => onFechar(false)} largura="max-w-lg">
      <div className="grid gap-3">
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
