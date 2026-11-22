\set ON_ERROR_STOP on
-- Run after the switch-off migration. Every T-number raises on failure.
SELECT public.proof_snapshot('after');

-- T1 + T2: a game that never ran Lightning, and the Classic rolling 30/10
-- floor, give byte-identical answers: window start, verdict, status, the
-- boundary's evictions and the warnings it opens.
DO $$
DECLARE n_diff int; n_rows int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE a.v IS DISTINCT FROM b.v)
    INTO n_rows, n_diff
    FROM public.proof_baseline b
    JOIN public.proof_baseline a ON a.k = 'after' || substr(b.k, 7)
   WHERE b.k LIKE 'before|%' AND (b.k LIKE '%|ee1%' OR b.k LIKE '%|ec1%');
  IF n_rows < 12 THEN RAISE EXCEPTION 'T1 compared only % answers', n_rows; END IF;
  IF n_diff > 0 THEN RAISE EXCEPTION 'T1 % answers changed on a game with no Lightning history', n_diff; END IF;
  IF public.proof_evictions('after', 'ee100000-0000-0000-0000-00000000000a') <> 1 THEN
    RAISE EXCEPTION 'T1b the never-Lightning game no longer stands up its 2/30 player'; END IF;
  RAISE NOTICE 'T1 PASS  % answers of a never-Lightning game and a Classic rolling 30/10 game are byte-identical', n_rows;
END $$;

DO $$
DECLARE v text;
BEGIN
  SELECT a.v INTO v FROM public.proof_baseline a WHERE a.k = 'after|warnings|ec100000-0000-0000-0000-00000000000c';
  IF v NOT LIKE '%ecb00000-0000-0000-0000-00000000000c%' OR v LIKE '%eca00000-0000-0000-0000-00000000000c%' THEN
    RAISE EXCEPTION 'T2 Classic rolling 30/10 no longer warns exactly its under-floor player: %', v; END IF;
  IF public.proof_evictions('after', 'ec100000-0000-0000-0000-00000000000c') <> 0 THEN
    RAISE EXCEPTION 'T2b Classic rolling 30/10 booted on a first lapse'; END IF;
  RAISE NOTICE 'T2 PASS  Classic rolling 30/10 still warns its under-floor player and boots nobody on a first lapse';
END $$;

-- T3: THE 2026-11-21 08:47:56 SHAPE. 200 pool hands at 20%, the game leaves
-- Lightning: nothing is judged at the switch-off, no warning is opened, and
-- the window starts at the switch-off.
DO $$
DECLARE c record; u uuid; vj jsonb; s record;
BEGIN
  SELECT * INTO c FROM public.proof_clock;
  IF public.proof_evictions('after', 'e1100000-0000-0000-0000-000000000001') <> 0 THEN
    RAISE EXCEPTION 'T3a the switch-off still stands up % pool seats',
      public.proof_evictions('after', 'e1100000-0000-0000-0000-000000000001'); END IF;
  IF EXISTS (SELECT 1 FROM public.proof_baseline WHERE proof_baseline.k = 'after|warnings|e1100000-0000-0000-0000-000000000001' AND proof_baseline.v <> '[]') THEN
    RAISE EXCEPTION 'T3b the switch-off opened a warning on the pool sitting'; END IF;
  FOREACH u IN ARRAY ARRAY['e1a00000-0000-0000-0000-000000000001','e1b00000-0000-0000-0000-000000000001']::uuid[] LOOP
    IF public.fn_nit_sitting_since('e1000000-0000-0000-0000-000000000001', u, NULL) <> c.off_at THEN
      RAISE EXCEPTION 'T3c the window of % starts at %, not the switch-off %', u,
        public.fn_nit_sitting_since('e1000000-0000-0000-0000-000000000001', u, NULL), c.off_at; END IF;
    vj := public.fn_nit_check('e1100000-0000-0000-0000-000000000001', u, NULL);
    IF vj->>'reason' <> 'within_limits' THEN RAISE EXCEPTION 'T3d verdict for %: %', u, vj; END IF;
  END LOOP;
  FOR s IN SELECT row_to_json(x)::jsonb j FROM public.fn_nit_status('e1100000-0000-0000-0000-000000000001') x LOOP
    IF coalesce((s.j->>'hands')::int, 0) <> 0 THEN RAISE EXCEPTION 'T3e status still shows the pool sample: %', s.j; END IF;
  END LOOP;
  RAISE NOTICE 'T3 PASS  200 pool hands at 20%% then switch-off: 0 seats stood up, no warning, window starts at the switch-off';
END $$;

-- T4: the same players then play ORDINARY hands below the floor: judged on
-- those hands only, under the table's own rule (25%%, ten hands, no grace).
-- Nine hands cannot be judged; the tenth is. A pair at 30%% after the
-- switch-off is not stood up, though its whole sitting is 20.5%%.
DO $$
DECLARE c record; r record; n int := 0;
BEGIN
  SELECT * INTO c FROM public.proof_clock;
  PERFORM public.proof_hands(u, 'e1100000-0000-0000-0000-000000000001', 9, 0, c.off_at, interval '10 seconds')
     FROM unnest(ARRAY['e1a00000-0000-0000-0000-000000000001','e1b00000-0000-0000-0000-000000000001']::uuid[]) u;
  PERFORM public.proof_hands(u, 'e1100000-0000-0000-0000-000000000001', 10, 3, c.off_at, interval '10 seconds')
     FROM unnest(ARRAY['e1a00000-0000-0000-0000-000000000003','e1b00000-0000-0000-0000-000000000003']::uuid[]) u;
  IF EXISTS (SELECT 1 FROM public.fn_nit_enforce('e1100000-0000-0000-0000-000000000001')) THEN
    RAISE EXCEPTION 'T4a a seat was stood up on nine post-switch-off hands, or on a 30%% sample'; END IF;
  PERFORM public.proof_hands(u, 'e1100000-0000-0000-0000-000000000001', 1, 1, c.off_at + interval '95 seconds', interval '1 second')
     FROM unnest(ARRAY['e1a00000-0000-0000-0000-000000000001','e1b00000-0000-0000-0000-000000000001']::uuid[]) u;
  FOR r IN SELECT * FROM public.fn_nit_enforce('e1100000-0000-0000-0000-000000000001') ORDER BY user_id LOOP
    n := n + 1;
    IF r.user_id::text NOT LIKE 'e1_00000-0000-0000-0000-000000000001' THEN
      RAISE EXCEPTION 'T4b the 30%% pair was stood up: %', r; END IF;
    IF r.hands <> 10 OR r.vpip <> 10.0 OR r.required <> 25 OR r.warned THEN
      RAISE EXCEPTION 'T4c judged on the wrong sample: %', r; END IF;
  END LOOP;
  IF n <> 2 THEN RAISE EXCEPTION 'T4d % seats stood up on ten post-switch-off hands at 10%%, expected 2', n; END IF;
  RAISE NOTICE 'T4 PASS  after the switch-off: 9 hands unjudged, 10 hands at 10%% judged (hands=10, vpip=10.0), 30%% kept';
END $$;

-- T5: the same on a table rule with a warning and ten hands of grace: the
-- first lapse warns and costs no seat; the seat goes only when the grace is
-- spent on post-switch-off hands.
DO $$
DECLARE c record; n int;
BEGIN
  SELECT * INTO c FROM public.proof_clock;
  IF public.proof_evictions('after', 'e2100000-0000-0000-0000-000000000002') <> 0 THEN
    RAISE EXCEPTION 'T5a the graced switch-off stood up a seat'; END IF;
  PERFORM public.proof_hands(u, 'e2100000-0000-0000-0000-000000000002', 10, 1, c.off_at, interval '10 seconds')
     FROM unnest(ARRAY['e2a00000-0000-0000-0000-000000000002','e2b00000-0000-0000-0000-000000000002']::uuid[]) u;
  SELECT count(*) INTO n FROM public.fn_nit_enforce('e2100000-0000-0000-0000-000000000002');
  IF n <> 0 THEN RAISE EXCEPTION 'T5b a first lapse stood up % seats', n; END IF;
  SELECT count(*) INTO n FROM public.ca_nit_warnings
   WHERE table_id = 'e2100000-0000-0000-0000-000000000002' AND cleared_at IS NULL
     AND hands_at_warn = 10 AND vpip_at_warn = 10.0 AND sitting_since = c.off_at;
  IF n <> 2 THEN RAISE EXCEPTION 'T5c expected 2 warnings on the post-switch-off sample, found %', n; END IF;
  PERFORM public.proof_hands(u, 'e2100000-0000-0000-0000-000000000002', 9, 0, now() + interval '1 second', interval '1 second')
     FROM unnest(ARRAY['e2a00000-0000-0000-0000-000000000002','e2b00000-0000-0000-0000-000000000002']::uuid[]) u;
  SELECT count(*) INTO n FROM public.fn_nit_enforce('e2100000-0000-0000-0000-000000000002');
  IF n <> 0 THEN RAISE EXCEPTION 'T5d stood up inside the grace (% seats)', n; END IF;
  PERFORM public.proof_hands(u, 'e2100000-0000-0000-0000-000000000002', 1, 0, now() + interval '20 seconds', interval '1 second')
     FROM unnest(ARRAY['e2a00000-0000-0000-0000-000000000002','e2b00000-0000-0000-0000-000000000002']::uuid[]) u;
  SELECT count(*) INTO n FROM public.fn_nit_enforce('e2100000-0000-0000-0000-000000000002') WHERE warned;
  IF n <> 2 THEN RAISE EXCEPTION 'T5e grace spent, % seats stood up, expected 2', n; END IF;
  RAISE NOTICE 'T5 PASS  graced table: switch-off judges nothing, first post-switch-off lapse warns, grace expiry stands up';
END $$;

-- T6: a player who joins AFTER the switch-off: the window is their sitting,
-- exactly as before the change.
DO $$
DECLARE c record; n int;
BEGIN
  SELECT * INTO c FROM public.proof_clock;
  PERFORM public.proof_seat('e1c00000-0000-0000-0000-000000000001', false, 'e1000000-0000-0000-0000-000000000001',
                            'e1100000-0000-0000-0000-000000000001', c.off_at + interval '5 minutes');
  IF public.fn_nit_sitting_since('e1000000-0000-0000-0000-000000000001', 'e1c00000-0000-0000-0000-000000000001', NULL)
     <> c.off_at + interval '5 minutes' THEN RAISE EXCEPTION 'T6a a later joiner''s window moved'; END IF;
  PERFORM public.proof_hands('e1c00000-0000-0000-0000-000000000001', 'e1100000-0000-0000-0000-000000000001', 10, 0,
                             c.off_at + interval '5 minutes', interval '5 seconds');
  SELECT count(*) INTO n FROM public.fn_nit_enforce('e1100000-0000-0000-0000-000000000001')
   WHERE user_id = 'e1c00000-0000-0000-0000-000000000001';
  IF n <> 1 THEN RAISE EXCEPTION 'T6b a later joiner at 0/10 was not stood up'; END IF;
  RAISE NOTICE 'T6 PASS  a player who joins after the switch-off is judged on their own sitting, unchanged';
END $$;

-- T7: Lightning on, off, ordinary hands, on again, off again: the window
-- starts at the LATEST switch-off; nothing before it is judged.
DO $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM public.proof_clock;
  IF public.fn_nit_sitting_since('e3000000-0000-0000-0000-000000000003', 'e3a00000-0000-0000-0000-000000000003', NULL) <> c.off_at THEN
    RAISE EXCEPTION 'T7a the window does not start at the latest switch-off'; END IF;
  IF public.proof_evictions('after', 'e3100000-0000-0000-0000-000000000003') <> 0 THEN
    RAISE EXCEPTION 'T7b the second switch-off stood up a seat'; END IF;
  RAISE NOTICE 'T7 PASS  on/off/on/off: the window starts at the latest switch-off, 0 seats stood up';
END $$;

-- T8: a switch-off still pending (the drain): the window is empty. T9: an
-- aborted switch-off (Lightning stays on) moves nothing.
DO $$
DECLARE v timestamptz; c record;
BEGIN
  SELECT * INTO c FROM public.proof_clock;
  v := public.fn_nit_sitting_since('e4000000-0000-0000-0000-000000000004', 'e4a00000-0000-0000-0000-000000000004', NULL);
  IF v < now() - interval '1 second' THEN RAISE EXCEPTION 'T8 a pending switch-off left the window at %', v; END IF;
  IF public.fn_nit_check('e4100000-0000-0000-0000-000000000004', 'e4a00000-0000-0000-0000-000000000004', NULL)->>'reason' <> 'within_limits' THEN
    RAISE EXCEPTION 'T8b a pending switch-off judged the pool'; END IF;
  v := public.fn_nit_sitting_since('e5000000-0000-0000-0000-000000000005', 'e5a00000-0000-0000-0000-000000000005', NULL);
  IF v <> c.base - interval '2 hours' THEN RAISE EXCEPTION 'T9 an aborted switch-off moved the window to %', v; END IF;
  RAISE NOTICE 'T8 PASS  a pending switch-off judges nothing';
  RAISE NOTICE 'T9 PASS  an aborted switch-off moves nothing';
END $$;

-- T10: a warning opened on ordinary hands BEFORE Lightning, whose grace count
-- pool hands then passed: the switch-off clears it as recovered and stands
-- nobody up. Pool hands neither spend a grace nor finish one.
DO $$
DECLARE v text;
BEGIN
  IF public.proof_evictions('after', 'e6100000-0000-0000-0000-000000000006') <> 0 THEN
    RAISE EXCEPTION 'T10a grace spent in the pool stood up a seat at the switch-off'; END IF;
  SELECT a.v INTO v FROM public.proof_baseline a WHERE a.k = 'after|warnings|e6100000-0000-0000-0000-000000000006';
  IF v NOT LIKE '%"open" : false, "reason" : "recovered"%"open" : false, "reason" : "recovered"%' THEN
    RAISE EXCEPTION 'T10b the pre-Lightning warnings were not cleared as recovered: %', v; END IF;
  RAISE NOTICE 'T10 PASS  a warning from before the pool is cleared at the switch-off, not executed by pool hands';
END $$;

-- T11: the anchor_seat_left shape. Left the pool, the game switched off,
-- sat back down inside the re-entry window: the sitting continues, its
-- window starts at the switch-off, nobody is stood up on the pool sitting.
DO $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM public.proof_clock;
  IF public.fn_nit_sitting_since('e7000000-0000-0000-0000-000000000007', 'e7a00000-0000-0000-0000-000000000007', NULL) <> c.off_at THEN
    RAISE EXCEPTION 'T11a the rejoined sitting does not start at the switch-off'; END IF;
  IF public.proof_evictions('after', 'e7100000-0000-0000-0000-000000000007') <> 0 THEN
    RAISE EXCEPTION 'T11b a rejoin after the switch-off stood up a seat on the pool sitting'; END IF;
  RAISE NOTICE 'T11 PASS  a rejoin after the switch-off is not stood up on the pool sitting';
END $$;

-- T12: PEOPLE AND HORSES ARE ONE RULE. Every answer for the Horse of each
-- pair equals the answer for the person, on every Lightning fixture.
DO $$
DECLARE n int; m int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE h.v IS DISTINCT FROM p.v) INTO n, m
    FROM public.proof_baseline h
    JOIN public.proof_baseline p
      ON split_part(p.k, '|', 1) = split_part(h.k, '|', 1)
     AND split_part(p.k, '|', 2) = split_part(h.k, '|', 2)
     AND split_part(p.k, '|', 3) = split_part(h.k, '|', 3)
     AND split_part(p.k, '|', 4) = overlay(split_part(h.k, '|', 4) placing 'b' from 3 for 1)
   WHERE split_part(h.k, '|', 1) = 'after'
     AND split_part(h.k, '|', 2) IN ('since', 'check')
     AND split_part(h.k, '|', 4) ~ '^e[1-7]a';
  IF n < 10 THEN RAISE EXCEPTION 'T12 compared only % Horse/person pairs', n; END IF;
  IF m > 0 THEN RAISE EXCEPTION 'T12 % answers differ between a Horse and a person', m; END IF;
  RAISE NOTICE 'T12 PASS  % Horse/person answer pairs are identical', n;
END $$;
