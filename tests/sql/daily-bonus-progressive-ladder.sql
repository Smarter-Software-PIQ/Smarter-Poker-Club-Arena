-- Isolated PostgreSQL qualification probe for the restructured progressive
-- non-repeating Daily Club Arena Bonus ladder (20261125075751).
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.diamond_reward_catalog
  (action_key, diamonds, max_per_day, counts_toward_daily_cap, lifetime, category, active)
VALUES ('daily_bonus', 0, 4, true, false, 'daily', true)
ON CONFLICT (action_key) DO NOTHING;

DO $$
DECLARE
  uid           uuid := gen_random_uuid();
  vip_uid       uuid := gen_random_uuid();
  today         date := (now() AT TIME ZONE 'America/Chicago')::date;
  previous      jsonb := '[]'::jsonb;
  picked        jsonb;
  again         jsonb;
  r             jsonb;
  replay        jsonb;
  day           integer;
  s             integer;
  before_count  integer;
  d_day1        integer;
  d_day3        integer;
  d_day7        integer;
  d_day9        integer;
  d_day11       integer;
  d_day14       integer;
  d_day16       integer;
  d_day18       integer;
  d_day21       integer;
  d_day23       integer;
  d_day25       integer;
  d_day28       integer;
  d_day30       integer;
  d_p_step2     integer;
  d_p_step4     integer;
  d_p_step7     integer;
  q_throw_w1    integer;
  q_throw_w2    integer;
  q_throw_w3    integer;
  q_throw_w4    integer;
  q_rh_w1       integer;
  q_rh_w2       integer;
  q_rh_w3       integer;
  q_rh_w4       integer;
  q_tb_w2       integer;
  q_tb_w3       integer;
  q_tb_w4       integer;
  free_dia_sum  integer;
  vip_dia_sum   integer;
BEGIN
  -- 1. Verify 100 consecutive streak days (Days 1..100):
  --    - Reproducible previews
  --    - Zero overlapping reward kinds between ANY two adjacent days (not just same slot!)
  --    - Single-claim diamond ceiling <= 125, free daily <= 110, VIP total <= 150
  --    - VIP tiles are strictly Diamonds (no nonsensical "VIP Time Bank" or "VIP Streak Shield")
  --    - Standard days are focused (1 non-VIP tile), milestone days add curated extras
  --    - Tenth days always carry slot 7 free_spin
  previous := '[]'::jsonb;
  FOR s IN 1..100 LOOP
    picked := public.fn_ca_daily_bonus_pick_tiles(uid, today + s, s, previous);
    again  := public.fn_ca_daily_bonus_pick_tiles(uid, today + s, s, previous);
    IF picked IS DISTINCT FROM again THEN
      RAISE EXCEPTION 'Preview is not reproducible on streak %', s;
    END IF;
    IF EXISTS (
      SELECT 1
        FROM jsonb_array_elements(picked) a
        JOIN jsonb_array_elements(previous) b ON a->>'kind' = b->>'kind'
    ) THEN
      RAISE EXCEPTION 'Adjacent streak day % repeated a reward kind: prev=%, cur=%', s, previous, picked;
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(picked) a WHERE (a->>'diamonds')::int > 125) THEN
      RAISE EXCEPTION 'Single claim ceiling exceeded on streak %: %', s, picked;
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(picked) a WHERE (a->>'vip_only')::boolean AND a->>'kind' <> 'diamonds') THEN
      RAISE EXCEPTION 'Nonsensical non-diamond VIP tile on streak %: %', s, picked;
    END IF;
    SELECT COALESCE(sum((a->>'diamonds')::int), 0) INTO free_dia_sum
      FROM jsonb_array_elements(picked) a WHERE a->>'kind' = 'diamonds' AND NOT (a->>'vip_only')::boolean;
    SELECT COALESCE(sum((a->>'diamonds')::int), 0) INTO vip_dia_sum
      FROM jsonb_array_elements(picked) a WHERE a->>'kind' = 'diamonds';
    IF free_dia_sum > 110 OR vip_dia_sum > 150 THEN
      RAISE EXCEPTION 'Daily cap exceeded on streak %: free=%, vip=%', s, free_dia_sum, vip_dia_sum;
    END IF;
    IF (s % 10 = 0) <> EXISTS (SELECT 1 FROM jsonb_array_elements(picked) a WHERE (a->>'slot')::int = 7 AND a->>'kind' = 'free_spin') THEN
      RAISE EXCEPTION 'Bonus spin milestone mismatch on streak %: %', s, picked;
    END IF;
    previous := picked;
  END LOOP;

  -- 2. Verify 400 calendar dates with realistic streak evolution: advancing +1
  --    each claimed day, resetting to Day 1 on missed days (including multiple
  --    consecutive Day 1 resets, and resets after diamond/chest/spin days).
  previous := '[]'::jsonb;
  s := 0;
  FOR day IN 1..400 LOOP
    IF day % 17 IN (0, 1, 2) OR day % 11 = 0 THEN
      s := 1;
    ELSE
      s := s + 1;
    END IF;
    picked := public.fn_ca_daily_bonus_pick_tiles(uid, today + day, s, previous);
    again  := public.fn_ca_daily_bonus_pick_tiles(uid, today + day, s, previous);
    IF picked IS DISTINCT FROM again THEN
      RAISE EXCEPTION 'Reset preview not reproducible on day %', day;
    END IF;
    IF EXISTS (
      SELECT 1
        FROM jsonb_array_elements(picked) a
        JOIN jsonb_array_elements(previous) b ON a->>'kind' = b->>'kind'
    ) THEN
      RAISE EXCEPTION 'Consecutive calendar day % (streak %) repeated a reward kind: prev=%, cur=%', day, s, previous, picked;
    END IF;
    previous := picked;
  END LOOP;

  -- 3. Verify strict progressive escalation across Weeks 1 -> 2 -> 3 -> 4 -> Day 30 -> Prestige
  SELECT (t->>'diamonds')::int INTO d_day1    FROM jsonb_array_elements(public.fn_ca_daily_bonus_pick_tiles(uid, today, 1, '[]')) t WHERE (t->>'slot')::int = 1;
  SELECT (t->>'diamonds')::int INTO d_day3    FROM jsonb_array_elements(public.fn_ca_daily_bonus_pick_tiles(uid, today, 3, '[]')) t WHERE (t->>'slot')::int = 1;
  SELECT (t->>'diamonds')::int INTO d_day7    FROM jsonb_array_elements(public.fn_ca_daily_bonus_pick_tiles(uid, today, 7, '[]')) t WHERE (t->>'slot')::int = 1;
  SELECT (t->>'diamonds')::int INTO d_day9    FROM jsonb_array_elements(public.fn_ca_daily_bonus_pick_tiles(uid, today, 9, '[]')) t WHERE (t->>'slot')::int = 1;
  SELECT (t->>'diamonds')::int INTO d_day11   FROM jsonb_array_elements(public.fn_ca_daily_bonus_pick_tiles(uid, today, 11, '[]')) t WHERE (t->>'slot')::int = 1;
  SELECT (t->>'diamonds')::int INTO d_day14   FROM jsonb_array_elements(public.fn_ca_daily_bonus_pick_tiles(uid, today, 14, '[]')) t WHERE (t->>'slot')::int = 1;
  SELECT (t->>'diamonds')::int INTO d_day16   FROM jsonb_array_elements(public.fn_ca_daily_bonus_pick_tiles(uid, today, 16, '[]')) t WHERE (t->>'slot')::int = 1;
  SELECT (t->>'diamonds')::int INTO d_day18   FROM jsonb_array_elements(public.fn_ca_daily_bonus_pick_tiles(uid, today, 18, '[]')) t WHERE (t->>'slot')::int = 1;
  SELECT (t->>'diamonds')::int INTO d_day21   FROM jsonb_array_elements(public.fn_ca_daily_bonus_pick_tiles(uid, today, 21, '[]')) t WHERE (t->>'slot')::int = 1;
  SELECT (t->>'diamonds')::int INTO d_day23   FROM jsonb_array_elements(public.fn_ca_daily_bonus_pick_tiles(uid, today, 23, '[]')) t WHERE (t->>'slot')::int = 1;
  SELECT (t->>'diamonds')::int INTO d_day25   FROM jsonb_array_elements(public.fn_ca_daily_bonus_pick_tiles(uid, today, 25, '[]')) t WHERE (t->>'slot')::int = 1;
  SELECT (t->>'diamonds')::int INTO d_day28   FROM jsonb_array_elements(public.fn_ca_daily_bonus_pick_tiles(uid, today, 28, '[]')) t WHERE (t->>'slot')::int = 1;
  SELECT (t->>'diamonds')::int INTO d_day30   FROM jsonb_array_elements(public.fn_ca_daily_bonus_pick_tiles(uid, today, 30, '[]')) t WHERE (t->>'slot')::int = 1;
  SELECT (t->>'diamonds')::int INTO d_p_step2 FROM jsonb_array_elements(public.fn_ca_daily_bonus_pick_tiles(uid, today, 32, '[]')) t WHERE (t->>'slot')::int = 1;
  SELECT (t->>'diamonds')::int INTO d_p_step4 FROM jsonb_array_elements(public.fn_ca_daily_bonus_pick_tiles(uid, today, 34, '[]')) t WHERE (t->>'slot')::int = 1;
  SELECT (t->>'diamonds')::int INTO d_p_step7 FROM jsonb_array_elements(public.fn_ca_daily_bonus_pick_tiles(uid, today, 37, '[]')) t WHERE (t->>'slot')::int = 1;

  IF NOT (d_day1 < d_day3 AND d_day3 < d_day7) THEN
    RAISE EXCEPTION 'Week 1 diamonds not progressive: %, %, %', d_day1, d_day3, d_day7;
  END IF;
  IF NOT (d_day1 < d_day9 AND d_day9 < d_day16 AND d_day16 < d_day23 AND d_day23 < d_p_step2) THEN
    RAISE EXCEPTION 'Early-week diamonds not progressive across weeks: %, %, %, %, %', d_day1, d_day9, d_day16, d_day23, d_p_step2;
  END IF;
  IF NOT (d_day3 < d_day11 AND d_day11 < d_day18 AND d_day18 < d_day25 AND d_day25 < d_p_step4) THEN
    RAISE EXCEPTION 'Mid-week diamonds not progressive across weeks: %, %, %, %, %', d_day3, d_day11, d_day18, d_day25, d_p_step4;
  END IF;
  IF NOT (d_day7 < d_day14 AND d_day14 < d_day21 AND d_day21 < d_day28 AND d_day28 < d_day30 AND d_day30 = d_p_step7) THEN
    RAISE EXCEPTION 'Finale/chest diamonds not progressive: %, %, %, %, %, %', d_day7, d_day14, d_day21, d_day28, d_day30, d_p_step7;
  END IF;

  -- Consumable progression across Weeks 1 -> 4
  SELECT (t->>'quantity')::int INTO q_throw_w1 FROM jsonb_array_elements(public.fn_ca_daily_bonus_pick_tiles(uid, today, 2, '[]')) t WHERE (t->>'slot')::int = 1;
  SELECT (t->>'quantity')::int INTO q_throw_w2 FROM jsonb_array_elements(public.fn_ca_daily_bonus_pick_tiles(uid, today, 10, '[]')) t WHERE (t->>'slot')::int = 1;
  SELECT (t->>'quantity')::int INTO q_throw_w3 FROM jsonb_array_elements(public.fn_ca_daily_bonus_pick_tiles(uid, today, 20, '[]')) t WHERE (t->>'slot')::int = 1;
  SELECT (t->>'quantity')::int INTO q_throw_w4 FROM jsonb_array_elements(public.fn_ca_daily_bonus_pick_tiles(uid, today, 28, '[]')) t WHERE (t->>'slot')::int = 2;
  IF NOT (q_throw_w1 < q_throw_w2 AND q_throw_w2 < q_throw_w3 AND q_throw_w3 < q_throw_w4) THEN
    RAISE EXCEPTION 'Throwables not progressive: %, %, %, %', q_throw_w1, q_throw_w2, q_throw_w3, q_throw_w4;
  END IF;

  SELECT (t->>'quantity')::int INTO q_rh_w1 FROM jsonb_array_elements(public.fn_ca_daily_bonus_pick_tiles(uid, today, 4, '[]')) t WHERE (t->>'slot')::int = 1;
  SELECT (t->>'quantity')::int INTO q_rh_w2 FROM jsonb_array_elements(public.fn_ca_daily_bonus_pick_tiles(uid, today, 12, '[]')) t WHERE (t->>'slot')::int = 1;
  SELECT (t->>'quantity')::int INTO q_rh_w3 FROM jsonb_array_elements(public.fn_ca_daily_bonus_pick_tiles(uid, today, 19, '[]')) t WHERE (t->>'slot')::int = 1;
  SELECT (t->>'quantity')::int INTO q_rh_w4 FROM jsonb_array_elements(public.fn_ca_daily_bonus_pick_tiles(uid, today, 26, '[]')) t WHERE (t->>'slot')::int = 1;
  IF NOT (q_rh_w1 < q_rh_w2 AND q_rh_w2 < q_rh_w3 AND q_rh_w3 < q_rh_w4) THEN
    RAISE EXCEPTION 'Rabbit hunts not progressive: %, %, %, %', q_rh_w1, q_rh_w2, q_rh_w3, q_rh_w4;
  END IF;

  SELECT (t->>'quantity')::int INTO q_tb_w2 FROM jsonb_array_elements(public.fn_ca_daily_bonus_pick_tiles(uid, today, 8, '[]')) t WHERE (t->>'slot')::int = 1;
  SELECT (t->>'quantity')::int INTO q_tb_w3 FROM jsonb_array_elements(public.fn_ca_daily_bonus_pick_tiles(uid, today, 17, '[]')) t WHERE (t->>'slot')::int = 1;
  SELECT (t->>'quantity')::int INTO q_tb_w4 FROM jsonb_array_elements(public.fn_ca_daily_bonus_pick_tiles(uid, today, 24, '[]')) t WHERE (t->>'slot')::int = 1;
  IF NOT (q_tb_w2 < q_tb_w3 AND q_tb_w3 < q_tb_w4) THEN
    RAISE EXCEPTION 'Time bank not progressive: %, %, %', q_tb_w2, q_tb_w3, q_tb_w4;
  END IF;

  -- 4. End-to-end status, week strip visibility, Day 1 clean 1-tile claim, and replay
  INSERT INTO auth.users(id) VALUES (uid), (vip_uid);
  INSERT INTO public.profiles(id, diamonds, is_vip) VALUES (uid, 0, false);
  INSERT INTO public.profiles(id, diamonds, is_vip, vip_tier) VALUES (vip_uid, 0, true, 'lifetime');

  PERFORM set_config('test.user', uid::text, true);
  r := public.fn_ca_daily_bonus_status();
  IF r->>'eligible' <> 'true' OR jsonb_array_length(r->'tiles') <> 1 OR (r->'tiles'->0->>'diamonds')::int <> 10 THEN
    RAISE EXCEPTION 'Day 1 should be 1 clean +10 Diamonds reward: %', r;
  END IF;
  IF jsonb_array_length(r->'week') <> 7
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(r->'week') w WHERE w->>'primary_kind' IS NULL) THEN
    RAISE EXCEPTION 'Week strip missing progressive reward details: %', r->'week';
  END IF;

  r := public.fn_ca_daily_bonus_claim_all(today, gen_random_uuid());
  IF r->>'success' <> 'true' OR r->'status'->>'unclaimed' <> '0'
     OR (SELECT diamonds FROM public.profiles WHERE id = uid) <> 10 THEN
    RAISE EXCEPTION 'Day 1 claim failed: %', r;
  END IF;
  SELECT count(*) INTO before_count FROM public.ca_daily_bonus_claims WHERE user_id = uid;
  replay := public.fn_ca_daily_bonus_claim_all(today, gen_random_uuid());
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(replay->'results') t WHERE t->>'idempotent' <> 'true')
     OR (SELECT count(*) FROM public.ca_daily_bonus_claims WHERE user_id = uid) <> before_count THEN
    RAISE EXCEPTION 'Day 1 replay duplicated claim';
  END IF;

  -- 5. Day 6 Mystery Vault: sealed at open_day, hidden in status, revealed with lucky roll at claim
  uid := gen_random_uuid();
  INSERT INTO auth.users(id) VALUES (uid);
  INSERT INTO public.profiles(id, diamonds, is_vip) VALUES (uid, 0, false);
  INSERT INTO public.ca_daily_bonus_days(user_id, bonus_date, streak, cycle_day, tiles, first_claimed_at)
  VALUES (uid, today - 1, 5, 5, '[{"slot":1,"kind":"shield"}]'::jsonb, now());
  PERFORM set_config('test.user', uid::text, true);
  r := public.fn_ca_daily_bonus_status();
  IF (r->>'streak')::int <> 6 OR r->'tiles'->0->>'kind' <> 'mystery' OR (r->'tiles'->0 ? 'mystery') THEN
    RAISE EXCEPTION 'Day 6 Mystery Vault missing or leaked secret roll: %', r;
  END IF;
  r := public.fn_ca_daily_bonus_claim_all(today, gen_random_uuid());
  IF r->>'success' <> 'true' OR (r->'results'->0->'revealed'->>'lucky')::int NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Day 6 Mystery Vault claim did not reveal lucky roll: %', r;
  END IF;

  -- 6. Day 3 VIP gate & non-VIP isolation
  uid := gen_random_uuid();
  INSERT INTO auth.users(id) VALUES (uid);
  INSERT INTO public.profiles(id, diamonds, is_vip) VALUES (uid, 0, false);
  INSERT INTO public.ca_daily_bonus_days(user_id, bonus_date, streak, cycle_day, tiles, first_claimed_at)
  VALUES (uid, today - 1, 2, 2, '[{"slot":1,"kind":"throwables"}]'::jsonb, now());
  PERFORM set_config('test.user', uid::text, true);
  r := public.fn_ca_daily_bonus_claim_all(today, gen_random_uuid());
  IF (SELECT diamonds FROM public.profiles WHERE id = uid) <> 18
     OR EXISTS (SELECT 1 FROM public.ca_daily_bonus_claims WHERE user_id = uid AND (tile->>'vip_only')::boolean) THEN
    RAISE EXCEPTION 'Day 3 non-VIP paid wrong amount or bypassed VIP gate: %', r;
  END IF;

  INSERT INTO public.ca_daily_bonus_days(user_id, bonus_date, streak, cycle_day, tiles, first_claimed_at)
  VALUES (vip_uid, today - 1, 2, 2, '[{"slot":1,"kind":"throwables"}]'::jsonb, now());
  PERFORM set_config('test.user', vip_uid::text, true);
  r := public.fn_ca_daily_bonus_claim_all(today, gen_random_uuid());
  IF (SELECT diamonds FROM public.profiles WHERE id = vip_uid) <> 30 THEN
    RAISE EXCEPTION 'Day 3 VIP should collect 18 + 12 = 30 diamonds, got %', (SELECT diamonds FROM public.profiles WHERE id = vip_uid);
  END IF;

  -- 7. Day 30 Grand Chest + 100 Diamond Bonus Spin + VIP Bonus (exact 150 cap fit)
  vip_uid := gen_random_uuid();
  INSERT INTO auth.users(id) VALUES (vip_uid);
  INSERT INTO public.profiles(id, diamonds, is_vip, vip_tier) VALUES (vip_uid, 0, true, 'lifetime');
  INSERT INTO public.ca_daily_bonus_days(user_id, bonus_date, streak, cycle_day, tiles, first_claimed_at)
  VALUES (vip_uid, today - 1, 29, 1, '[{"slot":1,"kind":"mystery"}]'::jsonb, now());
  PERFORM set_config('test.user', vip_uid::text, true);
  r := public.fn_ca_daily_bonus_status();
  IF (r->>'streak_day')::int <> 30 OR jsonb_array_length(r->'tiles') <> 4 THEN
    RAISE EXCEPTION 'Day 30 Grand Chest structure mismatch: %', r;
  END IF;
  r := public.fn_ca_daily_bonus_claim_all(today, gen_random_uuid());
  IF r->>'success' <> 'true'
     OR (SELECT diamonds FROM public.profiles WHERE id = vip_uid) <> 150
     OR (SELECT count(*) FROM public.diamond_bonus_spin_tickets WHERE user_id = vip_uid) <> 1
     OR (SELECT count(*) FROM public.feature_purchases WHERE user_id = vip_uid AND feature = 'streak_shield') <> 1 THEN
    RAISE EXCEPTION 'Day 30 Grand Chest claim failed: %', r;
  END IF;

  -- 8. Private ACLs remain locked
  IF has_function_privilege('anon', 'public.fn_ca_daily_bonus_status()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ca_daily_bonus_pick_tiles(uuid,date,integer,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ca_daily_bonus_open_day(uuid,date)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.ca_daily_bonus_calendar', 'SELECT') THEN
    RAISE EXCEPTION 'Private Daily Bonus door exposed';
  END IF;

  RAISE NOTICE 'PASS Daily Bonus progressive ladder: 100 consecutive days + 400 reset dates zero repeats, strict weekly/perk/chest progression, Mystery Vault 1x-5x reveal, Day 3 VIP gate, Day 30 150-diamond + shield + spin chest, private ACLs';
END $$;

ROLLBACK;
