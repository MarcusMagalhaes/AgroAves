// Monta o mapa de entrega de uma rota/semana: clientes na ordem de visita × produtos
import { supabase, ok } from './supabase'
import type { PedidoItem, PedidoView, Produto } from './types'

export interface LinhaMapa {
  pedido: PedidoView
  item: number
  qtd: Record<number, number>   // produto_id -> quantidade
  precos: Record<number, number>
}

export async function montarMapa(semanaRotaId: number, produtos: Produto[]) {
  const pedidos = ok(await supabase.from('v_pedido').select('*').eq('semana_rota_id', semanaRotaId).neq('status', 'EXCLUIDO')
    .order('ordem_visita')) as PedidoView[]
  const ids = pedidos.map((p) => p.id)
  const itens = ids.length ? ok(await supabase.from('pedido_item').select('*').in('pedido_id', ids)) as PedidoItem[] : []
  const porPedido: Record<number, PedidoItem[]> = {}
  for (const i of itens) (porPedido[i.pedido_id] ??= []).push(i)
  const linhas: LinhaMapa[] = pedidos.map((p, idx) => ({
    pedido: p, item: idx + 1,
    qtd: Object.fromEntries((porPedido[p.id] ?? []).map((i) => [i.produto_id, i.quantidade])),
    precos: Object.fromEntries((porPedido[p.id] ?? []).map((i) => [i.produto_id, Number(i.preco_unitario)])),
  }))
  const subtotal: Record<number, number> = {}
  for (const l of linhas) for (const [pid, q] of Object.entries(l.qtd)) subtotal[Number(pid)] = (subtotal[Number(pid)] ?? 0) + q
  const produtosUsados = produtos.filter((p) => (subtotal[p.id] ?? 0) > 0)
  const totalR = linhas.reduce((s, l) => s + l.pedido.reposicao, 0)
  const totalValor = linhas.reduce((s, l) => s + Number(l.pedido.total), 0)
  const porGrupo: Record<string, number> = {}
  for (const p of produtosUsados) porGrupo[p.grupo ?? 'OUTROS'] = (porGrupo[p.grupo ?? 'OUTROS'] ?? 0) + (subtotal[p.id] ?? 0)
  const totalAves = produtosUsados.filter((p) => p.conta_como_ave).reduce((s, p) => s + (subtotal[p.id] ?? 0), 0)
  return { linhas, subtotal, produtosUsados, totalR, totalValor, porGrupo, totalAves }
}
export type Mapa = Awaited<ReturnType<typeof montarMapa>>
