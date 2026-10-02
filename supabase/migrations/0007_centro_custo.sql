-- AgroAves 2.0 — Cadastro de centro de custo (exclusivo do administrador TI)
-- Usado no contas a pagar e no contas a receber. Árvore de até 4 níveis com código falante:
--   nível 1 (raiz)  → milhar:  1000, 2000, 3000 …
--   nível 2         → centena: 1100, 1200 … 1900   (filhos de 1000)
--   nível 3         → dezena:  1110, 1120 … 1190   (filhos de 1100)
--   nível 4         → unidade: 1111, 1112 … 1119   (filhos de 1110; não tem filhos)
-- O código é gerado pelo banco a partir do pai e nunca muda; por isso pai, nível e tipo também não mudam.
-- Não se exclui: desativa-se (e a desativação desce para os filhos). Para "mudar de lugar", desative e crie outro.

create table if not exists centro_custo (
  id          serial primary key,
  codigo      int not null unique,
  descricao   text not null check (btrim(descricao) <> ''),
  tipo        text not null check (tipo in ('PAGAR','RECEBER')),
  pai_codigo  int references centro_custo(codigo),
  nivel       smallint not null check (nivel between 1 and 4),
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now(),
  criado_por  uuid default auth.uid() references usuario(id)
);
create index if not exists ix_centro_custo_pai on centro_custo (pai_codigo);

-- Inclusão: calcula nível, código e tipo (herdado do pai). Valor de código/nível enviado pela aplicação é ignorado.
create or replace function fn_centro_custo_inclusao() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_pai  centro_custo%rowtype;
  v_passo int;
  v_ultimo int;
begin
  new.descricao := btrim(new.descricao);
  if new.pai_codigo is null then
    -- raiz: próximo milhar (serializa inclusões simultâneas de raiz)
    perform pg_advisory_xact_lock(hashtext('centro_custo_raiz'));
    if new.tipo is null then raise exception 'Informe o tipo do centro de custo (a pagar ou a receber).'; end if;
    select coalesce(max(codigo), 0) into v_ultimo from centro_custo where pai_codigo is null;
    new.nivel := 1;
    new.codigo := (v_ultimo / 1000 + 1) * 1000;
  else
    -- filho: trava o pai para não gerar o mesmo código em duas inclusões ao mesmo tempo
    select * into v_pai from centro_custo where codigo = new.pai_codigo for update;
    if not found then raise exception 'Centro de custo pai % não existe.', new.pai_codigo; end if;
    if not v_pai.ativo then raise exception 'O centro de custo pai % está inativo.', v_pai.codigo; end if;
    if v_pai.nivel >= 4 then
      raise exception 'O centro de custo % já está no último nível (unidade) e não pode ter filhos.', v_pai.codigo;
    end if;
    v_passo := case v_pai.nivel when 1 then 100 when 2 then 10 else 1 end;
    select coalesce(max(codigo), v_pai.codigo) into v_ultimo from centro_custo where pai_codigo = v_pai.codigo;
    if v_ultimo + v_passo > v_pai.codigo + 9 * v_passo then
      raise exception 'O centro de custo % já tem 9 filhos (limite do código falante).', v_pai.codigo;
    end if;
    new.nivel := v_pai.nivel + 1;
    new.codigo := v_ultimo + v_passo;
    new.tipo := v_pai.tipo;  -- filho é sempre do mesmo tipo do pai
  end if;
  new.ativo := coalesce(new.ativo, true);
  return new;
end $$;

drop trigger if exists trg_centro_custo_inclusao on centro_custo;
create trigger trg_centro_custo_inclusao before insert on centro_custo
  for each row execute function fn_centro_custo_inclusao();

-- Alteração: só descrição e ativo. Reativar exige pai ativo.
create or replace function fn_centro_custo_alteracao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.codigo is distinct from old.codigo or new.pai_codigo is distinct from old.pai_codigo
     or new.nivel is distinct from old.nivel or new.tipo is distinct from old.tipo then
    raise exception 'Código, centro de custo pai e tipo não podem ser alterados. Desative este centro de custo e cadastre outro.';
  end if;
  new.descricao := btrim(new.descricao);
  new.criado_em := old.criado_em;
  new.criado_por := old.criado_por;
  if new.ativo and not old.ativo and new.pai_codigo is not null
     and not (select ativo from centro_custo where codigo = new.pai_codigo) then
    raise exception 'Reative primeiro o centro de custo pai %.', new.pai_codigo;
  end if;
  return new;
end $$;

drop trigger if exists trg_centro_custo_alteracao on centro_custo;
create trigger trg_centro_custo_alteracao before update on centro_custo
  for each row execute function fn_centro_custo_alteracao();

-- Desativar um centro de custo desativa toda a sua descendência (o gatilho se repete a cada nível)
create or replace function fn_centro_custo_desativa_filhos() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update centro_custo set ativo = false where pai_codigo = new.codigo and ativo;
  return null;
end $$;

drop trigger if exists trg_centro_custo_desativa_filhos on centro_custo;
create trigger trg_centro_custo_desativa_filhos after update of ativo on centro_custo
  for each row when (old.ativo and not new.ativo) execute function fn_centro_custo_desativa_filhos();

-- Exclusão: proibida pela aplicação (SQL Editor, sem auth.uid(), continua livre para emergência)
create or replace function fn_centro_custo_exclusao() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null then
    raise exception 'Centro de custo não pode ser excluído; desative-o.';
  end if;
  return old;
end $$;

drop trigger if exists trg_centro_custo_exclusao on centro_custo;
create trigger trg_centro_custo_exclusao before delete on centro_custo
  for each row execute function fn_centro_custo_exclusao();

-- Auditoria (mesmo gatilho das demais tabelas)
drop trigger if exists trg_aud_centro_custo on centro_custo;
create trigger trg_aud_centro_custo after insert or update or delete on centro_custo
  for each row execute function fn_auditoria();

-- Segurança: somente o administrador TI lê, inclui e altera (não há política de exclusão)
alter table centro_custo enable row level security;
drop policy if exists centro_custo_ti_ler on centro_custo;
create policy centro_custo_ti_ler on centro_custo for select using (eh_admin_ti());
drop policy if exists centro_custo_ti_incluir on centro_custo;
create policy centro_custo_ti_incluir on centro_custo for insert with check (eh_admin_ti());
drop policy if exists centro_custo_ti_alterar on centro_custo;
create policy centro_custo_ti_alterar on centro_custo for update using (eh_admin_ti()) with check (eh_admin_ti());
