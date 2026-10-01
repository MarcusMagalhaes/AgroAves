// Contas a receber: títulos, baixa, estorno, pendências (RF-40…44)
import { useEffect, useMemo, useState } from 'react'
import { supabase, ok } from '@/lib/supabase'
import { rpc } from '@/lib/dados'
import { fmtData, fmtMoeda, hojeISO, normalizar } from '@/lib/format'
import { FORMAS, type Titulo as TituloT } from '@/lib/types'
import { Campo, Carregando, Chip, Confirmar, Progresso, Titulo, useToast } from '@/components/ui'

type Linha = TituloT & { cliente: { codigo: number; razao_social: string; nome_fantasia: string | null; cidade: string | null } }

export default function Financeiro() {
  const { toast } = useToast()
  const [lista, setLista] = useState<Linha[] | null>(null)
  const [situacao, setSituacao] = useState<'PENDENTE' | 'BAIXADO' | 'CANCELADO' | ''>('PENDENTE')
  const [forma, setForma] = useState('')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [texto, setTexto] = useState('')
  const [dataBaixa, setDataBaixa] = useState(hojeISO())
  const [sel, setSel] = useState<Set<number>>(new Set())

  async function carregar() {
    setLista(null)
    try {
      let q = supabase.from('titulo').select('*, cliente:cliente(codigo, razao_social, nome_fantasia, cidade)').order('data_referencia', { ascending: false }).order('id', { ascending: false }).limit(2000)
      if (situacao) q = q.eq('situacao', situacao)
      if (forma) q = q.eq('forma_pagamento', forma)
      if (de) q = q.gte('data_referencia', de)
      if (ate) q = q.lte('data_referencia', ate)
      setLista(ok(await q) as Linha[])
    } catch (e: any) { toast(e.message, 'erro'); setLista([]) }
  }
  useEffect(() => { carregar() }, [situacao, forma, de, ate])

  const visiveis = useMemo(() => {
    const t = normalizar(texto)
    return (lista ?? []).filter((l) => !t || normalizar(`${l.cliente?.codigo} ${l.cliente?.razao_social} ${l.cliente?.nome_fantasia} ${l.cliente?.cidade}`).includes(t))
  }, [lista, texto])
  const total = visiveis.reduce((s, l) => s + Number(l.valor), 0)

  // confirmação antes de baixar (um título ou em massa) e progresso durante a baixa em massa
  const [confirma, setConfirma] = useState<{ ids: number[]; valor: number; nome?: string } | null>(null)
  const [progresso, setProgresso] = useState<{ atual: number; total: number } | null>(null)
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
      <Titulo acoes={<button className="btn-secondary" onClick={exportarCsv}>Exportar CSV</button>}>Financeiro — contas a receber</Titulo>
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
          </div>
        )}
      </div>
      {lista === null ? <Carregando /> : (
        <div className="card overflow-auto max-h-[calc(100vh-170px)]">
          <table className="tabela">
            <thead>
              <tr>
                {situacao === 'PENDENTE' && <th className="px-2"><input type="checkbox" checked={sel.size > 0 && sel.size === visiveis.length} onChange={(e) => setSel(e.target.checked ? new Set(visiveis.map((l) => l.id)) : new Set())} /></th>}
                <th className="px-2">Semana</th><th className="px-2">Cód</th><th className="px-2">Cliente</th><th className="px-2">Cidade</th><th className="text-right">Valor</th><th className="px-2">Forma</th><th className="px-2">Situação</th><th className="px-2">Baixa</th><th className="px-2"></th>
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
                  <td className="text-xs">{FORMAS[l.forma_pagamento]}</td>
                  <td className="px-2"><Chip cor={l.situacao === 'PENDENTE' ? 'amarelo' : l.situacao === 'BAIXADO' ? 'verde' : 'cinza'}>{l.situacao}</Chip>{l.motivo && <div className="text-[10px] text-slate-400">{l.motivo}</div>}</td>
                  <td className="whitespace-nowrap">{fmtData(l.data_baixa)}</td>
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
      <p className="mt-1 text-[10px] text-slate-400">Títulos são gerados automaticamente quando a granja confirma a entrega da semana/cidade. Alteração no pedido cancela o pendente e lança a diferença; o que já foi baixado é preservado.</p>
      <Confirmar aberto={!!confirma} titulo={confirma && confirma.ids.length > 1 ? 'Baixar títulos em massa' : 'Baixar título'}
        texto={confirma ? (confirma.ids.length > 1
          ? `Deseja baixar todos os ${confirma.ids.length.toLocaleString('pt-BR')} títulos selecionados?\nTotal: ${fmtMoeda(confirma.valor)} · Data da baixa: ${fmtData(dataBaixa)}`
          : `Deseja baixar o título de ${confirma.nome ?? 'este cliente'}?\nValor: ${fmtMoeda(confirma.valor)} · Data da baixa: ${fmtData(dataBaixa)}`) : ''}
        onSim={() => confirma && baixar(confirma.ids)} onNao={() => setConfirma(null)} />
      {progresso && <Progresso titulo="Baixando títulos" atual={progresso.atual} total={progresso.total} />}
    </div>
  )
}
