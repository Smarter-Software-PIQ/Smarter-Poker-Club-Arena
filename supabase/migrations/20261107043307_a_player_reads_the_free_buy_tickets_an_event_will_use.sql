-- 20261107043307_a_player_reads_the_free_buy_tickets_an_event_will_use
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch.
--
-- A PLAYER READS THE FREE BUY TICKETS AN EVENT WILL USE
--
-- Owner, 2026-11-06: show players how many of their five daily Free Buy
-- tickets are left, and say plainly when a registration is refused for want
-- of one.
--
-- fn_ca_free_buy_tickets() (20261105223835) reads TODAY's gaming day. A
-- ticket, however, is drawn from the gaming day of the EVENT's start
-- (smarter_private.free_buy_ticket_redeem: free_buy_gaming_day(start_time)),
-- and Midway Free Buys open for registration days ahead. A player looking at
-- Saturday's Morning Free Buy on Friday night would have been shown Friday's
-- count. fn_ca_free_buy_tickets_for_event(event) answers for the one book
-- that registration will actually draw on:
--
--   { applies: false }                       not a Midway Free Buy: no ticket
--   { applies: true, gaming_day, today,      the event's gaming day, whether
--     allotment, used, remaining,            it is today's, that day's book,
--     used_here }                            and whether this player already
--                                            holds a live ticket on it
--
-- NULL for an anonymous caller or an unknown event. Read-only, the caller's
-- own book only (auth.uid()); granted to authenticated. The redeem path, the
-- allotment and every ticket rule are unchanged. No chips move.
--
-- @live-proof: to_regprocedure('public.fn_ca_free_buy_tickets_for_event(uuid)') IS NOT NULL AND has_function_privilege('authenticated', 'public.fn_ca_free_buy_tickets_for_event(uuid)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.fn_ca_free_buy_tickets_for_event(uuid)', 'EXECUTE')
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '10s';

DO $pre$ BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_midway_free_buy_format(uuid)'::regprocedure))
     IS DISTINCT FROM 'f9522dffe07a3d8d446e5e3bebd11f68' THEN
    RAISE EXCEPTION 'Inspected definition changed: fn_ca_midway_free_buy_format';
  END IF;
  IF md5(pg_get_functiondef('smarter_private.free_buy_gaming_day(timestamptz)'::regprocedure))
     IS DISTINCT FROM '7c1193f698a2c1dc047c347353074dcc' THEN
    RAISE EXCEPTION 'Inspected definition changed: free_buy_gaming_day';
  END IF;
  IF md5(pg_get_functiondef('smarter_private.free_buy_ticket_redeem(uuid,uuid)'::regprocedure))
     IS DISTINCT FROM '3e7bad4fd91a582ed5e5ea2f1c4f5643' THEN
    RAISE EXCEPTION 'Inspected definition changed: free_buy_ticket_redeem';
  END IF;
  IF to_regprocedure('public.fn_ca_free_buy_tickets_for_event(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'fn_ca_free_buy_tickets_for_event already exists';
  END IF;
END $pre$;

CREATE FUNCTION public.fn_ca_free_buy_tickets_for_event(p_tournament_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'smarter_private', 'pg_temp'
AS $function$
 SELECT CASE
   WHEN auth.uid() IS NULL THEN NULL
   WHEN public.fn_ca_midway_free_buy_format(t.id) IS NULL THEN jsonb_build_object('applies', false)
   ELSE jsonb_build_object(
     'applies', true,
     'gaming_day', g.day,
     'today', g.day = smarter_private.free_buy_gaming_day(clock_timestamp()),
     'allotment', coalesce(d.allotment, 5),
     'used', coalesce(d.used, 0),
     'remaining', greatest(0, coalesce(d.allotment, 5) - coalesce(d.used, 0)),
     'used_here', EXISTS (SELECT 1 FROM smarter_private.free_buy_ticket_redemptions r
                           WHERE r.user_id = auth.uid() AND r.tournament_id = t.id
                             AND r.returned_at IS NULL))
 END
 FROM public.tournaments t
 CROSS JOIN LATERAL (SELECT smarter_private.free_buy_gaming_day(coalesce(t.start_time, t.started_at)) AS day) g
 LEFT JOIN smarter_private.free_buy_ticket_days d ON d.user_id = auth.uid() AND d.gaming_day = g.day
 WHERE t.id = p_tournament_id
$function$;
COMMENT ON FUNCTION public.fn_ca_free_buy_tickets_for_event(uuid) IS
 'The caller''s Free Buy ticket book for the gaming day an event''s registration draws on: applies, gaming_day, today, allotment, used, remaining, used_here (20261107043307). Read-only.';
REVOKE ALL ON FUNCTION public.fn_ca_free_buy_tickets_for_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ca_free_buy_tickets_for_event(uuid) TO authenticated, service_role;

COMMIT;
