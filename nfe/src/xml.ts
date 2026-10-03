// Montagem do XML da NF-e 4.00 (modelo 55) a partir de um pedido do AgroAves.
// A ordem dos elementos segue o leiaute oficial (schemas/leiauteNFe_v4.00.xsd) — a SEFAZ rejeita fora de ordem.
import { EMITENTE, UF_IBGE, VER_PROC, type Ambiente, type Emitente } from './config.ts'
import { gerarCNF, montarChave } from './chave.ts'

export const NS_NFE = 'http://www.portalfiscal.inf.br/nfe'
/** Exigência da SEFAZ em homologação: nome do destinatário fixo (senão: rejeição 598) */
export const XNOME_HOMOLOGACAO = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL'

export interface Destinatario {
  cnpjCpf: string; razao: string; ie?: string // sem IE → não contribuinte (indIEDest 9)
  logradouro: string; numero: string; complemento?: string; bairro: string
  cMun: string; xMun: string; uf: string; cep: string; fone?: string; email?: string
}

export interface Item {
  codigo: string; descricao: string; ncm: string; cfop: string; unidade: string
  quantidade: number; valorUnitario: number
  csosn?: '102' | '103' | '300' | '400' // padrão: 102 (tributada pelo Simples sem permissão de crédito)
}

export interface Gta { uf: string; numero: string; serie?: string }

export interface DadosNFe {
  ambiente: Ambiente; serie: number; numero: number; emissao?: Date
  naturezaOperacao: string
  destinatario: Destinatario; itens: Item[]
  /** 0 = frete por conta do emitente (entrega própria), 1 = destinatário, 9 = sem frete */
  modFrete?: '0' | '1' | '2' | '3' | '4' | '9'
  /** tPag: 01 dinheiro, 15 boleto, 17 PIX, 90 sem pagamento, 99 outros */
  pagamento?: { tPag: string; valor?: number; indPag?: '0' | '1' }
  gta?: Gta
  infCpl?: string
  emitente?: Emitente
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
/** Texto livre: espaços duplos e quebras de linha viram um espaço (o schema não aceita), e caracteres especiais são escapados */
const txt = (s: string) => esc(s.replace(/\s+/g, ' ').trim())
const tag = (nome: string, valor: string | number | undefined | null) =>
  valor === undefined || valor === null || valor === '' ? '' : `<${nome}>${typeof valor === 'number' ? valor : txt(valor)}</${nome}>`
const dec = (n: number, casas: number) => n.toFixed(casas)
const soDigitos = (s: string) => s.replace(/\D/g, '')

/** Data/hora no formato exigido (AAAA-MM-DDThh:mm:ss-03:00), horário de Brasília */
export function dataHoraBrasilia(d: Date): string {
  const local = new Date(d.getTime() - 3 * 3600_000)
  return local.toISOString().slice(0, 19) + '-03:00'
}

export function montarNFe(dados: DadosNFe): { xml: string; chave: string; id: string; valorTotal: number } {
  const emit = dados.emitente ?? EMITENTE
  const dest = dados.destinatario
  if (!dados.itens.length) throw new Error('A nota precisa de ao menos um item')
  const emissao = dados.emissao ?? new Date()
  const dhEmi = dataHoraBrasilia(emissao)
  const cUF = UF_IBGE[emit.uf]
  const cNF = gerarCNF(dados.numero)
  const { chave, cDV } = montarChave({
    cUF, aamm: dhEmi.slice(2, 4) + dhEmi.slice(5, 7), cnpj: emit.cnpj, mod: '55',
    serie: dados.serie, nNF: dados.numero, tpEmis: '1', cNF,
  })
  const id = 'NFe' + chave
  const docDest = soDigitos(dest.cnpjCpf)
  const idDest = dest.uf === emit.uf ? '1' : '2' // 1 interna, 2 interestadual
  const contribuinte = !!dest.ie && soDigitos(dest.ie).length > 0
  // Homologação: o nome do destinatário é obrigatoriamente o texto fixo; o CNPJ/CPF pode ser o real
  const xNomeDest = dados.ambiente === 2 ? XNOME_HOMOLOGACAO : dest.razao

  const itensXml = dados.itens.map((it, i) => {
    const vProd = Math.round(it.quantidade * it.valorUnitario * 100) / 100
    return `<det nItem="${i + 1}"><prod>` +
      tag('cProd', it.codigo) + '<cEAN>SEM GTIN</cEAN>' + tag('xProd', it.descricao) + tag('NCM', it.ncm) +
      tag('CFOP', it.cfop) + tag('uCom', it.unidade) + `<qCom>${dec(it.quantidade, 4)}</qCom>` +
      `<vUnCom>${dec(it.valorUnitario, 10)}</vUnCom><vProd>${dec(vProd, 2)}</vProd>` +
      '<cEANTrib>SEM GTIN</cEANTrib>' + tag('uTrib', it.unidade) + `<qTrib>${dec(it.quantidade, 4)}</qTrib>` +
      `<vUnTrib>${dec(it.valorUnitario, 10)}</vUnTrib><indTot>1</indTot></prod>` +
      '<imposto>' +
      `<ICMS><ICMSSN102><orig>0</orig><CSOSN>${it.csosn ?? '102'}</CSOSN></ICMSSN102></ICMS>` +
      // Simples Nacional: PIS/COFINS recolhidos no DAS; CST 49 (outras operações de saída) com valores zerados
      '<PIS><PISOutr><CST>49</CST><vBC>0.00</vBC><pPIS>0.0000</pPIS><vPIS>0.00</vPIS></PISOutr></PIS>' +
      '<COFINS><COFINSOutr><CST>49</CST><vBC>0.00</vBC><pCOFINS>0.0000</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr></COFINS>' +
      '</imposto></det>'
  }).join('')
  const vNF = Math.round(dados.itens.reduce((s, it) => s + Math.round(it.quantidade * it.valorUnitario * 100) / 100, 0) * 100) / 100

  const pag = dados.pagamento ?? { tPag: '90' }
  const vPag = pag.tPag === '90' ? 0 : (pag.valor ?? vNF)

  const xml =
    `<NFe xmlns="${NS_NFE}"><infNFe versao="4.00" Id="${id}">` +
    '<ide>' +
      `<cUF>${cUF}</cUF><cNF>${cNF}</cNF>` + tag('natOp', dados.naturezaOperacao) +
      `<mod>55</mod><serie>${dados.serie}</serie><nNF>${dados.numero}</nNF><dhEmi>${dhEmi}</dhEmi>` +
      `<tpNF>1</tpNF><idDest>${idDest}</idDest><cMunFG>${emit.cMun}</cMunFG>` +
      `<tpImp>1</tpImp><tpEmis>1</tpEmis><cDV>${cDV}</cDV><tpAmb>${dados.ambiente}</tpAmb>` +
      `<finNFe>1</finNFe><indFinal>${contribuinte ? '0' : '1'}</indFinal><indPres>9</indPres>` +
      `<procEmi>0</procEmi>` + tag('verProc', VER_PROC) +
    '</ide>' +
    '<emit>' +
      `<CNPJ>${emit.cnpj}</CNPJ>` + tag('xNome', emit.razao) + tag('xFant', emit.fantasia) +
      '<enderEmit>' + tag('xLgr', emit.logradouro) + tag('nro', emit.numero) + tag('xCpl', emit.complemento) +
        tag('xBairro', emit.bairro) + `<cMun>${emit.cMun}</cMun>` + tag('xMun', emit.xMun) + `<UF>${emit.uf}</UF>` +
        `<CEP>${emit.cep}</CEP><cPais>1058</cPais><xPais>BRASIL</xPais>` + tag('fone', emit.fone) +
      '</enderEmit>' +
      `<IE>${emit.ie}</IE><CRT>${emit.crt}</CRT>` +
    '</emit>' +
    '<dest>' +
      (docDest.length === 14 ? `<CNPJ>${docDest}</CNPJ>` : `<CPF>${docDest}</CPF>`) + tag('xNome', xNomeDest) +
      '<enderDest>' + tag('xLgr', dest.logradouro) + tag('nro', dest.numero) + tag('xCpl', dest.complemento) +
        tag('xBairro', dest.bairro) + `<cMun>${dest.cMun}</cMun>` + tag('xMun', dest.xMun) + `<UF>${dest.uf}</UF>` +
        `<CEP>${soDigitos(dest.cep)}</CEP><cPais>1058</cPais><xPais>BRASIL</xPais>` + tag('fone', dest.fone && soDigitos(dest.fone)) +
      '</enderDest>' +
      (contribuinte ? `<indIEDest>1</indIEDest><IE>${soDigitos(dest.ie!)}</IE>` : '<indIEDest>9</indIEDest>') +
      tag('email', dest.email) +
    '</dest>' +
    itensXml +
    '<total><ICMSTot>' +
      '<vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST>' +
      '<vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet>' +
      `<vProd>${dec(vNF, 2)}</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI>` +
      `<vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro><vNF>${dec(vNF, 2)}</vNF>` +
    '</ICMSTot></total>' +
    `<transp><modFrete>${dados.modFrete ?? '0'}</modFrete></transp>` +
    '<pag><detPag>' + (pag.indPag ? `<indPag>${pag.indPag}</indPag>` : '') + `<tPag>${pag.tPag}</tPag><vPag>${dec(vPag, 2)}</vPag></detPag></pag>` +
    (dados.infCpl ? '<infAdic>' + tag('infCpl', dados.infCpl) + '</infAdic>' : '') +
    // tpGuia 1 = GTA (Guia de Trânsito Animal)
    (dados.gta ? '<agropecuario><guiaTransito><tpGuia>1</tpGuia>' + `<UFGuia>${dados.gta.uf}</UFGuia>` +
      tag('serieGuia', dados.gta.serie) + `<nGuia>${soDigitos(dados.gta.numero)}</nGuia></guiaTransito></agropecuario>` : '') +
    '</infNFe></NFe>'

  return { xml, chave, id, valorTotal: vNF }
}
