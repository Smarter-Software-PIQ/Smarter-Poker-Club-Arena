\set ON_ERROR_STOP on
-- T17: THE ELIGIBLE GAME IS LIVE, AND ITS TABLE IS JUDGING. Activation ran
-- inside the migration; this reads what it left behind.
DO $$
DECLARE s jsonb; t record; led record;
BEGIN
  SELECT ruleset_snapshot INTO s FROM public.cash_games WHERE id='bbbb0000-0000-0000-0000-000000000001';
  IF (s->>'vpip_floor')::int <> 20 THEN RAISE EXCEPTION 'T17a floor is %', s->>'vpip_floor'; END IF;
  IF (s->>'vpip_window')::int <> 30 THEN RAISE EXCEPTION 'T17b window is %', s->>'vpip_window'; END IF;
  IF (s->>'vpip_rolling')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'T17c not rolling'; END IF;
  IF (s->>'vpip_grace_hands')::int <> 10 THEN RAISE EXCEPTION 'T17d grace is %', s->>'vpip_grace_hands'; END IF;
  IF (s->>'vpip_floor_since') IS NULL THEN RAISE EXCEPTION 'T17e no floor_since'; END IF;
  SELECT nit_game, maintain_percent_min, maintain_hands INTO t
    FROM public.tables WHERE id='cccc0000-0000-0000-0000-000000000001';
  IF NOT (t.nit_game AND t.maintain_percent_min=20 AND t.maintain_hands=30) THEN
    RAISE EXCEPTION 'T17f the table is not judging: %', t; END IF;
  SELECT * INTO led FROM public.ca_classic_vpip_activations
   WHERE game_id='bbbb0000-0000-0000-0000-000000000001';
  IF led.id IS NULL THEN RAISE EXCEPTION 'T17g no audit row for the activated game'; END IF;
  IF led.floor_percent <> 20 OR led.grace_hands <> 10 OR led.tables_updated < 1 THEN
    RAISE EXCEPTION 'T17h the audit row disagrees with what was applied: %', led; END IF;
  RAISE NOTICE 'T17 PASS  the eligible game is floored, its table judges, and it is audited';
END $$;

-- T18: NOTHING ELSE WAS TOUCHED.
DO $$
DECLARE s jsonb; t record; n int;
BEGIN
  -- Below 0.50/1.00.
  SELECT ruleset_snapshot INTO s FROM public.cash_games WHERE id='bbbb0000-0000-0000-0000-000000000002';
  IF (s ? 'vpip_rolling') OR coalesce((s->>'vpip_floor')::int,0) <> 0 THEN
    RAISE EXCEPTION 'T18a the 0.25/0.50 game was floored: %', s; END IF;
  SELECT nit_game, maintain_percent_min INTO t FROM public.tables WHERE id='cccc0000-0000-0000-0000-000000000002';
  IF t.nit_game OR t.maintain_percent_min <> 0 THEN RAISE EXCEPTION 'T18b its table is judging'; END IF;

  -- Madness keeps its own floor, its ten-hand window and no grace.
  SELECT ruleset_snapshot INTO s FROM public.cash_games WHERE id='bbbb0000-0000-0000-0000-000000000003';
  IF (s ? 'vpip_rolling') THEN RAISE EXCEPTION 'T18c Madness went rolling'; END IF;
  IF (s->>'vpip_floor')::int <> 40 THEN RAISE EXCEPTION 'T18d Madness floor is %', s->>'vpip_floor'; END IF;
  IF (s->>'vpip_window')::int <> 10 THEN RAISE EXCEPTION 'T18e Madness window is %', s->>'vpip_window'; END IF;
  SELECT maintain_hands INTO t FROM public.tables WHERE id='cccc0000-0000-0000-0000-000000000003';
  IF t.maintain_hands <> 10 THEN RAISE EXCEPTION 'T18f Madness table window is %', t.maintain_hands; END IF;

  -- A RETIRED CLUB'S RECORDS STAY READ-ONLY. Its game may already carry a
  -- floor in its snapshot, written by the creating trigger while the club was
  -- still active - that is history, not activation. What activation controls is
  -- whether it WROTE to the club: it must not have touched the game's tables,
  -- because fn_guard_retired_club_mutation would refuse the write and a retired
  -- club's records are read-only.
  SELECT nit_game, maintain_percent_min INTO t
    FROM public.tables WHERE id='cccc0000-0000-0000-0000-000000000004';
  IF t.nit_game OR t.maintain_percent_min <> 0 THEN
    RAISE EXCEPTION 'T18g a retired club''s table was floored by activation: %', t; END IF;
  SELECT count(*) INTO n FROM public.ca_classic_vpip_activations
   WHERE game_id IN ('bbbb0000-0000-0000-0000-000000000002',
                     'bbbb0000-0000-0000-0000-000000000003',
                     'bbbb0000-0000-0000-0000-000000000004');
  IF n <> 0 THEN RAISE EXCEPTION 'T18h % out-of-scope game(s) were audited as activated', n; END IF;
  RAISE NOTICE 'T18 PASS  sub-threshold, Madness and retired-club games are untouched';
END $$;

-- T19: ACTIVATION IS IDEMPOTENT. Running the maintained path again changes no
-- table, so a second pass is a no-op rather than churn on a live relation.
DO $$
DECLARE n int;
BEGIN
  n := public.fn_cash_apply_ruleset('bbbb0000-0000-0000-0000-000000000001');
  IF n <> 0 THEN RAISE EXCEPTION 'T19 a second apply changed % table row(s)', n; END IF;
  RAISE NOTICE 'T19 PASS  re-applying the ruleset changes nothing';
END $$;

-- T20: A GAME CREATED AFTER ACTIVATION INHERITS THE FLOOR, and so does a table
-- opened in it. This is the trigger plus the maintained path, not a backfill.
DO $$
DECLARE s jsonb; t record; n int;
BEGIN
  INSERT INTO public.cash_games (id, club_id, template_name, variant, sb, bb, ruleset_snapshot)
    VALUES ('bbbb0000-0000-0000-0000-000000000005','aaaa0000-0000-0000-0000-000000000001',
            'classic','plo4',0.5,1.0,'{}'::jsonb);
  SELECT ruleset_snapshot INTO s FROM public.cash_games WHERE id='bbbb0000-0000-0000-0000-000000000005';
  IF (s->>'vpip_floor')::int <> 30 THEN RAISE EXCEPTION 'T20a a new plo4 game got floor %', s->>'vpip_floor'; END IF;
  IF (s->>'vpip_window')::int <> 30 OR (s->>'vpip_grace_hands')::int <> 10 THEN
    RAISE EXCEPTION 'T20b a new game got window/grace %/%', s->>'vpip_window', s->>'vpip_grace_hands'; END IF;
  INSERT INTO public.tables (id, cluster_id, club_id, name, game_variant, big_blind, status,
                             nit_game, maintain_percent_min, maintain_hands)
    VALUES ('cccc0000-0000-0000-0000-000000000005','bbbb0000-0000-0000-0000-000000000005',
            'aaaa0000-0000-0000-0000-000000000001','PLO4 0.50/1 Classic New','plo4',1.0,'running',false,0,10);
  n := public.fn_cash_apply_ruleset('bbbb0000-0000-0000-0000-000000000005');
  SELECT nit_game, maintain_percent_min, maintain_hands INTO t
    FROM public.tables WHERE id='cccc0000-0000-0000-0000-000000000005';
  IF NOT (t.nit_game AND t.maintain_percent_min=30 AND t.maintain_hands=30) THEN
    RAISE EXCEPTION 'T20c a table opened after activation is not judging: %', t; END IF;
  RAISE NOTICE 'T20 PASS  a game and table created after activation inherit the floor';
END $$;
