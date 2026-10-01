import { useEffect, useState } from 'react'
import { supabase, ok } from '@/lib/supabase'
import { listarFornecedores } from '@/lib/dados'
import type { Fornecedor } from '@/lib/types'
import { Campo, Carregando, Chip, Modal, Titulo, useToast } from '@/components/ui'

export default function Fornecedores() {
  const { toast } = useToast()
  const [lista, setLista] = useState<Fornecedor[] | null>(null)
  const [edit, setEdit] = useState<Partial<Fornecedor> | null>(null)
  const carregar = () => listarFornecedores().then(setLista).catch((e) => toast(e.message, 'erro'))
  useEffect(() => { carregar() }, [])
  async function salvar() {
    if (!edit?.nome) return
    try { ok(await supabase.from('fornecedor').upsert(edit)); toast('Fornecedor salvo'); setEdit(null); carregar() } catch (e: any) { toast(e.message, 'erro') }
  }
  if (!lista) return <Carregando />
  return (
    <div className="mx-auto max-w-2xl">
      <Titulo acoes={<button className="btn-primary" onClick={() => setEdit({ nome: '', ativo: true })}>+ Novo fornecedor</button>}>Fornecedores (granjas)</Titulo>
      <div className="card divide-y divide-slate-100">
        {lista.map((f) => (
          <div key={f.id} className="flex items-center justify-between p-3">
            <div className="font-semibold">{f.nome} {!f.ativo && <Chip cor="vermelho">inativo</Chip>}</div>
            <button className="btn-secondary py-1" onClick={() => setEdit(f)}>Editar</button>
          </div>
        ))}
      </div>
      <Modal aberto={!!edit} titulo="Fornecedor" onFechar={() => setEdit(null)} largura="max-w-md">
        {edit && (
          <div className="grid gap-3">
            <Campo label="Nome"><input className="input" value={edit.nome ?? ''} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} /></Campo>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!edit.ativo} onChange={(e) => setEdit({ ...edit, ativo: e.target.checked })} /> Ativo</label>
            <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setEdit(null)}>Cancelar</button><button className="btn-primary" onClick={salvar}>Salvar</button></div>
          </div>
        )}
      </Modal>
    </div>
  )
}
