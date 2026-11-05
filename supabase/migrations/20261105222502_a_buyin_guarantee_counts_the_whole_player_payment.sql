-- 20261105222502_a_buyin_guarantee_counts_the_whole_player_payment
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-05 22:25:02 UTC.
--
-- A BUY-IN GUARANTEE COUNTS THE WHOLE PLAYER PAYMENT, AND THE HOUSE FUNDS
-- ONLY H = max(0, G - C), ONCE
--
-- Owner rule (Dan, 2026-11-05, this chat): "The full qualifying player-funded
-- tournament payment counts toward the buy-in guarantee before deducting
-- bounty allocations or rake." A 40-chip entry split 26 prize / 10 bounty /
-- 4 rake credits 40 toward the guarantee. Thirteen such entries against a
-- 500 guarantee need ZERO house funding; ten need 100. Guarantee credit is
-- not money: the same payment still allocates 26 / 10 / 4.
--
-- WHAT PRODUCTION DID, READ FROM ROWS
--
-- fn_ca_apply_prize_guarantee_core (and fn_apply_prize_guarantee_before_
-- atomic_proof under it) funded max(0, place_guarantee - prize_pool) where
-- place_guarantee = G - bounty_pool. Coverage was therefore prize + bounty,
-- i.e. the payment NET of rake, so the house paid the rake back into every
-- guarantee the field had already met by gross payments:
--   * 40 Chip Freezeout - 1.5K GTD 2637de9d (2026-11-02): 40 x 40 = 1,600
--     gross against 1,500; house paid 60.
--   * 40 Chip Freezeout - 5K GTD d4b6204c: 5,520 gross, house paid 32.
--   * 40 Chip Bounty Freezeout - 5K GTD a70c1028: 5,800 gross, house 1,230.
--   Across 1,597 completed guaranteed chip MTTs since 2026-10-01, 166 carry
--   house funding above max(0, G - C), 10,575.55 chips in all, and none is
--   below it (manifest in
--   docs/changelog/2026-11-05-a-guarantee-counts-the-whole-payment.md). Every
--   one is completed and paid; nothing is taken back from any player.
-- And the 2,445 the owner saw: Wednesday Feature 94ef58cf (G 1,500, entry 30
-- = 27 prize + 3 rake). The old start trigger paid 1,338 = 1,500 - 6 x 27 at
-- 02:53:41 UTC on six entries; 41 paid entries later the pool read
-- 41 x 27 + 1,338 = 2,445. The start funding was removed by #9518 and the
-- 1,338 returned at 04:05:16 UTC; this migration replaces the net basis that
-- sized it.
--
-- WHAT THIS CHANGES
--
-- public.fn_ca_guarantee_funding(uuid) reads the event's own ledger once:
--   C = player wallet buy-ins, rebuys and add-ons, satellite seats and
--       redeemed tickets into this event's prize liability, at their full
--       charge, minus refunds and reversals back to players;
--   P = house/promo funding already posted (overlay, promo_send) minus what
--       went back to a bank;
--   H = max(0, G - C); due = max(0, H - P).
-- House transfers, promo heads and unused tickets are never C.
-- public.fn_ca_guarantee_place_floor(id, prize_pool, G, bounty) = prize_pool
-- + due: the only pool the house still owes. A Diamond event keeps its own
-- rule. Every finalization and settlement guard that compared the pool with
-- G - bounty_pool now compares it with this floor, so an event whose gross
-- payments met the guarantee settles at what it collected, and an unfunded
-- shortfall is still refused exactly as before. H is a total, reconciled
-- against P on every call, so a retry or second worker funds nothing twice
-- (the existing one-row overlay claim and journal key stay in place).
-- fn_ca_tournament_prize_funding (lobby/rewards aggregate) also returns
-- gross_coverage, house_required, house_posted and house_due.
--
-- Not touched: fn_ca_fund_overlay_on_lock (moves no chips for an ordinary
-- guarantee since #9518; satellite seat guarantees are seats, not buy-ins),
-- fn_ca_return_excess_start_overlay_locked (legacy start overlays only) and
-- fn_poker_diamond_tournament_effective_guarantee (Diamond book).
--
-- @live-proof: to_regprocedure('public.fn_ca_guarantee_funding(uuid)') IS NOT NULL AND position('fn_ca_guarantee_place_floor' in pg_get_functiondef('public.fn_ca_apply_prize_guarantee_core(uuid,text)'::regprocedure))>0 AND position('fn_ca_guarantee_place_floor' in pg_get_functiondef('public.fn_settle_tournament_places_atomic(uuid,text)'::regprocedure))>0 AND position('gross_coverage' in pg_get_functiondef('public.fn_ca_tournament_prize_funding(uuid)'::regprocedure))>0

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

CREATE FUNCTION public.fn_ca_guarantee_funding(p_tournament_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $fn$
 WITH t AS (
  SELECT x.id, round(greatest(coalesce(x.guaranteed_prize, 0), 0), 2) AS g
    FROM public.tournaments x WHERE x.id = p_tournament_id
 ), l AS (
  SELECT c.category, c.from_type, c.to_type, c.from_entity_id, c.to_entity_id, c.amount
    FROM public.chip_ledger c
   WHERE (c.to_entity_id = p_tournament_id OR c.from_entity_id = p_tournament_id)
     AND coalesce(c.status, 'posted') = 'posted'
 ), s AS (
  SELECT
   coalesce(sum(l.amount) FILTER (WHERE l.to_entity_id = p_tournament_id AND l.to_type = 'prize_liability' AND (
      (l.from_type = 'player_wallet' AND l.category IN ('tournament_buyin', 'rebuy', 'addon'))
      OR (l.from_type = 'prize_liability' AND l.category = 'tournament_buyin' AND l.from_entity_id IS DISTINCT FROM p_tournament_id)
      OR (l.from_type = 'escrow' AND l.category = 'ticket_redeem'))), 0) AS paid_in,
   coalesce(sum(l.amount) FILTER (WHERE l.from_entity_id = p_tournament_id AND l.from_type = 'prize_liability'
      AND l.to_type = 'player_wallet' AND l.category IN ('refund', 'reversal')), 0) AS paid_back,
   coalesce(sum(l.amount) FILTER (WHERE l.to_entity_id = p_tournament_id AND l.to_type = 'prize_liability'
      AND l.category IN ('overlay', 'promo_send') AND l.from_type IN ('union_bank', 'union_wallet', 'club_treasury')), 0) AS house_in,
   coalesce(sum(l.amount) FILTER (WHERE l.from_entity_id = p_tournament_id AND l.from_type = 'prize_liability'
      AND l.category = 'reversal' AND l.to_type IN ('union_bank', 'union_wallet', 'club_treasury')), 0) AS house_out
  FROM l
 ), v AS (
  SELECT t.g, round(greatest(0, s.paid_in - s.paid_back), 2) AS c, round(s.house_in - s.house_out, 2) AS p
    FROM t, s
 )
 SELECT jsonb_build_object(
  'guarantee', v.g,
  'gross_coverage', v.c,
  'house_required', greatest(0, v.g - v.c),
  'house_posted', v.p,
  'house_due', greatest(0, greatest(0, v.g - v.c) - v.p),
  'house_over_required', greatest(0, v.p - greatest(0, v.g - v.c)))
 FROM v;
$fn$;
REVOKE ALL ON FUNCTION public.fn_ca_guarantee_funding(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_guarantee_funding(uuid) TO service_role;

CREATE FUNCTION public.fn_ca_guarantee_place_floor(p_tournament_id uuid, p_prize_pool numeric, p_guarantee numeric, p_bounty_pool numeric)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $fn$
BEGIN
 IF coalesce(p_guarantee, 0) <= 0 THEN
  RETURN public.fn_ca_place_guarantee(p_guarantee, p_bounty_pool);
 END IF;
 IF p_tournament_id IS NULL OR public.fn_poker_diamond_tournament(p_tournament_id) THEN
  RETURN public.fn_ca_place_guarantee(p_guarantee, p_bounty_pool);
 END IF;
 RETURN round(coalesce(p_prize_pool, 0), 2)
   + (public.fn_ca_guarantee_funding(p_tournament_id)->>'house_due')::numeric;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_ca_guarantee_place_floor(uuid, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_guarantee_place_floor(uuid, numeric, numeric, numeric) TO service_role;

DO $patch$
DECLARE
 f text; v_def text; v_new text; n integer;
 c_targets constant text[] := ARRAY[
  'public.fn_ca_apply_prize_guarantee_core(uuid,text)',
  'public.fn_apply_prize_guarantee_before_atomic_proof(uuid,text)',
  'public.fn_settle_tournament_places_atomic(uuid,text)',
  'public.fn_settle_final_table_deal_atomic(uuid)',
  'public.fn_settle_tournament_final_table_deal(uuid)',
  'public.fn_settle_tournament_places(uuid,uuid)',
  'public.trg_tournament_atomic_place_completion_guard()',
  'public.fn_ca_overlay_shortfall(uuid)',
  'public.fn_ca_backpay_guarantee_shortfalls(boolean,integer)',
  'public.fn_ca_prize_overpay_unexplained(interval)',
  'public.fn_ca_tournament_settlement_mismatch(interval)'];
 c_pattern constant text :=
  'public\.fn_ca_place_guarantee\(\s*([A-Za-z_][A-Za-z_0-9]*)\.guaranteed_prize\s*,\s*(?:[A-Za-z_][A-Za-z_0-9]*\.)?bounty_pool\s*\)';
BEGIN
 FOREACH f IN ARRAY c_targets LOOP
  v_def := pg_get_functiondef(f::regprocedure);
  n := (SELECT count(*) FROM regexp_matches(v_def, c_pattern, 'g'));
  IF n < 1 OR n > 2 THEN
   RAISE EXCEPTION 'guarantee floor anchor in % found % times; refusing to patch', f, n;
  END IF;
  IF f = 'public.fn_ca_backpay_guarantee_shortfalls(boolean,integer)' THEN
   -- Inside UPDATE public.tournaments: prize_pool and bounty_pool are the row's own.
   v_new := regexp_replace(v_def, c_pattern,
    'public.fn_ca_guarantee_place_floor(\1.id, prize_pool, \1.guaranteed_prize, bounty_pool)', 'g');
  ELSE
   v_new := regexp_replace(v_def, c_pattern,
    'public.fn_ca_guarantee_place_floor(\1.id, \1.prize_pool, \1.guaranteed_prize, \1.bounty_pool)', 'g');
  END IF;
  IF position('fn_ca_place_guarantee(' IN v_new) > 0 THEN
   RAISE EXCEPTION 'an unpatched place guarantee remains in %', f;
  END IF;
  EXECUTE v_new;
 END LOOP;

 -- The aggregate the lobby and Rewards tab read: add the gross terms.
 v_def := pg_get_functiondef('public.fn_ca_tournament_prize_funding(uuid)'::regprocedure);
 IF (length(v_def) - length(replace(v_def, $q$'overlay', greatest(0, round(e.overlay_in, 2)))$q$, ''))) /
    length($q$'overlay', greatest(0, round(e.overlay_in, 2)))$q$) <> 1 THEN
  RAISE EXCEPTION 'fn_ca_tournament_prize_funding anchor not found exactly once; refusing to patch';
 END IF;
 EXECUTE replace(v_def, $q$'overlay', greatest(0, round(e.overlay_in, 2)))$q$,
  $q$'overlay', greatest(0, round(e.overlay_in, 2)))
    || public.fn_ca_guarantee_funding(t.id)
    || jsonb_build_object('prize_pool', round(coalesce(t.prize_pool, 0), 2),
         'bounty_pool', round(coalesce(t.bounty_pool, 0), 2),
         'rake', round(coalesce(t.total_rake, 0), 2),
         'finalized', coalesce(t.prize_pool_finalized, false))$q$);
END
$patch$;

DO $post$
DECLARE r jsonb;
BEGIN
 IF has_function_privilege('authenticated', 'public.fn_ca_guarantee_funding(uuid)', 'EXECUTE')
  OR NOT has_function_privilege('authenticated', 'public.fn_ca_tournament_prize_funding(uuid)', 'EXECUTE') THEN
  RAISE EXCEPTION 'guarantee funding privileges drifted';
 END IF;
 -- Owner example arithmetic (pure): 13 x 40 against 500 is zero; 10 x 40 is 100.
 IF greatest(0, 500 - 13 * 40) <> 0 OR greatest(0, 500 - 10 * 40) <> 100 THEN
  RAISE EXCEPTION 'owner example arithmetic';
 END IF;
END $post$;

COMMIT;
