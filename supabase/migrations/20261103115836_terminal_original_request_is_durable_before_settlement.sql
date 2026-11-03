-- Original terminal intent is acknowledged before any settlement request.
-- Transport loss must retain exact event/winner/proposal/qualifier identity.
-- The existing financial functions remain the only payers. This contract owns
-- request identity, current generation and serialized closure of late sends.
-- No hot-table foreign key, periodic scanner, or new financial implementation.
-- @live-proof: md5(pg_get_functiondef('fn_adopt_tournament_terminal_request(uuid,uuid,uuid)'::regprocedure))='300f92a0cf6a6e58d20dfa947cb613ff' AND md5(pg_get_functiondef('fn_close_uncommitted_tournament_terminal_request(uuid,uuid)'::regprocedure))='f7a6506c05164faf1027e0ed46e622f5' AND md5(pg_get_functiondef('fn_execute_tournament_terminal_request(uuid,uuid)'::regprocedure))='7580ca286c239ffd8c051d70379b6603' AND md5(pg_get_functiondef('fn_f06_assert_drained_manager_custody(uuid,uuid,uuid,jsonb,jsonb)'::regprocedure))='8b2c8626e8d9001b7152defe235c261d' AND md5(pg_get_functiondef('fn_prepare_tournament_terminal_request(uuid,jsonb,uuid)'::regprocedure))='0a6e96cd882dabb2f100a999cd8ced8b' AND md5(pg_get_functiondef('fn_read_tournament_terminal_request(uuid,uuid)'::regprocedure))='99fa4618cea552f99749d860c028b602' AND md5(pg_get_functiondef('fn_resolve_tournament_terminal_request(uuid)'::regprocedure))='f299c2191ab72f7e9e39b3ca24be83eb' AND md5(pg_get_functiondef('smarter_private.assert_terminal_request_generation(uuid,uuid)'::regprocedure))='cda0970a91262d8eb5b8fa75423acc19' AND md5(pg_get_functiondef('smarter_private.lock_terminal_request_lane(jsonb)'::regprocedure))='879072020cd7593676ea48361e309bd2' AND md5(pg_get_functiondef('smarter_private.resolve_terminal_request(jsonb)'::regprocedure))='1b4e041f76384dec9ae0f9541d722894' AND md5(pg_get_functiondef('smarter_private.terminal_receipt_requires_original_request()'::regprocedure))='94a3bbc4f77e90f9a3674dc8df4f7700' AND md5(pg_get_functiondef('smarter_private.terminal_request_identity_is_immutable()'::regprocedure))='4b47e6ef0b827c49ebb95516da97d493' AND md5(pg_get_functiondef('smarter_private.terminal_request_identity_valid(jsonb)'::regprocedure))='633f8d90720165532d6c06f1e686a379' AND has_function_privilege('service_role','fn_adopt_tournament_terminal_request(uuid,uuid,uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','fn_adopt_tournament_terminal_request(uuid,uuid,uuid)','EXECUTE') AND has_function_privilege('service_role','fn_close_uncommitted_tournament_terminal_request(uuid,uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','fn_close_uncommitted_tournament_terminal_request(uuid,uuid)','EXECUTE') AND has_function_privilege('service_role','fn_execute_tournament_terminal_request(uuid,uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','fn_execute_tournament_terminal_request(uuid,uuid)','EXECUTE') AND has_function_privilege('service_role','fn_f06_assert_drained_manager_custody(uuid,uuid,uuid,jsonb,jsonb)','EXECUTE') AND NOT has_function_privilege('authenticated','fn_f06_assert_drained_manager_custody(uuid,uuid,uuid,jsonb,jsonb)','EXECUTE') AND has_function_privilege('service_role','fn_prepare_tournament_terminal_request(uuid,jsonb,uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','fn_prepare_tournament_terminal_request(uuid,jsonb,uuid)','EXECUTE') AND has_function_privilege('service_role','fn_read_tournament_terminal_request(uuid,uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','fn_read_tournament_terminal_request(uuid,uuid)','EXECUTE') AND has_function_privilege('service_role','fn_resolve_tournament_terminal_request(uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','fn_resolve_tournament_terminal_request(uuid)','EXECUTE') AND NOT has_table_privilege('service_role','smarter_private.tournament_terminal_requests','INSERT,UPDATE,DELETE') AND (SELECT count(*)=3 FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='O' AND (tgrelid,tgname) IN (('smarter_private.tournament_terminal_requests'::regclass,'terminal_request_original_is_immutable'),('public.tournament_terminal_settlements'::regclass,'terminal_receipt_requires_original_request'),('public.tournament_satellite_settlements'::regclass,'satellite_receipt_requires_original_request')))
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE smarter_private.tournament_terminal_requests (
  request_id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  original_request jsonb NOT NULL CHECK (jsonb_typeof(original_request) = 'object'),
  original_generation uuid NOT NULL,
  current_generation uuid NOT NULL,
  phase text NOT NULL DEFAULT 'prepared' CHECK (phase IN ('prepared','committed','closed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX tournament_terminal_one_prepared_request
 ON smarter_private.tournament_terminal_requests(tournament_id) WHERE phase = 'prepared';
REVOKE ALL ON smarter_private.tournament_terminal_requests FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION smarter_private.assert_terminal_request_generation(p_event uuid,p_generation uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $f$
BEGIN
  IF current_setting('app.smarter_data_actor',true) IS DISTINCT FROM 'tournament-manager'
     OR current_setting('app.smarter_tournament_id',true) IS DISTINCT FROM p_event::text
     OR current_setting('app.smarter_tournament_lease_generation',true) IS DISTINCT FROM p_generation::text THEN
    RAISE EXCEPTION 'terminal request requires its current manager generation' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.engine_tournament_leases l
   WHERE l.tournament_id=p_event AND l.lease_generation=p_generation AND l.protocol_version=2
     AND l.heartbeat_at >= clock_timestamp()-make_interval(secs=>public.fn_engine_lease_stale_seconds())
     AND NOT smarter_private.f06_generation_aborted(p_event,p_generation)
   FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TOURNAMENT_MANAGER_FENCED' USING ERRCODE='42501'; END IF;
END $f$;
REVOKE ALL ON FUNCTION smarter_private.assert_terminal_request_generation(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION smarter_private.lock_terminal_request_lane(p_request jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $f$
BEGIN
  PERFORM public.fn_ca_lock_mtt_admission_contract();
  IF p_request->>'kind'='proposal_deal' THEN
    -- Proposal authorities still take G exclusively. Never upgrade a scoped lane.
    PERFORM public.fn_ca_lock_settlement_lane_global();
  ELSIF p_request->>'kind' IN ('satellite','satellite_qualifiers') THEN
    PERFORM public.fn_ca_lock_settlement_lane_for_satellite_finish((p_request->>'tournamentId')::uuid);
  ELSE
    PERFORM public.fn_ca_lock_settlement_lane_for_finish((p_request->>'tournamentId')::uuid);
  END IF;
END $f$;
REVOKE ALL ON FUNCTION smarter_private.lock_terminal_request_lane(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION smarter_private.terminal_request_identity_valid(p_request jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path TO public,pg_temp AS $f$
DECLARE v_kind text:=p_request->>'kind'; v_ids uuid[]; v_keys text[];
BEGIN
  IF jsonb_typeof(p_request) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF (p_request->>'tournamentId')::uuid IS NULL THEN RETURN false; END IF;
  SELECT array_agg(k ORDER BY k) INTO v_keys FROM jsonb_object_keys(p_request) k;
  IF v_kind IN ('places','satellite') THEN
    RETURN v_keys=ARRAY['kind','observedWinnerId','tournamentId'] AND (p_request->>'observedWinnerId')::uuid IS NOT NULL;
  ELSIF v_kind='legacy_deal' THEN
    RETURN v_keys=ARRAY['kind','observedWinnerId','tournamentId'] AND p_request->'observedWinnerId'='null'::jsonb;
  ELSIF v_kind='proposal_deal' THEN
    RETURN v_keys=ARRAY['kind','observedWinnerId','proposalId','revision','tournamentId']
      AND p_request->'observedWinnerId'='null'::jsonb AND (p_request->>'proposalId')::uuid IS NOT NULL
      AND p_request->>'revision' ~ '^[0-9a-f]{64}$';
  ELSIF v_kind='satellite_qualifiers' THEN
    SELECT array_agg(x::uuid ORDER BY n) INTO v_ids FROM jsonb_array_elements_text(p_request->'qualifierIds') WITH ORDINALITY q(x,n);
    RETURN v_keys=ARRAY['kind','observedWinnerId','qualifierIds','tournamentId']
      AND p_request->'observedWinnerId'='null'::jsonb AND cardinality(v_ids)>0 AND array_position(v_ids,NULL) IS NULL
      AND v_ids=(SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(v_ids) x);
  END IF;
  RETURN false;
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value THEN RETURN false;
END $f$;
REVOKE ALL ON FUNCTION smarter_private.terminal_request_identity_valid(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE smarter_private.tournament_terminal_requests ADD CONSTRAINT terminal_request_identity_valid
 CHECK (smarter_private.terminal_request_identity_valid(original_request) IS TRUE AND (original_request->>'tournamentId')::uuid=tournament_id);

CREATE FUNCTION smarter_private.terminal_request_identity_is_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path TO public,pg_temp AS $f$
BEGIN
  IF TG_OP='DELETE' OR (NEW.request_id,NEW.tournament_id,NEW.original_request,NEW.original_generation,NEW.created_at)
     IS DISTINCT FROM (OLD.request_id,OLD.tournament_id,OLD.original_request,OLD.original_generation,OLD.created_at)
     OR OLD.phase<>'prepared' THEN
    RAISE EXCEPTION 'terminal request original is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER terminal_request_original_is_immutable BEFORE UPDATE OR DELETE
 ON smarter_private.tournament_terminal_requests FOR EACH ROW EXECUTE FUNCTION smarter_private.terminal_request_identity_is_immutable();
REVOKE ALL ON FUNCTION smarter_private.terminal_request_identity_is_immutable() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_prepare_tournament_terminal_request(p_request_id uuid,p_request jsonb,p_generation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp
 SET lock_timeout TO '8s' SET statement_timeout TO '45s' AS $f$
DECLARE v_event uuid; v_row smarter_private.tournament_terminal_requests%ROWTYPE;
BEGIN
  IF p_request_id IS NULL OR NOT COALESCE(smarter_private.terminal_request_identity_valid(p_request),false) THEN
    RAISE EXCEPTION 'invalid original terminal request' USING ERRCODE='22023';
  END IF;
  v_event:=(p_request->>'tournamentId')::uuid;
  PERFORM smarter_private.assert_terminal_request_generation(v_event,p_generation);
  PERFORM smarter_private.lock_terminal_request_lane(p_request);
  SELECT * INTO v_row FROM smarter_private.tournament_terminal_requests WHERE request_id=p_request_id FOR UPDATE;
  IF FOUND THEN
    IF v_row.original_request IS DISTINCT FROM p_request OR v_row.current_generation<>p_generation THEN
      RAISE EXCEPTION 'original terminal request identity differs' USING ERRCODE='55000';
    END IF;
    RETURN jsonb_build_object('ok',true,'request',to_jsonb(v_row));
  END IF;
  SELECT * INTO v_row FROM smarter_private.tournament_terminal_requests WHERE tournament_id=v_event AND phase='prepared' FOR UPDATE;
  IF FOUND THEN
    IF v_row.original_request IS DISTINCT FROM p_request OR v_row.current_generation<>p_generation THEN
      RAISE EXCEPTION 'event already owns a different original terminal request' USING ERRCODE='55000';
    END IF;
    RETURN jsonb_build_object('ok',true,'request',to_jsonb(v_row));
  END IF;
  IF EXISTS(SELECT 1 FROM public.tournament_terminal_settlements WHERE tournament_id=v_event)
     OR EXISTS(SELECT 1 FROM public.tournament_satellite_settlements WHERE tournament_id=v_event) THEN
    RETURN jsonb_build_object('ok',true,'already_terminal',true,'tournament_id',v_event);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id=v_event AND status IN ('RUNNING','COMPLETING')) THEN
    RAISE EXCEPTION 'terminal request requires a running or completing event' USING ERRCODE='55000';
  END IF;
  INSERT INTO smarter_private.tournament_terminal_requests(request_id,tournament_id,original_request,original_generation,current_generation)
   VALUES(p_request_id,v_event,p_request,p_generation,p_generation) RETURNING * INTO v_row;
  RETURN jsonb_build_object('ok',true,'request',to_jsonb(v_row));
END $f$;
REVOKE ALL ON FUNCTION public.fn_prepare_tournament_terminal_request(uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_prepare_tournament_terminal_request(uuid,jsonb,uuid) TO service_role;

-- Reads do not borrow expired manager authority and do not authorize payout.
-- Caller startup owns a current lease before using a not-found answer to deal.
CREATE FUNCTION public.fn_read_tournament_terminal_request(p_tournament_id uuid,p_request_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp
 SET lock_timeout TO '8s' SET statement_timeout TO '45s' AS $f$
DECLARE v_row smarter_private.tournament_terminal_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM smarter_private.tournament_terminal_requests
   WHERE tournament_id=p_tournament_id AND (request_id=p_request_id OR (p_request_id IS NULL AND phase='prepared'))
   ORDER BY created_at,request_id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'found',false,'tournament_id',p_tournament_id); END IF;
  PERFORM smarter_private.lock_terminal_request_lane(v_row.original_request);
  SELECT * INTO STRICT v_row FROM smarter_private.tournament_terminal_requests WHERE request_id=v_row.request_id FOR UPDATE;
  RETURN jsonb_build_object('ok',true,'found',true,'tournament_id',p_tournament_id,'request',to_jsonb(v_row));
END $f$;
REVOKE ALL ON FUNCTION public.fn_read_tournament_terminal_request(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_read_tournament_terminal_request(uuid,uuid) TO service_role;

CREATE FUNCTION smarter_private.resolve_terminal_request(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $f$
DECLARE v_event uuid:=(p_request->>'tournamentId')::uuid; v_winner uuid:=(p_request->>'observedWinnerId')::uuid; v_ids uuid[];
BEGIN
  CASE p_request->>'kind'
    WHEN 'proposal_deal' THEN RETURN public.fn_resolve_tournament_terminal_proposal_outcome(v_event,v_winner,'final_table_deal',(p_request->>'proposalId')::uuid,p_request->>'revision');
    WHEN 'legacy_deal' THEN RETURN public.fn_resolve_tournament_terminal_outcome(v_event,v_winner,'final_table_deal');
    WHEN 'places' THEN RETURN public.fn_resolve_tournament_terminal_outcome(v_event,v_winner,'places');
    WHEN 'satellite' THEN RETURN public.fn_resolve_satellite_settlement_outcome(v_event,v_winner);
    WHEN 'satellite_qualifiers' THEN
      SELECT array_agg(x::uuid ORDER BY n) INTO v_ids FROM jsonb_array_elements_text(p_request->'qualifierIds') WITH ORDINALITY q(x,n);
      RETURN public.fn_resolve_satellite_qualifier_outcome(v_event,v_ids);
    ELSE RAISE EXCEPTION 'invalid terminal request kind' USING ERRCODE='22023';
  END CASE;
END $f$;
REVOKE ALL ON FUNCTION smarter_private.resolve_terminal_request(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_resolve_tournament_terminal_request(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp
 SET lock_timeout TO '8s' SET statement_timeout TO '45s' AS $f$
DECLARE v_row smarter_private.tournament_terminal_requests%ROWTYPE; v_outcome jsonb;
BEGIN
  SELECT * INTO STRICT v_row FROM smarter_private.tournament_terminal_requests WHERE request_id=p_request_id;
  PERFORM smarter_private.lock_terminal_request_lane(v_row.original_request);
  SELECT * INTO STRICT v_row FROM smarter_private.tournament_terminal_requests WHERE request_id=p_request_id FOR UPDATE;
  v_outcome:=smarter_private.resolve_terminal_request(v_row.original_request);
  RETURN jsonb_build_object('ok',true,'request',to_jsonb(v_row),'outcome',v_outcome);
END $f$;
REVOKE ALL ON FUNCTION public.fn_resolve_tournament_terminal_request(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_resolve_tournament_terminal_request(uuid) TO service_role;

CREATE FUNCTION public.fn_adopt_tournament_terminal_request(p_request_id uuid,p_previous_generation uuid,p_generation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp
 SET lock_timeout TO '8s' SET statement_timeout TO '45s' AS $f$
DECLARE v_row smarter_private.tournament_terminal_requests%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_row FROM smarter_private.tournament_terminal_requests WHERE request_id=p_request_id;
  PERFORM smarter_private.assert_terminal_request_generation(v_row.tournament_id,p_generation);
  PERFORM smarter_private.lock_terminal_request_lane(v_row.original_request);
  SELECT * INTO STRICT v_row FROM smarter_private.tournament_terminal_requests WHERE request_id=p_request_id FOR UPDATE;
  IF v_row.phase<>'prepared' THEN RETURN jsonb_build_object('ok',true,'request',to_jsonb(v_row)); END IF;
  IF (v_row.current_generation IS DISTINCT FROM p_previous_generation AND v_row.current_generation IS DISTINCT FROM p_generation) THEN
    RAISE EXCEPTION 'terminal request generation changed' USING ERRCODE='55000';
  END IF;
  IF v_row.current_generation<>p_generation THEN
    UPDATE smarter_private.tournament_terminal_requests SET current_generation=p_generation WHERE request_id=p_request_id RETURNING * INTO v_row;
  END IF;
  RETURN jsonb_build_object('ok',true,'request',to_jsonb(v_row));
END $f$;
REVOKE ALL ON FUNCTION public.fn_adopt_tournament_terminal_request(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_adopt_tournament_terminal_request(uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.fn_execute_tournament_terminal_request(p_request_id uuid,p_generation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp
 SET lock_timeout TO '8s' SET statement_timeout TO '45s' AS $f$
DECLARE v_row smarter_private.tournament_terminal_requests%ROWTYPE; v_request jsonb; v_receipt jsonb; v_outcome jsonb;
 v_event uuid; v_winner uuid; v_ids uuid[]; v_capability jsonb;
BEGIN
  SELECT * INTO STRICT v_row FROM smarter_private.tournament_terminal_requests WHERE request_id=p_request_id;
  PERFORM smarter_private.assert_terminal_request_generation(v_row.tournament_id,p_generation);
  PERFORM smarter_private.lock_terminal_request_lane(v_row.original_request);
  -- Re-read only after the lock. A queued sender cannot reuse a pre-close view.
  SELECT * INTO STRICT v_row FROM smarter_private.tournament_terminal_requests WHERE request_id=p_request_id FOR UPDATE;
  IF v_row.current_generation<>p_generation OR v_row.phase='closed' THEN
    RAISE EXCEPTION 'terminal request is closed or belongs to another generation' USING ERRCODE='55000';
  END IF;
  IF v_row.phase='committed' THEN
    v_outcome:=smarter_private.resolve_terminal_request(v_row.original_request);
    RETURN jsonb_build_object('ok',true,'request',to_jsonb(v_row),'receipt',v_outcome->'receipt');
  END IF;
  v_request:=v_row.original_request; v_event:=v_row.tournament_id; v_winner:=(v_request->>'observedWinnerId')::uuid;
  PERFORM set_config('app.tournament_terminal_request_id',p_request_id::text,true);
  CASE v_request->>'kind'
    WHEN 'proposal_deal' THEN v_receipt:=public.fn_complete_tournament_terminal_proposal(v_event,v_winner,'final_table_deal',(v_request->>'proposalId')::uuid,v_request->>'revision');
    WHEN 'legacy_deal' THEN
      v_capability:=public.fn_get_tournament_deal_consensus(v_event);
      IF v_capability->>'reason' IS DISTINCT FROM 'proposal_authority_not_active' OR v_capability->'ok' IS DISTINCT FROM 'false'::jsonb THEN
        RAISE EXCEPTION 'legacy deal authority is not inactive' USING ERRCODE='55000';
      END IF;
      v_receipt:=public.fn_complete_tournament_terminal(v_event,v_winner,'final_table_deal');
    WHEN 'places' THEN v_receipt:=public.fn_complete_tournament_terminal(v_event,v_winner,'places');
    WHEN 'satellite' THEN v_receipt:=public.fn_settle_satellite_tournament(v_event,v_winner);
    WHEN 'satellite_qualifiers' THEN
      SELECT array_agg(x::uuid ORDER BY n) INTO v_ids FROM jsonb_array_elements_text(v_request->'qualifierIds') WITH ORDINALITY q(x,n);
      v_receipt:=public.fn_settle_satellite_qualifiers(v_event,v_ids);
    ELSE RAISE EXCEPTION 'invalid terminal request kind' USING ERRCODE='22023';
  END CASE;
  -- Canonical receipt verification remains in the original transaction.
  v_outcome:=smarter_private.resolve_terminal_request(v_request);
  IF v_outcome->'definitively_not_committed' IS DISTINCT FROM 'false'::jsonb
     OR v_outcome->>'status' IS DISTINCT FROM 'COMPLETED' OR v_outcome->'receipt' IS DISTINCT FROM v_receipt THEN
    RAISE EXCEPTION 'terminal request did not produce its canonical receipt' USING ERRCODE='P0404';
  END IF;
  UPDATE smarter_private.tournament_terminal_requests SET phase='committed' WHERE request_id=p_request_id RETURNING * INTO v_row;
  RETURN jsonb_build_object('ok',true,'request',to_jsonb(v_row),'receipt',v_receipt);
END $f$;
REVOKE ALL ON FUNCTION public.fn_execute_tournament_terminal_request(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_execute_tournament_terminal_request(uuid,uuid) TO service_role;

CREATE FUNCTION public.fn_close_uncommitted_tournament_terminal_request(p_request_id uuid,p_generation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp
 SET lock_timeout TO '8s' SET statement_timeout TO '45s' AS $f$
DECLARE v_row smarter_private.tournament_terminal_requests%ROWTYPE; v_outcome jsonb;
BEGIN
  SELECT * INTO STRICT v_row FROM smarter_private.tournament_terminal_requests WHERE request_id=p_request_id;
  PERFORM smarter_private.assert_terminal_request_generation(v_row.tournament_id,p_generation);
  PERFORM smarter_private.lock_terminal_request_lane(v_row.original_request);
  SELECT * INTO STRICT v_row FROM smarter_private.tournament_terminal_requests WHERE request_id=p_request_id FOR UPDATE;
  IF v_row.current_generation<>p_generation THEN RAISE EXCEPTION 'terminal request generation changed' USING ERRCODE='55000'; END IF;
  v_outcome:=smarter_private.resolve_terminal_request(v_row.original_request);
  -- A COMPLETING original has no gameplay admission to release. Retain it
  -- for the same leased continuation rather than stranding it behind legacy
  -- reconstruction or fabricating a RUNNING status/winner.
  IF v_row.phase='prepared' AND v_outcome->'definitively_not_committed'='true'::jsonb
     AND v_outcome->'receipt'='null'::jsonb AND v_outcome->>'status'='RUNNING' THEN
    UPDATE smarter_private.tournament_terminal_requests SET phase='closed' WHERE request_id=p_request_id RETURNING * INTO v_row;
  END IF;
  RETURN jsonb_build_object('ok',true,'request',to_jsonb(v_row),'outcome',v_outcome);
END $f$;
REVOKE ALL ON FUNCTION public.fn_close_uncommitted_tournament_terminal_request(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_close_uncommitted_tournament_terminal_request(uuid,uuid) TO service_role;

-- Once an event uses durable requests, an older unwrapped sender cannot bypass
-- a closed request or invent a replacement winner. Existing receipts are read
-- unchanged; the guard acts only before a new canonical receipt is inserted.
CREATE FUNCTION smarter_private.terminal_receipt_requires_original_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $f$
DECLARE v_row smarter_private.tournament_terminal_requests%ROWTYPE; v_id uuid;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM smarter_private.tournament_terminal_requests WHERE tournament_id=NEW.tournament_id) THEN RETURN NEW; END IF;
  BEGIN v_id:=NULLIF(current_setting('app.tournament_terminal_request_id',true),'')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN v_id:=NULL; END;
  SELECT * INTO v_row FROM smarter_private.tournament_terminal_requests
   WHERE request_id=v_id AND tournament_id=NEW.tournament_id AND phase='prepared';
  IF NOT FOUND THEN RAISE EXCEPTION 'terminal receipt requires its open original request' USING ERRCODE='55000'; END IF;
  IF TG_TABLE_NAME='tournament_terminal_settlements' THEN
    IF v_row.original_request->>'kind' NOT IN ('places','legacy_deal','proposal_deal')
       OR NEW.settlement_mode IS DISTINCT FROM (CASE WHEN v_row.original_request->>'kind'='places' THEN 'places' ELSE 'final_table_deal' END)
       OR (v_row.original_request->>'observedWinnerId' IS NOT NULL AND NEW.winner_id IS DISTINCT FROM (v_row.original_request->>'observedWinnerId')::uuid)
       OR (v_row.original_request->>'kind'='proposal_deal' AND
          (current_setting('app.tournament_deal_proposal_id',true) IS DISTINCT FROM v_row.original_request->>'proposalId'
           OR current_setting('app.tournament_deal_proposal_revision',true) IS DISTINCT FROM v_row.original_request->>'revision')) THEN
      RAISE EXCEPTION 'terminal receipt differs from original request' USING ERRCODE='55000';
    END IF;
  ELSIF TG_TABLE_NAME='tournament_satellite_settlements' THEN
    IF v_row.original_request->>'kind'='satellite' THEN
      IF NEW.winner_id IS DISTINCT FROM (v_row.original_request->>'observedWinnerId')::uuid THEN
        RAISE EXCEPTION 'satellite winner differs from original request' USING ERRCODE='55000';
      END IF;
    ELSIF v_row.original_request->>'kind'='satellite_qualifiers' THEN
      IF to_jsonb(NEW.qualifier_ids) IS DISTINCT FROM v_row.original_request->'qualifierIds' OR NEW.winner_id IS NOT NULL THEN
        RAISE EXCEPTION 'satellite qualifiers differ from original request' USING ERRCODE='55000';
      END IF;
    ELSE RAISE EXCEPTION 'satellite receipt has wrong original request kind' USING ERRCODE='55000'; END IF;
  END IF;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION smarter_private.terminal_receipt_requires_original_request() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER terminal_receipt_requires_original_request BEFORE INSERT ON public.tournament_terminal_settlements
 FOR EACH ROW EXECUTE FUNCTION smarter_private.terminal_receipt_requires_original_request();
CREATE TRIGGER satellite_receipt_requires_original_request BEFORE INSERT ON public.tournament_satellite_settlements
 FOR EACH ROW EXECUTE FUNCTION smarter_private.terminal_receipt_requires_original_request();

-- A COMPLETING event still enters through the existing custody proof. Only an
-- acknowledged original terminal request permits that status; every original
-- hand, park, lease and expected-evidence check remains in the same function.
DO $custody$
DECLARE d text; old text:=$old$WHERE id=p_tournament_id AND upper(status)='RUNNING' FOR UPDATE;$old$;
BEGIN
 SELECT pg_get_functiondef('public.fn_f06_assert_drained_manager_custody(uuid,uuid,uuid,jsonb,jsonb)'::regprocedure) INTO d;
 IF md5(d)<>'8900f47fa86ffdc861aeec9c75d03c95' OR length(d)-length(replace(d,old,''))<>length(old) THEN
  RAISE EXCEPTION 'terminal continuation custody preimage changed';
 END IF;
 EXECUTE replace(d,old,$new$WHERE id=p_tournament_id AND (upper(status)='RUNNING' OR
  (upper(status)='COMPLETING' AND p_lease_generation IS NOT NULL AND EXISTS(
   SELECT 1 FROM smarter_private.tournament_terminal_requests r WHERE r.tournament_id=p_tournament_id AND r.phase='prepared')))
 FOR UPDATE;$new$);
END $custody$;

COMMIT;
