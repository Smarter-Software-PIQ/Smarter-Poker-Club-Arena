-- 20261123023325_a_hands_add_ons_take_their_seats_before_their_rows.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A HAND'S ADD-ONS TAKE THEIR SEATS BEFORE THEIR ROWS
--
-- THE DEFECT, READ FROM THE POSTGRES LOG. Between 20:16 and 20:23 UTC on
-- 2026-11-22 the end-of-hand bookkeeping RPC fn_project_hand_side_effects
-- deadlocked six times at one Lightning host table. Each time Postgres
-- cancelled the bookkeeping pass, whose side of the cycle is always this line
-- (the same line also deadlocked on 2026-11-18 at 06:27 UTC against the
-- Lightning lane, and on 2026-11-17 at 23:09 UTC against a cash-out,
-- fn_cashout_seat_occupancy, whose seat exit resolves the player's add-ons
-- under the seat row it is ending):
--
--   while locking tuple (80125,n) in relation "table_seats"
--   SELECT stack FROM table_seats WHERE table_id = v_row.table_id
--     AND user_id = v_row.user_id AND left_at IS NULL FOR UPDATE
--   resolve_pending_addon(uuid,numeric) line 29
--   fn_ca_process_hand_post_commit_obligations(uuid) line 469
--   fn_project_hand_side_effects(uuid) line 269
--
-- The other side was the next Lightning hand being settled
-- (fn_lightning_settle_hand, directly or through
-- smarter_private.fn_engine_lightning_lane). Its own lock-wait lines name what
-- it held and what it waited for:
--
--   held    table_seats   fn_lightning_settle_hand line 242
--           (every anchor seat FOR UPDATE, in seat id order)
--   wanted  table_pending_addons tuple (1158,35)
--           fn_ca_commit_hand_settlement line 649 (the commit door freezes the
--           host table's unresolved add-ons FOR UPDATE, ORDER BY created_at, id)
--
-- THE CAUSE, BY LINE. Every door that holds both a seat and a pending add-on
-- takes the seat first: the commit door freezes the add-ons after its stack
-- core holds the hand's seats (and a Lightning settlement after it has locked
-- every anchor), and an ended seat resolves its add-ons under its own row
-- (smarter_private.fn_record_ended_seat_occupancy, ORDER BY created_at, id).
-- The post-commit envelope was the one place that took them the other way
-- round: line 459 of fn_ca_process_hand_post_commit_obligations locks the
-- add-on row, then line 469 calls resolve_pending_addon, whose line 29 locks
-- the player's seat. A top-up being delivered after hand N, while hand N+1 was
-- committing on the same chair, held the add-on and waited for the seat while
-- the commit held the seat and waited for the add-on. The envelope also took
-- its add-ons in uuid text order, where every other door takes them by
-- created_at, id: a second reverse order, between two add-ons of one table.
--
-- THE FIX. Inside the envelope, before the add-on loop, every lock the loop
-- will take is taken first in the platform's order, each with the same 1 s
-- bound this function already gives every lock it names (a refusal still
-- rolls the block back and answers obligation_lock_busy, which the worker
-- retries): first every live seat resolve_pending_addon will lock (the player
-- of each unresolved add-on, at its table), ORDER BY seat id as the Lightning
-- settlement takes its anchors; then every add-on row the loop locks, ORDER BY
-- created_at, id as the commit door freezes them. The loop itself is not
-- touched: it still resolves in its own order, re-enters both locks at once,
-- and resolve_pending_addon still runs with the caller's lock_timeout. What
-- each add-on applies, refunds and records is exactly what it was.
--
-- THE SAME FUNCTION AGAINST ITSELF. Two envelopes of one table never overlap:
-- each holds the table's 'hand-post-commit:' mutex (tried, 250 ms) before any
-- row. Envelopes of different tables lock disjoint add-on and seat rows (both
-- are scoped to the hand's own table), and their player rows are taken under
-- the 'player-stats:' keys fn_project_hand_side_effects tries in uuid order
-- first. No self-deadlock appears in the Postgres log for 2026-11-17 through
-- 2026-11-23; nothing here changes those paths.
--
-- Nothing here moves or prices money, changes a stat, seats anyone or reads
-- is_horse. resolve_pending_addon and every other function are unchanged.
--
-- Proof: scripts/dev/prove-a-hands-add-ons-take-their-seats-before-their-rows.py
-- Law: tests/a-hands-add-ons-take-their-seats-before-their-rows.law.test.ts
-- Changelog: docs/changelog/2026-11-22-a-hands-add-ons-take-their-seats-before-their-rows.md
--
-- HOW. One anchored edit of the live definition: the needle must occur exactly
-- once or the whole file aborts and nothing changes.
-- @live-proof: (SELECT position('A HAND''S ADD-ONS TAKE THEIR SEATS BEFORE THEIR ROWS' IN pg_get_functiondef('public.fn_ca_process_hand_post_commit_obligations(uuid)'::regprocedure)) > 0 AND position('FOR UPDATE OF s' IN pg_get_functiondef('public.fn_ca_process_hand_post_commit_obligations(uuid)'::regprocedure)) BETWEEN 1 AND position('ORDER BY a.created_at, a.id' IN pg_get_functiondef('public.fn_ca_process_hand_post_commit_obligations(uuid)'::regprocedure)) AND position('ORDER BY a.created_at, a.id' IN pg_get_functiondef('public.fn_ca_process_hand_post_commit_obligations(uuid)'::regprocedure)) < position('FROM public.resolve_pending_addon(' IN pg_get_functiondef('public.fn_ca_process_hand_post_commit_obligations(uuid)'::regprocedure)))

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $seats_first$
DECLARE
  v_def text := pg_get_functiondef('public.fn_ca_process_hand_post_commit_obligations(uuid)'::regprocedure);
  v_edit record;
BEGIN
  IF position('TAKE THEIR SEATS BEFORE THEIR ROWS' IN v_def) > 0
     OR position('FOR UPDATE OF s' IN v_def) > 0 THEN
    RAISE EXCEPTION 'fn_ca_process_hand_post_commit_obligations already takes its seats first: re-read before editing';
  END IF;
  FOR v_edit IN SELECT * FROM (VALUES
    ('add-on loop',
$o$      RAISE EXCEPTION 'invalid pending-add-on obligation for hand %', p_hand_id;
    END IF;
    FOR v_item IN
      SELECT value
        FROM jsonb_array_elements(v_pending->'ids')
       ORDER BY value #>> '{}'
    LOOP
$o$,
$r$      RAISE EXCEPTION 'invalid pending-add-on obligation for hand %', p_hand_id;
    END IF;
    /* A HAND'S ADD-ONS TAKE THEIR SEATS BEFORE THEIR ROWS (20261123023325).
       Every other door that holds a seat and a pending add-on takes the seat
       first: the commit door (fn_ca_commit_hand_settlement) freezes the
       table's unresolved add-ons FOR UPDATE, by created_at then id, after its
       stack core holds the hand's seats, and a Lightning settlement after it
       has locked every anchor seat; an ended seat resolves its add-ons under
       its own row. The loop below took each add-on row first and its seat
       second (inside resolve_pending_addon), so a top-up delivered after one
       hand and the next hand committing on the same chair each held what the
       other wanted (six deadlocks at one Lightning host table on 2026-11-22).
       So, each with the same 1 s bound as every lock this function names:
       first every live seat resolve_pending_addon will lock (the player of an
       unresolved add-on, at its table), in seat id order, the order the
       Lightning settlement takes its anchors; then every add-on row the loop
       locks, in the commit door's own order. The loop resolves in its
       unchanged order and re-enters both locks at once, so what each add-on
       applies and refunds is unchanged. */
    PERFORM set_config('lock_timeout', '1s', true);
    PERFORM 1
      FROM public.table_pending_addons a
      JOIN public.table_seats s
        ON s.table_id = a.table_id
       AND s.user_id = a.user_id
       AND s.left_at IS NULL
     WHERE a.table_id = v_commit.table_id
       AND a.resolved_at IS NULL
       AND a.id = ANY (ARRAY(
             SELECT (x #>> '{}')::uuid
               FROM jsonb_array_elements(v_pending->'ids') x
              WHERE (x #>> '{}') ~*
                    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
     ORDER BY s.id
       FOR UPDATE OF s;
    PERFORM 1
      FROM public.table_pending_addons a
     WHERE a.table_id = v_commit.table_id
       AND a.id = ANY (ARRAY(
             SELECT (x #>> '{}')::uuid
               FROM jsonb_array_elements(v_pending->'ids') x
              WHERE (x #>> '{}') ~*
                    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
     ORDER BY a.created_at, a.id
       FOR UPDATE;
    PERFORM set_config('lock_timeout', v_caller_lock_timeout, true);
    FOR v_item IN
      SELECT value
        FROM jsonb_array_elements(v_pending->'ids')
       ORDER BY value #>> '{}'
    LOOP
$r$)
  ) AS e(label, old_text, new_text) LOOP
    IF (length(v_def) - length(replace(v_def, v_edit.old_text, ''))) / length(v_edit.old_text) <> 1 THEN
      RAISE EXCEPTION 'fn_ca_process_hand_post_commit_obligations anchor % was expected exactly once', v_edit.label;
    END IF;
    v_def := replace(v_def, v_edit.old_text, v_edit.new_text);
  END LOOP;
  EXECUTE v_def;
END
$seats_first$;

DO $verify_envelope$
DECLARE
  v_def text := pg_get_functiondef('public.fn_ca_process_hand_post_commit_obligations(uuid)'::regprocedure);
  v_seats integer := position('ORDER BY s.id' IN v_def);
  v_addons integer := position('ORDER BY a.created_at, a.id' IN v_def);
  v_loop integer := position('ORDER BY value #>> ''{}''' IN v_def);
  v_row integer := position('SELECT a.* INTO v_addon' IN v_def);
  v_resolve integer := position('FROM public.resolve_pending_addon(' IN v_def);
BEGIN
  IF v_seats = 0 OR v_addons = 0 OR v_loop = 0 OR v_row = 0 OR v_resolve = 0
     OR NOT (v_seats < v_addons AND v_addons < v_loop AND v_loop < v_row AND v_row < v_resolve)
     OR (length(v_def) - length(replace(v_def, 'FOR UPDATE OF s', ''))) / length('FOR UPDATE OF s') <> 1
     OR (length(v_def) - length(replace(v_def, 'ORDER BY a.created_at, a.id', ''))) / length('ORDER BY a.created_at, a.id') <> 1
     OR (length(v_def) - length(replace(v_def, 'set_config(''lock_timeout''', ''))) / length('set_config(''lock_timeout''') <> 8 THEN
    RAISE EXCEPTION 'the seat-first add-on locks did not install exactly in fn_ca_process_hand_post_commit_obligations';
  END IF;
END
$verify_envelope$;

-- @probe-for: public.fn_ca_process_hand_post_commit_obligations
DO $probe_envelope$
BEGIN
  PERFORM public.fn_ca_process_hand_post_commit_obligations(gen_random_uuid());
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_envelope$;

COMMIT;
