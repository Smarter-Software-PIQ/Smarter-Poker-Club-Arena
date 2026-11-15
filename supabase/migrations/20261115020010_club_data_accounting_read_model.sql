-- 20261115020010_club_data_accounting_read_model
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-15.
--
-- CLUB DATA READS THE UNION INVOICE'S OWN ACCOUNTING RECORDS (owner, 2026-11-14)
--
-- "The Club Data page must match the union weekly invoices 1:1, starting and
-- stopping at the same 2 AM boundary the invoices use."
--
-- The union weekly invoice (fn_union_club_invoice, fn_union_pnl_evidence_report)
-- is built from accounting records Club Data never read: rake credit by its
-- accounting source, each hand's stack change by the participant's earning
-- club, BBJ stack awards, tournament funding and returns by their receipts,
-- and the tournament entries carried across week boundaries. Club Data was
-- built from rake_records by seat club and wallet buy-ins/cash-outs on Chicago
-- midnight days, then moved horses to their current club at display time.
-- Measured for KINGS CLUB, week 2026-11-02 08:00Z to 2026-11-09 08:00Z:
-- invoice rake 25,854.24 against a Club Data cash fee of 103,637.66 before the
-- horse move; invoice player result -37,160.83 against +20,428.90.
--
-- This migration installs the read model that carries the invoice's records,
-- keyed by the 02:00 America/Chicago accounting day (fn_ca_accounting_day,
-- 20261114235606), for every union game (the invoice covers union games only;
-- a non-union hand carries no earning club and no invoice). Nothing reads it
-- yet. 20261115020011 attaches the live projection inside the 04:00 Chicago
-- maintenance window; each day's history is then loaded by
-- fn_ca_club_acct_seed_day.
--
--   record (invoice field)                         -> ca_club_acct_fact
--   accounting_cash_rake_sources, its club moved
--     by accounting_cash_funding_contract_admissions
--     (rake_generated, cash, earned_at)           -> fee, CASH
--   accounting_tournament_recognized_sources of
--     accounting_effective_tournament_fee_sources
--     (rake_generated, tournament, recognized_at) -> fee, TOURNAMENT
--   union_pnl_cash_outcome_touches (with the
--     treasury gift and post-hand escrow readings
--     fn_union_pnl_week_hand_lines uses) and
--     union_pnl_cash_outcome_link_resolutions
--     (lightning funding owner), by earning club  -> result + hands, CASH
--   fn_union_pnl_week_bbj_stack_awards            -> result, CASH (award)
--   union_pnl_original_flows of a tournament,
--     owned by its receipt (funding receipts,
--     accounting credit receipts, refund tranches,
--     refund entitlements incl. the satellite-seat
--     owner) exactly as fn_union_pnl_original_flow_evidence
--     classifies them                             -> result, TOURNAMENT
--   ca_union_pnl_boundary_capture (deferred
--     tournament entries at a week boundary, the
--     version the invoice used)                    -> src 2
--
-- Measured read-only on production for the week above, receipts plus the
-- 2026-11-02 opening and 2026-11-09 closing holdings reproduce every invoice
-- tournament result to the cent (Deep Stack -195,554.11, The Felt Society
-- -101,626.77, KINGS CLUB -18,011.94); hand deltas plus BBJ awards reproduce
-- every cash result (evidence file, 2026-11-15).
--
-- NO MONEY WRITE EVER WAITS ON A PROJECTION ROW. A live (src 0) aggregate row
-- is written only by the transaction that holds its advisory lock, the
-- one-key form pg_try_advisory_xact_lock(hashtextextended('ca-club-acct:' ||
-- row key, 0)), which never waits. (Not the two-key form: production's home
-- group functions take blocking two-key locks whose classid is derived from a
-- group id hash, so a fixed two-key classid could meet one. The one-key users
-- on main hash their own prefixed text with hashtextextended or hashtext; a
-- key here meets one of theirs only if two 64-bit hashes of different text
-- are equal.) A transaction that cannot take a row's lock (another open
-- transaction owns it) appends an insert-only journal row with no unique key
-- instead, so no row is ever locked by two open
-- transactions and no deadlock can form. A transaction takes at most 32 such
-- locks (the rest go to the journal), so the shared lock table is never
-- pressured. src 1 rows are written only by the day load (one load at a time,
-- itself a try-lock), src 2 rows only by the boundary loader (a try-lock per
-- boundary); live writers never touch either. Readers sum the aggregate rows
-- and the journal once each. Every trigger function also carries
-- lock_timeout = 50ms (under the 1 s deadlock_timeout) as a belt.
--
-- A projection that raises never refuses the money write: its subtransaction
-- rolls back, the failure is recorded in ca_club_acct_projection_failures
-- with its accounting day and source key, and the reader reports that day as
-- incomplete. A recorded failure is a P0 defect: its cause is fixed at the
-- root; loading the day again afterwards is listed as debt in
-- docs/BAND-AIDS-REGISTER.md, never a substitute for the fix.
--
-- @live-proof: to_regclass('public.ca_club_acct_fact') IS NOT NULL
-- @live-proof: to_regprocedure('public.fn_ca_club_acct_seed_day(date,boolean)') IS NOT NULL

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';

DO $guard$ BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'club data accounting read model requires the maintained installer';
  END IF;
  IF to_regclass('public.ca_club_acct_fact') IS NOT NULL THEN
    RAISE EXCEPTION 'club data accounting read model already installed';
  END IF;
  IF to_regprocedure('public.fn_ca_accounting_day(timestamptz)') IS NULL
     OR to_regprocedure('public.fn_ca_accounting_day_start(date)') IS NULL
     OR to_regclass('public.ca_union_pnl_boundary_capture') IS NULL
     OR to_regprocedure('public.fn_ca_union_pnl_boundary_for_invoice(uuid,timestamptz,timestamptz)') IS NULL
     OR to_regprocedure('public.fn_union_pnl_posthand_escrow_touch(public.union_pnl_cash_outcome_touches)') IS NULL
     OR to_regprocedure('public.fn_union_pnl_compact_participants(jsonb)') IS NULL
     OR to_regprocedure('smarter_private.original_treasury_cash_outcome_evidence(jsonb)') IS NULL
     OR to_regprocedure('smarter_private.original_lightning_funding_owner_evidence(uuid,bigint,jsonb,jsonb)') IS NULL
     OR to_regprocedure('public.fn_union_pnl_week_bbj_stack_awards(uuid,timestamptz,timestamptz)') IS NULL
     OR to_regprocedure('public.fn_union_pnl_satellite_seat_owner(uuid,uuid)') IS NULL
     OR to_regprocedure('public.fn_ca_launch_accounting_club_cutoffs()') IS NULL THEN
    RAISE EXCEPTION 'club data accounting read model prerequisite missing';
  END IF;
END $guard$;

-- ---------------------------------------------------------------------------
-- 1. The read model. No foreign key: a key to clubs or a source table would
--    lock it (CLAUDE.md, production DDL rule 7).
-- ---------------------------------------------------------------------------
CREATE TABLE public.ca_club_acct_fact (
  club_id  uuid        NOT NULL,
  acct_day date        NOT NULL,
  kind     text        NOT NULL CHECK (kind IN ('CASH', 'TOURNAMENT')),
  game_id  uuid        NOT NULL,
  user_id  uuid        NOT NULL,
  union_id uuid,
  fee      numeric     NOT NULL DEFAULT 0,
  result   numeric     NOT NULL DEFAULT 0,
  buyins   numeric     NOT NULL DEFAULT 0,
  cashouts numeric     NOT NULL DEFAULT 0,
  hands    bigint      NOT NULL DEFAULT 0,
  last_at  timestamptz NOT NULL,
  src      smallint    NOT NULL CHECK (src IN (0, 1, 2)),
  PRIMARY KEY (club_id, acct_day, game_id, user_id, src)
);
CREATE INDEX ca_club_acct_fact_day_idx ON public.ca_club_acct_fact (acct_day, club_id);
COMMENT ON TABLE public.ca_club_acct_fact IS
  'Club Data on the union invoice''s accounting records, per (club, 02:00 America/Chicago accounting day, game, player, src). fee = accounting rake credit; result = player result (CASH: hand stack deltas by earning club plus BBJ stack awards; TOURNAMENT: receipt-owned returns minus funding, plus src 2 deferred entries at week boundaries); buyins/cashouts = tournament funding/returns; hands = cash hands taken part in. src 0 live projection (written only under its row''s try-lock), 1 day load (whole day minus live, one snapshot), 2 boundary loader. Readers add ca_club_acct_fact_journal (src 0) exactly once.';

-- Live rows whose aggregate row another open transaction owned: insert-only.
CREATE TABLE public.ca_club_acct_fact_journal (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  club_id      uuid        NOT NULL,
  acct_day     date        NOT NULL,
  kind         text        NOT NULL CHECK (kind IN ('CASH', 'TOURNAMENT')),
  game_id      uuid        NOT NULL,
  user_id      uuid        NOT NULL,
  union_id     uuid,
  fee          numeric     NOT NULL DEFAULT 0,
  result       numeric     NOT NULL DEFAULT 0,
  buyins       numeric     NOT NULL DEFAULT 0,
  cashouts     numeric     NOT NULL DEFAULT 0,
  hands        bigint      NOT NULL DEFAULT 0,
  last_at      timestamptz NOT NULL,
  journaled_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ca_club_acct_fact_journal_club_idx ON public.ca_club_acct_fact_journal (club_id, acct_day);
CREATE INDEX ca_club_acct_fact_journal_day_idx ON public.ca_club_acct_fact_journal (acct_day);
COMMENT ON TABLE public.ca_club_acct_fact_journal IS
  'Live (src 0) fact deltas a transaction wrote while another open transaction owned the aggregate row (pg_try_advisory_xact_lock refused), or past its 32-lock budget. Live writers only insert, never wait; readers sum it with ca_club_acct_fact; a day load folds the day''s journal rows of its snapshot into src 1.';

CREATE TABLE public.ca_club_acct_hands (
  club_id  uuid     NOT NULL,
  acct_day date     NOT NULL,
  table_id uuid     NOT NULL,
  hands    bigint   NOT NULL DEFAULT 0,
  src      smallint NOT NULL CHECK (src IN (0, 1)),
  PRIMARY KEY (club_id, acct_day, table_id, src)
);
CREATE INDEX ca_club_acct_hands_day_idx ON public.ca_club_acct_hands (acct_day, club_id);
COMMENT ON TABLE public.ca_club_acct_hands IS
  'Hands a club had at least one participant in, per table and accounting day, from the same hand records as ca_club_acct_fact. Readers add ca_club_acct_hands_journal.';

CREATE TABLE public.ca_club_acct_hands_journal (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  club_id      uuid        NOT NULL,
  acct_day     date        NOT NULL,
  table_id     uuid        NOT NULL,
  hands        bigint      NOT NULL DEFAULT 0,
  journaled_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ca_club_acct_hands_journal_club_idx ON public.ca_club_acct_hands_journal (club_id, acct_day);
CREATE INDEX ca_club_acct_hands_journal_day_idx ON public.ca_club_acct_hands_journal (acct_day);

CREATE TABLE public.ca_club_acct_state (
  singleton  boolean     PRIMARY KEY DEFAULT true CHECK (singleton),
  live_from  timestamptz NOT NULL
);
COMMENT ON TABLE public.ca_club_acct_state IS
  'Written once by 20261115020011, in the transaction that attaches the live projection. From then on every source row inserted is projected live (src 0).';

CREATE TABLE public.ca_club_acct_seed_log (
  acct_day  date        PRIMARY KEY,
  fact_rows bigint      NOT NULL,
  hand_rows bigint      NOT NULL,
  seeded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Which version of each week boundary the deferred entries were loaded from,
-- per side, and whether that is the version the issued invoice used.
CREATE TABLE public.ca_club_acct_boundary_log (
  union_id      uuid        NOT NULL,
  boundary      timestamptz NOT NULL,
  opening_md5   text,
  opening_exact boolean     NOT NULL,
  closing_md5   text,
  closing_exact boolean     NOT NULL,
  fact_rows     bigint      NOT NULL,
  loaded_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (union_id, boundary)
);
COMMENT ON TABLE public.ca_club_acct_boundary_log IS
  'The deferred tournament entries of a union week boundary as loaded into ca_club_acct_fact src 2. Opening = the week starting at the boundary (-amount on its first day); closing = the week ending at it (+amount on its last day). A side is exact when fn_ca_union_pnl_boundary_for_invoice found the version that week''s issued invoice used (before an invoice exists, the latest kept version); a side that is not exact loads nothing (md5 NULL). A week edge with no row here, or a side that is not exact, is reported incomplete.';

CREATE TABLE public.ca_club_acct_projection_failures (
  id          bigserial   PRIMARY KEY,
  source      text        NOT NULL,
  source_key  text,
  acct_day    date,
  detail      text        NOT NULL,
  failed_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz
);
COMMENT ON TABLE public.ca_club_acct_projection_failures IS
  'A live projection that raised, a posted union tournament flow no receipt rule classifies (tournament_flow_unclassified), or a boundary that could not be loaded (pnl_boundary*, source_key = union:epoch). The money write it followed committed. A row here is a P0 defect: the reader reports its day (every day, when acct_day is NULL) as incomplete until the cause is fixed and the day is loaded again (fn_ca_club_acct_seed_day sets resolved_at; a boundary failure is resolved by fn_ca_club_acct_load_boundary).';

ALTER TABLE public.ca_club_acct_fact ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_club_acct_fact_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_club_acct_hands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_club_acct_hands_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_club_acct_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_club_acct_seed_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_club_acct_boundary_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_club_acct_projection_failures ENABLE ROW LEVEL SECURITY;
-- Read and written only through this migration's owner-rights functions; no
-- API role touches these tables directly.
REVOKE ALL ON public.ca_club_acct_fact, public.ca_club_acct_fact_journal, public.ca_club_acct_hands,
              public.ca_club_acct_hands_journal, public.ca_club_acct_state, public.ca_club_acct_seed_log,
              public.ca_club_acct_boundary_log, public.ca_club_acct_projection_failures
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.ca_club_acct_projection_failures_id_seq FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Helpers. Sentinels: a fee or result no player is named for is the
--    unattributed player (zero uuid) of its club, so club totals keep it; a
--    cash fee with no table and a carried entry with no tournament each get
--    their own game id.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_ca_club_acct_safe_day(p_at timestamptz)
RETURNS date LANGUAGE plpgsql STABLE SET search_path = public AS $function$
BEGIN
  RETURN public.fn_ca_accounting_day(p_at);
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

-- The day of a set of cash rake sources, and of a set of hands; NULL when it
-- cannot be read. Used only to name a failure's day, so never raises.
CREATE FUNCTION public.fn_ca_club_acct_day_of_sources(p_ids uuid[])
RETURNS date LANGUAGE plpgsql STABLE SET search_path = public AS $function$
BEGIN
  RETURN (SELECT public.fn_ca_accounting_day(min(s.earned_at)) FROM public.accounting_cash_rake_sources s
           WHERE s.id = ANY (p_ids));
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

CREATE FUNCTION public.fn_ca_club_acct_day_of_hands(p_tables uuid[], p_hands bigint[])
RETURNS date LANGUAGE plpgsql STABLE SET search_path = public AS $function$
BEGIN
  RETURN (SELECT public.fn_ca_accounting_day(min(o.recognized_at))
            FROM unnest(p_tables, p_hands) AS k(table_id, hand_number)
            JOIN public.union_pnl_cash_outcomes o ON (o.table_id, o.hand_number) = (k.table_id, k.hand_number));
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

-- Whether this transaction owns a live aggregate row's key. Never waits.
CREATE FUNCTION public.fn_ca_club_acct_own(p_key text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SET search_path = public AS $function$
DECLARE
  v_owned int := COALESCE(NULLIF(current_setting('ca.club_acct_owned', true), ''), '0')::int;
BEGIN
  IF v_owned >= 32 THEN
    RETURN false;
  END IF;
  IF pg_try_advisory_xact_lock(hashtextextended('ca-club-acct:' || p_key, 0)) THEN
    PERFORM set_config('ca.club_acct_owned', (v_owned + 1)::text, true);
    RETURN true;
  END IF;
  RETURN false;
END;
$function$;

-- Records a failure; never raises (a record that cannot be written becomes a
-- WARNING), so a projection can never refuse the money write it follows.
CREATE FUNCTION public.fn_ca_club_acct_fail(p_source text, p_day date, p_detail text, p_key text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  INSERT INTO public.ca_club_acct_projection_failures (source, source_key, acct_day, detail)
  VALUES (p_source, p_key, p_day, p_detail);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'club data accounting: % failure for % could not be recorded: % % (%)', p_source, p_day, SQLSTATE, SQLERRM, p_detail;
END;
$function$;

-- A boundary's key, independent of the session's time zone.
CREATE FUNCTION public.fn_ca_club_acct_boundary_key(p_union uuid, p_boundary timestamptz)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $function$
  SELECT p_union::text || ':' || extract(epoch FROM p_boundary)::text;
$function$;

-- The posted union tournament flows of a set that the invoice would have to
-- classify; fn_ca_club_acct_flow_rows returns one row for each it classifies.
CREATE FUNCTION public.fn_ca_club_acct_flow_eligible(p_flows jsonb)
RETURNS bigint LANGUAGE sql STABLE SET search_path = public AS $function$
  SELECT count(*) FROM jsonb_to_recordset(COALESCE(p_flows, '[]'::jsonb)) AS x(recognized_at timestamptz,
           game_scope jsonb, ledger_snapshot jsonb)
    JOIN public.unions u ON u.id::text = x.game_scope->>'game_union_id'
   WHERE NULLIF(x.game_scope->>'tournament_id', '') IS NOT NULL AND x.ledger_snapshot->>'status' = 'posted'
     AND x.recognized_at IS NOT NULL AND (x.ledger_snapshot->>'amount')::numeric > 0;
$function$;

-- ---------------------------------------------------------------------------
-- 3. The writers. Rows are summed per key first, in key order. src 0: the
--    row's owner upserts it, anyone else appends a journal row. src 1 and 2:
--    their single writer upserts.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_ca_club_acct_put(p_rows jsonb, p_src smallint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT x.club_id, x.acct_day, min(x.kind) AS kind, x.game_id, x.user_id, min(x.union_id::text)::uuid AS union_id,
           sum(COALESCE(x.fee, 0)) AS fee, sum(COALESCE(x.result, 0)) AS result, sum(COALESCE(x.buyins, 0)) AS buyins,
           sum(COALESCE(x.cashouts, 0)) AS cashouts, sum(COALESCE(x.hands, 0))::bigint AS hands, max(x.at) AS at
      FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb)) AS x(club_id uuid, acct_day date, kind text, game_id uuid,
             user_id uuid, union_id uuid, fee numeric, result numeric, buyins numeric, cashouts numeric, hands bigint,
             at timestamptz)
     WHERE x.club_id IS NOT NULL AND x.acct_day IS NOT NULL AND x.game_id IS NOT NULL AND x.user_id IS NOT NULL
       AND x.kind IN ('CASH', 'TOURNAMENT') AND x.at IS NOT NULL
     GROUP BY x.club_id, x.acct_day, x.game_id, x.user_id
     ORDER BY x.club_id, x.acct_day, x.game_id, x.user_id
  LOOP
    CONTINUE WHEN r.fee = 0 AND r.result = 0 AND r.buyins = 0 AND r.cashouts = 0 AND r.hands = 0;
    IF p_src <> 0
       OR public.fn_ca_club_acct_own('f:' || r.club_id || ':' || r.acct_day || ':' || r.game_id || ':' || r.user_id) THEN
      INSERT INTO public.ca_club_acct_fact AS f
        (club_id, acct_day, kind, game_id, user_id, union_id, fee, result, buyins, cashouts, hands, last_at, src)
      VALUES (r.club_id, r.acct_day, r.kind, r.game_id, r.user_id, r.union_id, r.fee, r.result, r.buyins, r.cashouts,
              r.hands, r.at, p_src)
      ON CONFLICT (club_id, acct_day, game_id, user_id, src) DO UPDATE
         SET fee = f.fee + EXCLUDED.fee, result = f.result + EXCLUDED.result,
             buyins = f.buyins + EXCLUDED.buyins, cashouts = f.cashouts + EXCLUDED.cashouts,
             hands = f.hands + EXCLUDED.hands, union_id = COALESCE(f.union_id, EXCLUDED.union_id),
             last_at = GREATEST(f.last_at, EXCLUDED.last_at);
    ELSE
      INSERT INTO public.ca_club_acct_fact_journal
        (club_id, acct_day, kind, game_id, user_id, union_id, fee, result, buyins, cashouts, hands, last_at)
      VALUES (r.club_id, r.acct_day, r.kind, r.game_id, r.user_id, r.union_id, r.fee, r.result, r.buyins, r.cashouts,
              r.hands, r.at);
    END IF;
  END LOOP;
END;
$function$;

CREATE FUNCTION public.fn_ca_club_acct_put_hands(p_rows jsonb, p_src smallint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT x.club_id, x.acct_day, x.table_id, sum(x.hands)::bigint AS hands
      FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb)) AS x(club_id uuid, acct_day date, table_id uuid, hands bigint)
     WHERE x.club_id IS NOT NULL AND x.acct_day IS NOT NULL AND x.table_id IS NOT NULL
     GROUP BY x.club_id, x.acct_day, x.table_id
     ORDER BY x.club_id, x.acct_day, x.table_id
  LOOP
    CONTINUE WHEN r.hands = 0;
    IF p_src <> 0 OR public.fn_ca_club_acct_own('h:' || r.club_id || ':' || r.acct_day || ':' || r.table_id) THEN
      INSERT INTO public.ca_club_acct_hands AS h (club_id, acct_day, table_id, hands, src)
      VALUES (r.club_id, r.acct_day, r.table_id, r.hands, p_src)
      ON CONFLICT (club_id, acct_day, table_id, src) DO UPDATE SET hands = h.hands + EXCLUDED.hands;
    ELSE
      INSERT INTO public.ca_club_acct_hands_journal (club_id, acct_day, table_id, hands)
      VALUES (r.club_id, r.acct_day, r.table_id, r.hands);
    END IF;
  END LOOP;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Per-record projections. The live triggers and the day load call the
--    same functions with the same rules.
-- ---------------------------------------------------------------------------

-- 4a. Cash fee: a union's accounting_cash_rake_sources rows, club as the
--     effective source view gives it (the funding admission's club when one
--     exists), counted only from that club's launch accounting cutoff, as
--     accounting_payable_earning_sources counts it.
CREATE FUNCTION public.fn_ca_club_acct_cash_fee_rows(p_sources jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'club_id', COALESCE(a.funding_club_id, s.club_id),
           'acct_day', public.fn_ca_accounting_day(s.earned_at),
           'kind', 'CASH',
           'game_id', COALESCE(rr.table_id, '00000000-0000-0000-0000-0000000000c1'::uuid),
           'user_id', COALESCE(s.player_id, '00000000-0000-0000-0000-000000000000'::uuid),
           'union_id', s.union_id, 'fee', s.rake_credit, 'at', s.earned_at)), '[]'::jsonb)
    FROM jsonb_to_recordset(COALESCE(p_sources, '[]'::jsonb)) AS s(id uuid, rake_record_id uuid, player_id uuid,
                                            club_id uuid, union_id uuid, earned_at timestamptz, rake_credit numeric)
    LEFT JOIN public.rake_records rr ON rr.id = s.rake_record_id
    LEFT JOIN public.accounting_cash_funding_contract_admissions a ON a.source_id = s.id
    LEFT JOIN public.fn_ca_launch_accounting_club_cutoffs() bd(club_id, cutoff_at)
      ON bd.club_id = COALESCE(a.funding_club_id, s.club_id)
   WHERE s.union_id IS NOT NULL AND s.earned_at IS NOT NULL AND isfinite(s.earned_at)
     AND EXISTS (SELECT 1 FROM public.unions u WHERE u.id = s.union_id)
     AND (bd.cutoff_at IS NULL OR s.earned_at >= bd.cutoff_at);
$function$;

-- 4b. A funding admission moves an already counted cash fee between clubs,
--     each side under its own club's cutoff, exactly as 4a reads it.
CREATE FUNCTION public.fn_ca_club_acct_admission_rows(p_admissions jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $function$
  WITH a AS (
    SELECT s.*, x.funding_club_id, rr.table_id
      FROM jsonb_to_recordset(COALESCE(p_admissions, '[]'::jsonb)) AS x(source_id uuid, funding_club_id uuid)
      JOIN public.accounting_cash_rake_sources s ON s.id = x.source_id
      LEFT JOIN public.rake_records rr ON rr.id = s.rake_record_id
     WHERE x.funding_club_id IS DISTINCT FROM s.club_id AND s.union_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.unions u WHERE u.id = s.union_id)
       AND s.earned_at IS NOT NULL AND isfinite(s.earned_at)
  ), sides AS (
    SELECT a.club_id AS club, -1 AS sign, a.* FROM a
    UNION ALL
    SELECT a.funding_club_id, 1, a.* FROM a
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'club_id', x.club, 'acct_day', public.fn_ca_accounting_day(x.earned_at), 'kind', 'CASH',
           'game_id', COALESCE(x.table_id, '00000000-0000-0000-0000-0000000000c1'::uuid),
           'user_id', COALESCE(x.player_id, '00000000-0000-0000-0000-000000000000'::uuid),
           'union_id', x.union_id, 'fee', x.sign * x.rake_credit, 'at', x.earned_at)), '[]'::jsonb)
    FROM sides x
    LEFT JOIN public.fn_ca_launch_accounting_club_cutoffs() bd(club_id, cutoff_at) ON bd.club_id = x.club
   WHERE x.club IS NOT NULL AND (bd.cutoff_at IS NULL OR x.earned_at >= bd.cutoff_at);
$function$;

-- 4c. Tournament fee: exactly the tournament half of
--     accounting_payable_earning_sources, dated by its recognition.
CREATE FUNCTION public.fn_ca_club_acct_tournament_fee_rows(p_recognized jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'club_id', s.club_id, 'acct_day', public.fn_ca_accounting_day(rs.recognized_at),
           'kind', 'TOURNAMENT', 'game_id', s.tournament_id,
           'user_id', COALESCE(s.player_id, '00000000-0000-0000-0000-000000000000'::uuid),
           'union_id', s.union_id, 'fee', s.rake_credit, 'at', rs.recognized_at)), '[]'::jsonb)
    FROM jsonb_to_recordset(COALESCE(p_recognized, '[]'::jsonb)) AS rs(source_id uuid, tournament_id uuid,
                                            recognized_at timestamptz, disposition text, rake_credit numeric)
    JOIN public.accounting_effective_tournament_fee_sources s
      ON s.id = rs.source_id AND s.tournament_id = rs.tournament_id AND s.rake_credit = rs.rake_credit
    JOIN public.accounting_tournament_fee_recognitions r
      ON r.tournament_id = s.tournament_id AND r.recognized_at = rs.recognized_at AND r.status = 'recognized'
     AND NOT (s.union_id IS DISTINCT FROM r.union_id)
    LEFT JOIN public.fn_ca_launch_accounting_club_cutoffs() bd(club_id, cutoff_at) ON bd.club_id = s.club_id
   WHERE rs.disposition = 'earned' AND s.club_id IS NOT NULL AND s.union_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.unions u WHERE u.id = s.union_id)
     AND (bd.cutoff_at IS NULL OR (s.charged_at IS NOT NULL AND isfinite(s.charged_at) AND s.charged_at >= bd.cutoff_at
                                   AND rs.recognized_at IS NOT NULL AND isfinite(rs.recognized_at)
                                   AND rs.recognized_at >= bd.cutoff_at));
$function$;

-- 4d. Cash hands. p_hands rows: table_id, hand_number, recognized_at,
--     union_id, participants (resolved the way the invoice reader resolves
--     them). A participant the record names no player for is the club's
--     unattributed player. Returns {"facts": [...], "hands": [...]}.
CREATE FUNCTION public.fn_ca_club_acct_hand_rows(p_hands jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $function$
  WITH h AS (
    SELECT x.table_id, x.hand_number, x.recognized_at, x.union_id, x.participants, COALESCE(x.sign, 1) AS sign
      FROM jsonb_to_recordset(COALESCE(p_hands, '[]'::jsonb)) AS x(table_id uuid, hand_number bigint,
             recognized_at timestamptz, union_id uuid, participants jsonb, sign int)
     WHERE x.table_id IS NOT NULL AND x.recognized_at IS NOT NULL AND x.union_id IS NOT NULL
  ), p AS (
    SELECT h.table_id, h.hand_number, h.recognized_at, public.fn_ca_accounting_day(h.recognized_at) AS acct_day,
           h.union_id, h.sign, (q->>'earning_club_id')::uuid AS club_id,
           COALESCE((q->>'user_id')::uuid, '00000000-0000-0000-0000-000000000000'::uuid) AS user_id,
           COALESCE((q->>'observed_stack_delta')::numeric, 0) AS delta
      FROM h CROSS JOIN LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(h.participants) = 'array' THEN h.participants ELSE '[]'::jsonb END) q
  )
  SELECT jsonb_build_object(
    'facts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'club_id', p.club_id, 'acct_day', p.acct_day, 'kind', 'CASH',
               'game_id', p.table_id, 'user_id', p.user_id, 'union_id', p.union_id,
               'result', p.sign * p.delta, 'hands', p.sign, 'at', p.recognized_at)) FROM p), '[]'::jsonb),
    'hands', COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'club_id', c.club_id, 'acct_day', c.acct_day, 'table_id', c.table_id, 'hands', c.n))
               FROM (SELECT p.club_id, p.acct_day, p.table_id, sum(p.sign) AS n
                       FROM (SELECT DISTINCT p.club_id, p.acct_day, p.table_id, p.hand_number, p.sign FROM p
                              WHERE p.club_id IS NOT NULL) p
                      GROUP BY 1, 2, 3) c), '[]'::jsonb));
$function$;

-- The same hand without its escrow certificate.
CREATE FUNCTION public.fn_ca_club_acct_unshaped_participants(h public.union_pnl_cash_outcome_touches)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public, smarter_private AS $function$
  SELECT COALESCE((
    SELECT CASE WHEN o.evidence->>'status' = 'blocked' AND o.recognized_at = h.recognized_at
                 AND o.game_scope->>'game_union_id' = h.game_union_id
                 AND o.evidence->>'accepted_rake' = h.accepted_rake
                 AND public.fn_union_pnl_compact_participants(o.evidence->'participants') = h.participants
                THEN smarter_private.original_treasury_cash_outcome_evidence(to_jsonb(o))->'participants' END
      FROM public.union_pnl_cash_outcomes o
     WHERE o.table_id = h.table_id AND o.hand_number = h.hand_number), h.participants);
$function$;

-- The participants the invoice reader uses for a touch
-- (fn_union_pnl_week_hand_lines, projected branch), with the escrow
-- certificate the hand holds now; a certificate inserted after its touch has
-- its own projection (trg_ca_club_acct_escrow_certificate).
CREATE FUNCTION public.fn_ca_club_acct_touch_participants(h public.union_pnl_cash_outcome_touches)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public, smarter_private AS $function$
  SELECT CASE
    WHEN h.shaped AND EXISTS (SELECT 1 FROM smarter_private.posthand_escrow_certificates cert
                               WHERE (cert.table_id, cert.hand_number) = (h.table_id, h.hand_number))
      THEN public.fn_union_pnl_posthand_escrow_touch(h)
    ELSE public.fn_ca_club_acct_unshaped_participants(h)
  END;
$function$;

-- A shaped hand's touch and its post-hand escrow certificate are projected
-- under the hand's own lock, so a touch and a certificate committing at the
-- same moment (neither seeing the other) are never both projected: the
-- second one cannot take the lock and its projection is recorded as a
-- failure for its day instead. Never waits. (Measured 2026-11-15: no shaped
-- touch in six hours, nine certificates in seven days.)
CREATE FUNCTION public.fn_ca_club_acct_hand_lock(p_table uuid, p_hand bigint)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path = public AS $function$
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('ca-club-acct:hand:' || p_table || ':' || p_hand, 0)) THEN
    RAISE EXCEPTION 'hand %:% is being projected by another open transaction', p_table, p_hand;
  END IF;
END;
$function$;

-- The union touches of a set, as hand rows (only a union this database holds).
CREATE FUNCTION public.fn_ca_club_acct_touch_hands(p_touches jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'table_id', t.table_id, 'hand_number', t.hand_number, 'recognized_at', t.recognized_at,
           'union_id', u.id, 'participants', public.fn_ca_club_acct_touch_participants(t))), '[]'::jsonb)
    FROM jsonb_populate_recordset(NULL::public.union_pnl_cash_outcome_touches, COALESCE(p_touches, '[]'::jsonb)) t
    JOIN public.unions u ON u.id::text = t.game_union_id;
$function$;

-- The participants the invoice reader uses for a link resolution
-- (fn_union_pnl_linked_cash_outcomes), and the hand's recognition time.
-- Callers pass each resolution without its proof (about 3.7 kB) and with
-- proof_ok = (proof_md5 = md5(proof::text)) instead (fn_ca_club_acct_link_row).
CREATE FUNCTION public.fn_ca_club_acct_link_hands(p_links jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public, smarter_private AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'table_id', r.table_id, 'hand_number', r.hand_number, 'recognized_at', o.recognized_at,
           'union_id', u.id,
           'participants', (CASE WHEN r.roster_source = 'lightning_pool'
                                 THEN smarter_private.original_lightning_funding_owner_evidence(r.table_id, r.hand_number, r.game_scope, r.evidence)
                                 ELSE r.evidence END)->'participants')), '[]'::jsonb)
    FROM jsonb_to_recordset(COALESCE(p_links, '[]'::jsonb)) AS r(table_id uuid, hand_number bigint, hand_id uuid,
           outcome_payload_hash text, outcome_evidence_md5 text, roster_source text, game_scope jsonb,
           evidence jsonb, proof_ok boolean)
    JOIN public.unions u ON u.id::text = r.game_scope->>'game_union_id'
    JOIN public.union_pnl_cash_outcomes o ON o.table_id = r.table_id AND o.hand_number = r.hand_number
   WHERE r.hand_id = o.hand_id AND r.outcome_payload_hash = o.payload_hash
     AND r.outcome_evidence_md5 = md5(o.evidence::text) AND r.proof_ok;
$function$;

-- A link resolution as fn_ca_club_acct_link_hands reads it.
CREATE FUNCTION public.fn_ca_club_acct_link_row(r public.union_pnl_cash_outcome_link_resolutions)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $function$
  SELECT jsonb_build_object('table_id', r.table_id, 'hand_number', r.hand_number, 'hand_id', r.hand_id,
           'outcome_payload_hash', r.outcome_payload_hash, 'outcome_evidence_md5', r.outcome_evidence_md5,
           'roster_source', r.roster_source, 'game_scope', r.game_scope, 'evidence', r.evidence,
           'proof_ok', COALESCE(r.proof_md5 = md5(r.proof::text), false));
$function$;

-- 4e. Tournament flows, owned by their receipts as
--     fn_union_pnl_original_flow_evidence classifies them: a funding receipt
--     makes a 'tournament_funding' (a loss), an accounting credit receipt, a
--     refund tranche or a refund entitlement makes a 'tournament_return' (a
--     gain), each for the receipt's club and player and only when that club
--     is the ledger's club (or, for a proven satellite seat refunded into
--     another club, the seat's funding club: owner ruling 2026-11-11). Cash
--     flows are not projected: the cash result is the hands.
CREATE FUNCTION public.fn_ca_club_acct_flow_rows(p_flows jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $function$
  WITH f AS (
    SELECT x.ledger_id, x.recognized_at, x.ledger_snapshot AS l, u.id AS union_id,
           NULLIF(x.game_scope->>'tournament_id', '')::uuid AS tid, (x.ledger_snapshot->>'amount')::numeric AS amt
      FROM jsonb_to_recordset(COALESCE(p_flows, '[]'::jsonb)) AS x(ledger_id uuid, recognized_at timestamptz,
             game_scope jsonb, ledger_snapshot jsonb)
      JOIN public.unions u ON u.id::text = x.game_scope->>'game_union_id'
     WHERE NULLIF(x.game_scope->>'tournament_id', '') IS NOT NULL AND x.ledger_snapshot->>'status' = 'posted'
       AND x.recognized_at IS NOT NULL
  ), c AS (
    SELECT f.*, e.funding_club_id AS e_club, e.user_id AS e_user, e.amount AS e_amount,
           cr.credited_club_id AS c_club, cr.user_id AS c_user, cr.amount AS c_amount,
           tr.source_wallet_club_id AS t_club, tr.user_id AS t_user, tr.amount_paid_now AS t_amount,
           en.refund_wallet_club_id AS n_wallet, en.user_id AS n_user, en.gross AS n_amount,
           CASE WHEN en.entitlement_kind = 'satellite_seat' THEN
             (SELECT o.club FROM (SELECT public.fn_union_pnl_satellite_seat_owner(en.registration_id, en.tournament_id) AS club) o
               WHERE o.club IS NOT NULL AND o.club <> en.refund_wallet_club_id) END AS n_funding
      FROM f
      LEFT JOIN public.tournament_participant_funding_receipts e
        ON e.ledger_id = f.ledger_id AND e.asset = 'chips' AND e.tournament_id = f.tid
      LEFT JOIN public.tournament_accounting_credit_receipts cr
        ON cr.ledger_id = f.ledger_id AND cr.tournament_id = f.tid
      LEFT JOIN public.tournament_refund_tranches tr
        ON cr.ledger_id IS NULL AND tr.credit_ledger_id = f.ledger_id AND tr.tournament_id = f.tid
      LEFT JOIN public.tournament_refund_entitlements en
        ON cr.ledger_id IS NULL AND tr.credit_ledger_id IS NULL
       AND f.l->>'idempotency_key' ~ '^tourney:[0-9a-f-]{36}:refund-entitlement:[0-9a-f-]{36}$'
       AND en.id = split_part(f.l->>'idempotency_key', ':', 4)::uuid AND en.tournament_id = f.tid
       AND en.entitlement_kind IN ('satellite_seat', 'wallet_charge', 'tournament_ticket')
  ), k AS (
    SELECT c.*,
      CASE
        WHEN c.e_club IS NOT NULL AND c.l->>'to_type' = 'prize_liability'
             AND c.l->>'category' IN ('tournament_buyin', 'rebuy', 'addon')
             AND c.e_amount = c.amt AND c.e_club::text = c.l->>'club_id' THEN 'funding'
        WHEN c.l->>'from_type' = 'prize_liability'
             AND c.l->>'category' IN ('tournament_prize', 'prize', 'bounty', 'refund', 'tournament_refund')
             AND ((c.c_club IS NOT NULL AND c.c_amount = c.amt AND c.c_club::text = c.l->>'club_id')
               OR (c.c_club IS NULL AND c.t_club IS NOT NULL AND c.t_amount = c.amt AND c.t_club::text = c.l->>'club_id')
               OR (c.c_club IS NULL AND c.t_club IS NULL AND c.n_wallet IS NOT NULL AND c.n_amount = c.amt
                   AND c.n_wallet::text = c.l->>'club_id' AND c.l->>'to_type' = 'player_wallet'
                   AND c.n_user::text = c.l->>'to_entity_id')) THEN 'return'
      END AS flow_kind,
      COALESCE(c.e_club, c.c_club, c.t_club, c.n_funding, c.n_wallet) AS owner_club,
      COALESCE(c.e_user, c.c_user, c.t_user, c.n_user) AS owner_user
      FROM c
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'club_id', k.owner_club, 'acct_day', public.fn_ca_accounting_day(k.recognized_at), 'kind', 'TOURNAMENT',
           'game_id', k.tid, 'user_id', k.owner_user, 'union_id', k.union_id,
           'result', CASE WHEN k.flow_kind = 'funding' THEN -k.amt ELSE k.amt END,
           'buyins', CASE WHEN k.flow_kind = 'funding' THEN k.amt ELSE 0 END,
           'cashouts', CASE WHEN k.flow_kind = 'return' THEN k.amt ELSE 0 END,
           'at', k.recognized_at)), '[]'::jsonb)
    FROM k
   WHERE k.flow_kind IS NOT NULL AND k.owner_club IS NOT NULL AND k.owner_user IS NOT NULL AND k.amt > 0;
$function$;

-- 4f. BBJ stack awards: the invoice's own reader, one recipient at a time.
CREATE FUNCTION public.fn_ca_club_acct_bbj_rows(p_payout uuid, p_user uuid, p_at timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'club_id', a.club_id, 'acct_day', public.fn_ca_accounting_day(p_at), 'kind', 'CASH',
           'game_id', b.table_id, 'user_id', p_user, 'union_id', t.union_id,
           'result', a.amount, 'at', p_at)), '[]'::jsonb)
    FROM public.bbj_payouts b
    JOIN public.tables t ON t.id = b.table_id AND t.union_id IS NOT NULL
    CROSS JOIN LATERAL public.fn_union_pnl_week_bbj_stack_awards(t.union_id, p_at, p_at + interval '1 day') a
   WHERE b.id = p_payout AND a.payout_id = p_payout AND a.user_id = p_user AND a.club_id IS NOT NULL;
$function$;

-- 4g. Deferred tournament entries of one side of a week boundary.
CREATE FUNCTION public.fn_ca_club_acct_boundary_rows(p_union uuid, p_boundary timestamptz, p_value jsonb,
                                                     p_day date, p_sign int)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'club_id', (h->>'club_id')::uuid, 'acct_day', p_day, 'kind', 'TOURNAMENT',
           'game_id', COALESCE(tp.tournament_id, '00000000-0000-0000-0000-0000000000d1'::uuid),
           'user_id', (h->>'user_id')::uuid, 'union_id', p_union,
           'result', p_sign * (h->>'amount')::numeric, 'at', p_boundary)), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(p_value->'holdings', '[]'::jsonb)) h
    LEFT JOIN public.tournament_players tp ON tp.id = NULLIF(h->>'source_id', '')::uuid
   WHERE h->>'kind' = 'deferred_tournament_result' AND h->>'club_id' IS NOT NULL AND h->>'user_id' IS NOT NULL;
$function$;

-- Load (or reload) one boundary's deferred entries into src 2: the opening
-- side (week starting at the boundary, -amount on its first accounting day)
-- and the closing side (week ending at it, +amount on its last accounting
-- day), each from the version that week's invoice used,
-- fn_ca_union_pnl_boundary_for_invoice(union, boundary, invoice created_at)
-- (20261115015159); before a week's invoice exists, the latest kept version
-- (a later version reloads the boundary through trg_ca_club_acct_boundary).
-- A side with no qualifying version is not invoice-exact: nothing is loaded
-- for it, never a later version, and the log says so (the reader reports
-- that day incomplete). Another loader of the same boundary wins (try-lock).
CREATE FUNCTION public.fn_ca_club_acct_load_boundary(p_union uuid, p_boundary timestamptz)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_open_day date := public.fn_ca_accounting_day(p_boundary);
  v_close_day date := public.fn_ca_accounting_day(p_boundary - interval '1 microsecond');
  v_open_issued timestamptz; v_close_issued timestamptz;
  v_open public.ca_union_pnl_boundary_capture; v_close public.ca_union_pnl_boundary_capture;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('ca-club-acct:b:' || public.fn_ca_club_acct_boundary_key(p_union, p_boundary), 0)) THEN
    RETURN NULL;
  END IF;
  SELECT min(si.created_at) INTO v_open_issued
    FROM public.settlement_invoices si JOIN public.settlement_periods sp ON sp.id = si.period_id
   WHERE sp.union_id = p_union AND sp.start_at = p_boundary
     AND si.invoice_type = 'union_weekly_squareup' AND si.status <> 'cancelled';
  SELECT min(si.created_at) INTO v_close_issued
    FROM public.settlement_invoices si JOIN public.settlement_periods sp ON sp.id = si.period_id
   WHERE sp.union_id = p_union AND sp.end_at = p_boundary
     AND si.invoice_type = 'union_weekly_squareup' AND si.status <> 'cancelled';
  v_open := public.fn_ca_union_pnl_boundary_for_invoice(p_union, p_boundary, COALESCE(v_open_issued, 'infinity'));
  v_close := public.fn_ca_union_pnl_boundary_for_invoice(p_union, p_boundary, COALESCE(v_close_issued, 'infinity'));

  DELETE FROM public.ca_club_acct_fact f
   WHERE f.src = 2 AND f.union_id = p_union AND f.last_at = p_boundary AND f.acct_day IN (v_open_day, v_close_day);
  IF v_open.union_id IS NOT NULL THEN
    v_rows := v_rows || public.fn_ca_club_acct_boundary_rows(p_union, p_boundary, v_open.value, v_open_day, -1);
  END IF;
  IF v_close.union_id IS NOT NULL THEN
    v_rows := v_rows || public.fn_ca_club_acct_boundary_rows(p_union, p_boundary, v_close.value, v_close_day, 1);
  END IF;
  PERFORM public.fn_ca_club_acct_put(v_rows, 2::smallint);

  INSERT INTO public.ca_club_acct_boundary_log AS g
    (union_id, boundary, opening_md5, opening_exact, closing_md5, closing_exact, fact_rows, loaded_at)
  VALUES (p_union, p_boundary, v_open.value_md5, v_open.union_id IS NOT NULL,
          v_close.value_md5, v_close.union_id IS NOT NULL, jsonb_array_length(v_rows), clock_timestamp())
  ON CONFLICT (union_id, boundary) DO UPDATE
     SET opening_md5 = EXCLUDED.opening_md5, opening_exact = EXCLUDED.opening_exact,
         closing_md5 = EXCLUDED.closing_md5, closing_exact = EXCLUDED.closing_exact,
         fact_rows = EXCLUDED.fact_rows, loaded_at = EXCLUDED.loaded_at;
  UPDATE public.ca_club_acct_projection_failures pf SET resolved_at = clock_timestamp()
   WHERE pf.source LIKE 'pnl_boundary%' AND pf.resolved_at IS NULL
     AND pf.source_key = public.fn_ca_club_acct_boundary_key(p_union, p_boundary);
  RETURN jsonb_array_length(v_rows);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Live projection trigger functions (attached by 20261115020011, except
--    the boundary one, attached here). Each runs its projection in its own
--    subtransaction and never waits more than 50 ms on any lock.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.trg_ca_club_acct_cash_fee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET lock_timeout = '50ms' AS $function$
BEGIN
  PERFORM public.fn_ca_club_acct_put(public.fn_ca_club_acct_cash_fee_rows(
    (SELECT jsonb_agg(to_jsonb(n)) FROM new_rows n)), 0::smallint);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    PERFORM public.fn_ca_club_acct_fail('cash_fee', (SELECT public.fn_ca_club_acct_safe_day(min(n.earned_at)) FROM new_rows n),
      SQLSTATE || ' ' || SQLERRM || ' ids=' || COALESCE((SELECT string_agg(n.id::text, ',') FROM new_rows n), ''));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'club data accounting projection could not record its failure: % %', SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;

CREATE FUNCTION public.trg_ca_club_acct_admission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET lock_timeout = '50ms' AS $function$
BEGIN
  PERFORM public.fn_ca_club_acct_put(public.fn_ca_club_acct_admission_rows(
    (SELECT jsonb_agg(to_jsonb(n)) FROM new_rows n)), 0::smallint);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    PERFORM public.fn_ca_club_acct_fail('cash_fee_admission',
      public.fn_ca_club_acct_day_of_sources(ARRAY(SELECT n.source_id FROM new_rows n)),
      SQLSTATE || ' ' || SQLERRM || ' sources=' || COALESCE((SELECT string_agg(n.source_id::text, ',') FROM new_rows n), ''));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'club data accounting projection could not record its failure: % %', SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;

CREATE FUNCTION public.trg_ca_club_acct_tournament_fee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET lock_timeout = '50ms' AS $function$
BEGIN
  PERFORM public.fn_ca_club_acct_put(public.fn_ca_club_acct_tournament_fee_rows(
    (SELECT jsonb_agg(to_jsonb(n)) FROM new_rows n)), 0::smallint);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    PERFORM public.fn_ca_club_acct_fail('tournament_fee', (SELECT public.fn_ca_club_acct_safe_day(min(n.recognized_at)) FROM new_rows n),
      SQLSTATE || ' ' || SQLERRM || ' sources=' || COALESCE((SELECT string_agg(n.source_id::text, ',') FROM new_rows n), ''));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'club data accounting projection could not record its failure: % %', SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;

CREATE FUNCTION public.trg_ca_club_acct_touch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET lock_timeout = '50ms' AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public.fn_ca_club_acct_hand_lock(n.table_id, n.hand_number) FROM new_rows n WHERE n.shaped;
  v := public.fn_ca_club_acct_hand_rows(public.fn_ca_club_acct_touch_hands(
         (SELECT jsonb_agg(to_jsonb(n)) FROM new_rows n WHERE n.game_union_id IS NOT NULL)));
  PERFORM public.fn_ca_club_acct_put(v->'facts', 0::smallint);
  PERFORM public.fn_ca_club_acct_put_hands(v->'hands', 0::smallint);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    PERFORM public.fn_ca_club_acct_fail('cash_hand', (SELECT public.fn_ca_club_acct_safe_day(min(n.recognized_at)) FROM new_rows n),
      SQLSTATE || ' ' || SQLERRM || ' hands=' || COALESCE((SELECT string_agg(n.table_id::text || ':' || n.hand_number, ',') FROM new_rows n), ''));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'club data accounting projection could not record its failure: % %', SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;

CREATE FUNCTION public.trg_ca_club_acct_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET lock_timeout = '50ms' AS $function$
DECLARE v jsonb;
BEGIN
  v := public.fn_ca_club_acct_hand_rows(public.fn_ca_club_acct_link_hands(
         (SELECT jsonb_agg(public.fn_ca_club_acct_link_row(n)) FROM new_rows n)));
  PERFORM public.fn_ca_club_acct_put(v->'facts', 0::smallint);
  PERFORM public.fn_ca_club_acct_put_hands(v->'hands', 0::smallint);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    PERFORM public.fn_ca_club_acct_fail('linked_hand',
      public.fn_ca_club_acct_day_of_hands(ARRAY(SELECT n.table_id FROM new_rows n), ARRAY(SELECT n.hand_number FROM new_rows n)),
      SQLSTATE || ' ' || SQLERRM || ' hands=' || COALESCE((SELECT string_agg(n.table_id::text || ':' || n.hand_number, ',') FROM new_rows n), ''));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'club data accounting projection could not record its failure: % %', SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;

-- A post-hand escrow certificate inserted after its touch reshapes the hand:
-- the escrow participants are added and the ones the touch was projected
-- with taken back (facts and the per-table hand count), in src 0. A day load
-- reads the hand with whatever certificate it holds and subtracts src 0, so
-- the correction is never counted twice.
CREATE FUNCTION public.trg_ca_club_acct_escrow_certificate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, smarter_private SET lock_timeout = '50ms' AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public.fn_ca_club_acct_hand_lock(n.table_id, n.hand_number) FROM new_rows n;
  v := public.fn_ca_club_acct_hand_rows((
    SELECT jsonb_agg(x) FROM public.union_pnl_cash_outcome_touches t
      JOIN new_rows n ON (t.table_id, t.hand_number) = (n.table_id, n.hand_number)
      JOIN public.unions u ON u.id::text = t.game_union_id
     CROSS JOIN LATERAL (VALUES
       (jsonb_build_object('table_id', t.table_id, 'hand_number', t.hand_number, 'recognized_at', t.recognized_at,
          'union_id', u.id, 'sign', 1, 'participants', public.fn_union_pnl_posthand_escrow_touch(t))),
       (jsonb_build_object('table_id', t.table_id, 'hand_number', t.hand_number, 'recognized_at', t.recognized_at,
          'union_id', u.id, 'sign', -1, 'participants', public.fn_ca_club_acct_unshaped_participants(t)))) s(x)
     WHERE t.shaped));
  PERFORM public.fn_ca_club_acct_put(v->'facts', 0::smallint);
  PERFORM public.fn_ca_club_acct_put_hands(v->'hands', 0::smallint);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    PERFORM public.fn_ca_club_acct_fail('escrow_certificate',
      public.fn_ca_club_acct_day_of_hands(ARRAY(SELECT n.table_id FROM new_rows n), ARRAY(SELECT n.hand_number FROM new_rows n)),
      SQLSTATE || ' ' || SQLERRM || ' hands=' || COALESCE((SELECT string_agg(n.table_id::text || ':' || n.hand_number, ',') FROM new_rows n), ''));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'club data accounting projection could not record its failure: % %', SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;

-- At commit, one flow at a time: the flow's receipt is written in the same
-- transaction as the flow (measured 2026-11-15 over 24 hours: 15,008 union
-- tournament flows, every one owned by a funding receipt, an accounting
-- credit receipt or a refund tranche carrying the flow's own transaction_id),
-- so it exists when the deferred trigger runs.
-- A posted union tournament flow no receipt rule classifies is never
-- dropped silently: it is recorded as a failure of its day (the invoice
-- refuses to certify such a week too). Measured 2026-11-15 over 7 days:
-- 186,945 posted union tournament flows, every one classified.
CREATE FUNCTION public.trg_ca_club_acct_flow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET lock_timeout = '50ms' AS $function$
DECLARE f jsonb := jsonb_build_array(to_jsonb(NEW)); v jsonb;
BEGIN
  IF NULLIF(NEW.game_scope->>'tournament_id', '') IS NOT NULL THEN
    v := public.fn_ca_club_acct_flow_rows(f);
    IF jsonb_array_length(v) < public.fn_ca_club_acct_flow_eligible(f) THEN
      PERFORM public.fn_ca_club_acct_fail('tournament_flow_unclassified', public.fn_ca_club_acct_safe_day(NEW.recognized_at),
        'no receipt rule classifies ledger=' || NEW.ledger_id, NEW.ledger_id::text);
    END IF;
    PERFORM public.fn_ca_club_acct_put(v, 0::smallint);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    PERFORM public.fn_ca_club_acct_fail('tournament_flow', public.fn_ca_club_acct_safe_day(NEW.recognized_at),
      SQLSTATE || ' ' || SQLERRM || ' ledger=' || NEW.ledger_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'club data accounting projection could not record its failure: % %', SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;

-- At commit: the share's wallet leg and its original flow are written in the
-- same transaction as the recipient row.
CREATE FUNCTION public.trg_ca_club_acct_bbj()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET lock_timeout = '50ms' AS $function$
BEGIN
  PERFORM public.fn_ca_club_acct_put(public.fn_ca_club_acct_bbj_rows(NEW.payout_id, NEW.user_id, NEW.created_at), 0::smallint);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    PERFORM public.fn_ca_club_acct_fail('bbj_award', public.fn_ca_club_acct_safe_day(NEW.created_at),
      SQLSTATE || ' ' || SQLERRM || ' payout=' || NEW.payout_id || ' user=' || NEW.user_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'club data accounting projection could not record its failure: % %', SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;

-- A kept boundary certificate (20261115015159) loads its boundary.
-- A kept boundary certificate (20261115015159) loads its boundary. When
-- another transaction is loading the same boundary (its try-lock is taken),
-- or the load raises, both days of the boundary are recorded as failures;
-- the next successful load of the boundary resolves them.
CREATE FUNCTION public.trg_ca_club_acct_boundary()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET lock_timeout = '50ms' AS $function$
DECLARE v_key text := public.fn_ca_club_acct_boundary_key(NEW.union_id, NEW.boundary);
BEGIN
  IF public.fn_ca_club_acct_load_boundary(NEW.union_id, NEW.boundary) IS NULL THEN
    PERFORM public.fn_ca_club_acct_fail('pnl_boundary_busy', d, 'boundary ' || v_key || ' was being loaded by another transaction', v_key)
       FROM unnest(ARRAY[public.fn_ca_club_acct_safe_day(NEW.boundary),
                         public.fn_ca_club_acct_safe_day(NEW.boundary - interval '1 microsecond')]) d;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    PERFORM public.fn_ca_club_acct_fail('pnl_boundary', d, SQLSTATE || ' ' || SQLERRM || ' boundary=' || v_key, v_key)
       FROM unnest(ARRAY[public.fn_ca_club_acct_safe_day(NEW.boundary),
                         public.fn_ca_club_acct_safe_day(NEW.boundary - interval '1 microsecond')]) d;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'club data accounting projection could not record its failure: % %', SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;

CREATE TRIGGER ca_club_acct_boundary
  AFTER INSERT ON public.ca_union_pnl_boundary_capture
  FOR EACH ROW EXECUTE FUNCTION public.trg_ca_club_acct_boundary();

-- The certificate copy (20261115015159, installed text md5 95729de2...)
-- records a failed copy; if that record itself cannot be written it now
-- becomes a WARNING instead of refusing the certificate. Nothing else changes.
DO $capture$ BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_ca_union_pnl_boundary_capture()'::regprocedure)
     <> '95729de2731d6fdcb7e7fa928b69a638' THEN
    RAISE EXCEPTION 'pnl boundary capture preimage changed';
  END IF;
END $capture$;
CREATE OR REPLACE FUNCTION public.fn_ca_union_pnl_boundary_capture()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
SET lock_timeout = '50ms' AS $function$
BEGIN
  IF NEW.kind = 'pnl_boundary' AND NEW.period_start = NEW.period_end
     AND NEW.value->>'status' = 'ready' THEN
    BEGIN
      INSERT INTO public.ca_union_pnl_boundary_capture (union_id, boundary, certified_at, value, value_md5)
      VALUES (NEW.union_id, NEW.period_start, NEW.certified_at, NEW.value, md5(NEW.value::text))
      ON CONFLICT (union_id, boundary, certified_at, value_md5) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        INSERT INTO public.ca_union_pnl_boundary_capture_failures (union_id, boundary, certified_at, value, detail)
        VALUES (NEW.union_id, NEW.period_start, NEW.certified_at, NEW.value, SQLSTATE || ' ' || SQLERRM);
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
      RAISE WARNING 'pnl boundary capture failed for % %: % %', NEW.union_id, NEW.period_start, SQLSTATE, SQLERRM;
    END;
  END IF;
  RETURN NULL;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. The day load. One accounting day per call, inside one REPEATABLE READ
--    transaction (refused otherwise), so every read below and the day's
--    live rows come from the same snapshot:
--
--      src 1 (day) := whole day projected from every source row it holds
--                     - src 0 aggregate rows of the day
--      and the day's journal rows in the snapshot are folded in (deleted):
--      their events are in the whole day. A journal row committed after
--      the snapshot is invisible to the delete and its events to the load,
--      so it stays and is counted once.
--
--    The whole day uses the projections the live triggers use. src 0 + src 1
--    is therefore the whole day whatever the cutover split, and a row
--    inserted after the snapshot is the live projection's alone. A day
--    already loaded is refused unless p_rebuild, which replaces its src 1 in
--    the same transaction. Refused before the live projection is attached and
--    while another load runs (a try-lock: a second load is refused, never
--    queued). The day load never writes a src 0 row or a journal row.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_ca_club_acct_seed_day(p_day date, p_rebuild boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, smarter_private SET statement_timeout = '600s' SET work_mem = '128MB' AS $function$
DECLARE
  v_lo timestamptz := public.fn_ca_accounting_day_start(p_day);
  v_hi timestamptz := public.fn_ca_accounting_day_start(p_day + 1);
  w_lo timestamptz; w_hi timestamptz; v jsonb; f jsonb; n_f bigint := 0; n_h bigint := 0; n_live bigint; n_fix bigint;
  n_unclassified bigint := 0;
BEGIN
  IF p_day IS NULL THEN
    RAISE EXCEPTION 'club data accounting load needs a day' USING ERRCODE = '22023';
  END IF;
  IF current_setting('transaction_isolation') NOT IN ('repeatable read', 'serializable') THEN
    RAISE EXCEPTION 'club data accounting load runs in one REPEATABLE READ transaction (BEGIN ISOLATION LEVEL REPEATABLE READ)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ca_club_acct_state) THEN
    RAISE EXCEPTION 'club data accounting load waits for the live projection (20261115020011)';
  END IF;
  IF v_lo > now() THEN
    RAISE EXCEPTION 'accounting day % has not started', p_day USING ERRCODE = '22023';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('ca-club-acct:seed', 0)) THEN
    RAISE EXCEPTION 'another club data accounting load is running';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ca_club_acct_seed_log l WHERE l.acct_day = p_day) THEN
    IF NOT p_rebuild THEN RAISE EXCEPTION 'accounting day % is already loaded', p_day; END IF;
    DELETE FROM public.ca_club_acct_seed_log WHERE acct_day = p_day;
  END IF;
  DELETE FROM public.ca_club_acct_fact WHERE acct_day = p_day AND src = 1;
  DELETE FROM public.ca_club_acct_hands WHERE acct_day = p_day AND src = 1;

  -- The whole day, in two-hour slices, one union (or club) at a time through
  -- each source's (union | club, time) index; the day is one transaction.
  w_lo := v_lo;
  WHILE w_lo < v_hi LOOP
    w_hi := LEAST(w_lo + interval '2 hours', v_hi);

    v := public.fn_ca_club_acct_cash_fee_rows((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'rake_record_id', s.rake_record_id, 'player_id', s.player_id,
               'club_id', s.club_id, 'union_id', s.union_id, 'earned_at', s.earned_at, 'rake_credit', s.rake_credit))
        FROM public.unions u
        CROSS JOIN LATERAL (SELECT x.* FROM public.accounting_cash_rake_sources x
                             WHERE x.union_id = u.id AND x.earned_at >= w_lo AND x.earned_at < w_hi) s));
    PERFORM public.fn_ca_club_acct_put(v, 1::smallint); n_f := n_f + jsonb_array_length(v);

    v := public.fn_ca_club_acct_tournament_fee_rows((
      SELECT jsonb_agg(to_jsonb(rs)) FROM public.accounting_tournament_recognized_sources rs
       WHERE rs.recognized_at >= w_lo AND rs.recognized_at < w_hi));
    PERFORM public.fn_ca_club_acct_put(v, 1::smallint); n_f := n_f + jsonb_array_length(v);

    v := public.fn_ca_club_acct_hand_rows(public.fn_ca_club_acct_touch_hands((
      SELECT jsonb_agg(to_jsonb(t)) FROM public.unions u
       CROSS JOIN LATERAL (SELECT x.* FROM public.union_pnl_cash_outcome_touches x
                            WHERE x.game_union_id = u.id::text
                              AND x.recognized_at >= w_lo AND x.recognized_at < w_hi) t)));
    PERFORM public.fn_ca_club_acct_put(v->'facts', 1::smallint);
    PERFORM public.fn_ca_club_acct_put_hands(v->'hands', 1::smallint);
    n_f := n_f + jsonb_array_length(v->'facts'); n_h := n_h + jsonb_array_length(v->'hands');

    v := public.fn_ca_club_acct_hand_rows(public.fn_ca_club_acct_link_hands((
      SELECT jsonb_agg(public.fn_ca_club_acct_link_row(r)) FROM public.union_pnl_cash_outcome_link_resolutions r
        JOIN public.union_pnl_cash_outcomes o ON o.table_id = r.table_id AND o.hand_number = r.hand_number
       WHERE o.recognized_at >= w_lo AND o.recognized_at < w_hi AND r.game_scope->>'game_union_id' IS NOT NULL)));
    PERFORM public.fn_ca_club_acct_put(v->'facts', 1::smallint);
    PERFORM public.fn_ca_club_acct_put_hands(v->'hands', 1::smallint);
    n_f := n_f + jsonb_array_length(v->'facts'); n_h := n_h + jsonb_array_length(v->'hands');

    f := (SELECT jsonb_agg(to_jsonb(fl)) FROM public.unions u
           CROSS JOIN LATERAL (SELECT x.* FROM public.union_pnl_original_flows x
                                WHERE x.game_scope->>'game_union_id' = u.id::text
                                  AND x.recognized_at >= w_lo AND x.recognized_at < w_hi
                                  AND NULLIF(x.game_scope->>'tournament_id', '') IS NOT NULL) fl);
    v := public.fn_ca_club_acct_flow_rows(f);
    n_unclassified := n_unclassified + public.fn_ca_club_acct_flow_eligible(f) - jsonb_array_length(v);
    PERFORM public.fn_ca_club_acct_put(v, 1::smallint); n_f := n_f + jsonb_array_length(v);

    w_lo := w_hi;
  END LOOP;

  v := COALESCE((
    SELECT jsonb_agg(x) FROM public.bbj_payout_recipients r
     CROSS JOIN LATERAL jsonb_array_elements(public.fn_ca_club_acct_bbj_rows(r.payout_id, r.user_id, r.created_at)) x
     WHERE r.created_at >= v_lo AND r.created_at < v_hi), '[]'::jsonb);
  PERFORM public.fn_ca_club_acct_put(v, 1::smallint); n_f := n_f + jsonb_array_length(v);

  -- Minus what the live aggregate rows already hold for the day (same
  -- snapshot); the day's journal rows in the snapshot are folded in.
  PERFORM public.fn_ca_club_acct_put((
    SELECT jsonb_agg(jsonb_build_object('club_id', f.club_id, 'acct_day', f.acct_day, 'kind', f.kind,
             'game_id', f.game_id, 'user_id', f.user_id, 'union_id', f.union_id, 'fee', -f.fee, 'result', -f.result,
             'buyins', -f.buyins, 'cashouts', -f.cashouts, 'hands', -f.hands, 'at', f.last_at))
      FROM public.ca_club_acct_fact f WHERE f.acct_day = p_day AND f.src = 0), 1::smallint);
  PERFORM public.fn_ca_club_acct_put_hands((
    SELECT jsonb_agg(jsonb_build_object('club_id', h.club_id, 'acct_day', h.acct_day, 'table_id', h.table_id,
             'hands', -h.hands))
      FROM public.ca_club_acct_hands h WHERE h.acct_day = p_day AND h.src = 0), 1::smallint);
  DELETE FROM public.ca_club_acct_fact_journal j WHERE j.acct_day = p_day;
  GET DIAGNOSTICS n_live = ROW_COUNT;
  DELETE FROM public.ca_club_acct_hands_journal j WHERE j.acct_day = p_day;
  -- An all-zero src 1 row says nothing; a src 1 row that offsets live rows
  -- to zero is removed (the live rows keep the player's participation).
  DELETE FROM public.ca_club_acct_fact z
   WHERE z.acct_day = p_day AND z.src = 1
     AND z.fee = 0 AND z.result = 0 AND z.buyins = 0 AND z.cashouts = 0 AND z.hands = 0;
  DELETE FROM public.ca_club_acct_hands z WHERE z.acct_day = p_day AND z.src = 1 AND z.hands = 0;

  -- The day is whole again for every live projection of it; a boundary's
  -- failures are resolved only by loading that boundary.
  UPDATE public.ca_club_acct_projection_failures pf SET resolved_at = clock_timestamp()
   WHERE pf.acct_day = p_day AND pf.resolved_at IS NULL AND pf.source NOT LIKE 'pnl_boundary%';
  GET DIAGNOSTICS n_fix = ROW_COUNT;
  IF n_unclassified > 0 THEN
    PERFORM public.fn_ca_club_acct_fail('tournament_flow_unclassified', p_day,
      n_unclassified || ' posted union tournament flow(s) no receipt rule classifies (day load)');
  END IF;

  INSERT INTO public.ca_club_acct_seed_log (acct_day, fact_rows, hand_rows) VALUES (p_day, n_f, n_h);
  RETURN jsonb_build_object('acct_day', p_day, 'from', v_lo, 'to', v_hi, 'fact_inputs', n_f, 'hand_inputs', n_h,
                            'journal_rows_folded', n_live, 'failures_resolved', n_fix,
                            'unclassified_flows', n_unclassified);
END;
$function$;

REVOKE ALL ON FUNCTION
  public.fn_ca_club_acct_safe_day(timestamptz), public.fn_ca_club_acct_day_of_sources(uuid[]),
  public.fn_ca_club_acct_day_of_hands(uuid[], bigint[]), public.fn_ca_club_acct_own(text),
  public.fn_ca_club_acct_fail(text, date, text, text), public.fn_ca_club_acct_boundary_key(uuid, timestamptz),
  public.fn_ca_club_acct_flow_eligible(jsonb),
  public.fn_ca_club_acct_put(jsonb, smallint), public.fn_ca_club_acct_put_hands(jsonb, smallint),
  public.fn_ca_club_acct_cash_fee_rows(jsonb), public.fn_ca_club_acct_admission_rows(jsonb),
  public.fn_ca_club_acct_tournament_fee_rows(jsonb), public.fn_ca_club_acct_hand_rows(jsonb),
  public.fn_ca_club_acct_touch_participants(public.union_pnl_cash_outcome_touches),
  public.fn_ca_club_acct_unshaped_participants(public.union_pnl_cash_outcome_touches),
  public.fn_ca_club_acct_touch_hands(jsonb), public.fn_ca_club_acct_link_hands(jsonb),
  public.fn_ca_club_acct_link_row(public.union_pnl_cash_outcome_link_resolutions),
  public.fn_ca_club_acct_hand_lock(uuid, bigint),
  public.fn_ca_club_acct_flow_rows(jsonb), public.fn_ca_club_acct_bbj_rows(uuid, uuid, timestamptz),
  public.fn_ca_club_acct_boundary_rows(uuid, timestamptz, jsonb, date, int),
  public.fn_ca_club_acct_load_boundary(uuid, timestamptz), public.fn_ca_club_acct_seed_day(date, boolean),
  public.trg_ca_club_acct_cash_fee(), public.trg_ca_club_acct_admission(), public.trg_ca_club_acct_tournament_fee(),
  public.trg_ca_club_acct_touch(), public.trg_ca_club_acct_link(), public.trg_ca_club_acct_escrow_certificate(),
  public.trg_ca_club_acct_flow(), public.trg_ca_club_acct_bbj(), public.trg_ca_club_acct_boundary()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Every boundary kept so far (20261115015159), loaded by the history load
--    (scripts/ci/club-data-accounting-seed.mjs) before its first day, in its
--    own transaction: about 4,000 holdings per boundary would not fit this
--    installation's 12 s budget. A boundary kept later loads itself
--    (ca_club_acct_boundary).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_ca_club_acct_load_boundaries()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET statement_timeout = '300s' AS $function$
DECLARE r record; n bigint := 0; v_rows bigint := 0; v bigint;
BEGIN
  FOR r IN SELECT DISTINCT k.union_id, k.boundary FROM public.ca_union_pnl_boundary_capture k ORDER BY 1, 2 LOOP
    v := public.fn_ca_club_acct_load_boundary(r.union_id, r.boundary);
    IF v IS NULL THEN
      RAISE EXCEPTION 'boundary % % is being loaded by another transaction', r.union_id, r.boundary;
    END IF;
    n := n + 1; v_rows := v_rows + v;
  END LOOP;
  RETURN jsonb_build_object('boundaries', n, 'fact_inputs', v_rows,
    'not_invoice_exact', (SELECT jsonb_agg(jsonb_build_object('union_id', g.union_id, 'boundary', g.boundary,
                                   'opening_exact', g.opening_exact, 'closing_exact', g.closing_exact))
                            FROM public.ca_club_acct_boundary_log g WHERE NOT (g.opening_exact AND g.closing_exact)));
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_club_acct_load_boundaries() FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
