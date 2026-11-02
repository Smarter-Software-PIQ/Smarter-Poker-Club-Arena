-- @live-proof: NOT EXISTS (SELECT 1 FROM public.poker_diamond_custody WHERE purpose='cash_seat' AND state<>'released') AND NOT EXISTS (SELECT 1 FROM public.tournaments x WHERE public.fn_poker_diamond_tournament(x.id) AND upper(x.status::text)='REGISTERING') AND EXISTS (SELECT 1 FROM public.cash_games WHERE id='f141626a-1bcb-466a-903e-6d6c780ad319' AND NOT enabled AND closed_at IS NOT NULL) AND EXISTS (SELECT 1 FROM public.ca_diamond_arena_owner_closure WHERE club_id='002c2d27-9584-4e52-835a-bb2be148fc81' AND closed)
-- ============================================================================
-- THE DIAMOND ARENA CLOSES ALL THE WAY: EMPTY EVENTS CANCELLED, EVERY CASH SEAT
-- CASHED OUT (Dan, 2026-11-02 05:08 UTC)
-- ============================================================================
--
-- Dan, verbatim: "My instruction was to close all Diamond Arena games and
-- events, including frozen leftovers - not merely confirm new starts are
-- disabled. Keep the arena closed until I explicitly reopen it. ... Close or
-- cancel them through the supported custody-safe settlement/refund paths,
-- preserving retained hands and preventing duplicate payments. Do not edit
-- balances directly." This supersedes the "no refunds" clause of
-- 20261031032915 for the two liability groups below. The closure record, the
-- disabled arena switches and the floor park are untouched: nothing reopens.
--
-- READ FROM ROWS (2026-11-02 05:12 UTC), every unreleased Diamond custody row:
--   cash_seat         active   43 rows   31,964 Diamonds  (cluster NLH 1/2)
--   tournament_entry  active 1,436 rows 428,212 Diamonds  (15 RUNNING events)
-- No pending purchase (diamond_purchases: completed/failed/expired only), no
-- open spin or sit-and-go, no other custody purpose. Every holder is a horse;
-- horses are players (CLAUDE.md 10.5) and are settled exactly as a human is.
--
-- WHAT THIS SETTLES, AND THROUGH WHICH AUTHORITY:
-- 1. 36 REGISTERING Diamond events (34 MTT, 2 satellites, 0 registrations,
--    0 custody, 0 ledger lines). fn_poker_diamond_tournament_cancel, called
--    exactly as the staff door fn_poker_diamond_cancel_tournament calls it
--    (global lane first, the two lifecycle settings, the system actor the
--    authority already defaults to). It releases each guarantee earmark and
--    writes an immutable tournament_cancellation_receipts row. 0 refunds owed.
-- 2. 43 cash seats on cluster f141626a (8 tables; last hand 2026-10-31
--    03:29 UTC; every stack equals its custody exactly; no retained hand,
--    post-hand escrow or retired-hand custody on the cluster).
--    fn_poker_diamond_cashout, the engine's own cash-out: it vacates the seat,
--    releases that seat's exact custody to the player's own wallet once (keyed
--    by occupancy) and stores a seat_cashout_receipts row. No balance is
--    written here. The empty cluster then closes with
--    fn_poker_diamond_close_cash_table's own writes; that door needs a signed-in
--    staff session, so the close is logged through fn_log_admin_action against
--    the same system actor.
--
-- WHAT THIS DELIBERATELY DOES NOT TOUCH:
--   The 15 RUNNING (started) Diamond events and their 428,212 Diamonds of entry
--   custody. The cancellation authority refuses a started event ("resume or
--   settle it instead of cancelling"), and all 15 are members of the owner's
--   existing 170-event equal-share closure (operation d44c4440 and its sibling
--   operations; scripts/ci/fixtures/tournament-recovery20/
--   equal-share-closure-intent.json), whose settlement runs through
--   fn_ca_settle_tournament_abort_equal_share once window migrations
--   20261101004247 and 20261101005048 install. Settling them here would race
--   that operation and risk paying twice. Their retained hands stay intact.
--
-- PROOF: the exact body ran as one self-aborting DO block on production
-- (2026-11-02 05:19 UTC) and returned: 36 events cancelled, 0 refund lines,
-- 43 seats cashed out, 31,964 Diamonds returned, 65 cluster tables closed,
-- 0 unaccounted seat exits. Those figures are asserted below; if the board
-- moved, the transaction aborts and nothing is written.
--
-- Lock order: the global settlement lane is taken before any row (a first
-- probe that took horse rows before the lane deadlocked against live
-- settlement work and was rolled back by Postgres).
-- ============================================================================
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
DO $close$
DECLARE
  v_cluster constant uuid := 'f141626a-1bcb-466a-903e-6d6c780ad319';
  v_club constant uuid := '002c2d27-9584-4e52-835a-bb2be148fc81';
  v_actor constant uuid := '2d1cd6c3-5700-4af9-a271-d4863fdab20d';
  v jsonb; s record; t record; v_before jsonb;
  n_cancel int := 0; n_refund_lines int := 0; v_refunded numeric := 0;
  n_seat int := 0; v_returned bigint := 0; n_tables int;
BEGIN
  -- The arena stays closed; nothing here reopens anything.
  IF NOT EXISTS (SELECT 1 FROM public.ca_diamond_arena_owner_closure WHERE club_id=v_club AND closed)
     OR EXISTS (SELECT 1 FROM public.ca_arena_settings WHERE id=1 AND (cash_games_enabled OR tournaments_enabled)) THEN
    RAISE EXCEPTION 'DIAMOND_CLOSURE: the arena is not closed; refusing to settle against an open floor';
  END IF;

  -- Lane before rows: every settlement authority takes the global lane first.
  PERFORM public.fn_ca_lock_settlement_lane_global();

  -- 1. Registering events: the pre-start cancellation authority, exactly as the
  --    staff door calls it. Each writes its own immutable cancellation receipt.
  FOR t IN SELECT x.id FROM public.tournaments x
            WHERE public.fn_poker_diamond_tournament(x.id) AND upper(x.status::text)='REGISTERING'
            ORDER BY x.id LOOP
    PERFORM set_config('app.poker_diamond_staff_cancel', t.id::text, true);
    PERFORM set_config('app.managed_game_lifecycle', 'on', true);
    v := public.fn_poker_diamond_tournament_cancel(t.id, v_actor);
    PERFORM set_config('app.managed_game_lifecycle', '', true);
    PERFORM set_config('app.poker_diamond_staff_cancel', '', true);
    IF (v->>'ok')::boolean IS DISTINCT FROM true OR v->>'status' IS DISTINCT FROM 'CANCELLED' THEN
      RAISE EXCEPTION 'DIAMOND_CLOSURE: cancellation of % did not settle: %', t.id, v;
    END IF;
    n_cancel := n_cancel + 1;
    n_refund_lines := n_refund_lines + COALESCE((v->>'refund_line_count')::int, 0);
    v_refunded := v_refunded + COALESCE((v->>'total_refunded')::numeric, 0);
  END LOOP;

  -- 2. Cash seats: the engine's own cash-out, seat by seat. Each vacates the
  --    seat, releases its exact custody to the player's wallet once (keyed by
  --    occupancy) and stores a seat_cashout_receipts row.
  FOR s IN SELECT ts.user_id, ts.table_id, ts.seat_number, ts.stack
             FROM public.table_seats ts JOIN public.tables tb ON tb.id=ts.table_id
            WHERE tb.cluster_id=v_cluster AND ts.left_at IS NULL
            ORDER BY ts.table_id, ts.seat_number LOOP
    v := public.fn_poker_diamond_cashout(s.user_id, s.table_id, s.seat_number);
    IF (v->>'ok')::boolean IS DISTINCT FROM true
       OR (v->>'stack')::numeric IS DISTINCT FROM s.stack
       OR (v->'custody_receipt'->>'success')::boolean IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'DIAMOND_CLOSURE: cash-out of seat % on % did not settle: %', s.seat_number, s.table_id, v;
    END IF;
    n_seat := n_seat + 1;
    v_returned := v_returned + (v->>'stack')::bigint;
  END LOOP;

  -- 3. The empty cluster closes with the close door's own writes, and the
  --    close is recorded in the admin action log against the system actor.
  IF EXISTS (SELECT 1 FROM public.table_seats ts JOIN public.tables tb ON tb.id=ts.table_id
              WHERE tb.cluster_id=v_cluster AND ts.left_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.poker_diamond_custody c JOIN public.tables tb ON tb.id=c.target_id
                 WHERE tb.cluster_id=v_cluster AND c.purpose='cash_seat' AND c.state<>'released') THEN
    RAISE EXCEPTION 'DIAMOND_CLOSURE: the cluster is not empty after cash-out';
  END IF;
  SELECT to_jsonb(g) INTO v_before FROM public.cash_games g WHERE g.id=v_cluster FOR UPDATE;
  UPDATE public.cash_games SET enabled=false, state='dormant', closed_at=clock_timestamp(), closed_by=v_actor
   WHERE id=v_cluster AND club_id=v_club;
  UPDATE public.tables SET status='closed', lifecycle='closed', current_players=0
   WHERE cluster_id=v_cluster;
  GET DIAGNOSTICS n_tables = ROW_COUNT;
  PERFORM public.fn_log_admin_action(v_actor, 'diamond.table_close', 'diamond_table', v_cluster::text,
    jsonb_build_object('asset','diamonds','door','owner_diamond_arena_full_closure_2026_11_02',
      'cash_seats_cashed_out', n_seat, 'diamonds_returned', v_returned, 'tables_closed', n_tables,
      'registering_events_cancelled', n_cancel),
    v_before, (SELECT to_jsonb(g) FROM public.cash_games g WHERE g.id=v_cluster));

  -- The numbers proved in the rolled-back probe. If the board moved, abort.
  IF n_cancel <> 36 OR n_refund_lines <> 0 OR v_refunded <> 0
     OR n_seat <> 43 OR v_returned <> 31964 THEN
    RAISE EXCEPTION 'DIAMOND_CLOSURE: board moved (cancelled % lines % refunded % seats % returned %)',
      n_cancel, n_refund_lines, v_refunded, n_seat, v_returned;
  END IF;
  IF EXISTS (SELECT 1 FROM public.poker_diamond_custody WHERE purpose='cash_seat' AND state<>'released')
     OR EXISTS (SELECT 1 FROM public.tournaments x WHERE public.fn_poker_diamond_tournament(x.id)
                 AND upper(x.status::text)='REGISTERING')
     OR EXISTS (SELECT 1 FROM public.fn_unaccounted_seat_exits()) THEN
    RAISE EXCEPTION 'DIAMOND_CLOSURE: a liability remains after settlement';
  END IF;
  RAISE NOTICE 'Diamond closure: % events cancelled, % seats cashed out, % Diamonds returned, % tables closed',
    n_cancel, n_seat, v_returned, n_tables;
END $close$;
COMMIT;
