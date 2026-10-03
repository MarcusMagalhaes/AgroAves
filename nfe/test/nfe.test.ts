// Testes offline: não falam com a SEFAZ e usam um certificado autoassinado gerado na hora (nunca o certificado real).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import forge from 'node-forge'
import { dvModulo11, montarChave } from '../src/chave.ts'
import { montarNFe, XNOME_HOMOLOGACAO, dataHoraBrasilia, type DadosNFe } from '../src/xml.ts'
import { carregarCertificado } from '../src/certificado.ts'
import { assinarNFe, verificarAssinatura } from '../src/assinatura.ts'
import { validarSchema } from '../src/validar.ts'

function pfxDeTeste(senha: string): Buffer {
  const chaves = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = chaves.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date(Date.now() + 86_400_000)
  const nome = [{ name: 'commonName', value: 'EMPRESA TESTE:11222333000181' }]
  cert.setSubject(nome); cert.setIssuer(nome)
  cert.sign(chaves.privateKey, forge.md.sha256.create())
  const p12 = forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [cert], senha, { algorithm: '3des' })
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary')
}

const pedido: DadosNFe = {
  ambiente: 2, serie: 99, numero: 1, emissao: new Date('2026-10-03T12:00:00Z'),
  naturezaOperacao: 'VENDA DE MERCADORIA',
  destinatario: { cnpjCpf: '11.222.333/0001-81', razao: 'Cliente & Filhos', logradouro: 'Rua A', numero: '1', bairro: 'Centro', cMun: '3158953', xMun: 'Santana do Paraiso', uf: 'MG', cep: '35179-000' },
  itens: [
    { codigo: 'PC', descricao: 'PINTINHO DE CORTE', ncm: '01051190', cfop: '5102', unidade: 'UN', quantidade: 100, valorUnitario: 4.5 },
    { codigo: 'PP', descricao: 'PINTINHA DE POSTURA', ncm: '01051190', cfop: '5102', unidade: 'UN', quantidade: 3, valorUnitario: 0.335 },
  ],
  pagamento: { tPag: '15', indPag: '1' },
  gta: { uf: 'MG', numero: '123456' },
}

test('dígito verificador da chave (exemplo do Manual de Orientação do Contribuinte)', () => {
  assert.equal(dvModulo11('3508059999909091027055001000000001518005127'), '3')
})

test('chave de acesso tem 44 dígitos e DV correto', () => {
  const { chave, cDV } = montarChave({ cUF: '31', aamm: '2610', cnpj: '51071556000100', mod: '55', serie: 99, nNF: 1, tpEmis: '1', cNF: '12345678' })
  assert.equal(chave.length, 44)
  assert.equal(chave.slice(-1), cDV)
  assert.equal(chave.slice(0, 2), '31')
})

test('data/hora em horário de Brasília', () => {
  assert.equal(dataHoraBrasilia(new Date('2026-10-03T12:00:00Z')), '2026-10-03T09:00:00-03:00')
})

test('XML: homologação troca o nome do destinatário, soma o total e referencia a GTA', () => {
  const { xml, chave, valorTotal } = montarNFe(pedido)
  assert.match(xml, new RegExp(`<xNome>${XNOME_HOMOLOGACAO}</xNome>`))
  assert.ok(!xml.includes('Cliente &'), 'nome real não pode ir em homologação')
  assert.equal(valorTotal, 451.01) // 450,00 + 3 × 0,335 = 1,005 → 1,01
  assert.match(xml, /<vNF>451\.01<\/vNF>/)
  assert.match(xml, /<guiaTransito><tpGuia>1<\/tpGuia><UFGuia>MG<\/UFGuia><nGuia>123456<\/nGuia>/)
  assert.match(xml, new RegExp(`Id="NFe${chave}"`))
  assert.match(xml, /<CEP>35179000<\/CEP>/)
})

test('assina, confere a assinatura e valida no schema oficial', () => {
  const cert = carregarCertificado(pfxDeTeste('senha'), 'senha')
  const { xml } = montarNFe(pedido)
  const assinada = assinarNFe(xml, cert)
  assert.match(assinada, /<\/infNFe><Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">/)
  assert.ok(verificarAssinatura(assinada, cert.certPem))
  const v = validarSchema(assinada)
  assert.ok(v.ok, v.erros.join('\n'))
})

test('assinatura detecta adulteração do valor', () => {
  const cert = carregarCertificado(pfxDeTeste('x'), 'x')
  const assinada = assinarNFe(montarNFe(pedido).xml, cert)
  assert.equal(verificarAssinatura(assinada.replace('<vNF>451.01</vNF>', '<vNF>1.00</vNF>'), cert.certPem), false)
})

test('senha errada do certificado é recusada', () => {
  assert.throws(() => carregarCertificado(pfxDeTeste('certa'), 'errada'))
})
