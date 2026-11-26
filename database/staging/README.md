# EPI Guard SaaS — Fase 1 (somente local/staging)

**Não aplique estes scripts ao banco conectado à operação In-Haus.** Eles ficam deliberadamente fora de `drizzle/migrations/` e `supabase/migrations/` para não serem aplicados automaticamente.

## Migrations, em ordem

1. `migrations/001_organizations_and_tenant.sql`
   - Cria `organizations`, `organization_members` e `migration_control`.
   - Cria resolução de tenant por membership, com `app_metadata.organization_id` validado e sem fallback para claim inválida.
   - Adiciona `organization_id` anulável às nove tabelas operacionais.
   - Adiciona FKs compostas, índices, unicidade por tenant e `movimentacoes.movimentacao_vinculada_id` 1:1.
   - Fotografa os 11 triggers operacionais originais.
2. `migrations/002_protected_backfill.sql`
   - Exige o LOGIN preexistente `epi_guard_backfill_worker`.
   - Protege INSERT/UPDATE durante a transição e limita o worker a `NULL -> bootstrap_organization_id`.
   - Executa lotes de 1 a 1000 linhas; cada chamada é uma transação independente no chamador.
3. `migrations/003_tenant_rpcs_and_links.sql`
   - Preserva as quatro assinaturas públicas existentes.
   - Implementa locks na ordem colaborador → EPIs ordenados por UUID → movimentações.
   - Valida JSONB, duplicidades, tenant, vínculo, estoque e posse.
   - Revoga INSERT/UPDATE/DELETE diretos de `movimentacoes` para `authenticated` e `anon`; o fluxo existente continua pelas RPCs.
4. `migrations/004_finalize_tenant.sql`
   - Exige zero pendências, valida todas as FKs e aplica `NOT NULL`.
   - Substitui a unicidade global de matrícula/configuração pela equivalente por organização.
   - Remove os nove `trg_tmp_*`, confirma os 11 triggers originais e instala RLS restritiva por tenant.
   - Revoga o acesso do worker às funções de backfill e mantém onboarding fechado.

## Teste local real

Pré-requisitos: PostgreSQL 17 com `initdb`, `pg_ctl`, `psql`, Python 3 e `setpriv`.

```bash
bash database/staging/tests/run.sh
```

O runner usa somente o socket `/tmp/epi-guard-pg`, porta `55432` e o banco descartável `epi_guard_test`. Ele apaga e recria **somente esse banco local**, aplica as migrations históricas do projeto e utiliza dados fictícios. Não lê credenciais nem se conecta ao Supabase.

Resultado da última execução: **112 asserções aprovadas, 0 reprovadas**. O log está em `tests/results.log` e o resumo em `RESULTS.md`.

## Aplicação futura em Supabase staging independente

1. Provisione um Supabase staging separado e restaure nele o schema/dados que serão homologados.
2. Um administrador privilegiado do staging deve criar o LOGIN `epi_guard_backfill_worker` com senha forte fora do repositório, `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE` e sem `BYPASSRLS`. A migration não executa `CREATE ROLE`: o usuário de inspeção do banco conectado tem `rolcreaterole=false` e não há evidência de que outro ambiente permita essa operação.
3. Aplique as migrations históricas e depois `001`, `002` e `003` no staging.
4. Cadastre a organização real In-Haus, configure `migration_control.bootstrap_organization_id` e cadastre os memberships correspondentes. Não use a organização fictícia dos testes.
5. Conecte diretamente com o LOGIN do worker e execute uma chamada por lote, com autocommit:

```sql
SELECT public.executar_backfill_lote('colaboradores', 500);
SELECT public.executar_backfill_lote('epis', 500);
SELECT public.executar_backfill_lote('movimentacoes', 500);
SELECT public.executar_backfill_lote('inventarios', 500);
SELECT public.executar_backfill_lote('inventario_itens', 500);
SELECT public.executar_backfill_lote('compras_config', 500);
SELECT public.executar_backfill_lote('pedidos_compra', 500);
SELECT public.executar_backfill_lote('compras_ajustes', 500);
SELECT public.executar_backfill_lote('colaborador_tamanhos', 500);
SELECT public.backfill_pending_counts();
```

Repita cada tabela até retornar zero. Não envolva chamadas de vários lotes em uma única transação.
6. Somente depois de reconciliar tudo, aplique `004_finalize_tenant.sql` e repita os testes no staging.

A identidade usa `session_user`, preservada dentro de `SECURITY DEFINER`; `SET ROLE` não basta para se tornar worker. Nenhum GUC ou parâmetro do cliente é aceito como prova.

## Compatibilidade e regras relevantes

- O fluxo atual, sem `organization_id` no payload, recebe a única organização autenticada no INSERT. Com múltiplas memberships, o claim é obrigatório.
- `registrar_entrega_multipla` continua recebendo os mesmos cinco parâmetros e retornando `integer`.
- O mesmo EPI não pode aparecer duas vezes no lote. Tamanhos diferentes do mesmo item-base são permitidos; entregas do próprio lote não viram item anterior e trocas já gravadas abatem o saldo antigo.
- Entrega e troca/devolução são ligadas por UUID e FK composta, não por texto ou timestamp.
- Registros legados não recebem vínculos inventados. A exclusão de uma entrega antiga sem vínculo é bloqueada se houver movimentação candidata na mesma data; a reconciliação manual exige confirmação humana do par correto.
- A edição recalcula a troca por `LEAST(nova_quantidade, saldo_anterior)`. A exclusão reverte os mesmos efeitos do trigger de estoque: entrega e ajustes/devoluções têm sinais invertidos; `troca` não movimenta estoque físico.
- As quatro rotinas de posse usam o mesmo protocolo de locks. Entradas e ajustes de inventário não alteram posse de colaborador e continuam usando o lock de EPI do trigger. Escritas diretas por cliente em `movimentacoes` foram fechadas para não contornar o protocolo.

## O que ainda depende de Supabase staging

- Provisionamento e conexão direta do papel customizado do worker no ambiente Supabase.
- Proprietários reais das funções `SECURITY DEFINER`, grants/default ACLs e comportamento de PostgREST/RLS com o JWT emitido pelo Supabase.
- Aplicação das policies restritivas sobre uma cópia real dos dados e teste do aplicativo autenticado.
- Renovação de sessão/claims, limpeza de cache na troca de organização e liberação de uma segunda organização; nenhuma dessas ativações pertence a esta fase.
- Medição de duração de locks e carga com o volume real. Os testes locais não tornam a migração pronta para produção.
