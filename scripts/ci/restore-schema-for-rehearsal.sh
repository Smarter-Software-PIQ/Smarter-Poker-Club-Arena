#!/usr/bin/env bash
# Restore production's schema-only archive into a THROWAWAY supabase/postgres
# container on this runner, for the window-migration rehearsal. It follows the
# Backup standby's own restore (server/standby/standby-engine.sh cmd_restore):
# the same application schemas, extensions, expected roles, referenced-role
# pre-creation, table-of-contents filter and production ownership. No seed,
# no data, no production connection: the archive is the only input.
#
# Usage: restore-schema-for-rehearsal.sh <schema.dump> <container-name>
#        restore-schema-for-rehearsal.sh --self-test <container-name>
#
# AUTHENTICATION (2026-11-18). This image trusts the OS-mapped `postgres` role on
# its socket but requires a password for `supabase_admin`, even locally. Every
# command that connects as supabase_admin therefore carries PGPASSWORD; without it
# psql prompted, failed with fe_sendauth, and the role wait below swallowed that
# for two minutes. The image is pinned by digest so a re-pushed tag cannot change
# this behaviour under the rehearsal. --self-test starts the image and proves both
# roles connect, with no archive and no production input.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SELF_TEST=false
if [ "${1:-}" = '--self-test' ]; then SELF_TEST=true; DUMP=''; else DUMP="${1:?schema.dump}"; fi
NAME="${2:?container name}"
IMAGE='supabase/postgres:17.6.1.063@sha256:178f0976b54a39237096bfa310c1a352dbc82fb1b08dda45cdb8acb5d40c1426'
REHEARSAL_PGPASSWORD='rehearsal-only'
WORKDIR="${RUNNER_TEMP:-/tmp}/rehearsal-restore"
mkdir -p "$WORKDIR"

# The standby's pure helpers (role parsing and pre-creation), pointed at this container.
# shellcheck source=../../server/standby/standby-engine.sh
. "$ROOT/server/standby/standby-engine.sh"
DB_CONTAINER="$NAME"
LOG_DIR="$WORKDIR"
STATE_DIR="$WORKDIR"
log() { echo "[rehearsal-restore] $*" >&2; }
# The standby helper connects as supabase_admin without a password; this image needs one.
psql_db() { docker exec -i -e PGPASSWORD="$REHEARSAL_PGPASSWORD" "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres "$@"; }
admin_exec() { docker exec -e PGPASSWORD="$REHEARSAL_PGPASSWORD" "$NAME" "$@"; }

docker run -d --name "$NAME" -e POSTGRES_PASSWORD="$REHEARSAL_PGPASSWORD" "$IMAGE" >/dev/null
for _ in $(seq 1 90); do
  docker exec "$NAME" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && break
  sleep 2
done
docker exec "$NAME" pg_isready -U postgres -h 127.0.0.1 >/dev/null
# The image's init scripts run after the first ready answer; wait for its roles.
roles_ready=false
for _ in $(seq 1 60); do
  if psql_db -Atc "select 1 from pg_roles where rolname='service_role'" 2>"$WORKDIR/wait.err" | grep -qx 1; then
    roles_ready=true; break
  fi
  sleep 2
done
if [ "$roles_ready" != true ]; then
  log "the image never answered as supabase_admin with its roles; last error:"; cat "$WORKDIR/wait.err" >&2; exit 1
fi
if [ "$SELF_TEST" = true ]; then
  admin=$(psql_db -Atc 'select current_user')
  plain=$(docker exec -i -e PGPASSWORD="$REHEARSAL_PGPASSWORD" "$NAME" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -Atc 'select current_user')
  docker rm -f "$NAME" >/dev/null
  [ "$admin" = supabase_admin ] && [ "$plain" = postgres ] || { log "self-test: roles answered '$admin'/'$plain'"; exit 1; }
  log 'self-test: supabase_admin and postgres both connect'; exit 0
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
admin_exec pg_restore -U supabase_admin -d postgres --no-owner --exit-on-error \
  --use-list /tmp/restore.list --schema-only /tmp/schema.dump > "$WORKDIR/restore.log" 2>&1 \
  || { tail -20 "$WORKDIR/restore.log" >&2; exit 1; }
docker cp "$ROOT/server/standby/standby-owners.sql" "$NAME:/tmp/owners.sql"
admin_exec psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -q -f /tmp/owners.sql >> "$WORKDIR/restore.log" 2>&1
psql_db -qc "DELETE FROM cron.job" >/dev/null
tables=$(psql_db -Atc "select count(*) from pg_tables where schemaname='public'")
functions=$(psql_db -Atc "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where nspname='public'")
log "restored: $tables public tables, $functions public functions"
[ "$tables" -gt 100 ] && [ "$functions" -gt 100 ] || { log 'restore produced an implausibly small schema'; exit 1; }
