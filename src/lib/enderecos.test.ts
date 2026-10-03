import { describe, expect, it, vi } from 'vitest'
import { buscarEndereco, camposParaGravar, faltaEndereco, numeroNaFaixa, partesEndereco, type ClienteEndereco } from './enderecos'

const base: ClienteEndereco = {
  id: 1, codigo: 125, razao_social: 'Casa do Sitio', cnpj_cpf: null, endereco: 'AVENIDA MONSENHOR ARISTIDES ROCHA, 525, GRACA',
  bairro: null, cidade: 'CARATINGA', cep: null, uf: null,
}

/** fetch simulado por prefixo de URL */
function fetchSimulado(rotas: Record<string, { status?: number; corpo: unknown }>) {
  const urls: string[] = []
  const fn = vi.fn(async (url: string) => {
    urls.push(url)
    const k = Object.keys(rotas).find((p) => url.startsWith(p))
    const r = k ? rotas[k] : { status: 404, corpo: {} }
    return new Response(JSON.stringify(r.corpo), { status: r.status ?? 200 })
  })
  return { fn, urls }
}

describe('partesEndereco', () => {
  it('rua, número e tipo', () => {
    expect(partesEndereco('AVENIDA MONSENHOR ARISTIDES ROCHA, 525, GRACA')).toEqual({ logradouro: 'MONSENHOR ARISTIDES ROCHA', numero: 525, cep: null })
    expect(partesEndereco('Av. João Pinheiro nº 1200 Centro')).toEqual({ logradouro: 'JOAO PINHEIRO', numero: 1200, cep: null })
    expect(partesEndereco('R. Sete de Setembro 45')).toEqual({ logradouro: 'SETE DE SETEMBRO', numero: 45, cep: null })
  })
  it('rua com número no nome', () => {
    expect(partesEndereco('Rua 7 de Setembro, 100')).toEqual({ logradouro: '7 DE SETEMBRO', numero: 100, cep: null })
    expect(partesEndereco('RUA 7 DE SETEMBRO 100 CENTRO')).toMatchObject({ logradouro: '7 DE SETEMBRO', numero: 100 })
  })
  it('CEP escrito no endereço', () => {
    expect(partesEndereco('Rua A, 10 - CEP 35300-344')).toMatchObject({ logradouro: 'A', numero: 10, cep: '35300344' })
  })
})

describe('numeroNaFaixa', () => {
  it('faixas do ViaCEP', () => {
    expect(numeroNaFaixa(525, 'até 499/500')).toBe(false)
    expect(numeroNaFaixa(400, 'até 499/500')).toBe(true)
    expect(numeroNaFaixa(525, 'de 501/502 ao fim')).toBe(true)
    expect(numeroNaFaixa(525, 'de 501 a 999 - lado ímpar')).toBe(true)
    expect(numeroNaFaixa(526, 'de 502 a 1000 - lado ímpar')).toBe(false)
    expect(numeroNaFaixa(525, '')).toBeNull()
    expect(numeroNaFaixa(null, 'até 499')).toBeNull()
  })
})

describe('buscarEndereco', () => {
  it('CNPJ: usa o endereço da Receita', async () => {
    const { fn, urls } = fetchSimulado({
      'https://brasilapi.com.br/api/cnpj/v1/': { corpo: {
        cep: '35300344', uf: 'MG', municipio: 'CARATINGA', bairro: 'GRACA', descricao_tipo_de_logradouro: 'AVENIDA',
        logradouro: 'MONSENHOR ARISTIDES ROCHA', numero: '525', complemento: '',
      } },
    })
    const r = await buscarEndereco(fn, { ...base, cnpj_cpf: '11.222.333/0001-81' }, 'MG')
    expect(r).toEqual({ status: 'OK', fonte: 'Receita (CNPJ)', achado: {
      endereco: 'AVENIDA MONSENHOR ARISTIDES ROCHA, 525', bairro: 'GRACA', cidade: 'CARATINGA', cep: '35300344', uf: 'MG',
    } })
    expect(urls).toEqual(['https://brasilapi.com.br/api/cnpj/v1/11222333000181'])
  })

  it('CPF nunca é enviado: vai direto para a busca pela rua', async () => {
    const { fn, urls } = fetchSimulado({ 'https://viacep.com.br/ws/MG/': { corpo: [
      { cep: '35300-344', logradouro: 'Avenida Monsenhor Aristides Rocha', complemento: '', bairro: 'Graça', localidade: 'Caratinga', uf: 'MG' },
    ] } })
    const r = await buscarEndereco(fn, { ...base, cnpj_cpf: '529.982.247-25' }, 'MG')
    expect(r).toMatchObject({ status: 'OK', fonte: 'Correios (rua)', achado: { cep: '35300344', bairro: 'Graça', uf: 'MG' } })
    expect(urls.join()).not.toContain('52998224725')
    expect(urls[0]).toBe('https://viacep.com.br/ws/MG/CARATINGA/MONSENHOR%20ARISTIDES%20ROCHA/json/')
  })

  it('rua com vários CEPs: escolhe pela numeração', async () => {
    const { fn } = fetchSimulado({ 'https://viacep.com.br/ws/MG/': { corpo: [
      { cep: '35300-001', complemento: 'até 499/500', bairro: 'Centro', localidade: 'Caratinga', uf: 'MG' },
      { cep: '35300-344', complemento: 'de 501/502 ao fim', bairro: 'Graça', localidade: 'Caratinga', uf: 'MG' },
    ] } })
    expect(await buscarEndereco(fn, base, 'MG')).toMatchObject({ status: 'OK', achado: { cep: '35300344', bairro: 'Graça' } })
  })

  it('rua com vários CEPs sem faixa: pede escolha', async () => {
    const { fn } = fetchSimulado({ 'https://viacep.com.br/ws/MG/': { corpo: [
      { cep: '35300-100', complemento: '', bairro: 'Centro', localidade: 'Caratinga', uf: 'MG' },
      { cep: '35300-200', complemento: '', bairro: 'Esplanada', localidade: 'Caratinga', uf: 'MG' },
    ] } })
    const r = await buscarEndereco(fn, base, 'MG')
    expect(r.status).toBe('AMBIGUO')
    expect(r.status === 'AMBIGUO' && r.opcoes.map((o) => o.cep)).toEqual(['35300100', '35300200'])
  })

  it('CNPJ sem resposta cai para a rua; nada encontrado', async () => {
    const { fn, urls } = fetchSimulado({ 'https://brasilapi.com.br/': { status: 404, corpo: {} }, 'https://viacep.com.br/': { corpo: [] } })
    const r = await buscarEndereco(fn, { ...base, cnpj_cpf: '11222333000181' }, 'MG')
    expect(r).toEqual({ status: 'NAO_ENCONTRADO', motivo: 'rua não encontrada nos Correios' })
    expect(urls).toHaveLength(2)
  })

  it('sem CNPJ e sem endereço', async () => {
    const { fn } = fetchSimulado({})
    expect(await buscarEndereco(fn, { ...base, endereco: null }, 'MG')).toMatchObject({ status: 'NAO_ENCONTRADO' })
  })
})

describe('camposParaGravar', () => {
  it('só completa bairro, CEP e UF vazios', () => {
    const achado = { endereco: 'AV X, 1', bairro: 'Graça', cidade: 'Caratinga', cep: '35300344', uf: 'MG' }
    expect(camposParaGravar(base, achado)).toEqual({ bairro: 'Graça', cep: '35300-344', uf: 'MG' })
    // endereço e cidade nunca mudam; campo preenchido (mesmo diferente) é mantido
    expect(camposParaGravar({ ...base, bairro: 'Centro', uf: 'MG', endereco: null, cidade: null }, achado)).toEqual({ cep: '35300-344' })
    expect(camposParaGravar({ ...base, bairro: 'Centro', cep: '35300-000', uf: 'MG' }, achado)).toEqual({})
  })
  it('faltaEndereco', () => {
    expect(faltaEndereco(base)).toBe(true)
    expect(faltaEndereco({ ...base, bairro: 'Graça', cep: '35300-344', uf: 'MG' })).toBe(false)
  })
})
