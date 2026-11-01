-- THE ADD-ON GRANT IS THE STARTING STACK (Dan 2026-11-01, binding):
--
--   "AN ADD ON CAN NEVER EXCEED THE AMOUNT OF CHIPS THAT THE TOURNAMENT
--    STARTED WITH, THE ADD ON SHOULD BE THE SAME AMOUNT OF CHIPS THAT YOU
--    START WITH IN THE TOURNAMENT, NEVER LESS!"
--
-- Sunday Funday Big Stack offered an 80,000-chip add-on over a 40,000
-- starting stack, because midwayStructurePolicy carried a 2x floor
-- (Math.max(addon_chips, stack * 2)). Two things close it here, and the same
-- pull request corrects the creators (midwayStructurePolicy.ts,
-- tournamentFromTableConfig.ts) so code and database state one law:
--
--   1. A BEFORE INSERT normalizer on public.tournaments: every new paid
--      add-on tournament is born with addon_chips = starting_chips. It runs
--      on INSERT only, deliberately - a BEFORE UPDATE form would alter a
--      protected key inside unrelated legitimate updates and trip
--      fn_guard_managed_game_lifecycle for them. Free Buy events keep their
--      owner-designed 1-chip / 10,000-chip promotional add-on
--      (FREE_BUY_TIERS, server/src/services/FreeBuy.ts), recognized by
--      free_buy = true or by the canonical fn_is_free_buy_event() test,
--      exactly as fn_freerolls_are_free_buy recognizes them.
--   2. The one-time correction of every unfinished paid row. The lifecycle
--      guard rightly refuses addon_chips on a registered event, so the
--      correction runs under session_replication_role = 'replica' scoped to
--      this transaction - the same owner-authorized one-time-correction shape
--      migration 20261101204812 (Lightning P&L supersession) used. No money
--      moves: addon_chips is the offer's grant figure; chips already credited
--      by earlier purchases are untouched.
--
-- @live-proof: (SELECT NOT EXISTS (SELECT 1 FROM public.tournaments t WHERE t.add_on_available = true AND COALESCE(t.free_buy, false) = false AND COALESCE(t.buy_in_amount, 0) > 0 AND upper(COALESCE(t.status,'')) NOT IN ('FINISHED','CANCELLED','COMPLETED') AND t.addon_chips IS DISTINCT FROM t.starting_chips))

BEGIN;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '10s';
SET LOCAL search_path = pg_catalog, public;

-- ── 1. Every new paid add-on tournament is born lawful ──────────────────────
CREATE OR REPLACE FUNCTION public.fn_ca_addon_grant_is_starting_stack()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.add_on_available, false)
     AND COALESCE(NEW.free_buy, false) = false
     AND NOT public.fn_is_free_buy_event(
       NEW.buy_in_amount, NEW.buy_in_fee, NEW.tournament_type, NEW.variant
     )
     AND COALESCE(NEW.starting_chips, 0) > 0
     AND NEW.addon_chips IS DISTINCT FROM NEW.starting_chips THEN
    NEW.addon_chips := NEW.starting_chips;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_ca_addon_grant_is_starting_stack ON public.tournaments;
CREATE TRIGGER trg_ca_addon_grant_is_starting_stack
BEFORE INSERT ON public.tournaments
FOR EACH ROW
EXECUTE FUNCTION public.fn_ca_addon_grant_is_starting_stack();

-- tournaments is a money table, so the trigger is declared in the same
-- migration that creates it, as the money-trigger register requires.
INSERT INTO public.ca_declared_money_triggers (table_name, trigger_name, note)
VALUES (
  'tournaments',
  'trg_ca_addon_grant_is_starting_stack',
  'BEFORE INSERT normalizer (Dan 2026-11-01, binding): a paid add-on tournament is born with addon_chips = starting_chips - "the add on should be the same amount of chips that you start with in the tournament, never less", and it "can never exceed" it. It assigns one column of NEW on INSERT only, reads nothing else, moves no chips and touches no wallet or ledger; Free Buy events keep their owner-designed promotional add-on, skipped by the free_buy flag and by the canonical fn_is_free_buy_event() test the free-buy pricing trigger itself uses.'
);

-- ── 2. The one-time correction of every unfinished paid row ─────────────────
SET LOCAL session_replication_role = 'replica';

UPDATE public.tournaments
SET addon_chips = starting_chips
WHERE add_on_available = true
  AND COALESCE(free_buy, false) = false
  AND COALESCE(buy_in_amount, 0) > 0
  AND COALESCE(starting_chips, 0) > 0
  AND upper(COALESCE(status, '')) NOT IN ('FINISHED', 'CANCELLED', 'COMPLETED')
  AND addon_chips IS DISTINCT FROM starting_chips;

SET LOCAL session_replication_role = 'origin';

COMMIT;
