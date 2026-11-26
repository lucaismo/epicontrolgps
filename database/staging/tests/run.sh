#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PGDIR="${EPG_DIR:-/tmp/epi-guard-pg}"
export PGHOST="$PGDIR"
export PGPORT="${EPG_PORT:-55432}"
export PGDATABASE="epi_guard_test"
export PGUSER="lovable"
LOG="$PGDIR/results.log"

if ! pg_isready -q; then
  if [[ ! -d "$PGDIR/data" ]]; then
    install -d -o 1000 -g 1000 "$PGDIR"
    setpriv --reuid=1000 --regid=1000 --clear-groups initdb -D "$PGDIR/data" --auth=trust --no-locale >"$PGDIR/initdb.log"
  fi
  setpriv --reuid=1000 --regid=1000 --clear-groups pg_ctl -D "$PGDIR/data" -o "-k $PGDIR -p $PGPORT" -l "$PGDIR/postgres.log" start >/dev/null
fi

mkdir -p "$PGDIR"
: >"$LOG"
exec > >(tee -a "$LOG") 2>&1
trap 'echo "FALHA — veja $LOG"; exit 1' ERR

echo "== Instalação limpa =="
dropdb --if-exists "$PGDATABASE"
createdb "$PGDATABASE"
psql -q -v ON_ERROR_STOP=1 -f "$ROOT/database/staging/tests/bootstrap_supabase_compat.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql "$ROOT"/drizzle/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done
psql -q -v ON_ERROR_STOP=1 -f "$ROOT/database/staging/tests/seed_legacy.sql" >/dev/null
psql -q -v ON_ERROR_STOP=1 -f "$ROOT/database/staging/tests/test_helpers.sql" >/dev/null

echo "== Migrations SaaS 001–003 =="
for f in 001_organizations_and_tenant.sql 002_protected_backfill.sql 003_tenant_rpcs_and_links.sql; do
  psql -q -v ON_ERROR_STOP=1 -f "$ROOT/database/staging/migrations/$f" >/dev/null
done
psql -q -v ON_ERROR_STOP=1 -f "$ROOT/database/staging/tests/setup_initial_org.sql" >/dev/null
psql -v ON_ERROR_STOP=1 -f "$ROOT/database/staging/tests/test_transition.sql" >/dev/null

echo "== Finalização deve falhar com pendências e fazer rollback =="
if psql -1 -q -v ON_ERROR_STOP=1 -f "$ROOT/database/staging/migrations/004_finalize_tenant.sql" >"$PGDIR/finalize-rejected.log" 2>&1; then
  echo "FALHA: finalização aceitou organization_id NULL"; exit 1
fi
psql -v ON_ERROR_STOP=1 -c "SELECT test.ok(true, 'Finalização com organization_id NULL é rejeitada');" >/dev/null
psql -v ON_ERROR_STOP=1 -c "SELECT test.eq((SELECT count(*)::text FROM information_schema.columns WHERE table_schema='public' AND column_name='organization_id' AND is_nullable='YES' AND table_name IN ('colaboradores','epis','movimentacoes','inventarios','inventario_itens','compras_config','pedidos_compra','compras_ajustes','colaborador_tamanhos')), '9', 'Rollback mantém as nove colunas anuláveis após finalização rejeitada');" >/dev/null
psql -v ON_ERROR_STOP=1 -c "SELECT test.eq((SELECT count(*)::text FROM pg_trigger WHERE tgname LIKE 'trg_tmp_%' AND NOT tgisinternal), '9', 'Rollback preserva triggers temporários até reconciliação');" >/dev/null

echo "== Backfill por worker, autocommit por lote =="
PGUSER="epi_guard_backfill_worker" psql -v ON_ERROR_STOP=1 -f "$ROOT/database/staging/tests/worker_backfill.sql" >/dev/null
psql -v ON_ERROR_STOP=1 -f "$ROOT/database/staging/tests/test_after_backfill.sql" >/dev/null

echo "== Finalização e testes de integração =="
psql -q -v ON_ERROR_STOP=1 -f "$ROOT/database/staging/migrations/004_finalize_tenant.sql" >/dev/null
psql -v ON_ERROR_STOP=1 -f "$ROOT/database/staging/tests/test_final.sql"
python3 "$ROOT/database/staging/tests/test_concurrency.py"

echo "== Resumo =="
psql -v ON_ERROR_STOP=1 -c "SELECT count(*) AS testes_aprovados FROM test.results;"
psql -v ON_ERROR_STOP=1 -c "SELECT c.relname, t.tgname, p.proname, t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname;"
echo "APROVADO — evidências em $LOG"
