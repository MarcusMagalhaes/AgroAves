// Anexos do contas a pagar: arquivos no bucket privado 'contas-pagar' do Supabase Storage + linha em conta_pagar_anexo
import { supabase, ok } from './supabase'
import { normalizar } from './format'
import type { ContaPagarAnexo, TipoAnexo } from './types'

const BUCKET = 'contas-pagar'
export const TAMANHO_MAXIMO = 10 * 1024 * 1024
export const TIPOS_ACEITOS = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,application/xml,text/xml,.xml,.pdf,.jpg,.jpeg,.png,.webp,.heic'

export const fmtTamanho = (b: number | null | undefined) =>
  b == null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`

/** Mensagem de erro se o arquivo não puder ser enviado; null se estiver ok */
export function validarArquivo(f: File): string | null {
  if (f.size > TAMANHO_MAXIMO) return `${f.name}: maior que 10 MB`
  if (!/\.(pdf|jpe?g|png|webp|heic|xml)$/i.test(f.name)) return `${f.name}: use PDF, imagem (JPG, PNG, WEBP, HEIC) ou XML`
  return null
}

const nomeSeguro = (nome: string) => normalizar(nome).replace(/[^a-z0-9._-]+/g, '_').replace(/_+/g, '_').slice(-80) || 'arquivo'
const tipoMime = (f: File) => f.type || (/\.xml$/i.test(f.name) ? 'application/xml' : /\.heic$/i.test(f.name) ? 'image/heic' : 'application/octet-stream')

export const listarAnexos = async (contaId: number) =>
  ok(await supabase.from('conta_pagar_anexo').select('*').eq('conta_pagar_id', contaId).order('criado_em')) as ContaPagarAnexo[]

export async function enviarAnexo(contaId: number, arquivo: File, tipo: TipoAnexo) {
  const erro = validarArquivo(arquivo)
  if (erro) throw new Error(erro)
  const caminho = `${contaId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${nomeSeguro(arquivo.name)}`
  const mime = tipoMime(arquivo)
  const up = await supabase.storage.from(BUCKET).upload(caminho, arquivo, { contentType: mime, upsert: false })
  if (up.error) throw new Error(`${arquivo.name}: ${up.error.message}`)
  const res = await supabase.from('conta_pagar_anexo')
    .insert({ conta_pagar_id: contaId, tipo, nome_arquivo: arquivo.name, caminho, tamanho: arquivo.size, mime })
  if (res.error) { await supabase.storage.from(BUCKET).remove([caminho]); throw new Error(res.error.message) }
}

/** Abre o arquivo numa aba nova (link assinado válido por 5 minutos) */
export async function abrirAnexo(a: ContaPagarAnexo) {
  const aba = window.open('', '_blank')
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(a.caminho, 300)
  if (error || !data) { aba?.close(); throw new Error(error?.message ?? 'Não foi possível abrir o anexo') }
  if (aba) aba.location.href = data.signedUrl
  else window.location.href = data.signedUrl
}

export async function removerAnexo(a: ContaPagarAnexo) {
  const rm = await supabase.storage.from(BUCKET).remove([a.caminho])
  if (rm.error) throw new Error(rm.error.message)
  ok(await supabase.from('conta_pagar_anexo').delete().eq('id', a.id))
}
