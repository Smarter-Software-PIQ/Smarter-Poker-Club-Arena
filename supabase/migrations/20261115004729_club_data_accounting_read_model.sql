-- 20261115004729_club_data_accounting_read_model
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-15.
--
-- CLUB DATA READS THE INVOICE'S OWN ACCOUNTING RECORDS (owner, 2026-11-14)
--
-- "The Club Data page must match the union weekly invoices 1:1, starting and
-- stopping at the same 2 AM boundary the invoices use."
--
-- The union weekly invoice (fn_union_club_invoice, fn_union_pnl_evidence_report)
-- is built from five accounting records. Club Data was built from two others
-- (rake_records with the seat's club, wallet_transactions buy-ins and
-- cash-outs) on Chicago midnight days and then moved horses to their current
-- club at display time. Measured on production for KINGS CLUB, week
-- 2026-11-02 08:00Z to 2026-11-09 08:00Z: invoice rake 25,854.24 against
-- Club Data cash fee 103,637.66 before the horse move; invoice player result
-- -37,160.83 against +20,428.90.
--
-- This migration installs the read model that carries the invoice's own
-- records, keyed by the 02:00 America/Chicago accounting day
-- (fn_ca_accounting_day, 20261114235606). Nothing here is read by a page yet,
-- and no trigger is attached: 20261115010436 attaches the live projection in
-- the 04:00 Chicago maintenance window and records its start; each day's
-- history is then loaded by fn_ca_club_acct_seed_day.
--
--   record (invoice field)                     -> ca_club_acct_fact
--   accounting_cash_rake_sources, moved by
--     accounting_cash_funding_contract_admissions
--     (rake_generated, cash)                   -> fee, CASH, earned_at day
--   accounting_tournament_recognized_sources x
--     fee sources x recognitions (rake_generated,
--     tournament)                              -> fee, TOURNAMENT, recognized_at day
--   union_pnl_cash_outcome_touches (gift and
--     post-hand escrow as fn_union_pnl_week_hand_lines
--     reads them) + union_pnl_cash_outcome_link_resolutions
--     (lightning funding owner) (cash player_pnl) -> result, CASH, per hand
--   fn_union_pnl_week_bbj_stack_awards (cash)  -> result, CASH (BBJ award)
--   union_pnl_original_flows (tournament funding
--     and returns; cash buy-ins and cash-outs)  -> result/buyins/cashouts
--   pnl_boundary certificates
--     (deferred_tournament_result holdings)    -> src 2: -opening on the
--                                                 boundary's day, +closing on
--                                                 the day before it
--
-- One writer per row and no double count. src 0 is written only by the live
-- projection, for every source row inserted after it is attached. src 1 is
-- written only by fn_ca_club_acct_seed_day, as the WHOLE day projected from
-- every source row the day holds MINUS the day's src 0, both read in one
-- REPEATABLE READ snapshot, so src 0 + src 1 equals the whole day exactly
-- whatever was inserted before, during or after the cutover. No transaction
-- id decides which side a row is on (a transaction open across the cutover,
-- or an xmin compared after wraparound, would make that answer wrong), and
-- loading a day again is idempotent: it replaces that day's src 1, which
-- also makes a day whole after a recorded projection failure. src 2 comes only from
-- pnl_boundary certificates. Every source table is insert-only (each carries
-- an *_immutable trigger), so an inserted row is projected once, except a
-- cash fee whose club a later funding admission moves and a shaped hand a
-- later post-hand escrow certificate reshapes, both of which have their own
-- projection.
--
-- A projection that fails never blocks the money write: the failure is
-- recorded in ca_club_acct_projection_failures (with its source key and, where
-- it can be named, its accounting day), and the Club Data reader reports a day
-- with an unresolved failure as incomplete. It is not swallowed. Loading the
-- day again (fn_ca_club_acct_seed_day(day, true)) makes it whole and marks the
-- day's failures resolved.
--
-- @live-proof: to_regclass('public.ca_club_acct_fact') IS NOT NULL
-- @live-proof: to_regprocedure('public.fn_ca_club_acct_seed_day(date,boolean)') IS NOT NULL

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '30s';

DO $guard$ BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'club data accounting read model requires the maintained installer';
  END IF;
  IF to_regclass('public.ca_club_acct_fact') IS NOT NULL THEN
    RAISE EXCEPTION 'club data accounting read model already installed';
  END IF;
  IF to_regprocedure('public.fn_ca_accounting_day(timestamptz)') IS NULL
     OR to_regprocedure('public.fn_ca_accounting_day_start(date)') IS NULL
     OR to_regprocedure('public.fn_union_pnl_posthand_escrow_touch(public.union_pnl_cash_outcome_touches)') IS NULL
     OR to_regprocedure('public.fn_union_pnl_compact_participants(jsonb)') IS NULL
     OR to_regprocedure('smarter_private.original_treasury_cash_outcome_evidence(jsonb)') IS NULL
     OR to_regprocedure('smarter_private.original_lightning_funding_owner_evidence(uuid,bigint,jsonb,jsonb)') IS NULL
     OR to_regprocedure('public.fn_union_pnl_week_bbj_stack_awards(uuid,timestamptz,timestamptz)') IS NULL
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
  last_at  timestamptz NOT NULL,
  src      smallint    NOT NULL CHECK (src IN (0, 1, 2)),
  PRIMARY KEY (club_id, acct_day, game_id, user_id, src)
);
CREATE INDEX ca_club_acct_fact_day_idx ON public.ca_club_acct_fact (acct_day, club_id);
COMMENT ON TABLE public.ca_club_acct_fact IS
  'Club Data on the union invoice''s accounting records, keyed by the 02:00 America/Chicago accounting day. fee = accounting rake_credit; result = player result (CASH: hand stack deltas by earning club plus BBJ stack awards; TOURNAMENT: returns minus funding, plus src 2 deferred-entry holdings at week boundaries). src 0 live projection; src 1 the day load (whole day minus src 0, one snapshot; may hold offsetting rows); src 2 pnl_boundary certificate. Readers sum all three.';

CREATE TABLE public.ca_club_acct_hands (
  club_id  uuid     NOT NULL,
  acct_day date     NOT NULL,
  table_id uuid     NOT NULL,
  hands    bigint   NOT NULL DEFAULT 0,
  src      smallint NOT NULL CHECK (src IN (0, 1)),
  PRIMARY KEY (club_id, acct_day, table_id, src)
);
COMMENT ON TABLE public.ca_club_acct_hands IS
  'Hands a club had at least one participant in, per table and accounting day, from the same hand records as ca_club_acct_fact.';

CREATE TABLE public.ca_club_acct_state (
  singleton  boolean     PRIMARY KEY DEFAULT true CHECK (singleton),
  live_from  timestamptz NOT NULL
);
COMMENT ON TABLE public.ca_club_acct_state IS
  'Written once by 20261115010436, in the transaction that attaches the live projection. From then on every source row inserted is projected live (src 0); a day is whole once fn_ca_club_acct_seed_day has loaded it, or when it starts after live_from.';

CREATE TABLE public.ca_club_acct_seed_log (
  acct_day  date        PRIMARY KEY,
  fact_rows bigint      NOT NULL,
  hand_rows bigint      NOT NULL,
  seeded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.ca_club_acct_projection_failures (
  id          bigserial   PRIMARY KEY,
  source      text        NOT NULL,
  acct_day    date,
  detail      text        NOT NULL,
  failed_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz
);
COMMENT ON TABLE public.ca_club_acct_projection_failures IS
  'A live projection that raised. The money write it followed committed; the Club Data reader reports the day (every day, when acct_day is NULL) as incomplete until the cause is fixed and the day is loaded again through fn_ca_club_acct_seed_day, which sets resolved_at.';

ALTER TABLE public.ca_club_acct_fact ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_club_acct_hands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_club_acct_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_club_acct_seed_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ca_club_acct_projection_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_club_acct_fact, public.ca_club_acct_hands, public.ca_club_acct_state,
              public.ca_club_acct_seed_log, public.ca_club_acct_projection_failures
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.ca_club_acct_projection_failures_id_seq FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The day of a failure that cannot name its own: never raises, so the
--    failure handler that calls it always records.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_ca_club_acct_safe_day(p_at timestamptz)
RETURNS date LANGUAGE plpgsql STABLE SET search_path = public AS $function$
BEGIN
  RETURN public.fn_ca_accounting_day(p_at);
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Shared writers. ON CONFLICT adds; rows are written in key order so two
--    concurrent writers take row locks in the same order.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_ca_club_acct_put(p_rows jsonb, p_src smallint)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $function$
  INSERT INTO public.ca_club_acct_fact AS f
    (club_id, acct_day, kind, game_id, user_id, union_id, fee, result, buyins, cashouts, last_at, src)
  SELECT x.club_id, x.acct_day, min(x.kind), x.game_id, x.user_id, min(x.union_id::text)::uuid,
         sum(COALESCE(x.fee, 0)), sum(COALESCE(x.result, 0)), sum(COALESCE(x.buyins, 0)),
         sum(COALESCE(x.cashouts, 0)), max(x.at), p_src
    FROM jsonb_to_recordset(p_rows) AS x(club_id uuid, acct_day date, kind text, game_id uuid, user_id uuid,
                                         union_id uuid, fee numeric, result numeric, buyins numeric,
                                         cashouts numeric, at timestamptz)
   WHERE x.club_id IS NOT NULL AND x.acct_day IS NOT NULL AND x.game_id IS NOT NULL AND x.user_id IS NOT NULL
   GROUP BY x.club_id, x.acct_day, x.game_id, x.user_id
   ORDER BY x.club_id, x.acct_day, x.game_id, x.user_id
  ON CONFLICT (club_id, acct_day, game_id, user_id, src) DO UPDATE
     SET fee = f.fee + EXCLUDED.fee,
         result = f.result + EXCLUDED.result,
         buyins = f.buyins + EXCLUDED.buyins,
         cashouts = f.cashouts + EXCLUDED.cashouts,
         union_id = COALESCE(f.union_id, EXCLUDED.union_id),
         last_at = GREATEST(f.last_at, EXCLUDED.last_at);
$function$;

CREATE FUNCTION public.fn_ca_club_acct_put_hands(p_rows jsonb, p_src smallint)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $function$
  INSERT INTO public.ca_club_acct_hands AS h (club_id, acct_day, table_id, hands, src)
  SELECT x.club_id, x.acct_day, x.table_id, sum(x.hands), p_src
    FROM jsonb_to_recordset(p_rows) AS x(club_id uuid, acct_day date, table_id uuid, hands bigint)
   WHERE x.club_id IS NOT NULL AND x.acct_day IS NOT NULL AND x.table_id IS NOT NULL
   GROUP BY x.club_id, x.acct_day, x.table_id
   ORDER BY x.club_id, x.acct_day, x.table_id
  ON CONFLICT (club_id, acct_day, table_id, src) DO UPDATE SET hands = h.hands + EXCLUDED.hands;
$function$;

CREATE FUNCTION public.fn_ca_club_acct_fail(p_source text, p_day date, p_detail text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $function$
  INSERT INTO public.ca_club_acct_projection_failures (source, acct_day, detail) VALUES (p_source, p_day, p_detail);
$function$;

-- ---------------------------------------------------------------------------
-- 4. Per-record projections. Each takes the source rows as jsonb (a
--    transition table in the live trigger, a day's rows in the seed) so the
--    live path and the seed run the same rule.
-- ---------------------------------------------------------------------------

-- 4a. Cash fee: accounting_cash_rake_sources, club as the effective source
--     view gives it (a funding admission's club when one exists). A live fee
--     row has no admission yet; a later admission has its own projection (4b).
CREATE FUNCTION public.fn_ca_club_acct_cash_fee_rows(p_sources jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'club_id', COALESCE(a.funding_club_id, s.club_id),
           'acct_day', public.fn_ca_accounting_day(s.earned_at),
           'kind', 'CASH',
           'game_id', COALESCE(rr.table_id, '00000000-0000-0000-0000-000000000000'::uuid),
           'user_id', COALESCE(s.player_id, '00000000-0000-0000-0000-000000000000'::uuid),
           'union_id', s.union_id, 'fee', s.rake_credit, 'at', s.earned_at)), '[]'::jsonb)
    FROM jsonb_to_recordset(p_sources) AS s(id uuid, rake_record_id uuid, player_id uuid, club_id uuid,
                                            union_id uuid, earned_at timestamptz, rake_credit numeric)
    LEFT JOIN public.rake_records rr ON rr.id = s.rake_record_id
    LEFT JOIN public.accounting_cash_funding_contract_admissions a ON a.source_id = s.id
    LEFT JOIN public.fn_ca_launch_accounting_club_cutoffs() bd(club_id, cutoff_at)
      ON bd.club_id = COALESCE(a.funding_club_id, s.club_id)
   WHERE s.earned_at IS NOT NULL AND isfinite(s.earned_at)
     AND (bd.cutoff_at IS NULL OR s.earned_at >= bd.cutoff_at);
$function$;

-- 4b. A funding admission moves an already projected cash fee between clubs.
CREATE FUNCTION public.fn_ca_club_acct_admission_rows(p_admissions jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $function$
  SELECT COALESCE(jsonb_agg(m.r), '[]'::jsonb) FROM (
    SELECT jsonb_build_object('club_id', s.club_id, 'acct_day', public.fn_ca_accounting_day(s.earned_at),
             'kind', 'CASH', 'game_id', COALESCE(rr.table_id, '00000000-0000-0000-0000-000000000000'::uuid),
             'user_id', COALESCE(s.player_id, '00000000-0000-0000-0000-000000000000'::uuid),
             'union_id', s.union_id, 'fee', -s.rake_credit, 'at', s.earned_at) r
      FROM jsonb_to_recordset(p_admissions) AS a(source_id uuid, funding_club_id uuid)
      JOIN public.accounting_cash_rake_sources s ON s.id = a.source_id
      LEFT JOIN public.rake_records rr ON rr.id = s.rake_record_id
     WHERE a.funding_club_id IS DISTINCT FROM s.club_id AND s.earned_at IS NOT NULL AND isfinite(s.earned_at)
    UNION ALL
    SELECT jsonb_build_object('club_id', a.funding_club_id, 'acct_day', public.fn_ca_accounting_day(s.earned_at),
             'kind', 'CASH', 'game_id', COALESCE(rr.table_id, '00000000-0000-0000-0000-000000000000'::uuid),
             'user_id', COALESCE(s.player_id, '00000000-0000-0000-0000-000000000000'::uuid),
             'union_id', s.union_id, 'fee', s.rake_credit, 'at', s.earned_at)
      FROM jsonb_to_recordset(p_admissions) AS a(source_id uuid, funding_club_id uuid)
      JOIN public.accounting_cash_rake_sources s ON s.id = a.source_id
      LEFT JOIN public.rake_records rr ON rr.id = s.rake_record_id
     WHERE a.funding_club_id IS DISTINCT FROM s.club_id AND s.earned_at IS NOT NULL AND isfinite(s.earned_at)
  ) m;
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
    FROM jsonb_to_recordset(p_recognized) AS rs(source_id uuid, tournament_id uuid, recognized_at timestamptz,
                                                disposition text, rake_credit numeric)
    JOIN public.accounting_effective_tournament_fee_sources s
      ON s.id = rs.source_id AND s.tournament_id = rs.tournament_id AND s.rake_credit = rs.rake_credit
    JOIN public.accounting_tournament_fee_recognitions r
      ON r.tournament_id = s.tournament_id AND r.recognized_at = rs.recognized_at AND r.status = 'recognized'
     AND NOT (s.union_id IS DISTINCT FROM r.union_id)
    LEFT JOIN public.fn_ca_launch_accounting_club_cutoffs() bd(club_id, cutoff_at) ON bd.club_id = s.club_id
   WHERE rs.disposition = 'earned' AND s.club_id IS NOT NULL
     AND (bd.cutoff_at IS NULL OR (s.charged_at IS NOT NULL AND isfinite(s.charged_at) AND s.charged_at >= bd.cutoff_at
                                   AND rs.recognized_at IS NOT NULL AND isfinite(rs.recognized_at)
                                   AND rs.recognized_at >= bd.cutoff_at));
$function$;

-- 4d. Cash hands. p_hands rows: table_id, recognized_at, union_id,
--     participants (already resolved the way the invoice reader resolves
--     them). Returns {"facts": [...], "hands": [...]}.
CREATE FUNCTION public.fn_ca_club_acct_hand_rows(p_hands jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $function$
  WITH h AS (
    SELECT x.table_id, x.hand_number, x.recognized_at, x.union_id, x.participants
      FROM jsonb_to_recordset(COALESCE(p_hands, '[]'::jsonb)) AS x(table_id uuid, hand_number bigint,
                                            recognized_at timestamptz, union_id uuid, participants jsonb)
     WHERE x.table_id IS NOT NULL AND x.recognized_at IS NOT NULL
  ), p AS (
    SELECT h.table_id, h.hand_number, h.recognized_at, public.fn_ca_accounting_day(h.recognized_at) acct_day,
           h.union_id, (q->>'earning_club_id')::uuid club_id, (q->>'user_id')::uuid user_id,
           (q->>'observed_stack_delta')::numeric delta
      FROM h CROSS JOIN LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(h.participants) = 'array' THEN h.participants ELSE '[]'::jsonb END) q
  )
  SELECT jsonb_build_object(
    'facts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'club_id', p.club_id, 'acct_day', p.acct_day, 'kind', 'CASH',
               'game_id', p.table_id, 'user_id', p.user_id, 'union_id', p.union_id,
               'result', p.delta, 'at', p.recognized_at)) FROM p), '[]'::jsonb),
    'hands', COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'club_id', c.club_id, 'acct_day', c.acct_day, 'table_id', c.table_id, 'hands', c.n))
               FROM (SELECT p.club_id, p.acct_day, p.table_id, count(DISTINCT p.hand_number) n
                       FROM p WHERE p.club_id IS NOT NULL GROUP BY 1, 2, 3) c), '[]'::jsonb));
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
    ELSE COALESCE((
      SELECT CASE WHEN o.evidence->>'status' = 'blocked' AND o.recognized_at = h.recognized_at
                   AND o.game_scope->>'game_union_id' = h.game_union_id
                   AND o.evidence->>'accepted_rake' = h.accepted_rake
                   AND public.fn_union_pnl_compact_participants(o.evidence->'participants') = h.participants
                  THEN smarter_private.original_treasury_cash_outcome_evidence(to_jsonb(o))->'participants' END
        FROM public.union_pnl_cash_outcomes o
       WHERE o.table_id = h.table_id AND o.hand_number = h.hand_number), h.participants)
  END;
$function$;

-- The participants the invoice reader uses for a link resolution
-- (fn_union_pnl_linked_cash_outcomes), and the hand's recognition time.
CREATE FUNCTION public.fn_ca_club_acct_link_hands(p_links jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public, smarter_private AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'table_id', r.table_id, 'hand_number', r.hand_number, 'recognized_at', o.recognized_at,
           'union_id', (r.game_scope->>'game_union_id')::uuid,
           'participants', (CASE WHEN r.roster_source = 'lightning_pool'
                                 THEN smarter_private.original_lightning_funding_owner_evidence(r.table_id, r.hand_number, r.game_scope, r.evidence)
                                 ELSE r.evidence END)->'participants')), '[]'::jsonb)
    FROM jsonb_to_recordset(p_links) AS r(table_id uuid, hand_number bigint, hand_id uuid, outcome_payload_hash text,
                                          outcome_evidence_md5 text, roster_source text, game_scope jsonb,
                                          evidence jsonb, proof jsonb, proof_md5 text)
    JOIN public.union_pnl_cash_outcomes o ON o.table_id = r.table_id AND o.hand_number = r.hand_number
   WHERE r.game_scope->>'game_union_id' IS NOT NULL
     AND r.hand_id = o.hand_id AND r.outcome_payload_hash = o.payload_hash
     AND r.outcome_evidence_md5 = md5(o.evidence::text) AND r.proof_md5 = md5(r.proof::text);
$function$;

-- 4e. Ledger flows (union_pnl_original_flows): tournament funding is a loss
--     and a tournament return a win when they post (the invoice's realized
--     tournament flow); cash buy-ins and cash-outs are reported, the cash
--     result is the hands.
CREATE FUNCTION public.fn_ca_club_acct_flow_rows(p_flows jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $function$
  WITH f AS (
    SELECT x.recognized_at, x.game_scope gs, x.ledger_snapshot l, (x.ledger_snapshot->>'amount')::numeric amt
      FROM jsonb_to_recordset(p_flows) AS x(ledger_id uuid, recognized_at timestamptz, game_scope jsonb,
                                            ledger_snapshot jsonb)
     WHERE x.game_scope->>'game_union_id' IS NOT NULL AND x.ledger_snapshot->>'status' = 'posted'
       AND x.ledger_snapshot->>'club_id' IS NOT NULL AND x.recognized_at IS NOT NULL
  ), c AS (
    SELECT f.*, NULLIF(f.gs->>'tournament_id', '')::uuid tour,
           CASE WHEN f.l->>'from_type' = 'player_wallet' THEN f.l->>'from_entity_id'
                WHEN f.l->>'to_type' = 'player_wallet' THEN f.l->>'to_entity_id' END wallet_user,
           CASE WHEN f.l->>'from_type' = 'player_wallet' THEN 1
                WHEN f.l->>'to_type' = 'player_wallet' THEN -1 END dir
      FROM f
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'club_id', (c.l->>'club_id')::uuid, 'acct_day', public.fn_ca_accounting_day(c.recognized_at),
           'kind', CASE WHEN c.tour IS NULL THEN 'CASH' ELSE 'TOURNAMENT' END,
           'game_id', COALESCE(c.tour, NULLIF(c.l->>'table_id', '')::uuid),
           'user_id', c.wallet_user::uuid, 'union_id', (c.gs->>'game_union_id')::uuid,
           'buyins', CASE WHEN c.dir = 1 THEN c.amt ELSE 0 END,
           'cashouts', CASE WHEN c.dir = -1 THEN c.amt ELSE 0 END,
           'result', CASE WHEN c.tour IS NULL THEN 0 ELSE -c.dir * c.amt END,
           'at', c.recognized_at)), '[]'::jsonb)
    FROM c
   WHERE c.dir IS NOT NULL AND c.wallet_user ~ '^[0-9a-fA-F-]{36}$'
     AND ((c.tour IS NOT NULL AND (c.l->>'from_type' = 'prize_liability' OR c.l->>'to_type' = 'prize_liability'))
       OR (c.tour IS NULL AND (c.l->>'from_type' = 'table_stack' OR c.l->>'to_type' = 'table_stack')
           AND NULLIF(c.l->>'table_id', '') IS NOT NULL));
$function$;

-- 4f. BBJ stack awards: the invoice's own reader, one payout share at a time.
CREATE FUNCTION public.fn_ca_club_acct_bbj_rows(p_payout uuid, p_user uuid, p_at timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'club_id', a.club_id, 'acct_day', public.fn_ca_accounting_day(p_at), 'kind', 'CASH',
           'game_id', b.table_id, 'user_id', p_user, 'union_id', t.union_id,
           'result', a.amount, 'at', p_at)), '[]'::jsonb)
    FROM public.bbj_payouts b
    JOIN public.tables t ON t.id = b.table_id AND t.union_id IS NOT NULL
    CROSS JOIN LATERAL public.fn_union_pnl_week_bbj_stack_awards(t.union_id, p_at, p_at + interval '1 day') a
   WHERE b.id = p_payout AND a.payout_id = p_payout
     AND a.user_id = p_user AND a.club_id IS NOT NULL;
$function$;

-- 4g. Deferred tournament entries carried across a week boundary
--     (pnl_boundary certificate holdings): -amount on the boundary's day,
--     +amount on the day that ends at it.
CREATE FUNCTION public.fn_ca_club_acct_boundary_rows(p_union uuid, p_boundary timestamptz, p_value jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'club_id', (h->>'club_id')::uuid, 'acct_day', d.day, 'kind', 'TOURNAMENT',
           'game_id', COALESCE(tp.tournament_id, '00000000-0000-0000-0000-000000000000'::uuid),
           'user_id', (h->>'user_id')::uuid, 'union_id', p_union,
           'result', d.sign * (h->>'amount')::numeric, 'at', p_boundary)), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(p_value->'holdings', '[]'::jsonb)) h
    LEFT JOIN public.tournament_players tp ON tp.id = NULLIF(h->>'source_id', '')::uuid
    CROSS JOIN LATERAL (VALUES (public.fn_ca_accounting_day(p_boundary), -1),
                               (public.fn_ca_accounting_day(p_boundary - interval '1 microsecond'), 1)) d(day, sign)
   WHERE h->>'kind' = 'deferred_tournament_result' AND h->>'club_id' IS NOT NULL AND h->>'user_id' IS NOT NULL;
$function$;

-- Replace one boundary's certificate rows (a recertified boundary replaces
-- its predecessor; the rows are the certificate, nothing else writes src 2).
CREATE FUNCTION public.fn_ca_club_acct_load_boundary(p_union uuid, p_boundary timestamptz)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v jsonb; n bigint;
BEGIN
  SELECT c.value INTO v FROM public.accounting_close_certificates c
   WHERE c.kind = 'pnl_boundary' AND c.union_id = p_union AND c.period_start = p_boundary AND c.period_end = p_boundary;
  IF v IS NULL THEN RETURN 0; END IF;
  DELETE FROM public.ca_club_acct_fact f
   WHERE f.src = 2 AND f.union_id = p_union
     AND f.acct_day IN (public.fn_ca_accounting_day(p_boundary), public.fn_ca_accounting_day(p_boundary - interval '1 microsecond'));
  v := public.fn_ca_club_acct_boundary_rows(p_union, p_boundary, v);
  PERFORM public.fn_ca_club_acct_put(v, 2::smallint);
  n := jsonb_array_length(v);
  RETURN n;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Live projection trigger functions (attached by 20261115010436).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.trg_ca_club_acct_cash_fee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  PERFORM public.fn_ca_club_acct_put(public.fn_ca_club_acct_cash_fee_rows(
    (SELECT jsonb_agg(to_jsonb(n)) FROM new_rows n)), 0::smallint);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.fn_ca_club_acct_fail('cash_fee', (SELECT public.fn_ca_club_acct_safe_day(min(n.earned_at)) FROM new_rows n),
    SQLSTATE || ' ' || SQLERRM || ' ids=' || COALESCE((SELECT string_agg(n.id::text, ',') FROM new_rows n), ''));
  RETURN NULL;
END;
$function$;

CREATE FUNCTION public.trg_ca_club_acct_admission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  PERFORM public.fn_ca_club_acct_put(public.fn_ca_club_acct_admission_rows(
    (SELECT jsonb_agg(to_jsonb(n)) FROM new_rows n)), 0::smallint);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.fn_ca_club_acct_fail('cash_fee_admission', NULL,
    SQLSTATE || ' ' || SQLERRM || ' ids=' || COALESCE((SELECT string_agg(n.source_id::text, ',') FROM new_rows n), ''));
  RETURN NULL;
END;
$function$;

CREATE FUNCTION public.trg_ca_club_acct_tournament_fee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  PERFORM public.fn_ca_club_acct_put(public.fn_ca_club_acct_tournament_fee_rows(
    (SELECT jsonb_agg(to_jsonb(n)) FROM new_rows n)), 0::smallint);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.fn_ca_club_acct_fail('tournament_fee', (SELECT public.fn_ca_club_acct_safe_day(min(n.recognized_at)) FROM new_rows n),
    SQLSTATE || ' ' || SQLERRM || ' ids=' || COALESCE((SELECT string_agg(n.source_id::text, ',') FROM new_rows n), ''));
  RETURN NULL;
END;
$function$;

CREATE FUNCTION public.trg_ca_club_acct_touch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v jsonb;
BEGIN
  v := public.fn_ca_club_acct_hand_rows((
    SELECT jsonb_agg(jsonb_build_object('table_id', n.table_id, 'hand_number', n.hand_number,
             'recognized_at', n.recognized_at, 'union_id', n.game_union_id,
             'participants', public.fn_ca_club_acct_touch_participants(n)))
      FROM new_rows n WHERE n.game_union_id IS NOT NULL));
  PERFORM public.fn_ca_club_acct_put(v->'facts', 0::smallint);
  PERFORM public.fn_ca_club_acct_put_hands(v->'hands', 0::smallint);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.fn_ca_club_acct_fail('cash_hand', (SELECT public.fn_ca_club_acct_safe_day(min(n.recognized_at)) FROM new_rows n),
    SQLSTATE || ' ' || SQLERRM || ' hands=' || COALESCE((SELECT string_agg(n.table_id::text || ':' || n.hand_number, ',') FROM new_rows n), ''));
  RETURN NULL;
END;
$function$;

CREATE FUNCTION public.trg_ca_club_acct_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v jsonb;
BEGIN
  v := public.fn_ca_club_acct_hand_rows(public.fn_ca_club_acct_link_hands(
         (SELECT jsonb_agg(to_jsonb(n)) FROM new_rows n)));
  PERFORM public.fn_ca_club_acct_put(v->'facts', 0::smallint);
  PERFORM public.fn_ca_club_acct_put_hands(v->'hands', 0::smallint);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.fn_ca_club_acct_fail('linked_hand', NULL,
    SQLSTATE || ' ' || SQLERRM || ' hands=' || COALESCE((SELECT string_agg(n.table_id::text || ':' || n.hand_number, ',') FROM new_rows n), ''));
  RETURN NULL;
END;
$function$;

-- A post-hand escrow certificate inserted after its touch reshapes the hand:
-- add the escrow participants and take back the ones the touch was projected
-- with, in src 0. A day load reads the hand with whatever certificate it
-- holds and subtracts src 0, so the correction is never counted twice.
CREATE FUNCTION public.trg_ca_club_acct_escrow_certificate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, smarter_private AS $function$
DECLARE v_new jsonb; v_old jsonb; h public.union_pnl_cash_outcome_touches;
BEGIN
  FOR h IN SELECT t.* FROM public.union_pnl_cash_outcome_touches t JOIN new_rows n
             ON (t.table_id, t.hand_number) = (n.table_id, n.hand_number)
            WHERE t.shaped AND t.game_union_id IS NOT NULL
  LOOP
    v_new := public.fn_union_pnl_posthand_escrow_touch(h);
    -- What the touch was projected with: the same participants without this
    -- certificate (the only certificate a hand has, PK on the hand).
    v_old := COALESCE((
      SELECT CASE WHEN o.evidence->>'status' = 'blocked' AND o.recognized_at = h.recognized_at
                   AND o.game_scope->>'game_union_id' = h.game_union_id
                   AND o.evidence->>'accepted_rake' = h.accepted_rake
                   AND public.fn_union_pnl_compact_participants(o.evidence->'participants') = h.participants
                  THEN smarter_private.original_treasury_cash_outcome_evidence(to_jsonb(o))->'participants' END
        FROM public.union_pnl_cash_outcomes o WHERE o.table_id = h.table_id AND o.hand_number = h.hand_number),
      h.participants);
    PERFORM public.fn_ca_club_acct_put((public.fn_ca_club_acct_hand_rows(jsonb_build_array(jsonb_build_object(
      'table_id', h.table_id, 'hand_number', h.hand_number, 'recognized_at', h.recognized_at,
      'union_id', h.game_union_id, 'participants', v_new))))->'facts', 0::smallint);
    PERFORM public.fn_ca_club_acct_put((SELECT jsonb_agg(x || jsonb_build_object('result', -(x->>'result')::numeric))
      FROM jsonb_array_elements((public.fn_ca_club_acct_hand_rows(jsonb_build_array(jsonb_build_object(
        'table_id', h.table_id, 'hand_number', h.hand_number, 'recognized_at', h.recognized_at,
        'union_id', h.game_union_id, 'participants', v_old))))->'facts') x), 0::smallint);
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.fn_ca_club_acct_fail('escrow_certificate', NULL, SQLSTATE || ' ' || SQLERRM);
  RETURN NULL;
END;
$function$;

CREATE FUNCTION public.trg_ca_club_acct_flow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  PERFORM public.fn_ca_club_acct_put(public.fn_ca_club_acct_flow_rows(
    (SELECT jsonb_agg(to_jsonb(n)) FROM new_rows n)), 0::smallint);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.fn_ca_club_acct_fail('ledger_flow', (SELECT public.fn_ca_club_acct_safe_day(min(n.recognized_at)) FROM new_rows n),
    SQLSTATE || ' ' || SQLERRM || ' ledger=' || COALESCE((SELECT string_agg(n.ledger_id::text, ',') FROM new_rows n), ''));
  RETURN NULL;
END;
$function$;

-- Deferred to commit: the BBJ wallet leg and its original flow are written in
-- the same transaction as the recipient row.
CREATE FUNCTION public.trg_ca_club_acct_bbj()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  PERFORM public.fn_ca_club_acct_put(public.fn_ca_club_acct_bbj_rows(NEW.payout_id, NEW.user_id, NEW.created_at), 0::smallint);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.fn_ca_club_acct_fail('bbj_award', public.fn_ca_club_acct_safe_day(NEW.created_at),
    SQLSTATE || ' ' || SQLERRM || ' payout=' || NEW.payout_id || ' user=' || NEW.user_id);
  RETURN NULL;
END;
$function$;

CREATE FUNCTION public.trg_ca_club_acct_boundary()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NEW.kind = 'pnl_boundary' AND NEW.period_start = NEW.period_end THEN
    PERFORM public.fn_ca_club_acct_load_boundary(NEW.union_id, NEW.period_start);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.fn_ca_club_acct_fail('pnl_boundary', public.fn_ca_club_acct_safe_day(NEW.period_start), SQLSTATE || ' ' || SQLERRM);
  RETURN NULL;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. The day load. One accounting day per call, inside one REPEATABLE READ
--    transaction (refused otherwise), so every read below and the day's
--    src 0 come from the same snapshot:
--
--      src 1 (day) := whole day projected from every source row it holds
--                     - src 0 (day)
--
--    The whole day uses the same projections as the live triggers, with each
--    correction as it stands (a funding admission's club, a hand's escrow
--    certificate). src 0 + src 1 is therefore the whole day whatever the
--    cutover split, and a row inserted after the snapshot is the live
--    projection's alone. A day already loaded is refused unless p_rebuild,
--    which replaces its src 1 in the same transaction (idempotent), and the
--    day's recorded projection failures are marked resolved. Refused before
--    the live projection is attached (a row inserted between a load and the
--    attachment would belong to neither) and while another load runs.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_ca_club_acct_seed_day(p_day date, p_rebuild boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, smarter_private SET statement_timeout = '600s' SET work_mem = '128MB' AS $function$
DECLARE
  v_lo timestamptz := public.fn_ca_accounting_day_start(p_day);
  v_hi timestamptz := public.fn_ca_accounting_day_start(p_day + 1);
  w_lo timestamptz; w_hi timestamptz; v jsonb; n_f bigint := 0; n_h bigint := 0; n_live bigint; n_fix bigint;
BEGIN
  IF p_day IS NULL THEN
    RAISE EXCEPTION 'club data accounting load needs a day' USING ERRCODE = '22023';
  END IF;
  IF current_setting('transaction_isolation') NOT IN ('repeatable read', 'serializable') THEN
    RAISE EXCEPTION 'club data accounting load runs in one REPEATABLE READ transaction (BEGIN ISOLATION LEVEL REPEATABLE READ)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ca_club_acct_state) THEN
    RAISE EXCEPTION 'club data accounting load waits for the live projection (20261115010436)';
  END IF;
  IF v_lo > now() THEN
    RAISE EXCEPTION 'accounting day % has not started', p_day USING ERRCODE = '22023';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtext('ca-club-acct-seed')) THEN
    RAISE EXCEPTION 'another club data accounting load is running';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ca_club_acct_seed_log l WHERE l.acct_day = p_day) THEN
    IF NOT p_rebuild THEN RAISE EXCEPTION 'accounting day % is already loaded', p_day; END IF;
    DELETE FROM public.ca_club_acct_seed_log WHERE acct_day = p_day;
  END IF;
  DELETE FROM public.ca_club_acct_fact WHERE acct_day = p_day AND src = 1;
  DELETE FROM public.ca_club_acct_hands WHERE acct_day = p_day AND src = 1;

  -- The whole day, in two-hour slices; the day is one transaction.
  w_lo := v_lo;
  WHILE w_lo < v_hi LOOP
    w_hi := LEAST(w_lo + interval '2 hours', v_hi);

    -- One club at a time: accounting_cash_rake_sources is read through its
    -- (club_id, earned_at) index, never by a scan of every club's rows.
    v := public.fn_ca_club_acct_cash_fee_rows((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'rake_record_id', s.rake_record_id, 'player_id', s.player_id,
               'club_id', s.club_id, 'union_id', s.union_id, 'earned_at', s.earned_at, 'rake_credit', s.rake_credit))
        FROM public.clubs c
        CROSS JOIN LATERAL (SELECT x.* FROM public.accounting_cash_rake_sources x
                             WHERE x.club_id = c.id AND x.earned_at >= w_lo AND x.earned_at < w_hi) s));
    PERFORM public.fn_ca_club_acct_put(v, 1::smallint); n_f := n_f + jsonb_array_length(v);

    v := public.fn_ca_club_acct_tournament_fee_rows((
      SELECT jsonb_agg(to_jsonb(rs)) FROM public.accounting_tournament_recognized_sources rs
       WHERE rs.recognized_at >= w_lo AND rs.recognized_at < w_hi));
    PERFORM public.fn_ca_club_acct_put(v, 1::smallint); n_f := n_f + jsonb_array_length(v);

    v := public.fn_ca_club_acct_hand_rows((
      SELECT jsonb_agg(jsonb_build_object('table_id', t.table_id, 'hand_number', t.hand_number,
               'recognized_at', t.recognized_at, 'union_id', t.game_union_id,
               'participants', public.fn_ca_club_acct_touch_participants(t)))
        FROM public.union_pnl_cash_outcome_touches t
       WHERE t.game_union_id IS NOT NULL AND t.recognized_at >= w_lo AND t.recognized_at < w_hi));
    PERFORM public.fn_ca_club_acct_put(v->'facts', 1::smallint);
    PERFORM public.fn_ca_club_acct_put_hands(v->'hands', 1::smallint);
    n_f := n_f + jsonb_array_length(v->'facts'); n_h := n_h + jsonb_array_length(v->'hands');

    v := public.fn_ca_club_acct_hand_rows(public.fn_ca_club_acct_link_hands((
      SELECT jsonb_agg(to_jsonb(r)) FROM public.union_pnl_cash_outcome_link_resolutions r
        JOIN public.union_pnl_cash_outcomes o ON o.table_id = r.table_id AND o.hand_number = r.hand_number
       WHERE o.recognized_at >= w_lo AND o.recognized_at < w_hi AND r.game_scope->>'game_union_id' IS NOT NULL)));
    PERFORM public.fn_ca_club_acct_put(v->'facts', 1::smallint);
    PERFORM public.fn_ca_club_acct_put_hands(v->'hands', 1::smallint);
    n_f := n_f + jsonb_array_length(v->'facts'); n_h := n_h + jsonb_array_length(v->'hands');

    v := public.fn_ca_club_acct_flow_rows((
      SELECT jsonb_agg(to_jsonb(f)) FROM public.union_pnl_original_flows f
       WHERE f.game_scope->>'game_union_id' IS NOT NULL AND f.recognized_at >= w_lo AND f.recognized_at < w_hi));
    PERFORM public.fn_ca_club_acct_put(v, 1::smallint); n_f := n_f + jsonb_array_length(v);

    w_lo := w_hi;
  END LOOP;

  -- BBJ stack awards (the invoice reader, per recipient).
  v := COALESCE((
    SELECT jsonb_agg(x) FROM public.bbj_payout_recipients r
     CROSS JOIN LATERAL jsonb_array_elements(public.fn_ca_club_acct_bbj_rows(r.payout_id, r.user_id, r.created_at)) x
     WHERE r.created_at >= v_lo AND r.created_at < v_hi), '[]'::jsonb);
  PERFORM public.fn_ca_club_acct_put(v, 1::smallint); n_f := n_f + jsonb_array_length(v);

  -- Minus what the live projection already holds for the day (same snapshot).
  INSERT INTO public.ca_club_acct_fact AS f
    (club_id, acct_day, kind, game_id, user_id, union_id, fee, result, buyins, cashouts, last_at, src)
  SELECT l.club_id, l.acct_day, l.kind, l.game_id, l.user_id, l.union_id,
         -l.fee, -l.result, -l.buyins, -l.cashouts, l.last_at, 1::smallint
    FROM public.ca_club_acct_fact l
   WHERE l.acct_day = p_day AND l.src = 0
   ORDER BY l.club_id, l.acct_day, l.game_id, l.user_id
  ON CONFLICT (club_id, acct_day, game_id, user_id, src) DO UPDATE
     SET fee = f.fee + EXCLUDED.fee, result = f.result + EXCLUDED.result,
         buyins = f.buyins + EXCLUDED.buyins, cashouts = f.cashouts + EXCLUDED.cashouts,
         union_id = COALESCE(f.union_id, EXCLUDED.union_id), last_at = GREATEST(f.last_at, EXCLUDED.last_at);
  GET DIAGNOSTICS n_live = ROW_COUNT;
  INSERT INTO public.ca_club_acct_hands AS h (club_id, acct_day, table_id, hands, src)
  SELECT l.club_id, l.acct_day, l.table_id, -l.hands, 1::smallint
    FROM public.ca_club_acct_hands l
   WHERE l.acct_day = p_day AND l.src = 0
   ORDER BY l.club_id, l.acct_day, l.table_id
  ON CONFLICT (club_id, acct_day, table_id, src) DO UPDATE SET hands = h.hands + EXCLUDED.hands;
  -- An all-zero src 1 row beside its src 0 row says nothing the src 0 row
  -- does not; a src 1 row alone is kept (the player took part).
  DELETE FROM public.ca_club_acct_fact z
   WHERE z.acct_day = p_day AND z.src = 1
     AND z.fee = 0 AND z.result = 0 AND z.buyins = 0 AND z.cashouts = 0
     AND EXISTS (SELECT 1 FROM public.ca_club_acct_fact l
                  WHERE (l.club_id, l.acct_day, l.game_id, l.user_id, l.src) = (z.club_id, z.acct_day, z.game_id, z.user_id, 0));
  DELETE FROM public.ca_club_acct_hands z WHERE z.acct_day = p_day AND z.src = 1 AND z.hands = 0;

  UPDATE public.ca_club_acct_projection_failures pf SET resolved_at = clock_timestamp()
   WHERE pf.acct_day = p_day AND pf.resolved_at IS NULL;
  GET DIAGNOSTICS n_fix = ROW_COUNT;

  INSERT INTO public.ca_club_acct_seed_log (acct_day, fact_rows, hand_rows) VALUES (p_day, n_f, n_h);
  RETURN jsonb_build_object('acct_day', p_day, 'from', v_lo, 'to', v_hi, 'fact_inputs', n_f, 'hand_inputs', n_h,
                            'live_rows_subtracted', n_live, 'failures_resolved', n_fix);
END;
$function$;

REVOKE ALL ON FUNCTION
  public.fn_ca_club_acct_safe_day(timestamptz),
  public.fn_ca_club_acct_put(jsonb, smallint), public.fn_ca_club_acct_put_hands(jsonb, smallint),
  public.fn_ca_club_acct_fail(text, date, text),
  public.fn_ca_club_acct_cash_fee_rows(jsonb), public.fn_ca_club_acct_admission_rows(jsonb),
  public.fn_ca_club_acct_tournament_fee_rows(jsonb), public.fn_ca_club_acct_hand_rows(jsonb),
  public.fn_ca_club_acct_touch_participants(public.union_pnl_cash_outcome_touches),
  public.fn_ca_club_acct_link_hands(jsonb), public.fn_ca_club_acct_flow_rows(jsonb),
  public.fn_ca_club_acct_bbj_rows(uuid, uuid, timestamptz), public.fn_ca_club_acct_boundary_rows(uuid, timestamptz, jsonb),
  public.fn_ca_club_acct_load_boundary(uuid, timestamptz), public.fn_ca_club_acct_seed_day(date, boolean),
  public.trg_ca_club_acct_cash_fee(), public.trg_ca_club_acct_admission(), public.trg_ca_club_acct_tournament_fee(),
  public.trg_ca_club_acct_touch(), public.trg_ca_club_acct_link(), public.trg_ca_club_acct_escrow_certificate(),
  public.trg_ca_club_acct_flow(), public.trg_ca_club_acct_bbj(), public.trg_ca_club_acct_boundary()
  FROM PUBLIC, anon, authenticated;

COMMIT;
