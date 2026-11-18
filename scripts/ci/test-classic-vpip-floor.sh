#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# THE CLASSIC VPIP FLOOR, PROVEN BY EXECUTION (Dan's ruling 2026-11-10)
# ═══════════════════════════════════════════════════════════════════════════
#
# The floor, the rolling window, the warning and the grace are SQL rules, and a
# string match cannot execute one. This stands up a THROWAWAY Postgres, builds
# the handful of relations the rule touches, installs the OLD production
# function signatures (so a changed return type is caught here and not on
# production), applies the migration, and asserts the behaviour Dan named:
#
#   exactly thirty hands      29 cannot be judged, 30 can
#   the threshold boundary    6/30 = 20.0 is safe, 5/30 = 16.7 is not
#   the rolling window        the last 30 are judged, not the whole sitting
#   warn, do not boot         a first lapse warns once and costs no seat
#   warning recovery          back at the floor clears it; the next lapse is
#                             a fresh FULL grace, never a shortened one
#   grace expiry              no boot at 9 of 10 hands, boot at 10
#   concurrent eviction       two passes over one expired grace boot once
#   forced blinds             a blind-only orbit is dealt hands, never VPIP
#   reconnects                a new chair keeps the window, warning and grace
#   Action / Madness          window 10, no grace, boot on the spot, untouched
#   below 0.50/1.00           no floor at all
#   an existing stronger floor is never lowered
#   a rejoin               leaving and sitting straight back down keeps the
#                          sample, the warning and the remaining grace, and the
#                          grace still runs out across it
#   a long absence         beyond the platform's own re-entry window, a clean
#                          sitting, by that existing rule and no new penalty
#   a cluster move         the window spans both chairs; the warning follows
#   activation             the eligible game is floored through the maintained
#                          ruleset path, its table judges, and it is audited
#   activation scope       sub-threshold, Madness and retired-club games are
#                          untouched; a second apply changes nothing
#   inheritance            a game and table created AFTER activation inherit it
#
# It NEVER touches production: a local cluster in a temp directory, removed on
# exit. CLAUDE.md section 2 rule 3 forbids DDL probes against production, and
# 11.5 forbids spending real chips to test a rule; this is how that rule is
# tested instead.
#
# Requires a local postgres (initdb / pg_ctl / psql on PATH). Skips with 0 when
# there is none, and says so - a check that cannot run must never read as green
# (CLAUDE.md 10.86 rule 1).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SQLDIR="$HERE/sql/classic-vpip-floor"
MIG="$ROOT/supabase/migrations/20261111003710_the_classic_floor_judges_thirty_dealt_hands_and_warns_before.sql"
MIG2="$ROOT/supabase/migrations/20261111022301_a_classic_rejoin_continues_the_vpip_sitting_and_the_approved.sql"
MIG3="$ROOT/supabase/migrations/20261111093132_the_vpip_sample_reads_only_the_sitting.sql"

for bin in initdb pg_ctl psql; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "SKIPPED: no local postgres ($bin not on PATH). This proof did not run."
    exit 0
  fi
done
[ -f "$MIG" ]  || { echo "FAIL: migration not found at $MIG"; exit 1; }
[ -f "$MIG2" ] || { echo "FAIL: migration not found at $MIG2"; exit 1; }
[ -f "$MIG3" ] || { echo "FAIL: migration not found at $MIG3"; exit 1; }

# A C locale, or macOS postgres dies with "postmaster became multithreaded".
export LC_ALL=C LANG=C
TMP="$(mktemp -d)"
cleanup() { pg_ctl -D "$TMP/pgd" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

mkdir -p "$TMP/pgd" "$TMP/sock"
initdb -D "$TMP/pgd" -U postgres -A trust >/dev/null 2>&1 || { echo "FAIL: initdb"; exit 1; }
# A unix socket only, on a port of our own: never a TCP listener, so a
# concurrent run or a developer's own cluster cannot collide with this one.
PORT=$(( 50000 + (RANDOM % 10000) ))
pg_ctl -D "$TMP/pgd" -o "-k $TMP/sock -p $PORT -c listen_addresses=" -l "$TMP/pg.log" start >/dev/null 2>&1
for _ in $(seq 1 20); do
  psql -h "$TMP/sock" -p "$PORT" -U postgres -c 'select 1' >/dev/null 2>&1 && break
  sleep 1
done
PSQL=(psql -h "$TMP/sock" -p "$PORT" -U postgres -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -c 'select 1' >/dev/null 2>&1 || { echo "FAIL: cluster did not start"; tail -5 "$TMP/pg.log"; exit 1; }

"${PSQL[@]}" -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;" >/dev/null || exit 1
"${PSQL[@]}" -f "$SQLDIR/01-fixture.sql"        >/dev/null || { echo "FAIL: fixture"; exit 1; }
"${PSQL[@]}" -f "$SQLDIR/02-old-signatures.sql" >/dev/null || { echo "FAIL: old signatures"; exit 1; }
"${PSQL[@]}" -f "$SQLDIR/03-apply-ruleset-stub.sql" >/dev/null || { echo "FAIL: ruleset stub"; exit 1; }

ACL_BEFORE="$("${PSQL[@]}" -t -c "select coalesce(array_to_string(proacl,'|'),'') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='fn_nit_status';" | tr -d ' ')"

"${PSQL[@]}" -f "$MIG" >/dev/null || { echo "FAIL: the migration did not apply over the old signatures"; exit 1; }
echo "PASS  the migration applies over the live signatures in one transaction"

ACL_AFTER="$("${PSQL[@]}" -t -c "select coalesce(array_to_string(proacl,'|'),'') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='fn_nit_status';" | tr -d ' ')"
if [ "$ACL_BEFORE" != "$ACL_AFTER" ]; then
  echo "FAIL  the DROP changed fn_nit_status's grants: '$ACL_BEFORE' -> '$ACL_AFTER'"; exit 1
fi
echo "PASS  the required DROP put fn_nit_status's grants back unchanged"

"${PSQL[@]}" -c "CREATE TRIGGER zz_cash_game_floor_from_template BEFORE INSERT OR UPDATE ON public.cash_games FOR EACH ROW EXECUTE FUNCTION public.fn_cash_game_floor_from_template();" >/dev/null || exit 1

# Four games the activation must treat differently, then the activation itself.
# The activation and its post-conditions live INSIDE the second migration, so an
# incomplete activation aborts it and this step fails - which is the point.
"${PSQL[@]}" -f "$SQLDIR/07-seed-activation.sql" >/dev/null || { echo "FAIL: activation fixtures"; exit 1; }
if ! ACT="$("${PSQL[@]}" -f "$MIG2" 2>&1)"; then
  echo "FAIL  the activation migration did not apply"; echo "$ACT" | grep -iE 'error|exception' | head -5; exit 1
fi
echo "PASS  the activation migration applies, and its post-conditions hold"
echo "$ACT" | sed -n 's/.*NOTICE:  \(Classic VPIP floor activated.*\)/      \1/p'

# THE SAMPLE PRODUCTION ACTUALLY RUNS. A third migration replaced fn_nit_sample
# and fn_nit_hands_since with a bounded read of the sitting. Every assertion
# below must hold against those installed definitions, not their predecessors.
"${PSQL[@]}" -f "$MIG3" >/dev/null || { echo "FAIL  the bounded-sample migration did not apply"; exit 1; }
echo "PASS  the bounded-sample migration applies over the activated floor"

RC=0
for f in "$SQLDIR/04-proof-window.sql" "$SQLDIR/05-proof-warning.sql" \
         "$SQLDIR/06-proof-rejoin.sql" "$SQLDIR/08-proof-activation.sql"; do
  OUT="$("${PSQL[@]}" -f "$f" 2>&1)" || RC=1
  echo "$OUT" | sed -n 's/.*NOTICE:  \(T[0-9]* PASS.*\)/PASS  \1/p'
  if echo "$OUT" | grep -qiE 'ERROR|EXCEPTION'; then
    echo "$OUT" | grep -iE 'ERROR|EXCEPTION' | head -5
    RC=1
  fi
done

if [ "$RC" -ne 0 ]; then echo "FAIL  the Classic floor proof did not hold"; exit 1; fi
echo "PASS  every Classic VPIP floor assertion held"
exit 0
