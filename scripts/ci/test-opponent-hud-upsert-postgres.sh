#!/usr/bin/env bash
# OPPONENT HUD, MORE THAN ONE WRITER (2026-11-21, lane OPPONENT-HUD-5). Owner order: the HUD helpers never break,
# regress or miscount. A profile row is written whole and more than one engine process can hold the same player (a
# cutover overlap, a standby, the backfill under a live engine), so the write must be a compare-and-swap on the row
# revision INSIDE the database. Proven by execution on a THROWAWAY PostgreSQL 17 with the repository's migration
# (supabase/migrations/20261120223000_opponent_hud_profiles.sql):
#  1. a save built on the stored revision is written and moves the revision; one built on an older revision, one
#     with no revision, and a first save that finds a row already there are refused and change nothing;
#  2. two sessions that save the same row from the same revision at the same time: exactly one is written (the
#     second waits for the first to commit, then is refused), for an existing row and for a first save alike;
#  3. EIGHT concurrent writers each count 40 hands of their own and 10 hands that every writer counts, into one row,
#     by read / add-what-the-row-does-not-list / save / on refusal read again: the row ends with every one of the
#     330 distinct hands exactly once (no lost update, no double count), and its revision equals the number of
#     accepted saves;
#  4. rebuild=true replaces the row and moves the revision (a holder of the old row is refused next); the sync point
#     and the population rows take the later watermark only; a batch is applied in key order.
# It never touches a real database. A proof that did not run is not a pass: no PostgreSQL binaries is a failure.
set -euo pipefail
export LC_ALL=C
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
migration="${OPPONENT_HUD_MIGRATION:-$repo/supabase/migrations/20261120223000_opponent_hud_profiles.sql}"
pgbin="${PG17_BINDIR:-}"
if [ -z "$pgbin" ]; then
  for c in /opt/homebrew/opt/postgresql@17/bin /usr/lib/postgresql/17/bin "$(dirname "$(command -v initdb 2>/dev/null || echo /nonexistent/x)")"; do
    if [ -x "$c/initdb" ]; then pgbin="$c"; break; fi
  done
fi
[ -n "$pgbin" ] && [ -x "$pgbin/initdb" ] || { echo 'OPPONENT_HUD_UPSERT_POSTGRES FAIL: no PostgreSQL binaries' >&2; exit 1; }
work="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/ohud.XXXXXX")"
trap '"$pgbin/pg_ctl" -D "$work/data" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$work"' EXIT
sock="$(mktemp -d /tmp/ohud.XXXXXX)"
trap '"$pgbin/pg_ctl" -D "$work/data" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$work" "$sock"' EXIT
"$pgbin/initdb" -D "$work/data" -U postgres --auth=trust --no-locale -E UTF8 >/dev/null
"$pgbin/pg_ctl" -D "$work/data" -l "$work/postgres.log" -o "-c listen_addresses='' -k '$sock' -c max_connections=40" -w start >/dev/null || { tail -5 "$work/postgres.log" >&2; exit 1; }
q() { "$pgbin/psql" -X -q -t -A -v ON_ERROR_STOP=1 -h "$sock" -U postgres -d postgres "$@"; }
q -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;"
q -f "$migration"
fail() { echo "OPPONENT_HUD_UPSERT_POSTGRES FAIL: $*" >&2; exit 1; }
U1=00000000-0000-4000-8000-000000000001
row() { # user base_rev hands [extra json members]
  printf '[{"user_id":"%s","family":"plo5","version":1,"hands":%s,"wm_ms":%s,%s"profile":{"hands":%s,"ids":[]}}]' "$1" "$3" "$3" "${2:+\"base_rev\":$2,}" "$3"
}
up() { q -c "select coalesce(array_to_string(public.fn_opponent_hud_profiles_upsert('$1'::jsonb), ','), '')"; }
state() { q -c "select rev || ':' || hands from public.opponent_hud_profiles where user_id='$1' and family='plo5'"; }

# 1. sequential compare-and-swap
[ "$(up "$(row $U1 0 1)")" = "" ] || fail 'a first save was refused'
[ "$(state $U1)" = "1:1" ] || fail "first save state $(state $U1)"
[ "$(up "$(row $U1 0 9)")" = "plo5|$U1" ] || fail 'a first save over an existing row was accepted'
[ "$(up "$(row $U1 1 2)")" = "" ] || fail 'a save on the stored revision was refused'
[ "$(state $U1)" = "2:2" ] || fail "state after save $(state $U1)"
[ "$(up "$(row $U1 1 50)")" = "plo5|$U1" ] || fail 'a save on an OLD revision with MORE hands was accepted (lost update)'
[ "$(up "$(row $U1 '' 50)")" = "plo5|$U1" ] || fail 'a save without a revision was accepted'
[ "$(state $U1)" = "2:2" ] || fail "a refused save changed the row: $(state $U1)"

# 2. two sessions, same revision, same moment (existing row, then a first save)
race() { # user base expect-final-rev
  ( q -c "begin; select public.fn_opponent_hud_profiles_upsert('$(row "$1" "$2" 100)'::jsonb); select pg_sleep(1.5); commit;" >/dev/null ) &
  sleep 0.5
  second="$(up "$(row "$1" "$2" 200)")"
  wait
  [ "$second" = "plo5|$1" ] || fail "the second concurrent writer was not refused ($1)"
  [ "$(state "$1")" = "$3:100" ] || fail "concurrent writers left $(state "$1"), expected $3:100"
}
race $U1 2 3
race 00000000-0000-4000-8000-000000000002 0 1

# 3. eight writers, one row, every hand exactly once
U3=00000000-0000-4000-8000-000000000003
writer() {
  q -c "DO \$\$
DECLARE i int; hid text; cur record; prof jsonb; refused text[]; tries int;
BEGIN
  FOR i IN 1..50 LOOP
    hid := CASE WHEN i <= 10 THEN 'shared-' || i ELSE 'w$1-' || i END;
    tries := 0;
    LOOP
      tries := tries + 1;
      IF tries > 2000 THEN RAISE EXCEPTION 'writer $1 starved'; END IF;
      SELECT rev, profile INTO cur FROM public.opponent_hud_profiles WHERE user_id = '$U3' AND family = 'plo5';
      IF FOUND AND cur.profile->'ids' ? hid THEN EXIT; END IF;  -- the stored row already counts this hand
      prof := CASE WHEN FOUND THEN cur.profile ELSE '{\"hands\":0,\"ids\":[]}'::jsonb END;
      prof := jsonb_build_object('hands', (prof->>'hands')::int + 1, 'ids', (prof->'ids') || to_jsonb(hid));
      refused := public.fn_opponent_hud_profiles_upsert(jsonb_build_array(jsonb_build_object(
        'user_id', '$U3', 'family', 'plo5', 'version', 1, 'hands', (prof->>'hands')::int, 'wm_ms', (prof->>'hands')::int,
        'base_rev', CASE WHEN FOUND THEN cur.rev ELSE 0 END, 'profile', prof)));
      COMMIT;
      EXIT WHEN coalesce(cardinality(refused), 0) = 0;
      INSERT INTO hud_proof_refusals VALUES ($1);
      COMMIT;
    END LOOP;
  END LOOP;
END \$\$;"
}
q -c "CREATE TABLE hud_proof_refusals (w int)"
pids=()
for w in 1 2 3 4 5 6 7 8; do writer $w & pids+=($!); done
for p in "${pids[@]}"; do wait "$p" || fail 'a concurrent writer failed'; done
got="$(q -c "select hands || ':' || jsonb_array_length(profile->'ids') || ':' || (select count(distinct x) from jsonb_array_elements_text(profile->'ids') x) || ':' || rev from public.opponent_hud_profiles where user_id='$U3'")"
[ "$got" = "330:330:330:330" ] || fail "eight writers left hands:listed:distinct:rev = $got, expected 330:330:330:330"
refusals="$(q -c "select count(*) from hud_proof_refusals")"
[ "$refusals" -gt 0 ] || fail 'the eight writers never collided: the proof did not exercise a refusal'

# 4. rebuild, sync point, population row, batch order
[ "$(up "$(row $U1 '' 7 | sed 's/"profile"/"rebuild":true,"profile"/')")" = "" ] || fail 'a rebuild was refused'
[ "$(state $U1)" = "4:7" ] || fail "rebuild state $(state $U1)"
[ "$(up "$(row $U1 3 8)")" = "plo5|$U1" ] || fail 'a holder of the row before the rebuild was not refused'
[ "$(up "$(row '#sync' '' 500)")" = "" ] || fail 'the sync point was refused'
[ "$(up "$(row '#sync' '' 400)")" = "plo5|#sync" ] || fail 'the sync point moved backwards'
[ "$(up "$(row '#sync' '' 600)")" = "" ] || fail 'a later sync point was refused'
[ "$(q -c "select wm_ms from public.opponent_hud_profiles where user_id='#sync'")" = "600" ] || fail 'sync point value'
both="$(up "[$(row 00000000-0000-4000-8000-00000000000b 0 1 | sed 's/^\[//;s/\]$//'),$(row 00000000-0000-4000-8000-00000000000a 0 1 | sed 's/^\[//;s/\]$//')]")"
[ "$both" = "" ] || fail 'a two-row batch was refused'
[ "$(q -c "select has_function_privilege('anon', 'public.fn_opponent_hud_profiles_upsert(jsonb)', 'execute') or has_table_privilege('authenticated', 'public.opponent_hud_profiles', 'select') or has_table_privilege('service_role', 'public.opponent_hud_profiles', 'insert')")" = "f" ] || fail 'privileges widened'
echo "OPPONENT_HUD_UPSERT_POSTGRES PASS: compare-and-swap on the row revision; concurrent same-revision writers: one written, one refused (existing row and first save); 8 writers x 50 hands (10 shared) -> 330 hands, 330 listed, 330 distinct, revision 330, $refusals refusals merged; rebuild moves the revision; sync point monotone"
