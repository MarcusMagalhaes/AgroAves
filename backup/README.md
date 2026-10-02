# Backup do banco AgroAves (7 dias, um por dia da semana)

Repositório **privado** `MarcusMagalhaes/AgroAves-backup`. O GitHub Actions roda todo dia às **00:30 (Brasília)** e copia o banco do Supabase como ele estava ao fim do dia anterior. O arquivo recebe o nome do dia da semana copiado (`backup-1-segunda` … `backup-7-domingo`); na semana seguinte o do mesmo dia é apagado e substituído. Sempre existem os últimos 7 dias.

- O que entra: todas as tabelas do schema `public` (clientes, preços, rotas, produtos, semanas, pedidos, itens, contatos, pedidos à granja, títulos, usuários, vendedores…), views e funções.
- O que fica de fora: **dados** das tabelas `auditoria` e `auditoria_login` (a estrutura delas vai, vazia). Usuários de login (`auth.users`) não entram; ao restaurar em outro projeto, cada pessoa entra de novo pelo Google e é liberada.
- Formato: `pg_dump --format=custom` (arquivo `.dump` comprimido, ~3 a 10 MB).

## Onde está o backup

GitHub → repositório `AgroAves-backup` → aba **Actions** → clique na execução do dia → seção **Artifacts** → baixe `backup-N-dia.zip` (dentro vem `agroaves-AAAA-MM-DD.dump`). Também dá para rodar na hora: Actions → "Backup diário do banco" → **Run workflow**.

## Como restaurar (ver os dados ou voltar a base)

Precisa do `pg_restore` 17 (instalar o PostgreSQL 17 no Windows, ou usar Docker: `docker run --name pg17 -e POSTGRES_PASSWORD=x -p 5433:5432 -d postgres:17`).

**Para olhar os dados numa base local** (não mexe no Supabase):

```bash
createdb -h localhost -p 5433 -U postgres agroaves_bkp
pg_restore -h localhost -p 5433 -U postgres -d agroaves_bkp --no-owner --no-privileges agroaves-2026-10-06.dump
```

Depois abra com DBeaver em `localhost:5433`, banco `agroaves_bkp`.

**Para voltar o Supabase inteiro ao backup** (apaga o que existe hoje no schema public):

```bash
pg_restore --clean --if-exists --no-owner --no-privileges --schema=public \
  -d "postgresql://postgres.qqpavhptvptgktnzoawi:SENHA@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require" \
  agroaves-2026-10-06.dump
```

Depois reaplicar o bloco de RLS (`app/supabase/migrations/0002_rls.sql`) se alguma política vier com aviso, e pedir Ctrl+F5 no sistema.

**Para voltar só uma tabela** (ex.: títulos):

```bash
pg_restore --data-only --table=titulo -d "postgresql://…" agroaves-2026-10-06.dump
```

(antes, apague ou renomeie os dados atuais daquela tabela.)

## Configuração (já feita em 02/10/2026)

- Segredo `DB_URL` do repositório = URI do pooler (`postgresql://postgres.qqpavhptvptgktnzoawi:SENHA@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require`, `@` da senha como `%40`). Se a senha do banco mudar, atualizar em Settings → Secrets and variables → Actions.
- Horário: `cron: "30 3 * * *"` (UTC) = 00:30 Brasília. Se o GitHub atrasar alguns minutos, normal.
- Se o backup falhar, o GitHub manda e-mail para o dono do repositório.
