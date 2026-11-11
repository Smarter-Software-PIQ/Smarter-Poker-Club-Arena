-- 20261111133739_the_lightning_handoff_trigger_reaches_its_lightning_branch.sql
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-11 13:37:39 UTC.
--
-- ============================================================================
-- THE HANDOFF TRIGGER NEVER RAN FOR THE LIGHTNING SOURCE
-- (Reliability incident ee77584d-da8d-4535-ad86-e27c5a2e8b35,
--  LightningHandHost.post_commit_obligations_pending, table 0f84a1ab)
-- ============================================================================
--
-- 20261110234927 taught fn_post_commit_handoff_is_a_warning() a second branch:
-- a Lightning `post-commit obligations refused (predecessor_pending)` alert
-- whose hand carries a persisted hand_atomic_commits.post_commit_payload is a
-- designed handoff, downgraded to 'warning'. It installed (its marker is in
-- the live function body), and it has never fired once.
--
-- The trigger that calls the function was created by 20261105174016 with a
-- WHEN clause naming ONE source:
--     CREATE TRIGGER a2_post_commit_handoff_is_a_warning BEFORE INSERT
--       ON public.financial_alerts FOR EACH ROW
--       WHEN (new.source = 'ServerTableEngine.post_commit_obligations_pending')
-- Postgres evaluates WHEN before calling the function, so a row whose source
-- is 'LightningHandHost.post_commit_obligations_pending' never reaches the
-- Lightning branch. Measured on production 2026-11-11 13:30Z: every
-- LightningHandHost alert in the last 12 hours (10 rows) is severity
-- 'critical' with no 'reclassified' key, and every one of the nine
-- predecessor_pending rows has exactly one hand_atomic_commits row with a
-- non-null post_commit_payload - the precise shape the branch downgrades.
-- Every one was then completed by the projection worker (resolved 3-18 min
-- later). The incident collected 79 occurrences and 6 recurrences, and the
-- Reliability Controller escalated it to AI AGENT NEEDED.
--
-- THE FIX is the WHEN clause, nothing else. The function body is unchanged
-- and still compares source and error for EQUALITY, so the statement-timeout,
-- LIGHTNING_HAND_IN_PROGRESS and predecessor lookup/scan failures from the
-- same source keep paging critical, and a predecessor_pending alert whose
-- hand has NO durable envelope keeps paging critical too.
--
-- THE REAL PAGE IS PRESERVED: post-commit-stranded-watchdog-5m writes a
-- critical row when an envelope is still unfinished after 10 minutes, under
-- its own source, which this trigger does not match. The install refuses if
-- that job is not scheduled, exactly as 20261110234927 did.
--
-- Regression protection: tests/a-handoff-trigger-reaches-every-source-its-function-names.law.test.ts
-- fails the build if a source the function compares for equality is missing
-- from the trigger's WHEN clause in the latest migration that defines it.
--
-- Severity classification only. No watcher, loop or reconciler is added; the
-- outbox, the projection worker, the envelope and every money row are
-- untouched.
--
-- @live-proof: position('LightningHandHost.post_commit_obligations_pending' in (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t WHERE t.tgname = 'a2_post_commit_handoff_is_a_warning' AND t.tgrelid = 'public.financial_alerts'::regclass AND NOT t.tgisinternal)) > 0 AND position('ServerTableEngine.post_commit_obligations_pending' in (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t WHERE t.tgname = 'a2_post_commit_handoff_is_a_warning' AND t.tgrelid = 'public.financial_alerts'::regclass AND NOT t.tgisinternal)) > 0

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '20s';

DO $pre$
BEGIN
  IF position('A DURABLE SUCCESSOR OWNS IT (20261110234927)' in
              pg_get_functiondef('public.fn_post_commit_handoff_is_a_warning()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'POST_COMMIT_HANDOFF_PREIMAGE_CHANGED: the Lightning branch of 20261110234927 is not installed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'post-commit-stranded-watchdog-5m' AND active) THEN
    RAISE EXCEPTION 'POST_COMMIT_STRANDED_WATCHDOG_NOT_ACTIVE: refusing to downgrade a handoff while the 10-minute guard is not scheduled';
  END IF;
END
$pre$;

DROP TRIGGER IF EXISTS a2_post_commit_handoff_is_a_warning ON public.financial_alerts;
CREATE TRIGGER a2_post_commit_handoff_is_a_warning
  BEFORE INSERT ON public.financial_alerts
  FOR EACH ROW
  WHEN (new.source IN ('ServerTableEngine.post_commit_obligations_pending',
                       'LightningHandHost.post_commit_obligations_pending'))
  EXECUTE FUNCTION public.fn_post_commit_handoff_is_a_warning();

DO $post$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_def
    FROM pg_trigger t
   WHERE t.tgname = 'a2_post_commit_handoff_is_a_warning'
     AND t.tgrelid = 'public.financial_alerts'::regclass
     AND NOT t.tgisinternal;
  IF v_def IS NULL
     OR position('LightningHandHost.post_commit_obligations_pending' in v_def) = 0
     OR position('ServerTableEngine.post_commit_obligations_pending' in v_def) = 0 THEN
    RAISE EXCEPTION 'POST_COMMIT_HANDOFF_POSTIMAGE: the trigger does not name both handoff sources';
  END IF;
END
$post$;

COMMIT;
