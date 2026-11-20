-- 20261119195413_the_lightning_games_vpip_floor_is_twenty_five.sql
--
-- THE LIGHTNING GAMES VPIP FLOOR IS 25 (Dan, 2026-11-19, 1:38 PM Chicago:
-- "LOWER THE VPIP IN LIGHTNING GAMES TO 25% ACROSS THE BOARD FOR ALL LIGHTNING
-- GAMES, NO LIMIT OR PLO").
--
-- WHERE THE 40 CAME FROM. A Lightning game is a cash_games row of the
-- Lightning Games format: template_name 'madness' (historical 'action' is the
-- same format) in a variant Lightning deals - nlh, plo4, plo5, plo6. Its floor
-- was never a setting on the game. fn_cash_template_defaults answered 40 for
-- every non-Classic template, and from there the number is only ever copied:
--
--   1. fn_cash_game_create_impl_20260905 writes the template's answer into
--      cash_games.ruleset_snapshot->'vpip_floor' and refuses a caller who
--      sends another one (OVERRIDE_LOCKED);
--   2. zz_cash_game_floor_from_template (fn_cash_game_floor_from_template)
--      rewrites that key from the template on every later snapshot write;
--   3. fn_cash_cluster_open_table copies it to a new table's
--      maintain_percent_min, and fn_cash_apply_ruleset pushes it onto every
--      open table of the game on every cluster tick;
--   4. the engine reads the table row (fn_nit_policy for the judgement, the
--      throttled rule re-read and the Lightning host's per-hand loadHostRules
--      for everything else).
--
-- So twelve table rows set to 25 by hand would have been put back to 40 by the
-- next tick. The one place to move is the template's own answer, and that is
-- what this does. The window (10 hands), the no-grace judgement, the eviction
-- and the two-hour bar are not touched: only the percentage.
--
-- WHAT STAYS AT 40, ON PURPOSE.
--   * A legacy Action or Madness row in a variant Lightning does not deal
--     (plo8, flo8, flh, short_deck): the owner named "NO LIMIT OR PLO", the
--     database refuses those variants for Lightning, and three such tables
--     exist with nobody seated since 2026-10-25. The variant list is written
--     inline because fn_cash_template_defaults runs with its caller's rights
--     and an authenticated caller may not execute fn_lightning_variant_allowed.
--   * Madness WITHOUT Lightning (a Classic game with rules_profile
--     'madness_without_lightning'). Its trigger branch borrows the madness
--     template's ruleset, which until now also lent it the 40. That branch now
--     states its own 40, so the PLO5 Madness games keep the floor the owner
--     gave them on 2026-11-17 and cannot follow Lightning down.
--   * Every Classic floor (template arm and ca_classic_vpip_floors).
--
-- Both functions are written out whole, pinned by pre-image and post-image
-- md5, as 20261118004324 and 20261118030451 did. The data step selects by the
-- format's own columns (template_name, variant), never by a name, and refuses
-- the whole install if this transaction wrote any other row.
--
-- RE-RUNNABLE: the merger dispatches a merged migration to
-- apply-merged-migration.yml, so a second run must be a clean no-op.

BEGIN;

DO $guard$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_cash_template_defaults';
  IF v_md5 IS NULL THEN
    RAISE EXCEPTION 'fn_cash_template_defaults is missing';
  END IF;
  IF v_md5 NOT IN ('6ad34a35974530555157dcf9e4f299c6', '73db130f800807e4b1cc1a4363c996c7') THEN
    RAISE EXCEPTION 'fn_cash_template_defaults drifted (md5=%), refusing to edit', v_md5;
  END IF;

  SELECT md5(p.prosrc) INTO v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_cash_game_floor_from_template';
  IF v_md5 IS NULL THEN
    RAISE EXCEPTION 'fn_cash_game_floor_from_template is missing';
  END IF;
  IF v_md5 NOT IN ('5b0b03754daf121c77d2a451bb9f8839', '1b3e7b8f5a24b613d9654ab31ea60898') THEN
    RAISE EXCEPTION 'fn_cash_game_floor_from_template drifted (md5=%), refusing to edit', v_md5;
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.fn_cash_template_defaults(p_template text, p_variant text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp' AS $fn$
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
  -- Dan 2026-11-19: every Lightning game, No Limit or PLO, keeps a 25% floor.
  -- A Lightning game is the madness template in a variant Lightning deals; a
  -- legacy Action or Madness row in any other variant keeps 40.
  'vpip_floor',CASE WHEN t='classic' AND v IN ('plo5','plo6') THEN 40 WHEN t='classic' THEN 0 WHEN v IN ('nlh','plo4','plo5','plo6') THEN 25 ELSE 40 END,'vpip_window',10,
  'bombs',jsonb_build_object('enabled',t<>'classic','trigger',CASE WHEN t='classic' THEN NULL ELSE 'timed_30m' END,'ante_bb',CASE WHEN t='classic' THEN NULL ELSE 3 END,'boards',CASE WHEN t='classic' THEN NULL ELSE 2 END),
  'straddle',false,'stay_clock_min',10,'rejoin_window_min',120,'run_it_n_times','opt_in','rake','existing');
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_cash_game_floor_from_template()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $fn$
DECLARE
  v_def   jsonb;
  v_floor integer;
  v_win   integer;
  v_grace integer;
BEGIN
  IF NEW.ruleset_snapshot IS NULL THEN
    RETURN NEW;
  END IF;

  -- THE TEMPLATE IS A PROMISE TO THE PLAYER (2026-09-09).
  v_def := public.fn_cash_template_defaults(NEW.template_name, NEW.variant);

  -- MADNESS WITHOUT LIGHTNING (Dan 2026-10-24).
  -- The branch borrows the rest of the madness ruleset from the template and
  -- states its own floor. 2026-11-17: every Classic and Madness PLO table
  -- keeps 40. 2026-11-19: the madness template is the Lightning Games format
  -- and its floor came down to 25 for Lightning alone, so the 40 is written
  -- here, where a Lightning ruling cannot reach it.
  IF NEW.template_name = 'classic'
     AND NOT coalesce(NEW.lightning_enabled, false)
     AND NEW.variant NOT IN ('pineapple', 'pineapple_holdem')
     AND NEW.ruleset_snapshot->>'rules_profile' = 'madness_without_lightning' THEN
    v_def := public.fn_cash_template_defaults('madness', NEW.variant)
             || jsonb_build_object('vpip_floor', 40);
  END IF;

  NEW.ruleset_snapshot := NEW.ruleset_snapshot
    || jsonb_build_object(
         'vpip_floor',   v_def->'vpip_floor',
         'vpip_window',  v_def->'vpip_window',
         'regular_ante', v_def->'regular_ante',
         'bombs',        v_def->'bombs',
         'min_buyin_bb', v_def->'min_buyin_bb');

  -- THE CLASSIC FLOOR (Dan 2026-11-10). A Classic cash game at or above the
  -- configured minimum big blind carries its variant's floor, a rolling
  -- window and a warning grace. GREATEST so a stronger floor already on the
  -- snapshot is preserved rather than lowered by a config row. Until
  -- 2026-11-17 that stronger floor was the 50% madness_without_lightning
  -- pinned on plo5 and plo6; every PLO table keeps 40 now, so nothing in the
  -- tree carries 50. A tournament table never reaches here: cash_games holds
  -- cash clusters only.
  IF NEW.template_name = 'classic' THEN
    SELECT fl.floor_percent, fl.window_hands, fl.warn_grace_hands
      INTO v_floor, v_win, v_grace
      FROM public.ca_classic_vpip_floors fl
     WHERE fl.variant = NEW.variant
       AND NEW.bb >= fl.min_bb
     LIMIT 1;

    IF v_floor IS NOT NULL THEN
      NEW.ruleset_snapshot := NEW.ruleset_snapshot
        || jsonb_build_object(
             'vpip_floor', GREATEST(
                             COALESCE((NEW.ruleset_snapshot->>'vpip_floor')::integer, 0),
                             v_floor),
             'vpip_window',      v_win,
             'vpip_rolling',     true,
             'vpip_grace_hands', v_grace);

      -- The floor never reaches back over hands played before it existed.
      IF (NEW.ruleset_snapshot->>'vpip_floor_since') IS NULL THEN
        NEW.ruleset_snapshot := NEW.ruleset_snapshot
          || jsonb_build_object('vpip_floor_since', to_jsonb(now()));
      END IF;
    END IF;
  END IF;

  IF NEW.variant IN ('flh','flo8') THEN
    NEW.ruleset_snapshot := NEW.ruleset_snapshot || jsonb_build_object('max_buyin_bb',NULL);
  END IF;
  RETURN NEW;
END;
$fn$;

-- Move the open Lightning games, then their open tables, and prove that
-- nothing else moved. One block, so the counts and the row sets it compares
-- are its own.
DO $apply$
DECLARE
  -- The low 32 bits of this transaction's id, as tables print it in xmin.
  v_xid          text := (txid_current() % 4294967296)::text;
  v_ids          uuid[];
  v_rest_before  text;
  v_rest_after   text;
  v_games        integer := 0;
  v_tables       integer := 0;
  v_n            integer;
  v              text;
BEGIN
  -- 1. The template answers 25 for every Lightning variant under both of the
  --    format's names, and exactly what it answered before for everything else.
  FOREACH v IN ARRAY ARRAY['nlh','plo4','plo5','plo6'] LOOP
    IF (public.fn_cash_template_defaults('madness', v)->>'vpip_floor') IS DISTINCT FROM '25'
       OR (public.fn_cash_template_defaults('action', v)->>'vpip_floor') IS DISTINCT FROM '25'
       OR (public.fn_cash_template_defaults('lightning', v)->>'vpip_floor') IS DISTINCT FROM '25' THEN
      RAISE EXCEPTION 'LIGHTNING_25_TEMPLATE: the Lightning % template does not answer 25', v;
    END IF;
  END LOOP;
  IF (public.fn_cash_template_defaults('classic','plo5')->>'vpip_floor') IS DISTINCT FROM '40'
     OR (public.fn_cash_template_defaults('classic','plo6')->>'vpip_floor') IS DISTINCT FROM '40'
     OR (public.fn_cash_template_defaults('classic','plo4')->>'vpip_floor') IS DISTINCT FROM '0'
     OR (public.fn_cash_template_defaults('classic','nlh')->>'vpip_floor') IS DISTINCT FROM '0'
     OR (public.fn_cash_template_defaults('madness','plo8')->>'vpip_floor') IS DISTINCT FROM '40'
     OR (public.fn_cash_template_defaults('madness','short_deck')->>'vpip_floor') IS DISTINCT FROM '40'
     OR (public.fn_cash_template_defaults('madness','nlh')->>'vpip_window') IS DISTINCT FROM '10' THEN
    RAISE EXCEPTION 'LIGHTNING_25_TEMPLATE: a floor outside Lightning moved, or the window did';
  END IF;

  -- 2. The open Lightning games that do not read 25 yet. A retired club's
  --    records are read-only (fn_guard_retired_club_mutation) and stay as
  --    they are.
  SELECT array_agg(g.id ORDER BY g.id),
         md5(coalesce(string_agg(g.id::text || md5((g.ruleset_snapshot - 'vpip_floor')::text), ',' ORDER BY g.id), ''))
    INTO v_ids, v_rest_before
    FROM public.cash_games g
   WHERE g.template_name IN ('action','madness','lightning')
     AND lower(g.variant) IN ('nlh','plo4','plo5','plo6')
     AND g.closed_at IS NULL
     AND g.ruleset_snapshot IS NOT NULL
     AND (g.ruleset_snapshot->>'vpip_floor') IS DISTINCT FROM '25'
     AND NOT EXISTS (SELECT 1 FROM public.clubs c
                      WHERE c.id = g.club_id AND c.lifecycle_status = 'retired');

  IF v_ids IS NOT NULL THEN
    -- Touching ruleset_snapshot fires zz_cash_game_floor_from_template, which
    -- resolves the floor from the template defined above.
    UPDATE public.cash_games g
       SET ruleset_snapshot = g.ruleset_snapshot || jsonb_build_object('vpip_floor', 25)
     WHERE g.id = ANY (v_ids);
    GET DIAGNOSTICS v_games = ROW_COUNT;

    IF v_games <> cardinality(v_ids) THEN
      RAISE EXCEPTION 'LIGHTNING_25_GAMES: % of % Lightning games were written', v_games, cardinality(v_ids);
    END IF;

    SELECT md5(coalesce(string_agg(g.id::text || md5((g.ruleset_snapshot - 'vpip_floor')::text), ',' ORDER BY g.id), ''))
      INTO v_rest_after
      FROM public.cash_games g
     WHERE g.id = ANY (v_ids);
    IF v_rest_after IS DISTINCT FROM v_rest_before THEN
      RAISE EXCEPTION 'LIGHTNING_25_GAMES: a rule other than the floor changed on a Lightning game';
    END IF;
  END IF;

  -- 3. Every open Lightning game outside a retired club reads 25.
  SELECT count(*) INTO v_n
    FROM public.cash_games g
   WHERE g.template_name IN ('action','madness','lightning')
     AND lower(g.variant) IN ('nlh','plo4','plo5','plo6')
     AND g.closed_at IS NULL
     AND g.ruleset_snapshot IS NOT NULL
     AND (g.ruleset_snapshot->>'vpip_floor') IS DISTINCT FROM '25'
     AND NOT EXISTS (SELECT 1 FROM public.clubs c
                      WHERE c.id = g.club_id AND c.lifecycle_status = 'retired');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'LIGHTNING_25_GAMES: % open Lightning games did not land on 25', v_n;
  END IF;

  -- 4. No game that is not a Lightning game was written by this transaction.
  SELECT count(*) INTO v_n
    FROM public.cash_games g
   WHERE g.xmin::text = v_xid
     AND NOT (g.template_name IN ('action','madness','lightning')
              AND lower(g.variant) IN ('nlh','plo4','plo5','plo6'));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'LIGHTNING_25_SCOPE: % games that are not Lightning games were written', v_n;
  END IF;

  -- 5. Madness without Lightning keeps the 40 of 2026-11-17.
  SELECT count(*) INTO v_n
    FROM public.cash_games g
   WHERE g.ruleset_snapshot->>'rules_profile' = 'madness_without_lightning'
     AND g.closed_at IS NULL
     AND (g.ruleset_snapshot->>'vpip_floor') IS DISTINCT FROM '40';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'LIGHTNING_25_SCOPE: % madness_without_lightning games left 40', v_n;
  END IF;

  -- 6. The open tables carry their own copy. fn_cash_apply_ruleset would bring
  --    them across on the next cluster tick; this does it now, for the same
  --    tables it would write (open, not deleted) and that one column only.
  --    Last, so the row locks on twelve dealing tables are held for the
  --    shortest time.
  UPDATE public.tables t
     SET maintain_percent_min = 25
    FROM public.cash_games g
   WHERE g.id = t.cluster_id
     AND g.template_name IN ('action','madness','lightning')
     AND lower(g.variant) IN ('nlh','plo4','plo5','plo6')
     AND g.closed_at IS NULL
     AND (g.ruleset_snapshot->>'vpip_floor') = '25'
     AND t.lifecycle <> 'closed'
     AND coalesce(t.is_deleted, false) = false
     AND t.nit_game IS TRUE
     AND t.maintain_percent_min IS DISTINCT FROM 25
     AND NOT EXISTS (SELECT 1 FROM public.clubs c
                      WHERE c.id IN (t.club_id, g.club_id) AND c.lifecycle_status = 'retired');
  GET DIAGNOSTICS v_tables = ROW_COUNT;

  -- 7. Every table of any game that this transaction wrote is an open table of
  --    a Lightning game and reads 25, and there are exactly as many as the
  --    statement above reported. A table with no game cannot be reached by
  --    that statement at all.
  SELECT count(*) INTO v_n
    FROM public.cash_games g
    JOIN public.tables t ON t.cluster_id = g.id
   WHERE t.xmin::text = v_xid
     AND NOT (g.template_name IN ('action','madness','lightning')
              AND lower(g.variant) IN ('nlh','plo4','plo5','plo6')
              AND t.lifecycle <> 'closed'
              AND t.maintain_percent_min = 25);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'LIGHTNING_25_SCOPE: % tables that are not open Lightning tables were written', v_n;
  END IF;
  SELECT count(*) INTO v_n
    FROM public.cash_games g
    JOIN public.tables t ON t.cluster_id = g.id
   WHERE t.xmin::text = v_xid;
  IF v_n <> v_tables THEN
    RAISE EXCEPTION 'LIGHTNING_25_SCOPE: % tables were written, % expected', v_n, v_tables;
  END IF;

  -- 8. No open table of an open Lightning game is left on another floor.
  SELECT count(*) INTO v_n
    FROM public.cash_games g
    JOIN public.tables t ON t.cluster_id = g.id
   WHERE g.template_name IN ('action','madness','lightning')
     AND lower(g.variant) IN ('nlh','plo4','plo5','plo6')
     AND g.closed_at IS NULL
     AND t.lifecycle <> 'closed'
     AND coalesce(t.is_deleted, false) = false
     AND t.nit_game IS TRUE
     AND t.maintain_percent_min IS DISTINCT FROM 25
     AND NOT EXISTS (SELECT 1 FROM public.clubs c
                      WHERE c.id IN (t.club_id, g.club_id) AND c.lifecycle_status = 'retired');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'LIGHTNING_25_TABLES: % open Lightning tables did not land on 25', v_n;
  END IF;

  RAISE NOTICE 'LIGHTNING_25: % games and % tables moved to 25', v_games, v_tables;
END
$apply$;

DO $verify$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_cash_template_defaults';
  IF v_md5 <> '73db130f800807e4b1cc1a4363c996c7' THEN
    RAISE EXCEPTION 'fn_cash_template_defaults post-image is %, expected 73db130f800807e4b1cc1a4363c996c7', v_md5;
  END IF;
  SELECT md5(p.prosrc) INTO v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_cash_game_floor_from_template';
  IF v_md5 <> '1b3e7b8f5a24b613d9654ab31ea60898' THEN
    RAISE EXCEPTION 'fn_cash_game_floor_from_template post-image is %, expected 1b3e7b8f5a24b613d9654ab31ea60898', v_md5;
  END IF;
END
$verify$;

COMMIT;
