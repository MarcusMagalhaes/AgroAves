// Completar cadastros: busca bairro, CEP e UF dos clientes que estão sem eles (Receita pelo CNPJ ou Correios pela rua)
// e grava só os campos vazios, depois da revisão. Endereço, cidade e campos preenchidos nunca são alterados.
import { useMemo, useRef, useState } from 'react'
import { supabase, ok } from '@/lib/supabase'
import { UFS } from '@/lib/boleto'
import { buscarEndereco, camposParaGravar, faltaEndereco, fmtCep, type Achado, type Resultado } from '@/lib/enderecos'
import type { Cliente } from '@/lib/types'
import { Chip, Modal, Progresso, useToast } from '@/components/ui'

type Linha = { c: Cliente; r: Resultado | null; escolha: number; marcado: boolean }

const achadoDe = (l: Linha): Achado | null =>
  l.r?.status === 'OK' ? l.r.achado : l.r?.status === 'AMBIGUO' && l.escolha >= 0 ? l.r.opcoes[l.escolha] : null

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function CompletarCadastros({ aberto, clientes, onFechar, onGravado }: {
  aberto: boolean; clientes: Cliente[]; onFechar: () => void; onGravado: () => void
}) {
  const { toast } = useToast()
  const [ufPadrao, setUfPadrao] = useState('MG')
  const [linhas, setLinhas] = useState<Linha[] | null>(null)
  const [busca, setBusca] = useState<{ atual: number; total: number } | null>(null)
  const [gravando, setGravando] = useState<{ atual: number; total: number } | null>(null)
  const [soEncontrados, setSoEncontrados] = useState(false)
  const parar = useRef(false)

  const pendentes = useMemo(() => clientes.filter((c) => c.ativo && c.tipo === 'CLIENTE' && faltaEndereco(c)), [clientes])

  async function buscar() {
    const lista: Linha[] = pendentes.map((c) => ({ c, r: null, escolha: -1, marcado: false }))
    setLinhas(lista); parar.current = false
    for (let i = 0; i < lista.length && !parar.current; i++) {
      setBusca({ atual: i, total: lista.length })
      let r: Resultado
      try { r = await buscarEndereco((u) => fetch(u), lista[i].c, ufPadrao) } catch { r = { status: 'NAO_ENCONTRADO', motivo: 'sem conexão com o serviço' } }
      const temAlgo = r.status === 'OK' && Object.keys(camposParaGravar(lista[i].c, r.achado)).length > 0
      lista[i] = { ...lista[i], r, marcado: temAlgo }
      setLinhas([...lista])
      await espera(300)   // gentil com os serviços públicos
    }
    setBusca(null)
  }

  async function gravar() {
    const alvo = (linhas ?? []).filter((l) => l.marcado && achadoDe(l))
    if (!alvo.length) return
    setGravando({ atual: 0, total: alvo.length })
    let feitos = 0; const erros: string[] = []
    for (const [i, l] of alvo.entries()) {
      const campos = camposParaGravar(l.c, achadoDe(l)!)
      if (Object.keys(campos).length) {
        try { ok(await supabase.from('cliente').update(campos).eq('id', l.c.id)); feitos++ } catch (e: any) { erros.push(`${l.c.codigo}: ${e.message}`) }
      }
      setGravando({ atual: i + 1, total: alvo.length })
    }
    setGravando(null)
    toast(erros.length ? `${feitos} cadastro(s) completado(s), ${erros.length} com erro — ${erros[0]}` : `${feitos} cadastro(s) completado(s)`, erros.length ? 'erro' : 'ok')
    setLinhas(null); onGravado()
  }

  function alterar(id: number, mud: Partial<Linha>) {
    setLinhas((ls) => ls && ls.map((l) => (l.c.id === id ? { ...l, ...mud } : l)))
  }

  if (!aberto) return null
  const visiveis = (linhas ?? []).filter((l) => !soEncontrados || achadoDe(l) || l.r?.status === 'AMBIGUO')
  const marcados = (linhas ?? []).filter((l) => l.marcado && achadoDe(l)).length
  const cont = (s: string) => (linhas ?? []).filter((l) => l.r?.status === s).length
  const fechar = () => { parar.current = true; setLinhas(null); setBusca(null); onFechar() }

  return (
    <Modal aberto titulo="Completar cadastros — bairro, CEP e UF" onFechar={fechar}>
      <div className="space-y-2">
        <p className="text-[11px] text-slate-600">
          Procura o endereço de cada cliente sem bairro, CEP ou UF: pelo <b>CNPJ</b> na Receita Federal (BrasilAPI) e, sem CNPJ, pela <b>rua e cidade</b> nos
          Correios (ViaCEP). Só os campos <b>vazios</b> de bairro, CEP e UF são gravados; endereço, cidade e o que já está preenchido não mudam.
          CPF não é enviado a nenhum serviço.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs"><b>{pendentes.length}</b> cliente(s) ativo(s) com bairro, CEP ou UF em branco</span>
          <label className="flex items-center gap-1 text-xs">UF quando não informada
            <select className="input w-20 py-1" value={ufPadrao} disabled={!!busca} onChange={(e) => setUfPadrao(e.target.value)}>
              {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          {!busca && <button className="btn-primary py-1" disabled={!pendentes.length} onClick={buscar}>{linhas ? 'Buscar de novo' : 'Buscar endereços'}</button>}
          {busca && (
            <>
              <span className="text-xs">Buscando {busca.atual + 1} de {busca.total}…</span>
              <div className="h-2 w-40 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-leaf-700" style={{ width: `${Math.round((busca.atual / busca.total) * 100)}%` }} /></div>
              <button className="btn-secondary py-1" onClick={() => { parar.current = true }}>Parar</button>
            </>
          )}
        </div>

        {linhas && (
          <>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span><Chip cor="verde">encontrado</Chip> {cont('OK')}</span>
              <span><Chip cor="amarelo">escolher</Chip> {cont('AMBIGUO')}</span>
              <span><Chip cor="cinza">não encontrado</Chip> {cont('NAO_ENCONTRADO')}</span>
              <label className="flex items-center gap-1"><input type="checkbox" checked={soEncontrados} onChange={(e) => setSoEncontrados(e.target.checked)} /> só com sugestão</label>
              <span className="ml-auto" />
              <button className="btn-primary py-1" disabled={!marcados || !!busca} onClick={gravar}>Gravar selecionados ({marcados})</button>
            </div>
            <div className="card overflow-auto max-h-[calc(94vh-230px)]">
              <table className="tabela">
                <thead>
                  <tr>
                    <th className="px-2"><input type="checkbox" checked={marcados > 0 && marcados === (linhas ?? []).filter((l) => achadoDe(l)).length}
                      onChange={(e) => setLinhas((ls) => ls && ls.map((l) => ({ ...l, marcado: e.target.checked && !!achadoDe(l) })))} /></th>
                    <th className="px-2">Cód</th><th className="px-2">Cliente</th><th className="px-2">Endereço / cidade (atual)</th>
                    <th className="px-2">Bairro</th><th className="px-2">CEP</th><th className="px-2">UF</th><th className="px-2">Fonte</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((l) => {
                    const a = achadoDe(l)
                    const novo = a ? camposParaGravar(l.c, a) : {}
                    const cel = (atual: string | null, sugerido?: string) => atual?.trim()
                      ? <span className="text-slate-500" title="já preenchido, não será alterado">{atual}</span>
                      : sugerido ? <b className="text-leaf-800">{sugerido}</b> : <span className="text-slate-300">—</span>
                    return (
                      <tr key={l.c.id} className="border-t border-slate-100">
                        <td className="px-2"><input type="checkbox" disabled={!a || !Object.keys(novo).length} checked={l.marcado && !!a} onChange={(e) => alterar(l.c.id, { marcado: e.target.checked })} /></td>
                        <td className="text-slate-500">{l.c.codigo}</td>
                        <td className="px-2 font-semibold">{l.c.razao_social}</td>
                        <td className="px-2 text-[11px]">{l.c.endereco}<div className="text-slate-500">{l.c.cidade}</div></td>
                        {l.r?.status === 'AMBIGUO' && !a ? (
                          <td colSpan={3} className="px-2">
                            <select className="input py-1 text-[11px]" value={l.escolha} onChange={(e) => alterar(l.c.id, { escolha: Number(e.target.value), marcado: Number(e.target.value) >= 0 })}>
                              <option value={-1}>Escolha o CEP ({l.r.opcoes.length} na rua)…</option>
                              {l.r.opcoes.map((o, i) => <option key={o.cep} value={i}>{fmtCep(o.cep)} · {o.bairro ?? 'sem bairro'}</option>)}
                            </select>
                          </td>
                        ) : (
                          <>
                            <td className="px-2">{cel(l.c.bairro, novo.bairro)}</td>
                            <td className="px-2 whitespace-nowrap">{cel(l.c.cep, novo.cep)}</td>
                            <td className="px-2">{cel(l.c.uf, novo.uf)}</td>
                          </>
                        )}
                        <td className="px-2 text-[10px] text-slate-500">
                          {!l.r ? 'aguardando…' : l.r.status === 'NAO_ENCONTRADO' ? l.r.motivo : l.r.fonte}
                          {l.r?.status === 'AMBIGUO' && a && <button className="ml-1 underline" onClick={() => alterar(l.c.id, { escolha: -1, marcado: false })}>trocar</button>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-slate-400">Em verde: o que será gravado. Em cinza: já preenchido, fica como está. Confira antes de gravar — a busca pela rua pode trazer o bairro dos Correios com outro nome.</p>
          </>
        )}
      </div>
      {gravando && <Progresso titulo="Completando cadastros" atual={gravando.atual} total={gravando.total} />}
    </Modal>
  )
}
