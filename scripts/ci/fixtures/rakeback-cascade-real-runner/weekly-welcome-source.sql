-- Production welcome functions and real-human view, read-only catalog capture 2026-11-16.
SET check_function_bodies=off;
CREATE TABLE public.sp_digest_settings(key text PRIMARY KEY,value numeric);
CREATE OR REPLACE FUNCTION public.fn_sp_setting(p_key text, p_default numeric)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT value FROM public.sp_digest_settings WHERE key = p_key), p_default)
$function$
;
CREATE OR REPLACE FUNCTION public.fn_promo_disburse(p_source_kind text, p_source_id uuid, p_target_kind text, p_target_id uuid, p_amount numeric, p_note text DEFAULT NULL::text, p_club_id uuid DEFAULT NULL::uuid, p_op_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor    uuid := auth.uid();
  v_service  boolean := public.fn_caller_is_engine();
  v_amt      numeric := round(COALESCE(p_amount, 0), 2);
  v_op       uuid := COALESCE(p_op_id, gen_random_uuid());
  v_src      text := lower(COALESCE(p_source_kind, ''));
  v_tgt      text := lower(COALESCE(p_target_kind, ''));
  v_avail    numeric;
  v_after    numeric;
  v_to_after numeric;
  v_club     uuid;
  v_union    uuid;
  v_prior    record;
  v_tx       uuid;
  v_lands_as text;
  v_member_skip text := current_setting('app.ledger_autoskip_club_members', true);
BEGIN
  IF v_actor IS NULL AND NOT v_service THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not Authenticated');
  END IF;
  IF v_src NOT IN ('union', 'club') THEN
    RETURN jsonb_build_object('success', false, 'error', 'source must be union or club');
  END IF;
  IF v_tgt NOT IN ('club', 'player') THEN
    RETURN jsonb_build_object('success', false, 'error', 'target must be club or player');
  END IF;
  IF v_src = 'club' AND v_tgt = 'club' THEN
    RETURN jsonb_build_object('success', false, 'error', 'a club disburses promo to its players, not to a club');
  END IF;
  IF p_source_id IS NULL OR p_target_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'source and target are required');
  END IF;

  SELECT id, amount, metadata INTO v_prior
    FROM chip_transactions
   WHERE transaction_type = 'promo_disbursement'
     AND metadata ->> 'op_id' = v_op::text
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'replayed', true,
      'transaction_id', v_prior.id, 'amount', v_prior.amount,
      'source_after', (v_prior.metadata ->> 'source_after')::numeric,
      'recipient_after', (v_prior.metadata ->> 'recipient_after')::numeric);
  END IF;

  IF v_amt <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount Must Be Greater Than Zero');
  END IF;
  IF v_amt <> round(v_amt, 2) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Chips Move In Hundredths At Most');
  END IF;
  IF v_amt > 1e9 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount Exceeds The Single Send Limit');
  END IF;

  IF v_src = 'union' THEN
    v_union := p_source_id;
    IF NOT v_service AND NOT EXISTS (
         SELECT 1 FROM unions u WHERE u.id = v_union AND u.owner_id = v_actor) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Only The Union Owner May Disburse Union Promo');
    END IF;
  ELSE
    v_club := p_source_id;
    IF NOT v_service AND NOT EXISTS (
         SELECT 1 FROM clubs c WHERE c.id = v_club AND c.owner_id = v_actor)
       AND NOT EXISTS (
         SELECT 1 FROM club_members m
          WHERE m.club_id = v_club AND m.user_id = v_actor
            AND m.role IN ('owner', 'co_owner')) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Only The Club Owner May Disburse Club Promo');
    END IF;
  END IF;

  IF v_tgt = 'club' THEN
    IF NOT EXISTS (SELECT 1 FROM union_clubs uc
                    WHERE uc.union_id = v_union AND uc.club_id = p_target_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'That Club Is Not In This Union');
    END IF;
    v_club := p_target_id;
  ELSE
    IF v_src = 'union' THEN
      v_club := p_club_id;
      IF v_club IS NULL THEN
        SELECT m.club_id INTO v_club
          FROM club_members m
         WHERE (EXISTS(SELECT 1 FROM union_clubs uc WHERE uc.club_id=m.club_id AND uc.union_id=v_union)
                 OR (m.club_id=v_union AND EXISTS(SELECT 1 FROM clubs c WHERE c.id=v_union AND c.union_id=v_union AND c.is_union IS TRUE)))
           AND m.user_id = p_target_id
           AND COALESCE(m.status, 'active') IN ('active', 'approved')
         ORDER BY m.updated_at DESC NULLS LAST
         LIMIT 1;
      END IF;
      IF v_club IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'That Player Is Not In Any Club Of This Union');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM union_clubs uc
                      WHERE uc.union_id = v_union AND uc.club_id = v_club)
         AND NOT (v_club=v_union AND EXISTS(SELECT 1 FROM clubs c
                    WHERE c.id=v_union AND c.union_id=v_union AND c.is_union IS TRUE)) THEN
        RETURN jsonb_build_object('success', false, 'error', 'That Club Is Not In This Union');
      END IF;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM club_members m
                    WHERE m.club_id = v_club AND m.user_id = p_target_id
                      AND COALESCE(m.status, 'active') IN ('active', 'approved')) THEN
      RETURN jsonb_build_object('success', false, 'error', 'That Player Is Not An Active Member Of That Club');
    END IF;
  END IF;

  IF v_src = 'union' THEN
    SELECT COALESCE(promo_wallet, 0) INTO v_avail
      FROM union_wallets WHERE union_id = v_union FOR UPDATE;
    IF v_avail IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Union Wallet Not Found');
    END IF;
    IF v_avail < v_amt THEN
      RETURN jsonb_build_object('success', false, 'error', 'Insufficient Promo Balance',
                                'available', v_avail, 'requested', v_amt);
    END IF;

    PERFORM public.fn_ca_declare_ledger('promo', 'union_wallet', v_union, NULL,
                                        'promo_disburse:' || v_op::text, ARRAY['union_wallets']);
    PERFORM set_config('app.ledger_counterparty_label', 'union_wallets.promo_wallet', true);
    PERFORM set_config('app.ledger_correlation', v_op::text, true);

    UPDATE union_wallets
       SET promo_wallet = promo_wallet - v_amt, updated_at = now()
     WHERE union_id = v_union
     RETURNING round(promo_wallet, 2) INTO v_after;
  ELSE
    SELECT COALESCE(promo_balance, 0) INTO v_avail
      FROM clubs WHERE id = v_club FOR UPDATE;
    IF v_avail IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Club Not Found');
    END IF;
    IF v_avail < v_amt THEN
      RETURN jsonb_build_object('success', false, 'error', 'Insufficient Promo Balance',
                                'available', v_avail, 'requested', v_amt);
    END IF;

    PERFORM public.fn_ca_declare_ledger('promo', 'promo_wallet', v_club, NULL,
                                        'promo_disburse:' || v_op::text, ARRAY['clubs']);
    PERFORM set_config('app.ledger_counterparty_label', 'clubs.promo_balance', true);
    PERFORM set_config('app.ledger_correlation', v_op::text, true);

    UPDATE clubs
       SET promo_balance = promo_balance - v_amt, updated_at = now()
     WHERE id = v_club
     RETURNING round(promo_balance, 2) INTO v_after;
  END IF;

  IF v_tgt = 'club' THEN
    v_lands_as := 'club_promo_wallet';
    UPDATE clubs
       SET promo_balance = COALESCE(promo_balance, 0) + v_amt, updated_at = now()
     WHERE id = v_club
     RETURNING round(promo_balance, 2) INTO v_to_after;
  ELSE
    v_lands_as := 'ordinary_chips';
    -- The common member writer has no source-column label. This promo door
    -- owns its exact union-promo leg; leave every other caller's writer alone.
    IF v_src = 'union' THEN
      PERFORM set_config('app.ledger_autoskip_club_members', '1', true);
    END IF;
    UPDATE club_members
       SET chip_balance = COALESCE(chip_balance, 0) + v_amt, updated_at = now()
     WHERE club_id = v_club AND user_id = p_target_id
     RETURNING round(chip_balance, 2) INTO v_to_after;
    IF v_src = 'union' THEN
      INSERT INTO public.chip_ledger
        (performed_by,from_type,from_entity_id,from_label,to_type,to_entity_id,to_label,
         amount,category,club_id,union_id,description,
         pre_from_balance,post_from_balance,pre_to_balance,post_to_balance)
      VALUES
        (COALESCE(v_actor,'2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid),
         'union_wallet',v_union,'union_wallets.promo_wallet',
         'player_wallet',p_target_id,'club_members.chip_balance',
         v_amt,'promo',v_club,v_union,'Union Promo Disbursement',
         v_avail,v_after,v_to_after-v_amt,v_to_after);
      PERFORM set_config('app.ledger_autoskip_club_members',COALESCE(v_member_skip,''),true);
    END IF;
  END IF;

  PERFORM set_config('app.ledger_autoskip_union_wallets', '', true);
  PERFORM set_config('app.ledger_autoskip_clubs', '', true);

  IF v_to_after IS NULL THEN
    RAISE EXCEPTION 'promo disbursement credit found no row: % %', v_tgt, p_target_id;
  END IF;

  INSERT INTO chip_transactions
    (club_id, from_user_id, to_user_id, amount, transaction_type, notes, metadata, balance_after)
  VALUES
    (v_club, v_actor,
     CASE WHEN v_tgt = 'player' THEN p_target_id END,
     v_amt, 'promo_disbursement',
     COALESCE(NULLIF(btrim(p_note), ''), 'Promo Disbursement'),
     jsonb_build_object('op_id', v_op,
                        'source_kind', v_src, 'source_id', p_source_id,
                        'target_kind', v_tgt, 'target_id', p_target_id,
                        'authorised_by', v_actor,
                        'source_after', v_after,
                        'recipient_after', v_to_after,
                        'lands_as', v_lands_as),
     v_to_after)
  RETURNING id INTO v_tx;

  IF v_src = 'union' THEN
    INSERT INTO union_wallet_transactions
      (union_id, club_id, wallet, direction, amount, balance_after, tx_type, notes, created_by)
    VALUES
      (v_union, v_club, 'promo_wallet', 'debit', v_amt, v_after, 'promo_disbursement',
       COALESCE(NULLIF(btrim(p_note), ''), 'Promo disbursed by the union owner')
         || ' (' || v_tgt || ')',
       v_actor);
  END IF;

  RETURN jsonb_build_object('success', true, 'replayed', false,
    'transaction_id', v_tx, 'op_id', v_op, 'amount', v_amt,
    'source_kind', v_src, 'target_kind', v_tgt, 'club_id', v_club,
    'source_after', v_after, 'recipient_after', v_to_after,
    'lands_as', v_lands_as);
END
$function$
;
ALTER TABLE auth.users ADD COLUMN is_anonymous boolean, ADD COLUMN email_confirmed_at timestamptz;
CREATE VIEW smarter_private.sp_real_humans AS  SELECT p.id,
    p.created_at,
    p.last_seen,
    p.phone_verified,
    p.is_vip,
    p.vip_tier,
    p.vip_expires_at,
    p.referred_by,
    p.username,
    u.email_confirmed_at
   FROM profiles p
     JOIN auth.users u ON u.id = p.id
  WHERE NOT COALESCE(p.is_horse, false) AND NOT COALESCE(u.is_anonymous, false) AND p.id::text !~~ '00000000-0000-0000-0000-%'::text AND POSITION(('@'::text) IN (COALESCE(u.email, ''::character varying))) > 0 AND lower(u.email::text) !~ '(\.invalid|\.local|\.test|@horses\.smarter\.poker|@hydra\.bot|@example\.(com|org|net))$'::text AND lower(u.email::text) !~ '@([a-z0-9-]+\.)*(smarter\.poker|pepnationlab\.com|bekavactrading\.com)$'::text AND lower(COALESCE(p.email, ''::text)) !~ '(\.invalid|\.local|\.test|@hydra\.bot|@example\.(com|org|net))$'::text AND COALESCE(p.username, ''::text) !~* '^(deleted-|crest_cert_|postdeploy|reels_qa|trivia_canary|codex-)'::text AND NOT (EXISTS ( SELECT 1
           FROM ca_cert_accounts c
          WHERE c.user_id = p.id AND c.active));
CREATE OR REPLACE FUNCTION public.fn_ca_refuse_welcome_back_to_funded_player()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.metadata ->> 'op_id' = md5('signup-welcome-back:' || NEW.to_user_id::text)::uuid::text
     AND (EXISTS (SELECT 1 FROM public.chip_transactions ct
                   WHERE ct.to_user_id = NEW.to_user_id AND ct.amount > 0 AND ct.created_at <> now())
          OR EXISTS (SELECT 1 FROM public.chip_ledger l
                      WHERE l.to_entity_id = NEW.to_user_id AND l.to_type = 'player_wallet'
                        AND l.amount > 0 AND l.created_at <> now())) THEN
    RAISE EXCEPTION 'Welcome Back Chips Refused: Player Already Received Chips'
      USING ERRCODE = '23514', DETAIL = format('player %s', NEW.to_user_id);
  END IF;
  RETURN NEW;
END
$function$
;
CREATE OR REPLACE FUNCTION public.fn_sp_player_has_played(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.ca_hand_facts f WHERE f.user_id = p_user_id)
      OR EXISTS (SELECT 1 FROM public.club_member_play_totals t
                  WHERE t.user_id = p_user_id AND (COALESCE(t.hands, 0) > 0 OR COALESCE(t.mtt_hands, 0) > 0));
$function$
;
CREATE OR REPLACE FUNCTION public.fn_sp_player_has_received_chips(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.chip_transactions ct
                  WHERE ct.to_user_id = p_user_id AND ct.amount > 0)
      OR EXISTS (SELECT 1 FROM public.chip_ledger l
                  WHERE l.to_entity_id = p_user_id AND l.to_type = 'player_wallet' AND l.amount > 0);
$function$
;
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
   WHERE a.status IN ('no_club', 'failed') AND public.fn_sp_player_has_played(a.user_id);
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  -- Welcome Back Chips is only for a player who has never received a chip
  -- (Dan, 2026-11-14). A parked row whose player has since been sent chips by
  -- anyone is closed: not retried, not nudged, not reported as unpaid.
  UPDATE public.sp_signup_welcome_back_awards a
     SET status = 'closed', last_error = 'Already Received Chips Before Welcome Back', updated_at = now()
   WHERE a.status IN ('no_club', 'failed') AND public.fn_sp_player_has_received_chips(a.user_id);
  GET DIAGNOSTICS v_closed_chips = ROW_COUNT;
  v_closed := v_closed + v_closed_chips;

  FOR c IN
    SELECT h.id, h.username, h.created_at, h.phone_verified
      FROM smarter_private.sp_real_humans h
     WHERE h.created_at <= now() - make_interval(mins => (v_hours * 60)::int)
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
;
CREATE TRIGGER zz_welcome_back_never_funded_guard BEFORE INSERT ON public.chip_transactions FOR EACH ROW WHEN(NEW.transaction_type='promo_disbursement' AND NEW.to_user_id IS NOT NULL) EXECUTE FUNCTION public.fn_ca_refuse_welcome_back_to_funded_player();
