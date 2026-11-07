DO $read$
DECLARE source_id uuid; award record; answer jsonb; kinds text[]:=ARRAY[]::text[];
BEGIN
 SELECT id INTO STRICT source_id FROM reconnect_award_source;
 FOR award IN SELECT a.*,h.target_id FROM public.tournament_satellite_awards a
   JOIN public.tournament_satellite_settlements h USING(tournament_id)
   WHERE a.tournament_id=source_id ORDER BY a.place LOOP
   PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',award.user_id,'role','authenticated')::text,true);
   EXECUTE 'SET LOCAL ROLE authenticated';
   answer:=public.fn_get_my_satellite_qualifier_result(source_id);
   EXECUTE 'RESET ROLE';
   IF answer IS NULL OR answer->>'user_id' IS DISTINCT FROM award.user_id::text
      OR answer->>'receipt_version' IS DISTINCT FROM '2'
      OR answer->>'delivery_kind' IS DISTINCT FROM award.delivery_kind
      OR answer->>'position' IS DISTINCT FROM award.place::text
      OR answer->>'target_id' IS DISTINCT FROM award.target_id::text
      OR answer->>'registration_id' IS DISTINCT FROM award.registration_id::text
      OR answer->>'ticket_id' IS DISTINCT FROM award.ticket_id::text THEN
      RAISE EXCEPTION 'ranked award identity was not recovered';
   END IF;
   kinds:=array_append(kinds,award.delivery_kind);
 END LOOP;
 IF cardinality(kinds)<>2 OR NOT(kinds @> ARRAY['seat','ticket']) THEN
   RAISE EXCEPTION 'expected a funded chair and a reusable ticket';
 END IF;
END;
$read$;
