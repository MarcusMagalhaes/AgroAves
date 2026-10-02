// Documentos de entrega: mapa da rota, recibos, GTA e controle de NF (impressão pelo navegador → PDF)
import { useEffect, useMemo, useRef, useState } from 'react'
import { imprimirHtml } from '@/lib/imprimir'
import { useParams } from 'react-router-dom'
import { supabase, ok } from '@/lib/supabase'
import { listarProdutos, listarRotasSemana } from '@/lib/dados'
import { montarMapa, type LinhaMapa, type Mapa as MapaT } from '@/lib/mapa'
import { dataExtenso, fmtData, fmtMoeda, fmtNum } from '@/lib/format'
import { FORMAS, corProduto, type Produto, type RotaSemana } from '@/lib/types'
import { Campo, Carregando, Vazio, useToast } from '@/components/ui'
import { TabelaMapa } from '@/pages/Mapa'
import Logo from '@/components/Logo'

type Doc = 'mapa' | 'recibos' | 'gta' | 'nf'
const EMAIL_EMPRESA = 'agroavesdistribuidora10@gmail.com'

export default function Documentos() {
  const { toast } = useToast()
  const [rotas, setRotas] = useState<RotaSemana[]>([])
  const [produtos, setProdutos] = useState<Produto[]>([])
  const { doc: docParam } = useParams()
  const doc: Doc = (['mapa', 'recibos', 'gta', 'nf'].includes(docParam ?? '') ? docParam : 'mapa') as Doc
  const [rotaId, setRotaId] = useState<number | ''>('')
  const [rotasGta, setRotasGta] = useState<number[]>([])
  const [mapa, setMapa] = useState<MapaT | null>(null)
  const [mapas, setMapas] = useState<{ rota: RotaSemana; mapa: MapaT }[]>([])
  const [carregando, setCarregando] = useState(false)
  const [clientesDoc, setClientesDoc] = useState<Record<number, { cnpj_cpf: string | null; cidade: string | null }>>({})

  useEffect(() => {
    Promise.all([listarRotasSemana(), listarProdutos()]).then(([r, p]) => { setRotas(r); setProdutos(p); if (r[0]) { setRotaId(r[0].rota_id); setRotasGta([r[0].rota_id]) } })
      .catch((e) => toast(e.message, 'erro'))
  }, [])

  const rota = rotas.find((r) => r.rota_id === rotaId)
  useEffect(() => {
    if (doc !== 'recibos' || !rota?.semana_rota_id || !produtos.length) { setMapa(null); return }
    setCarregando(true)
    montarMapa(rota.semana_rota_id, produtos).then(setMapa).catch((e) => toast(e.message, 'erro')).finally(() => setCarregando(false))
  }, [doc, rotaId, produtos])

  useEffect(() => {
    if (doc === 'recibos') return
    const sel = rotas.filter((r) => rotasGta.includes(r.rota_id) && r.semana_rota_id)
    setCarregando(true)
    Promise.all(sel.map(async (r) => ({ rota: r, mapa: await montarMapa(r.semana_rota_id!, produtos) })))
      .then(async (ms) => {
        setMapas(ms)
        const ids = ms.flatMap((m) => m.mapa.linhas.map((l) => l.pedido.cliente_id).filter(Boolean)) as number[]
        if (ids.length) {
          const cs = ok(await supabase.from('cliente').select('id, cnpj_cpf, cidade').in('id', ids)) as any[]
          setClientesDoc(Object.fromEntries(cs.map((c) => [c.id, c])))
        }
      }).catch((e) => toast(e.message, 'erro')).finally(() => setCarregando(false))
  }, [doc, rotasGta, produtos])

  const areaRef = useRef<HTMLDivElement>(null)
  const imprimir = () => {
    const el = areaRef.current
    if (!el) return
    const paisagem = doc !== 'recibos'
    const titulo = { mapa: 'Mapa de entrega', recibos: 'Recibos', gta: 'GTA', nf: 'Controle de NF' }[doc]
    imprimirHtml(titulo, el.innerHTML, paisagem ? 'landscape' : 'portrait')
  }

  return (
    <div>
      <div className="no-print">
        <div className="barra">
          <h1>{{ mapa: 'Mapa de entrega', recibos: 'Recibos', gta: 'GTA — Guia de Trânsito Animal', nf: 'Controle de Nota Fiscal' }[doc]}</h1>
          {doc === 'recibos' ? (
            <Campo label="Rota"><select className="input" value={rotaId} onChange={(e) => setRotaId(Number(e.target.value))}>{rotas.map((r) => <option key={r.rota_id} value={r.rota_id}>{r.rota} — {fmtData(r.data_entrega)}</option>)}</select></Campo>
          ) : (
            <Campo label="Rotas" className="sm:col-span-2">
              <div className="flex flex-wrap gap-1">
                {rotas.map((r) => (
                  <button key={r.rota_id} onClick={() => setRotasGta(rotasGta.includes(r.rota_id) ? rotasGta.filter((x) => x !== r.rota_id) : [...rotasGta, r.rota_id])}
                    className={`chip border ${rotasGta.includes(r.rota_id) ? 'bg-leaf-600 text-white border-leaf-600' : 'bg-white border-slate-300 text-slate-600'}`}>{r.rota} {fmtData(r.data_entrega)}</button>
                ))}
              </div>
            </Campo>
          )}
          <button className="btn-accent ml-auto" onClick={imprimir}>🖨️ Imprimir / salvar PDF</button>
        </div>
        <p className="text-[10px] text-slate-400 mb-1.5">O botão abre o documento já ajustado à página (mapa e GTA em paisagem, recibos em retrato), com as cores. Na janela de impressão escolha a impressora ou "Salvar como PDF".{doc === 'mapa' ? ' Na tela, cabeçalho e rodapé ficam fixos; cada rota sai numa página.' : ''}</p>
      </div>

      {carregando ? <Carregando /> : (
        <div className="bg-white print:bg-white max-h-[calc(100vh-130px)] overflow-auto" ref={areaRef}>
          {doc === 'mapa' && (mapas.some((m) => m.mapa.linhas.length) ? mapas.filter((m) => m.mapa.linhas.length).map((m, i, arr) => <DocMapa key={m.rota.rota_id} rota={m.rota} mapa={m.mapa} ultimo={i === arr.length - 1} />) : <Vazio texto={mapas.length ? 'Sem pedidos nesta semana' : 'Escolha ao menos uma rota'} />)}
          {doc === 'recibos' && rota && (mapa && mapa.linhas.length ? <DocRecibos rota={rota} mapa={mapa} produtos={produtos} /> : <Vazio texto="Sem pedidos nesta semana" />)}
          {doc === 'gta' && <DocGta mapas={mapas} produtos={produtos} clientes={clientesDoc} />}
          {doc === 'nf' && <DocNf mapas={mapas} clientes={clientesDoc} />}
        </div>
      )}
    </div>
  )
}

function Cabecalho({ titulo, sub }: { titulo: string; sub?: string }) {
  // logo à esquerda, título e subtítulo centralizados; a linha inferior acompanha a largura da tabela
  return (
    <div className="relative border-b-2 border-leaf-700 pb-1.5 mb-1.5 text-center">
      <div className="absolute left-0 top-0"><Logo size={34} /></div>
      <div className="text-base font-extrabold text-leaf-900 leading-tight">{titulo}</div>
      {sub && <div className="text-[11px] text-slate-600">{sub}</div>}
    </div>
  )
}

function DocMapa({ rota, mapa, ultimo }: { rota: RotaSemana; mapa: MapaT; ultimo?: boolean }) {
  return (
    <div className={`print-landscape card p-4 print:border-0 print:shadow-none print:p-0 overflow-visible mb-3 ${ultimo ? '' : 'print-page'}`}>
      <style>{`@media print { @page { size: A4 landscape; } }`}</style>
      <TabelaMapa mapa={mapa} compacto fixo cabecalho={<Cabecalho titulo={`DISTRIBUIÇÃO — ${rota.rota} — ${fmtData(rota.data_entrega)}`} sub={`Cidade de distribuição: ${rota.cidade_distribuicao} · Vendedor: ${rota.vendedor ?? ''} ${rota.vendedor_telefone ?? ''}`} />} />
    </div>
  )
}

/** Um recibo de entrega (usado na impressão em lote e no recibo individual da tela de venda) */
export function Recibo({ rota, l, produtos }: { rota: RotaSemana; l: LinhaMapa; produtos: Produto[] }) {
  return (
    <div className="border border-slate-400 p-2 text-xs flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-slate-300 pb-1 mb-1">
        <span className="recibo-logo"><Logo size={30} /></span>
        <div className="text-[11px] text-slate-600 text-right leading-tight"><div>{rota.vendedor} - {rota.vendedor_telefone} (WHATSAPP)</div><div>Ipatinga, {dataExtenso(rota.data_entrega!)}</div></div>
      </div>
      <div className="mt-1 font-bold text-xs">{l.pedido.nome_fantasia || l.pedido.razao_social}</div>
      <div>{l.pedido.cidade} · {l.pedido.telefone}</div>
      <div className="flex justify-between"><span>Item: <b>{l.item}</b> · Contato: {l.pedido.contato}</span><span>Cond. pg: <b>{l.pedido.forma_pagamento === 'ANTECIPADO' ? 'Pago' : l.pedido.forma_pagamento ? FORMAS[l.pedido.forma_pagamento] : ''}</b></span></div>
      <table className="w-full mt-2 border-collapse">
        <thead><tr className="border-b border-slate-300"><th className="text-right">Qtd</th><th className="text-left pl-2">Produto</th><th className="text-right">Unit.</th><th className="text-right">Total</th></tr></thead>
        <tbody>
          {produtos.filter((p) => l.qtd[p.id]).map((p) => (
            <tr key={p.id}><td className="text-right">{l.qtd[p.id]}</td><td className="pl-2" style={{ background: corProduto(p) + '26' }}>{p.nome}</td><td className="text-right">{fmtMoeda(l.precos[p.id])}</td><td className="text-right">{fmtMoeda(l.qtd[p.id] * (l.precos[p.id] ?? 0))}</td></tr>
          ))}
          {l.pedido.reposicao > 0 && <tr><td className="text-right">{l.pedido.reposicao}</td><td className="pl-2">Reposição</td><td className="text-right">—</td><td className="text-right">—</td></tr>}
        </tbody>
        <tfoot><tr className="border-t border-slate-400 font-bold"><td colSpan={3} className="text-right pr-2">TOTAL</td><td className="text-right">{fmtMoeda(Number(l.pedido.total))}</td></tr></tfoot>
      </table>
      <div className="mt-auto pt-5">
        <div className="border-t border-slate-400 pt-0.5 text-center text-[10px]">ASSINATURA</div>
        <div className="text-center text-[10px] text-slate-500">{EMAIL_EMPRESA}</div>
      </div>
    </div>
  )
}

function DocRecibos({ rota, mapa, produtos }: { rota: RotaSemana; mapa: MapaT; produtos: Produto[] }) {
  const clientes = mapa.linhas.filter((l) => l.pedido.tipo === 'CLIENTE')
  const pares: typeof clientes[] = []
  for (let i = 0; i < clientes.length; i += 2) pares.push(clientes.slice(i, i + 2))
  return (
    <div>
      <style>{`@media print { @page { size: A4 portrait; } }`}</style>
      {pares.map((par, i) => (
        <div key={i} className={`grid grid-cols-2 gap-3 mb-3 ${(i + 1) % 3 === 0 ? 'print-page' : ''}`} style={{ breakInside: 'avoid' }}>
          {par.map((l) => (
            <Recibo key={l.pedido.id} rota={rota} l={l} produtos={produtos} />
          ))}
        </div>
      ))}
    </div>
  )
}

function DocGta({ mapas, produtos, clientes }: { mapas: { rota: RotaSemana; mapa: MapaT }[]; produtos: Produto[]; clientes: Record<number, any> }) {
  const aves = produtos.filter((p) => p.conta_como_ave && !p.eh_codorna).map((p) => p.id)
  const codornas = produtos.filter((p) => p.eh_codorna).map((p) => p.id)
  const base = useMemo(() => mapas.flatMap(({ rota, mapa }) => mapa.linhas.filter((l) => l.pedido.exige_gta && l.pedido.tipo === 'CLIENTE').map((l) => ({
    chave: `${rota.rota_id}-${l.pedido.id}`, rota: rota.rota, item: l.item, codigo: l.pedido.cliente_codigo, cnpj: clientes[l.pedido.cliente_id!]?.cnpj_cpf, razao: l.pedido.razao_social, fantasia: l.pedido.nome_fantasia,
    municipio: l.pedido.cidade, aves: aves.reduce((s, id) => s + (l.qtd[id] ?? 0), 0), codornas: codornas.reduce((s, id) => s + (l.qtd[id] ?? 0), 0),
  }))), [mapas, clientes])
  // valores editados só nesta tela (não gravam no banco): a impressão usa o que estiver digitado
  const [edit, setEdit] = useState<Record<string, { aves?: string; codornas?: string }>>({})
  useEffect(() => { setEdit({}) }, [mapas])
  const linhas = base.map((l) => ({
    ...l,
    aves: edit[l.chave]?.aves !== undefined ? Number(edit[l.chave].aves) || 0 : l.aves,
    codornas: edit[l.chave]?.codornas !== undefined ? Number(edit[l.chave].codornas) || 0 : l.codornas,
  }))
  const campo = (l: typeof linhas[number], k: 'aves' | 'codornas') => (
    <>
      <span className="so-impressao">{l[k] ? fmtNum(l[k]) : ''}</span>
      <input className={`no-print w-16 rounded border px-1 py-0 text-right text-xs font-semibold ${edit[l.chave]?.[k] !== undefined ? 'bg-amber-100 border-amber-400' : 'bg-yellow-50 border-slate-300'}`}
        inputMode="numeric" value={edit[l.chave]?.[k] ?? String(l[k] || '')}
        onChange={(e) => setEdit({ ...edit, [l.chave]: { ...edit[l.chave], [k]: e.target.value.replace(/\D/g, '') } })} />
    </>
  )
  if (!mapas.length) return <Vazio texto="Escolha ao menos uma rota" />
  const alterados = Object.keys(edit).length
  return (
    <div className="card p-4 print:border-0 print:shadow-none print:p-0 overflow-auto">
      <style>{`@media print { @page { size: A4 landscape; } }`}</style>
      <div className="no-print mb-1 flex items-center gap-3 text-[11px] text-slate-600">
        <span>As quantidades de <b>Aves</b> e <b>Codornas</b> podem ser alteradas aqui só para a impressão. Não gravam no pedido; ao recarregar a página voltam ao original.</span>
        {alterados > 0 && <><span className="chip bg-amber-100 text-amber-800">{alterados} alterado(s)</span><button className="btn-secondary py-0.5" onClick={() => setEdit({})}>Desfazer alterações</button></>}
      </div>
      <table className="w-full text-xs border-collapse">
        <thead><tr><th colSpan={8} className="p-0 font-normal"><Cabecalho titulo="CONTROLE DE GTA" sub={mapas.map((m) => `${m.rota.rota} ${fmtData(m.rota.data_entrega)}`).join(' · ')} /></th></tr><tr className="bg-slate-100"><th className="border p-1">Rota</th><th className="border p-1">Cód</th><th className="border p-1">CNPJ/CPF</th><th className="border p-1 text-left">Razão social</th><th className="border p-1 text-left">Nome fantasia</th><th className="border p-1 text-left">Município</th><th className="border p-1">Aves</th><th className="border p-1">Codornas</th></tr></thead>
        <tbody>{linhas.map((l) => <tr key={l.chave}><td className="border p-1">{l.rota}</td><td className="border p-1 text-center">{l.codigo}</td><td className="border p-1 whitespace-nowrap">{l.cnpj}</td><td className="border p-1">{l.razao}</td><td className="border p-1">{l.fantasia}</td><td className="border p-1">{l.municipio}</td><td className="border p-1 text-right font-semibold">{campo(l, 'aves')}</td><td className="border p-1 text-right">{campo(l, 'codornas')}</td></tr>)}</tbody>
        <tfoot><tr className="bg-slate-100 font-bold"><td className="border p-1" colSpan={6}>{linhas.length} clientes</td><td className="border p-1 text-right">{fmtNum(linhas.reduce((s, l) => s + l.aves, 0))}</td><td className="border p-1 text-right">{fmtNum(linhas.reduce((s, l) => s + l.codornas, 0))}</td></tr></tfoot>
      </table>
    </div>
  )
}

function DocNf({ mapas, clientes }: { mapas: { rota: RotaSemana; mapa: MapaT }[]; clientes: Record<number, any> }) {
  const linhas = mapas.flatMap(({ rota, mapa }) => mapa.linhas.filter((l) => l.pedido.exige_nf && l.pedido.tipo === 'CLIENTE').map((l) => ({
    rota: rota.rota, codigo: l.pedido.cliente_codigo, cnpj: clientes[l.pedido.cliente_id!]?.cnpj_cpf, razao: l.pedido.razao_social, fantasia: l.pedido.nome_fantasia, municipio: l.pedido.cidade, total: Number(l.pedido.total),
  })))
  if (!mapas.length) return <Vazio texto="Escolha ao menos uma rota" />
  return (
    <div className="card p-4 print:border-0 print:shadow-none print:p-0 overflow-auto">
      <table className="w-full text-xs border-collapse">
        <thead><tr><th colSpan={8} className="p-0 font-normal"><Cabecalho titulo="CONTROLE DE NOTA FISCAL" sub={mapas.map((m) => `${m.rota.rota} ${fmtData(m.rota.data_entrega)}`).join(' · ')} /></th></tr><tr className="bg-slate-100"><th className="border p-1">Rota</th><th className="border p-1">Cód</th><th className="border p-1">CNPJ/CPF</th><th className="border p-1 text-left">Razão social</th><th className="border p-1 text-left">Nome fantasia</th><th className="border p-1 text-left">Município</th><th className="border p-1">Valor</th><th className="border p-1">NF emitida</th></tr></thead>
        <tbody>{linhas.map((l, i) => <tr key={i}><td className="border p-1">{l.rota}</td><td className="border p-1 text-center">{l.codigo}</td><td className="border p-1 whitespace-nowrap">{l.cnpj}</td><td className="border p-1">{l.razao}</td><td className="border p-1">{l.fantasia}</td><td className="border p-1">{l.municipio}</td><td className="border p-1 text-right font-semibold">{fmtMoeda(l.total)}</td><td className="border p-1 text-center">(  )</td></tr>)}</tbody>
        <tfoot><tr className="bg-slate-100 font-bold"><td className="border p-1" colSpan={6}>{linhas.length} clientes</td><td className="border p-1 text-right">{fmtMoeda(linhas.reduce((s, l) => s + l.total, 0))}</td><td className="border p-1" /></tr></tfoot>
      </table>
    </div>
  )
}
