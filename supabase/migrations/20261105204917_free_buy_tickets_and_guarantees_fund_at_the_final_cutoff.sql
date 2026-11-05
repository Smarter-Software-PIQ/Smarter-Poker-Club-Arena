-- 20261105204917_free_buy_tickets_and_guarantees_fund_at_the_final_cutoff
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-05.
--
-- FREE BUY TICKETS, AND A FREE BUY IS FUNDED ONLY AT ITS FINAL CUTOFF
-- (owner ruling, 2026-11-05 14:24 America/Chicago; supersedes "the promo
-- wallet pays 1 chip into the pool at signup" from 20261105035220).
--
-- THE RULES THIS INSTALLS
--
--  Tickets.
--   * Every Club Arena user is granted FIVE Free Buy tickets per tournament
--     day, one per daily Free Buy. Per user, not per club, device or session.
--     A daily job grants every account (offline accounts included); a user
--     who joins after it runs is granted that day's five on first use. The
--     grant row's primary key (user_id, ticket_day) makes it exactly once.
--   * The tournament day is the operating day of the daily window
--     (smarter_private.daily_window_policy): the day turns over at
--     window_start, 04:00 America/Chicago. So the 12:30 AM Midnight Free Buy
--     belongs to the PREVIOUS calendar day: it is that day's fifth Free Buy
--     (Friday 00:30 uses a Thursday ticket). fn_ca_free_buy_ticket_day.
--   * A ticket covers the user's FIRST entry into any Free Buy, guaranteed or
--     not; one ticket per user per event (unique (tournament_id, user_id)).
--     Rebuys, re-entries after the first entry and add-ons are paid from the
--     player's wallet by the unchanged purchase owner; a ticket never pays
--     for them.
--   * Issuing a ticket moves no chips. An unused ticket pays nothing.
--   * Unregister / cancellation of an unplayed entry restores its ticket
--     (the existing unplayed-return rule; no new expiry, carryover or
--     transfer rule is invented: a ticket is good for the Free Buys of its
--     own tournament day and is not transferable).
--   * Retries, reconnects and concurrent requests cannot double grant or
--     double redeem: the grant row is locked FOR UPDATE for each redemption
--     and redemptions are unique per (event, user); every redeem/restore is
--     appended to an immutable event log.
--
--  Funding (applies at the FINAL CUTOFF, i.e. inside fn_apply_prize_guarantee,
--  which runs only when the prize pool finalizes; the existing finalization
--  window guard refuses that until registration AND every rebuy and add-on
--  window has closed).
--   G = the advertised buy-in guarantee (tournaments.guaranteed_prize),
--   C = the FULL qualifying player-wallet payments (entries, rebuys, add-ons)
--       BEFORE any bounty or rake allocation (owner 2026-11-05: a 40-chip
--       payment split 26 prize / 10 bounty / 4 rake counts 40), net of
--       refunds; c = the prize-pool share of those payments.
--   Guaranteed Free Buy:      U = max(0, G - C), P = c + U. Tickets add 0.
--                             (No bounty or rake: P = max(G, C).)
--   Non-guaranteed Free Buy:  V = 1 chip x valid first-entry redemptions,
--                             P = V + C, U = V.
--   U comes from the Midway Union promo wallet, never earlier. At the cutoff:
--   lock the lane and the event row (consistent snapshot), compute P and U,
--   subtract what was already recorded (pre-ticket promo chips), transfer
--   only the remainder (or return an excess with a compensating entry before
--   anything is paid), and record the funding row. Re-running gives the same
--   result and moves nothing twice. fn_ca_free_buy_cutoff_terms holds the
--   arithmetic; fn_ca_free_buy_fund_at_cutoff the money.
--   Other guaranteed tournaments keep their own guarantee source (union bank
--   or club treasury) through the unchanged close-out core, which already
--   computes max(guarantee, collected) at the same cutoff.
--
--  Bounties. The prize pool and the bounty pool stay separate. A PKO ticket
--  entry carries its 1-chip head and a Mystery ticket entry its 0.50 bounty
--  share (owner: entries, rebuys and add-ons split 50/50). A bounty head is
--  live from the first hand and is paid at each knockout, so that share is
--  booked from the promo wallet when the head is created; only the
--  PRIZE-POOL share waits for the cutoff. The players' bounty and rake
--  payments count toward the guarantee (C) but stay in their own pools;
--  nothing is counted twice and no bounty money is ever moved into the prize
--  pool. Promo-funded heads are the house's money and never count in C.
--
--  Rollout compatibility. Every registration already standing in an
--  unfinalized Free Buy when this installs gets an auditable
--  'rollout_compat' redemption: it keeps its free first entry, is not charged
--  and is not refused, and does not use one of the user's five tickets. Its
--  promo chip already in the pool counts as "already recorded" at the cutoff.
--
-- WHAT IT CHANGES
--  1. New: ca_free_buy_ticket_grants, ca_free_buy_ticket_redemptions,
--     ca_free_buy_ticket_events (append-only), ca_free_buy_cutoff_fundings.
--  2. New: fn_ca_free_buy_ticket_day, fn_ca_free_buy_ticket_parts,
--     fn_ca_free_buy_cutoff_terms, fn_ca_free_buy_ticket_redeem,
--     fn_ca_free_buy_ticket_restore, fn_ca_grant_daily_free_buy_tickets,
--     fn_my_free_buy_tickets, fn_ca_free_buy_fund_at_cutoff.
--  3. fn_ca_midway_free_buy_promo_head: a new entry redeems a ticket and books
--     only the bounty share; the return path restores the ticket and reverses
--     exactly what that registration's own funding leg booked (old 1-chip
--     legs included).
--  4. Both registration doors book the ticket parts (prize 0 at the till).
--  5. fn_apply_prize_guarantee funds a Free Buy at the cutoff before the core.
-- Every replaced definition is md5-guarded against production as read
-- 2026-11-05; no wallet balance moves in this migration.
-- Native proof: scripts/ci/test-free-buy-tickets.py
--
-- @live-proof: to_regclass('public.ca_free_buy_ticket_grants') IS NOT NULL AND position('fn_ca_free_buy_fund_at_cutoff' IN pg_get_functiondef('public.fn_apply_prize_guarantee(uuid,text)'::regprocedure))>0 AND position('fn_ca_free_buy_ticket_redeem' IN pg_get_functiondef('public.fn_ca_midway_free_buy_promo_head(uuid,uuid,boolean)'::regprocedure))>0 AND EXISTS(SELECT 1 FROM cron.job WHERE jobname='free-buy-daily-tickets')
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='30s';

DO $pre$ BEGIN
 IF (SELECT md5(pg_get_functiondef('public.fn_ca_midway_free_buy_promo_head(uuid,uuid,boolean)'::regprocedure)))
    IS DISTINCT FROM '06d23281112741c264d32ad820016914' THEN
   RAISE EXCEPTION 'Inspected definition changed: fn_ca_midway_free_buy_promo_head'; END IF;
 IF (SELECT md5(pg_get_functiondef('public.fn_register_for_tournament_before_atomic_capacity_20260907(uuid,boolean)'::regprocedure)))
    IS DISTINCT FROM '6663ababb3cb55bdac1ada33492c281f' THEN
   RAISE EXCEPTION 'Inspected definition changed: fn_register_for_tournament_before_atomic_capacity_20260907'; END IF;
 IF (SELECT md5(pg_get_functiondef('public.fn_register_horse_for_tournament_before_maintenance_gate(uuid,uuid)'::regprocedure)))
    IS DISTINCT FROM 'bc2a3c2c25cb278b4d3b96684fdb9607' THEN
   RAISE EXCEPTION 'Inspected definition changed: fn_register_horse_for_tournament_before_maintenance_gate'; END IF;
 IF (SELECT md5(pg_get_functiondef('public.fn_apply_prize_guarantee(uuid,text)'::regprocedure)))
    IS DISTINCT FROM '8a2517fe8bdbff92348821650c418507' THEN
   RAISE EXCEPTION 'Inspected definition changed: fn_apply_prize_guarantee'; END IF;
 IF to_regclass('public.ca_free_buy_ticket_grants') IS NOT NULL THEN
   RAISE EXCEPTION 'Free Buy tickets already installed'; END IF;
END $pre$;

-- Private money owners are registered before their CREATE statements.
INSERT INTO public.ca_money_rpc_registry(proname,status,notes) VALUES
 ('fn_ca_free_buy_fund_at_cutoff','approved','Private Free Buy cutoff funding: under the settlement lane and event row lock computes P and U (guaranteed U=max(0,G-C) on the full player payments C incl. bounty and rake, P=c+U; otherwise P=V+c, U=V), subtracts promo chips already recorded, moves only the remainder between the Midway promo wallet and prize escrow with one journaled leg, records one funding row; idempotent.')
ON CONFLICT(proname) DO NOTHING;

-- ── 1. Tables ───────────────────────────────────────────────────────────────
CREATE TABLE public.ca_free_buy_ticket_grants(
  user_id uuid NOT NULL,
  ticket_day date NOT NULL,
  tickets smallint NOT NULL DEFAULT 5 CHECK (tickets = 5),
  granted_by text NOT NULL CHECK (granted_by IN ('daily_grant','first_use')),
  granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, ticket_day));
COMMENT ON TABLE public.ca_free_buy_ticket_grants IS
 'Five Free Buy tickets per user per tournament day (owner 2026-11-05). One row per (user, day): granted exactly once. Issuing moves no chips.';

CREATE TABLE public.ca_free_buy_ticket_redemptions(
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tournament_id uuid NOT NULL,
  user_id uuid NOT NULL,
  ticket_day date NOT NULL,
  registration_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ticket','rollout_compat')),
  status text NOT NULL CHECK (status IN ('redeemed','restored')),
  redeemed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  restored_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tournament_id, user_id));
CREATE INDEX ca_free_buy_ticket_redemptions_user_day
  ON public.ca_free_buy_ticket_redemptions(user_id, ticket_day) WHERE status='redeemed';
COMMENT ON TABLE public.ca_free_buy_ticket_redemptions IS
 'The current state of each user''s single Free Buy ticket use per event. History is in ca_free_buy_ticket_events.';

CREATE TABLE public.ca_free_buy_ticket_events(
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  redemption_id uuid NOT NULL,
  tournament_id uuid NOT NULL,
  user_id uuid NOT NULL,
  ticket_day date NOT NULL,
  registration_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('redeem','restore','rollout_compat')),
  kind text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE INDEX ca_free_buy_ticket_events_tournament ON public.ca_free_buy_ticket_events(tournament_id);

CREATE TABLE public.ca_free_buy_cutoff_fundings(
  tournament_id uuid NOT NULL PRIMARY KEY,
  guaranteed boolean NOT NULL,
  guarantee numeric(18,2) NOT NULL,
  wallet_chips numeric(18,2) NOT NULL,
  wallet_gross numeric(18,2) NOT NULL,
  valid_tickets integer NOT NULL,
  ticket_prize_part numeric(6,2) NOT NULL,
  prize_pool numeric(18,2) NOT NULL,
  promo_support numeric(18,2) NOT NULL,
  recorded_before numeric(18,2) NOT NULL,
  moved numeric(18,2) NOT NULL,
  ledger_idempotency_key text,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
COMMENT ON TABLE public.ca_free_buy_cutoff_fundings IS
 'One row per Free Buy at its final cutoff: G, C, valid tickets, P, U, what was already recorded and what moved.';

CREATE FUNCTION public.fn_ca_free_buy_history_is_append_only()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public','pg_temp'
AS $f$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE='55000';
END
$f$;
CREATE TRIGGER ca_free_buy_ticket_events_append_only BEFORE UPDATE OR DELETE ON public.ca_free_buy_ticket_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_free_buy_history_is_append_only();
CREATE TRIGGER ca_free_buy_cutoff_fundings_append_only BEFORE UPDATE OR DELETE ON public.ca_free_buy_cutoff_fundings
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_free_buy_history_is_append_only();
CREATE TRIGGER ca_free_buy_ticket_grants_append_only BEFORE UPDATE OR DELETE ON public.ca_free_buy_ticket_grants
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_free_buy_history_is_append_only();

ALTER TABLE public.ca_free_buy_ticket_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_free_buy_ticket_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_free_buy_ticket_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_free_buy_cutoff_fundings ENABLE ROW LEVEL SECURITY;
-- Only the owner's functions write these; the engine and the digest read them.
REVOKE ALL ON public.ca_free_buy_ticket_grants FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ca_free_buy_ticket_grants TO service_role;
REVOKE ALL ON public.ca_free_buy_ticket_redemptions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ca_free_buy_ticket_redemptions TO service_role;
REVOKE ALL ON public.ca_free_buy_ticket_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ca_free_buy_ticket_events TO service_role;
REVOKE ALL ON public.ca_free_buy_cutoff_fundings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ca_free_buy_cutoff_fundings TO service_role;

-- ── 2. The tournament day, the ticket parts and the cutoff arithmetic ───────
CREATE FUNCTION public.fn_ca_free_buy_ticket_day(p_at timestamptz)
 RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $f$
  -- The operating day turns over at the daily window's start (04:00 Chicago),
  -- so a 12:30 AM start belongs to the previous calendar day.
  SELECT ((p_at AT TIME ZONE p.time_zone) - p.window_start)::date
    FROM smarter_private.daily_window_policy p WHERE p.singleton;
$f$;

CREATE FUNCTION public.fn_ca_free_buy_ticket_parts(p_tournament_id uuid,
  OUT format text, OUT guaranteed boolean, OUT bounty_part numeric, OUT prize_part numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $f$
  -- What one ticket entry is worth. A guaranteed Free Buy: nothing (the
  -- guarantee is the floor; tickets add no chip). Otherwise one chip in the
  -- event's own split: pko all bounty, mystery 0.50/0.50, regular/aiof all
  -- prize. The bounty share backs a live head; the prize share waits for the
  -- final cutoff.
  SELECT f.fmt, f.g,
         CASE WHEN f.g THEN 0 WHEN f.fmt='pko' THEN 1 WHEN f.fmt='mystery' THEN 0.50 ELSE 0 END::numeric,
         CASE WHEN f.g THEN 0 WHEN f.fmt='pko' THEN 0 WHEN f.fmt='mystery' THEN 0.50 ELSE 1 END::numeric
    FROM public.tournaments t
   CROSS JOIN LATERAL (SELECT public.fn_ca_midway_free_buy_format(t.id) AS fmt,
                              round(COALESCE(t.guaranteed_prize,0),2) > 0 AS g) f
   WHERE t.id = p_tournament_id AND f.fmt IS NOT NULL;
$f$;

CREATE FUNCTION public.fn_ca_free_buy_cutoff_terms(p_guarantee numeric, p_wallet_chips numeric,
  p_valid_tickets integer, p_ticket_prize_part numeric DEFAULT 1, p_wallet_gross numeric DEFAULT NULL,
  OUT prize_pool numeric, OUT promo_support numeric)
 LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public','pg_temp'
AS $f$
DECLARE
  g numeric := round(COALESCE(p_guarantee,0),2);
  c numeric := round(COALESCE(p_wallet_chips,0),2);
  -- C: the full player payments (prize + bounty + rake shares) count toward
  -- the guarantee. With no bounty or rake it equals c.
  cg numeric := round(COALESCE(p_wallet_gross, p_wallet_chips, 0),2);
BEGIN
  IF cg < c OR g < 0 OR c < 0 OR COALESCE(p_valid_tickets,0) < 0 OR COALESCE(p_ticket_prize_part,0) < 0
     OR g::text IN ('NaN','Infinity') OR c::text IN ('NaN','Infinity') THEN
    RAISE EXCEPTION 'Free Buy cutoff terms need finite non-negative inputs' USING ERRCODE='22023';
  END IF;
  IF g > 0 THEN
    -- Guaranteed: U = max(0, G - C) on the gross C; P = c + U. Once the
    -- players' full payments reach G the sponsor adds nothing. Tickets add
    -- nothing.
    promo_support := GREATEST(0, g - cg);
    prize_pool := c + promo_support;
  ELSE
    -- Not guaranteed: V = one chip (its prize share) per valid first entry.
    promo_support := round(COALESCE(p_valid_tickets,0) * COALESCE(p_ticket_prize_part,0), 2);
    prize_pool := promo_support + c;
  END IF;
END
$f$;

-- ── 3. Grant, redeem, restore ───────────────────────────────────────────────
CREATE FUNCTION public.fn_ca_grant_daily_free_buy_tickets(p_day date DEFAULT NULL)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $f$
DECLARE
  v_day date := COALESCE(p_day, public.fn_ca_free_buy_ticket_day(clock_timestamp()));
  n integer;
BEGIN
  -- Every account, online or not. ON CONFLICT makes a second run (or a
  -- user already granted on first use) a no-op: exactly once per day.
  INSERT INTO public.ca_free_buy_ticket_grants(user_id, ticket_day, tickets, granted_by)
  SELECT p.id, v_day, 5, 'daily_grant' FROM public.profiles p
  ON CONFLICT (user_id, ticket_day) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$f$;

CREATE FUNCTION public.fn_ca_free_buy_ticket_redeem(p_tournament_id uuid, p_user_id uuid, p_registration_id uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $f$
DECLARE
  v_start timestamptz;
  v_day date;
  r public.ca_free_buy_ticket_redemptions%ROWTYPE;
  v_used integer;
BEGIN
  SELECT t.start_time INTO v_start FROM public.tournaments t WHERE t.id = p_tournament_id;
  IF NOT FOUND OR p_user_id IS NULL OR p_registration_id IS NULL THEN
    RAISE EXCEPTION 'A Free Buy ticket needs its event, user and registration' USING ERRCODE='22023';
  END IF;
  v_day := public.fn_ca_free_buy_ticket_day(v_start);
  -- A user who joined after the daily grant gets that day's five once.
  INSERT INTO public.ca_free_buy_ticket_grants(user_id, ticket_day, tickets, granted_by)
  VALUES (p_user_id, v_day, 5, 'first_use') ON CONFLICT (user_id, ticket_day) DO NOTHING;
  -- One redemption at a time per user and day: concurrent registrations queue here.
  PERFORM 1 FROM public.ca_free_buy_ticket_grants g
   WHERE g.user_id = p_user_id AND g.ticket_day = v_day FOR UPDATE;

  SELECT * INTO r FROM public.ca_free_buy_ticket_redemptions x
   WHERE x.tournament_id = p_tournament_id AND x.user_id = p_user_id FOR UPDATE;
  IF FOUND AND r.status = 'redeemed' THEN
    IF r.registration_id = p_registration_id THEN
      RETURN r.id;                       -- a retry of the same entry
    END IF;
    -- One ticket per user per event: a later entry is a paid re-entry.
    RAISE EXCEPTION 'free_buy_ticket_already_used: this event''s Free Buy ticket covered the first entry; a re-entry is paid from the wallet'
      USING ERRCODE='P0001';
  END IF;

  SELECT count(*) INTO v_used FROM public.ca_free_buy_ticket_redemptions x
   WHERE x.user_id = p_user_id AND x.ticket_day = v_day
     AND x.status = 'redeemed' AND x.kind = 'ticket';
  IF v_used >= 5 THEN
    RAISE EXCEPTION 'free_buy_ticket_unavailable: all five Free Buy tickets for % are in use', v_day
      USING ERRCODE='P0001';
  END IF;

  IF r.id IS NOT NULL THEN               -- restored earlier: the same row is reused
    UPDATE public.ca_free_buy_ticket_redemptions
       SET status='redeemed', kind='ticket', registration_id=p_registration_id,
           ticket_day=v_day, redeemed_at=clock_timestamp(), restored_at=NULL, updated_at=clock_timestamp()
     WHERE id = r.id RETURNING * INTO r;
  ELSE
    INSERT INTO public.ca_free_buy_ticket_redemptions(tournament_id,user_id,ticket_day,registration_id,kind,status)
    VALUES (p_tournament_id,p_user_id,v_day,p_registration_id,'ticket','redeemed') RETURNING * INTO r;
  END IF;
  INSERT INTO public.ca_free_buy_ticket_events(redemption_id,tournament_id,user_id,ticket_day,registration_id,action,kind)
  VALUES (r.id,r.tournament_id,r.user_id,r.ticket_day,r.registration_id,'redeem',r.kind);
  RETURN r.id;
END
$f$;

CREATE FUNCTION public.fn_ca_free_buy_ticket_restore(p_tournament_id uuid, p_user_id uuid, p_registration_id uuid, p_reason text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $f$
DECLARE
  r public.ca_free_buy_ticket_redemptions%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.ca_free_buy_ticket_redemptions x
   WHERE x.tournament_id = p_tournament_id AND x.user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'redeemed' OR r.registration_id IS DISTINCT FROM p_registration_id THEN
    RETURN false;                        -- nothing to restore, or already restored (retry)
  END IF;
  UPDATE public.ca_free_buy_ticket_redemptions
     SET status='restored', restored_at=clock_timestamp(), updated_at=clock_timestamp()
   WHERE id = r.id;
  INSERT INTO public.ca_free_buy_ticket_events(redemption_id,tournament_id,user_id,ticket_day,registration_id,action,kind,detail)
  VALUES (r.id,r.tournament_id,r.user_id,r.ticket_day,r.registration_id,'restore',r.kind,
          jsonb_build_object('reason',p_reason));
  RETURN true;
END
$f$;

CREATE FUNCTION public.fn_my_free_buy_tickets()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $f$
  -- The caller's own tickets for today's tournament day. Read only.
  SELECT jsonb_build_object(
    'ticket_day', d.day, 'tickets', 5,
    'used', (SELECT count(*) FROM public.ca_free_buy_ticket_redemptions x
              WHERE x.user_id = auth.uid() AND x.ticket_day = d.day
                AND x.status = 'redeemed' AND x.kind = 'ticket'),
    'remaining', 5 - (SELECT count(*) FROM public.ca_free_buy_ticket_redemptions x
              WHERE x.user_id = auth.uid() AND x.ticket_day = d.day
                AND x.status = 'redeemed' AND x.kind = 'ticket'))
    FROM (SELECT public.fn_ca_free_buy_ticket_day(clock_timestamp()) AS day) d
   WHERE auth.uid() IS NOT NULL;
$f$;

-- ── 4. The promo owner: a ticket at the till, a bounty head if any ───────────
CREATE OR REPLACE FUNCTION public.fn_ca_midway_free_buy_promo_head(p_tournament_id uuid, p_registration_id uuid, p_return boolean DEFAULT false)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
 t public.tournaments%ROWTYPE;
 p public.tournament_players%ROWTYPE;
 funded public.chip_ledger%ROWTYPE;
 prior public.chip_ledger%ROWTYPE;
 k text;
 n integer;
 previous_skip text;
 v_format text;
 v_parts record;
 v_amount numeric;
 v_bounty numeric;
 v_prize numeric;
 v_redemption uuid;
BEGIN
 SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 v_format:=public.fn_ca_midway_free_buy_format(p_tournament_id);
 IF v_format IS NULL THEN RETURN 0; END IF;
 SELECT * INTO p FROM public.tournament_players
 WHERE id=p_registration_id AND tournament_id=p_tournament_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Promo bounty requires its exact registration'; END IF;
 k:='tourney:'||p_tournament_id||':promo_head:'||p_registration_id;
 SELECT * INTO funded FROM public.chip_ledger WHERE idempotency_key=k;
 -- A funding leg is a 1-chip entry from before tickets (any split) or, since
 -- tickets (2026-11-05), the bounty share alone. Read its parts from itself.
 IF funded.id IS NOT NULL THEN
   v_amount:=round(funded.amount,2);
   v_bounty:=round(COALESCE((funded.metadata->>'bounty_part')::numeric,funded.amount),2);
   v_prize:=round(v_amount-v_bounty,2);
   IF v_amount<=0 OR v_amount>1 OR v_bounty<0 OR v_prize<0
     OR funded.category IS DISTINCT FROM 'promo_send'
     OR funded.from_type IS DISTINCT FROM 'union_wallet' OR funded.from_entity_id IS DISTINCT FROM 'fade0000-0000-0000-0000-000000000001'::uuid
     OR funded.to_type IS DISTINCT FROM 'prize_liability' OR funded.to_entity_id IS DISTINCT FROM p_tournament_id
     OR funded.metadata->>'registration_id' IS DISTINCT FROM p_registration_id::text THEN
     RAISE EXCEPTION 'Promo bounty funding identity conflict';
   END IF;
 END IF;

 IF p_return THEN
   -- An unplayed entry gives its ticket back and its own funding leg (if any).
   IF t.started_at IS NOT NULL OR upper(coalesce(t.status,'')) NOT IN ('ANNOUNCED','REGISTERING')
      OR coalesce(p.status,'') NOT IN ('registered','playing') THEN
     IF funded.id IS NULL THEN RETURN 0; END IF;
     RAISE EXCEPTION 'A played bounty cannot be returned as an unplayed promotion';
   END IF;
   PERFORM public.fn_ca_free_buy_ticket_restore(p_tournament_id,p.user_id,p_registration_id,'unplayed_return');
   IF funded.id IS NULL THEN RETURN 0; END IF;
   IF v_bounty>0 AND (p.current_bounty IS NULL OR p.current_bounty<v_bounty) THEN
     RAISE EXCEPTION 'A played bounty cannot be returned as an unplayed promotion';
   END IF;
   k:=k||':return';
   SELECT * INTO prior FROM public.chip_ledger WHERE idempotency_key=k;
   IF prior.id IS NOT NULL THEN
     IF prior.amount IS DISTINCT FROM funded.amount OR prior.from_entity_id IS DISTINCT FROM p_tournament_id
        OR prior.category IS DISTINCT FROM 'reversal' OR prior.from_type IS DISTINCT FROM 'prize_liability'
        OR prior.to_type IS DISTINCT FROM 'union_wallet'
        OR prior.to_entity_id IS DISTINCT FROM 'fade0000-0000-0000-0000-000000000001'::uuid
        OR prior.metadata->>'funding_ledger_id' IS DISTINCT FROM funded.id::text THEN
       RAISE EXCEPTION 'Promo bounty return identity conflict';
     END IF;
     RETURN 0;
   END IF;
 ELSE
   IF funded.id IS NOT NULL THEN RETURN 0; END IF;   -- a retry, or a pre-ticket entry
   SELECT * INTO v_parts FROM public.fn_ca_free_buy_ticket_parts(p_tournament_id);
   v_bounty:=round(COALESCE(v_parts.bounty_part,0),2);
   v_prize:=0;                                        -- the prize share waits for the cutoff
   v_amount:=v_bounty;
   IF upper(coalesce(t.status,'')) NOT IN ('ANNOUNCED','REGISTERING','RUNNING','BREAK')
      OR (v_bounty>0 AND p.current_bounty IS DISTINCT FROM v_bounty) THEN
     RAISE EXCEPTION 'Promo funding requires a newly registered one-chip head';
   END IF;
   -- FREE BUY TICKETS (owner 2026-11-05): the first entry uses one of the
   -- user's five daily tickets. Issuing and redeeming move no chips.
   v_redemption:=public.fn_ca_free_buy_ticket_redeem(p_tournament_id,p.user_id,p_registration_id);
   IF v_amount<=0 THEN RETURN 1; END IF;
 END IF;
 -- Initialize before the new ledger leg, then update once after it. This
 -- avoids counting a first-seen leg both through shadow initialization and delta.
 PERFORM public.fn_ca_escrow_apply(p_tournament_id,'Midway promo head prelock');
 previous_skip:=current_setting('app.ledger_autoskip_union_wallets',true);
 PERFORM set_config('app.ledger_autoskip_union_wallets','1',true);
 UPDATE public.union_wallets SET
   promo_wallet=promo_wallet+CASE WHEN p_return THEN v_amount ELSE -v_amount END,updated_at=now()
 WHERE union_id='fade0000-0000-0000-0000-000000000001'::uuid
   AND (p_return OR promo_wallet>=v_amount);
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'Midway promo funds cannot fund this entry'; END IF;
 PERFORM set_config('app.ledger_autoskip_union_wallets',coalesce(previous_skip,''),true);
 INSERT INTO public.chip_ledger(
   performed_by,from_type,from_entity_id,from_label,to_type,to_entity_id,to_label,
   amount,category,club_id,tournament_id,idempotency_key,description,metadata)
 VALUES(COALESCE(auth.uid(),'2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid),CASE WHEN p_return THEN 'prize_liability' ELSE 'union_wallet' END,
   CASE WHEN p_return THEN p_tournament_id ELSE 'fade0000-0000-0000-0000-000000000001'::uuid END,
   CASE WHEN NOT p_return THEN 'union_wallets.promo_wallet' WHEN v_prize=0 THEN 'tournament_escrow.bounty_balance'
        WHEN v_bounty>0 THEN 'tournament_escrow.bounty_and_prize_balance' ELSE 'tournament_escrow.prize_balance' END,
   CASE WHEN p_return THEN 'union_wallet' ELSE 'prize_liability' END,
   CASE WHEN p_return THEN 'fade0000-0000-0000-0000-000000000001'::uuid ELSE p_tournament_id END,
   CASE WHEN p_return THEN 'union_wallets.promo_wallet' ELSE 'tournament_escrow.bounty_balance' END,
   v_amount,CASE WHEN p_return THEN 'reversal' ELSE 'promo_send' END,t.club_id,p_tournament_id,k,
   CASE WHEN p_return AND v_prize=0 THEN 'Unplayed Free Buy Bounty Returned To Midway Promo Funds'
        WHEN p_return THEN 'Unplayed Free Buy Entry Returned To Midway Promo Funds'
        ELSE 'Midway Promo Funds Free Buy Ticket Bounty Head' END,
   jsonb_build_object('kind','midway_free_buy_promo_head','registration_id',p_registration_id,
     'user_id',p.user_id,'return',p_return,'funding_ledger_id',funded.id,
     'format',v_format,'bounty_part',v_bounty,'prize_part',v_prize,
     'ticket_redemption_id',v_redemption));
 PERFORM public.fn_ca_escrow_apply(p_tournament_id,'Midway promo head',
   p_gross_in=>CASE WHEN p_return THEN -v_amount ELSE v_amount END,
   p_bounty_in=>CASE WHEN p_return THEN -v_bounty ELSE v_bounty END);
 IF p_return THEN
   UPDATE public.tournaments SET bounty_pool=bounty_pool-v_bounty,prize_pool=prize_pool-v_prize
    WHERE id=p_tournament_id AND bounty_pool>=v_bounty AND prize_pool>=v_prize;
   GET DIAGNOSTICS n=ROW_COUNT;
   IF n<>1 THEN RAISE EXCEPTION 'Promo return exceeds funded bounty or prize pool'; END IF;
 END IF;
 RETURN 1;
END;
$function$
;

-- ── 5. Both registration doors book the ticket parts (prize 0 at the till) ──
DO $doors$
DECLARE
  v_old constant text :=
       E'  -- Midway Free Buy rotation (2026-11-04): the player pays nothing; the\n'
    || E'  -- promo chip is booked to the pool(s) of the event''s format.\n'
    || E'  v_mfb:=public.fn_ca_midway_free_buy_format(p_tournament_id);\n'
    || E'  IF v_mfb=''pko'' THEN\n'
    || E'    v_split.charge:=0; v_split.rake:=0; v_split.bounty:=1; v_split.prize:=0;\n'
    || E'  ELSIF v_mfb=''mystery'' THEN\n'
    || E'    v_split.charge:=0; v_split.rake:=0; v_split.bounty:=0.50; v_split.prize:=0.50;\n'
    || E'  ELSIF v_mfb IN (''regular'',''aiof'') THEN\n'
    || E'    v_split.charge:=0; v_split.rake:=0; v_split.bounty:=0; v_split.prize:=1;\n'
    || E'  END IF;\n';
  v_new constant text :=
       E'  -- FREE BUY TICKETS (owner 2026-11-05): the first entry is a ticket. It\n'
    || E'  -- charges nothing and adds nothing to the prize pool here; only a bounty\n'
    || E'  -- head (pko 1, mystery 0.50, none when guaranteed) is booked now. The\n'
    || E'  -- prize share is funded at the final cutoff (fn_ca_free_buy_fund_at_cutoff).\n'
    || E'  v_mfb:=public.fn_ca_midway_free_buy_format(p_tournament_id);\n'
    || E'  IF v_mfb IS NOT NULL THEN\n'
    || E'    v_split.charge:=0; v_split.rake:=0; v_split.prize:=0;\n'
    || E'    v_split.bounty:=COALESCE((SELECT x.bounty_part FROM public.fn_ca_free_buy_ticket_parts(p_tournament_id) x),0);\n'
    || E'  END IF;\n';
  v_targets constant text[] := ARRAY[
    'public.fn_register_for_tournament_before_atomic_capacity_20260907(uuid,boolean)',
    'public.fn_register_horse_for_tournament_before_maintenance_gate(uuid,uuid)'];
  v_def text;
  i integer;
BEGIN
  FOR i IN 1..2 LOOP
    v_def := pg_get_functiondef(v_targets[i]::regprocedure);
    IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
      RAISE EXCEPTION '% Free Buy split anchor not found exactly once; refusing to patch', v_targets[i];
    END IF;
    EXECUTE replace(v_def, v_old, v_new);
  END LOOP;
END
$doors$;

-- ── 6. The final cutoff ─────────────────────────────────────────────────────
CREATE FUNCTION public.fn_ca_free_buy_fund_at_cutoff(p_tournament_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $f$
DECLARE
  t public.tournaments%ROWTYPE;
  v_parts record;
  v_terms record;
  v_done public.ca_free_buy_cutoff_fundings%ROWTYPE;
  v_g numeric;
  v_pool numeric;
  v_recorded numeric;
  v_c numeric;
  v_promo_bounty numeric;
  v_gross numeric;
  v_tickets integer;
  v_move numeric;
  v_key text;
  v_skip text;
  n integer;
BEGIN
  SELECT * INTO v_parts FROM public.fn_ca_free_buy_ticket_parts(p_tournament_id);
  IF v_parts.format IS NULL THEN
    RETURN jsonb_build_object('applies',false);
  END IF;
  -- Snapshot: the caller holds the settlement lane; the event row lock makes
  -- every registration (its roster trigger locks this row) land before or
  -- after this, never during it.
  SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
  IF COALESCE(t.prize_pool_finalized,false) THEN
    RETURN jsonb_build_object('applies',true,'already_finalized',true);
  END IF;

  -- The advertised buy-in guarantee itself: bounties and rake are counted on
  -- the collected side (C), never subtracted from G.
  v_g := round(GREATEST(COALESCE(t.guaranteed_prize,0),0),2);
  v_pool := round(COALESCE(t.prize_pool,0),2);
  -- Already recorded toward the prize pool by the promo wallet: the prize
  -- share of pre-ticket 1-chip entries (net of their returns) and any earlier
  -- cutoff leg for this event.
  SELECT round(COALESCE(sum(CASE WHEN l.category='promo_send' THEN 1 ELSE -1 END
           *(l.amount-COALESCE((l.metadata->>'bounty_part')::numeric,l.amount))),0),2)
    INTO v_recorded
    FROM public.chip_ledger l
   WHERE l.tournament_id=p_tournament_id
     AND l.metadata->>'kind'='midway_free_buy_promo_head'
     AND l.category IN ('promo_send','reversal');
  v_recorded := v_recorded + COALESCE((SELECT sum(l.amount) FROM public.chip_ledger l
     WHERE l.idempotency_key='tourney:'||p_tournament_id||':free_buy_cutoff_sponsor'),0);
  v_c := round(v_pool - v_recorded,2);
  IF v_c < 0 THEN
    RAISE EXCEPTION 'Free Buy % pool % is below the promo chips recorded in it (%)',
      p_tournament_id, v_pool, v_recorded USING ERRCODE='23514';
  END IF;
  -- C: the players' full payments. Bounty money they paid is the bounty pool
  -- less the promo-funded heads; rake is what they paid in fees.
  SELECT round(COALESCE(sum(CASE WHEN l.category='promo_send' THEN 1 ELSE -1 END
           *COALESCE((l.metadata->>'bounty_part')::numeric,l.amount)),0),2)
    INTO v_promo_bounty
    FROM public.chip_ledger l
   WHERE l.tournament_id=p_tournament_id
     AND l.metadata->>'kind'='midway_free_buy_promo_head'
     AND l.category IN ('promo_send','reversal');
  v_gross := round(v_c + GREATEST(0, COALESCE(t.bounty_pool,0) - v_promo_bounty)
                       + GREATEST(0, COALESCE(t.total_rake,0)),2);
  -- V: valid first entries (a ticket or a rollout record whose registration stands).
  SELECT count(*)::integer INTO v_tickets
    FROM public.ca_free_buy_ticket_redemptions r
    JOIN public.tournament_players tp ON tp.id=r.registration_id AND tp.tournament_id=r.tournament_id
   WHERE r.tournament_id=p_tournament_id AND r.status='redeemed';

  SELECT * INTO v_terms FROM public.fn_ca_free_buy_cutoff_terms(
    CASE WHEN v_parts.guaranteed THEN v_g ELSE 0 END, v_c, v_tickets, v_parts.prize_part, v_gross);
  v_move := round(v_terms.promo_support - v_recorded,2);

  SELECT * INTO v_done FROM public.ca_free_buy_cutoff_fundings WHERE tournament_id=p_tournament_id;
  IF FOUND THEN
    -- A retry of a cutoff whose funding already committed: it must agree and move nothing.
    IF v_move <> 0 OR v_done.prize_pool <> v_terms.prize_pool THEN
      RAISE EXCEPTION 'Free Buy % cutoff funding was recorded with different terms', p_tournament_id
        USING ERRCODE='23514';
    END IF;
    RETURN to_jsonb(v_done) || jsonb_build_object('applies',true,'retry',true);
  END IF;

  IF v_move <> 0 THEN
    v_key := 'tourney:'||p_tournament_id||CASE WHEN v_move>0 THEN ':free_buy_cutoff_sponsor' ELSE ':free_buy_cutoff_return' END;
    PERFORM public.fn_ca_escrow_apply(p_tournament_id,'Free Buy cutoff prelock');
    v_skip := current_setting('app.ledger_autoskip_union_wallets',true);
    PERFORM set_config('app.ledger_autoskip_union_wallets','1',true);
    UPDATE public.union_wallets SET promo_wallet=promo_wallet-v_move, updated_at=now()
     WHERE union_id='fade0000-0000-0000-0000-000000000001'::uuid AND promo_wallet>=v_move;
    GET DIAGNOSTICS n=ROW_COUNT;
    IF n<>1 THEN RAISE EXCEPTION 'Midway promo funds cannot fund this Free Buy prize pool (% needed)', v_move
      USING ERRCODE='23514'; END IF;
    PERFORM set_config('app.ledger_autoskip_union_wallets',COALESCE(v_skip,''),true);
    IF v_move > 0 THEN
      -- Sponsor support into prize escrow (the overlay trigger credits escrow).
      INSERT INTO public.chip_ledger(performed_by,from_type,from_entity_id,from_label,to_type,to_entity_id,to_label,
        amount,category,club_id,tournament_id,idempotency_key,description,metadata)
      VALUES(COALESCE(auth.uid(),'2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid),
        'union_wallet','fade0000-0000-0000-0000-000000000001'::uuid,'union_wallets.promo_wallet',
        'prize_liability',p_tournament_id,'tournament_escrow.prize_balance',
        v_move,'overlay',t.club_id,p_tournament_id,v_key,
        CASE WHEN v_parts.guaranteed THEN 'Midway Promo Funds Free Buy Guarantee Support'
             ELSE 'Midway Promo Funds Free Buy Ticket Prize Chips' END,
        jsonb_build_object('kind','free_buy_cutoff_sponsor','guaranteed',v_parts.guaranteed,
          'guarantee',v_g,'wallet_chips',v_c,'wallet_gross',v_gross,'valid_tickets',v_tickets,'ticket_prize_part',v_parts.prize_part,
          'prize_pool',v_terms.prize_pool,'promo_support',v_terms.promo_support,'recorded_before',v_recorded));
    ELSE
      -- Pre-ticket promo chips beyond U go back before anything is paid: a
      -- compensating entry, read by the escrow shadow as a promo-head reversal.
      INSERT INTO public.chip_ledger(performed_by,from_type,from_entity_id,from_label,to_type,to_entity_id,to_label,
        amount,category,club_id,tournament_id,idempotency_key,description,metadata)
      VALUES(COALESCE(auth.uid(),'2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid),
        'prize_liability',p_tournament_id,'tournament_escrow.prize_balance',
        'union_wallet','fade0000-0000-0000-0000-000000000001'::uuid,'union_wallets.promo_wallet',
        -v_move,'reversal',t.club_id,p_tournament_id,v_key,
        'Free Buy Promo Chips Beyond The Guarantee Returned To Midway Promo Funds',
        jsonb_build_object('kind','midway_free_buy_promo_head','cutoff_return',true,
          'bounty_part',0,'prize_part',-v_move,'guarantee',v_g,'wallet_chips',v_c,'wallet_gross',v_gross,
          'valid_tickets',v_tickets,'prize_pool',v_terms.prize_pool,
          'promo_support',v_terms.promo_support,'recorded_before',v_recorded));
      PERFORM public.fn_ca_escrow_apply(p_tournament_id,'Free Buy cutoff return',p_gross_in=>v_move);
    END IF;
    UPDATE public.tournaments SET prize_pool=round(COALESCE(prize_pool,0)+v_move,2)
     WHERE id=p_tournament_id AND NOT COALESCE(prize_pool_finalized,false);
    GET DIAGNOSTICS n=ROW_COUNT;
    IF n<>1 THEN RAISE EXCEPTION 'Free Buy % prize pool could not take its cutoff funding', p_tournament_id; END IF;
  END IF;

  INSERT INTO public.ca_free_buy_cutoff_fundings(tournament_id,guaranteed,guarantee,wallet_chips,wallet_gross,valid_tickets,
    ticket_prize_part,prize_pool,promo_support,recorded_before,moved,ledger_idempotency_key)
  VALUES (p_tournament_id,v_parts.guaranteed,v_g,v_c,v_gross,v_tickets,v_parts.prize_part,
    v_terms.prize_pool,v_terms.promo_support,v_recorded,v_move,v_key)
  RETURNING * INTO v_done;
  IF round(v_pool+v_move,2) <> v_terms.prize_pool THEN
    RAISE EXCEPTION 'Free Buy % cutoff left pool % instead of %', p_tournament_id, v_pool+v_move, v_terms.prize_pool
      USING ERRCODE='23514';
  END IF;
  RETURN to_jsonb(v_done) || jsonb_build_object('applies',true);
END
$f$;

DO $cutoff$
DECLARE
  v_def text := pg_get_functiondef('public.fn_apply_prize_guarantee(uuid,text)'::regprocedure);
  v_anchor constant text := E'    v_result:=public.fn_ca_apply_prize_guarantee_core(\n';
BEGIN
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'fn_apply_prize_guarantee core anchor not found exactly once; refusing to patch';
  END IF;
  EXECUTE replace(v_def, v_anchor,
       E'    /* A FREE BUY IS FUNDED AT ITS FINAL CUTOFF (owner 2026-11-05): P and U\n'
    || E'       from the Midway promo wallet, before the core, in the same\n'
    || E'       subtransaction, so a refused finalization rolls it back too. */\n'
    || E'    PERFORM public.fn_ca_free_buy_fund_at_cutoff(p_tournament_id);\n'
    || v_anchor);
END
$cutoff$;

-- ── 7. Privileges ───────────────────────────────────────────────────────────
-- The promo head is called only from inside the registration and cancel
-- functions (owner-only); production holds no browser or service grant on it.
REVOKE ALL ON FUNCTION public.fn_ca_midway_free_buy_promo_head(uuid,uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ca_free_buy_history_is_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_free_buy_ticket_day(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_free_buy_ticket_parts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_free_buy_cutoff_terms(numeric,numeric,integer,numeric,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_grant_daily_free_buy_tickets(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_free_buy_ticket_redeem(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ca_free_buy_ticket_restore(uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_ca_free_buy_fund_at_cutoff(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_my_free_buy_tickets() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ca_free_buy_ticket_day(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_free_buy_ticket_parts(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_free_buy_cutoff_terms(numeric,numeric,integer,numeric,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_grant_daily_free_buy_tickets(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_my_free_buy_tickets() TO authenticated, service_role;

-- ── 8. Rollout compatibility and today's grant ──────────────────────────────
-- Every registration already standing in an unfinalized Free Buy keeps its
-- free first entry through an auditable record. Nothing is charged, nothing
-- is refused, and it does not use one of the user's five tickets.
WITH standing AS (
  INSERT INTO public.ca_free_buy_ticket_redemptions(tournament_id,user_id,ticket_day,registration_id,kind,status)
  SELECT tp.tournament_id, tp.user_id, public.fn_ca_free_buy_ticket_day(t.start_time), tp.id, 'rollout_compat', 'redeemed'
    FROM public.tournaments t
    JOIN public.tournament_players tp ON tp.tournament_id=t.id
   WHERE t.free_buy AND NOT COALESCE(t.prize_pool_finalized,false)
     AND upper(COALESCE(t.status,'')) IN ('ANNOUNCED','REGISTERING','RUNNING','BREAK')
     AND public.fn_ca_midway_free_buy_format(t.id) IS NOT NULL
     AND tp.user_id IS NOT NULL
  ON CONFLICT (tournament_id,user_id) DO NOTHING
  RETURNING *)
INSERT INTO public.ca_free_buy_ticket_events(redemption_id,tournament_id,user_id,ticket_day,registration_id,action,kind,detail)
SELECT s.id,s.tournament_id,s.user_id,s.ticket_day,s.registration_id,'rollout_compat','rollout_compat',
       jsonb_build_object('basis','registered before Free Buy tickets shipped (owner 2026-11-05 rule 7)')
  FROM standing s;

SELECT public.fn_ca_grant_daily_free_buy_tickets();

-- periodic-work: the owner's rule is that every user, online or not, holds five Free Buy tickets each tournament day; this grants the new day once it starts (04:00 Chicago is 09:00 or 10:00 UTC across DST) and is a no-op on the second run.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='free-buy-daily-tickets';
SELECT cron.schedule('free-buy-daily-tickets','1 9,10 * * *',
  $c$SELECT public.fn_ca_grant_daily_free_buy_tickets();$c$);

COMMIT;
