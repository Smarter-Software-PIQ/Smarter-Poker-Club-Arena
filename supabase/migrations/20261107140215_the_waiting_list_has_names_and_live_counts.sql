-- 20261107140215_the_waiting_list_has_names_and_live_counts.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY (owner request 2026-11-07 06:46 CST, "GO AHEAD AND
-- FULLY BUILD, FIX AND ENHANCE ALL OF THESE"; split from 20261107124911 so it can
-- install without waiting for an engine):
--
-- 1. NAMES BEHIND THE COUNT. fn_cash_game_lobby's waitlist carried only a
--    count. It now also carries `players`: the game list in join order, each
--    with its position and the same display name the Must Move List prints
--    (fn_player_display_name), up to 30, live rows only (a waiting row for 24
--    hours, a notified row for three minutes - the offer path's own liveness).
--    Horses and people are listed alike (CLAUDE.md 10.5).
--
-- 2. LIVE COUNTS. A row-level AFTER trigger on cash_game_waitlist sends one
--    public broadcast, topic 'cash-game-waitlist', event 'changed', payload
--    {game_id}, inside the writing transaction (a rollback publishes nothing).
--    It carries no user id. The lobby refreshes its counts on it instead of
--    waiting for its poll, which stays as the fallback.
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $preimage$
BEGIN
  IF md5(pg_get_functiondef('public.fn_cash_game_lobby(uuid)'::regprocedure))
       <> 'c6886ea147703b166ed48a86aafee0fc' THEN
    RAISE EXCEPTION 'waiting_list_names_preimage_changed' USING ERRCODE = '55000';
  END IF;
END $preimage$;

-- 1. Names behind the count, in the on-table lobby.
DO $patch$
DECLARE original text; patched text;
BEGIN
 SELECT pg_get_functiondef('public.fn_cash_game_lobby(uuid)'::regprocedure) INTO original;
 patched := replace(original,
   $anchor$    'waitlist', jsonb_build_object('waiting', (public.fn_cash_game_waitlist_position(g.id)->>'waiting')::integer),
$anchor$,
   $insert$    'waitlist', jsonb_build_object(
      'waiting', (public.fn_cash_game_waitlist_position(g.id)->>'waiting')::integer,
      -- Names behind the count (2026-11-07): join order, live rows only.
      'players', coalesce((
        SELECT jsonb_agg(jsonb_build_object('position', w.pos, 'user_id', w.user_id,
                                            'alias', public.fn_player_display_name(w.user_id))
                         ORDER BY w.pos)
          FROM (SELECT q.user_id, row_number() OVER (ORDER BY q.created_at, q.id) AS pos
                  FROM public.cash_game_waitlist q
                 WHERE q.game_id = g.id
                   AND ((q.status = 'waiting' AND q.created_at > now() - interval '24 hours')
                     OR (q.status = 'notified' AND q.updated_at > now() - interval '3 minutes'))
                 ORDER BY q.created_at, q.id
                 LIMIT 30) w), '[]'::jsonb)),
$insert$);
 IF patched = original THEN RAISE EXCEPTION 'cash game lobby waitlist anchor absent'; END IF;
 EXECUTE patched;
END $patch$;

-- 2. Live counts: one broadcast per change of a game's list.
CREATE OR REPLACE FUNCTION public.fn_cash_game_waitlist_broadcast()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('game_id', coalesce(NEW.game_id, OLD.game_id)),
    'changed', 'cash-game-waitlist', false);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- A broadcast is a courtesy; it never refuses the list write itself.
  RETURN NULL;
END
$function$;
REVOKE ALL ON FUNCTION public.fn_cash_game_waitlist_broadcast() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_cash_game_waitlist_broadcast ON public.cash_game_waitlist;
CREATE TRIGGER trg_cash_game_waitlist_broadcast
  AFTER INSERT OR DELETE OR UPDATE OF status ON public.cash_game_waitlist
  FOR EACH ROW EXECUTE FUNCTION public.fn_cash_game_waitlist_broadcast();

COMMIT;
