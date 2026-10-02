import { useEffect, useState } from 'react'
import { supabase, ok } from '@/lib/supabase'
import { PAPEIS, type Usuario, type Vendedor } from '@/lib/types'
import { Campo, Carregando, Chip, Modal, Titulo, useToast } from '@/components/ui'

/**
 * Usuários do sistema. Quem entra com Google (ou e-mail/senha) aparece aqui como "aguardando liberação".
 * Liberar como VENDEDOR exige dizer qual vendedor é (existente sem login, ou criar um novo): sem esse vínculo
 * o vendedor não vê rota nenhuma.
 */
export default function Usuarios() {
  const { toast } = useToast()
  const [lista, setLista] = useState<Usuario[] | null>(null)
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [edit, setEdit] = useState<Partial<Usuario> | null>(null)
  const [vinculo, setVinculo] = useState<{ usuario: Usuario; escolha: string; novoNome: string; novoTel: string } | null>(null)

  const carregar = async () => {
    try {
      setLista(ok(await supabase.from('usuario').select('*').order('ativo').order('nome')) as Usuario[])
      setVendedores(ok(await supabase.from('vendedor').select('*').order('nome')) as Vendedor[])
    } catch (e: any) { toast(e.message, 'erro') }
  }
  useEffect(() => { carregar() }, [])

  const vendedorDe = (u: Usuario) => vendedores.find((v) => v.usuario_id === u.id)

  async function salvar() {
    if (!edit?.id || !edit.nome || !edit.email) { toast('Preencha nome e e-mail', 'erro'); return }
    try {
      ok(await supabase.from('usuario').upsert({ id: edit.id, nome: edit.nome, email: edit.email, papel: edit.papel, ativo: edit.ativo }))
      toast('Usuário salvo'); setEdit(null); carregar()
    } catch (e: any) { toast(e.message, 'erro') }
  }

  async function liberarAdmin(u: Usuario) {
    try { ok(await supabase.from('usuario').update({ ativo: true, papel: 'ADMIN' }).eq('id', u.id)); toast(`${u.nome} liberado como administrador`); carregar() } catch (e: any) { toast(e.message, 'erro') }
  }

  // Libera como vendedor vinculando ao cadastro de vendedor escolhido (ou criando um novo)
  async function confirmarVinculo() {
    if (!vinculo) return
    const { usuario, escolha, novoNome, novoTel } = vinculo
    try {
      let vendedorId: number
      if (escolha === 'novo') {
        if (!novoNome.trim()) { toast('Informe o nome do vendedor', 'erro'); return }
        const v = ok(await supabase.from('vendedor').insert({ nome: novoNome.trim().toUpperCase(), telefone: novoTel || null, ativo: true, usuario_id: usuario.id }).select().single()) as Vendedor
        vendedorId = v.id
      } else {
        vendedorId = Number(escolha)
        if (!vendedorId) { toast('Escolha o vendedor correspondente a este usuário', 'erro'); return }
        // desvincula o usuário de outro vendedor, se houver, e vincula ao escolhido
        ok(await supabase.from('vendedor').update({ usuario_id: null }).eq('usuario_id', usuario.id))
        ok(await supabase.from('vendedor').update({ usuario_id: usuario.id }).eq('id', vendedorId))
      }
      ok(await supabase.from('usuario').update({ ativo: true, papel: 'VENDEDOR' }).eq('id', usuario.id))
      const v = vendedores.find((x) => x.id === vendedorId)
      toast(`${usuario.nome} liberado como vendedor${v ? ` (${v.nome})` : ''}. Confira as rotas dele em Cadastros › Rotas.`)
      setVinculo(null); carregar()
    } catch (e: any) { toast(e.message, 'erro') }
  }

  if (!lista) return <Carregando />
  const pendentes = lista.filter((u) => !u.ativo)
  const semVinculo = lista.filter((u) => u.ativo && u.papel === 'VENDEDOR' && !vendedorDe(u))
  const livres = vendedores.filter((v) => v.ativo && (!v.usuario_id || v.usuario_id === vinculo?.usuario.id))

  return (
    <div className="mx-auto max-w-4xl">
      <Titulo>Usuários</Titulo>
      <div className="card px-3 py-1.5 mb-1.5 text-xs text-slate-600">
        Peça à pessoa para abrir o site e clicar em <b>Entrar com Google</b>. Ela aparece abaixo como "aguardando liberação". Para liberar como <b>vendedor</b> é obrigatório dizer qual vendedor ela é (as rotas dela vêm do cadastro de Rotas).
      </div>
      {pendentes.length > 0 && (
        <div className="card p-3 mb-1.5 border-amber-300 bg-amber-50">
          <div className="font-bold text-amber-900 mb-1 text-xs">Aguardando liberação ({pendentes.length})</div>
          {pendentes.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-1 border-t border-amber-200 text-xs">
              <div><b>{u.nome}</b> <span className="text-slate-600">{u.email}</span></div>
              <div className="flex gap-1.5">
                <button className="btn-primary py-1" onClick={() => setVinculo({ usuario: u, escolha: '', novoNome: u.nome, novoTel: '' })}>Liberar como vendedor…</button>
                <button className="btn-secondary py-1" onClick={() => liberarAdmin(u)}>como administrador</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {semVinculo.length > 0 && (
        <div className="card p-3 mb-1.5 border-red-300 bg-red-50 text-xs">
          <div className="font-bold text-red-800 mb-1">Vendedores sem vínculo ({semVinculo.length}) — não enxergam nenhuma rota</div>
          {semVinculo.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-1 border-t border-red-200">
              <div><b>{u.nome}</b> <span className="text-slate-600">{u.email}</span></div>
              <button className="btn-accent py-1" onClick={() => setVinculo({ usuario: u, escolha: '', novoNome: u.nome, novoTel: '' })}>Vincular a um vendedor…</button>
            </div>
          ))}
        </div>
      )}
      <div className="card overflow-auto">
        <table className="tabela">
          <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Vendedor vinculado</th><th></th></tr></thead>
          <tbody>
            {lista.filter((u) => u.ativo).map((u) => {
              const v = vendedorDe(u)
              return (
                <tr key={u.id}>
                  <td className="font-semibold">{u.nome}</td>
                  <td>{u.email}</td>
                  <td><Chip cor={u.papel === 'VENDEDOR' ? 'verde' : 'azul'}>{PAPEIS[u.papel]}</Chip></td>
                  <td>{u.papel === 'VENDEDOR' ? (v ? v.nome : <span className="text-red-600 font-semibold">sem vínculo</span>) : <span className="text-slate-400">—</span>}</td>
                  <td className="text-right whitespace-nowrap">
                    {u.papel === 'VENDEDOR' && <button className="btn-secondary py-0.5 mr-1" onClick={() => setVinculo({ usuario: u, escolha: v ? String(v.id) : '', novoNome: u.nome, novoTel: '' })}>Vendedor…</button>}
                    {u.papel === 'ADMIN_TI'
                      ? <span className="text-slate-400 text-[11px]" title="Conta exclusiva da TI: não pode ser alterada pela aplicação">🔒 protegido</span>
                      : <button className="btn-secondary py-0.5" onClick={() => setEdit(u)}>Editar</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* vínculo usuário ↔ vendedor */}
      <Modal aberto={!!vinculo} titulo={vinculo ? `Qual vendedor é ${vinculo.usuario.nome} (${vinculo.usuario.email})?` : ''} onFechar={() => setVinculo(null)} largura="max-w-lg">
        {vinculo && (
          <div className="grid gap-3 text-xs">
            <div className="grid gap-1.5">
              {livres.map((v) => (
                <label key={v.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer ${vinculo.escolha === String(v.id) ? 'border-leaf-600 bg-leaf-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <input type="radio" name="vend" checked={vinculo.escolha === String(v.id)} onChange={() => setVinculo({ ...vinculo, escolha: String(v.id) })} />
                  <span className="font-semibold">{v.nome}</span><span className="text-slate-500">{v.telefone}</span>
                  {v.usuario_id === vinculo.usuario.id && <Chip cor="verde">vínculo atual</Chip>}
                </label>
              ))}
              {livres.length === 0 && <div className="text-slate-500">Todos os vendedores cadastrados já têm login. Crie um novo abaixo.</div>}
              <label className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer ${vinculo.escolha === 'novo' ? 'border-leaf-600 bg-leaf-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                <input type="radio" name="vend" checked={vinculo.escolha === 'novo'} onChange={() => setVinculo({ ...vinculo, escolha: 'novo' })} />
                <span className="font-semibold">Criar um vendedor novo para esta pessoa</span>
              </label>
              {vinculo.escolha === 'novo' && (
                <div className="grid gap-2 sm:grid-cols-2 pl-6">
                  <Campo label="Nome do vendedor"><input className="input" value={vinculo.novoNome} onChange={(e) => setVinculo({ ...vinculo, novoNome: e.target.value })} /></Campo>
                  <Campo label="Telefone (sai no recibo)"><input className="input" value={vinculo.novoTel} onChange={(e) => setVinculo({ ...vinculo, novoTel: e.target.value })} /></Campo>
                </div>
              )}
            </div>
            <div className="text-[11px] text-slate-500">Depois, confira em <b>Cadastros › Rotas</b> quais rotas apontam para esse vendedor: são as únicas que ele verá.</div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setVinculo(null)}>Cancelar</button>
              <button className="btn-primary" disabled={!vinculo.escolha} onClick={confirmarVinculo}>{vinculo.usuario.ativo ? 'Salvar vínculo' : 'Liberar como vendedor'}</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal aberto={!!edit} titulo="Usuário" onFechar={() => setEdit(null)} largura="max-w-md">
        {edit && (
          <div className="grid gap-3">
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
