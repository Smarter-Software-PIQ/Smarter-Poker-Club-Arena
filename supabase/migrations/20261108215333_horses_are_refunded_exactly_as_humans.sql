-- 20261108215333_horses_are_refunded_exactly_as_humans
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-08 21:53:33 UTC.
--
-- @live-proof: to_regclass('smarter_private.horse_refund_parity_receipts') IS NOT NULL AND to_regprocedure('smarter_private.horse_refund_parity_back_refund(integer)') IS NOT NULL AND (SELECT position('is_horse' in prosrc)=0 AND position('owner_retirement_unrefunded_entry' in prosrc)>0 FROM pg_proc WHERE oid='smarter_private.owner_retirement_transfer_pools(uuid,uuid)'::regprocedure)
--
-- OWNER HARD RULE, Dan, 2026-11-08: "HORSES GET REFUNDED 100% OF THE TIME ...
-- I DON'T KNOW WHO STARTED THIS, BUT HORSES GET REFUNDED EXACTLY THE SAME AS A
-- HUMAN 100% OF THE TIME!" It supersedes the 2026-11-05 note that said "no
-- refunds to horse entries or horse-only events" for closures; Dan says he
-- never ordered that. Every other refund rule stands and applies to a horse
-- identically: refund the actual eligible entry, subtract what was already
-- refunded, return a union-promo-funded entry to the union promo fund, keep
-- an auditable record, never pay twice. CLAUDE.md 10.5.
--
-- WHAT WAS WRONG, READ FROM PRODUCTION (2026-11-08 21:00-21:55 UTC, read only)
--
-- Every refund, cancel, abort, void, retire, unregister and closure function
-- in public and smarter_private was read for horse identity (is_horse,
-- is_bot, horse_status, the fleet register, the horse email domains). One
-- money path treats a horse differently:
--
--   smarter_private.owner_retirement_transfer_pools(uuid,uuid), the money
--   step of fn_ca_owner_retire_tournament (the Nov 2 owner retirement of the
--   140 frozen events). It required a refund ONLY for registrations where
--   `NOT coalesce(p.is_horse,false)` (six reviewed humans, four of whom had
--   paid), then moved the event's whole remaining custody - the horses' own
--   paid buy-ins, rebuys and add-ons - to Midway Main Bank (chips) or KingFish
--   (diamonds). A human's paid charge was refunded; a horse's identical
--   charge in the same event was swept to the house.
--
-- Measured result for chips (the shortfall this file makes payable):
--   114 events (113 retired through this function on 2026-11-05 02:14 to
--   23:12 UTC, plus Morning Free Buy d5decc98, where the two humans' 1-chip
--   add-ons were refunded by recorded owner credits and the 274 horse add-ons
--   and rebuys were not). 2,220 paid wallet charges, 1,827 horse entries,
--   856 horses, 17,931.00 chips (tournament_buyin 1,098, addon 997, rebuy
--   125). No human charge is outstanding in that set. The per-entry,
--   per-event and per-horse lists are in
--   docs/evidence/2026-11-08-horse-refund-parity/.
--   Diamonds: the 15 retired Diamond events hold no entitlement rows at all
--   (custody only); 0 humans played them; Diamond Arena is permanently
--   retired (20261105224533). Not settled here - see the changelog.
--
-- Nothing else differs. Since 2026-10-01: every other cancelled chip event
-- refunded horses in full (4,861 horse charges, 83,862.50, 0 short; humans 5
-- charges, 96.00, 0 short); the 41 cancelled Diamond events refunded horses
-- 418,200 of 418,200; started_operator_abort refunded 73 horse lines in full.
-- The four other functions that read horse identity near these words only
-- identify (a horse-only scope guard on a void that refunds every entrant, a
-- certification-identity check, and two restorations of retired patterned
-- horses' original hands); none skips, reduces or redirects a return.
--
-- WHAT THIS CHANGES
--
-- 1. owner_retirement_transfer_pools no longer reads horse identity. Its
--    human-only refusal is replaced with one rule for everybody: custody does
--    not move while ANY paid wallet charge of the event is unrefunded
--    (no tranche, no recorded owner credit, no bank refund, no ticket return,
--    no parity receipt). Byte-exact preimage asserted (prosrc md5
--    74617e15d176bb1d4428a084d8918af1); otherwise identical.
-- 2. smarter_private.horse_refund_parity_receipts: one immutable row per
--    refunded entitlement. Its primary key is the entitlement, so an entry is
--    refunded at most once.
-- 3. smarter_private.horse_refund_parity_back_refund(p_limit): the back-refund,
--    INSTALLED BUT NOT RUN by this migration. The coordinator runs it after
--    merge (scripts/operations/horse-refund-parity-20261108-back-refund.sql).
--    The events are terminal and their custody is sealed (the terminal escrow
--    trigger refuses fn_settle_tournament_refund_exact on them), so it uses
--    the audited house settlement door already used for the 2026-11-07
--    make-goods: a CLAUDE.md 10.9 adjustment citing Dan's ruling, a declared
--    union_bank journal leg, Midway Main Bank debited (the bank that received
--    the retired custody), the paid entry credited to the exact club wallet
--    that was charged, under key horse-refund-parity-20261108:<entitlement>.
--    It never reads horse identity: it refunds every unrefunded paid charge
--    in the pinned set. Per entitlement it re-proves the original player-wallet
--    debit and subtracts every refund already credited for that entry.
--    Union promo funding: none of the 2,220 charges is promo-funded (every
--    source ledger row is player_wallet); a different source refuses.
--    A credit landing on a horse membership the Nov 2 club split departed
--    (609 charges, 4,445.00) is then moved to that club's bank by the
--    existing zzzz_horse_split_late_credit_returns_to_bank trigger, Dan's
--    Nov 2/3 club-split order, exactly as any other late credit there.
--
-- REVERSIBLE: nothing moves at install. Restore the preimage of (1) to undo.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';

DO $pre$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='smarter_private.owner_retirement_transfer_pools(uuid,uuid)'::regprocedure)
    IS DISTINCT FROM '74617e15d176bb1d4428a084d8918af1' THEN
  RAISE EXCEPTION 'horse_refund_parity_transfer_pools_preimage_changed';
 END IF;
END $pre$;

CREATE TABLE smarter_private.horse_refund_parity_receipts(
 entitlement_id uuid PRIMARY KEY,
 tournament_id uuid NOT NULL,
 user_id uuid NOT NULL,
 club_id uuid NOT NULL,
 amount numeric NOT NULL CHECK (amount > 0),
 idempotency_key text NOT NULL UNIQUE,
 adjustment_id uuid NOT NULL,
 ledger_id uuid NOT NULL,
 wallet_transaction_id uuid NOT NULL,
 receipt jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON smarter_private.horse_refund_parity_receipts FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER horse_refund_parity_receipt_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
 ON smarter_private.horse_refund_parity_receipts FOR EACH STATEMENT
 EXECUTE FUNCTION smarter_private.owner_retirement_bank_refund_immutable();

CREATE OR REPLACE FUNCTION smarter_private.owner_retirement_transfer_pools(p_operation_id uuid, p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'smarter_private'
AS $function$
DECLARE
 intent smarter_private.owner_tournament_deletion_intents; t public.tournaments;
 e record; canonical record; prior jsonb; v_amount numeric; fee numeric; refunded_fee numeric:=0;
 bank_wallet uuid; bank_before numeric; bank_after numeric; journal uuid;
 credit jsonb; drains jsonb:='[]'; part record; saved jsonb; setting record;
 key text; answer jsonb; refundable record;
 main_bank constant uuid:='fade0000-0000-0000-0000-000000000001';
 kingfish constant uuid:='47965354-0e56-43ef-931c-ddaab82af765';
BEGIN
 PERFORM smarter_private.cancellation_lane(p_tournament_id);
 PERFORM smarter_private.assert_tournament_abort_quiesced(p_operation_id,p_tournament_id);
 SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 SELECT * INTO intent FROM smarter_private.owner_tournament_deletion_intents WHERE tournament_id=p_tournament_id;
 IF NOT FOUND OR intent.original_started_at IS DISTINCT FROM t.started_at
 OR intent.owner_chat_id IS DISTINCT FROM '01a19ccc-894e-75e2-a9e7-fe0d2df6c326'
 OR (intent.asset='chips' AND (intent.destination_id IS DISTINCT FROM main_bank OR t.union_id IS DISTINCT FROM main_bank))
 OR (intent.asset='diamonds' AND (intent.destination_id IS DISTINCT FROM kingfish OR NOT public.fn_poker_diamond_tournament(p_tournament_id)))
 THEN RAISE EXCEPTION 'owner_retirement_transfer_scope_changed';END IF;
 -- Every paid entry is refunded before custody moves, whoever paid it
 -- (Dan, 2026-11-08: horses are refunded exactly as humans, 100% of the time).
 IF EXISTS(SELECT 1 FROM public.tournament_refund_entitlements re
  WHERE re.tournament_id=p_tournament_id AND re.entitlement_kind='wallet_charge'
  AND NOT EXISTS(SELECT 1 FROM public.tournament_refund_tranches rt WHERE rt.entitlement_id=re.id)
  AND NOT EXISTS(SELECT 1 FROM smarter_private.owner_retirement_manual_refunds rm WHERE rm.entitlement_id=re.id)
  AND NOT EXISTS(SELECT 1 FROM smarter_private.owner_retirement_bank_refunds rb WHERE rb.entitlement_id=re.id)
  AND NOT EXISTS(SELECT 1 FROM public.tournament_tickets rk WHERE rk.source_refund_entitlement_id=re.id)
  AND NOT EXISTS(SELECT 1 FROM smarter_private.horse_refund_parity_receipts rp WHERE rp.entitlement_id=re.id))
 THEN RAISE EXCEPTION 'owner_retirement_unrefunded_entry';END IF;
 IF intent.asset='diamonds' AND EXISTS(SELECT 1 FROM public.poker_diamond_lot_reservations r
  JOIN public.poker_diamond_custody c ON c.id=r.custody_id WHERE c.target_id=p_tournament_id
  AND r.released_at IS NULL AND r.amount>r.consumed)
 THEN RAISE EXCEPTION 'owner_retirement_purchased_liability_requires_resolution';END IF;
 IF EXISTS(SELECT 1 FROM smarter_private.owner_retirement_pool_transfers WHERE tournament_id=p_tournament_id)
 THEN RAISE EXCEPTION 'owner_retirement_transfer_already_recorded';END IF;
 IF public.fn_platform_frozen() THEN RAISE EXCEPTION 'owner_retirement_platform_frozen';END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_obligations WHERE tournament_id=p_tournament_id AND amount_owed>amount_paid)
 THEN RAISE EXCEPTION 'owner_retirement_unpaid_player_obligation';END IF;
 -- All verified paid human charges must have their original bank-funded
 -- refund, including the two independent charges in the same event.
 FOR refundable IN SELECT * FROM (VALUES
 ('2781bcd7-cc8a-4713-ab3e-0d0a81fdf110'::uuid,'26b465dd-600d-42eb-9f37-68f6052febac'::uuid,5::numeric),
 ('6379b29e-1307-4e8b-91e7-e9a0975cd64d','8e6232d8-bbd7-4dc8-9640-4fbfa45ca952',1),
 ('d5decc98-cd0f-417f-aa28-6df009a74c76','1edfe4d2-005d-4b93-96d0-fc0bb10f8c95',1),
 ('d5decc98-cd0f-417f-aa28-6df009a74c76','26ac24a2-7c73-44af-a5ae-b971d0a8e4fd',1)
 )x(tournament_id,entitlement_id,amount) WHERE tournament_id=p_tournament_id LOOP
  SELECT receipt INTO prior FROM smarter_private.owner_retirement_bank_refunds WHERE entitlement_id=refundable.entitlement_id;
  IF smarter_private.owner_manual_refund_receipt(refundable.entitlement_id) IS NULL AND
   (prior IS NULL OR (prior->>'amount')::numeric IS DISTINCT FROM refundable.amount
   OR NOT EXISTS(SELECT 1 FROM public.tournament_refund_tranches WHERE entitlement_id=refundable.entitlement_id
    AND amount_paid_now=refundable.amount AND credit_ledger_id=(prior->'refund'->>'credit_ledger_id')::uuid))
  THEN RAISE EXCEPTION 'owner_retirement_original_refund_missing';END IF;
 END LOOP;
 IF intent.asset='diamonds' THEN PERFORM public.fn_poker_diamond_tournament_open_shadow(p_tournament_id);END IF;
 SELECT * INTO e FROM public.tournament_escrow WHERE tournament_id=p_tournament_id AND enforced AND closed_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'owner_retirement_open_escrow_required';END IF;
 IF intent.asset='diamonds' THEN SELECT * INTO canonical FROM public.fn_poker_diamond_tournament_escrow(p_tournament_id);
 ELSE SELECT * INTO canonical FROM public.fn_ca_tournament_escrow_chips(p_tournament_id);END IF;
 IF canonical.prize_balance IS DISTINCT FROM e.prize_balance OR canonical.bounty_balance IS DISTINCT FROM e.bounty_balance
 OR canonical.fee_balance IS DISTINCT FROM e.fee_balance THEN RAISE EXCEPTION 'owner_retirement_escrow_sources_disagree';END IF;
 IF e.prize_balance<0 OR e.bounty_balance<0 OR e.fee_balance<0
 OR e.prize_balance::text IN ('NaN','Infinity','-Infinity') OR e.bounty_balance::text IN ('NaN','Infinity','-Infinity')
 OR e.fee_balance::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'owner_retirement_invalid_bank';END IF;
 -- A bank-funded gross refund must retain its fee portion for the original
 -- club fee liability. The refund bank's overlay initially enters prize;
 -- this same terminal transaction reserves the exact original fee component.
 IF intent.asset='chips' THEN
  SELECT coalesce(sum(tr.refund_fee),0) INTO refunded_fee
   FROM smarter_private.owner_retirement_bank_refunds r JOIN public.tournament_refund_tranches tr
    ON tr.entitlement_id=r.entitlement_id AND tr.credit_ledger_id=(r.receipt->'refund'->>'credit_ledger_id')::uuid
   WHERE r.tournament_id=p_tournament_id;
  IF refunded_fee<0 OR refunded_fee>e.prize_balance THEN RAISE EXCEPTION 'owner_retirement_refunded_fee_funding_missing';END IF;
 END IF;
 -- Chip fees are held for the member clubs through the existing fee writer.
 -- Diamond fees have no member-club attribution and use the named recipient.
 fee:=CASE WHEN intent.asset='diamonds' THEN e.fee_balance ELSE 0 END;
 v_amount:=e.prize_balance-refunded_fee+e.bounty_balance+fee;
 key:='owner-retirement-pool:'||p_tournament_id::text||':'||p_operation_id::text;
 IF intent.asset='chips' THEN
  SELECT id,chip_balance INTO bank_wallet,bank_before FROM public.union_wallets WHERE union_id=main_bank FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'owner_retirement_main_bank_missing';END IF;
  IF v_amount>0 THEN
   SELECT jsonb_object_agg(k,coalesce(current_setting(k,true),'')) INTO saved FROM unnest(ARRAY[
    'app.ledger_category','app.ledger_counterparty','app.ledger_counterparty_entity','app.ledger_counterparty_label',
    'app.ledger_idempotency_key','app.ledger_tournament_id','app.ledger_autoledger_club_id']) k;
   PERFORM public.fn_ca_declare_ledger('transfer','prize_liability',t.id,NULL,key);
   PERFORM set_config('app.ledger_tournament_id',t.id::text,true);
   PERFORM set_config('app.ledger_autoledger_club_id',t.club_id::text,true);
   UPDATE public.union_wallets SET chip_balance=chip_balance+v_amount,updated_at=now()
    WHERE union_id=main_bank RETURNING chip_balance INTO bank_after;
   SELECT id INTO journal FROM public.chip_ledger WHERE idempotency_key=key AND from_type='prize_liability'
    AND from_entity_id=t.id AND to_type='union_bank' AND to_entity_id=bank_wallet
    AND to_label='union_wallets.chip_balance' AND category='transfer' AND chip_ledger.amount=v_amount;
   IF journal IS NULL OR bank_after IS DISTINCT FROM bank_before+v_amount THEN RAISE EXCEPTION 'owner_retirement_bank_credit_unproven';END IF;
   INSERT INTO public.union_wallet_transactions(union_id,wallet,direction,amount,balance_after,tx_type,club_id,notes,created_by)
    VALUES(main_bank,'chip_balance','credit',v_amount,bank_after,'owner_retirement_pool',t.club_id,key,'2d1cd6c3-5700-4af9-a271-d4863fdab20d');
   FOR setting IN SELECT * FROM jsonb_each_text(saved) LOOP PERFORM set_config(setting.key,setting.value,true);END LOOP;
  ELSE bank_after:=bank_before;END IF;
 ELSE
  IF v_amount<>trunc(v_amount) THEN RAISE EXCEPTION 'owner_retirement_diamonds_must_be_whole';END IF;
  SELECT diamonds INTO bank_before FROM public.profiles WHERE id=kingfish AND lower(username)='kingfish' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'owner_retirement_kingfish_identity_changed';END IF;
  IF v_amount>0 THEN
   credit:=public.add_diamonds_to_balance(kingfish,v_amount::integer,'arena_withdraw','Owner-directed retired tournament custody transfer',key);
   IF credit->>'success' IS DISTINCT FROM 'true' OR nullif(credit->>'transaction_id','') IS NULL
    THEN RAISE EXCEPTION 'owner_retirement_diamond_credit_failed';END IF;
   journal:=(credit->>'transaction_id')::uuid;
   FOR part IN SELECT * FROM (VALUES('prize',e.prize_balance),('bounty',e.bounty_balance),('fee',fee))x(bank,quantity) WHERE quantity>0 LOOP
    drains:=drains||jsonb_build_array(jsonb_build_object('bank',part.bank,'amount',part.quantity,'movements',
     public.fn_poker_diamond_tournament_drain(t.id,part.bank,part.quantity::bigint,key||':'||part.bank,'player:'||kingfish::text,journal)));
   END LOOP;
  END IF;
  SELECT diamonds INTO bank_after FROM public.profiles WHERE id=kingfish;
  IF bank_after IS DISTINCT FROM bank_before+v_amount THEN RAISE EXCEPTION 'owner_retirement_diamond_credit_unproven';END IF;
 END IF;
 answer:=jsonb_build_object('ok',true,'asset',intent.asset,'operation_id',p_operation_id,'tournament_id',t.id,
  'destination_id',intent.destination_id,'destination_wallet_id',bank_wallet,'key',key,'journal_id',journal,
  'prize',e.prize_balance-refunded_fee,'refund_fee_reserved',refunded_fee,'bounty',e.bounty_balance,'fee',fee,'amount',v_amount,
  'destination_before',bank_before,'destination_after',bank_after,'drains',drains,
  'member_club_fee_custody',CASE WHEN intent.asset='chips' THEN e.fee_balance+refunded_fee ELSE 0 END);
 INSERT INTO smarter_private.owner_retirement_pool_transfers(tournament_id,operation_id,asset,destination_id,prize,bounty,fee,refund_fee_reserved,receipt,transaction_id)
 VALUES(t.id,p_operation_id,intent.asset,intent.destination_id,e.prize_balance-refunded_fee,e.bounty_balance,fee,refunded_fee,answer,txid_current());
 -- The existing rake-settlement trigger applies the fee outflow exactly once later in this same transaction.
 PERFORM public.fn_ca_escrow_apply(t.id,'Owner-directed remaining custody transfer',p_prize_out=>e.prize_balance-refunded_fee,p_bounty_out=>e.bounty_balance,p_fee_entries_in=>refunded_fee);
 IF intent.asset='diamonds' THEN SELECT * INTO canonical FROM public.fn_poker_diamond_tournament_escrow(t.id);
 ELSE SELECT * INTO canonical FROM public.fn_ca_tournament_escrow_chips(t.id);END IF;
 IF canonical.prize_balance<>0 OR canonical.bounty_balance<>0 OR canonical.fee_balance IS DISTINCT FROM e.fee_balance+refunded_fee-fee
 THEN RAISE EXCEPTION 'owner_retirement_transfer_conservation_failed';END IF;
 IF intent.asset='diamonds' AND public.fn_poker_diamond_tournament_custody(t.id)<>0 THEN RAISE EXCEPTION 'owner_retirement_diamond_custody_not_zero';END IF;
 RETURN answer;
END $function$;
REVOKE ALL ON FUNCTION smarter_private.owner_retirement_transfer_pools(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;


CREATE FUNCTION smarter_private.horse_refund_parity_back_refund(p_limit integer)
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
            FROM zz_parity_owed o JOIN public.tournaments t ON t.id = o.tournament_id
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

DO $budget$ BEGIN
 IF clock_timestamp() - transaction_timestamp() > interval '8 seconds' THEN
  RAISE EXCEPTION 'horse_refund_parity_install_budget';
 END IF;
END $budget$;
COMMIT;
