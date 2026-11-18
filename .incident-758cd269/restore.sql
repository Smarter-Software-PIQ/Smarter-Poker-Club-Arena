-- TIER: 1 (incident 758cd269 TournamentFinishRefusalsPersisting, reason=rake_attribution).
-- AUTHOR: Claude. AFFECTS: five tournament money functions + one resurrected overload.
-- WHY: at ~2026-11-18 06:05 UTC the August file 20260826_tournament_rake_settlement_integrity.sql
-- (applied 2026-08-27, recorded as 20260827011455) was REPLAYED because its filename
-- version (20260826) is not a recorded version. It rolled fn_settle_tournament_rake back
-- to the pre-attribution body, so every finish was refused by the terminal guard
-- ('rake attribution did not complete'), re-created the process_tournament_rebuy
-- 6-arg overload dropped in 20260828021009 (EXECUTE to PUBLIC/anon), and re-granted
-- atomic_cancel_tournament to authenticated.
-- This restores the exact bodies production ran before the replay, copied byte-for-byte
-- from the recorded migrations named below (md5 of each body asserted).
-- REPLAY-SAFE: refuses unless each function is in the stale (replayed) state or already
-- in the restored state, so a future replay of this file can never roll back newer work.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$
DECLARE r record; v text;
BEGIN
 FOR r IN SELECT * FROM (VALUES ('public.fn_settle_tournament_rake(uuid,text)','af89499b16d4011ea9e64f366b59c1eb','30dc972220452d046ac4847dc8f34edc'),
 ('public.fn_sweep_unsettled_tournament_rake(integer,integer)','2ba3632f4a457df44a026e2498d7f9a5','0b099303c20d0fdeb9e26821f12aa763'),
 ('public.fn_unregister_from_tournament(uuid)','3f715e92e9e7e494942ce8e7c0b864ab','cc93302253f3cc5b23265665f8cf86e3'),
 ('public.atomic_cancel_tournament(uuid,uuid)','2dec9d322115de68f8400175622a2032','c7172f9d760fc00219cb2186f19f93ed')) x(sig,stale,good) LOOP
  SELECT md5(p.prosrc) INTO v FROM pg_proc p WHERE p.oid=to_regprocedure(r.sig);
  IF v IS NULL OR v NOT IN (r.stale,r.good) THEN
   RAISE EXCEPTION 'restore refused: % is in an unknown state (md5 %); a newer definition exists, do not replay this file', r.sig, v;
  END IF;
 END LOOP;
END $guard$;

-- fn_settle_tournament_rake: restored verbatim from 20261102180105_owner_retirement_transfers_custody_and_closes_exact_events.sql
CREATE OR REPLACE FUNCTION public.fn_settle_tournament_rake(p_tournament_id uuid, p_source text DEFAULT 'engine'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
 v_t record;v_prior record;v_claimed int;v_plan jsonb;v_att jsonb;v_res jsonb;
 v_net numeric;v_union uuid;v_dest text;v_reason text;v_raw record;v_bank_id uuid;v_journal_id uuid;v_matches int;
 v_week_start timestamptz;v_week_end timestamptz;v_lock_key text;v_attempt int:=0;
BEGIN
 PERFORM public.fn_ca_lock_settlement_lane_global();
 SELECT t.id,t.status,t.club_id,t.union_id,t.is_private,t.name,t.current_players INTO v_t
  FROM public.tournaments t WHERE t.id=p_tournament_id FOR NO KEY UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','not_found'); END IF;
 IF upper(COALESCE(v_t.status,'')) NOT IN('COMPLETING','COMPLETED','CANCELLED','CANCELED') THEN
  RETURN jsonb_build_object('ok',false,'reason','not_terminal','status',v_t.status); END IF;
 PERFORM public.fn_ca_begin_legacy_fee_resolution(p_tournament_id);
 INSERT INTO public.tournament_rake_settlements(tournament_id,club_id,amount,destination,source)
 VALUES(p_tournament_id,v_t.club_id,0,'pending',COALESCE(p_source,'engine')) ON CONFLICT(tournament_id) DO NOTHING;
 GET DIAGNOSTICS v_claimed=ROW_COUNT;
 IF v_claimed=0 THEN
  SELECT * INTO v_prior FROM public.tournament_rake_settlements WHERE tournament_id=p_tournament_id;
  -- Historical claims do not authorize another fee transfer or a success
  -- claim unless their stored attribution actually completed.
  IF v_prior.settled_at IS NULL OR v_prior.attributed_at IS NULL
   OR v_prior.attributed_users IS NULL OR v_prior.attributed_users<0
   OR v_prior.attribution_error IS NOT NULL
   OR NULLIF(v_prior.destination,'') IS NULL OR v_prior.destination='pending' THEN
   RETURN jsonb_build_object('ok',false,'already_settled',true,
    'reason','settlement_attribution_incomplete','amount',v_prior.amount,
    'destination',v_prior.destination,'settled_at',v_prior.settled_at,'attributed',false);
  END IF;
  IF v_prior.amount>0 AND v_prior.union_id IS NULL AND NOT public.fn_poker_diamond_tournament(p_tournament_id)
   AND v_prior.destination IS DISTINCT FROM 'chip_retirement:'||v_prior.club_id::text THEN
   RAISE EXCEPTION 'tournament_fee_legacy_treasury_leg_requires_adjustment' USING ERRCODE='55000'; END IF;
  v_att:=public.fn_accounting_tournament_terminal_fee_receipt(p_tournament_id);
  IF v_prior.amount>0 AND v_prior.union_id IS NULL AND NOT public.fn_poker_diamond_tournament(p_tournament_id) AND v_att IS NULL THEN
   RAISE EXCEPTION 'tournament_fee_disposition_receipt_missing' USING ERRCODE='55000'; END IF;
  RETURN jsonb_build_object('ok',true,'already_settled',true,'amount',v_prior.amount,'destination',v_prior.destination,
    'settled_at',v_prior.settled_at,'attributed',true,'attributed_users',v_prior.attributed_users,
    'no_attribution_due',v_prior.amount=0,'accounting',v_att);
 END IF;
  -- DIAMOND PHASE 8: a Diamond event's fee sits in its custody rows, not in
  -- rake_records; it goes to the house, and then the emptied custody closes.
  IF public.fn_poker_diamond_tournament(p_tournament_id) THEN
    IF EXISTS(SELECT 1 FROM smarter_private.owner_retirement_pool_transfers x
      JOIN smarter_private.owner_tournament_deletion_intents i USING(tournament_id)
      WHERE x.tournament_id=p_tournament_id AND x.asset='diamonds' AND x.destination_id=i.destination_id
      AND x.transaction_id=txid_current()) THEN
     SELECT x.fee,'player:'||x.destination_id::text INTO v_net,v_dest
      FROM smarter_private.owner_retirement_pool_transfers x WHERE x.tournament_id=p_tournament_id;
     IF public.fn_poker_diamond_tournament_custody(p_tournament_id)<>0 THEN
      RAISE EXCEPTION 'owner_retirement_fee_custody_not_zero';END IF;
     UPDATE public.tournament_rake_settlements SET amount=v_net,destination=v_dest,
      settled_at=now(),attributed_at=now(),attributed_users=0 WHERE tournament_id=p_tournament_id;
     v_res:=public.fn_poker_diamond_tournament_close_custody(p_tournament_id);
     IF (v_res->>'still_held')::integer IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'owner_retirement_custody_close_incomplete';END IF;
     RETURN jsonb_build_object('ok',true,'amount',v_net,'destination',v_dest,'attributed',true,
      'attributed_users',0,'members',0,'asset','diamonds','custody_closed',v_res->>'closed','custody_still_held',0);
    END IF;
    v_res := public.fn_poker_diamond_tournament_settle_fee(p_tournament_id, COALESCE(p_source, 'engine'));
    v_net := COALESCE((v_res->>'amount')::numeric, 0);
    UPDATE public.tournament_rake_settlements
       SET amount = v_net,
           destination = CASE WHEN v_net > 0 THEN 'diamond_house' ELSE 'none' END,
           settled_at = now(), attributed_at = now(), attributed_users = 0
     WHERE tournament_id = p_tournament_id;
    v_res := public.fn_poker_diamond_tournament_close_custody(p_tournament_id);
    RETURN jsonb_build_object('ok', true, 'amount', v_net,
      'destination', CASE WHEN v_net > 0 THEN 'diamond_house' ELSE 'none' END,
      'attributed', true, 'attributed_users', 0, 'members', 0, 'asset', 'diamonds',
      'custody_closed', v_res->>'closed', 'custody_still_held', v_res->>'still_held');
  END IF;

 -- Deferred capture is normally already committed. A same-transaction Spin
 -- close still captures the original exact charge before it can be recognized.
 FOR v_raw IN SELECT r.id FROM public.rake_records r WHERE r.tournament_id=p_tournament_id AND r.is_tournament
  AND r.rake_amount>0 AND r.created_at=transaction_timestamp()
  AND NOT EXISTS(SELECT 1 FROM public.accounting_tournament_fee_batches b WHERE b.rake_record_id=r.id) ORDER BY r.id LOOP
  PERFORM public.fn_stamp_accounting_tournament_fee(v_raw.id);
 END LOOP;
 -- 2026-09-20. A fee charged BEFORE the cutover was never captured by a
 -- producer, and fn_ca_capture_tournament_fee_from_recorded_evidence - the
 -- reader built for exactly that record - was reachable only from
 -- fn_ca_begin_legacy_fee_resolution, which does nothing unless the event
 -- already holds a custody obligation, which only a named event can get.
 -- So the reader was never called for an event that was not on a list.
 -- Call it here, on the ordinary close, while the event is COMPLETING.
 -- Each capture takes its own subtransaction: one that cannot prove itself
 -- rolls back alone and leaves its record exactly as it was, so the net
 -- plan below still refuses in the same words and legacy custody still
 -- receives the same reason. This can only add proof, never remove it.
 FOR v_raw IN SELECT r.id FROM public.rake_records r
   JOIN public.accounting_tournament_fee_cutover c ON c.singleton
  WHERE r.tournament_id=p_tournament_id AND r.is_tournament
    AND r.rake_amount>0 AND r.hand_id IS NULL AND r.created_at<c.starts_at
    AND NOT EXISTS(SELECT 1 FROM public.accounting_tournament_fee_batches b WHERE b.rake_record_id=r.id)
  ORDER BY r.id LOOP
  BEGIN
   PERFORM public.fn_ca_capture_tournament_fee_from_recorded_evidence(v_raw.id);
  EXCEPTION WHEN OTHERS THEN
   -- Not silence: the reason travels to the log, and the refusal that
   -- follows is unchanged. "Could not prove it" is not "there was nothing".
   RAISE NOTICE 'pre-cutover fee % left uncaptured: % (%)', v_raw.id, SQLERRM, SQLSTATE;
  END;
 END LOOP;
 SELECT COALESCE(sum(r.rake_amount),0) INTO v_net FROM public.rake_records r WHERE r.tournament_id=p_tournament_id AND r.is_tournament;
 IF v_net<0 OR v_net<>round(v_net,2) OR v_net::text IN('NaN','Infinity','-Infinity') THEN
  RAISE EXCEPTION 'tournament_fee_net_invalid' USING ERRCODE='23514'; END IF;
 BEGIN
  -- Qualify only this owning close's complete original mixed-cutover Spin
  -- receipts. The original batch remains unchanged; any failure below rolls
  -- proof, source rows, claim, bank transfer and recognition back together.
  FOR v_raw IN SELECT r.id FROM public.rake_records r
   JOIN public.accounting_tournament_fee_batches b ON b.rake_record_id=r.id
   JOIN public.accounting_tournament_fee_cutover c ON c.singleton
   WHERE r.tournament_id=p_tournament_id AND r.is_tournament AND r.rake_amount>0
    AND r.source='fn_spin_book_entry' AND r.created_at>=c.starts_at
    AND b.status='legacy_unverified' AND b.source_manifest IS NULL ORDER BY r.id LOOP
   PERFORM public.fn_accounting_qualify_mixed_cutover_spin_fee(v_raw.id);
  END LOOP;
  -- Original close owns deferred capture, source proof, player money and
  -- fee recognition in one transaction. No worker or scheduled repair.
  FOR v_raw IN SELECT r.id FROM public.rake_records r
   JOIN public.accounting_tournament_fee_batches b ON b.rake_record_id=r.id
   CROSS JOIN public.accounting_owner_direct_fee_incident i
   WHERE i.singleton AND r.tournament_id=p_tournament_id AND r.is_tournament AND r.rake_amount>0
    AND r.created_at>=i.starts_at AND r.created_at<i.ends_at
    AND b.status='legacy_unverified' AND b.source_manifest->>'capture_reason'='accounting_terms_not_observed'
   ORDER BY r.id LOOP
   PERFORM public.fn_accounting_qualify_owner_direct_fee(v_raw.id);
  END LOOP;
  v_plan:=public.fn_accounting_tournament_fee_net_plan(p_tournament_id);
 EXCEPTION WHEN SQLSTATE '55000' THEN
  IF SQLERRM NOT IN('tournament_fee_sources_require_reconciliation','accounting_terms_not_observed','accounting_terms_not_active','tournament_fee_not_captured_by_original_producer') THEN RAISE; END IF;
  v_reason:=SQLERRM;
  -- A new positive fee cannot leave custody before its exact attribution is
  -- available. Throw: direct callers must also roll back the inserted claim.
  IF v_net>0 THEN
   RAISE EXCEPTION 'tournament % rake attribution incomplete: %',p_tournament_id,v_reason USING ERRCODE='P0404';
  END IF;
  -- Exact zero owes no new attribution. Preserve the predecessor's zero-fee
  -- completion without inventing a source, bank, commission or paid receipt.
 END;
 v_union:=CASE WHEN v_reason IS NULL THEN NULLIF(v_plan->>'union_id','')::uuid
  WHEN v_t.is_private THEN NULL ELSE v_t.union_id END;
 PERFORM public.fn_lock_accounting_tournament_recognition_week(p_tournament_id,transaction_timestamp());
 -- A legacy event may have no captured contributor scope. Its actual bank
 -- still takes the exact same close lock, before either wallet is touched.
 v_week_start:=public.fn_union_week_start(transaction_timestamp());
 v_week_end:=((v_week_start AT TIME ZONE 'America/Los_Angeles')+interval '7 days') AT TIME ZONE 'America/Los_Angeles';
 v_lock_key:=CASE WHEN v_union IS NULL THEN 'club-accounting:'||v_t.club_id::text ELSE 'union-accounting:'||v_union::text END
  ||':'||extract(epoch FROM v_week_start)::text||':'||extract(epoch FROM v_week_end)::text;
 IF v_lock_key IS NOT NULL THEN PERFORM pg_advisory_xact_lock_shared(hashtextextended(v_lock_key,0)); END IF;
 IF EXISTS(SELECT 1 FROM public.accounting_routed_settlement_runs x WHERE x.period_start<=transaction_timestamp() AND x.period_end>transaction_timestamp()
   AND ((v_union IS NOT NULL AND x.union_id=v_union) OR(v_union IS NULL AND x.standalone_club_id=v_t.club_id))) THEN
  RAISE EXCEPTION 'tournament_accrual_closed_period_requires_adjustment' USING ERRCODE='23514'; END IF;
 IF v_net>0 THEN
  IF v_t.club_id IS NULL THEN RAISE EXCEPTION 'tournament_fee_bank_club_required' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM public.club_wallets WHERE club_id=v_t.club_id FOR NO KEY UPDATE;
  PERFORM set_config('app.ledger_category','rake',true);
  PERFORM set_config('app.ledger_counterparty','prize_liability',true);
  PERFORM set_config('app.ledger_counterparty_entity',p_tournament_id::text,true);
  /* THE TOURNAMENT RAKE LEG NAMES THE CLUB IT WAS EARNED IN (2026-09-21).
     The union fee is routed by UPDATE-ing union_wallets.rake_wallet through
     increment_union_wallet; fn_ca_autoledger journals that delta, and
     union_wallets has no club_id column, so every tournament union rake leg
     was written club-less. 20260920192513 taught the autoledger to read a
     declaring payer and fixed the PRIZE legs; 20260921040847 made the
     cash-table rake payer declare; this is the tournament rake payer saying
     the same thing. v_t.club_id is refused NULL above, and is the same club
     handed to increment_union_wallet for union_wallet_transactions.club_id,
     so the leg and its sibling receipt name one club or the fee does not
     move at all. NOT app.ledger_club_id: that name decides which club a
     WALLET credit is paid into (atomic_credit_wallet_and_log) and is set and
     restored by the rakeback close, so clearing it here would move money. */
  PERFORM set_config('app.ledger_autoledger_club_id',COALESCE(v_t.club_id::text,''),true);
  IF v_union IS NOT NULL THEN
   v_res:=public.increment_union_wallet(v_union,v_net,v_t.club_id,
    'Tournament rake: '||COALESCE(v_t.name,'tournament')||' [tournament '||p_tournament_id::text||']');
   IF COALESCE((v_res->>'success')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'tournament_fee_union_credit_failed' USING ERRCODE='23514'; END IF;
   SELECT count(*),(array_agg(id))[1] INTO v_matches,v_bank_id FROM public.union_wallet_transactions
    WHERE union_id=v_union AND club_id=v_t.club_id AND wallet='rake_wallet' AND direction='credit' AND tx_type='rake'
     AND amount=v_net AND created_at=transaction_timestamp() AND position('[tournament '||p_tournament_id::text||']' IN COALESCE(notes,''))>0;
   v_dest:='union:'||v_union::text;
  ELSE
   -- The original settlement-row trigger removes this exact fee from escrow.
   -- Retire that liability in the canonical journal; never debit a treasury or
   -- call fn_ca_burn, which would take these same chips from a wallet again.
   UPDATE public.clubs SET total_rake=COALESCE(total_rake,0)+v_net,updated_at=now()
    WHERE id=v_t.club_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'tournament_fee_club_missing' USING ERRCODE='23514'; END IF;
   INSERT INTO public.chip_ledger
    (performed_by,from_type,from_entity_id,to_type,to_entity_id,club_id,tournament_id,category,amount,description)
   VALUES(COALESCE(auth.uid(),'2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid),
    'prize_liability',p_tournament_id,'chip_retirement',NULL,v_t.club_id,p_tournament_id,'burn',v_net,
    'Standalone tournament fee retired (fn_settle_tournament_rake)') RETURNING id INTO v_journal_id;
   v_matches:=1;
   v_dest:='chip_retirement:'||v_t.club_id::text;
  END IF;
  IF v_matches<>1 THEN RAISE EXCEPTION 'tournament_fee_exact_bank_receipt_required' USING ERRCODE='23514'; END IF;
  UPDATE public.club_wallets SET period_rake_collected=COALESCE(period_rake_collected,0)+v_net,
   lifetime_rake_collected=COALESCE(lifetime_rake_collected,0)+v_net,updated_at=now() WHERE club_id=v_t.club_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'tournament_fee_club_wallet_missing' USING ERRCODE='23514'; END IF;
  PERFORM set_config('app.ledger_autoledger_club_id','',true);
 ELSE v_dest:='none'; END IF;
 IF v_reason IS NULL THEN
  -- Preserve the installed bounded retry contract, now around the sole
  -- canonical recognition writer. Exhaustion and permanent errors escape the
  -- whole settlement; rolled-back attempts cannot retain partial attribution.
  LOOP
   v_attempt:=v_attempt+1;
   BEGIN
    v_att:=public.fn_recognize_accounting_tournament_fees(p_tournament_id,transaction_timestamp(),v_t.club_id,v_bank_id,v_journal_id);
    EXIT;
   EXCEPTION WHEN deadlock_detected OR lock_not_available THEN
    IF v_attempt>=4 THEN RAISE; END IF;
    PERFORM pg_sleep(CASE v_attempt WHEN 1 THEN 0.1 WHEN 2 THEN 0.3 ELSE 0.6 END);
   END;
  END LOOP;
  IF v_att->>'status' IS DISTINCT FROM (CASE WHEN v_net>0 THEN 'recognized' ELSE 'cancelled' END)
   OR (v_att->>'attributed_chips')::numeric IS DISTINCT FROM v_net
   OR (v_net>0 AND COALESCE((v_att->>'attributed_users')::int,0)<1) THEN
   RAISE EXCEPTION 'tournament % rake attribution incomplete: canonical source receipt',p_tournament_id USING ERRCODE='P0404';
  END IF;
 END IF;
 UPDATE public.tournament_rake_settlements SET amount=v_net,union_id=v_union,destination=v_dest,settled_at=transaction_timestamp(),
  attributed_at=transaction_timestamp(),attributed_users=COALESCE((v_att->>'attributed_users')::int,0),
  attribution_error=NULL WHERE tournament_id=p_tournament_id;
 IF EXISTS(SELECT 1 FROM public.accounting_tournament_fee_custody_resolutions WHERE tournament_id=p_tournament_id AND transaction_id=txid_current()) THEN
  UPDATE public.tournament_rake_settlements SET terminal_closed_at=(SELECT completed_at FROM public.tournament_terminal_settlements WHERE tournament_id=p_tournament_id) WHERE tournament_id=p_tournament_id AND terminal_closed_at IS NULL;
 END IF;
 RETURN jsonb_build_object('ok',true,'amount',v_net,'destination',v_dest,'attributed',true,
  'attributed_users',COALESCE((v_att->>'attributed_users')::int,0),'attribution_attempts',v_attempt,
  'no_attribution_due',v_net=0,'accounting',public.fn_accounting_tournament_terminal_fee_receipt(p_tournament_id));
END;
$function$
;
REVOKE ALL ON FUNCTION public.fn_settle_tournament_rake(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_settle_tournament_rake(uuid,text) TO service_role;

-- fn_sweep_unsettled_tournament_rake: restored verbatim from 20260909014534_non_satellite_terminal_settlement_commits_one_stored_receipt.sql
CREATE OR REPLACE FUNCTION public.fn_sweep_unsettled_tournament_rake(
  p_since_days integer DEFAULT 45,
  p_limit integer DEFAULT 200
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row record; v_res jsonb;
  v_settled integer := 0; v_chips numeric := 0; v_scanned integer := 0; v_failed integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('ca:tournament-terminal-settlement:v1',0));
  FOR v_row IN
    SELECT t.id
      FROM public.tournaments t
     WHERE upper(COALESCE(t.status, '')) IN ('COMPLETED', 'CANCELLED', 'CANCELED')
       AND t.ended_at IS NOT NULL
       AND t.ended_at > now() - make_interval(days => GREATEST(p_since_days, 1))
       AND t.ended_at < now() - interval '10 minutes'   -- never race a live finish
       AND EXISTS (SELECT 1 FROM public.rake_records r
                    WHERE r.tournament_id = t.id AND r.is_tournament)
       AND NOT EXISTS (SELECT 1 FROM public.tournament_rake_settlements s
                        WHERE s.tournament_id = t.id)
     ORDER BY t.ended_at ASC
     LIMIT GREATEST(p_limit, 1)
  LOOP
    v_scanned := v_scanned + 1;
    BEGIN
      v_res := public.fn_settle_tournament_rake(v_row.id, 'sweep');
      IF COALESCE((v_res->>'ok')::boolean, false)
         AND NOT COALESCE((v_res->>'already_settled')::boolean, false) THEN
        v_settled := v_settled + 1;
        v_chips := v_chips + COALESCE((v_res->>'amount')::numeric, 0);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      INSERT INTO public.financial_alerts (severity, source, message, context)
      VALUES ('warning', 'fn_sweep_unsettled_tournament_rake',
              'Sweep could not settle tournament rake: ' || SQLERRM,
              jsonb_build_object('tournament_id', v_row.id));
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'scanned', v_scanned,
    'settled', v_settled, 'chips', round(v_chips, 2), 'failed', v_failed);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_sweep_unsettled_tournament_rake(integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sweep_unsettled_tournament_rake(integer,integer) TO service_role;

-- fn_unregister_from_tournament: restored verbatim from 20260909165629_satellite_settlement_has_one_atomic_authority.sql
CREATE OR REPLACE FUNCTION public.fn_unregister_from_tournament(
  p_tournament_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $unregister_wrapper$
DECLARE
  v_uid uuid:=auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'fn_unregister_from_tournament requires an authenticated caller'
      USING ERRCODE='28000';
  END IF;
  IF NOT public.fn_caller_session_is_live() THEN
    RAISE EXCEPTION 'fn_unregister_from_tournament requires a live session'
      USING ERRCODE='28000';
  END IF;
  RETURN public.fn_ca_unregister_tournament_player_exact(
    p_tournament_id,v_uid,NULL,'Tournament unregistration refund');
END;
$unregister_wrapper$;
REVOKE ALL ON FUNCTION public.fn_unregister_from_tournament(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_unregister_from_tournament(uuid) TO authenticated,service_role;

-- atomic_cancel_tournament: restored verbatim from 20261103064259_undrawn_spin_cancellation_returns_booked_fees_before_gross_r.sql
CREATE OR REPLACE FUNCTION public.atomic_cancel_tournament(p_tournament_id uuid, p_admin_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_undrawn_spin boolean := false;
  v_uid uuid := auth.uid();
  v_actor uuid := COALESCE(
    auth.uid(),p_admin_id,'2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid);
  v_t public.tournaments%ROWTYPE;
  v_stored public.tournament_cancellation_receipts%ROWTYPE;
  v_e public.tournament_escrow%ROWTYPE;
  v_player record;
  v_entitlement public.tournament_refund_entitlements%ROWTYPE;
  v_fee record;
  v_contribution public.spin_reserve_ledger%ROWTYPE;
  v_draw public.spin_reserve_ledger%ROWTYPE;
  v_pool public.spin_bonus_pools%ROWTYPE;
  v_settle jsonb;
  v_receipt jsonb;
  v_refunds jsonb := '[]'::jsonb;
  v_ticket_returns jsonb := '[]'::jsonb;
  v_source_player_ids uuid[] := ARRAY[]::uuid[];
  v_refunded_registration_ids uuid[] := ARRAY[]::uuid[];
  v_ticket_return_ids uuid[] := ARRAY[]::uuid[];
  v_zero_refund_registration_ids uuid[] := ARRAY[]::uuid[];
  v_closed_table_ids uuid[] := ARRAY[]::uuid[];
  v_source_seat_ids uuid[] := ARRAY[]::uuid[];
  v_released_seat_ids uuid[] := ARRAY[]::uuid[];
  v_fee_reversal_ids uuid[] := ARRAY[]::uuid[];
  v_registration_id uuid;
  v_fee_reversal_id uuid;
  v_original_entry_journal_id uuid;
  v_original_draw_journal_id uuid;
  v_draw_reversal_id uuid;
  v_draw_reversal_journal_id uuid;
  v_contribution_reversal_id uuid;
  v_contribution_reversal_journal_id uuid;
  v_spin_unwind_id uuid;
  v_source_player_count integer := 0;
  v_refunded_count integer := 0;
  v_refund_line_count integer := 0;
  v_ticket_return_count integer := 0;
  v_zero_refund_count integer := 0;
  v_closed_table_count integer := 0;
  v_source_seat_count integer := 0;
  v_released_seat_count integer := 0;
  v_total_refunded numeric := 0;
  v_total_ticket_returned numeric := 0;
  v_fees_reversed numeric := 0;
  v_total_rake_before numeric := 0;
  v_total_rake_after numeric := 0;
  v_total_owed numeric;
  v_draw_amount numeric := 0;
  v_pool_balance_before numeric;
  v_pool_balance_after numeric;
  v_rows integer;
  v_journal_count integer;
  v_cancelled_at timestamptz := transaction_timestamp();
  v_close_note constant text := 'atomic cancellation receipt: exact zero';
BEGIN
  -- Every terminal authority takes this lock before any row lock. Cancellation,
  -- satellite finish and cash finish can touch the same wallets and event rows.
  PERFORM smarter_private.cancellation_lane(p_tournament_id);
  IF p_tournament_id IS NULL THEN
    RAISE EXCEPTION 'Tournament id is required' USING ERRCODE = '22004';
  END IF;

  SELECT * INTO v_t FROM public.tournaments t
   WHERE t.id=p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament not found' USING ERRCODE = 'P0002';
  END IF;
  -- DIAMOND PHASE 8: a Diamond event is cancelled by its own authority, which
  -- returns every entry from custody and writes the same immutable receipt;
  -- the chip rails below never saw a Diamond entry.
  IF public.fn_poker_diamond_tournament(p_tournament_id) THEN
    RETURN public.fn_poker_diamond_tournament_cancel(p_tournament_id, p_admin_id);
  END IF;
  IF v_uid IS NOT NULL
     AND NOT public.fn_can_create_games(v_t.club_id,v_uid) THEN
    RAISE EXCEPTION 'Only the governed game operator may cancel a tournament'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_stored FROM public.tournament_cancellation_receipts h
   WHERE h.tournament_id=p_tournament_id FOR UPDATE;
  IF FOUND THEN
    RETURN public.fn_ca_tournament_cancellation_receipt(p_tournament_id,NULL);
  END IF;
  IF upper(COALESCE(v_t.status::text,'')) IN
       ('COMPLETED','CANCELLED','CANCELED','COMPLETING') THEN
    RAISE EXCEPTION 'Tournament is already %',v_t.status USING ERRCODE='55000';
  END IF;

  -- A tournament that has started is resumed or settled, never voided.
  -- start_time is a schedule/fill deadline; it is not proof that play began.
  -- The stored receipt above remains replayable without another cancellation.
  IF v_t.started_at IS NOT NULL
     OR upper(COALESCE(v_t.status::text,'')) IN ('RUNNING','BREAK')
     OR COALESCE(v_t.spin_multiplier,0)>0
     OR EXISTS (SELECT 1 FROM public.tournament_launch_receipts r
                 WHERE r.tournament_id=p_tournament_id AND r.completed_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.spin_draw_receipts r
                 WHERE r.tournament_id=p_tournament_id)
     OR EXISTS (SELECT 1 FROM public.spin_reserve_ledger r
                 WHERE r.tournament_id=p_tournament_id AND r.kind='jackpot_draw')
     OR EXISTS (SELECT 1 FROM public.hand_history hh
                 WHERE hh.tournament_id=p_tournament_id)
     OR EXISTS (SELECT 1 FROM public.tables tb
                 JOIN public.hand_history hh ON hh.table_id=tb.id
                 WHERE tb.tournament_id=p_tournament_id)
     OR EXISTS (SELECT 1 FROM public.tournament_obligations o
                 WHERE o.tournament_id=p_tournament_id
                   AND o.kind<>'refund' AND o.amount_paid>0) THEN
    RAISE EXCEPTION
      'Tournament has started or committed awards; resume or settle it instead of cancelling'
      USING ERRCODE='55000';
  END IF;

  PERFORM public.fn_lock_accounting_tournament_recognition_week(p_tournament_id,transaction_timestamp());

  -- Freeze every identity before any payer runs. Any concurrent registration,
  -- seat move or hand settlement either committed before these locks and is in
  -- the receipt, or waits behind this transaction and sees a terminal parent.
  PERFORM 1 FROM public.tournament_players tp
   WHERE tp.tournament_id=p_tournament_id
   ORDER BY tp.user_id,tp.id FOR UPDATE;
  PERFORM 1 FROM public.tables tb
   WHERE tb.tournament_id=p_tournament_id ORDER BY tb.id FOR UPDATE;
  PERFORM 1 FROM public.table_seats s
   JOIN public.tables tb ON tb.id=s.table_id
   WHERE tb.tournament_id=p_tournament_id
   ORDER BY s.table_id,s.id FOR UPDATE OF s;
  SELECT COALESCE(array_agg(tp.id ORDER BY tp.id),ARRAY[]::uuid[])
    INTO v_source_player_ids FROM public.tournament_players tp
   WHERE tp.tournament_id=p_tournament_id;
  SELECT COALESCE(array_agg(tb.id ORDER BY tb.id),ARRAY[]::uuid[])
    INTO v_closed_table_ids FROM public.tables tb
   WHERE tb.tournament_id=p_tournament_id;
  SELECT COALESCE(array_agg(s.id ORDER BY s.table_id,s.id),ARRAY[]::uuid[])
    INTO v_source_seat_ids FROM public.table_seats s
    JOIN public.tables tb ON tb.id=s.table_id
   WHERE tb.tournament_id=p_tournament_id;
  v_source_player_count := cardinality(v_source_player_ids);
  v_closed_table_count := cardinality(v_closed_table_ids);
  v_source_seat_count := cardinality(v_source_seat_ids);

  PERFORM public.fn_ca_midway_free_buy_promo_head(p_tournament_id,tp.id,true)
    FROM public.tournament_players tp WHERE tp.tournament_id=p_tournament_id ORDER BY tp.id;
  SELECT * INTO v_t FROM public.tournaments WHERE id=p_tournament_id;
  PERFORM public.fn_ca_escrow_apply(
    p_tournament_id,'atomic cancellation escrow prelock');
  SELECT * INTO v_e FROM public.tournament_escrow e
   WHERE e.tournament_id=p_tournament_id FOR UPDATE;
  -- A full Spin books its reserve before the launch/draw transaction. Its
  -- immutable wallet entitlements still hold the original gross prize rail.
  -- Prove that exact pre-draw state before accepting its pre-launch display.
  v_undrawn_spin := upper(COALESCE(v_t.tournament_type,''))='SPIN'
    AND EXISTS (SELECT 1 FROM public.spin_reserve_ledger r
      WHERE r.tournament_id=p_tournament_id AND r.kind='contribution');
  IF v_undrawn_spin AND ((
    v_e.enforced IS TRUE AND v_e.closed_at IS NULL
    AND v_e.gross_in>0 AND v_e.bounty_in=0 AND v_e.overlay_in=0
    AND v_e.satellite_in=0 AND v_e.satellite_fee_in=0
    AND v_e.prize_out=0 AND v_e.bounty_out=0 AND v_e.fee_out=0
    AND v_e.refund_prize=0 AND v_e.refund_bounty=0 AND v_e.refund_fee=0
    AND v_e.reserve_in=0 AND v_e.prize_balance=0 AND v_e.bounty_balance=0
    AND v_e.gross_in=v_e.reserve_out+v_e.fee_balance
    AND (SELECT count(*) FROM public.tournament_players p
      WHERE p.tournament_id=p_tournament_id)=3
    AND (SELECT count(*) FROM public.tournament_refund_entitlements e
      WHERE e.tournament_id=p_tournament_id)=3
    AND NOT EXISTS (SELECT 1 FROM public.tournament_refund_entitlements e
      WHERE e.tournament_id=p_tournament_id AND
       (e.entitlement_kind<>'wallet_charge' OR e.refund_prize<>e.gross
        OR e.refund_fee<>0 OR e.refund_bounty<>0
        OR EXISTS (SELECT 1 FROM public.tournament_refund_tranches tr
          WHERE tr.entitlement_id=e.id)))
    AND (SELECT sum(e.gross) FROM public.tournament_refund_entitlements e
      WHERE e.tournament_id=p_tournament_id)=v_e.gross_in
    AND (SELECT count(*) FROM public.spin_reserve_ledger r
      WHERE r.tournament_id=p_tournament_id)=1
    AND EXISTS (SELECT 1 FROM public.spin_reserve_ledger r
      WHERE r.tournament_id=p_tournament_id AND r.kind='contribution'
        AND r.amount=v_e.reserve_out AND r.house_rake=v_e.fee_balance
        AND r.seats=3 AND round(r.buy_in*3,2)=v_e.gross_in)
  ) IS NOT TRUE) THEN
    RAISE EXCEPTION 'undrawn Spin cancellation entry evidence disagrees'
      USING ERRCODE='P0404';
  END IF;
  IF v_e.tournament_id IS NULL OR v_e.enforced IS DISTINCT FROM true
     OR (v_t.prize_pool IS DISTINCT FROM v_e.prize_balance
         AND NOT (v_undrawn_spin AND v_t.prize_pool=v_e.gross_in))
     OR v_t.bounty_pool IS DISTINCT FROM v_e.bounty_balance
     OR (v_t.total_rake IS DISTINCT FROM v_e.fee_balance
         AND NOT (v_undrawn_spin AND v_t.total_rake=0)) THEN
    RAISE EXCEPTION 'tournament % caches do not equal exact escrow before cancellation',
      p_tournament_id USING ERRCODE='P0404';
  END IF;

  -- A booked Spin first gives back its draw, then withdraws this event's own
  -- contribution. Each pool movement creates its strict journal before the
  -- matching immutable reversal row and all four ids are stored together.
  PERFORM 1 FROM public.spin_reserve_ledger r
   WHERE r.tournament_id=p_tournament_id ORDER BY r.created_at,r.id FOR UPDATE;
  SELECT * INTO v_contribution FROM public.spin_reserve_ledger r
   WHERE r.tournament_id=p_tournament_id AND r.kind='contribution';
  IF FOUND THEN
    IF (SELECT count(*) FROM public.spin_reserve_ledger r
         WHERE r.tournament_id=p_tournament_id AND r.kind='contribution') <> 1
       OR EXISTS (SELECT 1 FROM public.spin_reserve_ledger r
                   WHERE r.tournament_id=p_tournament_id
                     AND r.kind IN ('draw_reversal','contribution_reversal'))
       OR EXISTS (SELECT 1 FROM public.tournament_spin_cancellation_unwinds u
                   WHERE u.tournament_id=p_tournament_id) THEN
      RAISE EXCEPTION 'Spin % has an ambiguous or partially unwound reserve contract',
        p_tournament_id USING ERRCODE='P0404';
    END IF;
    SELECT * INTO v_draw FROM public.spin_reserve_ledger r
     WHERE r.tournament_id=p_tournament_id AND r.kind='jackpot_draw';
    IF FOUND AND (SELECT count(*) FROM public.spin_reserve_ledger r
                   WHERE r.tournament_id=p_tournament_id
                     AND r.kind='jackpot_draw') <> 1 THEN
      RAISE EXCEPTION 'Spin % has more than one immutable draw',p_tournament_id
        USING ERRCODE='P0404';
    END IF;
    SELECT * INTO v_pool FROM public.spin_bonus_pools p
     WHERE p.club_id=v_contribution.club_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Spin % original reserve owner is missing',p_tournament_id
        USING ERRCODE='P0404';
    END IF;
    v_pool_balance_before := v_pool.balance;
    IF v_pool_balance_before IS NULL
       OR v_pool_balance_before::text IN ('NaN','Infinity','-Infinity')
       OR v_pool_balance_before<0 THEN
      RAISE EXCEPTION 'Spin % reserve balance is invalid',p_tournament_id
        USING ERRCODE='22003';
    END IF;
    SELECT count(*),(array_agg(l.id ORDER BY l.created_at,l.id))[1]
      INTO v_journal_count,v_original_entry_journal_id
      FROM public.chip_ledger l
     WHERE l.tournament_id=p_tournament_id
       AND l.category='spin_entry'
       AND l.from_type='prize_liability'
       AND l.from_entity_id=p_tournament_id
       AND l.to_type='spin_reserve' AND l.to_entity_id=v_pool.id
       AND l.amount=v_contribution.amount;
    IF v_journal_count<>1 OR v_contribution.amount<=0 THEN
      RAISE EXCEPTION 'Spin % contribution has no single exact journal',p_tournament_id
        USING ERRCODE='P0404';
    END IF;

    IF v_draw.id IS NOT NULL THEN
      IF v_draw.club_id IS DISTINCT FROM v_contribution.club_id
         OR v_draw.amount>=0 THEN
        RAISE EXCEPTION 'Spin % draw disagrees with its contribution owner',p_tournament_id
          USING ERRCODE='P0404';
      END IF;
      v_draw_amount := round(-v_draw.amount,2);
      SELECT count(*),(array_agg(l.id ORDER BY l.created_at,l.id))[1]
        INTO v_journal_count,v_original_draw_journal_id
        FROM public.chip_ledger l
       WHERE l.tournament_id=p_tournament_id
         AND l.category='spin_prize'
         AND l.from_type='spin_reserve' AND l.from_entity_id=v_pool.id
         AND l.to_type='prize_liability' AND l.to_entity_id=p_tournament_id
         AND l.amount=v_draw_amount;
      IF v_journal_count<>1 THEN
        RAISE EXCEPTION 'Spin % draw has no single exact journal',p_tournament_id
          USING ERRCODE='P0404';
      END IF;
      PERFORM public.fn_ca_declare_ledger(
        'reversal','prize_liability',p_tournament_id,NULL,
        'spin:'||p_tournament_id::text||':cancel:draw',NULL);
      UPDATE public.spin_bonus_pools
         SET balance=balance+v_draw_amount,updated_at=now()
       WHERE id=v_pool.id RETURNING balance INTO v_pool_balance_after;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Spin % reserve vanished during draw reversal',p_tournament_id
          USING ERRCODE='55000';
      END IF;
      INSERT INTO public.spin_reserve_ledger
        (club_id,tournament_id,kind,amount,balance_after,multiplier,
         buy_in,seats,house_rake,note)
      VALUES
        (v_draw.club_id,p_tournament_id,'draw_reversal',v_draw_amount,
         v_pool_balance_after,v_draw.multiplier,v_draw.buy_in,v_draw.seats,
         v_draw.house_rake,'atomic cancellation reversed the exact reserve draw')
      RETURNING id INTO v_draw_reversal_id;
      SELECT count(*),(array_agg(l.id ORDER BY l.created_at,l.id))[1]
        INTO v_journal_count,v_draw_reversal_journal_id
        FROM public.chip_ledger l
       WHERE l.idempotency_key='spin:'||p_tournament_id::text||':cancel:draw'
         AND l.tournament_id=p_tournament_id AND l.category='reversal'
         AND l.from_type='prize_liability' AND l.from_entity_id=p_tournament_id
         AND l.to_type='spin_reserve' AND l.to_entity_id=v_pool.id
         AND l.amount=v_draw_amount;
      IF v_journal_count<>1 THEN
        RAISE EXCEPTION 'Spin % draw reversal has no single exact journal',p_tournament_id
          USING ERRCODE='P0404';
      END IF;
    ELSE
      v_pool_balance_after := v_pool_balance_before;
    END IF;

    IF v_pool_balance_after<v_contribution.amount THEN
      RAISE EXCEPTION 'Spin % reserve cannot return its own contribution',p_tournament_id
        USING ERRCODE='P0403';
    END IF;
    PERFORM public.fn_ca_declare_ledger(
      'reversal','prize_liability',p_tournament_id,NULL,
      'spin:'||p_tournament_id::text||':cancel:entry',NULL);
    UPDATE public.spin_bonus_pools
       SET balance=balance-v_contribution.amount,updated_at=now()
     WHERE id=v_pool.id RETURNING balance INTO v_pool_balance_after;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Spin % reserve vanished during contribution reversal',p_tournament_id
        USING ERRCODE='55000';
    END IF;
    INSERT INTO public.spin_reserve_ledger
      (club_id,tournament_id,kind,amount,balance_after,multiplier,
       buy_in,seats,house_rake,note)
    VALUES
      (v_contribution.club_id,p_tournament_id,'contribution_reversal',
       -v_contribution.amount,v_pool_balance_after,v_contribution.multiplier,
       v_contribution.buy_in,v_contribution.seats,v_contribution.house_rake,
       'atomic cancellation returned the exact entry contribution')
    RETURNING id INTO v_contribution_reversal_id;
    SELECT count(*),(array_agg(l.id ORDER BY l.created_at,l.id))[1]
      INTO v_journal_count,v_contribution_reversal_journal_id
      FROM public.chip_ledger l
     WHERE l.idempotency_key='spin:'||p_tournament_id::text||':cancel:entry'
       AND l.tournament_id=p_tournament_id AND l.category='reversal'
       AND l.from_type='spin_reserve' AND l.from_entity_id=v_pool.id
       AND l.to_type='prize_liability' AND l.to_entity_id=p_tournament_id
       AND l.amount=v_contribution.amount;
    IF v_journal_count<>1 THEN
      RAISE EXCEPTION 'Spin % contribution reversal has no single exact journal',
        p_tournament_id USING ERRCODE='P0404';
    END IF;
    INSERT INTO public.tournament_spin_cancellation_unwinds(
      tournament_id,pool_id,reserve_owner_id,
      original_contribution_id,original_draw_id,
      original_entry_journal_id,original_draw_journal_id,
      draw_reversal_id,draw_reversal_journal_id,
      contribution_reversal_id,contribution_reversal_journal_id,
      contribution_amount,draw_amount,pool_balance_before,pool_balance_after,
      settled_at)
    VALUES(
      p_tournament_id,v_pool.id,v_contribution.club_id,
      v_contribution.id,v_draw.id,
      v_original_entry_journal_id,v_original_draw_journal_id,
      v_draw_reversal_id,v_draw_reversal_journal_id,
      v_contribution_reversal_id,v_contribution_reversal_journal_id,
      v_contribution.amount,v_draw_amount,v_pool_balance_before,
      v_pool_balance_after,v_cancelled_at)
    RETURNING tournament_id INTO v_spin_unwind_id;
  ELSIF EXISTS (
    SELECT 1 FROM public.spin_reserve_ledger r
     WHERE r.tournament_id=p_tournament_id
       AND r.kind IN ('jackpot_draw','draw_reversal','contribution_reversal')) THEN
    RAISE EXCEPTION 'Spin % has reserve evidence without its contribution',p_tournament_id
      USING ERRCODE='P0404';
  END IF;

  -- Reverse fee attribution before the exact refund payer. Ordinary entry
  -- entitlements retain their fee rail. Reverse each current player's net fee and
  -- each aggregate Spin source exactly once, retaining immutable source ids.
  IF EXISTS (SELECT 1 FROM public.rake_records r
              WHERE r.tournament_id=p_tournament_id
                AND r.source='atomic_cancel_tournament') THEN
    RAISE EXCEPTION 'unreceipted cancellation rake evidence already exists'
      USING ERRCODE='P0404';
  END IF;
  SELECT round(COALESCE(sum(r.rake_amount),0),2)
    INTO v_total_rake_before FROM public.rake_records r
   WHERE r.tournament_id=p_tournament_id AND r.is_tournament;
  IF v_total_rake_before<0
     OR v_total_rake_before::text IN ('NaN','Infinity','-Infinity')
     OR (round(COALESCE(v_t.total_rake,0),2) IS DISTINCT FROM v_total_rake_before
         AND NOT (v_undrawn_spin AND v_t.total_rake=0
                  AND v_total_rake_before=v_e.fee_balance)) THEN
    RAISE EXCEPTION 'tournament % rake cache and evidence disagree',p_tournament_id
      USING ERRCODE='P0404';
  END IF;

  FOR v_fee IN
    SELECT tp.user_id,r.club_id,
           round(sum(r.rake_amount),2) AS amount,
           jsonb_agg(r.id ORDER BY r.id) AS source_ids
      FROM (SELECT DISTINCT p.user_id FROM public.tournament_players p
             WHERE p.tournament_id=p_tournament_id AND p.user_id IS NOT NULL) tp
      JOIN public.rake_records r
        ON r.tournament_id=p_tournament_id AND r.is_tournament
       AND r.metadata->>'user_id'=tp.user_id::text
     GROUP BY tp.user_id,r.club_id HAVING round(sum(r.rake_amount),2)>0
     ORDER BY tp.user_id,r.club_id
  LOOP
    INSERT INTO public.rake_records(
      hand_id,table_id,club_id,rake_amount,pot_size,num_players,
      bbj_contribution,is_tournament,tournament_id,source,metadata)
    VALUES(NULL,NULL,v_fee.club_id,-v_fee.amount,v_fee.amount,1,0,true,
      p_tournament_id,'atomic_cancel_tournament',jsonb_build_object(
        'kind','tournament_fee_refund','user_id',v_fee.user_id,
        'original_rake_record_ids',v_fee.source_ids))
    RETURNING id INTO v_fee_reversal_id;
    v_fee_reversal_ids:=array_append(v_fee_reversal_ids,v_fee_reversal_id);
    v_fees_reversed:=round(v_fees_reversed+v_fee.amount,2);
  END LOOP;
  FOR v_fee IN
    SELECT r.*,round(r.rake_amount+COALESCE((SELECT sum(rr.rake_amount)
      FROM public.rake_records rr WHERE rr.tournament_id=p_tournament_id
       AND rr.source='atomic_cancel_tournament'
       AND rr.metadata->>'original_rake_record_id'=r.id::text),0),2) AS amount
      FROM public.rake_records r
     WHERE r.tournament_id=p_tournament_id AND r.is_tournament
       AND r.source IN ('fn_spin_book_entry','fn_spin_settle_game')
       AND r.rake_amount>0 AND NULLIF(r.metadata->>'user_id','') IS NULL
     ORDER BY r.id FOR UPDATE
  LOOP
    IF v_fee.amount>0 THEN
      INSERT INTO public.rake_records(
        hand_id,table_id,club_id,rake_amount,pot_size,num_players,
        bbj_contribution,is_tournament,tournament_id,source,
        player_contributions,metadata)
      VALUES(NULL,NULL,v_fee.club_id,-v_fee.amount,v_fee.pot_size,
        v_fee.num_players,0,true,p_tournament_id,'atomic_cancel_tournament',
        v_fee.player_contributions,jsonb_build_object(
          'kind','spin_rake_refund','original_source',v_fee.source,
          'original_rake_record_id',v_fee.id))
      RETURNING id INTO v_fee_reversal_id;
      v_fee_reversal_ids:=array_append(v_fee_reversal_ids,v_fee_reversal_id);
      v_fees_reversed:=round(v_fees_reversed+v_fee.amount,2);
    END IF;
  END LOOP;
  SELECT round(COALESCE(sum(r.rake_amount),0),2)
    INTO v_total_rake_after FROM public.rake_records r
   WHERE r.tournament_id=p_tournament_id AND r.is_tournament;
  IF v_total_rake_after IS DISTINCT FROM 0::numeric
     OR v_fees_reversed IS DISTINCT FROM v_total_rake_before THEN
    RAISE EXCEPTION 'tournament % fee reversal did not close exactly',p_tournament_id
      USING ERRCODE='P0404';
  END IF;

  IF v_undrawn_spin THEN
    -- The reserve reversal and negative fee records above are now proved.
    -- Return those exact booked components to the original gross entry rail;
    -- never rewrite an entitlement or fund a refund from another event.
    IF v_spin_unwind_id IS DISTINCT FROM p_tournament_id
       OR v_contribution.amount IS DISTINCT FROM v_e.reserve_out
       OR v_fees_reversed IS DISTINCT FROM v_e.fee_balance THEN
      RAISE EXCEPTION 'undrawn Spin cancellation unwind is not exact'
        USING ERRCODE='P0404';
    END IF;
    PERFORM public.fn_ca_escrow_apply(p_tournament_id,
      'undrawn Spin exact contribution and fee reversal',
      p_reserve_out=>-v_contribution.amount,
      p_fee_entries_in=>-v_fees_reversed);
  END IF;


  -- Return each unconsumed funded entitlement as cash to its recorded club.
  -- The exact refund payer proves wallet, satellite transfer or redeemed-ticket
  -- funding and excludes value already returned as a ticket. Stored historical
  -- cancellation receipts continue to replay through their original evidence.
  IF EXISTS (
    SELECT 1 FROM public.tournament_refund_entitlements e
    JOIN public.tournament_players tp ON tp.id=e.registration_id
    JOIN public.tournament_tickets tk
      ON tk.source_refund_entitlement_id=e.id
   WHERE e.tournament_id=p_tournament_id
     AND tp.tournament_id=p_tournament_id) THEN
    RAISE EXCEPTION 'active qualifier roster already has an unreceipted return ticket'
      USING ERRCODE='P0404';
  END IF;
  /* A DISPOSED ENTITLEMENT DOES NOT BLOCK A CANCELLATION (2026-10-05).

     This guard exists to catch an entitlement the refund loop below would
     MISS: one still owed money with no roster row to pay it through. It
     used to demand a live tournament_players row for EVERY entitlement,
     which is strictly stronger than the loop's own rule. The loop selects
     an entitlement only when it has no tournament_refund_tranches row and
     no tournament_tickets return - this function's own definition of
     "already disposed" - so an entitlement holding either of those is
     settled evidence the loop would never pay a second time, and demanding
     a roster row for it refused a cancellation that was in fact complete.

     The roster row is exactly what goes missing: fn_ca_unregister_tournament
     _player_exact DELETEs tournament_players when it refunds a registration,
     while tournament_refund_entitlements is append-only and carries no
     disposed marker, so the two can never be reconciled by repair - only by
     reading the tranche, which is what the loop already does.

     Measured on Deep Stack Society, 2026-10-05: 561 entitlements across 29
     events, every one paid in full through that authority (sum paid 5506.00
     = sum entitled 5506.00; none partial, none untranched) with every roster
     row deleted. Those 29 events could therefore never reach CANCELLED, and
     the club could never be retired at all, because fn_retire_settled_club
     refuses while any tournament is still active.

     The two arms now agree by construction: an entitlement trips this guard
     only if the loop would have wanted to pay it. An untranched, unticketed
     entitlement with no roster row still raises - the case this was written
     for. The ticket arm is unexercised by the measurement above (no return
     tickets exist for those events) and stays guarded on the dangerous side
     by the unreceipted-return-ticket check immediately preceding, which
     still refuses a ticketed entitlement whose qualifier is on the roster. */
  IF EXISTS (
    SELECT 1 FROM public.tournament_refund_entitlements e
    LEFT JOIN public.tournament_players tp
      ON tp.tournament_id=e.tournament_id AND tp.user_id=e.user_id
   WHERE e.tournament_id=p_tournament_id
     AND NOT EXISTS (
       SELECT 1 FROM public.tournament_refund_tranches tr
        WHERE tr.entitlement_id=e.id)
     AND NOT EXISTS (
       SELECT 1 FROM public.tournament_tickets tk
        WHERE tk.source_refund_entitlement_id=e.id)
     AND (tp.id IS NULL OR (e.entitlement_kind IN (
            'satellite_seat','tournament_ticket')
          AND e.registration_id IS DISTINCT FROM tp.id))) THEN
    RAISE EXCEPTION 'refund entitlement is detached from the frozen roster'
      USING ERRCODE='P0404';
  END IF;
  FOR v_player IN
    SELECT DISTINCT ON (tp.user_id) tp.id,tp.user_id
      FROM public.tournament_players tp
     WHERE tp.tournament_id=p_tournament_id AND tp.user_id IS NOT NULL
     ORDER BY tp.user_id,tp.id
  LOOP
    -- The owner-only plan validates every source ledger, wallet debit and
    -- escrow rail. Identity comes from the locked entitlement table below.
    PERFORM 1 FROM public.fn_ca_tournament_refund_plan(
      p_tournament_id,v_player.user_id);
    LOOP
      SELECT e.* INTO v_entitlement
        FROM public.tournament_refund_entitlements e
       WHERE e.tournament_id=p_tournament_id
         AND e.user_id=v_player.user_id
         AND NOT EXISTS (
           SELECT 1 FROM public.tournament_refund_tranches tr
            WHERE tr.entitlement_id=e.id)
         AND NOT EXISTS (
           SELECT 1 FROM public.tournament_tickets tk
            WHERE tk.source_refund_entitlement_id=e.id)
       ORDER BY e.entitlement_kind,e.id
       LIMIT 1 FOR UPDATE OF e;
      EXIT WHEN NOT FOUND;
      v_registration_id:=COALESCE(v_entitlement.registration_id,v_player.id);
      IF v_entitlement.entitlement_kind IN (
          'wallet_charge','satellite_seat','tournament_ticket') THEN
        SELECT COALESCE(o.amount_paid,0)+v_entitlement.gross
          INTO v_total_owed FROM public.tournament_obligations o
         WHERE o.tournament_id=p_tournament_id AND o.kind='refund'
           AND o.place IS NULL AND o.user_id=v_player.user_id FOR UPDATE;
        IF NOT FOUND THEN v_total_owed:=v_entitlement.gross; END IF;
        v_settle:=public.fn_settle_tournament_refund_exact(
          p_tournament_id,v_player.user_id,
          v_entitlement.refund_wallet_club_id,v_total_owed,
          v_entitlement.refund_prize,v_entitlement.refund_bounty,
          v_entitlement.refund_fee,'atomic_cancel_tournament',
          'Tournament cancellation refund: '||COALESCE(v_t.name,'Unknown'));
        IF COALESCE((v_settle->>'ok')::boolean,false) IS NOT TRUE
           OR COALESCE((v_settle->>'fully_settled')::boolean,false) IS NOT TRUE
           OR COALESCE((v_settle->>'remaining')::numeric,-1)<>0
           OR (v_settle->>'entitlement_id')::uuid
                IS DISTINCT FROM v_entitlement.id
           OR v_settle->>'entitlement_kind' IS DISTINCT FROM v_entitlement.entitlement_kind
           OR (v_settle->>'paid')::numeric IS DISTINCT FROM v_entitlement.gross
           OR (v_settle->>'refund_prize')::numeric
                IS DISTINCT FROM v_entitlement.refund_prize
           OR (v_settle->>'refund_bounty')::numeric
                IS DISTINCT FROM v_entitlement.refund_bounty
           OR (v_settle->>'refund_fee')::numeric
                IS DISTINCT FROM v_entitlement.refund_fee THEN
          RAISE EXCEPTION 'exact cancellation refund refused entitlement %: %',
            v_entitlement.id,v_settle USING ERRCODE='55000';
        END IF;
        v_refunds:=v_refunds||jsonb_build_array(jsonb_build_object(
          'registration_id',v_registration_id,
          'user_id',v_player.user_id,
          'entitlement_id',v_entitlement.id,
          'entitlement_kind',v_entitlement.entitlement_kind,
          'source_wallet_club_id',v_entitlement.refund_wallet_club_id,
          'gross_paid',v_entitlement.gross,
          'amount_paid_before',(v_settle->>'already_paid')::numeric,
          'amount_paid_now',(v_settle->>'paid')::numeric,
          'refund_prize',(v_settle->>'refund_prize')::numeric,
          'refund_bounty',(v_settle->>'refund_bounty')::numeric,
          'refund_fee',(v_settle->>'refund_fee')::numeric,
          'obligation_id',(v_settle->>'obligation_id')::uuid,
          'idempotency_key',v_settle->>'idempotency_key',
          'credit_ledger_id',(v_settle->>'credit_ledger_id')::uuid,
          'wallet_transaction_id',(v_settle->>'wallet_transaction_id')::uuid));
        v_refund_line_count:=v_refund_line_count+1;
        v_total_refunded:=round(
          v_total_refunded+(v_settle->>'paid')::numeric,2);
      ELSE
        RAISE EXCEPTION 'unknown cancellation entitlement kind %',
          v_entitlement.entitlement_kind USING ERRCODE='P0404';
      END IF;
      IF NOT v_registration_id=ANY(v_refunded_registration_ids) THEN
        v_refunded_registration_ids:=array_append(
          v_refunded_registration_ids,v_registration_id);
      END IF;
    END LOOP;
  END LOOP;
  SELECT COALESCE(array_agg(id ORDER BY id),ARRAY[]::uuid[])
    INTO v_refunded_registration_ids
    FROM unnest(v_refunded_registration_ids) ids(id);
  SELECT COALESCE(array_agg(id ORDER BY id),ARRAY[]::uuid[])
    INTO v_zero_refund_registration_ids
    FROM unnest(v_source_player_ids) ids(id)
   WHERE NOT id=ANY(v_refunded_registration_ids);
  v_refunded_count:=cardinality(v_refunded_registration_ids);
  v_zero_refund_count:=cardinality(v_zero_refund_registration_ids);

  IF EXISTS (
    SELECT 1 FROM public.tournament_players tp
     WHERE tp.tournament_id=p_tournament_id AND tp.user_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.fn_ca_tournament_refund_plan(
                    p_tournament_id,tp.user_id))) THEN
    RAISE EXCEPTION 'cancellation left a refundable entitlement unpaid'
      USING ERRCODE='55000';
  END IF;


  SELECT * INTO v_e FROM public.tournament_escrow e
   WHERE e.tournament_id=p_tournament_id FOR UPDATE;
  IF v_e.tournament_id IS NULL OR v_e.enforced IS DISTINCT FROM true
     OR v_e.prize_balance IS DISTINCT FROM 0::numeric
     OR v_e.bounty_balance IS DISTINCT FROM 0::numeric
     OR v_e.fee_balance IS DISTINCT FROM 0::numeric THEN
    RAISE EXCEPTION 'tournament % cancellation did not close all escrow banks',
      p_tournament_id USING ERRCODE='P0404';
  END IF;
  UPDATE public.tournament_escrow
     SET closed_at=v_cancelled_at,close_note=v_close_note,updated_at=now()
   WHERE tournament_id=p_tournament_id AND closed_at IS NULL
     AND prize_balance=0 AND bounty_balance=0 AND fee_balance=0;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN
    RAISE EXCEPTION 'tournament % lost its exact-zero escrow close',p_tournament_id
      USING ERRCODE='55000';
  END IF;

  UPDATE public.tournament_players
     SET status='eliminated',eliminated_at=v_cancelled_at,
         chips=0,current_bounty=0
   WHERE tournament_id=p_tournament_id;
  WITH released AS (
    UPDATE public.table_seats s
       SET left_at=v_cancelled_at,status='left',leave_pending=false,
           is_sitting_out=false,is_away=false,sit_out_at=NULL,
           scheduled_leave_hands=NULL
      FROM public.tables tb
     WHERE tb.id=s.table_id AND tb.tournament_id=p_tournament_id
       AND s.left_at IS NULL RETURNING s.id)
  SELECT COALESCE(array_agg(id ORDER BY id),ARRAY[]::uuid[])
    INTO v_released_seat_ids FROM released;
  v_released_seat_count:=cardinality(v_released_seat_ids);
  UPDATE public.table_seats s
     SET status='left',leave_pending=false,is_sitting_out=false,is_away=false,
         sit_out_at=NULL,scheduled_leave_hands=NULL
   WHERE s.id=ANY(v_source_seat_ids) AND s.left_at IS NOT NULL;

  UPDATE public.tournaments
     SET status='CANCELLED',ended_at=v_cancelled_at,updated_at=now(),
         prize_pool=0,bounty_pool=0,total_rake=0,current_players=0,
         on_break=false,break_started_at=NULL,break_ends_at=NULL
   WHERE id=p_tournament_id
     AND upper(COALESCE(status::text,'')) NOT IN
         ('COMPLETED','CANCELLED','CANCELED','COMPLETING');
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN
    RAISE EXCEPTION 'tournament % lost its cancellation lifecycle claim',
      p_tournament_id USING ERRCODE='55000';
  END IF;
  UPDATE public.tables
     SET status='closed',lifecycle='closed',current_players=0,
         terminal_closed_at=v_cancelled_at,updated_at=now()
   WHERE tournament_id=p_tournament_id;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>v_closed_table_count THEN
    RAISE EXCEPTION 'tournament % did not close every table',p_tournament_id
      USING ERRCODE='55000';
  END IF;

  SELECT COALESCE(array_agg(id ORDER BY id),ARRAY[]::uuid[])
    INTO v_fee_reversal_ids FROM unnest(v_fee_reversal_ids) ids(id);
  SELECT COALESCE(array_agg(id ORDER BY id),ARRAY[]::uuid[])
    INTO v_ticket_return_ids FROM unnest(v_ticket_return_ids) ids(id);
  v_receipt:=jsonb_build_object(
    'ok',true,'success',true,'fully_settled',true,'receipt_version',2,
    'tournament_id',p_tournament_id,'actor_id',v_actor,'status','CANCELLED',
    'source_player_count',v_source_player_count,
    'refunded_count',v_refunded_count,'refund_line_count',v_refund_line_count,
    'ticket_return_count',v_ticket_return_count,
    'total_ticket_returned',v_total_ticket_returned,
    'total_refunded',v_total_refunded,'fees_reversed',v_fees_reversed,
    'closed_table_count',v_closed_table_count,
    'source_seat_count',v_source_seat_count,
    'released_seat_count',v_released_seat_count,
    'refunds',v_refunds,'ticket_returns',v_ticket_returns,
    'settled_at',v_cancelled_at);
  INSERT INTO public.tournament_cancellation_receipts(
    tournament_id,actor_id,receipt_version,
    source_player_count,source_player_ids,
    refunded_count,refunded_registration_ids,refund_line_count,
    ticket_return_count,ticket_return_ids,total_ticket_returned,
    zero_refund_count,zero_refund_registration_ids,
    total_refunded,fees_reversed,total_rake_before,total_rake_after,
    closed_table_count,closed_table_ids,source_seat_count,source_seat_ids,
    released_seat_count,released_seat_ids,fee_reversal_ids,
    escrow_closed_at,escrow_close_note,spin_unwind_tournament_id,
    receipt,settled_at)
  VALUES(
    p_tournament_id,v_actor,2,
    v_source_player_count,v_source_player_ids,
    v_refunded_count,v_refunded_registration_ids,v_refund_line_count,
    v_ticket_return_count,v_ticket_return_ids,v_total_ticket_returned,
    v_zero_refund_count,v_zero_refund_registration_ids,
    v_total_refunded,v_fees_reversed,v_total_rake_before,v_total_rake_after,
    v_closed_table_count,v_closed_table_ids,v_source_seat_count,v_source_seat_ids,
    v_released_seat_count,v_released_seat_ids,v_fee_reversal_ids,
    v_cancelled_at,v_close_note,v_spin_unwind_id,v_receipt,v_cancelled_at);

  PERFORM public.fn_record_accounting_tournament_cancellation(p_tournament_id);
  RETURN public.fn_ca_tournament_cancellation_receipt(p_tournament_id,v_actor);
END;
$function$;
REVOKE ALL ON FUNCTION public.atomic_cancel_tournament(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.atomic_cancel_tournament(uuid,uuid) TO service_role;

-- The 6-arg overload was dropped by 20260828021009; the replay resurrected it with
-- EXECUTE for PUBLIC/anon. The only rebuy path is the 7-arg (client_token) authority.
DROP FUNCTION IF EXISTS public.process_tournament_rebuy(uuid, uuid, text, numeric, numeric, integer);

DO $assert$
DECLARE r record; v text;
BEGIN
 FOR r IN SELECT * FROM (VALUES
  ('public.fn_settle_tournament_rake(uuid,text)','30dc972220452d046ac4847dc8f34edc'),
  ('public.fn_sweep_unsettled_tournament_rake(integer,integer)','0b099303c20d0fdeb9e26821f12aa763'),
  ('public.fn_unregister_from_tournament(uuid)','cc93302253f3cc5b23265665f8cf86e3'),
  ('public.atomic_cancel_tournament(uuid,uuid)','c7172f9d760fc00219cb2186f19f93ed')) x(sig,good) LOOP
  SELECT md5(p.prosrc) INTO v FROM pg_proc p WHERE p.oid=to_regprocedure(r.sig);
  IF v IS DISTINCT FROM r.good THEN RAISE EXCEPTION 'ASSERT FAILED: % body % <> %', r.sig, v, r.good; END IF;
 END LOOP;
 IF to_regprocedure('public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer)') IS NOT NULL THEN
  RAISE EXCEPTION 'ASSERT FAILED: legacy 6-arg process_tournament_rebuy still exists'; END IF;
 IF has_function_privilege('authenticated','public.atomic_cancel_tournament(uuid,uuid)','EXECUTE')
  OR has_function_privilege('anon','public.fn_settle_tournament_rake(uuid,text)','EXECUTE')
  OR has_function_privilege('authenticated','public.fn_settle_tournament_rake(uuid,text)','EXECUTE')
  OR has_function_privilege('anon','public.fn_unregister_from_tournament(uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'ASSERT FAILED: restored ACLs are not service-only where required'; END IF;
END $assert$;
COMMIT;
