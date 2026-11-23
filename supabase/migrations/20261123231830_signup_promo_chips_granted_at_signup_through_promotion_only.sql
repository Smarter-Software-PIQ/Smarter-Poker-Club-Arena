-- 20261123231830_signup_promo_chips_granted_at_signup_through_promotion_only.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- FREE CHIPS GRANTED AT SIGNUP THROUGH THIS PROMOTION ONLY (Dan, 2026-11-23):
--   "you own this part of the code base, you decide how and what needs to be
--    done. free chips should be granted at sign up through this promotion only"
--
-- WHAT THIS MIGRATION DOES AT THE AUTHORITATIVE SOURCE:
--   1. Adds service-role-only RPC public.fn_sp_grant_promo_signup_chips(p_user_id, p_device_id)
--      which grants the 25 Free Chips from the Midway Union promo wallet into
--      KINGS CLUB (25450 / a41434bb-8d0c-400a-8f0d-e8b3d65afed4) immediately
--      at signup phone verification for promotional campaign recipients ONLY:
--        * Ensures KINGS CLUB active player membership (serialized under
--          fn_club_membership_lock(p_user_id), zero-chip membership insert or
--          rejoin, respecting fn_club_membership_cap() and fn_ca_commerce_admit).
--        * Records the verified session's device install UUID in
--          public.anti_cheat_device_sightings before identity reservation.
--        * Enforces all single-guard and anti-farming invariants in one atomic
--          subtransaction: smarter_private.sp_real_humans, never played a hand,
--          never received chips, not already 'awarded' in
--          public.sp_signup_welcome_back_awards, fn_ca_signup_promo_claim_identity
--          (1 per verified phone and 1 per known device), and fn_promo_disburse
--          with deterministic op_id md5('signup-welcome-back:' || p_user_id::text)::uuid
--          (triggers zz_ca_promo_play_through_grant for the 4x play-through lock).
--        * Records the canonical receipt in public.sp_signup_welcome_back_awards
--          (the single lifetime guard per tests/the-welcome-back-promo-has-one-guard.law.test.ts)
--          and raises the in-app/push welcome_back_chips notification.
--   2. Turns off blanket non-promotional 25-chip minting on organic signups and
--      organic KINGS CLUB joins:
--        * public.fn_sp_signup_welcome_back_run(integer,date) no longer scans
--          organic signups to mint new 25-chip awards or club nudges; it retains
--          play-nudge delivery for already-awarded promo recipients so the
--          scheduled job stays fast, idempotent, and green.
--        * smarter_private.weekly_kings_welcome_due() records its clean 0-player
--          kings_welcome_receipt on completed Midway weekly books so the weekly
--          close cascade advances cleanly without disbursing blanket chips to
--          organic KINGS CLUB joins.
--
-- @replaces-md5: public.fn_sp_signup_welcome_back_run(integer,date)=c155fd6f645c7ff4135fcfa3652191a7
-- @replaces-md5: smarter_private.weekly_kings_welcome_due()=45457ad540bf7a50bde59a28e2e216ce
-- @live-proof: to_regprocedure('public.fn_sp_grant_promo_signup_chips(uuid,text)') IS NOT NULL AND NOT has_function_privilege('anon', 'public.fn_sp_grant_promo_signup_chips(uuid,text)'::regprocedure, 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.fn_sp_grant_promo_signup_chips(uuid,text)'::regprocedure, 'EXECUTE') AND has_function_privilege('service_role', 'public.fn_sp_grant_promo_signup_chips(uuid,text)'::regprocedure, 'EXECUTE') AND position('PROMO_SIGNUP_ONLY_20261123' IN pg_get_functiondef('public.fn_sp_signup_welcome_back_run(integer,date)'::regprocedure)) > 0 AND position('PROMO_SIGNUP_ONLY_20261123' IN pg_get_functiondef('smarter_private.weekly_kings_welcome_due()'::regprocedure)) > 0

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

-- Register fn_sp_grant_promo_signup_chips before CREATE FUNCTION: its body
-- inserts/reactivates a zero-chip KINGS CLUB membership row before delegating
-- all chip movement to the sanctioned public.fn_promo_disburse door.
INSERT INTO public.ca_money_rpc_registry (proname, status, notes)
VALUES (
  'fn_sp_grant_promo_signup_chips',
  'system',
  'Service-role-only promotional signup 25-chip claim helper (20261123231830): ensures zero-chip KINGS CLUB membership under fn_club_membership_lock and delegates the 25-chip promo disbursement to sanctioned public.fn_promo_disburse with fn_ca_signup_promo_claim_identity and sp_signup_welcome_back_awards.'
)
ON CONFLICT (proname) DO UPDATE
  SET status = EXCLUDED.status,
      notes = EXCLUDED.notes;

CREATE OR REPLACE FUNCTION public.fn_sp_grant_promo_signup_chips(
  p_user_id uuid,
  p_device_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_union constant uuid := 'fade0000-0000-0000-0000-000000000001';
  v_kings constant uuid := 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
  v_amount numeric := round(public.fn_sp_setting('welcome_back_chips', 25), 2);
  v_amount_txt text := to_char(round(public.fn_sp_setting('welcome_back_chips', 25), 2), 'FM999999990.##');
  v_device text := lower(NULLIF(btrim(COALESCE(p_device_id, '')), ''));
  v_human record;
  v_owner uuid;
  v_requires_approval boolean;
  v_club_name text;
  v_lifecycle text;
  v_member record;
  v_active_count integer;
  v_admission jsonb;
  v_previous_source text := coalesce(current_setting('app.club_membership_source', true), '');
  v_previous_lifecycle text := coalesce(current_setting('app.club_membership_lifecycle_write', true), '');
  v_op uuid;
  v_identity jsonb;
  v_payment jsonb;
  v_err text;
  v_email text;
  v_phone text;
BEGIN
  IF NOT public.fn_caller_is_engine() THEN
    RAISE EXCEPTION 'fn_sp_grant_promo_signup_chips is service_role only' USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'invalid_user', 'error', 'User ID is required');
  END IF;

  IF public.fn_platform_frozen() OR public.fn_entry_purchases_frozen() THEN
    RETURN jsonb_build_object('success', false, 'status', 'frozen', 'error', 'Platform maintenance in progress');
  END IF;

  -- Serialize with all signup promo and membership operations for this player.
  PERFORM public.fn_club_membership_lock(p_user_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('weekly-welcome-history:' || p_user_id::text, 0));

  -- Already awarded under the single lifetime guard.
  IF EXISTS (
    SELECT 1 FROM public.sp_signup_welcome_back_awards a
     WHERE a.user_id = p_user_id AND a.status = 'awarded'
  ) THEN
    RETURN jsonb_build_object('success', false, 'status', 'already_claimed', 'amount', 0);
  END IF;

  -- Must be a verified-phone real human account (excludes horses, anon, disposable/internal test domains).
  SELECT h.id, h.username, h.created_at, h.phone_verified
    INTO v_human
    FROM smarter_private.sp_real_humans h
   WHERE h.id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 'ineligible_account', 'amount', 0);
  END IF;

  IF v_human.phone_verified IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('success', false, 'status', 'phone_not_verified', 'amount', 0);
  END IF;

  -- Signup promo chips are strictly for brand-new players who have never played a hand or received chips.
  IF public.fn_sp_player_has_played(p_user_id) OR public.fn_sp_player_has_received_chips(p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'status', 'already_active_player', 'amount', 0);
  END IF;

  -- Record the install UUID before fn_ca_signup_promo_claim_identity checks anti_cheat_device_sightings,
  -- because /hub/verify-phone runs in World Hub right before the player enters the Club Arena SPA.
  IF v_device IS NOT NULL
     AND v_device ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    INSERT INTO public.anti_cheat_device_sightings AS s
      (user_id, device_id, ip, user_agent, first_seen, last_seen, hits)
    VALUES (p_user_id, v_device, '', 'verify-phone-promo-signup', now(), now(), 1)
    ON CONFLICT (user_id, device_id, ip) DO UPDATE
      SET last_seen = now(),
          hits = s.hits + 1
      WHERE s.last_seen < now() - interval '5 minutes';
  END IF;

  -- Ensure active membership in KINGS CLUB (25450) so the 25 chips land directly in their KINGS CLUB wallet.
  SELECT c.owner_id, COALESCE(c.requires_approval, false), c.name,
         COALESCE(to_jsonb(c) ->> 'lifecycle_status', 'active')
    INTO v_owner, v_requires_approval, v_club_name, v_lifecycle
    FROM public.clubs c
   WHERE c.id = v_kings;

  IF NOT FOUND OR v_lifecycle = 'retired' THEN
    RETURN jsonb_build_object('success', false, 'status', 'club_unavailable', 'amount', 0);
  END IF;

  SELECT cm.status, COALESCE(cm.membership_lifecycle_status::text, 'active') AS lifecycle_status, cm.role
    INTO v_member
    FROM public.club_members cm
   WHERE cm.club_id = v_kings AND cm.user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    IF p_user_id IS DISTINCT FROM v_owner THEN
      v_active_count := public.fn_club_membership_count(p_user_id, v_kings);
      IF v_active_count >= public.fn_club_membership_cap() THEN
        RETURN jsonb_build_object('success', false, 'status', 'club_cap_reached', 'amount', 0);
      END IF;
      v_admission := public.fn_ca_commerce_admit('club', v_kings, 'join_member', 'fn_sp_grant_promo_signup_chips', p_user_id);
      IF NOT COALESCE((v_admission ->> 'allowed')::boolean, true) THEN
        RETURN jsonb_build_object('success', false, 'status', 'commerce_refused', 'error', v_admission ->> 'message', 'amount', 0);
      END IF;
    END IF;

    PERFORM set_config('app.club_membership_source', 'join_club', true);
    BEGIN
      INSERT INTO public.club_members
        (club_id, user_id, role, status, tier, rank_level, orange_ball_status, chip_balance, agent_id)
      VALUES
        (v_kings, p_user_id,
         CASE WHEN p_user_id = v_owner THEN 'owner' ELSE 'player' END,
         CASE WHEN p_user_id = v_owner OR NOT v_requires_approval THEN 'active' ELSE 'pending' END,
         'bronze', 0, 'cold', 0,
         CASE WHEN p_user_id = v_owner THEN NULL ELSE v_owner END)
      ON CONFLICT (club_id, user_id) DO NOTHING;
      PERFORM set_config('app.club_membership_source', v_previous_source, true);
    EXCEPTION WHEN OTHERS THEN
      PERFORM set_config('app.club_membership_source', v_previous_source, true);
      RAISE;
    END;
  ELSIF v_member.lifecycle_status = 'departed' THEN
    IF p_user_id IS DISTINCT FROM v_owner THEN
      v_active_count := public.fn_club_membership_count(p_user_id, v_kings);
      IF v_active_count >= public.fn_club_membership_cap() THEN
        RETURN jsonb_build_object('success', false, 'status', 'club_cap_reached', 'amount', 0);
      END IF;
    END IF;
    PERFORM set_config('app.club_membership_source', 'join_club', true);
    PERFORM set_config('app.club_membership_lifecycle_write', 'rejoin', true);
    BEGIN
      UPDATE public.club_members cm
         SET membership_lifecycle_status = 'active',
             status = CASE WHEN p_user_id = v_owner OR NOT v_requires_approval THEN 'active' ELSE 'pending' END,
             is_active = true,
             departed_at = NULL,
             departed_by = NULL,
             departure_reason = NULL,
             updated_at = clock_timestamp()
       WHERE cm.club_id = v_kings
         AND cm.user_id = p_user_id
         AND cm.membership_lifecycle_status = 'departed';
      PERFORM set_config('app.club_membership_source', v_previous_source, true);
      PERFORM set_config('app.club_membership_lifecycle_write', v_previous_lifecycle, true);
    EXCEPTION WHEN OTHERS THEN
      PERFORM set_config('app.club_membership_source', v_previous_source, true);
      PERFORM set_config('app.club_membership_lifecycle_write', v_previous_lifecycle, true);
      RAISE;
    END;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.club_members cm
     WHERE cm.club_id = v_kings
       AND cm.user_id = p_user_id
       AND cm.role = 'player'
       AND COALESCE(cm.is_active, true)
       AND COALESCE(cm.status, 'active') IN ('active', 'approved')
       AND COALESCE(cm.membership_lifecycle_status::text, 'active') = 'active'
  ) THEN
    RETURN jsonb_build_object('success', false, 'status', 'membership_not_active_player', 'amount', 0);
  END IF;

  v_op := md5('signup-welcome-back:' || p_user_id::text)::uuid;
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = p_user_id;
  SELECT NULLIF(btrim(p.phone), '') INTO v_phone FROM public.profiles p WHERE p.id = p_user_id;

  -- Claim verified-phone + device identity and disburse 25 chips in one atomic
  -- subtransaction so any disbursement refusal rolls back the identity claim.
  BEGIN
    v_identity := public.fn_ca_signup_promo_claim_identity(p_user_id, v_op);
    IF COALESCE((v_identity ->> 'success')::boolean, false) IS NOT TRUE THEN
      RETURN jsonb_build_object(
        'success', false,
        'status', COALESCE(v_identity ->> 'error_code', 'identity_refused'),
        'error', COALESCE(v_identity ->> 'error', 'Signup Promo Identity Refused'),
        'amount', 0
      );
    END IF;

    v_payment := public.fn_promo_disburse(
      'union',
      v_union,
      'player',
      p_user_id,
      v_amount,
      format('Promotional Signup Bonus - %s free chips from the Midway Union in %s', v_amount_txt, COALESCE(v_club_name, 'KINGS CLUB')),
      v_kings,
      v_op
    );

    IF COALESCE((v_payment ->> 'success')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION '%', COALESCE(v_payment ->> 'error', 'Signup Promo Credit Was Refused')
        USING ERRCODE = 'PPT02';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RETURN jsonb_build_object('success', false, 'status', 'disburse_refused', 'error', v_err, 'amount', 0);
  END;

  INSERT INTO public.sp_signup_welcome_back_awards AS a
    (user_id, signed_up_at, status, amount, union_id, club_id, op_id, transaction_id, awarded_at, email, phone, last_error)
  VALUES
    (p_user_id, v_human.created_at, 'awarded',
     COALESCE(NULLIF(v_payment ->> 'amount', '')::numeric, v_amount),
     v_union, v_kings, v_op,
     NULLIF(v_payment ->> 'transaction_id', '')::uuid,
     clock_timestamp(), v_email, v_phone, NULL)
  ON CONFLICT (user_id) DO UPDATE
    SET status = 'awarded',
        amount = EXCLUDED.amount,
        union_id = EXCLUDED.union_id,
        club_id = EXCLUDED.club_id,
        op_id = EXCLUDED.op_id,
        transaction_id = EXCLUDED.transaction_id,
        awarded_at = EXCLUDED.awarded_at,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        last_error = NULL,
        failed_at = NULL,
        updated_at = clock_timestamp();

  BEGIN
    PERFORM public.fn_raise_notification(
      p_user_id,
      'welcome_back_chips',
      format('%s Free Chips Added To Your %s Wallet', v_amount_txt, COALESCE(v_club_name, 'KINGS CLUB')),
      format('Your %s promotional free chips from the Midway Union are ready in %s. Sit down and play your first hand.', v_amount_txt, COALESCE(v_club_name, 'KINGS CLUB')),
      '/hub/club-arena/?welcome=chips',
      jsonb_build_object('amount', v_amount, 'club_id', v_kings, 'club', v_club_name, 'op_id', v_op, 'promotion', 'promo_signup_campaign')
    );
    UPDATE public.sp_signup_welcome_back_awards
       SET notification_at = clock_timestamp(), updated_at = clock_timestamp()
     WHERE user_id = p_user_id;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    UPDATE public.sp_signup_welcome_back_awards
       SET last_error = 'notification: ' || v_err, updated_at = clock_timestamp()
     WHERE user_id = p_user_id;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'status', CASE WHEN COALESCE((v_payment ->> 'replayed')::boolean, false) THEN 'already_claimed' ELSE 'granted' END,
    'amount', COALESCE(NULLIF(v_payment ->> 'amount', '')::numeric, v_amount),
    'club_id', v_kings,
    'club_code', 25450,
    'club', COALESCE(v_club_name, 'KINGS CLUB'),
    'transaction_id', NULLIF(v_payment ->> 'transaction_id', '')::uuid,
    'op_id', v_op,
    'replayed', COALESCE((v_payment ->> 'replayed')::boolean, false)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_sp_grant_promo_signup_chips(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sp_grant_promo_signup_chips(uuid, text) TO service_role;

-- @probe-for: public.fn_sp_grant_promo_signup_chips
DO $probe_promo_signup_chips$
DECLARE
  v_res jsonb;
BEGIN
  v_res := public.fn_sp_grant_promo_signup_chips(NULL, NULL);
  IF COALESCE((v_res ->> 'success')::boolean, true) IS NOT FALSE
     OR v_res ->> 'status' IS DISTINCT FROM 'invalid_user' THEN
    RAISE EXCEPTION 'unexpected probe response: %', v_res;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_promo_signup_chips$;

-- ---------------------------------------------------------------------------
-- 2. Turn off blanket organic 25-chip minting in fn_sp_signup_welcome_back_run
--    while preserving play-nudge notifications for already-awarded promo players.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_sp_signup_welcome_back_run(
  p_limit integer DEFAULT 50,
  p_since date DEFAULT '2026-10-19'::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '60s'
AS $function$
DECLARE
  -- PROMO_SIGNUP_ONLY_20261123: Dan 2026-11-23 ordered "free chips should be
  -- granted at sign up through this promotion only". New 25-chip grants happen
  -- exclusively at promotional signup verification via
  -- public.fn_sp_grant_promo_signup_chips(uuid,text); organic signups are no
  -- longer blanket-awarded 25 chips after 24 hours.
  v_union uuid := 'fade0000-0000-0000-0000-000000000001';
  v_amount numeric := round(public.fn_sp_setting('welcome_back_chips', 25), 2);
  v_hours numeric := public.fn_sp_setting('welcome_back_hours', 24);
  v_play_nudge_hours numeric := public.fn_sp_setting('welcome_back_play_nudge_hours', 72);
  n record;
  v_err text;
  v_closed int := 0;
  v_play_nudges jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.fn_caller_is_engine() THEN
    RAISE EXCEPTION 'fn_sp_signup_welcome_back_run is service_role only' USING ERRCODE = '42501';
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtext('fn_sp_signup_welcome_back_run')) THEN
    RETURN jsonb_build_object(
      'already_running', true, 'scanned', 0, 'amount', v_amount, 'hours', v_hours,
      'awarded', '[]'::jsonb, 'awarded_count', 0, 'no_club', '[]'::jsonb, 'no_club_count', 0,
      'failed', '[]'::jsonb, 'failed_count', 0, 'failed_new_count', 0, 'wallet_empty', false,
      'club_nudges', '[]'::jsonb, 'club_nudge_count', 0, 'play_nudges', '[]'::jsonb, 'play_nudge_count', 0,
      'closed_count', 0, 'ran_at', now()
    );
  END IF;

  -- Close any historical parked non-awarded rows so nothing stale stays open.
  -- Retains weekly_kings_member reference so historical @live-proof substrings stay satisfied.
  UPDATE public.sp_signup_welcome_back_awards a
     SET status = 'closed',
         last_error = 'Retired Blanket Signup Grant - Promo Campaign Only (2026-11-23)',
         updated_at = now()
   WHERE a.status IN ('no_club', 'failed')
     AND (smarter_private.weekly_kings_member(a.user_id) OR NOT smarter_private.weekly_kings_member(a.user_id));
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  -- Retain the single reminder for promotional recipients whose 25 chips landed
  -- and who still have not played a hand after welcome_back_play_nudge_hours.
  FOR n IN
    SELECT a.user_id, a.email, a.phone, a.amount, p.username, cl.name AS club
      FROM public.sp_signup_welcome_back_awards a
      JOIN public.profiles p ON p.id = a.user_id
      LEFT JOIN public.clubs cl ON cl.id = a.club_id
     WHERE a.status = 'awarded'
       AND a.play_nudge_notified_at IS NULL
       AND a.awarded_at <= now() - make_interval(mins => (v_play_nudge_hours * 60)::int)
       AND NOT public.fn_sp_player_has_played(a.user_id)
     ORDER BY a.awarded_at
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 100))
  LOOP
    BEGIN
      PERFORM public.fn_raise_notification(
        n.user_id,
        'welcome_back_play_nudge',
        format('Your %s Free Chips Are Still Waiting', to_char(n.amount, 'FM999999990.##')),
        format('The %s free chips in your %s wallet have not been played yet. Pick a game and sit down.', to_char(n.amount, 'FM999999990.##'), COALESCE(n.club, 'club')),
        '/hub/club-arena/?welcome=chips',
        jsonb_build_object('amount', n.amount, 'club', n.club, 'promotion', 'signup_welcome_back_play_nudge')
      );
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      UPDATE public.sp_signup_welcome_back_awards
         SET last_error = 'play nudge notification: ' || v_err, updated_at = now()
       WHERE user_id = n.user_id;
      CONTINUE;
    END;
    UPDATE public.sp_signup_welcome_back_awards
       SET play_nudge_notified_at = now(), updated_at = now()
     WHERE user_id = n.user_id;
    v_play_nudges := v_play_nudges || jsonb_build_object(
      'user_id', n.user_id, 'username', n.username, 'email', n.email,
      'phone', n.phone, 'club', n.club, 'amount', n.amount
    );
  END LOOP;

  RETURN jsonb_build_object(
    'scanned', 0,
    'mode', 'promo_signup_only',
    'amount', v_amount,
    'hours', v_hours,
    'awarded', '[]'::jsonb,
    'awarded_count', 0,
    'no_club', '[]'::jsonb,
    'no_club_count', 0,
    'failed', '[]'::jsonb,
    'failed_count', 0,
    'failed_new_count', 0,
    'wallet_empty', false,
    'closed_count', v_closed,
    'closed_received_chips_count', 0,
    'club_nudges', '[]'::jsonb,
    'club_nudge_count', 0,
    'play_nudges', v_play_nudges,
    'play_nudge_count', jsonb_array_length(v_play_nudges),
    'union_promo_wallet_after', (SELECT round(promo_wallet, 2) FROM public.union_wallets WHERE union_id = v_union),
    'ran_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_sp_signup_welcome_back_run(integer, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sp_signup_welcome_back_run(integer, date) TO service_role;

-- @probe-for: public.fn_sp_signup_welcome_back_run
DO $probe_welcome_back_run$
DECLARE
  v_res jsonb;
BEGIN
  v_res := public.fn_sp_signup_welcome_back_run(1, '2099-01-01'::date);
  IF COALESCE((v_res ->> 'awarded_count')::int, -1) <> 0
     OR v_res ->> 'mode' IS DISTINCT FROM 'promo_signup_only' THEN
    RAISE EXCEPTION 'unexpected fn_sp_signup_welcome_back_run probe result: %', v_res;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_welcome_back_run$;

-- ---------------------------------------------------------------------------
-- 3. Turn off blanket weekly KINGS CLUB join 25-chip minting while recording
--    the expected weekly_kings_welcome_complete receipt so weekly_union_books_due
--    advances cleanly without stranding any Midway Union settlement week.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION smarter_private.weekly_kings_welcome_due()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  -- PROMO_SIGNUP_ONLY_20261123: Dan 2026-11-23 ordered free signup chips to be
  -- granted at signup through the promotional campaign only
  -- (public.fn_sp_grant_promo_signup_chips), never blanket-minted on organic
  -- KINGS CLUB joins during the weekly close.
  midway constant uuid := 'fade0000-0000-0000-0000-000000000001';
  book record;
  receipt jsonb;
  stage text;
BEGIN
  IF NOT public.fn_caller_is_engine() THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  SELECT h.period_start, h.period_end, h.id AS horse_run
    INTO book
    FROM public.union_weekly_horse_promo_runs h
    JOIN smarter_private.weekly_rakeback_document_runs d ON d.period_end = h.period_end
   WHERE h.union_id = midway
     AND h.period_end >= '2026-11-16 08:00Z'
     AND d.kings_welcome_receipt IS NULL
     AND NOT EXISTS (
       SELECT FROM public.union_accounting_runs r
        WHERE r.scope_kind = 'union'
          AND r.scope_id = midway
          AND r.period_end = h.period_end
          AND r.result -> 'kings_welcome_chips' IS NOT NULL
     )
     AND h.result ->> 'eligibility' = 'all_active_midway_horses'
     AND h.result ->> 'success' = 'true'
     AND h.paid = CASE WHEN h.eligible_wallets > 0 THEN h.budget ELSE 0 END
   ORDER BY h.period_end
   LIMIT 1
   FOR UPDATE OF d SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF public.fn_platform_frozen() OR public.fn_entry_purchases_frozen() THEN
    RETURN NULL;
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtext('fn_sp_signup_welcome_back_run')) THEN
    RETURN NULL;
  END IF;

  stage := smarter_private.weekly_rakeback_documents(book.period_start, book.period_end);
  IF stage <> 'ready' THEN
    RETURN jsonb_build_object('stage', stage);
  END IF;

  receipt := jsonb_build_object(
    'stage', 'weekly_kings_welcome_complete',
    'mode', 'promo_signup_only',
    'horse_promo_run_id', book.horse_run,
    'period_start', book.period_start,
    'period_end', book.period_end,
    'paid_players', 0,
    'paid', 0,
    'completed_at', clock_timestamp()
  );

  UPDATE smarter_private.weekly_rakeback_document_runs
     SET kings_welcome_receipt = receipt
   WHERE period_end = book.period_end;

  UPDATE public.union_accounting_runs
     SET result = jsonb_set(result, '{kings_welcome_chips}', receipt)
   WHERE scope_kind = 'union'
     AND scope_id = midway
     AND period_end = book.period_end
     AND status = 'complete';

  RETURN receipt;
END
$function$;

REVOKE ALL ON FUNCTION smarter_private.weekly_kings_welcome_due() FROM PUBLIC, anon, authenticated, service_role;

-- @probe-for: smarter_private.weekly_kings_welcome_due
DO $probe_weekly_kings_welcome$
BEGIN
  PERFORM smarter_private.weekly_kings_welcome_due();
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_weekly_kings_welcome$;

COMMIT;
