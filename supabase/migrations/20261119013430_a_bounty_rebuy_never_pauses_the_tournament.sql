-- 20261119013430_a_bounty_rebuy_never_pauses_the_tournament.sql
--
-- Version reserved by scripts/reserve-migration-version.sh against this tree,
-- origin/main and every sibling worktree.
--
-- A BOUNTY REBUY NEVER PAUSES THE TOURNAMENT, AND NEVER CROSSES A HAND
-- (incident 075013fd, lane B7). Owner rules: "REBUYS IN A TOURNAMENT SHOULD
-- NOT PAUSE THE ACTION" (Dan, 2026-08-30), and a tournament issue never
-- affects another tournament or a cash game (Dan, 2026-11-17). Requires
-- 20261119011750 (lane R2: bounty rebuys and busts share the event lane);
-- refuses to run if its bodies are not live. Full account, with the lock
-- audit: docs/changelog/2026-11-19-a-bounty-rebuy-never-pauses-the-tournament.md.
--
-- WHAT R2 LEFT. Lane B3 measured (Midday Free Buy eb0c2d80, 2026-11-18 18:30
-- to 19:30 UTC) that every one of 418 rebuys created its bounty obligation
-- inside the rebuy: the rebuy of a still-open ("pending") generation goes
-- through fn_claim_bounty_legacy_candidate_20260907, which R2's proof
-- stubbed. The lock audit of the production bodies (read 2026-11-19, read
-- only) finds two things on that path and one on every rebuy:
--  1. THE 'atomic-table:' KEY CROSSES A HAND COMMIT. A hand commit of a table
--     takes, in order, G and T(id) shared, the lease row, the tournament row
--     FOR SHARE (fn_ca_commit_hand_settlement_exact_before_obligations), the
--     table row FOR UPDATE, then 'atomic-table:'<table> (fn_ca_commit_hand_
--     settlement_before_lease_generation), then its roster rows. The rebuy
--     took 'atomic-table:'<the candidate's table> FIRST and the tournament
--     row after it, in its seat root. On the shared lane both run at once:
--     the hand holds the tournament row and waits for the key, the rebuy
--     holds the key and waits for the row - a deadlock whose victim can be
--     the hand. The busted player's own table is exactly the table still
--     dealing, so this is the common case. An add-on took the same key
--     before its tournament row too. Under the old exclusive lane no hand
--     could be in flight, so the order never mattered.
--  2. THE BUST CLAIM LOCKS THE WHOLE FIELD. fn_sync_seat_first_player_count,
--     which the claim calls, locks EVERY table row and EVERY live seat of the
--     event FOR UPDATE before it learns the event is not seat-first, and then
--     rewrites one table's denormalised count. Inside the rebuy that lock is
--     held to commit: every table's next hand begin, finish and commit waits
--     for the rebuy, the field-wide pause lane R removed from the seat gate.
--  3. NO BOUND ON THE SETTLE'S WAITS. Every remaining wait of the settle is
--     on a row whose holder waits on nothing the rebuy holds (the audit), but
--     nothing made that a guarantee for code written later.
--
-- THE FIX.
--  1. process_tournament_rebuy takes 'atomic-table:' in the hand's order: a
--     rebuy or re-entry after its seat root (which locks the tournament row,
--     then the candidate's table row), an add-on after its tournament row.
--  2. fn_sync_seat_first_player_count answers before its field-wide lock on
--     an event that is neither seat-first nor a spin, inside the event's
--     shared change lane (smarter_private.tournament_rebuy_lane_held). The
--     claim PERFORMs it and has already written its own table's count; the
--     rebuy proves its final table's count; a bust door writes its own.
--     Seat-first events and every caller outside the lane are unchanged.
--  3. The prior generation's settle runs under a 500 ms lock_timeout, below
--     deadlock_timeout (1 s), so a wait that could ever close a cycle aborts
--     only the idempotent purchase, with the existing retryable 55P03
--     TOURNAMENT_PURCHASE_PLAYER_BUSY; the engine retries it in place.
--
-- WHAT REMAINS (measured in the native proof). The rebuy holds the
-- tournament row FOR UPDATE from its seat root to commit (its money core and
-- the bounty payout write it), and every hand commit takes that row FOR SHARE
-- first, so one table's commit can wait out the rest of one rebuy (the settle
-- is about 0.33 to 0.42 s after lane B1). Hand begins, finishes,
-- continuations, cards, snapshots, post-commit and projection do not wait.
-- Native proof: scripts/ci/test-rebuy-never-pauses-the-tournament.py,
-- section B7.
--
-- LOCK FOOTPRINT. CREATE OR REPLACE FUNCTION only: no table or row lock, no
-- install window, one transaction, one schema reload.
--
-- @live-proof: (md5(pg_get_functiondef('public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure)) = 'c294af49b455ffc1c421edbe3d6f1d1d' AND md5(pg_get_functiondef('public.fn_sync_seat_first_player_count(uuid)'::regprocedure)) = 'a21e76bf87b92436866d0b4cd59735c1')

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $requires$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.fn_ca_lock_settlement_lane_for_tournament(uuid,uuid)'))) IS DISTINCT FROM 'b76daaf8587cca4eeac91ec39e9e7ce3'
     OR md5(pg_get_functiondef(to_regprocedure('smarter_private.tournament_rebuy_lane_held(uuid,uuid)'))) IS DISTINCT FROM 'd32dad9b538f214bdeb224e1596d5416'
     OR md5(pg_get_functiondef(to_regprocedure('public.fn_ca_lock_tournament_rebuy_acquisition(uuid,uuid,uuid)'))) IS DISTINCT FROM '2ea19582f62ecd683304b1f85f17466c' THEN
    RAISE EXCEPTION 'bounty rebuy B7: 20261119011750 (lane R2) must be installed first';
  END IF;
END $requires$;

-- Exact substitutions on the pinned pre-images, each anchor counted, each
-- post-image pinned, owner, ACL, SECURITY DEFINER and proconfig preserved.
DO $subs$
DECLARE
  r record;
  i integer;
  v_sig regprocedure;
  v_def text;
  v_n integer;
  v_acl text; v_owner oid; v_definer boolean; v_config text[];
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
    ('public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)',
     'd5da73993760ca26529d284c144fec60', 'c294af49b455ffc1c421edbe3d6f1d1d',
     ARRAY[$o1$  v_lane_shared boolean:=false;
$o1$, $o2$    -- this key, preserving root -> table -> rows on both paths.
    PERFORM pg_advisory_xact_lock(
      hashtextextended('atomic-table:'||v_table_id::text,0));
    SELECT * INTO v_t FROM public.tournaments t
     WHERE t.id=p_tournament_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Tournament not found'; END IF;
$o2$, $o3$    v_table_id:=v_candidate_peek.table_id;
    PERFORM pg_advisory_xact_lock(
      hashtextextended('atomic-table:'||v_table_id::text,0));
$o3$, $o4$    IF COALESCE((v_gate->>'ok')::boolean,false) IS NOT TRUE THEN
      RAISE EXCEPTION 'tournament rebuy root refused: %',
        COALESCE(v_gate->>'reason','unknown') USING ERRCODE='55000';
    END IF;
$o4$, $o5$      v_bounty_settlement:=
        public.fn_ca_settle_bounty_rebuy_generation_v1(
          p_tournament_id,p_user_id,v_candidate.id);
$o5$],
     ARRAY[$n1$  v_lane_shared boolean:=false;
  v_settle_lock_timeout text;
$n1$, $n2$    -- this key, preserving root -> table -> rows on both paths.
    -- 20261119013430: a hand commit takes the tournament row (FOR SHARE)
    -- BEFORE this key; on the shared lane an add-on takes the row first too,
    -- or a hand of this table and the add-on each wait for the other.
    SELECT * INTO v_t FROM public.tournaments t
     WHERE t.id=p_tournament_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Tournament not found'; END IF;
    PERFORM pg_advisory_xact_lock(
      hashtextextended('atomic-table:'||v_table_id::text,0));
$n2$, $n3$    v_table_id:=v_candidate_peek.table_id;
    -- 20261119013430: the candidate table's 'atomic-table:' key is taken
    -- after the seat root below, in a hand commit's own order.
$n3$, $n4$    IF COALESCE((v_gate->>'ok')::boolean,false) IS NOT TRUE THEN
      RAISE EXCEPTION 'tournament rebuy root refused: %',
        COALESCE(v_gate->>'reason','unknown') USING ERRCODE='55000';
    END IF;
    -- A REBUY NEVER CROSSES A HAND OF ITS TABLE (20261119013430). A hand
    -- commit takes the tournament row, then its table row, then this key;
    -- the seat root above took the first two, so the key comes now. Taken
    -- before the tournament row it closed a cycle with a hand commit of the
    -- candidate's table, which is the table still dealing.
    PERFORM pg_advisory_xact_lock(
      hashtextextended('atomic-table:'||v_table_id::text,0));
$n4$, $n5$      -- THE SETTLE NEVER WAITS IN A CYCLE (20261119013430). Below the 1 s
      -- deadlock_timeout, a wait that could close a cycle aborts this
      -- idempotent purchase, never a hand, and the caller retries it.
      v_settle_lock_timeout:=current_setting('lock_timeout');
      PERFORM set_config('lock_timeout','500ms',true);
      BEGIN
        v_bounty_settlement:=
          public.fn_ca_settle_bounty_rebuy_generation_v1(
            p_tournament_id,p_user_id,v_candidate.id);
      EXCEPTION WHEN lock_not_available THEN
        RAISE EXCEPTION 'TOURNAMENT_PURCHASE_PLAYER_BUSY: retry this same purchase request'
          USING ERRCODE='55P03',
                DETAIL='the prior bounty generation waited over 500 ms for a lock';
      END;
      PERFORM set_config('lock_timeout',v_settle_lock_timeout,true);
$n5$]),
    ('public.fn_sync_seat_first_player_count(uuid)',
     '24b79979406ecba84423fd5da05c102f', 'a21e76bf87b92436866d0b4cd59735c1',
     ARRAY[$o6$  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Freeze the complete table/seat set before choosing the occupied table.
$o6$],
     ARRAY[$n6$  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- 20261119013430: inside its event's shared change lane (a rebuy's bust
  -- claim, a bust door) on an event that is neither seat-first nor a spin,
  -- the lock below would take every table and live seat of the event until
  -- commit to rewrite one table's count. The claim writes its own table's
  -- count and the rebuy proves its final table's; nothing here is owed.
  IF NOT COALESCE(v_seat_first,false) AND NOT COALESCE(v_is_spin,false)
     AND smarter_private.tournament_rebuy_lane_held(p_tournament_id,NULL) THEN
    RETURN NULL;
  END IF;

  -- Freeze the complete table/seat set before choosing the occupied table.
$n6$])
    ) AS s(signature, preimage, postimage, olds, news)
  LOOP
    v_sig := r.signature::regprocedure;
    v_def := pg_get_functiondef(v_sig);
    IF md5(v_def) <> r.preimage THEN
      RAISE EXCEPTION 'bounty rebuy B7: % is not the pinned pre-image (md5 %)', r.signature, md5(v_def);
    END IF;
    FOR i IN 1 .. cardinality(r.olds) LOOP
      v_n := (length(v_def) - length(replace(v_def, r.olds[i], ''))) / length(r.olds[i]);
      IF v_n <> 1 THEN
        RAISE EXCEPTION 'bounty rebuy B7: % anchor % occurs % times', r.signature, i, v_n;
      END IF;
      v_def := replace(v_def, r.olds[i], r.news[i]);
    END LOOP;
    IF md5(v_def) <> r.postimage THEN
      RAISE EXCEPTION 'bounty rebuy B7: % would not land on its reviewed post-image (md5 %)', r.signature, md5(v_def);
    END IF;
    SELECT p.proacl::text, p.proowner, p.prosecdef, p.proconfig
      INTO v_acl, v_owner, v_definer, v_config FROM pg_proc p WHERE p.oid = v_sig;
    EXECUTE v_def;
    IF md5(pg_get_functiondef(v_sig)) <> r.postimage
       OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_sig
            AND p.proacl::text IS NOT DISTINCT FROM v_acl AND p.proowner = v_owner
            AND p.prosecdef = v_definer AND p.proconfig IS NOT DISTINCT FROM v_config) THEN
      RAISE EXCEPTION 'bounty rebuy B7: % did not land on its post-image, or its metadata changed', r.signature;
    END IF;
  END LOOP;
END $subs$;

DO $post$
DECLARE
  v_src text;
  v_key text := 'hashtextextended(''atomic-table:''';
  v_k1 integer; v_k2 integer; v_row integer; v_gate integer;
  v_doctrine jsonb;
BEGIN
  -- Each of the rebuy's two 'atomic-table:' keys comes after the tournament
  -- row: the add-on's after its own row lock, the rebuy's after its seat root.
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure;
  v_row := strpos(v_src, 'FROM public.tournaments t' || chr(10) || '     WHERE t.id=p_tournament_id FOR UPDATE;');
  v_gate := strpos(v_src, 'v_gate:=public.fn_ca_lock_tournament_rebuy_acquisition(');
  v_k1 := strpos(v_src, v_key);
  v_k2 := v_k1 + strpos(substr(v_src, v_k1 + 1), v_key);
  IF (length(v_src) - length(replace(v_src, v_key, ''))) / length(v_key) <> 2
     OR v_row = 0 OR v_gate = 0 OR v_k1 < v_row OR v_k2 <= v_k1 OR v_k2 < v_gate THEN
    RAISE EXCEPTION 'bounty rebuy B7: an atomic-table key precedes its tournament row';
  END IF;
  v_doctrine := public.fn_ca_settlement_lane_doctrine();
  IF COALESCE((v_doctrine ->> 'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'bounty rebuy B7: the lane doctrine fails after the change: %', v_doctrine;
  END IF;
END $post$;

COMMIT;
