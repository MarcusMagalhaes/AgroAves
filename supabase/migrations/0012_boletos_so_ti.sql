-- AgroAves 2.0 — Boletos Sicoob exclusivos do administrador TI
-- Tabela boleto, configuração da cobrança, PDFs, liquidação e auditoria desses registros passam de eh_admin() para
-- eh_admin_ti(). O Worker (/api/boletos/*) também exige o administrador TI.
-- Os gatilhos do título (vencimento e "baixar no banco") continuam valendo para qualquer administrador,
-- pois rodam como security definer.
-- Rode depois da 0011. O script pode ser executado mais de uma vez.

-- 1. Boletos e configuração
drop policy if exists boleto_admin on boleto;
drop policy if exists boleto_ti on boleto;
create policy boleto_ti on boleto for all using (eh_admin_ti()) with check (eh_admin_ti());

drop policy if exists cobranca_config_ler on cobranca_config;
drop policy if exists cobranca_config_ti_ler on cobranca_config;
create policy cobranca_config_ti_ler on cobranca_config for select using (eh_admin_ti());

-- 2. Liquidação (chamada pelo Worker ao conferir pagamentos)
create or replace function liquidar_boleto(p_boleto_id bigint, p_data date, p_valor numeric default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_titulo bigint;
begin
  if not eh_admin_ti() then raise exception 'Somente administrador TI'; end if;
  update boleto set situacao = 'LIQUIDADO', data_liquidacao = p_data, valor_pago = coalesce(p_valor, valor)
    where id = p_boleto_id and situacao in ('EMITIDO','A_BAIXAR')
    returning titulo_id into v_titulo;
  if v_titulo is null then return; end if;
  update titulo set situacao = 'BAIXADO', data_baixa = p_data where id = v_titulo and situacao = 'PENDENTE';
end $$;

-- 3. PDFs
drop policy if exists boletos_admin_ler on storage.objects;
drop policy if exists boletos_admin_enviar on storage.objects;
drop policy if exists boletos_admin_atualizar on storage.objects;
drop policy if exists boletos_ti_ler on storage.objects;
create policy boletos_ti_ler on storage.objects for select
  using (bucket_id = 'boletos' and public.eh_admin_ti());
drop policy if exists boletos_ti_enviar on storage.objects;
create policy boletos_ti_enviar on storage.objects for insert
  with check (bucket_id = 'boletos' and public.eh_admin_ti());
drop policy if exists boletos_ti_atualizar on storage.objects;
create policy boletos_ti_atualizar on storage.objects for update
  using (bucket_id = 'boletos' and public.eh_admin_ti());

-- 4. Auditoria: boletos e configuração da cobrança só para o administrador TI
drop policy if exists aud_admin on auditoria;
create policy aud_admin on auditoria for select using (
  eh_admin_ti()
  or (eh_admin()
      and tabela not in ('centro_custo', 'conta_pagar', 'conta_pagar_anexo', 'boleto', 'cobranca_config')
      and not (tabela = 'fornecedor' and (coalesce(antes->>'tipo', 'PRODUTO_VENDA') <> 'PRODUTO_VENDA'
                                          or coalesce(depois->>'tipo', 'PRODUTO_VENDA') <> 'PRODUTO_VENDA')))
);

notify pgrst, 'reload schema';
