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
import CentrosCusto from '@/pages/admin/CentrosCusto'
import Programacao from '@/pages/admin/Programacao'
import PedidoFornecedor from '@/pages/admin/PedidoFornecedor'
import AjusteEntrega from '@/pages/admin/AjusteEntrega'
import Documentos from '@/pages/admin/Documentos'
import Financeiro from '@/pages/admin/Financeiro'
import ContasPagar from '@/pages/admin/ContasPagar'
import Fechamento from '@/pages/admin/Fechamento'
import Auditoria from '@/pages/admin/Auditoria'
import Dashboard from '@/pages/admin/Dashboard'
import DashboardFinanceiro from '@/pages/admin/DashboardFinanceiro'
import { ehAdmin, ehAdminTI } from '@/lib/types'

/** admin: ADMIN ou ADMIN_TI · ti: somente ADMIN_TI (telas exclusivas da TI) */
function Protegido({ admin, ti, children }: { admin?: boolean; ti?: boolean; children: React.ReactElement }) {
  const { usuario } = useAuth()
  if (!usuario) return <Navigate to="/login" replace />
  if (admin && !ehAdmin(usuario)) return <Navigate to="/venda" replace />
  if (ti && !ehAdminTI(usuario)) return <Navigate to="/venda" replace />
  return children
}

function Rotas_() {
  const { usuario, carregando, session } = useAuth()
  if (carregando) return <Carregando texto="Iniciando…" />
  // sessão existe mas sem cadastro: mostra login com a mensagem de erro
  if (!usuario && session) return <Login />
  // página inicial: administradores no dashboard de vendas; vendedor na venda semanal
  const inicio = ehAdmin(usuario) ? '/dashboard' : '/venda'
  return (
    <Routes>
      <Route path="/login" element={usuario ? <Navigate to={inicio} replace /> : <Login />} />
      <Route element={<Protegido><Layout /></Protegido>}>
        <Route index element={<Navigate to={inicio} replace />} />
        <Route path="/dashboard" element={<Protegido admin><Dashboard /></Protegido>} />
        <Route path="/dashboard-financeiro" element={<Protegido ti><DashboardFinanceiro /></Protegido>} />
        <Route path="/venda" element={<Venda />} />
        <Route path="/mapa" element={<Mapa />} />
        <Route path="/programacao" element={<Protegido admin><Programacao key="programacao" /></Protegido>} />
        <Route path="/fornecedor" element={<Protegido admin><PedidoFornecedor /></Protegido>} />
        <Route path="/ajuste" element={<Protegido admin><AjusteEntrega /></Protegido>} />
        <Route path="/documentos" element={<Navigate to="/documentos/mapa" replace />} />
        <Route path="/documentos/:doc" element={<Protegido admin><Documentos /></Protegido>} />
        <Route path="/financeiro" element={<Protegido admin><Financeiro /></Protegido>} />
        <Route path="/contas-pagar" element={<Protegido ti><ContasPagar /></Protegido>} />
        <Route path="/fechamento-geral" element={<Protegido admin><Programacao key="fechamento-geral" historico /></Protegido>} />
        <Route path="/fechamento" element={<Protegido admin><Fechamento /></Protegido>} />
        <Route path="/auditoria" element={<Protegido admin><Auditoria /></Protegido>} />
        <Route path="/clientes" element={<Protegido admin><Clientes /></Protegido>} />
        <Route path="/rotas" element={<Protegido admin><Rotas /></Protegido>} />
        <Route path="/produtos" element={<Protegido admin><Produtos /></Protegido>} />
        <Route path="/vendedores" element={<Protegido admin><Vendedores /></Protegido>} />
        <Route path="/fornecedores" element={<Protegido admin><Fornecedores /></Protegido>} />
        <Route path="/usuarios" element={<Protegido admin><Usuarios /></Protegido>} />
        <Route path="/centros-custo" element={<Protegido ti><CentrosCusto /></Protegido>} />
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
