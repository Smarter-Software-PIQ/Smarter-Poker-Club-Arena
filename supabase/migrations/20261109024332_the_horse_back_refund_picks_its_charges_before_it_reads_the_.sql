-- 20261109024332_the_horse_back_refund_picks_its_charges_before_it_reads_the_
--
-- Version reserved by scripts/new-migration.mjs on 2026-11-09 02:43:32 UTC.
--
-- @live-proof: (SELECT md5(prosrc) = '4bfe759d259f9f6e523ab6f7c02c1a9b' FROM pg_proc WHERE oid = 'smarter_private.horse_refund_parity_back_refund(integer)'::regprocedure)
--
-- THE HORSE BACK-REFUND PICKS ITS CHARGES BEFORE IT READS THE EVENTS
--
-- Dan, 2026-11-08 (owner hard rule): horses are refunded exactly as humans;
-- "RUN THE HORSE BACK-REFUND, ALL 17,931 CHIPS FROM MIDWAY MAIN BANK".
-- 20261108215333 installed smarter_private.horse_refund_parity_back_refund.
-- It paid 1,740 of the 2,220 pinned charges (13,862.00 of 17,931.00), then
-- every paid call, even p_limit 1, died at its own 2 s bound (57014).
--
-- MEASURED ON PRODUCTION, 2026-11-09 02:35-02:45 UTC (read only; every probe
-- ran in a transaction that was rolled back):
--   The loop query `zz_parity_owed o JOIN public.tournaments t ... ORDER BY
--   o.tournament_id, o.user_id, o.id LIMIT p_limit` runs as a Merge Join that
--   walks tournaments_pkey from the start (385,651 rows, 381,528 buffers,
--   1,025 ms) before it reaches the first remaining event. The temp table is
--   never analysed, so the planner guesses 1,254 rows and picks the merge.
--   The money cascade then adds 0.4 to 1.0 s per call (the chip_ledger writer
--   and its accounting-document triggers, and for a departed horse membership
--   the club-split forward to the club bank). Together they pass 2 s.
--   The same function with only this query changed, p_limit 10, in a
--   rolled-back transaction under statement_timeout 2s: 385 to 975 ms
--   (the 975 ms run took ten departed horse memberships, the costliest case).
--
-- WHAT THIS CHANGES: one line. The loop takes its p_limit charges from the
-- 480-row temp table first, in the same order, then joins those to
-- tournaments by primary key. The same charges are chosen in the same order
-- (every pinned event has its tournaments row), so no accounting outcome
-- changes. Everything else is byte-identical to 20261108215333: the 2 s
-- bank-hold bound, the 200 ms lock_timeout, the :08-:52 window and freeze
-- guards, the pinned-set digest, idempotency key, 10.9 adjustment, receipts,
-- the exact-wallet credit and the club-split forwarding trigger. Preimage
-- (prosrc md5 91ed87bf3768bd6d95dad0e2d2184dc9) and postimage
-- (4bfe759d259f9f6e523ab6f7c02c1a9b) are asserted. Moves no money at install.
--
-- REVERSIBLE: re-create the function from 20261108215333.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';

DO $pre$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='smarter_private.horse_refund_parity_back_refund(integer)'::regprocedure)
    IS DISTINCT FROM '91ed87bf3768bd6d95dad0e2d2184dc9' THEN
  RAISE EXCEPTION 'horse_refund_parity_back_refund_preimage_changed';
 END IF;
END $pre$;

CREATE OR REPLACE FUNCTION smarter_private.horse_refund_parity_back_refund(p_limit integer)
 RETURNS jsonb LANGUAGE plpgsql
 SET search_path = pg_catalog, public, smarter_private AS $fn$
DECLARE
 c_mig    constant text := '20261108215333_horses_are_refunded_exactly_as_humans';
 c_union  constant uuid := 'fade0000-0000-0000-0000-000000000001';
 c_events constant integer := 114;
 c_base_n constant integer := 2224;
 c_base_total constant numeric := 17939.00;
 c_base_digest constant text := 'de84d6b2fbf6d6e6b34eb53c3bf74816';
 c_owed_n constant integer := 2220;
 c_owed_total constant numeric := 17931.00;
 r record; v_n integer; v_total numeric; v_digest text; v_minute integer;
 v_key text; v_adj uuid; v_leg uuid; v_tx uuid; v_reason text; v_desc text;
 v_already numeric; v_debits numeric; v_amount numeric;
 v_bank_before numeric; v_bank_after numeric; v_before numeric; v_after numeric;
 v_paid numeric := 0; v_count integer := 0; v_report jsonb := '[]'::jsonb;
BEGIN
 IF current_user IS DISTINCT FROM 'postgres' OR auth.role() IS NOT NULL THEN
  RAISE EXCEPTION 'horse_refund_parity_operator_session_required' USING ERRCODE = '42501';
 END IF;
 IF p_limit IS NULL OR p_limit < 0 OR p_limit > 10 THEN
  RAISE EXCEPTION 'horse_refund_parity_limit_is_0_to_10 (0 previews and writes nothing)';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended(c_mig, 0)) THEN
  RAISE EXCEPTION 'horse_refund_parity_already_running' USING ERRCODE = '55P03';
 END IF;

 -- THE PINNED SET. The 114 chip events the Nov 2 owner retirement closed, and
 -- every paid wallet charge in them. Entitlements are immutable rows, so the
 -- digest read on 2026-11-08 must still match exactly or nothing moves.
 CREATE TEMP TABLE IF NOT EXISTS zz_parity_scope(tournament_id uuid PRIMARY KEY) ON COMMIT DROP;
 TRUNCATE zz_parity_scope;
 INSERT INTO zz_parity_scope
 SELECT i.tournament_id FROM smarter_private.owner_tournament_deletion_intents i
  WHERE i.asset = 'chips' AND (
   EXISTS (SELECT 1 FROM smarter_private.owner_retirement_pool_transfers x WHERE x.tournament_id = i.tournament_id)
   OR EXISTS (SELECT 1 FROM smarter_private.owner_retirement_manual_refunds m WHERE m.tournament_id = i.tournament_id)
   OR EXISTS (SELECT 1 FROM smarter_private.owner_retirement_bank_refunds b WHERE b.tournament_id = i.tournament_id));
 SELECT count(*) INTO v_n FROM zz_parity_scope;
 IF v_n <> c_events THEN RAISE EXCEPTION 'horse_refund_parity_scope_changed: % events', v_n; END IF;
 SELECT count(*), sum(e.gross),
        md5(string_agg(e.id::text||':'||e.tournament_id||':'||e.user_id||':'||e.refund_wallet_club_id||':'||e.gross, ',' ORDER BY e.id))
   INTO v_n, v_total, v_digest
   FROM public.tournament_refund_entitlements e JOIN zz_parity_scope s USING (tournament_id)
  WHERE e.entitlement_kind = 'wallet_charge';
 IF v_n <> c_base_n OR v_total <> c_base_total OR v_digest IS DISTINCT FROM c_base_digest THEN
  RAISE EXCEPTION 'horse_refund_parity_entitlements_changed: % / % / %', v_n, v_total, v_digest;
 END IF;

 CREATE TEMP TABLE IF NOT EXISTS zz_parity_owed ON COMMIT DROP AS
  SELECT e.* FROM public.tournament_refund_entitlements e WITH NO DATA;
 TRUNCATE zz_parity_owed;
 INSERT INTO zz_parity_owed
 SELECT e.* FROM public.tournament_refund_entitlements e JOIN zz_parity_scope s USING (tournament_id)
  WHERE e.entitlement_kind = 'wallet_charge'
    AND NOT EXISTS (SELECT 1 FROM public.tournament_refund_tranches x WHERE x.entitlement_id = e.id)
    AND NOT EXISTS (SELECT 1 FROM smarter_private.owner_retirement_manual_refunds x WHERE x.entitlement_id = e.id)
    AND NOT EXISTS (SELECT 1 FROM smarter_private.owner_retirement_bank_refunds x WHERE x.entitlement_id = e.id)
    AND NOT EXISTS (SELECT 1 FROM public.tournament_tickets x WHERE x.source_refund_entitlement_id = e.id);
 -- Owed before this operation = what is still open + what it has already paid.
 IF (SELECT count(*) FROM zz_parity_owed) <> c_owed_n
    OR (SELECT coalesce(sum(gross), 0) FROM zz_parity_owed) <> c_owed_total THEN
  RAISE EXCEPTION 'horse_refund_parity_owed_set_changed';
 END IF;
 DELETE FROM zz_parity_owed o USING smarter_private.horse_refund_parity_receipts p WHERE p.entitlement_id = o.id;

 IF p_limit = 0 THEN
  RETURN jsonb_build_object('mode', 'preview', 'events', c_events,
   'owed_charges', c_owed_n, 'owed_chips', c_owed_total,
   'already_refunded_charges', (SELECT count(*) FROM smarter_private.horse_refund_parity_receipts),
   'already_refunded_chips', (SELECT coalesce(sum(amount), 0) FROM smarter_private.horse_refund_parity_receipts),
   'remaining_charges', (SELECT count(*) FROM zz_parity_owed),
   'remaining_chips', (SELECT coalesce(sum(gross), 0) FROM zz_parity_owed),
   'midway_main_bank', (SELECT chip_balance FROM public.union_wallets WHERE union_id = c_union));
 END IF;

 -- Live play is never held for this: not inside the hourly break, not while
 -- frozen, and every statement bounded.
 v_minute := extract(minute FROM smarter_private.bulk_closure_clock() AT TIME ZONE 'UTC')::integer;
 IF v_minute >= 53 OR v_minute < 8 THEN RAISE EXCEPTION 'horse_refund_parity_break_window' USING ERRCODE = '55P03'; END IF;
 IF public.fn_platform_frozen() THEN RAISE EXCEPTION 'horse_refund_parity_platform_frozen' USING ERRCODE = '55P03'; END IF;
 IF coalesce(nullif(current_setting('statement_timeout'), '0'), '') = ''
    OR (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout') > 2000 THEN
  -- Midway Main Bank is locked until COMMIT; during play hold it 2 s at most.
  RAISE EXCEPTION 'horse_refund_parity_unbounded_caller: SET statement_timeout to 2s or less';
 END IF;
 PERFORM set_config('lock_timeout', '200ms', true);

 SELECT chip_balance INTO v_bank_before FROM public.union_wallets WHERE union_id = c_union FOR UPDATE;
 IF v_bank_before IS NULL THEN RAISE EXCEPTION 'horse_refund_parity_main_bank_missing'; END IF;

 FOR r IN SELECT o.*, t.name AS event_name, t.status AS event_status
            FROM (SELECT z.* FROM zz_parity_owed z ORDER BY z.tournament_id, z.user_id, z.id LIMIT p_limit) o
            JOIN public.tournaments t ON t.id = o.tournament_id
           ORDER BY o.tournament_id, o.user_id, o.id LIMIT p_limit LOOP
  -- The entry: the original player-wallet debit, exactly as charged. A
  -- promo-funded or otherwise sourced entry is not this door; refuse it.
  IF NOT EXISTS (SELECT 1 FROM public.chip_ledger l WHERE l.id = r.source_ledger_id
      AND l.from_type = 'player_wallet' AND l.from_entity_id = r.user_id
      AND l.club_id = r.refund_wallet_club_id AND l.to_type = 'prize_liability'
      AND l.to_entity_id = r.tournament_id AND l.amount = r.gross
      AND lower(l.category) = r.charge_category) THEN
   RAISE EXCEPTION 'horse_refund_parity_source_not_a_player_wallet_charge %', r.id;
  END IF;
  IF upper(r.event_status) NOT IN ('CANCELLED', 'COMPLETED') THEN
   RAISE EXCEPTION 'horse_refund_parity_event_not_terminal %', r.tournament_id;
  END IF;
  -- Subtract whatever was already returned on this player's charges in this
  -- event from this club wallet; never refund past what was paid.
  SELECT round(coalesce(sum(l.amount), 0), 2) INTO v_debits FROM public.chip_ledger l
   WHERE l.tournament_id = r.tournament_id AND l.club_id = r.refund_wallet_club_id
     AND l.from_type = 'player_wallet' AND l.from_entity_id = r.user_id
     AND l.to_type = 'prize_liability' AND l.category IN ('tournament_buyin', 'rebuy', 'addon');
  SELECT round(coalesce(sum(l.amount), 0), 2) INTO v_already FROM public.chip_ledger l
   WHERE l.tournament_id = r.tournament_id AND l.club_id = r.refund_wallet_club_id
     AND l.to_type = 'player_wallet' AND l.to_entity_id = r.user_id
     AND l.category IN ('refund', 'tournament_refund');
  v_already := v_already + coalesce((SELECT sum(p.amount) FROM smarter_private.horse_refund_parity_receipts p
     WHERE p.tournament_id = r.tournament_id AND p.user_id = r.user_id AND p.club_id = r.refund_wallet_club_id), 0);
  v_amount := least(r.gross, round(v_debits - v_already, 2));
  IF v_amount IS DISTINCT FROM r.gross THEN
   RAISE EXCEPTION 'horse_refund_parity_partial_prior_refund % (charged %, capacity %)', r.id, r.gross, v_debits - v_already;
  END IF;

  v_key := 'horse-refund-parity-20261108:' || r.id::text;
  v_desc := 'Tournament Refund: ' || coalesce(r.event_name, 'Tournament') || ' #' || left(r.id::text, 8);
  v_reason := format(
   'Owner hard rule, Dan, 2026-11-08: horses are refunded exactly as humans, 100%% of the time. '
   || 'Player %s paid %s chips (%s, entitlement %s, original charge %s) from its club wallet %s into %s (%s), '
   || 'which the 2026-11-02 owner retirement closed on 2026-11-05. That retirement refunded the reviewed human charges '
   || 'and moved the rest of the event custody, this paid entry included, to Midway Main Bank. '
   || 'This returns the actual eligible entry, less anything already refunded (none), to the exact wallet charged, '
   || 'funded by Midway Main Bank, once (key %s). Migration %s.',
   r.user_id, r.gross, r.charge_category, r.id, r.source_ledger_id, r.refund_wallet_club_id,
   coalesce(r.event_name, 'the event'), r.tournament_id, v_key, c_mig);
  v_adj := public.fn_ca_adjustment_under_10_9(r.tournament_id, r.user_id, v_amount, v_reason, c_mig,
            'Claude Opus 5.5 under CLAUDE.md 10.9: refund parity, owner ruling 2026-11-08');

  INSERT INTO public.wallet_credit_idempotency(key, user_id, amount) VALUES (v_key, r.user_id, v_amount);

  SELECT chip_balance INTO v_before FROM public.club_members
   WHERE user_id = r.user_id AND club_id = r.refund_wallet_club_id FOR NO KEY UPDATE;
  IF v_before IS NULL THEN RAISE EXCEPTION 'horse_refund_parity_charged_wallet_missing %', r.id; END IF;

  PERFORM public.fn_ca_declare_ledger('settlement', 'union_bank', c_union, NULL, v_key, ARRAY['union_wallets']);
  PERFORM set_config('app.ledger_correlation', v_adj::text, true);
  UPDATE public.union_wallets SET chip_balance = chip_balance - v_amount, updated_at = now()
   WHERE union_id = c_union AND chip_balance >= v_amount;
  IF NOT FOUND THEN RAISE EXCEPTION 'horse_refund_parity_main_bank_cannot_cover %', v_amount; END IF;
  UPDATE public.club_members SET chip_balance = coalesce(chip_balance, 0) + v_amount, updated_at = now()
   WHERE user_id = r.user_id AND club_id = r.refund_wallet_club_id
  RETURNING chip_balance INTO v_after;
  PERFORM set_config('app.ledger_autoskip_union_wallets', '', true);
  PERFORM set_config('app.ledger_counterparty', '', true);
  PERFORM set_config('app.ledger_counterparty_entity', '', true);
  PERFORM set_config('app.ledger_category', '', true);
  PERFORM set_config('app.ledger_idempotency_key', '', true);
  PERFORM set_config('app.ledger_correlation', '', true);
  IF v_after IS DISTINCT FROM round(v_before + v_amount, 2) THEN
   RAISE EXCEPTION 'horse_refund_parity_wallet_moved % (% -> %)', r.id, v_before, v_after;
  END IF;
  SELECT l.id INTO STRICT v_leg FROM public.chip_ledger l
   WHERE l.idempotency_key = v_key AND l.amount = v_amount
     AND l.from_type = 'union_bank' AND l.from_entity_id = c_union
     AND l.to_type = 'player_wallet' AND l.to_entity_id = r.user_id
     AND l.club_id = r.refund_wallet_club_id AND l.category = 'settlement';

  PERFORM public.log_wallet_transaction(r.user_id, 'PLAYER', v_amount, 'credit', 'settlement', v_desc, NULL, NULL, NULL);
  SELECT w.id INTO STRICT v_tx FROM public.wallet_transactions w
   WHERE w.user_id = r.user_id AND w.created_at = now() AND w.amount = v_amount
     AND w.type = 'credit' AND w.category = 'settlement' AND w.description = v_desc
     AND w.related_entity_id IS NULL;

  UPDATE public.ca_manual_adjustments SET status = 'settled' WHERE id = v_adj AND status = 'approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'horse_refund_parity_adjustment_did_not_settle %', v_adj; END IF;

  INSERT INTO smarter_private.horse_refund_parity_receipts(entitlement_id, tournament_id, user_id, club_id, amount,
    idempotency_key, adjustment_id, ledger_id, wallet_transaction_id, receipt)
  VALUES (r.id, r.tournament_id, r.user_id, r.refund_wallet_club_id, v_amount, v_key, v_adj, v_leg, v_tx,
    jsonb_build_object('migration', c_mig, 'ruling', 'Dan 2026-11-08: horses are refunded exactly as humans',
     'event', r.tournament_id, 'event_name', r.event_name, 'charge_category', r.charge_category,
     'original_charge_ledger_id', r.source_ledger_id, 'already_refunded', 0, 'refunded', v_amount,
     'wallet_before', v_before, 'wallet_after', v_after, 'funded_by', 'midway_main_bank'));
  v_paid := round(v_paid + v_amount, 2);
  v_count := v_count + 1;
 END LOOP;

 SELECT chip_balance INTO v_bank_after FROM public.union_wallets WHERE union_id = c_union;
 IF round(v_bank_before - v_bank_after, 2) <> v_paid THEN
  RAISE EXCEPTION 'horse_refund_parity_bank_conservation % paid, bank moved %', v_paid, v_bank_before - v_bank_after;
 END IF;
 IF (SELECT coalesce(sum(amount), 0) FROM smarter_private.horse_refund_parity_receipts) > c_owed_total THEN
  RAISE EXCEPTION 'horse_refund_parity_overpaid';
 END IF;
 RETURN jsonb_build_object('mode', 'paid', 'refunded_charges', v_count, 'refunded_chips', v_paid,
  'bank_before', v_bank_before, 'bank_after', v_bank_after,
  'total_refunded_charges', (SELECT count(*) FROM smarter_private.horse_refund_parity_receipts),
  'total_refunded_chips', (SELECT coalesce(sum(amount), 0) FROM smarter_private.horse_refund_parity_receipts),
  'remaining_charges', c_owed_n - (SELECT count(*) FROM smarter_private.horse_refund_parity_receipts));
END $fn$;
REVOKE ALL ON FUNCTION smarter_private.horse_refund_parity_back_refund(integer) FROM PUBLIC, anon, authenticated, service_role;

DO $post$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='smarter_private.horse_refund_parity_back_refund(integer)'::regprocedure)
    IS DISTINCT FROM '4bfe759d259f9f6e523ab6f7c02c1a9b' THEN
  RAISE EXCEPTION 'horse_refund_parity_back_refund_postimage_wrong';
 END IF;
 IF clock_timestamp() - transaction_timestamp() > interval '8 seconds' THEN
  RAISE EXCEPTION 'horse_refund_parity_back_refund_install_budget';
 END IF;
END $post$;
COMMIT;
