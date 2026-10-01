// Ajuste da entrega: (1) o que a granja confirmou (RF-33) e (2) redistribuição manual entre clientes (RF-34)
import { useEffect, useMemo, useState } from 'react'
import { supabase, ok } from '@/lib/supabase'
import { listarCidades, listarProdutos, rpc } from '@/lib/dados'
import { fmtData, fmtDataHora, fmtMoeda, fmtNum } from '@/lib/format'
import { corProduto } from '@/lib/types'
import type { Cidade, PedidoFornecedor as PF, PedidoFornecedorItem, Produto } from '@/lib/types'
import { Campo, Carregando, Chip, Confirmar, Titulo, Vazio, useToast } from '@/components/ui'

export default function AjusteEntrega() {
  const { toast } = useToast()
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [cidades, setCidades] = useState<Cidade[]>([])
  const [pedidos, setPedidos] = useState<PF[]>([])
  const [pfId, setPfId] = useState<number | ''>('')
  const [itens, setItens] = useState<PedidoFornecedorItem[]>([])
  const [conf, setConf] = useState<Record<number, { q: string; obs: string }>>({})
  const [programado, setProgramado] = useState<Record<number, number>>({})
  const [prodSel, setProdSel] = useState<number | null>(null)
  const [clientes, setClientes] = useState<any[]>([])
  const [carregando, setCarregando] = useState(false)
  const [confirmaEntrega, setConfirmaEntrega] = useState(false)

  const pf = pedidos.find((p) => p.id === pfId) ?? null

  useEffect(() => {
    Promise.all([listarProdutos(), listarCidades(), supabase.from('pedido_fornecedor').select('*').order('data_entrega', { ascending: false }).limit(40)])
      .then(([p, c, r]) => { setProdutos(p); setCidades(c); const l = ok(r) as PF[]; setPedidos(l); if (l[0]) setPfId(l[0].id) })
      .catch((e) => toast(e.message, 'erro'))
  }, [])

  async function carregar() {
    if (!pf) return
    setCarregando(true)
    try {
      const it = ok(await supabase.from('pedido_fornecedor_item').select('*').eq('pedido_fornecedor_id', pf.id)) as PedidoFornecedorItem[]
      setItens(it)
      setConf(Object.fromEntries(it.map((i) => [i.produto_id, { q: i.qtd_confirmada != null ? String(i.qtd_confirmada) : String(i.qtd_pedida), obs: i.observacao ?? '' }])))
      const prog = ok(await supabase.from('v_programacao_cidade').select('*').eq('data_entrega', pf.data_entrega).eq('cidade_distribuicao_id', pf.cidade_distribuicao_id)) as any[]
      const pm: Record<number, number> = {}; for (const x of prog) pm[x.produto_id] = Number(x.qtd_programada)
      setProgramado(pm)
      if (prodSel) await carregarClientes(prodSel, pf)
    } catch (e: any) { toast(e.message, 'erro') } finally { setCarregando(false) }
  }
  useEffect(() => { carregar() }, [pfId])

  async function carregarClientes(produtoId: number, p: PF = pf!) {
    const rows = ok(await supabase.from('pedido_item').select('pedido_id, quantidade, preco_unitario, pedido:pedido!inner(id, total, status, cidade_distribuicao_id, reposicao, semana_rota:semana_rota!inner(data_entrega, rota:rota(nome)), cliente:cliente(razao_social, nome_fantasia, cidade, forma_pagamento))')
      .eq('produto_id', produtoId).eq('pedido.cidade_distribuicao_id', p.cidade_distribuicao_id).eq('pedido.semana_rota.data_entrega', p.data_entrega).neq('pedido.status', 'EXCLUIDO')) as any[]
    setClientes(rows.map((r) => ({
      pedido_id: r.pedido_id, quantidade: r.quantidade, preco: Number(r.preco_unitario), total: Number(r.pedido.total),
      rota: r.pedido.semana_rota?.rota?.nome, cliente: r.pedido.cliente?.razao_social ?? '(reposição/sobra da rota)', nome: r.pedido.cliente?.nome_fantasia,
      cidade: r.pedido.cliente?.cidade, pagto: r.pedido.cliente?.forma_pagamento, edit: String(r.quantidade),
    })).sort((a, b) => (a.rota ?? '').localeCompare(b.rota ?? '') || a.cliente.localeCompare(b.cliente)))
  }

  async function salvarConfirmacao(status: 'CONFIRMADO' | 'ENTREGUE') {
    if (!pf) return
    setConfirmaEntrega(false)
    const lista = Object.entries(conf).map(([pid, v]) => ({ produto_id: Number(pid), qtd_confirmada: Number(v.q) || 0, observacao: v.obs || null }))
    try {
      await rpc('confirmar_pedido_fornecedor', { p_id: pf.id, p_itens: lista, p_status: status })
      toast(status === 'ENTREGUE' ? 'Entrega registrada e títulos financeiros gerados' : 'Confirmação da granja salva; títulos financeiros gerados')
      const r = ok(await supabase.from('pedido_fornecedor').select('*').order('data_entrega', { ascending: false }).limit(40)) as PF[]
      setPedidos(r); carregar()
    } catch (e: any) { toast(e.message, 'erro') }
  }

  async function salvarQtdCliente(c: any) {
    const q = Math.max(0, Math.floor(Number(c.edit) || 0))
    if (q === c.quantidade) return
    try {
      await rpc('atualizar_item_pedido', { p_pedido_id: c.pedido_id, p_produto_id: prodSel, p_quantidade: q })
      toast(`${c.cliente}: ${c.quantidade} → ${q}`)
      await carregar()
    } catch (e: any) { toast(e.message, 'erro'); setClientes((cs) => cs.map((x) => (x.pedido_id === c.pedido_id ? { ...x, edit: String(x.quantidade) } : x))) }
  }

  const linhas = useMemo(() => produtos.filter((p) => itens.some((i) => i.produto_id === p.id) || programado[p.id]), [produtos, itens, programado])
  const item = (pid: number) => itens.find((i) => i.produto_id === pid)
  const prodSelObj = produtos.find((p) => p.id === prodSel)

  return (
    <div className="mx-auto max-w-6xl">
      <Titulo>Ajuste da entrega</Titulo>
      <div className="barra">
        <Campo label="Pedido à granja (data / cidade)">
          <select className="input" value={pfId} onChange={(e) => { setPfId(Number(e.target.value)); setProdSel(null); setClientes([]) }}>
            {pedidos.map((p) => <option key={p.id} value={p.id}>{fmtData(p.data_entrega)} — {cidades.find((c) => c.id === p.cidade_distribuicao_id)?.nome} — {p.status}</option>)}
          </select>
        </Campo>
        {pf && <div className="text-sm"><Chip cor={pf.status === 'REGISTRADO' ? 'amarelo' : 'verde'}>{pf.status}</Chip> <span className="text-slate-500">registrado {fmtDataHora(pf.registrado_em)}</span></div>}
      </div>
      {!pf ? <div className="card"><Vazio texto="Nenhum pedido à granja registrado" /></div> : carregando ? <Carregando /> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {/* 1. Confirmação da granja */}
          <div className="card p-3">
            <div className="font-bold text-leaf-900 mb-1">1. O que a granja vai mandar</div>
            <p className="text-xs text-slate-500 mb-2">Informe por produto a quantidade confirmada no carregamento e substituições. Ao salvar, os títulos financeiros desta data/cidade são gerados.</p>
            <table className="tabela">
              <thead><tr><th className="text-left">Produto</th><th className="text-right">Pedido</th><th className="text-right">Confirmado</th><th className="text-left">Obs.</th></tr></thead>
              <tbody>
                {linhas.map((p, idx) => {
                const novoGrupo = idx === 0 || linhas[idx - 1].grupo !== p.grupo
                const linhaGrupo = novoGrupo ? <tr key={`g${p.id}`} className="grupo-prod"><td colSpan={9} style={{ background: corProduto(p) + '66' }}>{p.grupo ?? 'OUTROS'}</td></tr> : null
                  const it = item(p.id); const c = conf[p.id] ?? { q: '', obs: '' }
                  const dif = (Number(c.q) || 0) - (it?.qtd_pedida ?? 0)
                  return (<>{linhaGrupo}
                    <tr key={p.id} className="border-t border-slate-100">
                      <td className="font-semibold" style={{ background: corProduto(p) + '26' }}>{p.nome}</td>
                      <td className="text-right">{fmtNum(it?.qtd_pedida ?? 0)}</td>
                      <td className="text-right"><input type="number" className={`input w-24 py-1 text-right ${dif !== 0 ? 'border-amber-400 bg-amber-50' : ''}`} value={c.q} onChange={(e) => setConf({ ...conf, [p.id]: { ...c, q: e.target.value } })} /></td>
                      <td className="px-2"><input className="input py-1" placeholder="substituição…" value={c.obs} onChange={(e) => setConf({ ...conf, [p.id]: { ...c, obs: e.target.value } })} /></td>
                    </tr>
                  </>)
                })}
              </tbody>
            </table>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button className="btn-primary" onClick={() => salvarConfirmacao('CONFIRMADO')}>Salvar confirmação da granja</button>
              <button className="btn-accent" onClick={() => setConfirmaEntrega(true)}>Marcar como entregue</button>
            </div>
          </div>

          {/* 2. Redistribuição entre clientes */}
          <div className="card p-3">
            <div className="font-bold text-leaf-900 mb-1">2. Ajustar pedidos dos clientes</div>
            <p className="text-xs text-slate-500 mb-2">Previsto = soma atual dos pedidos. Clique num produto para ver quem pediu e alterar as quantidades. O sistema só mostra a diferença, não distribui.</p>
            <table className="tabela">
              <thead><tr><th className="text-left">Produto</th><th className="text-right">Previsto</th><th className="text-right">Confirmado</th><th className="text-right">Diferença</th></tr></thead>
              <tbody>
                {linhas.map((p, idx) => {
                const novoGrupo = idx === 0 || linhas[idx - 1].grupo !== p.grupo
                const linhaGrupo = novoGrupo ? <tr key={`g${p.id}`} className="grupo-prod"><td colSpan={9} style={{ background: corProduto(p) + '66' }}>{p.grupo ?? 'OUTROS'}</td></tr> : null
                  const prev = programado[p.id] ?? 0; const confQ = item(p.id)?.qtd_confirmada; const dif = confQ == null ? null : confQ - prev
                  return (<>{linhaGrupo}
                    <tr key={p.id} onClick={() => { setProdSel(p.id); carregarClientes(p.id) }} className={`border-t border-slate-100 cursor-pointer hover:bg-leaf-50 ${prodSel === p.id ? 'bg-leaf-100' : ''}`}>
                      <td className="font-semibold" style={{ background: corProduto(p) + '26' }}>{p.nome}</td>
                      <td className="text-right">{fmtNum(prev)}</td>
                      <td className="text-right">{confQ ?? '—'}</td>
                      <td className={`p-1.5 text-right font-bold ${dif == null ? '' : dif < 0 ? 'text-red-600' : dif > 0 ? 'text-leaf-700' : 'text-slate-400'}`}>{dif == null ? '' : dif > 0 ? `+${dif}` : dif}</td>
                    </tr>
                  </>)
                })}
              </tbody>
            </table>
            {prodSelObj && (
              <div className="mt-3 border-t border-slate-200 pt-3">
                <div className="font-semibold mb-1">Clientes que pediram <b>{prodSelObj.nome}</b> ({clientes.length})</div>
                <div className="max-h-80 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="text-slate-500"><tr><th className="p-1 text-left">Rota</th><th className="p-1 text-left">Cliente</th><th className="p-1 text-left">Pagto</th><th className="p-1 text-right">Qtd</th><th className="p-1 text-right">Total pedido</th></tr></thead>
                    <tbody>
                      {clientes.map((c) => (
                        <tr key={c.pedido_id} className="border-t border-slate-100">
                          <td className="p-1">{c.rota}</td>
                          <td className="p-1"><div className="font-semibold">{c.cliente}</div><div className="text-slate-500">{c.nome} · {c.cidade}</div></td>
                          <td className="p-1">{c.pagto}</td>
                          <td className="p-1 text-right">
                            <input type="number" className="input w-20 py-0.5 text-right" value={c.edit}
                              onChange={(e) => setClientes((cs) => cs.map((x) => (x.pedido_id === c.pedido_id ? { ...x, edit: e.target.value } : x)))}
                              onBlur={() => salvarQtdCliente(c)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                          </td>
                          <td className="p-1 text-right">{fmtMoeda(c.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr className="font-bold border-t"><td className="p-1" colSpan={3}>Soma atual</td><td className="p-1 text-right">{fmtNum(clientes.reduce((s, c) => s + c.quantidade, 0))}</td><td /></tr></tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <Confirmar aberto={confirmaEntrega} titulo="Marcar como entregue" texto="Confirma que a mercadoria chegou? Os títulos financeiros desta data/cidade serão gerados ou atualizados." onSim={() => salvarConfirmacao('ENTREGUE')} onNao={() => setConfirmaEntrega(false)} />
    </div>
  )
}
