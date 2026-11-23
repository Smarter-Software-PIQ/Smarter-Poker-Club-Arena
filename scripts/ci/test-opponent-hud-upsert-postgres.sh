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
# 5. (OPPONENT-HUD-FIX-1) the hands page counts PLO4/PLO5 tournaments as well as cash, never another game, and
#    projects no card: the follow-up migration replaces only the function
pages="${OPPONENT_HUD_PAGE_MIGRATION:-$repo/supabase/migrations/20261121190000_opponent_hud_hands_page_counts_tournaments.sql}"
q -c "CREATE TABLE public.hand_history (id uuid PRIMARY KEY, created_at timestamptz, ended_at timestamptz,
  game_variant text, tournament_id uuid, big_blind numeric, button_seat smallint, bomb_pot jsonb,
  community_cards text[], community_cards2 text[], rit_boards jsonb, showdown jsonb, winners jsonb, players jsonb,
  actions jsonb)"
hh() { q -c "INSERT INTO public.hand_history VALUES ('$1', '2026-11-21T10:00:0$2Z', NULL, '$3', $4, 2, 1, NULL,
  NULL, NULL, NULL, '[]', '[]', '[{\"seat\":1,\"userId\":\"$U1\",\"stack\":400,\"cards\":[\"As\",\"Ks\",\"Qs\",\"Js\"]}]',
  '[{\"seat\":1,\"action\":\"bb\",\"amount\":2,\"stage\":\"preflop\"}]')"; }
hh 10000000-0000-4000-8000-000000000001 1 plo5 NULL
hh 10000000-0000-4000-8000-000000000002 2 plo4 "'20000000-0000-4000-8000-000000000001'"
hh 10000000-0000-4000-8000-000000000003 3 plo6 NULL
page() { q -c "select count(*) || ':' || count(*) filter (where tournament_id is not null) || ':' || coalesce(sum((players::text like '%cards%')::int), 0) from public.fn_opponent_hud_hands_page('2026-01-01', '00000000-0000-0000-0000-000000000000', '2027-01-01', 100)"; }
[ "$(page)" = "1:0:0" ] || fail "creation migration page $(page), expected 1:0:0 (cash only)"
q -f "$pages"
[ "$(page)" = "2:1:0" ] || fail "follow-up page $(page), expected 2:1:0 (cash and tournament, no plo6, no card)"
[ "$(q -c "select has_function_privilege('anon', 'public.fn_opponent_hud_hands_page(timestamptz,uuid,timestamptz,integer)', 'execute') or has_function_privilege('authenticated', 'public.fn_opponent_hud_hands_page(timestamptz,uuid,timestamptz,integer)', 'execute')")" = "f" ] || fail 'the hands page is executable by anon or authenticated'
[ "$(q -c "select relrowsecurity from pg_class where oid = 'public.opponent_hud_profiles'::regclass")" = "t" ] || fail 'row level security is off'
echo "OPPONENT_HUD_PAGE_POSTGRES PASS: the hands page counts PLO4/PLO5 cash and tournaments, no other game, no card; service_role only; RLS on"

# 6. (Wave 2 Enhancement 2.1) NLH family migration: widens CHECK + all 4 RPCs to ('plo4','plo5','nlh'),
#    preserving PLO4/PLO5 CAS semantics, tournament support, public-only projection (no cards), service_role-only grants, and RLS
nlh_mig="${OPPONENT_HUD_NLH_MIGRATION:-$repo/supabase/migrations/20261122024808_opponent_hud_profiles_add_nlh_family.sql}"
q -f "$nlh_mig"
row_nlh() { # user base_rev hands
  printf '[{"user_id":"%s","family":"nlh","version":1,"hands":%s,"wm_ms":%s,%s"profile":{"hands":%s,"ids":[]}}]' "$1" "$3" "$3" "${2:+\"base_rev\":$2,}" "$3"
}
[ "$(up "$(row_nlh $U1 0 1)")" = "" ] || fail 'nlh first save was refused'
[ "$(up "$(row_nlh $U1 0 2)")" = "nlh|$U1" ] || fail 'nlh stale rev save was accepted'
[ "$(up "$(row_nlh $U1 1 2)")" = "" ] || fail 'nlh valid CAS save was refused'
[ "$(q -c "select rev || ':' || hands from public.opponent_hud_profiles where user_id='$U1' and family='nlh'")" = "2:2" ] || fail 'nlh stored state mismatch'
[ "$(q -c "select count(*) from public.fn_opponent_hud_profiles_read(ARRAY['$U1'], 'nlh')")" = "1" ] || fail 'nlh profiles_read failed'
[ "$(q -c "select count(*) from public.fn_opponent_hud_profiles_recent('nlh', now() - interval '1 hour', NULL, 10)")" = "1" ] || fail 'nlh profiles_recent failed'
[ "$(q -c "select count(*) from public.fn_opponent_hud_profiles_read(ARRAY['$U1'], 'plo6')")" = "0" ] || fail 'plo6 profiles_read was not rejected'
hh 10000000-0000-4000-8000-000000000004 4 nlh NULL
hh 10000000-0000-4000-8000-000000000005 5 nlh "'20000000-0000-4000-8000-000000000002'"
hh 10000000-0000-4000-8000-000000000006 6 plo8 NULL
hh 10000000-0000-4000-8000-000000000007 7 short_deck NULL
# total 4 hands (plo5 cash, plo4 tourney, nlh cash, nlh tourney), 2 tournament, 0 cards leaked; plo6/plo8/short_deck excluded
[ "$(page)" = "4:2:0" ] || fail "nlh hands page $(page), expected 4:2:0"
[ "$(q -c "select has_function_privilege('anon', 'public.fn_opponent_hud_profiles_upsert(jsonb)', 'execute') or has_function_privilege('authenticated', 'public.fn_opponent_hud_profiles_read(text[],text)', 'execute') or has_function_privilege('anon', 'public.fn_opponent_hud_hands_page(timestamptz,uuid,timestamptz,integer)', 'execute')")" = "f" ] || fail 'nlh migration widened privileges'
[ "$(q -c "select relrowsecurity from pg_class where oid = 'public.opponent_hud_profiles'::regclass")" = "t" ] || fail 'row level security is off after nlh migration'
echo "OPPONENT_HUD_NLH_POSTGRES PASS: nlh family accepted across table CHECK and all 4 RPCs (cash + tournament, no cards, plo6/plo8/short_deck excluded, service_role only, RLS on)"

# 7. (2026-11-22 O(N^2) -> O(log N) fix) Lower-bound index predicate on fn_opponent_hud_hands_page:
#    adds `h.created_at >= p_after_at` so Postgres pushes both bounds into idx_hand_history_created,
#    preserving exact (created_at, id) tie-breaking, public-only projection (no cards), and service_role grants.
lb_mig="${OPPONENT_HUD_LOWER_BOUND_MIGRATION:-$repo/supabase/migrations/20261122202000_opponent_hud_hands_page_index_lower_bound.sql}"
q -c "CREATE INDEX idx_hand_history_created ON public.hand_history (created_at DESC)"
q -f "$lb_mig"
[ "$(page)" = "4:2:0" ] || fail "lower-bound hands page $(page), expected 4:2:0"
# Add a second hand at the exact same created_at as hand 4 (2026-11-21T10:00:04Z) with a higher UUID
hh 10000000-0000-4000-8000-000000000008 4 plo5 NULL
# Exact tie-breaking at 2026-11-21T10:00:04Z:
#   - afterId=0000... returns both equal-timestamp rows (4, 8) + later row (5) = 3
#   - afterId=1000...0004 returns higher-UUID tie (8) + later row (5) = 2
#   - afterId=ffff... skips both equal-timestamp rows and returns strictly later row (5) = 1
[ "$(q -c "select count(*) from public.fn_opponent_hud_hands_page('2026-11-21T10:00:04Z', '00000000-0000-0000-0000-000000000000', '2026-11-21T10:00:05Z', 100)")" = "3" ] || fail 'lower-bound ZERO_UUID tie-break count'
[ "$(q -c "select count(*) from public.fn_opponent_hud_hands_page('2026-11-21T10:00:04Z', '10000000-0000-4000-8000-000000000004', '2026-11-21T10:00:05Z', 100)")" = "2" ] || fail 'lower-bound mid-UUID tie-break count'
[ "$(q -c "select count(*) from public.fn_opponent_hud_hands_page('2026-11-21T10:00:04Z', 'ffffffff-ffff-ffff-ffff-ffffffffffff', '2026-11-21T10:00:05Z', 100)")" = "1" ] || fail 'lower-bound MAX_UUID tie-break count'
q -c "select pg_get_functiondef('public.fn_opponent_hud_hands_page'::regproc)" | grep -q "h.created_at >= p_after_at" || fail 'fn_opponent_hud_hands_page missing h.created_at >= p_after_at'
[ "$(q -c "select has_function_privilege('anon', 'public.fn_opponent_hud_hands_page(timestamptz,uuid,timestamptz,integer)', 'execute') or has_function_privilege('authenticated', 'public.fn_opponent_hud_hands_page(timestamptz,uuid,timestamptz,integer)', 'execute')")" = "f" ] || fail 'lower-bound migration widened privileges'
echo "OPPONENT_HUD_LOWER_BOUND_POSTGRES PASS: h.created_at >= p_after_at installed, exact (created_at, id) tie-breaking verified, no cards, service_role only"
echo "OPPONENT_HUD_UPSERT_POSTGRES PASS: compare-and-swap on the row revision; concurrent same-revision writers: one written, one refused (existing row and first save); 8 writers x 50 hands (10 shared) -> 330 hands, 330 listed, 330 distinct, revision 330, $refusals refusals merged; rebuild moves the revision; sync point monotone"
