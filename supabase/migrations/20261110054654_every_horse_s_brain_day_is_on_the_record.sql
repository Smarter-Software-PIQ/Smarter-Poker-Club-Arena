-- 20261110054654_every_horse_s_brain_day_is_on_the_record.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- ============================================================================
-- EVERY HORSE'S BRAIN DAY IS ON THE RECORD
-- ============================================================================
--
-- THE BLIND SPOT, verified on production (kuklfnapbkmacvwxktbh) 2026-11-10:
-- horse_brain_telemetry is fleet-aggregate (day, feature, fires) with no horse
-- identity, so "every intended horse exercises the brain stack" is only
-- provable at fleet level. A single horse whose decisions all come from the
-- exception fallback, or a roster horse that never decides at all, is
-- invisible: the fleet totals absorb it. The per-action truth exists in
-- hand_history.actions (per-action userId and origin, 'horse_policy' or
-- 'horse_fallback', read back from live rows 2026-11-10), but at 936,405
-- hand_history rows on 2026-11-08 a day pass over that jsonb inside the
-- nightly audit is exactly the scan the 2026-09-05 rewrite removed (89.9s
-- measured cold against the engine's 8s service_role statement_timeout).
--
-- WHAT THIS CHANGES, in the pattern horse_review_rollup already proved for
-- this audit (arithmetic at the writing event, the nightly read from the
-- small rollup):
--
--   1. public.horse_brain_activity_rollup: per (day, horse, variant, lane)
--      counts of decided hands, policy actions and fallback actions, written
--      by a new AFTER INSERT row trigger on hand_history
--      (zz_horse_brain_activity_rollup, beside the six row triggers already
--      on that table). The trigger reads only NEW.actions, upserts at most
--      one row per horse seated in the hand, and never raises: a failed
--      counter must not block hand recording, and a dead counter is paged by
--      the audit finding below instead.
--
--   2. public.horse_daily_brain_coverage: the permanent per-horse daily
--      record, one row per ROSTER horse per audited day (profiles.is_horse,
--      not deleted, on ca_horse_fleet_register and not retired), zero rows
--      included. An idle horse becomes a visible zero row instead of an
--      absent one. Recomputed idempotently (delete+insert for the day) by
--      fn_horse_daily_brain_coverage_upsert inside the EXISTING nightly
--      fn_run_horse_daily_audit run. No new schedule of any kind.
--
--   3. fn_audit_per_horse_brain_coverage(p_day): one info summary finding
--      (active/idle split, policy/fallback totals, fallback share) appended
--      to the audit's findings, plus per_horse_coverage_absent when fleet
--      telemetry shows decides but the rollup recorded nothing: critical
--      when the rollup has data for an earlier day (the writer died), info
--      when the day predates the rollup (a backfill before install).
--
--   4. fn_run_horse_daily_audit is edited surgically (pg_get_functiondef,
--      anchored insert, guarded, the 20261107140000 pattern for this shared
--      function) to call the upsert and append the findings right after the
--      fn_audit_horse_cash_rake_pace wiring. Cost added to the nightly run:
--      one delete+insert of ~1,000 coverage rows from a rollup day slice of
--      a few thousand rows, milliseconds, nowhere near the 8s budget.
--
-- No backfill: the trigger starts counting at install, so the first audited
-- day after install is partial and days before install stay empty (reported
-- as info by per_horse_coverage_absent, never critical).
--
-- CREATE TRIGGER takes SHARE ROW EXCLUSIVE on hand_history, a hot table, so
-- this file waits for the daily break (CLAUDE.md section 2 rule 10).
--
-- @install-window: daily-maintenance
-- @locks: public.hand_history
--
-- @live-proof: (SELECT to_regclass('public.horse_brain_activity_rollup') IS NOT NULL AND to_regclass('public.horse_daily_brain_coverage') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.hand_history'::regclass AND tgname = 'zz_horse_brain_activity_rollup' AND NOT tgisinternal) AND NOT has_table_privilege('anon', 'public.horse_daily_brain_coverage', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.horse_daily_brain_coverage', 'SELECT') AND has_table_privilege('service_role', 'public.horse_daily_brain_coverage', 'SELECT') AND NOT has_table_privilege('anon', 'public.horse_brain_activity_rollup', 'SELECT') AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.horse_daily_brain_coverage'::regclass) AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.horse_brain_activity_rollup'::regclass) AND position('fn_audit_per_horse_brain_coverage' in pg_get_functiondef('public.fn_run_horse_daily_audit(date)'::regprocedure)) > 0)

BEGIN;

-- == 1. THE TRIGGER-FED ROLLUP ==============================================
-- Day is the UTC day of created_at, the same slicing the audit uses (it runs
-- SET TimeZone UTC). No foreign keys: a rollup row referencing a hot relation
-- would take locks the counter has no right to (CLAUDE.md DDL policy rule 7),
-- and an orphan count row is harmless.

CREATE TABLE public.horse_brain_activity_rollup (
  day              date        NOT NULL,
  horse_user_id    uuid        NOT NULL,
  game_variant     text        NOT NULL,
  lane             text        NOT NULL CHECK (lane IN ('cash', 'tournament')),
  decided_hands    integer     NOT NULL DEFAULT 0,
  policy_actions   integer     NOT NULL DEFAULT 0,
  fallback_actions integer     NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, horse_user_id, game_variant, lane)
);

CREATE FUNCTION public.fn_horse_brain_activity_from_hand()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if new.actions is null or jsonb_typeof(new.actions) <> 'array' then
    return new;
  end if;
  insert into public.horse_brain_activity_rollup as t
      (day, horse_user_id, game_variant, lane, decided_hands, policy_actions, fallback_actions)
  select (new.created_at at time zone 'UTC')::date,
         (a->>'userId')::uuid,
         coalesce(new.game_variant, 'unknown'),
         case when new.tournament_id is null then 'cash' else 'tournament' end,
         1,
         (count(*) filter (where a->>'origin' = 'horse_policy'))::int,
         (count(*) filter (where a->>'origin' = 'horse_fallback'))::int
    from jsonb_array_elements(new.actions) a
   where a->>'origin' in ('horse_policy', 'horse_fallback')
     and (a->>'userId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   group by 2
   order by 2
  on conflict (day, horse_user_id, game_variant, lane) do update
     set decided_hands    = t.decided_hands    + excluded.decided_hands,
         policy_actions   = t.policy_actions   + excluded.policy_actions,
         fallback_actions = t.fallback_actions + excluded.fallback_actions,
         updated_at       = now();
  return new;
exception when others then
  -- Never block hand recording for an observability counter. A writer that
  -- dies is paged by fn_audit_per_horse_brain_coverage
  -- (per_horse_coverage_absent, critical), not hidden by this handler.
  return new;
end
$function$;

CREATE TRIGGER zz_horse_brain_activity_rollup
AFTER INSERT ON public.hand_history
FOR EACH ROW
WHEN (new.actions IS NOT NULL)
EXECUTE FUNCTION public.fn_horse_brain_activity_from_hand();

-- == 2. THE PERMANENT PER-HORSE DAILY RECORD ================================

CREATE TABLE public.horse_daily_brain_coverage (
  day              date    NOT NULL,
  horse_id         uuid    NOT NULL,
  decided_hands    integer NOT NULL DEFAULT 0,
  policy_actions   integer NOT NULL DEFAULT 0,
  fallback_actions integer NOT NULL DEFAULT 0,
  variant_mix      jsonb   NOT NULL DEFAULT '{}'::jsonb,
  lane             text    NOT NULL DEFAULT 'none'
                           CHECK (lane IN ('cash', 'tournament', 'mixed', 'none')),
  PRIMARY KEY (day, horse_id)
);

CREATE FUNCTION public.fn_horse_daily_brain_coverage_upsert(p_day date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  delete from public.horse_daily_brain_coverage where day = p_day;
  insert into public.horse_daily_brain_coverage
      (day, horse_id, decided_hands, policy_actions, fallback_actions, variant_mix, lane)
  select p_day,
         p.id,
         coalesce(agg.decided_hands, 0),
         coalesce(agg.policy_actions, 0),
         coalesce(agg.fallback_actions, 0),
         coalesce(agg.variant_mix, '{}'::jsonb),
         case
           when agg.horse_user_id is null then 'none'
           when agg.lanes = 1 and agg.cash_lanes = 1 then 'cash'
           when agg.lanes = 1 then 'tournament'
           else 'mixed'
         end
    from public.profiles p
    join public.ca_horse_fleet_register r
      on r.horse_id = p.id and r.retired_at is null
    left join (
      select b.horse_user_id,
             sum(b.decided_hands)::int    as decided_hands,
             sum(b.policy_actions)::int   as policy_actions,
             sum(b.fallback_actions)::int as fallback_actions,
             count(distinct b.lane)::int  as lanes,
             (count(distinct b.lane) filter (where b.lane = 'cash'))::int as cash_lanes,
             (select jsonb_object_agg(v.game_variant, v.hands)
                from (select b2.game_variant, sum(b2.decided_hands)::int as hands
                        from public.horse_brain_activity_rollup b2
                       where b2.day = p_day and b2.horse_user_id = b.horse_user_id
                       group by b2.game_variant) v) as variant_mix
        from public.horse_brain_activity_rollup b
       where b.day = p_day
       group by b.horse_user_id
    ) agg on agg.horse_user_id = p.id
   where p.is_horse and coalesce(p.status, '') <> 'deleted';
end
$function$;

-- == 3. THE AUDIT'S READ OF IT ==============================================

CREATE FUNCTION public.fn_audit_per_horse_brain_coverage(p_day date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v record;
  v_decides bigint;
  v_findings jsonb := '[]'::jsonb;
begin
  select count(*)                                    as roster,
         count(*) filter (where c.decided_hands > 0) as active,
         count(*) filter (where c.decided_hands = 0) as idle,
         coalesce(sum(c.decided_hands), 0)           as decided_hands,
         coalesce(sum(c.policy_actions), 0)          as policy_actions,
         coalesce(sum(c.fallback_actions), 0)        as fallback_actions
    into v
    from public.horse_daily_brain_coverage c
   where c.day = p_day;

  select coalesce(sum(t.fires), 0) into v_decides
    from public.horse_brain_telemetry t
   where t.day = p_day and t.feature = 'decide';

  v_findings := v_findings || jsonb_build_object(
    'severity', 'info', 'category', 'logic', 'code', 'per_horse_brain_coverage',
    'title', 'Per-horse brain coverage: ' || v.active || ' of ' || v.roster
             || ' roster horses decided hands',
    'evidence', jsonb_build_object(
      'roster', v.roster,
      'active_horses', v.active,
      'idle_horses', v.idle,
      'decided_hands', v.decided_hands,
      'policy_actions', v.policy_actions,
      'fallback_actions', v.fallback_actions,
      'fallback_share', case when v.policy_actions + v.fallback_actions > 0
        then round(v.fallback_actions::numeric
                   / (v.policy_actions + v.fallback_actions), 4) end,
      'fleet_decides_telemetry', v_decides),
    'recommendation', 'horse_daily_brain_coverage holds one row per roster horse for the day; a zero row is an idle horse made visible, not an error. Judge individual horses from that table, and a horse whose actions are mostly fallback from its own row, not from this fleet summary.');

  if v_decides > 0 and v.policy_actions + v.fallback_actions = 0 then
    v_findings := v_findings || jsonb_build_object(
      'severity', case when exists (select 1 from public.horse_brain_activity_rollup b
                                     where b.day <= p_day)
                       then 'critical' else 'info' end,
      'category', 'schema', 'code', 'per_horse_coverage_absent',
      'title', 'Fleet telemetry shows ' || v_decides
               || ' decides but per-horse coverage recorded zero actions',
      'evidence', jsonb_build_object(
        'day', p_day,
        'fleet_decides_telemetry', v_decides,
        'rollup_rows_for_day', (select count(*) from public.horse_brain_activity_rollup b
                                 where b.day = p_day),
        'earliest_rollup_day', (select min(b.day) from public.horse_brain_activity_rollup b)),
      'recommendation', 'Critical means the rollup holds data for an earlier day and nothing for this one: the zz_horse_brain_activity_rollup trigger on hand_history stopped writing, so read its function and the day''s engine errors. Info means this day predates the rollup entirely (a backfill of a day before install), so zero per-horse data is expected and only the fleet telemetry exists for it.');
  end if;

  return v_findings;
end
$function$;

-- == 4. PRIVILEGES, THE 20261108191909 PATTERN ==============================
-- GRANT and REVOKE do not trigger a PostgREST schema reload (CLAUDE.md DDL
-- policy rule 5). RLS is enabled with no policies in the creation migration
-- (the explicit-access gate's rule for new public tables): the browser roles
-- hold no privilege and no policy, service_role holds exactly SELECT after an
-- explicit REVOKE ALL, and writes happen only inside the SECURITY DEFINER
-- functions, which run as the table owner.

ALTER TABLE public.horse_brain_activity_rollup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.horse_daily_brain_coverage ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.horse_brain_activity_rollup FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.horse_daily_brain_coverage FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.horse_brain_activity_rollup TO service_role;
GRANT SELECT ON TABLE public.horse_daily_brain_coverage TO service_role;

REVOKE ALL ON FUNCTION public.fn_horse_brain_activity_from_hand() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_horse_daily_brain_coverage_upsert(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_audit_per_horse_brain_coverage(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_horse_daily_brain_coverage_upsert(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_audit_per_horse_brain_coverage(date) TO service_role;

-- == 5. WIRE IT INTO THE NIGHTLY AUDIT ======================================
-- The 20261107140000 pattern: edit the live definition at a unique anchor,
-- refuse to edit blind, refuse to double-wire. A full replacement here would
-- silently stomp any other lane's in-flight edit to this shared function.

DO $mig$
DECLARE
  v_def text;
  v_anchor text := 'v_findings := v_findings || fn_audit_horse_cash_rake_pace(p_day);';
  v_new text;
BEGIN
  v_new := v_anchor || E'\n' ||
    '  -- 2026-11-10: brain telemetry is fleet-aggregate, so per-horse coverage' || E'\n' ||
    '  -- comes from the trigger-fed activity rollup: one permanent row per' || E'\n' ||
    '  -- roster horse per day, zero rows included, so an idle horse is a' || E'\n' ||
    '  -- visible zero instead of an absence. 20261110054654.' || E'\n' ||
    '  perform fn_horse_daily_brain_coverage_upsert(p_day);' || E'\n' ||
    '  v_findings := v_findings || fn_audit_per_horse_brain_coverage(p_day);';

  IF to_regprocedure('public.fn_run_horse_daily_audit(date)') IS NULL THEN
    RAISE EXCEPTION 'fn_run_horse_daily_audit(date) is not installed';
  END IF;
  v_def := pg_get_functiondef('public.fn_run_horse_daily_audit(date)'::regprocedure);
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) <> length(v_anchor) THEN
    RAISE EXCEPTION 'rake pace anchor is not present exactly once - refusing to edit blind';
  END IF;
  IF position('fn_audit_per_horse_brain_coverage' in v_def) <> 0 THEN
    RAISE EXCEPTION 'per-horse coverage already wired in';
  END IF;
  v_def := replace(v_def, v_anchor, v_new);
  IF position('fn_horse_daily_brain_coverage_upsert' in v_def) = 0
     OR position('fn_audit_per_horse_brain_coverage' in v_def) = 0 THEN
    RAISE EXCEPTION 'wiring did not take';
  END IF;
  EXECUTE v_def;
END
$mig$;

-- == 6. SELF-VERIFY (structural only: a window file stays DDL, and writing ==
--       production coverage rows from a still-empty rollup would record a
--       misleading all-zero day)

DO $verify$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.fn_run_horse_daily_audit(date)'::regprocedure);
  IF position('perform fn_horse_daily_brain_coverage_upsert(p_day);' in v_def) = 0 THEN
    RAISE EXCEPTION 'COVERAGE_UPSERT_NOT_WIRED';
  END IF;
  IF position('v_findings := v_findings || fn_audit_per_horse_brain_coverage(p_day);' in v_def) = 0 THEN
    RAISE EXCEPTION 'COVERAGE_FINDINGS_NOT_WIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.hand_history'::regclass
                    AND tgname = 'zz_horse_brain_activity_rollup'
                    AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'ROLLUP_TRIGGER_MISSING';
  END IF;
END
$verify$;

COMMIT;
