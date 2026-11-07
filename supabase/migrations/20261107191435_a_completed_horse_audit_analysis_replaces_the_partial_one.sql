-- 20261107191435_a_completed_horse_audit_analysis_replaces_the_partial_one.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A COMPLETED HORSE AUDIT ANALYSIS REPLACES THE PARTIAL ONE IT COMPLETES
-- (2026-11-07).
--
-- What happened. The horse-daily-audit-analysis run that claimed 2026-11-06
-- wrote its analysis at 11:07:56 UTC (submission ef5a8c5c, 9 flaws) and said
-- in its own summary that it had NOT done the GTO sweep of the 20 biggest
-- losses. A follow-up session finished that sweep and saved the completed
-- analysis at 18:27:42 UTC (submission 73089a83, 14 flaws: the same 9, byte
-- for byte, plus 5 from the sweep, one of them a critical V15 regression).
-- fn_horse_audit_set_agent_analysis keeps the first analysis written for a
-- day and files every later, different one as retained_existing, so the
-- completed analysis went into the submissions log and the Hand Reviews
-- panel, which reads horse_daily_audit.agent_analysis through
-- ca_horse_daily_audit, kept showing the partial one. The standard save was
-- the only path the job has, so a run that finishes another run's work had
-- no way to land it.
--
-- Why first-write-wins existed, and why it stays for everything else.
-- 20261105220227 made it so because the old function replaced whatever was
-- stored: two accounts running the same schedule could overwrite each
-- other's verdict and the last writer won, whatever it said. That protection
-- is right for two DIFFERENT analyses. It is wrong for an analysis that
-- carries the stored one forward unchanged and adds to it.
--
-- The rule (fn_horse_audit_analysis_completes). A submission COMPLETES the
-- stored analysis when every flaw object of the stored analysis appears,
-- exactly equal as jsonb, among the submission's flaws, and the submission
-- has strictly more flaws. Nothing the stored analysis said can be lost or
-- reworded by such a replacement, so it replaces the stored one: the audit
-- row takes the new analysis and agent_analyzed_at, the new submission is
-- logged as completes_existing, and the submission that had been stored is
-- re-marked superseded (it stays in the log). Any other differing submission
-- is still retained_existing, exactly as before. The function signature is
-- unchanged, so the scheduled job's standard save is the path, with nothing
-- to configure: a follow-up run that keeps the earlier findings and adds its
-- own simply lands.
--
-- The 2026-11-06 analysis. Submission 73089a83 meets the rule against the
-- stored analysis (all 9 stored flaws present unchanged, 14 > 9; checked on
-- production before this was written), so this migration applies the same
-- replacement to it, guarded on the exact md5 of both the stored analysis and
-- the submission so it does nothing if either moved.
--
-- No watcher, cron or repair loop: the save function itself decides, at the
-- moment of the save, inside the row lock it already takes.
-- @live-proof: to_regprocedure('public.fn_horse_audit_analysis_completes(jsonb,jsonb)') IS NOT NULL AND position('completes_existing' in pg_get_functiondef('public.fn_horse_audit_set_agent_analysis(date,jsonb)'::regprocedure)) > 0

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.horse_daily_audit_analysis_submissions
  DROP CONSTRAINT IF EXISTS horse_daily_audit_analysis_submissions_outcome_check;
ALTER TABLE public.horse_daily_audit_analysis_submissions
  ADD CONSTRAINT horse_daily_audit_analysis_submissions_outcome_check
  CHECK (outcome IN ('stored','pending_machine_audit','attached_after_audit','duplicate',
                     'retained_existing','completes_existing','superseded'));

CREATE OR REPLACE FUNCTION public.fn_horse_audit_analysis_completes(p_prior jsonb, p_next jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $f$
  SELECT COALESCE(
    jsonb_typeof(p_prior -> 'flaws') = 'array'
    AND jsonb_typeof(p_next -> 'flaws') = 'array'
    AND jsonb_array_length(p_next -> 'flaws') > jsonb_array_length(p_prior -> 'flaws')
    AND NOT EXISTS (
      SELECT 1
        FROM jsonb_array_elements(p_prior -> 'flaws') AS pf(flaw)
       WHERE NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_next -> 'flaws') AS nf(flaw)
          WHERE nf.flaw = pf.flaw)),
    false)
$f$;
COMMENT ON FUNCTION public.fn_horse_audit_analysis_completes(jsonb, jsonb) IS
  'True when p_next keeps every flaw of p_prior unchanged (exact jsonb equality) and adds at least one. Such an analysis completes the stored one and replaces it (20261107191435).';
REVOKE ALL ON FUNCTION public.fn_horse_audit_analysis_completes(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_horse_audit_analysis_completes(jsonb, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_horse_audit_set_agent_analysis(p_day date, p_analysis jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_audit   public.horse_daily_audit%ROWTYPE;
  v_sub_id  uuid;
  v_outcome text;
BEGIN
  IF p_day IS NULL OR p_analysis IS NULL OR jsonb_typeof(p_analysis) <> 'object' THEN
    RAISE EXCEPTION 'fn_horse_audit_set_agent_analysis needs a day and a json object' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_audit FROM public.horse_daily_audit WHERE day = p_day FOR UPDATE;

  IF NOT FOUND OR v_audit.stats = '{}'::jsonb THEN
    v_outcome := 'pending_machine_audit';
  ELSIF v_audit.agent_analysis IS NULL THEN
    UPDATE public.horse_daily_audit SET agent_analysis = p_analysis, agent_analyzed_at = now() WHERE day = p_day;
    v_outcome := 'stored';
  ELSIF md5(v_audit.agent_analysis::text) = md5(p_analysis::text) THEN
    v_outcome := 'duplicate';
  ELSIF public.fn_horse_audit_analysis_completes(v_audit.agent_analysis, p_analysis) THEN
    UPDATE public.horse_daily_audit_analysis_submissions
       SET outcome = 'superseded', outcome_at = clock_timestamp()
     WHERE day = p_day
       AND analysis_md5 = md5(v_audit.agent_analysis::text)
       AND outcome IN ('stored', 'attached_after_audit', 'completes_existing');
    UPDATE public.horse_daily_audit SET agent_analysis = p_analysis, agent_analyzed_at = now() WHERE day = p_day;
    v_outcome := 'completes_existing';
  ELSE
    v_outcome := 'retained_existing';
  END IF;

  INSERT INTO public.horse_daily_audit_analysis_submissions (day, analysis, outcome)
  VALUES (p_day, p_analysis, v_outcome) RETURNING id INTO v_sub_id;

  RETURN jsonb_build_object(
    'day', p_day,
    'persisted', true,
    'outcome', v_outcome,
    'submission_id', v_sub_id,
    'machine_audit_present', v_outcome <> 'pending_machine_audit',
    'note', CASE v_outcome
      WHEN 'stored' THEN 'Analysis stored on the audit row.'
      WHEN 'pending_machine_audit' THEN 'The machine audit for this day is not written yet. The analysis is kept and attaches itself when the audit row lands.'
      WHEN 'duplicate' THEN 'The same analysis is already stored.'
      WHEN 'completes_existing' THEN 'This analysis keeps every flaw of the stored analysis unchanged and adds more, so it replaced the stored analysis. The earlier one is kept in horse_daily_audit_analysis_submissions as superseded.'
      ELSE 'A different analysis is already stored and was kept. To replace it, keep every flaw of the stored analysis unchanged and add yours; this submission is retained in horse_daily_audit_analysis_submissions.' END);
END
$function$;
REVOKE ALL ON FUNCTION public.fn_horse_audit_set_agent_analysis(date, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_horse_audit_set_agent_analysis(date, jsonb) TO service_role;

-- The completed 2026-11-06 analysis, by the same rule, guarded on both md5s.
DO $promote$
DECLARE
  v_audit public.horse_daily_audit%ROWTYPE;
  v_sub   public.horse_daily_audit_analysis_submissions%ROWTYPE;
BEGIN
  SELECT * INTO v_audit FROM public.horse_daily_audit WHERE day = DATE '2026-11-06' FOR UPDATE;
  SELECT * INTO v_sub FROM public.horse_daily_audit_analysis_submissions
   WHERE day = DATE '2026-11-06' AND analysis_md5 = '3cd21f2c9cf07bf69465dfe9b2d0aba4'
     AND outcome = 'retained_existing'
   ORDER BY submitted_at LIMIT 1;
  IF v_audit.day IS NULL OR v_sub.id IS NULL
     OR md5(v_audit.agent_analysis::text) <> '1c32430beee1f03f415873b8f56d17ff' THEN
    RAISE NOTICE '2026-11-06 analysis already moved; nothing to promote';
    RETURN;
  END IF;
  IF NOT public.fn_horse_audit_analysis_completes(v_audit.agent_analysis, v_sub.analysis) THEN
    RAISE EXCEPTION '2026-11-06 submission % does not complete the stored analysis', v_sub.id;
  END IF;
  UPDATE public.horse_daily_audit_analysis_submissions
     SET outcome = 'superseded', outcome_at = clock_timestamp()
   WHERE day = DATE '2026-11-06'
     AND analysis_md5 = '1c32430beee1f03f415873b8f56d17ff'
     AND outcome IN ('stored', 'attached_after_audit');
  UPDATE public.horse_daily_audit
     SET agent_analysis = v_sub.analysis, agent_analyzed_at = v_sub.submitted_at
   WHERE day = DATE '2026-11-06';
  UPDATE public.horse_daily_audit_analysis_submissions
     SET outcome = 'completes_existing', outcome_at = clock_timestamp()
   WHERE id = v_sub.id;
END
$promote$;

DO $post$
BEGIN
  IF NOT (to_regprocedure('public.fn_horse_audit_analysis_completes(jsonb,jsonb)') IS NOT NULL
          AND position('completes_existing' in pg_get_functiondef('public.fn_horse_audit_set_agent_analysis(date,jsonb)'::regprocedure)) > 0
          AND public.fn_horse_audit_analysis_completes('{"flaws":[{"a":1}]}'::jsonb, '{"flaws":[{"a":1},{"b":2}]}'::jsonb)
          AND NOT public.fn_horse_audit_analysis_completes('{"flaws":[{"a":1}]}'::jsonb, '{"flaws":[{"a":2},{"b":2}]}'::jsonb)
          AND NOT public.fn_horse_audit_analysis_completes('{"flaws":[{"a":1}]}'::jsonb, '{"flaws":[{"a":1}]}'::jsonb)) THEN
    RAISE EXCEPTION 'horse audit completion post-image missing';
  END IF;
END
$post$;
COMMIT;
