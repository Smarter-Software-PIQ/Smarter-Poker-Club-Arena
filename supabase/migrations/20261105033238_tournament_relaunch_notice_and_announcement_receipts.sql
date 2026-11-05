-- 20261105033238_tournament_relaunch_notice_and_announcement_receipts.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- OWNER REQUEST, 2026-11-04 (Central), verbatim:
--   "WHEN THEY LOGIN TO KINGS CLUB, THEY SHOULD HAVE A NEW NOTIFICATION AS
--    WELL THAT REQUIRES AN "OK" TO CLOSE THAT READS SOMETHING LIKE, "Thank
--    You For Your Patience While We Updated The Poker Tournament Arena. It
--    Took A Little Longer Then Expected To Fully Finish The Update, So We
--    Have Credited Your Account With 25 Chips For The Delay! Good Luck Out
--    There!""
--
-- WHAT THIS ADDS (one transaction):
--
--   1. ca_player_notices - a platform-wide blocking notice: a title, the
--      copy, the one word on its OK plate, an active flag and an optional
--      audience ('real_humans' means the digest's smarter_private.sp_real_humans
--      set; horses, probes and staff test accounts never see it). Reads go
--      through the function below, never the table.
--
--   2. ca_player_notice_acks - one row per (notice, player): the receipt
--      that the player tapped OK. Once it exists the notice never shows that
--      player again, on any device.
--
--   3. fn_ca_pending_player_notice() - authenticated callers only; returns
--      the one active notice the caller has not acknowledged (or NULL). The
--      Club Arena client calls it on entry and renders a modal that closes
--      only through its OK plate.
--
--   4. fn_ca_ack_player_notice(notice_id) - records the caller's OK.
--
--   5. The relaunch notice row itself, active, audience real_humans, shown
--      only to a player whose relaunch chips have landed.
--
--   6. fn_ca_relaunch_chips_catchup() on a ten-minute pg_cron: pays the
--      relaunch chips to an account that had no club seat on send day as
--      soon as it joins a Midway Union club.
--
-- No hot table is touched (CLAUDE.md DDL policy rule 9): two new tables and
-- two new functions, 1 s lock_timeout, 5 s statements.
--
-- @live-proof: (SELECT to_regclass('public.ca_player_notices') IS NOT NULL AND to_regclass('public.ca_player_notice_acks') IS NOT NULL)
-- @live-proof: (SELECT count(*) = 2 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('fn_ca_pending_player_notice', 'fn_ca_ack_player_notice'))
-- @live-proof: (SELECT EXISTS (SELECT 1 FROM public.ca_player_notices WHERE slug = 'tournament-arena-relaunch-2026-11-05' AND active))
-- @live-proof: (SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ca-relaunch-chips-catchup'))

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.ca_player_notices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  title       text NOT NULL,
  body        text NOT NULL,
  ok_label    text NOT NULL DEFAULT 'OK',
  audience    text NOT NULL DEFAULT 'real_humans' CHECK (audience IN ('real_humans', 'everyone')),
  active      boolean NOT NULL DEFAULT true,
  starts_at   timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz,
  -- When set, the notice shows only to a player who holds the promo
  -- disbursement whose op_id is md5(prefix || user_id)::uuid. The relaunch
  -- notice says "we have credited your account", so it waits until that is
  -- true for the player reading it.
  requires_promo_op_prefix text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ca_player_notice_acks (
  notice_id   uuid NOT NULL REFERENCES public.ca_player_notices(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  acked_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notice_id, user_id)
);

ALTER TABLE public.ca_player_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_player_notice_acks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_player_notices FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.ca_player_notice_acks FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ca_player_notices TO service_role;
GRANT SELECT ON public.ca_player_notice_acks TO service_role;

CREATE OR REPLACE FUNCTION public.fn_ca_pending_player_notice()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  n record;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  SELECT pn.id, pn.slug, pn.title, pn.body, pn.ok_label, pn.requires_promo_op_prefix
    INTO n
    FROM public.ca_player_notices pn
   WHERE pn.active
     AND pn.starts_at <= now()
     AND (pn.ends_at IS NULL OR pn.ends_at > now())
     AND NOT EXISTS (SELECT 1 FROM public.ca_player_notice_acks a WHERE a.notice_id = pn.id AND a.user_id = v_uid)
     AND (pn.audience = 'everyone'
          OR EXISTS (SELECT 1 FROM smarter_private.sp_real_humans h WHERE h.id = v_uid))
     AND (pn.requires_promo_op_prefix IS NULL
          OR EXISTS (SELECT 1 FROM public.chip_transactions ct
                      WHERE (ct.metadata ->> 'op_id') = md5(pn.requires_promo_op_prefix || v_uid::text)::uuid::text
                        AND ct.transaction_type = 'promo_disbursement'))
   ORDER BY pn.starts_at DESC
   LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('id', n.id, 'slug', n.slug, 'title', n.title, 'body', n.body, 'ok_label', n.ok_label);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_pending_player_notice() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ca_pending_player_notice() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_ca_ack_player_notice(p_notice_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_notice_id IS NULL THEN RETURN false; END IF;
  INSERT INTO public.ca_player_notice_acks (notice_id, user_id)
  SELECT pn.id, v_uid FROM public.ca_player_notices pn WHERE pn.id = p_notice_id
  ON CONFLICT (notice_id, user_id) DO NOTHING;
  RETURN FOUND;
END
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_ack_player_notice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ca_ack_player_notice(uuid) TO authenticated, service_role;

INSERT INTO public.ca_player_notices (slug, title, body, ok_label, audience, active, requires_promo_op_prefix)
VALUES (
  'tournament-arena-relaunch-2026-11-05',
  'Tournament Arena Update Complete',
  'Thank You For Your Patience While We Updated The Poker Tournament Arena. It Took A Little Longer Than Expected To Fully Finish The Update, So We Have Credited Your Account With 25 Chips For The Delay! Good Luck Out There!',
  'OK',
  'real_humans',
  true,
  'relaunch-2026-11-05:'
)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. The relaunch chips for players who had no club seat on send day.
--
-- The 25 chips land in club_members.chip_balance (fn_promo_disburse), so a
-- player with no seat in a Midway Union club had no wallet to receive them on
-- 2026-11-05. Every account that existed before 04:00 UTC that day is owed the
-- chips; this sweep pays each one the moment they hold a union seat, with the
-- same per-player op_id (md5('relaunch-2026-11-05:' || user_id)) the send day
-- batch used, so fn_promo_disburse replays rather than pays twice. It raises
-- the in-app/push notification and then the OK notice above appears for them.
-- pg_cron runs it every ten minutes; it stops paying after 2026-12-05.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ca_relaunch_chips_catchup()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_union uuid := 'fade0000-0000-0000-0000-000000000001';
  c record; v_op uuid; v_res jsonb; v_paid int := 0; v_err text;
BEGIN
  IF NOT public.fn_caller_is_engine() THEN
    RAISE EXCEPTION 'fn_ca_relaunch_chips_catchup is service_role only' USING ERRCODE = '42501';
  END IF;
  IF now() >= timestamptz '2026-12-05 00:00:00+00' THEN
    RETURN jsonb_build_object('paid', 0, 'ended', true);
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtext('fn_ca_relaunch_chips_catchup')) THEN
    RETURN jsonb_build_object('paid', 0, 'already_running', true);
  END IF;
  FOR c IN
    SELECT h.id
      FROM smarter_private.sp_real_humans h
     WHERE h.created_at < timestamptz '2026-11-05 04:00:00+00'
       AND NOT EXISTS (SELECT 1 FROM public.chip_transactions ct
                        WHERE (ct.metadata ->> 'op_id') = md5('relaunch-2026-11-05:' || h.id::text)::uuid::text
                          AND ct.transaction_type = 'promo_disbursement')
       AND EXISTS (SELECT 1 FROM public.club_members m
                    WHERE m.user_id = h.id
                      AND COALESCE(m.status, 'active') IN ('active', 'approved')
                      AND (m.club_id = v_union
                           OR EXISTS (SELECT 1 FROM public.union_clubs uc WHERE uc.union_id = v_union AND uc.club_id = m.club_id)))
     LIMIT 100
  LOOP
    v_op := md5('relaunch-2026-11-05:' || c.id::text)::uuid;
    BEGIN
      v_res := public.fn_promo_disburse('union', v_union, 'player', c.id, 25,
                 'Tournament Arena Relaunch - 25 chips from the Midway Union for the delay', NULL, v_op);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      v_res := jsonb_build_object('success', false, 'error', v_err);
    END;
    IF COALESCE((v_res->>'success')::boolean, false) AND NOT COALESCE((v_res->>'replayed')::boolean, false) THEN
      v_paid := v_paid + 1;
      BEGIN
        PERFORM public.fn_raise_notification(c.id, 'tournament_relaunch',
          'Your 25 Chips Are In Your Wallet',
          'Thank You For Your Patience While We Updated The Tournament Arena. MTTs, Spins, Sit & Gos And Satellites Are Back Open, And We Added 25 Chips To Your Wallet For The Delay. Good Luck Out There!',
          '/hub/club-arena/',
          jsonb_build_object('amount', 25, 'op_id', v_op, 'promotion', 'tournament_relaunch_2026_11_05'));
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('paid', v_paid, 'ran_at', now());
END
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_relaunch_chips_catchup() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_relaunch_chips_catchup() TO service_role;

SELECT cron.schedule('ca-relaunch-chips-catchup', '*/10 * * * *', 'SELECT public.fn_ca_relaunch_chips_catchup()');

COMMIT;
