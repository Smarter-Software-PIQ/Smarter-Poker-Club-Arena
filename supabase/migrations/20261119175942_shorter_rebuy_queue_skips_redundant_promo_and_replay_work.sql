-- 20261119175942_shorter_rebuy_queue_skips_redundant_promo_and_replay_work.sql
--
-- SHORTER REBUY QUEUE WITHIN ONE EVENT (incident 075013fd, lane 4).
--
-- OWNER RULINGS (Dan): "REBUYS IN A TOURNAMENT SHOULD NOT PAUSE THE ACTION"
-- (2026-08-30); promo chips can not and should not ever cause payout issues
-- (2026-11-17); no unintended delays between hands (2026-11-18).
--
-- WHAT WAS STILL LENGTHENING THE EXCLUSIVE REBUY QUEUE R(id) AFTER #11364
--
-- Every chip purchase (rebuy, re-entry, add-on) takes the event's exclusive
-- rebuy key R(id) via fn_ca_share_tournament_lane_for_rebuy. Three remaining
-- sources of work still ran unnecessarily inside R(id) (or before it):
--
--   1. IMMUTABLE COMPLETED-RECEIPT REPLAYS QUEUED ON R(id). A transport retry
--      of an already-committed add-on or explicit-token rebuy/re-entry ran
--      fn_ca_promo_fee_state_ensure AND queued behind R(id) exclusive +
--      pg_advisory_xact_lock_shared(530090,1) before reading the immutable
--      completed receipt in entry_purchase_idempotency_receipts.
--   2. DUPLICATE IN-LANE SETTLE ON EVERY EVENT ENTRY/REBUY. On every tournament
--      buy-in, rebuy, re-entry or add-on (dest='event'), fn_ca_promo_custody_on_ledger
--      called fn_ca_promo_play_through_settle(NEW.club_id, uid) AND THEN
--      called fn_ca_promo_fund_from_balance(...), which called
--      fn_ca_promo_play_through_settle(l.club_id, l.from_entity_id) a second time.
--   3. IN-LANE FEE-HISTORY RECOMPUTATION WHEN A REBUY CLOSES A FREE BUY GRANT
--      OR WHEN NO WALLET PRINCIPAL EXISTS (36% of open-grant rebuys on
--      production: 213 of 584, noted in 20261119054539). Inside R(id),
--      fn_ca_promo_retire_busted_entry closes the exhausted Free Buy grant,
--      which changes fn_ca_promo_fee_state_signature. Five lines later,
--      fn_ca_promo_fund_from_balance ran fn_ca_promo_play_through_settle and
--      fn_ca_promo_play_through_state (1.4 s mean, 5.5 s max live fee-history
--      scan INSIDE R(id)) even when the player had ZERO open-grant principal
--      custody in their source wallet (where locked = expired = moved = 0).
--
-- WHAT CHANGES
--
--   1. process_tournament_rebuy checks entry_purchase_idempotency_receipts for
--      an already-committed immutable receipt (r.response IS NOT NULL) BEFORE
--      fn_ca_promo_fee_state_ensure and BEFORE taking R(id). Completed retries
--      return immediately with zero lane wait and zero promo work; new
--      purchases and in-flight receipts fall through to the existing in-lane
--      receipt check unchanged.
--   2. process_tournament_rebuy narrows its pre-lane fn_ca_promo_fee_state_ensure
--      to buyers who actually hold open-grant principal custody in player_wallet
--      (c.kind='player_wallet' AND c.entity_id=p_user_id AND c.amount>0), so
--      buyers whose only open grants are event-bound Free Buy grants pay zero
--      fee-history recomputation before or inside R(id).
--   3. fn_ca_promo_custody_on_ledger skips its duplicate
--      fn_ca_promo_play_through_settle when dest='event' (fn_ca_promo_fund_from_balance
--      owns it).
--   4. fn_ca_promo_fund_from_balance checks whether open-grant principal
--      custody exists at (l.from_type, l.from_entity_id) with amount > 0
--      before calling fn_ca_promo_play_through_settle / fn_ca_promo_play_through_state.
--      When none exists, locked = expired = moved = 0 identically, and the
--      exact same ca_promo_funding_custody_receipts row is written with zero
--      fee-history scan and zero club_members lock.
--
-- LOCK ORDER & INVARIANTS. Zero lock-order changes. Every chip debit, custody
-- transfer, expired-principal refusal, and idempotency receipt is preserved
-- identically.
--
-- @live-proof: (SELECT position('20261119175942' in pg_get_functiondef('public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure)) > 0 AND position('20261119175942' in pg_get_functiondef('public.fn_ca_promo_custody_on_ledger()'::regprocedure)) > 0 AND position('20261119175942' in pg_get_functiondef('public.fn_ca_promo_fund_from_balance(uuid,numeric,text,uuid,numeric)'::regprocedure)) > 0)
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- @probe-exempt: public.fn_ca_promo_custody_on_ledger trigger function cannot be called directly; covered by plpgsql_check and native PG proof
DO $rewrite$
DECLARE
  r record;
  v_sig regprocedure;
  v_def text;
  v_n integer;
  v_acl text;
  v_owner oid;
  v_definer boolean;
  v_config text[];
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      (
        'public.fn_ca_promo_custody_on_ledger()',
        $o1$  IF dest IS NOT NULL THEN
   PERFORM public.fn_ca_promo_profit_prelock_source(NEW.club_id,uid,NEW.from_type,uid);
   PERFORM public.fn_ca_promo_play_through_settle(NEW.club_id,uid);$o1$,
        $n1$  IF dest IS NOT NULL THEN
   PERFORM public.fn_ca_promo_profit_prelock_source(NEW.club_id,uid,NEW.from_type,uid);
   -- 20261119175942: dest='event' delegates settle/state once to fn_ca_promo_fund_from_balance
   -- (and only when open-grant principal custody exists in the source wallet).
   IF dest<>'event' THEN
    PERFORM public.fn_ca_promo_play_through_settle(NEW.club_id,uid);
   END IF;$n1$
      ),
      (
        'public.fn_ca_promo_fund_from_balance(uuid,numeric,text,uuid,numeric)',
        $o2$ IF EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from<=clock_timestamp()) THEN
  PERFORM public.fn_ca_promo_play_through_settle(l.club_id,l.from_entity_id);$o2$,
        $n2$ -- 20261119175942: when the source wallet holds zero open-grant principal custody,
 -- locked = expired = moved = 0 identically; skip settle and fee-history scan.
 IF EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from<=clock_timestamp())
  AND EXISTS(SELECT 1 FROM public.ca_promo_principal_custody c
   JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
   WHERE g.club_id=l.club_id AND g.user_id=l.from_entity_id
    AND g.closed_at IS NULL AND c.kind=l.from_type
    AND c.entity_id=l.from_entity_id AND c.amount>0) THEN
  PERFORM public.fn_ca_promo_play_through_settle(l.club_id,l.from_entity_id);$n2$
      ),
      (
        'public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)',
        $o3$  -- 20261119054539: an open-grant holder's hourly promo snapshot is made
  -- current HERE, before the event's rebuy key, so a fee-history recomputation
  -- (1.4 s mean on production) never runs while another purchase of this event
  -- waits. Inside the lane the settles then read it current. Holds no lane.
  PERFORM public.fn_ca_promo_fee_state_ensure(tp.club_id,p_user_id)
     FROM public.tournament_players tp
    WHERE tp.tournament_id=p_tournament_id AND tp.user_id=p_user_id
      AND EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings s
                  WHERE s.id AND s.enforced_from<=clock_timestamp())
      AND EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants g
                  WHERE g.club_id=tp.club_id AND g.user_id=p_user_id AND g.closed_at IS NULL);
  PERFORM public.fn_ca_share_tournament_lane_for_rebuy(p_tournament_id,p_user_id);
  v_lane_shared:=true;$o3$,
        $n3$  -- 20261119175942: immutable completed receipts (add-ons and explicit prompt
  -- tokens) replay HERE before promo work and before the event's exclusive
  -- rebuy key R(id), so delayed transport retries never queue behind active
  -- purchases. Uncommitted or absent receipts fall through into R(id).
  IF v_type='addon' THEN
    v_receipt_key:='tourney:'||p_tournament_id::text||':addon:'||
      p_user_id::text;
    v_request:=jsonb_build_object(
      'version','v1','tournament_id',p_tournament_id,'user_id',p_user_id,
      'rebuy_type',v_type,'idempotency_key',v_receipt_key);
  ELSIF p_client_token IS NOT NULL
        AND length(btrim(p_client_token))>0 THEN
    v_effective_token:=btrim(p_client_token);
    v_receipt_key:='tourney:'||p_tournament_id::text||':'||v_type||':'||
      p_user_id::text||':tok:'||v_effective_token;
  END IF;
  IF v_receipt_key IS NOT NULL THEN
    SELECT r.request,r.response
      INTO v_existing_request,v_existing_response
      FROM public.entry_purchase_idempotency_receipts r
     WHERE r.key_domain='tournament_chip_purchase'
       AND r.idempotency_key=v_receipt_key
       AND r.response IS NOT NULL;
    IF FOUND THEN
      IF v_existing_request->>'version'<>'v1'
         OR v_existing_request->>'tournament_id'<>p_tournament_id::text
         OR v_existing_request->>'user_id'<>p_user_id::text
         OR v_existing_request->>'rebuy_type'<>v_type
         OR v_existing_request->>'idempotency_key'<>v_receipt_key
         OR v_existing_response->>'success'<>'true'
         OR v_existing_response->>'seated'<>'true'
         OR v_existing_response->>'atomic_tournament_chip_purchase'<>'v1'
         OR v_existing_response->>'rebuy_type'<>v_type
         OR v_existing_response->>'table_id' IS NULL
         OR v_existing_response->>'seat_id' IS NULL
         OR v_existing_response->>'stack' IS NULL
         OR (v_type='addon' AND v_existing_request ? 'candidate_id')
         OR (v_type<>'addon' AND (
           v_existing_request->>'candidate_id' IS NULL
           OR v_existing_response->>'candidate_id'<>
              v_existing_request->>'candidate_id'
           OR v_existing_response->>'candidate_state'<>'rebought')) THEN
        RAISE EXCEPTION
          'IDEMPOTENCY_RECEIPT_UNBOUND: historical response is not an atomic tournament purchase proof'
          USING ERRCODE='55000';
      END IF;
      RETURN v_existing_response;
    END IF;
  END IF;

  -- 20261119054539 / 20261119175942: bring the hourly promo snapshot current
  -- BEFORE R(id) only when the buyer actually holds open-grant principal
  -- custody in player_wallet (event-bound Free Buy grants no longer scan fee
  -- history inside R(id) either). Holds no lane.
  PERFORM public.fn_ca_promo_fee_state_ensure(tp.club_id,p_user_id)
     FROM public.tournament_players tp
    WHERE tp.tournament_id=p_tournament_id AND tp.user_id=p_user_id
      AND EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings s
                  WHERE s.id AND s.enforced_from<=clock_timestamp())
      AND EXISTS(SELECT 1 FROM public.ca_promo_principal_custody c
                   JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
                  WHERE g.club_id=tp.club_id AND g.user_id=p_user_id
                    AND g.closed_at IS NULL AND c.kind='player_wallet'
                    AND c.entity_id=p_user_id AND c.amount>0);
  PERFORM public.fn_ca_share_tournament_lane_for_rebuy(p_tournament_id,p_user_id);
  v_lane_shared:=true;$n3$
      )
    ) AS s(signature, old_text, new_text)
  LOOP
    v_sig := r.signature::regprocedure;
    v_def := pg_get_functiondef(v_sig);
    v_n := (length(v_def) - length(replace(v_def, r.old_text, ''))) / length(r.old_text);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '20261119175942: anchor in % found % times, expected 1 (revalidate before applying)', r.signature, v_n;
    END IF;
    SELECT p.proacl::text, p.proowner, p.prosecdef, p.proconfig
      INTO v_acl, v_owner, v_definer, v_config
      FROM pg_proc p WHERE p.oid = v_sig;
    EXECUTE replace(v_def, r.old_text, r.new_text);
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
       WHERE p.oid = v_sig
         AND p.proacl::text IS NOT DISTINCT FROM v_acl
         AND p.proowner = v_owner
         AND p.prosecdef = v_definer
         AND p.proconfig IS NOT DISTINCT FROM v_config
    ) THEN
      RAISE EXCEPTION '20261119175942: metadata changed on %', r.signature;
    END IF;
  END LOOP;

  IF position('20261119175942' in pg_get_functiondef('public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure)) = 0
     OR position('20261119175942' in pg_get_functiondef('public.fn_ca_promo_custody_on_ledger()'::regprocedure)) = 0
     OR position('20261119175942' in pg_get_functiondef('public.fn_ca_promo_fund_from_balance(uuid,numeric,text,uuid,numeric)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '20261119175942: post-install verification failed';
  END IF;
END
$rewrite$;

-- @probe-for: public.fn_ca_promo_fund_from_balance
DO $probe$
BEGIN
  BEGIN
    PERFORM public.fn_ca_promo_fund_from_balance(gen_random_uuid(), 100, 'event', gen_random_uuid(), 0);
  EXCEPTION WHEN no_data_found THEN
    NULL;
  END;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- Exercises the new pre-lane immutable receipt replay path and unwinds.
-- @probe-for: public.process_tournament_rebuy
DO $probe$
DECLARE v_t uuid := gen_random_uuid(); v_u uuid := gen_random_uuid(); v_key text; v_r jsonb;
BEGIN
  v_key := 'tourney:'||v_t::text||':addon:'||v_u::text;
  INSERT INTO public.entry_purchase_idempotency_receipts(key_domain,idempotency_key,request,response,claimed_at,completed_at)
  VALUES('tournament_chip_purchase',v_key,
    jsonb_build_object('version','v1','tournament_id',v_t,'user_id',v_u,'rebuy_type','addon','idempotency_key',v_key),
    jsonb_build_object('success',true,'seated',true,'atomic_tournament_chip_purchase','v1','rebuy_type','addon',
      'table_id',gen_random_uuid(),'seat_id',gen_random_uuid(),'stack',1),
    clock_timestamp(),clock_timestamp());
  v_r := public.process_tournament_rebuy(v_t,v_u,'addon',NULL,NULL,NULL,NULL);
  IF v_r->>'atomic_tournament_chip_purchase' IS DISTINCT FROM 'v1' THEN
    RAISE EXCEPTION 'process_tournament_rebuy probe did not replay its receipt: %', v_r;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
