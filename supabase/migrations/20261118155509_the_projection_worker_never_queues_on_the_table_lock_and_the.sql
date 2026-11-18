-- 20261118155509_the_projection_worker_never_queues_on_the_table_lock_and_the.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- THE PROJECTION WORKER NEVER QUEUES ON THE TABLE LOCK, AND ONE DRAIN CALL
-- CLEARS A TABLE (incident 075013fd follow-ups, left open by #11269).
--
-- Layers on 20261118073646 (#11269). Production read 2026-11-18 (read only):
--   public.fn_project_hand_side_effects(uuid)                       39d043cda727119e0a6d883a3fb25d50
--     (the 20261118034950 + 20261118071728 postimage; derived from
--      scripts/ci/fixtures/cash-rake-pending/live-definitions.json by
--      tests/a-cash-hand-never-waits-on-the-union-bbj-pool.law.test.ts)
--   public.fn_ca_drain_orphaned_post_commit_envelopes(interval,integer) 6abdcb7286ea8823034f7c0eb1c7ed40
--     (the 20260909085724 text, unchanged since)
--   public.fn_ca_process_hand_post_commit_obligations(uuid)          39d75365156c46476bfe01854d3c86b9 (#11269, not changed here)
-- Each function must be its pinned preimage or this file refuses to install.
--
-- Stale pins (scripts/ci/migration-stale-pins.mjs): read on production
-- 2026-11-18, no function in public or smarter_private carries either
-- preimage md5 in its source. Nothing to move.
-- Money RPC registry (fn_ca_money_rpc_registry_guard): neither postimage is
-- one fn_ca_money_rpc_writes_balances() flags (neither preimage is, and
-- neither function gains a balance write here), so no registry row is needed.
-- Hand-path shared writes (#11281): neither function is on a hand's money
-- path root set, and neither gains a write or a blocking lock; the only
-- lock change is blocking -> try.
--
-- 1. fn_project_hand_side_effects WAITS AT MOST 250 MS FOR THE TABLE MUTEX.
--
-- The projection worker's RPC (handProjection.ts projectChain) banks the
-- hand's deferred obligations (fn_ca_bank_pending_hand_obligations,
-- fn_ca_bank_pending_cash_rake; both try-lock, never wait), then took
-- pg_advisory_xact_lock('hand-post-commit:<table>') with NO bound of its own:
-- production lock_timeout is 0, so it waited until service_role's 8 s
-- statement timeout, holding a connection, whenever the envelope or another
-- projection of the table held the mutex. #11269 bounded the envelope's own
-- wait at 250 ms and left this one. Now it is the same try-lock loop, at most
-- 250 ms; a busy table answers
--   contract 2: {ok:false, reason:'table_busy', retryable:true, projection_applied:false}
--   contract 1: {ok:false, reason:'predecessor_pending', queued_reason:'table_busy', ...}
-- The seated players' 'player-stats:<uuid>' locks (taken in uuid order under
-- the mutex, LOCK ORDER 2b) are tried the same way, sharing one 1 s deadline
-- (the envelope's own row bound); a held one answers obligation_lock_busy
-- (contract 1: predecessor_pending, queued_reason obligation_lock_busy).
-- Both refusals happen before anything is written in this transaction after
-- the bankers' own early return, so the outbox row stays, nothing is
-- projected, nothing is deleted, and the worker's deferral comes back for it:
-- exactly once and strict per-table order hold as before (the outbox delete
-- and the hand's projection still happen only under the mutex, after the
-- after-function's own predecessor check).
--
-- VERSIONED ANSWER CONTRACT (exactly #11269's design, read from the same
-- PostgREST header in the same way). The engine that ships with #11269 sends
-- x-ca-post-commit-contract: 2 on this RPC (speakPostCommitContract) and
-- treats table_busy and obligation_lock_busy as deferred
-- (isQueuedPostCommitReason). Every other caller - today's engine build, a
-- rolled-back build, any SQL caller - gets predecessor_pending, the one
-- queued answer every existing build defers without a failure receipt, with
-- the real reason in queued_reason (readPostCommitAnswer folds it back in).
--
-- 2. fn_ca_drain_orphaned_post_commit_envelopes CLEARS EACH TABLE'S BACKLOG.
--
-- Who calls it, read first (CLAUDE.md 10.12): nothing on a schedule. Its job
-- ca-post-commit-orphan-drain-10m was retired by 20260922155223, no cron.job
-- names it (production read 2026-11-18), no function in public or
-- smarter_private calls it, and no engine, client or script code does.
-- tests/a-retired-compensation-job-is-never-scheduled-again.law.test.ts
-- refuses any schedule that calls it. It is an operator's hand tool for an
-- incident, granted to service_role and postgres only. This file adds no
-- schedule and no caller, and the law for it pins that.
--
-- It used to take, per call, only each table's head-of-line hand (NOT EXISTS
-- an earlier pending envelope), so a 50-hand backlog on one table took 50
-- calls. Now one call walks each table's pending envelopes older than
-- p_older_than in hand order, oldest backlog first, up to p_limit envelope
-- calls in all, and stops a table at its first hand that does not complete
-- (a queued answer, a refusal or an error); later hands of that table are
-- not tried in this call, so per-table order holds. Every call is the
-- envelope itself (fn_ca_process_hand_post_commit_obligations), in its own
-- subtransaction, so every lock wait is the envelope's bounded one (250 ms
-- mutex, 1 s rows) and an error rolls back that hand alone. The answer keeps
-- seen / applied / failed and adds deferred, skipped, tables and stopped
-- (per stopped table: hand, number and reason).
--
-- Law: tests/the-projection-worker-never-queues-on-the-table-lock.law.test.ts
-- Proof on real PostgreSQL: scripts/ci/test-projection-table-lock-bound-postgres.py
--
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_project_hand_side_effects(uuid)'::regprocedure)) = '1e8eee8fe33b798b9fc2ac44c81d995a' AND md5(pg_get_functiondef('public.fn_ca_drain_orphaned_post_commit_envelopes(interval,integer)'::regprocedure)) = '7ae9773086093fad851bb66ffa1b8732')

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- The pinned-text substitution (the form 20261118073646 uses): the live
-- definition must be the pinned preimage, each anchor must occur exactly once,
-- the result must be the derived postimage before and after it is executed,
-- and owner, SECURITY DEFINER, settings and grants must not move.
CREATE FUNCTION pg_temp.ca_projection_subst(p_sig text, p_before text, p_after text,
                                            p_old text[], p_new text[])
RETURNS void LANGUAGE plpgsql AS $h$
DECLARE
  v_def text; v_new text; v_n integer; i integer;
  v_acl text; v_owner text; v_secdef boolean; v_cfg text[];
BEGIN
  v_def := pg_get_functiondef(p_sig::regprocedure);
  IF md5(v_def) <> p_before THEN
    RAISE EXCEPTION '% is not the pinned text (md5 %); expected %', p_sig, md5(v_def), p_before;
  END IF;
  IF array_length(p_old, 1) IS DISTINCT FROM array_length(p_new, 1) THEN
    RAISE EXCEPTION '%: anchors and replacements do not pair', p_sig;
  END IF;
  v_new := v_def;
  FOR i IN 1 .. array_length(p_old, 1) LOOP
    v_n := (length(v_new) - length(replace(v_new, p_old[i], ''))) / length(p_old[i]);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%: anchor % occurs % times, expected exactly 1', p_sig, i, v_n;
    END IF;
    v_new := replace(v_new, p_old[i], p_new[i]);
  END LOOP;
  IF md5(v_new) <> p_after THEN
    RAISE EXCEPTION '%: substituted text is not the derived postimage (md5 %)', p_sig, md5(v_new);
  END IF;

  SELECT p.proacl::text, pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    INTO v_acl, v_owner, v_secdef, v_cfg
    FROM pg_proc p WHERE p.oid = p_sig::regprocedure;

  EXECUTE v_new;

  IF md5(pg_get_functiondef(p_sig::regprocedure)) <> p_after THEN
    RAISE EXCEPTION '%: the replaced function does not read back as the postimage', p_sig;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = p_sig::regprocedure
                    AND p.proacl::text IS NOT DISTINCT FROM v_acl
                    AND pg_get_userbyid(p.proowner) = v_owner
                    AND p.prosecdef = v_secdef
                    AND p.proconfig IS NOT DISTINCT FROM v_cfg) THEN
    RAISE EXCEPTION '%: owner, security, settings or grants moved', p_sig;
  END IF;
END $h$;

-- #11269's envelope must already be live: this file's contract-2 answers
-- complete the set that envelope introduced.
DO $pin$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_process_hand_post_commit_obligations(uuid)'::regprocedure))
     <> '39d75365156c46476bfe01854d3c86b9' THEN
    RAISE EXCEPTION 'fn_ca_process_hand_post_commit_obligations is not the 20261118073646 postimage; install #11269 first';
  END IF;
END $pin$;

SELECT pg_temp.ca_projection_subst(
  'public.fn_project_hand_side_effects(uuid)',
  '39d043cda727119e0a6d883a3fb25d50', '1e8eee8fe33b798b9fc2ac44c81d995a',
  ARRAY[
$p1o$  v_hand_bank jsonb;
BEGIN
  IF NOT (current_user IN ('postgres','service_role')) THEN
    RAISE EXCEPTION 'fn_project_hand_side_effects is engine/service only';
  END IF;
$p1o$,
$p2o$  PERFORM pg_advisory_xact_lock(
    hashtextextended('hand-post-commit:' || v_table_id::text, 0)
  );

  /* LOCK ORDER 3: consume$p2o$,
$p3o$  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('player-stats:' || v_seat_uid::text, 0));
  END LOOP;
$p3o$
  ],
  ARRAY[
$p1n$  v_hand_bank jsonb;
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
$p1n$,
$p2n$  /* THE PROJECTION WORKER NEVER QUEUES ON THE TABLE LOCK (20261118155509,
     incident 075013fd). The mutex is tried for at most 250 ms; a table whose
     envelope or projection is running answers table_busy (retryable) with
     nothing written, instead of holding a connection until the statement
     timeout. Re-entered at once when this transaction already holds it. */
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
     bound). A held one answers obligation_lock_busy with nothing written;
     this transaction's locks end with it and the worker comes back for the
     hand. */
  v_lock_started := clock_timestamp();

  /* LOCK ORDER 3: consume$p2n$,
$p3n$  LOOP
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
$p3n$
  ]
);

SELECT pg_temp.ca_projection_subst(
  'public.fn_ca_drain_orphaned_post_commit_envelopes(interval,integer)',
  '6abdcb7286ea8823034f7c0eb1c7ed40', '7ae9773086093fad851bb66ffa1b8732',
  ARRAY[
$d1o$  DECLARE r record; v_seen int := 0; v_done int := 0; v_failed int := 0; v_res jsonb;
  BEGIN
    FOR r IN
      SELECT c.hand_id, c.table_id, c.hand_number, c.committed_at
        FROM public.hand_atomic_commits c
       WHERE c.post_commit_payload IS NOT NULL
         AND c.post_commit_completed_at IS NULL
         AND c.committed_at < now() - p_older_than
         /* the barrier is per table and in hand order: only drain a hand
            whose predecessors have all finished, or the applier will simply
            answer predecessor_pending and we will have learnt nothing */
         AND NOT EXISTS (
           SELECT 1 FROM public.hand_atomic_commits e
            WHERE e.table_id = c.table_id
              AND e.hand_number < c.hand_number
              AND e.post_commit_payload IS NOT NULL
              AND e.post_commit_completed_at IS NULL)
       ORDER BY c.committed_at
       LIMIT GREATEST(p_limit, 1)
    LOOP
      v_seen := v_seen + 1;
      BEGIN
        v_res := public.fn_ca_process_hand_post_commit_obligations(r.hand_id);
        IF COALESCE((v_res->>'ok')::boolean, false) THEN v_done := v_done + 1;
        ELSE v_failed := v_failed + 1; END IF;
      EXCEPTION WHEN OTHERS THEN
        v_failed := v_failed + 1;
      END;
    END LOOP;

    RETURN jsonb_build_object('ok', true, 'seen', v_seen, 'applied', v_done, 'failed', v_failed);
  END;
$d1o$
  ],
  ARRAY[
$d1n$  DECLARE r record; v_seen int := 0; v_done int := 0; v_failed int := 0; v_res jsonb;
    v_deferred int := 0; v_skipped int := 0; v_reason text;
    v_tables uuid[] := ARRAY[]::uuid[];
    v_stopped_tables uuid[] := ARRAY[]::uuid[];
    v_stopped jsonb := '[]'::jsonb;
  BEGIN
    /* ONE CALL CLEARS A TABLE (20261118155509). Each table's pending
       envelopes, oldest backlog first and in hand order within a table, up
       to p_limit envelope calls. A table stops at its first hand that does
       not complete; its later hands are not tried in this call, so per-table
       order holds. Every lock wait is the envelope's own bounded one, and
       each hand runs in its own subtransaction. No schedule calls this. */
    FOR r IN
      WITH pending AS (
        SELECT c.hand_id, c.table_id, c.hand_number, c.committed_at
          FROM public.hand_atomic_commits c
         WHERE c.post_commit_payload IS NOT NULL
           AND c.post_commit_completed_at IS NULL
           AND c.committed_at < now() - p_older_than
      ), heads AS (
        SELECT p.table_id, min(p.committed_at) AS head_at
          FROM pending p GROUP BY p.table_id
      )
      SELECT p.hand_id, p.table_id, p.hand_number
        FROM pending p JOIN heads h ON h.table_id = p.table_id
       ORDER BY h.head_at, p.table_id, p.hand_number
    LOOP
      IF r.table_id = ANY (v_stopped_tables) THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
      EXIT WHEN v_seen >= GREATEST(p_limit, 1);
      v_seen := v_seen + 1;
      IF NOT (r.table_id = ANY (v_tables)) THEN
        v_tables := v_tables || r.table_id;
      END IF;
      v_reason := NULL;
      BEGIN
        v_res := public.fn_ca_process_hand_post_commit_obligations(r.hand_id);
        IF COALESCE((v_res->>'ok')::boolean, false) THEN
          v_done := v_done + 1;
        ELSIF COALESCE(v_res->>'queued_reason', v_res->>'reason')
                IN ('predecessor_pending', 'table_busy', 'obligation_lock_busy') THEN
          v_deferred := v_deferred + 1;
          v_reason := COALESCE(v_res->>'queued_reason', v_res->>'reason');
        ELSE
          v_failed := v_failed + 1;
          v_reason := COALESCE(v_res->>'reason', 'refused');
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_failed := v_failed + 1;
        v_reason := 'error: ' || SQLSTATE || ' ' || left(SQLERRM, 200);
      END;
      IF v_reason IS NOT NULL THEN
        v_stopped_tables := v_stopped_tables || r.table_id;
        v_stopped := v_stopped || jsonb_build_object(
          'table_id', r.table_id, 'hand_id', r.hand_id,
          'hand_number', r.hand_number, 'reason', v_reason);
      END IF;
    END LOOP;

    RETURN jsonb_build_object('ok', true, 'seen', v_seen, 'applied', v_done,
      'failed', v_failed, 'deferred', v_deferred, 'skipped', v_skipped,
      'tables', COALESCE(array_length(v_tables, 1), 0), 'stopped', v_stopped);
  END;
$d1n$
  ]
);

COMMIT;
