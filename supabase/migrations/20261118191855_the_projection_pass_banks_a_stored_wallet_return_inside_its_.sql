-- 20261118191855_the_projection_pass_banks_a_stored_wallet_return_inside_its_.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- THE PROJECTION PASS BANKS A STORED WALLET RETURN INSIDE ITS LOCK DEADLINE
-- (incident 075013fd, lane H1; after 20261118161644 and #11300's 20261118155509)
--
-- 20261118161644 stores a deleted-account or horse-split return that a hand
-- could not make because its club bank was busy (hand_wallet_return_pending,
-- per table). This wires the banker into the table's own continuation,
-- fn_project_hand_side_effects, on top of #11300's postimage (94588bd7...):
-- right after the up-front try-locks (the 250 ms table mutex and the players'
-- 'player-stats:' keys) and inside the same 1 s deadline. The banker takes
-- every lock NOWAIT, or bounded by what is left of that deadline, and stops
-- when it runs out; nothing here is a blocking lock call. A pass that finds a
-- stored return for its table ends there (predecessor_pending, detail
-- wallet_returns), banked or not, so the outbox row of the hand that stored
-- it stays until the return is banked, and the next pass for the table
-- retries. Nothing scheduled (CLAUDE.md 10.12); fn_ca_post_commit_lag_watch
-- pages a stored return older than 15 s.
--
-- Its own migration because the 20261118155509 law refuses a later file that
-- names the projection and carries any queueing lock.
-- PRE-FLIGHT: the projection must be #11300's postimage, and 20261118161644
-- installed. Stale pins: no function pins 94588bd7... (#11300 declares none).
-- Native proofs: scripts/ci/test-hand-path-cash-lane.py (never strands) and
-- #11300's overlapping-players case run on this combined body.
--
-- @live-proof: (strpos(pg_get_functiondef('public.fn_project_hand_side_effects(uuid)'::regprocedure), 'public.fn_ca_bank_pending_wallet_returns(v_table_id, v_lock_started') > 0)

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $h1_pre$
BEGIN
 IF md5(pg_get_functiondef(to_regprocedure('public.fn_project_hand_side_effects(uuid)'))) IS DISTINCT FROM '94588bd7bc75f60b9b575eb396549d5c' THEN
  RAISE EXCEPTION 'h1_source_moved: % is not the text this file was written against', 'public.fn_project_hand_side_effects(uuid)' USING ERRCODE='55000';
 END IF;
END $h1_pre$;
DO $h1_needs$
BEGIN
 IF to_regclass('public.hand_wallet_return_pending') IS NULL
    OR to_regprocedure('public.fn_ca_bank_pending_wallet_returns(uuid,timestamptz)') IS NULL THEN
  RAISE EXCEPTION 'h1_needs_20261118161644' USING ERRCODE='55000';
 END IF;
END $h1_needs$;

CREATE OR REPLACE FUNCTION public.fn_project_hand_side_effects(p_hand_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_table_id uuid;
  v_hand_number bigint;
  v_history_table_id uuid;
  v_history_hand_number bigint;
  v_commit_table_id uuid;
  v_commit_hand_number bigint;
  v_post_commit jsonb;
  v_seat_uid uuid;
  v_hand_bank jsonb;
  v_contract integer := 1;
  v_lock_key bigint;
  v_lock_started timestamptz;
  v_lock_waited numeric;
BEGIN
  IF NOT (current_user IN ('postgres','service_role')) THEN
    RAISE EXCEPTION 'fn_project_hand_side_effects is engine/service only';
  END IF;

  /* THE ANSWER CONTRACT (20261118073646, applied here by 20261118155509).
     Contract 1 is every caller that predates it: it defers
     predecessor_pending and fails anything else it does not know. Contract 2
     (the PostgREST header x-ca-post-commit-contract: 2, sent by the engine
     on this RPC) also knows table_busy and obligation_lock_busy. A
     contract-1 caller gets predecessor_pending in their place, with the real
     reason in queued_reason. */
  IF pg_input_is_valid(COALESCE(current_setting('request.headers', true), ''), 'json')
     AND (current_setting('request.headers', true)::json
            ->> 'x-ca-post-commit-contract') ~ '^[0-9]{1,3}$' THEN
    v_contract := (current_setting('request.headers', true)::json
                     ->> 'x-ca-post-commit-contract')::integer;
  END IF;

  /* LOCK ORDER 1: read the exact durable scope without claiming the outbox.
     Another worker may finish it after this read; the implementation claim
     below remains the sole authority to apply projections. */
  SELECT o.table_id, o.hand_number
    INTO v_table_id, v_hand_number
    FROM public.hand_projection_outbox o
   WHERE o.hand_id = p_hand_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'not_pending',
      'hand_id', p_hand_id
    );
  END IF;

  SELECT h.table_id, h.hand_number
    INTO v_history_table_id, v_history_hand_number
    FROM public.hand_history h
   WHERE h.id = p_hand_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pending hand projection has no hand history row: %', p_hand_id;
  END IF;

  SELECT c.table_id, c.hand_number
    INTO v_commit_table_id, v_commit_hand_number
    FROM public.hand_atomic_commits c
   WHERE c.hand_id = p_hand_id;
  IF NOT FOUND
     OR v_history_table_id IS DISTINCT FROM v_table_id
     OR v_history_hand_number IS DISTINCT FROM v_hand_number
     OR v_commit_table_id IS DISTINCT FROM v_table_id
     OR v_commit_hand_number IS DISTINCT FROM v_hand_number THEN
    RAISE EXCEPTION
      'pending hand projection scope disagrees with immutable hand receipt: %',
      p_hand_id;
  END IF;

  /* THE HAND'S BBJ DROP AND INSURANCE LEGS ARE BANKED BY ITS OWN
     CONTINUATION (20261118071728), in the same pass as its rake and before any
     table or player lock. The banker never waits for the union's BBJ pool or
     insurance bank; a busy one leaves the obligation stored. */
  IF EXISTS (SELECT 1 FROM public.hand_bank_obligation_pending bp WHERE bp.hand_id = p_hand_id) THEN
    v_hand_bank := public.fn_ca_bank_pending_hand_obligations(p_hand_id);
  END IF;

  /* THE HAND'S RAKE IS BANKED BY ITS OWN CONTINUATION (20261118). A cash
     hand's completed envelope stores its rake in cash_rake_pending instead of
     crediting the shared union wallet row, so a dealing table never waits on
     whoever holds that row. This pass banks it before any table or player
     lock is taken and never waits for the wallet. It ends here either way:
     the outbox row is the durable continuation, and the worker already
     defers predecessor_pending without claiming success. Statistics run on
     the next pass, so they never run while this transaction holds the wallet. */
  IF EXISTS (SELECT 1 FROM public.cash_rake_pending rp WHERE rp.hand_id = p_hand_id) THEN
    v_post_commit := public.fn_ca_bank_pending_cash_rake(p_hand_id);
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'predecessor_pending',
      'detail', CASE WHEN v_post_commit->>'status' = 'banked'
                     THEN 'cash_rake_banked_in_this_transaction'
                     ELSE 'cash_rake_pending' END,
      'cash_rake', v_post_commit,
      'hand_bank', v_hand_bank,
      'projection_applied', false,
      'hand_id', p_hand_id
    );
  END IF;

  /* A pass that banked (or tried to bank) a drop or an insurance leg ends
     here, like the rake pass above: statistics never run while this
     transaction holds the pool or the bank (20261118071728). */
  IF v_hand_bank IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'predecessor_pending',
      'detail', CASE WHEN v_hand_bank->>'status' IN ('banked', 'absent')
                     THEN 'hand_bank_obligations_banked_in_this_transaction'
                     ELSE 'hand_bank_obligations_pending' END,
      'hand_bank', v_hand_bank,
      'projection_applied', false,
      'hand_id', p_hand_id
    );
  END IF;

  /* LOCK ORDER 1b (20261019): this tournament's shared lane, waiting, before
     any lock, so the post-commit and projection writes below are never
     refused by a tournament authority mid-transaction. */
  PERFORM smarter_private.f06_wait_table_lane(v_table_id);

  /* LOCK ORDER 2: every path that can consume the frozen post-commit envelope
     owns this per-table advisory lock before reaching any player/stat row. */
  /* THE PROJECTION WORKER NEVER QUEUES ON THE TABLE LOCK (20261118155509,
     incident 075013fd). The mutex is tried for at most 250 ms; a table whose
     envelope or projection is running answers table_busy (retryable) with
     nothing written, instead of holding a connection for up to the 8 s
     lock_timeout the PostgREST worker inherits from authenticator (a SQL
     caller under the global lock_timeout 0 waited until its statement
     timeout). Re-entered at once when this transaction already holds it.
     The f06 tournament lane above keeps its own 4 s wait (separate, out of
     scope here). */
  v_lock_key := hashtextextended('hand-post-commit:' || v_table_id::text, 0);
  v_lock_started := clock_timestamp();
  WHILE NOT pg_try_advisory_xact_lock(v_lock_key) LOOP
    IF clock_timestamp() - v_lock_started >= interval '250 milliseconds' THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', CASE WHEN v_contract >= 2 THEN 'table_busy' ELSE 'predecessor_pending' END,
        'queued_reason', 'table_busy',
        'retryable', true,
        'projection_applied', false,
        'hand_id', p_hand_id,
        'table_id', v_table_id,
        'hand_number', v_hand_number,
        'waited_ms', round(extract(epoch FROM clock_timestamp() - v_lock_started) * 1000)
      );
    END IF;
    PERFORM pg_sleep(0.025);
  END LOOP;

  /* The seated players' locks below (LOCK ORDER 2b, still in uuid order) are
     tried too, all within one 1 s deadline from here (the envelope's own row
     bound), and so are LOCK ORDER 4 and the players' 'player-stats-user:'
     keys (4b). A held one answers obligation_lock_busy with nothing written;
     this transaction's locks end with it and the worker comes back for the
     hand. */
  v_lock_started := clock_timestamp();

  /* LOCK ORDER 3: consume the exact stored envelope, or leave the outbox row
     untouched. predecessor_pending is returned unchanged so the event-driven
     worker preserves causal order. Any thrown validation/hash error aborts the
     transaction and is intentionally not converted into success. */
  /* LOCK ORDER 2b (20261015094418): one player order for the whole
     transaction. The rake, promo and projection passes below each touch a
     player's player_stats row, each in its own order; two hands sharing
     players deadlocked between passes. Every seated player is claimed here,
     in uuid order, before any pass runs. */
  FOR v_seat_uid IN
    SELECT DISTINCT (pl->>'userId')::uuid
      FROM public.hand_history h,
           jsonb_array_elements(CASE WHEN jsonb_typeof(h.players) = 'array'
                                     THEN h.players ELSE '[]'::jsonb END) pl
     WHERE h.id = p_hand_id
       AND (pl->>'userId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     ORDER BY 1
  LOOP
    WHILE NOT pg_try_advisory_xact_lock(hashtextextended('player-stats:' || v_seat_uid::text, 0)) LOOP
      v_lock_waited := extract(epoch FROM clock_timestamp() - v_lock_started);
      IF v_lock_waited >= 1 THEN
        RETURN jsonb_build_object(
          'ok', false,
          'reason', CASE WHEN v_contract >= 2 THEN 'obligation_lock_busy' ELSE 'predecessor_pending' END,
          'queued_reason', 'obligation_lock_busy',
          'retryable', true,
          'projection_applied', false,
          'detail', 'player_stats_lock_busy',
          'hand_id', p_hand_id,
          'table_id', v_table_id,
          'hand_number', v_hand_number,
          'waited_ms', round(v_lock_waited * 1000)
        );
      END IF;
      PERFORM pg_sleep(0.025);
    END LOOP;
  END LOOP;

  /* A DEFERRED WALLET RETURN IS BANKED BY THE TABLE'S OWN CONTINUATION
     (20261118161644). A hand that credited a deleted or split-departed
     record while its club bank was busy stored the return in
     hand_wallet_return_pending for this table. This pass banks it here,
     after the table mutex and the players' keys above (20261118155509) and
     inside the same 1 s deadline: every lock the banker takes is tried,
     NOWAIT or bounded by what is left of that deadline, never waited on. The
     pass ends here either way, so the outbox row that carries the hand stays
     until the return is banked, and the next pass for this table retries. */
  IF EXISTS (SELECT 1 FROM public.hand_wallet_return_pending wr WHERE wr.table_id = v_table_id) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'predecessor_pending',
      'detail', 'wallet_returns',
      'wallet_returns', public.fn_ca_bank_pending_wallet_returns(v_table_id, v_lock_started + interval '1 second'),
      'projection_applied', false,
      'hand_id', p_hand_id
    );
  END IF;

  v_post_commit :=
    public.fn_ca_process_hand_post_commit_obligations(p_hand_id);
  IF COALESCE((v_post_commit->>'ok')::boolean, false) IS NOT TRUE
     AND COALESCE(v_post_commit->>'reason', '') <> 'legacy_no_obligations' THEN
    RETURN COALESCE(v_post_commit, '{}'::jsonb) || jsonb_build_object(
      'projection_applied', false,
      'hand_id', p_hand_id
    );
  END IF;

  /* A newly completed envelope still holds the union wallet row until this
     transaction commits. End this pass before taking projection locks or
     writing dashboard facts. The outbox row is the durable continuation.
     The existing worker already defers predecessor_pending without claiming
     success: here its predecessor is the just-completed financial phase. */
  IF (v_post_commit->>'ok')::boolean IS TRUE
     AND (v_post_commit->>'already_completed')::boolean IS FALSE THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'predecessor_pending',
      'detail', 'post_commit_completed_in_this_transaction',
      'projection_applied', false,
      'hand_id', p_hand_id
    );
  END IF;

  /* LOCK ORDER 4: projection serialisation comes after post-commit. The
     preserved implementation next claims this exact outbox row FOR UPDATE,
     checks projection predecessors, applies the unchanged projections, and
     deletes through a0_finish_hand_post_commit_obligations. The trigger's
     second processor call is an idempotent completed/legacy assertion while
     this transaction still owns both advisory locks. */
  /* LOCK ORDER 4, TRIED (20261118155509). Only a holder of this table's
     mutex takes 'hand-projection:<table>' (this function and the
     after-function it calls), so it is free here; it is tried all the same,
     within the same 1 s deadline, so that this function makes no blocking
     lock call at all. */
  v_lock_key := hashtextextended('hand-projection:' || v_table_id::text, 0);
  WHILE NOT pg_try_advisory_xact_lock(v_lock_key) LOOP
    v_lock_waited := extract(epoch FROM clock_timestamp() - v_lock_started);
    IF v_lock_waited >= 1 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', CASE WHEN v_contract >= 2 THEN 'table_busy' ELSE 'predecessor_pending' END,
        'queued_reason', 'table_busy',
        'retryable', true,
        'projection_applied', false,
        'detail', 'hand_projection_lock_busy',
        'hand_id', p_hand_id,
        'table_id', v_table_id,
        'hand_number', v_hand_number,
        'waited_ms', round(v_lock_waited * 1000)
      );
    END IF;
    PERFORM pg_sleep(0.025);
  END LOOP;

  /* LOCK ORDER 4b, TRIED (20261118155509): every 'player-stats-user:<uuid>'
     key the after-function will take, in uuid order, within the same 1 s
     deadline, BEFORE it runs. The after-function takes these keys with a
     blocking pg_advisory_xact_lock (Projection 2, cash chip hands only) after
     it has already claimed the outbox row and written the club member
     projections; the cash commission batch, the cash source retry and the
     Midway promo take the same keys. Held here first, the after-function's
     own calls re-enter at once and never queue. The set is the
     after-function's (the hand's seated uuids, cash hand at a non-Diamond
     club) or wider, never narrower. A held key answers obligation_lock_busy
     with nothing written: the envelope is already complete or legacy here
     (a pass that completes it returned above), so this transaction has
     written nothing. Never waited on, never out of order: two hands with
     overlapping players cannot deadlock or convoy on these keys. */
  IF EXISTS (SELECT 1
               FROM public.hand_history h
               JOIN public.tables t ON t.id = h.table_id
               JOIN public.clubs c ON c.id = t.club_id
              WHERE h.id = p_hand_id
                AND h.tournament_id IS NULL
                AND NOT COALESCE(c.asset = 'diamonds', false)) THEN
    FOR v_seat_uid IN
      SELECT DISTINCT (pl->>'userId')::uuid
        FROM public.hand_history h,
             jsonb_array_elements(CASE WHEN jsonb_typeof(h.players) = 'array'
                                       THEN h.players ELSE '[]'::jsonb END) pl
       WHERE h.id = p_hand_id
         AND (pl->>'userId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       ORDER BY 1
    LOOP
      WHILE NOT pg_try_advisory_xact_lock(hashtextextended('player-stats-user:' || v_seat_uid::text, 0)) LOOP
        v_lock_waited := extract(epoch FROM clock_timestamp() - v_lock_started);
        IF v_lock_waited >= 1 THEN
          RETURN jsonb_build_object(
            'ok', false,
            'reason', CASE WHEN v_contract >= 2 THEN 'obligation_lock_busy' ELSE 'predecessor_pending' END,
            'queued_reason', 'obligation_lock_busy',
            'retryable', true,
            'projection_applied', false,
            'detail', 'player_stats_user_lock_busy',
            'hand_id', p_hand_id,
            'table_id', v_table_id,
            'hand_number', v_hand_number,
            'waited_ms', round(v_lock_waited * 1000)
          );
        END IF;
        PERFORM pg_sleep(0.025);
      END LOOP;
    END LOOP;
  END IF;

  RETURN public.fn_project_hand_side_effects_after_post_commit_20260908(
    p_hand_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_project_hand_side_effects(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_project_hand_side_effects(uuid) TO service_role;

COMMIT;
