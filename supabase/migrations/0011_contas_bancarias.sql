-- AgroAves 2.0 — Contas bancárias, saldos e extrato importado de OFX (exclusivo do administrador TI)
-- Somente leitura do banco: o sistema não faz nenhuma movimentação bancária.
-- conta_bancaria       cadastro (banco, apelido, agência, conta)
-- extrato_importacao   cada arquivo OFX importado (período, saldo, quantos lançamentos)
-- extrato_lancamento   lançamentos do extrato, sem duplicar (FITID do OFX), para a conciliação
-- saldo_bancario       saldo por conta e dia (OFX ou informado à mão); o mais recente é o saldo atual
-- O script pode ser executado mais de uma vez.

create table if not exists conta_bancaria (
  id            serial primary key,
  banco_codigo  text not null,            -- código de compensação (756 Sicoob, 403 Cora, …)
  banco_nome    text not null,
  apelido       text not null check (btrim(apelido) <> ''),
  agencia       text,
  numero        text,                     -- conta com dígito
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  criado_por    uuid default auth.uid() references usuario(id)
);

create table if not exists extrato_importacao (
  id                 bigserial primary key,
  conta_bancaria_id  int not null references conta_bancaria(id),
  arquivo_nome       text,
  data_inicio        date,
  data_fim           date,
  saldo              numeric(14,2),
  saldo_data         date,
  qtd_lancamentos    int not null default 0,
  qtd_novos          int not null default 0,
  criado_em          timestamptz not null default now(),
  criado_por         uuid default auth.uid() references usuario(id)
);
create index if not exists ix_extrato_importacao_conta on extrato_importacao (conta_bancaria_id, criado_em desc);

create table if not exists extrato_lancamento (
  id                 bigserial primary key,
  conta_bancaria_id  int not null references conta_bancaria(id),
  fitid              text not null,          -- identificador do lançamento no banco (evita duplicar)
  data               date not null,
  valor              numeric(14,2) not null, -- positivo = entrada, negativo = saída
  tipo               text,                   -- TRNTYPE do OFX (CREDIT, DEBIT, …)
  descricao          text,
  documento          text,
  importacao_id      bigint references extrato_importacao(id),
  unique (conta_bancaria_id, fitid)
);
create index if not exists ix_extrato_lancamento_data on extrato_lancamento (conta_bancaria_id, data);

create table if not exists saldo_bancario (
  id                 bigserial primary key,
  conta_bancaria_id  int not null references conta_bancaria(id),
  data               date not null,
  saldo              numeric(14,2) not null,
  origem             text not null check (origem in ('OFX','MANUAL')),
  importacao_id      bigint references extrato_importacao(id),
  criado_em          timestamptz not null default now(),
  criado_por         uuid default auth.uid() references usuario(id),
  unique (conta_bancaria_id, data)          -- um saldo por dia; nova importação do mesmo dia substitui
);

-- Importação de um OFX já lido na tela: grava tudo de uma vez (lançamentos novos + saldo do dia)
-- p_lancamentos: [{fitid, data, valor, tipo, descricao, documento}]
create or replace function importar_extrato(p_conta int, p_arquivo text, p_inicio date, p_fim date,
                                            p_saldo numeric, p_saldo_data date, p_lancamentos jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_imp bigint; v_total int; v_novos int;
begin
  if not eh_admin_ti() then raise exception 'Somente administrador TI'; end if;
  if not exists (select 1 from conta_bancaria where id = p_conta and ativo) then
    raise exception 'Conta bancária inexistente ou inativa.';
  end if;
  v_total := jsonb_array_length(coalesce(p_lancamentos, '[]'::jsonb));
  insert into extrato_importacao (conta_bancaria_id, arquivo_nome, data_inicio, data_fim, saldo, saldo_data, qtd_lancamentos)
    values (p_conta, p_arquivo, p_inicio, p_fim, p_saldo, p_saldo_data, v_total)
    returning id into v_imp;
  with novos as (
    insert into extrato_lancamento (conta_bancaria_id, fitid, data, valor, tipo, descricao, documento, importacao_id)
    select p_conta, l->>'fitid', (l->>'data')::date, (l->>'valor')::numeric, l->>'tipo', l->>'descricao', l->>'documento', v_imp
    from jsonb_array_elements(coalesce(p_lancamentos, '[]'::jsonb)) l
    on conflict (conta_bancaria_id, fitid) do nothing
    returning 1
  ) select count(*) into v_novos from novos;
  update extrato_importacao set qtd_novos = v_novos where id = v_imp;
  if p_saldo is not null and p_saldo_data is not null then
    insert into saldo_bancario (conta_bancaria_id, data, saldo, origem, importacao_id)
      values (p_conta, p_saldo_data, p_saldo, 'OFX', v_imp)
      on conflict (conta_bancaria_id, data) do update
        set saldo = excluded.saldo, origem = 'OFX', importacao_id = excluded.importacao_id, criado_em = now(), criado_por = auth.uid();
  end if;
  return jsonb_build_object('importacao_id', v_imp, 'lancamentos', v_total, 'novos', v_novos);
end $$;

-- Saldo atual (mais recente) de cada conta ativa, para a tela e o dashboard
create or replace function saldos_bancarios() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not eh_admin_ti() then null else coalesce(jsonb_agg(jsonb_build_object(
           'conta_bancaria_id', c.id, 'apelido', c.apelido, 'banco_codigo', c.banco_codigo, 'banco_nome', c.banco_nome,
           'agencia', c.agencia, 'numero', c.numero, 'saldo', s.saldo, 'data', s.data, 'origem', s.origem,
           'importado_em', (select max(criado_em) from extrato_importacao i where i.conta_bancaria_id = c.id))
           order by c.apelido), '[]'::jsonb) end
  from conta_bancaria c
  left join lateral (select saldo, data, origem from saldo_bancario sb where sb.conta_bancaria_id = c.id order by data desc limit 1) s on true
  where c.ativo
$$;

grant execute on function importar_extrato(int, text, date, date, numeric, date, jsonb) to authenticated;
grant execute on function saldos_bancarios() to authenticated;

-- Auditoria (registros de cadastro e saldo; lançamentos do extrato não, são cópia do banco)
drop trigger if exists trg_aud_conta_bancaria on conta_bancaria;
create trigger trg_aud_conta_bancaria after insert or update or delete on conta_bancaria for each row execute function fn_auditoria();
drop trigger if exists trg_aud_saldo_bancario on saldo_bancario;
create trigger trg_aud_saldo_bancario after insert or update or delete on saldo_bancario for each row execute function fn_auditoria();

-- Segurança: tudo só para o administrador TI
alter table conta_bancaria enable row level security;
alter table extrato_importacao enable row level security;
alter table extrato_lancamento enable row level security;
alter table saldo_bancario enable row level security;
drop policy if exists conta_bancaria_ti on conta_bancaria;
create policy conta_bancaria_ti on conta_bancaria for all using (eh_admin_ti()) with check (eh_admin_ti());
drop policy if exists extrato_importacao_ti on extrato_importacao;
create policy extrato_importacao_ti on extrato_importacao for select using (eh_admin_ti());
drop policy if exists extrato_lancamento_ti on extrato_lancamento;
create policy extrato_lancamento_ti on extrato_lancamento for select using (eh_admin_ti());
drop policy if exists saldo_bancario_ti on saldo_bancario;
create policy saldo_bancario_ti on saldo_bancario for all using (eh_admin_ti()) with check (eh_admin_ti());

drop policy if exists aud_admin on auditoria;
create policy aud_admin on auditoria for select using (
  eh_admin_ti()
  or (eh_admin()
      and tabela not in ('centro_custo', 'conta_pagar', 'conta_pagar_anexo', 'conta_bancaria', 'saldo_bancario')
      and not (tabela = 'fornecedor' and (coalesce(antes->>'tipo', 'PRODUTO_VENDA') <> 'PRODUTO_VENDA'
                                          or coalesce(depois->>'tipo', 'PRODUTO_VENDA') <> 'PRODUTO_VENDA')))
);

notify pgrst, 'reload schema';
