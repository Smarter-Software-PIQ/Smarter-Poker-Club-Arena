-- 20261113175242_horses_seed_the_1_2_and_half_dollar_lightning_games.sql
-- @live-proof: (SELECT enabled AND lightning_enabled AND ruleset_snapshot ? 'lightning' FROM public.cash_games WHERE id = 'f26f6efa-2470-49e7-8e96-6128f4d0cdb5') AND position('v_humans=0' in pg_get_functiondef('public.fn_plo_lightning_horse_admit(uuid,uuid,timestamptz)'::regprocedure)) = 0 AND position('v_population>=10' in pg_get_functiondef('public.fn_plo_lightning_horse_admit(uuid,uuid,timestamptz)'::regprocedure)) > 0
--
-- HORSES PLAY THE 1/2 AND .50/1 LIGHTNING GAMES (Dan, 2026-11-13 11:43).
--
-- "THE 1/2 PLAYERS NEED TO BE SPLIT UP AMONGST ALL OF THE GAMES, INCLUDING
-- THE LIGHTNING GAMES. AND INCLUDING LIGHTNING .50/1.00 FOR BOTH PLO AND
-- HOLDEM." Live at 11:38 Chicago: Lightning NLH 1/2, PLO 1/2 and PLO5 1/2 at
-- 0 players beside Classic games of 36-60, because horses started only the
-- two .25/.50 Lightning games (owner rule 2026-11-05, superseded here for
-- these stakes). The engine side is horseUnionCashPlan.json
-- lightningHorseSeeded. Two database changes go with it:
--
-- 1. Lightning PLO4 .50/1 (f26f6efa) was switched off on 2026-11-06 and has no
--    Lightning rules. It is switched on with the same Lightning rules as
--    Lightning NLH .50/1 (form worker, on at 5, off at 4, never always-on).
--    No other enabled PLO4 .50/1 madness game exists (one-per-key holds).
-- 2. fn_plo_lightning_horse_admit, the PLO4 1/2 Lightning (c79d8ec2) horse
--    guard, refused every horse unless a person was playing or the post-human
--    continuation held. Horses now seed it like the other Lightning games: the
--    person requirement is removed; its own 10-player population cap, the
--    heads-up rescue rule and the 70-90 second pacing are unchanged. Patched
--    from production's own definition with pre- and postimage checks, owner,
--    ACL and settings preserved.
-- No chips move; no seat, table or session is written.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

UPDATE public.cash_games
   SET enabled = true,
       lightning_enabled = true,
       ruleset_snapshot = ruleset_snapshot || jsonb_build_object(
         'lightning', jsonb_build_object(
           'always_on', false, 'worker_mode', 'form', 'on_threshold', 5, 'off_threshold', 4)),
       updated_at = now()
 WHERE id = 'f26f6efa-2470-49e7-8e96-6128f4d0cdb5'
   AND club_id = 'fade0000-0000-0000-0000-000000000001'
   AND variant = 'plo4' AND sb = 0.5 AND bb = 1 AND must_move;

DO $enable$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.cash_games
                  WHERE id = 'f26f6efa-2470-49e7-8e96-6128f4d0cdb5'
                    AND enabled AND lightning_enabled
                    AND ruleset_snapshot->'lightning'->>'on_threshold' = '5') THEN
    RAISE EXCEPTION 'Lightning PLO4 .50/1 was not switched on';
  END IF;
END $enable$;

DO $admission$
DECLARE
  sig constant regprocedure := 'public.fn_plo_lightning_horse_admit(uuid,uuid,timestamptz)'::regprocedure;
  s text := pg_get_functiondef(sig);
  n text;
  before_meta jsonb;
  old_gate constant text :=
    'IF (v_humans=0 AND NOT (public.fn_plo_lightning_post_human_demand()->>''continues'')::boolean) OR v_population>=10 THEN';
  new_gate constant text := 'IF v_population>=10 THEN';
BEGIN
  IF md5(s) <> 'd80b45b3c5e16a074fe4d83a8f64416b' THEN
    RAISE EXCEPTION 'PLO admission source changed; qualify the current source';
  END IF;
  IF (length(s) - length(replace(s, old_gate, ''))) / length(old_gate) <> 1 THEN
    RAISE EXCEPTION 'PLO admission person gate absent or duplicated';
  END IF;
  SELECT jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef,
                            'volatility',provolatile,'parallel',proparallel)
    INTO before_meta FROM pg_proc WHERE oid = sig;
  n := replace(s, old_gate, new_gate);
  EXECUTE n;
  IF pg_get_functiondef(sig) IS DISTINCT FROM n THEN
    RAISE EXCEPTION 'PLO admission postimage differs';
  END IF;
  IF before_meta IS DISTINCT FROM (
       SELECT jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef,
                                 'volatility',provolatile,'parallel',proparallel)
         FROM pg_proc WHERE oid = sig) THEN
    RAISE EXCEPTION 'PLO admission metadata changed';
  END IF;
END $admission$;

COMMIT;
