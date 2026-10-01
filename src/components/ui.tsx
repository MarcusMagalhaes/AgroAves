import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

// ---------- Toast ----------
type Toast = { id: number; tipo: 'ok' | 'erro' | 'info'; msg: string }
const ToastCtx = createContext<{ toast: (msg: string, tipo?: Toast['tipo']) => void }>({ toast: () => {} })
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<Toast[]>([])
  const seq = useRef(0)
  const toast = (msg: string, tipo: Toast['tipo'] = 'ok') => {
    const id = ++seq.current
    setLista((l) => [...l, { id, tipo, msg }])
    setTimeout(() => setLista((l) => l.filter((t) => t.id !== id)), tipo === 'erro' ? 6000 : 3000)
  }
  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 flex-col gap-2 px-4 w-full max-w-md no-print">
        {lista.map((t) => (
          <div key={t.id} className={`rounded-lg px-4 py-3 text-sm font-medium shadow-lg text-white ${t.tipo === 'erro' ? 'bg-red-600' : t.tipo === 'info' ? 'bg-slate-700' : 'bg-leaf-600'}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

// ---------- Modal ----------
export function Modal({ aberto, titulo, onFechar, children, largura = 'max-w-2xl' }:
  { aberto: boolean; titulo: string; onFechar: () => void; children: ReactNode; largura?: string }) {
  useEffect(() => {
    if (!aberto) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onFechar()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [aberto, onFechar])
  if (!aberto) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onFechar}>
      <div className={`card w-full ${largura} max-h-[95vh] overflow-auto rounded-b-none sm:rounded-b-xl`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-bold text-slate-800">{titulo}</h2>
          <button className="rounded-full p-2 text-slate-500 hover:bg-slate-100" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

// ---------- Confirmação ----------
export function Confirmar({ aberto, titulo, texto, onSim, onNao, perigo }:
  { aberto: boolean; titulo: string; texto: string; onSim: () => void; onNao: () => void; perigo?: boolean }) {
  return (
    <Modal aberto={aberto} titulo={titulo} onFechar={onNao} largura="max-w-md">
      <p className="text-slate-700 mb-5 whitespace-pre-line">{texto}</p>
      <div className="flex justify-end gap-2">
        <button className="btn-secondary" onClick={onNao}>Não</button>
        <button className={perigo ? 'btn-danger' : 'btn-primary'} onClick={onSim}>Sim</button>
      </div>
    </Modal>
  )
}

// ---------- Campos ----------
export function Campo({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`campo flex flex-col ${className}`}>
      <label className="label">{label}</label>
      {children}
    </div>
  )
}

export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return (
    <div className="flex items-center gap-3 p-6 text-slate-500">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-leaf-500 border-t-transparent" /> {texto}
    </div>
  )
}

export function Vazio({ texto }: { texto: string }) {
  return <div className="p-8 text-center text-slate-400">{texto}</div>
}

export function Titulo({ children, acoes }: { children: ReactNode; acoes?: ReactNode }) {
  return (
    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-sm font-extrabold text-leaf-900">{children}</h1>
      {acoes && <div className="flex flex-wrap gap-1.5">{acoes}</div>}
    </div>
  )
}

export function Chip({ cor, children }: { cor: 'verde' | 'amarelo' | 'vermelho' | 'cinza' | 'azul'; children: ReactNode }) {
  const m = {
    verde: 'bg-leaf-100 text-leaf-800', amarelo: 'bg-amber-100 text-amber-800', vermelho: 'bg-red-100 text-red-800',
    cinza: 'bg-slate-100 text-slate-600', azul: 'bg-sky-100 text-sky-800',
  }
  return <span className={`chip ${m[cor]}`}>{children}</span>
}
