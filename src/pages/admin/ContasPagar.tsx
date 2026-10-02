// Contas a pagar (exclusivo do administrador TI): fornecedor (qualquer tipo), vencimento, valor, centro de custo a pagar (qualquer nível),
// observação e anexos; pagamento, estorno e cancelamento
import { useEffect, useMemo, useState } from 'react'
import { supabase, ok } from '@/lib/supabase'
import { listarCentrosCusto, listarFornecedores } from '@/lib/dados'
import { fmtData, fmtMoeda, fmtPreco, hojeISO, mascaraPreco, normalizar, parsePreco } from '@/lib/format'
import { TIPOS_FORNECEDOR, type CentroCusto, type ContaPagar, type Fornecedor, type SituacaoContaPagar } from '@/lib/types'
import { Campo, Carregando, Chip, Confirmar, Modal, Titulo, useToast } from '@/components/ui'
import ComboCliente, { type OpcaoCombo } from '@/components/ComboCliente'
import AnexosConta, { AnexosPendentes, type AnexoPendente } from '@/components/AnexosConta'
import { enviarAnexo } from '@/lib/anexos'

type Edicao = { id?: number; fornecedor_id: number | ''; data_vencimento: string; valor: string; centro_custo_codigo: number | ''; observacao: string; anexos: AnexoPendente[] }
const vazia = (): Edicao => ({ fornecedor_id: '', data_vencimento: '', valor: '', centro_custo_codigo: '', observacao: '', anexos: [] })
type Linha = ContaPagar & { anexos: { count: number }[] }
/** Códigos da subárvore de um centro de custo: 1000 → 1000…1999, 1100 → 1100…1199, 1110 → 1110…1119 */
const naSubarvore = (cc: CentroCusto, codigo: number) => codigo >= cc.codigo && codigo < cc.codigo + 10 ** (4 - cc.nivel)
/** Opções do combo: na lista aparecem recuadas pelo nível da árvore; o escolhido aparece só como "1110 — Pessoal" */
const opcaoCc = (c: CentroCusto): OpcaoCombo => ({ id: c.codigo, rotulo: `${c.codigo} — ${c.descricao}`, recuo: c.nivel - 1, sufixo: c.ativo ? undefined : '(inativo)' })
const TODOS = 0 // código 0 não existe: usado como "Todos" no filtro

export default function ContasPagar() {
  const { toast } = useToast()
  const [lista, setLista] = useState<Linha[] | null>(null)
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [centros, setCentros] = useState<CentroCusto[]>([])
  const [situacao, setSituacao] = useState<SituacaoContaPagar | ''>('PENDENTE')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [fornecedorId, setFornecedorId] = useState<number | ''>('')
  const [ccFiltro, setCcFiltro] = useState<number | ''>('')
  const [texto, setTexto] = useState('')
  const [edit, setEdit] = useState<Edicao | null>(null)
  const [pagar, setPagar] = useState<{ conta: ContaPagar; data: string } | null>(null)
  const [cancelar, setCancelar] = useState<{ conta: ContaPagar; motivo: string } | null>(null)
  const [estornar, setEstornar] = useState<ContaPagar | null>(null)
  const [anexosDe, setAnexosDe] = useState<ContaPagar | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    Promise.all([listarFornecedores(), listarCentrosCusto()])
      .then(([f, c]) => { setFornecedores(f); setCentros(c.filter((x) => x.tipo === 'PAGAR')) })
      .catch((e) => toast(e.message, 'erro'))
  }, [])

  async function carregar(silencioso = false) {
    if (!silencioso) setLista(null)
    try {
      let q = supabase.from('conta_pagar').select('*, anexos:conta_pagar_anexo(count)').order('data_vencimento').order('id').limit(2000)
      if (situacao) q = q.eq('situacao', situacao)
      if (de) q = q.gte('data_vencimento', de)
      if (ate) q = q.lte('data_vencimento', ate)
      setLista(ok(await q) as Linha[])
    } catch (e: any) { toast(e.message, 'erro'); setLista([]) }
  }
  useEffect(() => { carregar() }, [situacao, de, ate])

  const fornPorId = useMemo(() => new Map(fornecedores.map((f) => [f.id, f])), [fornecedores])
  const ccPorCodigo = useMemo(() => new Map(centros.map((c) => [c.codigo, c])), [centros])
  const hoje = hojeISO()

  const visiveis = useMemo(() => {
    const t = normalizar(texto)
    const cc = ccFiltro === '' ? null : ccPorCodigo.get(ccFiltro) ?? null
    return (lista ?? []).filter((l) =>
      (fornecedorId === '' || l.fornecedor_id === fornecedorId) &&
      (!cc || naSubarvore(cc, l.centro_custo_codigo)) &&
      (!t || normalizar(`${fornPorId.get(l.fornecedor_id)?.nome} ${l.observacao ?? ''}`).includes(t)))
  }, [lista, texto, fornecedorId, ccFiltro, fornPorId, ccPorCodigo])
  const total = visiveis.reduce((s, l) => s + Number(l.valor), 0)

  async function salvar() {
    if (!edit) return
    const valor = parsePreco(edit.valor)
    if (edit.fornecedor_id === '') { toast('Escolha o fornecedor', 'erro'); return }
    if (!edit.data_vencimento) { toast('Informe o vencimento', 'erro'); return }
    if (!valor || valor <= 0) { toast('Informe um valor maior que zero', 'erro'); return }
    if (edit.centro_custo_codigo === '') { toast('Escolha o centro de custo', 'erro'); return }
    const dados = {
      fornecedor_id: edit.fornecedor_id, data_vencimento: edit.data_vencimento, valor,
      centro_custo_codigo: edit.centro_custo_codigo, observacao: edit.observacao.trim() || null,
    }
    setSalvando(true)
    try {
      if (edit.id) {
        ok(await supabase.from('conta_pagar').update(dados).eq('id', edit.id))
        toast('Conta alterada')
      } else {
        const nova = ok(await supabase.from('conta_pagar').insert(dados).select('id').single()) as { id: number }
        // anexos escolhidos antes de salvar: enviados agora que a conta existe
        let erros = 0
        for (const a of edit.anexos) { try { await enviarAnexo(nova.id, a.arquivo, a.tipo) } catch (e: any) { erros++; toast(e.message, 'erro') } }
        toast(erros ? `Conta cadastrada; ${erros} anexo(s) não enviado(s) — anexe de novo pelo 📎` : 'Conta a pagar cadastrada', erros ? 'erro' : 'ok')
      }
      setEdit(null); carregar()
    } catch (e: any) { toast(e.message, 'erro') } finally { setSalvando(false) }
  }

  async function mudarSituacao(id: number, dados: Partial<ContaPagar>, msg: string) {
    try { ok(await supabase.from('conta_pagar').update(dados).eq('id', id)); toast(msg); carregar() } catch (e: any) { toast(e.message, 'erro') }
  }

  const editar = (l: ContaPagar) => setEdit({
    id: l.id, fornecedor_id: l.fornecedor_id, data_vencimento: l.data_vencimento, valor: fmtPreco(l.valor),
    centro_custo_codigo: l.centro_custo_codigo, observacao: l.observacao ?? '', anexos: [],
  })
  /** Identificação da conta nas confirmações: fornecedor · valor · vencimento */
  const resumo = (l: ContaPagar) => `${fornPorId.get(l.fornecedor_id)?.nome ?? ''} · ${fmtMoeda(Number(l.valor))} · vencimento ${fmtData(l.data_vencimento)}`
  const nomeCc = (codigo: number) => `${codigo} — ${ccPorCodigo.get(codigo)?.descricao ?? ''}`
  // no formulário: fornecedores e centros ativos (mais o atual, se tiver sido desativado depois)
  const fornOpcoes = fornecedores.filter((f) => f.ativo || f.id === edit?.fornecedor_id)
  const ccOpcoes = centros.filter((c) => c.ativo || c.codigo === edit?.centro_custo_codigo)

  return (
    <div className="mx-auto max-w-6xl">
      <Titulo acoes={<button className="btn-primary" onClick={() => setEdit(vazia())}>+ Nova conta a pagar</button>}>Financeiro — contas a pagar</Titulo>
      <div className="barra">
        <Campo label="Situação"><select className="input" value={situacao} onChange={(e) => setSituacao(e.target.value as SituacaoContaPagar | '')}><option value="PENDENTE">Pendente</option><option value="PAGO">Pago</option><option value="CANCELADO">Cancelado</option><option value="">Todas</option></select></Campo>
        <Campo label="Vencimento de"><input className="input" type="date" value={de} onChange={(e) => setDe(e.target.value)} /></Campo>
        <Campo label="até"><input className="input" type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></Campo>
        <Campo label="Fornecedor"><select className="input" value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value ? Number(e.target.value) : '')}><option value="">Todos</option>{fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></Campo>
        <Campo label="Centro de custo" className="!flex-none">
          <ComboCliente flutuante className="w-56" classeInput="input pr-7 !w-full" opcoes={[{ id: TODOS, rotulo: 'Todos' }, ...centros.map(opcaoCc)]}
            valor={ccFiltro === '' ? TODOS : ccFiltro} onChange={(id) => setCcFiltro(id === TODOS ? '' : id)} textoSemResultado="Nenhum centro de custo encontrado" />
        </Campo>
        <Campo label="Buscar"><input className="input" placeholder="fornecedor, observação…" value={texto} onChange={(e) => setTexto(e.target.value)} /></Campo>
      </div>
      <div className="mb-1.5 text-xs"><b>{visiveis.length}</b> contas · total <b className="text-leaf-800">{fmtMoeda(total)}</b>{ccFiltro !== '' && <span className="text-slate-500"> · inclui os centros de custo abaixo de {ccFiltro}</span>}</div>
      {lista === null ? <Carregando /> : (
        <div className="card overflow-auto max-h-[calc(100vh-170px)]">
          <table className="tabela">
            <thead>
              <tr><th>Vencimento</th><th>Fornecedor</th><th>Centro de custo</th><th>Observação</th><th className="text-right">Valor</th><th>Situação</th><th>Pagamento</th><th>Anexos</th><th></th></tr>
            </thead>
            <tbody>
              {visiveis.map((l) => {
                const vencida = l.situacao === 'PENDENTE' && l.data_vencimento < hoje
                const f = fornPorId.get(l.fornecedor_id)
                return (
                  <tr key={l.id} className="hover:bg-leaf-50">
                    <td className={`whitespace-nowrap ${vencida ? 'font-bold text-red-600' : ''}`}>{fmtData(l.data_vencimento)}</td>
                    <td><div className="font-semibold">{f?.nome}</div><div className="text-[10px] text-slate-400">{f ? TIPOS_FORNECEDOR[f.tipo] : ''}</div></td>
                    <td className="whitespace-nowrap">{nomeCc(l.centro_custo_codigo)}</td>
                    <td className="max-w-[16rem] truncate" title={l.observacao ?? ''}>{l.observacao}</td>
                    <td className="text-right font-semibold whitespace-nowrap">{fmtMoeda(Number(l.valor))}</td>
                    <td>
                      <Chip cor={l.situacao === 'PAGO' ? 'verde' : l.situacao === 'CANCELADO' ? 'cinza' : vencida ? 'vermelho' : 'amarelo'}>{vencida ? 'VENCIDA' : l.situacao}</Chip>
                      {l.motivo && <div className="text-[10px] text-slate-400">{l.motivo}</div>}
                    </td>
                    <td className="whitespace-nowrap">{fmtData(l.data_pagamento)}</td>
                    <td><button className="btn-secondary py-0.5 text-xs whitespace-nowrap" title="Ver e anexar arquivos" onClick={() => setAnexosDe(l)}>📎 {l.anexos?.[0]?.count ?? 0}</button></td>
                    <td className="text-right whitespace-nowrap space-x-1 py-1">
                      {l.situacao === 'PENDENTE' && <>
                        <button className="btn-primary py-0.5 text-xs" onClick={() => setPagar({ conta: l, data: hoje })}>Pagar</button>
                        <button className="btn-secondary py-0.5 text-xs" onClick={() => editar(l)}>Editar</button>
                        <button className="btn-secondary py-0.5 text-xs" onClick={() => setCancelar({ conta: l, motivo: '' })}>Cancelar</button>
                      </>}
                      {l.situacao === 'PAGO' && <button className="btn-secondary py-0.5 text-xs" onClick={() => setEstornar(l)}>Estornar</button>}
                    </td>
                  </tr>
                )
              })}
              {!visiveis.length && <tr><td colSpan={9} className="p-6 text-center text-slate-400">Nenhuma conta a pagar.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <Modal aberto={!!edit} titulo={edit?.id ? 'Editar conta a pagar' : 'Nova conta a pagar'} onFechar={() => setEdit(null)} largura="max-w-xl">
        {edit && (
          <div className="grid gap-2 sm:grid-cols-2">
            <Campo label="Fornecedor" className="sm:col-span-2">
              <select className="input" autoFocus value={edit.fornecedor_id} onChange={(e) => setEdit({ ...edit, fornecedor_id: e.target.value ? Number(e.target.value) : '' })}>
                <option value="">— escolha —</option>
                {fornOpcoes.map((f) => <option key={f.id} value={f.id}>{f.nome} ({TIPOS_FORNECEDOR[f.tipo]})</option>)}
              </select>
            </Campo>
            <Campo label="Vencimento"><input className="input" type="date" value={edit.data_vencimento} onChange={(e) => setEdit({ ...edit, data_vencimento: e.target.value })} /></Campo>
            <Campo label="Valor (R$)"><input className="input text-right" inputMode="decimal" placeholder="0,00" value={edit.valor} onChange={(e) => setEdit({ ...edit, valor: mascaraPreco(e.target.value) })} /></Campo>
            <Campo label="Centro de custo" className="sm:col-span-2">
              <ComboCliente flutuante classeInput="input pr-7 w-full" opcoes={ccOpcoes.map(opcaoCc)} valor={edit.centro_custo_codigo === '' ? null : edit.centro_custo_codigo}
                onChange={(id) => setEdit({ ...edit, centro_custo_codigo: id })} textoVazio="— escolha —" textoSemResultado="Nenhum centro de custo encontrado" />
            </Campo>
            {!centros.length && <p className="sm:col-span-2 text-xs text-amber-700">Nenhum centro de custo do tipo a pagar cadastrado. Peça ao administrador TI para cadastrar.</p>}
            <Campo label="Observação" className="sm:col-span-2"><textarea className="input" rows={2} value={edit.observacao} onChange={(e) => setEdit({ ...edit, observacao: e.target.value })} /></Campo>
            <div className="sm:col-span-2">
              {edit.id ? <AnexosConta contaId={edit.id} onMudou={() => carregar(true)} />
                : <AnexosPendentes pendentes={edit.anexos} onChange={(anexos) => setEdit({ ...edit, anexos })} />}
            </div>
            <div className="sm:col-span-2 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setEdit(null)}>Cancelar</button>
              <button className="btn-primary" disabled={salvando} onClick={salvar}>Salvar</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal aberto={!!pagar} titulo="Pagar conta" onFechar={() => setPagar(null)} largura="max-w-xl">
        {pagar && (
          <div className="grid min-w-0 gap-3">
            <p className="text-sm">{resumo(pagar.conta)}{pagar.conta.observacao && <><br /><span className="text-slate-500">{pagar.conta.observacao}</span></>}</p>
            <Campo label="Data do pagamento"><input className="input" type="date" value={pagar.data} onChange={(e) => setPagar({ ...pagar, data: e.target.value })} /></Campo>
            <AnexosConta contaId={pagar.conta.id} tipoInicial="COMPROVANTE" onMudou={() => carregar(true)} />
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setPagar(null)}>Voltar</button>
              <button className="btn-primary" disabled={!pagar.data} onClick={() => { mudarSituacao(pagar.conta.id, { situacao: 'PAGO', data_pagamento: pagar.data }, 'Conta paga'); setPagar(null) }}>Confirmar pagamento</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal aberto={!!cancelar} titulo="Cancelar conta" onFechar={() => setCancelar(null)} largura="max-w-md">
        {cancelar && (
          <div className="grid gap-3">
            <p className="text-sm">{resumo(cancelar.conta)}</p>
            <Campo label="Motivo do cancelamento"><input className="input" autoFocus value={cancelar.motivo} onChange={(e) => setCancelar({ ...cancelar, motivo: e.target.value })} /></Campo>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setCancelar(null)}>Voltar</button>
              <button className="btn-danger" disabled={!cancelar.motivo.trim()} onClick={() => { mudarSituacao(cancelar.conta.id, { situacao: 'CANCELADO', motivo: cancelar.motivo.trim() }, 'Conta cancelada'); setCancelar(null) }}>Cancelar conta</button>
            </div>
          </div>
        )}
      </Modal>

      <Confirmar aberto={!!estornar} titulo="Estornar pagamento" texto={estornar ? `Estornar o pagamento?\n${resumo(estornar)}\nA conta volta para pendente.` : ''}
        onSim={() => { if (estornar) mudarSituacao(estornar.id, { situacao: 'PENDENTE' }, 'Pagamento estornado'); setEstornar(null) }} onNao={() => setEstornar(null)} />

      <Modal aberto={!!anexosDe} titulo="Anexos da conta" onFechar={() => setAnexosDe(null)} largura="max-w-xl">
        {anexosDe && (
          <div className="grid gap-2">
            <p className="text-sm">{resumo(anexosDe)}{anexosDe.observacao && <><br /><span className="text-slate-500">{anexosDe.observacao}</span></>}</p>
            <AnexosConta contaId={anexosDe.id} tipoInicial={anexosDe.situacao === 'PAGO' ? 'COMPROVANTE' : 'CONTA'} onMudou={() => carregar(true)} />
            <div className="flex justify-end"><button className="btn-secondary" onClick={() => setAnexosDe(null)}>Fechar</button></div>
          </div>
        )}
      </Modal>
    </div>
  )
}
