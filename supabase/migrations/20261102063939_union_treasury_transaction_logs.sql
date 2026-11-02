-- Union treasury transaction logs (Dan 2026-11-02).
--
-- "INSIDE THE UNION WALLETS, UNION BANK, RAKE TREASURY, BACK UP BBJ WALLET,
--  PROMO WALLET AND SPINS TREASURY, SHOULD BE A TRANSACTION LOG OF ANY OUTS,
--  AND A ONE TIME DAILY "INS" WHERE IT GIVES THE DAILY TOTALS COLLECTED."
--
-- Source of truth is chip_ledger. Every leg that leaves a union treasury is
-- copied here as its own 'out' row. Routine collection (rake, BBJ drops, spin
-- entries, the BBJ promo sweep) is rolled into ONE
-- 'daily_in' row per wallet per Chicago day. Deliberate one-off credits
-- (transfers between wallets, settlements, clawbacks, seeds, overlay returns) are not
-- "collection", so each one is logged individually as an 'in' row.
--
-- Ingest never reads by chain_seq: the sequence is taken before commit, so a
-- slow transaction can land a lower number after a higher one is visible.
--   * Individual rows (outs, one-off ins) re-scan a rolling 30-minute window
--     every 5 minutes; a unique key on the source leg makes overlap harmless.
--   * Daily totals are built from closed Chicago hours. An hour is closed 15
--     minutes after it ends (created_at is the inserting transaction's start
--     and no money transaction runs anywhere near 15 minutes). A closed hour
--     is summed once, replaced not added, so a re-run is harmless too.
-- Backfill: hours are walked back to 2026-10-01 at up to 18 s per tick.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ca_union_treasury_log (
  id                bigserial PRIMARY KEY,
  union_id          uuid        NOT NULL,
  wallet_key        text        NOT NULL CHECK (wallet_key IN
                      ('union_bank','rake_treasury','backup_bbj','main_bbj','promo','spins_treasury')),
  entry_kind        text        NOT NULL CHECK (entry_kind IN ('out','in','daily_in')),
  occurred_at       timestamptz NOT NULL,
  log_day           date        NOT NULL,
  amount            numeric     NOT NULL,
  category          text,
  entries           integer     NOT NULL DEFAULT 1,
  breakdown         jsonb,
  counterparty_type text,
  counterparty_label text,
  counterparty_id   uuid,
  counterparty_name text,
  performed_by      uuid,
  performed_by_name text,
  description       text,
  balance_after     numeric,
  club_id           uuid,
  club_name         text,
  tournament_id     uuid,
  source_ledger_id  uuid,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_ca_union_treasury_log_source
  ON public.ca_union_treasury_log (source_ledger_id, wallet_key, entry_kind)
  WHERE source_ledger_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_ca_union_treasury_log_daily
  ON public.ca_union_treasury_log (union_id, wallet_key, log_day)
  WHERE entry_kind = 'daily_in';
CREATE INDEX IF NOT EXISTS ix_ca_union_treasury_log_read
  ON public.ca_union_treasury_log (union_id, wallet_key, occurred_at DESC, id DESC);

-- One row per closed Chicago hour per wallet per category: the bricks the
-- daily totals are built from.
CREATE TABLE IF NOT EXISTS public.ca_union_treasury_hourly_ins (
  union_id   uuid        NOT NULL,
  wallet_key text        NOT NULL,
  hour_start timestamptz NOT NULL,
  category   text        NOT NULL,
  amount     numeric     NOT NULL,
  entries    integer     NOT NULL,
  PRIMARY KEY (union_id, wallet_key, hour_start, category)
);

CREATE TABLE IF NOT EXISTS public.ca_union_treasury_hours_done (
  hour_start timestamptz PRIMARY KEY,
  legs_seen  integer     NOT NULL,
  done_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ca_union_treasury_log_state (
  id               integer PRIMARY KEY CHECK (id = 1),
  last_tail_scan   timestamptz,
  backfill_floor   timestamptz NOT NULL,
  last_tick_at     timestamptz,
  last_tick_ms     integer,
  last_tick_note   text
);
INSERT INTO public.ca_union_treasury_log_state (id, backfill_floor)
VALUES (1, timestamptz '2026-10-01 00:00 America/Chicago')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.ca_union_treasury_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_union_treasury_hourly_ins   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_union_treasury_hours_done   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_union_treasury_log_state    ENABLE ROW LEVEL SECURITY;
-- Nobody reads these directly: the SECURITY DEFINER functions below own every
-- read and write, and the screen goes through fn_union_treasury_log.
REVOKE ALL ON public.ca_union_treasury_log FROM public, anon, authenticated, service_role;
REVOKE ALL ON public.ca_union_treasury_hourly_ins FROM public, anon, authenticated, service_role;
REVOKE ALL ON public.ca_union_treasury_hours_done FROM public, anon, authenticated, service_role;
REVOKE ALL ON public.ca_union_treasury_log_state FROM public, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.ca_union_treasury_log_id_seq FROM public, anon, authenticated, service_role;

-- Categories that are routine collection: rolled into the daily "In".
CREATE OR REPLACE FUNCTION public.fn_union_treasury_is_collection(p_category text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_category IN ('rake','bbj_contribution','spin_entry','promo');
$$;

-- Every treasury leg in a chip_ledger time range, one row per side that
-- touches a union treasury. side = 'out' (money left) or 'in' (money arrived).
CREATE OR REPLACE FUNCTION public.fn_union_treasury_legs(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  ledger_id uuid, created_at timestamptz, side text, union_id uuid, wallet_key text,
  amount numeric, category text, cp_type text, cp_label text, cp_id uuid,
  performed_by uuid, description text, balance_after numeric,
  club_id uuid, tournament_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH spin AS (
    SELECT sp.id, COALESCE(u.id, uc.union_id) AS union_id
      FROM spin_bonus_pools sp
      LEFT JOIN unions u ON u.id = sp.club_id
      LEFT JOIN union_clubs uc ON uc.club_id = sp.club_id
     WHERE sp.owner_kind = 'union'
  ),
  bbj AS (SELECT id, union_id FROM bbj_pools WHERE union_id IS NOT NULL),
  l AS (
    SELECT * FROM chip_ledger c
     WHERE c.created_at >= p_from AND c.created_at < p_to
       AND COALESCE(c.status, 'posted') = 'posted'
       AND (c.from_type IN ('union_bank','union_wallet','bbj_pool','spin_reserve')
         OR c.to_type   IN ('union_bank','union_wallet','bbj_pool','spin_reserve'))
  ),
  outs AS (
    SELECT l.id, l.created_at, 'out'::text AS side,
      CASE
        WHEN l.from_type = 'union_bank' THEN l.from_entity_id
        WHEN l.from_type = 'bbj_pool'   THEN (SELECT b.union_id FROM bbj b WHERE b.id = l.from_entity_id)
        WHEN l.from_type = 'spin_reserve' THEN (SELECT s.union_id FROM spin s WHERE s.id = l.from_entity_id)
        ELSE l.union_id END AS union_id,
      CASE
        WHEN l.from_type = 'union_bank' OR l.from_label = 'union_wallets.chip_balance' THEN 'union_bank'
        WHEN l.from_label = 'union_wallets.rake_wallet'  THEN 'rake_treasury'
        WHEN l.from_label = 'union_wallets.promo_wallet' THEN 'promo'
        WHEN l.from_label = 'union_wallets.spin_reserve_wallet' THEN 'spins_treasury'
        WHEN l.from_type = 'spin_reserve' THEN 'spins_treasury'
        WHEN l.from_type = 'bbj_pool' AND l.from_label = 'bbj_pools.backup_balance' THEN 'backup_bbj'
        WHEN l.from_type = 'bbj_pool' AND l.from_label = 'bbj_pools.main_balance'   THEN 'main_bbj'
      END AS wallet_key,
      l.amount, l.category, l.to_type, l.to_label, l.to_entity_id,
      l.performed_by, COALESCE(l.description, l.notes), l.post_from_balance,
      l.club_id, l.tournament_id
    FROM l
    WHERE l.from_type IN ('union_bank','union_wallet','bbj_pool','spin_reserve')
  ),
  ins AS (
    SELECT l.id, l.created_at, 'in'::text,
      CASE
        WHEN l.to_type = 'union_bank' THEN l.to_entity_id
        WHEN l.to_type = 'bbj_pool'   THEN (SELECT b.union_id FROM bbj b WHERE b.id = l.to_entity_id)
        WHEN l.to_type = 'spin_reserve' THEN (SELECT s.union_id FROM spin s WHERE s.id = l.to_entity_id)
        ELSE l.union_id END,
      CASE
        WHEN l.to_type = 'union_bank' OR l.to_label = 'union_wallets.chip_balance' THEN 'union_bank'
        WHEN l.to_label = 'union_wallets.rake_wallet'  THEN 'rake_treasury'
        WHEN l.to_label = 'union_wallets.promo_wallet' THEN 'promo'
        WHEN l.to_type = 'union_wallet' AND l.to_label IS NULL AND l.category = 'promo' THEN 'promo'
        WHEN l.to_label = 'union_wallets.spin_reserve_wallet' THEN 'spins_treasury'
        WHEN l.to_type = 'spin_reserve' THEN 'spins_treasury'
        WHEN l.to_type = 'bbj_pool' AND l.to_label = 'bbj_pools.backup_balance' THEN 'backup_bbj'
        WHEN l.to_type = 'bbj_pool' AND l.to_label = 'bbj_pools.main_balance'   THEN 'main_bbj'
      END,
      l.amount, l.category, l.from_type, l.from_label, l.from_entity_id,
      l.performed_by, COALESCE(l.description, l.notes), l.post_to_balance,
      l.club_id, l.tournament_id
    FROM l
    WHERE l.to_type IN ('union_bank','union_wallet','bbj_pool','spin_reserve')
  )
  SELECT * FROM (SELECT * FROM outs UNION ALL SELECT * FROM ins) x
   WHERE x.union_id IS NOT NULL AND x.wallet_key IS NOT NULL
     AND EXISTS (SELECT 1 FROM unions u WHERE u.id = x.union_id);
$$;

-- Copy individual rows (every out, every one-off in) for a time range.
CREATE OR REPLACE FUNCTION public.fn_union_treasury_log_copy_rows(p_from timestamptz, p_to timestamptz)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n integer;
BEGIN
  INSERT INTO ca_union_treasury_log AS t (
    union_id, wallet_key, entry_kind, occurred_at, log_day, amount, category,
    counterparty_type, counterparty_label, counterparty_id, counterparty_name,
    performed_by, performed_by_name, description, balance_after,
    club_id, club_name, tournament_id, source_ledger_id)
  SELECT g.union_id, g.wallet_key, g.side, g.created_at,
         (g.created_at AT TIME ZONE 'America/Chicago')::date,
         g.amount, g.category, g.cp_type, g.cp_label, g.cp_id,
         COALESCE(p.username, p.display_name, cl.name, tn.name, un.name),
         g.performed_by, COALESCE(pb.username, pb.display_name),
         g.description, g.balance_after, g.club_id, c.name, g.tournament_id, g.ledger_id
    FROM fn_union_treasury_legs(p_from, p_to) g
    LEFT JOIN profiles p    ON p.id  = g.cp_id AND g.cp_type IN ('player_wallet','agent_wallet','promo_wallet')
    LEFT JOIN clubs cl      ON cl.id = g.cp_id AND g.cp_type IN ('club_treasury','club_wallet','club_bank')
    LEFT JOIN unions un     ON un.id = g.cp_id AND g.cp_type = 'union_bank'
    LEFT JOIN tournaments tn ON tn.id = COALESCE(g.tournament_id, CASE WHEN g.cp_type='prize_liability' THEN g.cp_id END)
    LEFT JOIN profiles pb   ON pb.id = g.performed_by
    LEFT JOIN clubs c       ON c.id  = g.club_id
   WHERE g.side = 'out' OR NOT fn_union_treasury_is_collection(g.category)
  ON CONFLICT (source_ledger_id, wallet_key, entry_kind) WHERE source_ledger_id IS NOT NULL
  DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- Sum one closed hour of collection into the hourly bricks, then rebuild
-- that Chicago day's single "In" row from its bricks.
CREATE OR REPLACE FUNCTION public.fn_union_treasury_log_close_hour(p_hour timestamptz)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_day  date := (p_hour AT TIME ZONE 'America/Chicago')::date;
  v_legs integer;
BEGIN
  DELETE FROM ca_union_treasury_hourly_ins WHERE hour_start = p_hour;

  WITH g AS MATERIALIZED (
    SELECT * FROM fn_union_treasury_legs(p_hour, p_hour + interval '1 hour')
  ), ins AS (
    INSERT INTO ca_union_treasury_hourly_ins (union_id, wallet_key, hour_start, category, amount, entries)
    SELECT union_id, wallet_key, p_hour, category, sum(amount), count(*)
      FROM g
     WHERE side = 'in' AND fn_union_treasury_is_collection(category)
     GROUP BY union_id, wallet_key, category
    RETURNING 1
  )
  SELECT count(*) INTO v_legs FROM g;

  -- Outs and one-off ins of this hour, in case the 30-minute tail missed them
  -- (backfill, or the tick was down).
  PERFORM fn_union_treasury_log_copy_rows(p_hour, p_hour + interval '1 hour');

  INSERT INTO ca_union_treasury_hours_done (hour_start, legs_seen) VALUES (p_hour, v_legs)
  ON CONFLICT (hour_start) DO UPDATE SET legs_seen = EXCLUDED.legs_seen, done_at = now();

  PERFORM fn_union_treasury_log_rebuild_day(v_day);
  RETURN v_legs;
END $$;

CREATE OR REPLACE FUNCTION public.fn_union_treasury_log_rebuild_day(p_day date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_start timestamptz := p_day::timestamp AT TIME ZONE 'America/Chicago';
  v_end   timestamptz := (p_day + 1)::timestamp AT TIME ZONE 'America/Chicago';
BEGIN
  INSERT INTO ca_union_treasury_log AS t (
    union_id, wallet_key, entry_kind, occurred_at, log_day, amount, category,
    entries, breakdown, description, updated_at)
  SELECT h.union_id, h.wallet_key, 'daily_in', v_end - interval '1 microsecond', p_day,
         sum(h.amount), 'daily_collection', sum(h.entries)::int,
         jsonb_object_agg(h.category, jsonb_build_object('amount', h.amount, 'entries', h.entries)),
         'Daily Total Collected', now()
    FROM (SELECT union_id, wallet_key, category, sum(amount) amount, sum(entries) entries
            FROM ca_union_treasury_hourly_ins
           WHERE hour_start >= v_start AND hour_start < v_end
           GROUP BY 1, 2, 3) h
   GROUP BY h.union_id, h.wallet_key
  ON CONFLICT (union_id, wallet_key, log_day) WHERE entry_kind = 'daily_in'
  DO UPDATE SET amount = EXCLUDED.amount, entries = EXCLUDED.entries,
                breakdown = EXCLUDED.breakdown, updated_at = now();
END $$;

-- The 5-minute tick: the tail of individual rows, then closed hours
-- (newest unclosed first, then backfill), within an 18 s budget.
CREATE OR REPLACE FUNCTION public.fn_union_treasury_log_tick()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_t0    timestamptz := clock_timestamp();
  v_st    ca_union_treasury_log_state%ROWTYPE;
  v_from  timestamptz;
  v_rows  integer := 0;
  v_hours integer := 0;
  v_hour  timestamptz;
  v_last_closed timestamptz := date_trunc('hour', now() - interval '15 minutes') - interval '1 hour';
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('ca_union_treasury_log_tick')) THEN
    RETURN 'busy';
  END IF;
  SET LOCAL statement_timeout = '60s';
  SELECT * INTO v_st FROM ca_union_treasury_log_state WHERE id = 1 FOR UPDATE;

  v_from := LEAST(COALESCE(v_st.last_tail_scan, now() - interval '30 minutes'),
                  now()) - interval '30 minutes';
  v_rows := fn_union_treasury_log_copy_rows(v_from, now());

  FOR v_hour IN
    SELECT gs FROM generate_series(v_last_closed, v_st.backfill_floor, interval '-1 hour') gs
     WHERE NOT EXISTS (SELECT 1 FROM ca_union_treasury_hours_done d WHERE d.hour_start = gs)
     ORDER BY gs DESC
  LOOP
    EXIT WHEN clock_timestamp() - v_t0 > interval '18 seconds';
    PERFORM fn_union_treasury_log_close_hour(v_hour);
    v_hours := v_hours + 1;
  END LOOP;

  UPDATE ca_union_treasury_log_state
     SET last_tail_scan = now(), last_tick_at = now(),
         last_tick_ms = (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::int,
         last_tick_note = format('%s rows, %s hours', v_rows, v_hours)
   WHERE id = 1;
  RETURN format('%s rows, %s hours', v_rows, v_hours);
END $$;

-- Read side. Restricted exactly like fn_promo_wallet_ledger (union staff).
CREATE OR REPLACE FUNCTION public.fn_union_treasury_log(
  p_union_id  uuid,
  p_wallet    text,
  p_kind      text        DEFAULT 'all',     -- all | ins | outs
  p_before    timestamptz DEFAULT NULL,
  p_before_id bigint      DEFAULT NULL,
  p_limit     integer     DEFAULT 50,
  p_category  text        DEFAULT NULL,
  p_search    text        DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_rows jsonb;
  v_summary jsonb;
  v_cats jsonb;
  v_today_in jsonb;
  v_through timestamptz;
  v_live numeric;
  v_live_n bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
     AND NOT public.fn_union_can_manage_wallets(p_union_id, v_actor)
     AND NOT EXISTS (SELECT 1 FROM union_admins ua WHERE ua.union_id = p_union_id AND ua.user_id = v_actor) THEN
    RETURN jsonb_build_object('authorized', false, 'error', 'The Treasury Log Is Restricted To Union Staff');
  END IF;
  IF p_wallet NOT IN ('union_bank','rake_treasury','backup_bbj','main_bbj','promo','spins_treasury') THEN
    RETURN jsonb_build_object('authorized', false, 'error', 'Unknown Union Wallet');
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.occurred_at DESC, r.id DESC), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT t.id, t.entry_kind, t.occurred_at, t.log_day, t.amount, t.category, t.entries,
             t.breakdown, t.counterparty_type, t.counterparty_label, t.counterparty_name,
             t.performed_by_name, t.description, t.balance_after, t.club_name, t.tournament_id
        FROM ca_union_treasury_log t
       WHERE t.union_id = p_union_id AND t.wallet_key = p_wallet
         AND NOT (t.entry_kind = 'daily_in' AND t.log_day >= v_today)
         AND (p_kind = 'all'
              OR (p_kind = 'outs' AND t.entry_kind = 'out')
              OR (p_kind = 'ins'  AND t.entry_kind IN ('in','daily_in')))
         AND (p_category IS NULL OR t.category = p_category)
         AND (p_search IS NULL OR p_search = ''
              OR t.counterparty_name ILIKE '%' || p_search || '%'
              OR t.performed_by_name ILIKE '%' || p_search || '%'
              OR t.description       ILIKE '%' || p_search || '%'
              OR t.club_name         ILIKE '%' || p_search || '%')
         AND (p_before IS NULL
              OR t.occurred_at < p_before
              OR (t.occurred_at = p_before AND t.id < coalesce(p_before_id, 9223372036854775807)))
       ORDER BY t.occurred_at DESC, t.id DESC
       LIMIT v_limit
    ) r;

  -- Today so far: closed hours plus a live read of the open tail.
  SELECT max(hour_start) + interval '1 hour' INTO v_through
    FROM ca_union_treasury_hours_done
   WHERE hour_start >= (v_today::timestamp AT TIME ZONE 'America/Chicago');
  v_through := coalesce(v_through, v_today::timestamp AT TIME ZONE 'America/Chicago');

  SELECT coalesce(sum(amount), 0), count(*) INTO v_live, v_live_n
    FROM fn_union_treasury_legs(v_through, now()) g
   WHERE g.union_id = p_union_id AND g.wallet_key = p_wallet
     AND g.side = 'in' AND fn_union_treasury_is_collection(g.category);

  SELECT jsonb_build_object(
           'amount', coalesce(sum(h.amount), 0) + v_live,
           'entries', coalesce(sum(h.entries), 0) + v_live_n,
           'as_of', now())
    INTO v_today_in
    FROM ca_union_treasury_hourly_ins h
   WHERE h.union_id = p_union_id AND h.wallet_key = p_wallet
     AND h.hour_start >= (v_today::timestamp AT TIME ZONE 'America/Chicago');

  SELECT jsonb_build_object(
    'today_in', v_today_in,
    'today_out', coalesce(sum(amount) FILTER (WHERE entry_kind='out' AND log_day = v_today), 0),
    'today_out_count', count(*) FILTER (WHERE entry_kind='out' AND log_day = v_today),
    'week_in',  coalesce(sum(amount) FILTER (WHERE entry_kind IN ('in','daily_in') AND log_day >= v_today - 6), 0)
                + coalesce((v_today_in->>'amount')::numeric, 0),
    'week_out', coalesce(sum(amount) FILTER (WHERE entry_kind='out' AND log_day >= v_today - 6), 0),
    'month_in', coalesce(sum(amount) FILTER (WHERE entry_kind IN ('in','daily_in') AND log_day >= v_today - 29), 0)
                + coalesce((v_today_in->>'amount')::numeric, 0),
    'month_out', coalesce(sum(amount) FILTER (WHERE entry_kind='out' AND log_day >= v_today - 29), 0))
    INTO v_summary
    FROM ca_union_treasury_log t
   WHERE t.union_id = p_union_id AND t.wallet_key = p_wallet
     AND t.log_day >= v_today - 29
     AND NOT (t.entry_kind = 'daily_in' AND t.log_day >= v_today);

  SELECT coalesce(jsonb_agg(DISTINCT t.category), '[]'::jsonb) INTO v_cats
    FROM ca_union_treasury_log t
   WHERE t.union_id = p_union_id AND t.wallet_key = p_wallet AND t.entry_kind = 'out'
     AND t.log_day >= v_today - 89;

  RETURN jsonb_build_object(
    'authorized', true, 'wallet', p_wallet, 'rows', v_rows,
    'has_more', jsonb_array_length(v_rows) = v_limit,
    'summary', v_summary, 'out_categories', v_cats,
    'logged_since', (SELECT backfill_floor FROM ca_union_treasury_log_state WHERE id = 1),
    'last_tick_at', (SELECT last_tick_at FROM ca_union_treasury_log_state WHERE id = 1));
END $$;

REVOKE ALL ON FUNCTION public.fn_union_treasury_legs(timestamptz, timestamptz) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_union_treasury_log_copy_rows(timestamptz, timestamptz) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_union_treasury_log_close_hour(timestamptz) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_union_treasury_log_rebuild_day(date) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_union_treasury_log_tick() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_union_treasury_log(uuid, text, text, timestamptz, bigint, integer, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_union_treasury_log(uuid, text, text, timestamptz, bigint, integer, text, text) TO authenticated, service_role;

-- periodic-work: the daily "In" row is a summary of closed Chicago hours by definition, so
-- building it on a clock is the product itself, not a repair of a missed write. Hooking every
-- rake and jackpot drop instead would add a write to each hand's money transaction.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ca-union-treasury-log-5m';
SELECT cron.schedule('ca-union-treasury-log-5m', '*/5 * * * *',
  $c$SELECT public.fn_union_treasury_log_tick()$c$);

COMMIT;
