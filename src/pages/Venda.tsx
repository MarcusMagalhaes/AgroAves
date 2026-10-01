// Tela de venda semanal — segue o layout da aba "Venda Semana" (modelo Marcus):
// filtros (rota, texto, status) → lista de clientes → painel do cliente (pendência, últimos pedidos) → grade de produtos → contato
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { supabase, ok } from '@/lib/supabase'
import { itensDoPedido, listarProdutos, listarRotasSemana, precosDoCliente, rpc } from '@/lib/dados'
import { fmtData, fmtMoeda, normalizar } from '@/lib/format'
import { FORMAS, RESULTADOS, type ClienteRotaSemana, type Produto, type Resultado, type RotaSemana } from '@/lib/types'
import { Campo, Carregando, Chip, Confirmar, Titulo, Vazio, useToast } from '@/components/ui'

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

function corStatus(r: Resultado | null) {
  if (r === 'PEDIDO') return 'verde'
  if (r === 'SEM_INTERESSE') return 'vermelho'
  if (r === 'SEM_CONTATO') return 'cinza'
  if (r === 'INTERESSE_SEM_PEDIDO') return 'amarelo'
  return 'cinza'
}

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
  const [mostrarLista, setMostrarLista] = useState(true)

  // dados do cliente selecionado
  const [precos, setPrecos] = useState<Record<number, number>>({})
  const [qtd, setQtd] = useState<Record<number, string>>({})
  const [reposicao, setReposicao] = useState('')
  const [pendencia, setPendencia] = useState<{ valor_pendente: number; semanas: string[] } | null>(null)
  const [ultimos, setUltimos] = useState<any[]>([])
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [confirmaExcluir, setConfirmaExcluir] = useState(false)

  const rota = rotas.find((r) => r.rota_id === rotaId) ?? null
  const cliente = clientes.find((c) => c.cliente_id === clienteId) ?? null

  useEffect(() => {
    Promise.all([listarRotasSemana(), listarProdutos()]).then(([r, p]) => {
      setRotas(r); setProdutos(p)
      if (r.length && rotaId == null) setRotaId(r[0].rota_id)
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

  // ao trocar de cliente: relê pedido e contato gravados (comportamento da aba Marcus)
  useEffect(() => {
    if (!cliente) return
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
        setResultado(cliente.resultado)
        if (cliente.pedido_id) {
          const itens = await itensDoPedido(cliente.pedido_id)
          const { data } = await supabase.from('pedido').select('reposicao').eq('id', cliente.pedido_id).single()
          if (!vivo) return
          setQtd(Object.fromEntries(itens.map((i) => [i.produto_id, String(i.quantidade)])))
          setReposicao(data?.reposicao ? String(data.reposicao) : '')
        } else { setQtd({}); setReposicao('') }
      } catch (e: any) { toast(e.message, 'erro') }
    })()
    return () => { vivo = false }
  }, [clienteId])

  const total = useMemo(() =>
    produtos.reduce((s, p) => s + (Number(qtd[p.id]) || 0) * (precos[p.id] ?? 0), 0), [qtd, precos, produtos])

  async function salvarPedido() {
    if (!cliente || !rota?.semana_rota_id) return
    const itens = produtos.filter((p) => Number(qtd[p.id]) > 0).map((p) => ({ produto_id: p.id, quantidade: Number(qtd[p.id]) }))
    if (!itens.length && !(Number(reposicao) > 0)) { toast('Informe ao menos uma quantidade', 'erro'); return }
    setSalvando(true)
    try {
      await rpc('salvar_pedido', { p_semana_rota_id: rota.semana_rota_id, p_cliente_id: cliente.cliente_id, p_itens: itens, p_reposicao: Number(reposicao) || 0 })
      toast(`Pedido de ${cliente.razao_social} salvo: ${fmtMoeda(total)}`)
      setResultado('PEDIDO')
      await carregarClientes(true)
    } catch (e: any) { toast(e.message, 'erro') } finally { setSalvando(false) }
  }

  async function excluirPedido() {
    if (!cliente?.pedido_id) return
    setConfirmaExcluir(false)
    try {
      await rpc('excluir_pedido', { p_pedido_id: cliente.pedido_id })
      toast('Pedido excluído')
      setQtd({}); setReposicao(''); setResultado(null)
      await carregarClientes(true)
    } catch (e: any) { toast(e.message, 'erro') }
  }

  async function registrarContato(r: Resultado) {
    if (!cliente || !rota?.semana_rota_id) return
    if (r === 'SEM_INTERESSE' && cliente.pedido_id) {
      if (!confirm('Este cliente tem pedido na semana. Marcar "sem interesse" vai excluir o pedido. Continuar?')) return
      await rpc('excluir_pedido', { p_pedido_id: cliente.pedido_id })
      setQtd({}); setReposicao('')
    }
    try {
      ok(await supabase.from('contato_cliente').upsert(
        { semana_rota_id: rota.semana_rota_id, cliente_id: cliente.cliente_id, resultado: r, registrado_por: usuario!.id, registrado_em: new Date().toISOString() },
        { onConflict: 'semana_rota_id,cliente_id' }))
      setResultado(r)
      toast('Contato registrado')
      await carregarClientes(true)
    } catch (e: any) { toast(e.message, 'erro') }
  }

  function limpar() { setQtd({}); setReposicao('') }

  if (carregando) return <Carregando />
  if (!rotas.length) return <Vazio texto="Nenhuma rota disponível para você. Fale com o administrador." />

  const grupos = [...new Set(produtos.map((p) => p.grupo ?? 'OUTROS'))]

  return (
    <div className="mx-auto max-w-7xl">
      <Titulo>Venda semanal</Titulo>

      {/* Filtros */}
      <div className="card p-3 sm:p-4 mb-3 grid gap-3 sm:grid-cols-[1fr_1fr_1fr]">
        <Campo label="Rota">
          <select className="input" value={rotaId ?? ''} onChange={(e) => setRotaId(Number(e.target.value))}>
            {rotas.map((r) => <option key={r.rota_id} value={r.rota_id}>{r.rota} — {fmtData(r.data_entrega)}</option>)}
          </select>
        </Campo>
        <Campo label="Buscar cliente">
          <input className="input" placeholder="nome, cidade, contato…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </Campo>
        <Campo label="Pedido na semana">
          <select className="input" value={filtro} onChange={(e) => setFiltro(e.target.value as FiltroStatus)}>
            {Object.entries(FILTROS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Campo>
        {rota && (
          <div className="sm:col-span-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600">
            <span>Semana: <b>{fmtData(rota.data_entrega)}</b></span>
            <span>Distribuição: <b>{rota.cidade_distribuicao}</b></span>
            <span>Vendedor: <b>{rota.vendedor ?? '—'}</b> {rota.vendedor_telefone}</span>
            <span>Clientes: <b>{filtrados.length}</b> de {clientes.length}</span>
          </div>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-[340px_1fr]">
        {/* Lista de clientes */}
        <div className={`card overflow-hidden ${cliente && !mostrarLista ? 'hidden lg:block' : ''}`}>
          <div className="max-h-[60vh] lg:max-h-[calc(100vh-260px)] overflow-auto divide-y divide-slate-100">
            {filtrados.length === 0 && <Vazio texto="Nenhum cliente com esse filtro" />}
            {filtrados.map((c) => (
              <button key={c.cliente_id} onClick={() => { setClienteId(c.cliente_id); setMostrarLista(false) }}
                className={`w-full text-left px-3 py-2.5 hover:bg-leaf-50 ${c.cliente_id === clienteId ? 'bg-leaf-100' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-800 truncate"><span className="text-slate-400 text-xs mr-1">{c.ordem_visita}.</span>{c.razao_social}</div>
                    <div className="text-xs text-slate-500 truncate">{c.nome_fantasia} · {c.cidade} · {c.contato}</div>
                  </div>
                  <div className="text-right shrink-0">
                    {c.pedido_id ? <Chip cor="verde">{fmtMoeda(c.total)}</Chip> : c.resultado ? <Chip cor={corStatus(c.resultado)}>{c.resultado === 'SEM_INTERESSE' ? 'sem interesse' : c.resultado === 'SEM_CONTATO' ? 'sem contato' : 'religar'}</Chip> : null}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Painel do cliente */}
        <div className={`${!cliente || (cliente && mostrarLista) ? 'hidden lg:block' : ''}`}>
          {!cliente ? <div className="card"><Vazio texto="Escolha um cliente na lista" /></div> : (
            <div className="space-y-3">
              <button className="lg:hidden btn-secondary" onClick={() => setMostrarLista(true)}>← Lista de clientes</button>

              {/* Dados do cliente */}
              <div className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-lg font-extrabold text-leaf-900">{cliente.razao_social}</div>
                    <div className="text-sm text-slate-600">{cliente.nome_fantasia} · Cód. {cliente.codigo}</div>
                  </div>
                  <Chip cor={cliente.forma_pagamento === 'BOLETO' ? 'azul' : cliente.forma_pagamento === 'ANTECIPADO' ? 'verde' : 'amarelo'}>{FORMAS[cliente.forma_pagamento]}</Chip>
                </div>
                <div className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  <div><span className="text-slate-500">Cidade:</span> {cliente.cidade}</div>
                  <div><span className="text-slate-500">Contato:</span> {cliente.contato} {cliente.telefone && <a className="text-leaf-700 font-semibold" href={`tel:${cliente.telefone}`}>{cliente.telefone}</a>}</div>
                  <div className="sm:col-span-2"><span className="text-slate-500">Local de entrega:</span> {cliente.local_entrega}</div>
                </div>
                {pendencia && Number(pendencia.valor_pendente) > 0 && (
                  <div className="mt-3 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800">
                    <b>Pendência: {fmtMoeda(Number(pendencia.valor_pendente))}</b>
                    <div className="text-xs">Semanas: {pendencia.semanas.map(fmtData).join(' | ')}</div>
                  </div>
                )}
              </div>

              {/* Últimos pedidos */}
              {ultimos.length > 0 && (
                <div className="card p-4">
                  <div className="label">Últimos pedidos</div>
                  <div className="overflow-auto">
                    <table className="w-full text-xs">
                      <tbody>
                        {ultimos.map((u) => (
                          <tr key={u.pedido_id} className="border-t border-slate-100">
                            <td className="py-1 pr-3 whitespace-nowrap font-semibold">{fmtData(u.data_entrega)}</td>
                            <td className="py-1 pr-3 text-slate-600">{(u.itens as any[]).map((i) => `${i.sigla} ${i.quantidade}`).join(' · ')}{u.reposicao ? ` · R ${u.reposicao}` : ''}</td>
                            <td className="py-1 text-right whitespace-nowrap font-semibold">{fmtMoeda(Number(u.total))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Grade de produtos */}
              <div className="card p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="label mb-0">Pedido da semana {rota && fmtData(rota.data_entrega)}</div>
                  <div className="text-lg font-extrabold text-leaf-800">{fmtMoeda(total)}</div>
                </div>
                <div className="grid gap-x-6 gap-y-1 md:grid-cols-2 xl:grid-cols-3">
                  {grupos.map((g) => (
                    <div key={g}>
                      <div className="mt-2 mb-1 text-xs font-bold uppercase tracking-wide text-leaf-700">{g}</div>
                      {produtos.filter((p) => (p.grupo ?? 'OUTROS') === g).map((p) => {
                        const preco = precos[p.id]
                        const temPreco = preco != null
                        return (
                          <div key={p.id} className={`flex items-center gap-2 py-0.5 ${temPreco ? '' : 'opacity-40'}`}>
                            <input type="number" inputMode="numeric" min={0} step={1}
                              className="input w-20 px-2 py-1.5 text-center font-semibold"
                              disabled={!temPreco} value={qtd[p.id] ?? ''}
                              onChange={(e) => setQtd({ ...qtd, [p.id]: e.target.value })} />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium truncate"><span className="text-slate-400 mr-1">{p.sigla}</span>{p.nome}</div>
                            </div>
                            <div className="text-xs text-slate-500 w-16 text-right">{temPreco ? fmtMoeda(preco) : '—'}</div>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                  <div>
                    <div className="mt-2 mb-1 text-xs font-bold uppercase tracking-wide text-leaf-700">Reposição</div>
                    <div className="flex items-center gap-2 py-0.5">
                      <input type="number" inputMode="numeric" min={0} className="input w-20 px-2 py-1.5 text-center font-semibold" value={reposicao} onChange={(e) => setReposicao(e.target.value)} />
                      <div className="text-sm font-medium"><span className="text-slate-400 mr-1">R</span>Reposição (sem valor)</div>
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2 justify-end">
                  <button className="btn-secondary" onClick={limpar}>Limpar campos</button>
                  {cliente.pedido_id && <button className="btn-danger" onClick={() => setConfirmaExcluir(true)}>Excluir pedido</button>}
                  <button className="btn-primary px-6" onClick={salvarPedido} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar pedido'}</button>
                </div>
              </div>

              {/* Contato */}
              <div className="card p-4">
                <div className="label">Resultado do contato</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(Object.keys(RESULTADOS) as Resultado[]).filter((r) => r !== 'PEDIDO').map((r) => (
                    <button key={r} onClick={() => registrarContato(r)}
                      className={`rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition ${resultado === r ? 'border-leaf-600 bg-leaf-50 text-leaf-900' : 'border-slate-200 hover:bg-slate-50'}`}>
                      {resultado === r ? '✔ ' : ''}{RESULTADOS[r]}
                    </button>
                  ))}
                  <div className={`rounded-lg border px-3 py-2.5 text-sm font-medium ${resultado === 'PEDIDO' ? 'border-leaf-600 bg-leaf-50 text-leaf-900' : 'border-slate-200 text-slate-400'}`}>
                    {resultado === 'PEDIDO' ? '✔ ' : ''}{RESULTADOS.PEDIDO} <span className="text-xs">(automático ao salvar)</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <Confirmar aberto={confirmaExcluir} titulo="Excluir pedido" perigo
        texto={`Excluir o pedido de ${cliente?.razao_social} desta semana?`} onSim={excluirPedido} onNao={() => setConfirmaExcluir(false)} />
    </div>
  )
}
