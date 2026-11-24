-- @live-proof: position('resolved_by_twin' in pg_get_functiondef('public.fn_operational_alert_resolved_twin_closes_firing()'::regprocedure)) > 0
-- @live-proof: position('heartbeat resumed' in pg_get_functiondef('smarter_private.record_host_heartbeat(text,jsonb)'::regprocedure)) > 0
-- @live-proof: position('free space is back above 5%' in pg_get_functiondef('smarter_private.host_heartbeat_check()'::regprocedure)) > 0
-- @live-proof: position('read horizon is no longer held' in pg_get_functiondef('public.fn_rakeback_settler_stranded_source_check()'::regprocedure)) > 0
-- @live-proof: position('ready half an hour before' in pg_get_functiondef('smarter_private.weekly_payout_readiness_check()'::regprocedure)) > 0
-- @live-proof: position('a later complete check no longer found' in pg_get_functiondef('public.fn_cash_pot_conservation_check(integer)'::regprocedure)) > 0
-- @live-proof: to_regprocedure('public.fn_resolve_operational_alerts(text,text,text)') IS NOT NULL
-- @live-proof: EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'zz_bug_report_delivery_resolves_its_alert' AND tgenabled <> 'D')
-- @live-proof: EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'zz_weekly_payout_paid_resolves_its_alerts' AND tgenabled <> 'D')
-- 20261124095900_every_alert_source_clears_on_its_condition.sql
--
-- WHAT THIS CHANGES, AND WHY (incident fix audit 2026-11-24, #11899):
--
-- tests/every-alert-producer-declares-its-resolve-path.law.test.ts found
-- sources that record firing rows in operational_alert_events and never
-- resolve them, so their Reliability Controller incidents can never clear and
-- the alert store fills with rows that describe nothing current. Each source
-- below now resolves its own rows, in its own producer, on its own measured
-- condition. No schedule, sweep or watcher is added: every resolve runs in the
-- producer's existing pass or in the transaction of the state change it names.
--
--   financial-alerts / drift-incidents mirrors: the resolved twin
--     (fn_operational_alert_resolved_twin_closes_firing) only re-labelled the
--     firing mirror 'informational'; its status stayed 'firing' for ever.
--     Read 2026-11-24 09:40Z: 100,716 firing financial-alerts-backfill rows
--     mirror financial_alerts rows that are resolved. The twin now resolves
--     every earlier firing mirror row of the same original alert.
--   host-heartbeat: a resumed heartbeat posted an 'info' row and left the
--     silence episode firing; a disk warning was keyed per day and never
--     cleared. The resume now resolves its episode, and the 5-minute check
--     resolves a disk warning once that volume is back above 5% free.
--   rakeback-settler-read-horizon: resolved by the hourly check once the
--     horizon is no longer held.
--   weekly-payout: the readiness check resolves its own not-ready alert when
--     the period is ready; the payout's refused/deferred/not-ready/lost
--     alerts resolve when the week records agents_paid, clubs_paid and
--     players_paid (trigger on smarter_private.weekly_payout_owner_updates).
--     The invoice-mismatch alert is critical and is NOT auto-resolved.
--   cash-pot-conservation-measurement: a completed check resolves earlier
--     checks' rows for a condition it no longer finds.
--   bug-report-routing: a delivery receipt reaching 'delivered' resolves its
--     undelivered alert.
--   install-queue, mac-studio-git-maintenance (Mac senders): resolve through
--     fn_resolve_operational_alerts, restricted to those two sources, called
--     by operations/ops-mac/heartbeat.sh and git-maintenance-guard.sh when
--     their own condition clears.
--
-- One-time correction, proven before install: weekly-payout rows whose week
-- has recorded all three paid milestones; the 2026-11-02 midway follow-up row
-- whose defect (fn_ca_engine_release_stall_check stored a uuid in a bigint,
-- issue #9413) is fixed in the live body (v_open uuid). The ~100,700 stale
-- financial-alerts-backfill rows are NOT corrected here: each status change
-- fires the controller intake (~5 ms a row, ~500 s), past the install budget.
--
-- Guarded: every anchor must appear exactly once, every rewrite is re-read,
-- and a second run is a no-op.

BEGIN;

DO $migration$
DECLARE
  v_def text; v_n int;
  a record;
BEGIN
  FOR a IN SELECT * FROM (VALUES
    ('public.fn_operational_alert_resolved_twin_closes_firing()',
     E'    ELSIF NEW.source = ''alertmanager'' THEN', 'resolved_by_twin',
     $add$      -- THE RESOLVED TWIN RESOLVES ITS FIRING MIRROR (2026-11-24): the line
      -- above only re-labels; the original alert resolved, so every earlier
      -- firing mirror row of it resolves too.
      UPDATE public.operational_alert_events o
         SET status = 'resolved',
             payload = o.payload || jsonb_build_object('resolved_at', NEW.received_at, 'resolved_by_twin', NEW.id)
       WHERE o.id IN (SELECT f.id FROM public.operational_alert_events f
                       WHERE split_part(f.event_key, ':', 1) = v_aid
                         AND f.source IN (v_prefix || '-backfill', v_prefix || '-updates')
                         AND f.status = 'firing' AND f.id < NEW.id
                       FOR UPDATE SKIP LOCKED);
$add$, 'before'),
    ('smarter_private.record_host_heartbeat(text,jsonb)',
     E' IF prior.silence_event_key IS NOT NULL THEN\n', 'heartbeat resumed',
     $add$  UPDATE public.operational_alert_events e
     SET status = 'resolved',
         payload = e.payload || jsonb_build_object('resolved_at', n, 'resolution', 'heartbeat resumed')
   WHERE e.source = 'host-heartbeat' AND e.event_key = prior.silence_event_key AND e.status = 'firing';
$add$, 'after'),
    ('smarter_private.host_heartbeat_check()',
     E' RETURN jsonb_build_object(''checked_at'',n,''silences_fired'',fired,''disk_warnings'',disks);', 'free space is back above 5%',
     $add$ -- A disk warning resolves once its volume is back above 5% free (2026-11-24).
 UPDATE public.operational_alert_events e
    SET status = 'resolved',
        payload = e.payload || jsonb_build_object('resolved_at', n, 'resolution', 'free space is back above 5%')
  WHERE e.source = 'host-heartbeat' AND e.alertname = 'HostDiskNearlyFull' AND e.status = 'firing'
    AND EXISTS (SELECT 1 FROM smarter_private.host_heartbeats hb
                 WHERE hb.host = e.payload->>'host' AND hb.expected
                   AND jsonb_typeof(hb.details->'disks'->(e.payload->>'volume')->'free_pct') = 'number')
    AND NOT EXISTS (SELECT 1 FROM smarter_private.host_heartbeats hb
                     WHERE hb.host = e.payload->>'host' AND hb.expected
                       AND jsonb_typeof(hb.details->'disks'->(e.payload->>'volume')->'free_pct') = 'number'
                       AND (hb.details->'disks'->(e.payload->>'volume')->>'free_pct')::numeric < 5);
$add$, 'before'),
    ('public.fn_rakeback_settler_stranded_source_check()',
     E'  RETURN jsonb_build_object(''checked'', true, ''window_from'', v_from,', 'read horizon is no longer held',
     $add$  -- The read horizon is no longer held: its earlier warnings resolve (2026-11-24).
  IF v_horizon->>'horizon' IS NOT NULL AND v_held <= c_hold THEN
    UPDATE public.operational_alert_events e
       SET status = 'resolved',
           payload = e.payload || jsonb_build_object('resolved_at', clock_timestamp(),
             'resolution', 'the read horizon is no longer held', 'held_for_now', v_held::text)
     WHERE e.source = 'rakeback-settler-read-horizon' AND e.status = 'firing';
  END IF;

$add$, 'before'),
    ('smarter_private.weekly_payout_readiness_check()',
     E' IF ok THEN RETURN jsonb_build_object(''ready'',true,''scopes'',missing); END IF;', 'ready half an hour before',
     $add$ IF ok THEN
  -- Ready: this period's not-ready alert resolves (2026-11-24).
  UPDATE public.operational_alert_events ev
     SET status = 'resolved',
         payload = ev.payload || jsonb_build_object('resolved_at', n, 'resolution', 'the period is ready half an hour before its payout or later')
   WHERE ev.source = 'weekly-payout' AND ev.event_key = 'not-ready-at-0330:' || e::text AND ev.status = 'firing';
 END IF;
$add$, 'before'),
    ('public.fn_cash_pot_conservation_check(integer)',
     E'  RETURN v_result;\n\nEND;', 'a later complete check no longer found',
     $add$  -- A completed check resolves earlier checks' rows for a condition it no
  -- longer finds (2026-11-24).
  UPDATE public.operational_alert_events e
     SET status = 'resolved',
         payload = e.payload || jsonb_build_object('resolved_at', clock_timestamp(),
           'resolution', 'a later complete check no longer found this condition', 'resolved_by_check', v_check_id)
   WHERE e.source = 'cash-pot-conservation-measurement' AND e.status = 'firing'
     AND split_part(e.event_key, ':', 1) <> v_check_id::text
     AND NOT EXISTS (SELECT 1 FROM public.ca_cash_pot_check_anomalies x
                      WHERE x.check_id = v_check_id AND x.condition_kind = split_part(e.event_key, ':', 2));
$add$, 'before')
  ) AS t(fn, anchor, marker, addition, place)
  LOOP
    v_def := pg_get_functiondef(a.fn::regprocedure);
    IF position(a.marker in v_def) > 0 THEN
      RAISE NOTICE '% already applied', a.fn;
      CONTINUE;
    END IF;
    v_n := (length(v_def) - length(replace(v_def, a.anchor, ''))) / length(a.anchor);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'anchor found % times in %, expected 1', v_n, a.fn;
    END IF;
    IF a.place = 'before' THEN
      EXECUTE replace(v_def, a.anchor, a.addition || a.anchor);
    ELSE
      EXECUTE replace(v_def, a.anchor, a.anchor || a.addition);
    END IF;
    IF position(a.marker in pg_get_functiondef(a.fn::regprocedure)) = 0 THEN
      RAISE EXCEPTION 'rewrite of % did not land', a.fn;
    END IF;
  END LOOP;
END
$migration$;

-- Mac senders resolve through one narrow door: only these two sources, only
-- firing rows, only by an event-key prefix the sender itself recorded.
CREATE OR REPLACE FUNCTION public.fn_resolve_operational_alerts(p_source text, p_event_key_prefix text, p_resolution text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_n integer;
BEGIN
  IF p_source IS NULL OR p_source NOT IN ('install-queue', 'mac-studio-git-maintenance') THEN
    RAISE EXCEPTION 'fn_resolve_operational_alerts: source % does not resolve through this door', p_source USING ERRCODE = '22023';
  END IF;
  IF p_event_key_prefix IS NULL OR length(p_event_key_prefix) < 6 THEN
    RAISE EXCEPTION 'fn_resolve_operational_alerts: event key prefix too short' USING ERRCODE = '22023';
  END IF;
  UPDATE public.operational_alert_events e
     SET status = 'resolved',
         payload = e.payload || jsonb_build_object('resolved_at', clock_timestamp(),
           'resolution', left(COALESCE(NULLIF(btrim(p_resolution), ''), 'the sender measured the condition clear'), 500))
   WHERE e.source = p_source AND e.status = 'firing'
     AND left(e.event_key, length(p_event_key_prefix)) = p_event_key_prefix;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$fn$;
REVOKE ALL ON FUNCTION public.fn_resolve_operational_alerts(text, text, text) FROM PUBLIC, anon, authenticated;

-- A bug report delivered: its undelivered alert resolves.
CREATE OR REPLACE FUNCTION public.fn_bug_report_delivery_resolves_its_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  UPDATE public.operational_alert_events e
     SET status = 'resolved',
         payload = e.payload || jsonb_build_object('resolved_at', clock_timestamp(),
           'resolution', 'the bug report reached the owner Messenger', 'delivery_id', NEW.id)
   WHERE e.source = 'bug-report-routing' AND e.status = 'firing'
     AND e.event_key = 'bug-report-undelivered:' || NEW.source_table || ':' || NEW.source_id::text;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION public.fn_bug_report_delivery_resolves_its_alert() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_bug_report_delivery_resolves_its_alert ON public.bug_report_deliveries;
CREATE TRIGGER zz_bug_report_delivery_resolves_its_alert
  AFTER INSERT OR UPDATE OF status ON public.bug_report_deliveries
  FOR EACH ROW WHEN (NEW.status = 'delivered')
  EXECUTE FUNCTION public.fn_bug_report_delivery_resolves_its_alert();

-- A paid week: its payout alerts resolve (never the critical invoice mismatch).
CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_paid_resolves_its_alerts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $fn$
BEGIN
  IF (SELECT count(DISTINCT u.milestone) FROM smarter_private.weekly_payout_owner_updates u
       WHERE u.period_end = NEW.period_end AND u.milestone IN ('agents_paid', 'clubs_paid', 'players_paid')) = 3 THEN
    UPDATE public.operational_alert_events e
       SET status = 'resolved',
           payload = e.payload || jsonb_build_object('resolved_at', clock_timestamp(),
             'resolution', 'the week recorded agents_paid, clubs_paid and players_paid')
     WHERE e.source = 'weekly-payout' AND e.status = 'firing'
       AND e.alertname IN ('WeeklyPayoutSlotRefused', 'WeeklyPayoutScopeDeferred',
                           'WeeklyPayoutNotReadyHalfHourBefore', 'WeeklyPayoutScopeMoneyStatementLost')
       AND CASE WHEN pg_input_is_valid(e.payload->>'period_end', 'timestamp with time zone')
                THEN (e.payload->>'period_end')::timestamptz = NEW.period_end ELSE false END;
  END IF;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION smarter_private.weekly_payout_paid_resolves_its_alerts() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_weekly_payout_paid_resolves_its_alerts ON smarter_private.weekly_payout_owner_updates;
CREATE TRIGGER zz_weekly_payout_paid_resolves_its_alerts
  AFTER INSERT ON smarter_private.weekly_payout_owner_updates
  FOR EACH ROW WHEN (NEW.milestone IN ('agents_paid', 'clubs_paid', 'players_paid'))
  EXECUTE FUNCTION smarter_private.weekly_payout_paid_resolves_its_alerts();

-- One-time correction, each row proven resolved by the same condition.
UPDATE public.operational_alert_events e
   SET status = 'resolved',
       payload = e.payload || jsonb_build_object('resolved_at', clock_timestamp(),
         'resolution', 'the week recorded agents_paid, clubs_paid and players_paid')
 WHERE e.source = 'weekly-payout' AND e.status = 'firing'
   AND e.alertname IN ('WeeklyPayoutSlotRefused', 'WeeklyPayoutScopeDeferred',
                       'WeeklyPayoutNotReadyHalfHourBefore', 'WeeklyPayoutScopeMoneyStatementLost')
   AND CASE WHEN pg_input_is_valid(e.payload->>'period_end', 'timestamp with time zone')
            THEN (SELECT count(DISTINCT u.milestone) FROM smarter_private.weekly_payout_owner_updates u
                   WHERE u.period_end = (e.payload->>'period_end')::timestamptz
                     AND u.milestone IN ('agents_paid', 'clubs_paid', 'players_paid')) = 3
            ELSE false END;

UPDATE public.operational_alert_events e
   SET status = 'resolved',
       payload = e.payload || jsonb_build_object('resolved_at', clock_timestamp(),
         'resolution', 'fixed in the live body: fn_ca_engine_release_stall_check declares v_open uuid (issue #9413)')
 WHERE e.source = 'midway-weekly-payout-followup' AND e.status = 'firing'
   AND e.event_key = 'engine_release_stall_check_uuid_into_bigint:20261102'
   AND pg_get_functiondef('public.fn_ca_engine_release_stall_check(integer,integer)'::regprocedure) ~ 'v_open\s+uuid;';

COMMIT;
