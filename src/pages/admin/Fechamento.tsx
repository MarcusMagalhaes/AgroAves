// Fechamento semanal por rota (RF-60/61): pedidos viram histórico, rota avança o ciclo
import { useEffect, useState } from 'react'
import { supabase, ok } from '@/lib/supabase'
import { listarRotasSemana, rpc } from '@/lib/dados'
import { fmtData, fmtDataHora, hojeISO } from '@/lib/format'
import type { RotaSemana } from '@/lib/types'
import { Carregando, Chip, Confirmar, Titulo, useToast } from '@/components/ui'

interface Info extends RotaSemana { pedidos: number; pf_status: string | null }

export default function Fechamento() {
  const { toast } = useToast()
  const [rotas, setRotas] = useState<Info[] | null>(null)
  const [fechar, setFechar] = useState<Info | null>(null)
  const [forcar, setForcar] = useState(false)
  const [historico, setHistorico] = useState<any[]>([])

  async function carregar() {
    try {
      const rs = await listarRotasSemana()
      const infos = await Promise.all(rs.map(async (r) => {
        const { count } = await supabase.from('pedido').select('id', { count: 'exact', head: true }).eq('semana_rota_id', r.semana_rota_id ?? -1).eq('status', 'ABERTO')
        const pf = r.data_entrega ? ok(await supabase.from('pedido_fornecedor').select('status').eq('data_entrega', r.data_entrega).eq('cidade_distribuicao_id', r.cidade_distribuicao_id).maybeSingle()) as any : null
        return { ...r, pedidos: count ?? 0, pf_status: pf?.status ?? null }
      }))
      setRotas(infos)
      setHistorico(ok(await supabase.from('semana_rota').select('id, data_entrega, fechada_em, rota:rota(nome)').eq('status', 'FECHADA').order('fechada_em', { ascending: false }).limit(15)) as any[])
    } catch (e: any) { toast(e.message, 'erro') }
  }
  useEffect(() => { carregar() }, [])

  async function confirmar() {
    if (!fechar) return
    try {
      await rpc('fechar_semana_rota', { p_rota_id: fechar.rota_id, p_forcar: forcar })
      toast(`Semana ${fmtData(fechar.data_entrega)} da rota ${fechar.rota} fechada`); setFechar(null); setForcar(false); carregar()
    } catch (e: any) { toast(e.message, 'erro') }
  }

  if (!rotas) return <Carregando />
  const hoje = hojeISO()
  return (
    <div className="mx-auto max-w-4xl">
      <Titulo>Fechamento semanal</Titulo>
      <p className="text-sm text-slate-600 mb-3">Fechar a semana arquiva os pedidos (viram histórico, não podem mais ser editados) e avança a data da rota para o próximo ciclo. Só é permitido quando a data de entrega já passou e o pedido à granja foi registrado. <b>Semana fechada não reabre.</b></p>
      <div className="card overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Rota</th><th className="p-2">Semana atual</th><th className="p-2">Próxima</th><th className="p-2 text-right">Pedidos</th><th className="p-2">Granja</th><th className="p-2"></th></tr></thead>
          <tbody>
            {rotas.map((r) => {
              const vencida = !!r.data_entrega && r.data_entrega < hoje
              const pode = vencida && (r.pedidos === 0 || !!r.pf_status)
              return (
                <tr key={r.rota_id} className="border-t border-slate-100">
                  <td className="p-2 font-bold">{r.rota}<div className="text-xs font-normal text-slate-500">{r.cidade_distribuicao}</div></td>
                  <td className="p-2">{r.data_entrega ? <>{fmtData(r.data_entrega)} {vencida ? <Chip cor="amarelo">vencida</Chip> : <Chip cor="verde">em aberto</Chip>}</> : <Chip cor="vermelho">sem semana</Chip>}</td>
                  <td className="p-2 text-slate-500">{fmtData(r.proxima_semana)}</td>
                  <td className="p-2 text-right">{r.pedidos}</td>
                  <td className="p-2">{r.pf_status ? <Chip cor={r.pf_status === 'REGISTRADO' ? 'amarelo' : 'verde'}>{r.pf_status}</Chip> : r.pedidos > 0 ? <Chip cor="vermelho">não registrado</Chip> : <span className="text-slate-400">—</span>}</td>
                  <td className="p-2 text-right">
                    <button className={pode ? 'btn-primary py-1.5' : 'btn-secondary py-1.5'} disabled={!r.data_entrega} onClick={() => { setFechar(r); setForcar(!pode) }}>Fechar semana</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {historico.length > 0 && (
        <div className="mt-5">
          <div className="label">Últimos fechamentos</div>
          <div className="card divide-y divide-slate-100 text-sm">
            {historico.map((h) => <div key={h.id} className="flex justify-between p-2"><span><b>{h.rota?.nome}</b> · semana {fmtData(h.data_entrega)}</span><span className="text-slate-500">{fmtDataHora(h.fechada_em)}</span></div>)}
          </div>
        </div>
      )}
      <Confirmar aberto={!!fechar} titulo="Fechar semana" perigo={forcar}
        texto={fechar ? `Fechar a semana ${fmtData(fechar.data_entrega)} da rota ${fechar.rota}?\n${fechar.pedidos} pedidos serão arquivados e a rota avançará para ${fmtData(fechar.proxima_semana)}.${forcar ? '\n\nATENÇÃO: a semana ainda não venceu ou não há pedido à granja. Fechar mesmo assim (forçado)?' : ''}\n\nEsta ação não pode ser desfeita.` : ''}
        onSim={confirmar} onNao={() => setFechar(null)} />
    </div>
  )
}
