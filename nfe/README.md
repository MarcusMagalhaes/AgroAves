# Emissor próprio de NF-e — protótipo (somente homologação)

Prova de conceito do emissor de NF-e (modelo 55) dentro do AgroAves, **sem plataforma terceira**: o próprio sistema monta o
XML, assina com o certificado A1 da empresa e envia direto para a SEFAZ-MG.

> **Travado em homologação.** O código recusa `NFE_AMBIENTE` diferente de `2`. As notas de homologação **não têm valor
> fiscal**: o destinatário sai como "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL".

## O que já faz

| Etapa | Arquivo |
|---|---|
| Chave de acesso (44 dígitos) e dígito verificador | `src/chave.ts` |
| XML da NF-e 4.00 a partir de um pedido (emitente Simples Nacional, CSOSN 102, PIS/COFINS CST 49, referência à **GTA**) | `src/xml.ts` |
| Leitura do certificado A1 (.pfx) | `src/certificado.ts` |
| Assinatura digital XML-DSig (RSA-SHA1, C14N), conferida após assinar | `src/assinatura.ts` |
| Validação contra os schemas oficiais (`schemas/`, pacote PL_010 v1.30) | `src/validar.ts` |
| Status do serviço e autorização na SEFAZ-MG (síncrona, com consulta de recibo se vier em lote) | `src/sefaz.ts` |

Ainda não faz (próximas etapas): DANFE em PDF, cancelamento, carta de correção, inutilização, contingência,
integração com as telas e o banco do AgroAves.

## Como testar (no computador de quem tem o certificado)

A SEFAZ só aceita conexão com o certificado da empresa, então o teste roda numa máquina com o `.pfx` e a senha.
Requisitos: Node 22 e, opcionalmente, `xmllint` (valida o XML antes de enviar; no Linux vem no pacote `libxml2-utils`).

```bash
cd nfe
npm install
cp .env.example .env        # preencha NFE_PFX e NFE_PFX_SENHA (o .env não vai para o git)
npm test                    # testes offline, com certificado de teste gerado na hora
npm run status              # 1º passo: certificado + conexão. Esperado: "107 — Servico em Operacao"
npm run gerar               # monta, assina e valida o XML de exemplo, sem enviar (fica em nfe/saida/)
npm run emitir              # envia o exemplo para autorização em homologação
```

O pedido de exemplo está em `exemplos/pedido-exemplo.json`; para testar outro, `npm run emitir caminho/do/pedido.json`.
Uma nota autorizada pode ser conferida pela chave no portal de homologação da NF-e.

### Se der erro

- **`unable to get local issuer certificate`**: o Node não conhece a cadeia ICP-Brasil do servidor da SEFAZ. Baixe os
  certificados das ACs no site do ITI (acraiz.icpbrasil.gov.br), junte-os num único arquivo PEM e aponte `NFE_CA_FILE` para ele.
  Nunca desligue a verificação TLS.
- **Senha / `Invalid password` / `PKCS#12 MAC could not be verified`**: senha do certificado errada.
- **Rejeição da SEFAZ** (código + motivo aparecem na tela; o retorno completo fica em `saida/<chave>-retorno.xml`): os mais
  prováveis no primeiro teste são numeração repetida (apague `saida/numeracao-homologacao.json` ou mude `NFE_SERIE`),
  responsável técnico obrigatório (`infRespTec`) ou regra fiscal de CFOP/CSOSN — mande o retorno para ajustarmos.

## Pendências fiscais (confirmar com o contador antes de produção)

- **Série e último número** em uso no sistema atual (em produção a numeração virá do banco, com trava contra duplicidade).
- **NCM** dos produtos (exemplo usa 0105.11.90), **CFOP** (exemplo: 5102 dentro de MG; fora seria 6102) e **CSOSN**
  (exemplo: 102; aves vivas podem ter isenção, caso de 103/300/400).
- Telefone do emitente veio com 7 dígitos no cadastro ("31 3822-363").

## Segurança do certificado

O `.pfx` e a senha ficam **fora do repositório** (`.gitignore` bloqueia `*.pfx`, `*.p12`, `.env` e `saida/`). Em produção,
ficarão só no servidor do emissor, como segredo, nunca no navegador.
