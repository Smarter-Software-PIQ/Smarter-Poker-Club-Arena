#!/usr/bin/env bash
# Native proof for 20261128151139 on a throwaway PostgreSQL 16 cluster.
# Installs a minimal fixture, the pre-fix migration 20261126031810, the seven
# cycles production had noted by 2026-11-28 15:10Z, then the fix; asserts the
# backfill, the new send path, replay and grants. Run from the repo root as a
# non-root user (initdb refuses root).
set -euo pipefail
BIN=${PGBIN:-/usr/lib/postgresql/16/bin}
FIX=supabase/migrations/20261128151139_a_missed_cycle_note_is_recorded_in_the_alert_store.sql
D=$(mktemp -d); trap '"$BIN/pg_ctl" -D "$D/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$D"' EXIT
"$BIN/initdb" -D "$D/data" -U postgres -A trust >/dev/null
"$BIN/pg_ctl" -D "$D/data" -o "-k $D -p 55439 -c listen_addresses=''" -l "$D/log" start -w >/dev/null
P() { psql -X -q -v ON_ERROR_STOP=1 -h "$D" -p 55439 -U postgres -d postgres "$@"; }
P <<'SQL'
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA smarter_private;
CREATE TABLE smarter_private.reliability_settings (id boolean PRIMARY KEY DEFAULT true, system_sender_id uuid NOT NULL);
INSERT INTO smarter_private.reliability_settings VALUES (true, '00000000-0000-0000-0000-0000000000aa');
CREATE FUNCTION smarter_private.reliability_owner_conversation() RETURNS uuid LANGUAGE sql
  AS $$ SELECT '00000000-0000-0000-0000-0000000000cc'::uuid $$;
CREATE TABLE public.social_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid, sender_id uuid,
  content text, message_type text, media_metadata jsonb);
CREATE TABLE public.operational_alert_events (id bigserial PRIMARY KEY, source text NOT NULL, event_key text NOT NULL,
  alertname text, status text, severity text, payload jsonb, received_at timestamptz DEFAULT now(),
  last_received_at timestamptz DEFAULT now(), delivery_count int DEFAULT 1, UNIQUE (source, event_key));
CREATE FUNCTION public.fn_record_operational_alert(p_source text, p_event_key text, p_alertname text, p_status text, p_severity text, p_payload jsonb)
 RETURNS bigint LANGUAGE plpgsql SET search_path TO 'pg_catalog', 'public' AS $function$
DECLARE v_id bigint;
BEGIN
  INSERT INTO public.operational_alert_events(source,event_key,alertname,status,severity,payload)
  VALUES(p_source,p_event_key,p_alertname,p_status,p_severity,p_payload)
  ON CONFLICT (source,event_key) DO UPDATE
  SET last_received_at=clock_timestamp(), delivery_count=operational_alert_events.delivery_count+1
  RETURNING id INTO v_id;
  RETURN v_id;
END; $function$;
SQL
P -f supabase/migrations/20261126031810_an_owner_note_when_a_cutover_cycle_does_not_seal.sql
P <<'SQL'
SELECT public.fn_ca_note_cycle_did_not_seal(c, 'Engine cutover ' || c || ' did not happen.')
  FROM unnest(ARRAY['2026-11-26T10','2026-11-26T13','2026-11-26T19','2026-11-26T22','2026-11-27T07','2026-11-27T13','2026-11-28T07']) c;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.operational_alert_events) <> 0 THEN RAISE EXCEPTION 'pre-fix wrote a store row?'; END IF;
END $$;
SQL
echo "pre-fix: 7 notes, 0 store rows (the defect)"
P -f "$FIX"
P <<'SQL'
DO $$
DECLARE r jsonb; n int;
BEGIN
  IF (SELECT count(*) FROM smarter_private.ca_cutover_cycle_notes WHERE alert_id IS NULL) <> 0 THEN RAISE EXCEPTION 'backfill left a note without a store row'; END IF;
  IF (SELECT count(*) FROM public.operational_alert_events WHERE source='engine-cutover-watch' AND event_key LIKE 'cycle-not-sealed:%'
        AND payload->>'target_task_id'='01a09b86-5ba8-7290-8657-1041f13dd3ca' AND severity='warning') <> 7 THEN RAISE EXCEPTION 'backfill did not record seven addressed rows'; END IF;
  IF EXISTS (SELECT 1 FROM public.operational_alert_events WHERE event_key LIKE 'cycle-not-sealed:1999%') THEN RAISE EXCEPTION 'probe leaked a row'; END IF;
  IF (SELECT count(*) FROM public.social_messages) <> 7 THEN RAISE EXCEPTION 'the fix sent or lost a message'; END IF;
  r := public.fn_ca_note_cycle_did_not_seal('2026-11-28T10', 'Engine cutover at 10:00 AM did not happen.');
  IF NOT (r->>'sent')::boolean OR (r->>'alert_id') IS NULL THEN RAISE EXCEPTION 'new send path: %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM smarter_private.ca_cutover_cycle_notes WHERE cycle='2026-11-28T10' AND alert_id=(r->>'alert_id')::bigint) THEN RAISE EXCEPTION 'note row missing alert id'; END IF;
  IF (SELECT media_metadata->>'alert_id' FROM public.social_messages WHERE id=(r->>'message_id')::uuid) <> r->>'alert_id' THEN RAISE EXCEPTION 'message missing alert id'; END IF;
  r := public.fn_ca_note_cycle_did_not_seal('2026-11-28T10', 'again');
  IF (r->>'sent')::boolean THEN RAISE EXCEPTION 'replay sent'; END IF;
  SELECT count(*) INTO n FROM public.operational_alert_events WHERE event_key='cycle-not-sealed:2026-11-28T10';
  IF n <> 1 THEN RAISE EXCEPTION 'replay wrote % rows', n; END IF;
  IF (SELECT delivery_count FROM public.operational_alert_events WHERE event_key='cycle-not-sealed:2026-11-28T10') <> 1 THEN RAISE EXCEPTION 'replay touched the store'; END IF;
  IF (SELECT count(*) FROM public.social_messages) <> 8 THEN RAISE EXCEPTION 'message count'; END IF;
  IF has_function_privilege('authenticated','public.fn_ca_note_cycle_did_not_seal(text,text)','execute') OR has_function_privilege('anon','public.fn_ca_note_cycle_did_not_seal(text,text)','execute')
     OR NOT has_function_privilege('service_role','public.fn_ca_note_cycle_did_not_seal(text,text)','execute') THEN RAISE EXCEPTION 'grants changed'; END IF;
END $$;
SQL
# Re-running the fix must refuse (column exists) without touching anything: the installer sends a file once.
if P -f "$FIX" >/dev/null 2>&1; then echo "replayed file applied twice"; exit 1; fi
echo "post-fix: 7 backfilled + 1 new, all addressed; replay sends and records nothing; grants unchanged: PASS"
