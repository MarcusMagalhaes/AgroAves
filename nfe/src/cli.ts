// Linha de comando do protótipo (SOMENTE homologação):
//   npm run status                      → testa certificado + conexão com a SEFAZ-MG
//   npm run gerar  [pedido.json]        → monta, assina e valida o XML, sem enviar
//   npm run emitir [pedido.json]        → monta, assina, valida e envia para autorização em homologação
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { lerConfig, EMITENTE } from './config.ts'
import { carregarCertificado } from './certificado.ts'
import { montarNFe, type DadosNFe } from './xml.ts'
import { assinarNFe, verificarAssinatura } from './assinatura.ts'
import { validarSchema } from './validar.ts'
import { statusServico, autorizar } from './sefaz.ts'

const SAIDA = fileURLToPath(new URL('../saida/', import.meta.url))
const ARQ_NUMERACAO = SAIDA + 'numeracao-homologacao.json'
const EXEMPLO = fileURLToPath(new URL('../exemplos/pedido-exemplo.json', import.meta.url))

/** Numeração local só para testes (em produção virá do banco, com trava contra duplicidade) */
function proximoNumero(serie: number): number {
  const n = existsSync(ARQ_NUMERACAO) ? JSON.parse(readFileSync(ARQ_NUMERACAO, 'utf8')) : {}
  n[serie] = (n[serie] ?? 0) + 1
  writeFileSync(ARQ_NUMERACAO, JSON.stringify(n, null, 2))
  return n[serie]
}

function preparar(arquivo?: string) {
  const cfg = lerConfig()
  const cert = carregarCertificado(cfg.pfxPath, cfg.pfxSenha)
  const dias = Math.floor((cert.validoAte.getTime() - Date.now()) / 86_400_000)
  console.log(`Certificado: ${cert.titular} — válido até ${cert.validoAte.toLocaleDateString('pt-BR')} (${dias} dias)`)
  if (dias < 0) throw new Error('Certificado vencido')
  if (dias <= 30) console.warn(`⚠️  Certificado vence em ${dias} dias — renovar`)
  return { cfg, cert, conexao: { cert, ambiente: cfg.ambiente, uf: EMITENTE.uf, caFile: cfg.caFile } }
}

function gerarAssinada(arquivo: string | undefined, ctx: ReturnType<typeof preparar>) {
  mkdirSync(SAIDA, { recursive: true })
  const pedido = JSON.parse(readFileSync(arquivo ?? EXEMPLO, 'utf8')) as Omit<DadosNFe, 'ambiente' | 'serie' | 'numero'>
  const numero = proximoNumero(ctx.cfg.serie)
  const { xml, chave, valorTotal } = montarNFe({ ...pedido, ambiente: ctx.cfg.ambiente, serie: ctx.cfg.serie, numero })
  const assinada = assinarNFe(xml, ctx.cert)
  if (!verificarAssinatura(assinada, ctx.cert.certPem)) throw new Error('Falha ao conferir a assinatura gerada')
  const v = validarSchema(assinada)
  console.log(`NF-e série ${ctx.cfg.serie} nº ${numero} · chave ${chave} · total R$ ${valorTotal.toFixed(2)}`)
  if (!v.ok) { console.error('❌ XML não passou no schema oficial:\n' + v.erros.join('\n')); process.exit(1) }
  console.log(v.erros.length ? `⚠️  ${v.erros[0]}` : '✅ XML assinado e válido no schema oficial')
  const arq = `${SAIDA}${chave}-nfe.xml`
  writeFileSync(arq, assinada)
  console.log(`   ${arq}`)
  return { assinada, chave }
}

async function main() {
  const [cmd, arquivo] = process.argv.slice(2)
  if (cmd === 'status') {
    const ctx = preparar()
    const r = await statusServico(ctx.conexao)
    console.log(`SEFAZ-MG homologação: ${r.cStat} — ${r.xMotivo}${r.tMed ? ` (tempo médio ${r.tMed}s)` : ''}`)
    if (r.cStat !== '107') process.exitCode = 1 // 107 = serviço em operação
  } else if (cmd === 'gerar') {
    gerarAssinada(arquivo, preparar())
  } else if (cmd === 'emitir') {
    const ctx = preparar()
    const { assinada, chave } = gerarAssinada(arquivo, ctx)
    console.log('Enviando para a SEFAZ-MG (homologação)…')
    const r = await autorizar(assinada, ctx.conexao)
    writeFileSync(`${SAIDA}${chave}-retorno.xml`, r.bruto)
    if (r.autorizada) {
      writeFileSync(`${SAIDA}${chave}-procNFe.xml`, r.nfeProc!)
      console.log(`✅ AUTORIZADA (homologação, sem valor fiscal) · protocolo ${r.protocolo}`)
      console.log(`   Consulte a chave em https://hom.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx`)
    } else {
      console.log(`❌ ${r.cStat} — ${r.xMotivo}`)
      process.exitCode = 1
    }
  } else {
    console.log('Uso: npm run status | npm run gerar [pedido.json] | npm run emitir [pedido.json]')
  }
}

main().catch((e) => { console.error('Erro:', e.message); process.exit(1) })
