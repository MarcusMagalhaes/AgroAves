import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import Logo, { LogoMark } from './Logo'
import { useAuth } from '@/lib/auth'
import { PAPEIS, ehAdmin, ehAdminTI } from '@/lib/types'

/** ti: item visível só para o administrador TI */
type Item = { to: string; label: string; icone: string; ti?: boolean }
type Grupo = { grupo: string; icone: string; itens: Item[] }
type Entrada = Item | Grupo

const menuAdmin: Entrada[] = [
  { grupo: 'Cadastros', icone: '🗂️', itens: [
    { to: '/clientes', label: 'Clientes e preços', icone: '👥' },
    { to: '/rotas', label: 'Rotas', icone: '🛣️' },
    { to: '/produtos', label: 'Produtos', icone: '🐣' },
    { to: '/vendedores', label: 'Vendedores', icone: '🧑‍💼' },
    { to: '/fornecedores', label: 'Fornecedores', icone: '🏢' },
    { to: '/usuarios', label: 'Usuários', icone: '🔐' },
    { to: '/centros-custo', label: 'Centros de custo', icone: '🌳', ti: true },
  ] },
  { to: '/venda', label: 'Venda semanal', icone: '🛒' },
  { to: '/programacao', label: 'Programação', icone: '📋' },
  { to: '/fornecedor', label: 'Pedido à granja', icone: '🏭' },
  { grupo: 'Impressões', icone: '🖨️', itens: [
    { to: '/documentos/mapa', label: 'Mapa de entrega', icone: '🗺️' },
    { to: '/documentos/recibos', label: 'Recibos', icone: '🧾' },
    { to: '/documentos/gta', label: 'GTA', icone: '📄' },
    { to: '/documentos/nf', label: 'Nota fiscal', icone: '🧮' },
  ] },
  { grupo: 'Financeiro', icone: '💰', itens: [
    { to: '/financeiro', label: 'Contas a receber', icone: '📥' },
    { to: '/contas-pagar', label: 'Contas a pagar', icone: '📤', ti: true },
  ] },
  { to: '/fechamento-geral', label: 'Fechamento geral', icone: '📚' },
  { to: '/auditoria', label: 'Auditoria', icone: '🔍' },
]
const menuVendedor: Entrada[] = [
  { to: '/venda', label: 'Venda semanal', icone: '🛒' },
  { to: '/mapa', label: 'Mapa da rota', icone: '🗺️' },
]
const ehGrupo = (e: Entrada): e is Grupo => 'grupo' in e

export default function Layout() {
  const { usuario, sair } = useAuth()
  const [aberto, setAberto] = useState(false)          // drawer no celular
  const [recolhido, setRecolhido] = useState(() => { try { return localStorage.getItem('menuRecolhido') === '1' } catch { return false } })
  const { pathname } = useLocation()
  const [gruposFechados, setGruposFechados] = useState<Record<string, boolean>>({})
  // ao navegar, os submenus voltam ao padrão: aberto só o grupo da página atual
  useEffect(() => { setGruposFechados({}) }, [pathname])
  const [grupoTopo, setGrupoTopo] = useState<string | null>(null)
  const refTopo = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!grupoTopo) return
    const h = (e: MouseEvent) => { if (refTopo.current && !refTopo.current.contains(e.target as Node)) setGrupoTopo(null) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [grupoTopo])
  useEffect(() => { try { localStorage.setItem('menuRecolhido', recolhido ? '1' : '0') } catch { /* ignore */ } }, [recolhido])
  const menu = (ehAdmin(usuario) ? menuAdmin : menuVendedor)
    .map((e) => ehGrupo(e) ? { ...e, itens: e.itens.filter((i) => !i.ti || ehAdminTI(usuario)) } : e)
    .filter((e) => ehGrupo(e) ? e.itens.length > 0 : !e.ti || ehAdminTI(usuario))
    // grupo que ficou com um item só (ex.: Financeiro para quem não é TI) volta a ser um link simples
    .map((e): Entrada => ehGrupo(e) && e.itens.length === 1 ? { ...e.itens[0], label: e.grupo, icone: e.icone } : e)

  const link = (m: Item, sub = false) => (
    <NavLink key={m.to} to={m.to} onClick={() => { setAberto(false); setGruposFechados({}) }}
      className={({ isActive }) => `flex items-center gap-2 rounded-lg px-2.5 whitespace-nowrap ${sub ? 'py-1 ml-3 text-xs' : 'py-1.5 text-[13px]'} font-medium transition ${isActive ? 'bg-leaf-900 text-white' : 'text-slate-700 hover:bg-leaf-50'}`}>
      <span className="text-base leading-none">{m.icone}</span>{m.label}
    </NavLink>
  )
  const nav = (
    <nav className="flex flex-col gap-0.5 p-3">
      {menu.map((m) => {
        if (!ehGrupo(m)) return link(m)
        const ativo = m.itens.some((i) => pathname.startsWith(i.to))
        const abertoG = gruposFechados[m.grupo] === undefined ? ativo : !gruposFechados[m.grupo]
        return (
          <div key={m.grupo}>
            <button onClick={() => setGruposFechados({ ...gruposFechados, [m.grupo]: abertoG })}
              className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition whitespace-nowrap ${ativo ? 'text-leaf-900 font-bold' : 'text-slate-700'} hover:bg-leaf-50`}>
              <span className="text-base leading-none">{m.icone}</span>{m.grupo}<span className="ml-auto text-xs">{abertoG ? '▾' : '▸'}</span>
            </button>
            {abertoG && <div className="flex flex-col gap-0.5 mt-0.5">{m.itens.map((i) => link(i, true))}</div>}
          </div>
        )
      })}
    </nav>
  )
  const rodape = (
    <div className="p-3 border-t border-slate-200 text-xs">
      <div className="font-semibold truncate text-slate-800">{usuario?.nome}</div>
      <div className="text-slate-500 truncate">{usuario ? PAPEIS[usuario.papel] : ''}</div>
      <button className="mt-2 text-brand-600 font-semibold underline" onClick={sair}>Sair</button>
    </div>
  )

  return (
    <div className="flex h-full">
      {/* Sidebar desktop (recolhível) */}
      <aside className={`hidden md:flex flex-col bg-white border-r border-slate-200 no-print transition-all ${recolhido ? 'w-0 overflow-hidden border-r-0' : 'w-52'}`}>
        <div className="p-3 border-b-4 border-brand-600 flex items-center justify-between gap-2">
          <Logo size={34} />
          <button className="rounded p-1 text-slate-500 hover:bg-slate-100" title="Esconder menu" onClick={() => setRecolhido(true)}>«</button>
        </div>
        <div className="flex-1 overflow-auto">{nav}</div>
        {rodape}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barra superior mobile */}
        <header className="md:hidden flex items-center justify-between bg-white border-b-4 border-brand-600 px-3 py-1.5 no-print">
          <button className="rounded p-2 text-2xl leading-none text-leaf-900" onClick={() => setAberto(true)} aria-label="Menu">☰</button>
          <Logo size={30} />
          <button className="text-xs text-brand-600 font-semibold px-2" onClick={sair}>Sair</button>
        </header>
        {/* Barra fina no desktop quando o menu está escondido */}
        {recolhido && (
          <div className="hidden md:flex items-center gap-3 bg-white border-b border-slate-200 px-3 py-1 no-print">
            <button className="rounded p-1 text-slate-600 hover:bg-slate-100 text-lg leading-none" title="Mostrar menu" onClick={() => setRecolhido(false)}>☰</button>
            <LogoMark size={26} />
            <nav ref={refTopo} className="flex gap-1 overflow-visible items-center">
              {menu.map((m) => ehGrupo(m) ? (
                <div key={m.grupo} className="relative">
                  <button onClick={() => setGrupoTopo(grupoTopo === m.grupo ? null : m.grupo)} className={`rounded px-2 py-1 text-xs font-medium whitespace-nowrap ${m.itens.some((i) => pathname.startsWith(i.to)) ? 'bg-leaf-900 text-white' : 'text-slate-600 hover:bg-leaf-50'}`}>
                    {m.icone} <span className="hidden xl:inline">{m.grupo}</span> ▾
                  </button>
                  {grupoTopo === m.grupo && (
                    <div className="absolute z-40 left-0 top-full pt-1 w-48"><div className="rounded-lg border border-slate-200 bg-white shadow-lg py-1">
                      {m.itens.map((i) => <NavLink key={i.to} to={i.to} onClick={() => setGrupoTopo(null)} className={({ isActive }) => `block px-3 py-1.5 text-xs ${isActive ? 'bg-leaf-900 text-white' : 'text-slate-700 hover:bg-leaf-50'}`}>{i.icone} {i.label}</NavLink>)}
                    </div></div>
                  )}
                </div>
              ) : (
                <NavLink key={m.to} to={m.to} className={({ isActive }) => `rounded px-2 py-1 text-xs font-medium whitespace-nowrap ${isActive ? 'bg-leaf-900 text-white' : 'text-slate-600 hover:bg-leaf-50'}`} title={m.label}>
                  {m.icone} <span className="hidden xl:inline">{m.label}</span>
                </NavLink>
              ))}
            </nav>
            <button className="ml-auto text-xs text-brand-600 font-semibold" onClick={sair}>Sair</button>
          </div>
        )}
        <main className="flex-1 overflow-auto px-2 pb-2 pt-1">
          <Outlet />
        </main>
      </div>

      {/* Drawer mobile */}
      {aberto && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setAberto(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <aside className="absolute left-0 top-0 h-full w-72 bg-white shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b-4 border-brand-600 flex items-center justify-between">
              <Logo size={34} />
              <button onClick={() => setAberto(false)} className="text-xl text-slate-500">✕</button>
            </div>
            <div className="flex-1 overflow-auto">{nav}</div>
            {rodape}
          </aside>
        </div>
      )}
    </div>
  )
}
