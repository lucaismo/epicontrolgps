#!/usr/bin/env bash
set -euo pipefail
# Todas as variáveis PG*, serviços, passwords e credenciais Cloud são descartadas.
# A segunda execução ocorre com um ambiente mínimo, sem ler .env ou pg_service.conf.
if [[ "${C2_HERMETIC:-}" != 1 ]]; then
  exec env -i PATH="$PATH" HOME=/tmp C2_HERMETIC=1 /bin/bash "${BASH_SOURCE[0]}" "$@"
fi
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD PGPASSFILE PGSERVICE PGSERVICEFILE PGOPTIONS
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
readonly DIR=/tmp/epi-c2-pg PORT=55433 DB=epi_c2_staging USER=lovable
[[ "$DIR" == /tmp/epi-c2-pg && "$PORT" == 55433 && "$DB" == epi_c2_staging ]] || exit 1
[[ "$#" == 0 || ( "$#" == 1 && "$1" == --check-only ) ]] || { echo 'C2: argumentos de conexão não permitidos' >&2; exit 1; }
[[ ! -L "$DIR" && ! -L /tmp ]] || { echo 'C2: diretório simbólico rejeitado' >&2; exit 1; }
if [[ -e "$DIR" ]]; then
  [[ -d "$DIR" && "$(realpath "$DIR")" == "$DIR" && "$(stat -c %u "$DIR")" == 1000 ]] || { echo 'C2: diretório inválido' >&2; exit 1; }
fi
if [[ "${1:-}" == --check-only ]]; then
  echo 'ALLOWLIST OK: socket=/tmp/epi-c2-pg porta=55433 diretório=/tmp/epi-c2-pg/data banco=epi_c2_staging; TCP desativado'
  exit 0
fi
for tool in initdb pg_ctl psql createdb setpriv python3 flock; do
  command -v "$tool" >/dev/null || { echo "C2: ferramenta ausente: $tool" >&2; exit 1; }
done
install -d -o 1000 -g 1000 -m 700 "$DIR"
exec 9>"$DIR/runner.lock"
flock -n 9 || { echo 'C2: outro runner está ativo' >&2; exit 1; }
[[ ! -e "$DIR/data" && ! -e "$DIR/.s.PGSQL.$PORT" ]] || { echo 'C2: cluster preexistente rejeitado; inspecione antes de removê-lo' >&2; exit 1; }
: > "$DIR/results.log"
exec > >(tee -a "$DIR/results.log") 2>&1
started=0
cleanup() {
  code=$?
  if [[ "$started" == 1 ]]; then
    if setpriv --reuid=1000 --regid=1000 --clear-groups pg_ctl -D "$DIR/data" -m fast -w stop; then
      # Caminho fixo, validado; nenhum rm/drop em conexão externa.
      [[ "$DIR" == /tmp/epi-c2-pg && ! -L "$DIR/data" ]] && rm -rf -- "$DIR/data"
    else
      echo 'C2: falha ao parar o cluster; dados preservados para inspeção' >&2
      code=1
    fi
  fi
  exit "$code"
}
trap cleanup EXIT
setpriv --reuid=1000 --regid=1000 --clear-groups initdb -D "$DIR/data" --username="$USER" --auth=trust --no-locale > "$DIR/initdb.log"
setpriv --reuid=1000 --regid=1000 --clear-groups pg_ctl -D "$DIR/data" -o "-k $DIR -p $PORT -c listen_addresses='' -c unix_socket_permissions=0700" -l "$DIR/postgres.log" -w start
started=1
PSQL=(psql -X -h "$DIR" -p "$PORT" -U "$USER" -v ON_ERROR_STOP=1)
# Primeiro comando é somente leitura: confirma servidor/socket/data dir ANTES do createdb.
actual="$("${PSQL[@]}" -d postgres -Atc "SELECT current_database() || '|' || current_setting('port') || '|' || current_setting('data_directory') || '|' || current_setting('unix_socket_directories') || '|' || current_setting('listen_addresses') || '|' || (inet_server_addr() IS NULL)::text;")"
[[ "$actual" == 'postgres|55433|/tmp/epi-c2-pg/data|/tmp/epi-c2-pg||true' ]] || { echo 'C2: servidor fora da lista de permissões' >&2; exit 1; }
createdb -h "$DIR" -p "$PORT" -U "$USER" "$DB"
PSQL+=(-d "$DB")
actual="$("${PSQL[@]}" -Atc 'SELECT current_database();')"
[[ "$actual" == "$DB" ]] || exit 1
echo "ISOLAMENTO VALIDADO: $DIR | $PORT | $DB | TCP desativado"
"${PSQL[@]}" -q -f "$ROOT/database/staging/tests/bootstrap_supabase_compat.sql" > /dev/null
for f in "$ROOT"/supabase/migrations/*.sql "$ROOT"/drizzle/migrations/*.sql; do
  "${PSQL[@]}" -q -f "$f" > /dev/null
done
"${PSQL[@]}" -q -f "$ROOT/database/staging/tests/seed_legacy.sql" > /dev/null
"${PSQL[@]}" -q -f "$ROOT/database/staging/c2_corrections/seed_c2.sql" > /dev/null
"${PSQL[@]}" -q -f "$ROOT/database/staging/tests/test_helpers.sql" > /dev/null
python3 "$ROOT/database/staging/tests/test_c2.py" --snapshot "$DIR/before.json"
"${PSQL[@]}" -q -f "$ROOT/database/staging/c2_corrections/01_containment_rpcs.sql"
# Reaplicação valida idempotência sem recriar funções ou mudar o contrato.
"${PSQL[@]}" -q -f "$ROOT/database/staging/c2_corrections/01_containment_rpcs.sql"
python3 "$ROOT/database/staging/tests/test_c2.py"
python3 "$ROOT/database/staging/tests/test_c2_boundary.py" --snapshot-before
"${PSQL[@]}" -q -f "$ROOT/database/staging/c2_corrections/02_epis_grants_movimentacoes.sql"
python3 "$ROOT/database/staging/tests/test_c2_boundary.py" --snapshot-first
"${PSQL[@]}" -q -f "$ROOT/database/staging/c2_corrections/02_epis_grants_movimentacoes.sql"
python3 "$ROOT/database/staging/tests/test_c2_boundary.py"
echo 'APROVADO — Etapas 1 e 2 somente locais; cluster será parado e descartado'
