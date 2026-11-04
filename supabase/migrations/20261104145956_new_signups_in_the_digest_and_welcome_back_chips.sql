-- 20261104145956_new_signups_in_the_digest_and_welcome_back_chips.sql
--
-- Version reserved by scripts/reserve-migration-version.sh against this tree,
-- origin/main and every remote branch.
--
-- OWNER REQUEST, 2026-11-04 08:53 Central, verbatim:
--   "INSIDE THE DAILY EMAIL, UNDER REAL PLAYER SIGN UPS, I WANT TO KNOW WHERE
--    THEY CAME FROM, LIKE WHAT AGENT THEY WERE REFERRED BY AND THE NAME OF THE
--    NEW PLAYERS, AND ALSO IF THEY ARE PART OF THE KINGS CLUB OR NOT. I WANT TO
--    KNOW IF A "NEW SIGN UP" HAS JOINED THE KINGS CLUB, (OR ANY OTHER CLUB).
--    IF PLAYER DO NOT PLAY A REAL HAND AFTER SIGNING UP, AND JOING AFTER 24
--    HOURS, THEY SHOULD RECEIVE A PUSH NOTIFICATION, EMAIL AND TEXT AWARDING
--    THEM 25 FREE CHIPS FROM THE MIDWAY UNION FUNDED BY THE PROMO WALLET TO ANY
--    AND ALL PLAYERS THAT DIDN'T PLAY LIVE AFTER 24 HOURS OF SIGN UP.
--    (OBVIOUSLY IF THEY DIDN'T ADD A PHONE NUMBER WE CAN'T TEXT)"
--
-- WHAT THIS ADDS (one transaction, nothing existing is changed):
--
--   1. fn_sp_digest_signups(day)  - read-only, service_role only. Every real
--      player who signed up that Chicago day: name, who referred them, which
--      agent they sit under, every club they joined (KINGS CLUB flagged), and
--      whether they have played a hand yet. Also lists the welcome-back chips
--      awarded that day. The World Hub digest renders it under Growth.
--
--   2. sp_signup_welcome_back_awards - one row per player the welcome-back
--      promotion has touched: the chips awarded, the club they landed in, and
--      what each channel (in-app/push, email, text) did. Keyed by the player,
--      so a player can never be awarded twice.
--
--   3. fn_sp_signup_welcome_back_run(limit, since) - service_role only. Finds
--      real players who signed up at least 24 hours ago and have not played a
--      single hand (no ca_hand_facts row and no club_member_play_totals hands),
--      and pays each one 25 chips from the Midway Union promo wallet through
--      the platform's own promo door, fn_promo_disburse (union -> player lands
--      as ordinary cashable chips in the player's club wallet, debits
--      union_wallets.promo_wallet, writes chip_ledger, chip_transactions and
--      union_wallet_transactions). The op_id is derived from the player id, so
--      a replay is answered by fn_promo_disburse's own idempotency. It then
--      raises the in-app notification (the mirror trigger forwards it to
--      push_outbox) and returns the email and phone the World Hub job needs to
--      send the email and the text. A player who is not yet in any Midway Union
--      club cannot receive chips; the row is kept as 'no_club' and retried on
--      every later run, so the chips land the moment they join.
--
--   4. fn_sp_signup_welcome_back_mark(user, channel, ok, detail) - records what
--      the email and text channels did, for the digest.
--
-- DEFINITIONS
--   Real players   smarter_private.sp_real_humans (the digest's own set).
--   Played a hand  a ca_hand_facts row for the player, or hands/mtt_hands > 0
--                  in club_member_play_totals. Same test as the digest's
--                  "Played A Hand" funnel line, plus the raw hand facts.
--   24 hours       profiles.created_at <= now() - 24 hours.
--   Since          players who signed up on or after 2026-10-19 (platform
--                  launch). Earlier accounts are not retroactively mailed.
--   Midway Union   fade0000-0000-0000-0000-000000000001 (the one union; the
--                  same constant fn_ca_midway_free_buy_promo_head uses).
--   Amount         25.00 chips, from union_wallets.promo_wallet.
--
-- This is a scheduled promotion, not a repair: the schedule IS the product
-- (CLAUDE.md 10.12, "a job whose schedule is the product").
--
-- @live-proof: (SELECT count(*)=3 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('fn_sp_digest_signups','fn_sp_signup_welcome_back_run','fn_sp_signup_welcome_back_mark'))
-- @live-proof: (SELECT to_regclass('public.sp_signup_welcome_back_awards') IS NOT NULL)

BEGIN;

CREATE TABLE IF NOT EXISTS public.sp_signup_welcome_back_awards (
  user_id          uuid PRIMARY KEY,
  signed_up_at     timestamptz NOT NULL,
  status           text NOT NULL CHECK (status IN ('awarded', 'no_club')),
  amount           numeric(14,2) NOT NULL DEFAULT 25,
  union_id         uuid NOT NULL,
  club_id          uuid,
  op_id            uuid NOT NULL,
  transaction_id   uuid,
  awarded_at       timestamptz,
  notification_at  timestamptz,
  email            text,
  email_sent_at    timestamptz,
  email_error      text,
  phone            text,
  sms_sent_at      timestamptz,
  sms_error        text,
  last_error       text,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- No foreign keys on purpose (production DDL policy rule 7): a stale row in a
-- promotion log is harmless; a lock on profiles or clubs is not.
CREATE INDEX IF NOT EXISTS sp_signup_welcome_back_awards_awarded_at_idx
  ON public.sp_signup_welcome_back_awards (awarded_at);
ALTER TABLE public.sp_signup_welcome_back_awards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sp_signup_welcome_back_awards FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sp_signup_welcome_back_awards TO service_role;
COMMENT ON TABLE public.sp_signup_welcome_back_awards IS
  'Welcome-back chips (Dan 2026-11-04): one row per real player who signed up, had not played a hand after 24 hours, and was offered 25 free chips from the Midway Union promo wallet. status awarded = chips landed; no_club = waiting for the player to join a Midway Union club.';

-- ---------------------------------------------------------------------------
-- 1. The digest's sign-up detail
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_sp_digest_signups(p_day date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_day date := COALESCE(p_day, (now() AT TIME ZONE 'America/Chicago')::date - 1);
  s timestamptz := (v_day::timestamp AT TIME ZONE 'America/Chicago');
  e timestamptz := ((v_day + 1)::timestamp AT TIME ZONE 'America/Chicago');
  v_union uuid := 'fade0000-0000-0000-0000-000000000001';
  v_signups jsonb; v_awards jsonb; v_waiting jsonb;
BEGIN
  WITH hu AS (
    SELECT h.*, p.display_name, p.full_name, p.phone, r.username AS referrer_username,
           r.display_name AS referrer_display_name,
           (SELECT rf.referral_code_used FROM public.referrals rf WHERE rf.referee_id = h.id ORDER BY rf.created_at LIMIT 1) AS referral_code_used
      FROM smarter_private.sp_real_humans h
      JOIN public.profiles p ON p.id = h.id
      LEFT JOIN public.profiles r ON r.id = h.referred_by
     WHERE h.created_at >= s AND h.created_at < e
  ),
  memberships AS (
    SELECT cm.user_id,
           jsonb_agg(jsonb_build_object(
             'club', c.name,
             'is_kings_club', upper(c.name) = 'KINGS CLUB',
             'in_midway_union', c.union_id = v_union OR c.id = v_union,
             'agent', ap.username,
             'agent_display_name', ap.display_name,
             'status', COALESCE(cm.status, 'active'),
             'joined_at', cm.joined_at,
             'joined_ct', to_char(cm.joined_at AT TIME ZONE 'America/Chicago', 'Mon DD HH12:MI AM')
           ) ORDER BY cm.joined_at) AS clubs,
           bool_or(upper(c.name) = 'KINGS CLUB') AS in_kings_club,
           (array_agg(ap.username ORDER BY (upper(c.name) = 'KINGS CLUB') DESC, cm.joined_at) FILTER (WHERE ap.username IS NOT NULL))[1] AS agent
      FROM public.club_members cm
      JOIN public.clubs c ON c.id = cm.club_id
      LEFT JOIN public.profiles ap ON ap.id = cm.agent_id
     WHERE cm.user_id IN (SELECT id FROM hu)
       AND COALESCE(cm.status, 'active') NOT IN ('departed', 'removed', 'banned', 'rejected')
       AND COALESCE(cm.is_active, true)
     GROUP BY cm.user_id
  ),
  hands AS (
    SELECT f.user_id, count(*) AS hands, min(f.played_at) AS first_hand_at
      FROM public.ca_hand_facts f
     WHERE f.user_id IN (SELECT id FROM hu)
     GROUP BY f.user_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'user_id', hu.id,
           'username', hu.username,
           'display_name', COALESCE(NULLIF(hu.display_name, ''), NULLIF(hu.full_name, ''), hu.username),
           'full_name', hu.full_name,
           'signed_up_at', hu.created_at,
           'signed_up_ct', to_char(hu.created_at AT TIME ZONE 'America/Chicago', 'HH12:MI AM'),
           'referred_by', hu.referrer_username,
           'referred_by_display_name', hu.referrer_display_name,
           'referral_code_used', hu.referral_code_used,
           'agent', m.agent,
           'clubs', COALESCE(m.clubs, '[]'::jsonb),
           'in_kings_club', COALESCE(m.in_kings_club, false),
           'joined_a_club', m.user_id IS NOT NULL,
           'hands', COALESCE(hd.hands, 0),
           'played_hand', COALESCE(hd.hands, 0) > 0,
           'first_hand_ct', to_char(hd.first_hand_at AT TIME ZONE 'America/Chicago', 'Mon DD HH12:MI AM'),
           'phone_on_file', hu.phone IS NOT NULL AND btrim(hu.phone) <> '',
           'phone_verified', hu.phone_verified,
           'email_confirmed', hu.email_confirmed_at IS NOT NULL,
           'welcome_back', (SELECT jsonb_build_object('status', a.status, 'awarded_at', a.awarded_at)
                              FROM public.sp_signup_welcome_back_awards a WHERE a.user_id = hu.id)
         ) ORDER BY hu.created_at), '[]'::jsonb)
    INTO v_signups
    FROM hu
    LEFT JOIN memberships m ON m.user_id = hu.id
    LEFT JOIN hands hd ON hd.user_id = hu.id;

  -- Welcome-back chips that landed that Chicago day.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'user_id', a.user_id,
           'username', p.username,
           'display_name', COALESCE(NULLIF(p.display_name, ''), NULLIF(p.full_name, ''), p.username),
           'signed_up_ct', to_char(a.signed_up_at AT TIME ZONE 'America/Chicago', 'Mon DD HH12:MI AM'),
           'awarded_ct', to_char(a.awarded_at AT TIME ZONE 'America/Chicago', 'HH12:MI AM'),
           'amount', a.amount,
           'club', c.name,
           'push', a.notification_at IS NOT NULL,
           'email', CASE WHEN a.email_sent_at IS NOT NULL THEN 'sent'
                         WHEN a.email IS NULL THEN 'no email'
                         WHEN a.email_error IS NOT NULL THEN 'failed'
                         ELSE 'pending' END,
           'email_error', a.email_error,
           'text', CASE WHEN a.sms_sent_at IS NOT NULL THEN 'sent'
                        WHEN a.phone IS NULL THEN 'no phone'
                        WHEN a.sms_error IS NOT NULL THEN 'failed'
                        ELSE 'pending' END,
           'sms_error', a.sms_error,
           'played_since', EXISTS (SELECT 1 FROM public.ca_hand_facts f WHERE f.user_id = a.user_id AND f.played_at > a.awarded_at)
         ) ORDER BY a.awarded_at), '[]'::jsonb)
    INTO v_awards
    FROM public.sp_signup_welcome_back_awards a
    JOIN public.profiles p ON p.id = a.user_id
    LEFT JOIN public.clubs c ON c.id = a.club_id
   WHERE a.status = 'awarded' AND a.awarded_at >= s AND a.awarded_at < e;

  -- Players the promotion wants to pay but who have not joined a club yet.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'username', p.username,
           'signed_up_ct', to_char(a.signed_up_at AT TIME ZONE 'America/Chicago', 'Mon DD HH12:MI AM')
         ) ORDER BY a.signed_up_at), '[]'::jsonb)
    INTO v_waiting
    FROM public.sp_signup_welcome_back_awards a
    JOIN public.profiles p ON p.id = a.user_id
   WHERE a.status = 'no_club';

  RETURN jsonb_build_object(
    'day', v_day,
    'window', jsonb_build_object('start', s, 'end', e),
    'signups', v_signups,
    'signup_count', jsonb_array_length(v_signups),
    'welcome_back', jsonb_build_object(
      'amount', 25,
      'awarded', v_awards,
      'awarded_count', jsonb_array_length(v_awards),
      'waiting_for_club', v_waiting,
      'waiting_count', jsonb_array_length(v_waiting)),
    'generated_at', now());
END
$function$;

REVOKE ALL ON FUNCTION public.fn_sp_digest_signups(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sp_digest_signups(date) TO service_role;
COMMENT ON FUNCTION public.fn_sp_digest_signups(date) IS
  'Daily digest (Dan 2026-11-04): every real player who signed up that Chicago day - name, who referred them, their agent, the clubs they joined (KINGS CLUB flagged) and whether they have played a hand - plus the welcome-back chips awarded that day. Read-only, service_role only.';

-- ---------------------------------------------------------------------------
-- 2. The welcome-back run
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_sp_signup_welcome_back_run(p_limit integer DEFAULT 50, p_since date DEFAULT '2026-10-19')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_union uuid := 'fade0000-0000-0000-0000-000000000001';
  v_amount numeric := 25;
  v_since timestamptz := (p_since::timestamp AT TIME ZONE 'America/Chicago');
  c record;
  v_op uuid; v_res jsonb; v_err text;
  v_email text; v_phone text; v_club uuid; v_club_name text;
  v_awarded jsonb := '[]'::jsonb; v_no_club jsonb := '[]'::jsonb; v_failed jsonb := '[]'::jsonb;
  v_scanned int := 0;
BEGIN
  IF NOT public.fn_caller_is_engine() THEN
    RAISE EXCEPTION 'fn_sp_signup_welcome_back_run is service_role only' USING ERRCODE = '42501';
  END IF;

  FOR c IN
    SELECT h.id, h.username, h.created_at, h.phone_verified
      FROM smarter_private.sp_real_humans h
     WHERE h.created_at <= now() - interval '24 hours'
       AND h.created_at >= v_since
       AND NOT EXISTS (SELECT 1 FROM public.ca_hand_facts f WHERE f.user_id = h.id)
       AND NOT EXISTS (SELECT 1 FROM public.club_member_play_totals t
                        WHERE t.user_id = h.id AND (COALESCE(t.hands, 0) > 0 OR COALESCE(t.mtt_hands, 0) > 0))
       AND NOT EXISTS (SELECT 1 FROM public.sp_signup_welcome_back_awards a
                        WHERE a.user_id = h.id AND a.status = 'awarded')
     ORDER BY h.created_at
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 500))
  LOOP
    v_scanned := v_scanned + 1;
    -- One op per player for life: fn_promo_disburse replays an op_id it has
    -- already paid, so a crash between the credit and this row's insert can
    -- never pay twice.
    v_op := md5('signup-welcome-back:' || c.id::text)::uuid;
    SELECT u.email INTO v_email FROM auth.users u WHERE u.id = c.id;
    SELECT NULLIF(btrim(p.phone), '') INTO v_phone FROM public.profiles p WHERE p.id = c.id;

    BEGIN
      v_res := public.fn_promo_disburse('union', v_union, 'player', c.id, v_amount,
                 'Welcome Back Chips - 25 free chips from the Midway Union for your first hand',
                 NULL, v_op);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      v_res := jsonb_build_object('success', false, 'error', v_err);
    END;

    IF COALESCE((v_res->>'success')::boolean, false) THEN
      v_club := NULLIF(v_res->>'club_id', '')::uuid;
      SELECT name INTO v_club_name FROM public.clubs WHERE id = v_club;
      INSERT INTO public.sp_signup_welcome_back_awards AS a
        (user_id, signed_up_at, status, amount, union_id, club_id, op_id, transaction_id, awarded_at, email, phone, last_error)
      VALUES
        (c.id, c.created_at, 'awarded', v_amount, v_union, v_club, v_op,
         NULLIF(v_res->>'transaction_id', '')::uuid, now(), v_email, v_phone, NULL)
      ON CONFLICT (user_id) DO UPDATE
        SET status = 'awarded', club_id = EXCLUDED.club_id, transaction_id = EXCLUDED.transaction_id,
            awarded_at = now(), email = EXCLUDED.email, phone = EXCLUDED.phone,
            last_error = NULL, updated_at = now();

      -- In-app notification; trg_mirror_notification_to_push_outbox forwards
      -- it to push_outbox and push-dispatch sends it to every device the
      -- player has allowed.
      BEGIN
        PERFORM public.fn_raise_notification(c.id, 'welcome_back_chips',
          '25 Free Chips Are Waiting For You',
          format('The Midway Union just added 25 free chips to your %s wallet. Sit down and play your first hand.', COALESCE(v_club_name, 'club')),
          '/hub/club-arena/',
          jsonb_build_object('amount', v_amount, 'club_id', v_club, 'club', v_club_name, 'op_id', v_op, 'promotion', 'signup_welcome_back'));
        UPDATE public.sp_signup_welcome_back_awards SET notification_at = now(), updated_at = now() WHERE user_id = c.id;
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        UPDATE public.sp_signup_welcome_back_awards SET last_error = 'notification: ' || v_err, updated_at = now() WHERE user_id = c.id;
      END;

      v_awarded := v_awarded || jsonb_build_object(
        'user_id', c.id, 'username', c.username, 'email', v_email, 'phone', v_phone,
        'phone_verified', c.phone_verified, 'club_id', v_club, 'club', v_club_name,
        'amount', v_amount, 'op_id', v_op, 'replayed', COALESCE((v_res->>'replayed')::boolean, false));
    ELSIF v_res->>'error' ILIKE '%Not In Any Club%' OR v_res->>'error' ILIKE '%Not An Active Member%' THEN
      INSERT INTO public.sp_signup_welcome_back_awards AS a
        (user_id, signed_up_at, status, amount, union_id, op_id, email, phone, last_error)
      VALUES (c.id, c.created_at, 'no_club', v_amount, v_union, v_op, v_email, v_phone, v_res->>'error')
      ON CONFLICT (user_id) DO UPDATE
        SET last_error = EXCLUDED.last_error, email = EXCLUDED.email, phone = EXCLUDED.phone, updated_at = now();
      v_no_club := v_no_club || jsonb_build_object('user_id', c.id, 'username', c.username);
    ELSE
      v_failed := v_failed || jsonb_build_object('user_id', c.id, 'username', c.username, 'error', v_res->>'error');
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'scanned', v_scanned,
    'awarded', v_awarded, 'awarded_count', jsonb_array_length(v_awarded),
    'no_club', v_no_club, 'no_club_count', jsonb_array_length(v_no_club),
    'failed', v_failed, 'failed_count', jsonb_array_length(v_failed),
    'union_promo_wallet_after', (SELECT round(promo_wallet, 2) FROM public.union_wallets WHERE union_id = v_union),
    'ran_at', now());
END
$function$;

REVOKE ALL ON FUNCTION public.fn_sp_signup_welcome_back_run(integer, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sp_signup_welcome_back_run(integer, date) TO service_role;
COMMENT ON FUNCTION public.fn_sp_signup_welcome_back_run(integer, date) IS
  'Welcome-back chips (Dan 2026-11-04): pays 25 chips from the Midway Union promo wallet, through fn_promo_disburse, to every real player who signed up 24+ hours ago and has not played a hand; raises the in-app/push notification; returns the email and phone the World Hub job mails and texts. Idempotent per player.';

-- ---------------------------------------------------------------------------
-- 3. Channel receipts
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_sp_signup_welcome_back_mark(p_user_id uuid, p_channel text, p_ok boolean, p_detail text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.fn_caller_is_engine() THEN
    RAISE EXCEPTION 'fn_sp_signup_welcome_back_mark is service_role only' USING ERRCODE = '42501';
  END IF;
  IF p_channel = 'email' THEN
    UPDATE public.sp_signup_welcome_back_awards
       SET email_sent_at = CASE WHEN p_ok THEN now() ELSE email_sent_at END,
           email_error = CASE WHEN p_ok THEN NULL ELSE left(COALESCE(p_detail, 'failed'), 500) END,
           updated_at = now()
     WHERE user_id = p_user_id;
  ELSIF p_channel = 'sms' THEN
    UPDATE public.sp_signup_welcome_back_awards
       SET sms_sent_at = CASE WHEN p_ok THEN now() ELSE sms_sent_at END,
           sms_error = CASE WHEN p_ok THEN NULL ELSE left(COALESCE(p_detail, 'failed'), 500) END,
           updated_at = now()
     WHERE user_id = p_user_id;
  ELSE
    RAISE EXCEPTION 'unknown channel %', p_channel USING ERRCODE = '22023';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.fn_sp_signup_welcome_back_mark(uuid, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sp_signup_welcome_back_mark(uuid, text, boolean, text) TO service_role;

COMMIT;
