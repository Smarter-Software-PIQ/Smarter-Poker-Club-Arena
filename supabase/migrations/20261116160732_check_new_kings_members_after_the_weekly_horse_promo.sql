-- @live-proof: position('weekly_kings_welcome_due' in pg_get_functiondef('smarter_private.weekly_union_books_due()'::regprocedure))>0 AND position('weekly_kings_member' in pg_get_functiondef('public.fn_sp_signup_welcome_back_run(integer,date)'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';

-- The eligibility readers cover four histories. Writers for the same person
-- take compatible shared locks; only this person's first-hand welcome needs
-- an exclusive lock. No unrelated user, wallet or hand is blocked.
CREATE FUNCTION smarter_private.weekly_welcome_history_writer()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE player uuid;
BEGIN
  IF TG_TABLE_NAME='chip_ledger' THEN player:=NEW.to_entity_id;
  ELSIF TG_TABLE_NAME='chip_transactions' THEN player:=NEW.to_user_id;
  ELSE player:=NEW.user_id; END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('weekly-welcome-history:'||player::text,0));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION smarter_private.weekly_welcome_history_writer() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER weekly_welcome_credit_history BEFORE INSERT OR UPDATE OF to_entity_id,to_type,amount
ON public.chip_ledger FOR EACH ROW WHEN(NEW.to_type='player_wallet' AND NEW.amount>0)
EXECUTE FUNCTION smarter_private.weekly_welcome_history_writer();
INSERT INTO public.ca_declared_money_triggers(table_name,trigger_name,note)
VALUES ('chip_ledger','weekly_welcome_credit_history','Before a positive player credit, take the shared per-recipient welcome-history lock. Writes no rows and never changes ledger data.');
CREATE TRIGGER weekly_welcome_play_history BEFORE INSERT OR UPDATE OF user_id,hands,mtt_hands
ON public.club_member_play_totals FOR EACH ROW WHEN(NEW.hands>0 OR NEW.mtt_hands>0)
EXECUTE FUNCTION smarter_private.weekly_welcome_history_writer();
CREATE TRIGGER weekly_welcome_received_transfer BEFORE INSERT OR UPDATE OF to_user_id,amount
ON public.chip_transactions FOR EACH ROW WHEN(NEW.to_user_id IS NOT NULL AND NEW.amount>0)
EXECUTE FUNCTION smarter_private.weekly_welcome_history_writer();
CREATE TRIGGER weekly_welcome_played_hand BEFORE INSERT OR UPDATE OF user_id
ON public.ca_hand_facts FOR EACH ROW EXECUTE FUNCTION smarter_private.weekly_welcome_history_writer();

CREATE FUNCTION smarter_private.weekly_kings_member(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT FROM public.club_members m
   WHERE m.club_id='a41434bb-8d0c-400a-8f0d-e8b3d65afed4' AND m.user_id=p_user
     AND m.joined_at>='2026-11-09 08:00Z' AND m.is_active AND m.status IN ('active','approved')
     AND m.membership_lifecycle_status='active')
$$;
REVOKE ALL ON FUNCTION smarter_private.weekly_kings_member(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Give the existing weekly owner the KINGS branch of the existing lifetime
-- campaign. Other clubs retain the original hourly payment and nudge path.
DO $hourly$
DECLARE s text:=pg_get_functiondef('public.fn_sp_signup_welcome_back_run(integer,date)'::regprocedure);
BEGIN
 IF md5(s)<>'e1d4ed9955a87803e7093b057409fb2d' THEN RAISE EXCEPTION 'welcome_hourly_preimage_changed'; END IF;
 s:=replace(s,'WHERE h.created_at <= now()', 'WHERE NOT smarter_private.weekly_kings_member(h.id) AND h.created_at <= now()');
 s:=replace(s,'WHERE a.status IN (''no_club'', ''failed'') AND public.fn_sp_player_has_',
              'WHERE a.status IN (''no_club'', ''failed'') AND NOT smarter_private.weekly_kings_member(a.user_id) AND public.fn_sp_player_has_');
 s:=replace(s,'    v_scanned := v_scanned + 1;', $gate$
    -- A newly approved KINGS membership now belongs to the weekly owner.
    -- Share the normal join owner's per-user lock. A pending membership's
    -- status can also be approved separately, so serialize that row.
    IF NOT pg_try_advisory_xact_lock(hashtextextended(c.id::text,77431)) THEN CONTINUE; END IF;
    BEGIN
      PERFORM 1 FROM public.club_members WHERE club_id=v_kings AND user_id=c.id FOR UPDATE NOWAIT;
    EXCEPTION WHEN lock_not_available THEN CONTINUE;
    END;
    IF smarter_private.weekly_kings_member(c.id) THEN CONTINUE; END IF;
    v_scanned := v_scanned + 1;$gate$);
 EXECUTE s;
END $hourly$;

CREATE FUNCTION smarter_private.weekly_kings_welcome_due()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  midway constant uuid:='fade0000-0000-0000-0000-000000000001';
  kings constant uuid:='a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
  book record; member record; op uuid; payment jsonb; receipt jsonb;
  paid int:=0; stage text;
BEGIN
  IF NOT public.fn_caller_is_engine() THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  -- Only a committed complete, all-active-horse promo can make a book due.
  -- A prior week's pending work stays visible after the next Pacific rollover.
  SELECT r.period_start,r.period_end,h.id AS horse_run INTO book
    FROM public.union_accounting_runs r JOIN public.union_weekly_horse_promo_runs h
      ON h.union_id=r.scope_id AND h.period_start=r.period_start AND h.period_end=r.period_end
   WHERE r.scope_kind='union' AND r.scope_id=midway AND r.status='complete'
     AND r.period_end>='2026-11-16 08:00Z' AND r.result->'kings_welcome_chips' IS NULL
     AND h.result->>'eligibility'='all_active_midway_horses' AND h.result->>'success'='true'
     AND h.paid=CASE WHEN h.eligible_wallets>0 THEN h.budget ELSE 0 END
   ORDER BY r.period_end LIMIT 1 FOR UPDATE OF r SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF public.fn_platform_frozen() OR public.fn_entry_purchases_frozen() THEN RETURN NULL; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtext('fn_sp_signup_welcome_back_run')) THEN RETURN NULL; END IF;
  stage:=smarter_private.weekly_credit_invoices(book.period_start,book.period_end);
  IF stage<>'ready' THEN RETURN jsonb_build_object('stage',stage); END IF;

  -- joined_at is the KINGS membership event, independent of site signup.
  -- The book's half-open boundaries are Monday midnight America/Los_Angeles.
  FOR member IN
    SELECT m.user_id,h.created_at AS signed_up_at
      FROM public.club_members m JOIN smarter_private.sp_real_humans h ON h.id=m.user_id
     WHERE m.club_id=kings AND m.joined_at>=book.period_start AND m.joined_at<book.period_end
       AND m.role='player' AND m.is_active AND m.status IN ('active','approved') AND m.membership_lifecycle_status='active'
       AND NOT EXISTS(SELECT FROM public.sp_signup_welcome_back_awards a
                       WHERE a.user_id=m.user_id AND a.status='awarded')
       AND NOT public.fn_sp_player_has_played(m.user_id) AND NOT public.fn_sp_player_has_received_chips(m.user_id)
     ORDER BY m.user_id
  LOOP
    -- All locks are acquired before the final fresh eligibility read. If an
    -- incoming history writer already owns its gate, let the weekly tick retry.
    IF NOT pg_try_advisory_xact_lock(hashtextextended('weekly-welcome-history:'||member.user_id::text,0))
       OR NOT pg_try_advisory_xact_lock(hashtextextended('player-stats-user:'||member.user_id::text,0)) THEN
      RAISE lock_not_available USING MESSAGE='weekly_kings_welcome_history_busy';
    END IF;
    PERFORM 1 FROM public.union_wallets WHERE union_id=midway FOR UPDATE NOWAIT;
    PERFORM 1 FROM public.club_members m WHERE m.club_id=kings AND m.user_id=member.user_id
      AND m.joined_at>=book.period_start AND m.joined_at<book.period_end AND m.role='player' AND m.is_active
      AND m.status IN ('active','approved') AND m.membership_lifecycle_status='active' FOR UPDATE NOWAIT;
    IF NOT FOUND THEN CONTINUE; END IF;
    PERFORM 1 FROM public.profiles WHERE id=member.user_id FOR SHARE NOWAIT;
    IF NOT EXISTS(SELECT FROM smarter_private.sp_real_humans WHERE id=member.user_id)
       OR public.fn_sp_player_has_played(member.user_id) OR public.fn_sp_player_has_received_chips(member.user_id) THEN CONTINUE; END IF;
    op:=md5('signup-welcome-back:'||member.user_id::text)::uuid;
    payment:=public.fn_promo_disburse('union',midway,'player',member.user_id,25,
      'Welcome Back Chips - 25 free chips from the Midway Union for your first hand',kings,op);
    IF payment->>'success' IS DISTINCT FROM 'true' OR payment->>'replayed'='true'
      OR NOT EXISTS(SELECT FROM public.chip_transactions t WHERE t.id=(payment->>'transaction_id')::uuid
        AND t.to_user_id=member.user_id AND t.club_id=kings AND t.transaction_type='promo_disbursement'
        AND t.amount=25 AND t.metadata->>'op_id'=op::text) THEN
      RAISE EXCEPTION 'weekly_kings_welcome_payment_unconfirmed' USING DETAIL=payment::text;
    END IF;
    INSERT INTO public.sp_signup_welcome_back_awards(user_id,signed_up_at,status,amount,union_id,club_id,op_id,transaction_id,awarded_at)
      VALUES(member.user_id,member.signed_up_at,'awarded',25,midway,kings,op,(payment->>'transaction_id')::uuid,clock_timestamp())
      ON CONFLICT(user_id) DO UPDATE SET status='awarded', amount=25,union_id=midway,club_id=kings,
        op_id=EXCLUDED.op_id,transaction_id=EXCLUDED.transaction_id,awarded_at=EXCLUDED.awarded_at,
        updated_at=clock_timestamp(),last_error=NULL,failed_at=NULL;
    paid:=paid+1;
  END LOOP;
  receipt:=jsonb_build_object('stage','weekly_kings_welcome_complete','horse_promo_run_id',book.horse_run,
    'period_start',book.period_start,'period_end',book.period_end,'paid_players',paid,'paid',paid*25,'completed_at',clock_timestamp());
  UPDATE public.union_accounting_runs SET result=jsonb_set(result,'{kings_welcome_chips}',receipt)
    WHERE scope_kind='union' AND scope_id=midway AND period_end=book.period_end;
  RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION smarter_private.weekly_kings_welcome_due() FROM PUBLIC,anon,authenticated,service_role;

DO $owner$
DECLARE s text:=pg_get_functiondef('smarter_private.weekly_union_books_due()'::regprocedure);
BEGIN
 IF position('RETURN public.fn_midway_weekly_horse_promo_due(e);' in s)=0
   OR position('IF n < due OR n >= due + interval ''12 hours'' THEN RETURN NULL; END IF;' in s)=0 THEN
   RAISE EXCEPTION 'weekly_books_must_already_own_post_invoice_horse_promo'; END IF;
 -- When an older welcome remains open, this week's money, books and horse
 -- promo keep priority. The original two-minute owner can still resume a
 -- committed horse run after its 12-hour book window or the week rollover.
 s:=replace(s,'IF n < due OR n >= due + interval ''12 hours'' THEN RETURN NULL; END IF;',
   'IF n < due OR n >= due + interval ''12 hours'' THEN RETURN smarter_private.weekly_kings_welcome_due(); END IF;');
 s:=replace(s,E'RETURN public.fn_midway_weekly_horse_promo_due(e);\n    END IF;\n    RETURN NULL;',
   E'RETURN public.fn_midway_weekly_horse_promo_due(e);\n    END IF;\n    RETURN smarter_private.weekly_kings_welcome_due();');
 IF position('    RETURN smarter_private.weekly_kings_welcome_due();' in s)=0 THEN RAISE EXCEPTION 'weekly_welcome_resume_source_changed'; END IF;
 EXECUTE s;
END $owner$;
COMMIT;
