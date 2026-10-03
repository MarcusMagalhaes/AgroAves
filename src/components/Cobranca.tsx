// Boletos Sicoob no contas a receber: emissão, ações do boleto de um título e configuração da cobrança
import { useEffect, useState } from 'react'
import { supabase, ok } from '@/lib/supabase'
import { fmtData, fmtMoeda, hojeISO, parsePreco } from '@/lib/format'
import { pendenciasPagador, SITUACOES_BOLETO, type ClientePagador } from '@/lib/boleto'
import { abrirPdfBoleto, baixarBoletoNoBanco, emitirBoleto } from '@/lib/cobranca'
import type { Boleto, CobrancaConfig } from '@/lib/types'
import { Campo, Chip, Modal, useToast } from '@/components/ui'

/** Boleto que vale para o título: o vivo (emitido/pago/a baixar) ou, se não houver, o último */
export function boletoAtual(lista: Boleto[] | null | undefined): Boleto | null {
  const l = [...(lista ?? [])].sort((a, b) => b.id - a.id)
  return l.find((b) => ['EMITINDO', 'EMITIDO', 'A_BAIXAR', 'LIQUIDADO'].includes(b.situacao)) ?? l[0] ?? null
}
/** O título aceita um novo boleto? Só títulos com forma de pagamento Boleto */
export const podeEmitir = (t: { situacao: string; valor: number; forma_pagamento: string }, b: Boleto | null) =>
  t.forma_pagamento === 'BOLETO' && t.situacao === 'PENDENTE' && Number(t.valor) > 0 &&
  (!b || b.situacao === 'ERRO' || b.situacao === 'BAIXADO')

const COR: Record<Boleto['situacao'], 'verde' | 'amarelo' | 'vermelho' | 'cinza' | 'azul'> = {
  EMITINDO: 'cinza', EMITIDO: 'azul', LIQUIDADO: 'verde', A_BAIXAR: 'amarelo', BAIXADO: 'cinza', ERRO: 'vermelho',
}

async function copiar(texto: string, toast: (m: string, t?: 'ok' | 'erro' | 'info') => void, oque: string) {
  try { await navigator.clipboard.writeText(texto); toast(`${oque} copiado`) } catch { toast('Não foi possível copiar', 'erro') }
}

/** Coluna "Boleto" de um título: situação + ações */
export function AcoesBoleto({ titulo, boleto, onEmitir, onMudou }: {
  titulo: { situacao: string; valor: number; forma_pagamento: string }; boleto: Boleto | null; onEmitir: () => void; onMudou: () => void
}) {
  const { toast } = useToast()
  const [ocupado, setOcupado] = useState(false)
  async function exec(fn: () => Promise<unknown>, msg?: string) {
    setOcupado(true)
    try { await fn(); if (msg) { toast(msg); onMudou() } } catch (e: any) { toast(e.message, 'erro') } finally { setOcupado(false) }
  }
  const b = boleto
  return (
    <div className="flex flex-wrap items-center gap-1">
      {b && (
        <span title={b.erro ?? (b.nosso_numero ? `Nosso número ${b.nosso_numero}` : '')}>
          <Chip cor={COR[b.situacao]}>{SITUACOES_BOLETO[b.situacao]}{b.ambiente === 'SANDBOX' ? ' · teste' : ''}</Chip>
        </span>
      )}
      {b?.situacao === 'LIQUIDADO' && b.data_liquidacao && <span className="text-[10px] text-slate-500">{fmtData(b.data_liquidacao)}</span>}
      {b && ['EMITIDO', 'A_BAIXAR', 'LIQUIDADO'].includes(b.situacao) && (
        <button className="btn-secondary py-0.5 px-1.5 text-[11px]" disabled={ocupado} onClick={() => exec(() => abrirPdfBoleto(b.id))}>PDF</button>
      )}
      {b?.situacao === 'EMITIDO' && b.linha_digitavel && (
        <button className="btn-secondary py-0.5 px-1.5 text-[11px]" title={b.linha_digitavel} onClick={() => copiar(b.linha_digitavel!, toast, 'Linha digitável')}>Linha</button>
      )}
      {b?.situacao === 'EMITIDO' && b.pix_copia_cola && (
        <button className="btn-secondary py-0.5 px-1.5 text-[11px]" onClick={() => copiar(b.pix_copia_cola!, toast, 'Pix copia e cola')}>Pix</button>
      )}
      {b && ['EMITIDO', 'A_BAIXAR'].includes(b.situacao) && (
        <button className={`${b.situacao === 'A_BAIXAR' ? 'btn-accent' : 'btn-secondary'} py-0.5 px-1.5 text-[11px]`} disabled={ocupado}
          onClick={() => confirm(`Baixar (cancelar) no Sicoob o boleto de ${fmtMoeda(Number(b.valor))}? O cliente não poderá mais pagá-lo.`) && exec(() => baixarBoletoNoBanco(b.id), 'Boleto baixado no banco')}>
          Baixar no banco
        </button>
      )}
      {podeEmitir(titulo, b) && (
        <button className="btn-primary py-0.5 px-1.5 text-[11px]" onClick={onEmitir}>{b ? 'Emitir de novo' : 'Emitir boleto'}</button>
      )}
    </div>
  )
}

/** Emissão do boleto de um título: confere o cadastro do cliente e deixa ajustar o vencimento */
export function ModalEmitir({ titulo, onFechar, onEmitido }: {
  titulo: { id: number; valor: number; data_vencimento: string | null; cliente: ClientePagador & { codigo: number } } | null
  onFechar: () => void; onEmitido: () => void
}) {
  const { toast } = useToast()
  const [venc, setVenc] = useState('')
  const [enviando, setEnviando] = useState(false)
  useEffect(() => {
    if (titulo) setVenc(titulo.data_vencimento && titulo.data_vencimento >= hojeISO() ? titulo.data_vencimento : hojeISO())
  }, [titulo])
  if (!titulo) return null
  const falta = pendenciasPagador(titulo.cliente)
  async function emitir() {
    setEnviando(true)
    try { await emitirBoleto(titulo!.id, venc); toast('Boleto emitido'); onEmitido() } catch (e: any) { toast(e.message, 'erro') } finally { setEnviando(false) }
  }
  return (
    <Modal aberto titulo="Emitir boleto Sicoob" onFechar={onFechar} largura="max-w-lg">
      <div className="space-y-3 text-sm">
        <div>
          <div className="font-semibold">{titulo.cliente.codigo} — {titulo.cliente.razao_social}</div>
          <div className="text-xs text-slate-500">
            {titulo.cliente.cnpj_cpf} · {[titulo.cliente.endereco, titulo.cliente.bairro, titulo.cliente.cidade, titulo.cliente.uf, titulo.cliente.cep].filter(Boolean).join(', ')}
          </div>
        </div>
        <div className="flex items-end gap-3">
          <Campo label="Valor"><div className="py-2 text-lg font-extrabold text-leaf-900">{fmtMoeda(Number(titulo.valor))}</div></Campo>
          <Campo label="Vencimento"><input className="input" type="date" min={hojeISO()} value={venc} onChange={(e) => setVenc(e.target.value)} /></Campo>
        </div>
        {falta.length > 0 && (
          <div className="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
            Complete o cadastro do cliente (Cadastros › Clientes) antes de emitir: <b>{falta.join(', ')}</b>
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
          <button className="btn-secondary" onClick={onFechar}>Cancelar</button>
          <button className="btn-primary" disabled={enviando || falta.length > 0 || !venc || venc < hojeISO()} onClick={emitir}>
            {enviando ? 'Emitindo…' : 'Emitir boleto'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** Dados do beneficiário e regras do boleto; só o administrador TI altera */
export function ModalConfigCobranca({ aberto, podeEditar, ambiente, onFechar }: {
  aberto: boolean; podeEditar: boolean; ambiente: string | null; onFechar: () => void
}) {
  const { toast } = useToast()
  const [c, setC] = useState<CobrancaConfig | null>(null)
  useEffect(() => {
    if (!aberto) return
    supabase.from('cobranca_config').select('*').eq('id', 1).maybeSingle()
      .then((r) => { try { setC(ok(r) as CobrancaConfig) } catch (e: any) { toast(e.message, 'erro') } })
  }, [aberto])
  if (!aberto) return null
  const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(/\D/g, '')))
  async function salvar() {
    if (!c) return
    try {
      const { data: u } = await supabase.auth.getUser()
      const { id, atualizado_em, atualizado_por, ...campos } = c as CobrancaConfig & Record<string, unknown>
      ok(await supabase.from('cobranca_config').update({ ...campos, atualizado_em: new Date().toISOString(), atualizado_por: u.user?.id }).eq('id', 1))
      toast('Configuração salva'); onFechar()
    } catch (e: any) { toast(e.message, 'erro') }
  }
  const campo = (label: string, k: keyof CobrancaConfig, tipo: 'num' | 'pct' | 'txt' = 'num') => (
    <Campo label={label}>
      <input className="input" disabled={!podeEditar} value={(c?.[k] as any) ?? ''} inputMode={tipo === 'txt' ? 'text' : 'decimal'}
        onChange={(e) => c && setC({ ...c, [k]: tipo === 'num' ? num(e.target.value) : tipo === 'pct' ? (parsePreco(e.target.value) ?? 0) : e.target.value })} />
    </Campo>
  )
  return (
    <Modal aberto titulo="Cobrança Sicoob — configuração" onFechar={onFechar} largura="max-w-2xl">
      {!c ? <div className="p-4 text-slate-500">Carregando…</div> : (
        <div className="space-y-3 text-sm">
          <div className="text-xs text-slate-500">
            Ambiente do servidor: <b>{ambiente ?? '—'}</b>. As credenciais (Client ID, token, certificado) ficam no Cloudflare, nunca aqui.
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {campo('Nº do cliente (beneficiário)', 'numero_cliente')}
            {campo('Conta corrente', 'numero_conta_corrente')}
            {campo('Contrato de cobrança', 'numero_contrato_cobranca')}
            {campo('Modalidade', 'codigo_modalidade')}
            {campo('Espécie do documento', 'especie_documento', 'txt')}
            {campo('Prazo de vencimento (dias após a entrega)', 'prazo_vencimento_dias')}
            {campo('Multa (%)', 'multa_percentual', 'pct')}
            {campo('Juros ao mês (%)', 'juros_mes_percentual', 'pct')}
            <label className="flex items-center gap-2 pt-5">
              <input type="checkbox" disabled={!podeEditar} checked={c.com_pix} onChange={(e) => setC({ ...c, com_pix: e.target.checked })} /> Boleto com QR Code Pix
            </label>
            <Campo label="Instruções no boleto (até 5 linhas de 40 caracteres)" className="sm:col-span-3">
              <textarea className="input" rows={3} disabled={!podeEditar} value={c.mensagem ?? ''} onChange={(e) => setC({ ...c, mensagem: e.target.value })} />
            </Campo>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
            <button className="btn-secondary" onClick={onFechar}>{podeEditar ? 'Cancelar' : 'Fechar'}</button>
            {podeEditar && <button className="btn-primary" onClick={salvar}>Salvar</button>}
          </div>
        </div>
      )}
    </Modal>
  )
}
