-- 20261118073646_a_post_commit_envelope_never_queues_behind_a_slow_predecesso.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A POST-COMMIT ENVELOPE NEVER QUEUES BEHIND A SLOW PREDECESSOR (incident
-- 075013fd, 2026-11-18, LightningHandHost.post_commit_obligations_pending).
--
-- Layers on 20261118071736_a_cash_hand_never_waits_on_the_union_bbj_pool_or_insurance_b
-- (#11266), which layers on 20261118035606 (#11256, re-landed as #11270): the live definition must
-- be #11266's postimage (md5 7a796358fa28fda910e0f28ded72ff79) or this file
-- refuses to install. Land order: #11270 (#11256 re-land), #11266, this.
--
-- Stale pins (scripts/ci/migration-stale-pins.mjs): read on production
-- 2026-11-18, no function in public or smarter_private carries any md5 of this
-- envelope (8b81e8bb..., da123635..., 11f76921..., d41bfee4..., 7a796358...) in its source, and neither
-- #11256 nor #11266 installs one. Nothing to move.
--
-- WHAT WENT WRONG. fn_ca_process_hand_post_commit_obligations took the
-- tournament lane, then pg_advisory_xact_lock('hand-post-commit:<table>') with
-- no bound of its own (only the caller's: the authenticator role's 8 s
-- lock_timeout over PostgREST, none for a postgres-role caller, whose
-- statement_timeout is 2 min), then FOR UPDATE on its hand row,
-- and only THEN asked whether an earlier hand of the table was still pending.
-- A Lightning host table commits many hands at once (a fast fold frees its
-- players before the post-commit step), so when one envelope ran slowly every
-- successor queued on the advisory lock until the 8 s service_role statement
-- timeout, holding a connection the whole time, only to learn it could not
-- have run anyway. Measured: 8,303 statement timeouts, 38 million RPC calls in
-- pg_stat_statements, post-commit lag up to 6,410 s on seven host tables, and
-- 1,736 alert deliveries.
--
-- WHAT CHANGES (one function; money semantics unchanged):
--
--   1. Before any lock, one unlocked read answers the two outcomes that never
--      need one: an envelope already completed (the receipt is immutable once
--      committed; same answer as the locked path) and predecessor_pending (an
--      earlier envelope of the table is still open; it is named, with its
--      hand number and commit time, so callers can key one stall episode on
--      it). Both are re-checked under the lock exactly as before, so a stale
--      read can only make a caller retry, never skip a predecessor.
--   2. The per-table mutex is a try-lock loop bounded at 250 ms. A busy table
--      answers {ok:false, reason:'table_busy', retryable:true} instead of
--      queueing for the statement timeout.
--   3. Every lock the envelope names itself is waited for at most 1 s
--      (lock_timeout '1s' around that statement, then the caller's own value
--      again, read at entry; no function-level setting): its hand row, each
--      pending add-on row, and, before promo_apply_playthrough runs, that
--      player's player_stats and club_members rows (in the callee's own
--      order). A refused lock answers {ok:false,
--      reason:'obligation_lock_busy', retryable:true}. The envelope body runs
--      in its own block, so a refusal rolls back every write it made: no
--      receipt is written, the caller retries, exactly once holds. The same
--      handler answers #11266's insurance-bank try-lock refusal (55P03,
--      'insurance bank ... is busy'), so a busy bank is a retry too.
--      Callees run with the caller's own lock_timeout, exactly as before (not
--      shortened): promo_apply_playthrough wraps its player_stats upsert in
--      EXCEPTION WHEN OTHERS THEN NULL, and a shorter wait there would be
--      swallowed and silently drop the write. The rows it locks are already
--      held by then, so it does not wait on them. The
--      tournament lane (f06_wait_table_lane) keeps its own 4 s bound and its
--      own F06_RETRY_CANONICAL_LANE answer.
--
-- Strict per-table order is unchanged: the hand is still processed only under
-- the per-table mutex and only after the locked re-check finds no open
-- predecessor. The completion receipt is unchanged.
--
-- NOT CHANGED HERE: fn_project_hand_side_effects still takes the same
-- per-table mutex with a blocking wait before it calls this envelope. Its
-- waiters are the projection worker's chains, one per table per process (not
-- one per hand), and while it holds the mutex the Lightning hosts' calls now
-- answer table_busy at 250 ms instead of queueing behind it. It is also
-- rewritten by #11270 and #11266 part 1 in this same chain; bounding it is a
-- follow-up once those land, not another moving pin here.
--
-- Law: tests/a-post-commit-envelope-never-queues-behind-a-slow-predecessor.law.test.ts
-- Proof on real PostgreSQL: scripts/ci/test-post-commit-envelope-convoy-postgres.py
--
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_ca_process_hand_post_commit_obligations(uuid)'::regprocedure)) = 'dcd62bfc0a5ebae397a0f4c993a988eb')

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- The pinned-text substitution (the form 20261118035606 uses): the live
-- definition must be the pinned preimage, each anchor must occur exactly once,
-- the result must be the derived postimage before and after it is executed,
-- and owner, SECURITY DEFINER, settings and grants must not move.
CREATE FUNCTION pg_temp.ca_convoy_subst(p_sig text, p_before text, p_after text,
                                        p_old text[], p_new text[])
RETURNS void LANGUAGE plpgsql AS $h$
DECLARE
  v_def text; v_new text; v_n integer; i integer;
  v_acl text; v_owner text; v_secdef boolean; v_cfg text[];
BEGIN
  v_def := pg_get_functiondef(p_sig::regprocedure);
  IF md5(v_def) <> p_before THEN
    RAISE EXCEPTION '% is not the pinned text (md5 %); 20261118071736 (#11266) must be installed first',
      p_sig, md5(v_def);
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

SELECT pg_temp.ca_convoy_subst(
  'public.fn_ca_process_hand_post_commit_obligations(uuid)',
  '7a796358fa28fda910e0f28ded72ff79', 'dcd62bfc0a5ebae397a0f4c993a988eb',
  ARRAY[
$o1$  v_result jsonb;
BEGIN
$o1$,
$o2$  SELECT c.table_id INTO v_table_id
    FROM public.hand_atomic_commits c
   WHERE c.hand_id = p_hand_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found', 'hand_id', p_hand_id);
  END IF;
$o2$,
$o3$  PERFORM pg_advisory_xact_lock(
    hashtextextended('hand-post-commit:' || v_table_id::text, 0)
  );

  SELECT c.* INTO v_commit
    FROM public.hand_atomic_commits c
   WHERE c.hand_id = p_hand_id
   FOR UPDATE;
$o3$,
$o4$  IF EXISTS (
    SELECT 1
      FROM public.hand_atomic_commits earlier
     WHERE earlier.table_id = v_commit.table_id
       AND earlier.hand_number < v_commit.hand_number
       AND earlier.post_commit_payload IS NOT NULL
       AND earlier.post_commit_completed_at IS NULL
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'predecessor_pending',
      'hand_id', p_hand_id
    );
  END IF;
$o4$,
$o5$  RETURN v_result;
END;
$function$
$o5$,
$o6$    v_promo_result := public.promo_apply_playthrough(
      (v_item->>'club_id')::uuid,
      (v_item->>'user_id')::uuid,
      (v_item->>'wagered')::numeric
    );
$o6$,
$o7$      SELECT a.* INTO v_addon
        FROM public.table_pending_addons a
       WHERE a.id = (v_item #>> '{}')::uuid
         AND a.table_id = v_commit.table_id
       FOR UPDATE;
$o7$
  ],
  ARRAY[
$n1$  v_result jsonb;
  v_peek_hand_number bigint;
  v_peek_committed_at timestamptz;
  v_peek_has_payload boolean;
  v_peek_completed_at timestamptz;
  v_peek_result jsonb;
  v_oldest record;
  v_mutex_key bigint;
  v_mutex_started timestamptz;
  v_caller_lock_timeout text := current_setting('lock_timeout');
BEGIN
$n1$,
$n2$  /* A POST-COMMIT ENVELOPE NEVER QUEUES BEHIND A SLOW PREDECESSOR
     (20261118, incident 075013fd). Read the scope and the two answers that
     need no lock BEFORE any lock: a completed receipt is immutable once
     committed, and an open earlier envelope means this hand cannot run yet.
     Both are re-checked under the lock below exactly as before. */
  SELECT c.table_id, c.hand_number, c.committed_at,
         c.post_commit_payload IS NOT NULL,
         c.post_commit_completed_at, c.post_commit_result
    INTO v_table_id, v_peek_hand_number, v_peek_committed_at,
         v_peek_has_payload, v_peek_completed_at, v_peek_result
    FROM public.hand_atomic_commits c
   WHERE c.hand_id = p_hand_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found', 'hand_id', p_hand_id);
  END IF;
  IF v_peek_has_payload AND v_peek_completed_at IS NOT NULL THEN
    RETURN COALESCE(v_peek_result, '{}'::jsonb) || jsonb_build_object(
      'ok', true,
      'already_completed', true,
      'hand_id', p_hand_id,
      'completed_at', v_peek_completed_at
    );
  END IF;
  IF v_peek_has_payload THEN
    SELECT e.hand_id, e.hand_number, e.committed_at INTO v_oldest
      FROM public.hand_atomic_commits e
     WHERE e.table_id = v_table_id
       AND e.hand_number < v_peek_hand_number
       AND e.post_commit_payload IS NOT NULL
       AND e.post_commit_completed_at IS NULL
     ORDER BY e.hand_number
     LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'predecessor_pending',
        'retryable', true,
        'hand_id', p_hand_id,
        'table_id', v_table_id,
        'hand_number', v_peek_hand_number,
        'oldest_pending_hand_id', v_oldest.hand_id,
        'oldest_pending_hand_number', v_oldest.hand_number,
        'oldest_pending_committed_at', v_oldest.committed_at
      );
    END IF;
  END IF;
$n2$,
$n3$  /* The per-table mutex, waited for at most 250 ms. A table whose head
     envelope is running answers table_busy (retryable) instead of holding a
     connection until the statement timeout. Re-entered at once when the
     caller already holds it (fn_project_hand_side_effects). */
  v_mutex_key := hashtextextended('hand-post-commit:' || v_table_id::text, 0);
  v_mutex_started := clock_timestamp();
  WHILE NOT pg_try_advisory_xact_lock(v_mutex_key) LOOP
    IF clock_timestamp() - v_mutex_started >= interval '250 milliseconds' THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'table_busy',
        'retryable', true,
        'hand_id', p_hand_id,
        'table_id', v_table_id,
        'hand_number', v_peek_hand_number,
        'oldest_pending_hand_id', p_hand_id,
        'oldest_pending_hand_number', v_peek_hand_number,
        'oldest_pending_committed_at', v_peek_committed_at,
        'waited_ms', round(extract(epoch FROM clock_timestamp() - v_mutex_started) * 1000)
      );
    END IF;
    PERFORM pg_sleep(0.025);
  END LOOP;

  /* The envelope body runs in its own block. A lock this function names is
     waited for at most 1 s; a refused lock rolls back everything the block
     wrote (no receipt) and answers obligation_lock_busy, so the caller
     retries and the obligations still apply exactly once. */
  BEGIN
  /* The bounded wait applies only where this function names the rows
     itself: lock_timeout '1s' around each such statement, then back to the
     caller's own value (v_caller_lock_timeout, read at entry). Callees keep
     the wait they always had: promo_apply_playthrough swallows any error from
     its player_stats upsert (EXCEPTION WHEN OTHERS THEN NULL), so a shorter
     wait inside a callee could silently drop a write. On a refused lock the
     block's rollback restores the caller's value too. */
  PERFORM set_config('lock_timeout', '1s', true);
  SELECT c.* INTO v_commit
    FROM public.hand_atomic_commits c
   WHERE c.hand_id = p_hand_id
   FOR UPDATE;
  PERFORM set_config('lock_timeout', v_caller_lock_timeout, true);
$n3$,
$n4$  SELECT e.hand_id, e.hand_number, e.committed_at INTO v_oldest
    FROM public.hand_atomic_commits e
   WHERE e.table_id = v_commit.table_id
     AND e.hand_number < v_commit.hand_number
     AND e.post_commit_payload IS NOT NULL
     AND e.post_commit_completed_at IS NULL
   ORDER BY e.hand_number
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'predecessor_pending',
      'retryable', true,
      'hand_id', p_hand_id,
      'table_id', v_commit.table_id,
      'hand_number', v_commit.hand_number,
      'oldest_pending_hand_id', v_oldest.hand_id,
      'oldest_pending_hand_number', v_oldest.hand_number,
      'oldest_pending_committed_at', v_oldest.committed_at
    );
  END IF;
$n4$,
$n5$  RETURN v_result;
  EXCEPTION WHEN lock_not_available THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'obligation_lock_busy',
      'retryable', true,
      'hand_id', p_hand_id,
      'table_id', v_table_id,
      'hand_number', v_peek_hand_number,
      'oldest_pending_hand_id', p_hand_id,
      'oldest_pending_hand_number', v_peek_hand_number,
      'oldest_pending_committed_at', v_peek_committed_at,
      'detail', SQLERRM
    );
  END;
END;
$function$
$n5$,
$n6$    /* The rows promo_apply_playthrough locks, in its own order (player_stats,
       then club_members), taken here with the bounded wait: a held row
       answers obligation_lock_busy before the callee runs, and the callee
       then finds them already held, so nothing it would swallow can wait. */
    PERFORM set_config('lock_timeout', '1s', true);
    PERFORM 1
      FROM public.player_stats s
     WHERE s.user_id = (v_item->>'user_id')::uuid
       AND s.club_id = (v_item->>'club_id')::uuid
       FOR UPDATE;
    PERFORM 1
      FROM public.club_members m
     WHERE m.club_id = (v_item->>'club_id')::uuid
       AND m.user_id = (v_item->>'user_id')::uuid
       FOR UPDATE;
    PERFORM set_config('lock_timeout', v_caller_lock_timeout, true);
    v_promo_result := public.promo_apply_playthrough(
      (v_item->>'club_id')::uuid,
      (v_item->>'user_id')::uuid,
      (v_item->>'wagered')::numeric
    );
$n6$,
$n7$      PERFORM set_config('lock_timeout', '1s', true);
      SELECT a.* INTO v_addon
        FROM public.table_pending_addons a
       WHERE a.id = (v_item #>> '{}')::uuid
         AND a.table_id = v_commit.table_id
       FOR UPDATE;
      PERFORM set_config('lock_timeout', v_caller_lock_timeout, true);
$n7$
  ]
);

COMMIT;
