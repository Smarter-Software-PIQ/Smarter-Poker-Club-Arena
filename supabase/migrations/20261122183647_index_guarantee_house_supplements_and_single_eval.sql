-- 20261122183647_index_guarantee_house_supplements_and_single_eval.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--   On 2026-11-22, ca-free-buy-funding-watch-15m timed out 12 times in 24 hours
--   (55-60 s per run against its 60 s statement_timeout), and
--   ca-guarantee-funding-variance-15m also hit a statement timeout inside
--   public.fn_ca_guarantee_house_supplements(uuid).
--
--   Live EXPLAIN (ANALYZE, BUFFERS) proved two compounding root causes:
--     1. public.ca_manual_adjustments (2,389 rows) had no index on
--        tournament_id, so PostgreSQL drove fn_ca_guarantee_house_supplements
--        from chip_ledger via BitmapAnd(idx_chip_ledger_union_promo_runway_legs,
--        idx_chip_ledger_correlation_id) - reading 53,111 index entries and
--        1,071 shared buffers (53.4 ms) per call even when 0 adjustments exist.
--     2. public.fn_ca_guarantee_funding(uuid) invoked
--        fn_ca_guarantee_house_supplements(p_tournament_id) TWICE per
--        tournament (once in CTE v, once in SELECT jsonb_build_object),
--        producing 856 calls across 428 guaranteed tournaments (~45.7 s).
--
--   Permanent fix:
--     1. Add a partial CONCURRENTLY index on ca_manual_adjustments(tournament_id)
--        for settled player_wallet rows (built outside BEGIN; with zero table
--        write lock).
--     2. Materialize the ca_manual_adjustments lookup first in
--        fn_ca_guarantee_house_supplements(uuid) so the 0-row common case
--        short-circuits in ~0.02 ms without touching chip_ledger.
--     3. Evaluate fn_ca_guarantee_house_supplements(p_tournament_id) once in
--        a CTE inside fn_ca_guarantee_funding(uuid) with identical JSONB output.
--
-- @replaces-md5: public.fn_ca_guarantee_house_supplements(uuid)=bdf5961d524f0ee36c0e6688c1131043
-- @replaces-md5: public.fn_ca_guarantee_funding(uuid)=283ce3e0985134ee4e106a3a12213366
-- @probe-for: public.fn_ca_guarantee_house_supplements
-- @probe-for: public.fn_ca_guarantee_funding
-- @live-proof: EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'idx_ca_manual_adjustments_settled_player_wallet_tournament' AND i.indisvalid AND i.indisready) AND strpos(pg_get_functiondef('public.fn_ca_guarantee_house_supplements(uuid)'::regprocedure), 'WITH adj AS MATERIALIZED') > 0 AND (length(pg_get_functiondef('public.fn_ca_guarantee_funding(uuid)'::regprocedure)) - length(replace(pg_get_functiondef('public.fn_ca_guarantee_funding(uuid)'::regprocedure), 'fn_ca_guarantee_house_supplements(', ''))) / length('fn_ca_guarantee_house_supplements(') = 1

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ca_manual_adjustments_settled_player_wallet_tournament
  ON public.ca_manual_adjustments (tournament_id)
  WHERE status = 'settled' AND target_kind = 'player_wallet' AND tournament_id IS NOT NULL;

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.fn_ca_guarantee_house_supplements(p_tournament_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 WITH adj AS MATERIALIZED (
  SELECT a.id, a.tournament_id, a.target_id, a.amount
    FROM public.ca_manual_adjustments a
   WHERE a.tournament_id = p_tournament_id
     AND a.status = 'settled'
     AND a.target_kind = 'player_wallet'
 )
 SELECT coalesce(sum(l.amount), 0)
   FROM adj a
   JOIN public.chip_ledger l ON l.correlation_id = a.id
   JOIN public.wallet_credit_idempotency c ON c.key = l.idempotency_key
  WHERE a.target_id = c.user_id
    AND a.amount = c.amount
    AND c.amount = l.amount
    AND l.to_type = 'player_wallet'
    AND l.to_entity_id = c.user_id
    AND l.from_type = 'union_wallet'
    AND l.from_label = 'union_wallets.promo_wallet'
    AND l.from_entity_id = (SELECT t.union_id FROM public.tournaments t WHERE t.id = p_tournament_id)
    AND l.category = 'settlement'
    AND coalesce(l.status, 'posted') = 'posted'
    AND l.tournament_id IS NULL
    AND l.idempotency_key = 'net-guarantee-house:' || p_tournament_id::text || ':' || c.user_id::text;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_guarantee_house_supplements(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_guarantee_house_supplements(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_ca_guarantee_funding(p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 WITH t AS (
  SELECT x.id, round(greatest(coalesce(x.guaranteed_prize, 0), 0), 2) AS g, round(greatest(coalesce(x.total_rake, 0), 0), 2) AS rake
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
 ), sup AS (
  SELECT public.fn_ca_guarantee_house_supplements(p_tournament_id) AS paid
 ), v AS (
  SELECT t.g,
         round(greatest(0, s.paid_in - s.paid_back), 2) AS gross,
         round(greatest(0, s.paid_in - s.paid_back - t.rake), 2) AS c,
         round(s.house_in - s.house_out + sup.paid, 2) AS p,
         sup.paid AS house_supplement_paid
    FROM t, s, sup
 )
 SELECT jsonb_build_object(
  'guarantee', v.g,
  'gross_coverage', v.gross,
  'net_coverage', v.c,
  'house_required', greatest(0, v.g - v.c),
  'house_posted', v.p,
  'house_supplement_paid', v.house_supplement_paid,
  'house_due', greatest(0, greatest(0, v.g - v.c) - v.p),
  'house_over_required', greatest(0, v.p - greatest(0, v.g - v.c)))
 FROM v;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_guarantee_funding(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_guarantee_funding(uuid) TO service_role;

-- @probe-for: public.fn_ca_guarantee_house_supplements
DO $probe_sup$
BEGIN
  PERFORM public.fn_ca_guarantee_house_supplements('00000000-0000-0000-0000-000000000000'::uuid);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_sup$;

-- @probe-for: public.fn_ca_guarantee_funding
DO $probe_fund$
BEGIN
  PERFORM public.fn_ca_guarantee_funding('00000000-0000-0000-0000-000000000000'::uuid);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_fund$;

COMMIT;
