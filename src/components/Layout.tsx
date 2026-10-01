import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import Logo from './Logo'
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
  const [aberto, setAberto] = useState(false)
  const menu = usuario?.papel === 'ADMIN' ? menuAdmin : menuVendedor

  const nav = (
    <nav className="flex flex-col gap-0.5 p-3">
      {menu.map((m, i) =>
        'sep' in m ? <hr key={i} className="my-2 border-leaf-700" /> : (
          <NavLink key={m.to} to={m.to!} onClick={() => setAberto(false)}
            className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${isActive ? 'bg-leaf-600 text-white' : 'text-leaf-100 hover:bg-leaf-700'}`}>
            <span className="text-lg leading-none">{m.icone}</span>{m.label}
          </NavLink>
        ))}
    </nav>
  )

  return (
    <div className="flex h-full">
      {/* Sidebar desktop */}
      <aside className="hidden md:flex w-64 flex-col bg-leaf-800 text-white no-print">
        <div className="p-4 border-b border-leaf-700"><Logo variant="light" size={36} /></div>
        <div className="flex-1 overflow-auto">{nav}</div>
        <div className="p-3 border-t border-leaf-700 text-xs">
          <div className="font-semibold truncate">{usuario?.nome}</div>
          <div className="text-leaf-200 truncate">{usuario?.papel === 'ADMIN' ? 'Administrador' : 'Vendedor'}</div>
          <button className="mt-2 text-leaf-100 underline" onClick={sair}>Sair</button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barra superior mobile */}
        <header className="md:hidden flex items-center justify-between bg-leaf-800 px-3 py-2 text-white no-print">
          <button className="rounded p-2 text-2xl leading-none" onClick={() => setAberto(true)} aria-label="Menu">☰</button>
          <Logo variant="light" size={28} />
          <button className="text-xs text-leaf-100 px-2" onClick={sair}>Sair</button>
        </header>
        <main className="flex-1 overflow-auto p-3 sm:p-5">
          <Outlet />
        </main>
      </div>

      {/* Drawer mobile */}
      {aberto && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setAberto(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <aside className="absolute left-0 top-0 h-full w-72 bg-leaf-800 text-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-leaf-700 flex items-center justify-between">
              <Logo variant="light" size={32} />
              <button onClick={() => setAberto(false)} className="text-xl">✕</button>
            </div>
            {nav}
            <div className="p-4 text-xs text-leaf-200">{usuario?.nome} · {usuario?.papel === 'ADMIN' ? 'Administrador' : 'Vendedor'}</div>
          </aside>
        </div>
      )}
    </div>
  )
}
