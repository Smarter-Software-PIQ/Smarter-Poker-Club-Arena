#!/usr/bin/env bash
# Existing agreement-history qualification owns the private socket cluster.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
fixture=${1:?existing isolated fixture required}
pgbin=${2:?PostgreSQL binary directory required}
[[ -f "$fixture/data/PG_VERSION" && -f "$fixture/data/postmaster.pid" && -d "$fixture/socket" ]]
# The parent initdb owner is the invoking OS user (runner on GitHub), not
# necessarily postgres. Bootstrap the production owner only after proving
# this is that exact owned private cluster, never an arbitrary local service.
parent_psql=("$pgbin/psql" -XAtq -v ON_ERROR_STOP=1 -h "$fixture/socket" -p 55487)
[[ "$("${parent_psql[@]}" -d postgres -c "SELECT current_setting('data_directory')||'|'||(inet_server_addr()IS NULL)::text||'|'||(SELECT rolsuper FROM pg_roles WHERE rolname=current_user)::text")" == "$fixture/data|true|true" ]]
"${parent_psql[@]}" -d postgres -c "DO \$native_owner\$BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='postgres')THEN CREATE ROLE postgres SUPERUSER LOGIN;END IF;END\$native_owner\$;"
psql=("$pgbin/psql" -XAtq -v ON_ERROR_STOP=1 -h "$fixture/socket" -p 55487 -U postgres)
[[ "$("${psql[@]}" -d postgres -c "SELECT current_user||'|'||(inet_server_addr()IS NULL)::text")" == 'postgres|true' ]]
"${psql[@]}" -d postgres -c 'CREATE DATABASE original_dual_eco_native'
python3 - "$root" "$fixture/dual-eco-owners.sql" <<'PY'
from pathlib import Path
import json,sys
root=Path(sys.argv[1]);out=[]
for row in json.loads((root/'tests/fixtures/dual-eco/owners-before.json').read_text()):
 out.append(row['definition']+';')
 sig='public.'+row['oid'];out.append('REVOKE ALL ON FUNCTION '+sig+' FROM PUBLIC,anon,authenticated,service_role;')
 if row['oid'].startswith('fn_union_issue'):out.append('GRANT EXECUTE ON FUNCTION '+sig+' TO authenticated,service_role;')
 elif not row['oid'].startswith('fn_union_settlement'):out.append('GRANT EXECUTE ON FUNCTION '+sig+' TO service_role;')
for row in json.loads((root/'tests/fixtures/dual-eco/governance-before.json').read_text()):
 out.append(row['definition']+';')
Path(sys.argv[2]).write_text('\n'.join(out)+'\n')
PY
"${psql[@]}" -d original_dual_eco_native \
 -f "$root/tests/fixtures/dual-eco/bootstrap.sql" \
 -f "$root/tests/fixtures/dual-eco/pure-dependencies-before.sql" \
 -f "$fixture/dual-eco-owners.sql" \
 -f "$root/tests/fixtures/dual-eco/invoice-before.sql" \
 -f "$root/tests/fixtures/dual-eco/board-before.sql" \
 -f "$root/tests/fixtures/dual-eco/governance-bootstrap.sql" \
 -c 'REVOKE ALL ON FUNCTION ca_union_statement_board(uuid,date,integer) FROM PUBLIC; GRANT EXECUTE ON FUNCTION ca_union_statement_board(uuid,date,integer) TO authenticated,service_role; SET check_function_bodies=on;'
# Fix only the detector's default observation time; explicit canonical week
# arithmetic and original immutable component/invoice functions remain actual.
"${psql[@]}" -d original_dual_eco_native -c "DO \$clock\$DECLARE s text;BEGIN s:=pg_get_functiondef('fn_union_week_start(timestamptz)'::regprocedure);IF position('DEFAULT now()'in s)=0 THEN RAISE EXCEPTION 'fixture clock anchor changed';END IF;EXECUTE replace(s,'DEFAULT now()','DEFAULT ''2026-11-02 08:00Z''::timestamptz');END\$clock\$;"
# An already-recorded original scalar must abort the entire installer, never
# reinterpret financial history. These are private synthetic rows only.
"${psql[@]}" -d original_dual_eco_native -c "INSERT INTO union_eco_ledger(union_id,club_id,period_start,period_end,eco_amount)VALUES('fade0000-0000-0000-0000-000000000001',md5('native club')::uuid,'2026-10-26 07:00Z','2026-11-02 08:00Z',17)"
if "${psql[@]}" -d original_dual_eco_native -f "$root/supabase/migrations/20261110005719_cash_and_tournament_eco_have_separate_original_records.sql" >"$fixture/dual-eco-refusal.log" 2>&1; then
 echo 'FAIL: recorded legacy book accepted' >&2; exit 1
fi
grep -Fq original_eco_owner_amendment_legacy_record_exists "$fixture/dual-eco-refusal.log"
[[ "$("${psql[@]}" -d original_dual_eco_native -c "SELECT (to_regclass('smarter_private.union_eco_components')IS NULL AND(SELECT eco_amount=17 FROM union_eco_ledger))::text")" == true ]]
echo 'PASS: original legacy record rejects whole installer atomically'
"${psql[@]}" -d original_dual_eco_native -c "DELETE FROM union_eco_ledger WHERE union_id='fade0000-0000-0000-0000-000000000001'"
"${psql[@]}" -d original_dual_eco_native \
 -f "$root/supabase/migrations/20261110005719_cash_and_tournament_eco_have_separate_original_records.sql" \
 -f "$root/supabase/migrations/20261112152702_weekly_union_invoices_retain_cash_and_tournament_player_resu.sql" \
 -f "$root/tests/fixtures/dual-eco/weekly-player-results.sql" \
 -f "$root/tests/fixtures/dual-eco/regression.sql"
python3 "$root/tests/fixtures/dual-eco/concurrency.py" "$pgbin/psql" "$fixture/socket"
"${psql[@]}" -d postgres -c 'DROP DATABASE original_dual_eco_native'
