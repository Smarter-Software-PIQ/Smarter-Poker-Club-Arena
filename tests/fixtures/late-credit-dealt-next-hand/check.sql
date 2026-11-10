DO $c$
DECLARE v jsonb; t uuid:='adadadad-0000-0000-0000-000000000009'; a jsonb;
BEGIN
 v:=public.fn_union_pnl_prove_late_seat_credit(t,2000082);
 a:=public.fn_union_pnl_prove_late_seat_credit('aaaaaaaa-0000-0000-0000-000000000001',2000002);
 IF current_setting('ca.phase')='before' THEN
  -- The preimage takes the dropped number as the next dealt hand and refuses.
  IF v->>'status' IS DISTINCT FROM 'refused' OR v->>'reason' IS DISTINCT FROM 'next_hand_does_not_carry_the_late_credit' THEN
   RAISE EXCEPTION 'before: expected the dropped number to be misread, got %',v; END IF;
  RAISE NOTICE 'PASS before: the preimage reads the dropped manifest as the next dealt hand (%)',v->>'reason';
 ELSE
  IF v->>'status' IS DISTINCT FROM 'proven'
   OR (v->'participants'->0->'carried_into'->>'hand_number')::bigint IS DISTINCT FROM 2000084 THEN
   RAISE EXCEPTION 'after: expected proof carried into the dealt hand 2000084, got %',v; END IF;
  RAISE NOTICE 'PASS after: the dropped number is skipped; carried into dealt hand %',v->'participants'->0->'carried_into'->>'hand_number';
 END IF;
 -- Scenario A (no receipt on its next hand in this fixture) is unchanged in the preimage
 -- and, in the postimage, has no accepted next hand, so it falls to the seat-exit rule.
 RAISE NOTICE 'scenario A %: %',current_setting('ca.phase'),a->>'status';
END $c$;
