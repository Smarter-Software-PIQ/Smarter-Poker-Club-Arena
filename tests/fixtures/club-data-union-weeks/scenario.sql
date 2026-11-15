-- Assertions for 20261114235606 (and, after the marker, 20261114235607).
DO $test$
DECLARE
  k constant uuid := 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
  f constant uuid := 'a0000000-0000-0000-0000-000000000001';
  d constant uuid := '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3';
  s constant uuid := '946747c6-b991-4220-b0cb-effbea46ecd2';
  u constant uuid := 'fade0000-0000-0000-0000-000000000001';
  r jsonb; r2 jsonb;
BEGIN
  -- THE 02:00 DAY, ACROSS BOTH CLOCK CHANGES.
  -- Fall back, Sunday 2026-11-01: 01:30 happens twice and both belong to Oct 31.
  ASSERT public.fn_ca_accounting_day('2026-11-01 06:30+00') = date '2026-10-31', 'fall back 01:30 CDT';
  ASSERT public.fn_ca_accounting_day('2026-11-01 07:30+00') = date '2026-10-31', 'fall back 01:30 CST';
  ASSERT public.fn_ca_accounting_day('2026-11-01 07:59:59.999999+00') = date '2026-10-31', 'fall back last instant';
  ASSERT public.fn_ca_accounting_day('2026-11-01 08:00+00') = date '2026-11-01', 'fall back 02:00 CST';
  ASSERT public.fn_ca_accounting_day_start('2026-11-01') = '2026-11-01 08:00+00', 'fall back day start';
  ASSERT public.fn_ca_accounting_day_start('2026-11-01') - public.fn_ca_accounting_day_start('2026-10-31') = interval '25 hours', 'fall back day is 25 hours';
  -- Spring forward, Sunday 2026-03-08: 02:00 does not exist; the day starts at 03:00 CDT.
  ASSERT public.fn_ca_accounting_day('2026-03-08 07:59:59+00') = date '2026-03-07', 'spring 01:59 CST';
  ASSERT public.fn_ca_accounting_day('2026-03-08 08:00+00') = date '2026-03-08', 'spring 03:00 CDT';
  ASSERT public.fn_ca_accounting_day_start('2026-03-08') = '2026-03-08 08:00+00', 'spring day start';
  ASSERT public.fn_ca_accounting_day_start('2026-03-09') - public.fn_ca_accounting_day_start('2026-03-08') = interval '23 hours', 'spring day is 23 hours';
  -- Ordinary days: summer 07:00Z, winter 08:00Z; midnight to 02:00 is still yesterday.
  ASSERT public.fn_ca_accounting_day_start('2026-07-15') = '2026-07-15 07:00+00', 'summer day start';
  ASSERT public.fn_ca_accounting_day('2026-11-09 06:30+00') = date '2026-11-08', '00:30 Chicago is the previous accounting day';
  -- The Monday boundary IS the invoice boundary, on the DST weeks too.
  ASSERT public.fn_ca_accounting_day_start('2026-11-02') = public.fn_union_week_start('2026-11-02 08:00+00'), 'Nov 2 week start';
  ASSERT public.fn_ca_accounting_day_start('2026-11-02') = '2026-11-02 08:00+00', 'Nov 2 02:00 CST';
  ASSERT public.fn_ca_accounting_day_start('2026-10-26') = public.fn_union_week_start('2026-10-27 12:00+00'), 'Oct 26 week start';
  ASSERT public.fn_ca_accounting_day_start('2026-03-09') = public.fn_union_week_start('2026-03-10 12:00+00'), 'Mar 9 week start';

  -- THE INVOICE WEEK, 1:1. Nov 2 to Nov 9 is the week, not eight days.
  r := public.ca_club_data_union_weeks(k, '2026-11-02', '2026-11-09');
  ASSERT (r->>'window_start')::timestamptz = '2026-11-02 08:00+00' AND (r->>'window_end')::timestamptz = '2026-11-09 08:00+00', 'window is 02:00 to 02:00';
  ASSERT (r->>'covers_window')::boolean AND r->'open_from' = 'null'::jsonb AND (r->>'week_count')::int = 1, 'Kings week covers the window';
  ASSERT (r->>'fee')::numeric = 25854.24 AND (r->>'player_net_loss')::numeric = 37160.83, 'Kings equals its invoice';
  ASSERT r->'cash_net_loss' = 'null'::jsonb AND r->'tournament_net_loss' = 'null'::jsonb, 'no split is stated when the document has none';
  ASSERT r#>>'{weeks,0,invoices,0,invoice_number}' = 'MU-1' AND r->>'reporting_scope' = 'club', 'the invoice is named';
  r := public.ca_club_data_union_weeks(f, '2026-11-02', '2026-11-09');
  ASSERT (r->>'fee')::numeric = 455510.12 AND (r->>'player_net_loss')::numeric = 473091.31 AND (r->>'covers_window')::boolean, 'Felt equals its invoice';
  r := public.ca_club_data_union_weeks(d, '2026-11-02', '2026-11-09');
  ASSERT (r->>'fee')::numeric = 452206.43 AND (r->>'player_net_loss')::numeric = 562209.57 AND (r->>'covers_window')::boolean, 'Deep Stack equals its invoice';
  r := public.ca_club_data_union_weeks(s, '2026-11-02', '2026-11-09');
  ASSERT (r->>'fee')::numeric = 0 AND (r->>'player_net_loss')::numeric = 0 AND (r->>'covers_window')::boolean, 'Savage equals its invoice';
  -- The union reads every member's document and its own.
  r := public.ca_club_data_union_weeks(u, '2026-11-02', '2026-11-09');
  ASSERT (r->>'fee')::numeric = 25854.24 + 455510.12 + 452206.43
     AND (r->>'player_net_loss')::numeric = 37160.83 + 473091.31 + 562209.57 - 212.51
     AND jsonb_array_length(r#>'{weeks,0,invoices}') = 5 AND r->>'reporting_scope' = 'union', 'union equals its five invoices';

  -- The old reading of the same dates (through the end of Nov 9) is not a week.
  r := public.ca_club_data_union_weeks(k, '2026-11-02', '2026-11-10');
  ASSERT NOT (r->>'covers_window')::boolean AND (r->>'open_from')::timestamptz = '2026-11-09 08:00+00'
     AND (r->>'fee')::numeric = 25854.24, 'a ninth boundary is open time, never invoice time';
  -- A window that starts mid-week holds no whole invoice week.
  r := public.ca_club_data_union_weeks(k, '2026-11-03', '2026-11-09');
  ASSERT NOT (r->>'covers_window')::boolean AND (r->>'week_count')::int = 0 AND r->'fee' = 'null'::jsonb
     AND (r->>'open_from')::timestamptz = '2026-11-03 08:00+00', 'a partial week states no invoice figure';
  -- Two weeks end to end, across the clock change; the split is stated only when every document has it.
  r := public.ca_club_data_union_weeks(k, '2026-10-26', '2026-11-09');
  ASSERT (r->>'covers_window')::boolean AND (r->>'week_count')::int = 2
     AND (r->>'window_start')::timestamptz = '2026-10-26 07:00+00'
     AND (r->>'fee')::numeric = 26854.34 AND (r->>'player_net_loss')::numeric = 37410.88
     AND r->'cash_net_loss' = 'null'::jsonb, 'two invoice weeks add up';
  r := public.ca_club_data_union_weeks(k, '2026-10-26', '2026-11-02');
  ASSERT (r->>'cash_net_loss')::numeric = 200.03 AND (r->>'tournament_net_loss')::numeric = 50.02
     AND (r->>'player_net_loss')::numeric = 250.05 AND (r->>'rakeback_credit')::numeric = 900.09, 'the recorded split is quoted';
  -- A cancelled document is not an invoice week.
  r := public.ca_club_data_union_weeks(k, '2026-10-19', '2026-10-26');
  ASSERT (r->>'week_count')::int = 0 AND NOT (r->>'covers_window')::boolean, 'cancelled invoice ignored';
  -- A club in no union has no invoice week and says so.
  r := public.ca_club_data_union_weeks('5ca1ab1e-0000-0000-0000-000000000001', '2026-11-02', '2026-11-09');
  ASSERT r->'union_id' = 'null'::jsonb AND NOT (r->>'covers_window')::boolean AND r->'fee' = 'null'::jsonb, 'standalone club';

  -- ATTRIBUTION IS THE DOCUMENT'S. Moving a horse today moves nothing here.
  r := public.ca_club_data_union_weeks(u, '2026-11-02', '2026-11-09') - 'generated_at';
  UPDATE public.ca_horse_club_assignments SET club_id = k;
  r2 := public.ca_club_data_union_weeks(u, '2026-11-02', '2026-11-09') - 'generated_at';
  ASSERT r = r2, 'current horse assignment never re-attributes an invoice week';

  -- Refusals.
  BEGIN PERFORM public.ca_club_data_union_weeks(k, '2026-11-09', '2026-11-09'); RAISE EXCEPTION 'empty window accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.ca_club_data_union_weeks(k, '2026-01-01', '2026-11-09'); RAISE EXCEPTION 'oversized window accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  PERFORM set_config('test.can_view', 'off', true);
  BEGIN PERFORM public.ca_club_data_union_weeks(k, '2026-11-02', '2026-11-09'); RAISE EXCEPTION 'unauthorized viewer answered';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
  PERFORM set_config('test.can_view', 'on', true);

  -- THE RECORDED RENAME: the old slug still names The Felt Society.
  ASSERT public.ca_club_id_for_slug('club-jaqk') = f, 'club-jaqk resolves to The Felt Society';
  ASSERT public.ca_club_id_for_slug('the-felt-society') = f, 'the current slug resolves';
  ASSERT public.ca_club_id_for_slug('no-such-club') IS NULL, 'an unknown slug resolves to nothing';
  RAISE NOTICE 'UNION INVOICE WEEK SCENARIO PASSED';
END $test$;
-- @@ AFTER THE RENAME TRIGGER @@
DO $test$
DECLARE
  k constant uuid := 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
  f constant uuid := 'a0000000-0000-0000-0000-000000000001';
  msg text;
BEGIN
  -- A rename files the old slug in the same statement.
  UPDATE public.clubs SET slug = 'kings-club' WHERE id = k;
  ASSERT public.ca_club_id_for_slug('kings-club-1') = k AND public.ca_club_id_for_slug('kings-club') = k, 'renamed club keeps its old slug';
  -- Renaming back: the live slug is never also history.
  UPDATE public.clubs SET slug = 'kings-club-1' WHERE id = k;
  ASSERT NOT EXISTS (SELECT 1 FROM public.club_slug_history WHERE former_slug = 'kings-club-1'), 'a held slug is not history';
  ASSERT public.ca_club_id_for_slug('kings-club') = k, 'the interim slug still resolves';
  -- Another club can never take a slug that still opens a renamed club.
  BEGIN
    UPDATE public.clubs SET slug = 'club-jaqk' WHERE id = '5ca1ab1e-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'another club took a former slug';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    ASSERT msg LIKE 'club slug "club-jaqk" is a former slug of another club (a0000000-0000-0000-0000-000000000001)%', msg;
  END;
  ASSERT public.ca_club_id_for_slug('club-jaqk') = f, 'the old link still opens The Felt Society';
  ASSERT (SELECT slug FROM public.clubs WHERE id = '5ca1ab1e-0000-0000-0000-000000000001') = 'standalone', 'the refused club keeps its slug';
  -- Nor can a new club.
  BEGIN
    INSERT INTO public.clubs VALUES ('5ca1ab1e-0000-0000-0000-000000000002', 'Newcomer', 'kings-club');
    RAISE EXCEPTION 'a new club took a former slug';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  ASSERT NOT EXISTS (SELECT 1 FROM public.clubs WHERE id = '5ca1ab1e-0000-0000-0000-000000000002'), 'the new club was refused';
  INSERT INTO public.clubs VALUES ('5ca1ab1e-0000-0000-0000-000000000002', 'Newcomer', 'newcomer');
  -- A club taking back its own former slug is allowed and drops that history row.
  UPDATE public.clubs SET slug = 'kings-club' WHERE id = k;
  ASSERT NOT EXISTS (SELECT 1 FROM public.club_slug_history WHERE former_slug = 'kings-club'), 'a retaken slug is not history';
  ASSERT public.ca_club_id_for_slug('kings-club') = k AND public.ca_club_id_for_slug('kings-club-1') = k, 'both slugs open the club';
  -- An update that does not change the slug records nothing and is not refused.
  UPDATE public.clubs SET name = name WHERE id = f;
  UPDATE public.clubs SET slug = slug WHERE id = f;
  ASSERT (SELECT count(*) FROM public.club_slug_history) = 2, 'only real renames are recorded';
  RAISE NOTICE 'CLUB SLUG HISTORY SCENARIO PASSED';
END $test$;
