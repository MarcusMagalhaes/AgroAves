-- AgroAves 2.0 — Auditoria completa (registros e logins)
-- Tudo que é incluído, alterado ou excluído em qualquer tabela gera uma linha em `auditoria`
-- com quem fez (usuário), o quê (tabela, registro, antes/depois) e quando. Logins em `auditoria_login`.

-- 1. Colunas extras na auditoria de registros
alter table auditoria add column if not exists usuario_email text;
alter table auditoria add column if not exists origem text not null default 'app';   -- app | carga | sistema
alter table auditoria add column if not exists campos_alterados text[];              -- só no UPDATE
create index if not exists ix_auditoria_em on auditoria (em desc);
create index if not exists ix_auditoria_usuario on auditoria (usuario_id, em desc);

-- 2. Função do gatilho: registra antes/depois, usuário (id e e-mail), campos alterados.
--    A carga das planilhas liga `app.sem_auditoria = on` na sessão para não gerar milhares de linhas
--    (e grava uma única linha-resumo de origem 'carga').
create or replace function fn_auditoria() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rid text;
  v_uid uuid := auth.uid();
  v_email text;
  v_campos text[];
  v_origem text := 'app';
begin
  if coalesce(current_setting('app.sem_auditoria', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if v_uid is not null then
    select email into v_email from usuario where id = v_uid;
  else
    v_origem := 'sistema';
    v_email := coalesce(current_setting('app.operador', true), current_user);
  end if;

  if tg_op = 'DELETE' then
    rid := coalesce(to_jsonb(old)->>'id', (select string_agg(value, '|') from jsonb_each_text(to_jsonb(old)) where key in ('rota_id','cliente_id','produto_id','pedido_id','pedido_fornecedor_id')));
    insert into auditoria(tabela, registro_id, operacao, antes, usuario_id, usuario_email, origem)
      values (tg_table_name, coalesce(rid, ''), 'DELETE', to_jsonb(old), v_uid, v_email, v_origem);
    return old;
  elsif tg_op = 'UPDATE' then
    rid := coalesce(to_jsonb(new)->>'id', (select string_agg(value, '|') from jsonb_each_text(to_jsonb(new)) where key in ('rota_id','cliente_id','produto_id','pedido_id','pedido_fornecedor_id')));
    select array_agg(n.key) into v_campos
      from jsonb_each(to_jsonb(new)) n join jsonb_each(to_jsonb(old)) o on o.key = n.key
      where n.value is distinct from o.value and n.key not in ('atualizado_em','atualizado_por');
    if v_campos is null then return new; end if;  -- nada mudou de fato
    insert into auditoria(tabela, registro_id, operacao, antes, depois, usuario_id, usuario_email, origem, campos_alterados)
      values (tg_table_name, coalesce(rid, ''), 'UPDATE', to_jsonb(old), to_jsonb(new), v_uid, v_email, v_origem, v_campos);
    return new;
  else
    rid := coalesce(to_jsonb(new)->>'id', (select string_agg(value, '|') from jsonb_each_text(to_jsonb(new)) where key in ('rota_id','cliente_id','produto_id','pedido_id','pedido_fornecedor_id')));
    insert into auditoria(tabela, registro_id, operacao, depois, usuario_id, usuario_email, origem)
      values (tg_table_name, coalesce(rid, ''), 'INSERT', to_jsonb(new), v_uid, v_email, v_origem);
    return new;
  end if;
end $$;

-- 3. Gatilho em TODAS as tabelas de dados
do $$
declare t text;
begin
  foreach t in array array['usuario','vendedor','cidade_distribuicao','fornecedor','rota','cliente','rota_cliente','produto','preco_cliente',
                           'semana_rota','pedido','pedido_item','contato_cliente','pedido_fornecedor','pedido_fornecedor_item','titulo']
  loop
    execute format('drop trigger if exists trg_aud_%s on %s', t, t);
    execute format('create trigger trg_aud_%s after insert or update or delete on %s for each row execute function fn_auditoria()', t, t);
  end loop;
end $$;

-- 4. Auditoria de login
create table if not exists auditoria_login (
  id          bigserial primary key,
  email       text,
  usuario_id  uuid,
  evento      text not null check (evento in ('LOGIN_OK','LOGIN_FALHA','LOGOUT')),
  motivo      text,          -- ex.: 'senha inválida', 'aguardando liberação', 'usuário desativado', 'google'
  metodo      text,          -- 'google' | 'senha'
  agente      text,          -- navegador (user agent)
  em          timestamptz not null default now()
);
create index if not exists ix_auditoria_login_em on auditoria_login (em desc);
alter table auditoria_login enable row level security;
drop policy if exists aud_login_admin on auditoria_login;
create policy aud_login_admin on auditoria_login for select using (eh_admin());

-- Registro de login chamado pelo site (inclusive sem sessão, para falhas de senha)
create or replace function registrar_login(p_email text, p_evento text, p_motivo text default null, p_metodo text default null, p_agente text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into auditoria_login (email, usuario_id, evento, motivo, metodo, agente)
    values (lower(coalesce(p_email, '')), auth.uid(), p_evento, left(p_motivo, 200), p_metodo, left(p_agente, 300));
end $$;
grant execute on function registrar_login(text, text, text, text, text) to anon, authenticated;

-- 5. Auditoria de registros: leitura só para administradores (política já existe: aud_admin)
-- 6. Linha-resumo de carga (usada pelo migrar.py)
create or replace function registrar_carga(p_resumo jsonb) returns void
language sql security definer set search_path = public as $$
  insert into auditoria(tabela, registro_id, operacao, depois, usuario_email, origem)
  values ('carga_planilhas', to_char(now(), 'YYYY-MM-DD HH24:MI'), 'INSERT', p_resumo, 'migrar.py', 'carga')
$$;
