-- Cor de cada produto (coluna inteira na programação, mapa e impressões). Padrão por categoria.
alter table produto add column if not exists cor text;

update produto set cor = case grupo
  when 'CORTE' then '#f5a623'
  when 'CAIPIRA' then '#3fb663'
  when 'POSTURA' then '#4a7fd6'
  when 'EXOTICOS' then '#a855f7'
  when 'ACESSORIOS' then '#94a3b8'
  else '#cbd5e1' end
where cor is null;
