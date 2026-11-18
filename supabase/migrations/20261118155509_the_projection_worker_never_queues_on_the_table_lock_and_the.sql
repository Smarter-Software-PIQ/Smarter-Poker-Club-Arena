-- 20261118155509_the_projection_worker_never_queues_on_the_table_lock_and_the.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- THE PROJECTION WORKER NEVER QUEUES ON THE TABLE LOCK OR A PLAYER KEY
-- (incident 075013fd follow-up, left open by #11269).
--
-- Layers on 20261118073646 (#11269). Production read 2026-11-18 (read only):
--   public.fn_project_hand_side_effects(uuid)                       39d043cda727119e0a6d883a3fb25d50
--     (the 20261118034950 + 20261118071728 postimage; derived from
--      scripts/ci/fixtures/cash-rake-pending/live-definitions.json by
--      tests/a-cash-hand-never-waits-on-the-union-bbj-pool.law.test.ts)
--   public.fn_ca_process_hand_post_commit_obligations(uuid)          39d75365156c46476bfe01854d3c86b9 (#11269, not changed here)
-- The projection function must be its pinned preimage or this file refuses to
-- install. Nothing else is replaced. fn_ca_drain_orphaned_post_commit_envelopes
-- is NOT changed (code review: a function that drains many hands holds every
-- hand's locks to its one commit; it stays the operator's hand tool it is).
--
-- Stale pins (scripts/ci/migration-stale-pins.mjs): read on production
-- 2026-11-18, no function in public or smarter_private carries the preimage
-- md5 in its source. Nothing to move, nothing declared.
-- Money RPC registry (fn_ca_money_rpc_registry_guard): the function gains no
-- balance write (it writes nothing itself; every write is a callee's), so
-- fn_ca_money_rpc_writes_balances() does not flag it and no registry row is
-- needed.
-- Hand-path shared writes (#11281): the function is not in the hand doors'
-- call closure, and it gains no write and no blocking lock; every lock change
-- is blocking -> try.
--
-- WHAT PRODUCTION WAITED. The projection worker (handProjection.ts
-- projectChain) calls this RPC through PostgREST, which connects as
-- authenticator (lock_timeout 8s, role setting) and switches to service_role
-- (statement_timeout 8s). The global lock_timeout is 0, so a direct SQL caller
-- waits until its own statement timeout. The function banked the hand's
-- deferred obligations (both bankers try-lock, never wait), then took three
-- kinds of key with a blocking pg_advisory_xact_lock:
--   'hand-post-commit:<table>'   the per-table mutex the envelope also takes;
--   'player-stats:<uuid>'        each seated player, uuid order (LOCK ORDER 2b);
--   'hand-projection:<table>'    LOCK ORDER 4;
-- and the after-function it calls
-- (fn_project_hand_side_effects_after_post_commit_20260908, not changed here)
-- takes 'player-stats-user:<uuid>' per seated player of a cash chip hand,
-- blocking, after it has claimed the outbox row and written the club member
-- projections. Those keys are shared with the cash commission batch
-- (fn_credit_agent_commissions_batch), fn_retry_cash_accounting_sources and the
-- Midway weekly promo. So a busy table, or one busy player, held a projection
-- connection for up to 8 s, and every later hand of that table queued behind
-- it.
--
-- WHAT CHANGES (fn_project_hand_side_effects only):
--   * the mutex is tried for at most 250 ms (table_busy);
--   * from then on ONE 1 s deadline covers every other key, all tried, never
--     waited on: 'player-stats:' in uuid order (obligation_lock_busy,
--     detail player_stats_lock_busy), 'hand-projection:' (table_busy, detail
--     hand_projection_lock_busy; only mutex holders take it, so it is free),
--     then every 'player-stats-user:' key the after-function will take, in
--     uuid order, before it runs (obligation_lock_busy, detail
--     player_stats_user_lock_busy). The after-function's own blocking calls
--     then re-enter keys this transaction already holds and never queue. The
--     set taken here is the after-function's set (the hand's seated uuids, a
--     cash hand at a non-Diamond club) or wider, never narrower.
-- Every refusal happens before this transaction has written anything: the
-- bankers' passes return early, and the 'player-stats-user:' keys are tried
-- only once the envelope answers already-completed or legacy (a pass that
-- completes it returns predecessor_pending first). The outbox row stays,
-- nothing is projected, the worker's deferral comes back for the hand, and
-- exactly-once and per-table order hold as before (the outbox delete and the
-- projection still happen only under the mutex, after the after-function's
-- own predecessor check). Two hands with overlapping players, at any two
-- tables, in either order, cannot deadlock or convoy on these keys: neither
-- ever sits in a lock queue, and each gives up within 1 s.
--
-- OUT OF SCOPE: smarter_private.f06_wait_table_lane, called before the mutex,
-- keeps its own per-tournament wait (SET lock_timeout 4s on that function,
-- shared locks on the tournament's terminal-settlement keys). It is a separate
-- lane with its own owner ruling (2026-11-17) and is not changed here; the law
-- names it as the one wait this function still makes.
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
-- Law: tests/the-projection-worker-never-queues-on-the-table-lock.law.test.ts
-- (it also refuses any later migration that names this function and carries a
-- blocking lock, in a literal CREATE OR REPLACE or in substitution text).
-- Proof on real PostgreSQL: scripts/ci/test-projection-table-lock-bound-postgres.py
--
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_project_hand_side_effects(uuid)'::regprocedure)) = '94588bd7bc75f60b9b575eb396549d5c')

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
  '39d043cda727119e0a6d883a3fb25d50', '94588bd7bc75f60b9b575eb396549d5c',
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
$p3o$,
$p4o$  PERFORM pg_advisory_xact_lock(
    hashtextextended('hand-projection:' || v_table_id::text, 0)
  );
$p4o$
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
$p3n$,
$p4n$  /* LOCK ORDER 4, TRIED (20261118155509). Only a holder of this table's
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
$p4n$
  ]
);

COMMIT;
