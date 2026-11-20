-- Production pre-image of the owner page route, read from PokerIQ-Production
-- on 2026-11-20 ~03:45Z with pg_get_functiondef (read-only). Used only by
-- scripts/ci/test-hand-gap-watch.py on a throwaway cluster to prove
-- 20261120034809 patches the live route exactly once and pages a hand-delay
-- episode once. md5(pg_get_functiondef) on production at read time:
--   fn_ca_owner_page_kind               0b2e47d5b999a429faa4ad1346c90f52
--   fn_ca_a_real_alert_reaches_the_owner 587e68783be087a0a059d674377a7cc9
-- fn_ca_stall_watch_confirms_people_stuck is a stub (not on this path).
CREATE TABLE public.operational_alert_events(
  id bigserial PRIMARY KEY, source text, event_key text, alertname text, status text,
  severity text, payload jsonb, received_at timestamptz DEFAULT now(), UNIQUE (source, event_key));
CREATE TABLE public.ca_owner_page_state (
  kind text PRIMARY KEY CONSTRAINT ca_owner_page_state_kind_check
    CHECK (kind IN ('dealing', 'restarts', 'money', 'releases', 'daily_window', 'migrations', 'cutover_readiness')),
  last_firing_at timestamptz, last_paged_at timestamptz,
  held_since_page integer NOT NULL DEFAULT 0, pages_sent bigint NOT NULL DEFAULT 0);
INSERT INTO public.ca_owner_page_state (kind) VALUES ('dealing'), ('restarts'), ('money'), ('releases'),
  ('daily_window'), ('migrations'), ('cutover_readiness');
CREATE FUNCTION public.fn_ca_stall_watch_confirms_people_stuck() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;

CREATE OR REPLACE FUNCTION public.fn_is_owner_operational_notification(p_user uuid, p_type text, p_title text, p_data jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT COALESCE(p_user='47965354-0e56-43ef-931c-ddaab82af765'::uuid AND (
    p_type IN ('financial_incident','financial_incident_resolved','financial_attestation',
      'engine_break_failed','engine_break_recovered','guarantee_bank_short',
      'guarantee_bank_recovered','estate_digest')
    OR (p_type='system' AND (
      p_title IN ('Push Health Alert','Notifications May Not Be Reaching This Device')
      OR p_title ~ '^Horse Fleet (Alert|Recovered): '
      OR (jsonb_typeof(p_data)='object' AND p_data->>'component'='club-arena-engine'
        AND jsonb_typeof(p_data->'alertname')='string' AND NULLIF(p_data->>'alertname','') IS NOT NULL)
    ))
  ),false);
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_owner_page_kind(p_source text, p_alertname text, p_severity text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT CASE
    WHEN p_source = 'ca-stall-watch' AND p_alertname = 'TableStoppedDealing' AND p_severity = 'critical' THEN 'dealing'
    WHEN p_source = 'ca-stall-watch' AND p_alertname = 'TournamentStopNotSettled' AND p_severity = 'critical' THEN 'money'
    WHEN p_source = 'alertmanager' AND p_alertname IN ('SLOTableHasStalled', 'SLOHandsAreNotBeingDealt', 'EngineHandsStopped',
           'EngineLivenessDead', 'EngineDown', 'EngineScrapeDown', 'EngineDiscoveryStalled', 'EngineFleetThroughputCollapsed', 'MttPlayStopped',
           'MttFleetNotDealing', 'TournamentNeverStarted', 'TournamentFleetUnserved', 'PokerTournamentTableNeverStarted') THEN 'dealing'
    WHEN (p_source = 'engine-alerts-backfill' AND p_alertname = 'ClubArenaEngineKillStorm' AND p_severity = 'critical')
      OR (p_source = 'alertmanager' AND p_alertname IN ('EngineRestartedOutsideTheBreak', 'TablesAreReloadingThemselves')) THEN 'restarts'
    WHEN (p_source = 'owner-operational-notifications' AND p_severity = 'critical'
          AND (p_alertname LIKE 'financial\_incident:%' OR p_alertname LIKE 'guarantee\_bank\_short:%'))
      OR (p_source = 'alertmanager' AND p_alertname IN ('UndeclaredTriggerOnAMoneyTable', 'TournamentCompletedUnpaid', 'SpinPrizeUnpaid')) THEN 'money'
    WHEN p_source = 'engine-cutover-watch' AND p_alertname = 'EngineCutoverMissed' AND p_severity = 'critical' THEN 'releases'
    WHEN p_source = 'daily-window' AND p_alertname = 'DailyWindowLobbyCloseKeepsFailing' AND p_severity = 'critical' THEN 'daily_window'
    WHEN p_source = 'migration-install-watch' AND p_alertname = 'MergedMigrationNotInstalled' AND p_severity = 'critical' THEN 'migrations'
    WHEN p_source = 'cutover-readiness-watch' AND p_alertname = 'CutoverReadinessAtRisk' AND p_severity = 'critical' THEN 'cutover_readiness'
  END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_a_real_alert_reaches_the_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  c_new_episode CONSTANT interval := interval '3 hours';
  c_reminder CONSTANT interval := interval '12 hours';
  v_kind text;
  v_state public.ca_owner_page_state%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_page boolean;
  v_title text;
  v_summary text;
  v_rec uuid;
BEGIN
  v_kind := public.fn_ca_owner_page_kind(NEW.source, NEW.alertname, NEW.severity);
  IF v_kind IS NULL THEN RETURN NULL; END IF;

  IF v_kind = 'dealing' AND NEW.source = 'alertmanager'
     AND NEW.alertname IN ('SLOTableHasStalled', 'MttPlayStopped', 'MttFleetNotDealing')
     AND NOT public.fn_ca_stall_watch_confirms_people_stuck() THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_state FROM public.ca_owner_page_state WHERE kind = v_kind FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_page := v_state.last_firing_at IS NULL
         OR v_now - v_state.last_firing_at >= c_new_episode
         OR v_state.last_paged_at IS NULL
         OR v_now - v_state.last_paged_at >= c_reminder;

  IF NOT v_page THEN
    UPDATE public.ca_owner_page_state
       SET last_firing_at = v_now, held_since_page = held_since_page + 1
     WHERE kind = v_kind;
    RETURN NULL;
  END IF;

  v_title := CASE v_kind
               WHEN 'dealing' THEN 'Tables Have Stopped Dealing'
               WHEN 'restarts' THEN 'Engine Restart Storm'
               WHEN 'releases' THEN 'Engine Update Missed At 4 AM'
               WHEN 'daily_window' THEN '3 AM Lobby Close Keeps Failing'
               WHEN 'migrations' THEN 'Merged Migration Not Installed'
               WHEN 'cutover_readiness' THEN '4 AM Engine Update At Risk'
               ELSE 'Money Check Failed'
             END;
  v_summary := left(btrim(COALESCE(
      NULLIF(CASE WHEN v_kind IN ('releases', 'daily_window', 'migrations', 'cutover_readiness') THEN NEW.payload->>'summary' END, ''),
      NULLIF(NEW.payload->'alert'->'annotations'->>'summary', ''),
      NULLIF(NEW.payload->'original_event'->>'summary', ''),
      NULLIF(btrim(NEW.payload->'original_notification'->>'message'), ''),
      NULLIF(NEW.payload->'original_notification'->>'title', ''),
      NEW.alertname)), 300);

  FOR v_rec IN
    SELECT DISTINCT r.user_id FROM public.ca_incident_recipients r
     WHERE r.scope = 'platform' AND r.active AND r.senior AND r.user_id IS NOT NULL
  LOOP
    PERFORM public.fn_raise_notification(
      v_rec, 'system', v_title,
      v_summary || CASE WHEN v_state.held_since_page > 0
                        THEN format(' %s more of this kind since the last alert.', v_state.held_since_page)
                        ELSE '' END,
      CASE WHEN v_kind = 'money' THEN '/hub/club-arena/financial-incidents' ELSE '/hub/club-arena' END,
      jsonb_build_object('source', 'owner-real-alert', 'kind', v_kind, 'alert', NEW.alertname,
                         'inbox_id', NEW.id, 'held_since_last_page', v_state.held_since_page));
  END LOOP;

  UPDATE public.ca_owner_page_state
     SET last_firing_at = v_now, last_paged_at = v_now, held_since_page = 0,
         pages_sent = pages_sent + 1
   WHERE kind = v_kind;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_ca_a_real_alert_reaches_the_owner failed for %: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$function$;

CREATE TRIGGER zz_a_real_alert_reaches_the_owner AFTER INSERT ON public.operational_alert_events
  FOR EACH ROW WHEN (NEW.status = 'firing') EXECUTE FUNCTION public.fn_ca_a_real_alert_reaches_the_owner();

-- The capture the store already has: financial_alerts -> operational_alert_events
-- as 'financial-alerts-backfill' (shape as measured on row 446115).
CREATE FUNCTION public.fn_fixture_capture_financial_alert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.operational_alert_events(source, event_key, alertname, status, severity, payload)
  VALUES ('financial-alerts-backfill', NEW.id::text, NEW.source, 'firing', NEW.severity,
          jsonb_build_object('snapshot_kind', 'insert', 'original_event', to_jsonb(NEW),
                             'target_task_id', '01a09b86-5ba8-7290-8657-1041f13dd3ca'))
  ON CONFLICT (source, event_key) DO NOTHING;
  RETURN NULL;
END $$;
CREATE TRIGGER fixture_capture_financial_alert AFTER INSERT ON public.financial_alerts
  FOR EACH ROW EXECUTE FUNCTION public.fn_fixture_capture_financial_alert();
