// Rotas: cadastro + semana aberta + ordem de visita dos clientes (substitui as 9 abas de rota)
import { useEffect, useMemo, useState } from 'react'
import { supabase, ok } from '@/lib/supabase'
import { listarCidades, listarClientes, listarRotas, listarRotasSemana, listarVendedores } from '@/lib/dados'
import { fmtData, normalizar } from '@/lib/format'
import type { Cidade, Cliente, Rota, RotaSemana, Vendedor } from '@/lib/types'
import { Campo, Carregando, Chip, Modal, Titulo, useToast } from '@/components/ui'

export default function Rotas() {
  const { toast } = useToast()
  const [rotas, setRotas] = useState<Rota[] | null>(null)
  const [semanas, setSemanas] = useState<RotaSemana[]>([])
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [cidades, setCidades] = useState<Cidade[]>([])
  const [edit, setEdit] = useState<Partial<Rota> & { data_entrega?: string } | null>(null)
  const [ordemRota, setOrdemRota] = useState<Rota | null>(null)

  const carregar = async () => {
    try {
      const [r, s, v, c] = await Promise.all([listarRotas(), listarRotasSemana(), listarVendedores(), listarCidades()])
      setRotas(r); setSemanas(s); setVendedores(v); setCidades(c)
    } catch (e: any) { toast(e.message, 'erro') }
  }
  useEffect(() => { carregar() }, [])

  async function salvar() {
    if (!edit?.nome || !edit.cidade_distribuicao_id) { toast('Nome e cidade são obrigatórios', 'erro'); return }
    try {
      const { data_entrega, ...reg } = edit
      const rota = ok(await supabase.from('rota').upsert({ ...reg, nome: reg.nome!.trim().toUpperCase() }).select().single()) as Rota
      // semana aberta
      const aberta = semanas.find((s) => s.rota_id === rota.id)
      if (data_entrega && data_entrega !== aberta?.data_entrega) {
        if (aberta?.semana_rota_id) ok(await supabase.from('semana_rota').update({ data_entrega }).eq('id', aberta.semana_rota_id))
        else ok(await supabase.from('semana_rota').insert({ rota_id: rota.id, data_entrega, status: 'ABERTA' }))
      }
      toast('Rota salva'); setEdit(null); carregar()
    } catch (e: any) { toast(e.message, 'erro') }
  }

  if (!rotas) return <Carregando />
  return (
    <div className="mx-auto max-w-5xl">
      <Titulo acoes={<button className="btn-primary" onClick={() => setEdit({ nome: '', intervalo_dias: 14, ativa: true, cidade_distribuicao_id: cidades[0]?.id })}>+ Nova rota</button>}>Rotas</Titulo>
      <div className="card overflow-auto">
        <table className="tabela">
          <thead>
            <tr><th className="px-2">Rota</th><th className="px-2">Vendedor</th><th className="px-2">Distribuição</th><th className="px-2">Semana atual</th><th className="px-2">Próxima</th><th className="px-2"></th></tr>
          </thead>
          <tbody>
            {rotas.map((r) => {
              const s = semanas.find((x) => x.rota_id === r.id)
              return (
                <tr key={r.id} className={`border-t border-slate-100 ${r.ativa ? '' : 'opacity-50'}`}>
                  <td className="font-bold">{r.nome} {!r.ativa && <Chip cor="vermelho">inativa</Chip>}</td>
                  <td className="px-2">{vendedores.find((v) => v.id === r.vendedor_id)?.nome ?? <span className="text-amber-600">sem vendedor</span>}</td>
                  <td className="px-2">{cidades.find((c) => c.id === r.cidade_distribuicao_id)?.nome}</td>
                  <td className="font-semibold">{s?.data_entrega ? fmtData(s.data_entrega) : <span className="text-amber-600">sem semana aberta</span>}</td>
                  <td className="text-slate-500">{s?.proxima_semana ? fmtData(s.proxima_semana) : ''}</td>
                  <td className="text-right whitespace-nowrap space-x-1">
                    <button className="btn-secondary py-1" onClick={() => setOrdemRota(r)}>Clientes e ordem</button>
                    <button className="btn-secondary py-1" onClick={() => setEdit({ ...r, data_entrega: s?.data_entrega ?? '' })}>Editar</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <Modal aberto={!!edit} titulo={edit?.id ? 'Editar rota' : 'Nova rota'} onFechar={() => setEdit(null)} largura="max-w-lg">
        {edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label="Nome" className="sm:col-span-2"><input className="input" value={edit.nome ?? ''} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} /></Campo>
            <Campo label="Vendedor">
              <select className="input" value={edit.vendedor_id ?? ''} onChange={(e) => setEdit({ ...edit, vendedor_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">—</option>{vendedores.filter((v) => v.ativo).map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
              </select>
            </Campo>
            <Campo label="Cidade de distribuição">
              <select className="input" value={edit.cidade_distribuicao_id ?? ''} onChange={(e) => setEdit({ ...edit, cidade_distribuicao_id: Number(e.target.value) })}>
                {cidades.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </Campo>
            <Campo label="Semana atual (data de entrega)"><input className="input" type="date" value={edit.data_entrega ?? ''} onChange={(e) => setEdit({ ...edit, data_entrega: e.target.value })} /></Campo>
            <Campo label="Intervalo do ciclo (dias)"><input className="input" type="number" value={edit.intervalo_dias ?? 14} onChange={(e) => setEdit({ ...edit, intervalo_dias: Number(e.target.value) })} /></Campo>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!edit.ativa} onChange={(e) => setEdit({ ...edit, ativa: e.target.checked })} /> Ativa</label>
            <div className="sm:col-span-2 flex justify-end gap-2"><button className="btn-secondary" onClick={() => setEdit(null)}>Cancelar</button><button className="btn-primary" onClick={salvar}>Salvar</button></div>
          </div>
        )}
      </Modal>

      {ordemRota && <OrdemVisita rota={ordemRota} onFechar={() => setOrdemRota(null)} />}
    </div>
  )
}

// ---------- Ordem de visita ----------
function OrdemVisita({ rota, onFechar }: { rota: Rota; onFechar: () => void }) {
  const { toast } = useToast()
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [lista, setLista] = useState<{ cliente_id: number; ordem_visita: number }[] | null>(null)
  const [busca, setBusca] = useState('')
  const [sujo, setSujo] = useState(false)

  useEffect(() => {
    Promise.all([listarClientes(), supabase.from('rota_cliente').select('cliente_id, ordem_visita').eq('rota_id', rota.id).order('ordem_visita')])
      .then(([c, rc]) => { setClientes(c.filter((x) => x.tipo === 'CLIENTE')); setLista(ok(rc) as any) })
      .catch((e) => toast(e.message, 'erro'))
  }, [rota.id])

  const porId = useMemo(() => Object.fromEntries(clientes.map((c) => [c.id, c])), [clientes])
  const naRota = new Set((lista ?? []).map((l) => l.cliente_id))
  const candidatos = useMemo(() => {
    const t = normalizar(busca)
    return clientes.filter((c) => c.ativo && !naRota.has(c.id) && (!t || normalizar(`${c.razao_social} ${c.nome_fantasia} ${c.cidade}`).includes(t))).slice(0, 30)
  }, [clientes, busca, lista])

  function mover(i: number, delta: number) {
    if (!lista) return
    const j = i + delta; if (j < 0 || j >= lista.length) return
    const nova = [...lista]; [nova[i], nova[j]] = [nova[j], nova[i]]
    setLista(nova.map((l, k) => ({ ...l, ordem_visita: k + 1 }))); setSujo(true)
  }
  function remover(id: number) { setLista(lista!.filter((l) => l.cliente_id !== id).map((l, k) => ({ ...l, ordem_visita: k + 1 }))); setSujo(true) }
  function adicionar(id: number) { setLista([...(lista ?? []), { cliente_id: id, ordem_visita: (lista?.length ?? 0) + 1 }]); setSujo(true); setBusca('') }
  function definirPosicao(i: number, pos: number) {
    if (!lista) return
    const nova = [...lista]; const [it] = nova.splice(i, 1); nova.splice(Math.max(0, Math.min(lista.length - 1, pos - 1)), 0, it)
    setLista(nova.map((l, k) => ({ ...l, ordem_visita: k + 1 }))); setSujo(true)
  }

  async function salvar() {
    try {
      ok(await supabase.from('rota_cliente').delete().eq('rota_id', rota.id))
      if (lista?.length) ok(await supabase.from('rota_cliente').insert(lista.map((l) => ({ rota_id: rota.id, ...l }))))
      toast('Ordem de visita salva'); setSujo(false)
    } catch (e: any) { toast(e.message, 'erro') }
  }

  return (
    <Modal aberto titulo={`Clientes da rota ${rota.nome} — ordem de visita`} onFechar={onFechar} largura="max-w-4xl">
      {!lista ? <Carregando /> : (
        <div className="grid gap-4 md:grid-cols-[1fr_280px]">
          <div>
            <div className="text-sm text-slate-600 mb-2">{lista.length} clientes. Use ▲▼ ou digite a posição. Salve ao terminar.</div>
            <div className="max-h-[60vh] overflow-auto divide-y divide-slate-100 border rounded-lg">
              {lista.map((l, i) => {
                const c = porId[l.cliente_id]
                return (
                  <div key={l.cliente_id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                    <input type="number" className="input w-14 px-1 py-1 text-center" value={l.ordem_visita}
                      onChange={(e) => definirPosicao(i, Number(e.target.value))} />
                    <div className="min-w-0 flex-1"><div className="font-semibold truncate">{c?.razao_social ?? `#${l.cliente_id}`}</div><div className="text-xs text-slate-500 truncate">{c?.nome_fantasia} · {c?.cidade}</div></div>
                    <button className="btn-secondary px-2 py-1" onClick={() => mover(i, -1)}>▲</button>
                    <button className="btn-secondary px-2 py-1" onClick={() => mover(i, 1)}>▼</button>
                    <button className="btn-danger px-2 py-1" onClick={() => remover(l.cliente_id)}>✕</button>
                  </div>
                )
              })}
            </div>
          </div>
          <div>
            <Campo label="Adicionar cliente"><input className="input" placeholder="buscar…" value={busca} onChange={(e) => setBusca(e.target.value)} /></Campo>
            <div className="mt-2 max-h-[50vh] overflow-auto divide-y divide-slate-100 border rounded-lg">
              {candidatos.map((c) => (
                <button key={c.id} className="w-full text-left px-2 py-1.5 text-sm hover:bg-leaf-50" onClick={() => adicionar(c.id)}>
                  <div className="font-medium truncate">{c.razao_social}</div><div className="text-xs text-slate-500">{c.nome_fantasia} · {c.cidade}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button className="btn-secondary" onClick={onFechar}>Fechar</button>
            <button className="btn-primary" onClick={salvar} disabled={!sujo}>Salvar ordem</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
