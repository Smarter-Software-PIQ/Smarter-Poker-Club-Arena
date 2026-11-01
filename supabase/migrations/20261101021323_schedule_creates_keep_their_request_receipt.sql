-- An uncertain schedule-create acknowledgement must not create another row.
-- Explicit caller request identity, bound to its authenticated actor and exact
-- payload, is recorded in the same transaction as the canonical schedule insert.
-- Legacy callers remain compatible. The distinct request-bound RPC signature prevents
-- new clients silently executing a non-idempotent old server before installation.
-- No scheduled repair, write retry, hot-table foreign key or money mutation.
-- Captured live authority 2026-11-01: md5(pg_get_functiondef) 43602000c9c65c773bbfe96cd40b6e0f.
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_upsert_tournament_schedule(jsonb)'::regprocedure))='a09f6bb1f74305694c18a437e01b39bb' AND md5(pg_get_functiondef('public.fn_create_tournament_schedule_request(jsonb,uuid,uuid)'::regprocedure))='a0d87fa39719736c225fc9d43b424008')
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $pre$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.fn_upsert_tournament_schedule(jsonb)'::regprocedure
   AND md5(pg_get_functiondef(oid))='43602000c9c65c773bbfe96cd40b6e0f'
   AND pg_get_userbyid(proowner)='postgres'
   AND proacl::text='{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
   AND proconfig=ARRAY['search_path=public']::text[]) THEN
   RAISE EXCEPTION 'schedule_request_preimage_changed';
 END IF;
END $pre$;
CREATE TABLE smarter_private.tournament_schedule_create_receipts (
 request_id uuid PRIMARY KEY,
 user_id uuid NOT NULL,
 club_id uuid NOT NULL,
 union_id uuid,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 schedule_id uuid NOT NULL,
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object' AND receipt->'ok'='true'::jsonb),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE smarter_private.tournament_schedule_create_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON smarter_private.tournament_schedule_create_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION smarter_private.tournament_schedule_create_receipt_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $function$
BEGIN RAISE EXCEPTION 'schedule_create_receipt_is_immutable'; END
$function$;
REVOKE ALL ON FUNCTION smarter_private.tournament_schedule_create_receipt_immutable() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER schedule_create_receipt_immutable BEFORE UPDATE OR DELETE
ON smarter_private.tournament_schedule_create_receipts FOR EACH ROW
EXECUTE FUNCTION smarter_private.tournament_schedule_create_receipt_immutable();
CREATE TRIGGER schedule_create_receipt_no_truncate BEFORE TRUNCATE
ON smarter_private.tournament_schedule_create_receipts FOR EACH STATEMENT
EXECUTE FUNCTION smarter_private.tournament_schedule_create_receipt_immutable();
CREATE OR REPLACE FUNCTION public.fn_upsert_tournament_schedule(p_schedule jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_id        uuid;
  v_union_id  uuid;
  v_club_id   uuid;
  v_name      text;
  v_days      integer[];
  v_times     text[];
  v_interval  integer;
  v_config    jsonb;
  v_active    boolean;
  v_zone      text;
  v_d         integer;
  v_tm        text;
  v_existing  record;
  v_config_changed boolean := true;
  v_refusal   text;
  v_request uuid;
  v_request_unclaimed boolean := false;
  v_request_payload jsonb;
  v_request_receipt smarter_private.tournament_schedule_create_receipts%ROWTYPE;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated') || CASE WHEN v_request_unclaimed THEN jsonb_build_object('request_state','not_created','request_id',v_request,'user_id',v_uid) ELSE '{}'::jsonb END;
  END IF;
  IF p_schedule IS NULL OR jsonb_typeof(p_schedule) <> 'object' THEN
    RETURN jsonb_build_object('error', 'schedule_must_be_object') || CASE WHEN v_request_unclaimed THEN jsonb_build_object('request_state','not_created','request_id',v_request,'user_id',v_uid) ELSE '{}'::jsonb END;
  END IF;

  v_id       := NULLIF(p_schedule->>'id', '')::uuid;
  v_union_id := NULLIF(p_schedule->>'unionId', '')::uuid;
  v_club_id  := NULLIF(p_schedule->>'clubId', '')::uuid;
  v_name     := NULLIF(trim(p_schedule->>'name'), '');
  v_interval := NULLIF(p_schedule->>'intervalMinutes', '')::integer;
  v_config   := p_schedule->'config';
  v_active   := COALESCE((p_schedule->>'active')::boolean, true);
  -- IANA zone of the wall-clock days/times; absent or null = UTC.
  v_zone     := NULLIF(trim(p_schedule->>'timeZone'), '');

  -- A request key names ONE create, not a name/config based deduplication rule.
  IF p_schedule ? 'requestId' THEN
    IF jsonb_typeof(p_schedule->'requestId') IS DISTINCT FROM 'string'
       OR (p_schedule->>'requestId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      RETURN jsonb_build_object('error','schedule_request_id_invalid') || CASE WHEN v_request_unclaimed THEN jsonb_build_object('request_state','not_created','request_id',v_request,'user_id',v_uid) ELSE '{}'::jsonb END;
    END IF;
    IF v_id IS NOT NULL THEN RETURN jsonb_build_object('error','schedule_request_is_create_only') || CASE WHEN v_request_unclaimed THEN jsonb_build_object('request_state','not_created','request_id',v_request,'user_id',v_uid) ELSE '{}'::jsonb END; END IF;
    v_request := (p_schedule->>'requestId')::uuid;
    v_request_payload := p_schedule - 'requestId' - 'id';
    IF v_club_id IS NULL OR NOT public.fn_can_manage_tournament_schedule(v_union_id,v_club_id,v_uid) THEN
      RETURN jsonb_build_object('error','not_authorised') || CASE WHEN v_request_unclaimed THEN jsonb_build_object('request_state','not_created','request_id',v_request,'user_id',v_uid) ELSE '{}'::jsonb END;
    END IF;
    -- Same-key writers serialize inside their existing transaction. A timeout
    -- rolls back the entire call; no pending receipt is committed or repaired.
    PERFORM pg_advisory_xact_lock(hashtextextended('tournament-schedule-create:' || v_request::text,0));
    SELECT * INTO v_request_receipt
      FROM smarter_private.tournament_schedule_create_receipts WHERE request_id=v_request;
    IF FOUND THEN
      IF v_request_receipt.user_id IS DISTINCT FROM v_uid THEN
        RETURN jsonb_build_object('error','not_authorised') || CASE WHEN v_request_unclaimed THEN jsonb_build_object('request_state','not_created','request_id',v_request,'user_id',v_uid) ELSE '{}'::jsonb END;
      END IF;
      IF v_request_receipt.payload IS DISTINCT FROM v_request_payload THEN
        RETURN jsonb_build_object('error','schedule_request_payload_changed') || CASE WHEN v_request_unclaimed THEN jsonb_build_object('request_state','not_created','request_id',v_request,'user_id',v_uid) ELSE '{}'::jsonb END;
      END IF;
      -- A retired/deleted/moved target is never recreated or switched back on.
      SELECT * INTO v_existing FROM public.tournament_schedules
        WHERE id=v_request_receipt.schedule_id FOR KEY SHARE;
      IF NOT FOUND OR v_existing.created_by IS DISTINCT FROM v_uid
         OR v_existing.club_id IS DISTINCT FROM v_request_receipt.club_id
         OR v_existing.union_id IS DISTINCT FROM v_request_receipt.union_id THEN
        RETURN jsonb_build_object('error','schedule_request_target_changed',
          'request_state','retired','request_id',v_request,'user_id',v_uid,
          'schedule_id',v_request_receipt.schedule_id);
      END IF;
      RETURN v_request_receipt.receipt;
    END IF;
    v_request_unclaimed := true;
  END IF;

  SELECT COALESCE(array_agg(value::integer), '{}')
    INTO v_days FROM jsonb_array_elements_text(COALESCE(p_schedule->'daysOfWeek', '[]'::jsonb));
  SELECT COALESCE(array_agg(value), '{}')
    INTO v_times FROM jsonb_array_elements_text(COALESCE(p_schedule->'startTimesUtc', '[]'::jsonb));

  IF v_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.tournament_schedules WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'schedule_not_found') || CASE WHEN v_request_unclaimed THEN jsonb_build_object('request_state','not_created','request_id',v_request,'user_id',v_uid) ELSE '{}'::jsonb END;
    END IF;
    IF NOT public.fn_can_manage_tournament_schedule(v_existing.union_id, v_existing.club_id, v_uid) THEN
      RETURN jsonb_build_object('error', 'not_authorised') || CASE WHEN v_request_unclaimed THEN jsonb_build_object('request_state','not_created','request_id',v_request,'user_id',v_uid) ELSE '{}'::jsonb END;
    END IF;
    v_union_id := COALESCE(v_union_id, v_existing.union_id);
    v_club_id  := COALESCE(v_club_id,  v_existing.club_id);
    v_name     := COALESCE(v_name,     v_existing.name);
    v_config   := COALESCE(v_config,   v_existing.config);
    v_config_changed := v_config IS DISTINCT FROM v_existing.config;
    IF p_schedule->'daysOfWeek' IS NULL THEN v_days := v_existing.days_of_week; END IF;
    IF p_schedule->'startTimesUtc' IS NULL THEN v_times := v_existing.start_times_utc; END IF;
    IF p_schedule->'intervalMinutes' IS NULL THEN v_interval := v_existing.interval_minutes; END IF;
    IF NOT (p_schedule ? 'timeZone') THEN v_zone := v_existing.time_zone; END IF;
  END IF;

  IF v_club_id IS NULL THEN
    RETURN jsonb_build_object('error', 'club_id_required') || CASE WHEN v_request_unclaimed THEN jsonb_build_object('request_state','not_created','request_id',v_request,'user_id',v_uid) ELSE '{}'::jsonb END;
  END IF;
  IF v_name IS NULL THEN
    RETURN jsonb_build_object('error', 'name_required') || CASE WHEN v_request_unclaimed THEN jsonb_build_object('request_state','not_created','request_id',v_request,'user_id',v_uid) ELSE '{}'::jsonb END;
  END IF;
  IF v_config IS NULL OR jsonb_typeof(v_config) <> 'object' THEN
    RETURN jsonb_build_object('error', 'config_must_be_object') || CASE WHEN v_request_unclaimed THEN jsonb_build_object('request_state','not_created','request_id',v_request,'user_id',v_uid) ELSE '{}'::jsonb END;
  END IF;
  IF array_length(v_days, 1) IS NULL THEN
    RETURN jsonb_build_object('error', 'days_of_week_required') || CASE WHEN v_request_unclaimed THEN jsonb_build_object('request_state','not_created','request_id',v_request,'user_id',v_uid) ELSE '{}'::jsonb END;
  END IF;
  FOREACH v_d IN ARRAY v_days LOOP
    IF v_d < 0 OR v_d > 6 THEN
      RETURN jsonb_build_object('error', 'days_of_week_out_of_range', 'detail', v_d) || CASE WHEN v_request_unclaimed THEN jsonb_build_object('request_state','not_created','request_id',v_request,'user_id',v_uid) ELSE '{}'::jsonb END;
    END IF;
  END LOOP;
  FOREACH v_tm IN ARRAY v_times LOOP
    IF v_tm !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RETURN jsonb_build_object('error', 'start_time_format_invalid', 'detail', v_tm) || CASE WHEN v_request_unclaimed THEN jsonb_build_object('request_state','not_created','request_id',v_request,'user_id',v_uid) ELSE '{}'::jsonb END;
    END IF;
  END LOOP;
  IF array_length(v_times, 1) IS NULL AND v_interval IS NULL THEN
    RETURN jsonb_build_object('error', 'start_times_or_interval_required') || CASE WHEN v_request_unclaimed THEN jsonb_build_object('request_state','not_created','request_id',v_request,'user_id',v_uid) ELSE '{}'::jsonb END;
  END IF;
  IF v_interval IS NOT NULL AND (v_interval < 5 OR v_interval > 1440) THEN
    RETURN jsonb_build_object('error', 'interval_minutes_out_of_range') || CASE WHEN v_request_unclaimed THEN jsonb_build_object('request_state','not_created','request_id',v_request,'user_id',v_uid) ELSE '{}'::jsonb END;
  END IF;
  IF NOT public.fn_schedule_time_zone_is_known(v_zone) THEN
    RETURN jsonb_build_object('error', 'time_zone_unknown', 'detail', v_zone) || CASE WHEN v_request_unclaimed THEN jsonb_build_object('request_state','not_created','request_id',v_request,'user_id',v_uid) ELSE '{}'::jsonb END;
  END IF;

  IF v_id IS NULL AND NOT public.fn_can_manage_tournament_schedule(v_union_id, v_club_id, v_uid) THEN
    RETURN jsonb_build_object('error', 'not_authorised') || CASE WHEN v_request_unclaimed THEN jsonb_build_object('request_state','not_created','request_id',v_request,'user_id',v_uid) ELSE '{}'::jsonb END;
  END IF;
  -- Lock/read comparison preserves unchanged accepted schedules, including
  -- enable/disable and metadata edits, without authoring another ignored break.
  IF v_config_changed AND (
    lower(COALESCE(v_config->>'type','mtt')) NOT IN ('sng','spin')
    -- The scheduled writer promotes target-linked fixed labels to satellites.
    -- Only its recognized target keys participate; unrelated type aliases do not.
    OR public.fn_ca_is_new_mtt(jsonb_build_object(
      'satellite_target_id',v_config->'satellite_target_id',
      'satelliteTargetId',v_config->'satelliteTargetId',
      'satellite_target',v_config->'satellite_target',
      'satelliteTarget',v_config->'satelliteTarget'))
  ) AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(CASE
      WHEN jsonb_typeof(v_config->'blindStructure')='array' THEN v_config->'blindStructure'
      ELSE '[]'::jsonb END) AS level_row
    WHERE level_row->'isBreak'='true'::jsonb
  ) THEN
    RETURN jsonb_build_object('error','custom_level_breaks_not_supported') || CASE WHEN v_request_unclaimed THEN jsonb_build_object('request_state','not_created','request_id',v_request,'user_id',v_uid) ELSE '{}'::jsonb END;
  END IF;

  -- The creation rules, checked when the configuration is written rather than
  -- first discovered by the spawner (20260924033701).
  IF v_config_changed THEN
    v_refusal := public.fn_tournament_config_refusal(v_config,'schedule');
    IF v_refusal IS NOT NULL THEN
      RETURN jsonb_build_object('error',v_refusal) || CASE WHEN v_request_unclaimed THEN jsonb_build_object('request_state','not_created','request_id',v_request,'user_id',v_uid) ELSE '{}'::jsonb END;
    END IF;
  END IF;

  IF v_id IS NULL THEN
    -- ca-commerce-admission: a NEW recurring schedule is a prospective owner
    -- action (R2 4.3, D22). Shadow records and proceeds; enforced refuses
    -- here, before the schedule is written.
    DECLARE
      v_ca_admission jsonb := public.fn_ca_commerce_admit('club', v_club_id, 'create_tournament', 'fn_upsert_tournament_schedule', NULL);
    BEGIN
      IF NOT COALESCE((v_ca_admission->>'allowed')::boolean, true) THEN
        RETURN jsonb_build_object('error', 'operating_access_required',
          'message', v_ca_admission->>'message', 'reason', v_ca_admission->>'reason') || CASE WHEN v_request_unclaimed THEN jsonb_build_object('request_state','not_created','request_id',v_request,'user_id',v_uid) ELSE '{}'::jsonb END;
      END IF;
    END;
    INSERT INTO public.tournament_schedules
      (union_id, club_id, name, description, active, days_of_week,
       start_times_utc, interval_minutes, config, created_by, time_zone)
    VALUES
      (v_union_id, v_club_id, v_name, p_schedule->>'description', v_active, v_days,
       v_times, v_interval, v_config, v_uid, v_zone)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.tournament_schedules
       SET union_id         = v_union_id,
           club_id          = v_club_id,
           name             = v_name,
           description      = COALESCE(p_schedule->>'description', description),
           active           = v_active,
           days_of_week     = v_days,
           start_times_utc  = v_times,
           interval_minutes = v_interval,
           config           = v_config,
           time_zone        = v_zone,
           updated_at       = now()
     WHERE id = v_id;
  END IF;

  v_result := jsonb_build_object('ok', true, 'schedule_id', v_id);
  IF v_request IS NOT NULL THEN
    v_result := v_result || jsonb_build_object('request_id',v_request,'user_id',v_uid);
    INSERT INTO smarter_private.tournament_schedule_create_receipts
      (request_id,user_id,club_id,union_id,payload,schedule_id,receipt)
    VALUES(v_request,v_uid,v_club_id,v_union_id,v_request_payload,v_id,v_result);
  END IF;
  RETURN v_result;
END; $function$
;

-- The thin request adapter preserves one canonical business authority.
-- Its distinct name cannot resolve on an uninstalled database and adds no overload.
CREATE FUNCTION public.fn_create_tournament_schedule_request(p_schedule jsonb,p_request_id uuid,p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $function$
BEGIN
 IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error','not_authenticated'); END IF;
 IF p_user_id IS DISTINCT FROM auth.uid() THEN RETURN jsonb_build_object('error','not_authorised'); END IF;
 IF p_request_id IS NULL THEN RETURN jsonb_build_object('error','schedule_request_id_invalid'); END IF;
 IF p_schedule IS NULL OR jsonb_typeof(p_schedule)<>'object' THEN
   RETURN jsonb_build_object('error','schedule_must_be_object');
 END IF;
 IF p_schedule ? 'requestId' THEN RETURN jsonb_build_object('error','schedule_request_id_ambiguous'); END IF;
 RETURN public.fn_upsert_tournament_schedule(p_schedule || jsonb_build_object('requestId',p_request_id));
END $function$;
REVOKE ALL ON FUNCTION public.fn_create_tournament_schedule_request(jsonb,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_create_tournament_schedule_request(jsonb,uuid,uuid) TO authenticated,service_role;
DO $post$
BEGIN
 IF md5(pg_get_functiondef('public.fn_upsert_tournament_schedule(jsonb)'::regprocedure))<>'a09f6bb1f74305694c18a437e01b39bb'
 OR md5(pg_get_functiondef('public.fn_create_tournament_schedule_request(jsonb,uuid,uuid)'::regprocedure))<>'a0d87fa39719736c225fc9d43b424008'
 OR has_function_privilege('anon','public.fn_create_tournament_schedule_request(jsonb,uuid,uuid)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.fn_create_tournament_schedule_request(jsonb,uuid,uuid)','EXECUTE')
 OR has_table_privilege('authenticated','smarter_private.tournament_schedule_create_receipts','INSERT,UPDATE,DELETE,TRUNCATE') THEN
   RAISE EXCEPTION 'schedule_request_postimage_changed';
 END IF;
END $post$;
COMMIT;
