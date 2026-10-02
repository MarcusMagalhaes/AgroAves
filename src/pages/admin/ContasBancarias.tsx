// Cadastro de contas bancárias (exclusivo do administrador TI): banco, apelido, agência e conta.
// Usado na importação do extrato (OFX) e no saldo bancário do dashboard financeiro.
import { useEffect, useState } from 'react'
import { supabase, ok } from '@/lib/supabase'
import { BANCOS, type ContaBancaria } from '@/lib/types'
import { Campo, Carregando, Chip, Modal, Titulo, Vazio, useToast } from '@/components/ui'

const OUTRO = 'outro'
type Edicao = Partial<ContaBancaria> & { escolha: string }

export default function ContasBancarias() {
  const { toast } = useToast()
  const [lista, setLista] = useState<ContaBancaria[] | null>(null)
  const [edit, setEdit] = useState<Edicao | null>(null)
  const carregar = async () => {
    try { setLista(ok(await supabase.from('conta_bancaria').select('*').order('ativo', { ascending: false }).order('apelido')) as ContaBancaria[]) }
    catch (e: any) { toast(e.message, 'erro') }
  }
  useEffect(() => { carregar() }, [])

  const escolhaDe = (c: Partial<ContaBancaria>) => BANCOS.some((b) => b.codigo === c.banco_codigo) ? c.banco_codigo! : (c.banco_codigo ? OUTRO : '')
  function escolherBanco(codigo: string) {
    if (!edit) return
    const b = BANCOS.find((x) => x.codigo === codigo)
    setEdit({ ...edit, escolha: codigo, banco_codigo: b?.codigo ?? '', banco_nome: b?.nome ?? '', apelido: edit.apelido || b?.nome || '' })
  }
  async function salvar() {
    if (!edit) return
    if (!edit.banco_codigo?.trim() || !edit.banco_nome?.trim()) { toast('Escolha o banco (ou informe código e nome)', 'erro'); return }
    if (!edit.apelido?.trim()) { toast('Informe um apelido para a conta', 'erro'); return }
    const dados = {
      banco_codigo: edit.banco_codigo.trim(), banco_nome: edit.banco_nome.trim(), apelido: edit.apelido.trim(),
      agencia: edit.agencia?.trim() || null, numero: edit.numero?.trim() || null, ativo: edit.ativo ?? true,
    }
    try {
      ok(edit.id ? await supabase.from('conta_bancaria').update(dados).eq('id', edit.id) : await supabase.from('conta_bancaria').insert(dados))
      toast('Conta bancária salva'); setEdit(null); carregar()
    } catch (e: any) { toast(e.message, 'erro') }
  }

  if (!lista) return <Carregando />
  return (
    <div className="mx-auto max-w-2xl">
      <Titulo acoes={<button className="btn-primary" onClick={() => setEdit({ escolha: '', ativo: true })}>+ Nova conta bancária</button>}>Contas bancárias</Titulo>
      <div className="card divide-y divide-slate-100">
        {!lista.length && <Vazio texto="Nenhuma conta cadastrada." />}
        {lista.map((c) => (
          <div key={c.id} className={`flex items-center justify-between gap-2 p-3 ${c.ativo ? '' : 'opacity-60'}`}>
            <div>
              <div className="font-semibold">🏦 {c.apelido} {!c.ativo && <Chip cor="cinza">inativa</Chip>}</div>
              <div className="text-xs text-slate-500">{c.banco_codigo} — {c.banco_nome}{c.agencia && ` · ag. ${c.agencia}`}{c.numero && ` · conta ${c.numero}`}</div>
            </div>
            <button className="btn-secondary py-1" onClick={() => setEdit({ ...c, escolha: escolhaDe(c) })}>Editar</button>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500">Agência e conta são opcionais, mas ajudam: na importação do OFX o sistema confere se o arquivo é mesmo desta conta.</p>

      <Modal aberto={!!edit} titulo={edit?.id ? 'Editar conta bancária' : 'Nova conta bancária'} onFechar={() => setEdit(null)} largura="max-w-lg">
        {edit && (
          <div className="grid gap-2 sm:grid-cols-2">
            <Campo label="Banco" className="sm:col-span-2">
              <select className="input" autoFocus value={edit.escolha} onChange={(e) => escolherBanco(e.target.value)}>
                <option value="">— escolha —</option>
                {BANCOS.map((b) => <option key={b.codigo} value={b.codigo}>{b.codigo} — {b.nome}</option>)}
                <option value={OUTRO}>Outro banco…</option>
              </select>
            </Campo>
            {edit.escolha === OUTRO && <>
              <Campo label="Código do banco"><input className="input" inputMode="numeric" value={edit.banco_codigo ?? ''} onChange={(e) => setEdit({ ...edit, banco_codigo: e.target.value.replace(/\D/g, '').slice(0, 3) })} /></Campo>
              <Campo label="Nome do banco"><input className="input" value={edit.banco_nome ?? ''} onChange={(e) => setEdit({ ...edit, banco_nome: e.target.value })} /></Campo>
            </>}
            <Campo label="Apelido (como aparece no sistema)" className="sm:col-span-2"><input className="input" placeholder="ex.: Sicoob movimento" value={edit.apelido ?? ''} onChange={(e) => setEdit({ ...edit, apelido: e.target.value })} /></Campo>
            <Campo label="Agência"><input className="input" value={edit.agencia ?? ''} onChange={(e) => setEdit({ ...edit, agencia: e.target.value })} /></Campo>
            <Campo label="Conta (com dígito)"><input className="input" value={edit.numero ?? ''} onChange={(e) => setEdit({ ...edit, numero: e.target.value })} /></Campo>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.ativo ?? true} onChange={(e) => setEdit({ ...edit, ativo: e.target.checked })} /> Ativa</label>
            <div className="sm:col-span-2 flex justify-end gap-2"><button className="btn-secondary" onClick={() => setEdit(null)}>Cancelar</button><button className="btn-primary" onClick={salvar}>Salvar</button></div>
          </div>
        )}
      </Modal>
    </div>
  )
}
