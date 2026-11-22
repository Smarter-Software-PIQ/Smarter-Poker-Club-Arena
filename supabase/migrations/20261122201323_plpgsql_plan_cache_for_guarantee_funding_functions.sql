-- 20261122201323_plpgsql_plan_cache_for_guarantee_funding_functions.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--   Live verification after 20261122183647 proved that although execution of
--   fn_ca_guarantee_house_supplements(uuid) dropped to 0.103 ms (6 buffer hits)
--   and fn_ca_guarantee_funding(uuid) chip_ledger scan executes in 1.27 ms,
--   ca-guarantee-funding-variance-15m still took 49.38 s (20:07Z) and
--   ca-free-buy-funding-watch-15m still took 55.88 s (20:11Z).
--
--   Live EXPLAIN (ANALYZE, BUFFERS) proved the remaining root cause:
--   both functions were LANGUAGE sql with SECURITY DEFINER + SET search_path,
--   which prevents PostgreSQL from inlining them AND prevents plan caching
--   across calls. Across 428 guaranteed tournaments in 14 days, PostgreSQL
--   spent 11.5 ms (2,373 buffer hits) + 6.1 ms (1,255 buffer hits) per call
--   re-planning all 45+ indexes on public.chip_ledger (~92% of total runtime).
--
--   Permanent fix:
--     1. Convert public.fn_ca_guarantee_house_supplements(uuid) to LANGUAGE
--        plpgsql (session SPIPlan cache) with an immediate IF NOT EXISTS
--        short-circuit against idx_ca_manual_adjustments_settled_player_wallet_tournament
--        (verified Index Only Scan in live EXPLAIN (GENERIC_PLAN), cost 0.28..3.95)
--        so the 0-row common case never plans or touches public.chip_ledger.
--     2. Convert public.fn_ca_guarantee_funding(uuid) to LANGUAGE plpgsql
--        (session SPIPlan cache; verified Bitmap Index Scan on
--        idx_chip_ledger_to_entity + idx_chip_ledger_from_entity_created in
--        live EXPLAIN (GENERIC_PLAN)) while preserving identical JSONB output
--        and service_role-only EXECUTE grants.
--
-- @replaces-md5: public.fn_ca_guarantee_house_supplements(uuid)=4dee69fddf07fca2ced3d74c3ca40130
-- @replaces-md5: public.fn_ca_guarantee_funding(uuid)=8e7786d2695844829a40b9e17c8c202a
-- @probe-for: public.fn_ca_guarantee_house_supplements
-- @probe-for: public.fn_ca_guarantee_funding
-- @live-proof: EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = 'public.fn_ca_guarantee_house_supplements(uuid)'::regprocedure AND l.lanname = 'plpgsql') AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = 'public.fn_ca_guarantee_funding(uuid)'::regprocedure AND l.lanname = 'plpgsql') AND strpos(pg_get_functiondef('public.fn_ca_guarantee_house_supplements(uuid)'::regprocedure), 'IF NOT EXISTS') > 0 AND (length(pg_get_functiondef('public.fn_ca_guarantee_funding(uuid)'::regprocedure)) - length(replace(pg_get_functiondef('public.fn_ca_guarantee_funding(uuid)'::regprocedure), 'fn_ca_guarantee_house_supplements(', ''))) / length('fn_ca_guarantee_house_supplements(') = 1

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.fn_ca_guarantee_house_supplements(p_tournament_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_total numeric;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.ca_manual_adjustments a
     WHERE a.tournament_id = p_tournament_id
       AND a.status = 'settled'
       AND a.target_kind = 'player_wallet'
  ) THEN
    RETURN 0;
  END IF;

  WITH adj AS MATERIALIZED (
    SELECT a.id, a.tournament_id, a.target_id, a.amount
      FROM public.ca_manual_adjustments a
     WHERE a.tournament_id = p_tournament_id
       AND a.status = 'settled'
       AND a.target_kind = 'player_wallet'
  )
  SELECT coalesce(sum(l.amount), 0)
    INTO v_total
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

  RETURN coalesce(v_total, 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_guarantee_house_supplements(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_guarantee_house_supplements(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_ca_guarantee_funding(p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_sup numeric;
BEGIN
  v_sup := public.fn_ca_guarantee_house_supplements(p_tournament_id);

  WITH t AS (
    SELECT x.id,
           round(greatest(coalesce(x.guaranteed_prize, 0), 0), 2) AS g,
           round(greatest(coalesce(x.total_rake, 0), 0), 2) AS rake
      FROM public.tournaments x
     WHERE x.id = p_tournament_id
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
    SELECT t.g,
           round(greatest(0, s.paid_in - s.paid_back), 2) AS gross,
           round(greatest(0, s.paid_in - s.paid_back - t.rake), 2) AS c,
           round(s.house_in - s.house_out + v_sup, 2) AS p
      FROM t, s
  )
  SELECT jsonb_build_object(
    'guarantee', v.g,
    'gross_coverage', v.gross,
    'net_coverage', v.c,
    'house_required', greatest(0, v.g - v.c),
    'house_posted', v.p,
    'house_supplement_paid', v_sup,
    'house_due', greatest(0, greatest(0, v.g - v.c) - v.p),
    'house_over_required', greatest(0, v.p - greatest(0, v.g - v.c)))
    INTO v_result
    FROM v;

  RETURN v_result;
END;
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
