#!/usr/bin/env bash
# The dealt-chair rake provenance law refuses a redefinition that drops it.
#
# Event trigger ca_cash_rake_provenance_law (20261118164000, widened by
# 20261118190500) refuses any CREATE/ALTER FUNCTION of a guarded function whose
# new body lacks the evidence it must read or write (incident d2d79c4f,
# 2026-11-18). Proving that takes DDL, and production DDL probes are forbidden
# (CLAUDE.md section 2, rule 3), so the proof runs here, in a throwaway
# database, against the guard's own bytes: the LATEST migration on this branch
# that defines smarter_private.fn_cash_rake_provenance_law_guard(). If a later
# migration loosens the guard, this is what notices.
#
# For every guarded function: a body without its marker must be refused with
# 42501, and a body carrying the marker must be accepted.
#
# REHEARSAL_PSQL: a psql command line for the throwaway database (stdin = SQL).
set -uo pipefail

: "${REHEARSAL_PSQL:?REHEARSAL_PSQL must name the throwaway database}"
MIG_DIR="${MIG_DIR:-supabase/migrations}"
GUARD='CREATE OR REPLACE FUNCTION smarter_private.fn_cash_rake_provenance_law_guard()'

src="$(grep -lF "$GUARD" "$MIG_DIR"/*.sql | sort | tail -1)"
if [ -z "$src" ]; then
  echo "::error::no migration defines smarter_private.fn_cash_rake_provenance_law_guard()"
  exit 3
fi
echo "guard source: $src"

guard_sql="$(awk -v start="$GUARD" '
  index($0, start) == 1 { on = 1 }
  on { print }
  on && /^END \$function\$;/ { exit }' "$src")"
if ! printf '%s\n' "$guard_sql" | grep -q '^END \$function\$;'; then
  echo "::error::could not extract the guard body from $src"
  exit 3
fi

psql_run() { $REHEARSAL_PSQL -v ON_ERROR_STOP=1 -qAt 2>&1; }

setup="$(printf '%s\n' \
  'CREATE SCHEMA IF NOT EXISTS smarter_private;' \
  "$guard_sql" \
  'DROP EVENT TRIGGER IF EXISTS ca_cash_rake_provenance_law;' \
  "CREATE EVENT TRIGGER ca_cash_rake_provenance_law ON ddl_command_end WHEN TAG IN ('CREATE FUNCTION', 'ALTER FUNCTION') EXECUTE FUNCTION smarter_private.fn_cash_rake_provenance_law_guard();" \
  | psql_run)" || { echo "$setup"; echo "::error::could not install the guard"; exit 3; }

# name | marker(s) the body must carry (one per line after the name, joined by ;)
cases=(
  'public.fn_cash_earning_club|smarter_private.cash_hand_earning_club_evidence('
  'public.fn_cash_capture_hand_manifest|INSERT INTO smarter_private.cash_hand_chair_clubs'
  'public.fn_ca_attribute_union_rake|smarter_private.cash_hand_earning_club_evidence('
  'smarter_private.fn_record_ended_seat_occupancy|INSERT INTO smarter_private.cash_seat_occupancy_history'
  'smarter_private.cash_hand_earning_club_evidence|smarter_private.cash_hand_chair_clubs;smarter_private.cash_seat_occupancy_history;public.cash_hand_participant_manifests;public.ca_seat_stack_exits'
)

fail=0
for c in "${cases[@]}"; do
  fn="${c%%|*}"; markers="${c#*|}"
  # Only the names the guard actually lists are checked; a name it no longer
  # lists is a guard that was loosened, and that is a failure.
  if ! printf '%s\n' "$guard_sql" | grep -qF "'$fn'"; then
    echo "::error::the guard in $src no longer protects $fn"; fail=1; continue
  fi
  comment="$(printf '%s' "$markers" | tr ';' '\n' | sed 's/^/  -- /')"
  bad="CREATE OR REPLACE FUNCTION $fn() RETURNS int LANGUAGE plpgsql AS \$f\$ BEGIN RETURN 1; END \$f\$;"
  good="CREATE OR REPLACE FUNCTION $fn() RETURNS int LANGUAGE plpgsql AS \$f\$
BEGIN
$comment
  RETURN 1;
END \$f\$;"
  out="$(printf '%s\n' "$bad" | psql_run)"; rc=$?
  if [ "$rc" -eq 0 ] || ! printf '%s' "$out" | grep -q 'REFUSED'; then
    echo "::error::$fn without its evidence was NOT refused (rc=$rc): $out"; fail=1
  else
    echo "refused as required: $fn without its evidence"
  fi
  out="$(printf '%s\n' "$good" | psql_run)"; rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "::error::$fn carrying its evidence was refused: $out"; fail=1
  else
    echo "accepted as required: $fn with its evidence"
  fi
done

exit "$fail"
