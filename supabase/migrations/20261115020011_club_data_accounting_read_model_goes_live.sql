-- 20261115020011_club_data_accounting_read_model_goes_live
-- @install-window: daily-maintenance
-- @locks: public.accounting_cash_rake_sources, public.accounting_cash_funding_contract_admissions, public.accounting_tournament_recognized_sources, public.union_pnl_cash_outcome_touches, public.union_pnl_cash_outcome_link_resolutions, smarter_private.posthand_escrow_certificates, public.union_pnl_original_flows, public.bbj_payout_recipients
-- @live-proof: (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'ca_club_acct_%' AND NOT tgisinternal AND tgenabled = 'O') = 9 AND (SELECT count(*) FROM public.ca_club_acct_state) = 1
--
-- CLUB DATA'S ACCOUNTING READ MODEL GOES LIVE (owner, 2026-11-14)
--
-- Attaches the projections installed by 20261115020010 to the invoice's own
-- accounting records and records when it did: every source row inserted from
-- this commit on is projected live (src 0). Each day's history is then loaded
-- by fn_ca_club_acct_seed_day as the whole day minus its src 0, in one
-- snapshot, so which side of this commit a row landed on never decides
-- whether it is counted, and nothing is counted twice. (The boundary loader
-- was attached to ca_union_pnl_boundary_capture by 20261115020010 itself.)
--
-- CREATE TRIGGER takes SHARE ROW EXCLUSIVE on each source; the hand and
-- ledger tables are written in every instant of play, so this installs only
-- in the daily maintenance window (CLAUDE.md section 2, rule 10), once, with
-- a 1 s lock timeout. DDL plus the one state row of this feature's own table;
-- no money row is read for update or written.
--
-- A projection never makes the write it follows wait (its row locks are
-- try-locks; every trigger function runs with lock_timeout 50ms) and never
-- refuses it: a projection that raises is recorded in
-- ca_club_acct_projection_failures and the Club Data reader reports that day
-- as incomplete.
BEGIN;
SET LOCAL lock_timeout = '1s';

DO $prerequisite$ BEGIN
  IF to_regclass('public.ca_club_acct_fact') IS NULL
     OR to_regprocedure('public.fn_ca_club_acct_seed_day(date,boolean)') IS NULL THEN
    RAISE EXCEPTION 'CLUB_ACCT_PREREQUISITE_MISSING: install 20261115020010 first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ca_club_acct_state) THEN
    RAISE EXCEPTION 'CLUB_ACCT_ALREADY_LIVE';
  END IF;
END $prerequisite$;

CREATE TRIGGER ca_club_acct_cash_fee
  AFTER INSERT ON public.accounting_cash_rake_sources
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION public.trg_ca_club_acct_cash_fee();

CREATE TRIGGER ca_club_acct_admission
  AFTER INSERT ON public.accounting_cash_funding_contract_admissions
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION public.trg_ca_club_acct_admission();

CREATE TRIGGER ca_club_acct_tournament_fee
  AFTER INSERT ON public.accounting_tournament_recognized_sources
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION public.trg_ca_club_acct_tournament_fee();

CREATE TRIGGER ca_club_acct_touch
  AFTER INSERT ON public.union_pnl_cash_outcome_touches
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION public.trg_ca_club_acct_touch();

CREATE TRIGGER ca_club_acct_link
  AFTER INSERT ON public.union_pnl_cash_outcome_link_resolutions
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION public.trg_ca_club_acct_link();

CREATE TRIGGER ca_club_acct_escrow_certificate
  AFTER INSERT ON smarter_private.posthand_escrow_certificates
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION public.trg_ca_club_acct_escrow_certificate();

-- At commit: a tournament flow's receipt is written in the flow's own
-- transaction, after or before the flow.
CREATE CONSTRAINT TRIGGER ca_club_acct_flow
  AFTER INSERT ON public.union_pnl_original_flows
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION public.trg_ca_club_acct_flow();

-- At commit: the share's wallet leg and its original flow are written in the
-- same transaction as the recipient row.
CREATE CONSTRAINT TRIGGER ca_club_acct_bbj
  AFTER INSERT ON public.bbj_payout_recipients
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION public.trg_ca_club_acct_bbj();

INSERT INTO public.ca_club_acct_state (singleton, live_from) VALUES (true, now());

COMMIT;
