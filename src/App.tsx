import type React from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/lib/auth'
import { ToastProvider, Carregando } from '@/components/ui'
import Layout from '@/components/Layout'
import Login from '@/pages/Login'
import Venda from '@/pages/Venda'
import Mapa from '@/pages/Mapa'
import Clientes from '@/pages/admin/Clientes'
import Rotas from '@/pages/admin/Rotas'
import Produtos from '@/pages/admin/Produtos'
import Vendedores from '@/pages/admin/Vendedores'
import Fornecedores from '@/pages/admin/Fornecedores'
import Usuarios from '@/pages/admin/Usuarios'
import Programacao from '@/pages/admin/Programacao'
import PedidoFornecedor from '@/pages/admin/PedidoFornecedor'
import AjusteEntrega from '@/pages/admin/AjusteEntrega'
import Documentos from '@/pages/admin/Documentos'
import Financeiro from '@/pages/admin/Financeiro'
import Fechamento from '@/pages/admin/Fechamento'

function Protegido({ admin, children }: { admin?: boolean; children: React.ReactElement }) {
  const { usuario } = useAuth()
  if (!usuario) return <Navigate to="/login" replace />
  if (admin && usuario.papel !== 'ADMIN') return <Navigate to="/venda" replace />
  return children
}

function Rotas_() {
  const { usuario, carregando, session } = useAuth()
  if (carregando) return <Carregando texto="Iniciando…" />
  // sessão existe mas sem cadastro: mostra login com a mensagem de erro
  if (!usuario && session) return <Login />
  return (
    <Routes>
      <Route path="/login" element={usuario ? <Navigate to="/venda" replace /> : <Login />} />
      <Route element={<Protegido><Layout /></Protegido>}>
        <Route index element={<Navigate to="/venda" replace />} />
        <Route path="/venda" element={<Venda />} />
        <Route path="/mapa" element={<Mapa />} />
        <Route path="/programacao" element={<Protegido admin><Programacao /></Protegido>} />
        <Route path="/fornecedor" element={<Protegido admin><PedidoFornecedor /></Protegido>} />
        <Route path="/ajuste" element={<Protegido admin><AjusteEntrega /></Protegido>} />
        <Route path="/documentos" element={<Protegido admin><Documentos /></Protegido>} />
        <Route path="/financeiro" element={<Protegido admin><Financeiro /></Protegido>} />
        <Route path="/fechamento" element={<Protegido admin><Fechamento /></Protegido>} />
        <Route path="/clientes" element={<Protegido admin><Clientes /></Protegido>} />
        <Route path="/rotas" element={<Protegido admin><Rotas /></Protegido>} />
        <Route path="/produtos" element={<Protegido admin><Produtos /></Protegido>} />
        <Route path="/vendedores" element={<Protegido admin><Vendedores /></Protegido>} />
        <Route path="/fornecedores" element={<Protegido admin><Fornecedores /></Protegido>} />
        <Route path="/usuarios" element={<Protegido admin><Usuarios /></Protegido>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <ToastProvider>
          <Rotas_ />
        </ToastProvider>
      </AuthProvider>
    </HashRouter>
  )
}
