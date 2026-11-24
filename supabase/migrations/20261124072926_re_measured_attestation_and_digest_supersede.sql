-- @live-proof: position('A NEWER CHIP-INTEGRITY ATTESTATION SUPERSEDES' in pg_get_functiondef('public.fn_try_record_owner_notification(uuid)'::regprocedure)) > 0
-- @live-proof: position('A NEWER DIGEST EVALUATION SUPERSEDES' in pg_get_functiondef('public.fn_sp_dispatch_attention(date,jsonb)'::regprocedure)) > 0
-- 20261124072926_re_measured_attestation_and_digest_supersede.sql
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Two producers re-measure a condition on a schedule but never resolve what
-- they raised earlier, so their Reliability Controller incidents could never
-- clear (same class as #11197, #11220, #11221):
--
--  * Chip-integrity attestation (incident 6ed756e0). Each daily
--    financial_attestation notice is a complete re-measurement, recorded by
--    fn_try_record_owner_notification under its title. "Attention needed" and
--    "all green" carry different titles, so a later all-green never closed an
--    earlier attention-needed copy: 77 were still firing on 2026-11-24.
--    Now each newly recorded attestation resolves every older firing
--    attestation copy (superseded_by = the new row), so only the latest
--    attestation stands; a still-red attestation stays firing on its own.
--
--  * Daily Digest attention rules (incidents 9b667bc4 big_diamond_move,
--    6aeff72f phone_verification_low). fn_sp_dispatch_attention raises one
--    firing row per rule per day and never resolves it. Each day's digest
--    re-evaluates every rule; now the dispatch first resolves firing digest
--    notices from earlier days (a rule still true is raised again for its own
--    day). stuck_tournament keeps its own condition-based resolution
--    (fn_sp_critical_scan, 20261117173255) and is excluded.
--
-- One-time correction: older attestation copies and earlier-day digest notices
-- are resolved with the same note. Proved on production in a rolled-back DO
-- block: both anchors found once, rewrites landed, 80 attestation and 132
-- digest notices resolved, 508 ms.
--
-- No money moves. Guarded single-anchor amendments, re-read after rewrite,
-- idempotent.

BEGIN;

DO $migration$
DECLARE
  f1 regprocedure := 'public.fn_try_record_owner_notification(uuid)'::regprocedure;
  a1 text := E'    UPDATE public.operational_notification_destinations SET inbox_event_id=v_id,\n      last_attempt_at=clock_timestamp(),last_error=NULL WHERE notification_id=p_id;\n    RETURN v_id;';
  x1 text := E'    /* A NEWER CHIP-INTEGRITY ATTESTATION SUPERSEDES THE OLDER ONES (2026-11-24).\n       Each financial_attestation is a complete re-measurement; the earlier\n       copies are resolved so only the latest one stands. */\n    IF n->>''type'' = ''financial_attestation'' THEN\n      UPDATE public.operational_alert_events e\n         SET status = ''resolved'', last_received_at = clock_timestamp(),\n             payload = e.payload || jsonb_build_object(''resolution'', ''superseded by a newer chip-integrity attestation'', ''superseded_by'', v_id, ''resolved_at'', clock_timestamp())\n       WHERE e.source = ''owner-operational-notifications'' AND e.status = ''firing''\n         AND e.id < v_id AND e.alertname LIKE ''financial_attestation:%'';\n    END IF;\n';
  m1 text := 'A NEWER CHIP-INTEGRITY ATTESTATION SUPERSEDES';
  f2 regprocedure := 'public.fn_sp_dispatch_attention(date,jsonb)'::regprocedure;
  a2 text := E'BEGIN\n  FOR it IN';
  x2 text := E'BEGIN\n  /* A NEWER DIGEST EVALUATION SUPERSEDES AN EARLIER DAY''S ATTENTION (2026-11-24).\n     Each day''s digest re-measures every rule; a rule still true is raised\n     again for its own day. stuck_tournament resolves on its own condition\n     (fn_sp_critical_scan, 20261117173255). */\n  UPDATE public.operational_alert_events e\n     SET status = ''resolved'', last_received_at = clock_timestamp(),\n         payload = e.payload || jsonb_build_object(''resolution'', ''superseded by the digest for '' || p_day, ''resolved_at'', clock_timestamp())\n   WHERE e.source = ''sp-daily-digest'' AND e.status = ''firing''\n     AND e.alertname <> ''DailyDigest.stuck_tournament''\n     AND (e.payload->>''day'') < p_day::text;\n  FOR it IN';
  m2 text := 'A NEWER DIGEST EVALUATION SUPERSEDES';
  d text;
  n int;
BEGIN
  d := pg_get_functiondef(f1);
  IF position(m1 in d) = 0 THEN
    n := (length(d) - length(replace(d, a1, ''))) / length(a1);
    IF n <> 1 THEN RAISE EXCEPTION 'anchor found % times in fn_try_record_owner_notification, expected 1', n; END IF;
    EXECUTE replace(d, a1, x1 || a1);
    IF position(m1 in pg_get_functiondef(f1)) = 0 THEN RAISE EXCEPTION 'rewrite of fn_try_record_owner_notification did not land'; END IF;
  END IF;
  d := pg_get_functiondef(f2);
  IF position(m2 in d) = 0 THEN
    n := (length(d) - length(replace(d, a2, ''))) / length(a2);
    IF n <> 1 THEN RAISE EXCEPTION 'anchor found % times in fn_sp_dispatch_attention, expected 1', n; END IF;
    EXECUTE replace(d, a2, x2);
    IF position(m2 in pg_get_functiondef(f2)) = 0 THEN RAISE EXCEPTION 'rewrite of fn_sp_dispatch_attention did not land'; END IF;
  END IF;
END
$migration$;

-- One-time correction.
UPDATE public.operational_alert_events e
   SET status = 'resolved', last_received_at = clock_timestamp(),
       payload = e.payload || jsonb_build_object('resolution', 'superseded by a newer chip-integrity attestation', 'resolved_at', clock_timestamp())
 WHERE e.source = 'owner-operational-notifications' AND e.status = 'firing'
   AND e.alertname LIKE 'financial_attestation:%'
   AND e.id < (SELECT max(id) FROM public.operational_alert_events
                WHERE source = 'owner-operational-notifications' AND alertname LIKE 'financial_attestation:%');

UPDATE public.operational_alert_events e
   SET status = 'resolved', last_received_at = clock_timestamp(),
       payload = e.payload || jsonb_build_object('resolution', 'superseded by a later daily digest', 'resolved_at', clock_timestamp())
 WHERE e.source = 'sp-daily-digest' AND e.status = 'firing'
   AND e.alertname <> 'DailyDigest.stuck_tournament'
   AND (e.payload->>'day') < (SELECT max(payload->>'day') FROM public.operational_alert_events WHERE source = 'sp-daily-digest');

COMMIT;
