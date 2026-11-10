#!/usr/bin/env bash
# Exact original posthand escrow, isolated native PG17; no remote connection input.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
case "$("$PGBIN/postgres" --version)" in *' 17.'*) ;; *) echo 'PostgreSQL17 required' >&2;exit 1;;esac
if [[ "$(uname)" == Darwin ]]; then
 BASE="${POSTHAND_ESCROW_SCRATCH_ROOT:-/Volumes/SmarterWork/agent-work/extreme-capacity}"
 # Check the configured scratch itself: SSD2 can remain mounted while the
 # SSD1 parent is absent. Never fall back to the internal mountpoint.
 [[ -d "$BASE" && "$(df "$BASE" | tail -1 | awk '{print $1}')" == /dev/disk* ]]
 mounted="$(df "$BASE" | tail -1 | awk '{print $NF}')"
 case "$mounted" in /Volumes/SmarterWork|/Volumes/SmarterWork/agent-work/*) ;; *) echo 'external scratch SSD not mounted' >&2;exit 1;;esac
 [[ "$(head -1 "$mounted/SSD-IDENTITY.txt")" == SSD[12]* ]]
else BASE="${RUNNER_TEMP:-${TMPDIR:-/tmp}}";fi
WORK="$(mktemp -d "$BASE/postescrow.XXXXXX")"
started=false
finish() {
 local status=$?
 if [[ "$started" == true ]]; then
  if ! "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate -w stop >"$WORK/stop.log" 2>&1; then
   echo "ERROR: owned private PG cleanup failed; retained $WORK" >&2
   status=1
  else started=false;fi
 fi
 if [[ -n "${POSTHAND_ESCROW_EVIDENCE_DIR:-}" ]]; then
  mkdir -p "$POSTHAND_ESCROW_EVIDENCE_DIR"
  for log in "$WORK"/*.log; do [[ ! -f "$log" ]] || cp "$log" "$POSTHAND_ESCROW_EVIDENCE_DIR/";done
 fi
 [[ "$started" == true ]] || rm -rf "$WORK"
 exit "$status"
}
trap finish EXIT
export LC_ALL=C LANG=C
"$PGBIN/initdb" -D "$WORK/data" -U postgres -A trust --no-locale -E UTF8 >"$WORK/init.log" 2>&1
"$PGBIN/pg_ctl" -D "$WORK/data" -l "$WORK/pg.log" -o "-k $WORK -p 56436 -h ''" -w start >/dev/null
started=true
PSQL=("$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$WORK" -p 56436 -U postgres -d postgres)
F="$ROOT/tests/fixtures/posthand-escrow"
FLOW="$ROOT/tests/fixtures/late-seat-flow"
OLD="$ROOT/tests/fixtures/union-pnl-blocked-resolution"
ORIGINAL="$ROOT/tests/fixtures/original-unchanged-stack"
PRIOR="$ROOT/supabase/migrations/20261012201712_late_departed_seat_settlement_proves_its_original_cash_flow.sql"
MIG="$ROOT/supabase/migrations/20261012211046_original_posthand_escrow_retains_its_completed_financial_pro.sql"
load_original() {
python3 "$FLOW/load-captured.py" "$F/captured.jsonb" "$WORK/load.sql"
"${PSQL[@]}" -f "${NATIVE_SCHEMA:-$OLD/schema.sql}" -f "$FLOW/schema-additions.sql" -f "$ORIGINAL/schema-additions.sql" \
 -f "$FLOW/admission-preimages.sql" -f "$ORIGINAL/cents-preimage.sql" -f "$FLOW/consumer-preimage.sql" \
 -f "$FLOW/retained-preimages.sql" -f "$FLOW/retained-key-preimage.sql" -f "$FLOW/compact-preimages.sql" \
 -f "$F/atomic-original-preimage.sql" -f "$F/retained-atomic-preimage.sql" -f "$FLOW/unused-original-dependencies.sql" -f "$ORIGINAL/lineage-preimage.sql" \
 -f "$WORK/load.sql" -f "$FLOW/flow-preimage.sql" -f "$FLOW/report-preimage.sql" -f "$FLOW/access-preimage.sql" \
 -f "$F/pruner-schema.sql" -f "$F/f06-preimages.sql" -f "$F/unchanged-pruner-preimages.sql" \
 -f "$F/cash-evidence-preimage.sql" -f "$F/hand-lines-preimage.sql" -f "$F/touch-seed.sql" -f "$F/access-preimage.sql" -f "$PRIOR"
python3 - "$PRIOR" "$WORK/prior-history.sql" <<'PY'
from pathlib import Path
import sys
s=Path(sys.argv[1]).read_text()
assert '$original_prior$' not in s
Path(sys.argv[2]).write_text("CREATE SCHEMA supabase_migrations;CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);INSERT INTO supabase_migrations.schema_migrations VALUES('20261012201712','native qualified predecessor',ARRAY[$original_prior$"+s+"$original_prior$]);\n")
PY
"${PSQL[@]}" -f "$WORK/prior-history.sql" -f "$F/before.sql"
}
load_original
python3 "$F/admission.py" "$PGBIN" "$WORK" "$MIG"
sed 's/^COMMIT;$/ROLLBACK;/' "$MIG" >"$WORK/rollback.sql"
"${PSQL[@]}" -f "$WORK/rollback.sql" -f "$F/rollback-readback.sql"
"${PSQL[@]}" -f "$MIG" -f "$F/writer-boundaries.sql"
python3 - "$MIG" "$WORK/qualified-hand-lines.sql" <<'PY_READER'
from pathlib import Path
import sys
source=Path(sys.argv[1]).read_text()
a=source.index('CREATE OR REPLACE FUNCTION public.fn_union_pnl_week_hand_lines(')
b=source.index('CREATE OR REPLACE FUNCTION public.fn_pnl_cash_hand_evidence',a)
Path(sys.argv[2]).write_text(source[a:b])
PY_READER
"${PSQL[@]}" -v qualified_hand_lines="$WORK/qualified-hand-lines.sql" -f "$F/ordinary-touch-boundary.sql"
"${PSQL[@]}" -At -c "SELECT jsonb_build_object('proof_md5',md5(public.fn_union_pnl_prove_posthand_escrow('1c531058-25b9-4aad-b4f0-1641d1d085ea',31008564)::text),'original_sha256',encode(extensions.digest(convert_to(smarter_private.posthand_escrow_original_snapshot('1c531058-25b9-4aad-b4f0-1641d1d085ea',31008564)::text,'UTF8'),'sha256'),'hex'));"
"${PSQL[@]}" -At -c "SELECT pg_get_functiondef('fn_union_pnl_evidence_report(uuid,timestamptz,timestamptz)'::regprocedure)" >"$WORK/report.sql"
for qualified in false true;do
 for projected in false true;do python3 "$F/arithmetic.py" "$WORK/report.sql" "$qualified" "$projected" "$WORK/arithmetic-$qualified-$projected.sql";done
done
"${PSQL[@]}" -f "$WORK/arithmetic-false-false.sql" -f "$WORK/arithmetic-false-true.sql" \
 -v arithmetic_after="$WORK/arithmetic-true-false.sql" -v arithmetic_after_projected="$WORK/arithmetic-true-true.sql" -f "$F/certificate-boundaries.sql"
python3 "$F/concurrency.py" "$PGBIN" "$WORK"
"${PSQL[@]}" -f "$F/unchanged-pruner-boundary.sql" -f "$F/source-preservation.sql"
if "${PSQL[@]}" -f "$MIG" >"$WORK/replay.log" 2>&1;then echo 'ERROR exact posthand migration replay admitted';exit 1;fi
grep -q POSTHAND_ESCROW_ALREADY_INSTALLED "$WORK/replay.log"
echo 'PASS exact posthand migration replay refuses'
"${PSQL[@]}" -At -c "SELECT jsonb_object_agg(p.oid::regprocedure::text,jsonb_build_object('md5',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'config',p.proconfig,'security_definer',p.prosecdef)) FROM pg_proc p WHERE p.proname LIKE '%posthand_escrow%' OR p.oid=ANY(ARRAY['public.fn_union_pnl_cash_outcome_accepted(public.union_pnl_cash_outcomes)'::regprocedure,'public.fn_union_pnl_week_hand_lines(uuid,timestamptz,timestamptz,boolean)'::regprocedure,'public.fn_pnl_cash_hand_evidence(uuid,bigint)'::regprocedure]);"
echo 'PASS original posthand escrow native PostgreSQL17'

# The same maintained native route qualifies the successor temporal proof in
# a fresh local database, preserving every historical case above unchanged.
"$PGBIN/createdb" -h "$WORK" -p 56436 -U postgres posthand_temporal
PSQL=("$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$WORK" -p 56436 -U postgres -d posthand_temporal)
sed '/^CREATE ROLE /d' "$OLD/schema.sql" >"$WORK/temporal-schema.sql"
NATIVE_SCHEMA="$WORK/temporal-schema.sql" load_original
"${PSQL[@]}" -f "$MIG"
T="$F/temporal"
NEXT="$ROOT/supabase/migrations/20261109234320_prove_all_original_posthand_pending_escrow_completions.sql"
python3 "$T/extract-candidate.py" "$NEXT" "$WORK"
# This isolated seam intentionally supplies only reporting readiness, not a
# fabricated 68-source catalog. The real owners and all financial proofs run.
"${PSQL[@]}" -c 'CREATE FUNCTION smarter_private.original_inventory_proof_sources_match()RETURNS boolean LANGUAGE sql AS $$SELECT true$$'  -f "$T/prover-original.sql" -f "$T/projector-original.sql" -f "$WORK/helper.sql"
"${PSQL[@]}" -v prover_candidate="$WORK/prover.sql" -v completion_candidate="$WORK/completion.sql" -v completion_original="$T/completion-original.sql"  -f "$T/rebuy-prototype.sql" -f "$T/split-native.sql" -f "$T/initial-native.sql" -f "$T/multiple-native.sql"  -f "$T/extra-native.sql" -f "$T/event-native.sql" -f "$T/negative-native.sql" -f "$T/event-refusal-native.sql" -f "$T/lookup-native.sql"
python3 "$T/installation.py" "$PGBIN" "$WORK" "$NEXT"
echo 'PASS original completed pending escrow temporal native PostgreSQL17'
