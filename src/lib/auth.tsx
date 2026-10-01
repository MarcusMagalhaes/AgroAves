import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Usuario } from './types'

interface AuthCtx {
  session: Session | null
  usuario: Usuario | null
  carregando: boolean
  erro: string | null
  entrar: (email: string, senha: string) => Promise<void>
  sair: () => Promise<void>
}

const Ctx = createContext<AuthCtx>(null!)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  async function carregarUsuario(s: Session | null) {
    if (!s) { setUsuario(null); return }
    const { data, error } = await supabase.from('usuario').select('*').eq('id', s.user.id).maybeSingle()
    if (error) { setErro(error.message); setUsuario(null); return }
    if (!data) { setErro('Sua conta foi reconhecida, mas ainda não está cadastrada no sistema. Peça ao administrador para liberar o acesso.'); setUsuario(null); return }
    if (!data.ativo) { setErro(`Olá, ${data.nome}. Seu acesso está aguardando liberação pelo administrador.`); setUsuario(null); return }
    setErro(null)
    setUsuario(data as Usuario)
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await carregarUsuario(data.session)
      setCarregando(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      setSession(s)
      await carregarUsuario(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  async function entrar(email: string, senha: string) {
    setErro(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'E-mail ou senha inválidos' : error.message)
  }
  async function sair() { await supabase.auth.signOut(); setUsuario(null) }

  return <Ctx.Provider value={{ session, usuario, carregando, erro, entrar, sair }}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
