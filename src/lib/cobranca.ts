// Boletos Sicoob na tela: chamadas à API do Worker (/api/boletos/*) e PDFs no bucket privado 'boletos'
import { supabase } from './supabase'

const BUCKET = 'boletos'

async function api<T>(caminho: string, corpo?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sessão expirada: faça login novamente.')
  let r: Response
  try {
    r = await fetch(`${import.meta.env.BASE_URL}api/boletos/${caminho}`, {
      method: corpo === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    })
  } catch { throw new Error('Sem conexão com o servidor de boletos.') }
  const res = await r.json().catch(() => null)
  if (!res) throw new Error('Integração com o Sicoob indisponível neste endereço (funciona no site publicado no Cloudflare).')
  if (!r.ok) throw new Error(res.erro ?? `Erro ${r.status}`)
  return res as T
}

export const statusCobranca = () => api<{ ambiente: 'SANDBOX' | 'PRODUCAO'; configurado: boolean }>('status')
export const emitirBoleto = (tituloId: number, vencimento?: string) => api('emitir', { titulo_id: tituloId, vencimento })
export const baixarBoletoNoBanco = (boletoId: number) => api('baixar', { boleto_id: boletoId })
export const conciliarBoletos = (boletoIds: number[]) =>
  api<{ liquidados: number; baixados: number; abertos: number; erros: string[] }>('conciliar', { boleto_ids: boletoIds })
/** Máximo de boletos por chamada de conciliação (limite do Worker) */
export const LOTE_CONCILIACAO = 10

/** Abre o PDF do boleto numa aba nova; busca a 2ª via no banco se ainda não estiver guardado */
export async function abrirPdfBoleto(boletoId: number) {
  const aba = window.open('', '_blank')
  try {
    const { caminho } = await api<{ caminho: string }>('pdf', { boleto_id: boletoId })
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(caminho, 300)
    if (error || !data) throw new Error(error?.message ?? 'Não foi possível abrir o PDF')
    if (aba) aba.location.href = data.signedUrl
    else window.location.href = data.signedUrl
  } catch (e) { aba?.close(); throw e }
}
