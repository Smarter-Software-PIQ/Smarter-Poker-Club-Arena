-- 20261115032204_horse_cash_admits_short_deck_pineapple_and_plo8_again
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-15 03:22:04 UTC.
--
-- HORSE CASH ADMITS SHORT DECK, PINEAPPLE AND PLO8 AGAIN, AT .50/1 OR BELOW.
--
-- THE DECISION. Owner direction of 2026-11-14 (19:07, 19:10 and 20:42
-- America/Chicago) requires short deck, pineapple and PLO8 cash, approved
-- variants, to be made operational through the normal game-supply paths,
-- respecting schedules, eligibility and bankroll rules. The owner delegated
-- every decision to the Phase 1 overwatch at 19:22 Chicago ("THERE ARE NO
-- DECISIONS FOR ME, THEY ARE 100% ON YOU"). Overwatch decided that this
-- supersedes, for these three variants ONLY, the cash exclusion of the owner
-- order of November 1 (PR #9258, migration 20261102015546). Everything else of #9258
-- and its successors stands: the 40 percent cash schedule reduction, the
-- midnight cut, the stake ceiling (NLH/PLO4-6 through 1/2, fixed limit through
-- 5/10 blinds, every other variant - these three included - through .50/1),
-- and all human admission, tournament and settlement paths.
--
-- WHAT WAS WRONG. fn_horse_cash_game_allowed answered false for any
-- non-tournament seat of '%pineapple%', short_deck, shortdeck, 6+ and plo8
-- from 2026-11-02 00:00 Chicago. fn_ca_horse_roster_seat_guard calls it for
-- every Horse seat insert and raises 42501 horse_cash_game_restricted. Measured
-- read-only 2026-11-15 03:00Z (overwatch diagnosis CASH-VARIANTS-CAUSE-20261115):
-- 0 Horse cash seats and 0 hands in 72 h for all three variants, while 214 of
-- the 217 Horses on duty in Midway cash carry all three variant tags. The
-- server mirror (server/src/services/HorseCashSchedule.ts) withholds the same
-- tables first, so the games report 0 eligible Horses and stay dormant.
--
-- WHAT THIS CHANGES. The exclusion branch now applies only to p_at before
-- 2026-11-14 19:07 America/Chicago (2026-11-15 01:07 UTC), the owner direction,
-- exactly as the server's CASH_VARIANTS_RESTORED_START_MS does. From then on
-- these variants fall to the existing ELSE ceiling (sb <= 0.5, bb <= 1). The
-- dated branch keeps every November 2-14 answer what it was, so the server and
-- the database agree at every instant. Nothing else in the function changes.
-- The date is in the past on purpose: in the database it takes effect when
-- this installs; Horses are seated only once the engine release carrying the
-- server and plan half serves.
--
-- PRE-IMAGE. Built from production's own pg_get_functiondef, read read-only on
-- 2026-11-15 before 03:22Z (PostgreSQL 17.6): md5 f77febff99f314bdf878f5acc9b18dee (the 20261103121552
-- body), owner postgres, SECURITY INVOKER, IMMUTABLE, search_path
-- pg_catalog, public, pg_temp, EXECUTE for postgres and service_role only. Any
-- other definition, including this migration's own result, refuses: a re-run
-- cannot install twice. Owner, ACL, security mode, volatility and search_path
-- are checked before and after and must be unchanged.
--
-- Function replacement only: no table lock, no data change, one transaction.
-- The seat guard, the cluster tick, Horse work hours, daily caps, days off,
-- the curve's seat ceiling, bankroll and buy-in rules, minimum players,
-- must-move and VPIP floors are untouched. Horses still need the engine
-- release carrying the server and union cash plan change to be seeded; this
-- installs first so that release finds the database already admitting them.
-- @live-proof: (position('2026-11-14 19:07:00 America/Chicago' in pg_get_functiondef('public.fn_horse_cash_game_allowed(text,numeric,numeric,uuid,timestamptz)'::regprocedure)) > 0 AND public.fn_horse_cash_game_allowed('plo8',0.5,1,NULL) AND NOT public.fn_horse_cash_game_allowed('plo8',1,2,NULL))

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $guard$
DECLARE
  f regprocedure := 'public.fn_horse_cash_game_allowed(text,numeric,numeric,uuid,timestamptz)'::regprocedure;
  p record;
BEGIN
  IF md5(pg_get_functiondef(f)) IS DISTINCT FROM 'f77febff99f314bdf878f5acc9b18dee' THEN
    RAISE EXCEPTION 'HORSE_CASH_GAME_ALLOWED_PREIMAGE_CHANGED: md5 % is not the November 3 pre-image (already installed, or changed since)',
      md5(pg_get_functiondef(f));
  END IF;
  SELECT proowner, proacl::text AS acl, prosecdef, provolatile, proconfig INTO p FROM pg_proc WHERE oid = f;
  IF p.prosecdef OR p.provolatile <> 'i'
     OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, pg_temp']
     OR has_function_privilege('anon', f, 'EXECUTE')
     OR has_function_privilege('authenticated', f, 'EXECUTE')
     OR NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'HORSE_CASH_GAME_ALLOWED_CONTRACT_CHANGED';
  END IF;
  PERFORM set_config('ca.horse_cash_allowed_owner', p.proowner::text, true);
  PERFORM set_config('ca.horse_cash_allowed_acl', coalesce(p.acl, ''), true);
END $guard$;

CREATE OR REPLACE FUNCTION public.fn_horse_cash_game_allowed(p_variant text, p_sb numeric, p_bb numeric, p_tournament_id uuid, p_at timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
 SELECT CASE
 WHEN p_tournament_id IS NOT NULL OR p_at<'2026-11-02 00:00:00 America/Chicago'::timestamptz THEN true
 WHEN p_at<'2026-11-14 19:07:00 America/Chicago'::timestamptz
  AND (lower(btrim(coalesce(p_variant,''))) LIKE '%pineapple%'
   OR lower(btrim(coalesce(p_variant,''))) IN ('short_deck','shortdeck','6+','plo8')) THEN false
 WHEN lower(btrim(coalesce(p_variant,''))) IN ('flh','flo8') THEN coalesce(p_bb>0 AND p_bb<=10 AND p_sb>=0 AND p_sb<=5,false)
 WHEN lower(btrim(coalesce(p_variant,''))) IN ('nlh','plo','plo4','plo5','plo6') THEN coalesce(p_bb>0 AND p_bb<=2 AND p_sb>=0 AND p_sb<=1,false)
 ELSE coalesce(p_bb>0 AND p_bb<=1 AND p_sb>=0 AND p_sb<=0.5,false) END;
$function$;
REVOKE ALL ON FUNCTION public.fn_horse_cash_game_allowed(text,numeric,numeric,uuid,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_horse_cash_game_allowed(text,numeric,numeric,uuid,timestamptz) TO service_role;

DO $proof$
DECLARE
  f regprocedure := 'public.fn_horse_cash_game_allowed(text,numeric,numeric,uuid,timestamptz)'::regprocedure;
  p record;
  v text;
  restored constant timestamptz := '2026-11-14 19:07:00 America/Chicago';
BEGIN
  SELECT proowner, proacl::text AS acl, prosecdef, provolatile, proconfig INTO p FROM pg_proc WHERE oid = f;
  IF p.proowner::text IS DISTINCT FROM current_setting('ca.horse_cash_allowed_owner')
     OR coalesce(p.acl, '') IS DISTINCT FROM current_setting('ca.horse_cash_allowed_acl')
     OR p.prosecdef OR p.provolatile <> 'i'
     OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, pg_temp'] THEN
    RAISE EXCEPTION 'HORSE_CASH_GAME_ALLOWED_CONTRACT_NOT_PRESERVED';
  END IF;
  FOREACH v IN ARRAY ARRAY['short_deck','pineapple','plo8','shortdeck','6+','crazy_pineapple'] LOOP
    -- Restored from the owner direction on, inside the .50/1 ceiling only.
    IF NOT public.fn_horse_cash_game_allowed(v,0.5,1,NULL,restored)
       OR NOT public.fn_horse_cash_game_allowed(v,0.25,0.5,NULL)
       OR NOT public.fn_horse_cash_game_allowed(v,0.5,1,NULL)
       OR public.fn_horse_cash_game_allowed(v,1,2,NULL)
       OR public.fn_horse_cash_game_allowed(v,0.75,1,NULL)
       OR public.fn_horse_cash_game_allowed(v,0.5,1.01,NULL)
       OR public.fn_horse_cash_game_allowed(v,0.5,NULL,NULL)
       OR public.fn_horse_cash_game_allowed(v,NULL,1,NULL)
       -- November 2-14 answers are unchanged; tournaments and pre-policy too.
       OR public.fn_horse_cash_game_allowed(v,0.25,0.5,NULL,restored - interval '1 millisecond')
       OR public.fn_horse_cash_game_allowed(v,0.25,0.5,NULL,'2026-11-02 06:00+00')
       OR NOT public.fn_horse_cash_game_allowed(v,2,5,'00000000-0000-0000-0000-000000001001'::uuid)
       OR NOT public.fn_horse_cash_game_allowed(v,2,5,NULL,'2026-11-02 05:59:59.999+00') THEN
      RAISE EXCEPTION 'HORSE_CASH_GAME_ALLOWED_RESTORE_WRONG: %', v;
    END IF;
  END LOOP;
  FOREACH v IN ARRAY ARRAY['nlh','plo','plo4','plo5','plo6'] LOOP
    IF NOT public.fn_horse_cash_game_allowed(v,1,2,NULL) OR public.fn_horse_cash_game_allowed(v,2,5,NULL) THEN
      RAISE EXCEPTION 'HORSE_CASH_GAME_ALLOWED_STANDARD_CEILING_CHANGED: %', v;
    END IF;
  END LOOP;
  FOREACH v IN ARRAY ARRAY['flh','flo8'] LOOP
    IF NOT public.fn_horse_cash_game_allowed(v,5,10,NULL) OR public.fn_horse_cash_game_allowed(v,5,10.01,NULL) THEN
      RAISE EXCEPTION 'HORSE_CASH_GAME_ALLOWED_LIMIT_CEILING_CHANGED: %', v;
    END IF;
  END LOOP;
  IF NOT public.fn_horse_cash_game_allowed('stud',0.5,1,NULL) OR public.fn_horse_cash_game_allowed('stud',1,2,NULL) THEN
    RAISE EXCEPTION 'HORSE_CASH_GAME_ALLOWED_OTHER_CEILING_CHANGED';
  END IF;
END $proof$;

COMMIT;
