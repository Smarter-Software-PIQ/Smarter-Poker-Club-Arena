-- 20261102202312_weekly_payout_claims_strict_with_truthful_empty_fleet
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-02 20:23:13 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
-- Say what was wrong, what this changes, and what you measured. A
-- migration whose header is its own filename is the next agent's mystery.
-- WEEKLY PAYOUT CLAIMS ARE STRICT AGAIN, AND AN EMPTY FLEET IS A TRUTHFUL CLAIM (2026-11-02).
-- 20261028162126's weekly_payout_claims_match refused any empty claim list
-- before comparing it with the live leases. On 2026-11-02 the engine
-- acknowledged the payout boundary while no cash table or tournament held a
-- live lease (the games were paused), reported that truthfully as an empty
-- list, and was refused with weekly_payout_complete_original_fleet_required
-- at every slot. The owner-override repair of that day (recorded by
-- 20261102192634) relaxed the comparison to accept any array, which also
-- accepted a list that omits a live lease. Diagnostics of both later
-- acknowledgments (17:45 and 18:05 UTC) show 0 claims, 0 unclaimed cash or
-- tournament leases, 0 claims without a lease and no live instance: the only
-- refusal was the empty-list rule. This restores 20261028162126's comparison
-- byte for byte except that rule: an empty list now passes only through the
-- unchanged coverage test, i.e. only when no live lease exists anywhere.
-- weekly_payout_record_claims calls this function, so its strict_match column
-- records the strict verdict again.
-- Installs only after 20261102192634 (which records the relaxed body).
-- @live-proof: position('AN EMPTY FLEET IS A TRUTHFUL CLAIM' IN pg_get_functiondef('smarter_private.weekly_payout_claims_match(text,jsonb)'::regprocedure))>0 AND position('lease_generation' IN pg_get_functiondef('smarter_private.weekly_payout_claims_match(text,jsonb)'::regprocedure))>0
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
DO $guard$ BEGIN
 IF NOT EXISTS(SELECT FROM supabase_migrations.schema_migrations WHERE version='20261102192634')
 THEN RAISE EXCEPTION 'install_20261102192634_first'; END IF;
 IF md5(pg_get_functiondef('smarter_private.weekly_payout_claims_match(text,jsonb)'::regprocedure))<>'1a631143dc3389bc481acf82ecbe13fd'
  AND position('AN EMPTY FLEET IS A TRUTHFUL CLAIM' IN pg_get_functiondef('smarter_private.weekly_payout_claims_match(text,jsonb)'::regprocedure))=0
 THEN RAISE EXCEPTION 'weekly_payout_claims_match_preimage_changed'; END IF;
 IF EXISTS(SELECT FROM public.weekly_accounting_payout_pauses WHERE phase IN('draining','ready','paying'))
 THEN RAISE EXCEPTION 'claims_rule_changes_wait_for_the_weekly_payout'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_claims_match(p_instance text,p_claims jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $f$
BEGIN
 -- AN EMPTY FLEET IS A TRUTHFUL CLAIM (20261102202312): an empty list is not
 -- refused here; it passes only if the coverage test below finds no live lease.
 IF NULLIF(btrim(p_instance),'') IS NULL OR jsonb_typeof(p_claims) IS DISTINCT FROM 'array' THEN RETURN false;END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(p_claims) j
   WHERE j->>'scope' NOT IN('cash','tournament') OR j->>'scope' IS NULL OR j->>'lease_generation' IS NULL
    OR CASE WHEN j->>'scope'='cash' THEN j->>'table_id' IS NULL OR j->>'tournament_id' IS NOT NULL
      ELSE j->>'tournament_id' IS NULL OR j->>'table_id' IS NOT NULL END)
  OR EXISTS(SELECT FROM jsonb_array_elements(p_claims) j GROUP BY j->>'scope',COALESCE(j->>'table_id',j->>'tournament_id') HAVING count(*)<>1)
 THEN RETURN false;END IF;
 -- A single current process must account for the complete live fleet. An
 -- unknown second process is an explicit refusal, never an omitted scope.
 IF EXISTS(SELECT FROM public.engine_table_leases l
   WHERE l.heartbeat_at>=smarter_private.weekly_payout_clock()-interval '30 seconds'
    AND (l.instance_id IS DISTINCT FROM p_instance OR l.protocol_version<>2
     OR NOT EXISTS(SELECT FROM jsonb_array_elements(p_claims) j
      WHERE j->>'scope'='cash' AND (j->>'table_id')::uuid=l.table_id
       AND (j->>'lease_generation')::uuid=l.lease_generation)))
  OR EXISTS(SELECT FROM public.engine_tournament_leases l
   WHERE l.heartbeat_at>=smarter_private.weekly_payout_clock()-interval '30 seconds'
    AND (l.instance_id IS DISTINCT FROM p_instance OR l.protocol_version<>2
     OR NOT EXISTS(SELECT FROM jsonb_array_elements(p_claims) j
      WHERE j->>'scope'='tournament' AND (j->>'tournament_id')::uuid=l.tournament_id
       AND (j->>'lease_generation')::uuid=l.lease_generation)))
 THEN RETURN false;END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(p_claims) j WHERE
  CASE WHEN j->>'scope'='cash' THEN NOT EXISTS(SELECT FROM public.engine_table_leases l
    WHERE l.table_id=(j->>'table_id')::uuid AND l.instance_id=p_instance
     AND l.lease_generation=(j->>'lease_generation')::uuid AND l.protocol_version=2
     AND l.heartbeat_at>=smarter_private.weekly_payout_clock()-interval '30 seconds')
   ELSE NOT EXISTS(SELECT FROM public.engine_tournament_leases l
    WHERE l.tournament_id=(j->>'tournament_id')::uuid AND l.instance_id=p_instance
     AND l.lease_generation=(j->>'lease_generation')::uuid AND l.protocol_version=2
     AND l.heartbeat_at>=smarter_private.weekly_payout_clock()-interval '30 seconds') END)
 THEN RETURN false;END IF;
 RETURN true;
END $f$;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_claims_match(text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
