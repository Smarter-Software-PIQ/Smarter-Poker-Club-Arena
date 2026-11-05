-- 20261105222744_all_horses_play_the_hybrid_style.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- @live-proof: (SELECT count(*) FROM public.profiles WHERE is_horse IS TRUE AND status IS DISTINCT FROM 'deleted' AND coalesce(horse_profile->>'style', '') <> 'hybrid') = 0
-- @live-proof: (SELECT count(*) FROM public.profiles WHERE is_horse IS TRUE AND status IS DISTINCT FROM 'deleted' AND horse_profile->>'style' = 'hybrid') >= 1000
--
-- ALL HORSES PLAY THE HYBRID STYLE (Dan, 2026-11-05, verbatim: "YOU NEED TO
-- HAVE CHANGED ALL 1000 HORSES TO THE NEW 'HYBRID' STYLE HORSE AND RETIRE ALL
-- OTHER 'STYLES ASSIGNED TO THOSE HORSES' AND ACTIVATE THE NEW 'HYBRID' TO ALL
-- OF THEM.")
--
-- WHAT THIS CHANGES
--
-- Every live horse row in public.profiles (is_horse, not a closed account)
-- gets horse_profile.style = "hybrid". The style the row carried until now
-- (tricky 224 / grinder 220 / tag 209 / balanced 207 / lag 202 on the 1,000
-- live horses when this was written) is kept under horse_profile.retiredStyle
-- so the old persona stays in history; a row that already has a retiredStyle
-- keeps it. No other key of horse_profile changes: the four tuning dials, the
-- authored persona and the diagnostic counts are untouched. No other table is
-- touched. The 62 closed horse accounts (status deleted) are left as they are.
--
-- The engine already plays the Hybrid for every hand (HorseHybridProfile.ts,
-- live since PR #9488): the game mode picks the decision profile (cash plays
-- grinder/pebbles, tournaments play tricky/flint) and the stored style never
-- does, so this rewrite changes no decision. It makes the database say what
-- the fleet plays, and it retires the five legacy styles from every horse.
-- Server code in the same change writes "hybrid" on every assignment path
-- (new horses, the completeness sweep) and never one of the retired five.
--
-- Plain row updates only: no DDL, so no PostgREST schema reload. Row locks on
-- horse profile rows for well under a second; lock_timeout and
-- statement_timeout bound it and the whole thing rolls back if either fires.
-- Rerunning it is harmless: a row already on the Hybrid is not touched.
--
-- No money moves in this migration.

BEGIN;

SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

UPDATE public.profiles
   SET horse_profile = jsonb_set(
         CASE
           WHEN jsonb_typeof(horse_profile) = 'object' THEN
             CASE
               WHEN horse_profile ? 'retiredStyle' OR horse_profile->>'style' IS NULL THEN horse_profile
               ELSE horse_profile || jsonb_build_object('retiredStyle', horse_profile->>'style')
             END
           WHEN jsonb_typeof(horse_profile) = 'string' THEN
             jsonb_build_object('retiredStyle', horse_profile #>> '{}')
           ELSE '{}'::jsonb
         END,
         '{style}',
         '"hybrid"'::jsonb,
         true
       )
 WHERE is_horse IS TRUE
   AND status IS DISTINCT FROM 'deleted'
   AND coalesce(horse_profile->>'style', '') <> 'hybrid';

DO $migration$
DECLARE
  v_live integer;
  v_hybrid integer;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE horse_profile->>'style' = 'hybrid')
    INTO v_live, v_hybrid
    FROM public.profiles
   WHERE is_horse IS TRUE AND status IS DISTINCT FROM 'deleted';
  IF v_live <> v_hybrid THEN
    RAISE EXCEPTION 'ALL HORSES PLAY THE HYBRID STYLE: % of % live horses are on the Hybrid; refusing to commit',
      v_hybrid, v_live;
  END IF;
END
$migration$;

COMMIT;
