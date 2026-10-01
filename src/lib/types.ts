export type Papel = 'ADMIN' | 'VENDEDOR'
export type FormaPagamento = 'BOLETO' | 'ANTECIPADO' | 'A_VISTA'
export type Resultado = 'PEDIDO' | 'SEM_INTERESSE' | 'SEM_CONTATO' | 'INTERESSE_SEM_PEDIDO'

export const FORMAS: Record<FormaPagamento, string> = { BOLETO: 'Boleto', ANTECIPADO: 'Antecipado', A_VISTA: 'À vista' }
export const RESULTADOS: Record<Resultado, string> = {
  PEDIDO: 'Realizou pedido para esta semana',
  INTERESSE_SEM_PEDIDO: 'Demonstrou interesse mas sem pedido',
  SEM_INTERESSE: 'Realizamos contato mas não teve interesse',
  SEM_CONTATO: 'Sem sucesso no contato',
}
export const GRUPOS = ['CORTE', 'CAIPIRA', 'POSTURA', 'EXOTICOS', 'ACESSORIOS'] as const
export const COR_GRUPO: Record<string, string> = { CORTE: '#f5a623', CAIPIRA: '#3fb663', POSTURA: '#4a7fd6', EXOTICOS: '#a855f7', ACESSORIOS: '#94a3b8' }
export const corProduto = (p: { cor?: string | null; grupo?: string | null }) => p.cor || COR_GRUPO[p.grupo ?? ''] || '#cbd5e1'
/** Agrupa produtos consecutivos pela categoria (ordem do cadastro) */
export function gruposDeProdutos<T extends { grupo: string | null }>(produtos: T[]) {
  const out: { grupo: string; itens: T[] }[] = []
  for (const p of produtos) {
    const g = p.grupo ?? 'OUTROS'
    if (out.length && out[out.length - 1].grupo === g) out[out.length - 1].itens.push(p)
    else out.push({ grupo: g, itens: [p] })
  }
  return out
}

export interface Usuario { id: string; nome: string; email: string; papel: Papel; ativo: boolean }
export interface Vendedor { id: number; usuario_id: string | null; nome: string; telefone: string | null; ativo: boolean }
export interface Cidade { id: number; nome: string }
export interface Fornecedor { id: number; nome: string; ativo: boolean }
export interface Rota {
  id: number; nome: string; vendedor_id: number | null; cidade_distribuicao_id: number; intervalo_dias: number; ativa: boolean
}
export interface RotaSemana {
  rota_id: number; rota: string; vendedor_id: number | null; vendedor: string | null; vendedor_telefone: string | null
  cidade_distribuicao_id: number; cidade_distribuicao: string; intervalo_dias: number
  semana_rota_id: number | null; data_entrega: string | null; proxima_semana: string | null
}
export interface Cliente {
  id: number; codigo: number; codigo_externo: string | null; cnpj_cpf: string | null; razao_social: string
  nome_fantasia: string | null; endereco: string | null; cidade: string | null; contato: string | null; telefone: string | null
  local_entrega: string | null; exige_nf: boolean; exige_gta: boolean; forma_pagamento: FormaPagamento
  tipo: 'CLIENTE' | 'REPOSICAO'; observacao: string | null; ativo: boolean
}
export interface Produto {
  id: number; sigla: string; nome: string; grupo: string | null; ordem: number; preco_compra: number | null
  tem_preco: boolean; conta_como_ave: boolean; eh_codorna: boolean; ativo: boolean; cor: string | null
}
export interface PrecoCliente { cliente_id: number; produto_id: number; preco: number }
export interface ClienteRotaSemana {
  cliente_id: number; codigo: number; razao_social: string; nome_fantasia: string | null; cidade: string | null
  contato: string | null; telefone: string | null; local_entrega: string | null; forma_pagamento: FormaPagamento
  ordem_visita: number; resultado: Resultado | null; pedido_id: number | null; total: number | null; busca: string
}
export interface PedidoView {
  id: number; semana_rota_id: number; rota_id: number; rota: string; data_entrega: string; semana_status: string
  cliente_id: number | null; cliente_codigo: number | null; razao_social: string | null; nome_fantasia: string | null
  cidade: string | null; contato: string | null; telefone: string | null; local_entrega: string | null
  exige_nf: boolean | null; exige_gta: boolean | null; tipo: string; forma_pagamento: FormaPagamento | null
  cidade_distribuicao_id: number; cidade_distribuicao: string; reposicao: number; total: number; status: string
  observacao: string | null; criado_em: string; atualizado_em: string; ordem_visita: number
}
export interface PedidoItem { pedido_id: number; produto_id: number; quantidade: number; preco_unitario: number }
export interface Titulo {
  id: number; pedido_id: number | null; cliente_id: number; data_referencia: string; valor: number
  forma_pagamento: FormaPagamento; situacao: 'PENDENTE' | 'BAIXADO' | 'CANCELADO'; data_baixa: string | null
  motivo: string | null; criado_em: string
}
export interface PedidoFornecedor {
  id: number; data_entrega: string; cidade_distribuicao_id: number; fornecedor_id: number
  status: 'REGISTRADO' | 'CONFIRMADO' | 'ENTREGUE'; registrado_em: string; confirmado_em: string | null; observacao: string | null
}
export interface PedidoFornecedorItem {
  pedido_fornecedor_id: number; produto_id: number; qtd_programada: number; qtd_pedida: number; qtd_confirmada: number | null; observacao: string | null
}
