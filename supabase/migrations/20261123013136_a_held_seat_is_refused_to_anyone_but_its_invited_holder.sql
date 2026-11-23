-- @install-window: daily-maintenance
-- @locks: public.tournament_players
-- @live-proof: (EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid WHERE t.tgrelid = 'public.tournament_players'::regclass AND t.tgname = 'trg_private_game_entry_guard' AND NOT t.tgisinternal AND t.tgenabled = 'O' AND p.oid = 'public.fn_private_game_entry_guard()'::regprocedure) AND EXISTS (SELECT 1 FROM public.ca_declared_money_triggers d WHERE d.table_name = 'tournament_players' AND d.trigger_name = 'trg_private_game_entry_guard'))
--
-- 20261123013136_a_held_seat_is_refused_to_anyone_but_its_invited_holder.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- 20261123013126 made a held seat a rule (fn_private_game_entry_refusal) and
-- wrote the trigger body that applies it (fn_private_game_entry_guard). This
-- attaches that body to public.tournament_players, the one row every entry
-- into a Spin, a Heads Up or a satellite feeder writes, whoever buys it:
-- fn_take_seat_and_buy_in (through fn_register_for_tournament), the horse
-- seat door fn_seat_horse_in_seat_first_game (through
-- fn_register_horse_for_tournament), the ticket and free-buy doors and every
-- registration door after them. One rule, applied where the entry is written,
-- under the event row lock every one of those doors already takes. A person
-- without the invite and a horse are refused by exactly the same line; nothing
-- reads is_horse (CLAUDE.md 10.5).
--
-- The trigger fires BEFORE INSERT, and BEFORE UPDATE OF status or user_id, so a
-- row that BECOMES an entry is judged too. Every other write (registered to
-- playing, chips, busts) leaves at the trigger's first line, and a game with no
-- hold at its second: one primary-key probe on a table of open invites.
--
-- WINDOW: CREATE TRIGGER takes SHARE ROW EXCLUSIVE on tournament_players,
-- which tournament hands write throughout play (CLAUDE.md section 2 rule 10),
-- so this installs in the daily 04:00 America/Chicago window. It sets no
-- timeout of its own. Until it installs, the hold is honoured by the engine
-- (it seats no horse into a held game) and by the client (it admits through
-- fn_accept_private_game_invite before every seat-first purchase).
--
-- PRE-FLIGHT: refuses unless the ordinary half (20261123013126) is installed.

BEGIN;

DO $needs$
BEGIN
  IF to_regprocedure('public.fn_private_game_entry_guard()') IS NULL
     OR to_regprocedure('public.fn_private_game_entry_refusal(uuid,uuid)') IS NULL
     OR to_regclass('public.private_game_holds') IS NULL THEN
    RAISE EXCEPTION 'private_game_hold_rule_missing: install 20261123013126 first'
      USING ERRCODE = '55000';
  END IF;
END $needs$;

DROP TRIGGER IF EXISTS trg_private_game_entry_guard ON public.tournament_players;
CREATE TRIGGER trg_private_game_entry_guard
  BEFORE INSERT OR UPDATE OF status, user_id ON public.tournament_players
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_private_game_entry_guard();

INSERT INTO public.ca_declared_money_triggers (table_name, trigger_name, note)
VALUES ('tournament_players', 'trg_private_game_entry_guard',
        'BEFORE INSERT / UPDATE OF status, user_id: refuses (P0001 PRIVATE_GAME_SEAT_HELD) a NEW entry into a game whose seats an inviter holds for invited friends, unless the entrant is the inviter or a player the invite token admitted (fn_private_game_entry_refusal). Writes nothing and moves no money: the refused door rolls back its own purchase. Leaves at its first line for every non-entry write, so it is never on the hand path.')
ON CONFLICT DO NOTHING;

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'public.tournament_players'::regclass
                    AND t.tgname = 'trg_private_game_entry_guard'
                    AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'private_game_entry_guard_missing';
  END IF;
END $post$;

COMMIT;
