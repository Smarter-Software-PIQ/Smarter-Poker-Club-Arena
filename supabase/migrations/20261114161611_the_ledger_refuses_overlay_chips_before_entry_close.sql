-- 20261114161611_the_ledger_refuses_overlay_chips_before_entry_close
-- @install-window: daily-maintenance
-- @locks: public.chip_ledger
-- @live-proof: EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.chip_ledger'::regclass AND tgname = 'aab_ca_overlay_waits_for_entry_close' AND tgenabled = 'O')
--
-- THE LEDGER REFUSES OVERLAY CHIPS BEFORE THE ENTRY PERIOD ENDS (owner law,
-- 2026-11-14: "NO CHIPS ARE EVER EVER EVER SUPPOSED TO GO TO ANY TOURNAMENT
-- 'FOR OVERLAYS' UNTIL THE REGISTRATION / REBUY / ADD ON PERIOD HAS OFFICALLY
-- ENDED").
--
-- 20261114161610 fixed every writer: the entry-window close waits for the
-- rebuy window, fn_apply_prize_guarantee refuses before the period ends, and a
-- satellite with an entry period has its seats funded at the close instead of
-- its start. This attaches the guard function it installed,
-- fn_ca_overlay_waits_for_entry_close, to chip_ledger, so no writer, present
-- or future, can put bank or promo chips (overlay or promo_send from
-- union_bank, union_wallet or club_treasury) into a tournament's prize
-- liability before registration, rebuys and the add-on have all ended. A Free
-- Buy entry's bounty part booked at sign-up (tourney:<id>:promo_head:<reg>) is
-- entry funding, not an overlay, and passes.
--
-- CREATE TRIGGER takes SHARE ROW EXCLUSIVE on chip_ledger, a table written by
-- every buy-in, so it installs only in the daily maintenance window (CLAUDE.md
-- section 2, rule 10), once, with a 1 s lock timeout. DDL only; no rows move.
BEGIN;
SET LOCAL lock_timeout = '1s';

DO $prerequisite$ BEGIN
  IF to_regprocedure('public.fn_ca_overlay_waits_for_entry_close()') IS NULL
     OR to_regprocedure('public.fn_ca_guarantee_entry_period_ended(uuid)') IS NULL THEN
    RAISE EXCEPTION 'GUARANTEE_LEDGER_GUARD_PREREQUISITE_MISSING: install 20261114161610 first';
  END IF;
END $prerequisite$;

CREATE TRIGGER aab_ca_overlay_waits_for_entry_close
  BEFORE INSERT ON public.chip_ledger
  FOR EACH ROW
  WHEN (NEW.to_type = 'prize_liability'
        AND NEW.category IN ('overlay', 'promo_send')
        AND NEW.from_type IN ('union_bank', 'union_wallet', 'club_treasury'))
  EXECUTE FUNCTION public.fn_ca_overlay_waits_for_entry_close();

INSERT INTO public.ca_declared_money_triggers (table_name, trigger_name, note)
VALUES ('chip_ledger', 'aab_ca_overlay_waits_for_entry_close',
  'Owner law 2026-11-14: refuses overlay or promo_send chips from union_bank, union_wallet or club_treasury into a tournament prize liability before its registration, rebuy and add-on period has ended (fn_ca_guarantee_entry_period_ended). Writes nothing; a Free Buy sign-up bounty head passes.');

COMMIT;
