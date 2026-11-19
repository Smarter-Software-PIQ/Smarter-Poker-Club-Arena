-- 20261119054539_a_rebuy_reads_promo_fee_state_outside_its_event_lane.sql
--
-- A REBUY READS PROMO FEE STATE OUTSIDE ITS EVENT LANE (incident 075013fd,
-- lane E3). Owner rules: rebuys never pause the action (Dan, 2026-08-30);
-- promo chips never cause payout issues (2026-11-17); no unintended delays
-- (2026-11-18).
--
-- WHERE A REBUY'S TIME GOES. process_tournament_rebuy takes the event's rebuy
-- key R(id) exclusive first (fn_ca_share_tournament_lane_for_rebuy), so every
-- later step of one purchase is time the next purchase of the same event
-- waits. track_functions is off and pg_stat_statements tracks top level only,
-- so the parts were read on production 2026-11-19 05:30-06:00 UTC, read only:
--   - 4,586 of the 4,616 chip purchases of the last six hours (99%) were by
--     promo grant holders: 3,564 (77%) held a locked winnings gate, 545 (12%)
--     an open grant.
--   - Two steps of the purchase can recompute the holder's whole fee history
--     (fn_ca_promo_shared_fee_state_live) when the hourly snapshot is not
--     current. For 40 recent buyers that measured 1,367 ms mean, 1,041 ms
--     median and 5,497 ms max, and 29 of the 40 had no current snapshot: a
--     Free Buy grant changes its signature (85 of 98 drifted snapshots had a
--     grant granted or closed since).
--       a. Every entry charge ran the winnings settle
--          (fn_ca_promo_profit_finish_entry_fee), which refreshes for a
--          locked-gate holder. 20261119053144 removes that from every charge.
--       b. fn_ca_promo_custody_on_ledger runs fn_ca_promo_play_through_settle
--          for an open-grant holder, and that refreshes a stale snapshot.
--   - Nothing else reaches the fee history. fn_ca_promo_fund_from_balance
--     reads fn_ca_promo_play_through_state, whose join stops before the
--     recomputation for an account with no open grant and finds the snapshot
--     just refreshed by (b) for one with an open grant. Receipt, wake, club
--     stamp and Diamond work are single-row reads and writes.
--
-- WHAT CHANGES. process_tournament_rebuy brings an open-grant holder's hourly
-- snapshot current (fn_ca_promo_fee_state_ensure) BEFORE it takes the event's
-- rebuy key. The recomputation then runs while no other purchase waits for
-- it, and the settles inside the lane find the snapshot current. That is the
-- snapshot rule of 20261119002019 (a current snapshot is trusted for up to two
-- hours), applied a few lane-waits earlier. A release is still decided only
-- on the live fee history, and a cash-out is still live. A holder with no open
-- grant pays nothing. When the purchase itself closes a grant (exhausted Free
-- Buy principal, 213 of 584 open-grant purchases) and another stays open, the
-- settle still refreshes inside the lane, exactly as before.
-- No chip, custody, receipt or decision changes. Native proof:
-- scripts/ci/test-a-rebuy-reads-promo-fee-state-outside-its-lane.py.
--
-- COORDINATION. Requires 20261119013430 (lane B7, #11356): applied to its
-- post-image c294af49, whose anchors this block does not touch. This file
-- first merged (#11364) pinned to B7's own pre-image d5da7399; its dispatch
-- was cancelled before anything was sent, and it was re-pinned here before
-- any install, so B7 always installs first and this never moves its anchor.
--
-- LOCK FOOTPRINT. CREATE OR REPLACE FUNCTION only; no table or row lock.
--
-- @live-proof: (SELECT md5(pg_get_functiondef('public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure)) = '8acb45633fa7bfbd7d63dbb256138e53')
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- The rebuy: one exact anchor, counted, on the pinned pre-image; owner, ACL,
-- SECURITY DEFINER and proconfig are kept by CREATE OR REPLACE.
DO $rebuy$
DECLARE
  v_sig regprocedure := 'public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure;
  v_def text := pg_get_functiondef('public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure);
  v_anchor text := $a$  PERFORM public.fn_ca_share_tournament_lane_for_rebuy(p_tournament_id,p_user_id);
  v_lane_shared:=true;
$a$;
  v_new text := $n$  -- 20261119054539: an open-grant holder's hourly promo snapshot is made
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
  v_lane_shared:=true;
$n$;
  v_n integer;
BEGIN
  IF md5(v_def) <> 'c294af49b455ffc1c421edbe3d6f1d1d' THEN
    RAISE EXCEPTION 'process_tournament_rebuy is not the pinned pre-image (md5 %); revalidate before moving its promo read', md5(v_def);
  END IF;
  v_n := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'rebuy lane anchor found % times, expected 1', v_n;
  END IF;
  EXECUTE replace(v_def, v_anchor, v_new);
  IF md5(pg_get_functiondef(v_sig)) <> '8acb45633fa7bfbd7d63dbb256138e53' THEN
    RAISE EXCEPTION 'process_tournament_rebuy did not land on its reviewed post-image (md5 %)', md5(pg_get_functiondef(v_sig));
  END IF;
END
$rebuy$;

-- The new body runs once before COMMIT, undone: an add-on replay of a fixture
-- receipt passes the session check, the new block, the event lane and the
-- receipt read, and returns the recorded answer.
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
