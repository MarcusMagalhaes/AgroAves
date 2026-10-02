# AgroAves 2.0

Sistema web de gestão de vendas semanais de aves por rotas — substitui as planilhas Google Sheets + Apps Script.
Documentação do sistema em `../docs/sistema-2.0/`; especificação original em `../docs/sistema-1.0/08`–`11`.

**Stack**: React 19 + TypeScript + Vite 5 + Tailwind 3 · Supabase (PostgreSQL, Auth, RLS) · Cloudflare Workers/estáticos (GitHub só como repositório).

## Estrutura

```
app/
  supabase/migrations/   0001_schema.sql (tabelas, views, funções de negócio) · 0002_rls.sql (segurança) · 0003_seed.sql (produtos, cidades) · 0004 cor do produto · 0005 auditoria · 0006 admin TI
  src/
    lib/                 supabase.ts, auth.tsx (login e papel), dados.ts (consultas), mapa.ts (mapa de entrega), format.ts, types.ts
    components/          Layout (menu responsivo), Logo (marca nova), ui (modal, toast, campos)
    pages/               Login, Venda (tela do vendedor), Mapa
    pages/admin/         Programacao (planilha), PedidoFornecedor, AjusteEntrega, Documentos (mapa/recibos/GTA/NF), Financeiro, Fechamento,
                         Clientes, Rotas (ordem de entrega), Produtos, Vendedores, Fornecedores, Usuarios
  migracao/migrar.py     extrai os .xlsx, limpa, gera CSVs + rejeições e (opcional) carrega no banco com reconciliação
```

## 1. Banco (Supabase)

1. Projeto: `https://qqpavhptvptgktnzoawi.supabase.co`. Em **SQL Editor**, execute na ordem: `0001_schema.sql` … `0006_admin_ti.sql` (base já existente: só as que ainda não rodaram).
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
| ADMIN_TI | tudo do ADMIN + telas exclusivas da TI. Exclusivo de markvpm@gmail.com: definido só pelo banco (`0006_admin_ti.sql`), não aparece como opção em Usuários e não pode ser atribuído, alterado, desativado ou excluído pela aplicação |
| ADMIN | tudo (exceto telas da TI) |
| VENDEDOR | Venda semanal e Mapa, apenas das rotas em que é o vendedor cadastrado |

## Fluxo semanal no sistema

Venda (vendedor) → Programação em planilha (admin revisa/ajusta) → Pedido à granja (ajuste a lotes, fornecedor obrigatório) →
Ajuste da entrega (o que a granja confirmou; redistribuição manual entre clientes; gera títulos) → Documentos (mapa, recibos, GTA, NF) →
Financeiro (baixas) → Fechamento semanal (arquiva e avança a rota 14 dias).
