#!/usr/bin/env bash
# CLUB ARENA BACKUP ENGINE (owner order 2026-11-05).
#
# A 1:1 clone of the serving engine runs on its own Hetzner host
# (club-arena-engine-standby) against its own isolated database copy. Every
# engine change is built, booted and certified here first, all day, without
# touching the live engine. The 04:00 Chicago cutover accepts only a version
# this script has certified.
#
# Isolation is by construction, not by convention:
#   - the host holds NO production credential of any kind;
#   - the runtime network (supabase_network_standby) can reach private
#     addresses only (standby-egress-lock.service rejects everything else), so
#     neither the engine nor the database can call production or the internet;
#   - the host firewall admits SSH only.
#
# Commands (run as root on the standby host):
#   standby-engine.sh restore <schema.dump>   load the production structure
#   standby-engine.sh seed    <seed_dir>      load the horse-only platform seed
#   standby-engine.sh build   <sha>           build the exact engine image
#   standby-engine.sh run     <sha>           (re)start the Backup Engine
#   standby-engine.sh certify <sha> [soak_s]  build, boot, crash, soak, verdict
#   standby-engine.sh trial   <swap|break|table-kill|all> ...  simulations (standby-trials.sh)
#   standby-engine.sh status
set -Eeuo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=/opt/club-arena
DB_DIR=/opt/standby-db
STATE_DIR=/var/lib/club-arena-standby
CERT_DIR=$STATE_DIR/certificates
LOG_DIR=/var/log/club-arena-standby
SCHEMA_EVIDENCE_TOOL=$SCRIPT_DIR/schema-evidence.py
[ -f "$SCHEMA_EVIDENCE_TOOL" ] || SCHEMA_EVIDENCE_TOOL=/usr/local/share/club-arena-standby/schema-evidence.py
CONTAINER=club-arena-engine-standby
IMAGE_REPO=club-arena-engine-standby
NETWORK=supabase_network_standby
DB_CONTAINER=supabase_db_standby
KONG=http://supabase_kong_standby:8000
HOST_PORT=127.0.0.1:18080
APP_SCHEMAS=(public ca_archive discovery_private operational_source_intake ops ops_rollback smarter_private zz_archive)

die() { echo "standby-engine: $*" >&2; exit 1; }
log() { echo "[$(date -u +%FT%TZ)] $*" | tee -a "$LOG_DIR/standby.log" >&2; }
valid_sha() { [[ "$1" =~ ^[0-9a-f]{40}$ ]] || die "not a 40-hex sha: $1"; }

owners_file() {
  if [ -f "$SCRIPT_DIR/standby-owners.sql" ]; then
    printf '%s\n' "$SCRIPT_DIR/standby-owners.sql"
  else
    printf '%s\n' /usr/local/share/club-arena-standby/owners.sql
  fi
}

assert_isolated() {
  systemctl is-active -q standby-egress-lock || die 'egress lock is not active; refusing to run'
  iptables -C DOCKER-USER -s "$(docker network inspect "$NETWORK" -f '{{(index .IPAM.Config 0).Subnet}}')" -j REJECT 2>/dev/null \
    || die 'standby network can reach the internet; refusing to run'
  if docker run --rm --network "$NETWORK" curlimages/curl -s -m 4 -o /dev/null https://kuklfnapbkmacvwxktbh.supabase.co 2>/dev/null; then
    die 'production database host is reachable from the standby network; refusing to run'
  fi
}

psql_db() { docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres "$@"; }

assert_restore_quiet() {
  local running
  running=$(docker ps --format '{{.Names}}') || return 1
  if printf '%s\n' "$running" | grep -Fxq "$CONTAINER"; then
    log 'restore: standby restarted during restore/seed; refusing certification'
    return 1
  fi
}

stop_for_restore() {
  # Only this isolated container is stopped. An absent container is fine;
  # an unreadable Docker inventory or an unconfirmed stop is not.
  local containers
  containers=$(docker ps -a --format '{{.Names}}') || return 1
  if printf '%s\n' "$containers" | grep -Fxq "$CONTAINER"; then
    docker stop -t 60 "$CONTAINER" >/dev/null || return 1
    [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" = false ] || return 1
  fi
}

# Production roles the restore expects. Any other role the archive grants to
# is still created without login, and named in the log so it is added here.
EXPECTED_RESTORE_ROLES=(ca_ledger_refusal_recorder engine_lightning_fold engine_lightning_lane engine_lease_heartbeat supabase_backup_admin ca_record_gateway daily_content_reporter)

# Roles the production archive grants to, one raw token per line. Input is the
# SQL of its ACL, DEFAULT ACL and POLICY entries only (never a function body).
# A line this does not recognise names no role and restores exactly as before.
dump_referenced_roles() {
  local line list token ident='("([^"]|"")*"|[^ ".]+)'
  local grant_re='^GRANT .* TO (.+);$' revoke_re='^REVOKE .* FROM (.+);$'
  local default_re='^ALTER DEFAULT PRIVILEGES FOR ROLE ([^ ]+) .* (TO|FROM) (.+);$'
  local session_re="^SET SESSION AUTHORIZATION '?([^ ']+)'?;\$"
  local policy_re="^CREATE POLICY $ident ON $ident(\\.$ident)?( AS RESTRICTIVE)?( FOR [A-Z]+)? TO (.+)\$"
  while IFS= read -r line; do
    list=
    if [[ "$line" =~ $default_re ]]; then list="${BASH_REMATCH[1]}, ${BASH_REMATCH[3]}"
    elif [[ "$line" =~ $grant_re ]]; then list=${BASH_REMATCH[1]}
    elif [[ "$line" =~ $revoke_re ]]; then list=${BASH_REMATCH[1]}
    elif [[ "$line" =~ $session_re ]]; then list=${BASH_REMATCH[1]}
    elif [[ "$line" == 'CREATE POLICY '* ]]; then
      line=${line%% USING (*}; line=${line%% WITH CHECK (*}; line=${line%;}
      [[ "$line" =~ $policy_re ]] || continue
      list=${BASH_REMATCH[10]}
    else continue
    fi
    list=${list% WITH GRANT OPTION}
    list=${list// GRANTED BY /, }
    while [ -n "$list" ]; do
      token=${list%%, *}
      if [ "$token" = "$list" ]; then list=; else list=${list#*, }; fi
      case "$token" in PUBLIC|public|CURRENT_USER|CURRENT_ROLE|SESSION_USER|DEFAULT) ;; *) printf '%s\n' "$token";; esac
    done
  done | LC_ALL=C sort -u
}

# A role created in production outside this repository must not stop every
# engine release (2026-11-12: daily_content_reporter, five failed refreshes).
# Each role the archive grants to and the isolated copy lacks is created with
# no login, no password and no attribute, and named loudly so it gets listed.
precreate_referenced_roles() {
  local sql="$1" role existing expected known
  existing=$(psql_db -Atc 'select rolname from pg_roles') || return 1
  while IFS= read -r role; do
    [ -n "$role" ] || continue
    if ! [[ "$role" =~ ^[a-z_][a-z0-9_]{0,62}$ ]]; then
      log "restore: database_refresh_failed:unsafe_role_name:$(printf '%s' "$role" | LC_ALL=C tr -c 'A-Za-z0-9_' '?' | cut -c1-63) (the archive grants to a role name outside ^[a-z_][a-z0-9_]{0,62}\$; refusing to restore)"
      return 1
    fi
    if printf '%s\n' "$existing" | grep -Fxq -- "$role"; then continue; fi
    known=0
    for expected in "${EXPECTED_RESTORE_ROLES[@]}"; do [ "$expected" != "$role" ] || known=1; done
    psql_db -qc "CREATE ROLE $role NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS" >/dev/null \
      || { log "restore: database_refresh_failed:role_create_failed:$role"; return 1; }
    [ "$known" = 1 ] || log "restore: WARNING unlisted_role_auto_created:$role (production grants to a role standby-engine.sh does not list; created NOLOGIN with no attributes; add it to EXPECTED_RESTORE_ROLES)"
  done < <(dump_referenced_roles < "$sql")
}

# One-step diagnosis when the archive still names a role the copy lacks.
log_restore_missing_role() {
  local role
  role=$(sed -n 's/.*role "\([a-z_][a-z0-9_]*\)" does not exist.*/\1/p' "$LOG_DIR/restore.log" 2>/dev/null | head -n 1) || return 0
  [ -z "$role" ] || log "restore: database_refresh_failed:missing_role:$role"
}

cmd_restore() {
  local dump="$1"; [ -s "$dump" ] || die "missing dump $dump"
  assert_isolated || return 1
  stop_for_restore || return 1
  rm -f "$STATE_DIR/database.json" "$STATE_DIR/seed.json" || return 1
  python3 -B "$SCHEMA_EVIDENCE_TOOL" verify-dump "$STATE_DIR/schema-evidence.json" "$dump" >/dev/null || return 1
  log "restore: dropping app schemas and loading $(basename "$dump")"
  # Database-level event triggers depend on public functions; drop them first.
  psql_db -qc "DROP EVENT TRIGGER IF EXISTS ca_break_window_refuses_ddl; DROP EVENT TRIGGER IF EXISTS ca_break_window_refuses_drops" >/dev/null || return 1
  for s in "${APP_SCHEMAS[@]}"; do psql_db -qc "DROP SCHEMA IF EXISTS \"$s\" CASCADE" >/dev/null || return 1; done
  psql_db -qc 'CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;' >/dev/null || return 1
  # Same extensions, same schemas as production (pg_extension on PokerIQ-Production).
  for ext in "pg_trgm SCHEMA public" "vector SCHEMA public" "postgis SCHEMA extensions" "dblink SCHEMA extensions" \
             "pgstattuple SCHEMA extensions" "plpgsql_check SCHEMA extensions" "http SCHEMA extensions"; do
    psql_db -qc "CREATE EXTENSION IF NOT EXISTS ${ext%% *} WITH ${ext#* }" >/dev/null 2>&1 \
      || { log "restore: extension ${ext%% *} unavailable"; return 1; }
  done
  # Real extension-owned cron relations are dependencies of production views.
  # No production cron rows are exported or scheduled on the isolated copy.
  psql_db -qc 'CREATE EXTENSION IF NOT EXISTS pg_cron' >/dev/null || return 1
  # Production's own roles, so its grants restore exactly (no login, no password).
  for role in "${EXPECTED_RESTORE_ROLES[@]}"; do
    psql_db -qc "DO \$\$ BEGIN CREATE ROLE $role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$" >/dev/null || return 1
  done
  docker cp "$dump" "$DB_CONTAINER:/tmp/schema.dump" || return 1
  # public already exists so extension dependencies can be installed first.
  # Omit only its duplicate CREATE; retain every object, comment and ACL.
  docker exec "$DB_CONTAINER" pg_restore --list /tmp/schema.dump > "$STATE_DIR/restore-toc.list" || return 1
  awk '$4 == "SCHEMA" && $5 == "-" && $6 == "public" { print ";" $0; found++; next }
       { print } END { if (found != 1) exit 1 }' "$STATE_DIR/restore-toc.list" > "$STATE_DIR/restore.list" || return 1
  # pg_dump emits NOT VALID checks as separate post-data CHECK CONSTRAINT
  # entries. They grandfather historical rows, so install them after loading
  # those rows. All validated checks, keys and other schema entries stay put.
  : > "$STATE_DIR/restore-after-seed.list"
  awk -v before="$STATE_DIR/restore-before-seed.list" -v after="$STATE_DIR/restore-after-seed.list" '
    NR == FNR { if ($4 == "CHECK" && $5 == "CONSTRAINT") checks[$6 SUBSEP $7 SUBSEP $8]=1; next }
    { deferred=($4 == "CHECK" && $5 == "CONSTRAINT") ||
        ($4 == "COMMENT" && $6 == "CONSTRAINT" && $8 == "ON" && checks[$5 SUBSEP $9 SUBSEP $7]);
      if (deferred) print > after;
      print (deferred ? ";" $0 : $0) > before }
  ' "$STATE_DIR/restore.list" "$STATE_DIR/restore.list" || return 1
  docker cp "$STATE_DIR/restore-before-seed.list" "$DB_CONTAINER:/tmp/restore.list" || return 1
  docker cp "$STATE_DIR/restore-after-seed.list" "$DB_CONTAINER:/tmp/restore-after-seed.list" || return 1
  # Any other role the archive grants to exists before the first GRANT runs.
  awk '!/^;/ && ($4 == "ACL" || ($4 == "DEFAULT" && $5 == "ACL") || $4 == "POLICY")' \
    "$STATE_DIR/restore-before-seed.list" > "$STATE_DIR/restore-roles.list" || return 1
  : > "$STATE_DIR/restore-roles.sql" || return 1
  if [ -s "$STATE_DIR/restore-roles.list" ]; then
    docker cp "$STATE_DIR/restore-roles.list" "$DB_CONTAINER:/tmp/restore-roles.list" || return 1
    docker exec "$DB_CONTAINER" pg_restore --use-list /tmp/restore-roles.list --schema-only -f - /tmp/schema.dump \
      > "$STATE_DIR/restore-roles.sql" || return 1
  fi
  precreate_referenced_roles "$STATE_DIR/restore-roles.sql" || return 1
  docker exec "$DB_CONTAINER" pg_restore -U supabase_admin -d postgres --no-owner --exit-on-error \
      --use-list /tmp/restore.list --schema-only /tmp/schema.dump > "$LOG_DIR/restore.log" 2>&1 \
    || { log_restore_missing_role; return 1; }
  local errors; errors=$(grep -c 'error:' "$LOG_DIR/restore.log" || true)
  [ "$errors" = 0 ] || return 1
  # Production owns application objects as postgres; SECURITY DEFINER guards
  # (current_user IN ('postgres','service_role')) depend on it.
  docker cp "$(owners_file)" "$DB_CONTAINER:/tmp/owners.sql" || return 1
  local owners_sha
  owners_sha=$(docker exec "$DB_CONTAINER" sha256sum /tmp/owners.sql) || return 1
  owners_sha=${owners_sha%% *}
  [[ "$owners_sha" =~ ^[0-9a-f]{64}$ ]] || return 1
  docker exec "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -q -f /tmp/owners.sql >>"$LOG_DIR/restore.log" 2>&1 \
    || { log "restore: owner alignment reported errors (see restore.log)"; return 1; }
  # pg_cron jobs are never carried over: production jobs call production URLs.
  psql_db -qc "DELETE FROM cron.job" >/dev/null || return 1
  # The archive carries production ACLs; never broaden private function grants.
  docker restart supabase_rest_standby >/dev/null || return 1
  local tables functions
  tables=$(psql_db -Atc "select count(*) from pg_tables where schemaname='public'") || return 1
  functions=$(psql_db -Atc "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where nspname='public'") || return 1
  printf '{"restoredAt":"%s","dump":"%s","dumpSha256":"%s","publicTables":%s,"publicFunctions":%s,"restoreErrors":%s,"restoreValidated":false,"ownersSha256":"%s"}\n' \
    "$(date -u +%FT%TZ)" "$(basename "$dump")" "$(sha256sum "$dump" | cut -d' ' -f1)" "$tables" "$functions" "$errors" "$owners_sha" \
    | tee "$STATE_DIR/database.json"
}

cmd_seed() {
  local dir="$1"; [ -f "$dir/manifest.json" ] || die "missing seed bundle $dir"
  assert_isolated || return 1
  log "seed: loading $(python3 -c "import json;print(len(json.load(open('$dir/manifest.json'))['copied']))" ) tables (horse accounts and platform structure only)"
  assert_restore_quiet || return 1
  rm -f "$STATE_DIR/seed.json" || return 1
  docker exec "$DB_CONTAINER" rm -rf /tmp/seed || return 1
  docker cp "$dir" "$DB_CONTAINER:/tmp/seed" || return 1
  local loaded=0 failed=0
  # Seed loads into a freshly restored (empty) copy only: restore always runs first.
  docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -q >>"$LOG_DIR/seed.log" 2>&1 <<'SQL' || { log "seed: auth users load failed"; return 1; }
SET session_replication_role = replica;
CREATE TEMP TABLE h(id uuid, aud text, role text, created_at timestamptz);
\copy h FROM '/tmp/seed/auth.users.csv' CSV HEADER
-- GoTrue scans unset token and change fields as strings. The schema permits
-- NULL, but its Admin API cannot read such a user to initialize a login.
INSERT INTO auth.users (
  id, aud, role, created_at, updated_at, instance_id, email, encrypted_password,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data
)
SELECT id, aud, role, coalesce(created_at, now()), now(), '00000000-0000-0000-0000-000000000000',
       'standby-' || id || '@example.invalid', '',
       '', '', '', '', '', '', '', '', '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
FROM h ON CONFLICT (id) DO UPDATE SET
  created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at,
  email = EXCLUDED.email, encrypted_password = EXCLUDED.encrypted_password,
  confirmation_token = '', recovery_token = '', email_change_token_new = '', email_change = '',
  email_change_token_current = '', phone_change = '', phone_change_token = '', reauthentication_token = '',
  raw_app_meta_data = EXCLUDED.raw_app_meta_data, raw_user_meta_data = EXCLUDED.raw_user_meta_data;
SQL
  # The validated club-members automation CHECK reads clubs.is_platform.
  # Load that dependency first rather than weakening its real predicate.
  local seed_files=("$dir/public.clubs.csv")
  for f in "$dir"/*.csv; do
    [ "$f" = "$dir/public.clubs.csv" ] || seed_files+=("$f")
  done
  for f in "${seed_files[@]}"; do
    local t; t=$(basename "$f" .csv); [ "$t" = auth.users ] && continue
    local cols; cols=$(head -1 "$f" | python3 -c 'import csv,sys; print(",".join(chr(34)+c+chr(34) for c in next(csv.reader(sys.stdin))))')
    # Isolated copy only: load through a plain staging table (generated
    # columns are recomputed, identity values kept), with this one table's
    # triggers suspended for its own load. Production's guards refuse bulk
    # loads into money and seat tables, which is right there and moot here.
    local tq="${t%%.*}.\"${t#*.}\""
    if docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -q >>"$LOG_DIR/seed.log" 2>&1 <<SQL
BEGIN;
CREATE TEMP TABLE _seed_trigger_modes ON COMMIT DROP AS
WITH RECURSIVE relations(oid) AS (
  SELECT '$tq'::regclass::oid
  UNION ALL SELECT i.inhrelid FROM pg_inherits i JOIN relations r ON i.inhparent=r.oid
)
SELECT t.tgrelid,t.tgname,t.tgenabled FROM pg_trigger t JOIN relations r ON r.oid=t.tgrelid;
ALTER TABLE $tq DISABLE TRIGGER ALL;
CREATE TEMP TABLE _seed (LIKE $tq) ON COMMIT DROP;
\\copy _seed ($cols) FROM '/tmp/seed/$t.csv' CSV HEADER
SELECT string_agg(quote_ident(attname), ',' ORDER BY attnum) AS c FROM pg_attribute
 WHERE attrelid = '$tq'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '' \\gset
INSERT INTO $tq (:c) OVERRIDING SYSTEM VALUE SELECT :c FROM _seed;
SELECT format('ALTER TABLE ONLY %s %s TRIGGER %I',tgrelid::regclass,
 CASE tgenabled WHEN 'D' THEN 'DISABLE' WHEN 'O' THEN 'ENABLE'
                WHEN 'R' THEN 'ENABLE REPLICA' WHEN 'A' THEN 'ENABLE ALWAYS' END,tgname)
 FROM _seed_trigger_modes ORDER BY tgrelid,tgname \\gexec
COMMIT;
SQL
    then loaded=$((loaded+1)); else failed=$((failed+1)); echo "seed failed: $t" >> "$LOG_DIR/seed.log"; fi
  done
  [ "$failed" = 0 ] || return 1
  docker exec "$DB_CONTAINER" pg_restore -U supabase_admin -d postgres --no-owner --exit-on-error \
    --use-list /tmp/restore-after-seed.list --schema-only /tmp/schema.dump >> "$LOG_DIR/restore.log" 2>&1 || return 1
  docker cp /usr/local/share/club-arena-standby/placeholders.sql "$DB_CONTAINER:/tmp/placeholders.sql" || return 1
  docker exec "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -q -f /tmp/placeholders.sql >>"$LOG_DIR/seed.log" 2>&1 \
    || { log "seed: placeholder accounts reported errors (see seed.log)"; return 1; }
  [ "$failed" = 0 ] || return 1
  # Triggers are suspended only while loading the copy. Check the referenced
  # structural parents before any runtime may consume that copy.
  psql_db -qc "DO \$\$ BEGIN
    IF EXISTS (SELECT FROM public.tables t LEFT JOIN public.cash_games c ON c.id=t.cluster_id
               WHERE t.cluster_id IS NOT NULL AND c.id IS NULL)
    THEN RAISE EXCEPTION 'standby cash cluster parent missing'; END IF;
  END \$\$;" || return 1
  local tables horses seats
  tables=$(psql_db -Atc "select count(*) from public.tables") || return 1
  horses=$(psql_db -Atc "select count(*) from public.profiles where is_horse") || return 1
  seats=$(psql_db -Atc "select count(*) from public.table_seats where left_at is null") || return 1
  # Production's DDL break-window guard is two database-level event triggers,
  # which a schema dump does not carry; the engine's recovery-window contract
  # (fn_engine_recovery_window_contract) requires them, exactly as in production.
  docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -qc "CREATE EVENT TRIGGER ca_break_window_refuses_ddl ON ddl_command_end EXECUTE FUNCTION public.fn_ca_break_window_ddl_guard();
               CREATE EVENT TRIGGER ca_break_window_refuses_drops ON sql_drop EXECUTE FUNCTION public.fn_ca_break_window_ddl_guard();" >/dev/null \
    || { log "restore: break-window event triggers could not be installed"; return 1; }
  assert_restore_quiet || return 1
  # The installed source manifest is bound to this dump; compare its actual
  # restored function bodies before publishing a valid copy.
  verify_schema_evidence || return 1
  # Publish validity only after the deferred checks and finalization succeed.
  python3 - "$STATE_DIR/database.json" <<'PY_VALID'
import json, os, sys
path = sys.argv[1]
data = json.load(open(path))
data['restoreValidated'] = True
data['schemaEvidenceValidated'] = True
import hashlib
evidence_path = os.path.join(os.path.dirname(path), 'schema-evidence.json')
data['schemaEvidenceSha256'] = hashlib.sha256(open(evidence_path, 'rb').read()).hexdigest()
with open(path + '.new', 'w') as output:
    json.dump(data, output)
os.replace(path + '.new', path)
PY_VALID
  [ "$?" = 0 ] || return 1
  printf '{"cashClusterParentsValidated":true,"authFixtureVersion":2,"seededAt":"%s","tablesLoaded":%s,"tablesFailed":%s,"cashTables":%s,"horses":%s,"seatedHorses":%s}\n' \
    "$(date -u +%FT%TZ)" "$loaded" "$failed" "$tables" "$horses" "$seats" | tee "$STATE_DIR/seed.json"
}

cmd_build() {
  local sha="$1"; valid_sha "$sha"
  if docker image inspect "$IMAGE_REPO:$sha" >/dev/null 2>&1; then echo "$IMAGE_REPO:$sha"; return; fi
  git -C "$REPO_DIR" fetch -q origin || return 1
  git -C "$REPO_DIR" cat-file -e "$sha^{commit}" || die "unknown commit $sha"
  local ctx; ctx=$(mktemp -d /tmp/standby-ctx.XXXXXX) || return 1
  git -C "$REPO_DIR" archive "$sha" server | tar -x -C "$ctx" || { rm -rf "$ctx"; return 1; }
  log "build: $sha"
  docker build -q -t "$IMAGE_REPO:$sha" --build-arg "GIT_COMMIT_SHA=$sha" \
    --label "org.opencontainers.image.revision=$sha" "$ctx/server" >> "$LOG_DIR/build-$sha.log" 2>&1 \
    || { rm -rf "$ctx"; die "image build failed for $sha (see $LOG_DIR/build-$sha.log)"; }
  rm -rf "$ctx"
  echo "$IMAGE_REPO:$sha"
}

write_env() {
  local anon service
  anon=$(cd "$DB_DIR" && supabase status -o env 2>/dev/null | sed -n 's/^ANON_KEY="\(.*\)"/\1/p')
  service=$(cd "$DB_DIR" && supabase status -o env 2>/dev/null | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"/\1/p')
  [ -n "$anon" ] && [ -n "$service" ] || die 'standby database keys unavailable'
  umask 077
  cat > "$STATE_DIR/engine.env" <<EOF
PORT=8080
NODE_ENV=production
NODE_OPTIONS=--dns-result-order=ipv4first
MALLOC_ARENA_MAX=4
INTEGRITY_FEED=on
ENGINE_TOURNAMENT_LEASE_ENFORCE=on
SUPABASE_URL=$KONG
SUPABASE_ANON_KEY=$anon
SUPABASE_SERVICE_ROLE_KEY=$service
INTERNAL_API_KEY=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
ALERT_WEBHOOK_URL=http://127.0.0.1:9/standby-alerts-go-nowhere
ALERT_WEBHOOK_SECRET=standby
TURN_HOST=
TURN_PORT=3478
TURN_STATIC_AUTH_SECRET=
FAULT_INJECTION_TOKEN=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
ENGINE_STANDBY_CLONE=1
EOF
}

verify_schema_evidence() {
  local tool=$SCHEMA_EVIDENCE_TOOL
  local actual
  actual=$(mktemp "$STATE_DIR/schema-current.XXXXXX") || return 1
  rm -f "$actual"
  if python3 -B "$tool" verify-dump "$STATE_DIR/schema-evidence.json" "$STATE_DIR/schema.dump" &&
     python3 -B "$tool" capture --body-only --container "$DB_CONTAINER" --output "$actual" &&
     python3 -B "$tool" compare --body-only "$STATE_DIR/schema-evidence.json" "$actual"; then
    rm -f "$actual"
    return 0
  fi
  rm -f "$actual"
  return 1
}

assert_valid_copy() {
  python3 - "$STATE_DIR/database.json" "$STATE_DIR/seed.json" "$(owners_file)" <<'PY_CHECK' || return 1
import hashlib, json, os, sys
try:
    database, seed = (json.load(open(p)) for p in sys.argv[1:3])
    assert database.get('ownersSha256') == hashlib.sha256(open(sys.argv[3], 'rb').read()).hexdigest()
    assert database.get('restoreValidated') is True and database.get('restoreErrors') == 0
    assert database.get('schemaEvidenceValidated') is True
    evidence_path = os.path.join(os.path.dirname(sys.argv[1]), 'schema-evidence.json')
    assert database.get('schemaEvidenceSha256') == hashlib.sha256(open(evidence_path, 'rb').read()).hexdigest()
    assert seed.get('authFixtureVersion') == 2
    assert seed.get('cashClusterParentsValidated') is True
    assert seed['tablesFailed'] == 0 and seed['seededAt'] >= database['restoredAt']
except (OSError, ValueError, KeyError, TypeError, AssertionError):
    sys.exit('standby database restore/seed is unqualified')
PY_CHECK
  verify_schema_evidence
}

cmd_run() {
  local sha="$1"; valid_sha "$sha"
  assert_isolated || return 1
  assert_valid_copy || return 1
  cmd_build "$sha" >/dev/null || return 1
  write_env || return 1
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  log "run: $sha"
  docker run -d --name "$CONTAINER" --network "$NETWORK" -p "$HOST_PORT:8080" \
    --restart unless-stopped --cpus 7 --memory 26g \
    --log-driver json-file --log-opt max-size=50m --log-opt max-file=5 \
    --env-file "$STATE_DIR/engine.env" \
    --mount "type=bind,source=$STATE_DIR/engine-alerts,target=/var/lib/club-arena/engine-alerts" \
    --mount "type=bind,source=$STATE_DIR/horse-journal,target=/var/lib/club-arena/horse-journal" \
    --label "com.smarterpoker.standby.sha=$sha" \
    "$IMAGE_REPO:$sha" >/dev/null || return 1
}

health() { curl -fsS -m 5 "http://$HOST_PORT/health" 2>/dev/null || true; }
health_field() { python3 -c "import json,sys
try: d=json.loads(sys.stdin.read() or '{}')
except Exception: d={}
v=d
for k in sys.argv[1].split('.'): v=v.get(k) if isinstance(v,dict) else None
print('' if v is None else v)" "$1"; }

wait_live() {
  local deadline=$(( $(date +%s) + $1 )) h l
  while [ "$(date +%s)" -lt "$deadline" ]; do
    h=$(health); l=$(printf '%s' "$h" | health_field liveness)
    if [ "$l" = ok ] || [ "$l" = standby ]; then echo "$l"; return 0; fi
    [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" = true ] || return 2
    sleep 3
  done
  return 1
}

crash_container() {
  # PID1 ignores same-namespace SIGKILL. Signal the exact process from the
  # host through a pidfd, without Docker's intentional-stop semantics.
  python3 - "$CONTAINER" "$1" <<'PY_CRASH'
import json, os, signal, subprocess, sys
container, expected = sys.argv[1:]
def binding():
    output = subprocess.run(['docker', 'inspect', '--format',
        '{{json .Id}} {{json .State.Pid}}', container],
        check=True, capture_output=True, text=True).stdout
    identifier, pid = output.split()
    return json.loads(identifier), int(pid)
identifier, pid = binding()
if identifier != expected or pid <= 1:
    raise RuntimeError('standby crash target identity is not proved')
fd = os.pidfd_open(pid)
try:
    if binding() != (expected, pid):
        raise RuntimeError('standby crash target changed before signal')
    signal.pidfd_send_signal(fd, signal.SIGKILL)
finally:
    os.close(fd)
PY_CRASH
}

count_fatal_logs() {
  docker logs --since "$1" "$CONTAINER" > "$LOG_DIR/certify-$2.log" 2>&1 || return 1
  local count rc=0
  count=$(grep -c -E 'FATAL ERROR|Uncaught|unhandledRejection|heap out of memory|Segmentation fault' "$LOG_DIR/certify-$2.log") || rc=$?
  [ "$rc" -le 1 ] || return 1
  echo "$count"
}

wait_auto_recovery() {
  local sha="$1" container_id="$2" before="$3" deadline=$(( $(date +%s) + $4 )) count h l
  [[ "$before" =~ ^[0-9]+$ ]] || return 1
  while [ "$(date +%s)" -lt "$deadline" ]; do
    [ "$(docker inspect -f '{{.Id}}' "$CONTAINER")" = "$container_id" ] || return 1
    count=$(docker inspect -f '{{.RestartCount}}' "$CONTAINER") || return 1
    [[ "$count" =~ ^[0-9]+$ ]] || return 1
    h=$(health); l=$(printf '%s' "$h" | health_field liveness)
    if [ "$count" -gt "$before" ] && { [ "$l" = ok ] || [ "$l" = standby ]; } \
       && [ "$(printf '%s' "$h" | health_field releaseSha)" = "$sha" ]; then
      echo "$count"; return 0
    fi
    sleep 3
  done
  return 1
}

cmd_certify() {
  local sha="$1" soak="${2:-1800}" started verdict=pass reasons=() boot1 boot2 rss0 rss1 restarts fatals sv
  local restart_before restart_after container_id seats
  valid_sha "$sha"
  started=$(date +%s)
  local result="$CERT_DIR/$sha.json"
  record() { reasons+=("$1"); verdict=fail; log "certify $sha: FAIL $1"; }

  assert_valid_copy || return 1
  cmd_run "$sha" || { record 'boot_or_build_failed'; return 1; }
  t0=$(date +%s)
  if l=$(wait_live 600); then boot1=$(( $(date +%s) - t0 )); log "certify $sha: live ($l) in ${boot1}s"
  else record 'never_became_live'; boot1=-1; fi
  sv=$(health | health_field releaseSha)
  [ "$sv" = "$sha" ] || record "serving_sha_mismatch:${sv:-none}"

  # The 4 AM cutover rehearsed: the live serving release swaps to this one.
  local serving="" rollback_seconds=null forward_seconds=null SWAP_ADOPTION_SECONDS
  local player_reconnect=false
  if [ "$verdict" = pass ]; then
    if ! serving=$(curl -fsS -m 10 https://engine.smarter.poker/health | health_field releaseSha) \
       || ! [[ "$serving" =~ ^[0-9a-f]{40}$ ]]; then
      record 'serving_baseline_unknown'
    elif [ "$serving" != "$sha" ]; then
      if declare -F certified_player_swap >/dev/null; then
        # Exercise the predecessor against the database after candidate boot.
        # End on the candidate for the crash and soak checks below.
        if certified_player_swap "$sha" "$serving" >/dev/null; then
          rollback_seconds=$SWAP_ADOPTION_SECONDS
          if [ "$rollback_seconds" -gt 135 ]; then
            record 'rollback_rehearsal_exceeded_reserve'
          fi
          if certified_player_swap "$serving" "$sha" >/dev/null; then
            forward_seconds=$SWAP_ADOPTION_SECONDS
            player_reconnect=true
          else
            record "swap_rehearsal_failed_from_${serving:0:12}"
          fi
        else
          record "rollback_rehearsal_failed_to_${serving:0:12}"
        fi
      else
        record 'swap_rehearsal_unavailable'
      fi
    fi
  fi
  # An unexpected PID1 exit must recover through Docker's installed policy.
  # docker kill/stop is an intentional operator stop and suppresses that policy.
  if [ "$verdict" = pass ]; then
    container_id=$(docker inspect -f '{{.Id}}' "$CONTAINER") || return 1
    [ "$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$CONTAINER")" = unless-stopped ] || return 1
    restart_before=$(docker inspect -f '{{.RestartCount}}' "$CONTAINER") || return 1
    crash_container "$container_id" || return 1
    t0=$(date +%s)
    if restart_after=$(wait_auto_recovery "$sha" "$container_id" "$restart_before" 600); then
      boot2=$(( $(date +%s) - t0 ))
    else record 'did_not_recover_from_crash'; boot2=-1; fi
  fi

  # Soak: stays up, no restarts, no fatal errors, bounded memory growth.
  if [ "$verdict" = pass ]; then
    sleep 60
    rss0=$(docker stats --no-stream --format '{{.MemUsage}}' "$CONTAINER" | awk '{print $1}')
    local end=$(( $(date +%s) + soak ))
    local dealt=0 h
    while [ "$(date +%s)" -lt "$end" ]; do
      [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" = true ] || { record 'crashed_during_soak'; break; }
      h=$(health); l=$(printf '%s' "$h" | health_field liveness)
      [ "$l" = ok ] || [ "$l" = standby ] || { record "liveness_${l:-unreachable}_during_soak"; break; }
      n=$(printf '%s' "$h" | health_field dealRate.handsInWindow); [[ "$n" =~ ^[0-9]+$ ]] && [ "$n" -gt "$dealt" ] && dealt=$n
      sleep 15
    done
    [ "$(docker inspect -f '{{.Id}}' "$CONTAINER")" = "$container_id" ] || record 'container_changed_during_soak'
    [ "$(docker inspect -f '{{.RestartCount}}' "$CONTAINER")" = "$restart_after" ] || record 'restarted_during_soak'
    # The seeded horse tables must actually deal on this build.
    seats=$(psql_db -Atc "select count(*) from public.table_seats where left_at is null") || return 1
    [[ "$seats" =~ ^[0-9]+$ ]] || return 1
    if [ "$seats" -gt 0 ] && [ "$dealt" -eq 0 ]; then
      record 'no_hands_dealt_during_soak'
    fi
    rss1=$(docker stats --no-stream --format '{{.MemUsage}}' "$CONTAINER" | awk '{print $1}')
  fi
  if [ "$verdict" = pass ]; then
    python3 /usr/local/share/club-arena-standby/qualify-tournament-freeze-fixes.py "$sha" >&2 \
      || record 'tournament_freeze_qualification_failed'
  fi
  restarts=$(docker inspect -f '{{.RestartCount}}' "$CONTAINER" 2>/dev/null || echo -1)
  fatals=$(count_fatal_logs "$started" "$sha") || { record 'container_logs_unreadable'; fatals=-1; }
  [ "$fatals" -eq 0 ] || record "fatal_log_lines:$fatals"

  local reasons_json="[]"
  [ ${#reasons[@]} -eq 0 ] || reasons_json=$(printf '%s\n' "${reasons[@]}" | python3 -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')
  python3 - "$result" "$serving" "$rollback_seconds" "$forward_seconds" "$player_reconnect" <<PY
import json, sys, time
doc = {"schema": "club-arena-standby-certificate/v1", "sha": "$sha", "verdict": "$verdict",
       "reasons": $reasons_json, "certifiedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
       "playerReconnectedBothDirections": json.loads(sys.argv[5]), "rehearsedServingSha": sys.argv[2], "rollbackAdoptionSeconds": json.loads(sys.argv[3]), "forwardAdoptionSeconds": json.loads(sys.argv[4]),
       "bootSeconds": ${boot1:--1}, "crashRecoverySeconds": ${boot2:--1}, "soakSeconds": $soak, "restartPolicy": "unless-stopped", "crashRestartsBefore": ${restart_before:--1}, "crashRestartsAfter": ${restart_after:--1},
       "standbyScriptSha256": "$(sha256sum "${BASH_SOURCE[0]}" | cut -d' ' -f1)",
       "memoryStart": "${rss0:-}", "memoryEnd": "${rss1:-}", "fatalLogLines": $fatals, "peakHandsInWindow": ${dealt:-0},
       "seed": json.load(open("$STATE_DIR/seed.json")) if __import__("os").path.exists("$STATE_DIR/seed.json") else None,
       "database": json.load(open("$STATE_DIR/database.json")) if __import__("os").path.exists("$STATE_DIR/database.json") else None}
open(sys.argv[1], "w").write(json.dumps(doc, indent=2) + "\n")
print(json.dumps(doc))
PY
  [ "$verdict" = pass ]
}

TRIALS_FILE=/usr/local/share/club-arena-standby/standby-trials.sh
[ -f "$(dirname "$0")/standby-trials.sh" ] && TRIALS_FILE="$(dirname "$0")/standby-trials.sh"
# shellcheck source=standby-trials.sh
[ -f "$TRIALS_FILE" ] && . "$TRIALS_FILE"

cmd_status() {
  echo "container: $(docker inspect -f '{{index .Config.Labels "com.smarterpoker.standby.sha"}} running={{.State.Running}} restarts={{.RestartCount}}' "$CONTAINER" 2>/dev/null || echo none)"
  echo "health: $(health | head -c 400)"
  [ -f "$STATE_DIR/database.json" ] && echo "database: $(cat "$STATE_DIR/database.json")"
  ls -1t "$CERT_DIR" 2>/dev/null | head -5 | sed 's/^/certificate: /'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
mkdir -p "$CERT_DIR" "$LOG_DIR" "$STATE_DIR/engine-alerts" "$STATE_DIR/horse-journal"
case "${1:-}" in
  restore) cmd_restore "${2:?dump}" ;;
  seed)    cmd_seed "${2:?seed_dir}" ;;
  build)   cmd_build "${2:?sha}" ;;
  run)     cmd_run "${2:?sha}" ;;
  certify) cmd_certify "${2:?sha}" "${3:-1800}" ;;
  trial)   shift; cmd_trial "$@" ;;
  status)  cmd_status ;;
  *) sed -n 2,22p "$0"; exit 64 ;;
esac
fi
