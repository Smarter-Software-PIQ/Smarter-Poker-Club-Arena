-- 20261105223835_five_free_buy_tickets_a_day_for_every_player
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-05 22:38:35 UTC.
--
-- FIVE FREE BUY TICKETS A DAY FOR EVERY CLUB ARENA PLAYER
--
-- Owner rule (Dan, 2026-11-05, this chat): every Club Arena user receives
-- five Free Buy tickets daily; a ticket covers the first entry into any Free
-- Buy event, guaranteed or not; one ticket per user per event; rebuys,
-- re-entries and add-ons are paid from the player's wallet and a ticket can
-- never stand in for one; offline users and new users have the current day's
-- allotment; five per user across Club Arena (not per club, device or
-- session); no duplicate grant or redemption; issuing a ticket moves no chips.
--
-- READ FROM PRODUCTION AND SOURCE
--
-- A Midway Free Buy first entry is already the one-chip promo-funded head
-- (fn_ca_midway_free_buy_promo_head, #9515): one registration per user per
-- event (tournament_players_tournament_id_user_id_key), funded from the union
-- promo wallet at entry, returned when the player unregisters before play.
-- Rebuys and add-ons go through fn_ca_process_tournament_chip_purchase_money_v1
-- from the player's own wallet. Nothing capped first entries per day, so the
-- ticket allowance did not exist.
--
-- WHAT THIS CHANGES
--
-- * The allotment is a right, not a job: every user has five tickets for every
--   gaming day without a grant sweep, so offline and new users are covered by
--   construction and nothing can grant twice. The day row is written once, on
--   the first redemption, with allotment 5 (the only value allowed).
-- * Gaming day = the America/Chicago date of the event's start minus the daily
--   window end (06:00, smarter_private.daily_window_policy): an event at 00:30
--   belongs to the day before, like the 00:30 Midnight Free Buy.
-- * Both registration doors (player and horse; horses are players) redeem one
--   ticket immediately before the promo head is funded, in the same
--   transaction. Exhausted -> the registration is refused with
--   FREE_BUY_TICKETS_USED_TODAY and nothing is charged. A second ticket for
--   the same event is impossible (one live redemption per user and event).
-- * An unplayed entry that is returned (unregistration / pre-start cancel,
--   the promo head's return path) gives its ticket back the same day.
-- * Funding is unchanged: the voucher is the existing one-chip promo head.
--   For a guaranteed Free Buy those promo chips are house/promo funding inside
--   H = max(0, G - C) (fn_ca_guarantee_funding counts promo_send as posted
--   house funding, never as player money); for a Free Buy without a guarantee
--   the voucher is funded as before (V), never suppressed.
-- * fn_ca_free_buy_tickets() lets a signed-in player read their own day.
--
-- No chips move in this migration.
--
-- @live-proof: to_regclass('smarter_private.free_buy_ticket_redemptions') IS NOT NULL AND position('free_buy_ticket_redeem' in pg_get_functiondef('public.fn_register_for_tournament_before_atomic_capacity_20260907(uuid,boolean)'::regprocedure))>0 AND position('free_buy_ticket_redeem' in pg_get_functiondef('public.fn_register_horse_for_tournament_before_maintenance_gate(uuid,uuid)'::regprocedure))>0 AND position('free_buy_ticket_restore' in pg_get_functiondef('public.fn_ca_midway_free_buy_promo_head(uuid,uuid,boolean)'::regprocedure))>0

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

CREATE TABLE smarter_private.free_buy_ticket_days (
 user_id uuid NOT NULL,
 gaming_day date NOT NULL,
 allotment smallint NOT NULL DEFAULT 5 CHECK (allotment = 5),
 used smallint NOT NULL DEFAULT 0 CHECK (used >= 0 AND used <= allotment),
 granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (user_id, gaming_day)
);
REVOKE ALL ON smarter_private.free_buy_ticket_days FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE smarter_private.free_buy_ticket_redemptions (
 registration_id uuid PRIMARY KEY,
 user_id uuid NOT NULL,
 tournament_id uuid NOT NULL,
 gaming_day date NOT NULL,
 redeemed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 returned_at timestamptz
);
CREATE UNIQUE INDEX free_buy_ticket_one_live_per_event
 ON smarter_private.free_buy_ticket_redemptions (user_id, tournament_id) WHERE returned_at IS NULL;
REVOKE ALL ON smarter_private.free_buy_ticket_redemptions FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION smarter_private.free_buy_gaming_day(p_at timestamptz) RETURNS date
 LANGUAGE sql STABLE SET search_path TO 'pg_catalog', 'smarter_private' AS $fn$
 SELECT ((coalesce(p_at, clock_timestamp()) AT TIME ZONE coalesce(p.time_zone, 'America/Chicago'))
         - coalesce(p.window_end, time '06:00')::interval)::date
   FROM (SELECT NULL::int AS one) z
   LEFT JOIN smarter_private.daily_window_policy p ON p.singleton
$fn$;
REVOKE ALL ON FUNCTION smarter_private.free_buy_gaming_day(timestamptz) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION smarter_private.free_buy_ticket_redeem(p_tournament_id uuid, p_registration_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public', 'smarter_private' AS $fn$
DECLARE v_user uuid; v_day date; v_start timestamptz; n integer;
BEGIN
 IF public.fn_ca_midway_free_buy_format(p_tournament_id) IS NULL THEN RETURN; END IF;
 IF EXISTS (SELECT 1 FROM smarter_private.free_buy_ticket_redemptions r
             WHERE r.registration_id = p_registration_id AND r.returned_at IS NULL) THEN
  RETURN;  -- this registration already holds its ticket (replay)
 END IF;
 SELECT p.user_id INTO v_user FROM public.tournament_players p
  WHERE p.id = p_registration_id AND p.tournament_id = p_tournament_id;
 IF v_user IS NULL THEN RAISE EXCEPTION 'A Free Buy ticket requires its exact registration'; END IF;
 SELECT coalesce(t.start_time, t.started_at) INTO v_start FROM public.tournaments t WHERE t.id = p_tournament_id;
 v_day := smarter_private.free_buy_gaming_day(v_start);
 INSERT INTO smarter_private.free_buy_ticket_days (user_id, gaming_day) VALUES (v_user, v_day)
 ON CONFLICT (user_id, gaming_day) DO NOTHING;
 UPDATE smarter_private.free_buy_ticket_days d SET used = d.used + 1
  WHERE d.user_id = v_user AND d.gaming_day = v_day AND d.used < d.allotment;
 GET DIAGNOSTICS n = ROW_COUNT;
 IF n <> 1 THEN
  RAISE EXCEPTION 'FREE_BUY_TICKETS_USED_TODAY: all five of today''s Free Buy tickets are used'
   USING ERRCODE = 'P0001', HINT = 'Tickets cover first entries only; five per player per gaming day.';
 END IF;
 BEGIN
  INSERT INTO smarter_private.free_buy_ticket_redemptions (registration_id, user_id, tournament_id, gaming_day)
  VALUES (p_registration_id, v_user, p_tournament_id, v_day);
 EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'FREE_BUY_TICKET_ALREADY_USED_FOR_EVENT: one Free Buy ticket per player per event'
   USING ERRCODE = 'P0001';
 END;
END $fn$;
REVOKE ALL ON FUNCTION smarter_private.free_buy_ticket_redeem(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION smarter_private.free_buy_ticket_restore(p_registration_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'smarter_private' AS $fn$
DECLARE v_user uuid; v_day date;
BEGIN
 UPDATE smarter_private.free_buy_ticket_redemptions r SET returned_at = clock_timestamp()
  WHERE r.registration_id = p_registration_id AND r.returned_at IS NULL
 RETURNING r.user_id, r.gaming_day INTO v_user, v_day;
 IF v_user IS NULL THEN RETURN; END IF;
 UPDATE smarter_private.free_buy_ticket_days d SET used = d.used - 1
  WHERE d.user_id = v_user AND d.gaming_day = v_day AND d.used > 0;
END $fn$;
REVOKE ALL ON FUNCTION smarter_private.free_buy_ticket_restore(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.fn_ca_free_buy_tickets() RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public', 'smarter_private' AS $fn$
 SELECT CASE WHEN auth.uid() IS NULL THEN NULL ELSE jsonb_build_object(
  'gaming_day', g.day, 'allotment', 5,
  'used', coalesce(d.used, 0), 'remaining', 5 - coalesce(d.used, 0))
 END
 FROM (SELECT smarter_private.free_buy_gaming_day(clock_timestamp()) AS day) g
 LEFT JOIN smarter_private.free_buy_ticket_days d ON d.user_id = auth.uid() AND d.gaming_day = g.day
$fn$;
REVOKE ALL ON FUNCTION public.fn_ca_free_buy_tickets() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ca_free_buy_tickets() TO authenticated, service_role;

DO $patch$
DECLARE
 f text; v_def text;
 c_anchor constant text := 'PERFORM public.fn_ca_midway_free_buy_promo_head(p_tournament_id,v_player_id,false);';
 c_return constant text := E' RETURN 1;\nEND;';
BEGIN
 FOREACH f IN ARRAY ARRAY['public.fn_register_for_tournament_before_atomic_capacity_20260907(uuid,boolean)',
                          'public.fn_register_horse_for_tournament_before_maintenance_gate(uuid,uuid)'] LOOP
  v_def := pg_get_functiondef(f::regprocedure);
  IF (length(v_def) - length(replace(v_def, c_anchor, ''))) / length(c_anchor) <> 1 THEN
   RAISE EXCEPTION 'Free Buy ticket anchor in % not found exactly once; refusing to patch', f;
  END IF;
  EXECUTE replace(v_def, c_anchor,
   'PERFORM smarter_private.free_buy_ticket_redeem(p_tournament_id,v_player_id);' || E'\n  ' || c_anchor);
 END LOOP;

 v_def := pg_get_functiondef('public.fn_ca_midway_free_buy_promo_head(uuid,uuid,boolean)'::regprocedure);
 IF (length(v_def) - length(replace(v_def, c_return, ''))) / length(c_return) <> 1 THEN
  RAISE EXCEPTION 'promo head return anchor not found exactly once; refusing to patch';
 END IF;
 EXECUTE replace(v_def, c_return,
  E' IF p_return THEN PERFORM smarter_private.free_buy_ticket_restore(p_registration_id); END IF;\n' || c_return);
END
$patch$;

DO $post$
BEGIN
 IF smarter_private.free_buy_gaming_day('2026-11-06 06:30:00+00') <> date '2026-11-05'
  OR smarter_private.free_buy_gaming_day('2026-11-05 14:30:00+00') <> date '2026-11-05'
  OR smarter_private.free_buy_gaming_day('2026-11-05 11:59:00+00') <> date '2026-11-04' THEN
  RAISE EXCEPTION 'Free Buy gaming day boundary is wrong';
 END IF;
 IF has_function_privilege('authenticated', 'smarter_private.free_buy_ticket_redeem(uuid,uuid)', 'EXECUTE')
  OR has_table_privilege('authenticated', 'smarter_private.free_buy_ticket_days', 'SELECT') THEN
  RAISE EXCEPTION 'Free Buy ticket store exposed';
 END IF;
END $post$;

COMMIT;
