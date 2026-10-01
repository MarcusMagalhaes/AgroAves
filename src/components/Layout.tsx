import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import Logo, { LogoMark } from './Logo'
import { useAuth } from '@/lib/auth'

const menuAdmin = [
  { to: '/venda', label: 'Venda semanal', icone: '🛒' },
  { to: '/programacao', label: 'Programação (planilha)', icone: '📋' },
  { to: '/fornecedor', label: 'Pedido à granja', icone: '🏭' },
  { to: '/ajuste', label: 'Ajuste da entrega', icone: '⚖️' },
  { to: '/documentos', label: 'Mapa, recibos, GTA, NF', icone: '🖨️' },
  { to: '/financeiro', label: 'Financeiro', icone: '💰' },
  { to: '/fechamento', label: 'Fechamento semanal', icone: '📅' },
  { sep: true },
  { to: '/clientes', label: 'Clientes e preços', icone: '👥' },
  { to: '/rotas', label: 'Rotas', icone: '🛣️' },
  { to: '/produtos', label: 'Produtos', icone: '🐣' },
  { to: '/vendedores', label: 'Vendedores', icone: '🧑‍💼' },
  { to: '/fornecedores', label: 'Fornecedores', icone: '🏢' },
  { to: '/usuarios', label: 'Usuários', icone: '🔐' },
]
const menuVendedor = [
  { to: '/venda', label: 'Venda semanal', icone: '🛒' },
  { to: '/mapa', label: 'Mapa da rota', icone: '🗺️' },
]

export default function Layout() {
  const { usuario, sair } = useAuth()
  const [aberto, setAberto] = useState(false)          // drawer no celular
  const [recolhido, setRecolhido] = useState(() => { try { return localStorage.getItem('menuRecolhido') === '1' } catch { return false } })
  useEffect(() => { try { localStorage.setItem('menuRecolhido', recolhido ? '1' : '0') } catch { /* ignore */ } }, [recolhido])
  const menu = usuario?.papel === 'ADMIN' ? menuAdmin : menuVendedor

  const nav = (
    <nav className="flex flex-col gap-0.5 p-3">
      {menu.map((m, i) =>
        'sep' in m ? <hr key={i} className="my-2 border-slate-200" /> : (
          <NavLink key={m.to} to={m.to!} onClick={() => setAberto(false)}
            className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${isActive ? 'bg-leaf-900 text-white' : 'text-slate-700 hover:bg-leaf-50'}`}>
            <span className="text-lg leading-none">{m.icone}</span>{m.label}
          </NavLink>
        ))}
    </nav>
  )
  const rodape = (
    <div className="p-3 border-t border-slate-200 text-xs">
      <div className="font-semibold truncate text-slate-800">{usuario?.nome}</div>
      <div className="text-slate-500 truncate">{usuario?.papel === 'ADMIN' ? 'Administrador' : 'Vendedor'}</div>
      <button className="mt-2 text-brand-600 font-semibold underline" onClick={sair}>Sair</button>
    </div>
  )

  return (
    <div className="flex h-full">
      {/* Sidebar desktop (recolhível) */}
      <aside className={`hidden md:flex flex-col bg-white border-r border-slate-200 no-print transition-all ${recolhido ? 'w-0 overflow-hidden border-r-0' : 'w-64'}`}>
        <div className="p-4 border-b-4 border-brand-600 flex items-center justify-between gap-2">
          <Logo size={40} />
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
            <nav className="flex gap-1 overflow-auto">
              {menu.filter((m) => !('sep' in m)).map((m) => (
                <NavLink key={m.to} to={m.to!} className={({ isActive }) => `rounded px-2 py-1 text-xs font-medium whitespace-nowrap ${isActive ? 'bg-leaf-900 text-white' : 'text-slate-600 hover:bg-leaf-50'}`} title={m.label}>
                  {m.icone} <span className="hidden xl:inline">{m.label}</span>
                </NavLink>
              ))}
            </nav>
            <button className="ml-auto text-xs text-brand-600 font-semibold" onClick={sair}>Sair</button>
          </div>
        )}
        <main className="flex-1 overflow-auto p-2 sm:p-4">
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
