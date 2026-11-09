CREATE TABLE capped_recovery_subject(tournament_id uuid,request_id uuid);
DO $recovery$
DECLARE
 setup jsonb;
 event uuid;
 qualifiers uuid[];
 receipt jsonb;
 request_id uuid:=md5('capped recovery durable request')::uuid;
 generation uuid:=md5('capped recovery original generation')::uuid;
BEGIN
 setup:=pg_temp.capped_value_case('recovery29',29,false);
 event:=(setup->>'tournament_id')::uuid;
 SELECT array_agg(value::uuid ORDER BY value::uuid) INTO qualifiers
 FROM jsonb_array_elements_text(setup->'qualifier_ids');
 PERFORM set_config('app.satellite_capped_awards','v1',true);
 receipt:=public.fn_settle_satellite_qualifiers(event,qualifiers);
 PERFORM pg_temp.qualifier_assert((receipt->>'pool')::numeric=1003
  AND (receipt->'remainder'->>'amount')::numeric=523,
  'original funded capped receipt retains the full pool');
 PERFORM pg_temp.qualifier_assert((SELECT count(*)=49 AND sum(amount)=1003
  FROM public.tournament_payouts WHERE tournament_id=event),
  'original capped payment has exactly 49 conserved legs');
 INSERT INTO smarter_private.tournament_terminal_requests
 (request_id,tournament_id,original_request,original_generation,current_generation,phase)
 VALUES(request_id,event,jsonb_build_object('kind','satellite_qualifiers',
  'tournamentId',event,'observedWinnerId',NULL,'qualifierIds',qualifiers),
  generation,generation,'committed');
 INSERT INTO capped_recovery_subject VALUES(event,request_id);
END
$recovery$;
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
