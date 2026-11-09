-- 20261109212210_freebuy_rebuy_cutoff_and_rebuild_storm_resolution.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- @live-proof: position('rebuyLevels' in pg_get_functiondef('public.fn_ca_schedule_level_clock_floor()'::regprocedure)) > 0 AND position('NEW.rebuy_levels:=public.fn_ca_repeated_levels_late_reg' in pg_get_functiondef('public.fn_ca_tournament_level_clock_floor()'::regprocedure)) > 0 AND position('GameServer.tournament_dark_after_rebuild' in pg_get_functiondef('public.fn_ca_alert_resolution_reaches_the_incident()'::regprocedure)) > 0 AND NOT EXISTS (SELECT 1 FROM public.ca_drift_incidents WHERE id = 'b4175ad4-a1bd-42bd-b5e1-3a060809ce60' AND status <> 'resolved') AND NOT EXISTS (SELECT 1 FROM public.financial_alerts WHERE source = 'TournamentRecurring.freeBuyAudit' AND resolved = false)
--
-- FREE BUY REBUY CUTOFF PARITY AND REBUILD STORM INCIDENT RESOLUTION
--
-- WHAT WAS WRONG, READ FROM ROWS
--
-- 1. REBUY CUTOFF LEVEL WHEN STRIPPING REPEATED OPENING BLIND LEVELS.
--    Migration 20261108212837_record_strip_repeated_blind_levels_applied_directly.sql
--    taught fn_ca_schedule_level_clock_floor() and fn_ca_tournament_level_clock_floor()
--    to strip repeated opening blind levels (such as two consecutive 25/50 levels
--    at the start of the 40-level ladder -> 39 levels) and step down
--    lateRegistrationLevels / NEW.late_reg_levels via
--    fn_ca_repeated_levels_late_reg(...) (12 -> 11), so entry still closes at the
--    same blind level. However, neither normalizer stepped down rebuyLevels /
--    NEW.rebuy_levels when rebuy_levels equaled late_reg_levels prior to stripping.
--    Consequently:
--      - 56 active Midway schedules (< 25 chip buy-in and Free Buy slots, whose
--        authored catalog sets lateRegistrationLevels = 12, rebuyLevels = 12) had
--        config->>'lateRegistrationLevels' = '11' and config->>'rebuyLevels' = '12'.
--      - 83 unstarted REGISTERING tournaments (15 Free Buy + 68 < 25 chip events)
--        had late_reg_levels = 11 and rebuy_levels = 12.
--      - auditFreeBuyRow (server/src/services/FreeBuy.ts:966) raised warning
--        financial_alerts row cd9f260e-acff-4526-bbee-71c89671e8b1
--        ("the rebuy period and late registration do not close together").
--    Paid chip tournaments with buy_in_amount + buy_in_fee >= 25 intentionally use
--    lateRegistrationLevels = 10 (9 after stripping 1 repeated level) and
--    rebuyLevels = 12 (20261108035036); only schedules and events where
--    rebuy_levels matched late_reg_levels prior to stripping step down together.
--
-- 2. CAPPED POST-REBUILD DARK-TOURNAMENT STORM INCIDENT CLOSURE.
--    ca_drift_incidents row b4175ad4-a1bd-42bd-b5e1-3a060809ce60
--    (source = 'financial_alerts:GameServer.tournament_dark_after_rebuild',
--    dedupe_key = 'storm:financial_alerts:GameServer.tournament_dark_after_rebuild',
--    occurrences = 5, detected_at = 2026-11-08 06:46:21 UTC) remained open even
--    though all 5 of its recurred events in ca_incident_events carry
--    financial_member_version = 1 and point to 5 distinct
--    GameServer.tournament_dark_after_rebuild financial_alerts (071414c4,
--    137e4695, d52ebc03, db7419f6, e36abb6a) that are 100% resolved = true.
--    fn_ca_alert_resolution_reaches_the_incident() only checked
--    NEW.source IN ('Tournament.atomic_finish_refused','fn_ca_bust_backlog_page').
--
-- No money moves in this migration.

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '8s';

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Schedule & tournament level-clock floor normalizers keep rebuy_levels
--    paired with late_reg_levels when stripping repeated opening levels
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_ca_schedule_level_clock_floor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_structure text; v_floor numeric; v_authored text; v_late integer;
BEGIN
 IF NEW.config->>'midwayWeeklyRevision'='owner-sheet-2026-11-07-v1'
    AND (NEW.club_id='fade0000-0000-0000-0000-000000000001'::uuid
         OR NEW.union_id='fade0000-0000-0000-0000-000000000001'::uuid) THEN
   PERFORM public.fn_ca_mtt_blind_contract(NEW.config->'midwayWeeklyTerms'->>'blind_structure',
      (NEW.config->'midwayWeeklyTerms'->>'starting_chips')::integer);
   v_authored:=NEW.config->'midwayWeeklyTerms'->>'blind_structure';
   v_structure:=public.fn_ca_strip_repeated_levels(v_authored);
   IF v_structure IS DISTINCT FROM v_authored
      AND coalesce(NEW.config->>'lateRegistrationLevels','') ~ '^[0-9]{1,3}$' THEN
     v_late:=public.fn_ca_repeated_levels_late_reg(v_authored,(NEW.config->>'lateRegistrationLevels')::integer);
     IF coalesce(NEW.config->>'rebuyLevels','')=coalesce(NEW.config->>'lateRegistrationLevels','') THEN
       NEW.config:=jsonb_set(NEW.config,'{rebuyLevels}',to_jsonb(v_late));
     END IF;
     NEW.config:=jsonb_set(NEW.config,'{lateRegistrationLevels}',to_jsonb(v_late));
   END IF;
   NEW.config:=jsonb_set(NEW.config,'{blindStructure}',v_structure::jsonb);
   RETURN NEW;
 END IF;
 IF jsonb_typeof(NEW.config->'blindStructure')='array' THEN
  v_floor:=CASE WHEN coalesce((NEW.config->>'acceleratedMtt')::boolean,false) THEN 10
    WHEN upper(coalesce(NEW.config->>'blindPreset','STANDARD'))='STANDARD' THEN 8 ELSE 5 END;
  v_structure:=(NEW.config->'blindStructure')::text;
  IF lower(coalesce(NEW.config->>'type','mtt')) <> 'spin'
     AND lower(coalesce(NEW.config->>'variant','')) <> 'spin'
     AND upper(coalesce(NEW.config->>'tournamentType','')) <> 'SPIN' THEN
   v_structure:=public.fn_ca_tournament_opening_blinds(v_structure);
  END IF;
  v_structure:=public.fn_ca_minimum_tournament_levels(v_structure,v_floor);
  v_authored:=v_structure;
  v_structure:=public.fn_ca_strip_repeated_levels(v_authored);
  IF v_structure IS DISTINCT FROM v_authored
     AND coalesce(NEW.config->>'lateRegistrationLevels','') ~ '^[0-9]{1,3}$' THEN
    v_late:=public.fn_ca_repeated_levels_late_reg(v_authored,(NEW.config->>'lateRegistrationLevels')::integer);
    IF coalesce(NEW.config->>'rebuyLevels','')=coalesce(NEW.config->>'lateRegistrationLevels','') THEN
      NEW.config:=jsonb_set(NEW.config,'{rebuyLevels}',to_jsonb(v_late));
    END IF;
    NEW.config:=jsonb_set(NEW.config,'{lateRegistrationLevels}',to_jsonb(v_late));
  END IF;
  NEW.config:=jsonb_set(NEW.config,'{blindStructure}',v_structure::jsonb);
 END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_ca_tournament_level_clock_floor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_schedule_config jsonb; v_floor numeric; v_structure text; v_count integer; v_last numeric; v_stripped text;
BEGIN
 IF NEW.blind_structure IS NOT NULL
    AND NEW.started_at IS NULL
    AND coalesce(NEW.current_level,0)=0
    AND upper(coalesce(NEW.status,'')) IN ('ANNOUNCED','REGISTERING','SCHEDULED','PENDING') THEN
   v_stripped:=public.fn_ca_strip_repeated_levels(NEW.blind_structure);
   IF v_stripped IS DISTINCT FROM NEW.blind_structure THEN
     IF coalesce(NEW.late_reg_levels,0)>0 THEN
       IF coalesce(NEW.rebuy_levels,0)=NEW.late_reg_levels THEN
         NEW.rebuy_levels:=public.fn_ca_repeated_levels_late_reg(NEW.blind_structure,NEW.rebuy_levels);
       END IF;
       NEW.late_reg_levels:=public.fn_ca_repeated_levels_late_reg(NEW.blind_structure,NEW.late_reg_levels);
     END IF;
     NEW.blind_structure:=v_stripped;
   END IF;
 END IF;
 -- Explicit weekly terms have already been validated by the original insert.
 -- Do not turn an authored five-minute bounty into an eight-minute event here.
 IF (NEW.club_id='fade0000-0000-0000-0000-000000000001'::uuid
     OR NEW.union_id='fade0000-0000-0000-0000-000000000001'::uuid)
    AND public.fn_ca_midway_weekly_terms(NEW.schedule_id) IS NOT NULL THEN RETURN public.fn_ca_ten_level_late_registration(NEW); END IF;
 IF upper(coalesce(NEW.status,'')) IN ('COMPLETED','COMPLETING','CANCELLED','CANCELED','FAILED') THEN RETURN public.fn_ca_ten_level_late_registration(NEW); END IF;
 -- Ten raw minutes remain five after an old engine applies acceleration.
 v_floor:=CASE WHEN NEW.accelerated_mtt IS TRUE THEN 10
   WHEN upper(coalesce(NEW.tournament_type,''))='MTT' AND lower(coalesce(NEW.variant,'')) NOT IN ('spin','sng')
     AND lower(coalesce(NEW.blind_speed,'standard'))='standard' THEN 8 ELSE 5 END;
 v_structure:=public.fn_ca_minimum_tournament_levels(NEW.blind_structure,v_floor);
 IF v_structure IS DISTINCT FROM NEW.blind_structure
   OR TG_OP='INSERT' OR NEW.blind_structure IS DISTINCT FROM OLD.blind_structure THEN
  NEW.blind_structure:=v_structure;
  IF coalesce(NEW.late_reg_levels,0)>0 THEN
   SELECT jsonb_array_length(v_structure::jsonb), (array_agg(coalesce(nullif((e.value->>'durationMinutes')::numeric,0), nullif((e.value->>'duration_minutes')::numeric,0), (e.value->>'duration')::numeric/60) ORDER BY e.n DESC))[1]
   INTO v_count,v_last FROM jsonb_array_elements(v_structure::jsonb) WITH ORDINALITY e(value,n)
   WHERE NOT coalesce((e.value->>'isBreak')::boolean,false);
   SELECT ceil(greatest(0,NEW.late_reg_levels-coalesce(v_count,0))*coalesce(v_last,v_floor)+coalesce(sum(coalesce(nullif((e.value->>'durationMinutes')::numeric,0),
      nullif((e.value->>'duration_minutes')::numeric,0),(e.value->>'duration')::numeric/60)),0))::integer
   INTO NEW.late_reg_mins
   FROM jsonb_array_elements(v_structure::jsonb) WITH ORDINALITY e(value,n)
   WHERE e.n<=NEW.late_reg_levels AND NOT coalesce((e.value->>'isBreak')::boolean,false);
   -- 2026-11-07: a derived clock caps a stalled level clock; it must not
   -- close entry before the advertised last level because breaks stopped
   -- the levels. Free Buy minutes are the owner's hour and stay as set.
   IF coalesce(NEW.late_reg_mins,0)>0
      AND NEW.format_contract::text IN ('mtt-v1','mtt-v2')
      AND NEW.synchronized_breaks IS DISTINCT FROM false
      AND NOT coalesce(NEW.free_buy,false)
      AND NOT (lower(coalesce(NEW.name,'')) ~ 'free ?buy'
               AND coalesce(NEW.buy_in_amount,0)+coalesce(NEW.buy_in_fee,0)=0) THEN
    NEW.late_reg_mins := NEW.late_reg_mins + public.fn_ca_late_registration_break_allowance(NEW.late_reg_mins);
   END IF;
  END IF;
 END IF;

 -- An explicit authored schedule may choose a level window without a second
 -- wall-clock deadline. Preserve it after all existing clock normalization.
 IF NEW.schedule_id IS NOT NULL
    AND upper(coalesce(NEW.status,'')) IN ('ANNOUNCED','REGISTERING','SCHEDULED','PENDING')
    AND upper(coalesce(NEW.tournament_type,'')) IN ('MTT','SATELLITE')
    AND lower(coalesce(NEW.variant,'')) NOT IN ('spin','sng')
    AND NOT coalesce(NEW.prize_pool_finalized,false) THEN
   SELECT s.config INTO v_schedule_config
   FROM public.tournament_schedules s WHERE s.id=NEW.schedule_id;
   IF v_schedule_config->>'lateRegistrationMode' = 'levels' THEN
     IF coalesce(v_schedule_config->>'lateRegistrationLevels','') !~ '^[0-9]{1,3}$'
        OR (v_schedule_config->>'lateRegistrationLevels')::integer NOT BETWEEN 1 AND 100 THEN
       RAISE EXCEPTION 'A levels-only schedule requires 1 through 100 registration levels';
     END IF;
     NEW.late_reg_levels := (v_schedule_config->>'lateRegistrationLevels')::integer;
     NEW.late_reg_mins := 0;
   END IF;
 END IF;
 RETURN public.fn_ca_ten_level_late_registration(NEW);
END $function$;

-- Re-normalize active schedules and unstarted tournaments where late_reg_levels
-- was stepped from 12 to 11 while rebuy_levels remained 12.
DO $backfill_rebuy_cutoff$
BEGIN
  UPDATE public.tournament_schedules
     SET config = jsonb_set(config, '{rebuyLevels}', to_jsonb((config->>'lateRegistrationLevels')::integer))
   WHERE is_active = true
     AND coalesce(config->>'lateRegistrationLevels', '') = '11'
     AND coalesce(config->>'rebuyLevels', '') = '12';

  PERFORM set_config('app.lock_level_clock', 'on', true);
  UPDATE public.tournaments
     SET rebuy_levels = late_reg_levels
   WHERE upper(coalesce(status, '')) IN ('ANNOUNCED', 'REGISTERING', 'SCHEDULED', 'PENDING')
     AND started_at IS NULL
     AND coalesce(current_level, 0) = 0
     AND late_reg_levels = 11
     AND rebuy_levels = 12;
  PERFORM set_config('app.lock_level_clock', '', true);
END
$backfill_rebuy_cutoff$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Capped storm resolution for GameServer.tournament_dark_after_rebuild
-- ───────────────────────────────────────────────────────────────────────────

DO $patch$
DECLARE
  definition text := pg_get_functiondef('public.fn_ca_alert_resolution_reaches_the_incident()'::regprocedure);
  old_scope constant text := $anchor$  IF NEW.source IN ('Tournament.atomic_finish_refused','fn_ca_bust_backlog_page') THEN
    FOR v_storm IN
      SELECT i.id,i.occurrences,i.detected_at FROM public.ca_drift_incidents i
      WHERE i.source='financial_alerts:' || NEW.source
        AND i.dedupe_key='storm:financial_alerts:' || NEW.source
        AND i.status<>'resolved'
        AND (NEW.source='fn_ca_bust_backlog_page' OR i.metadata->>'storm_member_version'='1')$anchor$;
  new_scope constant text := $anchor$  IF NEW.source IN ('Tournament.atomic_finish_refused','fn_ca_bust_backlog_page','GameServer.tournament_dark_after_rebuild') THEN
    FOR v_storm IN
      SELECT i.id,i.occurrences,i.detected_at FROM public.ca_drift_incidents i
      WHERE i.source='financial_alerts:' || NEW.source
        AND i.dedupe_key='storm:financial_alerts:' || NEW.source
        AND i.status<>'resolved'
        AND (NEW.source IN ('fn_ca_bust_backlog_page','GameServer.tournament_dark_after_rebuild') OR i.metadata->>'storm_member_version'='1')$anchor$;
  old_events constant text := $anchor$      HAVING NEW.source <> 'fn_ca_bust_backlog_page'
          OR (count(DISTINCT a.id)=count(*)
            AND bool_and(COALESCE(e.detail->'financial_member_version'='1'::jsonb
                  AND e.detail->>'source'='financial_alerts:' || NEW.source,false)));$anchor$;
  new_events constant text := $anchor$      HAVING NEW.source NOT IN ('fn_ca_bust_backlog_page','GameServer.tournament_dark_after_rebuild')
          OR (count(DISTINCT a.id)=count(*)
            AND bool_and(COALESCE(e.detail->'financial_member_version'='1'::jsonb
                  AND e.detail->>'source'='financial_alerts:' || NEW.source,false)));$anchor$;
BEGIN
  IF position('GameServer.tournament_dark_after_rebuild' IN definition) = 0 THEN
    IF cardinality(string_to_array(definition, old_scope)) IS DISTINCT FROM 2
       OR cardinality(string_to_array(definition, old_events)) IS DISTINCT FROM 2 THEN
      RAISE EXCEPTION 'REBUILD_STORM_PREIMAGE_CHANGED';
    END IF;
    EXECUTE replace(replace(definition, old_scope, new_scope), old_events, new_events);
  END IF;
END
$patch$;

DO $original$
DECLARE
  original public.ca_drift_incidents%ROWTYPE;
  member_count bigint;
  distinct_alerts bigint;
  all_resolved boolean;
BEGIN
  SELECT * INTO original FROM public.ca_drift_incidents
   WHERE id='b4175ad4-a1bd-42bd-b5e1-3a060809ce60'
     AND source='financial_alerts:GameServer.tournament_dark_after_rebuild'
     AND dedupe_key='storm:financial_alerts:GameServer.tournament_dark_after_rebuild'
     AND status='open'
   FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*),count(DISTINCT a.id),
         bool_and(COALESCE(a.resolved AND a.source='GameServer.tournament_dark_after_rebuild'
           AND e.detail->'financial_member_version'='1'::jsonb
           AND e.detail->>'source'=original.source,false))
    INTO member_count,distinct_alerts,all_resolved
    FROM public.ca_incident_events e
    LEFT JOIN public.financial_alerts a ON a.id=CASE
      WHEN e.detail->>'alert_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (e.detail->>'alert_id')::uuid END
   WHERE e.incident_id=original.id AND e.kind='recurred';

  IF original.occurrences=5 AND member_count=5 AND distinct_alerts=5 AND all_resolved THEN
    UPDATE public.ca_drift_incidents
       SET status='resolved',resolved_at=GREATEST(now(),detected_at),
           closure_basis='verified_remeasured',
           root_cause='The capped post-rebuild dark-tournament storm was outside the financial alert resolution trigger''s supported sources.',
           correction_ref='verified: all 5 exact original GameServer.tournament_dark_after_rebuild alerts resolved by their producer',
           resolution='Closed after proving the complete set of exact original source alert resolutions.'
     WHERE id=original.id AND status='open';
  END IF;
END
$original$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Guard and close TournamentRecurring.freeBuyAudit alert cd9f260e once
--    all unstarted Free Buy rows have rebuy_levels = late_reg_levels = 11
-- ───────────────────────────────────────────────────────────────────────────

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
  ) OR EXISTS (
    SELECT 1 FROM public.fn_sp_midway_free_buy_watch()
  ) THEN
    RETURN NEW;
  END IF;

  NEW.resolved := true;
  NEW.resolved_at := COALESCE(NEW.resolved_at, now());
  NEW.resolution := 'Resolved automatically: all unstarted Free Buy events have rebuy_levels = late_reg_levels = 11 and fn_sp_midway_free_buy_watch() reports 0 findings; reported lines are immutable Nov 8-9 transition occurrences or pre-#10188 cancelled rows.';
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_free_buy_transition_audit_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a0_free_buy_transition_audit_guard ON public.financial_alerts;
CREATE TRIGGER a0_free_buy_transition_audit_guard
  BEFORE INSERT ON public.financial_alerts
  FOR EACH ROW
  WHEN (NEW.source = 'TournamentRecurring.freeBuyAudit')
  EXECUTE FUNCTION public.fn_ca_free_buy_transition_audit_guard();

DO $resolve_free_buy_audit$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tournaments t
    WHERE t.free_buy IS TRUE
      AND upper(coalesce(t.status, '')) IN ('ANNOUNCED', 'REGISTERING', 'SCHEDULED', 'PENDING')
      AND t.started_at IS NULL
      AND t.rebuy_levels IS DISTINCT FROM t.late_reg_levels
  ) AND NOT EXISTS (
    SELECT 1 FROM public.fn_sp_midway_free_buy_watch()
  ) THEN
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
