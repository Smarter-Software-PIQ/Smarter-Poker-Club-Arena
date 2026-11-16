-- 20261116200642_cash_throughput_cohorts_name_the_adopted_hourly_admission_co.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).
--
-- Needs ACCESS EXCLUSIVE (or SHARE / SHARE ROW EXCLUSIVE) on a hot table such as
-- clubs, tables or hand_history? Then it waits for the daily 04:00 America/Chicago
-- break (CLAUDE.md section 2 rule 10). Declare it with the rule's header line
-- "install-window: daily-maintenance" (prefixed "-- @", on a line of its own),
-- and optionally name the hot relations this file locks on a second header
-- line "locks: public.clubs, public.tables" (same "-- @" prefix, comma
-- separated, schema-qualified) so the installer sends files sharing a relation
-- together. The locks line orders only; it never widens a timeout.

-- Extend the existing catalog-only producer. Legacy consumers continue reading
-- their unchanged base fingerprint; modern consumers select the explicit contract.
-- No enablement, runtime admission, population, financial state or alert threshold changes.
-- @live-proof: (SELECT hourly_contract='cash-hourly-tables/v1' AND hourly_fingerprint IS NOT NULL FROM public.fn_lightning_admission_policy()) AND pg_get_function_result('public.fn_lightning_admission_policy()'::regprocedure) = 'TABLE(fingerprint bigint, hourly_contract text, hourly_fingerprint bigint)' AND NOT has_function_privilege('anon','public.fn_lightning_admission_policy()','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_lightning_admission_policy()','EXECUTE') AND has_function_privilege('service_role','public.fn_lightning_admission_policy()','EXECUTE')
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';
DO $preimage$
BEGIN
 IF md5(pg_get_functiondef('public.fn_lightning_admission_policy()'::regprocedure))
    IS DISTINCT FROM '8b1d877338264be5c33af423d5fbd2ad' THEN
  RAISE EXCEPTION 'cash_admission_policy_preimage_changed';
 END IF;
END $preimage$;
-- PostgreSQL cannot add OUT columns with CREATE OR REPLACE. This same-transaction
-- replacement retains the original RPC name, owner and service-only privilege.
DROP FUNCTION public.fn_lightning_admission_policy();
CREATE FUNCTION public.fn_lightning_admission_policy()
RETURNS TABLE(fingerprint bigint, hourly_contract text, hourly_fingerprint bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
SET statement_timeout = '5s'
AS $function$
 WITH definitions AS (
  SELECT signature,pg_get_functiondef(to_regprocedure(signature)) AS definition
  FROM (VALUES
   ('public.fn_cash_hourly_table_range(timestamp with time zone)'),
   ('public.fn_cash_hourly_table_census()'),
   ('public.fn_cash_hourly_table_excess(uuid)'),
   ('public.fn_cash_hourly_table_enabled()'),
   ('public.fn_cash_hourly_table_delay(uuid)'),
   ('public.fn_cash_hourly_table_drain_candidate()'),
   ('public.fn_cash_hourly_table_admit(uuid,uuid)'),
   ('public.fn_cash_hourly_table_admissions()'),
   ('public.fn_cash_hourly_table_close(uuid,uuid,text,uuid)'),
   ('public.fn_ca_horse_roster_seat_guard()'),
   ('public.fn_lightning_player_legality(uuid,timestamp with time zone,uuid[],jsonb)')
  ) AS inputs(signature)
 )
 SELECT ('x'||left(md5(pg_get_functiondef(to_regprocedure(
   'public.fn_lightning_horse_admit_paced(uuid,uuid,timestamp with time zone)'))),13))::bit(52)::bigint,
  'cash-hourly-tables/v1'::text,
  CASE WHEN count(definition)=11 THEN
   ('x'||left(md5(string_agg(signature||':'||definition,'|' ORDER BY signature)),13))::bit(52)::bigint
  END
 FROM definitions;
$function$;
REVOKE ALL ON FUNCTION public.fn_lightning_admission_policy() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_lightning_admission_policy() TO service_role;
COMMIT;
