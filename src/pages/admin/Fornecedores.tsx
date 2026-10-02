import { useEffect, useState } from 'react'
import { supabase, ok } from '@/lib/supabase'
import { listarFornecedores } from '@/lib/dados'
import { useAuth } from '@/lib/auth'
import { TIPOS_FORNECEDOR, ehAdminTI, type Fornecedor, type TipoFornecedor } from '@/lib/types'
import { Campo, Carregando, Chip, Modal, Titulo, useToast } from '@/components/ui'

/**
 * Tipo (exclusivo do administrador TI): Produto para venda (granja) aparece no Pedido à granja; todos aparecem no Contas a pagar.
 * Os demais administradores só veem e cadastram fornecedores de produto para venda (garantido também pelo RLS).
 */
const COR_TIPO: Record<TipoFornecedor, 'verde' | 'azul' | 'amarelo'> = { PRODUTO_VENDA: 'verde', MATERIAL: 'azul', CONSUMO: 'amarelo' }

export default function Fornecedores() {
  const { toast } = useToast()
  const ti = ehAdminTI(useAuth().usuario)
  const [lista, setLista] = useState<Fornecedor[] | null>(null)
  const [edit, setEdit] = useState<Partial<Fornecedor> | null>(null)
  const [filtroTipo, setFiltroTipo] = useState<'' | TipoFornecedor>('')
  const carregar = () => listarFornecedores().then(setLista).catch((e) => toast(e.message, 'erro'))
  useEffect(() => { carregar() }, [])
  async function salvar() {
    if (!edit?.nome?.trim()) { toast('Informe o nome', 'erro'); return }
    if (ti && !edit.tipo) { toast('Escolha o tipo do fornecedor', 'erro'); return }
    try { ok(await supabase.from('fornecedor').upsert({ ...edit, nome: edit.nome.trim(), tipo: ti ? edit.tipo : 'PRODUTO_VENDA' })); toast('Fornecedor salvo'); setEdit(null); carregar() } catch (e: any) { toast(e.message, 'erro') }
  }
  if (!lista) return <Carregando />
  const visiveis = lista.filter((f) => !filtroTipo || f.tipo === filtroTipo)
  return (
    <div className="mx-auto max-w-2xl">
      <Titulo acoes={<>
        {ti && <select className="input w-auto py-1" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value as '' | TipoFornecedor)}>
          <option value="">Todos os tipos</option>
          {Object.entries(TIPOS_FORNECEDOR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>}
        <button className="btn-primary" onClick={() => setEdit({ nome: '', ativo: true })}>+ Novo fornecedor</button>
      </>}>Fornecedores</Titulo>
      <div className="card divide-y divide-slate-100">
        {visiveis.map((f) => (
          <div key={f.id} className="flex items-center justify-between gap-2 p-3">
            <div className="font-semibold">{f.nome} {!f.ativo && <Chip cor="vermelho">inativo</Chip>}</div>
            <div className="flex items-center gap-2">
              {ti && <Chip cor={COR_TIPO[f.tipo]}>{TIPOS_FORNECEDOR[f.tipo]}</Chip>}
              <button className="btn-secondary py-1" onClick={() => setEdit(f)}>Editar</button>
            </div>
          </div>
        ))}
      </div>
      <Modal aberto={!!edit} titulo="Fornecedor" onFechar={() => setEdit(null)} largura="max-w-lg">
        {edit && (
          <div className="grid gap-2 sm:grid-cols-2">
            <Campo label="Nome" className="sm:col-span-2"><input className="input" autoFocus value={edit.nome ?? ''} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} /></Campo>
            {ti && <Campo label="Tipo">
              <select className="input" value={edit.tipo ?? ''} onChange={(e) => setEdit({ ...edit, tipo: (e.target.value || undefined) as TipoFornecedor | undefined })}>
                <option value="">— escolha —</option>
                {Object.entries(TIPOS_FORNECEDOR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Campo>}
            <label className={`flex items-center gap-2 text-sm ${ti ? 'sm:mt-5' : ''}`}><input type="checkbox" checked={!!edit.ativo} onChange={(e) => setEdit({ ...edit, ativo: e.target.checked })} /> Ativo</label>
            {ti && <p className="sm:col-span-2 text-xs text-slate-500">Só fornecedores de <b>Produto para venda</b> aparecem no Pedido à granja. Todos aparecem no Contas a pagar.</p>}
            <div className="sm:col-span-2 flex justify-end gap-2"><button className="btn-secondary" onClick={() => setEdit(null)}>Cancelar</button><button className="btn-primary" onClick={salvar}>Salvar</button></div>
          </div>
        )}
      </Modal>
    </div>
  )
}
