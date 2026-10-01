// Clientes: lista com filtros, ficha cadastral, rotas do cliente e grade de preços
import { useEffect, useMemo, useState } from 'react'
import { supabase, ok } from '@/lib/supabase'
import { listarClientes, listarProdutos, listarRotas, precosDoCliente } from '@/lib/dados'
import { fmtMoeda, normalizar } from '@/lib/format'
import { FORMAS, type Cliente, type Produto, type Rota } from '@/lib/types'
import { Campo, Carregando, Chip, Modal, Titulo, useToast } from '@/components/ui'

const novoCliente = (): Partial<Cliente> => ({ razao_social: '', forma_pagamento: 'BOLETO', exige_nf: false, exige_gta: false, tipo: 'CLIENTE', ativo: true })

export default function Clientes() {
  const { toast } = useToast()
  const [lista, setLista] = useState<Cliente[] | null>(null)
  const [rotas, setRotas] = useState<Rota[]>([])
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [rotasCliente, setRotasCliente] = useState<Record<number, number[]>>({})
  const [busca, setBusca] = useState('')
  const [rotaF, setRotaF] = useState<number | ''>('')
  const [inativos, setInativos] = useState(false)
  const [edit, setEdit] = useState<Partial<Cliente> | null>(null)
  const [editRotas, setEditRotas] = useState<number[]>([])
  const [precos, setPrecos] = useState<Record<number, string>>({})
  const [aba, setAba] = useState<'dados' | 'precos'>('dados')

  const carregar = async () => {
    try {
      const [c, r, p, rc] = await Promise.all([listarClientes(), listarRotas(), listarProdutos(), supabase.from('rota_cliente').select('rota_id, cliente_id')])
      setLista(c); setRotas(r); setProdutos(p)
      const m: Record<number, number[]> = {}
      for (const x of ok(rc) as any[]) (m[x.cliente_id] ??= []).push(x.rota_id)
      setRotasCliente(m)
    } catch (e: any) { toast(e.message, 'erro') }
  }
  useEffect(() => { carregar() }, [])

  const filtrados = useMemo(() => {
    const t = normalizar(busca)
    return (lista ?? []).filter((c) =>
      (inativos || c.ativo) && c.tipo === 'CLIENTE' &&
      (rotaF === '' || (rotasCliente[c.id] ?? []).includes(rotaF)) &&
      (!t || normalizar(`${c.codigo} ${c.razao_social} ${c.nome_fantasia} ${c.cidade} ${c.contato} ${c.cnpj_cpf}`).includes(t)))
  }, [lista, busca, rotaF, inativos, rotasCliente])

  async function abrir(c: Partial<Cliente>) {
    setEdit(c); setAba('dados')
    setEditRotas(c.id ? (rotasCliente[c.id] ?? []) : [])
    if (c.id) {
      const p = await precosDoCliente(c.id)
      setPrecos(Object.fromEntries(p.map((x) => [x.produto_id, String(x.preco)])))
    } else setPrecos({})
  }

  async function salvar() {
    if (!edit?.razao_social) { toast('Razão social obrigatória', 'erro'); return }
    try {
      let codigo = edit.codigo
      if (!codigo) {
        const { data } = await supabase.from('cliente').select('codigo').order('codigo', { ascending: false }).limit(1)
        codigo = (data?.[0]?.codigo ?? 0) + 1
      }
      const reg: any = { ...edit, codigo }
      delete reg.criado_em; delete reg.atualizado_em
      const salvo = ok(await supabase.from('cliente').upsert(reg).select().single()) as Cliente
      // rotas
      const atuais = rotasCliente[salvo.id] ?? []
      const remover = atuais.filter((r) => !editRotas.includes(r))
      const incluir = editRotas.filter((r) => !atuais.includes(r))
      if (remover.length) ok(await supabase.from('rota_cliente').delete().eq('cliente_id', salvo.id).in('rota_id', remover))
      for (const r of incluir) {
        const { data } = await supabase.from('rota_cliente').select('ordem_visita').eq('rota_id', r).order('ordem_visita', { ascending: false }).limit(1)
        ok(await supabase.from('rota_cliente').insert({ rota_id: r, cliente_id: salvo.id, ordem_visita: (data?.[0]?.ordem_visita ?? 0) + 1 }))
      }
      // preços
      const linhas = produtos.filter((p) => p.tem_preco && precos[p.id] !== undefined && precos[p.id] !== '')
        .map((p) => ({ cliente_id: salvo.id, produto_id: p.id, preco: Number(String(precos[p.id]).replace(',', '.')) }))
      ok(await supabase.from('preco_cliente').delete().eq('cliente_id', salvo.id))
      if (linhas.length) ok(await supabase.from('preco_cliente').insert(linhas))
      toast('Cliente salvo'); setEdit(null); carregar()
    } catch (e: any) { toast(e.message, 'erro') }
  }

  async function copiarPrecosDe(codigo: number) {
    const origem = lista?.find((c) => c.codigo === codigo)
    if (!origem) { toast('Cliente não encontrado', 'erro'); return }
    const p = await precosDoCliente(origem.id)
    setPrecos(Object.fromEntries(p.map((x) => [x.produto_id, String(x.preco)])))
    toast(`Preços copiados de ${origem.razao_social}`, 'info')
  }

  if (!lista) return <Carregando />
  return (
    <div className="mx-auto max-w-6xl">
      <Titulo acoes={<button className="btn-primary" onClick={() => abrir(novoCliente())}>+ Novo cliente</button>}>Clientes e preços</Titulo>
      <div className="card p-3 mb-3 grid gap-3 sm:grid-cols-[1fr_220px_auto] items-end">
        <Campo label="Buscar"><input className="input" placeholder="código, nome, cidade, contato, CNPJ…" value={busca} onChange={(e) => setBusca(e.target.value)} /></Campo>
        <Campo label="Rota">
          <select className="input" value={rotaF} onChange={(e) => setRotaF(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Todas</option>{rotas.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
          </select>
        </Campo>
        <label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /> mostrar inativos</label>
      </div>
      <div className="text-xs text-slate-500 mb-1">{filtrados.length} clientes</div>
      <div className="card overflow-auto max-h-[70vh]">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500 sticky top-0">
            <tr><th className="p-2">Cód</th><th className="p-2">Cliente</th><th className="p-2">Fantasia</th><th className="p-2">Cidade</th><th className="p-2">Rotas</th><th className="p-2">Pagto</th><th className="p-2">NF/GTA</th><th className="p-2"></th></tr>
          </thead>
          <tbody>
            {filtrados.map((c) => (
              <tr key={c.id} className={`border-t border-slate-100 hover:bg-leaf-50 cursor-pointer ${c.ativo ? '' : 'opacity-50'}`} onClick={() => abrir(c)}>
                <td className="p-2 text-slate-500">{c.codigo}</td>
                <td className="p-2 font-semibold">{c.razao_social}</td>
                <td className="p-2">{c.nome_fantasia}</td>
                <td className="p-2">{c.cidade}</td>
                <td className="p-2 text-xs">{(rotasCliente[c.id] ?? []).map((r) => rotas.find((x) => x.id === r)?.nome).join(', ')}</td>
                <td className="p-2 text-xs">{FORMAS[c.forma_pagamento]}</td>
                <td className="p-2 space-x-1">{c.exige_nf && <Chip cor="azul">NF</Chip>}{c.exige_gta && <Chip cor="amarelo">GTA</Chip>}</td>
                <td className="p-2 text-right"><button className="btn-secondary py-1">Abrir</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal aberto={!!edit} titulo={edit?.id ? `Cliente ${edit.codigo} — ${edit.razao_social}` : 'Novo cliente'} onFechar={() => setEdit(null)} largura="max-w-4xl">
        {edit && (
          <div>
            <div className="mb-4 flex gap-2 border-b border-slate-200">
              {(['dados', 'precos'] as const).map((a) => (
                <button key={a} onClick={() => setAba(a)} className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${aba === a ? 'border-leaf-600 text-leaf-800' : 'border-transparent text-slate-500'}`}>
                  {a === 'dados' ? 'Dados e rotas' : 'Preços por produto'}
                </button>
              ))}
            </div>
            {aba === 'dados' ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Campo label="Código (ITEM)"><input className="input" type="number" value={edit.codigo ?? ''} placeholder="automático" onChange={(e) => setEdit({ ...edit, codigo: e.target.value ? Number(e.target.value) : undefined })} /></Campo>
                <Campo label="Código externo (ID)"><input className="input" value={edit.codigo_externo ?? ''} onChange={(e) => setEdit({ ...edit, codigo_externo: e.target.value })} /></Campo>
                <Campo label="CNPJ/CPF"><input className="input" value={edit.cnpj_cpf ?? ''} onChange={(e) => setEdit({ ...edit, cnpj_cpf: e.target.value })} /></Campo>
                <Campo label="Cliente (razão social)" className="sm:col-span-2"><input className="input" value={edit.razao_social ?? ''} onChange={(e) => setEdit({ ...edit, razao_social: e.target.value })} /></Campo>
                <Campo label="Nome fantasia"><input className="input" value={edit.nome_fantasia ?? ''} onChange={(e) => setEdit({ ...edit, nome_fantasia: e.target.value })} /></Campo>
                <Campo label="Endereço" className="sm:col-span-2"><input className="input" value={edit.endereco ?? ''} onChange={(e) => setEdit({ ...edit, endereco: e.target.value })} /></Campo>
                <Campo label="Cidade"><input className="input" value={edit.cidade ?? ''} onChange={(e) => setEdit({ ...edit, cidade: e.target.value })} /></Campo>
                <Campo label="Contato"><input className="input" value={edit.contato ?? ''} onChange={(e) => setEdit({ ...edit, contato: e.target.value })} /></Campo>
                <Campo label="Telefone"><input className="input" value={edit.telefone ?? ''} onChange={(e) => setEdit({ ...edit, telefone: e.target.value })} /></Campo>
                <Campo label="Local de entrega"><input className="input" value={edit.local_entrega ?? ''} onChange={(e) => setEdit({ ...edit, local_entrega: e.target.value })} /></Campo>
                <Campo label="Forma de pagamento">
                  <select className="input" value={edit.forma_pagamento} onChange={(e) => setEdit({ ...edit, forma_pagamento: e.target.value as any })}>
                    {Object.entries(FORMAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Campo>
                <div className="flex flex-col gap-2 justify-end text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={!!edit.exige_nf} onChange={(e) => setEdit({ ...edit, exige_nf: e.target.checked })} /> Exige Nota Fiscal</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={!!edit.exige_gta} onChange={(e) => setEdit({ ...edit, exige_gta: e.target.checked })} /> Exige GTA</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={!!edit.ativo} onChange={(e) => setEdit({ ...edit, ativo: e.target.checked })} /> Ativo</label>
                </div>
                <Campo label="Rotas" className="sm:col-span-2 lg:col-span-3">
                  <div className="flex flex-wrap gap-2">
                    {rotas.filter((r) => r.ativa).map((r) => (
                      <label key={r.id} className={`chip cursor-pointer border ${editRotas.includes(r.id) ? 'bg-leaf-600 text-white border-leaf-600' : 'bg-white border-slate-300 text-slate-600'}`}>
                        <input type="checkbox" className="hidden" checked={editRotas.includes(r.id)} onChange={(e) => setEditRotas(e.target.checked ? [...editRotas, r.id] : editRotas.filter((x) => x !== r.id))} />{r.nome}
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">Cliente novo na rota entra no fim da ordem de visita (ajuste em Rotas › Clientes e ordem).</p>
                </Campo>
                <Campo label="Observação" className="sm:col-span-2 lg:col-span-3"><textarea className="input" rows={2} value={edit.observacao ?? ''} onChange={(e) => setEdit({ ...edit, observacao: e.target.value })} /></Campo>
              </div>
            ) : (
              <div>
                <div className="flex flex-wrap items-end gap-2 mb-3">
                  <Campo label="Copiar preços do cliente (código)"><input className="input w-40" type="number" onKeyDown={(e) => { if (e.key === 'Enter') copiarPrecosDe(Number((e.target as HTMLInputElement).value)) }} placeholder="código + Enter" /></Campo>
                  <div className="text-xs text-slate-500 pb-2">Deixe em branco os produtos que o cliente não compra. Preços em R$.</div>
                </div>
                <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                  {produtos.filter((p) => p.tem_preco).map((p) => (
                    <div key={p.id} className="flex items-center gap-2 py-0.5">
                      <div className="w-12 text-xs font-bold text-slate-500">{p.sigla}</div>
                      <div className="flex-1 text-sm truncate">{p.nome}</div>
                      <input className="input w-24 px-2 py-1 text-right" inputMode="decimal" value={precos[p.id] ?? ''} placeholder="—"
                        onChange={(e) => setPrecos({ ...precos, [p.id]: e.target.value })} />
                    </div>
                  ))}
                </div>
                <div className="mt-3 text-sm text-slate-600">{Object.values(precos).filter((v) => v !== '').length} produtos com preço · {fmtMoeda(0)} = não vende</div>
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2 border-t border-slate-200 pt-4">
              <button className="btn-secondary" onClick={() => setEdit(null)}>Cancelar</button>
              <button className="btn-primary" onClick={salvar}>Salvar cliente</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
