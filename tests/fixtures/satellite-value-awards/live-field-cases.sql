DO $live_field$
DECLARE c jsonb;s uuid;target uuid;u uuid;q uuid[];i integer;r jsonb;receipt jsonb;
BEGIN
 c:=pg_temp.qualifier_case('live_field',2,false);
 s:=(c->>'tournament_id')::uuid;target:=(c->>'target_id')::uuid;
 SELECT array_agg(value::uuid) INTO q FROM jsonb_array_elements_text(c->'qualifier_ids');
 FOR i IN 2..4 LOOP
  u:=md5('l04:live_field:user:'||i)::uuid;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated','session_id',md5('l04:live_field:session:'||i)::uuid)::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r:=public.fn_register_for_tournament_request(target,md5('live-field-target-entry:'||i)::uuid);
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.qualifier_assert((r->>'ok')::boolean,'actual target entry '||i||': '||r);
 END LOOP;
 -- Accepted launch/hand are an explicit isolated opening, not production writes.
 PERFORM set_config('session_replication_role','replica',true);
 UPDATE public.tournaments SET status='RUNNING',started_at=now()-interval '1 minute',start_time=now()-interval '1 minute',late_reg_mins=60,late_reg_levels=10,current_level=0,entry_contract_locked=true WHERE id=target;
 INSERT INTO public.tables(id,name,tournament_id,status,lifecycle,current_players,game_type,club_id,seat_game_scope,seat_admission_key,max_players)
 SELECT md5('live-field-target-table')::uuid,'Live Field Target',target,'running','live',0,'tournament',club_id,'table:'||md5('live-field-target-table')::uuid,'tournament:'||target,9 FROM public.tournaments WHERE id=target;
 UPDATE public.tournament_players SET status='playing',chips=1000 WHERE tournament_id=target;
 PERFORM set_config('session_replication_role','origin',true);
 -- The actual installed roster trigger owns this decrement.
 UPDATE public.tournament_players SET status='eliminated',chips=0,position=3,eliminated_at=now(),elimination_sequence=1 WHERE tournament_id=target AND user_id=md5('l04:live_field:user:3')::uuid;
 PERFORM pg_temp.qualifier_assert((SELECT current_players=2 FROM public.tournaments WHERE id=target),'real bust leaves two live players from three entrants');
 BEGIN
  UPDATE public.tournaments SET current_players=current_players+7 WHERE id=target;
  PERFORM public.fn_settle_satellite_qualifiers(s,q);
  RAISE EXCEPTION 'malformed target counter unexpectedly accepted';
 EXCEPTION WHEN SQLSTATE 'P0404' THEN NULL; END;
 PERFORM pg_temp.qualifier_assert((SELECT current_players=2 FROM public.tournaments WHERE id=target),'malformed count refusal rolls back without repairing rows');
 receipt:=public.fn_settle_satellite_qualifiers(s,q);
 PERFORM pg_temp.qualifier_assert((receipt->>'fully_settled')::boolean,'LIVE_FIELD_TARGET_SETTLES');
 PERFORM pg_temp.qualifier_assert((SELECT seat_count=1 AND entry_ticket_count=1 FROM public.tournament_satellite_settlements WHERE tournament_id=s),'one new seat and one already-registered winner ticket');
 PERFORM pg_temp.qualifier_assert((SELECT current_players=3 FROM public.tournaments WHERE id=target) AND (SELECT count(*)=4 FROM public.tournament_players WHERE tournament_id=target),'live count increases once and total roster remains independently counted');
 PERFORM pg_temp.qualifier_assert(public.fn_settle_satellite_qualifiers(s,q)=receipt,'exact receipt replay does not add a second seat');
END $live_field$;
