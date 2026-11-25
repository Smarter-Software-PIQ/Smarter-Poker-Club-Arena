-- 20261123072039_a_settled_mystery_bounty_pool_residual_earns_from_the_champi.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Incidents 5a481316-fd59-42ef-a58e-bce826ab295a (Tournament.atomic_finish_refused),
-- ff3327bf-8ad1-4d42-a063-8954dc644815 (fn_ca_tournament_finished_but_not_completed),
-- and 904018b7-d518-4ca7-88e8-d2dd23205dcb (MttPlayStopped) all fired on live
-- Mystery Bounty tournament 5f8a23ea ("Prime Time Free Buy (NLH)", bounty_amount 0.50,
-- bounty_pool 902.50, mystery_bounty_pool_cents 90200).
--
-- In an activated Mystery Bounty tournament, every entry, rebuy and add-on bounty
-- goes into the shared mystery bounty pool. fn_mystery_bounty_seed cuts whole-chip
-- ($1.00) chests totaling 902.00, leaving a 0.50 sub-chip rounding remainder in
-- tournaments.bounty_pool. After fn_mystery_bounty_settle completes and records
-- tournament_bounty_completion_receipts.mystery_settled_at, fn_finalize_bounty_pool
-- settles the 0.50 shared-pool remainder to the champion as kind='bounty_residual',
-- place=NULL.
--
-- Promo Play Through's obligation trigger fn_ca_promo_profit_capture_obligation_earning
-- previously routed EVERY kind IN ('bounty_residual', 'own_bounty') to
-- fn_ca_promo_profit_capture_residual_head, which requires the sum of the winner's
-- unretired ca_promo_profit_head_components to equal the residual amount. When a
-- Mystery Bounty champion's winning generation holds head components that do not
-- equal the whole-chip rounding remainder (e.g. 5f8a23ea champion bought both a 0.50
-- rebuy and a 0.50 add-on = 1.00 != 0.50, or any non-integer bounty_amount != remainder),
-- fn_ca_promo_profit_capture_residual_head raises original_residual_head_components_missing
-- and rolls back terminal completion forever.
--
-- Just like 20261117184500 did for unclaimed mystery chests (kind='mystery_bounty'),
-- a settled Mystery Bounty pool residual is earned by winning the tournament from the
-- champion's own current entry generation, not by returning a PKO head container.
-- This migration routes ONLY that exact case through the existing own-entry branch:
--   - NEW.kind = 'bounty_residual' and NEW.place IS NULL
--   - no knockout context (app.bounty_obligation_id is empty)
--   - tournament has is_mystery_bounty = true and mystery_bounty_stage IN ('active', 'complete')
--   - tournament_bounty_completion_receipts has mystery_settled_at IS NOT NULL for that champion
--   - recipient is the tournament's single recorded winner (status='winner', position=1)
-- Every PKO, regular bounty, unactivated ('pending') Mystery Bounty, own_bounty,
-- non-winner, multi-winner, placed, or knockout-context residual still routes to
-- fn_ca_promo_profit_capture_residual_head with all existing head-component checks intact.
-- No money, ledger, obligation or settlement row is touched.
--
-- @live-proof: EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='public.fn_ca_promo_profit_capture_obligation_earning()'::regprocedure AND position($a$NOT (NEW.kind='bounty_residual' AND NEW.place IS NULL AND NULLIF(current_setting('app.bounty_obligation_id',true),'') IS NULL$a$ IN pg_get_functiondef(p.oid))>0 AND p.proowner='postgres'::regrole AND p.prosecdef AND p.proacl::text='{postgres=X/postgres}')

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';

DO $mystery_pool_residual$
DECLARE
  d text;
  before_anchor text;
  after_anchor text;
BEGIN
  d := pg_get_functiondef('public.fn_ca_promo_profit_capture_obligation_earning()'::regprocedure);
  before_anchor := $a$ IF NEW.kind IN('bounty_residual','own_bounty') THEN
  PERFORM public.fn_ca_promo_profit_capture_residual_head(NEW.id,NEW.tournament_id,NEW.user_id,lo,NEW.amount_owed);
  RETURN NULL;
 END IF;$a$;
  after_anchor := $a$ IF NEW.kind IN('bounty_residual','own_bounty') AND NOT (NEW.kind='bounty_residual' AND NEW.place IS NULL AND NULLIF(current_setting('app.bounty_obligation_id',true),'') IS NULL
   AND EXISTS(SELECT 1 FROM public.tournaments mt WHERE mt.id=NEW.tournament_id AND COALESCE(mt.is_mystery_bounty,false) AND mt.mystery_bounty_stage IN('active','complete'))
   AND EXISTS(SELECT 1 FROM public.tournament_bounty_completion_receipts rc WHERE rc.tournament_id=NEW.tournament_id AND rc.winner_user_id=NEW.user_id AND rc.mystery_settled_at IS NOT NULL)
   AND EXISTS(SELECT 1 FROM public.tournament_players mw WHERE mw.tournament_id=NEW.tournament_id AND mw.user_id=NEW.user_id AND mw.status='winner' AND mw.position=1)
   AND (SELECT count(*) FROM public.tournament_players mw WHERE mw.tournament_id=NEW.tournament_id AND mw.status='winner' AND mw.position=1)=1) THEN
  PERFORM public.fn_ca_promo_profit_capture_residual_head(NEW.id,NEW.tournament_id,NEW.user_id,lo,NEW.amount_owed);
  RETURN NULL;
 END IF;$a$;

  IF (length(d) - length(replace(d, after_anchor, ''))) / length(after_anchor) = 1
     AND position(before_anchor IN d) = 0 THEN
    RETURN; -- already installed: idempotent
  END IF;
  IF (length(d) - length(replace(d, before_anchor, ''))) / length(before_anchor) <> 1 THEN
    RAISE EXCEPTION 'MYSTERY_POOL_RESIDUAL_ANCHOR_NOT_EXACTLY_ONCE';
  END IF;

  EXECUTE replace(d, before_anchor, after_anchor);

  d := pg_get_functiondef('public.fn_ca_promo_profit_capture_obligation_earning()'::regprocedure);
  IF position(after_anchor IN d) = 0 OR position(before_anchor IN d) > 0 THEN
    RAISE EXCEPTION 'MYSTERY_POOL_RESIDUAL_NOT_INSTALLED';
  END IF;
END $mystery_pool_residual$;

REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_capture_obligation_earning() FROM PUBLIC, anon, authenticated, service_role;

-- @probe-exempt: public.fn_ca_promo_profit_capture_obligation_earning trigger function (RETURNS trigger) cannot be called directly; covered by plpgsql_check and scripts/ci/test-promo-mystery-bounty-pool-residual.py

COMMIT;
