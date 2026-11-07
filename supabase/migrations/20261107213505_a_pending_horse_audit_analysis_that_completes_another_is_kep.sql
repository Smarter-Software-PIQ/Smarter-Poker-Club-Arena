-- 20261107213505_a_pending_horse_audit_analysis_that_completes_another_is_kep.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A PENDING HORSE AUDIT ANALYSIS THAT COMPLETES ANOTHER IS KEPT, AND A SAVE
-- RACING THE MACHINE AUDIT IS NEVER ORPHANED (2026-11-07, follow-up to
-- 20261107191435).
--
-- 20261107191435 taught fn_horse_audit_set_agent_analysis that a submission
-- which keeps every stored flaw unchanged and adds more replaces the stored
-- analysis (fn_horse_audit_analysis_completes). Two paths still did not obey
-- that rule:
--
--  1. The pending path. An analysis saved before the day's machine audit row
--     exists is held as pending_machine_audit, and the BEFORE INSERT OR UPDATE
--     OF stats trigger attaches the EARLIEST pending submission when the row
--     lands and files every later one as duplicate / retained_existing. So a
--     partial run followed by a completing run, both before the audit, would
--     show the partial one: exactly the 11-06 failure, on the other path. The
--     trigger now walks the pending submissions in submission order and lets
--     each one that completes the current choice replace it (the replaced one
--     is re-marked superseded), with the same rule and the same outcomes as
--     the direct save.
--
--  2. A save racing the machine audit. The save looked for the audit row,
--     found none (the writer had not committed) and filed its analysis as
--     pending after the writer's trigger had already looked for pending rows,
--     so the analysis was never attached by anything. Both sides now take the
--     same transaction-scoped advisory lock for the day on that path only: the
--     save before it decides "pending", the trigger before it reads pending
--     rows. Whichever commits second sees the other. The save takes the lock
--     only when it found no usable row and therefore holds no row lock, and
--     the trigger only when it is about to attach, so the lock order is the
--     same in both and cannot deadlock with the row lock.
--
-- Concurrent saves on an existing row were already serialised by the save's
-- SELECT ... FOR UPDATE on the day's row. With both changes, no ordering of
-- saves and audit writes can leave a less complete analysis displayed over a
-- more complete one that it does not contain: a replacement must contain every
-- flaw of what it replaces. Nothing is deleted; every submission stays in
-- horse_daily_audit_analysis_submissions with its outcome.
--
-- No watcher, cron or repair loop: the decision is made in the save and in the
-- audit row's own trigger, at the moment of the write.
-- @live-proof: position('pg_advisory_xact_lock' in pg_get_functiondef('public.fn_horse_audit_attach_pending_analysis()'::regprocedure)) > 0 AND position('fn_horse_audit_analysis_completes' in pg_get_functiondef('public.fn_horse_audit_attach_pending_analysis()'::regprocedure)) > 0 AND position('pg_advisory_xact_lock' in pg_get_functiondef('public.fn_horse_audit_set_agent_analysis(date,jsonb)'::regprocedure)) > 0

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.fn_horse_audit_analysis_day_lock(p_day date)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $f$
  SELECT hashtextextended('horse_daily_audit_analysis:' || p_day::text, 0)
$f$;
COMMENT ON FUNCTION public.fn_horse_audit_analysis_day_lock(date) IS
  'Advisory lock key shared by fn_horse_audit_set_agent_analysis (pending path) and fn_horse_audit_attach_pending_analysis, so a save racing the machine audit is never orphaned (20261107213505).';
REVOKE ALL ON FUNCTION public.fn_horse_audit_analysis_day_lock(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_horse_audit_analysis_day_lock(date) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_horse_audit_set_agent_analysis(p_day date, p_analysis jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_audit   public.horse_daily_audit%ROWTYPE;
  v_found   boolean;
  v_sub_id  uuid;
  v_outcome text;
BEGIN
  IF p_day IS NULL OR p_analysis IS NULL OR jsonb_typeof(p_analysis) <> 'object' THEN
    RAISE EXCEPTION 'fn_horse_audit_set_agent_analysis needs a day and a json object' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_audit FROM public.horse_daily_audit WHERE day = p_day FOR UPDATE;
  v_found := FOUND;

  IF NOT v_found OR v_audit.stats = '{}'::jsonb THEN
    -- No usable audit row yet. Serialise with the audit row's attach trigger
    -- before deciding "pending", then look again: a writer that committed
    -- while we waited is now visible.
    PERFORM pg_advisory_xact_lock(public.fn_horse_audit_analysis_day_lock(p_day));
    SELECT * INTO v_audit FROM public.horse_daily_audit WHERE day = p_day FOR UPDATE;
    v_found := FOUND;
  END IF;

  IF NOT v_found OR v_audit.stats = '{}'::jsonb THEN
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
      WHEN 'pending_machine_audit' THEN 'The machine audit for this day is not written yet. The analysis is kept and attaches itself when the audit row lands; a later pending analysis that keeps every flaw of it and adds more replaces it then.'
      WHEN 'duplicate' THEN 'The same analysis is already stored.'
      WHEN 'completes_existing' THEN 'This analysis keeps every flaw of the stored analysis unchanged and adds more, so it replaced the stored analysis. The earlier one is kept in horse_daily_audit_analysis_submissions as superseded.'
      ELSE 'A different analysis is already stored and was kept. To replace it, keep every flaw of the stored analysis unchanged and add yours; this submission is retained in horse_daily_audit_analysis_submissions.' END);
END
$function$;
REVOKE ALL ON FUNCTION public.fn_horse_audit_set_agent_analysis(date, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_horse_audit_set_agent_analysis(date, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_horse_audit_attach_pending_analysis()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sub     public.horse_daily_audit_analysis_submissions%ROWTYPE;
  v_chosen  public.horse_daily_audit_analysis_submissions%ROWTYPE;
  v_any     boolean := false;
BEGIN
  IF NEW.agent_analysis IS NOT NULL OR NEW.stats IS NULL OR NEW.stats = '{}'::jsonb THEN
    RETURN NEW;
  END IF;

  -- Same key as the save's pending path, so a save that committed "pending"
  -- while this row was being written is visible below.
  PERFORM pg_advisory_xact_lock(public.fn_horse_audit_analysis_day_lock(NEW.day));

  FOR v_sub IN
    SELECT * FROM public.horse_daily_audit_analysis_submissions s
     WHERE s.day = NEW.day AND s.outcome = 'pending_machine_audit'
     ORDER BY s.submitted_at ASC, s.id ASC
  LOOP
    IF NOT v_any THEN
      v_chosen := v_sub;
      v_any := true;
      UPDATE public.horse_daily_audit_analysis_submissions
         SET outcome = 'attached_after_audit', outcome_at = clock_timestamp()
       WHERE id = v_sub.id;
    ELSIF v_sub.analysis_md5 = v_chosen.analysis_md5 THEN
      UPDATE public.horse_daily_audit_analysis_submissions
         SET outcome = 'duplicate', outcome_at = clock_timestamp()
       WHERE id = v_sub.id;
    ELSIF public.fn_horse_audit_analysis_completes(v_chosen.analysis, v_sub.analysis) THEN
      UPDATE public.horse_daily_audit_analysis_submissions
         SET outcome = 'superseded', outcome_at = clock_timestamp()
       WHERE id = v_chosen.id;
      UPDATE public.horse_daily_audit_analysis_submissions
         SET outcome = 'completes_existing', outcome_at = clock_timestamp()
       WHERE id = v_sub.id;
      v_chosen := v_sub;
    ELSE
      UPDATE public.horse_daily_audit_analysis_submissions
         SET outcome = 'retained_existing', outcome_at = clock_timestamp()
       WHERE id = v_sub.id;
    END IF;
  END LOOP;

  IF v_any THEN
    NEW.agent_analysis := v_chosen.analysis;
    NEW.agent_analyzed_at := v_chosen.submitted_at;
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.fn_horse_audit_attach_pending_analysis() FROM PUBLIC, anon, authenticated;

DO $post$
BEGIN
  IF NOT (position('pg_advisory_xact_lock' in pg_get_functiondef('public.fn_horse_audit_attach_pending_analysis()'::regprocedure)) > 0
          AND position('fn_horse_audit_analysis_completes' in pg_get_functiondef('public.fn_horse_audit_attach_pending_analysis()'::regprocedure)) > 0
          AND position('pg_advisory_xact_lock' in pg_get_functiondef('public.fn_horse_audit_set_agent_analysis(date,jsonb)'::regprocedure)) > 0
          AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'horse_daily_audit_attach_pending_analysis'
                         AND tgrelid = 'public.horse_daily_audit'::regclass)) THEN
    RAISE EXCEPTION 'horse audit pending-completion post-image missing';
  END IF;
END
$post$;
COMMIT;
