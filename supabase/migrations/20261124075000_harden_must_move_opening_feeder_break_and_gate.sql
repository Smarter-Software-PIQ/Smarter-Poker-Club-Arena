-- 20261124075000_harden_must_move_opening_feeder_break_and_gate.sql
--
-- HARDEN OPENING-FEEDER RESERVATION, BREAK FILL ORDER, GATED-FEEDER STEP 2
-- COUNTER, AND FAIL-CLOSED SEAT-CHANGE GUARD
--
-- WHY THIS EXISTS (post-20261124051600 adversarial hardening audit):
--   1. public.fn_cash_main_chair_is_the_lists(uuid):
--      Reserving open Main chairs for ANY opening feeder (including a 0-seat
--      opening feeder with no pending inbound moves) could starve open Main
--      chairs when an opening feeder sits empty under the hourly table cap,
--      while relying solely on a feeder table left a momentary gap whenever
--      a feeder closed with higher live Mains still feeding upward. Require
--      either a higher live Main (hm.main_index > mt.main_index), a live
--      feeder, or an opening feeder that already has seated players or
--      pending inbound moves.
--   2. public.fn_cash_cluster_tick_uncapped(uuid,integer) Step 5 BREAK:
--      Breaking-table destinations were ordered `c.seated ASC, c.main_index
--      ASC NULLS LAST`, routing breaking players to a shorter higher Main
--      (e.g. Main 3 at 3/9) instead of filling Main 2 (5/9 -> 9/9) first.
--      Order by `(c.role = 'feeder') ASC, c.main_index ASC NULLS LAST,
--      c.seated DESC` so breaking tables always fill Main 1 -> Main 2 ->
--      Main 3 -> Feeder upward.
--   3. public.fn_cash_cluster_tick_uncapped(uuid,integer) Step 2 MUST-MOVE:
--      The SQL `LIMIT GREATEST(v_n, 0)` truncated candidate rows BEFORE the
--      per-row 9-max Feeder gate recheck (`CONTINUE WHEN`). When Main 2
--      needed 2 players and the Feeder at 7/9 held 2 older-joined players
--      ahead of Main 3 (9/9), the second Feeder row was skipped by the gate
--      and SQL LIMIT hid Main 3's eligible players, planning only 1 move
--      instead of 2. Replace SQL LIMIT with an explicit `v_planned_for_t`
--      counter incremented only after `INSERT INTO public.cash_seat_moves`.
--   4. public.fn_cash_seat_change_plan(uuid,timestamp with time zone):
--      The `NOT EXISTS` upward-Main guard failed open if `r.from_table_id`
--      was absent from `v_census` or if either `main_index` was NULL.
--      Replace with a fail-closed `EXISTS` guard that allows open-chair seat
--      changes into a Main only when `src` is positively present in
--      `v_census` with `src.role = 'main'`, non-NULL indices, and
--      `src.main_index < c.main_index`.
--
-- No money path, balance write, or engine restart is required. One bounded
-- transaction with catalog/reversibility guards, post-install assertions,
-- and rollback probes for all three functions.
--
-- Proof: scripts/dev/prove-every-main-table-feeds-upward.sh
-- Law: tests/every-main-table-feeds-upward.law.test.ts
--
-- @live-proof: (SELECT pg_get_functiondef('public.fn_cash_main_chair_is_the_lists(uuid)'::regprocedure) LIKE '%HIGHER LIVE MAIN OR POPULATED/LIVE FEEDER%' AND pg_get_functiondef('public.fn_cash_main_chair_is_the_lists(uuid)'::regprocedure) LIKE '%hm.main_index > mt.main_index%' AND pg_get_functiondef('public.fn_cash_main_chair_is_the_lists(uuid)'::regprocedure) LIKE '%m.to_table_id = ft.id AND m.state = ''pending''%')
-- @live-proof: (SELECT pg_get_functiondef('public.fn_cash_cluster_tick_uncapped(uuid,integer)'::regprocedure) LIKE '%ORDER BY (c.role = ''feeder'') ASC, c.main_index ASC NULLS LAST, c.seated DESC LIMIT 1;%' AND pg_get_functiondef('public.fn_cash_cluster_tick_uncapped(uuid,integer)'::regprocedure) LIKE '%EXIT WHEN v_planned_for_t >= GREATEST(v_n, 0);%' AND pg_get_functiondef('public.fn_cash_cluster_tick_uncapped(uuid,integer)'::regprocedure) NOT LIKE '%LIMIT GREATEST(v_n, 0)%')
-- @live-proof: (SELECT pg_get_functiondef('public.fn_cash_seat_change_plan(uuid,timestamp with time zone)'::regprocedure) LIKE '%FAIL-CLOSED UPWARD-MAIN GUARD%' AND pg_get_functiondef('public.fn_cash_seat_change_plan(uuid,timestamp with time zone)'::regprocedure) LIKE '%src.main_index < c.main_index%' AND pg_get_functiondef('public.fn_cash_seat_change_plan(uuid,timestamp with time zone)'::regprocedure) NOT LIKE '%src.main_index > c.main_index%')

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- 1. Reserve open Main chairs only for a higher live Main, a live feeder,
--    or an opening feeder that already has seated players or pending inbound moves.
DO $harden_main_chair$
DECLARE
  v_oid     oid := 'public.fn_cash_main_chair_is_the_lists(uuid)'::regprocedure;
  v_before  text;
  v_after   text;
  v_catalog record;
  v_old     text :=
$o$       AND EXISTS (SELECT 1 FROM public.tables ft
                    WHERE ft.cluster_id = mt.cluster_id AND ft.role = 'feeder'
                      AND ft.lifecycle IN ('live', 'opening')
                      AND coalesce(ft.is_deleted, false) = false
                      AND ft.status IN ('waiting', 'running', 'active')));$o$;
  v_new     text :=
$r$       AND (
         -- HIGHER LIVE MAIN OR POPULATED/LIVE FEEDER (2026-11-24): reserve open
         -- Main chairs whenever a higher live Main can feed upward (closing any
         -- momentary closed-feeder gap) OR a live feeder exists OR an opening
         -- feeder already has seated players or pending inbound moves (avoiding
         -- 0-seat opening-feeder starvation and 1-player opening-feeder stranding).
         EXISTS (SELECT 1 FROM public.tables hm
                  WHERE hm.cluster_id = mt.cluster_id
                    AND hm.role = 'main'
                    AND hm.main_index > mt.main_index
                    AND hm.lifecycle = 'live'
                    AND coalesce(hm.is_deleted, false) = false
                    AND hm.status IN ('waiting', 'running', 'active'))
         OR EXISTS (SELECT 1 FROM public.tables ft
                     WHERE ft.cluster_id = mt.cluster_id
                       AND ft.role = 'feeder'
                       AND coalesce(ft.is_deleted, false) = false
                       AND ft.status IN ('waiting', 'running', 'active')
                       AND (ft.lifecycle = 'live'
                            OR (ft.lifecycle = 'opening'
                                AND (EXISTS (SELECT 1 FROM public.table_seats ts
                                              WHERE ts.table_id = ft.id AND ts.left_at IS NULL)
                                     OR EXISTS (SELECT 1 FROM public.cash_seat_moves m
                                                 WHERE m.to_table_id = ft.id AND m.state = 'pending')))))
       ));$r$;
BEGIN
  SELECT pg_get_functiondef(v_oid) INTO v_before;
  SELECT proowner, proacl, proconfig, prosecdef, provolatile
    INTO v_catalog
    FROM pg_proc
   WHERE oid = v_oid;

  IF position('HIGHER LIVE MAIN OR POPULATED/LIVE FEEDER' IN v_before) > 0 THEN
    RAISE EXCEPTION 'fn_cash_main_chair_is_the_lists already carries opening-feeder and higher-Main hardening: re-read before editing';
  END IF;

  IF position('ALL FEEDER GAMES' IN v_before) = 0 THEN
    RAISE EXCEPTION 'fn_cash_main_chair_is_the_lists requires 20261124051600 before applying this migration';
  END IF;

  IF (length(v_before) - length(replace(v_before, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'fn_cash_main_chair_is_the_lists feeder-exists anchor was expected exactly once';
  END IF;

  v_after := replace(v_before, v_old, v_new);
  EXECUTE v_after;

  IF replace(pg_get_functiondef(v_oid), v_new, v_old) <> v_before
     OR EXISTS (
       SELECT 1 FROM pg_proc
        WHERE oid = v_oid
          AND (proowner IS DISTINCT FROM v_catalog.proowner
               OR proacl IS DISTINCT FROM v_catalog.proacl
               OR proconfig IS DISTINCT FROM v_catalog.proconfig
               OR prosecdef IS DISTINCT FROM v_catalog.prosecdef
               OR provolatile IS DISTINCT FROM v_catalog.provolatile)
     ) THEN
    RAISE EXCEPTION 'fn_cash_main_chair_is_the_lists edit changed unrelated source or authority';
  END IF;
END
$harden_main_chair$;

DO $verify_main_chair$
DECLARE
  v_def text := pg_get_functiondef('public.fn_cash_main_chair_is_the_lists(uuid)'::regprocedure);
BEGIN
  IF position('ALL FEEDER GAMES' IN v_def) = 0
     OR position('HIGHER LIVE MAIN OR POPULATED/LIVE FEEDER' IN v_def) = 0
     OR position('hm.main_index > mt.main_index' IN v_def) = 0
     OR position('m.to_table_id = ft.id AND m.state = ''pending''' IN v_def) = 0
     OR position('coalesce(cg.handedness, 9) >= 7' IN v_def) > 0 THEN
    RAISE EXCEPTION 'fn_cash_main_chair_is_the_lists hardening did not install cleanly';
  END IF;
END
$verify_main_chair$;

-- @probe-for: public.fn_cash_main_chair_is_the_lists
DO $probe_main_chair$
BEGIN
  PERFORM public.fn_cash_main_chair_is_the_lists(gen_random_uuid());
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_main_chair$;

-- 2 & 3. Harden fn_cash_cluster_tick_uncapped:
--        - Step 5 BREAK fills Main 1 -> Main 2 -> Main 3 -> Feeder upward.
--        - Step 2 MUST-MOVE replaces SQL LIMIT with explicit v_planned_for_t
--          counter incremented only after INSERT (after the 9-max Feeder gate).
DO $harden_tick$
DECLARE
  v_oid       oid := 'public.fn_cash_cluster_tick_uncapped(uuid,integer)'::regprocedure;
  v_before    text;
  v_after     text;
  v_catalog   record;
  v_old_decl  text :=
$o$  v_moves integer := 0;
  v_n integer;$o$;
  v_new_decl  text :=
$r$  v_moves integer := 0;
  v_n integer;
  v_planned_for_t integer := 0;$r$;
  v_old_init  text :=
$o$    v_n := t.open_unreserved
         - (SELECT count(*) FROM public.cash_seat_moves m WHERE m.to_table_id = t.id AND m.state = 'pending' AND m.swap_move_id IS NULL);
    FOR r IN$o$;
  v_new_init  text :=
$r$    v_n := t.open_unreserved
         - (SELECT count(*) FROM public.cash_seat_moves m WHERE m.to_table_id = t.id AND m.state = 'pending' AND m.swap_move_id IS NULL);
    v_planned_for_t := 0;
    FOR r IN$r$;
  v_old_loop  text :=
$o$       LIMIT GREATEST(v_n, 0)
    LOOP
      IF v_full_ring AND NOT (r.user_id = ANY (v_first)) THEN
        SELECT c.role, c.breaking, c.seated INTO v_src FROM unnest(v_census) c WHERE c.id = r.table_id;
        CONTINUE WHEN v_src.role = 'feeder' AND NOT v_src.breaking
          AND v_src.seated - (SELECT count(*) FROM public.cash_seat_moves mo
                               WHERE mo.from_table_id = r.table_id AND mo.state = 'pending') < v_gate;
      END IF;
      INSERT INTO public.cash_seat_moves (game_id, player_id, from_table_id, to_table_id, reason)
      VALUES (g.id, r.user_id, r.table_id, t.id, 'must_move');
      v_moves := v_moves + 1;$o$;
  v_new_loop  text :=
$r$       -- COUNT PLANNED MOVES AFTER FEEDER GATE (2026-11-24): never truncate
       -- candidates with SQL LIMIT before the per-row 9-max Feeder gate recheck,
       -- or skipped Feeder rows starve eligible Main N+1..K candidates behind them.
    LOOP
      EXIT WHEN v_planned_for_t >= GREATEST(v_n, 0);
      IF v_full_ring AND NOT (r.user_id = ANY (v_first)) THEN
        SELECT c.role, c.breaking, c.seated INTO v_src FROM unnest(v_census) c WHERE c.id = r.table_id;
        CONTINUE WHEN v_src.role = 'feeder' AND NOT v_src.breaking
          AND v_src.seated - (SELECT count(*) FROM public.cash_seat_moves mo
                               WHERE mo.from_table_id = r.table_id AND mo.state = 'pending') < v_gate;
      END IF;
      INSERT INTO public.cash_seat_moves (game_id, player_id, from_table_id, to_table_id, reason)
      VALUES (g.id, r.user_id, r.table_id, t.id, 'must_move');
      v_planned_for_t := v_planned_for_t + 1;
      v_moves := v_moves + 1;$r$;
  v_old_break text :=
$o$       ORDER BY c.seated ASC, c.main_index ASC NULLS LAST LIMIT 1;$o$;
  v_new_break text :=
$r$       -- BREAK FILLS UPWARD (2026-11-24): fill Main 1 -> Main 2 -> Main 3 ->
       -- Feeder (fullest tie-break) so breaking tables never starve lower Mains.
       ORDER BY (c.role = 'feeder') ASC, c.main_index ASC NULLS LAST, c.seated DESC LIMIT 1;$r$;
BEGIN
  SELECT pg_get_functiondef(v_oid) INTO v_before;
  SELECT proowner, proacl, proconfig, prosecdef, provolatile
    INTO v_catalog
    FROM pg_proc
   WHERE oid = v_oid;

  IF position('v_planned_for_t' IN v_before) > 0
     OR position('BREAK FILLS UPWARD' IN v_before) > 0 THEN
    RAISE EXCEPTION 'fn_cash_cluster_tick_uncapped already carries Step 2 counter or Step 5 break hardening: re-read before editing';
  END IF;

  IF position('EVERY MAIN FEEDS UPWARDS' IN v_before) = 0 THEN
    RAISE EXCEPTION 'fn_cash_cluster_tick_uncapped requires 20261124003437 before applying this migration';
  END IF;

  IF (length(v_before) - length(replace(v_before, v_old_decl, ''))) / length(v_old_decl) <> 1 THEN
    RAISE EXCEPTION 'fn_cash_cluster_tick_uncapped DECLARE anchor was expected exactly once';
  END IF;

  IF (length(v_before) - length(replace(v_before, v_old_init, ''))) / length(v_old_init) <> 1 THEN
    RAISE EXCEPTION 'fn_cash_cluster_tick_uncapped Step 2 init anchor was expected exactly once';
  END IF;

  IF (length(v_before) - length(replace(v_before, v_old_loop, ''))) / length(v_old_loop) <> 1 THEN
    RAISE EXCEPTION 'fn_cash_cluster_tick_uncapped Step 2 loop anchor was expected exactly once';
  END IF;

  IF (length(v_before) - length(replace(v_before, v_old_break, ''))) / length(v_old_break) <> 1 THEN
    RAISE EXCEPTION 'fn_cash_cluster_tick_uncapped Step 5 break order anchor was expected exactly once';
  END IF;

  v_after := replace(
    replace(
      replace(
        replace(v_before, v_old_decl, v_new_decl),
        v_old_init, v_new_init
      ),
      v_old_loop, v_new_loop
    ),
    v_old_break, v_new_break
  );
  EXECUTE v_after;

  IF replace(
       replace(
         replace(
           replace(pg_get_functiondef(v_oid), v_new_break, v_old_break),
           v_new_loop, v_old_loop
         ),
         v_new_init, v_old_init
       ),
       v_new_decl, v_old_decl
     ) <> v_before
     OR EXISTS (
       SELECT 1 FROM pg_proc
        WHERE oid = v_oid
          AND (proowner IS DISTINCT FROM v_catalog.proowner
               OR proacl IS DISTINCT FROM v_catalog.proacl
               OR proconfig IS DISTINCT FROM v_catalog.proconfig
               OR prosecdef IS DISTINCT FROM v_catalog.prosecdef
               OR provolatile IS DISTINCT FROM v_catalog.provolatile)
     ) THEN
    RAISE EXCEPTION 'fn_cash_cluster_tick_uncapped edit changed unrelated source or authority';
  END IF;
END
$harden_tick$;

DO $verify_tick$
DECLARE
  v_def text := pg_get_functiondef('public.fn_cash_cluster_tick_uncapped(uuid,integer)'::regprocedure);
BEGIN
  IF position('EVERY MAIN FEEDS UPWARDS' IN v_def) = 0
     OR position('(c.role = ''main'' AND c.main_index > t.main_index)' IN v_def) = 0
     OR position('BREAK FILLS UPWARD' IN v_def) = 0
     OR position('ORDER BY (c.role = ''feeder'') ASC, c.main_index ASC NULLS LAST, c.seated DESC LIMIT 1;' IN v_def) = 0
     OR position('EXIT WHEN v_planned_for_t >= GREATEST(v_n, 0);' IN v_def) = 0
     OR position('v_planned_for_t := v_planned_for_t + 1;' IN v_def) = 0
     OR position('LIMIT GREATEST(v_n, 0)' IN v_def) > 0 THEN
    RAISE EXCEPTION 'fn_cash_cluster_tick_uncapped hardening did not install cleanly';
  END IF;
END
$verify_tick$;

-- @probe-for: public.fn_cash_cluster_tick_uncapped
DO $probe_tick$
BEGIN
  PERFORM public.fn_cash_cluster_tick_uncapped(gen_random_uuid(), NULL);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_tick$;

-- 4. Make fn_cash_seat_change_plan fail-closed on missing source row or NULL main_index.
DO $harden_seat_change$
DECLARE
  v_oid     oid := 'public.fn_cash_seat_change_plan(uuid,timestamp with time zone)'::regprocedure;
  v_before  text;
  v_after   text;
  v_catalog record;
  v_old     text :=
$o$       AND NOT EXISTS (
         SELECT 1 FROM unnest(v_census) src
          WHERE src.id = r.from_table_id
            AND c.role = 'main'
            AND (src.role = 'feeder' OR (src.role = 'main' AND src.main_index > c.main_index))
       )$o$;
  v_new     text :=
$r$       -- FAIL-CLOSED UPWARD-MAIN GUARD (2026-11-24): allow an open-chair seat
       -- change into a Main only when src is positively present in v_census as
       -- a strictly lower-numbered Main (src.main_index < c.main_index).
       -- Missing source rows, Feeders, and NULL main_index values fail closed.
       AND EXISTS (
         SELECT 1 FROM unnest(v_census) src
          WHERE src.id = r.from_table_id
            AND (c.role <> 'main'
                 OR (src.role = 'main'
                     AND src.main_index IS NOT NULL
                     AND c.main_index IS NOT NULL
                     AND src.main_index < c.main_index))
       )$r$;
BEGIN
  SELECT pg_get_functiondef(v_oid) INTO v_before;
  SELECT proowner, proacl, proconfig, prosecdef, provolatile
    INTO v_catalog
    FROM pg_proc
   WHERE oid = v_oid;

  IF position('FAIL-CLOSED UPWARD-MAIN GUARD' IN v_before) > 0 THEN
    RAISE EXCEPTION 'fn_cash_seat_change_plan already carries fail-closed upward-Main guard: re-read before editing';
  END IF;

  IF (length(v_before) - length(replace(v_before, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'fn_cash_seat_change_plan upward-Main guard anchor was expected exactly once';
  END IF;

  v_after := replace(v_before, v_old, v_new);
  EXECUTE v_after;

  IF replace(pg_get_functiondef(v_oid), v_new, v_old) <> v_before
     OR EXISTS (
       SELECT 1 FROM pg_proc
        WHERE oid = v_oid
          AND (proowner IS DISTINCT FROM v_catalog.proowner
               OR proacl IS DISTINCT FROM v_catalog.proacl
               OR proconfig IS DISTINCT FROM v_catalog.proconfig
               OR prosecdef IS DISTINCT FROM v_catalog.prosecdef
               OR provolatile IS DISTINCT FROM v_catalog.provolatile)
     ) THEN
    RAISE EXCEPTION 'fn_cash_seat_change_plan edit changed unrelated source or authority';
  END IF;
END
$harden_seat_change$;

DO $verify_seat_change$
DECLARE
  v_def text := pg_get_functiondef('public.fn_cash_seat_change_plan(uuid,timestamp with time zone)'::regprocedure);
BEGIN
  IF position('NEVER SEAT-CHANGE UPWARD INTO A MAIN' IN v_def) = 0
     OR position('FAIL-CLOSED UPWARD-MAIN GUARD' IN v_def) = 0
     OR position('src.main_index < c.main_index' IN v_def) = 0
     OR position('src.main_index > c.main_index' IN v_def) > 0
     OR position('cluster_mode IS DISTINCT FROM ''must_move''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'fn_cash_seat_change_plan hardening did not install cleanly';
  END IF;
END
$verify_seat_change$;

-- @probe-for: public.fn_cash_seat_change_plan
DO $probe_seat_change$
BEGIN
  PERFORM public.fn_cash_seat_change_plan(gen_random_uuid());
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_seat_change$;

COMMIT;
