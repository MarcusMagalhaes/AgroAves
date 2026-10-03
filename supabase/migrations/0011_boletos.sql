-- AgroAves 2.0 — Boletos Sicoob (API Cobrança Bancária v3)
-- Emissão, 2ª via, baixa no banco e conciliação dos títulos do contas a receber. A comunicação com o Sicoob é feita
-- pelo Worker do Cloudflare (worker/index.ts), que usa o login do usuário: tudo aqui continua protegido por RLS.
--   1. Cliente: endereço estruturado exigido pelo banco (bairro, CEP, UF) e e-mail
--   2. Título: data de vencimento (entrega + prazo configurado)
--   3. cobranca_config: dados do beneficiário e regras do boleto (uma linha, editada pelo administrador TI)
--   4. boleto: um registro por boleto emitido; ciclo EMITINDO → EMITIDO → LIQUIDADO | A_BAIXAR → BAIXADO (ou ERRO)
--   5. Bucket privado 'boletos' para os PDFs
-- Rode depois da 0010. O script pode ser executado mais de uma vez.

-- 1. Cliente
alter table cliente add column if not exists bairro text;
alter table cliente add column if not exists cep text;
alter table cliente add column if not exists uf text;
alter table cliente add column if not exists email text;

-- 2. Configuração da cobrança (linha única, id = 1)
create table if not exists cobranca_config (
  id                        int primary key default 1 check (id = 1),
  numero_cliente            bigint,                       -- código do beneficiário no Sicoob (sandbox: 25546454)
  codigo_modalidade         int not null default 1,       -- 1 = simples com registro
  numero_conta_corrente     bigint,
  numero_contrato_cobranca  bigint,
  especie_documento         text not null default 'DM',   -- duplicata mercantil
  prazo_vencimento_dias     int not null default 7 check (prazo_vencimento_dias between 0 and 120),
  multa_percentual          numeric(5,2) not null default 2 check (multa_percentual between 0 and 2),
  juros_mes_percentual      numeric(5,2) not null default 1 check (juros_mes_percentual between 0 and 10),
  com_pix                   boolean not null default true, -- boleto híbrido (QR Code Pix)
  mensagem                  text,                          -- instrução impressa no boleto
  atualizado_em             timestamptz not null default now(),
  atualizado_por            uuid default auth.uid() references usuario(id)
);
insert into cobranca_config (id, numero_cliente) values (1, 25546454) on conflict (id) do nothing;

-- 3. Vencimento do título: entrega + prazo da configuração (pode ser ajustado na emissão do boleto)
alter table titulo add column if not exists data_vencimento date;
-- preenche os títulos existentes sem gerar uma linha de auditoria por título
select set_config('app.sem_auditoria', 'on', false);
update titulo t set data_vencimento = t.data_referencia + c.prazo_vencimento_dias
  from cobranca_config c where c.id = 1 and t.data_vencimento is null;
select set_config('app.sem_auditoria', '', false);

create or replace function fn_titulo_vencimento() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.data_vencimento is null then
    new.data_vencimento := new.data_referencia + coalesce((select prazo_vencimento_dias from cobranca_config where id = 1), 7);
  end if;
  return new;
end $$;
drop trigger if exists trg_titulo_vencimento on titulo;
create trigger trg_titulo_vencimento before insert on titulo for each row execute function fn_titulo_vencimento();

-- 4. Boletos
create table if not exists boleto (
  id               bigserial primary key,
  titulo_id        bigint not null references titulo(id),
  ambiente         text not null check (ambiente in ('SANDBOX','PRODUCAO')),
  situacao         text not null default 'EMITINDO'
                   check (situacao in ('EMITINDO','EMITIDO','LIQUIDADO','A_BAIXAR','BAIXADO','ERRO')),
  valor            numeric(12,2) not null,
  data_vencimento  date not null,
  seu_numero       text not null,
  nosso_numero     bigint,
  linha_digitavel  text,
  codigo_barras    text,
  pix_copia_cola   text,
  pdf_caminho      text,                 -- caminho no bucket 'boletos'
  data_liquidacao  date,
  valor_pago       numeric(12,2),
  erro             text,                 -- mensagem do banco quando a emissão falha
  resposta         jsonb,                -- retorno do banco (sem o PDF)
  criado_em        timestamptz not null default now(),
  criado_por       uuid default auth.uid() references usuario(id),
  atualizado_em    timestamptz not null default now()
);
create index if not exists ix_boleto_titulo on boleto (titulo_id);
create index if not exists ix_boleto_situacao on boleto (situacao);
-- no máximo um boleto vivo por título (evita emissão em dobro com duplo clique)
create unique index if not exists ux_boleto_titulo_vivo on boleto (titulo_id)
  where situacao in ('EMITINDO','EMITIDO','A_BAIXAR','LIQUIDADO');
-- em produção o nosso número é único; o sandbox devolve sempre os mesmos dados simulados
create unique index if not exists ux_boleto_nosso_numero on boleto (nosso_numero) where nosso_numero is not null and ambiente = 'PRODUCAO';

create or replace function fn_boleto_atualizado() returns trigger
language plpgsql as $$ begin new.atualizado_em := now(); return new; end $$;
drop trigger if exists trg_boleto_atualizado on boleto;
create trigger trg_boleto_atualizado before update on boleto for each row execute function fn_boleto_atualizado();

drop trigger if exists trg_aud_boleto on boleto;
create trigger trg_aud_boleto after insert or update or delete on boleto for each row execute function fn_auditoria();
drop trigger if exists trg_aud_cobranca_config on cobranca_config;
create trigger trg_aud_cobranca_config after insert or update or delete on cobranca_config for each row execute function fn_auditoria();

-- Título cancelado (recálculo/exclusão) ou baixado à mão: o boleto em aberto precisa ser baixado no banco.
-- Estorno da baixa devolve o boleto ainda não baixado no banco para "emitido".
create or replace function fn_titulo_boleto() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.situacao is distinct from old.situacao then
    if new.situacao in ('CANCELADO','BAIXADO') then
      update boleto set situacao = 'A_BAIXAR' where titulo_id = new.id and situacao = 'EMITIDO';
    elsif new.situacao = 'PENDENTE' then
      update boleto set situacao = 'EMITIDO' where titulo_id = new.id and situacao = 'A_BAIXAR';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_titulo_boleto on titulo;
create trigger trg_titulo_boleto after update of situacao on titulo for each row execute function fn_titulo_boleto();

-- Pagamento confirmado pelo banco: liquida o boleto e baixa o título na data do pagamento
create or replace function liquidar_boleto(p_boleto_id bigint, p_data date, p_valor numeric default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_titulo bigint;
begin
  if not eh_admin() then raise exception 'Somente administrador'; end if;
  update boleto set situacao = 'LIQUIDADO', data_liquidacao = p_data, valor_pago = coalesce(p_valor, valor)
    where id = p_boleto_id and situacao in ('EMITIDO','A_BAIXAR')
    returning titulo_id into v_titulo;
  if v_titulo is null then return; end if;
  update titulo set situacao = 'BAIXADO', data_baixa = p_data where id = v_titulo and situacao = 'PENDENTE';
end $$;

-- 5. Segurança: boletos e configuração só para administradores; configuração alterada só pela TI
alter table boleto enable row level security;
drop policy if exists boleto_admin on boleto;
create policy boleto_admin on boleto for all using (eh_admin()) with check (eh_admin());

alter table cobranca_config enable row level security;
drop policy if exists cobranca_config_ler on cobranca_config;
create policy cobranca_config_ler on cobranca_config for select using (eh_admin());
drop policy if exists cobranca_config_ti on cobranca_config;
create policy cobranca_config_ti on cobranca_config for update using (eh_admin_ti()) with check (eh_admin_ti());

-- 6. PDFs dos boletos: bucket privado, caminho <título>/<boleto>.pdf
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('boletos', 'boletos', false, 5242880, array['application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists boletos_admin_ler on storage.objects;
create policy boletos_admin_ler on storage.objects for select
  using (bucket_id = 'boletos' and public.eh_admin());
drop policy if exists boletos_admin_enviar on storage.objects;
create policy boletos_admin_enviar on storage.objects for insert
  with check (bucket_id = 'boletos' and public.eh_admin());
drop policy if exists boletos_admin_atualizar on storage.objects;
create policy boletos_admin_atualizar on storage.objects for update
  using (bucket_id = 'boletos' and public.eh_admin());

notify pgrst, 'reload schema';
