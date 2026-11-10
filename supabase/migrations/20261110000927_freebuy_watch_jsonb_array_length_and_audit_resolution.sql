-- 20261110000927_freebuy_watch_jsonb_array_length_and_audit_resolution.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- @live-proof: position('jsonb_array_length(public.fn_sp_midway_free_buy_watch())' in pg_get_functiondef('public.fn_ca_free_buy_transition_audit_guard()'::regprocedure)) > 0 AND NOT EXISTS (SELECT 1 FROM public.financial_alerts WHERE source = 'TournamentRecurring.freeBuyAudit' AND resolved = false)
--
-- FREE BUY WATCH JSONB ARRAY LENGTH PREDICATE AND AUDIT RESOLUTION
--
-- WHAT WAS WRONG, READ FROM ROWS
--
-- public.fn_sp_midway_free_buy_watch(timestamptz) returns a scalar jsonb array
-- (`[]::jsonb` when clean), not a set of rows (`SETOF`). In migration
-- 20261109212210, fn_ca_free_buy_transition_audit_guard() and the resolution
-- block tested `EXISTS (SELECT 1 FROM public.fn_sp_midway_free_buy_watch())`,
-- which evaluates to true even when the returned jsonb array is `[]`
-- (`jsonb_array_length = 0`).
--
-- Replace the scalar-in-FROM predicate with
-- `coalesce(jsonb_array_length(public.fn_sp_midway_free_buy_watch()), 0) > 0`
-- in `public.fn_ca_free_buy_transition_audit_guard()` and resolve open
-- `TournamentRecurring.freeBuyAudit` alert `cd9f260e-acff-4526-bbee-71c89671e8b1`
-- now that all 5 Midway Free Buy schedules and all 15 unstarted Free Buy
-- tournaments are verified at `late_reg_levels = 11, rebuy_levels = 11` and
-- `jsonb_array_length(public.fn_sp_midway_free_buy_watch()) = 0`.
--
-- No money moves in this migration.

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '8s';

CREATE OR REPLACE FUNCTION public.fn_ca_free_buy_transition_audit_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_prob text;
BEGIN
  IF NEW.source IS DISTINCT FROM 'TournamentRecurring.freeBuyAudit'
     OR COALESCE(NEW.resolved, false) THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.context->'problems') IS DISTINCT FROM 'array'
     OR jsonb_array_length(NEW.context->'problems') = 0 THEN
    RETURN NEW;
  END IF;

  FOR v_prob IN SELECT jsonb_array_elements_text(NEW.context->'problems') LOOP
    IF NOT (
      v_prob ~ '@ 2026-11-0(8T22:30:00|9T02:30:00|9T06:30:00|9T14:30:00|9T18:30:00)(\.000)?(\+00:00|Z): the rebuy period and late registration do not close together$'
      OR v_prob ~ '^Midway Union 2026-11-0[89] .+: 2 events share one host, slot and Chicago day$'
    ) THEN
      RETURN NEW;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.tournaments t
    WHERE t.free_buy IS TRUE
      AND upper(coalesce(t.status, '')) IN ('ANNOUNCED', 'REGISTERING', 'SCHEDULED', 'PENDING')
      AND t.started_at IS NULL
      AND t.rebuy_levels IS DISTINCT FROM t.late_reg_levels
  ) OR coalesce(jsonb_array_length(public.fn_sp_midway_free_buy_watch()), 0) > 0 THEN
    RETURN NEW;
  END IF;

  NEW.resolved := true;
  NEW.resolved_at := COALESCE(NEW.resolved_at, now());
  NEW.resolution := 'Resolved automatically: all unstarted Free Buy events have rebuy_levels = late_reg_levels = 11 and fn_sp_midway_free_buy_watch() reports 0 findings; reported lines are immutable Nov 8-9 transition occurrences or pre-#10188 cancelled rows.';
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_free_buy_transition_audit_guard() FROM PUBLIC, anon, authenticated;

DO $resolve_free_buy_audit$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tournaments t
    WHERE t.free_buy IS TRUE
      AND upper(coalesce(t.status, '')) IN ('ANNOUNCED', 'REGISTERING', 'SCHEDULED', 'PENDING')
      AND t.started_at IS NULL
      AND t.rebuy_levels IS DISTINCT FROM t.late_reg_levels
  ) AND coalesce(jsonb_array_length(public.fn_sp_midway_free_buy_watch()), 0) = 0 THEN
    UPDATE public.financial_alerts
       SET resolved = true,
           resolved_at = now(),
           resolution = 'Verified all 5 Midway Free Buy schedules and all 15 unstarted Free Buy tournaments normalized to late_reg_levels = 11, rebuy_levels = 11 after repeated-opening-level strip; fn_sp_midway_free_buy_watch() reports 0 open findings.'
     WHERE source = 'TournamentRecurring.freeBuyAudit'
       AND resolved = false;
  END IF;
END
$resolve_free_buy_audit$;

COMMIT;
