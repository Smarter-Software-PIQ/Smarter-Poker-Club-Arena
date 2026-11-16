CREATE OR REPLACE FUNCTION public.fn_sp_signup_welcome_back_run(p_limit integer DEFAULT 50, p_since date DEFAULT '2026-10-19'::date)
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
  v_scanned int := 0; v_closed int := 0; v_closed_chips int := 0; v_is_new_failure boolean; v_failed_new int := 0; v_wallet_empty boolean := false;
BEGIN
  IF NOT public.fn_caller_is_engine() THEN
    RAISE EXCEPTION 'fn_sp_signup_welcome_back_run is service_role only' USING ERRCODE = '42501';
  END IF;

  -- One run at a time. fn_promo_disburse checks its op_id with a plain
  -- SELECT before it locks the wallet, so two overlapping runs (the hourly
  -- fire plus a manual call) could both pass that check and both pay. The
  -- lock is released with the transaction; a second caller waits, then sees
  -- the first run's awarded rows and pays nobody twice.
  IF NOT pg_try_advisory_xact_lock(hashtext('fn_sp_signup_welcome_back_run')) THEN
    RETURN jsonb_build_object('already_running', true, 'scanned', 0, 'amount', v_amount, 'hours', v_hours,
      'awarded', '[]'::jsonb, 'awarded_count', 0, 'no_club', '[]'::jsonb, 'no_club_count', 0,
      'failed', '[]'::jsonb, 'failed_count', 0, 'failed_new_count', 0, 'wallet_empty', false,
      'club_nudges', '[]'::jsonb, 'club_nudge_count', 0, 'play_nudges', '[]'::jsonb, 'play_nudge_count', 0,
      'closed_count', 0, 'ran_at', now());
  END IF;

  -- A player who played a hand before the chips could be paid is owed
  -- nothing: close the row so it is neither retried nor nudged nor reported
  -- as unpaid.
  UPDATE public.sp_signup_welcome_back_awards a
     SET status = 'closed', last_error = 'Played A Hand Before The Chips Were Paid', updated_at = now()
   WHERE a.status IN ('no_club', 'failed') AND NOT smarter_private.weekly_kings_member(a.user_id) AND public.fn_sp_player_has_played(a.user_id);
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  -- Welcome Back Chips is only for a player who has never received a chip
  -- (Dan, 2026-11-14). A parked row whose player has since been sent chips by
  -- anyone is closed: not retried, not nudged, not reported as unpaid.
  UPDATE public.sp_signup_welcome_back_awards a
     SET status = 'closed', last_error = 'Already Received Chips Before Welcome Back', updated_at = now()
   WHERE a.status IN ('no_club', 'failed') AND NOT smarter_private.weekly_kings_member(a.user_id) AND public.fn_sp_player_has_received_chips(a.user_id);
  GET DIAGNOSTICS v_closed_chips = ROW_COUNT;
  v_closed := v_closed + v_closed_chips;

  FOR c IN
    SELECT h.id, h.username, h.created_at, h.phone_verified
      FROM smarter_private.sp_real_humans h
     WHERE NOT smarter_private.weekly_kings_member(h.id) AND h.created_at <= now() - make_interval(mins => (v_hours * 60)::int)
       AND h.created_at >= v_since
       AND NOT public.fn_sp_player_has_played(h.id)
       -- Never received a chip from anyone, ever (Dan, 2026-11-14).
       AND NOT public.fn_sp_player_has_received_chips(h.id)
       AND NOT EXISTS (SELECT 1 FROM public.sp_signup_welcome_back_awards a
                        WHERE a.user_id = h.id AND a.status IN ('awarded', 'closed'))
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
     -- Fresh sign-ups first; players already recorded as failed are retried
     -- after them, so a stuck row can never crowd a new player out of the limit.
     ORDER BY EXISTS (SELECT 1 FROM public.sp_signup_welcome_back_awards a WHERE a.user_id = h.id AND a.status = 'failed'),
              h.created_at
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 500))
  LOOP

    -- A newly approved KINGS membership now belongs to the weekly owner.
    -- Share the normal join owner's per-user lock. A pending membership's
    -- status can also be approved separately, so serialize that row.
    IF NOT pg_try_advisory_xact_lock(hashtextextended(c.id::text,77431)) THEN CONTINUE; END IF;
    BEGIN
      PERFORM 1 FROM public.club_members WHERE club_id=v_kings AND user_id=c.id FOR UPDATE NOWAIT;
    EXCEPTION WHEN lock_not_available THEN CONTINUE;
    END;
    IF smarter_private.weekly_kings_member(c.id) THEN CONTINUE; END IF;
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
        (c.id, c.created_at, 'awarded', COALESCE(NULLIF(v_res->>'amount', '')::numeric, v_amount), v_union, v_club, v_op,
         NULLIF(v_res->>'transaction_id', '')::uuid, now(), v_email, v_phone, NULL)
      ON CONFLICT (user_id) DO UPDATE
        SET status = 'awarded', amount = EXCLUDED.amount, club_id = EXCLUDED.club_id, transaction_id = EXCLUDED.transaction_id,
            awarded_at = now(), email = EXCLUDED.email, phone = EXCLUDED.phone,
            last_error = NULL, failed_at = NULL, updated_at = now();

      -- In-app notification; trg_mirror_notification_to_push_outbox forwards
      -- it to push_outbox and push-dispatch sends it to every device the
      -- player has allowed.
      BEGIN
        PERFORM public.fn_raise_notification(c.id, 'welcome_back_chips',
          format('%s Free Chips Are Waiting For You', v_amount_txt),
          format('The Midway Union just added %s free chips to your %s wallet. Sit down and play your first hand.', v_amount_txt, COALESCE(v_club_name, 'club')),
          '/hub/club-arena/?welcome=chips',
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
        SET status = 'no_club', last_error = EXCLUDED.last_error, email = EXCLUDED.email, phone = EXCLUDED.phone,
            failed_at = NULL, updated_at = now();
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
        SET status = 'failed', last_error = EXCLUDED.last_error, email = EXCLUDED.email, phone = EXCLUDED.phone, updated_at = now()
      RETURNING (a.failed_at IS NULL) INTO v_is_new_failure;
      UPDATE public.sp_signup_welcome_back_awards SET failed_at = COALESCE(failed_at, now()) WHERE user_id = c.id;
      IF v_is_new_failure THEN v_failed_new := v_failed_new + 1; END IF;
      IF v_res->>'error' ILIKE '%promo%balance%' OR v_res->>'error' ILIKE '%insufficient%' THEN v_wallet_empty := true; END IF;
      v_failed := v_failed || jsonb_build_object('user_id', c.id, 'username', c.username, 'error', v_res->>'error', 'new', v_is_new_failure);
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
       AND NOT public.fn_sp_player_has_played(a.user_id)
       -- Anyone already holding a seat or a pending application in a Midway
       -- Union club has done what the nudge asks; they are paid on the next
       -- scan or approved by the club.
       AND NOT EXISTS (SELECT 1 FROM public.club_members m
                        WHERE m.user_id = a.user_id
                          AND COALESCE(m.status, 'active') NOT IN ('departed', 'removed', 'banned', 'rejected')
                          AND (m.club_id = v_union
                               OR EXISTS (SELECT 1 FROM public.union_clubs uc WHERE uc.union_id = v_union AND uc.club_id = m.club_id)))
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
      CONTINUE;
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
       AND NOT public.fn_sp_player_has_played(a.user_id)
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
      CONTINUE;
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
    'failed_new_count', v_failed_new, 'wallet_empty', v_wallet_empty, 'closed_count', v_closed, 'closed_received_chips_count', v_closed_chips,
    'club_nudges', v_club_nudges, 'club_nudge_count', jsonb_array_length(v_club_nudges),
    'play_nudges', v_play_nudges, 'play_nudge_count', jsonb_array_length(v_play_nudges),
    'union_promo_wallet_after', (SELECT round(promo_wallet, 2) FROM public.union_wallets WHERE union_id = v_union),
    'ran_at', now());
END
$function$

