-- 20261110234927_the_lightning_handoff_warning_needs_a_successor.sql
--
-- Version reserved by scripts/reserve-migration-version.sh against this tree,
-- origin/main and every sibling worktree on this machine.
--
-- ============================================================================
-- THE LIGHTNING POST-COMMIT HANDOFF IS A WARNING ONLY WHEN A SUCCESSOR OWNS IT
-- (Reliability incident a974b740-b4d4-4c50-9b92-b4b89a1730da,
--  LightningHandHost.post_commit_obligations_pending, table ea34f32d)
-- ============================================================================
--
-- SUPERSEDES 20261110224637, the same change, which REFUSED on its own
-- postimage with nothing committed: it asserted a marker string that its own
-- replacement body wrapped across two lines, so the contiguous string was
-- never present and the assertion could not pass. Production was left
-- untouched, confirmed read-only: the function still hashes to its pre-patch
-- md5. This file carries the identical change with the marker on ONE line.
--
-- WHAT WENT WRONG. fn_post_commit_handoff_is_a_warning exists so that a
-- post-commit OWNERSHIP HANDOFF does not page as critical: the outbox row
-- stays authoritative and the projection worker finishes the envelope. It
-- matched one source and one error only:
--     source = 'ServerTableEngine.post_commit_obligations_pending'
--     AND context->>'error' = 'f06_owner_changed'
-- The Lightning host raises the same designed handoff under its own name, so
-- it kept 'critical' and the reliability controller escalated it to an
-- AI-AGENT-NEEDED page: 27 occurrences and 3 recurrences on 2026-11-10 for
-- table ea34f32d alone, every one of which the successor completed. Financial
-- alert ea0ae17c resolved itself the same day with "the post-commit envelope
-- for this hand has been applied; post_commit_completed_at is set".
--
-- WHY THE MATCH IS EXACT AND NOT A PATTERN. Read from financial_alerts over
-- the last 7 days, this one source raises SIX distinct conditions, all
-- critical today:
--     263  post-commit obligations refused (predecessor_pending)   <- the handoff
--     124  post-commit obligations RPC failed: canceling statement due to statement timeout (57014)
--       8  post-commit obligations RPC failed: LIGHTNING_HAND_IN_PROGRESS ... (PLT01)
--       3  post-commit obligations RPC failed: Error: supabase_timeout
--       2  post-commit predecessor lookup failed: Error: supabase_timeout
--       1  post-commit predecessor scan failed: Error: supabase_timeout
-- Only the first is the handoff. The rest are genuine failures or unknown
-- outcomes and MUST stay critical: a timeout does not establish that the
-- obligation completed, and the hardening standard says so. A substring match
-- would be fragile against any future message carrying the same token, so the
-- error is compared for EQUALITY, and the source for equality too, which also
-- excludes the 'drift_incident:financial_alerts:...' mirror rows.
--
-- AND RECOGNISING THE WORDS IS NOT ENOUGH. Before treating a handoff as benign
-- this requires that a DURABLE SUCCESSOR ACTUALLY OWNS THE WORK: the hand's
-- row in hand_atomic_commits must carry a persisted post_commit_payload. That
-- payload is precisely what the projection worker applies and precisely what
-- fn_post_commit_stranded_watchdog reads (post_commit_payload IS NOT NULL AND
-- post_commit_completed_at IS NULL, older than 10 minutes). No payload means
-- nothing durable will finish the work, so the alert stays critical. Verified
-- on production 2026-11-10: every alert of this shape carries
-- context->>'hand_id', hand_atomic_commits.hand_id is its key, that table's
-- rows for ea34f32d carry payloads and stamp post_commit_completed_at 0.3 to
-- 0.5 s after commit, and 0 envelopes are stranded past 10 minutes.
--
-- THE REAL PAGE IS PRESERVED. post-commit-stranded-watchdog-5m is active on
-- "*/5 * * * *" and its last run at 2026-11-10 21:55:00Z succeeded; it writes
-- a critical financial_alerts row, which reaches the controller through
-- trg_ca_financial_alert_incident. Trigger order on financial_alerts is
-- a00_operational_source_intake, a2_post_commit_handoff_is_a_warning,
-- trg_ca_financial_alert_incident, zz_ca_alert_resolution_reaches_the_incident,
-- so this reclassification lands before the incident is created while the
-- watchdog's own critical row is untouched by it. This migration refuses to
-- install if that watchdog is not scheduled.
--
-- Severity classification only. No watcher, loop or reconciler is added, and
-- the outbox, the projection worker, the envelope and every money row are
-- untouched.
--
-- @live-proof: position('A DURABLE SUCCESSOR OWNS IT (20261110234927)' in pg_get_functiondef('public.fn_post_commit_handoff_is_a_warning()'::regprocedure)) > 0 AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'a2_post_commit_handoff_is_a_warning' AND tgrelid = 'public.financial_alerts'::regclass AND NOT tgisinternal AND tgenabled <> 'D') AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'post-commit-stranded-watchdog-5m' AND active)

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '20s';

DO $pre$
BEGIN
  IF md5(pg_get_functiondef('public.fn_post_commit_handoff_is_a_warning()'::regprocedure)) <> '7352efa472aafe6fa3963178adbcb51c' THEN
    RAISE EXCEPTION 'POST_COMMIT_HANDOFF_PREIMAGE_CHANGED: fn_post_commit_handoff_is_a_warning was edited since this patch was qualified';
  END IF;
  IF to_regclass('public.hand_atomic_commits') IS NULL THEN
    RAISE EXCEPTION 'POST_COMMIT_HANDOFF_PREIMAGE_CHANGED: public.hand_atomic_commits is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'post-commit-stranded-watchdog-5m' AND active) THEN
    RAISE EXCEPTION 'POST_COMMIT_STRANDED_WATCHDOG_NOT_ACTIVE: refusing to downgrade a handoff while the 10-minute guard is not scheduled';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.fn_post_commit_handoff_is_a_warning()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_hand uuid;
begin
  -- The ServerTableEngine owner-change handoff, unchanged.
  if new.source = 'ServerTableEngine.post_commit_obligations_pending'
     and new.severity = 'critical'
     and coalesce(new.context->>'error','') = 'f06_owner_changed' then
    new.severity := 'warning';
    new.context := coalesce(new.context,'{}'::jsonb) || jsonb_build_object(
      'reclassified', 'owner-change handoff; the outbox projection worker completes it. fn_post_commit_stranded_watchdog pages if it does not within 10 minutes.');
    return new;
  end if;

  -- A DURABLE SUCCESSOR OWNS IT (20261110234927). The Lightning handoff is a
  -- warning only when the hand carries a persisted post-commit envelope.
  -- Source and error are compared for EQUALITY: this one source also raises
  -- statement timeouts, LIGHTNING_HAND_IN_PROGRESS refusals and predecessor
  -- lookup and scan failures, and every one of those is a genuine failure or
  -- an unknown outcome that must keep paging critical.
  if new.source = 'LightningHandHost.post_commit_obligations_pending'
     and new.severity = 'critical'
     and coalesce(new.context->>'error','') = 'post-commit obligations refused (predecessor_pending)'
     and coalesce(new.context->>'hand_id','') ~ c_uuid then
    v_hand := (new.context->>'hand_id')::uuid;
    if exists (select 1 from public.hand_atomic_commits c
                where c.hand_id = v_hand
                  and c.post_commit_payload is not null) then
      new.severity := 'warning';
      new.context := coalesce(new.context,'{}'::jsonb) || jsonb_build_object(
        'reclassified', 'Lightning predecessor handoff with a durable post-commit envelope on its hand_atomic_commits row; '
                     || 'the outbox row stays authoritative and the projection worker completes it. '
                     || 'fn_post_commit_stranded_watchdog pages critical if it is still unfinished after 10 minutes.');
    end if;
  end if;

  return new;
end $function$;

DO $post$
BEGIN
  IF position('A DURABLE SUCCESSOR OWNS IT (20261110234927)' in
              pg_get_functiondef('public.fn_post_commit_handoff_is_a_warning()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'POST_COMMIT_HANDOFF_POSTIMAGE: the marker is not in the installed function';
  END IF;
END
$post$;

COMMIT;
