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

# Zero fatal/shutdown/unexpected leadership_shutdown lifecycle logs during the
# candidate's boot and soak window (incident 075013fd, Wave 2 Hardening).
# Returns 0 on pass or not_armed (table not yet installed), 1 when any
# matching lifecycle failure row was recorded (printing exact error/stack to
# stderr), and 2 when the database or payload could not be read (fail closed).
check_engine_lifecycle_logs() {
  local since="$1" sha="$2" raw
  [[ "$since" =~ ^[0-9]+$ ]] || return 2
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || return 2
  raw=$(psql_db -At -v since="$since" -v sha="$sha" <<'SQL_LIFECYCLE_LOGS'
\set QUIET on
SET statement_timeout = '10s';
SELECT set_config('standby.since', :'since', false) AS _s,
       set_config('standby.sha', :'sha', false) AS _h \gset
DO $chk$
DECLARE
  v_since bigint := current_setting('standby.since')::bigint;
  v_sha text := current_setting('standby.sha');
  v_result json;
BEGIN
  IF to_regclass('public.engine_lifecycle_logs') IS NULL THEN
    v_result := json_build_object('status', 'not_armed', 'count', 0, 'rows', '[]'::json);
  ELSE
    SELECT json_build_object(
      'status', CASE WHEN count(*) = 0 THEN 'pass' ELSE 'fail' END,
      'count', count(*)::int,
      'rows', COALESCE(json_agg(
        json_build_object(
          'id', id,
          'createdAt', created_at,
          'instanceId', instance_id,
          'releaseSha', release_sha,
          'level', level,
          'event', event,
          'message', message,
          'kind', detail->>'kind',
          'errorName', detail->>'errorName',
          'errorMessage', detail->>'errorMessage',
          'stack', detail->>'stack'
        ) ORDER BY created_at ASC, id ASC
      ), '[]'::json)
    )
    INTO v_result
    FROM (
      SELECT id, created_at, instance_id, release_sha, level, event, message, detail
      FROM public.engine_lifecycle_logs
      WHERE created_at >= to_timestamp(v_since)
        AND (release_sha = v_sha OR release_sha = left(v_sha, 8) OR release_sha IS NULL)
        AND (
          event IN ('fatal_error', 'shutdown_failed', 'shutdown_deadline', 'leadership_shutdown')
          OR level = 'fatal'
        )
      ORDER BY created_at ASC, id ASC
      LIMIT 20
    ) bad;
  END IF;
  PERFORM set_config('standby.lifecycle_result', v_result::text, false);
END
$chk$;
SELECT current_setting('standby.lifecycle_result');
SQL_LIFECYCLE_LOGS
  ) || return 2
  python3 - "$raw" <<'PY_LIFECYCLE'
import json, sys
try:
    data = json.loads(sys.argv[1])
    status = data['status']
    count = data['count']
    rows = data['rows']
    assert status in ('pass', 'fail', 'not_armed')
    assert type(count) is int and count >= 0
    assert isinstance(rows, list)
except Exception as exc:
    print(f'standby-engine: lifecycle_logs_unreadable: {exc}', file=sys.stderr)
    sys.exit(2)
summary = {'status': status, 'count': count}
print(json.dumps(summary))
if status == 'fail' or count > 0:
    print(f'standby-engine: FAIL {count} fatal/shutdown lifecycle log row(s) recorded during certification:', file=sys.stderr)
    for row in rows:
        print(
            f"  [{row.get('createdAt')}] event={row.get('event')} level={row.get('level')} "
            f"instance={row.get('instanceId')} sha={row.get('releaseSha')} "
            f"kind={row.get('kind')} message={row.get('message')}",
            file=sys.stderr,
        )
        if row.get('errorName') or row.get('errorMessage'):
            print(f"    error: {row.get('errorName') or 'Error'}: {row.get('errorMessage') or ''}", file=sys.stderr)
        if row.get('stack'):
            print(f"    stack:\n{row['stack']}", file=sys.stderr)
    sys.exit(1)
sys.exit(0)
PY_LIFECYCLE
}

# Unintended between-hand delay gate during Backup soak (incident 075013fd,
# Wave 2 Hardening; made a sound sample test 2026-11-24, Cutover reliability
# item 1b). Backup soak deals classic hands into public.hand_history;
# when fn_ca_hand_gap_unintended_delay is installed on the copy, the judge
# below grades every graded (kind, shape) cell of the steady-state soak:
#   rule 1 hard_ceiling       any single gap more than HARD_CEILING_MS
#                             (5,000 ms) beyond what the hand owed fails at
#                             any sample size: a multi-second stall is never
#                             acceptable.
#   rule 2 over_budget_share  a cell with at least MIN_CELL_HANDS (10) graded
#                             hands fails when its count of hands over the
#                             250 ms budget is improbable for an engine whose
#                             true over-budget share is ALLOWED_RATE (5 %,
#                             the share the old p95 <= 250 ms test allowed):
#                             one-sided exact binomial P(X >= k | n, 5 %)
#                             below 1 - CONFIDENCE (0.05).
#   rule 3 over_budget_share_pooled  cells under MIN_CELL_HANDS issue no
#                             verdict of their own ("insufficient_sample");
#                             they are pooled per kind and the pool is tested
#                             by rule 2.
# A percentile of a small cell is its slowest hand, so no percentile is a
# verdict: one 1.4 s hand in 14 (2026-11-24 12:47Z) is 1 of 14 over budget,
# P = 0.51, and passes; four of 14, or a shifted distribution, still fails.
# The verdict names the cell, n, the rule and the worst hands (ids from the
# grader's worst_hands column; a copy whose grader predates it judges rule 1
# on p99, a lower bound of the maximum, and says the ids are unavailable).
# Returns 0 on pass or not_armed, 1 on breach (printing the verdicts to
# stderr), and 2 when unreadable.
check_soak_hand_gap_delay() {
  local since="$1" window_minutes="${2:-15}" raw
  [[ "$since" =~ ^[0-9]+$ ]] || return 2
  [[ "$window_minutes" =~ ^[0-9]+$ ]] || return 2
  raw=$(psql_db -At -v since="$since" -v window_minutes="$window_minutes" <<'SQL_HAND_GAP'
\set QUIET on
SET statement_timeout = '15s';
SELECT set_config('standby.since', :'since', false) AS _s,
       set_config('standby.window_minutes', :'window_minutes', false) AS _w \gset
DO $gap$
DECLARE
  v_since bigint := current_setting('standby.since')::bigint;
  v_win int := LEAST(GREATEST(current_setting('standby.window_minutes')::int, 1), 15);
  v_grader regprocedure := to_regprocedure('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)');
  v_extremes boolean;
  v_shapes json;
  v_result json;
  v_hands_in_soak int;
BEGIN
  IF v_grader IS NULL THEN
    v_result := json_build_object(
      'status', 'not_armed',
      'windowMinutes', v_win,
      'handsInSoak', 0,
      'extremesAvailable', false,
      'shapes', '[]'::json
    );
  ELSE
    SELECT count(*)::int INTO v_hands_in_soak
    FROM public.hand_history
    WHERE created_at >= to_timestamp(v_since);

    SELECT 'worst_hands' = ANY (p.proargnames) AND 'unintended_max_ms' = ANY (p.proargnames)
      INTO v_extremes
      FROM pg_proc p WHERE p.oid = v_grader;

    IF v_extremes THEN
      EXECUTE $q$
        SELECT COALESCE(json_agg(row_to_json(g) ORDER BY g.kind, g.shape), '[]'::json)
        FROM (SELECT kind, shape, graded, hands, gap_p50_ms, owed_p50_ms,
                     unintended_p50_ms, unintended_p95_ms, unintended_p99_ms,
                     over_budget, COALESCE(budget_ms, 250) AS budget_ms,
                     unintended_max_ms, worst_hands
                FROM public.fn_ca_hand_gap_unintended_delay(now(), $1)) g
      $q$ INTO v_shapes USING v_win;
    ELSE
      EXECUTE $q$
        SELECT COALESCE(json_agg(row_to_json(g) ORDER BY g.kind, g.shape), '[]'::json)
        FROM (SELECT kind, shape, graded, hands, gap_p50_ms, owed_p50_ms,
                     unintended_p50_ms, unintended_p95_ms, unintended_p99_ms,
                     over_budget, COALESCE(budget_ms, 250) AS budget_ms
                FROM public.fn_ca_hand_gap_unintended_delay(now(), $1)) g
      $q$ INTO v_shapes USING v_win;
    END IF;

    v_result := json_build_object(
      'status', 'graded',
      'windowMinutes', v_win,
      'handsInSoak', v_hands_in_soak,
      'extremesAvailable', COALESCE(v_extremes, false),
      'shapes', v_shapes
    );
  END IF;
  PERFORM set_config('standby.hand_gap_result', v_result::text, false);
END
$gap$;
SELECT current_setting('standby.hand_gap_result');
SQL_HAND_GAP
  ) || return 2
  python3 - "$raw" <<'PY_HAND_GAP'
import json, math, sys

# The judge's constants. The budget itself comes from the grader (250 ms).
DEFAULT_BUDGET_MS = 250
ALLOWED_OVER_BUDGET_RATE = 0.05
CONFIDENCE = 0.95
MIN_CELL_HANDS = 10
HARD_CEILING_MS = 5000
WORST_HANDS_SHOWN = 5


def over_budget_p_value(n, k, rate=ALLOWED_OVER_BUDGET_RATE):
    """One-sided exact binomial tail P(X >= k) for X ~ Binomial(n, rate).

    Summed in log space: math.comb(n, i) is an exact integer, and multiplying
    it by a float overflows ("int too large to convert to float") from about
    1,000 hands in a cell, which would crash the judge on a long or busy soak.
    """
    if k <= 0:
        return 1.0
    if k > n:
        return 0.0
    log_rate, log_rest = math.log(rate), math.log1p(-rate)
    log_n = math.lgamma(n + 1)
    terms = [log_n - math.lgamma(i + 1) - math.lgamma(n - i + 1) + i * log_rate + (n - i) * log_rest
             for i in range(k, n + 1)]
    top = max(terms)
    return min(1.0, math.exp(top) * sum(math.exp(t - top) for t in terms))


def as_count(value, name):
    if type(value) is not int or value < 0:
        raise ValueError(f'{name} is not a count: {value!r}')
    return value


try:
    data = json.loads(sys.argv[1])
    status = data['status']
    hands_in_soak = data['handsInSoak']
    shapes = data['shapes']
    window_minutes = data['windowMinutes']
    extremes = data.get('extremesAvailable') is True
    assert status in ('graded', 'not_armed'), f'status {status!r}'
    assert type(hands_in_soak) is int and hands_in_soak >= 0
    assert isinstance(shapes, list)
    cells = []
    for s in shapes:
        if s.get('graded') is not True:
            continue
        n = as_count(s['hands'], 'hands')
        k = as_count(s['over_budget'] if s.get('over_budget') is not None else 0, 'over_budget')
        assert k <= n, f'over_budget {k} > hands {n}'
        budget = s.get('budget_ms') if s.get('budget_ms') is not None else DEFAULT_BUDGET_MS
        assert type(budget) is int and budget > 0
        worst = None
        top = None
        if extremes:
            top = s.get('unintended_max_ms')
            assert top is None or type(top) is int
            worst = []
            for w in s.get('worst_hands') or []:
                assert isinstance(w, dict) and type(w.get('unintended_ms')) is int
                worst.append({'hand_id': w.get('hand_id'), 'table_id': w.get('table_id'),
                              'unintended_ms': w['unintended_ms']})
        p99 = s.get('unintended_p99_ms')
        assert p99 is None or type(p99) is int
        cells.append({'kind': s['kind'], 'shape': s['shape'], 'n': n, 'overBudget': k,
                      'budgetMs': budget, 'maxMs': top, 'p99Ms': p99,
                      'p50Ms': s.get('unintended_p50_ms'), 'worstHands': worst})
except Exception as exc:
    print(f'standby-engine: hand_gap_check_unreadable: {exc}', file=sys.stderr)
    sys.exit(2)

ALPHA = 1 - CONFIDENCE


def worst_text(worst):
    if worst is None:
        return 'worst_hands=unavailable (grader predates worst_hands)'
    if not worst:
        return 'worst_hands=[]'
    return 'worst_hands=[' + ', '.join(f"{w['hand_id']}:{w['unintended_ms']}ms" for w in worst) + ']'


breaches = []
pools = {}
for c in cells:
    # Rule 1: one multi-second stall fails at any sample size.
    if c['maxMs'] is not None:
        observed, measure = c['maxMs'], 'max_ms'
    else:
        # p99 never exceeds the maximum, so p99 > ceiling proves max > ceiling.
        observed, measure = c['p99Ms'], 'p99_ms(lower bound of max)'
    c['hardCeilingBreached'] = observed is not None and observed > HARD_CEILING_MS
    if c['hardCeilingBreached']:
        breaches.append({'kind': c['kind'], 'shape': c['shape'], 'n': c['n'], 'rule': 'hard_ceiling',
                         'overBudget': c['overBudget'], 'observedMs': observed, 'worstHands': c['worstHands'],
                         'verdict': f"kind={c['kind']} shape={c['shape']} n={c['n']} rule=hard_ceiling "
                                    f"{measure}={observed} > ceiling_ms={HARD_CEILING_MS} {worst_text(c['worstHands'])}"})
    # Rules 2 and 3: the share of over-budget hands, tested on enough hands.
    if c['n'] >= MIN_CELL_HANDS:
        c['judged'] = 'cell'
        c['pValue'] = over_budget_p_value(c['n'], c['overBudget'])
        if c['pValue'] < ALPHA:
            breaches.append({'kind': c['kind'], 'shape': c['shape'], 'n': c['n'], 'rule': 'over_budget_share',
                             'overBudget': c['overBudget'], 'pValue': c['pValue'], 'worstHands': c['worstHands'],
                             'verdict': f"kind={c['kind']} shape={c['shape']} n={c['n']} rule=over_budget_share "
                                        f"over_budget={c['overBudget']}/{c['n']} budget_ms={c['budgetMs']} "
                                        f"p_value={c['pValue']:.4g} < {ALPHA:.2g} (allowed share "
                                        f"{ALLOWED_OVER_BUDGET_RATE:.0%}, one-sided binomial, {CONFIDENCE:.0%} confidence) "
                                        f"max_ms={c['maxMs']} {worst_text(c['worstHands'])}"})
    else:
        c['judged'] = 'insufficient_sample'
        c['pValue'] = None
        pools.setdefault(c['kind'], []).append(c)

pooled = []
for kind, members in sorted(pools.items()):
    n = sum(m['n'] for m in members)
    k = sum(m['overBudget'] for m in members)
    p = over_budget_p_value(n, k)
    if any(m['worstHands'] is None for m in members):
        worst = None
    else:
        worst = sorted((w for m in members for w in m['worstHands']),
                       key=lambda w: -w['unintended_ms'])[:WORST_HANDS_SHOWN]
    names = '+'.join(m['shape'] for m in members)
    pooled.append({'kind': kind, 'shapes': [m['shape'] for m in members], 'n': n, 'overBudget': k, 'pValue': p})
    if p < ALPHA:
        breaches.append({'kind': kind, 'shape': f'pooled({names})', 'n': n, 'rule': 'over_budget_share_pooled',
                         'overBudget': k, 'pValue': p, 'worstHands': worst,
                         'verdict': f"kind={kind} shape=pooled({names}) n={n} rule=over_budget_share_pooled "
                                    f"over_budget={k}/{n} p_value={p:.4g} < {ALPHA:.2g} (cells under "
                                    f"{MIN_CELL_HANDS} hands, allowed share {ALLOWED_OVER_BUDGET_RATE:.0%}) "
                                    f"{worst_text(worst)}"})

summary = {
    'status': 'not_armed' if status == 'not_armed' else ('fail' if breaches else 'pass'),
    'windowMinutes': window_minutes,
    'handsInSoak': hands_in_soak,
    'rules': {'budgetMs': DEFAULT_BUDGET_MS, 'allowedOverBudgetRate': ALLOWED_OVER_BUDGET_RATE,
              'confidence': CONFIDENCE, 'minCellHands': MIN_CELL_HANDS, 'hardCeilingMs': HARD_CEILING_MS},
    'extremesAvailable': extremes,
    'breachCount': len(breaches),
    'breaches': breaches,
    'cells': [{k: v for k, v in c.items() if k != 'p50Ms'} for c in cells],
    'pools': pooled,
}
print(json.dumps(summary))
if breaches:
    print(f'standby-engine: FAIL unintended hand-gap delay: {len(breaches)} verdict(s):', file=sys.stderr)
    for b in breaches:
        print(f"  {b['verdict']}", file=sys.stderr)
    sys.exit(1)
sys.exit(0)
PY_HAND_GAP
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
  # TODAY'S INCIDENTS NEVER COME BACK (2026-11-19): replayed on the restored
  # copy before the engine boots; a regression withholds the certificate.
  if declare -F trial_regression_replay >/dev/null; then
    trial_regression_replay "$sha" >&2 || record 'regression_replay_failed'
  else
    record 'regression_replay_unavailable'
  fi
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
  local lifecycle_check='null' hand_gap_check='null' lc_rc hg_rc lc_count soak_started soak_window_min
  if [ "$verdict" = pass ]; then
    sleep 60
    soak_started=$(date +%s)
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
    # Unintended between-hand delay check over the steady-state soak window.
    soak_window_min=$(( ( $(date +%s) - soak_started + 59 ) / 60 ))
    [ "$soak_window_min" -lt 1 ] && soak_window_min=1
    [ "$soak_window_min" -gt 15 ] && soak_window_min=15
    hg_rc=0
    hand_gap_check=$(check_soak_hand_gap_delay "$soak_started" "$soak_window_min") || hg_rc=$?
    if [ "$hg_rc" -eq 1 ]; then
      record 'hand_gap_unintended_delay_exceeded'
    elif [ "$hg_rc" -ne 0 ]; then
      hand_gap_check='null'
      record 'hand_gap_check_unreadable'
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
  # Always check engine_lifecycle_logs so boot/soak fatal crashes print their
  # exact error and stack from the Backup database and fail closed.
  lc_rc=0
  lifecycle_check=$(check_engine_lifecycle_logs "$started" "$sha") || lc_rc=$?
  if [ "$lc_rc" -eq 1 ]; then
    lc_count=$(printf '%s' "$lifecycle_check" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("count", 1))' 2>/dev/null || echo 1)
    record "lifecycle_fatal_events:$lc_count"
  elif [ "$lc_rc" -ne 0 ]; then
    lifecycle_check='null'
    record 'lifecycle_logs_unreadable'
  fi

  local reasons_json="[]"
  [ ${#reasons[@]} -eq 0 ] || reasons_json=$(printf '%s\n' "${reasons[@]}" | python3 -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')
  python3 - "$result" "$serving" "$rollback_seconds" "$forward_seconds" "$player_reconnect" "$lifecycle_check" "$hand_gap_check" <<PY
import json, sys, time
doc = {"schema": "club-arena-standby-certificate/v1", "sha": "$sha", "verdict": "$verdict",
       "reasons": $reasons_json, "certifiedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
       "playerReconnectedBothDirections": json.loads(sys.argv[5]), "rehearsedServingSha": sys.argv[2], "rollbackAdoptionSeconds": json.loads(sys.argv[3]), "forwardAdoptionSeconds": json.loads(sys.argv[4]),
       "bootSeconds": ${boot1:--1}, "crashRecoverySeconds": ${boot2:--1}, "soakSeconds": $soak, "restartPolicy": "unless-stopped", "crashRestartsBefore": ${restart_before:--1}, "crashRestartsAfter": ${restart_after:--1},
       "standbyScriptSha256": "$(sha256sum "${BASH_SOURCE[0]}" | cut -d' ' -f1)",
       "memoryStart": "${rss0:-}", "memoryEnd": "${rss1:-}", "fatalLogLines": $fatals, "peakHandsInWindow": ${dealt:-0},
       "lifecycleLogCheck": json.loads(sys.argv[6]), "handGapCheck": json.loads(sys.argv[7]),
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
