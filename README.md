# AgroAves 2.0

Sistema web de gestão de vendas semanais de aves por rotas — substitui as planilhas Google Sheets + Apps Script.
Especificação em `../docs/08`–`11`.

**Stack**: React 19 + TypeScript + Vite 5 + Tailwind 3 · Supabase (PostgreSQL, Auth, RLS) · GitHub Pages.

## Estrutura

```
app/
  supabase/migrations/   0001_schema.sql (tabelas, views, funções de negócio) · 0002_rls.sql (segurança) · 0003_seed.sql (produtos, cidades)
  src/
    lib/                 supabase.ts, auth.tsx (login e papel), dados.ts (consultas), mapa.ts (mapa de entrega), format.ts, types.ts
    components/          Layout (menu responsivo), Logo (marca nova), ui (modal, toast, campos)
    pages/               Login, Venda (tela do vendedor), Mapa
    pages/admin/         Programacao (planilha), PedidoFornecedor, AjusteEntrega, Documentos (mapa/recibos/GTA/NF), Financeiro, Fechamento,
                         Clientes, Rotas (ordem de visita), Produtos, Vendedores, Fornecedores, Usuarios
  migracao/migrar.py     extrai os .xlsx, limpa, gera CSVs + rejeições e (opcional) carrega no banco com reconciliação
```

## 1. Banco (Supabase)

1. Projeto: `https://qqpavhptvptgktnzoawi.supabase.co`. Em **SQL Editor**, execute na ordem: `0001_schema.sql`, `0002_rls.sql`, `0003_seed.sql`.
2. **Login com Google** (Authentication › Providers › Google): ative e cole Client ID + Secret de um cliente OAuth do Google Cloud
   (pode reutilizar o do Controle Metanoia, acrescentando as origens/redirecionamentos abaixo):
   - Origens JavaScript autorizadas: `https://qqpavhptvptgktnzoawi.supabase.co` e `https://marcusmagalhaes.github.io`
   - URI de redirecionamento: `https://qqpavhptvptgktnzoawi.supabase.co/auth/v1/callback`
3. Authentication › **URL Configuration**: Site URL `https://marcusmagalhaes.github.io/AgroAves/`; Redirect URLs `https://marcusmagalhaes.github.io/AgroAves/**` e `http://localhost:5173/**`.
4. Abra o site e clique **Entrar com Google** com markvpm@gmail.com: o gatilho em `auth.users` cria o usuário como ADMIN.
   Outras pessoas que entrarem ficam "aguardando liberação" até o administrador definir o papel em **Usuários**.
5. Em **Settings › API** estão `Project URL` e `anon key` usadas no `.env` e nos secrets do GitHub.

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
Revise `migracao/saida/rejeicoes.csv` (decisões D-11…D-17 em `docs/11`).

## 4. Publicar no GitHub Pages

Repositório: https://github.com/MarcusMagalhaes/AgroAves · Site: https://marcusmagalhaes.github.io/AgroAves/

Todo push em `main` dispara `.github/workflows/deploy.yml`, que compila e publica no GitHub Pages (fonte "GitHub Actions").
Secrets do repositório: `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (a chave *anon* é pública por desenho; a segurança está nas políticas RLS).

```bash
git add -A && git commit -m "..." && git push      # publica automaticamente
```

## Perfis

| Papel | Acesso |
| --- | --- |
| ADMIN | tudo |
| VENDEDOR | Venda semanal e Mapa, apenas das rotas em que é o vendedor cadastrado |

## Fluxo semanal no sistema

Venda (vendedor) → Programação em planilha (admin revisa/ajusta) → Pedido à granja (ajuste a lotes, fornecedor obrigatório) →
Ajuste da entrega (o que a granja confirmou; redistribuição manual entre clientes; gera títulos) → Documentos (mapa, recibos, GTA, NF) →
Financeiro (baixas) → Fechamento semanal (arquiva e avança a rota 14 dias).
