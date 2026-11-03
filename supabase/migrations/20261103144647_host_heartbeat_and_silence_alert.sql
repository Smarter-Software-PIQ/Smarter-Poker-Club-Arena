-- 20261103144647_host_heartbeat_and_silence_alert
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-03 14:46:47 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
-- Say what was wrong, what this changes, and what you measured. A
-- migration whose header is its own filename is the next agent's mystery.
-- A HOST THAT GOES SILENT IS NOTICED WITHIN MINUTES (owner, 2026-11-03).
-- On 2026-11-02 at 14:39 Chicago the Claude desktop app on the operations Mac
-- crashed and restarted; every background watcher it had launched died with
-- its process group, and nothing noticed for about 15 hours (a merged
-- migration waited until the next morning to be installed). The Mac itself
-- stayed up. Operations jobs now run as macOS launchd services outside any
-- app, and each host reports a heartbeat here every 5 minutes. A host silent
-- for longer than its allowed silence raises one critical Production Alert
-- per outage and records an informational HostHeartbeatResumed event (keyed
-- to that outage) when beats resume; a volume under 5% free
-- raises one warning per volume per day.
-- periodic-work: detection only. Every 5 minutes it compares each expected
-- host's last heartbeat with its allowed silence and records an alert; it
-- never moves money, never changes game state and never repairs anything.
-- @live-proof: to_regclass('smarter_private.host_heartbeats') IS NOT NULL AND EXISTS(SELECT 1 FROM cron.job WHERE jobname='host-heartbeat-check' AND schedule='*/5 * * * *' AND active)
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';

CREATE TABLE IF NOT EXISTS smarter_private.host_heartbeats(
 host text PRIMARY KEY CHECK (host ~ '^[a-z0-9-]{3,64}$'),
 beat_at timestamptz NOT NULL,
 details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(details) < 16384),
 expected boolean NOT NULL DEFAULT true,
 max_silence interval NOT NULL DEFAULT interval '15 minutes' CHECK (max_silence BETWEEN interval '5 minutes' AND interval '1 day'),
 silent_since timestamptz,
 silence_event_key text
);
ALTER TABLE smarter_private.host_heartbeats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE smarter_private.host_heartbeats FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION smarter_private.record_host_heartbeat(p_host text, p_details jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $f$
DECLARE prior smarter_private.host_heartbeats%ROWTYPE; n timestamptz:=clock_timestamp();
BEGIN
 IF p_host IS NULL OR p_host !~ '^[a-z0-9-]{3,64}$' THEN RAISE EXCEPTION 'host_heartbeat_host_invalid' USING ERRCODE='22023'; END IF;
 IF p_details IS NULL OR jsonb_typeof(p_details)<>'object' THEN RAISE EXCEPTION 'host_heartbeat_details_invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO prior FROM smarter_private.host_heartbeats h WHERE h.host=p_host FOR UPDATE;
 INSERT INTO smarter_private.host_heartbeats AS h(host,beat_at,details) VALUES(p_host,n,p_details)
 ON CONFLICT (host) DO UPDATE SET beat_at=EXCLUDED.beat_at,details=EXCLUDED.details,silent_since=NULL,silence_event_key=NULL;
 IF prior.silence_event_key IS NOT NULL THEN
  PERFORM public.fn_record_operational_alert('host-heartbeat',prior.silence_event_key||':resumed','HostHeartbeatResumed','info','info',
   jsonb_build_object('target_task_id','01a09b86-5ba8-7290-8657-1041f13dd3ca','host',p_host,'outage_event_key',prior.silence_event_key,'silent_since',prior.silent_since,'resumed_at',n,
    'silence',(n-prior.beat_at)::text));
 END IF;
 RETURN jsonb_build_object('host',p_host,'beat_at',n,'resolved_silence',prior.silence_event_key IS NOT NULL);
END $f$;
REVOKE ALL ON FUNCTION smarter_private.record_host_heartbeat(text,jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION smarter_private.host_heartbeat_check()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $f$
DECLARE h record; d record; n timestamptz:=clock_timestamp(); fired int:=0; disks int:=0; k text;
BEGIN
 FOR h IN SELECT * FROM smarter_private.host_heartbeats WHERE expected AND silence_event_key IS NULL AND beat_at < n-max_silence FOR UPDATE LOOP
  k:='missing:'||h.host||':'||to_char(h.beat_at AT TIME ZONE 'UTC','YYYYMMDD"T"HH24MISS');
  PERFORM public.fn_record_operational_alert('host-heartbeat',k,'HostHeartbeatMissing','firing','critical',
   jsonb_build_object('target_task_id','01a09b86-5ba8-7290-8657-1041f13dd3ca','host',h.host,'last_beat',h.beat_at,
    'silence',(n-h.beat_at)::text,'allowed',h.max_silence::text,'last_details',h.details));
  UPDATE smarter_private.host_heartbeats SET silent_since=n,silence_event_key=k WHERE host=h.host;
  fired:=fired+1;
 END LOOP;
 FOR d IN SELECT hb.host, v.key AS volume, (v.value->>'free_pct')::numeric AS free_pct, v.value AS info
   FROM smarter_private.host_heartbeats hb, jsonb_each(CASE WHEN jsonb_typeof(hb.details->'disks')='object' THEN hb.details->'disks' ELSE '{}'::jsonb END) v
   WHERE hb.expected AND jsonb_typeof(v.value->'free_pct')='number' AND (v.value->>'free_pct')::numeric < 5 LOOP
  PERFORM public.fn_record_operational_alert('host-heartbeat','disk:'||d.host||':'||d.volume||':'||to_char(n AT TIME ZONE 'America/Chicago','YYYYMMDD'),
   'HostDiskNearlyFull','firing','warning',
   jsonb_build_object('target_task_id','01a09b86-5ba8-7290-8657-1041f13dd3ca','host',d.host,'volume',d.volume,'free_pct',d.free_pct,'disk',d.info));
  disks:=disks+1;
 END LOOP;
 RETURN jsonb_build_object('checked_at',n,'silences_fired',fired,'disk_warnings',disks);
END $f$;
REVOKE ALL ON FUNCTION smarter_private.host_heartbeat_check() FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO smarter_private.host_heartbeats(host,beat_at,details,expected,max_silence)
VALUES('ops-mac-studio',clock_timestamp(),jsonb_build_object('seeded_by','20261103144647'),true,interval '15 minutes')
ON CONFLICT (host) DO NOTHING;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='host-heartbeat-check';
SELECT cron.schedule('host-heartbeat-check','*/5 * * * *',$c$SELECT smarter_private.host_heartbeat_check();$c$);
COMMIT;
