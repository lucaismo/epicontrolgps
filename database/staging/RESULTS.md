# Evidências — Fase 1 local

## Ambiente

- PostgreSQL local/descartável: **17.12**.
- Banco conectado da In-Haus consultado somente em leitura: **17.6**.
- Instalação local criada a partir de todas as migrations existentes em `supabase/migrations/` e `drizzle/migrations/`, seguida das quatro migrations desta fase.
- Dados e organizações usados nos testes são fictícios e existem somente no banco local.

## Resultado final

- **112 asserções PostgreSQL aprovadas**.
- **44 testes unitários existentes aprovados** (`bun test`, 5 arquivos, 95 expectativas).
- **0 falhas nas execuções finais**.
- Comandos: `bash database/staging/tests/run.sh` e `bun test`.
- Logs completos: `tests/results.log` e `tests/unit-results.log`.
- `bunx vitest run` também foi tentado, mas não é compatível com os imports `bun:test` já existentes; a execução correta com Bun aprovou todos os testes.

## Cobertura executada

- Instalação limpa e ordem das migrations.
- Rejeição da finalização com `organization_id` NULL, com rollback das nove colunas e dos triggers temporários.
- Backfill em lotes de duas linhas e depois em lotes maiores, com autocommit e zero pendências.
- Identidade por `session_user`; `SET ROLE` não assume o worker e usuário autenticado não executa backfill.
- `app_metadata` e `organization_id` com tipos inválidos negados sem fallback; membership única funciona e múltiplas memberships exigem claim.
- INSERT sem tenant no fluxo atual, UPDATE comum permitido e mudança de tenant bloqueada.
- RLS negativa nas nove tabelas entre duas organizações locais; mesma matrícula permitida em organizações diferentes.
- FKs compostas rejeitam EPI e colaborador cruzados.
- Quatro assinaturas públicas e retorno `integer` da entrega múltipla confirmados pelo catálogo.
- Payload não array, EPI duplicado, quantidade fracionária e EPI de outro tenant rejeitados sem alterar estoque.
- Dois tamanhos do mesmo item-base: duas entregas, uma única troca do item anterior e nenhuma troca da entrega criada no próprio lote.
- Edição de quantidade/EPI, exclusão, RPC atômica, reversão de estoque e restauração de posse.
- Técnico impedido de editar/excluir; vínculo 1:1 e `ON DELETE RESTRICT` verificados.
- Histórico ambíguo preservado e bloqueado para exclusão até reconciliação explícita.
- Auditoria de INSERT/UPDATE/DELETE preservada.
- Duas entregas concorrentes no mesmo colaborador: sem deadlock, duas entregas, uma troca e estoque 18.
- Duas RPCs atômicas com pares de EPIs em ordem inversa: sem deadlock, estoques 17/18 e posse reconciliada.
- Nenhum `trg_tmp_*` restante; 11 triggers originais com mesma tabela, função, estado e definição.

## Falhas encontradas durante o desenvolvimento e corrigidas

- O `BEFORE UPDATE` apresenta a coluna gerada `inventario_itens.diferenca` como NULL; a comparação do worker passou a excluir somente essa coluna gerada, além de `organization_id` e `updated_at` automático.
- PostgreSQL não possui `min(uuid)`; a membership única passou a usar `min(organization_id::text)::uuid`.
- Uma mensagem `RAISE` com `%` sem argumento foi corrigida.
- Expectativas da massa de Luva foram ajustadas ao saldo histórico inicial de 49.
- O runner Python passou a usar saída `psql -t -A` para não confundir `(1 row)` com valor.
- Permissões dos papéis no esquema de asserções foram corrigidas. Nenhuma dessas falhas permaneceu na execução final.

## Limites

Os testes são reais de integração PostgreSQL, mas não substituem homologação em Supabase staging. Não validam PostgREST, JWT emitido pelo Supabase, proprietários/grants específicos desse serviço, conexão do papel customizado do worker nem carga com o volume In-Haus.
