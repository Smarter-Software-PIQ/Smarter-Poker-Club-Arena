-- Activate only after the four owner-only private providers were installed.
-- This transaction switches the original attendance, wallet/ticket delegates,
-- seat admission and F06 source ownership together. Its first check also
-- refuses a changed public original between the two installations.
-- @live-proof: (SELECT count(*)=12 AND md5(string_agg(name || ':' || md5(pg_get_functiondef(p.oid)), ',' ORDER BY name))='72a6a1f7d42d2b7c8d0baeb869a81351' FROM unnest(ARRAY['public.fn_register_horse_for_tournament_to_target(uuid,uuid,boolean,bigint)','smarter_private.purchase_mtt_to_attendance_target(uuid,uuid,boolean,bigint)','smarter_private.is_background_mtt_admission(uuid,uuid)','smarter_private.owns_background_mtt_admission(uuid,uuid)','smarter_private.acquire_mtt_entry_lane(uuid,uuid,uuid)','smarter_private.f06_source_guard()','public.fn_ca_lock_tournament_seat_acquisition(uuid,uuid,uuid)','public.fn_ca_register_for_tournament_with_ticket_for(uuid,uuid,uuid)','public.fn_ca_use_cashier_entry_ticket(uuid,uuid,uuid)','public.fn_register_horse_for_tournament_before_terminal_gate(uuid,uuid,boolean)','public.fn_satellite_target_player_provenance_is_immutable()','public.fn_tournament_live_seat_acquisition_requires_authority()']) name JOIN pg_proc p ON p.oid=to_regprocedure(name)) AND EXISTS(SELECT FROM pg_class c WHERE c.oid=to_regclass('smarter_private.background_mtt_admission') AND c.relpersistence='u' AND c.relrowsecurity) AND NOT EXISTS(SELECT FROM unnest(ARRAY['anon','authenticated','service_role']) r WHERE has_table_privilege(r,'smarter_private.background_mtt_admission','INSERT') OR has_function_privilege(r,'smarter_private.purchase_mtt_to_attendance_target(uuid,uuid,boolean,bigint)','EXECUTE')) AND has_function_privilege('service_role','public.fn_register_horse_for_tournament_to_target(uuid,uuid,boolean,bigint)','EXECUTE')

BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';

DO $require_preparation$
BEGIN
  IF NOT ((SELECT count(*)=4 AND bool_and(md5(pg_get_functiondef(p.oid))=v.digest AND p.proowner='postgres'::regrole AND NOT EXISTS(SELECT FROM unnest(ARRAY['anon','authenticated','service_role']) r WHERE has_function_privilege(r,p.oid,'EXECUTE'))) FROM (VALUES ('smarter_private.acquire_mtt_entry_lane(uuid,uuid,uuid)','5b53ed9a10de11de610c27cb1e626f86'),('smarter_private.is_background_mtt_admission(uuid,uuid)','b78fb15976b5071ac4cbb3341f9b3382'),('smarter_private.owns_background_mtt_admission(uuid,uuid)','18e92749d21ef81582b7de8f6ec581bd'),('smarter_private.purchase_mtt_to_attendance_target(uuid,uuid,boolean,bigint)','ebe73512d4f8f90537ceaf32dedb8493')) v(name,digest) JOIN pg_proc p ON p.oid=to_regprocedure(v.name)) AND EXISTS(SELECT FROM pg_class c WHERE c.oid=to_regclass('smarter_private.background_mtt_admission') AND c.relpersistence='u' AND c.relrowsecurity AND NOT EXISTS(SELECT FROM unnest(ARRAY['anon','authenticated','service_role']) r WHERE has_table_privilege(r,c.oid,'INSERT')))) OR md5(pg_get_functiondef('public.fn_register_horse_for_tournament_to_target(uuid,uuid,boolean,bigint)'::regprocedure)) IS DISTINCT FROM 'afb54a9112c4fe974ef3b398d8dbe748' THEN
    RAISE EXCEPTION 'funded_mtt_admission_preparation_changed' USING ERRCODE='55000';
  END IF;
END $require_preparation$;

CREATE OR REPLACE FUNCTION public.fn_register_horse_for_tournament_to_target(
  p_tournament_id uuid,p_user_id uuid,p_allow_wallet_charge boolean,p_target_live_entries bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='1ms' SET statement_timeout='30s' AS $$
DECLARE answer jsonb; owns_marker boolean:=false;
BEGIN
  IF p_target_live_entries BETWEEN 0 AND 9007199254740991 AND
     EXISTS(SELECT FROM public.tournaments t WHERE t.id=p_tournament_id AND t.format_contract IN ('mtt-v1','mtt-v2') AND t.status IN ('REGISTERING','RUNNING','ANNOUNCED'))
     AND EXISTS(SELECT FROM public.profiles h WHERE h.id=p_user_id AND h.is_horse IS TRUE) THEN
    IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('ca:tournament-terminal-settlement:v1',0)) THEN
      RAISE EXCEPTION 'horse_attendance_lane_busy' USING ERRCODE='55P03';
    END IF;
    IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('ca:tournament-terminal-settlement:v1:'||p_tournament_id::text,0)) THEN
      RAISE EXCEPTION 'horse_attendance_lane_busy' USING ERRCODE='55P03';
    END IF;
    IF NOT pg_try_advisory_xact_lock(hashtextextended('ca:background-mtt-admission:v1:'||p_tournament_id::text,0)) THEN
      RAISE EXCEPTION 'horse_attendance_lane_busy' USING ERRCODE='55P03';
    END IF;
    INSERT INTO smarter_private.background_mtt_admission VALUES(pg_current_xact_id(),p_tournament_id,p_user_id)
     ON CONFLICT(writer_xid) DO NOTHING;
    owns_marker:=FOUND;
    IF NOT owns_marker AND NOT smarter_private.is_background_mtt_admission(p_tournament_id,p_user_id) THEN
      RAISE EXCEPTION 'concurrent_nested_background_mtt_admission' USING ERRCODE='55000';
    END IF;
  END IF;
  answer:=smarter_private.purchase_mtt_to_attendance_target(p_tournament_id,p_user_id,p_allow_wallet_charge,p_target_live_entries);
  IF owns_marker THEN
    DELETE FROM smarter_private.background_mtt_admission WHERE writer_xid=pg_current_xact_id()
      AND tournament_id=p_tournament_id AND user_id=p_user_id;
  END IF;
  RETURN answer;
END $$;

REVOKE ALL ON FUNCTION public.fn_register_horse_for_tournament_to_target(uuid,uuid,boolean,bigint)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_register_horse_for_tournament_to_target(uuid,uuid,boolean,bigint)
 TO service_role;

-- Every other field, refusal, source record, privilege and lock ordering stays
-- in its installed original. Abort the transaction if any input has drifted.
DO $admission_contract$
DECLARE definition text;
BEGIN
  definition:=pg_get_functiondef('public.fn_ca_lock_tournament_seat_acquisition(uuid,uuid,uuid)'::regprocedure);
  IF md5(definition)<>'651ddfe7bd5fa4884edae4df0050268a' THEN RAISE EXCEPTION 'changed original fn_ca_lock_tournament_seat_acquisition(uuid,uuid,uuid)'; END IF;
  definition:=replace(definition,$old$  v_table_id uuid := p_table_id;$old$,$new$  v_table_id uuid := p_table_id;
  v_background boolean;$new$);
  definition:=replace(definition,$old$  PERFORM public.fn_ca_lock_settlement_lane_for_tournament(p_tournament_id, p_table_id);$old$,$new$  v_background := smarter_private.acquire_mtt_entry_lane(p_tournament_id, p_table_id, p_user_id);$new$);
  definition:=replace(definition,$old$  PERFORM 1
  FROM public.tables tb
  WHERE tb.tournament_id = v_tournament_id
    AND COALESCE(tb.status, 'active') <> 'closed'
  ORDER BY tb.id
  FOR UPDATE;

  PERFORM 1
  FROM public.tournament_players tp
  WHERE tp.tournament_id = v_tournament_id
    AND tp.status::text IN ('registered', 'playing')
  ORDER BY tp.id
  FOR UPDATE;

  PERFORM 1
  FROM public.table_seats ts
  JOIN public.tables tb ON tb.id = ts.table_id
  WHERE tb.tournament_id = v_tournament_id
    AND ts.left_at IS NULL
  ORDER BY ts.id
  FOR UPDATE;$old$,$new$  -- Other authorities retain their original event-wide row fencing. The attendance
  -- buyer is serialized with them by the terminal lane and with its peers by
  -- the event admission lock. Its original payer and chosen chair still lock.
  IF NOT v_background THEN
    PERFORM 1
    FROM public.tables tb
    WHERE tb.tournament_id = v_tournament_id
      AND COALESCE(tb.status, 'active') <> 'closed'
    ORDER BY tb.id
    FOR UPDATE;

    PERFORM 1
    FROM public.tournament_players tp
    WHERE tp.tournament_id = v_tournament_id
      AND tp.status::text IN ('registered', 'playing')
    ORDER BY tp.id
    FOR UPDATE;

    PERFORM 1
    FROM public.table_seats ts
    JOIN public.tables tb ON tb.id = ts.table_id
    WHERE tb.tournament_id = v_tournament_id
      AND ts.left_at IS NULL
    ORDER BY ts.id
    FOR UPDATE;
  END IF;$new$);
  EXECUTE definition;

  definition:=pg_get_functiondef('public.fn_ca_register_for_tournament_with_ticket_for(uuid,uuid,uuid)'::regprocedure);
  IF md5(definition)<>'d2402cf683084df0245e76f8fa7bac73' THEN RAISE EXCEPTION 'changed original fn_ca_register_for_tournament_with_ticket_for(uuid,uuid,uuid)'; END IF;
  definition:=replace(definition,$old$PERFORM public.fn_ca_lock_settlement_lane_for_tournament(p_tournament_id);$old$,$new$PERFORM smarter_private.acquire_mtt_entry_lane(p_tournament_id,NULL,p_beneficiary_id);$new$);
  EXECUTE definition;

  definition:=pg_get_functiondef('public.fn_ca_use_cashier_entry_ticket(uuid,uuid,uuid)'::regprocedure);
  IF md5(definition)<>'0d5b384945f80b0b127663bbc5a64652' THEN RAISE EXCEPTION 'changed original fn_ca_use_cashier_entry_ticket(uuid,uuid,uuid)'; END IF;
  definition:=replace(definition,$old$PERFORM public.fn_ca_lock_settlement_lane_for_tournament(p_tournament_id);$old$,$new$PERFORM smarter_private.acquire_mtt_entry_lane(p_tournament_id,NULL,p_beneficiary_id);$new$);
  EXECUTE definition;

  definition:=pg_get_functiondef('public.fn_register_horse_for_tournament_before_terminal_gate(uuid,uuid,boolean)'::regprocedure);
  IF md5(definition)<>'ab3da30e108c4b1f1ad5edace51607bd' THEN RAISE EXCEPTION 'changed original fn_register_horse_for_tournament_before_terminal_gate(uuid,uuid,boolean)'; END IF;
  definition:=replace(definition,$old$PERFORM public.fn_ca_lock_settlement_lane_for_tournament(p_tournament_id);$old$,$new$PERFORM smarter_private.acquire_mtt_entry_lane(p_tournament_id,NULL,p_user_id);$new$);
  EXECUTE definition;

  definition:=pg_get_functiondef('public.fn_satellite_target_player_provenance_is_immutable()'::regprocedure);
  IF md5(definition)<>'68f98d4ec2cb186aae11787f1666cffc' THEN RAISE EXCEPTION 'changed original fn_satellite_target_player_provenance_is_immutable()'; END IF;
  definition:=replace(definition,$old$      INTO v_owns_acquisition_root;$old$,$new$      INTO v_owns_acquisition_root;
    IF TG_OP = 'INSERT' AND NOT v_owns_acquisition_root THEN
      v_owns_acquisition_root := smarter_private.owns_background_mtt_admission(NEW.tournament_id,NEW.user_id);
    END IF;$new$);
  EXECUTE definition;

  definition:=pg_get_functiondef('public.fn_tournament_live_seat_acquisition_requires_authority()'::regprocedure);
  IF md5(definition)<>'2039e26a8513bba99c057a28b79f44e5' THEN RAISE EXCEPTION 'changed original fn_tournament_live_seat_acquisition_requires_authority()'; END IF;
  definition:=replace(definition,$old$  IF NOT COALESCE(v_owns_authority,false) THEN$old$,$new$  IF NOT COALESCE(v_owns_authority,false)
     AND NOT smarter_private.owns_background_mtt_admission(v_tournament_id,NEW.user_id) THEN$new$);
  EXECUTE definition;

  -- This original trigger also acquires T for physical source changes. A new
  -- entrant has no source chair to move. Keep the original park, manifest,
  -- custody and move-dispatch checks below this substitution for every row.
  definition:=pg_get_functiondef('smarter_private.f06_source_guard()'::regprocedure);
  IF md5(definition)<>'2cb07986223473917ab28dd889ced884' THEN RAISE EXCEPTION 'changed original f06_source_guard'; END IF;
  definition:=replace(definition,$old$ ELSE
  PERFORM smarter_private.f06_try_lane(t);
 END IF;$old$,$new$ ELSIF (
  dst IS NOT NULL AND newj->>'user_id' IS NOT NULL AND (
    (TG_TABLE_NAME='table_seats' AND newj->>'left_at' IS NULL AND
     (TG_OP='INSERT' OR (TG_OP='UPDATE' AND oldj->>'left_at' IS NOT NULL
      AND (src,oldj->>'id',oldj->>'seat_number') IS NOT DISTINCT FROM
          (dst,newj->>'id',newj->>'seat_number'))))
    OR (TG_TABLE_NAME='tournament_players' AND TG_OP='UPDATE' AND src IS NULL
      AND oldj->>'status'='registered' AND newj->>'status'='playing'
      AND (oldj->>'id',oldj->>'user_id',oldj->>'tournament_id') IS NOT DISTINCT FROM
          (newj->>'id',newj->>'user_id',newj->>'tournament_id')))
  AND smarter_private.owns_background_mtt_admission(t,u)
 ) IS NOT TRUE THEN
  PERFORM smarter_private.f06_try_lane(t);
 END IF;$new$);
  EXECUTE definition;

END $admission_contract$;

COMMIT;
