#!/usr/bin/env bash
# Native proof for migration 20261105183133 (lobby favorites and filters are
# durable account preferences). Builds a throwaway Postgres, applies the
# migration over a fixture shaped like production (same columns, RLS policies
# and grants), and asserts every guarantee as the `authenticated` role through
# auth.uid(), exactly as PostgREST runs a browser's request. Each check raises
# on failure; the script prints a PASS line per check and exits 0 only when
# every one held.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pgbin="${PG_BIN:-${PG17_BINDIR:-/opt/homebrew/opt/postgresql@17/bin}}"
work="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/lobby-favorites.XXXXXX")"
cleanup() { "$pgbin/pg_ctl" -D "$work/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
mkdir "$work/socket"
"$pgbin/initdb" -D "$work/data" -U fixture_admin --auth-local=trust --auth-host=reject --no-locale -E UTF8 >/dev/null
"$pgbin/pg_ctl" -D "$work/data" -l "$work/postgres.log" -o "-h '' -k '$work/socket' -p 57649" -w start >/dev/null
psql=("$pgbin/psql" -X -q -v ON_ERROR_STOP=1 -h "$work/socket" -p 57649 -U fixture_admin -d postgres)

"${psql[@]}" <<'SQL'
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO authenticated, service_role;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
-- Production's definition, verbatim.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, service_role;
GRANT USAGE ON SCHEMA public TO authenticated, service_role;

CREATE TABLE public.tournaments(
  id uuid PRIMARY KEY, schedule_id uuid, club_id uuid, union_id uuid, name text, status text,
  tournament_type text, format_contract text, max_players int, starting_chips int,
  buy_in_amount numeric, satellite_target_id uuid);
CREATE TABLE public.tables(
  id uuid PRIMARY KEY, club_id uuid, cluster_id uuid, name text, status text,
  tournament_id uuid, is_deleted boolean, is_template boolean);
CREATE TABLE public.favorite_tables(user_id uuid, table_id uuid REFERENCES public.tables(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now());
-- The two preference stores with production's columns, policies and grants.
CREATE TABLE public.user_lobby_filters(
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, club_id uuid NOT NULL,
  filters jsonb, updated_at timestamptz, view_prefs jsonb, PRIMARY KEY (user_id, club_id));
CREATE TABLE public.user_page_preferences(
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  preference_key text NOT NULL, value jsonb NOT NULL, PRIMARY KEY (user_id, preference_key));
ALTER TABLE public.user_lobby_filters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_page_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_lobby_filters_select_own ON public.user_lobby_filters FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY user_lobby_filters_insert_own ON public.user_lobby_filters FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_lobby_filters_update_own ON public.user_lobby_filters FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY user_lobby_filters_delete_own ON public.user_lobby_filters FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY own_page_preference_read ON public.user_page_preferences FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY own_page_preference_insert ON public.user_page_preferences FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY own_page_preference_update ON public.user_page_preferences FOR UPDATE TO authenticated USING (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_lobby_filters TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.user_page_preferences TO authenticated;
GRANT ALL ON public.user_lobby_filters, public.user_page_preferences TO service_role;

INSERT INTO auth.users VALUES ('aaaaaaaa-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-000000000002');

-- Clubs C1, C2. Schedules S1 (Nightly 10K) and S2 (a different event that
-- happens to share its name and settings).
INSERT INTO tournaments(id, schedule_id, club_id, name, status, tournament_type, format_contract, max_players, buy_in_amount) VALUES
 ('11111111-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','Nightly 10K','COMPLETED','MTT','mtt-v2',null,10),
 ('11111111-0000-4000-8000-000000000005','51000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','Nightly 10K','COMPLETED','MTT','mtt-v2',null,10),
 ('11111111-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','Nightly 10K','REGISTERING','MTT','mtt-v2',null,10),
 ('11111111-0000-4000-8000-000000000003','52000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001','Nightly 10K','REGISTERING','MTT','mtt-v2',null,10);
-- Engine boards: NLH Heads-Up 1 in C1 and in C2; another buy-in in C1; and a
-- club's own one-off that reuses the board's exact name (no engine format).
INSERT INTO tournaments(id, club_id, name, status, tournament_type, format_contract, max_players, starting_chips, buy_in_amount) VALUES
 ('22222222-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','NLH Heads-Up 1','REGISTERING','SNG','sng-v1',2,1500,1),
 ('22222222-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002','NLH Heads-Up 1','REGISTERING','SNG','sng-v1',2,1500,1),
 ('22222222-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000001','NLH Heads-Up 5','REGISTERING','SNG','sng-v1',2,1500,5),
 ('22222222-0000-4000-8000-000000000004','c1000000-0000-4000-8000-000000000001','NLH Heads-Up 1','REGISTERING','SNG',null,2,1500,1),
 ('22222222-0000-4000-8000-000000000005','c1000000-0000-4000-8000-000000000001','1 Chip Spin NLH','REGISTERING','SPIN','spin-v1',3,500,1);
-- Satellite into tonight's run of S1, and one of the same name and format into S2.
INSERT INTO tournaments(id, club_id, name, status, tournament_type, format_contract, max_players, buy_in_amount, satellite_target_id) VALUES
 ('33333333-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','Nightly 10K Satellite','RUNNING','SNG','sng-v1',9,1,'11111111-0000-4000-8000-000000000002'),
 ('33333333-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000001','Nightly 10K Satellite','RUNNING','SNG','sng-v1',9,1,'11111111-0000-4000-8000-000000000003');
-- Cash: game G1 (a closed table and its rebuild), G2 a different game whose
-- table shares the name, G3 the same name in another club.
INSERT INTO tables(id, club_id, cluster_id, name, status) VALUES
 ('44444444-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001','PLO5 2/5 Madness','closed'),
 ('44444444-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001','PLO5 2/5 Madness','waiting'),
 ('44444444-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000002','PLO5 2/5 Madness','waiting'),
 ('44444444-0000-4000-8000-000000000004','c2000000-0000-4000-8000-000000000002','9a000000-0000-4000-8000-000000000003','PLO5 2/5 Madness','running');

-- Legacy stars for A: the closed table, two runs of the same schedule (one
-- duplicate), a missing tournament and an unreadable entry (both unresolved).
INSERT INTO favorite_tables(user_id, table_id) VALUES ('aaaaaaaa-0000-4000-8000-000000000001','44444444-0000-4000-8000-000000000001');
INSERT INTO user_page_preferences VALUES ('aaaaaaaa-0000-4000-8000-000000000001','lobby-tournament-favorites:global',
  '["11111111-0000-4000-8000-000000000001","11111111-0000-4000-8000-000000000005","99999999-0000-4000-8000-000000000009","not-a-uuid"]');
INSERT INTO user_lobby_filters VALUES ('aaaaaaaa-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001',
  '{"HOLDEM":{"seatMax":6},"OMAHA":{"seatMax":4}}', now(), '{"tab":"OMAHA","favoritesOnly":true}');
SQL

"${psql[@]}" -f "$repo/supabase/migrations/20261105183133_lobby_favorites_follow_the_game_not_the_row.sql"

"${psql[@]}" <<'SQL'
CREATE FUNCTION pg_temp.check(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', what; END IF; RAISE NOTICE 'PASS: %', what; END $$;
-- Ids of live games currently STARRED for the caller.
CREATE FUNCTION pg_temp.stars() RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(game_id::text, ',' ORDER BY game_id::text), '')
    FROM public.fn_my_lobby_favorites() WHERE active $$;
CREATE FUNCTION pg_temp.has(id text) RETURNS boolean LANGUAGE sql AS $$ SELECT position(id in pg_temp.stars()) > 0 $$;
CREATE FUNCTION pg_temp.rev(id text) RETURNS bigint LANGUAGE sql AS $$
  SELECT coalesce(max(revision), 0) FROM public.fn_my_lobby_favorites() WHERE game_id::text = id $$;
CREATE FUNCTION pg_temp.fav(kind text, id text, on_ boolean, base bigint) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.fn_set_lobby_favorites(jsonb_build_array(jsonb_build_object(
    'kind', kind, 'game_id', id, 'on', on_, 'base', base)))->'results'->0 $$;
CREATE FUNCTION pg_temp.lobby(changes jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.fn_save_lobby_preferences('c1000000-0000-4000-8000-000000000001', changes) $$;
CREATE FUNCTION pg_temp.lrev(field text) RETURNS bigint LANGUAGE sql AS $$
  SELECT coalesce((revisions->>field)::bigint, 0) FROM public.user_lobby_filters
   WHERE user_id = auth.uid() AND club_id = 'c1000000-0000-4000-8000-000000000001' $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, service_role;

-- ═══ MIGRATION OF LEGACY FAVORITES ══════════════════════════════════════════
SELECT pg_temp.check((SELECT count(*) FROM lobby_favorites_migration_report WHERE outcome = 'mapped') = 2
  AND (SELECT count(*) FROM lobby_favorites_migration_report WHERE outcome = 'duplicate') = 1
  AND (SELECT count(*) FROM lobby_favorites_migration_report WHERE outcome = 'unresolved') = 2,
  'migration report: 2 mapped, 1 duplicate consolidated, 2 unresolved recorded');
SELECT pg_temp.check((SELECT value FROM user_page_preferences WHERE preference_key = 'lobby-tournament-favorites:global')
  = '["11111111-0000-4000-8000-000000000001","11111111-0000-4000-8000-000000000005","99999999-0000-4000-8000-000000000009","not-a-uuid"]'::jsonb
  AND (SELECT count(*) FROM favorite_tables) = 1, 'legacy sources are left exactly as they were');

SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';
SELECT pg_temp.check(pg_temp.stars() = '11111111-0000-4000-8000-000000000002,44444444-0000-4000-8000-000000000002',
  'carried-over stars light tonight''s run and the rebuilt table, nothing else');

-- ═══ IDENTITY THROUGH THE LIFECYCLE ═════════════════════════════════════════
RESET ROLE;
-- A schedule edit (rename and new buy-in on its runs) is the same recurring game.
UPDATE tournaments SET name = 'Nightly 15K', buy_in_amount = 15 WHERE schedule_id = '51000000-0000-4000-8000-000000000001';
UPDATE tables SET name = 'PLO5 2/5 Classic' WHERE cluster_id = '9a000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
SELECT pg_temp.check(pg_temp.has('11111111-0000-4000-8000-000000000002') AND pg_temp.has('44444444-0000-4000-8000-000000000002'),
  'editing the schedule and renaming the cash game keep both stars');
SELECT pg_temp.check(NOT pg_temp.has('11111111-0000-4000-8000-000000000003'),
  'a different schedule with the same name and settings stays separate');
SELECT pg_temp.check(NOT pg_temp.has('44444444-0000-4000-8000-000000000003') AND NOT pg_temp.has('44444444-0000-4000-8000-000000000004'),
  'same-named tables of another cash game or another club stay separate');

-- Engine boards.
SELECT pg_temp.check((pg_temp.fav('tournament', '22222222-0000-4000-8000-000000000001', true, 0))->>'status' = 'applied',
  'starring a Sit N Go board applies');
RESET ROLE;
UPDATE tournaments SET status = 'COMPLETED' WHERE id = '22222222-0000-4000-8000-000000000001';
INSERT INTO tournaments(id, club_id, name, status, tournament_type, format_contract, max_players, starting_chips, buy_in_amount) VALUES
 ('22222222-0000-4000-8000-000000000009','c1000000-0000-4000-8000-000000000001','NLH Heads-Up 1','REGISTERING','SNG','sng-v1',2,300,1);
SET ROLE authenticated;
SELECT pg_temp.check(pg_temp.has('22222222-0000-4000-8000-000000000009'),
  'the board''s next game inherits the star, even after its stack was edited');
SELECT pg_temp.check(NOT pg_temp.has('22222222-0000-4000-8000-000000000002'), 'the same board name in another club stays separate');
SELECT pg_temp.check(NOT pg_temp.has('22222222-0000-4000-8000-000000000003'), 'a board at another buy-in stays separate');
SELECT pg_temp.check(NOT pg_temp.has('22222222-0000-4000-8000-000000000004'),
  'a club''s own one-off reusing the board''s exact name and settings does not inherit');
SELECT pg_temp.check((pg_temp.fav('tournament', '22222222-0000-4000-8000-000000000005', true, 0))->>'status' = 'applied'
  AND pg_temp.has('22222222-0000-4000-8000-000000000005'), 'a Spin board can be starred');
-- Renaming a board in the catalogue needs an explicit alias.
RESET ROLE;
UPDATE tournaments SET status = 'COMPLETED' WHERE id = '22222222-0000-4000-8000-000000000005';
INSERT INTO tournaments(id, club_id, name, status, tournament_type, format_contract, max_players, starting_chips, buy_in_amount) VALUES
 ('22222222-0000-4000-8000-000000000006','c1000000-0000-4000-8000-000000000001','1 Chip Turbo Spin NLH','REGISTERING','SPIN','spin-v1',3,500,1);
SET ROLE authenticated;
SELECT pg_temp.check(NOT pg_temp.has('22222222-0000-4000-8000-000000000006'), 'a renamed board does not inherit by guesswork');
RESET ROLE;
INSERT INTO lobby_game_aliases(old_key, new_key, reason) VALUES (
  'board:c1000000-0000-4000-8000-000000000001::SPIN:1 Chip Spin NLH',
  'board:c1000000-0000-4000-8000-000000000001::SPIN:1 Chip Turbo Spin NLH', 'catalogue rename (fixture)');
SET ROLE authenticated;
SELECT pg_temp.check(pg_temp.has('22222222-0000-4000-8000-000000000006'), 'with its alias, the renamed board keeps the star');

-- Satellites follow the recurring event they feed.
SELECT pg_temp.check((pg_temp.fav('tournament', '33333333-0000-4000-8000-000000000001', true, 0))->>'status' = 'applied',
  'starring a satellite applies');
RESET ROLE;
UPDATE tournaments SET status = 'COMPLETED' WHERE id IN ('33333333-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000002');
INSERT INTO tournaments(id, schedule_id, club_id, name, status, tournament_type, format_contract) VALUES
 ('11111111-0000-4000-8000-000000000004','51000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','Nightly 15K','ANNOUNCED','MTT','mtt-v2');
INSERT INTO tournaments(id, club_id, name, status, tournament_type, format_contract, max_players, buy_in_amount, satellite_target_id) VALUES
 ('33333333-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001','Nightly 15K Satellite','REGISTERING','SNG','sng-v1',9,1,'11111111-0000-4000-8000-000000000004');
SET ROLE authenticated;
SELECT pg_temp.check(pg_temp.has('33333333-0000-4000-8000-000000000002'),
  'tomorrow''s satellite into the same recurring event inherits the star, renamed or not');
SELECT pg_temp.check(NOT pg_temp.has('33333333-0000-4000-8000-000000000003'),
  'a same-named satellite into a different event stays separate');

-- Cash: a new game definition is a different game unless an alias says so.
RESET ROLE;
UPDATE tables SET status = 'closed' WHERE cluster_id = '9a000000-0000-4000-8000-000000000001';
INSERT INTO tables(id, club_id, cluster_id, name, status) VALUES
 ('44444444-0000-4000-8000-000000000005','c1000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001','PLO5 2/5 Classic','waiting'),
 ('44444444-0000-4000-8000-000000000006','c1000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000009','PLO5 2/5 Classic','waiting');
DELETE FROM tables WHERE id = '44444444-0000-4000-8000-000000000001';
SET ROLE authenticated;
SELECT pg_temp.check(pg_temp.has('44444444-0000-4000-8000-000000000005'),
  'a cash game rebuilt after its old table was deleted lights again');
SELECT pg_temp.check(NOT pg_temp.has('44444444-0000-4000-8000-000000000006'),
  'a new cash game reusing the old name does not inherit');

-- Unavailable is not unstarred.
RESET ROLE;
UPDATE tables SET status = 'closed' WHERE cluster_id = '9a000000-0000-4000-8000-000000000001';
UPDATE tournaments SET status = 'COMPLETED' WHERE schedule_id = '51000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
SELECT pg_temp.check(NOT pg_temp.has('44444444') AND
  (SELECT count(*) FROM player_lobby_favorites WHERE active) = 5,
  'with nothing live the saved favorites all remain selected');
RESET ROLE;
INSERT INTO tournaments(id, schedule_id, club_id, name, status, tournament_type, format_contract) VALUES
 ('11111111-0000-4000-8000-000000000006','51000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','Nightly 15K','ANNOUNCED','MTT','mtt-v2');
SET ROLE authenticated;
SELECT pg_temp.check(pg_temp.has('11111111-0000-4000-8000-000000000006'), 'the schedule''s next run lights again');

-- ═══ SERVER REVISIONS: STALE STATE NEVER REPLACES NEWER ACCEPTED STATE ═════
-- Device A last saw the Spin board unstarred-by-no-one? It is starred (rev r).
-- An older offline star cannot come back after a later unfavorite.
DO $$
DECLARE r bigint := pg_temp.rev('22222222-0000-4000-8000-000000000006'); res jsonb;
BEGIN
  res := pg_temp.fav('tournament', '22222222-0000-4000-8000-000000000006', false, r);   -- unfavorite now
  PERFORM pg_temp.check(res->>'status' = 'applied', 'unfavorite against the current revision applies');
  res := pg_temp.fav('tournament', '22222222-0000-4000-8000-000000000006', true, r);    -- offline star made before it
  PERFORM pg_temp.check(res->>'status' = 'conflict' AND (res->>'active')::boolean = false,
    'an older offline star is refused after the unfavorite, and the reply says it is unstarred');
  PERFORM pg_temp.check(NOT pg_temp.has('22222222-0000-4000-8000-000000000006'), 'the unfavorite stands');
  res := pg_temp.fav('tournament', '22222222-0000-4000-8000-000000000006', true, 0);    -- a device that never saw it
  PERFORM pg_temp.check(res->>'status' = 'conflict', 'a device that never saw the unfavorite cannot override it either');
END $$;
SELECT pg_temp.check((SELECT count(*) FROM player_lobby_favorites WHERE NOT active) = 1,
  'the unfavorite is kept as a record with its revision');
-- Duplicate retries and out-of-order replies.
DO $$
DECLARE r bigint := pg_temp.rev('22222222-0000-4000-8000-000000000003'); a jsonb; b jsonb;
BEGIN
  a := pg_temp.fav('tournament', '22222222-0000-4000-8000-000000000003', true, r);
  b := pg_temp.fav('tournament', '22222222-0000-4000-8000-000000000003', true, r);   -- the same request again
  PERFORM pg_temp.check(a->>'status' = 'applied' AND b->>'status' = 'conflict'
    AND (b->>'active')::boolean = true AND pg_temp.has('22222222-0000-4000-8000-000000000003'),
    'a duplicate retry changes nothing and reports the already-saved value');
END $$;

-- Filters: per-field, against the revision each device saw.
DO $$
DECLARE r jsonb; h bigint; t bigint;
BEGIN
  r := pg_temp.lobby('[{"field":"filters.HOLDEM","value":{"seatMax":9},"base":null}]');
  PERFORM pg_temp.check(r->'results'->0->>'status' = 'applied' AND (r->'filters'->'OMAHA'->>'seatMax') = '4'
    AND (r->'view_prefs'->>'tab') = 'OMAHA',
    'a change to one filter applies and leaves every other saved setting as it was');
  h := pg_temp.lrev('filters.HOLDEM');
  -- Device B (another tab) saw rev h and changes Hold'em; device A replays a snapshot made against nothing.
  r := pg_temp.lobby(jsonb_build_array(jsonb_build_object('field','filters.HOLDEM','value','{"seatMax":2}'::jsonb,'base',h)));
  PERFORM pg_temp.check(r->'results'->0->>'status' = 'applied', 'a change made against the current revision applies');
  r := pg_temp.lobby(jsonb_build_array(jsonb_build_object('field','filters.HOLDEM','value','{"seatMax":6}'::jsonb,'base',h)));
  PERFORM pg_temp.check(r->'results'->0->>'status' = 'conflict' AND (r->'results'->0->'value'->>'seatMax') = '2',
    'an older filter snapshot is refused and the reply carries the newer value');
  r := pg_temp.lobby('[{"field":"filters.HOLDEM","value":{"seatMax":7},"base":null}]');
  PERFORM pg_temp.check(r->'results'->0->>'status' = 'conflict',
    'a change with no known revision never overwrites an already-saved field');
  t := pg_temp.lrev('view.tab');
  r := pg_temp.lobby(jsonb_build_array(
    jsonb_build_object('field','filters.HOLDEM','value','{"seatMax":5}'::jsonb,'base',h),
    jsonb_build_object('field','view.tab','value','"MTT"'::jsonb,'base',t),
    jsonb_build_object('field','view.sort.MTT','value','"players"'::jsonb,'base',0)));
  PERFORM pg_temp.check(r->'results'->0->>'status' = 'conflict' AND r->'results'->1->>'status' = 'applied'
    AND r->'results'->2->>'status' = 'applied' AND (r->'view_prefs'->>'tab') = 'MTT'
    AND (r->'view_prefs'->'sortByTab'->>'MTT') = 'players' AND (r->'filters'->'HOLDEM'->>'seatMax') = '2'
    AND (r->'view_prefs'->>'favoritesOnly') = 'true',
    'in one save a stale field is refused while fresh ones apply, and untouched ones stay');
  r := pg_temp.lobby('[{"field":"filters.HOLDEM; drop table x","value":1,"base":0}]');
  PERFORM pg_temp.check(r->'results'->0->>'status' = 'invalid', 'an unknown field is refused');
END $$;

-- Page preferences: the same rule.
DO $$
DECLARE r jsonb; v bigint;
BEGIN
  r := public.fn_save_page_preferences('[{"field":"lobby-all-status:global","value":"running","base":0}]');
  PERFORM pg_temp.check(r->'results'->0->>'status' = 'applied', 'a page preference saves');
  v := (r->'results'->0->>'revision')::bigint;
  r := public.fn_save_page_preferences('[{"field":"lobby-all-status:global","value":"open","base":0}]');
  PERFORM pg_temp.check(r->'results'->0->>'status' = 'conflict' AND r->'results'->0->>'value' = 'running',
    'an older page preference is refused and the newer value returned');
  r := public.fn_save_page_preferences(jsonb_build_array(jsonb_build_object('field','lobby-all-status:global','value','"open"'::jsonb,'base',v)));
  PERFORM pg_temp.check(r->'results'->0->>'status' = 'applied', 'a page preference made against the current revision applies');
END $$;

-- ═══ ACCOUNTS AND OWNERSHIP ════════════════════════════════════════════════
-- Another account acts only on itself.
SET request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
SELECT pg_temp.check((SELECT count(*) FROM player_lobby_favorites) = 0 AND (SELECT count(*) FROM user_lobby_filters) = 0,
  'another account cannot see A''s favorites or filters');
SELECT pg_temp.lobby('[{"field":"filters.HOLDEM","value":{"seatMax":3},"base":null}]');
SELECT pg_temp.fav('tournament', '22222222-0000-4000-8000-000000000003', false, 0);
RESET ROLE;
SELECT pg_temp.check(
  (SELECT filters->'HOLDEM'->>'seatMax' FROM user_lobby_filters WHERE user_id = 'aaaaaaaa-0000-4000-8000-000000000001') = '2'
  AND (SELECT active FROM player_lobby_favorites WHERE user_id = 'aaaaaaaa-0000-4000-8000-000000000001'
        AND game_key LIKE '%:NLH Heads-Up 5') = true
  AND (SELECT count(*) FROM user_lobby_filters WHERE user_id = 'bbbbbbbb-0000-4000-8000-000000000002') = 1,
  'a change sent under account B lands only on account B');

-- Direct table writes from a browser are refused; only the functions write.
SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';
DO $$ BEGIN UPDATE public.user_lobby_filters SET filters = '{}'; RAISE EXCEPTION 'not refused';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN INSERT INTO public.user_page_preferences VALUES (auth.uid(), 'x', '1'); RAISE EXCEPTION 'not refused';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN INSERT INTO public.player_lobby_favorites(user_id, kind, game_key, revision) VALUES (auth.uid(), 'cash', 'x', 1);
  RAISE EXCEPTION 'not refused'; EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN DELETE FROM public.user_lobby_filters; RAISE EXCEPTION 'not refused';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
SELECT pg_temp.check(true, 'a browser cannot write, overwrite or delete the stores directly');

-- Service paths (a service_role key carries no user) cannot change or erase them.
RESET ROLE;
SET ROLE service_role;
SET request.jwt.claim.sub = '';
DO $$ BEGIN UPDATE public.user_lobby_filters SET filters = '{}'; RAISE EXCEPTION 'not refused'; EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%written only by its owner%' THEN NULL; ELSE RAISE; END IF; END $$;
DO $$ BEGIN DELETE FROM public.user_page_preferences; RAISE EXCEPTION 'not refused'; EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%only by deleting the account%' THEN NULL; ELSE RAISE; END IF; END $$;
DO $$ BEGIN TRUNCATE public.user_lobby_filters; RAISE EXCEPTION 'not refused'; EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%cannot be truncated%' THEN NULL; ELSE RAISE; END IF; END $$;
DO $$ BEGIN PERFORM public.fn_save_lobby_preferences('c1000000-0000-4000-8000-000000000001', '[]'); RAISE EXCEPTION 'not refused';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%sign in%' OR SQLSTATE = '42501' THEN NULL; ELSE RAISE; END IF; END $$;
SELECT pg_temp.check(true, 'service paths cannot rewrite, delete, truncate or save on behalf of a player');
RESET ROLE;
-- Even a superuser delete is refused while the account exists.
DO $$ BEGIN DELETE FROM public.player_lobby_favorites; RAISE EXCEPTION 'not refused'; EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%only by deleting the account%' THEN NULL; ELSE RAISE; END IF; END $$;
SELECT pg_temp.check(true, 'no delete removes a live account''s favorites, not even a cleanup run as the database owner');

-- Deleting the account takes everything with it.
DELETE FROM auth.users WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001';
SELECT pg_temp.check(
  (SELECT count(*) FROM player_lobby_favorites WHERE user_id = 'aaaaaaaa-0000-4000-8000-000000000001') = 0
  AND (SELECT count(*) FROM user_lobby_filters WHERE user_id = 'aaaaaaaa-0000-4000-8000-000000000001') = 0
  AND (SELECT count(*) FROM user_page_preferences WHERE user_id = 'aaaaaaaa-0000-4000-8000-000000000001') = 0
  AND (SELECT count(*) FROM user_lobby_filters WHERE user_id = 'bbbbbbbb-0000-4000-8000-000000000002') = 1,
  'deleting the account removes its preferences and nobody else''s');
SQL
echo "lobby favorites native proof: all checks passed"
