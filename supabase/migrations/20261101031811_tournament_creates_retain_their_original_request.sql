-- A lost initial-create acknowledgement must not create a second tournament.
-- The request adapter delegates to the existing canonical creator unchanged;
-- its accepted receipt and tournament commit in one transaction. Exact retries
-- return that original receipt, never restart or recreate an accepted event.
-- Native proof uses captured current creator, format/permission authorities and
-- checks, synthetic policy inputs and disposable PostgreSQL only.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

DO $pre$
BEGIN
  IF md5(pg_get_functiondef('public.fn_create_tournament(uuid,jsonb)'::regprocedure))
       IS DISTINCT FROM 'd3585069bf906c99bdb3ae795ac4304d'
     OR md5(pg_get_functiondef('public.fn_create_tournament_governed_legacy(uuid,jsonb)'::regprocedure))
       IS DISTINCT FROM '3d40ead690de9769287475c206341668' THEN
    RAISE EXCEPTION 'tournament_create_request_authority_changed';
  END IF;
END $pre$;

-- No hot-parent foreign key: authority verifies actor, club and event in the
-- owning transaction, and immutable receipts survive later event retirement.
CREATE TABLE smarter_private.tournament_create_receipts (
  request_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  club_id uuid NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  tournament_id uuid NOT NULL UNIQUE,
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((receipt->'success'='true'::jsonb) IS TRUE),
  CHECK ((receipt->>'request_state'='accepted') IS TRUE),
  CHECK ((receipt->>'request_id') IS NOT DISTINCT FROM request_id::text),
  CHECK ((receipt->>'user_id') IS NOT DISTINCT FROM actor_id::text),
  CHECK ((receipt->>'club_id') IS NOT DISTINCT FROM club_id::text),
  CHECK ((receipt->>'tournament_id') IS NOT DISTINCT FROM tournament_id::text)
);
ALTER TABLE smarter_private.tournament_create_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON smarter_private.tournament_create_receipts FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION smarter_private.tournament_create_receipt_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $fn$
BEGIN
  RAISE EXCEPTION 'tournament_create_receipt_is_immutable' USING ERRCODE='55000';
END $fn$;
REVOKE ALL ON FUNCTION smarter_private.tournament_create_receipt_immutable() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER tournament_create_receipt_immutable
BEFORE UPDATE OR DELETE ON smarter_private.tournament_create_receipts
FOR EACH ROW EXECUTE FUNCTION smarter_private.tournament_create_receipt_immutable();
CREATE TRIGGER tournament_create_receipt_no_truncate
BEFORE TRUNCATE ON smarter_private.tournament_create_receipts
FOR EACH STATEMENT EXECUTE FUNCTION smarter_private.tournament_create_receipt_immutable();

CREATE FUNCTION public.fn_create_tournament_request(
  p_club_id uuid, p_config jsonb, p_request_id uuid, p_actor_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $fn$
DECLARE
  v_uid uuid:=auth.uid();
  v_saved smarter_private.tournament_create_receipts%ROWTYPE;
  v_result jsonb;
  v_id uuid;
  v_club uuid;
BEGIN
  IF v_uid IS NULL OR p_actor_id IS NULL OR v_uid IS DISTINCT FROM p_actor_id
     OR NOT COALESCE(public.fn_caller_session_is_live(),false) THEN
    RETURN jsonb_build_object('success',false,'error','not_authenticated');
  END IF;
  IF p_club_id IS NULL OR NOT COALESCE(public.fn_can_create_games(p_club_id,v_uid),false) THEN
    RETURN jsonb_build_object('success',false,'error','not_authorised');
  END IF;
  IF p_request_id IS NULL OR p_config IS NULL OR jsonb_typeof(p_config)<>'object' THEN
    RETURN jsonb_build_object('success',false,'error','tournament_request_invalid');
  END IF;

  -- Same UUID is one logical request, including concurrent tabs and a late
  -- first transaction. The caller never guesses success from a timeout.
  PERFORM pg_advisory_xact_lock(hashtextextended('tournament-create-request:'||p_request_id::text,0));
  IF NOT COALESCE(public.fn_caller_session_is_live(),false)
     OR NOT COALESCE(public.fn_can_create_games(p_club_id,v_uid),false) THEN
    RETURN jsonb_build_object('success',false,'error','not_authorised');
  END IF;
  SELECT * INTO v_saved FROM smarter_private.tournament_create_receipts WHERE request_id=p_request_id;
  IF FOUND THEN
    IF v_saved.actor_id IS DISTINCT FROM v_uid OR v_saved.club_id IS DISTINCT FROM p_club_id THEN
      RETURN jsonb_build_object('success',false,'error','not_authorised');
    END IF;
    IF v_saved.payload IS DISTINCT FROM p_config THEN
      RETURN jsonb_build_object('success',false,'error','tournament_request_payload_changed');
    END IF;
    SELECT club_id INTO v_club FROM public.tournaments WHERE id=v_saved.tournament_id FOR KEY SHARE;
    IF NOT FOUND OR v_club IS DISTINCT FROM v_saved.club_id THEN
      RETURN jsonb_build_object('success',false,'error','tournament_request_target_retired',
        'request_state','retired','request_id',p_request_id,'user_id',v_uid,
        'club_id',v_saved.club_id,'tournament_id',v_saved.tournament_id);
    END IF;
    RETURN v_saved.receipt;
  END IF;

  v_result:=public.fn_create_tournament(p_club_id,p_config);
  IF v_result->'success'='false'::jsonb AND jsonb_typeof(v_result->'error')='string' THEN
    RETURN v_result||jsonb_build_object('request_state','not_created','request_id',p_request_id,
      'user_id',v_uid,'club_id',p_club_id);
  END IF;
  IF v_result->'success' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'tournament_create_request_receipt_unconfirmed';
  END IF;
  v_id:=NULLIF(v_result->>'tournament_id','')::uuid;
  IF v_id IS NULL THEN RAISE EXCEPTION 'tournament_create_request_id_missing'; END IF;
  SELECT club_id INTO v_club FROM public.tournaments WHERE id=v_id FOR KEY SHARE;
  IF NOT FOUND OR v_club IS DISTINCT FROM p_club_id THEN
    RAISE EXCEPTION 'tournament_create_request_event_scope_changed';
  END IF;
  v_result:=v_result||jsonb_build_object('request_state','accepted','request_id',p_request_id,
    'user_id',v_uid,'club_id',p_club_id);
  INSERT INTO smarter_private.tournament_create_receipts(request_id,actor_id,club_id,payload,tournament_id,receipt)
  VALUES(p_request_id,v_uid,p_club_id,p_config,v_id,v_result);
  RETURN v_result;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_create_tournament_request(uuid,jsonb,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_create_tournament_request(uuid,jsonb,uuid,uuid) TO authenticated,service_role;
COMMIT;
