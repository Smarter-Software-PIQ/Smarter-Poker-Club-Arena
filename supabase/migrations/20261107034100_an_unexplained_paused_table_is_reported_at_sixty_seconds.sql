-- The generic paused metric does not identify an authorized break. Once a table
-- reaches the reporting threshold, consult its specific wait facts.
-- @live-proof: public.fn_ca_table_stall_decide('{}'::jsonb,60000,'2026-11-07 03:35:00Z'::timestamptz,false,true) IS NULL AND public.fn_ca_table_stall_decide('{}'::jsonb,59999,'2026-11-07 03:35:00Z'::timestamptz,false,true) = 'engine_paused'
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $patch$
DECLARE
  definition text := pg_get_functiondef('public.fn_ca_table_stall_decide(jsonb,bigint,timestamptz,boolean,boolean)'::regprocedure);
  anchor constant text := 'IF COALESCE(p_engine_paused, false) AND p_ms < c_pause_bound';
BEGIN
  IF (length(definition) - length(replace(definition, anchor, ''))) <> length(anchor) THEN
    RAISE EXCEPTION 'Unexpected paused-table decision definition';
  END IF;
  EXECUTE replace(definition, anchor, 'IF COALESCE(p_engine_paused, false) AND p_ms < 60000');
END $patch$;

DO $proof$
DECLARE
  observed_at constant timestamptz := '2026-11-07 03:35:00Z';
BEGIN
  IF public.fn_ca_table_stall_decide('{}', 59999, observed_at, false, true) IS DISTINCT FROM 'engine_paused'
     OR public.fn_ca_table_stall_decide('{}', 60000, observed_at, false, true) IS NOT NULL
     OR public.fn_ca_table_stall_decide('{}', 60000, observed_at, true, true) IS DISTINCT FROM 'maintenance_break'
     OR public.fn_ca_table_stall_decide('{"operator_halt":true}', 60000, observed_at, false, true) IS DISTINCT FROM 'operator_halt' THEN
    RAISE EXCEPTION 'Paused-table reporting threshold or authorized wait changed';
  END IF;
END $proof$;
COMMIT;
