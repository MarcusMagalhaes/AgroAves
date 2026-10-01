// Tela de venda semanal — mesmo padrão da aba "Venda Semana" da planilha:
// cabeçalho (vendedor, semana, filtros, cliente) → financeiro + 4 últimos pedidos → grade 3 colunas × 9 produtos → interesse
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '@/lib/auth'
import { supabase, ok } from '@/lib/supabase'
import { itensDoPedido, listarProdutos, listarRotasSemana, precosDoCliente, rpc } from '@/lib/dados'
import { fmtData, fmtMoeda, normalizar } from '@/lib/format'
import { FORMAS, RESULTADOS, type ClienteRotaSemana, type Produto, type Resultado, type RotaSemana } from '@/lib/types'
import { Carregando, Confirmar, Vazio, useToast } from '@/components/ui'

type FiltroStatus = 'TODOS' | 'PEDIDO' | 'SEM_PEDIDO' | 'SEM_INTERESSE' | 'SEM_CONTATO'
const FILTROS: Record<FiltroStatus, string> = {
  TODOS: 'Todos', PEDIDO: 'Pedido registrado', SEM_PEDIDO: 'Sem pedido', SEM_INTERESSE: 'Sem interesse', SEM_CONTATO: 'Sem contato',
}
function passaFiltro(c: ClienteRotaSemana, f: FiltroStatus) {
  switch (f) {
    case 'PEDIDO': return c.resultado === 'PEDIDO'
    case 'SEM_PEDIDO': return !c.resultado || c.resultado === 'INTERESSE_SEM_PEDIDO'
    case 'SEM_INTERESSE': return c.resultado === 'SEM_INTERESSE'
    case 'SEM_CONTATO': return !c.resultado || c.resultado === 'SEM_CONTATO'
    default: return true
  }
}
const rotulo = (c: ClienteRotaSemana) =>
  [c.razao_social, c.nome_fantasia, c.cidade, c.contato, c.telefone].filter(Boolean).join('  __  ')

const CabecalhoCel = ({ children, className = '' }: { children: ReactNode; className?: string }) =>
  <th className={`bg-slate-200 border border-slate-300 px-1 py-0.5 text-[11px] font-bold text-slate-700 ${className}`}>{children}</th>

export default function Venda() {
  const { usuario } = useAuth()
  const { toast } = useToast()
  const [rotas, setRotas] = useState<RotaSemana[]>([])
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [rotaId, setRotaId] = useState<number | null>(null)
  const [texto, setTexto] = useState('')
  const [filtro, setFiltro] = useState<FiltroStatus>('TODOS')
  const [clientes, setClientes] = useState<ClienteRotaSemana[]>([])
  const [carregando, setCarregando] = useState(true)
  const [clienteId, setClienteId] = useState<number | null>(null)

  const [precos, setPrecos] = useState<Record<number, number>>({})
  const [qtd, setQtd] = useState<Record<number, string>>({})
  const [reposicao, setReposicao] = useState('')
  const [pendencia, setPendencia] = useState<{ valor_pendente: number; semanas: string[] } | null>(null)
  const [ultimos, setUltimos] = useState<any[]>([])
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [marca, setMarca] = useState<Resultado | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [confirmaExcluir, setConfirmaExcluir] = useState(false)
  const primeiroInput = useRef<HTMLInputElement>(null)

  const rota = rotas.find((r) => r.rota_id === rotaId) ?? null
  const cliente = clientes.find((c) => c.cliente_id === clienteId) ?? null

  useEffect(() => {
    Promise.all([listarRotasSemana(), listarProdutos()]).then(([r, p]) => {
      setRotas(r); setProdutos(p)
      if (r.length) setRotaId(r[0].rota_id)
    }).catch((e) => toast(e.message, 'erro')).finally(() => setCarregando(false))
  }, [])

  async function carregarClientes(manterSelecao = false) {
    if (!rotaId) return
    try {
      const lista = await rpc<ClienteRotaSemana[]>('clientes_rota_semana', { p_rota_id: rotaId })
      setClientes(lista)
      if (!manterSelecao) setClienteId(null)
    } catch (e: any) { toast(e.message, 'erro') }
  }
  useEffect(() => { carregarClientes() }, [rotaId])

  const filtrados = useMemo(() => {
    const t = normalizar(texto).replace(/[^\w\s]/g, ' ').trim().split(/\s+/).filter(Boolean)
    return clientes.filter((c) => passaFiltro(c, filtro) && t.every((p) => c.busca.includes(p)))
  }, [clientes, texto, filtro])

  // cliente selecionado saiu do filtro → mantém, mas se nenhum, escolhe o primeiro
  useEffect(() => {
    if (filtrados.length && (clienteId == null || !filtrados.some((c) => c.cliente_id === clienteId))) setClienteId(filtrados[0].cliente_id)
    if (!filtrados.length) setClienteId(null)
  }, [filtrados])

  // ao trocar de cliente: relê pedido e contato gravados
  useEffect(() => {
    if (!cliente) { setQtd({}); setReposicao(''); setPendencia(null); setUltimos([]); setResultado(null); setMarca(null); return }
    let vivo = true
    ;(async () => {
      try {
        const [pc, pend, ult] = await Promise.all([
          precosDoCliente(cliente.cliente_id),
          rpc<any[]>('pendencia_cliente', { p_cliente_id: cliente.cliente_id, p_antes_de: rota?.data_entrega ?? null }),
          rpc<any[]>('ultimos_pedidos', { p_cliente_id: cliente.cliente_id, p_limite: 4 }),
        ])
        if (!vivo) return
        setPrecos(Object.fromEntries(pc.map((p) => [p.produto_id, Number(p.preco)])))
        setPendencia(pend?.[0] ?? null)
        setUltimos(ult ?? [])
        setResultado(cliente.resultado); setMarca(cliente.resultado)
        if (cliente.pedido_id) {
          const itens = await itensDoPedido(cliente.pedido_id)
          const { data } = await supabase.from('pedido').select('reposicao').eq('id', cliente.pedido_id).single()
          if (!vivo) return
          setQtd(Object.fromEntries(itens.map((i) => [i.produto_id, String(i.quantidade)])))
          setReposicao(data?.reposicao ? String(data.reposicao) : '')
        } else { setQtd({}); setReposicao('') }
        setTimeout(() => primeiroInput.current?.focus(), 50)
      } catch (e: any) { toast(e.message, 'erro') }
    })()
    return () => { vivo = false }
  }, [clienteId])

  const total = useMemo(() => produtos.reduce((s, p) => s + (Number(qtd[p.id]) || 0) * (precos[p.id] ?? 0), 0), [qtd, precos, produtos])

  async function salvarPedido() {
    if (!cliente || !rota?.semana_rota_id) return
    const itens = produtos.filter((p) => Number(qtd[p.id]) > 0).map((p) => ({ produto_id: p.id, quantidade: Number(qtd[p.id]) }))
    if (!itens.length && !(Number(reposicao) > 0)) { toast('Informe ao menos uma quantidade', 'erro'); return }
    setSalvando(true)
    try {
      await rpc('salvar_pedido', { p_semana_rota_id: rota.semana_rota_id, p_cliente_id: cliente.cliente_id, p_itens: itens, p_reposicao: Number(reposicao) || 0 })
      toast(`Pedido salvo: ${fmtMoeda(total)}`)
      setResultado('PEDIDO'); setMarca('PEDIDO')
      await carregarClientes(true)
    } catch (e: any) { toast(e.message, 'erro') } finally { setSalvando(false) }
  }
  async function excluirPedido() {
    if (!cliente?.pedido_id) return
    setConfirmaExcluir(false)
    try { await rpc('excluir_pedido', { p_pedido_id: cliente.pedido_id }); toast('Pedido excluído'); setQtd({}); setReposicao(''); setResultado(null); setMarca(null); await carregarClientes(true) }
    catch (e: any) { toast(e.message, 'erro') }
  }
  async function registrarInteresse() {
    if (!cliente || !rota?.semana_rota_id) return
    if (!marca) { toast('Marque uma opção de interesse do cliente', 'erro'); return }
    if (marca === 'PEDIDO' && !cliente.pedido_id) { toast('"Realizou pedido" é marcado automaticamente ao salvar o pedido', 'erro'); return }
    if (marca === 'SEM_INTERESSE' && cliente.pedido_id) {
      if (!confirm('Este cliente tem pedido na semana. Marcar "não teve interesse" vai excluir o pedido. Continuar?')) return
      await rpc('excluir_pedido', { p_pedido_id: cliente.pedido_id }); setQtd({}); setReposicao('')
    }
    try {
      ok(await supabase.from('contato_cliente').upsert(
        { semana_rota_id: rota.semana_rota_id, cliente_id: cliente.cliente_id, resultado: marca, registrado_por: usuario!.id, registrado_em: new Date().toISOString() },
        { onConflict: 'semana_rota_id,cliente_id' }))
      setResultado(marca); toast('Interesse registrado'); await carregarClientes(true)
    } catch (e: any) { toast(e.message, 'erro') }
  }
  function limpar() { setQtd({}); setReposicao(''); setMarca(resultado) }
  function navegar(d: number) {
    const i = filtrados.findIndex((c) => c.cliente_id === clienteId)
    const j = i + d; if (j >= 0 && j < filtrados.length) setClienteId(filtrados[j].cliente_id)
  }

  if (carregando) return <Carregando />
  if (!rotas.length) return <Vazio texto="Nenhuma rota disponível para você. Fale com o administrador." />

  // 3 colunas de produtos na ordem do cadastro (como na planilha)
  const colunas: Produto[][] = [[], [], []]
  const porCol = Math.ceil(produtos.length / 3)
  produtos.forEach((p, i) => colunas[Math.min(2, Math.floor(i / porCol))].push(p))
  const idx = filtrados.findIndex((c) => c.cliente_id === clienteId)
  // produtos presentes nos últimos pedidos (colunas da tabela de histórico)
  const siglasUlt = new Set<string>(ultimos.flatMap((u) => (u.itens as any[]).map((i) => i.sigla)))
  const prodUlt = produtos.filter((p) => siglasUlt.has(p.sigla))

  return (
    <div className="mx-auto max-w-[1500px] text-sm">
      {/* ===== Cabeçalho compacto: vendedor, semana, filtros, cliente ===== */}
      <div className="card px-3 py-2 mb-1.5 bg-rose-50/60 text-xs">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
          <div className="flex items-center gap-1.5"><span className="font-bold text-slate-500 uppercase text-[10px]">Vendedor</span><span className="rounded border border-slate-300 bg-white px-2 py-0.5 font-bold">{rota?.vendedor ?? '—'}</span></div>
          <div className="flex items-center gap-1.5"><span className="font-bold text-slate-500 uppercase text-[10px]">Semana</span><span className="rounded border border-slate-300 bg-white px-2 py-0.5 font-bold">{fmtData(rota?.data_entrega)}</span></div>
          <div className="flex items-center gap-1.5 flex-1 min-w-[180px]"><span className="font-bold text-slate-500 uppercase text-[10px]">Rota</span>
            <select className="input py-1 px-2 text-xs bg-yellow-50 font-bold" value={rotaId ?? ''} onChange={(e) => setRotaId(Number(e.target.value))}>
              {rotas.map((r) => <option key={r.rota_id} value={r.rota_id}>{r.rota}</option>)}
            </select></div>
          <div className="flex items-center gap-1.5 flex-1 min-w-[180px]"><span className="font-bold text-slate-500 uppercase text-[10px]">Texto</span>
            <input className="input py-1 px-2 text-xs bg-yellow-50" placeholder="buscar cliente, cidade, contato…" value={texto} onChange={(e) => setTexto(e.target.value)} /></div>
          <div className="flex items-center gap-1.5 min-w-[200px]"><span className="font-bold text-slate-500 uppercase text-[10px] whitespace-nowrap">Pedido na semana</span>
            <select className="input py-1 px-2 text-xs bg-yellow-50 italic" value={filtro} onChange={(e) => setFiltro(e.target.value as FiltroStatus)}>
              {Object.entries(FILTROS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="font-bold text-slate-500 uppercase text-[10px] shrink-0 hidden sm:block">Cliente</span>
          <button className="btn-secondary px-2.5 py-1 text-xs" onClick={() => navegar(-1)} disabled={idx <= 0} title="Cliente anterior">◀</button>
          <select className="input py-1 px-2 text-sm bg-yellow-50 font-bold flex-1 min-w-0" value={clienteId ?? ''} onChange={(e) => setClienteId(Number(e.target.value))}>
            {filtrados.length === 0 && <option value="">Nenhum cliente com esse filtro</option>}
            {filtrados.map((c) => <option key={c.cliente_id} value={c.cliente_id}>{c.ordem_visita}. {rotulo(c)}{c.pedido_id ? '  ✔' : c.resultado === 'SEM_INTERESSE' ? '  ✖' : ''}</option>)}
          </select>
          <button className="btn-secondary px-2.5 py-1 text-xs" onClick={() => navegar(1)} disabled={idx < 0 || idx >= filtrados.length - 1} title="Próximo cliente">▶</button>
          <span className="text-[11px] text-slate-500 shrink-0 hidden md:block">{idx + 1}/{filtrados.length}</span>
        </div>
      </div>

      {!cliente ? <div className="card"><Vazio texto="Nenhum cliente selecionado" /></div> : (
        <>
          {/* ===== Financeiro + últimos pedidos (altura só do conteúdo) ===== */}
          {/* ===== Financeiro + últimos pedidos: ALTURA FIXA (cabeçalho de 2 linhas + 4 pedidos) ===== */}
          <div className="grid gap-1.5 lg:grid-cols-[170px_1fr] mb-1.5 lg:h-[158px]">
            <div className="card bg-emerald-50/50 relative h-full">
              <div className="lg:absolute lg:inset-0 overflow-auto px-2 py-1">
                <div className="flex items-baseline justify-between"><span className="label mb-0">Financeiro</span><span className="text-[10px] font-bold text-slate-500 uppercase">Pendência</span></div>
                {pendencia && Number(pendencia.valor_pendente) > 0 ? (
                  <>
                    <div className="text-base font-extrabold text-red-700 leading-tight">{fmtMoeda(Number(pendencia.valor_pendente))}</div>
                    <div className="text-[10px] text-slate-600 leading-tight">{pendencia.semanas.map(fmtData).join(' | ')}</div>
                  </>
                ) : <div className="text-base font-extrabold text-emerald-700 leading-tight">R$ 0,00</div>}
              </div>
            </div>
            <div className="card px-2 py-1 h-full overflow-hidden flex flex-col">
              <div className="text-center text-[11px] font-bold bg-emerald-100 rounded leading-4 mb-1 shrink-0">4 Últimos pedidos</div>
              <div className="overflow-x-auto overflow-y-hidden flex-1">
                <table className="w-full border-collapse table-fixed">
                  <thead>
                    <tr className="h-[32px]">
                      <CabecalhoCel className="text-left whitespace-nowrap w-[72px]">Data</CabecalhoCel>
                      {prodUlt.map((p) => <CabecalhoCel key={p.id} className="leading-[1.1] font-semibold text-[10px] px-0.5 align-middle">{p.nome}</CabecalhoCel>)}
                      {prodUlt.length === 0 && <CabecalhoCel className="font-normal text-slate-400">Sem pedidos anteriores</CabecalhoCel>}
                      <CabecalhoCel className="w-[52px]">Repos.</CabecalhoCel>
                      <CabecalhoCel className="text-right w-[90px]">Total R$</CabecalhoCel>
                    </tr>
                  </thead>
                  <tbody>
                    {[0, 1, 2, 3].map((i) => {
                      const u = ultimos[i]
                      const m = u ? Object.fromEntries((u.itens as any[]).map((x) => [x.sigla, x.quantidade])) : {}
                      return (
                        <tr key={u?.pedido_id ?? `v${i}`} className="h-[22px] leading-[20px]">
                          <td className="border border-slate-300 px-1 py-0 text-[11px] font-bold whitespace-nowrap">{u ? fmtData(u.data_entrega) : ''}</td>
                          {prodUlt.map((p) => <td key={p.id} className="border border-slate-300 px-1 py-0 text-center text-[11px] font-semibold">{u ? (m[p.sigla] || '') : ''}</td>)}
                          {prodUlt.length === 0 && <td className="border border-slate-300" />}
                          <td className="border border-slate-300 px-1 py-0 text-center text-[11px]">{u?.reposicao || ''}</td>
                          <td className="border border-slate-300 px-1 py-0 text-right text-[11px] font-bold whitespace-nowrap">{u ? fmtMoeda(Number(u.total)) : ''}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ===== Pedido da semana + interesse ===== */}
          <div className="grid gap-1.5 lg:grid-cols-[1fr_220px] items-start">
            <div className="card p-2 bg-sky-50/50">
              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                <button className="btn bg-orange-500 text-white hover:bg-orange-600 py-1 text-xs" onClick={limpar}>Limpar campos</button>
                <button className="btn-primary py-1 px-5 text-xs" onClick={salvarPedido} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar pedido'}</button>
                {cliente.pedido_id && <button className="btn-danger py-1 text-xs" onClick={() => setConfirmaExcluir(true)}>Excluir</button>}
                <div className="flex-1 text-center font-extrabold text-xs">Pedido da Semana</div>
                <label className="flex items-center gap-1 text-xs font-bold text-red-700">Reposição
                  <input type="number" inputMode="numeric" min={0} className="input w-16 px-1 py-0.5 text-xs text-center bg-yellow-50 font-bold text-slate-800" value={reposicao} onChange={(e) => setReposicao(e.target.value)} /></label>
                <div className="flex items-center gap-2 rounded bg-slate-200 px-2 py-0.5"><span className="text-xs font-bold">Total</span><span className="text-sm font-extrabold min-w-[90px] text-right">{fmtMoeda(total)}</span></div>
              </div>
              <div className="grid gap-x-3 md:grid-cols-3">
                {colunas.map((col, ci) => (
                  <table key={ci} className="w-full border-collapse">
                    <thead><tr><CabecalhoCel className="w-14">Quant.</CabecalhoCel><CabecalhoCel className="text-left">Discriminação</CabecalhoCel><CabecalhoCel className="w-16">Unit.</CabecalhoCel></tr></thead>
                    <tbody>
                      {col.map((p, i) => {
                        const preco = precos[p.id]; const tem = preco != null
                        return (
                          <tr key={p.id} className={tem ? '' : 'opacity-40'}>
                            <td className="border border-slate-300 p-0">
                              <input ref={ci === 0 && i === 0 ? primeiroInput : undefined} type="number" inputMode="numeric" min={0} disabled={!tem} value={qtd[p.id] ?? ''}
                                onChange={(e) => setQtd({ ...qtd, [p.id]: e.target.value })}
                                className="w-full h-[22px] bg-yellow-50 text-center text-xs font-bold outline-none focus:bg-yellow-200 disabled:bg-slate-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
                            </td>
                            <td className="border border-slate-300 px-1.5 py-0 text-[11px] font-semibold whitespace-nowrap leading-none">{p.nome}</td>
                            <td className="border border-slate-300 px-1 py-0 text-right text-[10px]">{tem ? fmtMoeda(preco).replace('R$', '').trim() : '-'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                ))}
              </div>
            </div>

            <div className="card p-2 bg-sky-50/50">
              <div className="text-center font-bold bg-sky-200 rounded py-0.5 mb-1">Interesse do Cliente</div>
              <table className="w-full border-collapse">
                <tbody>
                  {(['INTERESSE_SEM_PEDIDO', 'SEM_INTERESSE', 'SEM_CONTATO', 'PEDIDO'] as Resultado[]).map((r) => (
                    <tr key={r} className="cursor-pointer" onClick={() => setMarca(marca === r ? null : r)}>
                      <td className={`border border-slate-300 px-1.5 py-1 text-[11px] leading-tight ${marca === r ? 'font-bold' : ''}`}>{RESULTADOS[r]}</td>
                      <td className={`border border-slate-300 w-8 text-center text-lg font-black ${marca === r ? 'bg-white' : 'bg-yellow-50'}`}>{marca === r ? 'X' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="btn-primary w-full mt-1.5 py-1 text-xs" onClick={registrarInteresse}>Registrar interesse</button>
              {resultado && <div className="mt-1 text-[11px] text-center text-slate-500">Registrado: {RESULTADOS[resultado]}</div>}
            </div>
          </div>
        </>
      )}

      <Confirmar aberto={confirmaExcluir} titulo="Excluir pedido" perigo
        texto={`Excluir o pedido de ${cliente?.razao_social} desta semana?`} onSim={excluirPedido} onNao={() => setConfirmaExcluir(false)} />
    </div>
  )
}
