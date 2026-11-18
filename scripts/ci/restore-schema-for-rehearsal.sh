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

# The standby's pure helpers (role parsing and pre-creation), pointed at this container.
# shellcheck source=../../server/standby/standby-engine.sh
. "$ROOT/server/standby/standby-engine.sh"
DB_CONTAINER="$NAME"
LOG_DIR="$WORKDIR"
STATE_DIR="$WORKDIR"
log() { echo "[rehearsal-restore] $*" >&2; }

# The image asks supabase_admin for a password even on its local socket, and
# every psql_db and pg_restore below is a `docker exec` as supabase_admin.
# `docker exec` inherits the container environment, so PGPASSWORD set here
# reaches every one of them; without it each call stopped at
# "Password for user supabase_admin:" and failed with fe_sendauth (every
# migration-bearing pull request since this rehearsal was added, 2026-11-18).
REHEARSAL_PASSWORD=rehearsal-only
docker run -d --name "$NAME" -e POSTGRES_PASSWORD="$REHEARSAL_PASSWORD" -e PGPASSWORD="$REHEARSAL_PASSWORD" "$IMAGE" >/dev/null
for _ in $(seq 1 90); do
  docker exec "$NAME" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && break
  sleep 2
done
docker exec "$NAME" pg_isready -U postgres -h 127.0.0.1 >/dev/null
# The image's init scripts run after the first ready answer; wait for its roles.
for _ in $(seq 1 60); do
  psql_db -Atc "select 1 from pg_roles where rolname='service_role'" 2>/dev/null | grep -qx 1 && break
  sleep 2
done

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
docker exec "$NAME" pg_restore -U supabase_admin -d postgres --no-owner --exit-on-error \
  --use-list /tmp/restore.list --schema-only /tmp/schema.dump > "$WORKDIR/restore.log" 2>&1 \
  || { tail -20 "$WORKDIR/restore.log" >&2; exit 1; }
docker cp "$ROOT/server/standby/standby-owners.sql" "$NAME:/tmp/owners.sql"
docker exec "$NAME" psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -q -f /tmp/owners.sql >> "$WORKDIR/restore.log" 2>&1
psql_db -qc "DELETE FROM cron.job" >/dev/null
tables=$(psql_db -Atc "select count(*) from pg_tables where schemaname='public'")
functions=$(psql_db -Atc "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where nspname='public'")
log "restored: $tables public tables, $functions public functions"
[ "$tables" -gt 100 ] && [ "$functions" -gt 100 ] || { log 'restore produced an implausibly small schema'; exit 1; }
