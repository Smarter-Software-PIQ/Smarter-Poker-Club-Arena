-- 20261105073723_a_free_buy_entry_has_no_ticket_to_check.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- @live-proof: position('A FREE BUY ENTRY HAS NO TICKET TO CHECK' in pg_get_functiondef('public.fn_ca_find_tournament_entry_ticket_for(uuid,uuid)'::regprocedure)) > 0 AND position('A FREE BUY ENTRY HAS NO TICKET TO CHECK' in pg_get_functiondef('public.fn_horse_tournament_entry_ticket_hints(uuid)'::regprocedure)) > 0
--
-- A FREE BUY ENTRY HAS NO TICKET TO CHECK
--
-- WHAT WAS WRONG, READ FROM ROWS
--
-- Every Midway Free Buy since 2026-11-03 06:30 UTC finished with ZERO entries
-- and was cancelled (14 in a row, through the 12:30 AM Free Buy on
-- 2026-11-05), after 200-400 entries each through 2026-11-02. Players and
-- horses alike were refused.
--
-- 20261102154336 made a Midway Free Buy a 0-chip entry whose 1-chip bounty is
-- paid by the Midway promo wallet (buy_in_amount 0, buy_in_fee 0,
-- bounty_amount 1). For that shape fn_tournament_entry_split(0, 0, 1, true)
-- returns charge 0, bounty 1, prize -1. The entry-ticket lookups validate the
-- split BEFORE their own "a 0-chip entry has no ticket" exit, read the -1 as an
-- impossible price and raise 'tournament ... has no finite ticket contract'.
-- Both entry doors call one of them before registering:
--   fn_ca_find_tournament_entry_ticket_for  (players, and horses through
--                                            fn_register_horse_for_tournament_before_terminal_gate)
--   fn_horse_tournament_entry_ticket_hints  (horse purchase planning)
-- Probed in a rolled-back transaction on the 12:30 AM Free Buy (ce952f30):
-- the lookup raised; the registration core that follows it admitted the horse
-- with cost 0, rake 0 and a 1-chip promo bounty, exactly as designed.
--
-- THE FIX
--
-- A Free Buy whose entry charges the player nothing has no ticket that could
-- pay for it, so both lookups answer "no ticket" before the price check. Paid
-- events, and any misconfigured event that is not a Free Buy, still meet the
-- unchanged check. The registration core keeps booking the promo bounty as
-- before; no wallet balance moves in this migration.
--
-- Applied to the installed definitions, refusing unless each anchor appears
-- exactly once, so the long functions are not retyped by hand.

BEGIN;

SET LOCAL lock_timeout = '1s';

DO $migration$
DECLARE
  v_anchor constant text :=
    E'  SELECT * INTO v_split FROM public.fn_tournament_entry_split(\n'
    || E'    v_t.buy_in_amount,v_t.buy_in_fee,v_t.bounty_amount,v_is_bounty);\n';
  v_note constant text :=
    E'  /* A FREE BUY ENTRY HAS NO TICKET TO CHECK (2026-11-05). A Midway Free Buy\n'
    || E'     charges the player nothing; its bounty is promo funded, so its split\n'
    || E'     reads prize -1 and must not be judged as a ticket price. */\n';
  v_targets constant text[] := ARRAY[
    'public.fn_ca_find_tournament_entry_ticket_for(uuid,uuid)',
    'public.fn_horse_tournament_entry_ticket_hints(uuid)'];
  v_returns constant text[] := ARRAY[
    E'    RETURN jsonb_build_object(''ok'',true,''ticket_id'',NULL);\n',
    E'    RETURN jsonb_build_object(''ok'',true,''holder_ids'',''[]''::jsonb);\n'];
  v_def text;
  i integer;
BEGIN
  FOR i IN 1..2 LOOP
    v_def := pg_get_functiondef(v_targets[i]::regprocedure);
    CONTINUE WHEN position('A FREE BUY ENTRY HAS NO TICKET TO CHECK' IN v_def) > 0;
    IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
      RAISE EXCEPTION '% anchor not found exactly once; refusing to patch', v_targets[i];
    END IF;
    EXECUTE replace(v_def, v_anchor,
      v_note
      || E'  IF COALESCE(v_t.free_buy,false)\n'
      || E'     AND round(COALESCE(v_t.buy_in_amount,0)+COALESCE(v_t.buy_in_fee,0),2)=0 THEN\n'
      || v_returns[i]
      || E'  END IF;\n'
      || v_anchor);
  END LOOP;
END
$migration$;

COMMIT;
