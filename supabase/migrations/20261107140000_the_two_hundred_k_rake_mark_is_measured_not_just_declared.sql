-- ═══════════════════════════════════════════════════════════════════════════
-- THE 200K RAKE MARK IS MEASURED, NOT JUST DECLARED (2026-11-07)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Dan, 2026-11-05 14:32: "THERE IS NO CAP OR CLOCK THAT SHOULD BE WATCHING
-- THIS, JUST HAVE AND LAUNCH FEWER LIGHTNING GAMES, TO OFF SET THE TOTAL RAKE
-- COLLECTED ... FIGURE OUT THE RIGHT ALGO TO INSURE THAT THE GAMES STILL RUN,
-- BUT NOT ALL THE TIME, AND WE STAY UNDER THE 200K MARK."
--
-- The mark was written down - horseUnionCashPlan.json carries
-- "weeklyRakeTarget": 200000 - and then NOTHING read it. Searched the whole
-- engine and the whole database: `weeklyRakeTarget` appears in that one JSON
-- file and in no other file and no function. The throttle that followed is a
-- hand-authored list of games, time windows and two horse-seeded Lightning
-- clusters. It moves rake in the right direction and nobody measures whether
-- it arrives:
--
--   week of 2026-10-19   2,584,858 chips   12.9x the mark
--   week of 2026-10-26   1,864,717 chips    9.3x
--   week of 2026-11-02     726,434 chips    3.6x   (and still running)
--
-- An unmeasured target is a wish. This makes the mark a number the floor can
-- be judged against every night: one authority row for the target, one
-- function for the pace, and one audit finding that names the projection.
-- It changes no game, seats no horse and moves no money - the hand-authored
-- plan still decides what runs. It only makes the miss visible, so the next
-- adjustment is made against evidence instead of feel.

CREATE TABLE IF NOT EXISTS public.horse_cash_rake_target (
  union_id      uuid PRIMARY KEY,
  weekly_target numeric     NOT NULL CHECK (weekly_target > 0),
  source        text        NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Read by SECURITY DEFINER audit functions only. No client role reads it
-- directly: RLS on with no policy, and one explicit grant.
ALTER TABLE public.horse_cash_rake_target ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.horse_cash_rake_target FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.horse_cash_rake_target TO service_role;

COMMENT ON TABLE public.horse_cash_rake_target IS
  'The weekly union rake mark the horse cash plan aims to stay under. One authority both the audit and any future governor read, so the number can be tuned without an engine release.';

INSERT INTO public.horse_cash_rake_target (union_id, weekly_target, source)
VALUES ('fade0000-0000-0000-0000-000000000001'::uuid, 200000,
        'horseUnionCashPlan.json weeklyRakeTarget (Dan 2026-11-05: "WE STAY UNDER THE 200K MARK")')
ON CONFLICT (union_id) DO NOTHING;

-- ── THE PACE ────────────────────────────────────────────────────────────────
-- Week-to-date rake against the share of the week that has elapsed. The
-- projection is the honest read: a Monday morning total is not a week.
CREATE OR REPLACE FUNCTION public.fn_horse_cash_rake_pace(
  p_union_id uuid DEFAULT 'fade0000-0000-0000-0000-000000000001'::uuid,
  p_at timestamptz DEFAULT now()
) RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_week_start timestamptz;
  v_target numeric;
  v_rake numeric;
  v_elapsed numeric;
  v_projected numeric;
  v_verdict text;
BEGIN
  SELECT weekly_target INTO v_target
    FROM public.horse_cash_rake_target WHERE union_id = p_union_id;
  IF v_target IS NULL THEN
    RETURN jsonb_build_object('known', false, 'reason', 'no rake target on record for this union');
  END IF;

  v_week_start := public.fn_union_week_start(p_at);

  SELECT coalesce(sum(w.rake_total), 0) INTO v_rake
    FROM public.union_rake_weekly w
   WHERE w.union_id = p_union_id
     AND w.week_start = v_week_start::date;

  -- Clamped: a clock skew must never divide by zero or claim a finished week.
  v_elapsed := least(greatest(
      extract(epoch FROM (p_at - v_week_start)) / extract(epoch FROM interval '7 days'),
      0.0001), 1.0);
  v_projected := round(v_rake / v_elapsed, 2);

  v_verdict := CASE
    WHEN v_projected > v_target * 1.10 THEN 'over'
    WHEN v_projected < v_target * 0.50 THEN 'under'
    ELSE 'on_pace' END;

  RETURN jsonb_build_object(
    'known', true,
    'union_id', p_union_id,
    'week_start', v_week_start,
    'weekly_target', v_target,
    'rake_to_date', round(v_rake, 2),
    'week_elapsed_fraction', round(v_elapsed, 4),
    'paced_target', round(v_target * v_elapsed, 2),
    'projected_week', v_projected,
    'times_target', round(v_projected / v_target, 2),
    'verdict', v_verdict);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_horse_cash_rake_pace(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_horse_cash_rake_pace(uuid, timestamptz) TO service_role;

-- ── THE FINDING ─────────────────────────────────────────────────────────────
-- warn, never critical: this is a commercial target, not a correctness or
-- safety invariant, and a Critical that fires every night for a number
-- somebody is already steering stops being read. It names the projection so
-- the next plan edit has a figure to aim at.
CREATE OR REPLACE FUNCTION public.fn_audit_horse_cash_rake_pace(p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb;
BEGIN
  -- Judge the audited day inside its own week, not today's.
  v := public.fn_horse_cash_rake_pace(
         'fade0000-0000-0000-0000-000000000001'::uuid,
         least(((p_day + 1)::timestamp AT TIME ZONE 'UTC'), now()));
  IF coalesce((v->>'known')::boolean, false) IS NOT TRUE THEN
    RETURN '[]'::jsonb;
  END IF;

  IF v->>'verdict' = 'over' THEN
    RETURN jsonb_build_array(jsonb_build_object(
      'severity','warn','category','gto','code','horse_cash_rake_over_target',
      'title','Union rake is pacing at ' || (v->>'times_target') ||
              'x the ' || (v->>'weekly_target') || ' weekly mark',
      'evidence', v,
      'recommendation','The horse cash plan (horseUnionCashPlan.json: games, windows, lightningHorseSeeded) is the only throttle, and it is hand-authored. Reduce the scheduled game set or the horse-seeded Lightning clusters rather than adding a timer - Dan 2026-11-05: "there should never be a on off timer for these games! ever!!" Lightning games stay running; there are simply fewer of them.'));
  ELSIF v->>'verdict' = 'under' THEN
    RETURN jsonb_build_array(jsonb_build_object(
      'severity','info','category','gto','code','horse_cash_rake_under_target',
      'title','Union rake is pacing at ' || (v->>'times_target') ||
              'x the weekly mark, well under it',
      'evidence', v,
      'recommendation','The floor is throttled harder than the mark requires. Horse cash volume also feeds the self-tuner, which needs 1,500 cash hands a week per horse to tune from settlement truth, so an over-tight throttle costs brain quality. Consider widening a window or seeding one more Lightning cluster.'));
  END IF;

  RETURN jsonb_build_array(jsonb_build_object(
    'severity','info','category','gto','code','horse_cash_rake_on_pace',
    'title','Union rake is on pace against the weekly mark',
    'evidence', v,
    'recommendation','No plan change indicated.'));
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_audit_horse_cash_rake_pace(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_audit_horse_cash_rake_pace(date) TO service_role;

-- ── WIRE IT INTO THE NIGHTLY AUDIT ──────────────────────────────────────────
DO $mig$
DECLARE
  v_def text;
  v_anchor text := 'v_findings := v_findings || fn_audit_tournament_results(p_day);';
  v_new text;
BEGIN
  v_new := v_anchor || E'\n' ||
    '  -- 2026-11-07: the 200K weekly rake mark was declared in' || E'\n' ||
    '  -- horseUnionCashPlan.json and read by nothing. Measure it.' || E'\n' ||
    '  v_findings := v_findings || fn_audit_horse_cash_rake_pace(p_day);';

  v_def := pg_get_functiondef('public.fn_run_horse_daily_audit(date)'::regprocedure);
  IF position(v_anchor in v_def) = 0 THEN
    RAISE EXCEPTION 'tournament_results anchor not found - refusing to edit blind';
  END IF;
  IF position('fn_audit_horse_cash_rake_pace' in v_def) <> 0 THEN
    RAISE EXCEPTION 'rake pace already wired in';
  END IF;
  v_def := replace(v_def, v_anchor, v_new);
  IF position('fn_audit_horse_cash_rake_pace' in v_def) = 0 THEN
    RAISE EXCEPTION 'wiring did not take';
  END IF;
  EXECUTE v_def;
END
$mig$;

-- ── SELF-VERIFY ─────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  v jsonb;
  f jsonb;
BEGIN
  v := public.fn_horse_cash_rake_pace();
  IF coalesce((v->>'known')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'RAKE_PACE_UNKNOWN: the target row did not land';
  END IF;
  IF (v->>'weekly_target')::numeric <> 200000 THEN
    RAISE EXCEPTION 'RAKE_PACE_TARGET_WRONG: %', v->>'weekly_target';
  END IF;
  IF (v->>'week_elapsed_fraction')::numeric <= 0
     OR (v->>'week_elapsed_fraction')::numeric > 1 THEN
    RAISE EXCEPTION 'RAKE_PACE_ELAPSED_OUT_OF_RANGE: %', v->>'week_elapsed_fraction';
  END IF;
  IF (v->>'projected_week')::numeric < (v->>'rake_to_date')::numeric THEN
    RAISE EXCEPTION 'RAKE_PACE_PROJECTION_BELOW_ACTUAL';
  END IF;
  -- The finding shape must be an array the audit can concatenate.
  f := public.fn_audit_horse_cash_rake_pace((now() AT TIME ZONE 'UTC')::date - 1);
  IF jsonb_typeof(f) <> 'array' OR jsonb_array_length(f) <> 1 THEN
    RAISE EXCEPTION 'RAKE_PACE_FINDING_SHAPE: %', f;
  END IF;
  IF f->0->>'code' NOT IN ('horse_cash_rake_over_target','horse_cash_rake_under_target','horse_cash_rake_on_pace') THEN
    RAISE EXCEPTION 'RAKE_PACE_FINDING_CODE: %', f->0->>'code';
  END IF;
  IF f->0->>'severity' = 'critical' THEN
    RAISE EXCEPTION 'RAKE_PACE_MUST_NEVER_BE_CRITICAL';
  END IF;
END
$verify$;
