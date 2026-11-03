-- 20261103114208_horse_late_prize_return_trigger_installs
-- @install-window: daily-maintenance
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-03 11:42:08 UTC.
--
-- Owner order (Dan, 2026-11-03 05:27 CT): late prizes return to the bank by
-- themselves. Binds fn_ca_horse_split_return_late_credit (installed by
-- 20261103113029_horse_late_prizes_return_to_the_old_club_bank, which says
-- what it does and why it can never block a payment) to club_members: after a
-- departed record's chip_balance rises. Creating a trigger on club_members
-- takes SHARE ROW EXCLUSIVE on a table written in every instant of play, so
-- this file installs inside the daily 04:00 Chicago window (CLAUDE.md 2 rule
-- 10). DDL plus its money-trigger declaration only.
-- @live-proof: (SELECT count(*) = 1 FROM pg_trigger WHERE tgrelid = 'public.club_members'::regclass AND tgname = 'zzzz_horse_split_late_credit_returns_to_bank' AND tgenabled = 'O')

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

CREATE TRIGGER zzzz_horse_split_late_credit_returns_to_bank
  AFTER UPDATE OF chip_balance ON public.club_members
  FOR EACH ROW
  WHEN (NEW.membership_lifecycle_status = 'departed' AND NEW.chip_balance > OLD.chip_balance)
  EXECUTE FUNCTION public.fn_ca_horse_split_return_late_credit();

-- Declared in the same migration (check-money-trigger-declared).
INSERT INTO public.ca_declared_money_triggers(table_name, trigger_name, note)
VALUES ('club_members', 'zzzz_horse_split_late_credit_returns_to_bank',
  'Dan 2026-11-03: a credit landing on a horse membership the club split departed returns to that club''s bank in the same transaction (declared Club Bank claim); on any failure the credit stays on the record.')
ON CONFLICT DO NOTHING;

COMMIT;
