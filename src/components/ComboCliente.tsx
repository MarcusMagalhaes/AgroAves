// Caixa de seleção com busca por digitação (substitui o <select> nativo): clientes na tela de venda, centros de custo no contas a pagar
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { normalizar } from '@/lib/format'

/** recuo: nível na lista aberta (árvore); o valor escolhido aparece sem recuo */
export interface OpcaoCombo { id: number; rotulo: string; sufixo?: string; recuo?: number }

export default function ComboCliente({ opcoes, valor, onChange, placeholder = 'digite para pesquisar…', className = '',
  flutuante = false, textoVazio = 'Nenhum cliente', textoSemResultado = 'Nenhum cliente encontrado', classeInput = 'input py-1 px-2 pr-7 text-sm bg-yellow-50 font-bold w-full' }:
  { opcoes: OpcaoCombo[]; valor: number | null; onChange: (id: number) => void; placeholder?: string; className?: string
    textoVazio?: string; textoSemResultado?: string; classeInput?: string
    /** lista em posição fixa na tela: não é cortada por janelas (modal) com rolagem */
    flutuante?: boolean }) {
  const [aberto, setAberto] = useState(false)
  const [texto, setTexto] = useState('')
  const [ativo, setAtivo] = useState(0)
  const caixa = useRef<HTMLDivElement>(null)
  const lista = useRef<HTMLDivElement>(null)
  const selecionado = opcoes.find((o) => o.id === valor) ?? null
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  useEffect(() => {
    if (!aberto || !flutuante) return
    const medir = () => { const r = caixa.current?.getBoundingClientRect(); if (r) setPos({ top: r.bottom + 2, left: r.left, width: Math.max(r.width, 260) }) }
    medir()
    window.addEventListener('scroll', medir, true); window.addEventListener('resize', medir)
    return () => { window.removeEventListener('scroll', medir, true); window.removeEventListener('resize', medir) }
  }, [aberto, flutuante])

  const filtradas = useMemo(() => {
    const t = normalizar(texto).trim().split(/\s+/).filter(Boolean)
    if (!t.length) return opcoes
    return opcoes.filter((o) => { const n = normalizar(o.rotulo); return t.every((p) => n.includes(p)) })
  }, [opcoes, texto])

  useEffect(() => { setAtivo(0) }, [texto, aberto])
  useEffect(() => {
    const h = (e: MouseEvent) => {
      const alvo = e.target as Node
      if (caixa.current && !caixa.current.contains(alvo) && !lista.current?.contains(alvo)) fechar()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  useEffect(() => {
    if (!aberto || !lista.current) return
    const el = lista.current.children[ativo] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [ativo, aberto])

  function fechar() { setAberto(false); setTexto('') }
  function escolher(o: OpcaoCombo) { onChange(o.id); fechar() }
  function teclado(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!aberto && (e.key === 'ArrowDown' || e.key === 'Enter')) { setAberto(true); e.preventDefault(); return }
    if (e.key === 'ArrowDown') { setAtivo((a) => Math.min(filtradas.length - 1, a + 1)); e.preventDefault() }
    else if (e.key === 'ArrowUp') { setAtivo((a) => Math.max(0, a - 1)); e.preventDefault() }
    else if (e.key === 'Enter') { if (filtradas[ativo]) escolher(filtradas[ativo]); e.preventDefault() }
    else if (e.key === 'Escape') { fechar(); (e.target as HTMLInputElement).blur() }
  }

  // escolhe no clique (não no mousedown): o clique termina na própria lista e não vaza para o fundo de um modal
  const listaEl = (
        <div ref={lista} style={flutuante && pos ? { position: 'fixed', top: pos.top, left: pos.left, width: pos.width, maxHeight: `min(18rem, calc(100vh - ${pos.top + 8}px))` } : undefined}
          className={`${flutuante ? 'z-[60]' : 'absolute z-30 left-0 right-0 mt-0.5'} max-h-72 overflow-auto rounded-lg border border-slate-300 bg-white shadow-lg text-sm`}>
          {filtradas.length === 0 && <div className="px-3 py-2 text-slate-400">{textoSemResultado}</div>}
          {filtradas.map((o, i) => (
            <div key={o.id} onMouseDown={(e) => e.preventDefault()} onClick={() => escolher(o)} onMouseEnter={() => setAtivo(i)}
              style={o.recuo ? { paddingLeft: `${0.75 + o.recuo * 1.1}rem` } : undefined}
              className={`px-3 py-1 cursor-pointer whitespace-nowrap overflow-hidden text-ellipsis ${i === ativo ? 'bg-leaf-900 text-white' : o.id === valor ? 'bg-leaf-50 font-bold' : ''}`}>
              {o.rotulo}{o.sufixo ? <span className="ml-2 opacity-80">{o.sufixo}</span> : null}
            </div>
          ))}
        </div>
  )

  return (
    <div ref={caixa} className={`relative ${className}`}>
      <input
        className={classeInput}
        value={aberto ? texto : (selecionado?.rotulo ?? '')}
        placeholder={aberto ? placeholder : textoVazio}
        onFocus={() => setAberto(true)}
        onClick={() => setAberto(true)}
        onChange={(e) => { setTexto(e.target.value); setAberto(true) }}
        onKeyDown={teclado}
        title={selecionado?.rotulo}
      />
      <button type="button" tabIndex={-1} className="absolute right-1 top-1/2 -translate-y-1/2 px-1 text-slate-500" onMouseDown={(e) => { e.preventDefault(); aberto ? fechar() : setAberto(true) }}>▾</button>
      {aberto && (flutuante ? (pos && createPortal(listaEl, document.body)) : listaEl)}
    </div>
  )
}
