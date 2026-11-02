DO $$
DECLARE page jsonb; cursor_token jsonb; item jsonb; n int := 0; expected numeric;
BEGIN
 LOOP
  page := public.ca_club_members_page('00000000-0000-0000-0000-000000000001','','all','name',cursor_token,20);
  FOR item IN SELECT * FROM jsonb_array_elements(page->'items') LOOP
   IF NOT item ? 'effective_rakeback_rate' THEN RAISE EXCEPTION 'Rakeback missing from directory'; END IF;
   IF NOT (item->>'can_view_financials')::boolean THEN
    IF item->'effective_rakeback_rate' <> 'null'::jsonb THEN RAISE EXCEPTION 'Private rate leaked'; END IF;
   ELSE
    expected := public.fn_player_rakeback_rate((item->>'user_id')::uuid,(item->>'management_club_id')::uuid);
    IF (item->>'effective_rakeback_rate')::numeric IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Wrong effective rate'; END IF;
   END IF;
   n := n+1;
  END LOOP;
  EXIT WHEN NOT (page->>'has_more')::boolean;
  cursor_token := page->'next_cursor';
 END LOOP;
 IF n<>45 THEN RAISE EXCEPTION 'Pagination changed: %',n; END IF;
END $$;
