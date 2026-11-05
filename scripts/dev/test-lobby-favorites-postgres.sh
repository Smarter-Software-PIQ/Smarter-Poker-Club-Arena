#!/usr/bin/env bash
# Native proof for migration 20261105183133 (lobby favorites and filters are
# durable account preferences). Builds a throwaway Postgres, applies the
# migration over a fixture shaped like production, and asserts every guarantee
# as the `authenticated` role through auth.uid(), the same way PostgREST runs.
# Each check raises on failure; the script prints PASS lines and exits 0 only
# when every one held.
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
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
-- Production's definition, verbatim.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

CREATE TABLE public.tournaments(
  id uuid PRIMARY KEY, schedule_id uuid, club_id uuid, union_id uuid, name text, status text,
  tournament_type text, game_type text, variant text, buy_in_amount numeric, buy_in_fee numeric,
  max_players int, table_size int, blind_speed text, starting_chips int, spin_type text,
  is_premium_spin boolean, is_bounty boolean, is_pko boolean, is_mystery_bounty boolean,
  is_rebuy boolean, is_reentry boolean, add_on_available boolean, is_vip_only boolean,
  is_private boolean, satellite_target_id uuid);
CREATE TABLE public.tables(
  id uuid PRIMARY KEY, club_id uuid, cluster_id uuid, name text, status text,
  tournament_id uuid, is_deleted boolean, is_template boolean);
CREATE TABLE public.favorite_tables(user_id uuid, table_id uuid);
-- The two preference stores, with production's columns, RLS and grants.
CREATE TABLE public.user_lobby_filters(
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, club_id uuid NOT NULL,
  filters jsonb, updated_at timestamptz, view_prefs jsonb, PRIMARY KEY (user_id, club_id));
CREATE TABLE public.user_page_preferences(
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  preference_key text NOT NULL, value jsonb NOT NULL, PRIMARY KEY (user_id, preference_key));
ALTER TABLE public.user_lobby_filters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_page_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON public.user_lobby_filters FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY own ON public.user_page_preferences FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_lobby_filters, public.user_page_preferences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_lobby_filters, public.user_page_preferences TO service_role;
GRANT USAGE ON SCHEMA public TO authenticated, service_role;

-- Accounts: A and B are players, C has no preferences.
INSERT INTO auth.users VALUES ('aaaaaaaa-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-000000000002'), ('cccccccc-0000-4000-8000-000000000003');

-- Club 1 and club 2.
-- Scheduled MTT: yesterday's finished run (starred under the old scheme) and tonight's run.
INSERT INTO tournaments(id, schedule_id, club_id, name, status, tournament_type) VALUES
 ('11111111-0000-4000-8000-000000000001','5c000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','Nightly 10K','COMPLETED','MTT'),
 ('11111111-0000-4000-8000-000000000002','5c000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','Nightly 10K','REGISTERING','MTT'),
 -- A different schedule with the SAME name in club 1 must never be starred with it.
 ('11111111-0000-4000-8000-000000000003','5c000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001','Nightly 10K','REGISTERING','MTT');
-- Catalogue Sit N Go: one live instance in each club, same name; plus same name, other stakes.
INSERT INTO tournaments(id, club_id, name, status, tournament_type, game_type, variant, buy_in_amount, buy_in_fee, max_players, table_size, blind_speed, starting_chips, spin_type) VALUES
 ('22222222-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','NLH Heads-Up 1','REGISTERING','SNG','nlh','nlh',0.95,0.05,2,2,'normal',1500,'standard'),
 ('22222222-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002','NLH Heads-Up 1','REGISTERING','SNG','nlh','nlh',0.95,0.05,2,2,'normal',1500,'standard'),
 ('22222222-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000001','NLH Heads-Up 1','REGISTERING','SNG','nlh','nlh',4.75,0.25,2,2,'normal',1500,'standard'),
 ('22222222-0000-4000-8000-000000000004','c1000000-0000-4000-8000-000000000001','PLO4 Heads-Up 1','REGISTERING','SNG','plo4','plo4',0.95,0.05,2,2,'normal',1500,'standard');
-- Satellite feeding tonight's Nightly 10K.
INSERT INTO tournaments(id, club_id, name, status, tournament_type, game_type, buy_in_amount, buy_in_fee, max_players, table_size, starting_chips, satellite_target_id) VALUES
 ('33333333-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','Nightly 10K Satellite','RUNNING','SATELLITE','nlh',5,0.5,6,6,3000,'11111111-0000-4000-8000-000000000002');

-- Cash game G1 (club 1): an old closed table (starred under the old scheme) and its rebuild.
-- Cash game G2 (club 1): a DIFFERENT game whose table carries the same name.
-- Cash game G3 (club 2): same name, other club.
INSERT INTO tables(id, club_id, cluster_id, name, status) VALUES
 ('44444444-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001','PLO5 2/5 Madness','closed'),
 ('44444444-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001','PLO5 2/5 Madness','waiting'),
 ('44444444-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000002','PLO5 2/5 Madness','waiting'),
 ('44444444-0000-4000-8000-000000000004','c2000000-0000-4000-8000-000000000002','9a000000-0000-4000-8000-000000000003','PLO5 2/5 Madness','running');

-- Old-scheme stars for A: yesterday's run id and the closed table.
INSERT INTO favorite_tables VALUES ('aaaaaaaa-0000-4000-8000-000000000001','44444444-0000-4000-8000-000000000001');
INSERT INTO user_page_preferences VALUES ('aaaaaaaa-0000-4000-8000-000000000001','lobby-tournament-favorites:global',
  '["11111111-0000-4000-8000-000000000001","not-a-uuid"]');
-- A's saved filters and a page preference, as they exist before the change.
INSERT INTO user_lobby_filters VALUES ('aaaaaaaa-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001',
  '{"HOLDEM":{"seatMax":6}}', now(), '{"tab":"OMAHA"}');
INSERT INTO user_page_preferences VALUES ('aaaaaaaa-0000-4000-8000-000000000001','lobby-all-status:global','"open"');
SQL

"${psql[@]}" -f "$repo/supabase/migrations/20261105183133_lobby_favorites_follow_the_game_not_the_row.sql"

"${psql[@]}" <<'SQL'
CREATE FUNCTION pg_temp.check(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', what; END IF; RAISE NOTICE 'PASS: %', what; END $$;
CREATE FUNCTION pg_temp.ids() RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(game_id::text, ',' ORDER BY game_id::text), '') FROM public.fn_my_lobby_favorites() $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';

-- 1. Old stars are carried forward onto the GAME, so tonight's run and the rebuilt table light.
SELECT pg_temp.check(pg_temp.ids() = '11111111-0000-4000-8000-000000000002,44444444-0000-4000-8000-000000000002',
  'backfilled stars light tonight''s run and the rebuilt table, and nothing else');

-- 2. Renames keep the star.
RESET ROLE;
UPDATE tournaments SET name = 'Nightly 10K (Renamed)' WHERE schedule_id = '5c000000-0000-4000-8000-000000000001';
UPDATE tables SET name = 'Renamed Cash Game' WHERE cluster_id = '9a000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
SELECT pg_temp.check(pg_temp.ids() = '11111111-0000-4000-8000-000000000002,44444444-0000-4000-8000-000000000002',
  'renaming the tournament and the cash game keeps both stars');

-- 3. A catalogue Sit N Go star follows its definition, not its name.
SELECT public.fn_set_lobby_favorite('tournament', '22222222-0000-4000-8000-000000000001', true);
RESET ROLE;
INSERT INTO tournaments(id, club_id, name, status, tournament_type, game_type, variant, buy_in_amount, buy_in_fee, max_players, table_size, blind_speed, starting_chips, spin_type)
VALUES ('22222222-0000-4000-8000-000000000009','c1000000-0000-4000-8000-000000000001','Renamed HU','REGISTERING','SNG','nlh','nlh',0.95,0.05,2,2,'normal',1500,'standard');
UPDATE tournaments SET status = 'COMPLETED' WHERE id = '22222222-0000-4000-8000-000000000001';
SET ROLE authenticated;
SELECT pg_temp.check(position('22222222-0000-4000-8000-000000000009' in pg_temp.ids()) > 0,
  'the next Sit N Go of the same definition inherits the star, even renamed');
SELECT pg_temp.check(position('22222222-0000-4000-8000-000000000002' in pg_temp.ids()) = 0,
  'the same-named Sit N Go in another club is not starred');
SELECT pg_temp.check(position('22222222-0000-4000-8000-000000000003' in pg_temp.ids()) = 0,
  'the same-named Sit N Go at other stakes is not starred');
SELECT pg_temp.check(position('22222222-0000-4000-8000-000000000004' in pg_temp.ids()) = 0,
  'a Sit N Go of another variant is not starred');
SELECT pg_temp.check(position('11111111-0000-4000-8000-000000000003' in pg_temp.ids()) = 0,
  'a different schedule with the same name is not starred');
SELECT pg_temp.check(position('44444444-0000-4000-8000-000000000003' in pg_temp.ids()) = 0
                 AND position('44444444-0000-4000-8000-000000000004' in pg_temp.ids()) = 0,
  'same-named cash tables of other games or clubs are not starred');

-- 4. A satellite star follows the recurring event it feeds.
SELECT public.fn_set_lobby_favorite('tournament', '33333333-0000-4000-8000-000000000001', true);
RESET ROLE;
INSERT INTO tournaments(id, schedule_id, club_id, name, status, tournament_type) VALUES
 ('11111111-0000-4000-8000-000000000004','5c000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','Nightly 10K','ANNOUNCED','MTT');
UPDATE tournaments SET status = 'COMPLETED' WHERE id = '33333333-0000-4000-8000-000000000001';
INSERT INTO tournaments(id, club_id, name, status, tournament_type, game_type, buy_in_amount, buy_in_fee, max_players, table_size, starting_chips, satellite_target_id) VALUES
 ('33333333-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001','Nightly 10K Satellite','REGISTERING','SATELLITE','nlh',5,0.5,6,6,3000,'11111111-0000-4000-8000-000000000004');
SET ROLE authenticated;
SELECT pg_temp.check(position('33333333-0000-4000-8000-000000000002' in pg_temp.ids()) > 0,
  'tomorrow''s satellite into the same recurring event inherits the star');

-- 5. Nothing running is not the same as unstarred.
RESET ROLE;
UPDATE tournaments SET status = 'COMPLETED' WHERE schedule_id = '5c000000-0000-4000-8000-000000000001';
UPDATE tables SET status = 'closed' WHERE cluster_id = '9a000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
SELECT pg_temp.check(position('44444444' in pg_temp.ids()) = 0, 'a game with nothing live lights nothing');
SELECT pg_temp.check((SELECT count(*) FROM player_lobby_favorites) = 4, 'every saved star survives runs ending and tables closing');
RESET ROLE;
INSERT INTO tables(id, club_id, cluster_id, name, status) VALUES
 ('44444444-0000-4000-8000-000000000005','c1000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001','Rebuilt Again','waiting');
DELETE FROM tables WHERE id IN ('44444444-0000-4000-8000-000000000001','44444444-0000-4000-8000-000000000002');
SET ROLE authenticated;
SELECT pg_temp.check(position('44444444-0000-4000-8000-000000000005' in pg_temp.ids()) > 0,
  'a game rebuilt after its old tables were deleted lights again');

-- 6. Only the owner changes a favorite.
SET request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
SELECT pg_temp.check((SELECT count(*) FROM player_lobby_favorites) = 0, 'another player cannot see A''s favorites');
DO $$ BEGIN DELETE FROM public.player_lobby_favorites; EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;
SELECT pg_temp.check((SELECT count(*) FROM player_lobby_favorites) = 4, 'another player''s delete removed nothing');
SET request.jwt.claim.sub = '';
DO $$ BEGIN DELETE FROM public.player_lobby_favorites; RAISE EXCEPTION 'not refused'; EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%removed only by their owner%' THEN NULL; ELSE RAISE EXCEPTION 'unexpected: %', SQLERRM; END IF; END $$;
SELECT pg_temp.check(true, 'a server-side or cleanup delete of favorites is refused');
DO $$ BEGIN TRUNCATE public.player_lobby_favorites; RAISE EXCEPTION 'not refused'; EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%cannot be truncated%' THEN NULL; ELSE RAISE EXCEPTION 'unexpected: %', SQLERRM; END IF; END $$;
SELECT pg_temp.check(true, 'truncating favorites is refused');
SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';
DO $$ BEGIN INSERT INTO public.player_lobby_favorites(user_id, kind, game_key) VALUES (auth.uid(), 'cash', 'x');
  RAISE EXCEPTION 'not refused'; EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
SELECT pg_temp.check(true, 'a player cannot write the favorites table directly, only through the star control');
SELECT public.fn_set_lobby_favorite('tournament', '22222222-0000-4000-8000-000000000009', false);
SELECT pg_temp.check(position('22222222-0000-4000-8000-000000000009' in pg_temp.ids()) = 0
                 AND (SELECT count(*) FROM player_lobby_favorites WHERE game_key LIKE 'catalog:%') = 1,
  'the owner''s unfavorite (through any instance) removes exactly that game');

-- 7. Saved filters and page preferences: owner only.
SET request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
SELECT pg_temp.check((SELECT count(*) FROM user_lobby_filters) = 0, 'another player cannot read A''s filters');
RESET ROLE;
SET ROLE service_role;
SET request.jwt.claim.sub = '';
DO $$ BEGIN UPDATE public.user_lobby_filters SET filters = '{}'; RAISE EXCEPTION 'not refused'; EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%written only by its owner%' THEN NULL; ELSE RAISE EXCEPTION 'unexpected: %', SQLERRM; END IF; END $$;
SELECT pg_temp.check(true, 'a server-side rewrite of saved filters is refused');
DO $$ BEGIN DELETE FROM public.user_page_preferences; RAISE EXCEPTION 'not refused'; EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%removed only by their owner%' THEN NULL; ELSE RAISE EXCEPTION 'unexpected: %', SQLERRM; END IF; END $$;
SELECT pg_temp.check(true, 'a server-side delete of page preferences is refused');
RESET ROLE;
SELECT pg_temp.check((SELECT filters FROM user_lobby_filters) = '{"HOLDEM":{"seatMax":6}}'::jsonb,
  'A''s saved filters are untouched by every refused write');

-- 8. Newer choice wins; a stale replay cannot undo it.
SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001';
INSERT INTO user_lobby_filters(user_id, club_id, filters, filters_changed_at) VALUES
  (auth.uid(), 'c1000000-0000-4000-8000-000000000001', '{"HOLDEM":{"seatMax":9}}', '2026-11-05 12:00+00')
  ON CONFLICT (user_id, club_id) DO UPDATE SET filters = excluded.filters, filters_changed_at = excluded.filters_changed_at;
INSERT INTO user_lobby_filters(user_id, club_id, filters, filters_changed_at) VALUES
  (auth.uid(), 'c1000000-0000-4000-8000-000000000001', '{"HOLDEM":{"seatMax":2}}', '2026-11-05 11:00+00')
  ON CONFLICT (user_id, club_id) DO UPDATE SET filters = excluded.filters, filters_changed_at = excluded.filters_changed_at;
SELECT pg_temp.check((SELECT filters->'HOLDEM'->>'seatMax' FROM user_lobby_filters) = '9',
  'a late replay of an older filter choice keeps the newer one');
INSERT INTO user_lobby_filters(user_id, club_id, view_prefs, view_prefs_changed_at) VALUES
  (auth.uid(), 'c1000000-0000-4000-8000-000000000001', '{"tab":"MTT"}', '2026-11-05 13:00+00')
  ON CONFLICT (user_id, club_id) DO UPDATE SET view_prefs = excluded.view_prefs, view_prefs_changed_at = excluded.view_prefs_changed_at;
SELECT pg_temp.check((SELECT view_prefs->>'tab' FROM user_lobby_filters) = 'MTT'
                 AND (SELECT filters->'HOLDEM'->>'seatMax' FROM user_lobby_filters) = '9',
  'a newer view choice applies and leaves the filters beside it alone');
INSERT INTO user_lobby_filters(user_id, club_id, filters) VALUES
  (auth.uid(), 'c1000000-0000-4000-8000-000000000001', '{"HOLDEM":{"seatMax":4}}')
  ON CONFLICT (user_id, club_id) DO UPDATE SET filters = excluded.filters;
SELECT pg_temp.check((SELECT filters->'HOLDEM'->>'seatMax' FROM user_lobby_filters) = '4',
  'a client that sends no choice time still saves (older builds keep working)');
INSERT INTO user_page_preferences(user_id, preference_key, value, changed_at) VALUES
  (auth.uid(), 'lobby-all-status:global', '"running"', '2026-11-05 12:00+00')
  ON CONFLICT (user_id, preference_key) DO UPDATE SET value = excluded.value, changed_at = excluded.changed_at;
INSERT INTO user_page_preferences(user_id, preference_key, value, changed_at) VALUES
  (auth.uid(), 'lobby-all-status:global', '"open"', '2026-11-05 10:00+00')
  ON CONFLICT (user_id, preference_key) DO UPDATE SET value = excluded.value, changed_at = excluded.changed_at;
SELECT pg_temp.check((SELECT value #>> '{}' FROM user_page_preferences WHERE preference_key = 'lobby-all-status:global') = 'running',
  'a late replay of an older page preference keeps the newer one');

-- 9. Deleting the account takes everything with it, and nothing else does.
RESET ROLE;
DELETE FROM auth.users WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001';
SELECT pg_temp.check((SELECT count(*) FROM player_lobby_favorites) = 0
                 AND (SELECT count(*) FROM user_lobby_filters) = 0
                 AND (SELECT count(*) FROM user_page_preferences) = 0,
  'deleting the account removes its favorites and preferences');
SQL
echo "lobby favorites native proof: all checks passed"
