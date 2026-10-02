-- AgroAves 2.0 — Tipo de fornecedor e contas a pagar
-- 1. Fornecedor passa a ter tipo: PRODUTO_VENDA (granja: aparece no pedido), MATERIAL e CONSUMO.
--    Os já cadastrados (a Granja) ficam como PRODUTO_VENDA.
-- 2. Pedido à granja só aceita fornecedor PRODUTO_VENDA.
-- 3. Contas a pagar: descrição, fornecedor (qualquer tipo), vencimento, valor e centro de custo do tipo A PAGAR
--    (qualquer nível da árvore). Situação PENDENTE → PAGO (com data) ou CANCELADO (com motivo); sem exclusão.
-- 4. Administradores (ADMIN e ADMIN_TI) passam a LER os centros de custo, para escolher na conta a pagar.
--    O cadastro (inclusão/alteração) continua exclusivo do administrador TI.

-- 1. Tipo do fornecedor
alter table fornecedor add column if not exists tipo text not null default 'PRODUTO_VENDA';
alter table fornecedor drop constraint if exists fornecedor_tipo_check;
alter table fornecedor add constraint fornecedor_tipo_check check (tipo in ('PRODUTO_VENDA','MATERIAL','CONSUMO'));

-- 2. Pedido à granja: somente fornecedor de produto para venda
create or replace function fn_pedido_fornecedor_tipo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select tipo from fornecedor where id = new.fornecedor_id) is distinct from 'PRODUTO_VENDA' then
    raise exception 'O pedido só pode ser feito a fornecedor do tipo Produto para venda.';
  end if;
  return new;
end $$;

drop trigger if exists trg_pedido_fornecedor_tipo on pedido_fornecedor;
create trigger trg_pedido_fornecedor_tipo before insert or update of fornecedor_id on pedido_fornecedor
  for each row execute function fn_pedido_fornecedor_tipo();

-- 3. Contas a pagar
create table if not exists conta_pagar (
  id                   bigserial primary key,
  descricao            text not null check (btrim(descricao) <> ''),
  fornecedor_id        int not null references fornecedor(id),
  data_vencimento      date not null,
  valor                numeric(12,2) not null check (valor > 0),
  centro_custo_codigo  int not null references centro_custo(codigo),
  situacao             text not null default 'PENDENTE' check (situacao in ('PENDENTE','PAGO','CANCELADO')),
  data_pagamento       date,
  motivo               text,          -- motivo do cancelamento
  observacao           text,
  criado_em            timestamptz not null default now(),
  criado_por           uuid references usuario(id),
  atualizado_em        timestamptz not null default now(),
  atualizado_por       uuid references usuario(id),
  check (situacao <> 'PAGO' or data_pagamento is not null)
);
create index if not exists ix_conta_pagar_venc on conta_pagar (situacao, data_vencimento);
create index if not exists ix_conta_pagar_fornecedor on conta_pagar (fornecedor_id);
create index if not exists ix_conta_pagar_cc on conta_pagar (centro_custo_codigo);

-- Regras: centro de custo A PAGAR e ativo; fornecedor ativo; só a conta pendente pode ser editada
create or replace function fn_conta_pagar_regras() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_cc centro_custo%rowtype;
begin
  new.descricao := btrim(new.descricao);
  if tg_op = 'UPDATE' and old.situacao <> 'PENDENTE'
     and (new.descricao, new.fornecedor_id, new.data_vencimento, new.valor, new.centro_custo_codigo, new.observacao)
         is distinct from (old.descricao, old.fornecedor_id, old.data_vencimento, old.valor, old.centro_custo_codigo, old.observacao) then
    raise exception 'Só a conta pendente pode ser alterada.';
  end if;
  if tg_op = 'INSERT' or new.centro_custo_codigo is distinct from old.centro_custo_codigo then
    select * into v_cc from centro_custo where codigo = new.centro_custo_codigo;
    if not found then raise exception 'Centro de custo % não existe.', new.centro_custo_codigo; end if;
    if v_cc.tipo <> 'PAGAR' then raise exception 'O centro de custo % não é do tipo a pagar.', v_cc.codigo; end if;
    if not v_cc.ativo then raise exception 'O centro de custo % está inativo.', v_cc.codigo; end if;
  end if;
  if (tg_op = 'INSERT' or new.fornecedor_id is distinct from old.fornecedor_id)
     and not coalesce((select ativo from fornecedor where id = new.fornecedor_id), false) then
    raise exception 'Fornecedor inativo ou inexistente.';
  end if;
  if new.situacao = 'PENDENTE' then new.data_pagamento := null; new.motivo := null; end if;
  if new.situacao = 'CANCELADO' and coalesce(btrim(new.motivo), '') = '' then
    raise exception 'Informe o motivo do cancelamento.';
  end if;
  if new.situacao <> 'PAGO' then new.data_pagamento := null; end if;
  return new;
end $$;

drop trigger if exists trg_conta_pagar_regras on conta_pagar;
create trigger trg_conta_pagar_regras before insert or update on conta_pagar
  for each row execute function fn_conta_pagar_regras();

drop trigger if exists trg_carimbo_conta_pagar on conta_pagar;
create trigger trg_carimbo_conta_pagar before insert or update on conta_pagar
  for each row execute function fn_carimbo();

drop trigger if exists trg_aud_conta_pagar on conta_pagar;
create trigger trg_aud_conta_pagar after insert or update or delete on conta_pagar
  for each row execute function fn_auditoria();

-- Segurança: administradores leem, incluem e alteram; não há exclusão (cancela-se)
alter table conta_pagar enable row level security;
drop policy if exists conta_pagar_admin_ler on conta_pagar;
create policy conta_pagar_admin_ler on conta_pagar for select using (eh_admin());
drop policy if exists conta_pagar_admin_incluir on conta_pagar;
create policy conta_pagar_admin_incluir on conta_pagar for insert with check (eh_admin());
drop policy if exists conta_pagar_admin_alterar on conta_pagar;
create policy conta_pagar_admin_alterar on conta_pagar for update using (eh_admin()) with check (eh_admin());

-- 4. Centro de custo: leitura para administradores (escrita segue só TI, políticas da 0007)
drop policy if exists centro_custo_ti_ler on centro_custo;
drop policy if exists centro_custo_admin_ler on centro_custo;
create policy centro_custo_admin_ler on centro_custo for select using (eh_admin());

-- Atualiza o cache da API do Supabase para enxergar a tabela e a coluna novas
notify pgrst, 'reload schema';
