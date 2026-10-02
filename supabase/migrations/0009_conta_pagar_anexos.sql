-- AgroAves 2.0 — Contas a pagar: sem descrição (a observação identifica a conta) e com anexos (exclusivo do administrador TI)
-- Anexos: vários por conta (a conta/boleto, o comprovante, outros). Arquivos no Supabase Storage, bucket privado
-- 'contas-pagar', caminho <id da conta>/<arquivo>. Tabela conta_pagar_anexo guarda tipo, nome e tamanho.
-- Rode depois da 0008. O script pode ser executado mais de uma vez.

-- 1. Remove a descrição
alter table conta_pagar drop column if exists descricao;

create or replace function fn_conta_pagar_regras() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_cc centro_custo%rowtype;
begin
  new.observacao := nullif(btrim(new.observacao), '');
  if tg_op = 'UPDATE' and old.situacao <> 'PENDENTE'
     and (new.fornecedor_id, new.data_vencimento, new.valor, new.centro_custo_codigo, new.observacao)
         is distinct from (old.fornecedor_id, old.data_vencimento, old.valor, old.centro_custo_codigo, old.observacao) then
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

-- 2. Anexos
create table if not exists conta_pagar_anexo (
  id             bigserial primary key,
  conta_pagar_id bigint not null references conta_pagar(id),
  tipo           text not null check (tipo in ('CONTA','COMPROVANTE','OUTRO')),
  nome_arquivo   text not null,
  caminho        text not null unique,          -- caminho no bucket 'contas-pagar'
  tamanho        bigint,
  mime           text,
  criado_em      timestamptz not null default now(),
  criado_por     uuid default auth.uid() references usuario(id)
);
create index if not exists ix_conta_pagar_anexo_conta on conta_pagar_anexo (conta_pagar_id);

drop trigger if exists trg_aud_conta_pagar_anexo on conta_pagar_anexo;
create trigger trg_aud_conta_pagar_anexo after insert or update or delete on conta_pagar_anexo
  for each row execute function fn_auditoria();

alter table conta_pagar_anexo enable row level security;
drop policy if exists conta_pagar_anexo_ti on conta_pagar_anexo;
create policy conta_pagar_anexo_ti on conta_pagar_anexo for all using (eh_admin_ti()) with check (eh_admin_ti());

-- 3. Bucket privado no Storage (até 10 MB por arquivo; PDF, imagens e XML de nota)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contas-pagar', 'contas-pagar', false, 10485760,
        array['application/pdf','image/jpeg','image/png','image/webp','image/heic','application/xml','text/xml'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists contas_pagar_ti_ler on storage.objects;
create policy contas_pagar_ti_ler on storage.objects for select
  using (bucket_id = 'contas-pagar' and public.eh_admin_ti());
drop policy if exists contas_pagar_ti_enviar on storage.objects;
create policy contas_pagar_ti_enviar on storage.objects for insert
  with check (bucket_id = 'contas-pagar' and public.eh_admin_ti());
drop policy if exists contas_pagar_ti_excluir on storage.objects;
create policy contas_pagar_ti_excluir on storage.objects for delete
  using (bucket_id = 'contas-pagar' and public.eh_admin_ti());

-- 4. Auditoria: anexos também só para o administrador TI
drop policy if exists aud_admin on auditoria;
create policy aud_admin on auditoria for select using (
  eh_admin_ti()
  or (eh_admin()
      and tabela not in ('centro_custo', 'conta_pagar', 'conta_pagar_anexo')
      and not (tabela = 'fornecedor' and (coalesce(antes->>'tipo', 'PRODUTO_VENDA') <> 'PRODUTO_VENDA'
                                          or coalesce(depois->>'tipo', 'PRODUTO_VENDA') <> 'PRODUTO_VENDA')))
);

notify pgrst, 'reload schema';
