import { useEffect, useState } from 'react'
import { supabase, ok } from '@/lib/supabase'
import { listarVendedores } from '@/lib/dados'
import type { Usuario, Vendedor } from '@/lib/types'
import { Campo, Carregando, Chip, Modal, Titulo, useToast } from '@/components/ui'

export default function Vendedores() {
  const { toast } = useToast()
  const [lista, setLista] = useState<Vendedor[] | null>(null)
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [edit, setEdit] = useState<Partial<Vendedor> | null>(null)

  const carregar = async () => {
    try {
      setLista(await listarVendedores())
      setUsuarios(ok(await supabase.from('usuario').select('*').order('nome')) as Usuario[])
    } catch (e: any) { toast(e.message, 'erro') }
  }
  useEffect(() => { carregar() }, [])

  async function salvar() {
    if (!edit?.nome) { toast('Nome obrigatório', 'erro'); return }
    try { ok(await supabase.from('vendedor').upsert({ ...edit, usuario_id: edit.usuario_id || null })); toast('Vendedor salvo'); setEdit(null); carregar() }
    catch (e: any) { toast(e.message, 'erro') }
  }

  if (!lista) return <Carregando />
  return (
    <div className="mx-auto max-w-3xl">
      <Titulo acoes={<button className="btn-primary" onClick={() => setEdit({ nome: '', telefone: '', ativo: true, usuario_id: null })}>+ Novo vendedor</button>}>Vendedores</Titulo>
      <div className="card overflow-auto">
        <table className="tabela">
          <thead><tr><th className="px-2">Nome</th><th className="px-2">Telefone</th><th className="px-2">Usuário (login)</th><th className="px-2"></th></tr></thead>
          <tbody>
            {lista.map((v) => (
              <tr key={v.id} className={`border-t border-slate-100 ${v.ativo ? '' : 'opacity-50'}`}>
                <td className="font-semibold">{v.nome} {!v.ativo && <Chip cor="vermelho">inativo</Chip>}</td>
                <td className="px-2">{v.telefone}</td>
                <td className="text-slate-600">{usuarios.find((u) => u.id === v.usuario_id)?.email ?? <span className="text-amber-600">sem login</span>}</td>
                <td className="text-right"><button className="btn-secondary py-1" onClick={() => setEdit(v)}>Editar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal aberto={!!edit} titulo={edit?.id ? 'Editar vendedor' : 'Novo vendedor'} onFechar={() => setEdit(null)}>
        {edit && (
          <div className="grid gap-2 sm:grid-cols-3">
            <Campo label="Nome"><input className="input" value={edit.nome ?? ''} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} /></Campo>
            <Campo label="Telefone (sai nos recibos)"><input className="input" value={edit.telefone ?? ''} onChange={(e) => setEdit({ ...edit, telefone: e.target.value })} /></Campo>
            <Campo label="Usuário de login">
              <select className="input" value={edit.usuario_id ?? ''} onChange={(e) => setEdit({ ...edit, usuario_id: e.target.value || null })}>
                <option value="">— sem login —</option>
                {usuarios.filter((u) => u.papel === 'VENDEDOR').map((u) => <option key={u.id} value={u.id}>{u.nome} ({u.email})</option>)}
              </select>
              <p className="text-xs text-slate-500 mt-1">Crie o usuário em "Usuários" com papel Vendedor e vincule aqui. O vendedor só vê as rotas em que está cadastrado.</p>
            </Campo>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!edit.ativo} onChange={(e) => setEdit({ ...edit, ativo: e.target.checked })} /> Ativo</label>
            <div className="flex justify-end gap-2 pt-2"><button className="btn-secondary" onClick={() => setEdit(null)}>Cancelar</button><button className="btn-primary" onClick={salvar}>Salvar</button></div>
          </div>
        )}
      </Modal>
    </div>
  )
}
