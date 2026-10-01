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

1. Crie um projeto em supabase.com. Em **SQL Editor**, execute na ordem: `0001_schema.sql`, `0002_rls.sql`, `0003_seed.sql`.
2. Em **Authentication › Users › Add user**, crie o administrador (e-mail + senha). Copie o UUID.
3. No SQL Editor: `insert into usuario (id, nome, email, papel) values ('<uuid>', 'Marcus', 'markvpm@gmail.com', 'ADMIN');`
4. Em **Settings › API** copie `Project URL` e `anon public key`.

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

Depois da carga: em **Rotas**, confira vendedor e semana atual; em **Vendedores**, vincule os logins; em **Fornecedores**, renomeie "GRANJA (padrão)".
Revise `migracao/saida/rejeicoes.csv` (decisões D-11…D-17 em `docs/11`).

## 4. Publicar no GitHub Pages

```bash
# uma vez: criar o repositório (ex.: agroaves) e apontar o remote
git init && git add . && git commit -m "AgroAves 2.0" && git branch -M main
git remote add origin https://github.com/MarcusMagalhaes/AgroAves.git && git push -u origin main
# a cada versão:
VITE_BASE=/AgroAves/ npm run build && npm run deploy     # publica dist/ na branch gh-pages
```

Em **Settings › Pages** do repositório escolha a branch `gh-pages`. O site fica em `https://marcusmagalhaes.github.io/AgroAves/`.
As variáveis `VITE_SUPABASE_*` são embutidas no build (a chave *anon* é pública por desenho; a segurança está nas políticas RLS).
No Supabase, em **Authentication › URL Configuration**, adicione a URL do site.

## Perfis

| Papel | Acesso |
| --- | --- |
| ADMIN | tudo |
| VENDEDOR | Venda semanal e Mapa, apenas das rotas em que é o vendedor cadastrado |

## Fluxo semanal no sistema

Venda (vendedor) → Programação em planilha (admin revisa/ajusta) → Pedido à granja (ajuste a lotes, fornecedor obrigatório) →
Ajuste da entrega (o que a granja confirmou; redistribuição manual entre clientes; gera títulos) → Documentos (mapa, recibos, GTA, NF) →
Financeiro (baixas) → Fechamento semanal (arquiva e avança a rota 14 dias).
