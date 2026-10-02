# AgroAves 2.0

Sistema web de gestão de vendas semanais de aves por rotas — substitui as planilhas Google Sheets + Apps Script.
Documentação do sistema em `../docs/sistema-2.0/`; especificação original em `../docs/sistema-1.0/08`–`11`.

**Stack**: React 19 + TypeScript + Vite 5 + Tailwind 3 · Supabase (PostgreSQL, Auth, RLS) · Cloudflare Workers/estáticos (GitHub só como repositório).

## Estrutura

```
app/
  supabase/migrations/   0001_schema.sql (tabelas, views, funções de negócio) · 0002_rls.sql (segurança) · 0003_seed.sql (produtos, cidades) · 0004 cor do produto · 0005 auditoria · 0006 admin TI · 0007 centro de custo · 0008 contas a pagar · 0009 anexos do contas a pagar · 0010 dashboards · 0011 boletos Sicoob
  src/
    lib/                 boleto.ts (validação do pagador), cobranca.ts (API de boletos), supabase.ts, auth.tsx (login e papel), dados.ts (consultas), mapa.ts (mapa de entrega), format.ts, types.ts
    components/          Layout (menu responsivo), Logo (marca nova), ui (modal, toast, campos)
    pages/               Login, Venda (tela do vendedor), Mapa
    pages/admin/         Programacao (planilha), PedidoFornecedor, AjusteEntrega, Documentos (mapa/recibos/GTA/NF), Financeiro, Fechamento,
                         Clientes, Rotas (ordem de entrega), Produtos, Vendedores, Fornecedores, Usuarios, CentrosCusto (só TI), ContasPagar
  worker/                index.ts (Worker do Cloudflare: site + /api/boletos/*), sicoob.ts (API Cobrança Bancária v3) e testes
  migracao/migrar.py     extrai os .xlsx, limpa, gera CSVs + rejeições e (opcional) carrega no banco com reconciliação
```

## 1. Banco (Supabase)

1. Projeto: `https://qqpavhptvptgktnzoawi.supabase.co`. Em **SQL Editor**, execute na ordem: `0001_schema.sql` … `0011_boletos.sql` (base já existente: só as que ainda não rodaram).
2. **Login com Google** (Authentication › Providers › Google): ative e cole Client ID + Secret de um cliente OAuth do Google Cloud
   (pode reutilizar o do Controle Metanoia, acrescentando as origens/redirecionamentos abaixo):
   - Origens JavaScript autorizadas: `https://qqpavhptvptgktnzoawi.supabase.co` e o endereço do Cloudflare (`https://agroaves.<sua-conta>.workers.dev` ou domínio próprio)
   - URI de redirecionamento: `https://qqpavhptvptgktnzoawi.supabase.co/auth/v1/callback`
3. Authentication › **URL Configuration**: Site URL = endereço do Cloudflare; Redirect URLs `<endereço do Cloudflare>/**` e `http://localhost:5173/**`.
4. Abra o site e clique **Entrar com Google** com markvpm@gmail.com: o gatilho em `auth.users` cria o usuário como **ADMIN_TI** (agroavesdistribuidora10@gmail.com entra como ADMIN).
   Outras pessoas que entrarem ficam "aguardando liberação" até o administrador definir o papel em **Usuários**.
5. Em **Settings › API** estão `Project URL` e `anon key` usadas no `.env` e nas variáveis de build do Cloudflare.

## 2. Rodar localmente

```bash
cd app
cp .env.example .env     # preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm install
npm run dev              # http://localhost:5173
```

## 3. Migrar os dados das planilhas

```bash
pip install openpyxl psycopg2-binary
# carga de ensaio (só CSVs + rejeicoes.csv em migracao/saida/)
python migracao/migrar.py --admin ../Admin.xlsx --vendas "../VENDAS - Agro Aves Distribuidora.xlsx"
# carga real (string de conexão em Supabase › Settings › Database › Connection string, URI)
python migracao/migrar.py --admin ../Admin.xlsx --vendas "../VENDAS - Agro Aves Distribuidora.xlsx" --dsn "postgresql://postgres:SENHA@db.xxxx.supabase.co:5432/postgres"
```

Depois da carga: em **Rotas**, confira vendedor e semana atual; em **Vendedores**, vincule os logins; em **Fornecedores**, confira o fornecedor "Granja".
Revise `migracao/saida/rejeicoes.csv` (decisões D-11…D-17 em `docs/sistema-1.0/11`). Opção `--limpar-tudo` apaga pedidos, contatos, granja e títulos antes de recarregar.

## 4. Publicar no Cloudflare (Workers, arquivos estáticos)

Repositório: https://github.com/MarcusMagalhaes/AgroAves · Site: `https://agroaves.<sua-conta>.workers.dev`

O GitHub é só o repositório: o Cloudflare (Workers Builds, integração Git) compila e publica a cada push em `main`.
A configuração está em `wrangler.jsonc` (nome `agroaves`, build `npm run build`, pasta `dist`); no painel o comando de deploy é `npx wrangler deploy`.

Variáveis de **build** (Workers › agroaves › Settings › Build › Variables and secrets): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
A chave *anon* é pública por desenho; a segurança está nas políticas RLS. Node 22 (`.nvmrc`). Cabeçalhos em `public/_headers`.

Transição: enquanto o Cloudflare não estiver no ar, `.github/workflows/deploy.yml` continua publicando em
`marcusmagalhaes.github.io/AgroAves/` (com `VITE_BASE=/AgroAves/`). Quando o Cloudflare estiver funcionando: atualize as URLs
no Supabase e no Google (seção 1), apague o `deploy.yml` e desative GitHub › Settings › Pages.

```bash
git add -A && git commit -m "..." && git push      # publica automaticamente
```

## Perfis

| Papel | Acesso |
| --- | --- |
| ADMIN_TI | tudo do ADMIN + telas exclusivas da TI (Centros de custo, Contas a pagar, tipo de fornecedor). Exclusivo de markvpm@gmail.com: definido só pelo banco (`0006_admin_ti.sql`), não aparece como opção em Usuários e não pode ser atribuído, alterado, desativado ou excluído pela aplicação |
| ADMIN | tudo (exceto telas da TI) |
| VENDEDOR | Venda semanal e Mapa, apenas das rotas em que é o vendedor cadastrado |

## Centros de custo (TI)

Usados no contas a pagar e no contas a receber. Árvore de 4 níveis com código falante gerado pelo banco a partir do pai:
`1000` (milhar, raiz) › `1100` (centena) › `1110` (dezena) › `1111` (unidade) — até 9 filhos por nível; o tipo (a pagar/a receber)
é escolhido na raiz e herdado pelos filhos. Código, pai e tipo nunca mudam; não há exclusão: desativar um centro de custo
desativa toda a descendência.

## Fornecedores e contas a pagar

**Exclusivo do ADMIN_TI**: centros de custo, contas a pagar e fornecedores de Material/Consumo (telas, RLS e auditoria).
Os demais administradores só veem e cadastram fornecedores de Produto para venda, sem o campo tipo.

Fornecedor tem tipo: **Produto para venda** (granja — único que aparece no Pedido à granja), **Material** e **Consumo**.
Contas a pagar (Financeiro › Contas a pagar): fornecedor (qualquer tipo), vencimento, valor, centro de custo do tipo a pagar
(qualquer nível da árvore) e observação. Anexos (conta/boleto, comprovante, outros; PDF, imagem ou XML até 10 MB) ficam no
bucket privado `contas-pagar` do Supabase Storage, criado pela `0009`. Pendente → Pago (com data; pode ser estornado) ou Cancelado (com motivo); não se exclui.

## Boletos Sicoob (contas a receber)

Integração com a **API Cobrança Bancária v3** do Sicoob, feita pelo Worker do Cloudflare (`worker/`). O navegador nunca vê
as credenciais do banco: chama `/api/boletos/*` com o login do Supabase, e o Worker confere se é administrador (`eh_admin()`)
e grava com as mesmas regras RLS da tela.

- **Emitir**: Financeiro › linha do título › *Emitir boleto* (ou selecione vários › *Emitir boletos*). O boleto sai com PDF,
  linha digitável e QR Code Pix (boleto híbrido), vence na `data_vencimento` do título (entrega + prazo da configuração;
  ajustável na emissão) e tem multa/juros da configuração. O PDF fica no bucket privado `boletos`.
- **Cadastro do cliente**: o banco exige CNPJ/CPF válido, endereço, bairro, cidade, CEP e UF (Clientes avisa o que falta).
- **Conferir pagamentos**: consulta no Sicoob os boletos em aberto; os pagos baixam o título na data do pagamento.
- **Baixar no banco**: título cancelado (recálculo/exclusão) ou baixado à mão deixa o boleto como *Baixar no banco*, para
  cancelá-lo no Sicoob e o cliente não pagar em dobro.
- **Cobrança** (botão no Financeiro): nº do cliente/beneficiário, conta, modalidade, prazo, multa, juros, Pix e instruções.
  Só o ADMIN_TI altera.

### Configuração no Cloudflare (Workers › agroaves › Settings › Variables and secrets, tipo **Secret**)

| Variável | Sandbox | Produção |
| --- | --- | --- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | iguais às `VITE_*` | iguais às `VITE_*` |
| `SICOOB_CLIENT_ID` | Client ID do portal (sandbox) | Client ID liberado pela cooperativa |
| `SICOOB_TOKEN` | "Access token (Bearer)" do portal | — (o Worker obtém token OAuth) |
| `SICOOB_AMBIENTE` | `SANDBOX` (em `wrangler.jsonc`) | `PRODUCAO` |

Produção também exige o certificado ICP-Brasil (A1) do Sicoob como binding mTLS `SICOOB_CERT` (instruções em `wrangler.jsonc`).
O sandbox devolve **dados simulados**: serve para validar a integração, não as regras do banco (homologue com a cooperativa).
Boletos emitidos no sandbox aparecem marcados como *teste*. A API só funciona no site publicado no Cloudflare (não no GitHub Pages).

Desenvolvimento: `npm run dev:api` (Worker na porta 8787, com as variáveis em `.dev.vars`) e `npm run dev` em outro terminal
(o Vite repassa `/api` para o Worker). Testes: `npm test`.

## Dashboards

- **Dashboard de vendas** (página inicial de ADMIN e ADMIN_TI): semana atual por padrão, com troca de semana; pedidos, valor,
  aves, ticket médio, cobertura da carteira, top 3 rotas, pedidos por produto e por rota, contatos e top 10 clientes
  (quantidade e valor). Função `dashboard_vendas(data)`.
- **Dashboard financeiro** (Financeiro › Dashboard, só ADMIN_TI): a receber × a pagar, saldo previsto, vencidas, a pagar
  nas próximas 8 semanas e por centro de custo, clientes devendo e próximas contas. Função `dashboard_financeiro()`.

Os números são calculados no banco (a API devolve no máximo ~1.000 linhas por consulta).

## Fluxo semanal no sistema

Venda (vendedor) → Programação em planilha (admin revisa/ajusta) → Pedido à granja (ajuste a lotes, fornecedor obrigatório) →
Ajuste da entrega (o que a granja confirmou; redistribuição manual entre clientes; gera títulos) → Documentos (mapa, recibos, GTA, NF) →
Financeiro (boletos, baixas) → Fechamento semanal (arquiva e avança a rota 14 dias).
