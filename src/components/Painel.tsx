// Peças dos dashboards: indicador (KPI), cartão de seção e lista de barras horizontais
import type { ReactNode } from 'react'

/** Indicador: rótulo, número em destaque e linha de apoio (comparação, contagem) */
export function Indicador({ rotulo, valor, apoio, icone, tom = 'neutro' }:
  { rotulo: string; valor: ReactNode; apoio?: ReactNode; icone?: ReactNode; tom?: 'neutro' | 'entrada' | 'saida' | 'alerta' }) {
  const borda = { neutro: 'border-l-leaf-700', entrada: 'border-l-green-600', saida: 'border-l-red-600', alerta: 'border-l-amber-500' }[tom]
  return (
    <div className={`card border-l-4 ${borda} px-3 py-2`}>
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">{icone}{rotulo}</div>
      <div className="mt-0.5 text-xl font-extrabold tabular-nums text-slate-900">{valor}</div>
      {apoio && <div className="text-[11px] text-slate-500">{apoio}</div>}
    </div>
  )
}

/** Variação em relação a um valor anterior: ▲ 12% / ▼ 5% (texto em tinta neutra, seta indica o sentido) */
export function Variacao({ atual, anterior, rotulo }: { atual: number; anterior: number; rotulo: string }) {
  if (!anterior) return <span>sem base de comparação</span>
  const pct = Math.round(((atual - anterior) / anterior) * 100)
  const seta = pct > 0 ? '▲' : pct < 0 ? '▼' : '='
  const cor = pct > 0 ? 'text-green-700' : pct < 0 ? 'text-red-700' : 'text-slate-500'
  return <span><b className={cor}>{seta} {Math.abs(pct)}%</b> vs {rotulo}</span>
}

export function Secao({ titulo, acao, children, className = '' }: { titulo: ReactNode; acao?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-3 ${className}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-extrabold uppercase tracking-wide text-leaf-900">{titulo}</h2>
        {acao}
      </div>
      {children}
    </section>
  )
}

export type ItemBarra = { chave: string | number; rotulo: ReactNode; valor: number; texto: string; detalhe?: string; cor?: string }

/** Barras horizontais ordenadas: rótulo à esquerda, barra proporcional ao maior valor, número à direita */
export function ListaBarras({ itens, cor = '#1e3a8a', vazio = 'Sem dados.', numerar }: { itens: ItemBarra[]; cor?: string; vazio?: string; numerar?: boolean }) {
  if (!itens.length) return <div className="py-4 text-center text-xs text-slate-400">{vazio}</div>
  const max = Math.max(...itens.map((i) => i.valor), 0) || 1
  return (
    <ul className="space-y-1">
      {itens.map((i, n) => (
        <li key={i.chave} className="group grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-2 rounded px-1 text-xs hover:bg-slate-50"
          title={i.detalhe ? `${typeof i.rotulo === 'string' ? i.rotulo + ' — ' : ''}${i.texto} · ${i.detalhe}` : undefined}>
          <span className="truncate text-slate-700">{numerar && <b className="mr-1 text-slate-400">{n + 1}.</b>}{i.rotulo}</span>
          <span className="h-3 rounded-r bg-slate-100">
            <span className="block h-3 rounded-r transition-all group-hover:opacity-80" style={{ width: `${Math.max(2, (i.valor / max) * 100)}%`, background: i.cor ?? cor }} />
          </span>
          <span className="whitespace-nowrap text-right font-semibold tabular-nums text-slate-800">{i.texto}{i.detalhe && <span className="ml-1 font-normal text-slate-400">{i.detalhe}</span>}</span>
        </li>
      ))}
    </ul>
  )
}
