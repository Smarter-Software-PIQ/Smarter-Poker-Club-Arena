-- 20261123024433_a_cash_exit_locks_its_table_before_its_seat.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A CASH EXIT LOCKS ITS TABLE BEFORE ITS SEAT, AND NEVER WAITS FOR AN ADD-ON
-- ITS HAND OWNS
--
-- THE DEFECT, READ FROM THE POSTGRES LOG. In the 24 hours to 2026-11-23 01:20
-- UTC public.fn_cashout_seat_occupancy (the engine's cash-out of one seat)
-- deadlocked three times, each against a different path, and each time the
-- player's cash-out was the side Postgres cancelled:
--
--   07:30:23 against fn_ca_process_hand_post_commit_obligations. The cash-out
--     waited at "while locking tuple (1154,93) in relation table_pending_addons",
--     smarter_private.fn_record_ended_seat_occupancy() line 25, fired by the
--     seat exit (atomic_seat_cashout_locked line 119). The post-commit held that
--     add-on and waited for the leaving player's seat at resolve_pending_addon
--     line 29 (SELECT stack FROM table_seats ... FOR UPDATE).
--   21:04:38 against atomic_table_buyin. The cash-out waited for the table row
--     at atomic_seat_cashout_locked line 140 (UPDATE tables SET current_players),
--     held by the buy-in, which waited for the cash-out.
--   22:35:32 against fn_cash_capture_hand_manifest. Same cash-out line, the
--     table row held FOR SHARE by the manifest (its line 28), which waited for
--     the leaving player's chair the cash-out held FOR UPDATE.
--
-- THE CAUSES, BY LINE.
--
-- (1) The cash-out took its table row last. fn_cashout_seat_occupancy and
-- atomic_seat_cashout_locked lock the seat FOR UPDATE, credit the wallet
-- (atomic_credit_wallet_and_log, whose wallet_transactions row makes
-- trg_ca_reporting_wallet_insert upsert the table's shared club_table_daily
-- row), vacate the seat, and only then UPDATE tables at line 140 (a human's
-- vacate takes it a moment earlier, through zz_note_human_seat_seen). Two
-- paths hold that table row first and then want what the cash-out holds:
--   * the dealt manifest takes the table FOR SHARE, then reads each dealt
--     chair FOR SHARE, the leaving one included;
--   * a buy-in inserts its new chair, takes the table (a human buyer through
--     zz_note_human_seat_seen), and journals its debit into the same
--     club_table_daily row.
-- The table row is the parent of every chair and every reporting row at it.
-- Taken last, it closed both cycles.
--
-- (2) The seat exit trigger. When a player's last chair at a table ends,
-- fn_record_ended_seat_occupancy refunds their unresolved add-ons there. Its
-- loop locked every such add-on FOR UPDATE and only then skipped the ones an
-- open hand envelope owns (CONTINUE WHEN EXISTS ... hand_atomic_commits ...).
-- That hand's post-commit resolves those: it locks the add-on, then the
-- player's seat. The exit already holds the seat, so it waited on an add-on it
-- was always going to skip, held by a resolver waiting for its seat.
--
-- THE FIX.
--
-- (a) PARENT BEFORE CHILD. Both cash-out functions take a cash table's row FOR
--     NO KEY UPDATE (the mode their own current_players UPDATE takes) before
--     the seat, exactly as the same functions already take a tournament's
--     game row before the seat ("THE GAME BEFORE THE SEAT", 20260906) and a
--     diamond table's row before the seat. That is the order the manifest, a
--     table close (trg_tables_auto_cashout_on_close cashes out every chair
--     under its table UPDATE) and the admin closes already use, so a cash-out
--     now waits for any of them, holding nothing they want, instead of dying.
--     The UPDATE at the end is unchanged and re-enters a lock already held.
--     The accepted cash-hand settlement and the add-on resolver never lock the
--     table row, so they meet the cash-out only at the seat, as before.
-- (b) THE BUY-IN TAKES THE TABLE WITH ITS CHAIR. atomic_table_buyin_before_
--     maintenance_announcement_gate takes the table row right after it inserts
--     the new chair, before its wallet journal. A human buyer already held it
--     there (the insert's zz_note_human_seat_seen trigger); a horse buyer took
--     it only at the final current_players UPDATE, after the reporting rows,
--     which against (a) is the next deadlock (scripts/dev/prove-cash-locks-
--     take-one-order.sh reproduces it). Horses are players: every buyer now
--     takes its table in the same place, and the table before the reporting
--     rows, like the cash-out. Never before the insert: a buyer that waits
--     there for a leaving chair holds no table lock.
-- (c) AN ADD-ON ITS HAND OWNS IS NOT WAITED FOR. fn_record_ended_seat_occupancy
--     skips the add-ons an open hand envelope owns in the query that locks
--     the others. The check after the lock stays, for an envelope that commits
--     while it waits on another add-on. Every add-on it resolved before it
--     still resolves (an envelope's post-commit resolves every id it lists
--     before it completes), and every one it skipped is still skipped.
--
-- MONEY. Nothing is credited, debited, priced, refunded or skipped
-- differently. Every amount, every key and every write is the same; only the
-- moment a row lock is taken moves. Nothing reads is_horse.
--
-- Proof: scripts/dev/prove-cash-locks-take-one-order.sh
-- Law: tests/cash-locks-take-one-order.law.test.ts
-- Changelog: docs/changelog/2026-11-22-cash-locks-take-one-order.md
--
-- HOW. Anchored edits of the live definitions: each needle must occur exactly
-- once or the whole file aborts and nothing changes.
-- @probe-exempt: smarter_private.fn_record_ended_seat_occupancy is a trigger function and cannot be called directly; the plpgsql_check gate covers its body
-- @live-proof: (SELECT pg_get_functiondef('public.fn_cashout_seat_occupancy(uuid,uuid,integer,uuid,text)'::regprocedure) LIKE '%THE TABLE BEFORE THE SEAT (20261123024433)%PERFORM 1 FROM public.tables WHERE id=p_table_id FOR NO KEY UPDATE;%SELECT id,seat_number,occupancy_id INTO v_seat FROM public.table_seats%')
-- @live-proof: (SELECT pg_get_functiondef('public.atomic_seat_cashout_locked(uuid,uuid,integer,text)'::regprocedure) LIKE '%THE TABLE BEFORE THE SEAT (20261123024433)%PERFORM 1 FROM tables WHERE id = p_table_id FOR NO KEY UPDATE;%FROM table_seats%atomic_credit_wallet_and_log%')
-- @live-proof: (SELECT pg_get_functiondef('public.atomic_table_buyin_before_maintenance_announcement_gate(uuid,uuid,integer,numeric,boolean,uuid,uuid)'::regprocedure) LIKE '%INSERT INTO table_seats (table_id%THE TABLE WITH ITS CHAIR (20261123024433)%PERFORM 1 FROM tables WHERE id = p_table_id FOR NO KEY UPDATE;%INSERT INTO wallet_transactions%')
-- @live-proof: (SELECT pg_get_functiondef('smarter_private.fn_record_ended_seat_occupancy()'::regprocedure) LIKE '%AN ADD-ON ITS HAND OWNS IS NOT WAITED FOR (20261123024433)%ORDER BY a.created_at, a.id%FOR UPDATE%CONTINUE WHEN EXISTS%')

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- (a1) The engine's cash-out of one occupancy: the table before the seat.
DO $wrapper_table$
DECLARE
  v_def text := pg_get_functiondef('public.fn_cashout_seat_occupancy(uuid,uuid,integer,uuid,text)'::regprocedure);
  v_old text := $o$    PERFORM 1 FROM public.profiles WHERE id=p_user_id FOR UPDATE;
  END IF;
$o$;
  v_new text := $r$    PERFORM 1 FROM public.profiles WHERE id=p_user_id FOR UPDATE;
  ELSIF v_tournament IS NULL THEN
    /* THE TABLE BEFORE THE SEAT (20261123024433). A chip cash table's row
       is locked before the seat, in the mode the cash-out's current_players
       UPDATE takes. The manifest, a table close and the diamond exit above
       all take the table first; taking it after the seat deadlocked with
       the manifest (2026-11-22 22:35 UTC) and, through the shared reporting
       row, with a buy-in (21:04 UTC). Tournaments keep game, then seat. */
    PERFORM 1 FROM public.tables WHERE id=p_table_id FOR NO KEY UPDATE;
  END IF;
$r$;
BEGIN
  IF position('THE TABLE BEFORE THE SEAT' IN v_def) > 0 THEN
    RAISE EXCEPTION 'fn_cashout_seat_occupancy already locks its table first: re-read before editing';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'fn_cashout_seat_occupancy diamond lock anchor was expected exactly once';
  END IF;
  IF position(v_old IN v_def) > position('SELECT id,seat_number,occupancy_id INTO v_seat FROM public.table_seats' IN v_def) THEN
    RAISE EXCEPTION 'fn_cashout_seat_occupancy locks its seat before the diamond branch: re-read before editing';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$wrapper_table$;

DO $verify_wrapper$
DECLARE
  v_def text := pg_get_functiondef('public.fn_cashout_seat_occupancy(uuid,uuid,integer,uuid,text)'::regprocedure);
  v_table integer := position('PERFORM 1 FROM public.tables WHERE id=p_table_id FOR NO KEY UPDATE' IN v_def);
  v_seat integer := position('SELECT id,seat_number,occupancy_id INTO v_seat FROM public.table_seats' IN v_def);
BEGIN
  IF v_table = 0 OR v_seat = 0 OR v_table > v_seat THEN
    RAISE EXCEPTION 'the cash-out wrapper does not lock its table before its seat';
  END IF;
END
$verify_wrapper$;

-- @probe-for: public.fn_cashout_seat_occupancy
DO $probe_wrapper$
DECLARE
  v_r record;
  v_out jsonb;
BEGIN
  -- A cash-out the platform already made, asked again exactly: the edited
  -- body answers with its stored receipt and moves nothing.
  SELECT r.user_id, r.table_id, r.seat_number, r.occupancy_id, r.receipt INTO v_r
    FROM public.seat_cashout_receipts r
   WHERE r.user_id IS NOT NULL AND r.table_id IS NOT NULL AND r.seat_number IS NOT NULL
   ORDER BY r.occupancy_id LIMIT 1;
  IF FOUND THEN
    v_out := public.fn_cashout_seat_occupancy(v_r.user_id, v_r.table_id, v_r.seat_number, v_r.occupancy_id, NULL);
    IF v_out IS DISTINCT FROM v_r.receipt THEN
      RAISE EXCEPTION 'the cash-out wrapper probe expected its stored receipt back';
    END IF;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_wrapper$;

-- (a2) The canonical cash-out every exit runs: the table before the seat.
DO $cashout_table$
DECLARE
  v_def text := pg_get_functiondef('public.atomic_seat_cashout_locked(uuid,uuid,integer,text)'::regprocedure);
  v_old text := $o$    PERFORM 1 FROM tournaments WHERE id = v_tournament FOR NO KEY UPDATE;
  END IF;
$o$;
  v_new text := $r$    PERFORM 1 FROM tournaments WHERE id = v_tournament FOR NO KEY UPDATE;
  ELSE
    /* THE TABLE BEFORE THE SEAT (20261123024433). A cash table's row is
       locked here, parent before child, in the mode the current_players
       UPDATE below takes, before the seat, the credit and the session close.
       Taken last it deadlocked with the dealt manifest and a buy-in, which
       both hold the table and then want the seat or the table's reporting
       row this exit holds (2026-11-22 21:04 and 22:35 UTC). */
    PERFORM 1 FROM tables WHERE id = p_table_id FOR NO KEY UPDATE;
  END IF;
$r$;
BEGIN
  IF position('THE TABLE BEFORE THE SEAT' IN v_def) > 0 THEN
    RAISE EXCEPTION 'atomic_seat_cashout_locked already locks its table first: re-read before editing';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'atomic_seat_cashout_locked game lock anchor was expected exactly once';
  END IF;
  IF position(v_old IN v_def) > position('FROM table_seats' IN v_def) THEN
    RAISE EXCEPTION 'atomic_seat_cashout_locked reads its seat before the game lock: re-read before editing';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$cashout_table$;

DO $verify_cashout$
DECLARE
  v_def text := pg_get_functiondef('public.atomic_seat_cashout_locked(uuid,uuid,integer,text)'::regprocedure);
  v_game integer := position('FROM tournaments WHERE id = v_tournament FOR NO KEY UPDATE' IN v_def);
  v_table integer := position('PERFORM 1 FROM tables WHERE id = p_table_id FOR NO KEY UPDATE' IN v_def);
  v_seat integer := position('FROM table_seats' IN v_def);
  v_credit integer := position('PERFORM public.atomic_credit_wallet_and_log' IN v_def);
BEGIN
  IF v_game = 0 OR v_table = 0 OR v_seat = 0 OR v_credit = 0
     OR NOT (v_game < v_table AND v_table < v_seat AND v_seat < v_credit) THEN
    RAISE EXCEPTION 'the cash-out table lock did not install before the seat';
  END IF;
END
$verify_cashout$;

-- @probe-for: public.atomic_seat_cashout_locked
DO $probe_cashout$
DECLARE
  v_table uuid;
  v_out jsonb;
BEGIN
  -- A closed chip cash table and a player who holds no seat there: the call
  -- runs the edited body through the new table lock to its no_active_seat
  -- answer. Nothing plays at a closed table, so the lock waits for no one.
  SELECT t.id INTO v_table FROM public.tables t JOIN public.clubs c ON c.id = t.club_id
   WHERE t.tournament_id IS NULL AND c.asset = 'chips' AND t.status = 'closed'
   ORDER BY t.id LIMIT 1;
  IF v_table IS NOT NULL THEN
    v_out := public.atomic_seat_cashout_locked(gen_random_uuid(), v_table, NULL, NULL);
    IF v_out->>'reason' IS DISTINCT FROM 'no_active_seat' THEN
      RAISE EXCEPTION 'the cash-out probe expected no_active_seat for an unseated player';
    END IF;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_cashout$;

-- (b) The buy-in: the table with its new chair, before the money.
DO $buyin_table$
DECLARE
  v_def text := pg_get_functiondef('public.atomic_table_buyin_before_maintenance_announcement_gate(uuid,uuid,integer,numeric,boolean,uuid,uuid)'::regprocedure);
  v_old text := $o$  INSERT INTO table_seats (table_id, seat_number, user_id, stack, status, auto_rebuy, club_id)
       VALUES (p_table_id, p_seat_number, p_user_id, p_amount, 'active', p_auto_rebuy, v_seat_club);
$o$;
  v_new text := $r$  INSERT INTO table_seats (table_id, seat_number, user_id, stack, status, auto_rebuy, club_id)
       VALUES (p_table_id, p_seat_number, p_user_id, p_amount, 'active', p_auto_rebuy, v_seat_club);

  /* THE TABLE WITH ITS CHAIR (20261123024433). The new chair's table row is
     locked here, before the wallet journal below upserts the table's shared
     reporting rows. A human buyer already holds it at this point (the
     insert's zz_note_human_seat_seen trigger updates the table); a horse
     buyer took it only at the current_players UPDATE at the end, after those
     rows, while a cash-out takes the table before its money. Every buyer now
     takes it in the same place. Never before the insert: a buyer waiting
     there for a leaving chair's row holds no table lock. */
  PERFORM 1 FROM tables WHERE id = p_table_id FOR NO KEY UPDATE;
$r$;
BEGIN
  IF position('THE TABLE WITH ITS CHAIR' IN v_def) > 0 THEN
    RAISE EXCEPTION 'the buy-in already locks its table with its chair: re-read before editing';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'the buy-in seat insert anchor was expected exactly once';
  END IF;
  IF position(v_old IN v_def) > position('INSERT INTO wallet_transactions' IN v_def) THEN
    RAISE EXCEPTION 'the buy-in journals before it seats: re-read before editing';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$buyin_table$;

DO $verify_buyin$
DECLARE
  v_def text := pg_get_functiondef('public.atomic_table_buyin_before_maintenance_announcement_gate(uuid,uuid,integer,numeric,boolean,uuid,uuid)'::regprocedure);
  v_insert integer := position('INSERT INTO table_seats (table_id, seat_number' IN v_def);
  v_table integer := position('PERFORM 1 FROM tables WHERE id = p_table_id FOR NO KEY UPDATE' IN v_def);
  v_journal integer := position('INSERT INTO wallet_transactions' IN v_def);
BEGIN
  IF v_insert = 0 OR v_table = 0 OR v_journal = 0
     OR NOT (v_insert < v_table AND v_table < v_journal) THEN
    RAISE EXCEPTION 'the buy-in table lock did not install between the chair and the journal';
  END IF;
END
$verify_buyin$;

-- @probe-for: public.atomic_table_buyin_before_maintenance_announcement_gate
DO $probe_buyin$
DECLARE
  v_key uuid;
BEGIN
  -- An idempotency key the platform already holds: the edited body runs to
  -- its replay answer at its first statement and moves nothing.
  SELECT k.key INTO v_key FROM public.transaction_idempotency_keys k ORDER BY k.key LIMIT 1;
  IF v_key IS NOT NULL THEN
    PERFORM public.atomic_table_buyin_before_maintenance_announcement_gate(
      gen_random_uuid(), gen_random_uuid(), 1, 1, false, NULL, v_key);
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_buyin$;

-- (c) The seat exit: an add-on its hand owns is not waited for.
DO $exit_addons$
DECLARE
  v_def text := pg_get_functiondef('smarter_private.fn_record_ended_seat_occupancy()'::regprocedure);
  v_old text := $o$         AND a.resolved_at IS NULL
       ORDER BY a.created_at, a.id
       FOR UPDATE
    LOOP$o$;
  v_new text := $r$         AND a.resolved_at IS NULL
         -- AN ADD-ON ITS HAND OWNS IS NOT WAITED FOR (20261123024433). An
         -- add-on an open hand envelope lists is resolved by that hand's
         -- post-commit, which locks it and then this player's seat. This exit
         -- already holds the seat and skipped such an add-on after locking it
         -- (CONTINUE WHEN below), so it waited for a lock it never needed
         -- (deadlock 2026-11-22 07:30 UTC). They are skipped before the lock
         -- now; the check below stays for an envelope committed meanwhile.
         AND NOT EXISTS (
           SELECT 1
             FROM public.hand_atomic_commits oc
            WHERE oc.table_id = OLD.table_id
              AND oc.post_commit_payload IS NOT NULL
              AND oc.post_commit_completed_at IS NULL
              AND jsonb_typeof(oc.post_commit_payload #> '{pending_addons,ids}') = 'array'
              AND (oc.post_commit_payload #> '{pending_addons,ids}') ? a.id::text
         )
       ORDER BY a.created_at, a.id
       FOR UPDATE
    LOOP$r$;
BEGIN
  IF position('AN ADD-ON ITS HAND OWNS IS NOT WAITED FOR' IN v_def) > 0 THEN
    RAISE EXCEPTION 'fn_record_ended_seat_occupancy already skips owned add-ons: re-read before editing';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'fn_record_ended_seat_occupancy add-on lock anchor was expected exactly once';
  END IF;
  IF position('CONTINUE WHEN EXISTS' IN v_def) < position(v_old IN v_def) THEN
    RAISE EXCEPTION 'fn_record_ended_seat_occupancy has no post-lock ownership check: re-read before editing';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$exit_addons$;

DO $verify_exit$
DECLARE
  v_def text := pg_get_functiondef('smarter_private.fn_record_ended_seat_occupancy()'::regprocedure);
  v_skip integer := position('AN ADD-ON ITS HAND OWNS IS NOT WAITED FOR' IN v_def);
  v_lock integer := position('ORDER BY a.created_at, a.id' IN v_def);
  v_recheck integer := position('CONTINUE WHEN EXISTS' IN v_def);
BEGIN
  IF v_skip = 0 OR v_lock = 0 OR v_recheck = 0 OR NOT (v_skip < v_lock AND v_lock < v_recheck) THEN
    RAISE EXCEPTION 'the owned add-on skip did not install before the seat exit lock';
  END IF;
END
$verify_exit$;

COMMIT;
