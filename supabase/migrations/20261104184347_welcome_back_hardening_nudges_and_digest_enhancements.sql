-- 20261104184347_welcome_back_hardening_nudges_and_digest_enhancements.sql
--
-- Version reserved by scripts/reserve-migration-version.sh.
--
-- Follow-up to 20261104145956 (welcome-back chips, Dan 2026-11-04), found in
-- the same-day bug hunt after the first live run paid 21 players:
--
--   1. fn_sp_signup_welcome_back_run scanned every clubless sign-up on every
--      hourly run, oldest first, inside the same LIMIT as new sign-ups. Seven
--      players are already waiting for a club; as that list grows it would
--      fill the limit and a newer sign-up could wait forever. A player
--      recorded as no_club is now re-examined only once they hold an active
--      membership in a Midway Union club (the same test fn_promo_disburse
--      applies), so they are paid the hour after they join and never crowd
--      out anyone else.
--
--   2. fn_sp_digest_signups said "push" was true the moment the in-app
--      notification was raised. The first run queued 21 pushes and the
--      dispatcher skipped all 21 (no_subscription): none of those players has
--      a live device subscription. The digest now reports the real outcome
--      from push_outbox: sent, no device, failed, queued, or not raised.
--
--   3. Two overlapping runs could pay a player twice: fn_promo_disburse checks
--      its op_id with a plain SELECT before locking the wallet. The run now
--      takes pg_advisory_xact_lock so runs serialize.
--
--   4. A disbursement that failed for any reason other than club membership
--      (promo wallet empty, a ledger refusal) was returned to the caller and
--      stored nowhere, so the digest said "nobody qualified" while players sat
--      unpaid. Such players are now recorded with status 'failed', retried on
--      every run, and listed in the digest under "Could Not Be Paid".
--
--   5. KINGS CLUB is recognised by its id (a41434bb-...) as well as its name,
--      so a rename or stray whitespace cannot flip every sign-up to "not
--      KINGS CLUB". A replayed disbursement now reads its club from the
--      ledger instead of writing a NULL club.
--
-- ENHANCEMENTS (Dan, 2026-11-04 13:02 Central: "fully build, fix and enhance
-- all of these"):
--
--   6. Settings, not code: the chip amount, the 24-hour wait, both nudge
--      delays and the low-wallet line live in sp_digest_settings
--      (welcome_back_chips, welcome_back_hours, welcome_back_club_nudge_hours,
--      welcome_back_play_nudge_hours, promo_wallet_low_chips).
--   7. Two nudges, each sent once per player by in-app/push, email and text:
--      a club nudge for a sign-up stuck without a club ("join KINGS CLUB with
--      code 25450 and your chips are waiting"), and a play nudge for a player
--      who still has no hand 72 hours after the chips landed. Receipts live
--      on the awards row; fn_sp_signup_welcome_back_mark records them.
--   8. The digest gains: conversion (how many welcome-back players have since
--      played, that day and over 7 days and all time), the Midway Union promo
--      wallet balance with 7-day outflow and days of runway, an agent
--      scoreboard for the last 7 days (sign-ups, joined, played, push on, per
--      referrer), and push coverage for new sign-ups.
--
-- Qualified against production as pg_temp copies in self-aborting DO blocks.
--
-- @live-proof: (SELECT position('pg_advisory_xact_lock' in pg_get_functiondef('public.fn_sp_signup_welcome_back_run'::regproc)) > 0 AND position('agents_7d' in pg_get_functiondef('public.fn_sp_digest_signups'::regproc)) > 0 AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sp_signup_welcome_back_awards_status_check' AND pg_get_constraintdef(oid) LIKE '%failed%') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sp_signup_welcome_back_awards' AND column_name = 'play_nudge_notified_at') AND (SELECT count(*) FROM public.sp_digest_settings WHERE key LIKE 'welcome_back_%' OR key = 'promo_wallet_low_chips') = 5)

BEGIN;

-- The awards table gains a third status: 'failed' (tried to pay, could not).
ALTER TABLE public.sp_signup_welcome_back_awards
  DROP CONSTRAINT IF EXISTS sp_signup_welcome_back_awards_status_check;
ALTER TABLE public.sp_signup_welcome_back_awards
  ADD CONSTRAINT sp_signup_welcome_back_awards_status_check CHECK (status IN ('awarded', 'no_club', 'failed'));

-- Nudge receipts. The club nudge goes to a sign-up parked without a club; the
-- play nudge to a paid player with no hand after the configured delay. Each
-- is raised once (the *_notified_at stamp is the in-app/push leg and the
-- "already sent" test); email and text record their own outcome.
ALTER TABLE public.sp_signup_welcome_back_awards
  ADD COLUMN IF NOT EXISTS club_nudge_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS club_nudge_email_at   timestamptz,
  ADD COLUMN IF NOT EXISTS club_nudge_email_error text,
  ADD COLUMN IF NOT EXISTS club_nudge_sms_at     timestamptz,
  ADD COLUMN IF NOT EXISTS club_nudge_sms_error  text,
  ADD COLUMN IF NOT EXISTS play_nudge_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS play_nudge_email_at   timestamptz,
  ADD COLUMN IF NOT EXISTS play_nudge_email_error text,
  ADD COLUMN IF NOT EXISTS play_nudge_sms_at     timestamptz,
  ADD COLUMN IF NOT EXISTS play_nudge_sms_error  text;

INSERT INTO public.sp_digest_settings (key, value, note) VALUES
  ('welcome_back_chips', 25, 'Free chips paid from the Midway Union promo wallet to a sign-up with no hand after welcome_back_hours'),
  ('welcome_back_hours', 24, 'Hours after sign-up before a player with no hand is paid welcome-back chips'),
  ('welcome_back_club_nudge_hours', 1, 'Hours a sign-up sits without a club before the join-a-club nudge goes out'),
  ('welcome_back_play_nudge_hours', 72, 'Hours after the chips land before a player who still has no hand gets the play nudge'),
  ('promo_wallet_low_chips', 2500, 'Midway Union promo wallet at or below this chips lands in the digest as Needs Attention (100 welcome-back awards at 25)')
ON CONFLICT (key) DO NOTHING;

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
  v_kings uuid := 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';  -- KINGS CLUB (renamed from SHARK CLUB 2026-10-21); the id survives a rename
  v_amount numeric := round(public.fn_sp_setting('welcome_back_chips', 25), 2);
  v_low numeric := public.fn_sp_setting('promo_wallet_low_chips', 2500);
  w7 timestamptz := e - interval '7 days';
  v_signups jsonb; v_awards jsonb; v_waiting jsonb; v_failed jsonb;
  v_conv jsonb; v_wallet jsonb; v_agents jsonb; v_push jsonb; v_nudges jsonb;
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
             'is_kings_club', (c.id = v_kings OR upper(btrim(c.name)) = 'KINGS CLUB'),
             'in_midway_union', c.union_id = v_union OR c.id = v_union,
             'agent', ap.username,
             'agent_display_name', ap.display_name,
             'status', COALESCE(cm.status, 'active'),
             'joined_at', cm.joined_at,
             'joined_ct', to_char(cm.joined_at AT TIME ZONE 'America/Chicago', 'Mon DD HH12:MI AM')
           ) ORDER BY cm.joined_at) AS clubs,
           bool_or((c.id = v_kings OR upper(btrim(c.name)) = 'KINGS CLUB')) AS in_kings_club,
           (array_agg(ap.username ORDER BY ((c.id = v_kings OR upper(btrim(c.name)) = 'KINGS CLUB')) DESC, cm.joined_at) FILTER (WHERE ap.username IS NOT NULL))[1] AS agent
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
           'push_status', COALESCE((SELECT CASE po.status WHEN 'sent' THEN 'sent'
                                                 WHEN 'skipped' THEN CASE WHEN po.failure_reason = 'no_subscription' THEN 'no device' ELSE 'skipped: ' || COALESCE(po.failure_reason, '') END
                                                 WHEN 'failed' THEN 'failed'
                                                 WHEN 'deactivated' THEN 'no device'
                                                 ELSE COALESCE(po.status, 'queued') END
                                      FROM public.push_outbox po
                                     WHERE po.recipient_user_id = a.user_id AND po.event = 'welcome_back_chips'
                                     ORDER BY po.created_at DESC LIMIT 1),
                                   CASE WHEN a.notification_at IS NULL THEN 'not raised'
                                        WHEN a.notification_at < now() - interval '1 day' THEN 'dropped (outbox cap)'
                                        ELSE 'queued' END),
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
           'played_since', EXISTS (SELECT 1 FROM public.ca_hand_facts f WHERE f.user_id = a.user_id AND f.played_at > a.awarded_at),
           'play_nudge', CASE WHEN a.play_nudge_notified_at IS NULL THEN NULL
                              ELSE jsonb_build_object('at_ct', to_char(a.play_nudge_notified_at AT TIME ZONE 'America/Chicago', 'Mon DD HH12:MI AM'),
                                                      'email', CASE WHEN a.play_nudge_email_at IS NOT NULL THEN 'sent' WHEN a.email IS NULL THEN 'no email' WHEN a.play_nudge_email_error IS NOT NULL THEN 'failed' ELSE 'pending' END,
                                                      'text', CASE WHEN a.play_nudge_sms_at IS NOT NULL THEN 'sent' WHEN a.phone IS NULL THEN 'no phone' WHEN a.play_nudge_sms_error IS NOT NULL THEN 'failed' ELSE 'pending' END) END
         ) ORDER BY a.awarded_at), '[]'::jsonb)
    INTO v_awards
    FROM public.sp_signup_welcome_back_awards a
    JOIN public.profiles p ON p.id = a.user_id
    LEFT JOIN public.clubs c ON c.id = a.club_id
   WHERE a.status = 'awarded' AND a.awarded_at >= s AND a.awarded_at < e;

  -- Players the promotion wants to pay but who have not joined a club yet.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'username', p.username,
           'signed_up_ct', to_char(a.signed_up_at AT TIME ZONE 'America/Chicago', 'Mon DD HH12:MI AM'),
           'club_nudge', CASE WHEN a.club_nudge_notified_at IS NULL THEN 'not yet'
                              ELSE 'push ' || CASE WHEN EXISTS (SELECT 1 FROM public.push_outbox po WHERE po.recipient_user_id = a.user_id AND po.event = 'welcome_back_club_nudge' AND po.status = 'sent') THEN 'sent' ELSE 'no device' END
                                   || ', email ' || CASE WHEN a.club_nudge_email_at IS NOT NULL THEN 'sent' WHEN a.email IS NULL THEN 'none' WHEN a.club_nudge_email_error IS NOT NULL THEN 'failed' ELSE 'pending' END
                                   || ', text ' || CASE WHEN a.club_nudge_sms_at IS NOT NULL THEN 'sent' WHEN a.phone IS NULL THEN 'no phone' WHEN a.club_nudge_sms_error IS NOT NULL THEN 'failed' ELSE 'pending' END END
         ) ORDER BY a.signed_up_at), '[]'::jsonb)
    INTO v_waiting
    FROM public.sp_signup_welcome_back_awards a
    JOIN public.profiles p ON p.id = a.user_id
   WHERE a.status = 'no_club';

  -- Players the promotion tried to pay and could not (promo wallet empty, a
  -- ledger refusal). They are retried every hour; the owner sees them here.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'username', p.username,
           'signed_up_ct', to_char(a.signed_up_at AT TIME ZONE 'America/Chicago', 'Mon DD HH12:MI AM'),
           'error', a.last_error,
           'since_ct', to_char(a.first_seen_at AT TIME ZONE 'America/Chicago', 'Mon DD HH12:MI AM')
         ) ORDER BY a.signed_up_at), '[]'::jsonb)
    INTO v_failed
    FROM public.sp_signup_welcome_back_awards a
    JOIN public.profiles p ON p.id = a.user_id
   WHERE a.status = 'failed';

  -- Did the chips work: welcome-back players who have since played a hand.
  SELECT jsonb_build_object(
    'day', jsonb_build_object('awarded', count(*) FILTER (WHERE a.awarded_at >= s AND a.awarded_at < e),
                              'played', count(*) FILTER (WHERE a.awarded_at >= s AND a.awarded_at < e AND EXISTS (SELECT 1 FROM public.ca_hand_facts f WHERE f.user_id = a.user_id AND f.played_at > a.awarded_at))),
    'week', jsonb_build_object('awarded', count(*) FILTER (WHERE a.awarded_at >= w7 AND a.awarded_at < e),
                               'played', count(*) FILTER (WHERE a.awarded_at >= w7 AND a.awarded_at < e AND EXISTS (SELECT 1 FROM public.ca_hand_facts f WHERE f.user_id = a.user_id AND f.played_at > a.awarded_at))),
    'all', jsonb_build_object('awarded', count(*) FILTER (WHERE a.awarded_at < e),
                              'played', count(*) FILTER (WHERE a.awarded_at < e AND EXISTS (SELECT 1 FROM public.ca_hand_facts f WHERE f.user_id = a.user_id AND f.played_at > a.awarded_at)),
                              'chips', COALESCE(sum(a.amount) FILTER (WHERE a.awarded_at < e), 0)))
    INTO v_conv
    FROM public.sp_signup_welcome_back_awards a
   WHERE a.status = 'awarded';

  -- The promo wallet that funds this, with its 7-day outflow and runway.
  SELECT jsonb_build_object(
    'balance', round(COALESCE(uw.promo_wallet, 0), 2),
    'low_threshold', v_low,
    'low', COALESCE(uw.promo_wallet, 0) <= v_low,
    'welcome_back_7d_chips', x.wb7,
    'all_promo_7d_out', x.out7,
    'all_promo_7d_in', x.in7,
    'awards_left_at_amount', CASE WHEN v_amount > 0 THEN floor(COALESCE(uw.promo_wallet, 0) / v_amount) ELSE NULL END,
    -- Runway two ways: at the welcome-back promotion's own pace, and at the
    -- wallet's NET pace (everything out minus everything in over 7 days).
    -- The wallet is refilled by other promos, so gross outflow alone misleads.
    'days_left_at_welcome_back_pace', CASE WHEN x.wb7 > 0 THEN round(COALESCE(uw.promo_wallet, 0) / (x.wb7 / 7.0), 1) ELSE NULL END,
    'net_7d', round(x.in7 - x.out7, 2),
    'days_left_at_net_pace', CASE WHEN (x.out7 - x.in7) > 0 THEN round(COALESCE(uw.promo_wallet, 0) / ((x.out7 - x.in7) / 7.0), 1) ELSE NULL END)
    INTO v_wallet
    FROM public.union_wallets uw
    CROSS JOIN LATERAL (
      SELECT COALESCE((SELECT sum(a.amount) FROM public.sp_signup_welcome_back_awards a WHERE a.status = 'awarded' AND a.awarded_at >= w7 AND a.awarded_at < e), 0) AS wb7,
             COALESCE((SELECT sum(t.amount) FROM public.union_wallet_transactions t WHERE t.union_id = v_union AND t.wallet = 'promo_wallet' AND t.direction = 'debit' AND t.created_at >= w7 AND t.created_at < e), 0) AS out7,
             COALESCE((SELECT sum(t.amount) FROM public.union_wallet_transactions t WHERE t.union_id = v_union AND t.wallet = 'promo_wallet' AND t.direction = 'credit' AND t.created_at >= w7 AND t.created_at < e), 0) AS in7
    ) x
   WHERE uw.union_id = v_union;

  -- Agent scoreboard, last 7 days: who is bringing players, and do they stick.
  WITH hu7 AS (
    SELECT h.id, h.referred_by FROM smarter_private.sp_real_humans h WHERE h.created_at >= w7 AND h.created_at < e
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'referrer', COALESCE(rp.username, 'No referral'),
           'signups', x.n,
           'joined', x.joined,
           'kings_club', x.kings,
           'played', x.played,
           'push_on', x.push_on,
           'welcome_back_paid', x.paid
         ) ORDER BY x.n DESC, rp.username), '[]'::jsonb)
    INTO v_agents
    FROM (
      SELECT hu7.referred_by, count(*) n,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.club_members cm WHERE cm.user_id = hu7.id AND COALESCE(cm.status, 'active') IN ('active', 'approved'))) joined,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.club_members cm WHERE cm.user_id = hu7.id AND cm.club_id = v_kings AND COALESCE(cm.status, 'active') IN ('active', 'approved'))) kings,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.ca_hand_facts f WHERE f.user_id = hu7.id)) played,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.user_id = hu7.id AND COALESCE(ps.is_active, false))) push_on,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.sp_signup_welcome_back_awards a WHERE a.user_id = hu7.id AND a.status = 'awarded')) paid
        FROM hu7 GROUP BY hu7.referred_by) x
    LEFT JOIN public.profiles rp ON rp.id = x.referred_by;

  -- Push coverage: how many of the week's sign-ups, and of everyone paid, have a live device.
  SELECT jsonb_build_object(
    'week_signups', (SELECT count(*) FROM smarter_private.sp_real_humans h WHERE h.created_at >= w7 AND h.created_at < e),
    'week_with_device', (SELECT count(*) FROM smarter_private.sp_real_humans h WHERE h.created_at >= w7 AND h.created_at < e
                           AND EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.user_id = h.id AND COALESCE(ps.is_active, false))),
    'paid_total', (SELECT count(*) FROM public.sp_signup_welcome_back_awards a WHERE a.status = 'awarded'),
    'paid_with_device', (SELECT count(*) FROM public.sp_signup_welcome_back_awards a WHERE a.status = 'awarded'
                           AND EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.user_id = a.user_id AND COALESCE(ps.is_active, false))))
    INTO v_push;

  -- Nudges that went out that day.
  SELECT jsonb_build_object(
    'club_nudges_day', (SELECT count(*) FROM public.sp_signup_welcome_back_awards a WHERE a.club_nudge_notified_at >= s AND a.club_nudge_notified_at < e),
    'play_nudges_day', (SELECT count(*) FROM public.sp_signup_welcome_back_awards a WHERE a.play_nudge_notified_at >= s AND a.play_nudge_notified_at < e),
    'play_nudged_then_played', (SELECT count(*) FROM public.sp_signup_welcome_back_awards a WHERE a.play_nudge_notified_at IS NOT NULL AND a.play_nudge_notified_at < e
                                   AND EXISTS (SELECT 1 FROM public.ca_hand_facts f WHERE f.user_id = a.user_id AND f.played_at > a.play_nudge_notified_at)),
    'play_nudged_total', (SELECT count(*) FROM public.sp_signup_welcome_back_awards a WHERE a.play_nudge_notified_at IS NOT NULL AND a.play_nudge_notified_at < e),
    'club_nudged_then_joined', (SELECT count(*) FROM public.sp_signup_welcome_back_awards a WHERE a.club_nudge_notified_at IS NOT NULL AND a.club_nudge_notified_at < e AND a.status = 'awarded'),
    'club_nudged_total', (SELECT count(*) FROM public.sp_signup_welcome_back_awards a WHERE a.club_nudge_notified_at IS NOT NULL AND a.club_nudge_notified_at < e))
    INTO v_nudges;

  RETURN jsonb_build_object(
    'day', v_day,
    'window', jsonb_build_object('start', s, 'end', e),
    'settings', jsonb_build_object('amount', v_amount, 'hours', public.fn_sp_setting('welcome_back_hours', 24),
                                   'club_nudge_hours', public.fn_sp_setting('welcome_back_club_nudge_hours', 1),
                                   'play_nudge_hours', public.fn_sp_setting('welcome_back_play_nudge_hours', 72)),
    'conversion', v_conv,
    'promo_wallet', v_wallet,
    'agents_7d', v_agents,
    'push_coverage', v_push,
    'nudges', v_nudges,
    'signups', v_signups,
    'signup_count', jsonb_array_length(v_signups),
    'welcome_back', jsonb_build_object(
      'amount', v_amount,
      'awarded', v_awards,
      'awarded_count', jsonb_array_length(v_awards),
      'waiting_for_club', v_waiting,
      'waiting_count', jsonb_array_length(v_waiting),
      'failed', v_failed,
      'failed_count', jsonb_array_length(v_failed)),
    'generated_at', now());
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_sp_signup_welcome_back_run(p_limit integer DEFAULT 50, p_since date DEFAULT '2026-10-19')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_union uuid := 'fade0000-0000-0000-0000-000000000001';
  v_kings uuid := 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
  -- Settings (sp_digest_settings), so the owner changes them without a migration.
  v_amount numeric := round(public.fn_sp_setting('welcome_back_chips', 25), 2);
  v_hours numeric := public.fn_sp_setting('welcome_back_hours', 24);
  v_club_nudge_hours numeric := public.fn_sp_setting('welcome_back_club_nudge_hours', 1);
  v_play_nudge_hours numeric := public.fn_sp_setting('welcome_back_play_nudge_hours', 72);
  v_since timestamptz := (p_since::timestamp AT TIME ZONE 'America/Chicago');
  c record; n record;
  v_op uuid; v_res jsonb; v_err text;
  v_email text; v_phone text; v_club uuid; v_club_name text;
  v_awarded jsonb := '[]'::jsonb; v_no_club jsonb := '[]'::jsonb; v_failed jsonb := '[]'::jsonb;
  v_club_nudges jsonb := '[]'::jsonb; v_play_nudges jsonb := '[]'::jsonb;
  v_kings_code text; v_kings_name text;
  v_amount_txt text := to_char(round(public.fn_sp_setting('welcome_back_chips', 25), 2), 'FM999999990.##');
  v_scanned int := 0;
BEGIN
  IF NOT public.fn_caller_is_engine() THEN
    RAISE EXCEPTION 'fn_sp_signup_welcome_back_run is service_role only' USING ERRCODE = '42501';
  END IF;

  -- One run at a time. fn_promo_disburse checks its op_id with a plain
  -- SELECT before it locks the wallet, so two overlapping runs (the hourly
  -- fire plus a manual call) could both pass that check and both pay. The
  -- lock is released with the transaction; a second caller waits, then sees
  -- the first run's awarded rows and pays nobody twice.
  PERFORM pg_advisory_xact_lock(hashtext('fn_sp_signup_welcome_back_run'));

  FOR c IN
    SELECT h.id, h.username, h.created_at, h.phone_verified
      FROM smarter_private.sp_real_humans h
     WHERE h.created_at <= now() - make_interval(mins => (v_hours * 60)::int)
       AND h.created_at >= v_since
       AND NOT EXISTS (SELECT 1 FROM public.ca_hand_facts f WHERE f.user_id = h.id)
       AND NOT EXISTS (SELECT 1 FROM public.club_member_play_totals t
                        WHERE t.user_id = h.id AND (COALESCE(t.hands, 0) > 0 OR COALESCE(t.mtt_hands, 0) > 0))
       AND NOT EXISTS (SELECT 1 FROM public.sp_signup_welcome_back_awards a
                        WHERE a.user_id = h.id AND a.status = 'awarded')
       -- A player already recorded as no_club is looked at again only once
       -- they hold an active seat in a Midway Union club. Otherwise the
       -- oldest clubless sign-ups would fill the limit on every run and a
       -- newer sign-up could wait forever.
       AND NOT EXISTS (SELECT 1 FROM public.sp_signup_welcome_back_awards a
                        WHERE a.user_id = h.id AND a.status = 'no_club'
                          AND NOT EXISTS (SELECT 1 FROM public.club_members m
                                           WHERE m.user_id = h.id
                                             AND COALESCE(m.status, 'active') IN ('active', 'approved')
                                             AND (m.club_id = v_union
                                                  OR EXISTS (SELECT 1 FROM public.union_clubs uc
                                                              WHERE uc.union_id = v_union AND uc.club_id = m.club_id))))
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
                 format('Welcome Back Chips - %s free chips from the Midway Union for your first hand', v_amount_txt),
                 NULL, v_op);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      v_res := jsonb_build_object('success', false, 'error', v_err);
    END;

    IF COALESCE((v_res->>'success')::boolean, false) THEN
      v_club := NULLIF(v_res->>'club_id', '')::uuid;
      IF v_club IS NULL THEN
        -- A replayed disbursement (paid by an earlier run whose award row was
        -- lost) carries no club_id; read it from the ledger it wrote.
        SELECT ct.club_id INTO v_club FROM public.chip_transactions ct
         WHERE ct.transaction_type = 'promo_disbursement' AND ct.metadata ->> 'op_id' = v_op::text
         ORDER BY ct.created_at DESC LIMIT 1;
      END IF;
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
          format('%s Free Chips Are Waiting For You', v_amount_txt),
          format('The Midway Union just added %s free chips to your %s wallet. Sit down and play your first hand.', v_amount_txt, COALESCE(v_club_name, 'club')),
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
      -- Not paid and not a membership problem: promo wallet empty, a ledger
      -- refusal, an exception. Recorded so the digest shows it and the next
      -- run tries again; the World Hub route answers non-200 so the
      -- dispatcher pages after three failed hours.
      INSERT INTO public.sp_signup_welcome_back_awards AS a
        (user_id, signed_up_at, status, amount, union_id, op_id, email, phone, last_error)
      VALUES (c.id, c.created_at, 'failed', v_amount, v_union, v_op, v_email, v_phone, left(COALESCE(v_res->>'error', 'unknown'), 500))
      ON CONFLICT (user_id) DO UPDATE
        SET status = 'failed', last_error = EXCLUDED.last_error, email = EXCLUDED.email, phone = EXCLUDED.phone, updated_at = now();
      v_failed := v_failed || jsonb_build_object('user_id', c.id, 'username', c.username, 'error', v_res->>'error');
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------------
  -- Nudge 1: a sign-up parked without a club cannot be paid. Tell them once
  -- how to join (KINGS CLUB's join code, and the referral code they used),
  -- in-app/push here, email and text from the World Hub job.
  -- ---------------------------------------------------------------------
  SELECT c2.club_id::text, c2.name INTO v_kings_code, v_kings_name FROM public.clubs c2 WHERE c2.id = v_kings;
  FOR n IN
    SELECT a.user_id, a.email, a.phone, p.username,
           (SELECT rf.referral_code_used FROM public.referrals rf WHERE rf.referee_id = a.user_id ORDER BY rf.created_at LIMIT 1) AS referral_code,
           rp.username AS referrer
      FROM public.sp_signup_welcome_back_awards a
      JOIN public.profiles p ON p.id = a.user_id
      LEFT JOIN public.profiles rp ON rp.id = p.referred_by
     WHERE a.status = 'no_club'
       AND a.club_nudge_notified_at IS NULL
       AND a.first_seen_at <= now() - make_interval(mins => (v_club_nudge_hours * 60)::int)
     ORDER BY a.first_seen_at
     LIMIT 100
  LOOP
    BEGIN
      PERFORM public.fn_raise_notification(n.user_id, 'welcome_back_club_nudge',
        format('%s Free Chips Are Waiting - Join A Club To Claim Them', v_amount_txt),
        format('Join %s with club code %s and the Midway Union will add %s free chips to your wallet.', COALESCE(v_kings_name, 'KINGS CLUB'), COALESCE(v_kings_code, ''), v_amount_txt),
        '/hub/club-arena/?join=' || COALESCE(v_kings_code, '') || COALESCE('&ref=' || n.referral_code, ''),
        jsonb_build_object('amount', v_amount, 'club_code', v_kings_code, 'referral_code', n.referral_code, 'promotion', 'signup_welcome_back_club_nudge'));
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      UPDATE public.sp_signup_welcome_back_awards SET last_error = 'club nudge notification: ' || v_err, updated_at = now() WHERE user_id = n.user_id;
    END;
    UPDATE public.sp_signup_welcome_back_awards SET club_nudge_notified_at = now(), updated_at = now() WHERE user_id = n.user_id;
    v_club_nudges := v_club_nudges || jsonb_build_object(
      'user_id', n.user_id, 'username', n.username, 'email', n.email, 'phone', n.phone,
      'club_code', v_kings_code, 'club', v_kings_name, 'referral_code', n.referral_code, 'referrer', n.referrer, 'amount', v_amount);
  END LOOP;

  -- ---------------------------------------------------------------------
  -- Nudge 2: the chips landed, the player still has no hand after the
  -- configured delay. One reminder.
  -- ---------------------------------------------------------------------
  FOR n IN
    SELECT a.user_id, a.email, a.phone, a.amount, p.username, cl.name AS club
      FROM public.sp_signup_welcome_back_awards a
      JOIN public.profiles p ON p.id = a.user_id
      LEFT JOIN public.clubs cl ON cl.id = a.club_id
     WHERE a.status = 'awarded'
       AND a.play_nudge_notified_at IS NULL
       AND a.awarded_at <= now() - make_interval(mins => (v_play_nudge_hours * 60)::int)
       AND NOT EXISTS (SELECT 1 FROM public.ca_hand_facts f WHERE f.user_id = a.user_id)
     ORDER BY a.awarded_at
     LIMIT 100
  LOOP
    BEGIN
      PERFORM public.fn_raise_notification(n.user_id, 'welcome_back_play_nudge',
        format('Your %s Free Chips Are Still Waiting', to_char(n.amount, 'FM999999990.##')),
        format('The %s free chips in your %s wallet have not been played yet. Pick a game and sit down.', to_char(n.amount, 'FM999999990.##'), COALESCE(n.club, 'club')),
        '/hub/club-arena/?welcome=chips',
        jsonb_build_object('amount', n.amount, 'club', n.club, 'promotion', 'signup_welcome_back_play_nudge'));
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      UPDATE public.sp_signup_welcome_back_awards SET last_error = 'play nudge notification: ' || v_err, updated_at = now() WHERE user_id = n.user_id;
    END;
    UPDATE public.sp_signup_welcome_back_awards SET play_nudge_notified_at = now(), updated_at = now() WHERE user_id = n.user_id;
    v_play_nudges := v_play_nudges || jsonb_build_object(
      'user_id', n.user_id, 'username', n.username, 'email', n.email, 'phone', n.phone, 'club', n.club, 'amount', n.amount);
  END LOOP;

  RETURN jsonb_build_object(
    'scanned', v_scanned,
    'amount', v_amount, 'hours', v_hours,
    'awarded', v_awarded, 'awarded_count', jsonb_array_length(v_awarded),
    'no_club', v_no_club, 'no_club_count', jsonb_array_length(v_no_club),
    'failed', v_failed, 'failed_count', jsonb_array_length(v_failed),
    'club_nudges', v_club_nudges, 'club_nudge_count', jsonb_array_length(v_club_nudges),
    'play_nudges', v_play_nudges, 'play_nudge_count', jsonb_array_length(v_play_nudges),
    'union_promo_wallet_after', (SELECT round(promo_wallet, 2) FROM public.union_wallets WHERE union_id = v_union),
    'ran_at', now());
END
$function$;

-- ---------------------------------------------------------------------------
-- Channel receipts, now including the two nudges
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_sp_signup_welcome_back_mark(p_user_id uuid, p_channel text, p_ok boolean, p_detail text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_detail text := left(COALESCE(p_detail, 'failed'), 500);
BEGIN
  IF NOT public.fn_caller_is_engine() THEN
    RAISE EXCEPTION 'fn_sp_signup_welcome_back_mark is service_role only' USING ERRCODE = '42501';
  END IF;
  CASE p_channel
    WHEN 'email' THEN
      UPDATE public.sp_signup_welcome_back_awards
         SET email_sent_at = CASE WHEN p_ok THEN now() ELSE email_sent_at END,
             email_error = CASE WHEN p_ok THEN NULL ELSE v_detail END, updated_at = now()
       WHERE user_id = p_user_id;
    WHEN 'sms' THEN
      UPDATE public.sp_signup_welcome_back_awards
         SET sms_sent_at = CASE WHEN p_ok THEN now() ELSE sms_sent_at END,
             sms_error = CASE WHEN p_ok THEN NULL ELSE v_detail END, updated_at = now()
       WHERE user_id = p_user_id;
    WHEN 'club_nudge_email' THEN
      UPDATE public.sp_signup_welcome_back_awards
         SET club_nudge_email_at = CASE WHEN p_ok THEN now() ELSE club_nudge_email_at END,
             club_nudge_email_error = CASE WHEN p_ok THEN NULL ELSE v_detail END, updated_at = now()
       WHERE user_id = p_user_id;
    WHEN 'club_nudge_sms' THEN
      UPDATE public.sp_signup_welcome_back_awards
         SET club_nudge_sms_at = CASE WHEN p_ok THEN now() ELSE club_nudge_sms_at END,
             club_nudge_sms_error = CASE WHEN p_ok THEN NULL ELSE v_detail END, updated_at = now()
       WHERE user_id = p_user_id;
    WHEN 'play_nudge_email' THEN
      UPDATE public.sp_signup_welcome_back_awards
         SET play_nudge_email_at = CASE WHEN p_ok THEN now() ELSE play_nudge_email_at END,
             play_nudge_email_error = CASE WHEN p_ok THEN NULL ELSE v_detail END, updated_at = now()
       WHERE user_id = p_user_id;
    WHEN 'play_nudge_sms' THEN
      UPDATE public.sp_signup_welcome_back_awards
         SET play_nudge_sms_at = CASE WHEN p_ok THEN now() ELSE play_nudge_sms_at END,
             play_nudge_sms_error = CASE WHEN p_ok THEN NULL ELSE v_detail END, updated_at = now()
       WHERE user_id = p_user_id;
    ELSE
      RAISE EXCEPTION 'unknown channel %', p_channel USING ERRCODE = '22023';
  END CASE;
END
$function$;

COMMIT;
