// Dashboard de vendas da semana (administradores): abre na semana atual; dá para escolher outra semana (data de entrega)
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { rpc } from '@/lib/dados'
import { fmtData, fmtMoeda, fmtNum } from '@/lib/format'
import { corProduto } from '@/lib/types'
import { Carregando, Titulo, useToast } from '@/components/ui'
import { Indicador, ListaBarras, Secao, Variacao } from '@/components/Painel'

type ClienteTop = { cliente_id: number; codigo: number; nome: string; cidade: string | null; rota: string; quantidade: number; valor: number }
type RotaDash = { rota_id: number; rota: string; vendedor: string | null; pedidos: number; valor: number; quantidade: number; carteira: number }
type DashVendas = {
  data: string | null; anterior: string | null; semanas: string[]
  kpis: { pedidos: number; clientes: number; valor: number; rotas: number; aves: number; itens: number; pedidos_anterior: number; valor_anterior: number; carteira: number }
  contatos: Record<string, number>
  produtos: { produto_id: number; sigla: string; nome: string; grupo: string | null; cor: string | null; quantidade: number; valor: number }[]
  clientes_quantidade: ClienteTop[]; clientes_valor: ClienteTop[]; rotas: RotaDash[]
}

const MEDALHA = ['🥇', '🥈', '🥉']
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)

export default function Dashboard() {
  const { toast } = useToast()
  const [data, setData] = useState<string | null>(null)
  const [d, setD] = useState<DashVendas | null>(null)
  const [atual, setAtual] = useState<string | null>(null)

  useEffect(() => {
    setD(null)
    rpc<DashVendas>('dashboard_vendas', { p_data: data })
      .then((r) => { setD(r); if (!data) setAtual(r.data) })
      .catch((e) => toast(e.message, 'erro'))
  }, [data])

  if (!d) return <Carregando />
  const k = d.kpis
  const ticket = k.pedidos ? k.valor / k.pedidos : 0
  const contatados = Object.values(d.contatos).reduce((s, n) => s + n, 0)
  const top3 = d.rotas.filter((r) => r.pedidos > 0).slice(0, 3)

  const seletor = (
    <select className="input w-auto py-1" value={d.data ?? ''} onChange={(e) => setData(e.target.value)}>
      {d.semanas.map((s) => <option key={s} value={s}>Semana {fmtData(s)}{s === atual ? ' (atual)' : ''}</option>)}
    </select>
  )

  if (!d.data) return <div className="mx-auto max-w-6xl"><Titulo>Dashboard de vendas</Titulo><div className="card p-8 text-center text-slate-400">Nenhuma semana cadastrada.</div></div>

  return (
    <div className="mx-auto max-w-6xl space-y-3">
      <Titulo acoes={seletor}>Dashboard de vendas — semana {fmtData(d.data)}{d.data === atual && <span className="ml-2 rounded bg-leaf-100 px-1.5 py-0.5 text-[10px] font-bold text-leaf-800">ATUAL</span>}</Titulo>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Indicador rotulo="Pedidos" valor={fmtNum(k.pedidos)} apoio={d.anterior ? <Variacao atual={k.pedidos} anterior={k.pedidos_anterior} rotulo={fmtData(d.anterior)} /> : undefined} />
        <Indicador rotulo="Valor vendido" valor={fmtMoeda(k.valor)} apoio={d.anterior ? <Variacao atual={k.valor} anterior={k.valor_anterior} rotulo={fmtData(d.anterior)} /> : undefined} />
        <Indicador rotulo="Aves" valor={fmtNum(k.aves)} apoio={k.itens !== k.aves ? `${fmtNum(k.itens)} itens no total` : 'quantidade pedida'} />
        <Indicador rotulo="Ticket médio" valor={fmtMoeda(ticket)} apoio="valor por pedido" />
        <Indicador rotulo="Clientes atendidos" valor={`${fmtNum(k.clientes)} de ${fmtNum(k.carteira)}`} apoio={`${pct(k.clientes, k.carteira)}% da carteira · ${k.rotas} rota(s)`} />
      </div>

      <Secao titulo="Top 3 rotas com mais pedidos" acao={<Link to="/programacao" className="text-xs font-semibold text-leaf-700 underline">ver programação</Link>}>
        {!top3.length ? <div className="py-3 text-center text-xs text-slate-400">Nenhum pedido nesta semana.</div> : (
          <div className="grid gap-2 sm:grid-cols-3">
            {top3.map((r, i) => (
              <div key={r.rota_id} className={`rounded-lg border p-3 ${i === 0 ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-2xl leading-none">{MEDALHA[i]}</span>
                  <span className="text-[11px] text-slate-500">{r.vendedor ?? 'sem vendedor'}</span>
                </div>
                <div className="mt-1 truncate text-sm font-extrabold text-slate-900">{r.rota}</div>
                <div className="text-lg font-extrabold tabular-nums text-leaf-900">{fmtNum(r.pedidos)} pedidos</div>
                <div className="text-xs text-slate-600">{fmtMoeda(r.valor)} · {fmtNum(r.quantidade)} un. · {pct(r.pedidos, r.carteira)}% dos {r.carteira} clientes</div>
              </div>
            ))}
          </div>
        )}
      </Secao>

      <div className="grid gap-3 lg:grid-cols-2">
        <Secao titulo="Pedidos por produto (quantidade)">
          <ListaBarras itens={d.produtos.map((p) => ({
            chave: p.produto_id, rotulo: <><b>{p.sigla}</b> <span className="text-slate-500">{p.nome}</span></>, valor: p.quantidade,
            texto: fmtNum(p.quantidade), detalhe: fmtMoeda(p.valor), cor: corProduto(p),
          }))} vazio="Nenhum item pedido." />
        </Secao>
        <div className="space-y-3">
          <Secao titulo="Pedidos por rota">
            <ListaBarras cor="#27448a" itens={d.rotas.map((r) => ({
              chave: r.rota_id, rotulo: r.rota, valor: r.pedidos, texto: `${fmtNum(r.pedidos)} / ${fmtNum(r.carteira)}`, detalhe: fmtMoeda(r.valor),
            }))} vazio="Nenhuma rota nesta semana." />
          </Secao>
          <Secao titulo="Contatos da semana">
            <ListaBarras itens={[
              { chave: 'p', rotulo: 'Fizeram pedido', valor: d.contatos.PEDIDO ?? 0, texto: fmtNum(d.contatos.PEDIDO ?? 0), cor: '#16a34a' },
              { chave: 'i', rotulo: 'Interesse sem pedido', valor: d.contatos.INTERESSE_SEM_PEDIDO ?? 0, texto: fmtNum(d.contatos.INTERESSE_SEM_PEDIDO ?? 0), cor: '#d97706' },
              { chave: 's', rotulo: 'Sem interesse', valor: d.contatos.SEM_INTERESSE ?? 0, texto: fmtNum(d.contatos.SEM_INTERESSE ?? 0), cor: '#94a3b8' },
              { chave: 'c', rotulo: 'Sem sucesso no contato', valor: d.contatos.SEM_CONTATO ?? 0, texto: fmtNum(d.contatos.SEM_CONTATO ?? 0), cor: '#94a3b8' },
              { chave: 'n', rotulo: 'Ainda não contatados', valor: Math.max(0, k.carteira - contatados), texto: fmtNum(Math.max(0, k.carteira - contatados)), cor: '#64748b' },
            ]} />
          </Secao>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Secao titulo="Top 10 clientes — quantidade">
          <ListaBarras numerar cor="#27448a" itens={d.clientes_quantidade.map((c) => ({
            chave: c.cliente_id, rotulo: <span title={`${c.codigo} · ${c.cidade ?? ''} · ${c.rota}`}>{c.nome}</span>, valor: c.quantidade, texto: `${fmtNum(c.quantidade)} un.`, detalhe: c.rota,
          }))} vazio="Nenhum pedido nesta semana." />
        </Secao>
        <Secao titulo="Top 10 clientes — valor">
          <ListaBarras numerar cor="#16a34a" itens={d.clientes_valor.map((c) => ({
            chave: c.cliente_id, rotulo: <span title={`${c.codigo} · ${c.cidade ?? ''} · ${c.rota}`}>{c.nome}</span>, valor: c.valor, texto: fmtMoeda(c.valor), detalhe: c.rota,
          }))} vazio="Nenhum pedido nesta semana." />
        </Secao>
      </div>
      <p className="text-[10px] text-slate-400">Considera pedidos de clientes (sem reposição/sobra) não excluídos, pela data de entrega da semana. Clientes atendidos e carteira: clientes ativos das rotas da semana.</p>
    </div>
  )
}
