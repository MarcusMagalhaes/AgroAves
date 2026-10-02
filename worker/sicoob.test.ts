import { describe, expect, it, vi } from 'vitest'
import { cnpjValido, cpfValido, montarPagador, pendenciasPagador, type ClientePagador } from '../src/lib/boleto'
import { ErroSicoob, Sicoob, lerBoleto, lerSituacao, pdfDeBase64, montarInclusao, somaDias, type ConfigCobranca } from './sicoob'
import { hojeBrasilia, tratarApi, type Env } from './index'

const cliente: ClientePagador = {
  cnpj_cpf: '11.222.333/0001-81', razao_social: 'Granja Exemplo Ltda', endereco: 'Rua 87, Quadra 1, Lote 1',
  bairro: 'Santa Rosa', cidade: 'Luziânia', cep: '72.320-000', uf: 'go', email: 'financeiro@exemplo.com.br',
}
const config: ConfigCobranca = {
  numero_cliente: 25546454, codigo_modalidade: 1, numero_conta_corrente: 12345, numero_contrato_cobranca: null,
  especie_documento: 'DM', multa_percentual: 2, juros_mes_percentual: 1, com_pix: true, mensagem: 'Não receber após 30 dias',
}

/** fetch simulado: registra as chamadas e responde na ordem dada */
function fetchSimulado(...respostas: Array<{ status?: number; corpo?: unknown }>) {
  const chamadas: Array<{ url: string; init?: RequestInit }> = []
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    chamadas.push({ url, init })
    const r = respostas.shift() ?? { status: 500, corpo: { mensagens: [{ mensagem: 'sem resposta simulada' }] } }
    return new Response(r.corpo === undefined ? null : JSON.stringify(r.corpo), { status: r.status ?? 200 })
  })
  return { fn, chamadas }
}

describe('validação do pagador', () => {
  it('CPF e CNPJ', () => {
    expect(cpfValido('529.982.247-25')).toBe(true)
    expect(cpfValido('529.982.247-24')).toBe(false)
    expect(cpfValido('111.111.111-11')).toBe(false)
    expect(cnpjValido('11.222.333/0001-81')).toBe(true)
    expect(cnpjValido('11.222.333/0001-80')).toBe(false)
  })
  it('aponta o que falta no cadastro', () => {
    expect(pendenciasPagador(cliente)).toEqual([])
    expect(pendenciasPagador({ ...cliente, cnpj_cpf: '123', bairro: ' ', cep: '7232', uf: 'XX' }))
      .toEqual(['CNPJ/CPF inválido', 'bairro', 'CEP', 'UF'])
  })
  it('normaliza para a API', () => {
    expect(montarPagador(cliente)).toEqual({
      numeroCpfCnpj: '11222333000181', nome: 'Granja Exemplo Ltda', endereco: 'Rua 87, Quadra 1, Lote 1',
      bairro: 'Santa Rosa', cidade: 'Luziânia', cep: '72320000', uf: 'GO', email: 'financeiro@exemplo.com.br',
    })
    expect(() => montarPagador({ ...cliente, cep: null })).toThrow(/CEP/)
  })
})

describe('montarInclusao', () => {
  const base = { config, cliente, titulo: { id: 4521, valor: 1256.1, data_referencia: '2026-10-01' }, vencimento: '2026-10-08', hoje: '2026-10-02' }
  it('monta o corpo do POST /boletos', () => {
    const c = montarInclusao(base)
    expect(c).toMatchObject({
      numeroCliente: 25546454, codigoModalidade: 1, numeroContaCorrente: 12345, codigoEspecieDocumento: 'DM',
      dataEmissao: '2026-10-02', seuNumero: '4521', valor: 1256.1, dataVencimento: '2026-10-08',
      tipoMulta: 2, dataMulta: '2026-10-09', valorMulta: 2, tipoJurosMora: 2, dataJurosMora: '2026-10-09', valorJurosMora: 1,
      gerarPdf: true, codigoCadastrarPIX: 1, mensagensInstrucao: { mensagens: ['Não receber após 30 dias'] },
    })
    expect(c).not.toHaveProperty('nossoNumero')            // o banco gera
    expect(c).not.toHaveProperty('numeroContratoCobranca')
    expect(c).not.toHaveProperty('identificacaoBoletoEmpresa')   // não existe na v3
    expect(montarInclusao({ ...base, config: { ...config, numero_conta_corrente: null } }).numeroContaCorrente).toBe(0)
  })
  it('sem multa/juros e sem Pix', () => {
    const c = montarInclusao({ ...base, config: { ...config, multa_percentual: 0, juros_mes_percentual: 0, com_pix: false } })
    expect(c).toMatchObject({ tipoMulta: 0, tipoJurosMora: 3, codigoCadastrarPIX: 2 })
    expect(c).not.toHaveProperty('valorMulta')
  })
  it('recusa vencimento passado, valor não positivo e beneficiário não configurado', () => {
    expect(() => montarInclusao({ ...base, vencimento: '2026-10-01' })).toThrow(/vencimento/)
    expect(() => montarInclusao({ ...base, titulo: { ...base.titulo, valor: -10 } })).toThrow(/valor positivo/)
    expect(() => montarInclusao({ ...base, config: { ...config, numero_cliente: null } })).toThrow(/número do cliente/)
  })
  it('somaDias atravessa mês e ano', () => {
    expect(somaDias('2026-12-31', 1)).toBe('2027-01-01')
    expect(somaDias('2026-02-28', 1)).toBe('2026-03-01')
  })
})

describe('cliente Sicoob (sandbox)', () => {
  const opcoes = { ambiente: 'SANDBOX' as const, clientId: 'cid', tokenSandbox: 'tok' }

  it('inclui boleto com os cabeçalhos do sandbox e lê o retorno', async () => {
    const { fn, chamadas } = fetchSimulado({ corpo: { resultado: {
      nossoNumero: 2588658, linhaDigitavel: '75691.12345 01234.567890 12345.678901 1 99990000125610',
      codigoBarras: '75691999900001256101123401234567891234567890', qrCode: '00020101021226...', pdfBoleto: 'JVBERi0x',
    } } })
    const s = new Sicoob({ ...opcoes, fetcher: fn })
    const r = await s.incluir(montarInclusao({ config, cliente, titulo: { id: 1, valor: 10, data_referencia: '2026-10-01' }, vencimento: '2026-10-08', hoje: '2026-10-02' }))
    expect(chamadas[0].url).toBe('https://sandbox.sicoob.com.br/sicoob/sandbox/cobranca-bancaria/v3/boletos')
    expect(chamadas[0].init?.method).toBe('POST')
    expect(chamadas[0].init?.headers).toMatchObject({ Authorization: 'Bearer tok', client_id: 'cid', 'Content-Type': 'application/json' })
    expect(r).toMatchObject({ nossoNumero: 2588658, pixCopiaCola: '00020101021226...', pdfBase64: 'JVBERi0x' })
    expect(r.resposta).not.toHaveProperty('pdfBoleto')     // o PDF vai para o Storage, não para o banco de dados
  })

  it('transforma a lista de mensagens de erro do banco', async () => {
    const { fn } = fetchSimulado({ status: 400, corpo: { mensagens: [{ mensagem: 'CEP do pagador inválido', codigo: '4001' }, { mensagem: 'UF inválida' }] } })
    const s = new Sicoob({ ...opcoes, fetcher: fn })
    await expect(s.consultar(config, 1)).rejects.toThrow('HTTP 400: 4001 CEP do pagador inválido · UF inválida')
    await expect(s.consultar(config, 1)).rejects.toBeInstanceOf(ErroSicoob)
  })

  it('consulta, 2ª via e baixa usam o nosso número', async () => {
    const { fn, chamadas } = fetchSimulado(
      { corpo: { resultado: { situacaoBoleto: 'Em Aberto' } } },
      { corpo: { resultado: { nossoNumero: 77, pdfBoleto: 'JVBE' } } },
      { status: 204 },
    )
    const s = new Sicoob({ ...opcoes, fetcher: fn })
    expect((await s.consultar(config, 77)).situacao).toBe('ABERTO')
    expect((await s.segundaVia(config, 77)).pdfBase64).toBe('JVBE')
    await s.baixar(config, 77)
    expect(chamadas[0].url).toContain('/boletos?numeroCliente=25546454&codigoModalidade=1&nossoNumero=77')
    expect(chamadas[1].url).toContain('/boletos/segunda-via?')
    expect(chamadas[1].url).toContain('gerarPdf=true')
    expect(chamadas[2].url).toMatch(/\/boletos\/77\/baixar$/)
    expect(JSON.parse(String(chamadas[2].init?.body))).toEqual({ numeroCliente: 25546454, codigoModalidade: 1 })
  })

  it('produção pede token OAuth e reaproveita enquanto vale', async () => {
    const { fn, chamadas } = fetchSimulado(
      { corpo: { access_token: 'oauth', expires_in: 300 } },
      { corpo: { resultado: { situacaoBoleto: 'Em Aberto' } } },
      { corpo: { resultado: { situacaoBoleto: 'Em Aberto' } } },
    )
    const s = new Sicoob({ ambiente: 'PRODUCAO', clientId: 'cid', fetcher: fn })
    await s.consultar(config, 1); await s.consultar(config, 2)
    expect(chamadas.map((c) => c.url)).toEqual([
      'https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token',
      expect.stringContaining('https://api.sicoob.com.br/cobranca-bancaria/v3/boletos?'),
      expect.stringContaining('https://api.sicoob.com.br/cobranca-bancaria/v3/boletos?'),
    ])
    expect(String(chamadas[0].init?.body)).toContain('grant_type=client_credentials')
    expect(chamadas[1].init?.headers).toMatchObject({ Authorization: 'Bearer oauth' })
  })

  it('erro com o exemplo da documentação mostra o retorno bruto', async () => {
    const corpo = { mensagens: [{ mensagem: 'string', codigo: 'string' }] }
    const { fn } = fetchSimulado({ status: 400, corpo })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(new Sicoob({ ...opcoes, fetcher: fn }).consultar(config, 1)).rejects.toThrow(`HTTP 400: ${JSON.stringify(corpo)}`)
  })

  it('sandbox devolve o exemplo da documentação (nosso número 0, "string"): aceita só no sandbox', async () => {
    const exemplo = { resultado: { nossoNumero: 0, linhaDigitavel: 'string', codigoBarras: 'string', qrCode: 'string', pdfBoleto: 'string' } }
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const corpo = montarInclusao({ config, cliente, titulo: { id: 1, valor: 10, data_referencia: '2026-10-01' }, vencimento: '2026-10-08', hoje: '2026-10-02' })
    const sb = new Sicoob({ ...opcoes, fetcher: fetchSimulado({ corpo: exemplo }).fn })
    expect(await sb.incluir(corpo)).toMatchObject({ nossoNumero: 0, linhaDigitavel: null, pixCopiaCola: null, pdfBase64: null })
    const prod = new Sicoob({ ambiente: 'PRODUCAO', clientId: 'cid', fetcher: fetchSimulado({ corpo: { access_token: 't' } }, { corpo: exemplo }).fn })
    await expect(prod.incluir(corpo)).rejects.toThrow(/nosso número/)
  })

  it('aceita o formato em lista da v2', () => {
    expect(lerBoleto({ resultado: [{ status: { codigo: 200 }, boleto: { nossoNumero: 55, linhaDigitavel: '7569' } }] }))
      .toMatchObject({ nossoNumero: 55, linhaDigitavel: '7569' })
  })

  it('exige token no sandbox', () => {
    expect(() => new Sicoob({ ambiente: 'SANDBOX', clientId: 'cid' })).toThrow(/SICOOB_TOKEN/)
  })
})

describe('pdfDeBase64', () => {
  const pdf = btoa('%PDF-1.4 teste\n%%EOF\n')
  it('aceita base64, data URI, base64url e sem padding', () => {
    expect(new TextDecoder().decode(pdfDeBase64(pdf)!)).toBe('%PDF-1.4 teste\n%%EOF\n')
    expect(pdfDeBase64(`data:application/pdf;base64,${pdf}`)).not.toBeNull()
    expect(pdfDeBase64(pdf.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'))).not.toBeNull()
    expect(pdfDeBase64(pdf.slice(0, 10) + '\n' + pdf.slice(10))).not.toBeNull()
  })
  it('recusa o que não é PDF em base64 sem lançar erro', () => {
    for (const v of [null, '', 'string', 'não é base64!', 'https://exemplo/boleto.pdf', btoa('<html>'), 'abcde']) expect(pdfDeBase64(v)).toBeNull()
    expect(pdfDeBase64(btoa('%PDF-1.4 truncado sem fim'))).toBeNull()   // exemplo do sandbox
  })
})

describe('lerSituacao', () => {
  it('liquidado com data do histórico', () => {
    expect(lerSituacao({ situacaoBoleto: 'Liquidado', listaHistorico: [
      { dataHistorico: '2026-10-01T00:00:00-03:00', descricaoHistorico: 'Entrada do título' },
      { dataHistorico: '2026-10-07T00:00:00-03:00', descricaoHistorico: 'Liquidação via Pix' },
    ] })).toEqual({ situacao: 'LIQUIDADO', dataLiquidacao: '2026-10-07', valorPago: null })
  })
  it('baixado e em aberto', () => {
    expect(lerSituacao({ situacaoBoleto: 'Baixado' }).situacao).toBe('BAIXADO')
    expect(lerSituacao({ situacaoBoleto: 'Em Aberto' }).situacao).toBe('ABERTO')
    expect(lerSituacao({}).situacao).toBe('ABERTO')
  })
})

describe('Worker', () => {
  const env = { SUPABASE_URL: '', SUPABASE_ANON_KEY: '', ASSETS: { fetch: async () => new Response('site') } } as Env

  it('data de hoje no fuso de Brasília', () => {
    expect(hojeBrasilia(new Date('2026-10-03T01:30:00Z'))).toBe('2026-10-02')   // 22h30 em Brasília
  })
  it('rota desconhecida e configuração ausente', async () => {
    expect((await tratarApi(new Request('https://x/api/nada', { method: 'POST' }), env)).status).toBe(404)
    const r = await tratarApi(new Request('https://x/api/boletos/emitir', { method: 'POST' }), env)
    expect(r.status).toBe(500)
    expect((await r.json()).erro).toMatch(/SUPABASE_URL/)
  })
  it('exige login', async () => {
    const r = await tratarApi(new Request('https://x/api/boletos/emitir', { method: 'POST' }), { ...env, SUPABASE_URL: 'https://p.supabase.co', SUPABASE_ANON_KEY: 'k' })
    expect(r.status).toBe(401)
  })
})
