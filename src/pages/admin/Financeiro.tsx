// Contas a receber: títulos, baixa, estorno, pendências (RF-40…44)
import { useEffect, useMemo, useState } from 'react'
import { supabase, ok } from '@/lib/supabase'
import { rpc } from '@/lib/dados'
import { fmtData, fmtMoeda, hojeISO, normalizar } from '@/lib/format'
import { FORMAS, ehAdminTI, type Boleto, type Titulo as TituloT } from '@/lib/types'
import type { ClientePagador } from '@/lib/boleto'
import { useAuth } from '@/lib/auth'
import { LOTE_CONCILIACAO, conciliarBoletos, emitirBoleto, statusCobranca } from '@/lib/cobranca'
import { Campo, Carregando, Chip, Confirmar, Progresso, Titulo, useToast } from '@/components/ui'
import { AcoesBoleto, ModalConfigCobranca, ModalEmitir, boletoAtual, podeEmitir } from '@/components/Cobranca'

type Linha = TituloT & {
  cliente: ClientePagador & { codigo: number; nome_fantasia: string | null }
  boletos: Boleto[]
}

export default function Financeiro() {
  const { toast } = useToast()
  const { usuario } = useAuth()
  const ti = ehAdminTI(usuario)   // boletos Sicoob: exclusivos do administrador TI
  const [lista, setLista] = useState<Linha[] | null>(null)
  const [situacao, setSituacao] = useState<'PENDENTE' | 'BAIXADO' | 'CANCELADO' | ''>('PENDENTE')
  const [forma, setForma] = useState('')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [texto, setTexto] = useState('')
  const [dataBaixa, setDataBaixa] = useState(hojeISO())
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [aBaixar, setABaixar] = useState(0)   // boletos abertos no banco de títulos já cancelados/baixados

  async function carregar() {
    setLista(null)
    try {
      let q = supabase.from('titulo').select(`*, cliente:cliente(codigo, razao_social, nome_fantasia, cidade, cnpj_cpf, endereco, bairro, cep, uf, email)${ti ? ', boletos:boleto(*)' : ''}`).order('data_referencia', { ascending: false }).order('id', { ascending: false }).limit(2000)
      if (situacao) q = q.eq('situacao', situacao)
      if (forma) q = q.eq('forma_pagamento', forma)
      if (de) q = q.gte('data_referencia', de)
      if (ate) q = q.lte('data_referencia', ate)
      setLista(ok(await q) as unknown as Linha[])
      if (ti) {
        const { count } = await supabase.from('boleto').select('id', { count: 'exact', head: true }).eq('situacao', 'A_BAIXAR')
        setABaixar(count ?? 0)
      }
    } catch (e: any) { toast(e.message, 'erro'); setLista([]) }
  }
  useEffect(() => { carregar() }, [situacao, forma, de, ate])

  // boletos Sicoob
  const [cobranca, setCobranca] = useState<{ ambiente: 'SANDBOX' | 'PRODUCAO'; configurado: boolean } | null>(null)
  const [emitindo, setEmitindo] = useState<Linha | null>(null)
  const [verConfig, setVerConfig] = useState(false)
  useEffect(() => { if (ti) statusCobranca().then(setCobranca).catch(() => setCobranca(null)) }, [ti])
  async function emitirSelecionados() {
    const alvo = (lista ?? []).filter((l) => sel.has(l.id) && podeEmitir(l, boletoAtual(l.boletos)))
    if (!alvo.length) { toast('Nenhum título selecionado aceita boleto (já emitido, valor zero ou não pendente)', 'info'); return }
    if (!confirm(`Emitir ${alvo.length} boleto(s) no Sicoob${cobranca?.ambiente === 'SANDBOX' ? ' (sandbox, teste)' : ''}? Cada um vence na data do título.`)) return
    setProgresso({ atual: 0, total: alvo.length, titulo: 'Emitindo boletos' })
    const erros: string[] = []
    try {
      for (const [i, l] of alvo.entries()) {
        try { await emitirBoleto(l.id) } catch (e: any) { erros.push(`${l.cliente?.razao_social}: ${e.message}`) }
        setProgresso({ atual: i + 1, total: alvo.length, titulo: 'Emitindo boletos' })
      }
      toast(erros.length ? `${alvo.length - erros.length} emitido(s), ${erros.length} com erro — ${erros.slice(0, 3).join(' | ')}` : `${alvo.length} boleto(s) emitido(s)`, erros.length ? 'erro' : 'ok')
    } finally { setProgresso(null); setSel(new Set()); carregar() }
  }
  /** Consulta no banco todos os boletos em aberto e baixa os títulos pagos */
  async function conciliar() {
    try {
      const ids = (ok(await supabase.from('boleto').select('id').in('situacao', ['EMITIDO', 'A_BAIXAR']).eq('ambiente', cobranca?.ambiente ?? 'SANDBOX').order('id')) as { id: number }[]).map((b) => b.id)
      if (!ids.length) { toast('Nenhum boleto em aberto para conferir', 'info'); return }
      const tot = { liquidados: 0, baixados: 0, erros: [] as string[] }
      setProgresso({ atual: 0, total: ids.length, titulo: 'Conferindo boletos no Sicoob' })
      for (let i = 0; i < ids.length; i += LOTE_CONCILIACAO) {
        try {
          const r = await conciliarBoletos(ids.slice(i, i + LOTE_CONCILIACAO))
          tot.liquidados += r.liquidados; tot.baixados += r.baixados; tot.erros.push(...r.erros)
        } catch (e: any) { tot.erros.push(e.message) }
        setProgresso({ atual: Math.min(i + LOTE_CONCILIACAO, ids.length), total: ids.length, titulo: 'Conferindo boletos no Sicoob' })
      }
      toast(`${tot.liquidados} pago(s) e baixado(s) · ${tot.baixados} baixado(s) no banco${tot.erros.length ? ` · ${tot.erros.length} erro(s): ${tot.erros[0]}` : ''}`, tot.erros.length ? 'erro' : 'ok')
    } catch (e: any) { toast(e.message, 'erro') } finally { setProgresso(null); carregar() }
  }

  const visiveis = useMemo(() => {
    const t = normalizar(texto)
    return (lista ?? []).filter((l) => !t || normalizar(`${l.cliente?.codigo} ${l.cliente?.razao_social} ${l.cliente?.nome_fantasia} ${l.cliente?.cidade}`).includes(t))
  }, [lista, texto])
  const total = visiveis.reduce((s, l) => s + Number(l.valor), 0)

  // confirmação antes de baixar (um título ou em massa) e progresso durante a baixa em massa
  const [confirma, setConfirma] = useState<{ ids: number[]; valor: number; nome?: string } | null>(null)
  const [progresso, setProgresso] = useState<{ atual: number; total: number; titulo?: string } | null>(null)
  function pedirBaixa(ids: number[]) {
    const tit = (lista ?? []).filter((l) => ids.includes(l.id))
    setConfirma({ ids, valor: tit.reduce((s, l) => s + Number(l.valor), 0), nome: tit.length === 1 ? tit[0].cliente?.razao_social : undefined })
  }
  async function baixar(ids: number[]) {
    setConfirma(null)
    const total = ids.length
    if (total > 1) setProgresso({ atual: 0, total })
    let feitos = 0; let erros = 0
    try {
      for (const id of ids) {
        try { await rpc('baixar_titulo', { p_id: id, p_data: dataBaixa }); feitos++ } catch { erros++ }
        if (total > 1) setProgresso({ atual: feitos + erros, total })
      }
      toast(erros ? `${feitos} baixado(s), ${erros} com erro` : `${feitos} título(s) baixado(s)`, erros ? 'erro' : 'ok')
    } finally {
      setProgresso(null); setSel(new Set()); carregar()
    }
  }
  async function estornar(id: number) {
    if (!confirm('Estornar a baixa deste título?')) return
    try { await rpc('estornar_baixa', { p_id: id }); toast('Baixa estornada'); carregar() } catch (e: any) { toast(e.message, 'erro') }
  }
  function exportarCsv() {
    const cab = ['Data Ref', 'Cod', 'Cliente', 'Nome', 'Cidade', 'Valor', 'Forma', 'Situação', 'Data Baixa', 'Motivo']
    const rows = visiveis.map((l) => [fmtData(l.data_referencia), l.cliente?.codigo, l.cliente?.razao_social, l.cliente?.nome_fantasia, l.cliente?.cidade, String(l.valor).replace('.', ','), FORMAS[l.forma_pagamento], l.situacao, fmtData(l.data_baixa), l.motivo])
    const csv = [cab, ...rows].map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })); a.download = `financeiro-${hojeISO()}.csv`; a.click()
  }

  return (
    <div className="mx-auto max-w-6xl">
      <Titulo acoes={<>
        {ti && cobranca && <button className="btn-secondary" onClick={conciliar} title="Consulta no Sicoob os boletos em aberto e baixa os títulos pagos">Conferir pagamentos</button>}
        {ti && <button className="btn-secondary" onClick={() => setVerConfig(true)}>Cobrança{cobranca?.ambiente === 'SANDBOX' ? ' (sandbox)' : ''}</button>}
        <button className="btn-secondary" onClick={exportarCsv}>Exportar CSV</button>
      </>}>Financeiro — contas a receber</Titulo>
      {ti && aBaixar > 0 && (
        <div className="mb-1.5 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          {aBaixar} boleto(s) de títulos cancelados ou baixados à mão continuam abertos no banco: use <b>Baixar no banco</b> na linha do título (filtre a situação por Cancelado ou Baixado).
        </div>
      )}
      <div className="barra">
        <Campo label="Situação"><select className="input" value={situacao} onChange={(e) => setSituacao(e.target.value as any)}><option value="PENDENTE">Pendente</option><option value="BAIXADO">Baixado</option><option value="CANCELADO">Cancelado</option><option value="">Todas</option></select></Campo>
        <Campo label="Forma"><select className="input" value={forma} onChange={(e) => setForma(e.target.value)}><option value="">Todas</option>{Object.entries(FORMAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>
        <Campo label="Semana de"><input className="input" type="date" value={de} onChange={(e) => setDe(e.target.value)} /></Campo>
        <Campo label="até"><input className="input" type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></Campo>
        <Campo label="Cliente"><input className="input" placeholder="buscar…" value={texto} onChange={(e) => setTexto(e.target.value)} /></Campo>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5 text-xs">
        <div><b>{visiveis.length}</b> títulos · total <b className="text-leaf-800">{fmtMoeda(total)}</b></div>
        {situacao === 'PENDENTE' && (
          <div className="flex items-center gap-2">
            <span>Data da baixa</span><input className="input w-40 py-1" type="date" value={dataBaixa} onChange={(e) => setDataBaixa(e.target.value)} />
            <button className="btn-primary py-1.5" disabled={!sel.size} onClick={() => pedirBaixa([...sel])}>Baixar selecionados ({sel.size})</button>
            {ti && cobranca && <button className="btn-accent py-1.5" disabled={!sel.size} onClick={emitirSelecionados}>Emitir boletos ({sel.size})</button>}
          </div>
        )}
      </div>
      {lista === null ? <Carregando /> : (
        <div className="card overflow-auto max-h-[calc(100vh-170px)]">
          <table className="tabela">
            <thead>
              <tr>
                {situacao === 'PENDENTE' && <th className="px-2"><input type="checkbox" checked={sel.size > 0 && sel.size === visiveis.length} onChange={(e) => setSel(e.target.checked ? new Set(visiveis.map((l) => l.id)) : new Set())} /></th>}
                <th className="px-2">Semana</th><th className="px-2">Cód</th><th className="px-2">Cliente</th><th className="px-2">Cidade</th><th className="text-right">Valor</th>{ti && <th className="px-2">Venc.</th>}<th className="px-2">Forma</th><th className="px-2">Situação</th><th className="px-2">Baixa</th>{ti && <th className="px-2">Boleto</th>}<th className="px-2"></th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l) => (
                <tr key={l.id} className="border-t border-slate-100 hover:bg-leaf-50">
                  {situacao === 'PENDENTE' && <td className="px-2"><input type="checkbox" checked={sel.has(l.id)} onChange={(e) => { const s = new Set(sel); e.target.checked ? s.add(l.id) : s.delete(l.id); setSel(s) }} /></td>}
                  <td className="whitespace-nowrap">{fmtData(l.data_referencia)}</td>
                  <td className="text-slate-500">{l.cliente?.codigo}</td>
                  <td className="px-2"><div className="font-semibold">{l.cliente?.razao_social}</div><div className="text-xs text-slate-500">{l.cliente?.nome_fantasia}</div></td>
                  <td className="px-2">{l.cliente?.cidade}</td>
                  <td className={`p-2 text-right font-semibold whitespace-nowrap ${Number(l.valor) < 0 ? 'text-red-600' : ''}`}>{fmtMoeda(Number(l.valor))}</td>
                  {ti && <td className="whitespace-nowrap text-xs">{fmtData(l.data_vencimento)}</td>}
                  <td className="text-xs">{FORMAS[l.forma_pagamento]}</td>
                  <td className="px-2"><Chip cor={l.situacao === 'PENDENTE' ? 'amarelo' : l.situacao === 'BAIXADO' ? 'verde' : 'cinza'}>{l.situacao}</Chip>{l.motivo && <div className="text-[10px] text-slate-400">{l.motivo}</div>}</td>
                  <td className="whitespace-nowrap">{fmtData(l.data_baixa)}</td>
                  {ti && <td className="px-2"><AcoesBoleto titulo={l} boleto={boletoAtual(l.boletos)} onEmitir={() => setEmitindo(l)} onMudou={carregar} /></td>}
                  <td className="text-right whitespace-nowrap">
                    {l.situacao === 'PENDENTE' && <button className="btn-primary py-1" onClick={() => pedirBaixa([l.id])}>Baixar</button>}
                    {l.situacao === 'BAIXADO' && <button className="btn-secondary py-1" onClick={() => estornar(l.id)}>Estornar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-1 text-[10px] text-slate-400">Títulos são gerados automaticamente ao marcar o pedido à granja como entregue (Pedido à granja › Ajuste da entrega). Alteração no pedido cancela o pendente e lança a diferença; o que já foi baixado é preservado.</p>
      <Confirmar aberto={!!confirma} titulo={confirma && confirma.ids.length > 1 ? 'Baixar títulos em massa' : 'Baixar título'}
        texto={confirma ? (confirma.ids.length > 1
          ? `Deseja baixar todos os ${confirma.ids.length.toLocaleString('pt-BR')} títulos selecionados?\nTotal: ${fmtMoeda(confirma.valor)} · Data da baixa: ${fmtData(dataBaixa)}`
          : `Deseja baixar o título de ${confirma.nome ?? 'este cliente'}?\nValor: ${fmtMoeda(confirma.valor)} · Data da baixa: ${fmtData(dataBaixa)}`) : ''}
        onSim={() => confirma && baixar(confirma.ids)} onNao={() => setConfirma(null)} />
      {progresso && <Progresso titulo={progresso.titulo ?? 'Baixando títulos'} atual={progresso.atual} total={progresso.total} />}
      {ti && <ModalEmitir titulo={emitindo} onFechar={() => setEmitindo(null)} onEmitido={() => { setEmitindo(null); carregar() }} />}
      {ti && <ModalConfigCobranca aberto={verConfig} podeEditar ambiente={cobranca?.ambiente ?? null} onFechar={() => setVerConfig(false)} />}
    </div>
  )
}
