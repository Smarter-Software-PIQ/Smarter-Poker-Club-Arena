-- THE SPIN RESERVE GAUGE READS EACH TABLE ONCE.
--
-- v_spin_reserve_health is the gauge the spin-sweep cron and the operator
-- monitor read. It returns one row per spin_bonus_pools row (3,991 today) and
-- computed its four alarm counters with correlated subqueries: for every pool,
-- four separate scans of spin_reserve_ledger or tournaments, each filtered on
-- fn_spin_reserve_owner(club_id) = p.club_id. That function call cannot use an
-- index, so every pool re-read the last day of spins and adjustments. Postgres
-- logged 93 statement timeouts on this view in the 24 hours to
-- 2026-11-26 19:00 UTC, the largest single source of timeouts in the database,
-- and a timed-out read means the alarm it feeds never ran.
--
-- The counters are unchanged in meaning. Each table is now read once, grouped
-- by owner, and joined back to the pools:
--   shortfall_events     adjustment rows whose note says SHORTFALL, last 24 h
--   unbooked_24h         fee-free spins with no ledger row, last 24 h
--   null_multiplier_24h  spins with no multiplier, last 24 h
--   fee_violations_24h   spins that charged a buy-in fee, last 24 h
-- Every column keeps its name, order and type (the counters stay bigint), so
-- every reader is unaffected. Measured on production before this change: the
-- same select returns all 3,991 rows in 88 ms; the old definition did not
-- finish inside 90 s.
--
-- security_invoker stays on, and only postgres and service_role can read it.
-- ROLLBACK: restore the definition in 20260831070000_a_repair_is_not_a_shortfall.sql.
-- @live-proof: (SELECT pg_get_viewdef('public.v_spin_reserve_health'::regclass) LIKE '%WITH shortfall AS%' AND pg_get_viewdef('public.v_spin_reserve_health'::regclass) LIKE '%GROUP BY%' AND (SELECT reloptions @> ARRAY['security_invoker=true'] FROM pg_class WHERE oid = 'public.v_spin_reserve_health'::regclass) AND NOT has_table_privilege('authenticated', 'public.v_spin_reserve_health', 'SELECT') AND NOT has_table_privilege('anon', 'public.v_spin_reserve_health', 'SELECT') AND has_table_privilege('service_role', 'public.v_spin_reserve_health', 'SELECT'))

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

CREATE OR REPLACE VIEW public.v_spin_reserve_health AS
 WITH shortfall AS (
         -- A REPAIR IS NOT A SHORTFALL (2026-08-31): only notes that say
         -- SHORTFALL count, and only for 24 hours, like every sibling.
         SELECT fn_spin_reserve_owner(l.club_id) AS owner_id,
            count(*) AS n
           FROM spin_reserve_ledger l
          WHERE l.kind = 'adjustment'::text
            AND l.note ILIKE '%SHORTFALL%'
            AND l.created_at > (now() - '24:00:00'::interval)
          GROUP BY (fn_spin_reserve_owner(l.club_id))
        ), spins AS (
         SELECT fn_spin_reserve_owner(t.club_id) AS owner_id,
            count(*) FILTER (WHERE COALESCE(t.buy_in_fee, 0::numeric) = 0::numeric
                               AND NOT (EXISTS ( SELECT 1
                                                   FROM spin_reserve_ledger l2
                                                  WHERE l2.tournament_id = t.id))) AS unbooked,
            count(*) FILTER (WHERE COALESCE(t.spin_multiplier, 0::numeric) <= 0::numeric) AS null_multiplier,
            count(*) FILTER (WHERE COALESCE(t.buy_in_fee, 0::numeric) <> 0::numeric) AS fee_violations
           FROM tournaments t
          WHERE t.variant = 'spin'::text
            AND (t.status = ANY (ARRAY['RUNNING'::text, 'COMPLETED'::text]))
            AND t.started_at > (now() - '24:00:00'::interval)
          GROUP BY (fn_spin_reserve_owner(t.club_id))
        )
 SELECT p.club_id,
    COALESCE(c.name, u.name) AS club_name,
    p.balance,
    p.seeded_amount,
    p.highest_stake,
    p.ceiling_amount,
    p.spin_count,
    p.total_deposited,
    p.total_drawn,
    round(p.highest_stake * 100::numeric * 1.5, 2) AS need_for_100x,
    p.balance >= (p.highest_stake * 100::numeric * 1.5) AS can_draw_100x,
    p.balance < (p.highest_stake * 10::numeric) AS is_thin,
    COALESCE(sf.n, 0::bigint) AS shortfall_events,
    COALESCE(s.unbooked, 0::bigint) AS unbooked_24h,
    COALESCE(s.null_multiplier, 0::bigint) AS null_multiplier_24h,
    COALESCE(s.fee_violations, 0::bigint) AS fee_violations_24h
   FROM spin_bonus_pools p
     LEFT JOIN clubs c ON c.id = p.club_id
     LEFT JOIN unions u ON u.id = p.club_id
     LEFT JOIN shortfall sf ON sf.owner_id = p.club_id
     LEFT JOIN spins s ON s.owner_id = p.club_id;

ALTER VIEW public.v_spin_reserve_health SET (security_invoker = true);
REVOKE ALL ON public.v_spin_reserve_health FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_spin_reserve_health TO service_role;

DO $post$
DECLARE
  v_pools bigint;
  v_rows bigint;
  v_started timestamptz := clock_timestamp();
  v_ms numeric;
BEGIN
  SELECT count(*) INTO v_pools FROM public.spin_bonus_pools;
  SELECT count(*) INTO v_rows
    FROM public.v_spin_reserve_health
   WHERE shortfall_events >= 0 AND unbooked_24h >= 0
     AND null_multiplier_24h >= 0 AND fee_violations_24h >= 0;
  v_ms := extract(epoch FROM clock_timestamp() - v_started) * 1000;

  IF v_rows <> v_pools THEN
    RAISE EXCEPTION 'v_spin_reserve_health returned % rows for % pools', v_rows, v_pools;
  END IF;
  IF v_ms > 5000 THEN
    RAISE EXCEPTION 'v_spin_reserve_health still takes % ms to read', round(v_ms);
  END IF;

  IF (SELECT array_agg(attname::text ORDER BY attnum)
        FROM pg_attribute
       WHERE attrelid = 'public.v_spin_reserve_health'::regclass
         AND attnum > 0 AND NOT attisdropped)
     IS DISTINCT FROM ARRAY['club_id', 'club_name', 'balance', 'seeded_amount',
       'highest_stake', 'ceiling_amount', 'spin_count', 'total_deposited',
       'total_drawn', 'need_for_100x', 'can_draw_100x', 'is_thin',
       'shortfall_events', 'unbooked_24h', 'null_multiplier_24h',
       'fee_violations_24h'] THEN
    RAISE EXCEPTION 'v_spin_reserve_health columns changed';
  END IF;

  IF has_table_privilege('authenticated', 'public.v_spin_reserve_health', 'SELECT')
     OR has_table_privilege('anon', 'public.v_spin_reserve_health', 'SELECT') THEN
    RAISE EXCEPTION 'a browser role can read v_spin_reserve_health';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.v_spin_reserve_health', 'SELECT') THEN
    RAISE EXCEPTION 'service_role lost SELECT on v_spin_reserve_health';
  END IF;
END $post$;

COMMIT;
