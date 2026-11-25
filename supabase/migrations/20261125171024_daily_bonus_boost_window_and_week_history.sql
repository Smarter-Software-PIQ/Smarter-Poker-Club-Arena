-- 20261125171024_daily_bonus_boost_window_and_week_history.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS FIXES, AND WHY:
--
--   1. Mission Boost active-window check (fn_ca_daily_bonus_pick_tiles):
--      Previously checked `b.ends_at > (p_date::timestamp AT TIME ZONE 'America/Chicago')`,
--      which compared against Chicago midnight 00:00 instead of GREATEST(now(), midnight).
--      A 24h Mission Boost started yesterday at 10:00 AM and ALREADY EXPIRED today at
--      10:00 AM still satisfied `ends_at > today 00:00`, falsely stripping a player's
--      Mission Boost tile on Day 7 / 15 / 27 / Prestige Step 7 if they logged in later
--      the same afternoon. Using `GREATEST(now(), (p_date::timestamp AT TIME ZONE 'America/Chicago'))`
--      matches fn_ca_daily_bonus_claim's exact `b.ends_at > now()` live guard for today
--      while still anticipating boosts that extend past midnight into tomorrow.
--
--   2. Week strip historical fidelity (fn_ca_daily_bonus_status):
--      Previously recomputed past days in the current week (`d < v_day.cycle_day`)
--      via fn_ca_daily_bonus_pick_tiles(..., '[]'::jsonb). That overwrote history
--      on the 7-day strip whenever a past day had rotated (e.g., Day 1 reset to
--      Time Bank) or carried a Mission Boost that was still live the next morning.
--      Now `v_week` reads the player's actual saved `ca_daily_bonus_days.tiles`
--      for past days in the current week and passes `v_day.tiles` when previewing
--      tomorrow (`d = v_day.cycle_day + 1`) so the strip matches the Tomorrow note.
--
-- Single transaction, zero DDL locks, zero value movement, exact preimage guards,
-- private ACLs restated verbatim, and self-unwinding pre-COMMIT function probes.

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '90s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_daily_bonus_pick_tiles(uuid,date,integer,jsonb)'::regprocedure)) <> '2ef2fca403faac02cfaf5519f236b298' THEN
    RAISE EXCEPTION 'Daily bonus pick_tiles predecessor changed';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_daily_bonus_status()'::regprocedure)) <> '83e2df78e5c33dcb5a87b2f3cd4854c1' THEN
    RAISE EXCEPTION 'Daily bonus status predecessor changed';
  END IF;
END $guard$;

-- ---------------------------------------------------------------------------
-- 1. Progressive selector: accurate live Mission Boost window
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
  -- Only treat a Mission Boost as blocking when it is ACTUALLY still live at
  -- the later of now() or p_date's Chicago midnight. An already-expired
  -- same-day boost must never rob the player of today's Mission Boost tile.
  SELECT EXISTS (
    SELECT 1
      FROM public.player_boosts b
     WHERE b.user_id = p_user_id
       AND b.kind = 'mission_diamonds'
       AND b.ends_at > GREATEST(now(), (p_date::timestamp AT TIME ZONE 'America/Chicago'))
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
-- 2. Read side: preserve saved past-day history in v_week & align tomorrow
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

  -- Progressive 7-day strip for the player's current week block:
  --   - Past days (`d < v_day.cycle_day`) read the player's actual saved
  --     `ca_daily_bonus_days.tiles` when present, never rewriting history.
  --   - Today (`d = v_day.cycle_day`) uses `v_day.tiles`.
  --   - Tomorrow (`d = v_day.cycle_day + 1`) passes `v_day.tiles` so the strip
  --     agrees verbatim with the Tomorrow preview line.
  WITH week_days AS (
    SELECT
      g.d,
      GREATEST(1, v_day.streak - v_day.cycle_day + g.d) AS s,
      CASE
        WHEN g.d = v_day.cycle_day THEN v_day.tiles
        WHEN g.d < v_day.cycle_day AND saved.tiles IS NOT NULL THEN saved.tiles
        ELSE public.fn_ca_daily_bonus_pick_tiles(
          v_uid,
          v_today + (g.d - v_day.cycle_day),
          GREATEST(1, v_day.streak - v_day.cycle_day + g.d),
          CASE WHEN g.d = v_day.cycle_day + 1 THEN v_day.tiles ELSE '[]'::jsonb END
        )
      END AS day_tiles
    FROM generate_series(1, 7) AS g(d)
    LEFT JOIN public.ca_daily_bonus_days saved
      ON g.d < v_day.cycle_day
     AND saved.user_id = v_uid
     AND saved.bonus_date = v_today + (g.d - v_day.cycle_day)
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

-- Restate exact existing ACLs.
REVOKE ALL ON FUNCTION public.fn_ca_daily_bonus_pick_tiles(uuid,date,integer,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_daily_bonus_pick_tiles(uuid,date,integer,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_ca_daily_bonus_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ca_daily_bonus_status() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Self-unwinding pre-COMMIT function probes (migration-function-probes law)
-- ---------------------------------------------------------------------------

-- @probe-for: public.fn_ca_daily_bonus_pick_tiles
DO $probe$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_uid   uuid := gen_random_uuid();
  v_tiles jsonb;
BEGIN
  v_tiles := public.fn_ca_daily_bonus_pick_tiles(v_uid, v_today, 15, '[]'::jsonb);
  IF jsonb_typeof(v_tiles) <> 'array' OR (v_tiles->0->>'kind') <> 'boost' THEN
    RAISE EXCEPTION 'pick_tiles probe expected boost on Day 15, got %', v_tiles;
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
