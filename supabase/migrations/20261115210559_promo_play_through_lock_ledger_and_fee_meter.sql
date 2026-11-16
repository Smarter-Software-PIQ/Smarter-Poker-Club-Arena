-- 20261115210559_promo_play_through_lock_ledger_and_fee_meter.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Owner ruling, November 15, 2026: "WHEN A PLAYER RECEIVES PROMO CHIPS, WE NEED
-- TO HAVE PLAY THROUGH LIMIT OF 4X ON ANY PROMO CHIPS BEFORE THEY CAN BE CASHED
-- OUT... SO IF A PLAYER RECEIVES 50 PROMO CHIPS, THEY NEED TO EARN 200 CHIPS IN
-- FEE'S BEFORE THOSE 50 CHIPS CAN BE CASHED OUT OR CLAIMED BACK BY AN AGENT.
-- ... THEY CAN CASH OUT PROFIT, BUT NOT THE FREE PLAY UNTIL THE ENTIRE
-- REQUIREMEMENT IS MET."
--
-- Measured the same day: 0 of 2,587 memberships held a locked promo balance.
-- Every promo door credits club_members.chip_balance directly, so the older
-- promo_balance / promo_playthrough_required columns are never set, and the
-- older meter counted chips put in the pot, not fees.
--
-- This is phase 1 of 5: the record of each promo grant and the fee meter that
-- measures it. It moves no chips, changes no existing function and takes no
-- lock on a live table. Nothing writes a grant until phase 2 wires the promo
-- doors, and nothing is refused until phase 3 wires the exits, so installing
-- this file changes no behaviour.
--
-- THE METER WRITES NOTHING DURING PLAY. A player's fees are already recorded,
-- per hand and per entry, where rakeback reads them:
--   cash        public.rake_attributions (player_id, club_id, rake_amount)
--   tournament  public.accounting_tournament_fee_sources (player_id, club_id,
--               rake_credit), less the named negative refund rows in
--               public.rake_records for the same tournament
-- Progress is the sum of those rows since the player's current promo cycle
-- began. A hand settlement therefore never touches a play-through row, so the
-- meter cannot slow, block or deadlock a table, and a refunded fee leaves the
-- meter by itself.
--
-- THE RULE. Each grant locks its own amount and adds amount x multiplier to
-- the fee target (multiplier 4 by default, stored on the grant so a later
-- promotion can run at another figure). Grants a player holds at the same
-- time form one cycle: fees since the cycle began fill the oldest grant
-- first, and a grant is met once those fees reach the running target through
-- it. Locked = the unmet grants' remaining amounts. Everything above that in
-- the wallet is the player's to cash out.
--
-- Wrap ALL DDL for one change in ONE transaction (CLAUDE.md, production DDL
-- policy). No hot relation is locked: both tables are new, and neither has a
-- foreign key to a live table (rule 7).

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1. The dial. One row. enforced_from stays NULL until go-live (phase 5):
--    promo received before that moment is never locked.
-- ---------------------------------------------------------------------------
CREATE TABLE public.ca_promo_play_through_settings (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),
  multiplier    numeric NOT NULL DEFAULT 4
                CHECK (multiplier > 0 AND multiplier <= 100),
  expiry_days   integer NOT NULL DEFAULT 30
                CHECK (expiry_days BETWEEN 1 AND 3650),
  enforced_from timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid
);

COMMENT ON TABLE public.ca_promo_play_through_settings IS
  'Promo play-through dial (owner ruling 2026-11-15): default fee multiplier, days before an unmet grant expires, and the go-live moment. One row.';

INSERT INTO public.ca_promo_play_through_settings (id) VALUES (true);

ALTER TABLE public.ca_promo_play_through_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ca_promo_play_through_settings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ca_promo_play_through_settings TO service_role;

-- ---------------------------------------------------------------------------
-- 2. One row per promo grant. No foreign key to clubs, club_members or
--    chip_ledger: an orphan row here is harmless, a lock on those is not.
-- ---------------------------------------------------------------------------
CREATE TABLE public.ca_promo_play_through_grants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id           uuid NOT NULL,
  user_id           uuid NOT NULL,
  amount            numeric NOT NULL CHECK (amount > 0),
  remaining         numeric NOT NULL CHECK (remaining >= 0),
  multiplier        numeric NOT NULL CHECK (multiplier > 0 AND multiplier <= 100),
  fee_target        numeric GENERATED ALWAYS AS (round(amount * multiplier, 4)) STORED,
  source_kind       text NOT NULL CHECK (source_kind IN (
                      'union_promo', 'club_promo', 'agent_promo',
                      'wheel_prize', 'promo_ticket_prize',
                      'promo_ticket_redeem', 'other_promo')),
  source_ref        text NOT NULL,
  source_ledger_id  uuid,
  funded_from_type  text,
  funded_from_id    uuid,
  cycle_started_at  timestamptz NOT NULL,
  granted_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz,
  closed_at         timestamptz,
  close_reason      text CHECK (close_reason IN (
                      'met', 'expired', 'returned', 'override', 'spent', 'left_club')),
  closed_by         uuid,
  close_note        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ca_promo_play_through_grants_source_once UNIQUE (source_ref),
  CONSTRAINT ca_promo_play_through_grants_remaining_within_amount
    CHECK (remaining <= amount),
  CONSTRAINT ca_promo_play_through_grants_closed_has_reason
    CHECK ((closed_at IS NULL) = (close_reason IS NULL)),
  CONSTRAINT ca_promo_play_through_grants_cycle_not_after_grant
    CHECK (cycle_started_at <= granted_at)
);

COMMENT ON TABLE public.ca_promo_play_through_grants IS
  'One row per promo grant to a player or agent wallet (owner ruling 2026-11-15). amount is locked until the holder has paid fee_target in fees; remaining is what is still locked. Holds no balance and moves no chips.';

CREATE INDEX ca_promo_play_through_grants_open_member
  ON public.ca_promo_play_through_grants (club_id, user_id, granted_at, id)
  WHERE closed_at IS NULL;

CREATE INDEX ca_promo_play_through_grants_member_cycle
  ON public.ca_promo_play_through_grants (club_id, user_id, cycle_started_at);

CREATE INDEX ca_promo_play_through_grants_open_expiry
  ON public.ca_promo_play_through_grants (expires_at)
  WHERE closed_at IS NULL AND expires_at IS NOT NULL;

ALTER TABLE public.ca_promo_play_through_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ca_promo_play_through_grants FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ca_promo_play_through_grants TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The fee meter: what one member paid in fees in one club in a window.
--    Read-only. Cash rake share plus tournament fees net of named refunds.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_ca_promo_play_through_fees_between(
  p_club_id uuid,
  p_user_id uuid,
  p_from    timestamptz,
  p_to      timestamptz
) RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    COALESCE((
      SELECT sum(a.rake_amount)
        FROM public.rake_attributions a
       WHERE a.player_id = p_user_id
         AND a.club_id = p_club_id
         AND a.created_at >= p_from
         AND a.created_at < p_to
    ), 0)
    +
    COALESCE((
      SELECT sum(GREATEST(0, t.charged + COALESCE((
               SELECT sum(r.rake_amount)
                 FROM public.rake_records r
                WHERE r.tournament_id = t.tournament_id
                  AND r.is_tournament
                  AND r.rake_amount < 0
                  AND r.metadata ->> 'user_id' = p_user_id::text
             ), 0)))
        FROM (
          SELECT s.tournament_id, sum(s.rake_credit) AS charged
            FROM public.accounting_tournament_fee_sources s
           WHERE s.club_id = p_club_id
             AND s.player_id = p_user_id
             AND s.charged_at >= p_from
             AND s.charged_at < p_to
           GROUP BY s.tournament_id
        ) t
    ), 0);
$function$;

COMMENT ON FUNCTION public.fn_ca_promo_play_through_fees_between(uuid, uuid, timestamptz, timestamptz) IS
  'Fees one member paid in one club in [from, to): cash rake share (rake_attributions) plus tournament fees (accounting_tournament_fee_sources) net of that member''s named refunds. The promo play-through meter; read-only.';

-- ---------------------------------------------------------------------------
-- 4. Where every grant of the member's current cycle stands. Read-only.
--    state: met            closed as met
--           met_pending    fees reached its running target; not yet stamped
--           expired_pending  past expires_at without reaching it
--           locked         still locked
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_ca_promo_play_through_state(
  p_club_id uuid,
  p_user_id uuid
) RETURNS TABLE (
  grant_id         uuid,
  amount           numeric,
  remaining        numeric,
  fee_target       numeric,
  cum_target       numeric,
  cycle_started_at timestamptz,
  cycle_fees       numeric,
  granted_at       timestamptz,
  expires_at       timestamptz,
  state            text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cycle timestamptz;
  v_fees  numeric;
  v_now   timestamptz := clock_timestamp();
BEGIN
  SELECT min(g.cycle_started_at) INTO v_cycle
    FROM public.ca_promo_play_through_grants g
   WHERE g.club_id = p_club_id
     AND g.user_id = p_user_id
     AND g.closed_at IS NULL;

  IF v_cycle IS NULL THEN
    RETURN;
  END IF;

  v_fees := public.fn_ca_promo_play_through_fees_between(
    p_club_id, p_user_id, v_cycle, v_now);

  RETURN QUERY
  WITH g AS (
    SELECT gr.id, gr.amount, gr.remaining, gr.fee_target, gr.granted_at,
           gr.expires_at, gr.closed_at,
           sum(gr.fee_target) OVER (ORDER BY gr.granted_at, gr.id) AS cum_target
      FROM public.ca_promo_play_through_grants gr
     WHERE gr.club_id = p_club_id
       AND gr.user_id = p_user_id
       AND gr.cycle_started_at = v_cycle
       AND (gr.closed_at IS NULL OR gr.close_reason = 'met')
  )
  SELECT g.id, g.amount, g.remaining, g.fee_target, g.cum_target,
         v_cycle, v_fees, g.granted_at, g.expires_at,
         CASE
           WHEN g.closed_at IS NOT NULL THEN 'met'
           WHEN v_fees >= g.cum_target
                AND (g.expires_at IS NULL
                     OR g.expires_at > v_now
                     OR public.fn_ca_promo_play_through_fees_between(
                          p_club_id, p_user_id, v_cycle, g.expires_at) >= g.cum_target)
             THEN 'met_pending'
           WHEN g.expires_at IS NOT NULL AND g.expires_at <= v_now THEN 'expired_pending'
           ELSE 'locked'
         END
    FROM g
   ORDER BY g.granted_at, g.id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Stamp the grants the meter says are met. Called by the promo doors
--    (phase 2) and the exits (phase 3), never by a hand settlement and never
--    on a schedule. Serialised per member.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_ca_promo_play_through_settle(
  p_club_id uuid,
  p_user_id uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_closed integer := 0;
BEGIN
  IF p_club_id IS NULL OR p_user_id IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('ca_promo_play_through:' || p_club_id::text || ':' || p_user_id::text, 0));

  UPDATE public.ca_promo_play_through_grants g
     SET closed_at = clock_timestamp(),
         close_reason = 'met',
         remaining = 0
    FROM public.fn_ca_promo_play_through_state(p_club_id, p_user_id) s
   WHERE g.id = s.grant_id
     AND s.state = 'met_pending'
     AND g.closed_at IS NULL;
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  RETURN v_closed;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Record one grant. Idempotent on source_ref. Before go-live it records
--    nothing, so promo already in wallets is never locked after the fact.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_ca_promo_play_through_record_grant(
  p_club_id          uuid,
  p_user_id          uuid,
  p_amount           numeric,
  p_source_kind      text,
  p_source_ref       text,
  p_source_ledger_id uuid DEFAULT NULL,
  p_funded_from_type text DEFAULT NULL,
  p_funded_from_id   uuid DEFAULT NULL,
  p_multiplier       numeric DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_settings public.ca_promo_play_through_settings%ROWTYPE;
  v_now      timestamptz := clock_timestamp();
  v_cycle    timestamptz;
  v_id       uuid;
BEGIN
  IF p_club_id IS NULL OR p_user_id IS NULL
     OR p_amount IS NULL OR p_amount <= 0
     OR p_source_ref IS NULL OR btrim(p_source_ref) = '' THEN
    RAISE EXCEPTION 'promo play-through grant needs a club, a member, a positive amount and a source reference';
  END IF;

  SELECT * INTO v_settings FROM public.ca_promo_play_through_settings WHERE id;
  IF NOT FOUND OR v_settings.enforced_from IS NULL OR v_now < v_settings.enforced_from THEN
    RETURN NULL;
  END IF;

  SELECT g.id INTO v_id
    FROM public.ca_promo_play_through_grants g
   WHERE g.source_ref = p_source_ref;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  -- Takes the member's advisory lock and closes whatever is already met, so
  -- a finished cycle never lends its old fees to a new grant.
  PERFORM public.fn_ca_promo_play_through_settle(p_club_id, p_user_id);

  SELECT min(g.cycle_started_at) INTO v_cycle
    FROM public.ca_promo_play_through_grants g
   WHERE g.club_id = p_club_id
     AND g.user_id = p_user_id
     AND g.closed_at IS NULL;

  INSERT INTO public.ca_promo_play_through_grants (
    club_id, user_id, amount, remaining, multiplier, source_kind, source_ref,
    source_ledger_id, funded_from_type, funded_from_id,
    cycle_started_at, granted_at, expires_at
  ) VALUES (
    p_club_id, p_user_id, p_amount, p_amount,
    COALESCE(p_multiplier, v_settings.multiplier),
    p_source_kind, p_source_ref,
    p_source_ledger_id, p_funded_from_type, p_funded_from_id,
    COALESCE(v_cycle, v_now), v_now,
    v_now + make_interval(days => v_settings.expiry_days)
  )
  ON CONFLICT ON CONSTRAINT ca_promo_play_through_grants_source_once DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT g.id INTO v_id
      FROM public.ca_promo_play_through_grants g
     WHERE g.source_ref = p_source_ref;
  END IF;

  RETURN v_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. The one figure every reader shares: what is locked, how far the fees
--    have come, and what the wallet can release. Read-only.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_ca_promo_play_through_summary(
  p_club_id uuid,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_locked      numeric := 0;
  v_target      numeric := 0;
  v_fees        numeric := 0;
  v_open        integer := 0;
  v_next_expiry timestamptz;
  v_balance     numeric := 0;
  v_progress    numeric := 0;
BEGIN
  SELECT COALESCE(sum(s.remaining) FILTER (WHERE s.state IN ('locked', 'expired_pending')), 0),
         COALESCE(max(s.cum_target), 0),
         COALESCE(max(s.cycle_fees), 0),
         count(*) FILTER (WHERE s.state IN ('locked', 'expired_pending')),
         min(s.expires_at) FILTER (WHERE s.state = 'locked')
    INTO v_locked, v_target, v_fees, v_open, v_next_expiry
    FROM public.fn_ca_promo_play_through_state(p_club_id, p_user_id) s;

  SELECT COALESCE(m.chip_balance, 0) INTO v_balance
    FROM public.club_members m
   WHERE m.club_id = p_club_id AND m.user_id = p_user_id;

  v_balance  := COALESCE(v_balance, 0);
  v_progress := LEAST(v_fees, v_target);

  RETURN jsonb_build_object(
    'locked',        v_locked,
    'open_grants',   v_open,
    'fee_target',    v_target,
    'fee_progress',  v_progress,
    'fee_remaining', GREATEST(v_target - v_progress, 0),
    'percent',       CASE WHEN v_locked <= 0 THEN 100
                          WHEN v_target <= 0 THEN 0
                          ELSE LEAST(99, floor(100 * v_progress / v_target)::integer) END,
    'wallet',        v_balance,
    'cashable',      GREATEST(v_balance - v_locked, 0),
    'next_expiry_at', v_next_expiry
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. The member's own figure, for the wallet and cash-out screens (phase 4).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_ca_my_promo_play_through(
  p_club_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not Authenticated');
  END IF;
  IF p_club_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.club_members m
        WHERE m.club_id = p_club_id AND m.user_id = v_me) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not A Member Of This Club');
  END IF;
  RETURN jsonb_build_object('success', true)
         || public.fn_ca_promo_play_through_summary(p_club_id, v_me);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_promo_play_through_fees_between(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_promo_play_through_state(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_promo_play_through_settle(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_promo_play_through_record_grant(uuid, uuid, numeric, text, text, uuid, text, uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_promo_play_through_summary(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_my_promo_play_through(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fn_ca_promo_play_through_fees_between(uuid, uuid, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_promo_play_through_state(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_promo_play_through_settle(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_promo_play_through_record_grant(uuid, uuid, numeric, text, text, uuid, text, uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_promo_play_through_summary(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_my_promo_play_through(uuid) TO authenticated, service_role;

COMMIT;
