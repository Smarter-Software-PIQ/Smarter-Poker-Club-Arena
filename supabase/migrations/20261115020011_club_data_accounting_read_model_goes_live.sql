-- 20261115020011_club_data_accounting_read_model_goes_live
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
-- INSTALLED AT MERGE, NOT IN THE 04:00 WINDOW (owner instruction 2026-11-14
-- 21:55 America/Chicago, verbatim: "IT CAN GO LIVE AS SOON AS YOU PUSH IT").
-- CREATE TRIGGER takes SHARE ROW EXCLUSIVE on each of the eight source
-- tables, which waits for the writers in flight on that table and holds new
-- ones until COMMIT. So this transaction is kept from stalling play:
--   * every lock is asked for once, with lock_timeout 120ms and no retry; a
--     busy table fails the whole file cleanly (nothing attached, nothing
--     recorded) and it is dispatched once more later, never in a loop;
--   * the triggers are created back to back with nothing between them, the
--     coldest tables first and the hand path last (posthand escrow
--     certificates, BBJ recipients, tournament recognized fees, cash funding
--     admissions, original flows, cash rake sources, lightning link
--     resolutions, hand touches), so the tables written by every hand are
--     held the shortest;
--   * the longest any writer can wait is the eight bounded asks in a row,
--     8 x 120 ms = 0.96 s, under the 1 s deadlock_timeout (so a hand commit
--     is never chosen as a deadlock victim: this transaction times out first)
--     and under the owner's one-second stall bound, in ONE transaction (one
--     PostgREST schema reload; CLAUDE.md production DDL policy rule 1).
-- Measured read-only on production 2026-11-15 04:05Z (100 samples, 100 ms
-- apart): a row-exclusive holder on any of the eight tables was seen in 4
-- samples, the oldest 79 ms old, so each ask expects to be granted inside
-- its 120 ms.
--
-- DDL plus the one state row of this feature's own table; no money row is
-- read for update or written.
--
-- A projection never makes the write it follows wait (its row locks are
-- try-locks; every trigger function runs with lock_timeout 50ms) and never
-- refuses it: a projection that raises is recorded in
-- ca_club_acct_projection_failures and the Club Data reader reports that day
-- as incomplete.
BEGIN;
SET LOCAL lock_timeout = '120ms';

DO $prerequisite$ BEGIN
  IF to_regclass('public.ca_club_acct_fact') IS NULL
     OR to_regprocedure('public.fn_ca_club_acct_seed_day(date,boolean)') IS NULL THEN
    RAISE EXCEPTION 'CLUB_ACCT_PREREQUISITE_MISSING: install 20261115020010 first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ca_club_acct_state) THEN
    RAISE EXCEPTION 'CLUB_ACCT_ALREADY_LIVE';
  END IF;
END $prerequisite$;

CREATE TRIGGER ca_club_acct_escrow_certificate
  AFTER INSERT ON smarter_private.posthand_escrow_certificates
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION public.trg_ca_club_acct_escrow_certificate();
-- At commit: the share's wallet leg and its original flow are written in the
-- same transaction as the recipient row.
CREATE CONSTRAINT TRIGGER ca_club_acct_bbj
  AFTER INSERT ON public.bbj_payout_recipients
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION public.trg_ca_club_acct_bbj();
CREATE TRIGGER ca_club_acct_tournament_fee
  AFTER INSERT ON public.accounting_tournament_recognized_sources
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION public.trg_ca_club_acct_tournament_fee();
CREATE TRIGGER ca_club_acct_admission
  AFTER INSERT ON public.accounting_cash_funding_contract_admissions
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION public.trg_ca_club_acct_admission();
-- At commit: a tournament flow's receipt is written in the flow's own
-- transaction, after or before the flow.
CREATE CONSTRAINT TRIGGER ca_club_acct_flow
  AFTER INSERT ON public.union_pnl_original_flows
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION public.trg_ca_club_acct_flow();
CREATE TRIGGER ca_club_acct_cash_fee
  AFTER INSERT ON public.accounting_cash_rake_sources
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION public.trg_ca_club_acct_cash_fee();
CREATE TRIGGER ca_club_acct_link
  AFTER INSERT ON public.union_pnl_cash_outcome_link_resolutions
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION public.trg_ca_club_acct_link();
CREATE TRIGGER ca_club_acct_touch
  AFTER INSERT ON public.union_pnl_cash_outcome_touches
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION public.trg_ca_club_acct_touch();

INSERT INTO public.ca_club_acct_state (singleton, live_from) VALUES (true, now());

COMMIT;
