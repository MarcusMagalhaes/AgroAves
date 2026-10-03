# Emissor de NF-e — memória para a próxima sessão

## Regras que não mudam

- **Somente homologação** (`NFE_AMBIENTE=2`). O código recusa produção (`src/config.ts`); não remover essa trava sem
  pedido explícito do usuário e sem o contador validar CFOP/CSOSN/NCM.
- **Certificado A1 (.pfx) e senha nunca entram no repositório, no código nem no chat.** Ficam só em `nfe/.env` (ignorado
  pelo git), apontando para um caminho fora do repo. Antes de qualquer commit, conferir que nenhum `.pfx`, `.p12`, `.env`
  ou `saida/` foi adicionado. Não pedir a senha ao usuário: ele preenche o `.env` sozinho.
- Nunca desligar a verificação TLS (`NODE_TLS_REJECT_UNAUTHORIZED=0` está proibido). Se faltar a cadeia ICP-Brasil, usar `NFE_CA_FILE`.

## Teste em homologação (o que fazer nesta sessão)

Pré-requisitos na máquina: Node 22; `xmllint` é opcional (sem ele a validação de schema é pulada com aviso — no Windows
normalmente não existe).

1. `cd nfe && npm install`
2. Criar `nfe/.env` a partir de `.env.example` (o usuário preenche `NFE_PFX` e `NFE_PFX_SENHA`; no Windows o caminho
   pode ser `C:/Users/.../certificado.pfx`).
3. `npm test` — 7 testes offline devem passar.
4. `npm run status` — esperado `107 — Servico em Operacao`. Se der `unable to get local issuer certificate`, montar o
   PEM da cadeia ICP-Brasil (site do ITI, acraiz.icpbrasil.gov.br) e definir `NFE_CA_FILE`.
5. `npm run gerar` — gera e valida o XML de `exemplos/pedido-exemplo.json` sem enviar.
6. `npm run emitir` — envia à SEFAZ-MG homologação. Sucesso = `AUTORIZADA` + protocolo; arquivos em `nfe/saida/`
   (`-nfe.xml`, `-retorno.xml`, `-procNFe.xml`).
7. Rejeição: ler `cStat`/`xMotivo` e o `saida/<chave>-retorno.xml`, corrigir em `src/xml.ts` e reenviar.
   - Duplicidade de numeração → mudar `NFE_SERIE` ou apagar `saida/numeracao-homologacao.json`.
   - Responsável técnico obrigatório → incluir o grupo `infRespTec` (fica após `infAdic`/`agropecuario` no leiaute).
   - Regras de CFOP/CSOSN/NCM → anotar e levar ao contador.

## Dados do emitente (já em `src/config.ts`)

AGROAVES DISTRIBUIDORA PINTINHOS DE UM DIA LTDA · CNPJ 51.071.556/0001-00 · IE 0046416040000 · Simples Nacional (CRT 1),
sem crédito de ICMS · Av. Joaquim Avelino dos Reis, 634, Industrial · Santana do Paraíso/MG · IBGE 3158953 · CEP 35179-000.

## Pendências

- **Certificado A1 vence em 23/10/2026** (AC SyngularID Múltipla). Testar antes disso ou com o certificado renovado.
- Contador confirmar: NCM (exemplo usa 0105.11.90), CFOP (5102 interno / 6102 interestadual), CSOSN (102; aves vivas
  podem ser 103/300/400), natureza da operação.
- Saber a **série e o último número** de NF-e usados no sistema atual; em produção usar série diferente para não colidir.
- Telefone do emitente veio com 7 dígitos ("31 3822-363"); hoje não é enviado.

## Próximas etapas (depois da primeira nota autorizada)

1. Banco: campos fiscais em `cliente` (IE, endereço estruturado, CEP, cód. IBGE, UF, e-mail) e `produto` (NCM, CFOP,
   CSOSN, unidade); tabela `nota_fiscal` (pedido, série, número, chave, status, protocolo, XML) com numeração no banco.
2. Tela: botão "Emitir NF" em Impressões › Nota fiscal (`src/pages/admin/Documentos.tsx`, componente `DocNf`), por rota,
   com validação de cadastro e status por nota.
3. DANFE em PDF, cancelamento, carta de correção, inutilização, contingência.
4. Hospedagem do emissor como serviço (o front é estático; Supabase Edge Functions não fazem bem mTLS/XML-DSig) com
   o certificado guardado como segredo no servidor.

## Mapa do código

`src/config.ts` emitente, endpoints MG, leitura do `.env` · `src/chave.ts` chave de acesso/DV · `src/xml.ts` XML 4.00 ·
`src/certificado.ts` leitura do .pfx · `src/assinatura.ts` XML-DSig · `src/validar.ts` xmllint + `schemas/` (PL_010 v1.30) ·
`src/sefaz.ts` SOAP/mTLS · `src/cli.ts` comandos · `test/nfe.test.ts` testes offline.
