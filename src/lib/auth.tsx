import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Usuario } from './types'

const metodoSessao = (s: Session | null) => (s?.user.app_metadata?.provider === 'google' ? 'google' : 'senha')

interface AuthCtx {
  session: Session | null
  usuario: Usuario | null
  carregando: boolean
  erro: string | null
  entrar: (email: string, senha: string) => Promise<void>
  sair: () => Promise<void>
}

const Ctx = createContext<AuthCtx>(null!)

/** Grava evento de login/logout na auditoria (não interrompe o fluxo se falhar) */
async function registrarLogin(email: string | null | undefined, evento: 'LOGIN_OK' | 'LOGIN_FALHA' | 'LOGOUT', motivo?: string, metodo?: string) {
  try {
    await supabase.rpc('registrar_login', { p_email: email ?? '', p_evento: evento, p_motivo: motivo ?? null, p_metodo: metodo ?? null, p_agente: navigator.userAgent })
  } catch { /* auditoria nunca bloqueia o uso */ }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  async function carregarUsuario(s: Session | null) {
    if (!s) { setUsuario(null); return }
    const { data, error } = await supabase.from('usuario').select('*').eq('id', s.user.id).maybeSingle()
    if (error) { setErro(error.message); setUsuario(null); return }
    if (!data) { setErro('Sua conta foi reconhecida, mas ainda não está cadastrada no sistema. Peça ao administrador para liberar o acesso.'); setUsuario(null); registrarLogin(s.user.email, 'LOGIN_FALHA', 'sem cadastro no sistema', metodoSessao(s)); return }
    if (!data.ativo) { setErro(`Olá, ${data.nome}. Seu acesso está aguardando liberação pelo administrador.`); setUsuario(null); registrarLogin(s.user.email, 'LOGIN_FALHA', 'aguardando liberação / desativado', metodoSessao(s)); return }
    setErro(null)
    setUsuario(data as Usuario)
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await carregarUsuario(data.session)
      setCarregando(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange(async (evento, s) => {
      setSession(s)
      if (evento === 'SIGNED_IN' && s) {
        // SIGNED_IN acontece no login de fato (Google ou senha); INITIAL_SESSION é só a sessão lembrada
        const { data } = await supabase.from('usuario').select('ativo').eq('id', s.user.id).maybeSingle()
        if (data?.ativo) registrarLogin(s.user.email, 'LOGIN_OK', undefined, metodoSessao(s))
      }
      await carregarUsuario(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  async function entrar(email: string, senha: string) {
    setErro(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    if (error) {
      registrarLogin(email, 'LOGIN_FALHA', error.message === 'Invalid login credentials' ? 'e-mail ou senha inválidos' : error.message, 'senha')
      throw new Error(error.message === 'Invalid login credentials' ? 'E-mail ou senha inválidos' : error.message)
    }
  }
  async function sair() { await registrarLogin(session?.user.email, 'LOGOUT', undefined, metodoSessao(session)); await supabase.auth.signOut(); setUsuario(null) }

  return <Ctx.Provider value={{ session, usuario, carregando, erro, entrar, sair }}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
