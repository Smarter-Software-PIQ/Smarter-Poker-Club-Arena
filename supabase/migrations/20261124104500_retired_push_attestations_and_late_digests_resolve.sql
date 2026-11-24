-- @live-proof: position('owner-operational-push' in pg_get_functiondef('public.fn_try_record_owner_notification(uuid)'::regprocedure)) > 0
-- @live-proof: EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'zz_a_sent_digest_resolves_its_missing_alert' AND tgenabled <> 'D')
-- 20261124104500_retired_push_attestations_and_late_digests_resolve.sql
--
-- WHAT THIS CHANGES, AND WHY (2026-11-24, found by B2 after #11893):
--
-- Twelve rows still fired that the #11893 supersede logic cannot match:
--
--  * 10 chip-integrity attestation copies (events 39281-41855, Sept 14-16)
--    recorded under the retired source 'owner-operational-push' before the
--    owner notifications moved to 'owner-operational-notifications'. #11893
--    lets a newer attestation resolve older copies only in the new source.
--    The supersede now covers both sources, so the retired copies are
--    superseded by the same newer re-measurement.
--  * 2 DailyDigest.not_delivered rows (sp-digest-missing:2026-10-25 and
--    :2026-10-26) raised by fn_sp_digest_watchdog. They carry the day under
--    payload.run.day, not payload.day, and nothing resolved them when the
--    digest was delivered late (Oct 26 13:47Z and Oct 27 18:07Z, status
--    'sent'). A digest run reaching 'sent' now resolves its own
--    sp-digest-missing:<day> alert (trigger on public.sp_daily_digest_runs).
--
-- One-time correction, each row's condition proven resolved: the retired
-- attestation copies that a newer attestation exists for, and the
-- not-delivered rows whose day's digest run is 'sent'. Proved on production
-- in a rolled-back probe first (2026-11-24 10:40Z: 10 attestation copies and
-- 2 not-delivered rows resolved; 67 other retired-push rows untouched).
-- No money moves. Guarded single-anchor amendment, re-read after rewrite,
-- idempotent.

BEGIN;

DO $migration$
DECLARE
  f regprocedure := 'public.fn_try_record_owner_notification(uuid)'::regprocedure;
  a text := E'WHERE e.source = ''owner-operational-notifications'' AND e.status = ''firing''\n         AND e.id < v_id AND e.alertname LIKE ''financial_attestation:%'';';
  x text := E'WHERE e.source IN (''owner-operational-notifications'', ''owner-operational-push'') AND e.status = ''firing''\n         AND e.id < v_id AND e.alertname LIKE ''financial_attestation:%'';';
  d text;
  n int;
BEGIN
  d := pg_get_functiondef(f);
  IF position('owner-operational-push' in d) = 0 THEN
    n := (length(d) - length(replace(d, a, ''))) / length(a);
    IF n <> 1 THEN RAISE EXCEPTION 'anchor found % times in fn_try_record_owner_notification, expected 1', n; END IF;
    EXECUTE replace(d, a, x);
    IF position('owner-operational-push' in pg_get_functiondef(f)) = 0 THEN
      RAISE EXCEPTION 'rewrite of fn_try_record_owner_notification did not land';
    END IF;
  END IF;
END
$migration$;

-- @probe-for: public.fn_try_record_owner_notification
DO $probe$
DECLARE v_nid uuid;
BEGIN
  SELECT notification_id INTO v_nid FROM public.operational_notification_destinations
   WHERE inbox_event_id IS NOT NULL AND original_notification->>'type' = 'financial_attestation'
   ORDER BY inbox_event_id DESC LIMIT 1;
  IF v_nid IS NOT NULL THEN
    PERFORM public.fn_try_record_owner_notification(v_nid);
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- A digest delivered, even late: its not-delivered alert resolves.
CREATE OR REPLACE FUNCTION public.fn_sp_digest_sent_resolves_its_missing_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $fn$
BEGIN
  UPDATE public.operational_alert_events e
     SET status = 'resolved', last_received_at = clock_timestamp(),
         payload = e.payload || jsonb_build_object('resolved_at', clock_timestamp(),
           'resolution', 'the digest for ' || NEW.day || ' was delivered', 'sent_at', NEW.sent_at)
   WHERE e.source = 'sp-daily-digest' AND e.status = 'firing'
     AND e.event_key = 'sp-digest-missing:' || NEW.day;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION public.fn_sp_digest_sent_resolves_its_missing_alert() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_a_sent_digest_resolves_its_missing_alert ON public.sp_daily_digest_runs;
CREATE TRIGGER zz_a_sent_digest_resolves_its_missing_alert
  AFTER INSERT OR UPDATE OF status ON public.sp_daily_digest_runs
  FOR EACH ROW WHEN (NEW.status = 'sent')
  EXECUTE FUNCTION public.fn_sp_digest_sent_resolves_its_missing_alert();

-- The trigger proves itself: a fixture day's firing alert resolves when the
-- run is recorded sent (undone with the subtransaction).
DO $t$
DECLARE v_id bigint; v_s text;
BEGIN
  v_id := public.fn_record_operational_alert('sp-daily-digest', 'sp-digest-missing:1999-01-01', 'DailyDigest.not_delivered', 'firing', 'critical', '{}'::jsonb);
  INSERT INTO public.sp_daily_digest_runs(day, status) VALUES ('1999-01-01', 'sent');
  SELECT status INTO v_s FROM public.operational_alert_events WHERE id = v_id;
  IF v_s <> 'resolved' THEN RAISE EXCEPTION 'a sent digest did not resolve its missing alert (%)', v_s; END IF;
  RAISE EXCEPTION 'trigger-proof-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'trigger-proof-unwind' THEN RAISE; END IF;
END $t$;

-- One-time correction, each row's condition proven resolved.
UPDATE public.operational_alert_events e
   SET status = 'resolved', last_received_at = clock_timestamp(),
       payload = e.payload || jsonb_build_object('resolved_at', clock_timestamp(),
         'resolution', 'superseded by a newer chip-integrity attestation')
 WHERE e.source = 'owner-operational-push' AND e.status = 'firing'
   AND e.alertname LIKE 'financial_attestation:%'
   AND EXISTS (SELECT 1 FROM public.operational_alert_events z
                WHERE z.source IN ('owner-operational-notifications', 'owner-operational-push')
                  AND z.alertname LIKE 'financial_attestation:%' AND z.id > e.id);

UPDATE public.operational_alert_events e
   SET status = 'resolved', last_received_at = clock_timestamp(),
       payload = e.payload || jsonb_build_object('resolved_at', clock_timestamp(),
         'resolution', 'the digest for that day was delivered late')
 WHERE e.source = 'sp-daily-digest' AND e.status = 'firing'
   AND e.alertname = 'DailyDigest.not_delivered'
   AND EXISTS (SELECT 1 FROM public.sp_daily_digest_runs r
                WHERE e.event_key = 'sp-digest-missing:' || r.day AND r.status = 'sent');

COMMIT;
