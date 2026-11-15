-- Native fixture for scripts/ci/test-club-data-accounting-read-model.py.
-- Loaded after tests/fixtures/club-data-union-weeks/fixture.sql (clubs, union,
-- fn_union_week_start) and 20261114235606 (the accounting day).
--
-- The source tables carry the production columns 20261115020010 reads
-- (information_schema, 2026-11-15). The invoice's own helper functions are
-- stand-ins with the same signatures and a deterministic, documented effect,
-- so the scenario can prove the projection calls each one where the invoice
-- reader does; what those helpers compute is qualified by their own tests.
CREATE SCHEMA IF NOT EXISTS smarter_private;

CREATE TABLE public.tables (id uuid PRIMARY KEY, union_id uuid, club_id uuid);
CREATE TABLE public.rake_records (id uuid PRIMARY KEY, table_id uuid);
CREATE TABLE public.tournament_players (id uuid PRIMARY KEY, tournament_id uuid NOT NULL);

CREATE TABLE public.accounting_cash_rake_sources (
  id uuid PRIMARY KEY, rake_record_id uuid, player_id uuid, club_id uuid, union_id uuid,
  coordinator_union_id uuid, earned_at timestamptz, rake_credit numeric, contract jsonb,
  recorded_at timestamptz DEFAULT now());
CREATE TABLE public.accounting_cash_funding_contract_admissions (
  source_id uuid PRIMARY KEY, original_contract jsonb, admitted_contract jsonb, original_club_id uuid,
  funding_club_id uuid, original_chair jsonb, buyin_ledger jsonb, wallet_debit jsonb, admitted_at timestamptz DEFAULT now());
CREATE TABLE public.accounting_tournament_fee_sources (
  id uuid PRIMARY KEY, rake_record_id uuid, tournament_id uuid, player_id uuid, club_id uuid, union_id uuid,
  coordinator_union_id uuid, game_type text, registration_id uuid, source_charge_ledger_id uuid,
  source_entitlement_id uuid, charged_at timestamptz, rake_credit numeric, contract jsonb, recorded_at timestamptz);
CREATE VIEW public.accounting_effective_tournament_fee_sources AS
  SELECT id, rake_record_id, tournament_id, player_id, club_id, union_id, coordinator_union_id, game_type,
         registration_id, source_charge_ledger_id, source_entitlement_id, charged_at, rake_credit, contract, recorded_at
    FROM public.accounting_tournament_fee_sources;
CREATE TABLE public.accounting_tournament_fee_recognitions (
  tournament_id uuid PRIMARY KEY, recognized_at timestamptz, status text, net_rake numeric, union_id uuid);
CREATE TABLE public.accounting_tournament_recognized_sources (
  source_id uuid, tournament_id uuid, recognized_at timestamptz, disposition text, rake_credit numeric);

CREATE TABLE public.union_pnl_cash_outcomes (
  table_id uuid, hand_number bigint, hand_id uuid, transaction_id xid8, recognized_at timestamptz,
  payload_hash text, game_scope jsonb, evidence jsonb, PRIMARY KEY (table_id, hand_number));
CREATE TABLE public.union_pnl_cash_outcome_touches (
  table_id uuid, hand_number bigint, recognized_at timestamptz, game_union_id text, shaped boolean,
  accepted_rake text, participants jsonb, PRIMARY KEY (table_id, hand_number));
CREATE TABLE public.union_pnl_cash_outcome_link_resolutions (
  table_id uuid, hand_number bigint, hand_id uuid, outcome_payload_hash text, outcome_evidence_md5 text,
  roster_source text, manifest_id uuid, game_scope jsonb, evidence jsonb, proof jsonb, proof_md5 text,
  reason text, resolved_by text, resolved_at timestamptz DEFAULT now(), PRIMARY KEY (table_id, hand_number));
CREATE TABLE public.union_pnl_original_flows (
  ledger_id uuid PRIMARY KEY, transaction_id xid8, recognized_at timestamptz, game_scope jsonb, ledger_snapshot jsonb);
CREATE TABLE smarter_private.posthand_escrow_certificates (
  table_id uuid, hand_number bigint, hand_id uuid, original jsonb, original_sha256 text, recorded_at timestamptz,
  PRIMARY KEY (table_id, hand_number));
CREATE TABLE public.bbj_payouts (id uuid PRIMARY KEY, table_id uuid, hand_number bigint, created_at timestamptz);
CREATE TABLE public.bbj_payout_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payout_id uuid, user_id uuid, amount numeric(20,2), created_at timestamptz);
CREATE TABLE public.accounting_close_certificates (
  kind text, union_id uuid, period_start timestamptz, period_end timestamptz, value jsonb,
  certified_at timestamptz DEFAULT now(), PRIMARY KEY (kind, union_id, period_start, period_end));
CREATE TABLE public.fixture_launch_cutoffs (club_id uuid PRIMARY KEY, cutoff_at timestamptz);
-- The receipts that own a tournament flow (production columns, 2026-11-15).
CREATE TABLE public.tournament_participant_funding_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transaction_id xid8 DEFAULT pg_current_xact_id(), tournament_id uuid,
  user_id uuid, asset text, amount numeric, ledger_id uuid UNIQUE, funding_club_id uuid);
CREATE TABLE public.tournament_accounting_credit_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transaction_id xid8 DEFAULT pg_current_xact_id(), tournament_id uuid,
  user_id uuid, asset text, amount numeric, ledger_id uuid UNIQUE, credited_club_id uuid);
CREATE TABLE public.tournament_refund_tranches (
  tournament_id uuid, user_id uuid, source_wallet_club_id uuid, credit_ledger_id uuid UNIQUE, amount_paid_now numeric,
  transaction_id xid8 DEFAULT pg_current_xact_id());
CREATE TABLE public.tournament_refund_entitlements (
  id uuid PRIMARY KEY, tournament_id uuid, user_id uuid, entitlement_kind text, refund_wallet_club_id uuid, gross numeric,
  registration_id uuid);
-- Satellite seat owner: the seat's funding club, from a fixture table.
CREATE TABLE public.fixture_satellite_seat_owners (registration_id uuid PRIMARY KEY, club_id uuid);
CREATE FUNCTION public.fn_union_pnl_satellite_seat_owner(p_registration uuid, p_tournament uuid)
RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT o.club_id FROM public.fixture_satellite_seat_owners o WHERE o.registration_id = p_registration $$;
-- When each issued invoice was created (production's created_at for the two
-- weeks the base fixture issues: 2026-11-10 16:05 for the week ending at the
-- 2026-11-02 boundary, 2026-11-11 09:05 for the week starting at it).
ALTER TABLE public.settlement_invoices ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
UPDATE public.settlement_invoices si SET created_at = CASE sp.start_at
    WHEN '2026-11-02 08:00+00' THEN timestamptz '2026-11-11 09:05:00.200977+00'
    WHEN '2026-10-26 07:00+00' THEN timestamptz '2026-11-10 16:05:00.183995+00'
    ELSE timestamptz '2026-10-27 00:00+00' END
  FROM public.settlement_periods sp WHERE sp.id = si.period_id;

-- Stand-ins (same signatures as production).
CREATE FUNCTION public.fn_ca_launch_accounting_club_cutoffs()
RETURNS TABLE(club_id uuid, cutoff_at timestamptz) LANGUAGE sql STABLE AS
$$ SELECT c.club_id, c.cutoff_at FROM public.fixture_launch_cutoffs c $$;
-- Identity: production compacts evidence participants to the touch shape.
CREATE FUNCTION public.fn_union_pnl_compact_participants(p jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT p $$;
-- Escrow: the certificate's recorded participants replace the touch's.
CREATE FUNCTION public.fn_union_pnl_posthand_escrow_touch(h public.union_pnl_cash_outcome_touches)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public, smarter_private AS $$
  SELECT c.original->'participants' FROM smarter_private.posthand_escrow_certificates c
   WHERE (c.table_id, c.hand_number) = (h.table_id, h.hand_number) $$;
-- Treasury gift: a blocked original carries its admitted participants.
CREATE FUNCTION smarter_private.original_treasury_cash_outcome_evidence(o jsonb)
RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('participants', o#>'{evidence,gift_participants}') $$;
-- Lightning funding owner: the evidence's owner roster when it names one.
CREATE FUNCTION smarter_private.original_lightning_funding_owner_evidence(t uuid, n bigint, s jsonb, e jsonb)
RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT CASE WHEN e ? 'owner_participants' THEN e || jsonb_build_object('participants', e->'owner_participants') ELSE e END $$;
-- BBJ stack awards: a felt share in the window, to the recipient's earning
-- club in the hand (the felt branch of the production reader). While
-- fixture_bbj_outage holds a row it raises, to prove a failed projection
-- never refuses the share and a later day load makes the day whole.
CREATE TABLE public.fixture_bbj_outage (down boolean PRIMARY KEY);
CREATE FUNCTION public.fn_union_pnl_week_bbj_stack_awards(p_union_id uuid, p_start timestamptz, p_end timestamptz)
RETURNS TABLE(club_id uuid, user_id uuid, amount numeric, payout_id uuid) LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.fixture_bbj_outage) THEN
    RAISE EXCEPTION 'fixture: bbj reader unavailable';
  END IF;
  RETURN QUERY
  SELECT (pp.p->>'earning_club_id')::uuid, r.user_id, r.amount::numeric, r.payout_id
    FROM public.bbj_payout_recipients r JOIN public.bbj_payouts b ON b.id = r.payout_id
    JOIN public.union_pnl_cash_outcomes o ON o.table_id = b.table_id AND o.hand_number = b.hand_number
    CROSS JOIN LATERAL (SELECT p FROM jsonb_array_elements(o.evidence->'participants') p
                         WHERE p->>'user_id' = r.user_id::text LIMIT 1) pp
   WHERE r.created_at >= p_start AND r.created_at < p_end AND o.game_scope->>'game_union_id' = p_union_id::text;
END $$;
