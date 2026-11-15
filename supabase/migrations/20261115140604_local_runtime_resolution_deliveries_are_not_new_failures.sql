-- Local runtime sends a separate resolved event with payload.resolves.
-- The November14 digest counted two tour failures and nine resolution deliveries
-- as eleven new critical failures. Keep original/in-place-resolved observations;
-- exclude only typed local-runtime resolution deliveries from new-failure counts
-- and the identical attention history/member cohort. Historical snapshots and
-- every inbox/source record remain unchanged. No release or repair schedule.
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_sp_daily_metrics_compute(date)'::regprocedure))='cf92a94803102ccc48e77192e38bfa17' AND md5(pg_get_functiondef('public.fn_sp_digest_attention(date,jsonb)'::regprocedure))='ed46ab41226a700bfbcbbbc3ff05b0a5')
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $fix$
DECLARE r record; before text; after text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.fn_sp_daily_metrics_compute(date)','7b3118323fff5a16c6bdfc900871c14e',4),
    ('public.fn_sp_digest_attention(date,jsonb)','a0bbecfc85331f0748bc8728979c2978',1)
  ) p(signature,expected_md5,expected_replacements) LOOP
    before:=pg_get_functiondef(to_regprocedure(r.signature));
    IF before IS NULL OR md5(before)<>r.expected_md5 THEN
      RAISE EXCEPTION 'LOCAL_RUNTIME_DIGEST_PREIMAGE_CHANGED: %',r.signature;
    END IF;
    IF (length(before)-length(replace(before,$old$payload->>'snapshot_kind' IS DISTINCT FROM 'update_new'$old$,'')))/length($old$payload->>'snapshot_kind' IS DISTINCT FROM 'update_new'$old$)<>r.expected_replacements THEN
      RAISE EXCEPTION 'LOCAL_RUNTIME_DIGEST_PREDICATE_CHANGED';
    END IF;
    IF r.signature='public.fn_sp_digest_attention(date,jsonb)' THEN
      after:=before;
      after:=replace(after,$old0$SELECT id,alertname,received_at,investigation_status
$old0$,$new0$SELECT id,alertname,received_at,investigation_status,
           NOT COALESCE((source LIKE 'local.%-runtime' AND status='resolved' AND jsonb_typeof(payload->'resolves')='string'),false) AS failure_observation
$new0$);
      after:=replace(after,$old1$WHERE received_at < s
$old1$,$new1$WHERE received_at < s AND failure_observation
$new1$);
      after:=replace(after,$old2$SELECT COALESCE(alertname,'unknown') alertname, jsonb_agg(id ORDER BY id) event_ids$old2$,$new2$SELECT COALESCE(alertname,'unknown') alertname,
      -- Old immutable metrics counted every delivery; retain their exact
      -- original cohort for status proof, while new metrics count failures.
      CASE WHEN (p_metrics#>>ARRAY['health','alert_names',COALESCE(alertname,'unknown')])::numeric
                    = count(*) FILTER(WHERE failure_observation)
           THEN COALESCE(jsonb_agg(id ORDER BY id) FILTER(WHERE failure_observation),'[]'::jsonb)
           WHEN (p_metrics#>>ARRAY['health','alert_names',COALESCE(alertname,'unknown')])::numeric=count(*)
           THEN jsonb_agg(id ORDER BY id)
           ELSE '[]'::jsonb END event_ids$new2$);
    ELSE
    after:=replace(before,$old$payload->>'snapshot_kind' IS DISTINCT FROM 'update_new'$old$,$new$payload->>'snapshot_kind' IS DISTINCT FROM 'update_new' AND NOT COALESCE((source LIKE 'local.%-runtime' AND status='resolved' AND jsonb_typeof(payload->'resolves')='string'),false)$new$);
    END IF;
    EXECUTE after;
    IF pg_get_functiondef(to_regprocedure(r.signature))<>after THEN
      RAISE EXCEPTION 'LOCAL_RUNTIME_DIGEST_POSTIMAGE_CHANGED';
    END IF;
  END LOOP;
END $fix$;
COMMIT;
