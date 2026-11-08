DO $redeem$
DECLARE src uuid; original_target uuid; holder uuid; voucher uuid; destination uuid:=gen_random_uuid(); result jsonb;
BEGIN
 SELECT s.id,h.target_id,a.user_id,a.ticket_id INTO STRICT src,original_target,holder,voucher
 FROM reconnect_award_source s JOIN public.tournament_satellite_settlements h ON h.tournament_id=s.id
 JOIN public.tournament_satellite_awards a ON a.tournament_id=s.id AND a.delivery_kind='ticket';
 INSERT INTO public.tournaments SELECT d.* FROM public.tournaments t,
  LATERAL jsonb_populate_record(NULL::public.tournaments,to_jsonb(t)||jsonb_build_object(
   'id',destination,'format_contract',NULL,'name','Reconnect voucher destination','status','REGISTERING',
   'start_time',now()+interval '5 minutes','started_at',NULL,'ended_at',NULL,'entry_contract_locked',false,
   'current_players',0,'prize_pool',0,'total_rake',0,'prize_pool_finalized',false,
   'blind_structure','[{"smallBlind":5,"bigBlind":10,"ante":0,"durationMinutes":10}]',
   'guaranteed_prize',0,'late_reg_mins',60,'late_reg_levels',10)) d WHERE t.id=original_target;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',holder,'role','service_role')::text,true);
 result:=public.fn_ca_register_for_tournament_with_ticket_for(destination,voucher,holder);
 IF result->>'ok' IS DISTINCT FROM 'true' OR NOT EXISTS(
   SELECT 1 FROM public.tournament_tickets WHERE id=voucher AND status='redeemed') THEN
   RAISE EXCEPTION 'ranked voucher was not consumed: %',result;
 END IF;
 result:=public.fn_ca_register_for_tournament_with_ticket_for(destination,voucher,holder);
 IF result->>'replayed' IS DISTINCT FROM 'true' OR
    (SELECT count(*) FROM public.tournament_players WHERE tournament_id=destination AND user_id=holder)<>1 THEN
   RAISE EXCEPTION 'ranked voucher lost its original entry on replay: %',result;
 END IF;
END;
$redeem$;
