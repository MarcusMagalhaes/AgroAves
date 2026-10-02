// Acesso a dados compartilhado entre telas
import { supabase, ok } from './supabase'
import type { CentroCusto, Cidade, Cliente, Fornecedor, PrecoCliente, Produto, Rota, RotaSemana, Vendedor } from './types'

export const listarProdutos = async (soAtivos = true) => {
  let q = supabase.from('produto').select('*').order('ordem')
  if (soAtivos) q = q.eq('ativo', true)
  return ok(await q) as Produto[]
}
export const listarRotasSemana = async () =>
  ok(await supabase.from('v_rota_semana_aberta').select('*').order('rota')) as RotaSemana[]
export const listarRotas = async () => ok(await supabase.from('rota').select('*').order('nome')) as Rota[]
export const listarCidades = async () => ok(await supabase.from('cidade_distribuicao').select('*').order('nome')) as Cidade[]
export const listarVendedores = async () => ok(await supabase.from('vendedor').select('*').order('nome')) as Vendedor[]
export const listarFornecedores = async () => ok(await supabase.from('fornecedor').select('*').order('nome')) as Fornecedor[]
export const listarCentrosCusto = async () =>
  ok(await supabase.from('centro_custo').select('*').order('codigo')) as CentroCusto[]
export const listarClientes = async () =>
  ok(await supabase.from('cliente').select('*').order('razao_social')) as Cliente[]
export const precosDoCliente = async (clienteId: number) =>
  ok(await supabase.from('preco_cliente').select('*').eq('cliente_id', clienteId)) as PrecoCliente[]

export const itensDoPedido = async (pedidoId: number) =>
  ok(await supabase.from('pedido_item').select('*').eq('pedido_id', pedidoId)) as { produto_id: number; quantidade: number; preco_unitario: number }[]

export const rpc = async <T = unknown>(fn: string, args: Record<string, unknown>) => ok(await supabase.rpc(fn, args)) as T
