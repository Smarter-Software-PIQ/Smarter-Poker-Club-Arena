CREATE OR REPLACE FUNCTION smarter_private.original_lightning_funding_owner_evidence(p_table uuid,p_number bigint,p_scope jsonb,p_evidence jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE
SET search_path TO pg_catalog,public,smarter_private SET TimeZone TO 'UTC' SET enable_nestloop TO 'on'
AS $function$
DECLARE started timestamptz; lightning_id uuid; person jsonb; custody record;
 occupancy uuid; funding uuid; funding_count bigint; original_union boolean;
 result_people jsonb:='[]'::jsonb; game_union uuid;
BEGIN
 game_union:=(p_scope->>'game_union_id')::uuid;
 -- Already-correct owners and other original custody shapes retain exact bytes.
 IF game_union IS NULL OR NOT EXISTS(SELECT FROM jsonb_array_elements(p_evidence->'participants')q
  WHERE q->>'ownership_scope'='original_lightning_pool_session'AND q->>'earning_club_id'=game_union::text)
 THEN RETURN p_evidence;END IF;
 SELECT h.hand_id,hh.started_at INTO STRICT lightning_id,started
 FROM public.lightning_hand h JOIN public.hand_history hh ON hh.id=h.hand_history_id
 WHERE h.host_table_id=p_table AND h.hand_number=p_number AND hh.table_id=p_table AND hh.hand_number=p_number
  AND hh.id::text=p_evidence->>'hand_id';
 IF started IS NULL OR NOT isfinite(started) OR p_evidence->>'table_id'IS DISTINCT FROM p_table::text
  OR p_evidence->>'hand_number'IS DISTINCT FROM p_number::text OR p_evidence->'game_scope'IS DISTINCT FROM p_scope
  OR p_evidence->>'status'IS DISTINCT FROM 'ready'OR p_evidence->'basis_certified'IS DISTINCT FROM 'true'::jsonb
 THEN RAISE EXCEPTION 'original_lightning_funding_owner_identity_changed';END IF;
 FOR person IN SELECT value FROM jsonb_array_elements(p_evidence->'participants')LOOP
  IF person->>'ownership_scope'='original_lightning_pool_session'AND person->>'earning_club_id'=game_union::text THEN
   SELECT hp.net_result,cs.id cash_session,cs.club_id,cs.table_id,cs.opened_at,cs.closed_at,ps.anchor_seat_id,
    ps.entered_at,ps.exited_at,sl.opened_at slot_opened,sl.closed_at slot_closed
   INTO STRICT custody FROM public.lightning_hand_player hp
   JOIN public.lightning_pool_slot sl ON sl.id=hp.pool_slot_id AND sl.player_id=hp.player_id
    AND sl.id=(person->>'pool_slot_id')::uuid
   JOIN public.lightning_pool_session ps ON ps.id=sl.pool_session_id AND ps.player_id=hp.player_id
    AND ps.id=(person->>'pool_session_id')::uuid AND ps.cluster_id=sl.cluster_id AND ps.cluster_epoch=sl.cluster_epoch
   JOIN public.cash_player_session cs ON cs.id=ps.cash_player_session_id AND cs.player_id=hp.player_id
   WHERE hp.hand_id=lightning_id AND hp.player_id=(person->>'user_id')::uuid
    AND hp.cluster_id=sl.cluster_id AND hp.cluster_epoch=sl.cluster_epoch;
   IF person->'original_funding_session_ids'IS DISTINCT FROM jsonb_build_array(custody.cash_session)
    OR person->'ownership_certified'IS DISTINCT FROM 'true'::jsonb OR custody.club_id IS DISTINCT FROM game_union
    OR (person->>'observed_stack_delta')::numeric IS DISTINCT FROM custody.net_result
    OR custody.opened_at IS NULL OR NOT isfinite(custody.opened_at)OR custody.opened_at>started
    OR(custody.closed_at IS NOT NULL AND(NOT isfinite(custody.closed_at)OR custody.closed_at<=started))
    OR custody.entered_at IS NULL OR NOT isfinite(custody.entered_at)OR custody.entered_at>started
    OR(custody.exited_at IS NOT NULL AND(NOT isfinite(custody.exited_at)OR custody.exited_at<=started))
    OR custody.slot_opened IS NULL OR NOT isfinite(custody.slot_opened)OR custody.slot_opened>started
    OR(custody.slot_closed IS NOT NULL AND(NOT isfinite(custody.slot_closed)OR custody.slot_closed<=started))
   THEN RAISE EXCEPTION 'original_lightning_funding_owner_custody_changed';END IF;
   occupancy:=NULL;funding:=NULL;funding_count:=NULL;
   -- Same original Nov1 anchor-first rule, then the carried-stack fallback.
   SELECT r.occupancy_id INTO occupancy FROM public.cash_participant_funding_receipts r
   WHERE r.table_id=custody.table_id AND r.account_entity_id=(person->>'user_id')::uuid
    AND r.operation_kind='buyin'AND r.user_id=(person->>'user_id')::uuid
    AND r.seat_id=custody.anchor_seat_id AND r.recorded_at<=started
   ORDER BY r.recorded_at DESC,r.id DESC LIMIT 1;
   IF occupancy IS NULL THEN
    SELECT r.occupancy_id INTO occupancy FROM public.cash_participant_funding_receipts r
    WHERE r.user_id=(person->>'user_id')::uuid AND r.account_entity_id=(person->>'user_id')::uuid
     AND r.operation_kind='buyin'AND r.recorded_at<=started
    ORDER BY r.recorded_at DESC,r.id DESC LIMIT 1;
   END IF;
   IF occupancy IS NOT NULL THEN
    SELECT count(DISTINCT r.funding_club_id),min(r.funding_club_id::text)::uuid,
     bool_and(r.funding_union_id IS NOT DISTINCT FROM game_union AND r.asset IS NOT DISTINCT FROM 'chips'AND r.user_id IS NOT DISTINCT FROM (person->>'user_id')::uuid)
    INTO funding_count,funding,original_union FROM public.cash_participant_funding_receipts r
    WHERE r.occupancy_id=occupancy AND r.recorded_at<=started AND r.funding_club_id IS NOT NULL;
    -- Receipt-time union attribution is immutable; current membership cannot
    -- rewrite a closed week's original funding ownership.
    IF funding_count=1 AND funding IS DISTINCT FROM custody.club_id AND original_union IS TRUE THEN
     person:=jsonb_set(person,'{earning_club_id}',to_jsonb(funding));
    END IF;
   END IF;
  END IF;
  result_people:=result_people||jsonb_build_array(person);
 END LOOP;
 RETURN jsonb_set(p_evidence,'{participants}',result_people);
END $function$;
REVOKE ALL ON FUNCTION smarter_private.original_lightning_funding_owner_evidence(uuid,bigint,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
