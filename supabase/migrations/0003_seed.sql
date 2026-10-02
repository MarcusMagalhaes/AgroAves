-- AgroAves 2.0 — dados básicos (produtos, cidades, fornecedor padrão)
-- Produtos conforme Cad Produtos da Admin (confirmado 01/10/2026, D-05)

insert into cidade_distribuicao (nome) values ('IPATINGA'), ('REALEZA'), ('VIÇOSA')
on conflict (nome) do nothing;

insert into fornecedor (nome) values ('Granja')
on conflict (nome) do nothing;

insert into produto (sigla, nome, grupo, ordem, preco_compra, tem_preco, conta_como_ave, eh_codorna) values
('COR',  'Pintos Corte',               'CORTE',      1,  3.50,  true, true,  false),
('PP',   'Pescoço Pelado Vermelho',    'CAIPIRA',    2,  3.20,  true, true,  false),
('CJ',   'Carijó',                     'CAIPIRA',    3,  3.20,  true, true,  false),
('P.S',  'Pesadão',                    'CAIPIRA',    4,  3.20,  true, true,  false),
('MS',   'Mesclado',                   'CAIPIRA',    5,  3.20,  true, true,  false),
('PJ',   'Carijó Pescoço Pelado',      'CAIPIRA',    6,  3.20,  true, true,  false),
('GC',   'Grand Cinza',                'CAIPIRA',    7,  3.20,  true, true,  false),
('NGR',  'Caipira Negro',              'CAIPIRA',    8,  3.20,  true, true,  false),
('PV',   'Postura Vermelha',           'POSTURA',    9,  5.70,  true, true,  false),
('PN',   'Postura Negra',              'POSTURA',   10,  5.70,  true, true,  false),
('CRE',  'Postura Creme',              'POSTURA',   11,  6.80,  true, true,  false),
('PB',   'Postura Branca',             'POSTURA',   12,  5.70,  true, true,  false),
('AZU',  'Postura Azul',               'POSTURA',   13,  6.80,  true, true,  false),
('VER',  'Postura Verde',              'POSTURA',   14,  6.80,  true, true,  false),
('CIN',  'Postura Cinza',              'POSTURA',   15,  6.80,  true, true,  false),
('PC',   'Postura Chocolate',          'POSTURA',   16,  6.80,  true, true,  false),
('CDN',  'Codornas',                   'EXOTICOS',  17,  6.00,  true, true,  true),
('ANG1', 'Angola 8 dias',              'EXOTICOS',  18, 13.00,  true, true,  false),
('ANG2', 'Angola 16 dias',             'EXOTICOS',  19, 14.90,  true, true,  false),
('IND1', 'Índio 8 dias',               'EXOTICOS',  20, 19.90,  true, true,  false),
('IND2', 'Índio 15 dias',              'EXOTICOS',  21, 24.90,  true, true,  false),
('MAR1', 'Marreco de Pequim 16 dias',  'EXOTICOS',  22, 12.00,  true, true,  false),
('MAR2', 'Marreco de Pequim 8 dias',   'EXOTICOS',  23, 15.00,  true, true,  false),
('BRH1', 'Pintos Brahma 8 dias',       'EXOTICOS',  24, 10.00,  true, true,  false),
('BRH2', 'Pintos Brahma 1 dia',        'EXOTICOS',  25, 11.90,  true, true,  false),
('VIVC', 'Viveiro Com Pé',             'ACESSORIOS',26, 256.12, true, false, false),
('VIVS', 'Viveiro Sem Pé',             'ACESSORIOS',27, 219.14, true, false, false)
on conflict (sigla) do nothing;

-- Administradores: markvpm@gmail.com (ADMIN_TI, ver 0006) e agroavesdistribuidora10@gmail.com — basta entrar com Google; o gatilho em auth.users cria o registro como ADMIN.
-- Se o usuário já existia em auth.users antes do gatilho, rode:
-- insert into usuario (id, nome, email, papel) select id, 'Marcus', email, 'ADMIN' from auth.users where lower(email) in ('markvpm@gmail.com','agroavesdistribuidora10@gmail.com') on conflict (id) do nothing;
