// Comunicação com os web services da SEFAZ (SOAP 1.2 sobre HTTPS com certificado do cliente — mTLS)
import https from 'node:https'
import tls from 'node:tls'
import { readFileSync } from 'node:fs'
import { UF_IBGE, WS_MG, type Ambiente } from './config.ts'
import { NS_NFE } from './xml.ts'
import type { Certificado } from './certificado.ts'

export interface Conexao { cert: Certificado; ambiente: Ambiente; uf: string; caFile?: string }

function agente(c: Conexao): https.Agent {
  // Usa chave/certificado em PEM (e não o .pfx direto): muitos .pfx de AC brasileira usam cifras legadas que o OpenSSL 3 recusa.
  // A SEFAZ usa certificado de servidor ICP-Brasil, que não está na lista padrão do Node: informe a cadeia em NFE_CA_FILE.
  const ca = c.caFile ? [...tls.rootCertificates, readFileSync(c.caFile, 'utf8')] : undefined
  return new https.Agent({ key: c.cert.chavePem, cert: c.cert.certPem, ca, keepAlive: false })
}

function soap(url: string, servico: string, metodo: string, corpo: string, c: Conexao): Promise<string> {
  const envelope = '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
    `<soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/${servico}">${corpo}</nfeDadosMsg></soap12:Body></soap12:Envelope>`
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST', agent: agente(c), timeout: 30_000,
      headers: {
        'Content-Type': `application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/${servico}/${metodo}"`,
        'Content-Length': Buffer.byteLength(envelope),
      },
    }, (res) => {
      let dados = ''
      res.setEncoding('utf8')
      res.on('data', (p) => (dados += p))
      res.on('end', () => (res.statusCode && res.statusCode >= 400 && !dados.includes('Envelope')
        ? reject(new Error(`SEFAZ respondeu HTTP ${res.statusCode}: ${dados.slice(0, 500)}`)) : resolve(dados)))
    })
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado falando com a SEFAZ')))
    req.on('error', reject)
    req.end(envelope)
  })
}

/** Primeiro valor de uma tag no XML de retorno (retornos da SEFAZ são simples o bastante para isso) */
export const campo = (xml: string, nome: string) => xml.match(new RegExp(`<(?:\\w+:)?${nome}[^>]*>([^<]*)</(?:\\w+:)?${nome}>`))?.[1]
const bloco = (xml: string, nome: string) => xml.match(new RegExp(`<${nome}[\\s>][\\s\\S]*?</${nome}>`))?.[0]

const ws = (c: Conexao) => {
  if (c.uf !== 'MG') throw new Error('Protótipo configurado só para a SEFAZ-MG')
  return WS_MG[c.ambiente]
}

export async function statusServico(c: Conexao) {
  const corpo = `<consStatServ xmlns="${NS_NFE}" versao="4.00"><tpAmb>${c.ambiente}</tpAmb><cUF>${UF_IBGE[c.uf]}</cUF><xServ>STATUS</xServ></consStatServ>`
  const ret = await soap(ws(c).status, 'NFeStatusServico4', 'nfeStatusServicoNF', corpo, c)
  return { cStat: campo(ret, 'cStat'), xMotivo: campo(ret, 'xMotivo'), tMed: campo(ret, 'tMed'), bruto: ret }
}

export interface ResultadoEnvio {
  autorizada: boolean; cStat?: string; xMotivo?: string; protocolo?: string
  /** XML de distribuição (NF-e + protocolo) — é o arquivo que se guarda por 5 anos e se envia ao cliente */
  nfeProc?: string; bruto: string
}

function resultadoProtocolo(ret: string, nfeAssinada: string): ResultadoEnvio {
  const prot = bloco(ret, 'protNFe')
  const cStat = prot ? campo(prot, 'cStat') : campo(ret, 'cStat')
  const xMotivo = prot ? campo(prot, 'xMotivo') : campo(ret, 'xMotivo')
  // 100 = autorizado; 150 = autorizado fora de prazo
  const autorizada = cStat === '100' || cStat === '150'
  const nfeProc = autorizada && prot
    ? `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="${NS_NFE}" versao="4.00">${nfeAssinada}${prot.replace(/^<protNFe(?![^>]*xmlns)/, `<protNFe xmlns="${NS_NFE}"`)}</nfeProc>`
    : undefined
  return { autorizada, cStat, xMotivo, protocolo: prot ? campo(prot, 'nProt') : undefined, nfeProc, bruto: ret }
}

/** Envia uma NF-e assinada. Tenta o modo síncrono; se a SEFAZ processar em lote (cStat 103), consulta o recibo. */
export async function autorizar(nfeAssinada: string, c: Conexao): Promise<ResultadoEnvio> {
  const nfe = nfeAssinada.replace(/^<\?xml[^>]*>/, '')
  const idLote = String(Date.now()).slice(-15)
  const corpo = `<enviNFe xmlns="${NS_NFE}" versao="4.00"><idLote>${idLote}</idLote><indSinc>1</indSinc>${nfe}</enviNFe>`
  const ret = await soap(ws(c).autorizacao, 'NFeAutorizacao4', 'nfeAutorizacaoLote', corpo, c)
  if (campo(ret, 'cStat') !== '103') return resultadoProtocolo(ret, nfe)

  const nRec = campo(ret, 'nRec')
  for (let tentativa = 0; tentativa < 10; tentativa++) {
    await new Promise((r) => setTimeout(r, 2000 + tentativa * 1000))
    const cons = `<consReciNFe xmlns="${NS_NFE}" versao="4.00"><tpAmb>${c.ambiente}</tpAmb><nRec>${nRec}</nRec></consReciNFe>`
    const r = await soap(ws(c).retAutorizacao, 'NFeRetAutorizacao4', 'nfeRetAutorizacaoLote', cons, c)
    if (campo(r, 'cStat') !== '105') return resultadoProtocolo(r, nfe) // 105 = lote em processamento
  }
  return { autorizada: false, cStat: '105', xMotivo: `Lote ${nRec} ainda em processamento; consultar depois`, bruto: ret }
}
