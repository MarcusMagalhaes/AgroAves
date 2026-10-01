import { useState, type FormEvent } from 'react'
import Logo from '@/components/Logo'
import { useAuth } from '@/lib/auth'
import { supabaseConfigurado } from '@/lib/supabase'

export default function Login() {
  const { entrar, erro } = useAuth()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setMsg(null); setOcupado(true)
    try { await entrar(email.trim(), senha) } catch (err: any) { setMsg(err.message) } finally { setOcupado(false) }
  }

  return (
    <div className="min-h-full flex items-center justify-center bg-gradient-to-br from-leaf-800 via-leaf-700 to-leaf-900 p-4">
      <div className="card w-full max-w-sm p-6 sm:p-8">
        <div className="flex justify-center mb-6"><Logo size={48} /></div>
        <h1 className="text-center text-lg font-bold text-slate-700 mb-1">Sistema 2.0</h1>
        <p className="text-center text-sm text-slate-500 mb-6">Entre com seu e-mail e senha</p>
        {!supabaseConfigurado && (
          <div className="mb-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            Banco não configurado. Crie o arquivo <code>.env</code> a partir de <code>.env.example</code>.
          </div>
        )}
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">E-mail</label>
            <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="label">Senha</label>
            <input className="input" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
          </div>
          {(msg || erro) && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{msg ?? erro}</div>}
          <button className="btn-primary w-full py-3 text-base" disabled={ocupado}>{ocupado ? 'Entrando…' : 'Entrar'}</button>
        </form>
      </div>
    </div>
  )
}
