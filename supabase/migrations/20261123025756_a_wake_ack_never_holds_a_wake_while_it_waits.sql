-- 20261123025756_a_wake_ack_never_holds_a_wake_while_it_waits.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A WAKE ACKNOWLEDGEMENT NEVER HOLDS A WAKE WHILE IT WAITS
--
-- THE DEFECT, READ FROM THE POSTGRES LOG. The engine's acknowledgement of a
-- tournament manager's wakes (fn_ack_tournament_manager_wakes) and a bounty
-- rebuy (process_tournament_rebuy) deadlocked at 07:20:43 and 18:50:25 UTC on
-- 2026-11-22. Postgres cancelled the acknowledgement both times (the engine
-- reports that as GameServer.tournament_manager_wake_ack_failed and keeps the
-- wakes for a later acknowledgement). The ack's side is the same line each
-- time:
--
--   while locking tuple (...) in relation "tournament_manager_wakes"
--   fn_ack_tournament_manager_wakes line 27:
--   SELECT 1 FROM public.tournament_manager_wakes w
--    WHERE w.id=ANY(v_ids) ORDER BY w.id FOR UPDATE
--
-- THE CAUSE, BY LINE. A tournament has at most one pending wake row per
-- reason, and fn_emit_tournament_manager_wake writes it with
-- INSERT ... ON CONFLICT (tournament_id,reason) DO UPDATE, which locks the row
-- until the writer commits. A bounty rebuy writes two of them in one
-- transaction, in code order: bounty_settled (the
-- trg_emit_manager_wake_for_settled_bounty trigger, inside the bounty settle)
-- and then rebuy. Their ids are whatever they were when each pending row was
-- created. At 18:50:25 the rebuy row was 1390195 and the bounty_settled row
-- 1390196 (production rows read back), so the rebuy locked 1390196 first and
-- then wanted 1390195. The acknowledgement locks its exact ids in id order:
-- it held 1390195 and waited for 1390196. Same at 07:20:43 with 1385466
-- (rebuy) and 1385467 (bounty_settled). No order of reasons fixes this,
-- because which reason has the lower id changes from one wake to the next.
--
-- THE FIX. One per-tournament key orders every wake row writer against the
-- acknowledgement: 'ca:tournament-manager-wakes:v1:' || tournament id.
--   * fn_emit_tournament_manager_wake takes it SHARED just before its upsert
--     (after its terminal-status refusal, which writes nothing), so a writer
--     holds it from its first wake write to its commit. Shared holders never
--     wait for each other: two emitters of one tournament block each other
--     exactly as before (only on the same reason's row).
--   * fn_retire_manager_wakes_after_terminal_status, the only other writer of
--     wake rows, takes it SHARED before its UPDATE for the same reason.
--   * fn_ack_tournament_manager_wakes takes it EXCLUSIVE before it locks any
--     wake, when it locks more than one. It now waits for the writers in
--     flight while holding no wake, and no writer can hold one of its rows
--     once it has the key. An acknowledgement of one wake keeps its old path:
--     waiting for its only row holds nothing, so it cannot close a cycle.
-- tournament_capacity_table_receipts.manager_wake_id key-shares a wake row
-- through its foreign key, but only in the transaction that just emitted that
-- wake, which already holds the key.
--
-- Nothing else moves: the same rows are written with the same generations
-- and consumed_at values, and the acknowledgement returns the same answer.
-- Nothing here moves or prices money, seats anyone or reads is_horse.
--
-- Proof: scripts/dev/prove-a-wake-ack-never-holds-a-wake-while-it-waits.sh
-- Law: tests/a-wake-ack-never-holds-a-wake-while-it-waits.law.test.ts
-- Changelog: docs/changelog/2026-11-22-a-wake-ack-never-holds-a-wake-while-it-waits.md
--
-- HOW. Anchored edits of the live definition: each needle must occur exactly
-- once or the whole file aborts and nothing changes.
-- @live-proof: (SELECT position('pg_advisory_xact_lock_shared(' IN pg_get_functiondef('public.fn_emit_tournament_manager_wake(uuid,text)'::regprocedure)) BETWEEN 1 AND position('INSERT INTO public.tournament_manager_wakes' IN pg_get_functiondef('public.fn_emit_tournament_manager_wake(uuid,text)'::regprocedure)))
-- @live-proof: (SELECT position('pg_advisory_xact_lock(' IN pg_get_functiondef('public.fn_ack_tournament_manager_wakes(uuid,bigint[],bigint[])'::regprocedure)) BETWEEN 1 AND position('ORDER BY w.id' IN pg_get_functiondef('public.fn_ack_tournament_manager_wakes(uuid,bigint[],bigint[])'::regprocedure)))
-- @live-proof: (SELECT position('pg_advisory_xact_lock_shared(' IN pg_get_functiondef('public.fn_retire_manager_wakes_after_terminal_status()'::regprocedure)) BETWEEN 1 AND position('UPDATE public.tournament_manager_wakes' IN pg_get_functiondef('public.fn_retire_manager_wakes_after_terminal_status()'::regprocedure)))

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $emit_takes_the_key$
DECLARE
  v_def text := pg_get_functiondef('public.fn_emit_tournament_manager_wake(uuid,text)'::regprocedure);
  v_old text := $o$  INSERT INTO public.tournament_manager_wakes AS pending(tournament_id,reason,generation)$o$;
  v_new text := $r$  -- THE TOURNAMENT'S WAKE KEY, SHARED (20261123025756). Every writer of a
  -- wake row holds it from its first write to its commit, and an
  -- acknowledgement of two or more wakes takes it exclusively before it locks
  -- any. A bounty rebuy writes bounty_settled and then rebuy, whatever their
  -- ids, while the acknowledgement locks in id order: with the key it waits
  -- for the rebuy holding no wake. Shared, so emitters never wait on it.
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('ca:tournament-manager-wakes:v1:'||p_tournament_id::text,0));
  INSERT INTO public.tournament_manager_wakes AS pending(tournament_id,reason,generation)$r$;
BEGIN
  IF position('ca:tournament-manager-wakes:v1:' IN v_def)>0 THEN
    RAISE EXCEPTION 'fn_emit_tournament_manager_wake already takes the wake key: re-read before editing';
  END IF;
  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN
    RAISE EXCEPTION 'fn_emit_tournament_manager_wake upsert anchor was expected exactly once';
  END IF;
  EXECUTE replace(v_def,v_old,v_new);
END
$emit_takes_the_key$;

-- @probe-for: public.fn_emit_tournament_manager_wake
DO $probe_emit$
BEGIN
  BEGIN
    PERFORM public.fn_emit_tournament_manager_wake(gen_random_uuid(), 'rebuy');
    RAISE EXCEPTION 'WAKE_PROBE_FOUND_A_TOURNAMENT';
  EXCEPTION WHEN foreign_key_violation THEN
    IF SQLERRM NOT LIKE 'tournament % does not exist' THEN RAISE; END IF;
  END;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_emit$;

DO $verify_emit$
BEGIN
  IF (length(pg_get_functiondef('public.fn_emit_tournament_manager_wake(uuid,text)'::regprocedure))-length(replace(pg_get_functiondef('public.fn_emit_tournament_manager_wake(uuid,text)'::regprocedure),'pg_advisory_xact_lock_shared(','')))
        /length('pg_advisory_xact_lock_shared(')<>1
     OR position('pg_advisory_xact_lock_shared(' IN pg_get_functiondef('public.fn_emit_tournament_manager_wake(uuid,text)'::regprocedure))
        >= position('INSERT INTO public.tournament_manager_wakes' IN pg_get_functiondef('public.fn_emit_tournament_manager_wake(uuid,text)'::regprocedure))
     OR position('pg_advisory_xact_lock_shared(' IN pg_get_functiondef('public.fn_emit_tournament_manager_wake(uuid,text)'::regprocedure))
        <= position('RETURN NULL' IN pg_get_functiondef('public.fn_emit_tournament_manager_wake(uuid,text)'::regprocedure)) THEN
    RAISE EXCEPTION 'the emitter wake key did not install exactly once between its terminal refusal and its upsert';
  END IF;
END
$verify_emit$;

DO $ack_takes_the_key$
DECLARE
  v_def text := pg_get_functiondef('public.fn_ack_tournament_manager_wakes(uuid,bigint[],bigint[])'::regprocedure);
  v_old text := $o$  PERFORM 1
    FROM public.tournament_manager_wakes w
   WHERE w.id=ANY(v_ids)
   ORDER BY w.id
   FOR UPDATE;$o$;
  v_new text := $r$  -- THE TOURNAMENT'S WAKE KEY, EXCLUSIVE (20261123025756), before any wake is
  -- locked, when more than one will be. Every writer of a wake row holds it
  -- shared until it commits, so this waits for the writers in flight while
  -- holding no wake, and no writer can hold one of these rows once it is
  -- held. Waiting for a single wake holds nothing, so one wake cannot close a
  -- cycle and keeps the old path.
  IF cardinality(v_ids)>1 THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('ca:tournament-manager-wakes:v1:'||p_tournament_id::text,0));
  END IF;
  PERFORM 1
    FROM public.tournament_manager_wakes w
   WHERE w.id=ANY(v_ids)
   ORDER BY w.id
   FOR UPDATE;$r$;
BEGIN
  IF position('ca:tournament-manager-wakes:v1:' IN v_def)>0 THEN
    RAISE EXCEPTION 'fn_ack_tournament_manager_wakes already takes the wake key: re-read before editing';
  END IF;
  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN
    RAISE EXCEPTION 'fn_ack_tournament_manager_wakes row lock anchor was expected exactly once';
  END IF;
  EXECUTE replace(v_def,v_old,v_new);
END
$ack_takes_the_key$;

-- @probe-for: public.fn_ack_tournament_manager_wakes
DO $probe_ack$
BEGIN
  IF public.fn_ack_tournament_manager_wakes(gen_random_uuid(),
       ARRAY[9223372036854775806,9223372036854775807]::bigint[], ARRAY[1,1]::bigint[])->>'reason'
     IS DISTINCT FROM 'wake_identity_or_tournament_mismatch' THEN
    RAISE EXCEPTION 'WAKE_ACK_PROBE_ACCEPTED_UNKNOWN_WAKES';
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_ack$;

DO $verify_ack$
BEGIN
  IF (length(pg_get_functiondef('public.fn_ack_tournament_manager_wakes(uuid,bigint[],bigint[])'::regprocedure))-length(replace(pg_get_functiondef('public.fn_ack_tournament_manager_wakes(uuid,bigint[],bigint[])'::regprocedure),'pg_advisory_xact_lock(','')))
        /length('pg_advisory_xact_lock(')<>1
     OR position('IF cardinality(v_ids)>1 THEN' IN pg_get_functiondef('public.fn_ack_tournament_manager_wakes(uuid,bigint[],bigint[])'::regprocedure))=0
     OR position('pg_advisory_xact_lock(' IN pg_get_functiondef('public.fn_ack_tournament_manager_wakes(uuid,bigint[],bigint[])'::regprocedure))
        >= position('ORDER BY w.id' IN pg_get_functiondef('public.fn_ack_tournament_manager_wakes(uuid,bigint[],bigint[])'::regprocedure)) THEN
    RAISE EXCEPTION 'the acknowledgement wake key did not install exactly once before its row locks';
  END IF;
END
$verify_ack$;

DO $retire_takes_the_key$
DECLARE
  v_def text := pg_get_functiondef('public.fn_retire_manager_wakes_after_terminal_status()'::regprocedure);
  v_old text := $o$    UPDATE public.tournament_manager_wakes
       SET consumed_at=COALESCE(consumed_at,clock_timestamp())
     WHERE tournament_id=NEW.id AND consumed_at IS NULL;$o$;
  v_new text := $r$    -- The tournament's wake key, shared (20261123025756), like every other
    -- writer of wake rows: an acknowledgement holding these rows is waited
    -- for here, and never waits for this transaction while holding one.
    PERFORM pg_advisory_xact_lock_shared(
      hashtextextended('ca:tournament-manager-wakes:v1:'||NEW.id::text,0));
    UPDATE public.tournament_manager_wakes
       SET consumed_at=COALESCE(consumed_at,clock_timestamp())
     WHERE tournament_id=NEW.id AND consumed_at IS NULL;$r$;
BEGIN
  IF position('ca:tournament-manager-wakes:v1:' IN v_def)>0 THEN
    RAISE EXCEPTION 'fn_retire_manager_wakes_after_terminal_status already takes the wake key: re-read before editing';
  END IF;
  IF (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old)<>1 THEN
    RAISE EXCEPTION 'fn_retire_manager_wakes_after_terminal_status update anchor was expected exactly once';
  END IF;
  EXECUTE replace(v_def,v_old,v_new);
END
$retire_takes_the_key$;

-- @probe-exempt: public.fn_retire_manager_wakes_after_terminal_status is an AFTER UPDATE OF status trigger on public.tournaments, not called directly, covered by the static plpgsql_check gate and exercised by scripts/dev/prove-a-wake-ack-never-holds-a-wake-while-it-waits.sh

DO $verify_retire$
BEGIN
  IF (length(pg_get_functiondef('public.fn_retire_manager_wakes_after_terminal_status()'::regprocedure))-length(replace(pg_get_functiondef('public.fn_retire_manager_wakes_after_terminal_status()'::regprocedure),'pg_advisory_xact_lock_shared(','')))
        /length('pg_advisory_xact_lock_shared(')<>1
     OR position('pg_advisory_xact_lock_shared(' IN pg_get_functiondef('public.fn_retire_manager_wakes_after_terminal_status()'::regprocedure))
        >= position('UPDATE public.tournament_manager_wakes' IN pg_get_functiondef('public.fn_retire_manager_wakes_after_terminal_status()'::regprocedure)) THEN
    RAISE EXCEPTION 'the terminal retirement wake key did not install exactly once before its update';
  END IF;
END
$verify_retire$;

COMMIT;
