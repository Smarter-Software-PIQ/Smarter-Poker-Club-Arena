-- Minimal production shapes (columns, indexes and triggers the roll-up and the
-- pager touch), read from production 2026-11-18. Nothing else is modelled.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $r$BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END$r$;
CREATE SCHEMA smarter_private;
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigint PRIMARY KEY, schedule text NOT NULL, command text NOT NULL,
  nodename text NOT NULL DEFAULT 'localhost', nodeport integer NOT NULL DEFAULT 5432,
  database text NOT NULL, username text NOT NULL, active boolean NOT NULL DEFAULT true, jobname text);
CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL,
  database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  UPDATE cron.job j SET schedule=COALESCE($2,j.schedule), command=COALESCE($3,j.command),
    database=COALESCE($4,j.database), username=COALESCE($5,j.username), active=COALESCE($6,j.active)
   WHERE j.jobid=$1
$$;

CREATE TABLE public.financial_alerts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text NOT NULL, source text NOT NULL,
  message text NOT NULL, context jsonb DEFAULT '{}'::jsonb, resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), resolved_by uuid, resolution text);
CREATE INDEX idx_financial_alerts_source_created ON public.financial_alerts(source, created_at DESC);
CREATE INDEX financial_alerts_unresolved_source_idx ON public.financial_alerts(source) WHERE NOT resolved;
CREATE INDEX financial_alerts_incident_uuid_idx ON public.financial_alerts(((context->>'incident_id')::uuid))
  WHERE (context->>'incident_id') ~ '^[0-9a-fA-F-]{36}$';

CREATE TABLE public.ca_drift_incidents(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), detected_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'open', source text NOT NULL, dedupe_key text NOT NULL,
  occurrences integer NOT NULL DEFAULT 1, root_cause text, correction_ref text, resolution text,
  resolved_at timestamptz, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, closure_basis text);
CREATE UNIQUE INDEX ux_ca_drift_incidents_open_dedupe ON public.ca_drift_incidents(dedupe_key) WHERE status<>'resolved';
CREATE INDEX ix_ca_drift_incidents_open ON public.ca_drift_incidents(status, detected_at DESC) WHERE status<>'resolved';
CREATE INDEX ca_drift_incidents_alert_uuid_idx ON public.ca_drift_incidents(((metadata->>'alert_id')::uuid))
  WHERE (metadata->>'alert_id') ~ '^[0-9a-fA-F-]{36}$';

CREATE TABLE public.ca_incident_events(
  id bigserial PRIMARY KEY, incident_id uuid NOT NULL, at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL, actor uuid, actor_label text, detail jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE INDEX ix_ca_incident_events_incident ON public.ca_incident_events(incident_id, at);

CREATE TABLE public.ca_incident_file_failures(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), occurred_at timestamptz NOT NULL DEFAULT now(),
  source text, dedupe_key text, classification text, severity text, discrepancy numeric, sqlstate text, message text);
CREATE TABLE public.operational_alert_events(
  id bigserial PRIMARY KEY, source text, status text, investigation jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb);

-- Closer stand-ins with the result keys the pager reads. The stand-in closer
-- resolves settled alerts in ONE set-based UPDATE per call, like the real
-- classes, and can be told to fail on its Nth call.
CREATE TABLE public.closer_calls(n integer NOT NULL, fail_on_call integer, sleep_on_call integer);
INSERT INTO public.closer_calls VALUES (0, NULL, NULL);
CREATE TABLE public.landed_calls(at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE FUNCTION public.fn_resolve_settled_financial_alerts(p_apply boolean DEFAULT false, p_limit integer DEFAULT 5000)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
DECLARE v_settled integer; v_proven jsonb;
BEGIN
  UPDATE closer_calls SET n = n + 1;
  IF (SELECT n = fail_on_call FROM closer_calls) THEN RAISE EXCEPTION 'injected page failure'; END IF;
  IF (SELECT n = sleep_on_call FROM closer_calls) THEN PERFORM pg_sleep(30); END IF;
  WITH c AS (
    UPDATE financial_alerts a SET resolved=true, resolved_at=now(), resolution='verified: completion receipt'
     WHERE a.id IN (SELECT x.id FROM financial_alerts x WHERE NOT x.resolved AND x.context->>'settled'='true'
                     ORDER BY x.created_at, x.id LIMIT p_limit)
    RETURNING 1)
  SELECT count(*) INTO v_settled FROM c;
  v_proven := smarter_private.financial_alerts_proven_over(p_apply, p_limit);
  RETURN jsonb_build_object('ok', true, 'accounting_lightning_proven_over', v_proven, 'total', v_settled);
END $f$;
CREATE FUNCTION smarter_private.financial_alerts_proven_over(p_apply boolean, p_limit integer)
RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('proven_over', 0, 'echoes_closed', 0) $$;
CREATE FUNCTION public.fn_ca_resolve_landed_unreachable_hand_alerts()
RETURNS integer LANGUAGE sql AS $$ INSERT INTO landed_calls DEFAULT VALUES; SELECT 0 $$;
