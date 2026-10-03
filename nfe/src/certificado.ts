// Leitura do certificado A1 (.pfx / PKCS#12): chave privada para assinar o XML e certificado para o KeyInfo.
// A conexão com a SEFAZ (mTLS) usa o próprio .pfx direto no agente HTTPS do Node.
import { readFileSync } from 'node:fs'
import forge from 'node-forge'

export interface Certificado {
  pfx: Buffer; senha: string
  chavePem: string; certPem: string
  /** Certificado em base64 (DER), como vai no <X509Certificate> */
  certBase64: string
  titular: string; validoAte: Date
}

export function carregarCertificado(pfxOuCaminho: Buffer | string, senha: string): Certificado {
  const pfx = typeof pfxOuCaminho === 'string' ? readFileSync(pfxOuCaminho) : pfxOuCaminho
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(pfx.toString('binary')), false, senha)
  const chaves = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ]
  const certs = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []
  const chave = chaves[0]?.key
  if (!chave) throw new Error('Chave privada não encontrada no .pfx')
  // O certificado do titular é o que tem a mesma chave pública da chave privada (os demais são da cadeia ICP-Brasil)
  const pub = forge.pki.setRsaPublicKey((chave as forge.pki.rsa.PrivateKey).n, (chave as forge.pki.rsa.PrivateKey).e)
  const cert = certs.map((b) => b.cert!).find((c) => forge.pki.publicKeyToPem(c.publicKey) === forge.pki.publicKeyToPem(pub))
  if (!cert) throw new Error('Certificado do titular não encontrado no .pfx')
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()
  return {
    pfx, senha,
    chavePem: forge.pki.privateKeyToPem(chave),
    certPem: forge.pki.certificateToPem(cert),
    certBase64: forge.util.encode64(der),
    titular: String(cert.subject.getField('CN')?.value ?? ''),
    validoAte: cert.validity.notAfter,
  }
}
