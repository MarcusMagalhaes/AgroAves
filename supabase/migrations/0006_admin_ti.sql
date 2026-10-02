-- AgroAves 2.0 — Papel ADMIN_TI (super administrador)
-- Exclusivo da conta markvpm@gmail.com: não pode ser atribuído, transferido, removido nem desativado pela aplicação.
-- ADMIN_TI tem tudo que o ADMIN tem (eh_admin() = true) e, além disso, acesso às telas exclusivas (eh_admin_ti()).
-- O e-mail é conferido em auth.users (identidade do login), não só na tabela usuario, que o administrador pode editar.

-- 1. Único lugar onde o e-mail do administrador TI é definido
create or replace function email_admin_ti() returns text
language sql immutable as $$ select 'markvpm@gmail.com'::text $$;

-- Verdadeiro se o usuário (por id do auth) é a conta do administrador TI
create or replace function eh_conta_admin_ti(p_id uuid) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce((select lower(email) = email_admin_ti() from auth.users where id = p_id), false)
$$;

-- 2. Novo valor de papel
alter table usuario drop constraint if exists usuario_papel_check;
alter table usuario add constraint usuario_papel_check check (papel in ('ADMIN_TI','ADMIN','VENDEDOR'));

-- 3. Funções de permissão: ADMIN_TI também é administrador
create or replace function eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select papel in ('ADMIN','ADMIN_TI') from usuario where id = auth.uid() and ativo), false)
$$;

create or replace function eh_admin_ti() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select papel = 'ADMIN_TI' from usuario where id = auth.uid() and ativo), false)
         and eh_conta_admin_ti(auth.uid())
$$;

-- 4. Proteção da linha em usuario (vale para a aplicação e para qualquer chamada à API)
--    - a conta do administrador TI é sempre ADMIN_TI, ativa e com o e-mail original;
--    - nenhuma outra conta pode receber ADMIN_TI;
--    - só o próprio administrador TI altera ou exclui a sua linha (SQL Editor, sem auth.uid(), continua livre para emergência).
create or replace function fn_protege_admin_ti() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.papel = 'ADMIN_TI' and auth.uid() is not null then
      raise exception 'O administrador TI não pode ser excluído.';
    end if;
    return old;
  end if;

  if eh_conta_admin_ti(new.id) then
    if tg_op = 'UPDATE' and auth.uid() is not null and auth.uid() <> new.id then
      raise exception 'Somente o próprio administrador TI pode alterar este usuário.';
    end if;
    new.papel := 'ADMIN_TI';
    new.ativo := true;
    new.email := email_admin_ti();
  elsif new.papel = 'ADMIN_TI' then
    raise exception 'O papel Administrador TI é exclusivo e não pode ser atribuído a outro usuário.';
  end if;
  return new;
end $$;

drop trigger if exists trg_protege_admin_ti on usuario;
create trigger trg_protege_admin_ti before insert or update or delete on usuario
  for each row execute function fn_protege_admin_ti();

-- 5. Primeiro login: conta TI → ADMIN_TI; administrador da empresa → ADMIN; demais → pendentes
create or replace function fn_novo_usuario_auth() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_nome text; v_email text;
begin
  v_email := lower(coalesce(new.email, ''));
  v_nome := coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(v_email, '@', 1));
  insert into usuario (id, nome, email, papel, ativo)
    values (new.id, v_nome, v_email,
            case when v_email = email_admin_ti() then 'ADMIN_TI'
                 when v_email = 'agroavesdistribuidora10@gmail.com' then 'ADMIN'
                 else 'VENDEDOR' end,
            v_email in (email_admin_ti(), 'agroavesdistribuidora10@gmail.com'))
    on conflict (id) do nothing;
  return new;
end $$;

-- 6. Conta já existente: promove a ADMIN_TI (o gatilho do passo 4 completa ativo/e-mail)
update usuario set papel = 'ADMIN_TI'
 where id in (select id from auth.users where lower(email) = email_admin_ti());
