import { useEffect, useState } from 'react'
import { supabase, ok } from '@/lib/supabase'
import { listarProdutos } from '@/lib/dados'
import { GRUPOS, corProduto, type Produto } from '@/lib/types'
import { fmtMoeda } from '@/lib/format'
import { Campo, Carregando, Chip, Modal, Titulo, useToast } from '@/components/ui'

const vazio: Partial<Produto> = { sigla: '', nome: '', grupo: 'CAIPIRA', ordem: 99, preco_compra: null, tem_preco: true, conta_como_ave: true, eh_codorna: false, ativo: true, cor: null }

export default function Produtos() {
  const { toast } = useToast()
  const [lista, setLista] = useState<Produto[] | null>(null)
  const [edit, setEdit] = useState<Partial<Produto> | null>(null)

  const carregar = () => listarProdutos(false).then(setLista).catch((e) => toast(e.message, 'erro'))
  useEffect(() => { carregar() }, [])

  async function salvar() {
    if (!edit?.sigla || !edit.nome) { toast('Sigla e nome são obrigatórios', 'erro'); return }
    try {
      const reg = { ...edit, sigla: edit.sigla.trim().toUpperCase(), preco_compra: edit.preco_compra === ('' as any) ? null : edit.preco_compra }
      ok(await supabase.from('produto').upsert(reg))
      toast('Produto salvo'); setEdit(null); carregar()
    } catch (e: any) { toast(e.message, 'erro') }
  }

  if (!lista) return <Carregando />
  return (
    <div className="mx-auto max-w-5xl">
      <Titulo acoes={<button className="btn-primary" onClick={() => setEdit({ ...vazio, ordem: lista.length + 1 })}>+ Novo produto</button>}>Produtos</Titulo>
      <div className="card overflow-auto">
        <table className="tabela">
          <thead>
            <tr><th className="px-2">#</th><th className="px-2">Sigla</th><th className="px-2">Nome</th><th className="px-2">Grupo</th><th className="text-right">Preço compra</th><th className="text-center">Conta como ave (GTA)</th><th className="text-center">Codorna</th><th className="text-center">Situação</th><th className="px-2"></th></tr>
          </thead>
          <tbody>
            {lista.map((p) => (
              <tr key={p.id} className={`border-t border-slate-100 ${p.ativo ? '' : 'opacity-50'}`}>
                <td className="text-slate-400">{p.ordem}</td>
                <td className="font-bold"><span className="inline-block w-3 h-3 rounded-sm mr-1.5 align-middle border border-black/10" style={{ background: corProduto(p) }} />{p.sigla}</td>
                <td className="px-2">{p.nome}</td>
                <td className="px-2">{p.grupo}</td>
                <td className="text-right">{p.preco_compra != null ? fmtMoeda(p.preco_compra) : '—'}</td>
                <td className="text-center">{p.conta_como_ave ? 'Sim' : <span className="text-slate-400">Não</span>}</td>
                <td className="text-center">{p.eh_codorna ? 'Sim' : <span className="text-slate-400">—</span>}</td>
                <td className="text-center">{p.ativo ? <Chip cor="verde">ativo</Chip> : <Chip cor="vermelho">inativo</Chip>}</td>
                <td className="text-right"><button className="btn-secondary py-1" onClick={() => setEdit(p)}>Editar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal aberto={!!edit} titulo={edit?.id ? 'Editar produto' : 'Novo produto'} onFechar={() => setEdit(null)} largura="max-w-lg">
        {edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label="Sigla"><input className="input" value={edit.sigla ?? ''} onChange={(e) => setEdit({ ...edit, sigla: e.target.value })} /></Campo>
            <Campo label="Ordem"><input className="input" type="number" value={edit.ordem ?? ''} onChange={(e) => setEdit({ ...edit, ordem: Number(e.target.value) })} /></Campo>
            <Campo label="Nome" className="sm:col-span-2"><input className="input" value={edit.nome ?? ''} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} /></Campo>
            <Campo label="Grupo">
              <select className="input" value={edit.grupo ?? ''} onChange={(e) => setEdit({ ...edit, grupo: e.target.value || null })}>
                <option value="">—</option>{GRUPOS.map((g) => <option key={g}>{g}</option>)}
              </select>
            </Campo>
            <Campo label="Cor da coluna (programação, mapa, impressões)">
              <div className="flex items-center gap-2"><input type="color" className="h-8 w-12 rounded border border-slate-300 p-0.5" value={corProduto(edit)} onChange={(e) => setEdit({ ...edit, cor: e.target.value })} /><span className="text-xs text-slate-500">{edit.cor ? edit.cor : 'padrão da categoria'}</span>{edit.cor && <button className="btn-secondary py-0.5 text-xs" onClick={() => setEdit({ ...edit, cor: null })}>usar padrão</button>}</div>
            </Campo>
            <Campo label="Preço de compra (R$)"><input className="input" type="number" step="0.01" value={edit.preco_compra ?? ''} onChange={(e) => setEdit({ ...edit, preco_compra: e.target.value === '' ? null : Number(e.target.value) })} /></Campo>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!edit.tem_preco} onChange={(e) => setEdit({ ...edit, tem_preco: e.target.checked })} /> Tem preço de venda</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!edit.conta_como_ave} onChange={(e) => setEdit({ ...edit, conta_como_ave: e.target.checked })} /> Conta como ave (GTA)</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!edit.eh_codorna} onChange={(e) => setEdit({ ...edit, eh_codorna: e.target.checked })} /> É codorna (coluna própria na GTA)</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!edit.ativo} onChange={(e) => setEdit({ ...edit, ativo: e.target.checked })} /> Ativo</label>
            <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setEdit(null)}>Cancelar</button>
              <button className="btn-primary" onClick={salvar}>Salvar</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
