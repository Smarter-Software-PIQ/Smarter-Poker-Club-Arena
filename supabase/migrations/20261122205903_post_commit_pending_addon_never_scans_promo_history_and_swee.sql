-- 20261122205903_post_commit_pending_addon_never_scans_promo_history_and_swee.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- INCIDENTS:
--   053d3341-0f26-4909-94d4-e51f129a0526 (fn_post_commit_stranded_watchdog, CRITICAL)
--   515d6f24-617a-47ad-a387-33d33234a549 (LightningHandHost.post_commit_obligations_pending, table 6165c59d)
--   0a4e0b45-bcab-4fa2-9ead-cd5a65f43281 (LightningHandHost.post_commit_obligations_pending, table 6464f2e6)
--   6efe4260-0d99-431f-b66b-1aa78e30848b (fn_ca_post_commit_lag_watch, table 6464f2e6)
--
-- ROOT CAUSES (verified directly from production rows on 2026-11-22):
--   1. public.fn_ca_promo_apply_pending_cash_funding(uuid), reached inside every
--      cash hand post-commit envelope via
--        fn_ca_process_hand_post_commit_obligations -> resolve_pending_addon
--        -> fn_cash_record_funding_application -> fn_ca_promo_apply_pending_cash_funding,
--      unconditionally acquired grant locks (fn_ca_promo_profit_prelock_source)
--      and called fn_ca_promo_play_through_settle + fn_ca_promo_locked_at even
--      when the pending add-on held 0.00 promo custody (761 of 769 = 98.96% of
--      all cash pending add-ons, including incident add-on 888d5f0f: 0/0/0).
--      That violated the 2026-11-18 owner ruling ("promo progress is not
--      checked after every hand; it is updated once per hour... promo chips can
--      never cause payout issues with tournaments or cash games"), stalled hand
--      bb67efb4 (#60560424) for 853.5 s behind table mutex hand-post-commit,
--      queued 24 hands on 6165c59d, and held club_members locks for multi-tabler
--      d49f4819 that cascaded obligation_lock_busy onto table 6464f2e6.
--   2. public.fn_ca_promo_locked_at(uuid,uuid,text,uuid) was a SQL join against
--      fn_ca_promo_play_through_state (WITH shared AS MATERIALIZED), so even
--      when ca_promo_principal_custody had 0 rows at (p_kind, p_entity) it
--      evaluated the entire fee-state engine (797 buffers on cache hit; live
--      fee-history scan on cache miss) across hand commit, cashout, and payout
--      hot paths.
--   3. Sibling callers public.fn_ca_promo_nonwallet_entry() (ticket_redeem) and
--      public.fn_ca_promo_leave_principal(uuid,uuid) also called
--      fn_ca_promo_play_through_settle unconditionally when 0 open-grant
--      principal custody existed at the source.
--   4. public.sp_ca_promo_profit_hourly_sweep(integer) self-invalidated the
--      ca_promo_fee_state_cache row it had just written whenever its ACT phase
--      closed a grant or unlocked a winnings gate (changing
--      fn_ca_promo_fee_state_signature), then stamped last_swept_at = now() so
--      it skipped that account for an entire hour. Its candidate query also
--      ignored accounts whose cache signature was invalidated by a new grant or
--      external closure within the 1-hour cooldown (231 of 534 = 43.3% of open
--      accounts had mismatched cache signatures live on production; only 55.6%
--      had a current cache). That exact self-invalidation at 19:43:00 UTC on
--      member 86e42f5e triggered the cache miss at 20:15:47 UTC.
--
-- PERMANENT FIXES:
--   1. fn_ca_promo_apply_pending_cash_funding never calls
--      fn_ca_promo_play_through_settle, fn_ca_promo_locked_at, or
--      fn_ca_promo_move_custody. It checks ca_promo_principal_custody and
--      ca_promo_profit_custody via their partial indexes first, acquires
--      fn_ca_promo_profit_prelock_source only when custody actually exists at
--      ('pending_addon', p_pending), and moves any open-grant principal custody
--      conservatively via fn_ca_promo_move_selected_custody (preserving 100% of
--      locked chips until the hourly sweep or live cash-out settles them).
--   2. fn_ca_promo_locked_at short-circuits to 0 whenever no open grant holds
--      positive principal custody at (p_kind, p_entity).
--   3. fn_ca_promo_nonwallet_entry (ticket_redeem) and
--      fn_ca_promo_leave_principal guard fn_ca_promo_play_through_settle behind
--      positive open-grant custody at the source.
--   4. sp_ca_promo_profit_hourly_sweep refreshes ca_promo_fee_state_cache
--      lock-free after ACT mutates grants/gates when the account still has open
--      grants or locked winnings gates, and prioritizes accounts with missing,
--      expired, or signature-mismatched cache rows without waiting 1 hour.
--
-- @replaces-md5: public.fn_ca_promo_apply_pending_cash_funding(uuid)=c8fabb510c304f6bec3ba32e473467cf
-- @replaces-md5: public.fn_ca_promo_locked_at(uuid,uuid,text,uuid)=216896f6641f4805b65e7f40e28e511f
-- @replaces-md5: public.fn_ca_promo_nonwallet_entry()=3af89f55f351761d354031a844330ab3
-- @replaces-md5: public.fn_ca_promo_leave_principal(uuid,uuid)=c715a35737dc1010a6fba32ab15023e0
-- @replaces-md5: public.sp_ca_promo_profit_hourly_sweep(integer)=104b63d08586407f80f95e66d1a4bfed
-- @live-proof: position('fn_ca_promo_play_through_settle' in pg_get_functiondef('public.fn_ca_promo_apply_pending_cash_funding(uuid)'::regprocedure))=0 AND position('fn_ca_promo_move_selected_custody' in pg_get_functiondef('public.fn_ca_promo_apply_pending_cash_funding(uuid)'::regprocedure))>0 AND position('ca_promo_principal_custody' in pg_get_functiondef('public.fn_ca_promo_locked_at(uuid,uuid,text,uuid)'::regprocedure))>0 AND position('closed_at IS NULL' in pg_get_functiondef('public.fn_ca_promo_locked_at(uuid,uuid,text,uuid)'::regprocedure))>0 AND position('ca_promo_principal_custody' in pg_get_functiondef('public.fn_ca_promo_nonwallet_entry()'::regprocedure))>0 AND position('ca_promo_principal_custody' in pg_get_functiondef('public.fn_ca_promo_leave_principal(uuid,uuid)'::regprocedure))>0 AND position('v_act_mutated' in pg_get_functiondef('public.sp_ca_promo_profit_hourly_sweep(integer)'::regprocedure))>0 AND position('fn_ca_promo_fee_state_signature' in pg_get_functiondef('public.sp_ca_promo_profit_hourly_sweep(integer)'::regprocedure))>0 AND (SELECT count(*) FROM pg_proc p WHERE p.oid IN ('public.fn_ca_promo_apply_pending_cash_funding(uuid)'::regprocedure,'public.fn_ca_promo_locked_at(uuid,uuid,text,uuid)'::regprocedure,'public.fn_ca_promo_nonwallet_entry()'::regprocedure,'public.fn_ca_promo_leave_principal(uuid,uuid)'::regprocedure,'public.sp_ca_promo_profit_hourly_sweep(integer)'::regprocedure) AND p.proowner='postgres'::regrole AND p.proacl::text='{postgres=X/postgres}')=5

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $before$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_promo_apply_pending_cash_funding(uuid)'::regprocedure)) <> 'c8fabb510c304f6bec3ba32e473467cf' THEN
    RAISE EXCEPTION 'preimage of public.fn_ca_promo_apply_pending_cash_funding changed before install' USING ERRCODE = '55000';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_promo_locked_at(uuid,uuid,text,uuid)'::regprocedure)) <> '216896f6641f4805b65e7f40e28e511f' THEN
    RAISE EXCEPTION 'preimage of public.fn_ca_promo_locked_at changed before install' USING ERRCODE = '55000';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_promo_nonwallet_entry()'::regprocedure)) <> '3af89f55f351761d354031a844330ab3' THEN
    RAISE EXCEPTION 'preimage of public.fn_ca_promo_nonwallet_entry changed before install' USING ERRCODE = '55000';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_promo_leave_principal(uuid,uuid)'::regprocedure)) <> 'c715a35737dc1010a6fba32ab15023e0' THEN
    RAISE EXCEPTION 'preimage of public.fn_ca_promo_leave_principal changed before install' USING ERRCODE = '55000';
  END IF;
  IF md5(pg_get_functiondef('public.sp_ca_promo_profit_hourly_sweep(integer)'::regprocedure)) <> '104b63d08586407f80f95e66d1a4bfed' THEN
    RAISE EXCEPTION 'preimage of public.sp_ca_promo_profit_hourly_sweep changed before install' USING ERRCODE = '55000';
  END IF;
END
$before$;

-- 1. Post-commit cash pending add-on resolution NEVER settles promo progress or
--    scans fee history, and NEVER locks promo grants when no custody sits at
--    ('pending_addon', p_pending).
CREATE OR REPLACE FUNCTION public.fn_ca_promo_apply_pending_cash_funding(p_pending uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  f public.cash_participant_funding_receipts%ROWTYPE;
  a public.cash_funding_application_receipts%ROWTYPE;
  pending numeric := 0;
  applied numeric := 0;
  refunded numeric := 0;
  place uuid;
  active_ids uuid[];
  has_principal boolean;
  has_profit boolean;
BEGIN
  SELECT * INTO STRICT a FROM public.cash_funding_application_receipts WHERE pending_addon_id = p_pending;
  SELECT * INTO STRICT f FROM public.cash_participant_funding_receipts WHERE id = a.funding_receipt_id;
  IF EXISTS (SELECT 1 FROM public.ca_promo_pending_custody_receipts WHERE pending_addon_id = p_pending) THEN
    RETURN;
  END IF;

  -- Check actual custody at ('pending_addon', p_pending) via partial indexes
  -- before acquiring any promo grant locks. Nearly all cash pending add-ons
  -- hold zero promo custody and complete here without touching promo grants.
  SELECT EXISTS (
    SELECT 1
      FROM public.ca_promo_principal_custody c
      JOIN public.ca_promo_play_through_grants g ON g.id = c.grant_id
     WHERE g.club_id = f.funding_club_id
       AND g.user_id = f.user_id
       AND g.closed_at IS NULL
       AND c.kind = 'pending_addon'
       AND c.entity_id = p_pending
       AND c.amount > 0
  ) INTO has_principal;

  SELECT EXISTS (
    SELECT 1
      FROM public.ca_promo_profit_custody c
      JOIN public.ca_promo_profit_gates w ON w.grant_id = c.grant_id AND w.unlocked_at IS NULL
     WHERE c.club_id = f.funding_club_id
       AND c.user_id = f.user_id
       AND c.kind = 'pending_addon'
       AND c.entity_id = p_pending
       AND c.amount > 0
       AND NOT EXISTS (SELECT 1 FROM public.ca_promo_profit_overrides o WHERE o.grant_id = c.grant_id)
  ) INTO has_profit;

  IF has_principal OR has_profit THEN
    PERFORM public.fn_ca_promo_profit_prelock_source(f.funding_club_id, f.user_id, 'pending_addon', p_pending);
  END IF;

  -- Post-commit hand envelopes never settle promo play-through progress or scan
  -- fee history (20261122205903, incidents 053d3341 / 515d6f24). Any open-grant
  -- principal custody held at ('pending_addon', p_pending) moves conservatively
  -- to table_stack / player_wallet under its open grant(s); the hourly sweep or
  -- live cash-out settles once fees are met.
  IF has_principal THEN
    SELECT array_agg(g.id ORDER BY g.granted_at, g.id), COALESCE(sum(c.amount), 0)
      INTO active_ids, pending
      FROM public.ca_promo_principal_custody c
      JOIN public.ca_promo_play_through_grants g ON g.id = c.grant_id
     WHERE g.club_id = f.funding_club_id
       AND g.user_id = f.user_id
       AND g.closed_at IS NULL
       AND c.kind = 'pending_addon'
       AND c.entity_id = p_pending
       AND c.amount > 0;

    IF pending > 0 THEN
      applied := LEAST(pending, GREATEST(a.applied - GREATEST(f.amount - pending, 0), 0));
      refunded := pending - applied;
      IF applied > 0 THEN
        SELECT s.table_id INTO STRICT place
          FROM public.table_seats s
         WHERE s.occupancy_id = a.applied_occupancy_id AND s.user_id = f.user_id;
        PERFORM public.fn_ca_promo_move_selected_custody(
          f.funding_club_id, f.user_id, 'pending_addon', p_pending, 'table_stack', place, applied, 'spent', active_ids
        );
      END IF;
      IF refunded > 0 THEN
        PERFORM public.fn_ca_promo_move_selected_custody(
          f.funding_club_id, f.user_id, 'pending_addon', p_pending, 'player_wallet', f.user_id, refunded, 'spent', active_ids
        );
      END IF;
    END IF;
  END IF;

  INSERT INTO public.ca_promo_pending_custody_receipts VALUES (p_pending, pending, applied, refunded);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_apply_pending_cash_funding(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- 2. fn_ca_promo_locked_at short-circuits to 0 whenever no open grant holds
--    positive principal custody at (p_kind, p_entity), avoiding unnecessary
--    fn_ca_promo_play_through_state materialization across hand commit, cashout,
--    and payout hot paths.
CREATE OR REPLACE FUNCTION public.fn_ca_promo_locked_at(p_club uuid, p_user uuid, p_kind text, p_entity uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.ca_promo_principal_custody c
      JOIN public.ca_promo_play_through_grants g ON g.id = c.grant_id
     WHERE g.club_id = p_club
       AND g.user_id = p_user
       AND g.closed_at IS NULL
       AND c.kind = p_kind
       AND c.entity_id = p_entity
       AND c.amount > 0
  ) THEN
    RETURN 0;
  END IF;

  RETURN (
    SELECT COALESCE(sum(c.amount), 0)
      FROM public.ca_promo_principal_custody c
      JOIN public.fn_ca_promo_play_through_state(p_club, p_user) s ON s.grant_id = c.grant_id
     WHERE c.kind = p_kind
       AND c.entity_id = p_entity
       AND s.state IN ('locked', 'expired_pending')
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_locked_at(uuid,uuid,text,uuid) FROM PUBLIC, anon, authenticated, service_role;

-- 3. Ticket redemptions only settle promo play-through when the redeemed ticket
--    actually holds open-grant principal custody.
CREATE OR REPLACE FUNCTION public.fn_ca_promo_nonwallet_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE uid uuid;promo numeric:=0;earning_club uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from<=clock_timestamp())
  OR NEW.amount<=0 OR COALESCE(NEW.status,'posted')<>'posted' THEN RETURN NULL; END IF;
 uid:=(NEW.metadata->>'user_id')::uuid;
 IF NEW.from_type='escrow' AND NEW.to_type='prize_liability' AND NEW.category='ticket_redeem' THEN
  IF uid IS NULL OR NOT EXISTS(SELECT 1 FROM public.tournament_tickets t WHERE t.id=NEW.from_entity_id AND t.holder_id=uid AND t.club_id=NEW.club_id) THEN
   RAISE EXCEPTION 'promo_ticket_direct_entry_original_holder_missing'; END IF;
  SELECT scope.club_id INTO earning_club FROM public.fn_ca_promo_entry_charge_identity(NEW.id) scope;
  IF EXISTS (
    SELECT 1
      FROM public.ca_promo_principal_custody c
      JOIN public.ca_promo_play_through_grants g ON g.id = c.grant_id
     WHERE g.club_id = earning_club
       AND g.user_id = uid
       AND g.closed_at IS NULL
       AND c.kind = 'ticket'
       AND c.entity_id = NEW.from_entity_id
       AND c.amount > 0
  ) THEN
    PERFORM public.fn_ca_promo_play_through_settle(earning_club,uid);
  END IF;
  PERFORM public.fn_ca_promo_profit_snapshot_ticket(NEW.id);
  promo:=public.fn_ca_promo_move_custody(earning_club,uid,'ticket',NEW.from_entity_id,'event',NEW.to_entity_id,NEW.amount);
  INSERT INTO public.ca_promo_event_realization_receipts VALUES(NEW.id,NEW.to_entity_id,earning_club,uid,NEW.amount,promo);
  PERFORM public.fn_ca_promo_record_event_charge(NEW.id);
  PERFORM public.fn_ca_promo_integrity_roll_source(NEW.id,uid,promo);
  PERFORM public.fn_ca_promo_profit_apply_ticket(NEW.id,'event',NEW.to_entity_id);
  PERFORM public.fn_ca_promo_capture_entry_funding(NEW.id,promo);
 ELSIF NEW.from_type='prize_liability' AND NEW.to_type='prize_liability' AND NEW.category='tournament_buyin' THEN
  IF uid IS NULL THEN RAISE EXCEPTION 'promo_satellite_entry_original_holder_missing'; END IF;
  promo:=public.fn_ca_promo_roll_event_principal(NEW.id,uid,'event');
  PERFORM public.fn_ca_promo_record_event_charge(NEW.id);
  PERFORM public.fn_ca_promo_integrity_roll_source(NEW.id,uid,promo);
  PERFORM public.fn_ca_promo_capture_entry_funding(NEW.id,promo);
 ELSIF NEW.from_type='prize_liability' AND NEW.to_type='escrow' AND NEW.category='ticket_issue' THEN
  IF uid IS NULL THEN RAISE EXCEPTION 'promo_satellite_ticket_original_holder_missing'; END IF;
  promo:=public.fn_ca_promo_roll_event_principal(NEW.id,uid,'ticket');
  PERFORM public.fn_ca_promo_integrity_roll_source(NEW.id,uid,promo);
 END IF;
 RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_nonwallet_entry() FROM PUBLIC, anon, authenticated, service_role;

-- 4. Club departure only settles promo play-through when the member holds
--    open-grant principal custody in pending_addon, player_wallet, or agent_wallet.
CREATE OR REPLACE FUNCTION public.fn_ca_promo_leave_principal(p_club uuid, p_user uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r record;returned numeric:=0;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from<=clock_timestamp()) THEN RETURN 0; END IF;
 IF NOT EXISTS(
   SELECT 1
     FROM public.ca_promo_principal_custody c
     JOIN public.ca_promo_play_through_grants g ON g.id = c.grant_id
    WHERE g.club_id = p_club
      AND g.user_id = p_user
      AND g.closed_at IS NULL
      AND c.kind IN ('pending_addon', 'player_wallet', 'agent_wallet')
      AND c.amount > 0
 ) THEN
   RETURN 0;
 END IF;
 PERFORM public.fn_ca_promo_play_through_settle(p_club,p_user);
 -- An original pending funding application still owes this member either
 -- a seat credit or its wallet refund. Keep its destination until that
 -- original owner has recorded the application; never discard the liability.
 IF EXISTS(SELECT 1 FROM public.ca_promo_principal_custody c
  JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
  WHERE g.club_id=p_club AND g.user_id=p_user AND g.closed_at IS NULL
   AND c.kind='pending_addon' AND c.amount>0) THEN
  RAISE EXCEPTION 'Wait For Your Pending Table Top-Up To Settle Before Leaving The Club'
   USING ERRCODE='55000';
 END IF;
 FOR r IN SELECT g.id,c.kind FROM public.ca_promo_play_through_grants g
  JOIN public.ca_promo_principal_custody c ON c.grant_id=g.id
  WHERE g.club_id=p_club AND g.user_id=p_user AND g.closed_at IS NULL
   AND c.amount>0 AND c.kind IN('player_wallet','agent_wallet')
  ORDER BY g.granted_at,g.id,c.kind LOOP
  returned:=returned+public.fn_ca_promo_return_principal(r.id,r.kind,'left_club',NULL,'leave:'||r.kind);
 END LOOP;
 RETURN returned;
END $function$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_leave_principal(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

-- 5. The hourly promo sweep never leaves a self-invalidated cache signature
--    after closing a grant or unlocking a gate, and prioritizes accounts whose
--    cache is missing, expired, or signature-mismatched instead of waiting 1h.
CREATE OR REPLACE PROCEDURE public.sp_ca_promo_profit_hourly_sweep(IN p_budget_seconds integer DEFAULT 60)
 LANGUAGE plpgsql
AS $procedure$
DECLARE
  r             record;
  t_start       timestamptz := clock_timestamp();
  t0            timestamptz;
  v_err         text;
  v_unlock      uuid[];
  v_met         uuid[];
  v_act_mutated boolean;
  v_rows_u      integer;
  v_rows_m      integer;
  v_budget      integer := GREATEST(5, LEAST(COALESCE(p_budget_seconds, 60), 100));
  v_key         integer := hashtext('ca-promo-profit-hourly-sweep');
BEGIN
  -- The :55 freeze stops everything; so does this.
  IF public.fn_platform_frozen() THEN RETURN; END IF;
  -- One sweep at a time. Session scope, because every account commits alone.
  IF NOT pg_try_advisory_lock(v_key) THEN RETURN; END IF;

  FOR r IN
    SELECT a.club_id, a.user_id
      FROM (
        SELECT g.club_id, g.user_id
          FROM public.ca_promo_play_through_grants g
          JOIN public.ca_promo_profit_gates w ON w.grant_id = g.id
         WHERE w.unlocked_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM public.ca_promo_profit_overrides o
                            WHERE o.grant_id = g.id)
        UNION
        SELECT g.club_id, g.user_id
          FROM public.ca_promo_play_through_grants g
         WHERE g.closed_at IS NULL
      ) a
      LEFT JOIN public.ca_promo_profit_sweep_state s
        ON s.club_id = a.club_id AND s.user_id = a.user_id
      LEFT JOIN public.ca_promo_fee_state_cache k
        ON k.club_id = a.club_id AND k.user_id = a.user_id
     WHERE s.last_swept_at IS NULL
        OR s.last_swept_at <= clock_timestamp() - interval '1 hour'
        OR (
          (k.club_id IS NULL
           OR k.valid_until <= clock_timestamp()
           OR k.computed_at <= clock_timestamp() - interval '2 hours'
           OR k.signature IS DISTINCT FROM public.fn_ca_promo_fee_state_signature(a.club_id, a.user_id))
          AND (s.last_error IS NULL OR s.last_swept_at <= clock_timestamp() - interval '5 minutes')
        )
     ORDER BY
       (k.club_id IS NULL
        OR k.valid_until <= clock_timestamp()
        OR k.computed_at <= clock_timestamp() - interval '2 hours'
        OR k.signature IS DISTINCT FROM public.fn_ca_promo_fee_state_signature(a.club_id, a.user_id)) DESC,
       s.last_swept_at NULLS FIRST,
       a.club_id,
       a.user_id
  LOOP
    EXIT WHEN clock_timestamp() - t_start > make_interval(secs => v_budget);
    EXIT WHEN public.fn_platform_frozen();
    t0 := clock_timestamp();
    v_err := NULL;
    v_unlock := NULL;
    v_met := NULL;
    v_act_mutated := false;

    -- LOOK. No grant row, no member row and no member scope is held.
    BEGIN
      IF public.fn_ca_promo_fee_state_refresh(r.club_id, r.user_id) THEN
        SELECT array_agg(DISTINCT x.grant_id) FILTER (WHERE x.profit_target > 0 AND x.profit_earned >= x.profit_target
                 AND w.unlocked_at IS NULL AND o.grant_id IS NULL),
               array_agg(DISTINCT x.grant_id) FILTER (WHERE x.phase_kind = 'gift' AND x.principal_state = 'met_pending'
                 AND g.closed_at IS NULL)
          INTO v_unlock, v_met
          FROM public.ca_promo_fee_state_cache k
          CROSS JOIN LATERAL jsonb_to_recordset(k.state) x(grant_id uuid, profit_target numeric, profit_earned numeric,
                 phase_kind text, principal_state text)
          JOIN public.ca_promo_play_through_grants g ON g.id = x.grant_id
          LEFT JOIN public.ca_promo_profit_gates w ON w.grant_id = x.grant_id
          LEFT JOIN public.ca_promo_profit_overrides o ON o.grant_id = x.grant_id
         WHERE k.club_id = r.club_id AND k.user_id = r.user_id AND k.computed_at >= t0;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_err := left(SQLERRM, 500);
    END;
    -- The look is committed before anything is locked.
    COMMIT;

    -- ACT. Never queue behind a chip movement and never make one wait: a busy
    -- account is left alone and looked at again on the next run.
    IF v_err IS NULL AND (v_unlock IS NOT NULL OR v_met IS NOT NULL) THEN
      BEGIN
        PERFORM set_config('lock_timeout', '1s', true);
        IF pg_try_advisory_xact_lock(hashtextextended(
             'ca_promo_play_through:' || r.club_id::text || ':' || r.user_id::text, 0)) THEN
          PERFORM 1 FROM public.ca_promo_play_through_grants g
            WHERE g.club_id = r.club_id AND g.user_id = r.user_id
            ORDER BY g.granted_at, g.id FOR UPDATE NOWAIT;
          UPDATE public.ca_promo_profit_gates w SET unlocked_at = clock_timestamp()
           WHERE w.grant_id = ANY (COALESCE(v_unlock, '{}'::uuid[])) AND w.unlocked_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM public.ca_promo_profit_overrides o WHERE o.grant_id = w.grant_id);
          GET DIAGNOSTICS v_rows_u = ROW_COUNT;
          UPDATE public.ca_promo_play_through_grants g
             SET closed_at = clock_timestamp(), close_reason = 'met', remaining = 0
           WHERE g.id = ANY (COALESCE(v_met, '{}'::uuid[])) AND g.closed_at IS NULL
             AND g.club_id = r.club_id AND g.user_id = r.user_id;
          GET DIAGNOSTICS v_rows_m = ROW_COUNT;
          v_act_mutated := (v_rows_u > 0 OR v_rows_m > 0);
        ELSE
          v_err := 'busy';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_err := CASE WHEN SQLSTATE = '55P03' THEN 'busy' ELSE left(SQLERRM, 500) END;
      END;
    END IF;

    IF v_err IS DISTINCT FROM 'busy' THEN
      INSERT INTO public.ca_promo_profit_sweep_state AS st
        (club_id, user_id, last_swept_at, last_ms, last_error)
      VALUES (r.club_id, r.user_id, clock_timestamp(),
              (extract(epoch FROM clock_timestamp() - t0) * 1000)::integer, v_err)
      ON CONFLICT (club_id, user_id) DO UPDATE
        SET last_swept_at = EXCLUDED.last_swept_at,
            last_ms       = EXCLUDED.last_ms,
            last_error    = EXCLUDED.last_error;
    END IF;
    COMMIT;

    -- POST-ACT CACHE SYNC (20261122205903): closing a grant or unlocking a gate
    -- changes fn_ca_promo_fee_state_signature, immediately invalidating the
    -- cache row written in LOOK. Refresh lock-free now whenever the account
    -- still has an open grant or locked winnings gate.
    IF v_act_mutated AND v_err IS NULL AND NOT public.fn_platform_frozen() THEN
      IF EXISTS (
        SELECT 1 FROM public.ca_promo_play_through_grants g
         WHERE g.club_id = r.club_id AND g.user_id = r.user_id AND g.closed_at IS NULL
      ) OR EXISTS (
        SELECT 1 FROM public.ca_promo_play_through_grants g
          JOIN public.ca_promo_profit_gates w ON w.grant_id = g.id
         WHERE g.club_id = r.club_id AND g.user_id = r.user_id
           AND w.unlocked_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM public.ca_promo_profit_overrides o WHERE o.grant_id = g.id)
      ) THEN
        BEGIN
          PERFORM public.fn_ca_promo_fee_state_refresh(r.club_id, r.user_id);
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
        COMMIT;
      END IF;
    END IF;
  END LOOP;

  PERFORM pg_advisory_unlock(v_key);
END
$procedure$;
REVOKE ALL ON PROCEDURE public.sp_ca_promo_profit_hourly_sweep(integer) FROM PUBLIC, anon, authenticated, service_role;

-- @probe-for: public.fn_ca_promo_apply_pending_cash_funding
DO $probe$
DECLARE
  v_funding uuid := gen_random_uuid();
  v_pending uuid := gen_random_uuid();
  v_user    uuid := gen_random_uuid();
  v_table   uuid := gen_random_uuid();
  v_seat    uuid := gen_random_uuid();
  v_occ     uuid := gen_random_uuid();
  v_ledger  uuid := gen_random_uuid();
  v_club    uuid := gen_random_uuid();
  v_before  numeric;
BEGIN
  INSERT INTO public.cash_participant_funding_receipts (
    id, recorded_at, operation_kind, operation_key, user_id, table_id, seat_id,
    occupancy_id, seat_joined_at, source_ledger_id, account_type, account_entity_id,
    funding_club_id, asset, unit_scale, amount, balance_before, balance_after, pending_addon_id
  ) VALUES (
    v_funding, clock_timestamp(), 'addon', 'probe:' || v_pending::text, v_user, v_table, v_seat,
    v_occ, clock_timestamp(), v_ledger, 'player_wallet', v_user,
    v_club, 'chips', 2, 10.00, 100.00, 90.00, v_pending
  );
  INSERT INTO public.cash_funding_application_receipts (
    pending_addon_id, funding_receipt_id, applied_at, original_occupancy_id,
    applied_occupancy_id, applied, refunded
  ) VALUES (
    v_pending, v_funding, clock_timestamp(), v_occ, NULL, 0, 10.00
  );
  PERFORM public.fn_ca_promo_apply_pending_cash_funding(v_pending);
  SELECT principal_before INTO STRICT v_before
    FROM public.ca_promo_pending_custody_receipts
   WHERE pending_addon_id = v_pending;
  IF v_before <> 0 THEN
    RAISE EXCEPTION 'unexpected non-zero principal_before in zero-custody probe: %', v_before;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_ca_promo_locked_at
DO $probe$
DECLARE
  v_locked numeric;
BEGIN
  v_locked := public.fn_ca_promo_locked_at(gen_random_uuid(), gen_random_uuid(), 'pending_addon', gen_random_uuid());
  IF v_locked <> 0 THEN
    RAISE EXCEPTION 'unexpected non-zero fn_ca_promo_locked_at in zero-custody probe: %', v_locked;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_ca_promo_leave_principal
DO $probe$
DECLARE
  v_returned numeric;
BEGIN
  v_returned := public.fn_ca_promo_leave_principal(gen_random_uuid(), gen_random_uuid());
  IF v_returned <> 0 THEN
    RAISE EXCEPTION 'unexpected non-zero fn_ca_promo_leave_principal in zero-custody probe: %', v_returned;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
