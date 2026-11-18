-- A refused hand obligation never holds its table, and a refusal that cannot
-- change on retry is named once, at its source, instead of retried forever.
--
-- INCIDENT d2d79c4f (2026-11-18): hand 59989058's stored rake refused
-- 23514 cash_earning_seat_provenance_missing_or_ambiguous on every attempt
-- (7,000+ by 19:04 UTC, about one a second). Two defects made one bad hand
-- into a stopped table:
--
--   1. ONE HAND HELD ITS WHOLE TABLE. a0_finish_hand_post_commit_obligations
--      refuses to let a hand's outbox row leave while its rake, BBJ drop or
--      insurance leg is stored, and fn_project_hand_side_effects ends every
--      pass while one is stored. The engine walks a table's outbox in hand
--      order and stops at the first row the database keeps, so the table's
--      later hands never even reached their own banking: 22 later rakes sat at
--      zero attempts behind the one that could never bank.
--   2. EVERY REFUSAL WAS TREATED AS A RETRY. A refusal no retry can change
--      (a check, a data or a privilege refusal, a named refusal) was retried
--      as if a lock were busy, and paged only through the ten-minute stranded
--      watchdog.
--
-- THE LAW HERE:
--   * The two bankers classify. A transient refusal (serialization or
--     deadlock class 40, lock_not_available 55P03, object_in_use 55006,
--     resources 53, operator 57, connection 08) stays retryable, exactly as
--     before. Every other refusal is DETERMINISTIC: the obligation is marked
--     terminal under the current money-law epoch and one critical
--     financial_alerts row names it at the source, at once. While the law is
--     unchanged the banker answers 'terminal' without running again.
--   * A terminal obligation stays stored in its own row (held on the felt by
--     the tally, never lost), but it no longer holds its hand: the projection
--     pass and the outbox finish accept 'terminal', so the hand's statistics
--     project and the table's later hands bank and project in order.
--   * A REFUSAL IS ASKED AGAIN WHEN THE LAW CHANGES, deterministically and
--     without a timer. Every CREATE or ALTER FUNCTION/PROCEDURE commits one
--     row in smarter_private.money_law_changes (only while a terminal
--     obligation exists); the epoch is the newest committed row, so a fix
--     still being installed is never seen early. The banker reads the epoch
--     BEFORE it runs, so an attempt made under the old code can never be
--     stamped with the new epoch. The next pass on the obligation's table asks
--     every terminal obligation stamped under an older epoch again, with the
--     same call, before any lock, never waiting on a shared row. Why the epoch
--     and not a timer: the only thing that can change a deterministic answer
--     is a change of code, so a change of code is the only re-ask. Why any
--     function and not a named list: the refusal can come from anywhere in
--     the call graph (atomic_distribute_rake, fn_cash_earning_club, the BBJ
--     and insurance writers and their readers); a list would silently miss
--     the function that fixes it.
--   * fn_post_commit_stranded_watchdog no longer counts an obligation already
--     named terminal under the current law (it is paged at its source); an
--     obligation whose law has changed and still waits is counted as before.
--     Its guard now silences only its own finding (the oldest unfinished
--     envelope and stored obligation), per tests/an-open-alert-silences-only-
--     its-own-finding.law.test.ts: one stale open alert used to silence every
--     later stranding.
--
-- No watcher, sweeper or repair job is added: the re-ask runs inside the
-- table's own continuation, and the epoch only moves when code is installed.

BEGIN;

SET LOCAL lock_timeout = '4s';

-- THE PREIMAGE PIN. Every body below was generated from the live definition
-- with these md5s. If any has changed since, another change landed first: this
-- migration refuses to install rather than silently revert it. Regenerate.
DO $preimage$
BEGIN
  IF md5(pg_get_functiondef('public.fn_project_hand_side_effects'::regproc)) IS DISTINCT FROM '94588bd7bc75f60b9b575eb396549d5c' THEN
    RAISE EXCEPTION 'preimage of public.fn_project_hand_side_effects changed since this migration was generated' USING ERRCODE = '55000';
  END IF;
  IF md5(pg_get_functiondef('public.trg_finish_hand_post_commit_obligations'::regproc)) IS DISTINCT FROM '2d9d0d7cab537e608da36be3319e347e' THEN
    RAISE EXCEPTION 'preimage of public.trg_finish_hand_post_commit_obligations changed since this migration was generated' USING ERRCODE = '55000';
  END IF;
  IF md5(pg_get_functiondef('public.fn_post_commit_stranded_watchdog'::regproc)) IS DISTINCT FROM 'a16ceda2073f0dbb3cd28feb841106e9' THEN
    RAISE EXCEPTION 'preimage of public.fn_post_commit_stranded_watchdog changed since this migration was generated' USING ERRCODE = '55000';
  END IF;
END $preimage$;


CREATE TABLE IF NOT EXISTS smarter_private.money_law_changes (
  id             bigserial   PRIMARY KEY,
  changed_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  command_tag    text,
  object_identity text
);
REVOKE ALL ON smarter_private.money_law_changes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE smarter_private.money_law_changes_id_seq FROM PUBLIC, anon, authenticated;
INSERT INTO smarter_private.money_law_changes (command_tag, object_identity)
VALUES ('MIGRATION', 'a_refused_hand_obligation_never_holds_its_table');

CREATE OR REPLACE FUNCTION smarter_private.money_law_epoch()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT COALESCE(max(id), 0) FROM smarter_private.money_law_changes
$function$;
REVOKE ALL ON FUNCTION smarter_private.money_law_epoch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION smarter_private.money_law_epoch() TO service_role;

CREATE OR REPLACE FUNCTION smarter_private.bank_refusal_is_transient(p_sqlstate text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT p_sqlstate IS NULL
      OR left(p_sqlstate, 2) IN ('40', '53', '57', '08')
      OR p_sqlstate IN ('55P03', '55006')
$function$;
REVOKE ALL ON FUNCTION smarter_private.bank_refusal_is_transient(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION smarter_private.bank_refusal_is_transient(text) TO service_role;

ALTER TABLE public.cash_rake_pending
  ADD COLUMN IF NOT EXISTS terminal_epoch bigint,
  ADD COLUMN IF NOT EXISTS terminal_at timestamptz;
ALTER TABLE public.hand_bank_obligation_pending
  ADD COLUMN IF NOT EXISTS terminal_epoch bigint,
  ADD COLUMN IF NOT EXISTS terminal_at timestamptz;
CREATE INDEX IF NOT EXISTS cash_rake_pending_terminal_idx
  ON public.cash_rake_pending (table_id, hand_number) WHERE terminal_epoch IS NOT NULL;
CREATE INDEX IF NOT EXISTS hand_bank_obligation_pending_terminal_idx
  ON public.hand_bank_obligation_pending (table_id, hand_number) WHERE terminal_epoch IS NOT NULL;

CREATE OR REPLACE FUNCTION smarter_private.fn_money_law_changed()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  -- Only a held refusal needs the law to move; with none, nothing is written.
  IF EXISTS (SELECT 1 FROM public.cash_rake_pending WHERE terminal_epoch IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.hand_bank_obligation_pending WHERE terminal_epoch IS NOT NULL) THEN
    INSERT INTO smarter_private.money_law_changes (command_tag, object_identity)
    SELECT c.command_tag, c.object_identity
      FROM pg_event_trigger_ddl_commands() c
     WHERE c.object_type IN ('function', 'procedure')
     LIMIT 1;
  END IF;
END $function$;
REVOKE ALL ON FUNCTION smarter_private.fn_money_law_changed() FROM PUBLIC, anon, authenticated;

DROP EVENT TRIGGER IF EXISTS ca_money_law_change_reasks_refusals;
CREATE EVENT TRIGGER ca_money_law_change_reasks_refusals ON ddl_command_end
  WHEN TAG IN ('CREATE FUNCTION', 'ALTER FUNCTION', 'CREATE PROCEDURE', 'ALTER PROCEDURE')
  EXECUTE FUNCTION smarter_private.fn_money_law_changed();

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
  v_reask jsonb;
  v_reask_hand uuid;
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

  /* A REFUSAL IS ASKED AGAIN AFTER THE LAW CHANGES (20261118192000). An earlier
     hand of this table whose stored obligation was refused deterministically
     no longer holds the table: its outbox row left with the obligation still
     stored. Once code has been installed since that refusal, this table's
     next pass asks it again with the same call, before any table or player
     lock, never waiting on a shared row. Its own hand's pass keeps asking too. */
  FOR v_reask_hand IN
    SELECT x.hand_id FROM (
      SELECT rp.hand_id, rp.hand_number FROM public.cash_rake_pending rp
       WHERE rp.table_id = v_table_id AND rp.hand_id <> p_hand_id
         AND rp.terminal_epoch IS NOT NULL
         AND rp.terminal_epoch < smarter_private.money_law_epoch()
      UNION
      SELECT bp.hand_id, bp.hand_number FROM public.hand_bank_obligation_pending bp
       WHERE bp.table_id = v_table_id AND bp.hand_id <> p_hand_id
         AND bp.terminal_epoch IS NOT NULL
         AND bp.terminal_epoch < smarter_private.money_law_epoch()) x
     ORDER BY x.hand_number
     LIMIT 4
  LOOP
    v_reask := COALESCE(v_reask, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'hand_id', v_reask_hand,
      'cash_rake', CASE WHEN EXISTS (SELECT 1 FROM public.cash_rake_pending r WHERE r.hand_id = v_reask_hand)
                        THEN public.fn_ca_bank_pending_cash_rake(v_reask_hand) END,
      'hand_bank', CASE WHEN EXISTS (SELECT 1 FROM public.hand_bank_obligation_pending b WHERE b.hand_id = v_reask_hand)
                        THEN public.fn_ca_bank_pending_hand_obligations(v_reask_hand) END));
  END LOOP;
  /* Anything banked holds its wallet or pool until COMMIT: end the pass here,
     as the hand's own banking does. A re-ask that refused again holds nothing. */
  IF v_reask IS NOT NULL AND jsonb_path_exists(v_reask, '$.** ? (@.status == "banked")') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'predecessor_pending',
      'detail', 'refused_obligation_banked_after_law_change',
      'reask', v_reask,
      'projection_applied', false,
      'hand_id', p_hand_id
    );
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
    /* A rake refused by a rule no retry can change (20261118192000) holds
       nothing and no longer holds this hand: it stays stored, named at its
       source, and the hand projects so its table's later hands proceed. */
    IF v_post_commit->>'status' IS DISTINCT FROM 'terminal' THEN
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
  END IF;

  /* A pass that banked (or tried to bank) a drop or an insurance leg ends
     here, like the rake pass above: statistics never run while this
     transaction holds the pool or the bank (20261118071728). */
  IF v_hand_bank IS NOT NULL
     AND (v_hand_bank->>'status' IS DISTINCT FROM 'terminal'
          OR jsonb_path_exists(v_hand_bank, '$.items[*] ? (@.status == "banked")')) THEN
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

CREATE OR REPLACE FUNCTION public.trg_finish_hand_post_commit_obligations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.fn_ca_process_hand_post_commit_obligations(OLD.hand_id);
  IF COALESCE((v_result->>'ok')::boolean, false) IS NOT TRUE
     AND v_result->>'reason' <> 'legacy_no_obligations' THEN
    RAISE EXCEPTION 'hand post-commit obligations remain pending for %: %',
      OLD.hand_id, v_result;
  END IF;
  /* 20261118: the outbox row is the continuation that banks a cash hand's
     stored rake. It may not leave while that rake is still pending. */
  IF EXISTS (SELECT 1 FROM public.cash_rake_pending rp WHERE rp.hand_id = OLD.hand_id) THEN
    v_result := public.fn_ca_bank_pending_cash_rake(OLD.hand_id);
    /* 20261118192000: a rake refused by a rule no retry can change stays
       stored and named; it does not hold the hand's outbox row. */
    IF COALESCE(v_result->>'status', '') NOT IN ('banked', 'terminal') THEN
      RAISE EXCEPTION 'hand rake remains pending for %: %', OLD.hand_id, v_result;
    END IF;
  END IF;
  /* 20261118071728: nor while its BBJ drop or an insurance leg is pending. */
  IF EXISTS (SELECT 1 FROM public.hand_bank_obligation_pending bp WHERE bp.hand_id = OLD.hand_id) THEN
    v_result := public.fn_ca_bank_pending_hand_obligations(OLD.hand_id);
    IF COALESCE(v_result->>'status', '') NOT IN ('banked', 'terminal') THEN
      RAISE EXCEPTION 'hand bank obligations remain pending for %: %', OLD.hand_id, v_result;
    END IF;
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_post_commit_stranded_watchdog()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
declare v_n int; v_oldest timestamptz; v_sample jsonb;
  v_pending int; v_pending_oldest timestamptz; v_pending_sample jsonb;
  v_key text;
begin
  select count(*), min(committed_at),
         coalesce(jsonb_agg(jsonb_build_object('table_id', table_id, 'hand_number', hand_number, 'committed_at', committed_at)) filter (where rn <= 10), '[]')
    into v_n, v_oldest, v_sample
    from (select table_id, hand_number, committed_at, row_number() over (order by committed_at) rn
            from hand_atomic_commits
           where post_commit_payload is not null and post_commit_completed_at is null
             and committed_at < now() - interval '10 minutes') s;

  /* 20261118071728: a completed envelope's rake, BBJ drop or insurance leg
     still stored after the same grace. Its hand's outbox row cannot leave, so
     that table's projections wait on it: page, with why it has not banked. */
  select count(*), min(created_at),
         coalesce(jsonb_agg(jsonb_build_object('obligation', kind, 'hand_id', hand_id, 'table_id', table_id,
                                               'hand_number', hand_number, 'stored_at', created_at,
                                               'attempts', attempts, 'last_error', last_error))
                  filter (where rn <= 10), '[]')
    into v_pending, v_pending_oldest, v_pending_sample
    from (select u.*, row_number() over (order by u.created_at) rn
            from (select 'rake'::text kind, rp.hand_id, rp.table_id, rp.hand_number, rp.created_at,
                         rp.attempts, rp.last_error
                    from cash_rake_pending rp
                   where rp.created_at < now() - interval '10 minutes'
                     and (rp.terminal_epoch is null or rp.terminal_epoch < smarter_private.money_law_epoch())
                  union all
                  select bp.kind, bp.hand_id, bp.table_id, bp.hand_number, bp.created_at,
                         bp.attempts, bp.last_error
                    from hand_bank_obligation_pending bp
                   where bp.created_at < now() - interval '10 minutes'
                     and (bp.terminal_epoch is null or bp.terminal_epoch < smarter_private.money_law_epoch())) u) s;

  if v_n + v_pending > 0 then
    /* AN OPEN ALERT SILENCES ONLY ITS OWN FINDING (20261118192000). The
       finding is the oldest unfinished envelope and the oldest unfinished
       stored obligation. An open alert about older items that have since
       finished is closed; a newer finding is named on its own. */
    v_key := 'envelope:' || coalesce(v_oldest::text, '-') || '|obligation:' || coalesce(v_pending_oldest::text, '-');
    update financial_alerts set resolved = true, resolved_at = now(),
           resolution = 'the oldest unfinished hand obligation it named has finished'
     where source='fn_post_commit_stranded_watchdog' and not resolved
       and context->>'finding_key' is distinct from v_key;
    if not exists (select 1 from financial_alerts where source='fn_post_commit_stranded_watchdog' and not resolved
                     and context->>'finding_key' = v_key) then
      insert into financial_alerts (severity, source, message, context)
      values ('critical','fn_post_commit_stranded_watchdog',
        (v_n + v_pending) || ' committed hand obligation(s) still unfinished after 10+ minutes (' || v_n || ' envelope(s), oldest ' || coalesce(v_oldest::text, '-') || '; ' || v_pending || ' stored rake/BBJ/insurance obligation(s), oldest ' || coalesce(v_pending_oldest::text, '-') || '). Players'' balances, stats or rake for these hands may be incomplete.',
        jsonb_build_object('finding_key', v_key, 'stranded', v_n, 'oldest', v_oldest, 'sample', v_sample,
                           'pending_obligations', v_pending, 'pending_oldest', v_pending_oldest,
                           'pending_sample', v_pending_sample));
    end if;
  else
    update financial_alerts set resolved = true, resolved_at = now(), resolution = 'no stranded post-commit work remains'
     where source='fn_post_commit_stranded_watchdog' and not resolved;
  end if;
  return jsonb_build_object('stranded', v_n, 'oldest', v_oldest,
                            'pending_obligations', v_pending, 'pending_oldest', v_pending_oldest);
end $function$;

-- Every redefined function keeps production's exact grants: service_role only.
REVOKE ALL ON FUNCTION public.fn_project_hand_side_effects(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_project_hand_side_effects(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.trg_finish_hand_post_commit_obligations() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_post_commit_stranded_watchdog() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_post_commit_stranded_watchdog() TO service_role;

COMMIT;
