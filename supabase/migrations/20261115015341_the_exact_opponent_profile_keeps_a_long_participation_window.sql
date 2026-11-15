-- @install-window: daily-maintenance
-- @live-proof: (SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.horse_exact_profiles') AND attname='long_counters' AND NOT attisdropped) AND strpos(pg_get_functiondef(to_regprocedure('public.fn_horse_exact_accept_hand()')), 'long_counters=public.fn_horse_long_participation_add(horse_exact_profiles.long_counters,excluded.counters)')>0)
-- 20261115015341_the_exact_opponent_profile_keeps_a_long_participation_window.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Horses could not read an ordinary tight regular as tight. The exact opponent
-- profile (horse_exact_profiles.counters) decays every counter with a 30-hand
-- half-life (fn_horse_exploit_add), so a player's decayed hand count saturates
-- at 1 / (1 - 2^(-1/30)) = 43.8. At that much evidence the style read's 90%
-- posterior (6 prior hands at the Horse mean, margin 0.02) calls a full-ring
-- no-limit player tight only at VPIP <= 0.119 (short-handed 0.231, heads-up
-- 0.302), whatever he has played. The engine now keeps a third window over
-- hands, VPIP and PFR only, with a 120-hand half-life (HorseOpponentExploit
-- EXPLOIT_LONG_HALF_LIFE_HANDS): it saturates at 173.6 decayed hands, where the
-- same rule calls tight at VPIP <= 0.156 / 0.279 / 0.354.
--
-- This file gives the exact profile that window, written by the same
-- accepted-hand learner from the same per-hand increments:
--   - a new nullable column long_counters jsonb ({lHands, lVpip, lPfr});
--   - fn_horse_long_participation_add(base, delta): each field aged one hand
--     at 2^(-1/120) plus that hand's hands / vpip / pfr increment, a NULL base
--     read as 0 (HorseOpponentExploit.decayAndAddLong applies the same rule);
--   - fn_horse_exact_accept_hand writes it beside counters on the insert and
--     on the conflict update, from excluded.counters (one hand's increments).
--     Patched by exact preimage fragments like 20261107160549, so the reducer
--     (forced folds and unattributed folds excluded) is untouched: the long
--     window counts exactly the hands and folds the 30-hand counters count.
--
-- FORWARD ONLY. No back-fill, no replay of history, no reset: every existing
-- row keeps its counters untouched and its long_counters NULL until its next
-- accepted hand, from which the window accumulates. The engine reads a NULL or
-- thinner window as absent (the 30-hand read stands), so the window becomes
-- useful for a player once his long window holds more decayed hands than his
-- 30-hand one: about 51 of his hands in that exact context after install, and
-- a tight read at VPIP 0.14 full ring after about 118.
--
-- The legacy aggregate (horse_exploit_profiles), fn_horse_exploit_add and the
-- reducers are not changed. The read RPC returns SETOF horse_exact_profiles,
-- so it returns the new column; an engine that predates it ignores it (its
-- validator checks named fields), and the engine that reads it accepts a row
-- without it, so either may be installed first.
--
-- ADD COLUMN with no default is a catalog-only change but takes ACCESS
-- EXCLUSIVE on horse_exact_profiles, which every accepted hand writes: the
-- daily-maintenance window, one 1 s lock request.

BEGIN;
SET LOCAL lock_timeout='1s';

ALTER TABLE public.horse_exact_profiles ADD COLUMN IF NOT EXISTS long_counters jsonb;

CREATE OR REPLACE FUNCTION public.fn_horse_long_participation_add(p_base jsonb,p_delta jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $fn$
 SELECT jsonb_build_object(
  'lHands',coalesce((p_base->>'lHands')::double precision,0)*power(0.5::double precision,1.0/120)
           +coalesce((p_delta->>'hands')::double precision,0),
  'lVpip',coalesce((p_base->>'lVpip')::double precision,0)*power(0.5::double precision,1.0/120)
           +coalesce((p_delta->>'vpip')::double precision,0),
  'lPfr',coalesce((p_base->>'lPfr')::double precision,0)*power(0.5::double precision,1.0/120)
           +coalesce((p_delta->>'pfr')::double precision,0))
$fn$;
REVOKE ALL ON FUNCTION public.fn_horse_long_participation_add(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE item record; def text; signature regprocedure;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('public.fn_horse_exact_accept_hand()', $a$public_memory_domain,counters,observed_hands,initialized)$a$,
   $b$public_memory_domain,counters,observed_hands,initialized,long_counters)$b$),
  ('public.fn_horse_exact_accept_hand()', $a$h.public_memory_domain,actor.value,1,true)$a$,
   $b$h.public_memory_domain,actor.value,1,true,public.fn_horse_long_participation_add(NULL,actor.value))$b$),
  ('public.fn_horse_exact_accept_hand()', $a$observed_hands=horse_exact_profiles.observed_hands+1,updated_at=clock_timestamp();$a$,
   $b$observed_hands=horse_exact_profiles.observed_hands+1,long_counters=public.fn_horse_long_participation_add(horse_exact_profiles.long_counters,excluded.counters),updated_at=clock_timestamp();$b$)
 ) edits(name,old_fragment,new_fragment) LOOP
  signature:=item.name::regprocedure;
  def:=pg_get_functiondef(signature);
  IF strpos(def,item.new_fragment)>0 THEN CONTINUE; END IF;
  IF (length(def)-length(replace(def,item.old_fragment,'')))<>length(item.old_fragment) THEN
   RAISE EXCEPTION 'unexpected exact public-memory learner preimage: %',item.name;
  END IF;
  EXECUTE replace(def,item.old_fragment,item.new_fragment);
 END LOOP;
END $patch$;

COMMIT;
