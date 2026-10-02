// Dashboard financeiro (exclusivo do administrador TI): a receber × a pagar, clientes devendo, próximas contas a pagar
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { rpc } from '@/lib/dados'
import { fmtData, fmtMoeda, fmtNum } from '@/lib/format'
import { FORMAS, type FormaPagamento, type SaldoConta } from '@/lib/types'
import { Carregando, Titulo, useToast } from '@/components/ui'
import { IconeDinheiro } from '@/components/Icones'
import { Indicador, ListaBarras, Secao } from '@/components/Painel'

type DashFin = {
  hoje: string
  receber: { pendente: number; qtd: number; clientes: number; recebido_mes: number; por_forma: Partial<Record<FormaPagamento, number>> }
  pagar: { pendente: number; qtd: number; vencido: number; qtd_vencido: number; prox7: number; qtd_prox7: number; pago_mes: number }
  devedores: { cliente_id: number; codigo: number; nome: string; cidade: string | null; valor: number; qtd: number; desde: string }[]
  proximas: { id: number; fornecedor: string; observacao: string | null; data_vencimento: string; valor: number; centro: string }[]
  por_centro: { codigo: number; descricao: string; valor: number }[]
  semanas_pagar: { inicio: string; valor: number }[]
}

const compacto = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 }).format(v)
const dias = (de: string, ate: string) => Math.round((Date.parse(ate) - Date.parse(de)) / 86400000)

export default function DashboardFinanceiro() {
  const { toast } = useToast()
  const [d, setD] = useState<DashFin | null>(null)
  const [bancos, setBancos] = useState<SaldoConta[]>([])
  useEffect(() => {
    rpc<DashFin>('dashboard_financeiro', {}).then(setD).catch((e) => toast(e.message, 'erro'))
    rpc<SaldoConta[]>('saldos_bancarios', {}).then((b) => setBancos(b ?? [])).catch(() => setBancos([]))  // antes da 0011: sem bancos
  }, [])
  if (!d) return <Carregando />
  const emBancos = bancos.reduce((s, b) => s + Number(b.saldo ?? 0), 0)
  // posição projetada: dinheiro em conta + o que falta receber − o que falta pagar
  const saldo = emBancos + Number(d.receber.pendente) - Number(d.pagar.pendente)
  const ontem = (() => { const x = new Date(Date.parse(d.hoje) - 86400000); return x.toISOString().slice(0, 10) })()
  const desatualizadas = bancos.filter((b) => !b.data || b.data < ontem).length
  const maxSemana = Math.max(...d.semanas_pagar.map((s) => Number(s.valor)), 0) || 1

  return (
    <div className="mx-auto max-w-6xl space-y-3">
      <Titulo>Dashboard financeiro</Titulo>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <Indicador tom={emBancos >= 0 ? 'neutro' : 'saida'} icone="🏦" rotulo="Saldo em bancos" valor={`${emBancos < 0 ? '−' : ''}${fmtMoeda(Math.abs(emBancos))}`}
          apoio={bancos.length ? <Link to="/saldos-bancarios" className="underline">{bancos.length} conta(s){desatualizadas ? ` · ${desatualizadas} desatualizada(s)` : ''}</Link> : <Link to="/contas-bancarias" className="underline">cadastrar contas</Link>} />
        <Indicador tom="entrada" icone={<IconeDinheiro sentido="entrada" />} rotulo="A receber" valor={fmtMoeda(d.receber.pendente)}
          apoio={`${fmtNum(d.receber.qtd)} títulos · ${fmtNum(d.receber.clientes)} clientes`} />
        <Indicador tom="saida" icone={<IconeDinheiro sentido="saida" />} rotulo="A pagar" valor={fmtMoeda(d.pagar.pendente)}
          apoio={`${fmtNum(d.pagar.qtd)} contas pendentes`} />
        <Indicador tom={saldo >= 0 ? 'entrada' : 'saida'} rotulo="Posição projetada" valor={`${saldo < 0 ? '−' : ''}${fmtMoeda(Math.abs(saldo))}`}
          apoio="bancos + a receber − a pagar" />
        <Indicador tom="alerta" rotulo="Contas vencidas" valor={fmtMoeda(d.pagar.vencido)}
          apoio={`${fmtNum(d.pagar.qtd_vencido)} conta(s) · vencem em 7 dias: ${fmtMoeda(d.pagar.prox7)}`} />
        <Indicador rotulo="Recebido no mês" valor={fmtMoeda(d.receber.recebido_mes)} apoio={`pago no mês: ${fmtMoeda(d.pagar.pago_mes)}`} />
      </div>

      {bancos.length > 0 && (
        <Secao titulo="Saldo por conta bancária" acao={<Link to="/saldos-bancarios" className="text-xs font-semibold text-leaf-700 underline">saldos e extratos</Link>}>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {bancos.map((b) => (
              <div key={b.conta_bancaria_id} className="rounded-lg border border-slate-200 px-3 py-2">
                <div className="truncate text-xs font-semibold text-slate-600">🏦 {b.apelido} <span className="font-normal text-slate-400">{b.banco_nome}</span></div>
                <div className={`text-lg font-extrabold tabular-nums ${Number(b.saldo) < 0 ? 'text-red-700' : 'text-slate-900'}`}>{b.saldo == null ? '—' : fmtMoeda(b.saldo)}</div>
                <div className={`text-[11px] ${!b.data || b.data < ontem ? 'font-semibold text-amber-700' : 'text-slate-500'}`}>{b.data ? `em ${fmtData(b.data)}${b.data < ontem ? ' · desatualizado' : ''}` : 'sem saldo importado'}</div>
              </div>
            ))}
          </div>
        </Secao>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <Secao titulo="A pagar nas próximas 8 semanas">
          <div className="flex h-40 items-end gap-1.5 border-b border-slate-200 pb-0.5">
            {d.semanas_pagar.map((s) => (
              <div key={s.inicio} className="group flex h-full flex-1 flex-col items-center justify-end" title={`Semana de ${fmtData(s.inicio)}: ${fmtMoeda(s.valor)}`}>
                <span className="mb-0.5 whitespace-nowrap text-[10px] font-semibold tabular-nums text-slate-700">{Number(s.valor) ? compacto(Number(s.valor)) : ''}</span>
                <div className="w-full rounded-t bg-red-600 group-hover:bg-red-700" style={{ height: `${Number(s.valor) ? Math.max(2, (Number(s.valor) / maxSemana) * 100) : 0}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-1.5">
            {d.semanas_pagar.map((s, i) => <div key={s.inicio} className="flex-1 text-center text-[10px] text-slate-500">{i === 0 ? 'esta sem.' : fmtData(s.inicio).slice(0, 5)}</div>)}
          </div>
          {Number(d.pagar.vencido) > 0 && <p className="mt-1 text-[11px] font-semibold text-red-700">+ {fmtMoeda(d.pagar.vencido)} já vencidos (não entram no gráfico)</p>}
        </Secao>
        <div className="space-y-3">
          <Secao titulo="A pagar por centro de custo">
            <ListaBarras cor="#dc2626" itens={d.por_centro.map((c) => ({ chave: c.codigo, rotulo: `${c.codigo} — ${c.descricao}`, valor: Number(c.valor), texto: fmtMoeda(c.valor) }))} vazio="Nenhuma conta pendente." />
          </Secao>
          <Secao titulo="A receber por forma de pagamento">
            <ListaBarras cor="#16a34a" itens={(Object.entries(d.receber.por_forma) as [FormaPagamento, number][]).sort((a, b) => b[1] - a[1])
              .map(([f, v]) => ({ chave: f, rotulo: FORMAS[f], valor: Number(v), texto: fmtMoeda(v) }))} vazio="Nenhum título pendente." />
          </Secao>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Secao titulo="Clientes devendo (maiores valores)" acao={<Link to="/financeiro" className="text-xs font-semibold text-leaf-700 underline">contas a receber</Link>}>
          {!d.devedores.length ? <div className="py-4 text-center text-xs text-slate-400">Nenhum cliente com títulos pendentes.</div> : (
            <div className="max-h-96 overflow-auto"><table className="tabela">
              <thead><tr><th>Cliente</th><th>Títulos</th><th>Desde</th><th className="text-right">Valor</th></tr></thead>
              <tbody>
                {d.devedores.map((c) => {
                  const atraso = dias(c.desde, d.hoje)
                  return (
                    <tr key={c.cliente_id}>
                      <td><div className="font-semibold">{c.nome}</div><div className="text-[10px] text-slate-400">{c.codigo} · {c.cidade}</div></td>
                      <td className="tabular-nums">{c.qtd}</td>
                      <td className="whitespace-nowrap">{fmtData(c.desde)}{atraso > 0 && <div className={`text-[10px] ${atraso > 30 ? 'font-bold text-red-700' : 'text-slate-500'}`}>{atraso} dias</div>}</td>
                      <td className="text-right font-semibold tabular-nums whitespace-nowrap">{fmtMoeda(c.valor)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table></div>
          )}
        </Secao>
        <Secao titulo="Próximas contas a pagar" acao={<Link to="/contas-pagar" className="text-xs font-semibold text-leaf-700 underline">contas a pagar</Link>}>
          {!d.proximas.length ? <div className="py-4 text-center text-xs text-slate-400">Nenhuma conta pendente.</div> : (
            <table className="tabela">
              <thead><tr><th>Vencimento</th><th>Fornecedor</th><th>Centro de custo</th><th className="text-right">Valor</th></tr></thead>
              <tbody>
                {d.proximas.map((c) => {
                  const vencida = c.data_vencimento < d.hoje
                  return (
                    <tr key={c.id}>
                      <td className={`whitespace-nowrap ${vencida ? 'font-bold text-red-700' : ''}`}>{fmtData(c.data_vencimento)}{vencida && <div className="text-[10px]">vencida</div>}</td>
                      <td><div className="font-semibold">{c.fornecedor}</div>{c.observacao && <div className="max-w-[14rem] truncate text-[10px] text-slate-500">{c.observacao}</div>}</td>
                      <td className="whitespace-nowrap">{c.centro}</td>
                      <td className="text-right font-semibold tabular-nums whitespace-nowrap">{fmtMoeda(c.valor)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Secao>
      </div>
      <p className="text-[10px] text-slate-400">A receber: títulos pendentes (Financeiro › Contas a receber). A pagar: contas pendentes. "Desde" é a semana do título pendente mais antigo do cliente.</p>
    </div>
  )
}
