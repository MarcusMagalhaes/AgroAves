// Mapa de entrega da rota (consulta na tela; impressão em Documentos)
import { useEffect, useState } from 'react'
import { listarProdutos, listarRotasSemana } from '@/lib/dados'
import { montarMapa, type Mapa as MapaT } from '@/lib/mapa'
import { fmtData, fmtMoeda, fmtNum } from '@/lib/format'
import type { Produto, RotaSemana } from '@/lib/types'
import { Campo, Carregando, Titulo, Vazio, useToast } from '@/components/ui'
import { FORMAS } from '@/lib/types'

export function TabelaMapa({ mapa, compacto }: { mapa: MapaT; compacto?: boolean }) {
  const cls = compacto ? 'px-1 py-0.5 text-[10px]' : 'px-2 py-1 text-xs'
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="bg-slate-100">
          <th className={`${cls} border text-left`}>#</th>
          <th className={`${cls} border text-left`}>Cliente</th>
          <th className={`${cls} border text-left`}>Nome (contato)</th>
          <th className={`${cls} border text-left`}>Cidade</th>
          <th className={`${cls} border text-left`}>Local de entrega</th>
          <th className={`${cls} border text-left`}>Pagto</th>
          {mapa.produtosUsados.map((p) => <th key={p.id} className={`${cls} border text-center`} title={p.nome}>{p.sigla}</th>)}
          {mapa.totalR > 0 && <th className={`${cls} border text-center`}>R</th>}
          <th className={`${cls} border text-right`}>Total R$</th>
        </tr>
      </thead>
      <tbody>
        {mapa.linhas.map((l) => (
          <tr key={l.pedido.id} className="odd:bg-white even:bg-slate-50">
            <td className={`${cls} border`}>{l.item}</td>
            <td className={`${cls} border font-semibold`}>{l.pedido.tipo !== 'CLIENTE' ? l.pedido.tipo : l.pedido.razao_social}</td>
            <td className={`${cls} border`}>{l.pedido.nome_fantasia}{l.pedido.contato ? ` (${l.pedido.contato})` : ''}</td>
            <td className={`${cls} border`}>{l.pedido.cidade}</td>
            <td className={`${cls} border`}>{l.pedido.local_entrega}</td>
            <td className={`${cls} border whitespace-nowrap`}>{l.pedido.forma_pagamento === 'A_VISTA' ? 'Pago: Sim (  ) Não (  )' : l.pedido.forma_pagamento === 'ANTECIPADO' ? 'Pago' : l.pedido.forma_pagamento ? FORMAS[l.pedido.forma_pagamento] : ''}</td>
            {mapa.produtosUsados.map((p) => <td key={p.id} className={`${cls} border text-center font-semibold`}>{l.qtd[p.id] || ''}</td>)}
            {mapa.totalR > 0 && <td className={`${cls} border text-center`}>{l.pedido.reposicao || ''}</td>}
            <td className={`${cls} border text-right font-semibold whitespace-nowrap`}>{l.pedido.tipo === 'CLIENTE' ? fmtMoeda(Number(l.pedido.total)) : ''}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="bg-slate-100 font-bold">
          <td className={`${cls} border`} colSpan={6}>SUB-TOTAL · {mapa.linhas.length} entregas</td>
          {mapa.produtosUsados.map((p) => <td key={p.id} className={`${cls} border text-center`}>{fmtNum(mapa.subtotal[p.id])}</td>)}
          {mapa.totalR > 0 && <td className={`${cls} border text-center`}>{fmtNum(mapa.totalR)}</td>}
          <td className={`${cls} border text-right whitespace-nowrap`}>{fmtMoeda(mapa.totalValor)}</td>
        </tr>
        <tr className="bg-slate-50 text-slate-700">
          <td className={`${cls} border`} colSpan={6}>
            {Object.entries(mapa.porGrupo).map(([g, n]) => `${g}: ${fmtNum(n)}`).join(' · ')} · <b>TOTAL AVES: {fmtNum(mapa.totalAves)}</b>
          </td>
          <td className={`${cls} border`} colSpan={mapa.produtosUsados.length + (mapa.totalR > 0 ? 2 : 1)}></td>
        </tr>
      </tfoot>
    </table>
  )
}

export default function Mapa() {
  const { toast } = useToast()
  const [rotas, setRotas] = useState<RotaSemana[]>([])
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [rotaId, setRotaId] = useState<number | null>(null)
  const [mapa, setMapa] = useState<MapaT | null>(null)
  const [carregando, setCarregando] = useState(false)

  useEffect(() => {
    Promise.all([listarRotasSemana(), listarProdutos()]).then(([r, p]) => { setRotas(r); setProdutos(p); if (r.length) setRotaId(r[0].rota_id) })
      .catch((e) => toast(e.message, 'erro'))
  }, [])
  useEffect(() => {
    const r = rotas.find((x) => x.rota_id === rotaId)
    if (!r?.semana_rota_id) { setMapa(null); return }
    setCarregando(true)
    montarMapa(r.semana_rota_id, produtos).then(setMapa).catch((e) => toast(e.message, 'erro')).finally(() => setCarregando(false))
  }, [rotaId, produtos])

  const rota = rotas.find((x) => x.rota_id === rotaId)
  return (
    <div>
      <Titulo>Mapa da rota</Titulo>
      <div className="card p-3 mb-3 grid sm:grid-cols-2 gap-3 items-end">
        <Campo label="Rota">
          <select className="input" value={rotaId ?? ''} onChange={(e) => setRotaId(Number(e.target.value))}>
            {rotas.map((r) => <option key={r.rota_id} value={r.rota_id}>{r.rota} — {fmtData(r.data_entrega)}</option>)}
          </select>
        </Campo>
        {rota && <div className="text-sm text-slate-600">Distribuição <b>{rota.cidade_distribuicao}</b> · {rota.vendedor} {rota.vendedor_telefone}</div>}
      </div>
      {carregando ? <Carregando /> : !mapa || mapa.linhas.length === 0 ? <div className="card"><Vazio texto="Nenhum pedido nesta semana" /></div> : (
        <div className="card overflow-auto p-2"><TabelaMapa mapa={mapa} /></div>
      )}
    </div>
  )
}
