-- An earned Mines board is quoted against the cap already funded for its award.
-- A later standalone-game cap must not silently shorten that sealed board.
-- @live-proof: position('WHEN p_game=''mines'' THEN COALESCE((public.fn_wheel_starting_award()).cap_cents' IN pg_get_functiondef('public.fn_choice_start(uuid,text,text,bigint,uuid,text,integer)'::regprocedure)) > 0
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $migration$
DECLARE
  target constant regprocedure := 'public.fn_choice_start(uuid,text,text,bigint,uuid,text,integer)'::regprocedure;
  source text := pg_get_functiondef(target);
  old_call constant text := 'cap:=public.fn_diamond_game_cap_cents(adm.o_cfg,adm.o_pool,adm.o_bank,adm.o_bet_chips,(adm.o_cfg).max_multiplier_cents);';
  new_call constant text := 'cap:=public.fn_diamond_game_cap_cents(adm.o_cfg,adm.o_pool,adm.o_bank,adm.o_bet_chips,
  CASE WHEN p_game=''mines'' THEN COALESCE((public.fn_wheel_starting_award()).cap_cents,(adm.o_cfg).max_multiplier_cents)
  ELSE (adm.o_cfg).max_multiplier_cents END);';
BEGIN
  IF (length(source) - length(replace(source,old_call,''))) <> length(old_call) THEN
    RAISE EXCEPTION 'Expected one Mines admission cap calculation';
  END IF;
  EXECUTE replace(source,old_call,new_call);
END $migration$;
COMMIT;
