// Consolidação por cidade de distribuição e registro do pedido à granja (RF-30/31)
import { useEffect, useMemo, useState } from 'react'
import { supabase, ok } from '@/lib/supabase'
import { listarCidades, listarFornecedores, listarProdutos, listarRotasSemana, rpc } from '@/lib/dados'
import { fmtData, fmtDataHora, fmtNum } from '@/lib/format'
import { corProduto } from '@/lib/types'
import type { Cidade, Fornecedor, PedidoFornecedor as PF, PedidoFornecedorItem, Produto, RotaSemana } from '@/lib/types'
import { Campo, Carregando, Chip, Confirmar, Titulo, useToast } from '@/components/ui'
import { Link } from 'react-router-dom'

export default function PedidoFornecedor() {
  const { toast } = useToast()
  const [rotas, setRotas] = useState<RotaSemana[]>([])
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [cidades, setCidades] = useState<Cidade[]>([])
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [data, setData] = useState('')
  const [cidadeId, setCidadeId] = useState<number | ''>('')
  const [programado, setProgramado] = useState<Record<number, number>>({})
  const [pf, setPf] = useState<PF | null>(null)
  const [itens, setItens] = useState<Record<number, PedidoFornecedorItem>>({})
  const [aPedir, setAPedir] = useState<Record<number, string>>({})
  const [fornecedorId, setFornecedorId] = useState<number | ''>('')
  const [obs, setObs] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [confirma, setConfirma] = useState(false)

  const datas = useMemo(() => [...new Set(rotas.map((r) => r.data_entrega).filter(Boolean))].sort() as string[], [rotas])

  useEffect(() => {
    Promise.all([listarRotasSemana(), listarProdutos(), listarCidades(), listarFornecedores()]).then(([r, p, c, f]) => {
      // pedido só a fornecedor de produto para venda (granja)
      const fv = f.filter((x) => x.ativo && x.tipo === 'PRODUTO_VENDA')
      setRotas(r); setProdutos(p); setCidades(c); setFornecedores(fv)
      const d = [...new Set(r.map((x) => x.data_entrega))].filter(Boolean).sort(); if (d[0]) setData(d[0] as string)
      if (c[0]) setCidadeId(c[0].id)
      if (fv.length === 1) setFornecedorId(fv[0].id)
    }).catch((e) => toast(e.message, 'erro'))
  }, [])

  async function carregar() {
    if (!data || cidadeId === '') return
    setCarregando(true)
    try {
      const prog = ok(await supabase.from('v_programacao_cidade').select('*').eq('data_entrega', data).eq('cidade_distribuicao_id', cidadeId)) as any[]
      const pm: Record<number, number> = {}
      for (const x of prog) pm[x.produto_id] = Number(x.qtd_programada)
      setProgramado(pm)
      const reg = ok(await supabase.from('pedido_fornecedor').select('*').eq('data_entrega', data).eq('cidade_distribuicao_id', cidadeId).maybeSingle()) as PF | null
      setPf(reg)
      if (reg) {
        const it = ok(await supabase.from('pedido_fornecedor_item').select('*').eq('pedido_fornecedor_id', reg.id)) as PedidoFornecedorItem[]
        const im: Record<number, PedidoFornecedorItem> = {}; for (const i of it) im[i.produto_id] = i
        setItens(im); setFornecedorId(reg.fornecedor_id); setObs(reg.observacao ?? '')
        setAPedir(Object.fromEntries(produtos.map((p) => [p.id, im[p.id]?.qtd_pedida ? String(im[p.id].qtd_pedida) : (pm[p.id] ? String(pm[p.id]) : '')])))
      } else {
        setItens({}); setAPedir(Object.fromEntries(produtos.map((p) => [p.id, pm[p.id] ? String(pm[p.id]) : ''])))
      }
    } catch (e: any) { toast(e.message, 'erro') } finally { setCarregando(false) }
  }
  useEffect(() => { carregar() }, [data, cidadeId, produtos])

  async function registrar() {
    setConfirma(false)
    if (fornecedorId === '') { toast('Escolha o fornecedor (obrigatório)', 'erro'); return }
    const lista = produtos.map((p) => ({ produto_id: p.id, qtd_pedida: Number(aPedir[p.id]) || 0 })).filter((x) => x.qtd_pedida > 0 || programado[x.produto_id])
    try {
      await rpc('registrar_pedido_fornecedor', { p_data: data, p_cidade_id: cidadeId, p_fornecedor_id: fornecedorId, p_itens: lista, p_obs: obs || null })
      toast('Pedido à granja registrado'); carregar()
    } catch (e: any) { toast(e.message, 'erro') }
  }

  const rotasDaCidade = rotas.filter((r) => r.data_entrega === data && r.cidade_distribuicao_id === cidadeId)
  const linhas = produtos.filter((p) => programado[p.id] || Number(aPedir[p.id]) > 0 || itens[p.id])
  const totProg = linhas.reduce((s, p) => s + (programado[p.id] ?? 0), 0)
  const totPed = linhas.reduce((s, p) => s + (Number(aPedir[p.id]) || 0), 0)

  return (
    <div className="mx-auto max-w-4xl">
      <Titulo>Pedido à granja</Titulo>
      <div className="barra">
        <Campo label="Semana (data de entrega)"><select className="input" value={data} onChange={(e) => setData(e.target.value)}>{datas.map((d) => <option key={d} value={d}>{fmtData(d)}</option>)}</select></Campo>
        <Campo label="Cidade de distribuição"><select className="input" value={cidadeId} onChange={(e) => setCidadeId(Number(e.target.value))}>{cidades.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></Campo>
        <Campo label="Fornecedor (granja)">
          <select className="input" value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">— escolha —</option>{fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        </Campo>
        <div className="sm:col-span-3 text-sm text-slate-600">Rotas desta data/cidade: <b>{rotasDaCidade.map((r) => r.rota).join(', ') || 'nenhuma'}</b></div>
      </div>

      {pf && (
        <div className={`card p-3 mb-3 text-sm flex flex-wrap items-center gap-3 ${pf.status === 'REGISTRADO' ? 'border-amber-300 bg-amber-50' : 'border-leaf-300 bg-leaf-50'}`}>
          <Chip cor={pf.status === 'REGISTRADO' ? 'amarelo' : 'verde'}>{pf.status === 'REGISTRADO' ? 'Pedido registrado' : pf.status === 'CONFIRMADO' ? 'Confirmado pela granja' : 'Entregue'}</Chip>
          <span>em {fmtDataHora(pf.registrado_em)}</span>
          {pf.confirmado_em && <span>· confirmado em {fmtDataHora(pf.confirmado_em)}</span>}
          <Link to="/ajuste" className="ml-auto btn-accent py-1.5">Ajuste da entrega →</Link>
        </div>
      )}

      {carregando ? <Carregando /> : (
        <div className="card overflow-auto">
          <table className="tabela">
            <thead>
              <tr><th className="text-left">Produto</th><th className="text-right">Programado</th><th className="text-right">A pedir</th>{pf && <th className="text-right">Confirmado granja</th>}</tr>
            </thead>
            <tbody>
              {linhas.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-slate-400">Nenhum pedido programado para esta data e cidade</td></tr>}
              {linhas.map((p, idx) => {
                const novoGrupo = idx === 0 || linhas[idx - 1].grupo !== p.grupo
                const linhaGrupo = novoGrupo ? <tr key={`g${p.id}`} className="grupo-prod"><td colSpan={9} style={{ background: corProduto(p) + '66' }}>{p.grupo ?? 'OUTROS'}</td></tr> : null
                const prog = programado[p.id] ?? 0; const ped = Number(aPedir[p.id]) || 0
                return (<>{linhaGrupo}
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="font-semibold" style={{ background: corProduto(p) + '26' }}>{p.nome}</td>
                    <td className="text-right font-semibold">{fmtNum(prog)}</td>
                    <td className="text-right">
                      <input type="number" inputMode="numeric" className={`input w-28 text-right py-1 ${ped !== prog ? 'border-amber-400 bg-amber-50' : ''}`} value={aPedir[p.id] ?? ''}
                        onChange={(e) => setAPedir({ ...aPedir, [p.id]: e.target.value })} />
                    </td>
                    {pf && <td className="text-right">{itens[p.id]?.qtd_confirmada ?? <span className="text-slate-400">—</span>}</td>}
                  </tr>
                </>)
              })}
            </tbody>
            <tfoot className="bg-slate-50 font-bold"><tr><td className="px-2">TOTAL</td><td className="text-right">{fmtNum(totProg)}</td><td className="text-right">{fmtNum(totPed)}</td>{pf && <td />}</tr></tfoot>
          </table>
        </div>
      )}
      <div className="mt-1.5 grid gap-2 sm:grid-cols-[1fr_auto] items-end">
        <Campo label="Observação"><input className="input" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="ex.: ajustado para lotes de 500" /></Campo>
        <button className="btn-primary px-5 py-2" disabled={linhas.length === 0} onClick={() => (pf ? setConfirma(true) : registrar())}>{pf ? 'Registrar novamente' : 'Registrar pedido à granja'}</button>
      </div>
      <p className="mt-1 text-[10px] text-slate-400">Ajuste "A pedir" para os lotes da granja (ex.: múltiplos de 500). Células em amarelo diferem do programado. Depois do registro, confirme o que a granja vai mandar em "Ajuste da entrega".</p>
      <Confirmar aberto={confirma} titulo="Registrar novamente" texto={`Já existe pedido registrado para ${fmtData(data)} / ${cidades.find((c) => c.id === cidadeId)?.nome}. Substituir as quantidades?`} onSim={registrar} onNao={() => setConfirma(false)} />
    </div>
  )
}
