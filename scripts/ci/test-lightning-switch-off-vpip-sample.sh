#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# A LIGHTNING SWITCH-OFF STARTS A FRESH VPIP SAMPLE, PROVEN BY EXECUTION
# (migration 20261121152102)
# ═══════════════════════════════════════════════════════════════════════════
#
# When a game left Lightning, its anchor tables' first eviction pass judged
# the whole pool sitting (every pool hand is a ca_hand_facts row of the game)
# with the game's ten-hand, no-grace rule: an instant eviction and the
# two-hour bar, no warning. Production, 30 days to 2026-11-21: 220 of 236
# Lightning-game VPIP bars could not have been judged at that instant under
# a window that starts at the switch-off.
#
# This stands up a THROWAWAY Postgres, builds the Classic floor chain exactly
# as scripts/ci/test-classic-vpip-floor.sh does (so fn_nit_sitting_since is
# the installed pre-image, md5 5c9907e0...), adds Lightning-format games and
# cash_cluster_conversion, records every answer of the old window, applies the
# migration, and asserts:
#
#   T0  the old window reproduces the defect (the control)
#   T1  a never-Lightning game: byte-identical answers
#   T2  Classic rolling 30/10: byte-identical, still warns before it boots
#   T3  the 08:47:56 shape: 200 pool hands at 20%, switch-off, nothing judged
#   T4  ordinary hands after it: judged on those only (9 no, 10 yes, 30% kept)
#   T5  a graced table: the first post-switch-off lapse warns, grace expiry boots
#   T6  a player who joins after the switch-off: unchanged
#   T7  on/off/on/off: the window starts at the latest switch-off
#   T8  a pending switch-off (the drain) judges nothing
#   T9  an aborted switch-off moves nothing
#   T10 a warning from before the pool is cleared, not executed by pool hands
#   T11 left the pool, game switched off, rejoined: not judged on the pool
#   T12 people and Horses: identical answers
#   and: the migration refuses a drifted pre-image, and a second run is a no-op
#   and: the existing Classic floor proofs (04-06, 08) still hold after it
#
# It NEVER touches production. Skips with 0 when there is no local postgres,
# and says so - a check that cannot run must never read as green.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CLASSIC="$HERE/sql/classic-vpip-floor"
SQLDIR="$HERE/sql/lightning-switch-off-vpip"
MIG="$ROOT/supabase/migrations/20261111003710_the_classic_floor_judges_thirty_dealt_hands_and_warns_before.sql"
MIG2="$ROOT/supabase/migrations/20261111022301_a_classic_rejoin_continues_the_vpip_sitting_and_the_approved.sql"
MIG3="$ROOT/supabase/migrations/20261111093132_the_vpip_sample_reads_only_the_sitting.sql"
FIX="$ROOT/supabase/migrations/20261121152102_a_lightning_switch_off_starts_a_fresh_vpip_sample.sql"

for bin in initdb pg_ctl psql; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "SKIPPED: no local postgres ($bin not on PATH). This proof did not run."
    exit 0
  fi
done
for f in "$MIG" "$MIG2" "$MIG3" "$FIX"; do
  [ -f "$f" ] || { echo "FAIL: migration not found at $f"; exit 1; }
done

export LC_ALL=C LANG=C
TMP="$(mktemp -d)"
cleanup() { pg_ctl -D "$TMP/pgd" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

mkdir -p "$TMP/pgd" "$TMP/sock"
initdb -D "$TMP/pgd" -U postgres -A trust >/dev/null 2>&1 || { echo "FAIL: initdb"; exit 1; }
PORT=$(( 50000 + (RANDOM % 10000) ))
pg_ctl -D "$TMP/pgd" -o "-k $TMP/sock -p $PORT -c listen_addresses=" -l "$TMP/pg.log" start >/dev/null 2>&1
for _ in $(seq 1 20); do
  psql -h "$TMP/sock" -p "$PORT" -U postgres -c 'select 1' >/dev/null 2>&1 && break
  sleep 1
done
PSQL=(psql -h "$TMP/sock" -p "$PORT" -U postgres -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -c 'select 1' >/dev/null 2>&1 || { echo "FAIL: cluster did not start"; tail -5 "$TMP/pg.log"; exit 1; }

# The Classic floor chain, as test-classic-vpip-floor.sh builds it.
"${PSQL[@]}" -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;" >/dev/null || exit 1
"${PSQL[@]}" -f "$CLASSIC/01-fixture.sql"          >/dev/null || { echo "FAIL: fixture"; exit 1; }
"${PSQL[@]}" -f "$CLASSIC/02-old-signatures.sql"   >/dev/null || { echo "FAIL: old signatures"; exit 1; }
"${PSQL[@]}" -f "$CLASSIC/03-apply-ruleset-stub.sql" >/dev/null || { echo "FAIL: ruleset stub"; exit 1; }
"${PSQL[@]}" -f "$MIG" >/dev/null || { echo "FAIL: $MIG"; exit 1; }
"${PSQL[@]}" -c "CREATE TRIGGER zz_cash_game_floor_from_template BEFORE INSERT OR UPDATE ON public.cash_games FOR EACH ROW EXECUTE FUNCTION public.fn_cash_game_floor_from_template();" >/dev/null || exit 1
"${PSQL[@]}" -f "$CLASSIC/07-seed-activation.sql" >/dev/null || { echo "FAIL: activation fixtures"; exit 1; }
"${PSQL[@]}" -f "$MIG2" >/dev/null 2>&1 || { echo "FAIL: $MIG2"; exit 1; }
"${PSQL[@]}" -f "$MIG3" >/dev/null || { echo "FAIL: $MIG3"; exit 1; }

PRE="$("${PSQL[@]}" -t -A -c "select md5(prosrc) from pg_proc where proname='fn_nit_sitting_since'")"
if [ "$PRE" != "5c9907e0e981a6840f8a2f37e4faa9ce" ]; then
  echo "FAIL  the chain's fn_nit_sitting_since is $PRE, not the installed pre-image"; exit 1
fi
echo "PASS  the chain installs the production pre-image of fn_nit_sitting_since"

"${PSQL[@]}" -f "$SQLDIR/10-fixture.sql" >/dev/null || { echo "FAIL: Lightning fixtures"; exit 1; }

RC=0
run() {
  local OUT
  OUT="$("${PSQL[@]}" -f "$1" 2>&1)" || RC=1
  echo "$OUT" | sed -n 's/.*NOTICE:  \(T[0-9]* PASS.*\)/PASS  \1/p'
  if echo "$OUT" | grep -qiE 'ERROR|EXCEPTION'; then
    echo "$OUT" | grep -iE 'ERROR|EXCEPTION' | head -5
    RC=1
  fi
}

run "$SQLDIR/11-snapshot.sql"
[ "$RC" -eq 0 ] || { echo "FAIL  the control did not reproduce the defect"; exit 1; }

# A drifted pre-image is refused, and nothing is changed.
"${PSQL[@]}" -c "ALTER FUNCTION public.fn_nit_sitting_since(uuid,uuid,timestamptz) RENAME TO fn_nit_sitting_since_real;" >/dev/null
"${PSQL[@]}" -c "CREATE FUNCTION public.fn_nit_sitting_since(p_game_id uuid, p_user_id uuid, p_fallback timestamptz) RETURNS timestamptz LANGUAGE sql STABLE AS 'SELECT p_fallback';" >/dev/null
if "${PSQL[@]}" -f "$FIX" >/dev/null 2>&1; then
  echo "FAIL  the migration applied over a drifted fn_nit_sitting_since"; exit 1
fi
"${PSQL[@]}" -c "DROP FUNCTION public.fn_nit_sitting_since(uuid,uuid,timestamptz); ALTER FUNCTION public.fn_nit_sitting_since_real(uuid,uuid,timestamptz) RENAME TO fn_nit_sitting_since;" >/dev/null
echo "PASS  the migration refuses a drifted pre-image"

ACL_BEFORE="$("${PSQL[@]}" -t -A -c "select coalesce(array_to_string(proacl,'|'),'') from pg_proc where proname='fn_nit_sitting_since'")"
"${PSQL[@]}" -f "$FIX" >/dev/null || { echo "FAIL  the migration did not apply over the installed pre-image"; exit 1; }
"${PSQL[@]}" -f "$FIX" >/dev/null || { echo "FAIL  a second run of the migration failed"; exit 1; }
ACL_AFTER="$("${PSQL[@]}" -t -A -c "select coalesce(array_to_string(proacl,'|'),'') from pg_proc where proname='fn_nit_sitting_since'")"
[ "$ACL_BEFORE" = "$ACL_AFTER" ] || { echo "FAIL  grants changed: '$ACL_BEFORE' -> '$ACL_AFTER'"; exit 1; }
echo "PASS  the migration applies, its install-time assertions hold, a second run is a no-op, grants unchanged"

run "$SQLDIR/12-proof.sql"

# The Classic floor's own proofs, against the new window.
"${PSQL[@]}" -c "DELETE FROM public.ca_nit_warnings;" >/dev/null
for f in "$CLASSIC/04-proof-window.sql" "$CLASSIC/05-proof-warning.sql" \
         "$CLASSIC/06-proof-rejoin.sql" "$CLASSIC/08-proof-activation.sql"; do
  run "$f"
done

if [ "$RC" -ne 0 ]; then echo "FAIL  the Lightning switch-off proof did not hold"; exit 1; fi
echo "PASS  every Lightning switch-off VPIP assertion held"
exit 0
