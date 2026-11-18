#!/usr/bin/env bash
# Restore production's schema-only archive into a THROWAWAY supabase/postgres
# container on this runner, for the window-migration rehearsal. It follows the
# Backup standby's own restore (server/standby/standby-engine.sh cmd_restore):
# the same application schemas, extensions, expected roles, referenced-role
# pre-creation, table-of-contents filter and production ownership. No seed,
# no data, no production connection: the archive is the only input.
#
# Usage: restore-schema-for-rehearsal.sh <schema.dump> <container-name>
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DUMP="${1:?schema.dump}"
NAME="${2:?container name}"
IMAGE='supabase/postgres:17.6.1.063'
WORKDIR="${RUNNER_TEMP:-/tmp}/rehearsal-restore"
mkdir -p "$WORKDIR"
# The image's own init (migrations/db/migrate.sh, copied to
# /docker-entrypoint-initdb.d) runs ALTER USER supabase_admin WITH PASSWORD
# '$POSTGRES_PASSWORD', and its pg_hba.conf asks supabase_admin for that
# password on the local socket ("local all supabase_admin scram-sha-256"),
# while every other role on the socket is peer-mapped. Every supabase_admin
# call below therefore carries it. Until 2026-11-18 none did: psql_db (from
# the standby, whose host supplies the password itself) prompted, the
# readiness loop swallowed "fe_sendauth: no password supplied" for 120 s and
# the first real call failed, so every rehearsal since 13:03 UTC exited 2
# (incident 075013fd).
REHEARSAL_DB_PASSWORD="${REHEARSAL_DB_PASSWORD:-rehearsal-only}"

# The standby's pure helpers (role parsing and pre-creation), pointed at this container.
# shellcheck source=../../server/standby/standby-engine.sh
. "$ROOT/server/standby/standby-engine.sh"
DB_CONTAINER="$NAME"
LOG_DIR="$WORKDIR"
STATE_DIR="$WORKDIR"
log() { echo "[rehearsal-restore] $*" >&2; }
# This copy's own psql_db: the standby's, with this container's password.
# The standby's definition is untouched on the Backup host.
psql_db() { docker exec -i -e PGPASSWORD="$REHEARSAL_DB_PASSWORD" "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres "$@"; }
admin_exec() { docker exec -e PGPASSWORD="$REHEARSAL_DB_PASSWORD" "$NAME" "$@"; }

docker run -d --name "$NAME" -e POSTGRES_PASSWORD="$REHEARSAL_DB_PASSWORD" "$IMAGE" >/dev/null
for _ in $(seq 1 90); do
  docker exec "$NAME" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && break
  sleep 2
done
docker exec "$NAME" pg_isready -U postgres -h 127.0.0.1 >/dev/null
# The image's init scripts run after the first ready answer; wait for its roles.
# A refused connection is not "not ready yet" forever: the last answer is kept
# and printed if the roles never appear, so the real error reaches the log.
ready=''
for _ in $(seq 1 60); do
  if answer=$(psql_db -Atc "select 1 from pg_roles where rolname='service_role'" 2>&1) && [ "$answer" = 1 ]; then
    ready=1
    break
  fi
  sleep 2
done
if [ -z "$ready" ]; then
  log "the copy never answered as supabase_admin with its roles in place; last answer: $answer"
  exit 1
fi

for s in "${APP_SCHEMAS[@]}"; do psql_db -qc "DROP SCHEMA IF EXISTS \"$s\" CASCADE" >/dev/null; done
psql_db -qc 'CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;' >/dev/null
for ext in "pg_trgm SCHEMA public" "vector SCHEMA public" "postgis SCHEMA extensions" "dblink SCHEMA extensions" \
           "pgstattuple SCHEMA extensions" "plpgsql_check SCHEMA extensions" "http SCHEMA extensions"; do
  psql_db -qc "CREATE EXTENSION IF NOT EXISTS ${ext%% *} WITH ${ext#* }" >/dev/null
done
psql_db -qc 'CREATE EXTENSION IF NOT EXISTS pg_cron' >/dev/null
for role in "${EXPECTED_RESTORE_ROLES[@]}"; do
  psql_db -qc "DO \$\$ BEGIN CREATE ROLE $role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$" >/dev/null
done

# auth.users as production has it (see rehearsal-auth-users-columns.txt).
grep -vE '^(#|$)' "$ROOT/scripts/ci/rehearsal-auth-users-columns.txt" \
  | sed -E 's/^([a-z_]+) (.+)$/ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS \1 \2;/' \
  | psql_db -q >/dev/null
docker cp "$DUMP" "$NAME:/tmp/schema.dump"
docker exec "$NAME" pg_restore --list /tmp/schema.dump > "$WORKDIR/toc.list"
awk '$4 == "SCHEMA" && $5 == "-" && $6 == "public" { print ";" $0; found++; next }
     { print } END { if (found != 1) exit 1 }' "$WORKDIR/toc.list" > "$WORKDIR/restore.list"
awk '!/^;/ && ($4 == "ACL" || ($4 == "DEFAULT" && $5 == "ACL") || $4 == "POLICY")' "$WORKDIR/restore.list" > "$WORKDIR/roles.list"
: > "$WORKDIR/roles.sql"
if [ -s "$WORKDIR/roles.list" ]; then
  docker cp "$WORKDIR/roles.list" "$NAME:/tmp/roles.list"
  docker exec "$NAME" pg_restore --use-list /tmp/roles.list --schema-only -f - /tmp/schema.dump > "$WORKDIR/roles.sql"
fi
precreate_referenced_roles "$WORKDIR/roles.sql"
docker cp "$WORKDIR/restore.list" "$NAME:/tmp/restore.list"
if ! admin_exec pg_restore -U supabase_admin -d postgres --no-owner --exit-on-error \
  --use-list /tmp/restore.list --schema-only /tmp/schema.dump > "$WORKDIR/restore.log" 2>&1; then
  # The first error alone hides the rest, so one run names them all.
  log "the restore stopped at its first error:"
  grep -m1 -A2 -E 'ERROR:' "$WORKDIR/restore.log" >&2 || tail -20 "$WORKDIR/restore.log" >&2
  # Everything before the stop is already in place; carry on past every error
  # and list the ones that are not just "already exists".
  admin_exec pg_restore -U supabase_admin -d postgres --no-owner \
    --use-list /tmp/restore.list --schema-only /tmp/schema.dump > "$WORKDIR/restore-diagnosis.log" 2>&1 || true
  grep -E 'ERROR:' "$WORKDIR/restore-diagnosis.log" | grep -v 'already exists' \
    | sed -E 's/^.*ERROR: +//' | sort | uniq -c | sort -rn > "$WORKDIR/restore-errors.txt" || true
  log "every other error in a full restore ($(wc -l < "$WORKDIR/restore-errors.txt") distinct):"
  head -60 "$WORKDIR/restore-errors.txt" >&2
  exit 1
fi
docker cp "$ROOT/server/standby/standby-owners.sql" "$NAME:/tmp/owners.sql"
admin_exec psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -q -f /tmp/owners.sql >> "$WORKDIR/restore.log" 2>&1
psql_db -qc "DELETE FROM cron.job" >/dev/null
tables=$(psql_db -Atc "select count(*) from pg_tables where schemaname='public'")
functions=$(psql_db -Atc "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where nspname='public'")
log "restored: $tables public tables, $functions public functions"
[ "$tables" -gt 100 ] && [ "$functions" -gt 100 ] || { log 'restore produced an implausibly small schema'; exit 1; }
