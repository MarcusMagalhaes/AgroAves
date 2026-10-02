// Anexos de uma conta a pagar (vários por conta: a conta/boleto, o comprovante, outros)
import { useEffect, useRef, useState } from 'react'
import { abrirAnexo, enviarAnexo, fmtTamanho, listarAnexos, removerAnexo, TIPOS_ACEITOS, validarArquivo } from '@/lib/anexos'
import { fmtDataHora } from '@/lib/format'
import { TIPOS_ANEXO, type ContaPagarAnexo, type TipoAnexo } from '@/lib/types'
import { Chip, useToast } from './ui'

const COR: Record<TipoAnexo, 'azul' | 'verde' | 'cinza'> = { CONTA: 'azul', COMPROVANTE: 'verde', OUTRO: 'cinza' }

/** Botão "Anexar" com escolha do tipo; chama onArquivos com os arquivos válidos */
function Anexar({ onArquivos, desabilitado, tipoInicial = 'CONTA' }: { onArquivos: (fs: File[], tipo: TipoAnexo) => void; desabilitado?: boolean; tipoInicial?: TipoAnexo }) {
  const { toast } = useToast()
  const [tipo, setTipo] = useState<TipoAnexo>(tipoInicial)
  const entrada = useRef<HTMLInputElement>(null)
  function escolhidos(lista: FileList | null) {
    const fs = Array.from(lista ?? [])
    const erros = fs.map(validarArquivo).filter(Boolean)
    if (erros.length) toast(erros.join(' · '), 'erro')
    const bons = fs.filter((f) => !validarArquivo(f))
    if (bons.length) onArquivos(bons, tipo)
    if (entrada.current) entrada.current.value = ''
  }
  return (
    <div className="flex items-center gap-1.5">
      <select className="input w-auto py-1 text-xs" value={tipo} onChange={(e) => setTipo(e.target.value as TipoAnexo)}>
        {Object.entries(TIPOS_ANEXO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <button type="button" className="btn-secondary py-1 text-xs" disabled={desabilitado} onClick={() => entrada.current?.click()}>📎 Anexar arquivos</button>
      <input ref={entrada} type="file" multiple accept={TIPOS_ACEITOS} className="hidden" onChange={(e) => escolhidos(e.target.files)} />
    </div>
  )
}

/** Anexos de uma conta já gravada: lista, abre, envia e remove na hora */
export default function AnexosConta({ contaId, onMudou, tipoInicial }: { contaId: number; onMudou?: () => void; tipoInicial?: TipoAnexo }) {
  const { toast } = useToast()
  const [lista, setLista] = useState<ContaPagarAnexo[] | null>(null)
  const [enviando, setEnviando] = useState('')
  const carregar = () => listarAnexos(contaId).then(setLista).catch((e) => { toast(e.message, 'erro'); setLista([]) })
  useEffect(() => { carregar() }, [contaId])

  async function enviar(fs: File[], tipo: TipoAnexo) {
    let erros = 0
    for (const [i, f] of fs.entries()) {
      setEnviando(`Enviando ${i + 1} de ${fs.length}…`)
      try { await enviarAnexo(contaId, f, tipo) } catch (e: any) { erros++; toast(e.message, 'erro') }
    }
    setEnviando('')
    if (fs.length > erros) toast(`${fs.length - erros} anexo(s) enviado(s)`)
    carregar(); onMudou?.()
  }
  async function remover(a: ContaPagarAnexo) {
    if (!confirm(`Remover o anexo "${a.nome_arquivo}"?`)) return
    try { await removerAnexo(a); toast('Anexo removido'); carregar(); onMudou?.() } catch (e: any) { toast(e.message, 'erro') }
  }
  async function abrir(a: ContaPagarAnexo) { try { await abrirAnexo(a) } catch (e: any) { toast(e.message, 'erro') } }

  return (
    <div className="min-w-0 rounded-lg border border-slate-200 p-2">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="label mb-0">Anexos {lista ? `(${lista.length})` : ''}</span>
        {enviando ? <span className="text-xs text-slate-500">{enviando}</span> : <Anexar onArquivos={enviar} tipoInicial={tipoInicial} />}
      </div>
      {lista === null ? <div className="text-xs text-slate-400">Carregando…</div>
        : !lista.length ? <div className="text-xs text-slate-400">Nenhum anexo. PDF, imagem ou XML, até 10 MB cada.</div>
        : (
          <ul className="divide-y divide-slate-100">
            {lista.map((a) => (
              <li key={a.id} className="flex items-center gap-2 py-1 text-xs">
                <Chip cor={COR[a.tipo]}>{TIPOS_ANEXO[a.tipo]}</Chip>
                <button type="button" className="min-w-0 flex-1 truncate text-left font-semibold text-leaf-900 underline" title="Abrir" onClick={() => abrir(a)}>{a.nome_arquivo}</button>
                <span className="text-slate-400 whitespace-nowrap">{fmtTamanho(a.tamanho)}<span className="hidden sm:inline"> · {fmtDataHora(a.criado_em)}</span></span>
                <button type="button" className="px-1 text-red-600" title="Remover anexo" onClick={() => remover(a)}>✕</button>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}

/** Anexos escolhidos antes de a conta existir (conta nova): enviados logo depois de salvar */
export type AnexoPendente = { arquivo: File; tipo: TipoAnexo }
export function AnexosPendentes({ pendentes, onChange }: { pendentes: AnexoPendente[]; onChange: (p: AnexoPendente[]) => void }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 p-2">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="label mb-0">Anexos ({pendentes.length})</span>
        <Anexar onArquivos={(fs, tipo) => onChange([...pendentes, ...fs.map((arquivo) => ({ arquivo, tipo }))])} />
      </div>
      {!pendentes.length ? <div className="text-xs text-slate-400">Nenhum anexo. PDF, imagem ou XML, até 10 MB cada.</div> : (
        <ul className="divide-y divide-slate-100">
          {pendentes.map((p, i) => (
            <li key={i} className="flex items-center gap-2 py-1 text-xs">
              <Chip cor={COR[p.tipo]}>{TIPOS_ANEXO[p.tipo]}</Chip>
              <span className="min-w-0 flex-1 truncate">{p.arquivo.name}</span>
              <span className="text-slate-400">{fmtTamanho(p.arquivo.size)}</span>
              <button type="button" className="px-1 text-red-600" title="Tirar" onClick={() => onChange(pendentes.filter((_, j) => j !== i))}>✕</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
