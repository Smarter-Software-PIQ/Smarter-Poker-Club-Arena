DO $test$
DECLARE r jsonb;s jsonb;g text; f text; total numeric; mtt numeric; fee numeric;
BEGIN
  FOREACH g IN ARRAY ARRAY['ALL','HOLDEM','OMAHA','MTT','SNG'] LOOP
    r:=ca_club_data_player_totals('a41434bb-8d0c-400a-8f0d-e8b3d65afed4','2026-11-05','2026-11-05',g);
    s:=ca_club_data_screen('a41434bb-8d0c-400a-8f0d-e8b3d65afed4','2026-11-05','2026-11-05',g)->'summary';
    SELECT coalesce(sum((p->>'total_winnings')::numeric),0),coalesce(sum((p->>'mtt_winnings')::numeric),0),coalesce(sum((p->>'fee')::numeric),0)
      INTO total,mtt,fee FROM jsonb_array_elements(r->'players') p;
    IF round(total,2)<>(s->>'total_winnings')::numeric OR round(mtt,2)<>(s->>'mtt_winnings')::numeric OR round(fee,2)<>(s->>'fee')::numeric THEN RAISE EXCEPTION 'summary mismatch %: % / %',g,r,s; END IF;
    IF g='ALL' AND (total<>60 OR mtt<>50 OR fee<>15.079 OR jsonb_array_length(r->'players')<>3) THEN RAISE EXCEPTION 'wrong complete totals %',r; END IF;
  END LOOP;
  r:=ca_club_data_player_totals('a41434bb-8d0c-400a-8f0d-e8b3d65afed4','2026-11-05','2026-11-05','ALL','ALL','Finished');
  SELECT sum((p->>'total_winnings')::numeric) INTO total FROM jsonb_array_elements(r->'players') p;
  IF total<>50 THEN RAISE EXCEPTION 'search not respected'; END IF;
  r:=ca_club_data_player_totals('a41434bb-8d0c-400a-8f0d-e8b3d65afed4','2026-11-04','2026-11-04');
  IF jsonb_array_length(r->'players')<>0 THEN RAISE EXCEPTION 'empty date not empty'; END IF;
  BEGIN
    PERFORM ca_club_data_player_totals('a41434bb-8d0c-400a-8f0d-e8b3d65afed4','2026-01-01','2026-11-05');
    RAISE EXCEPTION 'invalid range accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $test$;
SET SESSION AUTHORIZATION authenticated;
SET test.uid='10000000-0000-0000-0000-000000000003';
DO $test$
DECLARE r jsonb;
BEGIN
 r:=ca_club_data_player_totals('a41434bb-8d0c-400a-8f0d-e8b3d65afed4','2026-11-05','2026-11-05');
 IF r->>'scope'<>'downline' OR jsonb_array_length(r->'players')<>1 OR r->'players'->0->>'name'<>'Bob' THEN RAISE EXCEPTION 'downline leaked %',r; END IF;
END $test$;
RESET SESSION AUTHORIZATION;
