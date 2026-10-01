import { useEffect, useState } from 'react'
import { supabase, ok } from '@/lib/supabase'
import type { Usuario } from '@/lib/types'
import { Campo, Carregando, Chip, Modal, Titulo, useToast } from '@/components/ui'

/**
 * Usuários do sistema. Quem entra com Google (ou e-mail/senha) aparece aqui automaticamente como
 * "aguardando liberação"; o administrador define o papel e ativa. Vendedor ainda precisa ser vinculado
 * em "Vendedores" para ver suas rotas.
 */
export default function Usuarios() {
  const { toast } = useToast()
  const [lista, setLista] = useState<Usuario[] | null>(null)
  const [edit, setEdit] = useState<Partial<Usuario> | null>(null)
  const carregar = () => supabase.from('usuario').select('*').order('ativo').order('nome').then((r) => setLista(ok(r) as Usuario[]))
  useEffect(() => { carregar() }, [])

  async function salvar() {
    if (!edit?.id || !edit.nome || !edit.email) { toast('Preencha nome e e-mail', 'erro'); return }
    try { ok(await supabase.from('usuario').upsert(edit)); toast('Usuário salvo'); setEdit(null); carregar() } catch (e: any) { toast(e.message, 'erro') }
  }
  async function liberar(u: Usuario, papel: Usuario['papel']) {
    try { ok(await supabase.from('usuario').update({ ativo: true, papel }).eq('id', u.id)); toast(`${u.nome} liberado como ${papel === 'ADMIN' ? 'administrador' : 'vendedor'}`); carregar() } catch (e: any) { toast(e.message, 'erro') }
  }

  if (!lista) return <Carregando />
  const pendentes = lista.filter((u) => !u.ativo)
  return (
    <div className="mx-auto max-w-3xl">
      <Titulo>Usuários</Titulo>
      <div className="card px-3 py-1.5 mb-1.5 text-xs text-slate-600">
        Peça à pessoa para abrir o site e clicar em <b>Entrar com Google</b>. Ela aparece abaixo como "aguardando liberação"; escolha o papel para liberar.
        Para vendedor, depois vincule em <b>Vendedores</b>.
      </div>
      {pendentes.length > 0 && (
        <div className="card p-3 mb-3 border-amber-300 bg-amber-50">
          <div className="font-bold text-amber-900 mb-2">Aguardando liberação ({pendentes.length})</div>
          {pendentes.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 border-t border-amber-200 text-sm">
              <div><b>{u.nome}</b> <span className="text-slate-600">{u.email}</span></div>
              <div className="flex gap-2">
                <button className="btn-primary py-1" onClick={() => liberar(u, 'VENDEDOR')}>Liberar como vendedor</button>
                <button className="btn-secondary py-1" onClick={() => liberar(u, 'ADMIN')}>como administrador</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="card overflow-auto">
        <table className="tabela">
          <thead><tr><th className="px-2">Nome</th><th className="px-2">E-mail</th><th className="px-2">Papel</th><th className="px-2"></th></tr></thead>
          <tbody>
            {lista.filter((u) => u.ativo).map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="font-semibold">{u.nome}</td>
                <td className="px-2">{u.email}</td>
                <td className="px-2"><Chip cor={u.papel === 'ADMIN' ? 'azul' : 'verde'}>{u.papel === 'ADMIN' ? 'Administrador' : 'Vendedor'}</Chip></td>
                <td className="text-right"><button className="btn-secondary py-1" onClick={() => setEdit(u)}>Editar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal aberto={!!edit} titulo="Usuário" onFechar={() => setEdit(null)}>
        {edit && (
          <div className="grid gap-2 sm:grid-cols-3">
            <Campo label="Nome"><input className="input" value={edit.nome ?? ''} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} /></Campo>
            <Campo label="E-mail"><input className="input" value={edit.email ?? ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Campo>
            <Campo label="Papel">
              <select className="input" value={edit.papel} onChange={(e) => setEdit({ ...edit, papel: e.target.value as any })}>
                <option value="ADMIN">Administrador</option><option value="VENDEDOR">Vendedor</option>
              </select>
            </Campo>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!edit.ativo} onChange={(e) => setEdit({ ...edit, ativo: e.target.checked })} /> Ativo (desmarcar bloqueia o acesso)</label>
            <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setEdit(null)}>Cancelar</button><button className="btn-primary" onClick={salvar}>Salvar</button></div>
          </div>
        )}
      </Modal>
    </div>
  )
}
