-- 20261121151027_a_shipped_release_resolves_its_own_failures.sql
--
-- WHAT WAS WRONG (incident 484c4cee, 2026-11-21)
--
-- auto-deploy-hetzner raises EngineReleaseFailed with a per-run fingerprint
-- (engine-release-failed:<run>-<attempt>) for every run that does not ship.
-- Nothing ever resolved it. At 00:19 UTC run 44841264851 failed at prepare for
-- e2140d2d while sibling run 44841245126 had already sealed and verified the
-- same SHA at 00:10 (ca_engine_deploy_attempts id 1500): the critical
-- incident stayed escalated with the engine it complained about serving.
-- (The duplicate delivery and the prepare refusal were fixed by #11558 and
-- #11579.)
--
-- WHAT THIS CHANGES
--
-- The shipped receipt is the authoritative fact. An AFTER INSERT trigger on
-- the append-only public.ca_engine_deploy_attempts, for a row with
-- shipped = true, resolves every EngineReleaseFailed whose latest event is
-- still firing for that exact target SHA, through the same door that raised
-- it (fn_record_engine_alerts), naming the run that shipped it. A failure for
-- any other SHA is left firing. An alerting error never refuses the receipt:
-- it is raised as a WARNING with the reason. The redelivery case is also
-- refused at its source (record-engine-release-alert.mjs shippedSibling).
--
-- One transaction (club-arena CLAUDE.md production DDL policy).

BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';

CREATE OR REPLACE FUNCTION public.fn_ca_shipped_release_resolves_its_failures()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE batch jsonb;
BEGIN
 IF NEW.shipped IS DISTINCT FROM true OR NEW.target_sha !~ '^[0-9a-f]{40}$' THEN RETURN NULL;END IF;
 SELECT jsonb_agg(jsonb_build_object(
   'status','resolved','fingerprint',a.fingerprint,
   'startsAt',to_char(a.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'endsAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'labels',a.labels||'{"severity":"info"}'::jsonb,
   'annotations',jsonb_build_object(
     'summary',format('Engine release %s shipped (run %s); the earlier failure for this SHA is resolved',left(NEW.target_sha,8),NEW.run_id),
     'description',format('ca_engine_deploy_attempts %s: %s',NEW.id,left(COALESCE(NEW.reason,''),300)))))
  INTO batch
  FROM (SELECT DISTINCT ON (e.fingerprint) e.fingerprint,e.status,e.labels,e.starts_at
          FROM public.engine_alerts e
         WHERE e.alertname='EngineReleaseFailed' AND e.labels->>'target_sha'=NEW.target_sha
         ORDER BY e.fingerprint,e.id DESC) a
 WHERE a.status='firing';
 IF batch IS NOT NULL THEN
  BEGIN
   PERFORM public.fn_record_engine_alerts(batch);
  EXCEPTION WHEN OTHERS THEN
   RAISE WARNING 'shipped release % could not resolve its earlier failures: %',NEW.target_sha,SQLERRM;
  END;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_shipped_release_resolves_its_failures() FROM PUBLIC,anon,authenticated,service_role;

DROP TRIGGER IF EXISTS ca_shipped_release_resolves_its_failures ON public.ca_engine_deploy_attempts;
CREATE TRIGGER ca_shipped_release_resolves_its_failures AFTER INSERT ON public.ca_engine_deploy_attempts
 FOR EACH ROW WHEN (NEW.shipped) EXECUTE FUNCTION public.fn_ca_shipped_release_resolves_its_failures();

-- Executes the trigger once on a synthetic SHA with a synthetic firing
-- failure, checks it was resolved, and unwinds everything.
-- @probe-for: public.fn_ca_shipped_release_resolves_its_failures
DO $probe$
DECLARE sha constant text:=repeat('ab',20); fp constant text:='engine-release-failed:probe-'||md5(clock_timestamp()::text);
BEGIN
  PERFORM public.fn_record_engine_alerts(jsonb_build_array(jsonb_build_object('status','firing','fingerprint',fp,
    'labels',jsonb_build_object('alertname','EngineReleaseFailed','severity','critical','component','engine-release','target_sha',sha,'run_id','probe-1'),
    'annotations',jsonb_build_object('summary','probe'))));
  INSERT INTO public.ca_engine_deploy_attempts(run_id,target_sha,shipped,reason,actor) VALUES('probe-2',sha,true,'probe','probe');
  IF (SELECT e.status FROM public.engine_alerts e WHERE e.fingerprint=fp ORDER BY e.id DESC LIMIT 1) IS DISTINCT FROM 'resolved' THEN
    RAISE EXCEPTION 'shipped_release_probe_left_failure_firing';
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
