-- AgroAves 2.0 — Row Level Security
-- Admin: tudo. Vendedor: leitura de cadastros; leitura/escrita de pedidos e contatos só das próprias rotas.

alter table usuario enable row level security;
alter table vendedor enable row level security;
alter table cidade_distribuicao enable row level security;
alter table fornecedor enable row level security;
alter table rota enable row level security;
alter table cliente enable row level security;
alter table rota_cliente enable row level security;
alter table produto enable row level security;
alter table preco_cliente enable row level security;
alter table semana_rota enable row level security;
alter table pedido enable row level security;
alter table pedido_item enable row level security;
alter table contato_cliente enable row level security;
alter table pedido_fornecedor enable row level security;
alter table pedido_fornecedor_item enable row level security;
alter table titulo enable row level security;
alter table auditoria enable row level security;

-- Função: rotas do vendedor logado
create or replace function minhas_rotas() returns setof int
language sql stable security definer set search_path = public as $$
  select r.id from rota r join vendedor v on v.id = r.vendedor_id where v.usuario_id = auth.uid()
$$;

-- usuario: cada um lê o próprio; admin tudo
drop policy if exists usuario_self on usuario;
create policy usuario_self on usuario for select using (id = auth.uid() or eh_admin());
drop policy if exists usuario_admin on usuario;
create policy usuario_admin on usuario for all using (eh_admin()) with check (eh_admin());

-- cadastros: leitura para autenticados, escrita para admin
do $$
declare t text;
begin
  foreach t in array array['vendedor','cidade_distribuicao','fornecedor','rota','cliente','rota_cliente','produto','preco_cliente','semana_rota']
  loop
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('create policy %I_read on %I for select using (auth.uid() is not null)', t, t);
    execute format('drop policy if exists %I_admin on %I', t, t);
    execute format('create policy %I_admin on %I for all using (eh_admin()) with check (eh_admin())', t, t);
  end loop;
end $$;

-- pedido / pedido_item / contato: admin tudo; vendedor só das próprias rotas
drop policy if exists pedido_admin on pedido;
create policy pedido_admin on pedido for all using (eh_admin()) with check (eh_admin());
drop policy if exists pedido_vend on pedido;
create policy pedido_vend on pedido for select using (
  exists (select 1 from semana_rota s where s.id = pedido.semana_rota_id and s.rota_id in (select minhas_rotas()))
);

drop policy if exists pedido_item_admin on pedido_item;
create policy pedido_item_admin on pedido_item for all using (eh_admin()) with check (eh_admin());
drop policy if exists pedido_item_vend on pedido_item;
create policy pedido_item_vend on pedido_item for select using (
  exists (select 1 from pedido p join semana_rota s on s.id = p.semana_rota_id
          where p.id = pedido_item.pedido_id and s.rota_id in (select minhas_rotas()))
);

drop policy if exists contato_admin on contato_cliente;
create policy contato_admin on contato_cliente for all using (eh_admin()) with check (eh_admin());
drop policy if exists contato_vend_sel on contato_cliente;
create policy contato_vend_sel on contato_cliente for select using (
  exists (select 1 from semana_rota s where s.id = contato_cliente.semana_rota_id and s.rota_id in (select minhas_rotas()))
);
drop policy if exists contato_vend_ins on contato_cliente;
create policy contato_vend_ins on contato_cliente for insert with check (
  exists (select 1 from semana_rota s where s.id = contato_cliente.semana_rota_id and s.status = 'ABERTA' and s.rota_id in (select minhas_rotas()))
);
drop policy if exists contato_vend_upd on contato_cliente;
create policy contato_vend_upd on contato_cliente for update using (
  exists (select 1 from semana_rota s where s.id = contato_cliente.semana_rota_id and s.status = 'ABERTA' and s.rota_id in (select minhas_rotas()))
);

-- fornecedor / títulos / auditoria: só admin (vendedor vê pendência via view com security_invoker desligado)
drop policy if exists pf_admin on pedido_fornecedor;
create policy pf_admin on pedido_fornecedor for all using (eh_admin()) with check (eh_admin());
drop policy if exists pfi_admin on pedido_fornecedor_item;
create policy pfi_admin on pedido_fornecedor_item for all using (eh_admin()) with check (eh_admin());
drop policy if exists titulo_admin on titulo;
create policy titulo_admin on titulo for all using (eh_admin()) with check (eh_admin());
drop policy if exists aud_admin on auditoria;
create policy aud_admin on auditoria for select using (eh_admin());

-- Views: v_pendencia_cliente precisa ser lida pelo vendedor sem expor títulos → função security definer
create or replace function pendencia_cliente(p_cliente_id int, p_antes_de date default null)
returns table (valor_pendente numeric, qtd_titulos bigint, semanas date[])
language sql stable security definer set search_path = public as $$
  select coalesce(sum(valor),0), count(*), coalesce(array_agg(distinct data_referencia order by data_referencia), '{}')
  from titulo
  where cliente_id = p_cliente_id and situacao = 'PENDENTE'
    and (p_antes_de is null or data_referencia < p_antes_de)
$$;

-- Últimos pedidos do cliente (histórico), visível ao vendedor da rota
create or replace function ultimos_pedidos(p_cliente_id int, p_limite int default 4)
returns table (pedido_id bigint, data_entrega date, rota text, cidade_distribuicao text, total numeric, reposicao int, itens jsonb)
language sql stable security definer set search_path = public as $$
  select p.id, s.data_entrega, r.nome, cd.nome, p.total, p.reposicao,
         coalesce((select jsonb_agg(jsonb_build_object('sigla', pr.sigla, 'quantidade', pi.quantidade) order by pr.ordem)
                   from pedido_item pi join produto pr on pr.id = pi.produto_id where pi.pedido_id = p.id), '[]'::jsonb)
  from pedido p
  join semana_rota s on s.id = p.semana_rota_id
  join rota r on r.id = s.rota_id
  join cidade_distribuicao cd on cd.id = p.cidade_distribuicao_id
  where p.cliente_id = p_cliente_id and p.status = 'FECHADO'
  order by s.data_entrega desc
  limit p_limite
$$;

-- Lista de clientes da rota para a tela de venda (ordem de visita + contato da semana + pedido da semana)
create or replace function clientes_rota_semana(p_rota_id int)
returns table (
  cliente_id int, codigo int, razao_social text, nome_fantasia text, cidade text, contato text, telefone text,
  local_entrega text, forma_pagamento text, ordem_visita int, resultado text, pedido_id bigint, total numeric, busca text
)
language sql stable security definer set search_path = public as $$
  select c.id, c.codigo, c.razao_social, c.nome_fantasia, c.cidade, c.contato, c.telefone, c.local_entrega, c.forma_pagamento,
         rc.ordem_visita, cc.resultado, p.id, p.total,
         normalizar(c.razao_social || ' ' || coalesce(c.nome_fantasia,'') || ' ' || coalesce(c.cidade,'') || ' ' || coalesce(c.contato,''))
  from rota_cliente rc
  join cliente c on c.id = rc.cliente_id and c.ativo and c.tipo = 'CLIENTE'
  left join semana_rota s on s.rota_id = rc.rota_id and s.status = 'ABERTA'
  left join contato_cliente cc on cc.semana_rota_id = s.id and cc.cliente_id = c.id
  left join pedido p on p.semana_rota_id = s.id and p.cliente_id = c.id and p.status <> 'EXCLUIDO'
  where rc.rota_id = p_rota_id
    and (eh_admin() or p_rota_id in (select minhas_rotas()))
  order by rc.ordem_visita
$$;

-- Rotas visíveis por papel (sobrescreve a view de 0001): administrador vê todas; vendedor só as suas
create or replace view v_rota_semana_aberta as
select r.id as rota_id, r.nome as rota, r.vendedor_id, v.nome as vendedor, v.telefone as vendedor_telefone,
       r.cidade_distribuicao_id, c.nome as cidade_distribuicao, r.intervalo_dias,
       s.id as semana_rota_id, s.data_entrega,
       (s.data_entrega + r.intervalo_dias) as proxima_semana
from rota r
join cidade_distribuicao c on c.id = r.cidade_distribuicao_id
left join vendedor v on v.id = r.vendedor_id
left join semana_rota s on s.rota_id = r.id and s.status = 'ABERTA'
where r.ativa and (eh_admin() or r.id in (select minhas_rotas()));
