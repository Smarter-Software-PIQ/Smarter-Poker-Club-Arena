-- 20261124150209_the_horse_error_log_table_is_part_of_the_schema_the_engine_w.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- @live-proof: (SELECT relrowsecurity FROM pg_class WHERE oid='public.horse_error_log'::regclass) AND has_table_privilege('service_role','public.horse_error_log','INSERT') AND NOT has_table_privilege('anon','public.horse_error_log','SELECT') AND NOT has_table_privilege('authenticated','public.horse_error_log','SELECT')
--
-- THE HORSE ERROR LOG TABLE IS PART OF THE SCHEMA THE ENGINE WRITES (2026-11-24).
--
-- services/HorseErrorLog.ts now writes public.horse_error_log (the table every
-- switch watch list reads as a rollback trigger, which had never held a row
-- because nothing wrote it). Production has the table; the migrations do not:
-- 20260905085612 dropped it as dead and nothing in supabase/migrations created
-- it again, so a database rebuilt from this repository would have no table and
-- every row would be a counted write failure. This states it, with production's
-- exact shape (read 2026-11-24: 0 rows, RLS on, no policy, no trigger).
--
-- On production the CREATE statements are no-ops. The grants become what the
-- writer needs and no more: the engine's service role inserts and the report
-- tooling reads (SELECT, INSERT; its UPDATE/DELETE/TRUNCATE go, nothing used
-- them); anon and authenticated lose a SELECT that RLS (no policy) already
-- denied, so nothing a client can see changes. No policy is added:
-- the service role bypasses RLS, and no browser reads this table.
--
-- One transaction, one schema-cache reload. Not a hot table.

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

CREATE TABLE IF NOT EXISTS public.horse_error_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  horse_id text,
  error_type text NOT NULL,
  error_message text,
  context jsonb DEFAULT '{}'::jsonb,
  stack_trace text,
  resolved boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT horse_error_log_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS horse_error_log_created_idx
  ON public.horse_error_log USING btree (created_at DESC);
ALTER TABLE public.horse_error_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.horse_error_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.horse_error_log TO service_role;

COMMENT ON TABLE public.horse_error_log IS
  'One row per Horse decision fallback, legalizer correction, Lightning fallback or decision worker failure, coalesced per minute (server/src/services/HorseErrorLog.ts). Public context only, never a card. Read by the switch watch lists as a rollback trigger.';

DO $verify$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.horse_error_log'::regclass) THEN
    RAISE EXCEPTION 'horse_error_log must keep row level security on';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.horse_error_log', 'INSERT')
     OR has_table_privilege('anon', 'public.horse_error_log', 'SELECT')
     OR has_table_privilege('authenticated', 'public.horse_error_log', 'SELECT')
     OR has_table_privilege('service_role', 'public.horse_error_log', 'DELETE') THEN
    RAISE EXCEPTION 'horse_error_log grants are not service-role only';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'horse_error_log'
         AND column_name IN ('horse_id','error_type','error_message','context','stack_trace','created_at')) <> 6 THEN
    RAISE EXCEPTION 'horse_error_log is missing a column the engine writes';
  END IF;
END
$verify$;

COMMIT;
