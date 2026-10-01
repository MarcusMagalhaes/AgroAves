import { useState, type FormEvent } from 'react'
import Logo from '@/components/Logo'
import { useAuth } from '@/lib/auth'
import { supabase, supabaseConfigurado } from '@/lib/supabase'

export default function Login() {
  const { entrar, erro, session, sair } = useAuth()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [comSenha, setComSenha] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setMsg(null); setOcupado(true)
    try { await entrar(email.trim(), senha) } catch (err: any) { setMsg(err.message) } finally { setOcupado(false) }
  }

  async function google() {
    setMsg(null); setOcupado(true)
    const redirectTo = window.location.origin + window.location.pathname
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })
    if (error) { setMsg(error.message); setOcupado(false) }
  }

  return (
    <div className="min-h-full flex items-center justify-center bg-gradient-to-br from-leaf-800 via-leaf-700 to-leaf-900 p-4">
      <div className="card w-full max-w-sm p-6 sm:p-8">
        <div className="flex justify-center mb-6"><Logo size={48} /></div>
        <h1 className="text-center text-lg font-bold text-slate-700 mb-1">Sistema 2.0</h1>
        {!supabaseConfigurado && (
          <div className="my-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            Banco não configurado. Crie o arquivo <code>.env</code> a partir de <code>.env.example</code>.
          </div>
        )}

        {session && erro ? (
          <div className="mt-4 space-y-4">
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{erro}</div>
            <div className="text-xs text-slate-500">Conectado como {session.user.email}</div>
            <button className="btn-secondary w-full" onClick={sair}>Sair e entrar com outra conta</button>
          </div>
        ) : (
          <>
            <p className="text-center text-sm text-slate-500 mb-6">Entre com sua conta Google</p>
            <button onClick={google} disabled={ocupado} className="btn w-full py-3 text-base bg-white border border-slate-300 text-slate-800 hover:bg-slate-50 focus:ring-slate-200">
              <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-2.8-.4-4H24v7.6h12.7c-.3 2.1-1.7 5.2-4.8 7.3l7.4 5.7c4.4-4.1 7.2-10.1 7.2-16.6z"/><path fill="#FBBC05" d="M10.4 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.8-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2 1.4-4.7 2.4-8.5 2.4-6.3 0-11.7-4.1-13.6-9.9l-7.8 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
              {ocupado ? 'Redirecionando…' : 'Entrar com Google'}
            </button>

            <button className="mt-4 w-full text-center text-xs text-slate-400 underline" onClick={() => setComSenha(!comSenha)}>
              {comSenha ? 'ocultar login com senha' : 'entrar com e-mail e senha'}
            </button>
            {comSenha && (
              <form onSubmit={submit} className="mt-3 space-y-3">
                <div><label className="label">E-mail</label><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
                <div><label className="label">Senha</label><input className="input" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required /></div>
                <button className="btn-primary w-full py-3" disabled={ocupado}>{ocupado ? 'Entrando…' : 'Entrar'}</button>
              </form>
            )}
            {(msg || erro) && <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{msg ?? erro}</div>}
          </>
        )}
      </div>
    </div>
  )
}
