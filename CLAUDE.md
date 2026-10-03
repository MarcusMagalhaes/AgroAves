# AgroAves — memória do projeto

Sistema de vendas semanais de aves por rotas: React + Vite + Tailwind (front estático no Cloudflare) e Supabase
(Postgres, Auth, Storage). Visão geral, fluxo semanal e estrutura em `README.md`.

- Idioma: código, comentários, commits e respostas em **português**.
- Front: `npm run typecheck` / `npm run build` na raiz. Migrações SQL em `supabase/migrations/` (numeradas).

## Emissor próprio de NF-e (em andamento)

Detalhes e passo a passo em `nfe/CLAUDE.md` e `nfe/README.md`. Resumo das decisões:

- **Objetivo:** emitir NF-e de dentro do AgroAves, eliminando a digitação manual semanal e a mensalidade do emissor
  que o cliente paga hoje.
- **Decisão (Plano B):** emissor **próprio**, sem plataforma terceira paga (Focus NFe, PlugNotas etc. foram descartados
  por custo mensal). O AgroAves monta o XML, assina com o certificado A1 e transmite direto à SEFAZ-MG.
- **Estado:** protótipo por linha de comando em `nfe/`, **travado em homologação** (sem valor fiscal). Ainda não ligado às telas.
- **Próximo passo:** o usuário rodar o teste real em homologação pelo Claude Code Desktop, na máquina que tem o certificado.
