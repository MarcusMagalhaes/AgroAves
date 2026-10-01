import { useEffect, useState } from 'react'
import { supabase, ok } from '@/lib/supabase'
import type { Usuario } from '@/lib/types'
import { Campo, Carregando, Chip, Modal, Titulo, useToast } from '@/components/ui'

/**
 * Usuários do sistema. A criação do login (e-mail + senha) é feita no painel do Supabase
 * (Authentication > Users > Add user) ou via convite; aqui vinculamos o UUID ao nome e papel.
 */
export default function Usuarios() {
  const { toast } = useToast()
  const [lista, setLista] = useState<Usuario[] | null>(null)
  const [edit, setEdit] = useState<Partial<Usuario> | null>(null)
  const carregar = () => supabase.from('usuario').select('*').order('nome').then((r) => setLista(ok(r) as Usuario[]))
  useEffect(() => { carregar() }, [])

  async function salvar() {
    if (!edit?.id || !edit.nome || !edit.email) { toast('Preencha UUID, nome e e-mail', 'erro'); return }
    try { ok(await supabase.from('usuario').upsert(edit)); toast('Usuário salvo'); setEdit(null); carregar() } catch (e: any) { toast(e.message, 'erro') }
  }
  if (!lista) return <Carregando />
  return (
    <div className="mx-auto max-w-3xl">
      <Titulo acoes={<button className="btn-primary" onClick={() => setEdit({ id: '', nome: '', email: '', papel: 'VENDEDOR', ativo: true })}>+ Vincular usuário</button>}>Usuários</Titulo>
      <div className="card p-3 mb-3 text-sm text-slate-600">
        1) Crie o login em <b>Supabase › Authentication › Users › Add user</b> (e-mail e senha). 2) Copie o <b>UUID</b> do usuário criado. 3) Clique em "Vincular usuário", cole o UUID, informe nome e papel.
      </div>
      <div className="card overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Nome</th><th className="p-2">E-mail</th><th className="p-2">Papel</th><th className="p-2"></th></tr></thead>
          <tbody>
            {lista.map((u) => (
              <tr key={u.id} className={`border-t border-slate-100 ${u.ativo ? '' : 'opacity-50'}`}>
                <td className="p-2 font-semibold">{u.nome}</td>
                <td className="p-2">{u.email}</td>
                <td className="p-2"><Chip cor={u.papel === 'ADMIN' ? 'azul' : 'verde'}>{u.papel === 'ADMIN' ? 'Administrador' : 'Vendedor'}</Chip> {!u.ativo && <Chip cor="vermelho">inativo</Chip>}</td>
                <td className="p-2 text-right"><button className="btn-secondary py-1" onClick={() => setEdit(u)}>Editar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal aberto={!!edit} titulo="Usuário" onFechar={() => setEdit(null)} largura="max-w-md">
        {edit && (
          <div className="grid gap-3">
            <Campo label="UUID (Supabase Auth)"><input className="input font-mono text-xs" value={edit.id ?? ''} onChange={(e) => setEdit({ ...edit, id: e.target.value.trim() })} disabled={!!lista.find((u) => u.id === edit.id)} /></Campo>
            <Campo label="Nome"><input className="input" value={edit.nome ?? ''} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} /></Campo>
            <Campo label="E-mail"><input className="input" value={edit.email ?? ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Campo>
            <Campo label="Papel">
              <select className="input" value={edit.papel} onChange={(e) => setEdit({ ...edit, papel: e.target.value as any })}>
                <option value="ADMIN">Administrador</option><option value="VENDEDOR">Vendedor</option>
              </select>
            </Campo>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!edit.ativo} onChange={(e) => setEdit({ ...edit, ativo: e.target.checked })} /> Ativo</label>
            <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setEdit(null)}>Cancelar</button><button className="btn-primary" onClick={salvar}>Salvar</button></div>
          </div>
        )}
      </Modal>
    </div>
  )
}
