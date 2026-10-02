import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase, ok } from '@/lib/supabase'
import { listarCentrosCusto } from '@/lib/dados'
import { TIPOS_CENTRO_CUSTO, type CentroCusto, type TipoCentroCusto } from '@/lib/types'
import { Campo, Carregando, Chip, Modal, Titulo, Vazio, useToast } from '@/components/ui'

/**
 * Centros de custo (exclusivo do administrador TI) — usados no contas a pagar e no contas a receber.
 * O código é falante e gerado pelo banco a partir do pai: 1000 (milhar) › 1100 (centena) › 1110 (dezena) › 1111 (unidade).
 * Código, pai e tipo não mudam; para mudar de lugar, desative e cadastre outro.
 */
const NOME_NIVEL = ['', 'milhar', 'centena', 'dezena', 'unidade']
const PASSO = [0, 100, 10, 1] // passo do código dos filhos, pelo nível do pai

/** Mesma regra do gatilho do banco — só para mostrar o código previsto antes de salvar */
function proximoCodigo(lista: CentroCusto[], pai: CentroCusto | null): number | string {
  if (!pai) return (Math.floor(Math.max(0, ...lista.filter((c) => c.pai_codigo == null).map((c) => c.codigo)) / 1000) + 1) * 1000
  if (pai.nivel >= 4) return 'último nível: não pode ter filhos'
  const passo = PASSO[pai.nivel]
  const prox = Math.max(pai.codigo, ...lista.filter((c) => c.pai_codigo === pai.codigo).map((c) => c.codigo)) + passo
  return prox > pai.codigo + 9 * passo ? 'limite de 9 filhos atingido' : prox
}

type Novo = { pai: CentroCusto | null; descricao: string; tipo: TipoCentroCusto }

export default function CentrosCusto() {
  const { toast } = useToast()
  const [lista, setLista] = useState<CentroCusto[] | null>(null)
  const [abertos, setAbertos] = useState<Set<number>>(new Set())
  const [filtroTipo, setFiltroTipo] = useState<'' | TipoCentroCusto>('')
  const [verInativos, setVerInativos] = useState(false)
  const [novo, setNovo] = useState<Novo | null>(null)
  const [edit, setEdit] = useState<CentroCusto | null>(null)
  const [salvando, setSalvando] = useState(false)

  const carregar = () => listarCentrosCusto().then(setLista).catch((e) => toast(e.message, 'erro'))
  useEffect(() => { carregar() }, [])

  // filhos de cada código (raízes na chave 0), já filtrados
  const filhos = useMemo(() => {
    const m = new Map<number, CentroCusto[]>()
    for (const c of lista ?? []) {
      if (!verInativos && !c.ativo) continue
      if (filtroTipo && c.tipo !== filtroTipo) continue
      const k = c.pai_codigo ?? 0
      m.set(k, [...(m.get(k) ?? []), c])
    }
    return m
  }, [lista, verInativos, filtroTipo])
  const qtdFilhos = (c: CentroCusto) => (lista ?? []).filter((x) => x.pai_codigo === c.codigo).length

  const alternar = (codigo: number) => setAbertos((s) => { const n = new Set(s); n.has(codigo) ? n.delete(codigo) : n.add(codigo); return n })
  const expandirTudo = () => setAbertos(new Set((lista ?? []).map((c) => c.codigo)))

  async function incluir() {
    if (!novo || !novo.descricao.trim()) { toast('Informe a descrição', 'erro'); return }
    setSalvando(true)
    try {
      const c = ok(await supabase.from('centro_custo')
        .insert({ descricao: novo.descricao.trim(), tipo: novo.tipo, pai_codigo: novo.pai?.codigo ?? null })
        .select().single()) as CentroCusto
      toast(`Centro de custo ${c.codigo} cadastrado`)
      if (novo.pai) setAbertos((s) => new Set(s).add(novo.pai!.codigo))
      setNovo(null); carregar()
    } catch (e: any) { toast(e.message, 'erro') } finally { setSalvando(false) }
  }

  async function alterar() {
    if (!edit || !edit.descricao.trim()) { toast('Informe a descrição', 'erro'); return }
    setSalvando(true)
    try {
      ok(await supabase.from('centro_custo').update({ descricao: edit.descricao.trim(), ativo: edit.ativo }).eq('id', edit.id))
      toast('Centro de custo salvo'); setEdit(null); carregar()
    } catch (e: any) { toast(e.message, 'erro') } finally { setSalvando(false) }
  }

  if (!lista) return <Carregando />
  const porCodigo = new Map(lista.map((c) => [c.codigo, c]))
  const original = edit ? porCodigo.get(edit.codigo) : undefined

  const no = (c: CentroCusto): ReactNode => {
    const sub = filhos.get(c.codigo) ?? []
    const aberto = abertos.has(c.codigo)
    const podeFilho = c.ativo && c.nivel < 4 && qtdFilhos(c) < 9
    return (
      <div key={c.codigo}>
        <div className={`flex items-center gap-2 border-b border-slate-100 py-1.5 pr-2 hover:bg-leaf-50 ${c.ativo ? '' : 'opacity-60'}`}
          style={{ paddingLeft: `${(c.nivel - 1) * 1.5 + 0.5}rem` }}>
          <button className={`w-5 shrink-0 text-xs text-slate-500 ${sub.length ? '' : 'invisible'}`} onClick={() => alternar(c.codigo)}
            aria-label={aberto ? 'Recolher' : 'Expandir'}>{aberto ? '▾' : '▸'}</button>
          <span className="w-12 shrink-0 font-mono font-bold text-leaf-900 tabular-nums">{c.codigo}</span>
          <span className={`min-w-0 flex-1 truncate ${c.nivel === 1 ? 'font-bold' : ''}`}>{c.descricao}</span>
          {sub.length > 0 && !aberto && <span className="text-[11px] text-slate-400">{sub.length} {sub.length === 1 ? 'filho' : 'filhos'}</span>}
          <Chip cor={c.tipo === 'PAGAR' ? 'vermelho' : 'azul'}>{TIPOS_CENTRO_CUSTO[c.tipo]}</Chip>
          {!c.ativo && <Chip cor="cinza">inativo</Chip>}
          {podeFilho && <button className="btn-secondary py-0.5 text-xs" title={`Novo filho (${NOME_NIVEL[c.nivel + 1]})`}
            onClick={() => setNovo({ pai: c, descricao: '', tipo: c.tipo })}>+ Filho</button>}
          <button className="btn-secondary py-0.5 text-xs" onClick={() => setEdit({ ...c })}>Editar</button>
        </div>
        {aberto && sub.map(no)}
      </div>
    )
  }

  const raizes = filhos.get(0) ?? []
  const previsto = novo ? proximoCodigo(lista, novo.pai) : null

  return (
    <div className="mx-auto max-w-3xl">
      <Titulo acoes={<>
        <button className="btn-secondary" onClick={expandirTudo}>Expandir tudo</button>
        <button className="btn-secondary" onClick={() => setAbertos(new Set())}>Recolher tudo</button>
        <button className="btn-primary" onClick={() => setNovo({ pai: null, descricao: '', tipo: filtroTipo || 'PAGAR' })}>+ Novo centro de custo</button>
      </>}>Centros de custo</Titulo>

      <div className="mb-1.5 flex flex-wrap items-center gap-3 text-sm">
        <select className="input w-auto py-1" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value as '' | TipoCentroCusto)}>
          <option value="">Todos os tipos</option>
          {Object.entries(TIPOS_CENTRO_CUSTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={verInativos} onChange={(e) => setVerInativos(e.target.checked)} /> Mostrar inativos</label>
        <span className="text-xs text-slate-500">Código: 1000 milhar › 1100 centena › 1110 dezena › 1111 unidade</span>
      </div>

      <div className="card overflow-hidden">
        {raizes.length ? raizes.map(no) : <Vazio texto="Nenhum centro de custo cadastrado." />}
      </div>

      <Modal aberto={!!novo} titulo={novo?.pai ? 'Novo centro de custo filho' : 'Novo centro de custo'} onFechar={() => setNovo(null)} largura="max-w-lg">
        {novo && (
          <div className="grid gap-2 sm:grid-cols-2">
            <Campo label="Centro de custo pai">
              <div className="input bg-slate-50">{novo.pai ? `${novo.pai.codigo} — ${novo.pai.descricao}` : 'Nenhum (primeiro nível)'}</div>
            </Campo>
            <Campo label="Código (gerado)">
              <div className="input bg-slate-50 font-mono font-bold">{previsto}</div>
            </Campo>
            <Campo label="Descrição" className="sm:col-span-2">
              <input className="input" autoFocus value={novo.descricao} onChange={(e) => setNovo({ ...novo, descricao: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && incluir()} />
            </Campo>
            <Campo label="Tipo">
              {novo.pai
                ? <div className="input bg-slate-50">{TIPOS_CENTRO_CUSTO[novo.tipo]} (herdado do pai)</div>
                : <select className="input" value={novo.tipo} onChange={(e) => setNovo({ ...novo, tipo: e.target.value as TipoCentroCusto })}>
                    {Object.entries(TIPOS_CENTRO_CUSTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>}
            </Campo>
            <Campo label="Nível">
              <div className="input bg-slate-50">{NOME_NIVEL[(novo.pai?.nivel ?? 0) + 1]}</div>
            </Campo>
            <p className="sm:col-span-2 text-xs text-slate-500">Depois de salvo, o código, o pai e o tipo não podem ser alterados.</p>
            <div className="sm:col-span-2 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setNovo(null)}>Cancelar</button>
              <button className="btn-primary" disabled={salvando || typeof previsto !== 'number'} onClick={incluir}>Salvar</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal aberto={!!edit} titulo={`Centro de custo ${edit?.codigo ?? ''}`} onFechar={() => setEdit(null)} largura="max-w-lg">
        {edit && (
          <div className="grid gap-2 sm:grid-cols-2">
            <Campo label="Código"><div className="input bg-slate-50 font-mono font-bold">{edit.codigo}</div></Campo>
            <Campo label="Centro de custo pai">
              <div className="input bg-slate-50">{edit.pai_codigo ? `${edit.pai_codigo} — ${porCodigo.get(edit.pai_codigo)?.descricao ?? ''}` : 'Nenhum (primeiro nível)'}</div>
            </Campo>
            <Campo label="Tipo"><div className="input bg-slate-50">{TIPOS_CENTRO_CUSTO[edit.tipo]}</div></Campo>
            <Campo label="Nível"><div className="input bg-slate-50">{NOME_NIVEL[edit.nivel]}</div></Campo>
            <Campo label="Descrição" className="sm:col-span-2">
              <input className="input" autoFocus value={edit.descricao} onChange={(e) => setEdit({ ...edit, descricao: e.target.value })} />
            </Campo>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={edit.ativo} onChange={(e) => setEdit({ ...edit, ativo: e.target.checked })} /> Ativo
            </label>
            {original?.ativo && !edit.ativo && qtdFilhos(edit) > 0 && (
              <p className="sm:col-span-2 text-xs font-semibold text-amber-700">Ao desativar, todos os centros de custo abaixo de {edit.codigo} também serão desativados.</p>
            )}
            <p className="sm:col-span-2 text-xs text-slate-500">Código, pai e tipo não mudam. Para mudar a filiação, desative este e cadastre outro no lugar certo.</p>
            <div className="sm:col-span-2 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setEdit(null)}>Cancelar</button>
              <button className="btn-primary" disabled={salvando} onClick={alterar}>Salvar</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
