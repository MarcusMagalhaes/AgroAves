// Assinatura digital XML (XML-DSig) no padrão exigido pela NF-e:
// enveloped + C14N, RSA-SHA1, digest SHA1, referência ao Id do infNFe, certificado em X509Data.
import { SignedXml } from 'xml-crypto'
import type { Certificado } from './certificado.ts'

export function assinarNFe(xml: string, cert: Certificado): string {
  const sig = new SignedXml({
    privateKey: cert.chavePem,
    publicCert: cert.certPem,
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    getKeyInfoContent: () => `<X509Data><X509Certificate>${cert.certBase64}</X509Certificate></X509Data>`,
  })
  sig.addReference({
    xpath: "//*[local-name(.)='infNFe']",
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  })
  // A Signature fica depois do infNFe, dentro do <NFe>
  sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='infNFe']", action: 'after' } })
  return sig.getSignedXml()
}

/** Confere a assinatura (usado nos testes e antes de enviar) */
export function verificarAssinatura(xmlAssinado: string, certPem: string): boolean {
  const sig = new SignedXml({ publicCert: certPem })
  const m = xmlAssinado.match(/<Signature[\s\S]*<\/Signature>/)
  if (!m) return false
  sig.loadSignature(m[0])
  return sig.checkSignature(xmlAssinado)
}
