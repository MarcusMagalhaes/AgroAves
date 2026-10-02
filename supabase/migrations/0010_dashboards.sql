-- AgroAves 2.0 — Dashboards
-- Os números são calculados no banco (a API do Supabase devolve no máximo ~1.000 linhas por consulta;
-- somar na tela daria totais errados com muitos pedidos/títulos).
-- dashboard_vendas(data): administradores (ADMIN e ADMIN_TI). "Semana" = data de entrega, como na Programação.
-- dashboard_financeiro(): somente administrador TI.
-- O script pode ser executado mais de uma vez.

-- ---------------------------------------------------------------------
-- Vendas da semana. p_data nula = semana atual (primeira data de entrega em aberto).
-- Considera pedidos de cliente (tipo CLIENTE) não excluídos.
-- ---------------------------------------------------------------------
create or replace function dashboard_vendas(p_data date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_data date := p_data;
  v_ant date;
  r jsonb;
begin
  if not eh_admin() then raise exception 'Somente administrador'; end if;
  if v_data is null then
    select min(data_entrega) into v_data from semana_rota where status = 'ABERTA';
    if v_data is null then select max(data_entrega) into v_data from semana_rota; end if;
  end if;
  select max(s.data_entrega) into v_ant from semana_rota s where s.data_entrega < v_data;

  with ped as (
    select p.id, p.cliente_id, p.total, s.rota_id, s.data_entrega
    from pedido p join semana_rota s on s.id = p.semana_rota_id
    where s.data_entrega in (v_data, v_ant) and p.status <> 'EXCLUIDO' and p.tipo = 'CLIENTE'
  ),
  atual as (select * from ped where data_entrega = v_data),
  itens as (
    select a.id as pedido_id, a.cliente_id, a.rota_id, i.produto_id, i.quantidade, i.quantidade * i.preco_unitario as valor, pr.conta_como_ave
    from atual a join pedido_item i on i.pedido_id = a.id join produto pr on pr.id = i.produto_id
  ),
  kpi_atual as (
    select count(*) as pedidos, count(distinct cliente_id) as clientes, coalesce(sum(total), 0) as valor, count(distinct rota_id) as rotas
    from atual
  ),
  kpi_itens as (
    select coalesce(sum(quantidade) filter (where conta_como_ave), 0) as aves, coalesce(sum(quantidade), 0) as itens from itens
  ),
  kpi_ant as (
    select count(*) as pedidos, coalesce(sum(total), 0) as valor from ped where data_entrega = v_ant
  ),
  rotas_semana as (select id as semana_rota_id, rota_id from semana_rota where data_entrega = v_data),
  carteira as (  -- clientes ativos nas rotas da semana
    select rc.rota_id, count(*) as clientes
    from rota_cliente rc join cliente c on c.id = rc.cliente_id and c.ativo
    where rc.rota_id in (select rota_id from rotas_semana)
    group by rc.rota_id
  ),
  contatos as (
    select cc.resultado, count(*) as n
    from contato_cliente cc where cc.semana_rota_id in (select semana_rota_id from rotas_semana)
    group by cc.resultado
  ),
  por_cliente as (
    select a.cliente_id, max(r.nome) as rota, sum(a.total) as valor, coalesce(sum(iq.q), 0) as quantidade
    from atual a join rota r on r.id = a.rota_id
    left join (select pedido_id, sum(quantidade) as q from itens group by pedido_id) iq on iq.pedido_id = a.id
    group by a.cliente_id
  )
  select jsonb_build_object(
    'data', v_data,
    'anterior', v_ant,
    'semanas', coalesce((select jsonb_agg(d order by d desc) from (select distinct data_entrega as d from semana_rota order by 1 desc limit 104) x), '[]'),
    'kpis', (select jsonb_build_object('pedidos', k.pedidos, 'clientes', k.clientes, 'valor', k.valor, 'rotas', k.rotas,
                                       'aves', ki.aves, 'itens', ki.itens,
                                       'pedidos_anterior', ka.pedidos, 'valor_anterior', ka.valor,
                                       'carteira', coalesce((select sum(clientes) from carteira), 0))
             from kpi_atual k, kpi_itens ki, kpi_ant ka),
    'contatos', coalesce((select jsonb_object_agg(resultado, n) from contatos), '{}'),
    'produtos', coalesce((
      select jsonb_agg(jsonb_build_object('produto_id', pr.id, 'sigla', pr.sigla, 'nome', pr.nome, 'grupo', pr.grupo, 'cor', pr.cor,
                                          'quantidade', x.quantidade, 'valor', x.valor) order by x.quantidade desc, pr.ordem)
      from (select produto_id, sum(quantidade) as quantidade, sum(valor) as valor from itens group by produto_id) x
      join produto pr on pr.id = x.produto_id), '[]'),
    'clientes_quantidade', coalesce((
      select jsonb_agg(o) from (
        select jsonb_build_object('cliente_id', c.id, 'codigo', c.codigo, 'nome', coalesce(nullif(c.nome_fantasia, ''), c.razao_social),
                                  'cidade', c.cidade, 'rota', pc.rota, 'quantidade', pc.quantidade, 'valor', pc.valor) as o
        from por_cliente pc join cliente c on c.id = pc.cliente_id
        order by pc.quantidade desc, pc.valor desc limit 10) t), '[]'),
    'clientes_valor', coalesce((
      select jsonb_agg(o) from (
        select jsonb_build_object('cliente_id', c.id, 'codigo', c.codigo, 'nome', coalesce(nullif(c.nome_fantasia, ''), c.razao_social),
                                  'cidade', c.cidade, 'rota', pc.rota, 'quantidade', pc.quantidade, 'valor', pc.valor) as o
        from por_cliente pc join cliente c on c.id = pc.cliente_id
        order by pc.valor desc, pc.quantidade desc limit 10) t), '[]'),
    'rotas', coalesce((
      select jsonb_agg(o) from (
        select jsonb_build_object('rota_id', r.id, 'rota', r.nome, 'vendedor', v.nome,
                                  'pedidos', count(a.id), 'valor', coalesce(sum(a.total), 0),
                                  'quantidade', coalesce((select sum(i.quantidade) from itens i where i.rota_id = r.id), 0),
                                  'carteira', coalesce(max(ca.clientes), 0)) as o
        from rotas_semana rs join rota r on r.id = rs.rota_id
        left join vendedor v on v.id = r.vendedor_id
        left join atual a on a.rota_id = r.id
        left join carteira ca on ca.rota_id = r.id
        group by r.id, r.nome, v.nome
        order by count(a.id) desc, coalesce(sum(a.total), 0) desc) t), '[]')
  ) into r;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- Financeiro: a receber (títulos) × a pagar (contas a pagar). Somente administrador TI.
-- ---------------------------------------------------------------------
create or replace function dashboard_financeiro() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_mes date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
  r jsonb;
begin
  if not eh_admin_ti() then raise exception 'Somente administrador TI'; end if;
  with tp as (select * from titulo where situacao = 'PENDENTE'),
       cp as (select * from conta_pagar where situacao = 'PENDENTE')
  select jsonb_build_object(
    'hoje', v_hoje,
    'receber', (select jsonb_build_object(
        'pendente', coalesce(sum(valor), 0), 'qtd', count(*), 'clientes', count(distinct cliente_id),
        'recebido_mes', (select coalesce(sum(valor), 0) from titulo where situacao = 'BAIXADO' and data_baixa >= v_mes),
        'por_forma', coalesce((select jsonb_object_agg(forma_pagamento, v) from (select forma_pagamento, sum(valor) as v from tp group by 1) f), '{}'))
      from tp),
    'pagar', (select jsonb_build_object(
        'pendente', coalesce(sum(valor), 0), 'qtd', count(*),
        'vencido', coalesce(sum(valor) filter (where data_vencimento < v_hoje), 0),
        'qtd_vencido', count(*) filter (where data_vencimento < v_hoje),
        'prox7', coalesce(sum(valor) filter (where data_vencimento between v_hoje and v_hoje + 7), 0),
        'qtd_prox7', count(*) filter (where data_vencimento between v_hoje and v_hoje + 7),
        'pago_mes', (select coalesce(sum(valor), 0) from conta_pagar where situacao = 'PAGO' and data_pagamento >= v_mes))
      from cp),
    -- clientes devendo: títulos pendentes por cliente, desde a semana mais antiga
    'devedores', coalesce((
      select jsonb_agg(o) from (
        select jsonb_build_object('cliente_id', c.id, 'codigo', c.codigo, 'nome', coalesce(nullif(c.nome_fantasia, ''), c.razao_social),
                                  'cidade', c.cidade, 'valor', sum(t.valor), 'qtd', count(*), 'desde', min(t.data_referencia)) as o
        from tp t join cliente c on c.id = t.cliente_id
        group by c.id having sum(t.valor) > 0
        order by sum(t.valor) desc limit 20) x), '[]'),
    -- próximas contas a pagar (vencidas primeiro)
    'proximas', coalesce((
      select jsonb_agg(o) from (
        select jsonb_build_object('id', cp.id, 'fornecedor', f.nome, 'observacao', cp.observacao, 'data_vencimento', cp.data_vencimento,
                                  'valor', cp.valor, 'centro', cp.centro_custo_codigo || ' — ' || cc.descricao) as o
        from cp join fornecedor f on f.id = cp.fornecedor_id join centro_custo cc on cc.codigo = cp.centro_custo_codigo
        order by cp.data_vencimento, cp.id limit 12) x), '[]'),
    -- a pagar pendente por centro de custo do primeiro nível (1000, 2000, …)
    'por_centro', coalesce((
      select jsonb_agg(jsonb_build_object('codigo', raiz.codigo, 'descricao', raiz.descricao, 'valor', x.v) order by x.v desc)
      from (select (cp.centro_custo_codigo / 1000) * 1000 as raiz, sum(cp.valor) as v from cp group by 1) x
      join centro_custo raiz on raiz.codigo = x.raiz), '[]'),
    -- a pagar nas próximas 8 semanas (semana começando na segunda); vencidas à parte
    'semanas_pagar', (
      select jsonb_agg(jsonb_build_object('inicio', s.inicio,
             'valor', coalesce((select sum(valor) from cp where data_vencimento >= greatest(s.inicio, v_hoje) and data_vencimento < s.inicio + 7), 0))
             order by s.inicio)
      from (select (date_trunc('week', v_hoje)::date + 7 * g) as inicio from generate_series(0, 7) g) s)
  ) into r;
  return r;
end $$;

grant execute on function dashboard_vendas(date) to authenticated;
grant execute on function dashboard_financeiro() to authenticated;

notify pgrst, 'reload schema';
