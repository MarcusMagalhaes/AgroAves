-- AgroAves 2.0 — esquema do banco (Supabase / PostgreSQL)
-- Base: docs/09-modelo-de-dados-alvo.md. Executar no SQL Editor do Supabase ou via supabase CLI.

create extension if not exists unaccent;

-- =====================================================================
-- 1. Usuários e papéis (vinculados ao Supabase Auth)
-- =====================================================================
create table if not exists usuario (
  id          uuid primary key references auth.users(id) on delete cascade,
  nome        text not null,
  email       text not null unique,
  papel       text not null check (papel in ('ADMIN','VENDEDOR')),
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);

-- Função auxiliar: papel do usuário logado (usada nas políticas RLS)
create or replace function papel_atual() returns text
language sql stable security definer set search_path = public as $$
  select papel from usuario where id = auth.uid() and ativo
$$;

create or replace function eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select papel = 'ADMIN' from usuario where id = auth.uid() and ativo), false)
$$;

-- =====================================================================
-- 2. Cadastros
-- =====================================================================
create table if not exists vendedor (
  id          serial primary key,
  usuario_id  uuid references usuario(id),
  nome        text not null,
  telefone    text,
  ativo       boolean not null default true
);

create table if not exists cidade_distribuicao (
  id    serial primary key,
  nome  text not null unique
);

create table if not exists fornecedor (
  id     serial primary key,
  nome   text not null unique,
  ativo  boolean not null default true
);

create table if not exists rota (
  id                      serial primary key,
  nome                    text not null unique,
  vendedor_id             int references vendedor(id),
  cidade_distribuicao_id  int not null references cidade_distribuicao(id),
  intervalo_dias          int not null default 14,
  ativa                   boolean not null default true
);

create table if not exists cliente (
  id              serial primary key,
  codigo          int not null unique,
  codigo_externo  text,
  cnpj_cpf        text,
  razao_social    text not null,
  nome_fantasia   text,
  endereco        text,
  cidade          text,
  contato         text,
  telefone        text,
  local_entrega   text,
  exige_nf        boolean not null default false,
  exige_gta       boolean not null default false,
  forma_pagamento text not null default 'BOLETO' check (forma_pagamento in ('BOLETO','ANTECIPADO','A_VISTA')),
  tipo            text not null default 'CLIENTE' check (tipo in ('CLIENTE','REPOSICAO')),
  observacao      text,
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
create index if not exists ix_cliente_busca on cliente (ativo, razao_social);

create table if not exists rota_cliente (
  rota_id       int not null references rota(id) on delete cascade,
  cliente_id    int not null references cliente(id) on delete cascade,
  ordem_visita  int not null,
  primary key (rota_id, cliente_id)
);
create index if not exists ix_rota_cliente_ordem on rota_cliente (rota_id, ordem_visita);

create table if not exists produto (
  id              serial primary key,
  sigla           text not null unique,
  nome            text not null,
  grupo           text check (grupo in ('CORTE','CAIPIRA','POSTURA','EXOTICOS','ACESSORIOS')),
  ordem           int not null,
  preco_compra    numeric(10,2),
  tem_preco       boolean not null default true,
  conta_como_ave  boolean not null default true,
  eh_codorna      boolean not null default false,
  ativo           boolean not null default true
);

create table if not exists preco_cliente (
  cliente_id  int not null references cliente(id) on delete cascade,
  produto_id  int not null references produto(id) on delete cascade,
  preco       numeric(10,2) not null check (preco >= 0),
  atualizado_em timestamptz not null default now(),
  primary key (cliente_id, produto_id)
);

-- =====================================================================
-- 3. Ciclo semanal
-- =====================================================================
create table if not exists semana_rota (
  id            serial primary key,
  rota_id       int not null references rota(id),
  data_entrega  date not null,
  status        text not null default 'ABERTA' check (status in ('ABERTA','FECHADA')),
  fechada_em    timestamptz,
  fechada_por   uuid references usuario(id),
  unique (rota_id, data_entrega)
);
create unique index if not exists ux_semana_rota_aberta on semana_rota (rota_id) where status = 'ABERTA';

-- =====================================================================
-- 4. Pedidos e contatos
-- =====================================================================
create table if not exists pedido (
  id                      bigserial primary key,
  semana_rota_id          int not null references semana_rota(id),
  cliente_id              int references cliente(id),
  tipo                    text not null default 'CLIENTE' check (tipo in ('CLIENTE','REPOSICAO','SOBRA')),
  forma_pagamento         text check (forma_pagamento in ('BOLETO','ANTECIPADO','A_VISTA')),
  cidade_distribuicao_id  int not null references cidade_distribuicao(id),
  reposicao               int not null default 0 check (reposicao >= 0),
  total                   numeric(12,2) not null default 0,
  status                  text not null default 'ABERTO' check (status in ('ABERTO','FECHADO','EXCLUIDO')),
  observacao              text,
  criado_em               timestamptz not null default now(),
  criado_por              uuid references usuario(id),
  atualizado_em           timestamptz not null default now(),
  atualizado_por          uuid references usuario(id)
);
-- um pedido por cliente por semana da rota (pedidos de rota, cliente nulo, não entram)
create unique index if not exists ux_pedido_semana_cliente on pedido (semana_rota_id, cliente_id)
  where cliente_id is not null and status <> 'EXCLUIDO';
create index if not exists ix_pedido_cliente on pedido (cliente_id, status);
create index if not exists ix_pedido_semana on pedido (semana_rota_id, status);

create table if not exists pedido_item (
  pedido_id       bigint not null references pedido(id) on delete cascade,
  produto_id      int not null references produto(id),
  quantidade      int not null check (quantidade > 0),
  preco_unitario  numeric(10,2) not null default 0,
  primary key (pedido_id, produto_id)
);

create table if not exists contato_cliente (
  id              bigserial primary key,
  semana_rota_id  int not null references semana_rota(id),
  cliente_id      int not null references cliente(id),
  resultado       text not null check (resultado in ('PEDIDO','SEM_INTERESSE','SEM_CONTATO','INTERESSE_SEM_PEDIDO')),
  registrado_em   timestamptz not null default now(),
  registrado_por  uuid references usuario(id),
  unique (semana_rota_id, cliente_id)
);

-- =====================================================================
-- 5. Pedido ao fornecedor (granja)
-- =====================================================================
create table if not exists pedido_fornecedor (
  id                      serial primary key,
  data_entrega            date not null,
  cidade_distribuicao_id  int not null references cidade_distribuicao(id),
  fornecedor_id           int not null references fornecedor(id),
  status                  text not null default 'REGISTRADO' check (status in ('REGISTRADO','CONFIRMADO','ENTREGUE')),
  registrado_em           timestamptz not null default now(),
  registrado_por          uuid references usuario(id),
  confirmado_em           timestamptz,
  confirmado_por          uuid references usuario(id),
  observacao              text,
  unique (data_entrega, cidade_distribuicao_id)
);

create table if not exists pedido_fornecedor_item (
  pedido_fornecedor_id  int not null references pedido_fornecedor(id) on delete cascade,
  produto_id            int not null references produto(id),
  qtd_programada        int not null default 0,
  qtd_pedida            int not null default 0,
  qtd_confirmada        int,
  observacao            text,
  primary key (pedido_fornecedor_id, produto_id)
);

-- =====================================================================
-- 6. Contas a receber
-- =====================================================================
create table if not exists titulo (
  id               bigserial primary key,
  pedido_id        bigint references pedido(id),
  cliente_id       int not null references cliente(id),
  data_referencia  date not null,
  valor            numeric(12,2) not null,
  forma_pagamento  text not null check (forma_pagamento in ('BOLETO','ANTECIPADO','A_VISTA')),
  situacao         text not null default 'PENDENTE' check (situacao in ('PENDENTE','BAIXADO','CANCELADO')),
  data_baixa       date,
  cancelado_por_id bigint references titulo(id),
  motivo           text,
  criado_em        timestamptz not null default now(),
  criado_por       uuid references usuario(id),
  atualizado_em    timestamptz not null default now(),
  atualizado_por   uuid references usuario(id),
  check (situacao <> 'BAIXADO' or data_baixa is not null)
);
create index if not exists ix_titulo_cliente_sit on titulo (cliente_id, situacao);
create index if not exists ix_titulo_data on titulo (data_referencia);
create index if not exists ix_titulo_pedido on titulo (pedido_id);

-- =====================================================================
-- 7. Auditoria genérica
-- =====================================================================
create table if not exists auditoria (
  id          bigserial primary key,
  tabela      text not null,
  registro_id text not null,
  operacao    text not null,
  antes       jsonb,
  depois      jsonb,
  usuario_id  uuid,
  em          timestamptz not null default now()
);
create index if not exists ix_auditoria_reg on auditoria (tabela, registro_id);

create or replace function fn_auditoria() returns trigger
language plpgsql security definer set search_path = public as $$
declare rid text;
begin
  if tg_op = 'DELETE' then
    rid := (to_jsonb(old)->>'id');
    insert into auditoria(tabela, registro_id, operacao, antes, usuario_id)
      values (tg_table_name, coalesce(rid, ''), tg_op, to_jsonb(old), auth.uid());
    return old;
  elsif tg_op = 'UPDATE' then
    rid := (to_jsonb(new)->>'id');
    insert into auditoria(tabela, registro_id, operacao, antes, depois, usuario_id)
      values (tg_table_name, coalesce(rid, ''), tg_op, to_jsonb(old), to_jsonb(new), auth.uid());
    return new;
  else
    rid := (to_jsonb(new)->>'id');
    insert into auditoria(tabela, registro_id, operacao, depois, usuario_id)
      values (tg_table_name, coalesce(rid, ''), tg_op, to_jsonb(new), auth.uid());
    return new;
  end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['pedido','pedido_item','contato_cliente','titulo','pedido_fornecedor','pedido_fornecedor_item','preco_cliente','cliente','rota','semana_rota']
  loop
    execute format('drop trigger if exists trg_aud_%s on %s', t, t);
    execute format('create trigger trg_aud_%s after insert or update or delete on %s for each row execute function fn_auditoria()', t, t);
  end loop;
end $$;

-- Carimbo de atualização / usuário
create or replace function fn_carimbo() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    begin new.criado_por := coalesce(new.criado_por, auth.uid()); exception when others then null; end;
  end if;
  begin new.atualizado_em := now(); exception when others then null; end;
  begin new.atualizado_por := auth.uid(); exception when others then null; end;
  return new;
end $$;

drop trigger if exists trg_carimbo_pedido on pedido;
create trigger trg_carimbo_pedido before insert or update on pedido for each row execute function fn_carimbo();
drop trigger if exists trg_carimbo_titulo on titulo;
create trigger trg_carimbo_titulo before insert or update on titulo for each row execute function fn_carimbo();
drop trigger if exists trg_carimbo_cliente on cliente;
create trigger trg_carimbo_cliente before insert or update on cliente for each row execute function fn_carimbo();

-- =====================================================================
-- 8. Views de apoio
-- =====================================================================

-- Semana aberta de cada rota (equivale à coluna "Semana Atual" da aba Rotas)
create or replace view v_rota_semana_aberta as
select r.id as rota_id, r.nome as rota, r.vendedor_id, v.nome as vendedor, v.telefone as vendedor_telefone,
       r.cidade_distribuicao_id, c.nome as cidade_distribuicao, r.intervalo_dias,
       s.id as semana_rota_id, s.data_entrega,
       (s.data_entrega + r.intervalo_dias) as proxima_semana
from rota r
join cidade_distribuicao c on c.id = r.cidade_distribuicao_id
left join vendedor v on v.id = r.vendedor_id
left join semana_rota s on s.rota_id = r.id and s.status = 'ABERTA'
where r.ativa;

-- Pendência financeira por cliente: títulos pendentes de semanas anteriores
create or replace view v_pendencia_cliente as
select t.cliente_id,
       sum(t.valor) as valor_pendente,
       count(*) as qtd_titulos,
       array_agg(distinct t.data_referencia order by t.data_referencia) as semanas
from titulo t
where t.situacao = 'PENDENTE'
group by t.cliente_id;

-- Pedidos com dados do cliente, rota e semana (linha "larga" para grades e relatórios)
create or replace view v_pedido as
select p.id, p.semana_rota_id, s.rota_id, r.nome as rota, s.data_entrega, s.status as semana_status,
       p.cliente_id, c.codigo as cliente_codigo, c.razao_social, c.nome_fantasia, c.cidade, c.contato, c.telefone,
       c.local_entrega, c.exige_nf, c.exige_gta,
       p.tipo, p.forma_pagamento, p.cidade_distribuicao_id, cd.nome as cidade_distribuicao,
       p.reposicao, p.total, p.status, p.observacao, p.criado_em, p.criado_por, p.atualizado_em, p.atualizado_por,
       coalesce(rc.ordem_visita, 9999) as ordem_visita
from pedido p
join semana_rota s on s.id = p.semana_rota_id
join rota r on r.id = s.rota_id
join cidade_distribuicao cd on cd.id = p.cidade_distribuicao_id
left join cliente c on c.id = p.cliente_id
left join rota_cliente rc on rc.rota_id = s.rota_id and rc.cliente_id = p.cliente_id;

-- Consolidação por data de entrega × cidade de distribuição × produto (substitui a tabela dinâmica)
create or replace view v_programacao_cidade as
select s.data_entrega, p.cidade_distribuicao_id, cd.nome as cidade_distribuicao,
       pi.produto_id, pr.sigla, sum(pi.quantidade) as qtd_programada
from pedido p
join semana_rota s on s.id = p.semana_rota_id
join cidade_distribuicao cd on cd.id = p.cidade_distribuicao_id
join pedido_item pi on pi.pedido_id = p.id
join produto pr on pr.id = pi.produto_id
where p.status <> 'EXCLUIDO'
group by s.data_entrega, p.cidade_distribuicao_id, cd.nome, pi.produto_id, pr.sigla;

-- =====================================================================
-- 9. Funções de negócio (executadas no banco para garantir atomicidade)
-- =====================================================================

-- Salvar pedido completo (cria/substitui) + contato "PEDIDO". itens: jsonb [{produto_id, quantidade}]
create or replace function salvar_pedido(
  p_semana_rota_id int,
  p_cliente_id int,
  p_itens jsonb,
  p_reposicao int default 0,
  p_observacao text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_pedido_id bigint;
  v_rota_id int;
  v_cidade int;
  v_forma text;
  v_total numeric(12,2) := 0;
  v_item jsonb;
  v_preco numeric(10,2);
  v_qtd int;
  v_prod int;
  v_status text;
begin
  select s.rota_id, r.cidade_distribuicao_id, s.status into v_rota_id, v_cidade, v_status
    from semana_rota s join rota r on r.id = s.rota_id where s.id = p_semana_rota_id;
  if v_rota_id is null then raise exception 'Semana da rota não encontrada'; end if;
  if v_status <> 'ABERTA' then raise exception 'Semana já fechada'; end if;
  if papel_atual() = 'VENDEDOR' and not exists (
      select 1 from rota r join vendedor v on v.id = r.vendedor_id
      where r.id = v_rota_id and v.usuario_id = auth.uid()) then
    raise exception 'Vendedor não atende esta rota';
  end if;

  select forma_pagamento into v_forma from cliente where id = p_cliente_id;
  if v_forma is null then raise exception 'Cliente não encontrado'; end if;

  select id into v_pedido_id from pedido
    where semana_rota_id = p_semana_rota_id and cliente_id = p_cliente_id and status <> 'EXCLUIDO';

  if v_pedido_id is null then
    insert into pedido (semana_rota_id, cliente_id, tipo, forma_pagamento, cidade_distribuicao_id, reposicao, observacao)
      values (p_semana_rota_id, p_cliente_id, 'CLIENTE', v_forma, v_cidade, coalesce(p_reposicao,0), p_observacao)
      returning id into v_pedido_id;
  else
    update pedido set reposicao = coalesce(p_reposicao,0), observacao = p_observacao, forma_pagamento = v_forma
      where id = v_pedido_id;
    delete from pedido_item where pedido_id = v_pedido_id;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    v_prod := (v_item->>'produto_id')::int;
    v_qtd := coalesce((v_item->>'quantidade')::int, 0);
    if v_qtd <= 0 then continue; end if;
    select preco into v_preco from preco_cliente where cliente_id = p_cliente_id and produto_id = v_prod;
    v_preco := coalesce(v_preco, 0);
    insert into pedido_item (pedido_id, produto_id, quantidade, preco_unitario)
      values (v_pedido_id, v_prod, v_qtd, v_preco);
    v_total := v_total + v_qtd * v_preco;
  end loop;

  if not exists (select 1 from pedido_item where pedido_id = v_pedido_id) and coalesce(p_reposicao,0) = 0 then
    raise exception 'Pedido sem quantidades';
  end if;

  update pedido set total = v_total where id = v_pedido_id;

  insert into contato_cliente (semana_rota_id, cliente_id, resultado, registrado_por)
    values (p_semana_rota_id, p_cliente_id, 'PEDIDO', auth.uid())
    on conflict (semana_rota_id, cliente_id) do update
      set resultado = 'PEDIDO', registrado_em = now(), registrado_por = auth.uid();

  perform sincronizar_titulo(v_pedido_id);
  return v_pedido_id;
end $$;

-- Excluir pedido (marca EXCLUIDO, cancela título pendente)
create or replace function excluir_pedido(p_pedido_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update pedido set status = 'EXCLUIDO' where id = p_pedido_id and status = 'ABERTO';
  update titulo set situacao = 'CANCELADO', motivo = 'EXCLUSAO_PEDIDO'
    where pedido_id = p_pedido_id and situacao = 'PENDENTE';
  delete from contato_cliente cc using pedido p
    where p.id = p_pedido_id and cc.semana_rota_id = p.semana_rota_id and cc.cliente_id = p.cliente_id and cc.resultado = 'PEDIDO';
end $$;

-- Atualizar quantidade de um item (grade do administrador). quantidade 0 remove o item.
create or replace function atualizar_item_pedido(p_pedido_id bigint, p_produto_id int, p_quantidade int) returns numeric
language plpgsql security definer set search_path = public as $$
declare v_cliente int; v_preco numeric(10,2); v_total numeric(12,2);
begin
  if not eh_admin() then raise exception 'Somente administrador'; end if;
  select cliente_id into v_cliente from pedido where id = p_pedido_id and status = 'ABERTO';
  if v_cliente is null and not exists (select 1 from pedido where id = p_pedido_id and status='ABERTO') then
    raise exception 'Pedido não encontrado ou fechado';
  end if;
  if coalesce(p_quantidade,0) <= 0 then
    delete from pedido_item where pedido_id = p_pedido_id and produto_id = p_produto_id;
  else
    select preco into v_preco from preco_cliente where cliente_id = v_cliente and produto_id = p_produto_id;
    insert into pedido_item (pedido_id, produto_id, quantidade, preco_unitario)
      values (p_pedido_id, p_produto_id, p_quantidade, coalesce(v_preco,0))
      on conflict (pedido_id, produto_id) do update set quantidade = excluded.quantidade;
  end if;
  select coalesce(sum(quantidade * preco_unitario),0) into v_total from pedido_item where pedido_id = p_pedido_id;
  update pedido set total = v_total where id = p_pedido_id;
  perform sincronizar_titulo(p_pedido_id);
  return v_total;
end $$;

-- Título: gerado/recalculado só quando o pedido ao fornecedor da semana/cidade está CONFIRMADO ou ENTREGUE (D-08)
create or replace function sincronizar_titulo(p_pedido_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ped record;
  v_pf_status text;
  v_total_vigente numeric(12,2);
  v_baixado numeric(12,2);
  v_novo numeric(12,2);
  v_old_id bigint;
begin
  select p.*, s.data_entrega into v_ped from pedido p join semana_rota s on s.id = p.semana_rota_id where p.id = p_pedido_id;
  if v_ped.cliente_id is null or v_ped.tipo <> 'CLIENTE' then return; end if;

  select status into v_pf_status from pedido_fornecedor
    where data_entrega = v_ped.data_entrega and cidade_distribuicao_id = v_ped.cidade_distribuicao_id;
  if v_pf_status is null or v_pf_status = 'REGISTRADO' then return; end if;  -- ainda não é hora

  select coalesce(sum(valor),0) into v_total_vigente from titulo where pedido_id = p_pedido_id and situacao <> 'CANCELADO';
  select coalesce(sum(valor),0) into v_baixado from titulo where pedido_id = p_pedido_id and situacao = 'BAIXADO';

  if v_ped.status = 'EXCLUIDO' then
    update titulo set situacao='CANCELADO', motivo='EXCLUSAO_PEDIDO' where pedido_id = p_pedido_id and situacao='PENDENTE';
    return;
  end if;

  if abs(v_total_vigente - v_ped.total) < 0.005 then return; end if;

  -- cancela pendentes e lança diferença (R11)
  update titulo set situacao = 'CANCELADO', motivo = 'RECALCULO'
    where pedido_id = p_pedido_id and situacao = 'PENDENTE';
  v_novo := v_ped.total - v_baixado;
  if v_novo > 0.005 then
    insert into titulo (pedido_id, cliente_id, data_referencia, valor, forma_pagamento, situacao, motivo)
      values (p_pedido_id, v_ped.cliente_id, v_ped.data_entrega, v_novo, v_ped.forma_pagamento, 'PENDENTE',
              case when v_total_vigente = 0 then 'GERACAO' else 'RECALCULO' end);
  end if;
end $$;

-- Gera títulos de todos os pedidos de uma data × cidade (chamado ao confirmar a granja / entrega)
create or replace function gerar_titulos(p_data date, p_cidade_id int) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int := 0; v_id bigint;
begin
  if not eh_admin() then raise exception 'Somente administrador'; end if;
  for v_id in select p.id from pedido p join semana_rota s on s.id = p.semana_rota_id
              where s.data_entrega = p_data and p.cidade_distribuicao_id = p_cidade_id and p.status = 'ABERTO' and p.cliente_id is not null
  loop
    perform sincronizar_titulo(v_id); v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Registrar pedido ao fornecedor: itens jsonb [{produto_id, qtd_pedida}]
create or replace function registrar_pedido_fornecedor(p_data date, p_cidade_id int, p_fornecedor_id int, p_itens jsonb, p_obs text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare v_id int; v_item jsonb; v_prod int; v_prog int;
begin
  if not eh_admin() then raise exception 'Somente administrador'; end if;
  if p_fornecedor_id is null then raise exception 'Fornecedor é obrigatório'; end if;
  insert into pedido_fornecedor (data_entrega, cidade_distribuicao_id, fornecedor_id, registrado_por, observacao)
    values (p_data, p_cidade_id, p_fornecedor_id, auth.uid(), p_obs)
    on conflict (data_entrega, cidade_distribuicao_id) do update
      set fornecedor_id = excluded.fornecedor_id, registrado_em = now(), registrado_por = auth.uid(), observacao = excluded.observacao
    returning id into v_id;
  delete from pedido_fornecedor_item where pedido_fornecedor_id = v_id;
  for v_item in select * from jsonb_array_elements(coalesce(p_itens,'[]'::jsonb)) loop
    v_prod := (v_item->>'produto_id')::int;
    select coalesce(sum(qtd_programada),0) into v_prog from v_programacao_cidade
      where data_entrega = p_data and cidade_distribuicao_id = p_cidade_id and produto_id = v_prod;
    insert into pedido_fornecedor_item (pedido_fornecedor_id, produto_id, qtd_programada, qtd_pedida)
      values (v_id, v_prod, v_prog, coalesce((v_item->>'qtd_pedida')::int,0));
  end loop;
  return v_id;
end $$;

-- Confirmação da granja: itens jsonb [{produto_id, qtd_confirmada, observacao}]
create or replace function confirmar_pedido_fornecedor(p_id int, p_itens jsonb, p_status text default 'CONFIRMADO')
returns void
language plpgsql security definer set search_path = public as $$
declare v_item jsonb; v_data date; v_cid int;
begin
  if not eh_admin() then raise exception 'Somente administrador'; end if;
  for v_item in select * from jsonb_array_elements(coalesce(p_itens,'[]'::jsonb)) loop
    update pedido_fornecedor_item
      set qtd_confirmada = (v_item->>'qtd_confirmada')::int, observacao = v_item->>'observacao'
      where pedido_fornecedor_id = p_id and produto_id = (v_item->>'produto_id')::int;
    if not found then
      insert into pedido_fornecedor_item (pedido_fornecedor_id, produto_id, qtd_programada, qtd_pedida, qtd_confirmada, observacao)
        values (p_id, (v_item->>'produto_id')::int, 0, 0, (v_item->>'qtd_confirmada')::int, v_item->>'observacao');
    end if;
  end loop;
  update pedido_fornecedor set status = p_status, confirmado_em = now(), confirmado_por = auth.uid() where id = p_id
    returning data_entrega, cidade_distribuicao_id into v_data, v_cid;
  if p_status in ('CONFIRMADO','ENTREGUE') then perform gerar_titulos(v_data, v_cid); end if;
end $$;

-- Fechamento semanal de uma rota: exige pedido ao fornecedor registrado para a data/cidade
create or replace function fechar_semana_rota(p_rota_id int, p_forcar boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare v_sem record; v_rota record; v_nova int;
begin
  if not eh_admin() then raise exception 'Somente administrador'; end if;
  select * into v_rota from rota where id = p_rota_id;
  select * into v_sem from semana_rota where rota_id = p_rota_id and status = 'ABERTA';
  if v_sem.id is null then raise exception 'Rota sem semana aberta'; end if;
  if not p_forcar and v_sem.data_entrega >= current_date then
    raise exception 'A semana % ainda não venceu', to_char(v_sem.data_entrega,'DD/MM/YYYY');
  end if;
  if exists (select 1 from pedido where semana_rota_id = v_sem.id and status = 'ABERTO' and cliente_id is not null)
     and not exists (select 1 from pedido_fornecedor
                     where data_entrega = v_sem.data_entrega and cidade_distribuicao_id = v_rota.cidade_distribuicao_id) then
    raise exception 'Não há pedido ao fornecedor registrado para % / %', to_char(v_sem.data_entrega,'DD/MM/YYYY'), v_rota.cidade_distribuicao_id;
  end if;
  update pedido set status = 'FECHADO' where semana_rota_id = v_sem.id and status = 'ABERTO';
  update semana_rota set status = 'FECHADA', fechada_em = now(), fechada_por = auth.uid() where id = v_sem.id;
  insert into semana_rota (rota_id, data_entrega, status)
    values (p_rota_id, v_sem.data_entrega + v_rota.intervalo_dias, 'ABERTA')
    returning id into v_nova;
  return v_nova;
end $$;

-- Baixa / estorno de título
create or replace function baixar_titulo(p_id bigint, p_data date default current_date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not eh_admin() then raise exception 'Somente administrador'; end if;
  update titulo set situacao = 'BAIXADO', data_baixa = p_data where id = p_id and situacao = 'PENDENTE';
end $$;

create or replace function estornar_baixa(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not eh_admin() then raise exception 'Somente administrador'; end if;
  update titulo set situacao = 'PENDENTE', data_baixa = null where id = p_id and situacao = 'BAIXADO';
end $$;

-- Busca de clientes sem acento (RF-11)
create or replace function normalizar(p text) returns text
language sql immutable as $$ select lower(unaccent(coalesce(p,''))) $$;
