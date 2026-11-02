-- 20261102142022_stall_recovery_requires_complete_telemetry
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-02 14:20:22 UTC.
--
-- Phase1 deep audit reproduced an incomplete telemetry body resolving an
-- episode: two recorded hands plus a missing uptime scalar bypassed every
-- freshness guard. The observer defaulted to "can resolve" when it could not
-- know. Require exactly one valid uptime, instance, active count, stalled count
-- and maintenance scalar before any observation transition. Invalid/missing or
-- duplicate witnesses enter the existing failed-observation path; original
-- episodes and watches remain intact. Numeric overflow also uses that path
-- instead of aborting the observer tick. A bounded maintenance pause cannot
-- certify recovery merely because the table samples disappeared, even when
-- two hands were recorded immediately before the pause. Both cases reproduced
-- against the previous final body. No gameplay, money, schedule or historical
-- state is changed. The existing required PostgreSQL gate tests the final body.
-- @live-proof: position('metrics missing or ambiguous recovery witnesses' IN pg_get_functiondef('public.fn_ca_table_stall_watch_ingest(text,timestamptz,bigint)'::regprocedure)) > 0

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
DO $migration$
DECLARE
  v_def text := pg_get_functiondef('public.fn_ca_table_stall_watch_ingest(text,timestamptz,bigint)'::regprocedure);
  v_anchor text := $anchor$  v_uptime := (regexp_match(p_body, E'\npoker_uptime_seconds ([0-9.]+)'))[1]::numeric;$anchor$;
  v_parse_end text := $anchor$  v_maint := COALESCE((regexp_match(p_body, E'\npoker_maintenance_break_active (\\d)'))[1] = '1', false);$anchor$;
  v_guard text := $guard$  -- Recovery requires complete, unambiguous telemetry, never null-as-healthy.
  IF NOT (
    p_body ~ E'\npoker_uptime_seconds [0-9]+(\\.[0-9]+)?(\n|$)'
    AND p_body ~ E'\npoker_engine_info\\{instance_id="[^"]+"'
    AND p_body ~ E'\npoker_active_tables [0-9]+(\n|$)'
    AND p_body ~ E'\npoker_fleet_tables_stalled [0-9]+(\n|$)'
    AND p_body ~ E'\npoker_maintenance_break_active [01](\n|$)'
    AND regexp_count(p_body, E'\npoker_uptime_seconds ') = 1
    AND regexp_count(p_body, E'\npoker_engine_info\\{') = 1
    AND regexp_count(p_body, E'\npoker_active_tables ') = 1
    AND regexp_count(p_body, E'\npoker_fleet_tables_stalled ') = 1
    AND regexp_count(p_body, E'\npoker_maintenance_break_active ') = 1
  ) THEN
    RETURN public.fn_ca_table_stall_watch_failed(p_now, 'metrics missing or ambiguous recovery witnesses', NULL);
  END IF;
  BEGIN
$guard$;
BEGIN
  IF (length(v_def)-length(replace(v_def,v_anchor,''))) / length(v_anchor) <> 1
     OR position('metrics missing or ambiguous recovery witnesses' IN v_def) > 0
     OR position('previous_progress_hand_id' IN v_def) = 0 THEN
    RAISE EXCEPTION 'expected exactly one qualified sustained-recovery parser';
  END IF;
  v_def := replace(v_def, v_anchor, v_guard || v_anchor);
  IF (length(v_def)-length(replace(v_def,v_parse_end,''))) / length(v_parse_end) <> 1 THEN
    RAISE EXCEPTION 'expected exactly one qualified telemetry parser end';
  END IF;
  v_def := replace(v_def, v_parse_end, v_parse_end || $parse$
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN public.fn_ca_table_stall_watch_failed(p_now, 'metrics contain an invalid recovery scalar', NULL);
  END;
$parse$);
  v_anchor := '  IF v_can_resolve THEN';
  IF (length(v_def)-length(replace(v_def,v_anchor,''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'expected exactly one qualified recovery transition';
  END IF;
  EXECUTE replace(v_def, v_anchor, $pause$  IF v_maint THEN
    v_can_resolve := false;
    v_note := COALESCE(v_note, 'maintenance does not certify recovery');
  END IF;
$pause$ || v_anchor);
END;
$migration$;
COMMIT;
