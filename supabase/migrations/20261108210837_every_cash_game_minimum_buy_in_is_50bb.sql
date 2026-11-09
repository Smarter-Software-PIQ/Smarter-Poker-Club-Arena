-- 20261108210837_every_cash_game_minimum_buy_in_is_50bb.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Dan 2026-11-08: "MAKE THE MINIMUM BUY INS 50 BB FOR ANY AND ALL CASH
-- GAMES." Asked whether Lightning keeps its higher 100 BB minimum, he chose
-- "Every game exactly 50 BB": Classic goes 40 -> 50, Lightning 100 -> 50,
-- one minimum everywhere. The maximum is unchanged.
--
-- Where the number lives, measured on production before this file:
--   - cash_games.ruleset_snapshot->>'min_buyin_bb' is each game's rule; the
--     opener (fn_cash_cluster_open_table) and fn_cash_apply_ruleset project
--     it onto the game's tables as min_buy_in = bb * min_buyin_bb. Open games
--     carried 40 (Classic), 100 (Lightning), 50, 100 and 400.
--   - fn_cash_template_defaults wrote 40 for Classic and 100 otherwise.
--   - fn_update_managed_game accepted any min_buy_in for a table.
--   - atomic_table_buyin enforces tables.min_buy_in, so the rows ARE the rule.
--
-- THE FIX AT THE ROOT, not a sweep:
--   1. The template says 50 for every template.
--   2. zz_cash_game_floor_from_template (which already forces the template's
--      ante, VPIP floor and bombs onto every snapshot write) now forces the
--      template's min_buyin_bb too. No creation override, edit or script can
--      save a cash game with any other minimum.
--   3. fn_update_managed_game derives a table's minimum from its big blind
--      (bb * 50) instead of accepting one.
-- Then the open games are re-saved through that trigger and their rules
-- projected onto their live tables with the platform's own fn_cash_apply_ruleset.
--
-- Untouched on purpose: closed games, tables in retired clubs (read-only by
-- fn_guard_retired_club_mutation), tournament tables, and the Diamond Arena
-- (closed 2026-11-05). Seated stacks are not touched: a player already seated
-- below 50 BB keeps the stack; the next buy-in or rebuy is held to 50 BB by
-- atomic_table_buyin reading the new row.
--
-- No hot-table DDL: CREATE OR REPLACE FUNCTION locks no table, and the row
-- updates are ordinary row writes the per-game projection makes every tick.

BEGIN;
SET LOCAL lock_timeout = '2s';

-- 1. Every template's minimum is 50 BB.
CREATE OR REPLACE FUNCTION public.fn_cash_template_defaults(p_template text, p_variant text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE t text:=lower(coalesce(p_template,'classic')); v text:=lower(coalesce(p_variant,'nlh')); family text; seats int;
BEGIN
 IF t IN ('action','madness','lightning') THEN t:='madness'; END IF;
 IF t NOT IN ('classic','madness') THEN RAISE EXCEPTION 'TEMPLATE_UNKNOWN: %',p_template; END IF;
 IF t='madness' AND v IN ('pineapple','pineapple_holdem') THEN
  RAISE EXCEPTION 'LIGHTNING_VARIANT_NOT_SUPPORTED: Pineapple Uses Classic Games';
 END IF;
 family:=CASE WHEN v IN ('plo4','plo5','plo6','plo8','flo8') THEN 'plo' WHEN v='short_deck' THEN 'shortdeck' WHEN v='pineapple' THEN 'pineapple' ELSE 'holdem' END;
 seats:=CASE WHEN t='classic' AND family='holdem' THEN 9 ELSE 6 END;
 RETURN jsonb_build_object('template',t,'variant',v,'family',family,'seats',seats,
  'seats_locked',t='madness' OR family='plo',
  'seat_choices',CASE WHEN t='madness' OR family='plo' THEN '[6]'::jsonb WHEN family='holdem' THEN '[9,6]'::jsonb ELSE '[2,3,4,5,6,7,8]'::jsonb END,
  -- Dan 2026-11-08: every cash game's minimum buy-in is exactly 50 BB.
  'min_buyin_bb',50,'max_buyin_bb',CASE WHEN v IN ('flh','flo8') THEN NULL ELSE 200 END,
  'regular_ante',CASE WHEN t='classic' AND v NOT IN ('plo5','plo6') THEN 'none' ELSE 'bb' END,
  'vpip_floor',CASE WHEN t='classic' AND v IN ('plo5','plo6') THEN 50 WHEN t='classic' THEN 0 ELSE 40 END,'vpip_window',10,
  'bombs',jsonb_build_object('enabled',t<>'classic','trigger',CASE WHEN t='classic' THEN NULL ELSE 'timed_30m' END,'ante_bb',CASE WHEN t='classic' THEN NULL ELSE 3 END,'boards',CASE WHEN t='classic' THEN NULL ELSE 2 END),
  'straddle',false,'stay_clock_min',10,'rejoin_window_min',120,'run_it_n_times','opt_in','rake','existing');
END $function$;

-- 2. Every snapshot write carries the template's minimum.
CREATE OR REPLACE FUNCTION public.fn_cash_game_floor_from_template()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_def jsonb;
BEGIN
  IF NEW.ruleset_snapshot IS NULL THEN
    RETURN NEW;
  END IF;

  -- THE TEMPLATE IS A PROMISE TO THE PLAYER (2026-09-09). The four fields the
  -- lobby blurb names come from fn_cash_template_defaults on EVERY write, not
  -- only at creation. "No Antes, No Bombs, No VPIP Floor" cannot be true of a
  -- game whose snapshot says otherwise, whoever wrote that snapshot.
  --
  -- `||` and not jsonb_set for `bombs`: the object is replaced WHOLE, so a
  -- stale member inside it (a trigger left over from a template change) cannot
  -- survive underneath a corrected `enabled`.
  v_def := public.fn_cash_template_defaults(NEW.template_name, NEW.variant);

  -- MADNESS WITHOUT LIGHTNING (Dan 2026-10-24). One named profile, honoured
  -- only on an ordinary Classic game that is not Lightning: the Madness
  -- promise (BB ante, two-board bombs every 10 minutes) with the owner's 50%
  -- floor. It is still the template that decides, on every write.
  IF NEW.template_name = 'classic'
     AND NOT coalesce(NEW.lightning_enabled, false)
     AND NEW.variant NOT IN ('pineapple', 'pineapple_holdem')
     AND NEW.ruleset_snapshot->>'rules_profile' = 'madness_without_lightning' THEN
    v_def := public.fn_cash_template_defaults('madness', NEW.variant)
             || jsonb_build_object('vpip_floor', 50);
  END IF;

  -- THE MINIMUM BUY-IN IS THE TEMPLATE'S TOO (Dan 2026-11-08: "MAKE THE
  -- MINIMUM BUY INS 50 BB FOR ANY AND ALL CASH GAMES"). A creation override
  -- or a later edit cannot carry another minimum onto a game.
  NEW.ruleset_snapshot := NEW.ruleset_snapshot
    || jsonb_build_object(
         'vpip_floor',   v_def->'vpip_floor',
         'vpip_window',  v_def->'vpip_window',
         'regular_ante', v_def->'regular_ante',
         'bombs',        v_def->'bombs',
         'min_buyin_bb', v_def->'min_buyin_bb');

  IF NEW.variant IN ('flh','flo8') THEN
    NEW.ruleset_snapshot := NEW.ruleset_snapshot || jsonb_build_object('max_buyin_bb',NULL);
  END IF;
  RETURN NEW;
END;
$function$;

-- 3. A managed table's minimum is derived from its big blind, never accepted.
DO $patch$
DECLARE
  v_sig regprocedure := 'public.fn_update_managed_game(text,uuid,jsonb)'::regprocedure;
  v_def text := pg_get_functiondef(v_sig);
  v_old text := E'      IF v_sb IS NULL OR v_bb IS NULL OR v_min IS NULL';
  v_new text := E'      -- Dan 2026-11-08: every cash minimum is exactly 50 BB.\n'
             || E'      IF v_bb > 0 THEN v_min := round(v_bb * 50, 2); END IF;\n\n'
             || E'      IF v_sb IS NULL OR v_bb IS NULL OR v_min IS NULL';
BEGIN
  IF strpos(v_def, 'v_min := round(v_bb * 50, 2)') > 0 THEN
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) <> length(v_old) THEN
    RAISE EXCEPTION 'unexpected fn_update_managed_game preimage';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$patch$;

-- 4. Re-save every open game's rules through the trigger above.
UPDATE public.cash_games g
   SET ruleset_snapshot = g.ruleset_snapshot
  FROM public.clubs c
 WHERE c.id = g.club_id
   AND g.closed_at IS NULL
   AND g.ruleset_snapshot IS NOT NULL
   AND coalesce(c.lifecycle_status, '') <> 'retired'
   AND coalesce(c.asset, 'chips') <> 'diamonds'
   AND (g.ruleset_snapshot->>'min_buyin_bb') IS DISTINCT FROM '50';

-- 5. Project each open game's rules onto its live tables, through the same
--    function the platform uses for every rule change.
DO $apply$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT g.id
      FROM public.cash_games g
      JOIN public.clubs c ON c.id = g.club_id
     WHERE g.closed_at IS NULL
       AND coalesce(c.lifecycle_status, '') <> 'retired'
       AND coalesce(c.asset, 'chips') <> 'diamonds'
     ORDER BY g.id
  LOOP
    PERFORM public.fn_cash_apply_ruleset(r.id);
  END LOOP;
END
$apply$;

-- 6. Prove it, or roll the whole file back.
DO $assert$
DECLARE v_games integer; v_tables integer;
BEGIN
  SELECT count(*) INTO v_games
    FROM public.cash_games g JOIN public.clubs c ON c.id = g.club_id
   WHERE g.closed_at IS NULL AND g.ruleset_snapshot IS NOT NULL
     AND coalesce(c.lifecycle_status, '') <> 'retired'
     AND coalesce(c.asset, 'chips') <> 'diamonds'
     AND (g.ruleset_snapshot->>'min_buyin_bb') IS DISTINCT FROM '50';
  IF v_games > 0 THEN
    RAISE EXCEPTION '% open cash games still carry a minimum other than 50 BB', v_games;
  END IF;

  SELECT count(*) INTO v_tables
    FROM public.tables t
    JOIN public.cash_games g ON g.id = t.cluster_id
    JOIN public.clubs c ON c.id = g.club_id
   WHERE g.closed_at IS NULL
     AND coalesce(c.lifecycle_status, '') <> 'retired'
     AND coalesce(c.asset, 'chips') <> 'diamonds'
     AND t.tournament_id IS NULL
     AND coalesce(t.big_blind, 0) > 0
     AND coalesce(t.lifecycle, '') <> 'closed'
     AND NOT coalesce(t.is_deleted, false)
     AND t.min_buy_in IS DISTINCT FROM round(t.big_blind * 50, 2);
  IF v_tables > 0 THEN
    RAISE EXCEPTION '% live cash tables still carry a minimum other than 50 BB', v_tables;
  END IF;

  IF (public.fn_cash_template_defaults('classic', 'nlh')->>'min_buyin_bb') <> '50'
     OR (public.fn_cash_template_defaults('madness', 'plo4')->>'min_buyin_bb') <> '50' THEN
    RAISE EXCEPTION 'template minimum is not 50 BB';
  END IF;
END
$assert$;

COMMIT;
