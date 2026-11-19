-- 20261118194330_promo_winnings_are_checked_hourly_never_per_hand.sql
--
-- OWNER RULING (Dan, 2026-11-18 13:40 America/Chicago): promo progress "can
-- not and should not be checked after every hand, it should be updated once
-- per hour, and only for accounts with active promo chips."
--
-- periodic-work: the schedule IS the product. The owner ruled that promo
-- winnings are settled hourly instead of inside every hand; nothing upstream
-- fails and this job compensates for nothing. A cash-out still settles its
-- own account at the moment chips leave (fn_ca_promo_play_through_on_exit).
--
-- BEFORE: the deferred trigger ca_promo_profit_original_cash_fee on
-- rake_attributions ran fn_ca_promo_profit_settle for the player of every
-- raked cash hand whose account held a locked promo winnings gate. Measured
-- that day: 89,488 calls, 28,915 s of database time, ~141,000 buffer hits per
-- call (323 ms mean, 42 s worst), and a busy member scope ABORTED the fee
-- transaction. 886 accounts qualified, 874 of them horses holding Free Buy
-- promo_ticket_prize grants.
--
-- AFTER: a hand never runs the promo winnings settle. One sweep settles each
-- account that still has a locked winnings gate at most once per hour, in
-- short time-boxed runs so it never holds a member scope across accounts and
-- never outlives the statement timeout. Nothing is released earlier than
-- before: the settle is the same function, only its trigger moved. The exit
-- path (fn_ca_promo_play_through_on_exit) is untouched and still settles at
-- the moment chips leave a wallet, so a cash-out always sees a fresh answer.
--
-- Installed on production by hand at 2026-11-18 19:43 UTC during the lag
-- incident; this file is that installation, idempotent.

CREATE TABLE IF NOT EXISTS public.ca_promo_profit_sweep_state (
  club_id       uuid        NOT NULL,
  user_id       uuid        NOT NULL,
  last_swept_at timestamptz NOT NULL,
  last_ms       integer,
  last_error    text,
  PRIMARY KEY (club_id, user_id)
);
ALTER TABLE public.ca_promo_profit_sweep_state ENABLE ROW LEVEL SECURITY;
-- Only the sweep (its owner) reads or writes this table.
REVOKE ALL ON TABLE public.ca_promo_profit_sweep_state FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE PROCEDURE public.sp_ca_promo_profit_hourly_sweep(p_budget_seconds integer DEFAULT 60)
LANGUAGE plpgsql
AS $proc$
DECLARE
  r        record;
  t_start  timestamptz := clock_timestamp();
  t0       timestamptz;
  v_err    text;
  v_budget integer := GREATEST(5, LEAST(COALESCE(p_budget_seconds, 60), 100));
  v_key    integer := hashtext('ca-promo-profit-hourly-sweep');
BEGIN
  -- The :55 freeze stops everything; so does this.
  IF public.fn_platform_frozen() THEN RETURN; END IF;
  -- One sweep at a time. Session scope, because every account commits alone.
  IF NOT pg_try_advisory_lock(v_key) THEN RETURN; END IF;

  FOR r IN
    SELECT a.club_id, a.user_id
      FROM (
        SELECT DISTINCT g.club_id, g.user_id
          FROM public.ca_promo_play_through_grants g
          JOIN public.ca_promo_profit_gates w ON w.grant_id = g.id
         WHERE w.unlocked_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM public.ca_promo_profit_overrides o
                            WHERE o.grant_id = g.id)
      ) a
      LEFT JOIN public.ca_promo_profit_sweep_state s
        ON s.club_id = a.club_id AND s.user_id = a.user_id
     WHERE s.last_swept_at IS NULL
        OR s.last_swept_at <= clock_timestamp() - interval '1 hour'
     ORDER BY s.last_swept_at NULLS FIRST, a.club_id, a.user_id
  LOOP
    EXIT WHEN clock_timestamp() - t_start > make_interval(secs => v_budget);
    EXIT WHEN public.fn_platform_frozen();
    t0 := clock_timestamp();
    v_err := NULL;
    BEGIN
      -- Never queue behind a cash-out: a busy account is retried next run.
      PERFORM set_config('lock_timeout', '2s', true);
      IF pg_try_advisory_xact_lock(hashtextextended(
           'ca_promo_play_through:' || r.club_id::text || ':' || r.user_id::text, 0)) THEN
        PERFORM public.fn_ca_promo_profit_settle(r.club_id, r.user_id);
      ELSE
        v_err := 'busy';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_err := CASE WHEN SQLSTATE = '55P03' THEN 'busy' ELSE left(SQLERRM, 500) END;
    END;
    IF v_err IS DISTINCT FROM 'busy' THEN
      INSERT INTO public.ca_promo_profit_sweep_state AS st
        (club_id, user_id, last_swept_at, last_ms, last_error)
      VALUES (r.club_id, r.user_id, clock_timestamp(),
              (extract(epoch FROM clock_timestamp() - t0) * 1000)::integer, v_err)
      ON CONFLICT (club_id, user_id) DO UPDATE
        SET last_swept_at = EXCLUDED.last_swept_at,
            last_ms       = EXCLUDED.last_ms,
            last_error    = EXCLUDED.last_error;
    END IF;
    COMMIT;
  END LOOP;

  PERFORM pg_advisory_unlock(v_key);
END
$proc$;
REVOKE ALL ON PROCEDURE public.sp_ca_promo_profit_hourly_sweep(integer) FROM PUBLIC, anon, authenticated, service_role;

-- The per-hand settle retires. The trigger stays wired so nothing that names
-- it breaks; its body no longer does any promo work.
CREATE OR REPLACE FUNCTION public.fn_ca_promo_profit_after_original_fee()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 -- Owner ruling 2026-11-18: promo winnings are never checked per hand.
 -- sp_ca_promo_profit_hourly_sweep settles each account that still holds a
 -- locked winnings gate once per hour; the exit path settles at cash-out.
 RETURN NULL;
END $function$;

SELECT cron.schedule(
  'ca-promo-profit-hourly-sweep',
  '*/2 * * * *',
  'CALL public.sp_ca_promo_profit_hourly_sweep(60)'
);
