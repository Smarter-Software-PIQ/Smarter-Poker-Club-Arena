-- 20261115010436_club_data_accounting_read_model_goes_live
-- @install-window: daily-maintenance
-- @locks: public.accounting_cash_rake_sources, public.accounting_cash_funding_contract_admissions, public.accounting_tournament_recognized_sources, public.union_pnl_cash_outcome_touches, public.union_pnl_cash_outcome_link_resolutions, smarter_private.posthand_escrow_certificates, public.union_pnl_original_flows, public.bbj_payout_recipients, public.accounting_close_certificates
-- @live-proof: (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'ca_club_acct_%' AND NOT tgisinternal AND tgenabled = 'O') = 9 AND (SELECT count(*) FROM public.ca_club_acct_state) = 1
--
-- CLUB DATA'S ACCOUNTING READ MODEL GOES LIVE (owner, 2026-11-14)
--
-- Attaches the projections installed by 20261115004729 to the invoice's own
-- accounting records and records when it did: every source row inserted from
-- this commit on is projected live (src 0). Each day's history is then loaded
-- by fn_ca_club_acct_seed_day as the whole day minus its src 0, in one
-- snapshot, so which side of this commit a row landed on never decides
-- whether it is counted, and nothing is counted twice.
--
-- CREATE TRIGGER takes SHARE ROW EXCLUSIVE on each source; every one of the
-- hand and ledger tables is written in every instant of play, so this
-- installs only in the daily maintenance window (CLAUDE.md section 2, rule
-- 10), once, with a 1 s lock timeout. DDL plus the one state row of this
-- feature's own table; no money row is read for update or written.
--
-- The projections never refuse the write they follow: a projection that
-- raises is recorded in ca_club_acct_projection_failures and the Club Data
-- reader reports that day as incomplete.
BEGIN;
SET LOCAL lock_timeout = '1s';

DO $prerequisite$ BEGIN
  IF to_regclass('public.ca_club_acct_fact') IS NULL
     OR to_regprocedure('public.fn_ca_club_acct_seed_day(date,boolean)') IS NULL THEN
    RAISE EXCEPTION 'CLUB_ACCT_PREREQUISITE_MISSING: install 20261115004729 first';
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

CREATE TRIGGER ca_club_acct_flow
  AFTER INSERT ON public.union_pnl_original_flows
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION public.trg_ca_club_acct_flow();

-- At commit: the share's wallet leg and its original flow are written in the
-- same transaction as the recipient row.
CREATE CONSTRAINT TRIGGER ca_club_acct_bbj
  AFTER INSERT ON public.bbj_payout_recipients
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION public.trg_ca_club_acct_bbj();

CREATE TRIGGER ca_club_acct_boundary
  AFTER INSERT OR UPDATE OF value ON public.accounting_close_certificates
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_ca_club_acct_boundary();

INSERT INTO public.ca_club_acct_state (singleton, live_from) VALUES (true, now());

COMMIT;
