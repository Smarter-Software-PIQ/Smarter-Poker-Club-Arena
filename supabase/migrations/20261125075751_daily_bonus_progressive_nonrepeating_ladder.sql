-- 20261125075751_daily_bonus_progressive_nonrepeating_ladder.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Restructures the Daily Club Arena Bonus ladder to eliminate repetitive,
-- randomly scrambled 3-tile bundles (e.g., "VIP Time Bank", "VIP Streak Shield")
-- and restore a strictly progressive, non-repeating 30-day + Prestige ladder:
--   1. Standard days focus on 1 clean, high-impact hero reward (never 3
--      cluttered gifts on ordinary days). Weekly finales (Day 7, 14, 21, 28),
--      tenth-day Bonus Spin milestones (Day 10, 20, 30, 40...), and VIP
--      milestone days add curated extras.
--   2. Every consecutive streak day from Day 1 through Day 30 and into
--      Prestige (Days 31+) has disjoint reward kinds with zero back-to-back
--      repeats, including across streak resets back to Day 1.
--   3. Both Diamonds (scaled by fn_get_streak_multiplier, capped at 110 free /
--      150 VIP daily and <=125 per claim) and table perks (Throwables, Rabbit
--      Hunts, Time Bank) scale progressively across Weeks 1-4 and Prestige.
--   4. Restores the server-rolled Mystery Vault (1x-5x lucky roll) and clean
--      VIP Diamond Bonuses on milestone days only.
--   5. Exposes each day's actual progressive reward on the 7-day week strip
--      instead of opaque "New" placeholders.
--   6. Preserves all financial laws: zero chips ever, canonical award_diamonds_v2
--      under daily_bonus caps, feature_purchases source='daily_bonus', existing
--      saved days/claims immutable, and private ACLs intact.
--
-- Single transaction, zero DDL locks on hot tables (ca_daily_bonus_calendar is
-- an operator config table unreadable by players).

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '90s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_daily_bonus_pick_tiles(uuid,date,integer,jsonb)'::regprocedure)) <> 'f7edb06bbcfda334c16dce2e7d951143' THEN
    RAISE EXCEPTION 'Daily bonus pick_tiles predecessor changed';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_daily_bonus_open_day(uuid,date)'::regprocedure)) <> 'd0c982394f3067cc4eefd57e48a624ac' THEN
    RAISE EXCEPTION 'Daily bonus open_day predecessor changed';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_daily_bonus_status()'::regprocedure)) <> '30799f675abb2282d66f12322496393f' THEN
    RAISE EXCEPTION 'Daily bonus status predecessor changed';
  END IF;
END $guard$;

-- ---------------------------------------------------------------------------
-- 1. Restructured 30-day progressive calendar (history-tracked automatically)
-- ---------------------------------------------------------------------------
-- Week 1 (cycle_day 1..7), Weeks 2-4 + Day 30 (streak_day 8..30).
-- Every diamond base is chosen as an exact clean multiple of its streak tier's
-- multiplier (1.0 / 1.2 / 1.5 / 1.8 / 2.0) and stays inside per-player daily
-- caps (110 free / 150 VIP) and the 125 single-claim clamp.
DELETE FROM public.ca_daily_bonus_calendar WHERE id IS NOT NULL;

INSERT INTO public.ca_daily_bonus_calendar
  (cycle_day, streak_day, slot, kind, quantity, diamonds, vip_only, label, active)
VALUES
  -- Week 1 (Days 1-7): build the habit, 1 clean hero prize on standard days
  (1, NULL, 1, 'diamonds',      0, 10, false, 'Diamonds',          true), -- +10 (x1.0)
  (2, NULL, 1, 'throwables',    3,  0, false, 'Throwables',        true), -- x3 Throwables
  (3, NULL, 1, 'diamonds',      0, 15, false, 'Diamonds',          true), -- +18 (x1.2)
  (3, NULL, 5, 'diamonds',      0, 10, true,  'VIP Bonus',         true), -- +12 VIP (x1.2)
  (4, NULL, 1, 'rabbit_hunts',  2,  0, false, 'Rabbit Hunts',      true), -- x2 Rabbit Hunts
  (5, NULL, 1, 'shield',        1,  0, false, 'Streak Shield',     true), -- x1 Shield (30d)
  (6, NULL, 1, 'mystery',       0,  0, false, 'Mystery Vault',     true), -- 1x-5x Lucky Roll
  (7, NULL, 1, 'diamonds',      0, 40, false, 'Weekly Jackpot',    true), -- +60 (x1.5)
  (7, NULL, 2, 'boost',        24,  0, false, 'Mission Boost',     true), -- 2x Missions 24h
  (7, NULL, 5, 'diamonds',      0, 16, true,  'VIP Bonus',         true), -- +24 VIP (x1.5)

  -- Week 2 (Days 8-14): Time Bank enters, perks & diamonds step up, Day 10 Spin, Day 14 Chest
  (NULL,  8, 1, 'time_bank',     4,  0, false, 'Time Bank',        true), -- +80s Time Bank
  (NULL,  9, 1, 'diamonds',      0, 20, false, 'Diamonds',         true), -- +30 (x1.5)
  (NULL, 10, 1, 'throwables',    5,  0, false, 'Throwables',       true), -- x5 + 100d Spin (slot 7)
  (NULL, 11, 1, 'diamonds',      0, 30, false, 'Diamonds',         true), -- +45 (x1.5)
  (NULL, 11, 5, 'diamonds',      0, 16, true,  'VIP Bonus',        true), -- +24 VIP (x1.5)
  (NULL, 12, 1, 'rabbit_hunts',  4,  0, false, 'Rabbit Hunts',     true), -- x4 Rabbit Hunts
  (NULL, 13, 1, 'mystery',       0,  0, false, 'Mystery Vault',    true), -- 1x-5x Lucky Roll
  (NULL, 14, 1, 'diamonds',      0, 45, false, 'Two-Week Chest',   true), -- +81 (x1.8)
  (NULL, 14, 2, 'shield',        1,  0, false, 'Streak Shield',    true), -- x1 Shield (30d)
  (NULL, 14, 5, 'diamonds',      0, 15, true,  'VIP Bonus',        true), -- +27 VIP (x1.8)

  -- Week 3 (Days 15-21): x1.8 streak tier, bigger packs, Day 20 Spin, Day 21 Chest
  (NULL, 15, 1, 'boost',        24,  0, false, 'Mission Boost',    true), -- 2x Missions 24h
  (NULL, 16, 1, 'diamonds',      0, 25, false, 'Diamonds',         true), -- +45 (x1.8)
  (NULL, 17, 1, 'time_bank',     6,  0, false, 'Time Bank',        true), -- +120s Time Bank
  (NULL, 18, 1, 'diamonds',      0, 35, false, 'Diamonds',         true), -- +63 (x1.8)
  (NULL, 18, 5, 'diamonds',      0, 15, true,  'VIP Bonus',        true), -- +27 VIP (x1.8)
  (NULL, 19, 1, 'rabbit_hunts',  6,  0, false, 'Rabbit Hunts',     true), -- x6 Rabbit Hunts
  (NULL, 20, 1, 'throwables',    8,  0, false, 'Throwables',       true), -- x8 + 100d Spin (slot 7)
  (NULL, 21, 1, 'diamonds',      0, 50, false, 'Three-Week Chest', true), -- +90 (x1.8)
  (NULL, 21, 2, 'mystery',       0,  0, false, 'Mystery Vault',    true), -- 1x-5x Lucky Roll
  (NULL, 21, 5, 'diamonds',      0, 20, true,  'VIP Bonus',        true), -- +36 VIP (x1.8)

  -- Week 4 + 30-Day Grand Chest (Days 22-30): peak progression into x2.0 tier
  (NULL, 22, 1, 'shield',        1,  0, false, 'Streak Shield',    true), -- x1 Shield (30d)
  (NULL, 23, 1, 'diamonds',      0, 30, false, 'Diamonds',         true), -- +54 (x1.8)
  (NULL, 24, 1, 'time_bank',     8,  0, false, 'Time Bank',        true), -- +160s Time Bank
  (NULL, 25, 1, 'diamonds',      0, 40, false, 'Diamonds',         true), -- +72 (x1.8)
  (NULL, 25, 5, 'diamonds',      0, 20, true,  'VIP Bonus',        true), -- +36 VIP (x1.8)
  (NULL, 26, 1, 'rabbit_hunts',  8,  0, false, 'Rabbit Hunts',     true), -- x8 Rabbit Hunts
  (NULL, 27, 1, 'boost',        24,  0, false, 'Mission Boost',    true), -- 2x Missions 24h
  (NULL, 28, 1, 'diamonds',      0, 55, false, 'Four-Week Jackpot',true), -- +99 (x1.8)
  (NULL, 28, 2, 'throwables',   10,  0, false, 'Throwables',       true), -- x10 Throwables
  (NULL, 28, 5, 'diamonds',      0, 20, true,  'VIP Bonus',        true), -- +36 VIP (x1.8)
  (NULL, 29, 1, 'mystery',       0,  0, false, 'Mystery Vault',    true), -- 1x-5x Lucky Roll
  (NULL, 30, 1, 'diamonds',      0, 55, false, 'Thirty-Day Chest', true), -- +110 (x2.0)
  (NULL, 30, 2, 'shield',        1,  0, false, 'Streak Shield',    true), -- x1 Shield (30d)
  (NULL, 30, 5, 'diamonds',      0, 20, true,  'VIP Bonus',        true); -- +40 VIP (x2.0) + 100d Spin (slot 7)

-- ---------------------------------------------------------------------------
-- 2. Deterministic progressive, non-repeating selector
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ca_daily_bonus_pick_tiles(
  p_user_id uuid,
  p_date date,
  p_streak integer,
  p_previous jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_streak        integer := GREATEST(1, COALESCE(p_streak, 1));
  v_mult          numeric := public.fn_get_streak_multiplier(v_streak);
  v_prev          jsonb := COALESCE(p_previous, '[]'::jsonb);
  v_has_boost     boolean := false;
  v_prestige_step integer;
  v_prestige_week integer;
  v_kind          text;
  v_label         text;
  v_qty           integer;
  v_base_dia      integer;
  c               record;
  result          jsonb := '[]'::jsonb;
BEGIN
  -- Never offer a 24h Mission Boost if one is already running past today's start.
  SELECT EXISTS (
    SELECT 1
      FROM public.player_boosts b
     WHERE b.user_id = p_user_id
       AND b.kind = 'mission_diamonds'
       AND b.ends_at > (p_date::timestamp AT TIME ZONE 'America/Chicago')
  ) INTO v_has_boost;

  IF v_streak <= 30 THEN
    -- Days 1-7 read cycle_day; Days 8-30 read exact streak_day rows.
    FOR c IN
      SELECT *
        FROM public.ca_daily_bonus_calendar cal
       WHERE cal.active
         AND (
           (v_streak >= 8 AND cal.streak_day = v_streak)
           OR (v_streak < 8 AND cal.cycle_day = v_streak)
         )
       ORDER BY cal.slot
    LOOP
      v_kind     := c.kind;
      v_label    := c.label;
      v_qty      := c.quantity;
      v_base_dia := c.diamonds;

      -- Guard 1: streak reset onto Day 1 right after a diamonds day rotates to
      -- a clean starter Time Bank (+40s) so consecutive calendar days never
      -- repeat the same prize type, and Day 2 (Throwables) stays disjoint.
      IF v_streak = 1 AND c.slot = 1 AND v_kind = 'diamonds'
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_prev) t
            WHERE t->>'kind' = 'diamonds'
         )
      THEN
        IF NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_prev) t
           WHERE t->>'kind' = 'time_bank'
        ) THEN
          v_kind     := 'time_bank';
          v_label    := 'Time Bank';
          v_qty      := 2;
          v_base_dia := 0;
        ELSE
          v_kind     := 'rabbit_hunts';
          v_label    := 'Rabbit Hunts';
          v_qty      := 2;
          v_base_dia := 0;
        END IF;
      END IF;

      -- Guard 2: if a Mission Boost is already active, substitute a disjoint
      -- table perk so the player never receives an unclaimable boost tile.
      IF v_kind = 'boost' AND v_has_boost THEN
        IF v_streak = 27 THEN
          v_kind     := 'time_bank';
          v_label    := 'Time Bank';
          v_qty      := 8;
          v_base_dia := 0;
        ELSE
          v_kind     := 'rabbit_hunts';
          v_label    := 'Rabbit Hunts';
          v_qty      := CASE WHEN v_streak >= 15 THEN 4 ELSE 3 END;
          v_base_dia := 0;
        END IF;
      END IF;

      result := result || jsonb_build_array(jsonb_build_object(
        'slot',          c.slot,
        'kind',          v_kind,
        'label',         v_label,
        'vip_only',      c.vip_only,
        'quantity',      v_qty,
        'base_diamonds', v_base_dia,
        'diamonds',      CASE WHEN v_kind = 'diamonds'
                              THEN LEAST(125, round(v_base_dia * v_mult)::integer)
                              ELSE 0 END,
        'mystery',       NULL
      ));
    END LOOP;
  ELSE
    -- Days 31+: Prestige Master Streak (x2.0 multiplier locked in).
    -- 7-day elite cycle starting cleanly after Day 30 (diamonds/shield/spin),
    -- with zero consecutive repeats across any day or week boundary.
    v_prestige_step := ((v_streak - 31) % 7) + 1;
    v_prestige_week := (v_streak - 31) / 7;

    CASE v_prestige_step
      WHEN 1 THEN
        result := jsonb_build_array(jsonb_build_object(
          'slot', 1, 'kind', 'throwables', 'label', 'Throwables',
          'vip_only', false, 'quantity', 10, 'base_diamonds', 0, 'diamonds', 0, 'mystery', NULL
        ));
      WHEN 2 THEN
        result := jsonb_build_array(jsonb_build_object(
          'slot', 1, 'kind', 'diamonds', 'label', 'Prestige Diamonds',
          'vip_only', false, 'quantity', 0, 'base_diamonds', 35,
          'diamonds', LEAST(125, round(35 * v_mult)::integer), 'mystery', NULL
        ));
      WHEN 3 THEN
        result := jsonb_build_array(jsonb_build_object(
          'slot', 1, 'kind', 'rabbit_hunts', 'label', 'Rabbit Hunts',
          'vip_only', false, 'quantity', 8, 'base_diamonds', 0, 'diamonds', 0, 'mystery', NULL
        ));
      WHEN 4 THEN
        result := jsonb_build_array(
          jsonb_build_object(
            'slot', 1, 'kind', 'diamonds', 'label', 'Prestige Diamonds',
            'vip_only', false, 'quantity', 0, 'base_diamonds', 45,
            'diamonds', LEAST(125, round(45 * v_mult)::integer), 'mystery', NULL
          ),
          jsonb_build_object(
            'slot', 5, 'kind', 'diamonds', 'label', 'VIP Bonus',
            'vip_only', true, 'quantity', 0, 'base_diamonds', 20,
            'diamonds', LEAST(125, round(20 * v_mult)::integer), 'mystery', NULL
          )
        );
      WHEN 5 THEN
        IF (v_prestige_week % 2) = 0 THEN
          result := jsonb_build_array(jsonb_build_object(
            'slot', 1, 'kind', 'time_bank', 'label', 'Time Bank',
            'vip_only', false, 'quantity', 8, 'base_diamonds', 0, 'diamonds', 0, 'mystery', NULL
          ));
        ELSE
          result := jsonb_build_array(jsonb_build_object(
            'slot', 1, 'kind', 'shield', 'label', 'Streak Shield',
            'vip_only', false, 'quantity', 1, 'base_diamonds', 0, 'diamonds', 0, 'mystery', NULL
          ));
        END IF;
      WHEN 6 THEN
        result := jsonb_build_array(jsonb_build_object(
          'slot', 1, 'kind', 'mystery', 'label', 'Mystery Vault',
          'vip_only', false, 'quantity', 0, 'base_diamonds', 0, 'diamonds', 0, 'mystery', NULL
        ));
      ELSE
        -- Step 7: Prestige Weekly Jackpot (+110 Diamonds + 24h Mission Boost + VIP +40)
        result := jsonb_build_array(
          jsonb_build_object(
            'slot', 1, 'kind', 'diamonds', 'label', 'Prestige Jackpot',
            'vip_only', false, 'quantity', 0, 'base_diamonds', 55,
            'diamonds', LEAST(125, round(55 * v_mult)::integer), 'mystery', NULL
          ),
          CASE WHEN v_has_boost THEN
            jsonb_build_object(
              'slot', 2, 'kind', 'rabbit_hunts', 'label', 'Rabbit Hunts',
              'vip_only', false, 'quantity', 6, 'base_diamonds', 0, 'diamonds', 0, 'mystery', NULL
            )
          ELSE
            jsonb_build_object(
              'slot', 2, 'kind', 'boost', 'label', 'Mission Boost',
              'vip_only', false, 'quantity', 24, 'base_diamonds', 0, 'diamonds', 0, 'mystery', NULL
            )
          END,
          jsonb_build_object(
            'slot', 5, 'kind', 'diamonds', 'label', 'VIP Bonus',
            'vip_only', true, 'quantity', 0, 'base_diamonds', 20,
            'diamonds', LEAST(125, round(20 * v_mult)::integer), 'mystery', NULL
          )
        );
    END CASE;
  END IF;

  IF result = '[]'::jsonb THEN
    RAISE EXCEPTION 'No progressive daily reward configured for streak %', v_streak
      USING ERRCODE = '22023';
  END IF;

  RETURN result || public.fn_ca_daily_bonus_spin_tile(v_streak);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Opening a day: rolls server-sealed Mystery Vault & marks Chest milestones
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ca_daily_bonus_open_day(p_user_id uuid, p_today date)
RETURNS public.ca_daily_bonus_days
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row        public.ca_daily_bonus_days;
  v_yesterday  public.ca_daily_bonus_days;
  v_last       public.ca_daily_bonus_days;
  v_shield     public.feature_purchases;
  v_streak     integer;
  v_cycle_day  integer;
  v_streak_day integer;
  v_tiles      jsonb;
  v_protected  boolean := false;
  v_shield_id  uuid := NULL;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ca_daily_bonus:' || p_user_id::text, 0));
  SELECT * INTO v_row FROM public.ca_daily_bonus_days
   WHERE user_id = p_user_id AND bonus_date = p_today;
  IF FOUND THEN
    IF p_today = (now() AT TIME ZONE 'America/Chicago')::date AND v_row.streak % 10 = 0
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_row.tiles) t WHERE (t->>'slot')::integer = 7) THEN
      UPDATE public.ca_daily_bonus_days
         SET tiles = tiles || public.fn_ca_daily_bonus_spin_tile(v_row.streak)
       WHERE user_id = p_user_id AND bonus_date = p_today
      RETURNING * INTO v_row;
    END IF;
    RETURN v_row;
  END IF;

  -- Streak advances across consecutive CLAIMED days.
  SELECT * INTO v_yesterday FROM public.ca_daily_bonus_days
   WHERE user_id = p_user_id AND bonus_date = p_today - 1;
  IF FOUND AND v_yesterday.first_claimed_at IS NOT NULL THEN
    v_streak := v_yesterday.streak + 1;
  ELSE
    -- Streak Shield: covers exactly one missed day when held.
    SELECT * INTO v_last FROM public.ca_daily_bonus_days
     WHERE user_id = p_user_id AND bonus_date < p_today AND first_claimed_at IS NOT NULL
     ORDER BY bonus_date DESC LIMIT 1;
    IF FOUND AND v_last.bonus_date = p_today - 2 THEN
      SELECT * INTO v_shield FROM public.feature_purchases f
       WHERE f.user_id = p_user_id AND f.feature = 'streak_shield'
         AND f.uses_remaining > 0 AND (f.expires_at IS NULL OR f.expires_at > now())
       ORDER BY f.expires_at NULLS LAST, f.created_at
       LIMIT 1
       FOR UPDATE SKIP LOCKED;
      IF FOUND THEN
        UPDATE public.feature_purchases SET uses_remaining = uses_remaining - 1 WHERE id = v_shield.id;
        v_streak    := v_last.streak + 1;
        v_protected := true;
        v_shield_id := v_shield.id;
      END IF;
    END IF;
    IF NOT v_protected THEN
      v_streak := 1;
    END IF;
  END IF;

  v_cycle_day  := ((v_streak - 1) % 7) + 1;
  -- Only major milestone Chest days light the gold Chest badge.
  v_streak_day := CASE WHEN v_streak IN (14, 21, 30) THEN v_streak ELSE NULL END;

  v_tiles := public.fn_ca_daily_bonus_pick_tiles(
    p_user_id, p_today, v_streak, COALESCE(v_yesterday.tiles, '[]'::jsonb)
  );

  -- Attach the server-sealed mystery prize at day-open so fn_ca_daily_bonus_claim
  -- reveals it with its server-rolled 1x-5x lucky multiplier.
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN t->>'kind' = 'mystery' AND (t->'mystery' IS NULL OR t->'mystery' = 'null'::jsonb)
      THEN t || jsonb_build_object('mystery', public.fn_ca_daily_bonus_roll_mystery())
      ELSE t
    END
    ORDER BY (t->>'slot')::integer), '[]'::jsonb)
    INTO v_tiles
    FROM jsonb_array_elements(v_tiles) t;

  IF v_tiles = '[]'::jsonb THEN
    RAISE EXCEPTION 'fn_ca_daily_bonus_open_day: no calendar rows for streak % (cycle day %)', v_streak, v_cycle_day
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.ca_daily_bonus_days
    (user_id, bonus_date, streak, cycle_day, streak_day, tiles, streak_protected, shield_consumed_id)
  VALUES
    (p_user_id, p_today, v_streak, v_cycle_day, v_streak_day, v_tiles, v_protected, v_shield_id)
  ON CONFLICT (user_id, bonus_date) DO NOTHING;

  SELECT * INTO v_row FROM public.ca_daily_bonus_days
   WHERE user_id = p_user_id AND bonus_date = p_today;
  RETURN v_row;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Read side: populates real progressive rewards for all 7 days on the strip
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ca_daily_bonus_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_elig       text;
  v_today      date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_reset_at   timestamptz := ((now() AT TIME ZONE 'America/Chicago')::date + 1)::timestamp AT TIME ZONE 'America/Chicago';
  v_day        public.ca_daily_bonus_days;
  v_is_vip     boolean := false;
  v_caps       jsonb;
  v_tiles      jsonb;
  v_week       jsonb;
  v_next       jsonb;
  v_next_streak integer;
  v_shield     jsonb;
  v_boost      jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'fn_ca_daily_bonus_status requires an authenticated caller' USING ERRCODE = '28000';
  END IF;

  v_elig := public.fn_ca_daily_bonus_eligibility(v_uid);
  IF v_elig <> 'ok' THEN
    RETURN jsonb_build_object(
      'eligible', false, 'reason', v_elig, 'today', v_today,
      'reset_at', v_reset_at,
      'seconds_to_reset', GREATEST(0, floor(extract(epoch FROM (v_reset_at - now())))::integer),
      'shown_today', false,
      'tiles', '[]'::jsonb
    );
  END IF;

  SELECT COALESCE(p.is_vip, false)
         AND (p.vip_tier = 'lifetime' OR p.vip_expires_at IS NULL OR p.vip_expires_at > now())
    INTO v_is_vip
    FROM public.profiles p WHERE p.id = v_uid;

  v_day  := public.fn_ca_daily_bonus_open_day(v_uid, v_today);
  v_caps := public.fn_ca_daily_bonus_caps(v_uid, v_is_vip);

  SELECT COALESCE(jsonb_agg(
           (t - 'mystery') || jsonb_build_object(
             'claimed', cl.id IS NOT NULL,
             'claimed_at', cl.created_at,
             'granted', cl.granted,
             'revealed', CASE WHEN cl.id IS NOT NULL THEN cl.result->'revealed' ELSE NULL END,
             'locked', (t->>'vip_only')::boolean AND NOT v_is_vip,
             'capped', cl.id IS NULL AND t->>'kind' = 'diamonds'
                       AND (t->>'diamonds')::int > (v_caps->>'daily_remaining')::int
           ) ORDER BY (t->>'slot')::int), '[]'::jsonb)
    INTO v_tiles
    FROM jsonb_array_elements(v_day.tiles) t
    LEFT JOIN public.ca_daily_bonus_claims cl
      ON cl.user_id = v_uid AND cl.bonus_date = v_today AND cl.slot = (t->>'slot')::int;

  -- Progressive 7-day strip for the player's current week block: every day shows
  -- its actual reward (diamonds, perk count, Mystery Vault, Chest, or Bonus Spin).
  WITH week_days AS (
    SELECT
      d,
      GREATEST(1, v_day.streak - v_day.cycle_day + d) AS s,
      CASE
        WHEN d = v_day.cycle_day THEN v_day.tiles
        ELSE public.fn_ca_daily_bonus_pick_tiles(
          v_uid,
          v_today + (d - v_day.cycle_day),
          GREATEST(1, v_day.streak - v_day.cycle_day + d),
          '[]'::jsonb
        )
      END AS day_tiles
    FROM generate_series(1, 7) d
  )
  SELECT jsonb_agg(jsonb_build_object(
    'day', d,
    'streak', s,
    'diamonds', (
      SELECT sum((t->>'diamonds')::integer)
        FROM jsonb_array_elements(day_tiles) t
       WHERE t->>'kind' = 'diamonds' AND NOT COALESCE((t->>'vip_only')::boolean, false)
    ),
    'primary_kind', (
      SELECT t->>'kind'
        FROM jsonb_array_elements(day_tiles) t
       WHERE NOT COALESCE((t->>'vip_only')::boolean, false)
       ORDER BY (t->>'slot')::integer LIMIT 1
    ),
    'primary_quantity', (
      SELECT COALESCE((t->>'quantity')::integer, 0)
        FROM jsonb_array_elements(day_tiles) t
       WHERE NOT COALESCE((t->>'vip_only')::boolean, false)
       ORDER BY (t->>'slot')::integer LIMIT 1
    ),
    'has_spin', (s > 0 AND s % 10 = 0),
    'extras', (
      SELECT string_agg(t->>'label', ', ' ORDER BY (t->>'slot')::integer)
        FROM jsonb_array_elements(day_tiles) t
       WHERE t->>'kind' <> 'diamonds' AND NOT COALESCE((t->>'vip_only')::boolean, false)
    ),
    'chest', (s IN (14, 21, 30)),
    'state', CASE
               WHEN d < v_day.cycle_day THEN 'done'
               WHEN d = v_day.cycle_day THEN 'today'
               ELSE 'upcoming'
             END
  ) ORDER BY d)
  INTO v_week
  FROM week_days;

  v_next_streak := v_day.streak + 1;
  v_next := public.fn_ca_daily_bonus_pick_tiles(v_uid, v_today + 1, v_next_streak, v_day.tiles);

  SELECT jsonb_build_object(
           'held', COALESCE(sum(f.uses_remaining), 0),
           'expires_at', min(f.expires_at))
    INTO v_shield
    FROM public.feature_purchases f
   WHERE f.user_id = v_uid AND f.feature = 'streak_shield'
     AND f.uses_remaining > 0 AND (f.expires_at IS NULL OR f.expires_at > now());

  SELECT jsonb_build_object(
           'active', true, 'factor', b.factor, 'kind', b.kind,
           'ends_at', b.ends_at,
           'seconds_left', GREATEST(0, floor(extract(epoch FROM (b.ends_at - now())))::integer),
           'applied_diamonds', b.applied_diamonds)
    INTO v_boost
    FROM public.player_boosts b
   WHERE b.user_id = v_uid AND b.kind = 'mission_diamonds' AND b.starts_at <= now() AND b.ends_at > now()
   ORDER BY b.ends_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'eligible', true,
    'bonus_spin_every_days', 10,
    'bonus_spin_entry_diamonds', 100,
    'bonus_spins_held', (SELECT count(*) FROM public.diamond_bonus_spin_tickets WHERE user_id = v_uid AND redeemed_spin_id IS NULL),
    'today', v_today,
    'reset_at', v_reset_at,
    'seconds_to_reset', GREATEST(0, floor(extract(epoch FROM (v_reset_at - now())))::integer),
    'streak', v_day.streak,
    'cycle_day', v_day.cycle_day,
    'streak_day', v_day.streak_day,
    'multiplier', public.fn_get_streak_multiplier(v_day.streak),
    'is_vip', v_is_vip,
    'claimed_today', v_day.first_claimed_at IS NOT NULL,
    'shown_today', v_day.sheet_shown_at IS NOT NULL,
    'unclaimed', (SELECT count(*) FROM jsonb_array_elements(v_tiles) x
                   WHERE NOT (x->>'claimed')::boolean AND NOT (x->>'locked')::boolean),
    'tiles', v_tiles,
    'week', v_week,
    'tomorrow', v_next,
    'caps', v_caps,
    'cents_per_diamond', 1,
    'shield', COALESCE(v_shield, jsonb_build_object('held', 0, 'expires_at', NULL)),
    'streak_protected', COALESCE(v_day.streak_protected, false),
    'boost', COALESCE(v_boost, jsonb_build_object('active', false))
  );
END;
$function$;

INSERT INTO public.ca_money_rpc_registry(proname, status, notes) VALUES
  ('fn_ca_daily_bonus_pick_tiles', 'approved',
   'Private read-only progressive daily reward selector. Uses maintained 30-day progressive calendar + Prestige tier, guarantees zero back-to-back reward kind repeats (including across streak resets), scales diamonds inside the 125-per-claim clamp and 110/150 daily caps, and moves no value.')
ON CONFLICT (proname) DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes;

-- Restate exact existing ACLs.
REVOKE ALL ON FUNCTION public.fn_ca_daily_bonus_pick_tiles(uuid,date,integer,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_daily_bonus_pick_tiles(uuid,date,integer,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_ca_daily_bonus_open_day(uuid,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_daily_bonus_open_day(uuid,date) TO service_role;
REVOKE ALL ON FUNCTION public.fn_ca_daily_bonus_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ca_daily_bonus_status() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Self-unwinding pre-COMMIT function probes (migration-function-probes law)
-- ---------------------------------------------------------------------------

-- @probe-for: public.fn_ca_daily_bonus_pick_tiles
DO $probe$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_uid   uuid := gen_random_uuid();
  v_s     integer;
  v_tiles jsonb;
BEGIN
  FOREACH v_s IN ARRAY ARRAY[1, 6, 7, 14, 21, 30, 31, 37] LOOP
    v_tiles := public.fn_ca_daily_bonus_pick_tiles(v_uid, v_today, v_s, '[]'::jsonb);
    IF jsonb_typeof(v_tiles) <> 'array' OR jsonb_array_length(v_tiles) < 1 THEN
      RAISE EXCEPTION 'pick_tiles probe returned empty for streak %', v_s;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_ca_daily_bonus_open_day
DO $probe$
DECLARE
  v_uid uuid;
  v_day public.ca_daily_bonus_days;
BEGIN
  SELECT p.id INTO v_uid
    FROM public.profiles p
   WHERE public.fn_ca_daily_bonus_eligibility(p.id) = 'ok'
   LIMIT 1;
  IF v_uid IS NOT NULL THEN
    v_day := public.fn_ca_daily_bonus_open_day(v_uid, DATE '2099-12-31');
    IF v_day.user_id IS DISTINCT FROM v_uid OR jsonb_array_length(v_day.tiles) < 1 THEN
      RAISE EXCEPTION 'open_day probe returned invalid row';
    END IF;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_ca_daily_bonus_status
DO $probe$
DECLARE
  v_uid uuid;
  v_st  jsonb;
BEGIN
  SELECT p.id INTO v_uid
    FROM public.profiles p
   WHERE public.fn_ca_daily_bonus_eligibility(p.id) = 'ok'
   LIMIT 1;
  IF v_uid IS NULL THEN
    v_uid := gen_random_uuid();
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  v_st := public.fn_ca_daily_bonus_status();
  IF jsonb_typeof(v_st) <> 'object' OR NOT (v_st ? 'eligible') THEN
    RAISE EXCEPTION 'status probe returned invalid payload: %', v_st;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
