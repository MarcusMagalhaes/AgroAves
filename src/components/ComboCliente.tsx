// Caixa de seleção de cliente com busca por digitação (substitui o <select> nativo na tela de venda)
import { useEffect, useMemo, useRef, useState } from 'react'
import { normalizar } from '@/lib/format'

export interface OpcaoCombo { id: number; rotulo: string; sufixo?: string }

export default function ComboCliente({ opcoes, valor, onChange, placeholder = 'digite para pesquisar…', className = '' }:
  { opcoes: OpcaoCombo[]; valor: number | null; onChange: (id: number) => void; placeholder?: string; className?: string }) {
  const [aberto, setAberto] = useState(false)
  const [texto, setTexto] = useState('')
  const [ativo, setAtivo] = useState(0)
  const caixa = useRef<HTMLDivElement>(null)
  const lista = useRef<HTMLDivElement>(null)
  const selecionado = opcoes.find((o) => o.id === valor) ?? null

  const filtradas = useMemo(() => {
    const t = normalizar(texto).trim().split(/\s+/).filter(Boolean)
    if (!t.length) return opcoes
    return opcoes.filter((o) => { const n = normalizar(o.rotulo); return t.every((p) => n.includes(p)) })
  }, [opcoes, texto])

  useEffect(() => { setAtivo(0) }, [texto, aberto])
  useEffect(() => {
    const h = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) fechar() }
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

  return (
    <div ref={caixa} className={`relative ${className}`}>
      <input
        className="input py-1 px-2 pr-7 text-sm bg-yellow-50 font-bold w-full"
        value={aberto ? texto : (selecionado?.rotulo ?? '')}
        placeholder={aberto ? placeholder : 'Nenhum cliente'}
        onFocus={() => setAberto(true)}
        onClick={() => setAberto(true)}
        onChange={(e) => { setTexto(e.target.value); setAberto(true) }}
        onKeyDown={teclado}
        title={selecionado?.rotulo}
      />
      <button type="button" tabIndex={-1} className="absolute right-1 top-1/2 -translate-y-1/2 px-1 text-slate-500" onMouseDown={(e) => { e.preventDefault(); aberto ? fechar() : setAberto(true) }}>▾</button>
      {aberto && (
        <div ref={lista} className="absolute z-30 left-0 right-0 mt-0.5 max-h-72 overflow-auto rounded-lg border border-slate-300 bg-white shadow-lg text-sm">
          {filtradas.length === 0 && <div className="px-3 py-2 text-slate-400">Nenhum cliente encontrado</div>}
          {filtradas.map((o, i) => (
            <div key={o.id} onMouseDown={(e) => { e.preventDefault(); escolher(o) }} onMouseEnter={() => setAtivo(i)}
              className={`px-3 py-1 cursor-pointer whitespace-nowrap overflow-hidden text-ellipsis ${i === ativo ? 'bg-leaf-900 text-white' : o.id === valor ? 'bg-leaf-50 font-bold' : ''}`}>
              {o.rotulo}{o.sufixo ? <span className="ml-2 opacity-80">{o.sufixo}</span> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
