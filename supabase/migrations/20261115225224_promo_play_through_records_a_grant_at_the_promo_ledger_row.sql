-- 20261115225224_promo_play_through_records_a_grant_at_the_promo_ledger_row.sql
-- @install-window: daily-maintenance
-- @locks: public.chip_ledger
-- @live-proof: EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.chip_ledger'::regclass AND tgname = 'zz_ca_promo_play_through_grant' AND tgenabled = 'O')
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Promo play-through, phase 2 of 5 (owner ruling 2026-11-15: "IMPLEMENT THIS
-- GLOBALLY FOR ALL PROMO CHIPS SENT OUT AND RECEIVED TO ANY AND ALL PLAERS OR
-- AGENTS"). Phase 1 (20261115210559) built the grant ledger and the fee meter;
-- nothing wrote a grant. This records one at the single place every promo chip
-- already passes: its chip_ledger row.
--
-- WHY THE LEDGER ROW AND NOT EACH DOOR. A balance never moves without its
-- ledger row, so a promo chip reaching a player wallet always writes one row
-- from a promo wallet to player_wallet. Measured over 14 days on production
-- (4,827 such rows): every one carries club_id, names a club member in
-- to_entity_id, is posted and positive. The doors are many (union
-- disbursement, club and agent promo sends, wheel, crash, plinko, mines and
-- crossing prizes) and a door added later would be missed by a list of doors.
-- It is not missed here.
--
-- WHAT COUNTS. From a promo wallet (from_type promo_wallet, or the union's
-- promo wallet: from_type union_wallet with from_label
-- union_wallets.promo_wallet) to a player wallet, positive, in any category
-- except the ones that are not a gift: settlement (a prize shortfall paid out
-- of promo is winnings), reversal, refund, correction and adjustment.
--
-- The grant is written in the transaction that credits the chips, so a credit
-- without its lock cannot exist, and there is nothing to reconcile afterwards.
-- Before go-live (ca_promo_play_through_settings.enforced_from IS NULL) the
-- function reads one settings row and records nothing, so installing this
-- file changes no behaviour.
--
-- Not covered here, and named so it is not mistaken for covered: promo sent
-- to an agent wallet (2 rows, 120 chips in 30 days) and the value of a ticket
-- paid for with promo chips. Both follow in this phase's next migration.
--
-- CREATE TRIGGER takes SHARE ROW EXCLUSIVE on chip_ledger, a table written by
-- every hand, so this file waits for the daily 04:00 America/Chicago break
-- (CLAUDE.md section 2 rule 10). DDL only.

BEGIN;
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.fn_ca_promo_play_through_on_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.fn_ca_promo_play_through_record_grant(
    NEW.club_id,
    NEW.to_entity_id,
    NEW.amount,
    CASE
      WHEN NEW.category = 'wheel_prize' THEN 'wheel_prize'
      WHEN NEW.category LIKE '%\_prize' THEN 'other_promo'
      WHEN NEW.from_type = 'union_wallet' THEN 'union_promo'
      WHEN NEW.category = 'promo_send'
           AND COALESCE(NEW.metadata ->> 'actor_role', '') IN ('super_agent', 'agent', 'sub_agent')
        THEN 'agent_promo'
      ELSE 'club_promo'
    END,
    'chip_ledger:' || NEW.id::text,
    NEW.id,
    NEW.from_type,
    NEW.from_entity_id,
    NULL);
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_promo_play_through_on_ledger() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER zz_ca_promo_play_through_grant
  AFTER INSERT ON public.chip_ledger
  FOR EACH ROW
  WHEN (NEW.to_type = 'player_wallet'
        AND NEW.amount > 0
        AND NEW.club_id IS NOT NULL
        AND NEW.to_entity_id IS NOT NULL
        AND COALESCE(NEW.status, 'posted') = 'posted'
        AND (NEW.from_type = 'promo_wallet'
             OR (NEW.from_type = 'union_wallet'
                 AND NEW.from_label = 'union_wallets.promo_wallet'))
        AND NEW.category NOT IN ('settlement', 'reversal', 'refund', 'correction', 'adjustment'))
  EXECUTE FUNCTION public.fn_ca_promo_play_through_on_ledger();

INSERT INTO public.ca_declared_money_triggers(table_name, trigger_name, note)
VALUES ('chip_ledger', 'zz_ca_promo_play_through_grant',
  'Dan 2026-11-15: every promo chip credited to a player wallet records its 4x play-through grant in the crediting transaction. Writes ca_promo_play_through_grants only; moves no chips.')
ON CONFLICT DO NOTHING;

COMMIT;
