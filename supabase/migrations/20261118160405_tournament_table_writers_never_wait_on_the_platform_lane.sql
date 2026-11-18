-- 20261118160405_tournament_table_writers_never_wait_on_the_platform_lane.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A TABLE WRITER NEVER WAITS ON THE PLATFORM LANE (incident 075013fd, lane T).
-- Owner ruling, 2026-11-17: "a tournament issue must always be isolated and
-- never affect other tournaments or cash games". Full account:
-- docs/changelog/2026-11-18-a-table-writer-never-waits-on-the-platform-lane.md.
--
-- THE DEFECT. Every tournament table writer took the platform key G
-- ('ca:tournament-terminal-settlement:v1') SHARED before its own T(id):
-- smarter_private.f06_wait_table_lane (insert_hole_cards,
-- save_hand_state_snapshot, fn_ca_process_hand_post_commit_obligations,
-- fn_project_hand_side_effects), public.fn_ca_f06_share_table_lane (begin,
-- finish, continuation and hand-number calls) and
-- public.fn_ca_share_settlement_lane_for_table (the hand commit, which took
-- G shared for CASH tables too). Postgres queues a new shared request behind
-- a WAITING exclusive one, so a global authority (G exclusive) paused every
-- tournament table and every cash hand on the platform for as long as it
-- QUEUED for G, not only while it held it - and it queues behind any slow
-- authority of any other event that holds G shared.
--
-- MEASURED ON PRODUCTION (postgres log, log_lock_waits; 2026-11-17 12:00 to
-- 2026-11-18 12:00 UTC). Waits of 1 s or more on G by table writers: 477,
-- in 8 episodes; each one was a G-exclusive request queued for 3-14 s behind
-- a slow G-shared holder (a tournament_schedules update, a hand projection):
-- the club-create certification job's direct call of
-- fn_ca_lock_settlement_lane_global() (6 of them, up to 14.5 s), one
-- fn_retire_settled_club, and one hand-run cancellation script. The waits
-- on a tournament's OWN T(id) in the same 24 h: about 47,000. Those are
-- intra-tournament and are not changed here (see the changelog).
--
-- THE FIX. Table writers take the hand barrier B
-- ('ca:hand-settlement-barrier:v1') SHARED instead of G, then their own T(id)
-- shared. The global helpers take G then B exclusively (unchanged), so B is
-- requested only once G is HELD: a global authority that is still waiting
-- for G pauses no table. Exact substitutions, md5-pinned both ways:
--   f06_wait_table_lane               G shared        -> B shared (waits, 4 s)
--   fn_ca_f06_share_table_lane        G shared        -> B shared
--   fn_ca_share_settlement_lane_for_table  G shared + B shared -> B shared
--   f06_aborted_hand_guard            try G shared    -> try B shared
--   f06_cancelled_preparation_writer_guard try G shared -> try B shared
--   f06_source_guard (the two payload/zero-stack writer branches)
--                                     try G shared    -> try B shared
--   fn_ca_settlement_lane_doctrine    + rule 5: table writers never take G
-- Authorities are untouched: rolling (G s, T x), finish (G s, F, F(scope),
-- T x), satellite/sweep (G s, F x, T x...), global (G x, B x) and
-- f06_try_lane (try G s, T x).
--
-- WHY EVERY INVARIANT STILL HOLDS.
-- * A global authority still excludes every hand write while it holds the
--   lane: it holds B exclusively from right after G until it commits, and
--   every writer and both hand guards hold or try B shared. G exclusive and
--   B exclusive are only ever taken together (fn_ca_lock_settlement_lane_global
--   and fn_ca_lock_settlement_lane_for_tournament(NULL), doctrine rule 1).
-- * Every per-tournament authority still excludes its own tournament's hand
--   writes through T(id) exclusive vs T(id) shared - unchanged.
-- * Authority vs authority exclusion (the 2026-09-17 wallet-order rule) is
--   G, F and T and is unchanged: no authority's lock set moved.
-- * No deadlock: order is G < F < B < T everywhere. Writers take B then T and
--   never G. The writer paths that do reach G (fn_ca_resume_hand_submission,
--   f06_prefix) take it through an authority lane BEFORE B. A writer waits on
--   B only while a global holds B, i.e. holds G exclusively, so no other
--   transaction holds T(id) exclusively (every T-exclusive taker holds G
--   shared first) and no writer holding B shared exists to wait for.
--   Proven natively: scripts/ci/test-tournament-lane-isolation.py.
-- * The 4 s bound, the F06_RETRY_CANONICAL_LANE / 55P03 sentinel, SECURITY
--   DEFINER, owner, ACL and proconfig of every function are unchanged.
--
-- LOCK FOOTPRINT. CREATE OR REPLACE FUNCTION on seven functions: no table
-- lock, no row lock, no window. Sessions running an old body finish under
-- it; a transaction that mixes bodies takes G, B, T in that order. One
-- transaction, one schema-cache reload.
--
-- STALE PIN. smarter_private.original_hand_correction_sources_match() pins
-- the pre-image of fn_ca_share_settlement_lane_for_table in a 26-function
-- list; it already answers false on production (read 2026-11-18 16:00 UTC:
-- other pinned bodies moved before this), so its outcome does not change.
-- @stale-pin-ok: 409b14ee72ce888d3b26524c52d49a68 original_hand_correction_sources_match already answers false on production; moving one of its 26 pins would not revive it
--
-- @live-proof: (SELECT md5(pg_get_functiondef('smarter_private.f06_wait_table_lane(uuid)'::regprocedure)) = '32c0483040ec95ffc3c68196c3041749')

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $subs$
DECLARE
  r record;
  v_sig regprocedure;
  v_def text;
  v_new_def text;
  v_after text;
  v_n integer;
  v_acl text;
  v_owner oid;
  v_definer boolean;
  v_config text[];
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
    ('smarter_private.f06_wait_table_lane(uuid)',
     '4cd46ed5819cd9a91f87c93d4f112e45', 1,
     $old$    PERFORM pg_advisory_xact_lock_shared(
      hashtextextended('ca:tournament-terminal-settlement:v1', 0));
$old$,
     $new$    /* 20261118160405: the hand barrier B, never the platform key G. A
       global authority queued on G pauses no table; while one HOLDS the
       lane it holds B exclusively and this waits, bounded, as before. */
    PERFORM pg_advisory_xact_lock_shared(
      hashtextextended('ca:hand-settlement-barrier:v1', 0));
$new$),
    ('public.fn_ca_f06_share_table_lane(uuid,uuid,uuid)',
     '7ac5aeac3454c71ded85ff88655a3357', 1,
     $old$  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('ca:tournament-terminal-settlement:v1', 0));
$old$,
     $new$  /* 20261118160405: B shared, never G: one event's authority queued on
     the platform key never pauses another event's table. */
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('ca:hand-settlement-barrier:v1', 0));
$new$),
    ('public.fn_ca_share_settlement_lane_for_table(uuid)',
     '409b14ee72ce888d3b26524c52d49a68', 1,
     $old$  -- Acquire G before B and T; source custody guards also need G.
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('ca:tournament-terminal-settlement:v1',0));
$old$,
     $new$  -- 20261118160405: no G. A hand (cash or tournament) never waits for
  -- the platform key, so a global authority still queued for G pauses no
  -- table; B below is what fences a hand from a global authority holding
  -- the lane (G then B exclusive), and the source custody guards try B.
$new$),
    ('smarter_private.f06_aborted_hand_guard()',
     '49046cee6eb91ce98c44564e0590e452', 1,
     $old$ IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('ca:tournament-terminal-settlement:v1',0))
$old$,
     $new$ IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('ca:hand-settlement-barrier:v1',0))
$new$),
    ('smarter_private.f06_cancelled_preparation_writer_guard()',
     '3219dd0db0c0de9e8f9c02f4609eaaf8', 1,
     $old$ IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('ca:tournament-terminal-settlement:v1',0))
$old$,
     $new$ IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('ca:hand-settlement-barrier:v1',0))
$new$),
    ('smarter_private.f06_source_guard()',
     '2cb07986223473917ab28dd889ced884', 2,
     $old$  IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('ca:tournament-terminal-settlement:v1',0))
$old$,
     $new$  IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('ca:hand-settlement-barrier:v1',0))
$new$),
    ('public.fn_ca_settlement_lane_doctrine()',
     'a0a71944de239c5d5ef93460f0835ce0', 1,
     $old$  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_violations) = 0,
$old$,
     $new$  -- 5. A table writer never takes G (20261118160405). One event's
  --    authority queued on the platform key must never pause another
  --    event's tables or a cash hand: the writers' lane helpers and the hand
  --    guards take or try the hand barrier B and their own T(id), and never
  --    name G. A renamed or dropped writer is a violation too, so this rule
  --    cannot pass by losing its subject.
  SELECT string_agg(x.sig, ',' ORDER BY x.sig COLLATE "C")
    INTO v_set
    FROM unnest(ARRAY[
      'smarter_private.f06_wait_table_lane(uuid)',
      'public.fn_ca_f06_share_table_lane(uuid,uuid,uuid)',
      'public.fn_ca_share_settlement_lane_for_table(uuid)',
      'smarter_private.f06_aborted_hand_guard()',
      'smarter_private.f06_cancelled_preparation_writer_guard()',
      'smarter_private.f06_source_guard()']) AS x(sig)
    LEFT JOIN pg_catalog.pg_proc p ON p.oid = to_regprocedure(x.sig)
   WHERE p.oid IS NULL
      OR p.prosrc ~ ('hashtextextended\(\s*''ca:tournament-terminal-' || 'settlement:v1''\s*,')
      OR p.prosrc !~ ('hashtextextended\(\s*''ca:hand-settlement-' || 'barrier:v1''\s*,');
  IF v_set IS NOT NULL THEN
    v_violations := v_violations || jsonb_build_object('rule', 'table_writers_never_take_g', 'found', v_set);
  END IF;

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_violations) = 0,
$new$)
    ) AS subs(signature, preimage, expected, old_text, new_text)
  LOOP
    v_sig := r.signature::regprocedure;
    v_def := pg_get_functiondef(v_sig);
    IF md5(v_def) <> r.preimage THEN
      RAISE EXCEPTION 'table writer lane: % is not the pinned pre-image (md5 %)', r.signature, md5(v_def);
    END IF;
    v_n := (length(v_def) - length(replace(v_def, r.old_text, ''))) / length(r.old_text);
    IF v_n <> r.expected THEN
      RAISE EXCEPTION 'table writer lane: % anchor occurs % times, expected %', r.signature, v_n, r.expected;
    END IF;
    v_new_def := replace(v_def, r.old_text, r.new_text);
    IF replace(v_new_def, r.new_text, r.old_text) IS DISTINCT FROM v_def THEN
      RAISE EXCEPTION 'table writer lane: % substitution is not reversible', r.signature;
    END IF;
    SELECT p.proacl::text, p.proowner, p.prosecdef, p.proconfig
      INTO v_acl, v_owner, v_definer, v_config FROM pg_proc p WHERE p.oid = v_sig;
    EXECUTE v_new_def;
    v_after := pg_get_functiondef(v_sig);
    IF v_after IS DISTINCT FROM v_new_def THEN
      RAISE EXCEPTION 'table writer lane: % is not its intended post-image (md5 %)', r.signature, md5(v_after);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_sig
         AND p.proacl::text IS NOT DISTINCT FROM v_acl AND p.proowner = v_owner
         AND p.prosecdef = v_definer AND p.proconfig IS NOT DISTINCT FROM v_config) THEN
      RAISE EXCEPTION 'table writer lane: % metadata or privileges changed', r.signature;
    END IF;
    RAISE NOTICE '% post-image md5 %', r.signature, md5(v_after);
  END LOOP;
END $subs$;

DO $post$
DECLARE
  v_doctrine jsonb;
BEGIN
  -- The exact reviewed post-images (scripts/ci/test-tournament-lane-isolation.py).
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('smarter_private.f06_wait_table_lane(uuid)', '32c0483040ec95ffc3c68196c3041749'),
      ('public.fn_ca_f06_share_table_lane(uuid,uuid,uuid)', '6cea02b2f02dc4e238e7ae17ad0bf9c8'),
      ('public.fn_ca_share_settlement_lane_for_table(uuid)', 'ff501f74982567097241b1d90fbb4b96'),
      ('smarter_private.f06_aborted_hand_guard()', '4cab83a49494bd9f0657825384daea71'),
      ('smarter_private.f06_cancelled_preparation_writer_guard()', '8bb02c9d92510bcd42fd48d2c134c284'),
      ('smarter_private.f06_source_guard()', '1355f6d7edff0f4939d7c46f86c98699'),
      ('public.fn_ca_settlement_lane_doctrine()', 'a386f2d5adfbdc1a5ab2ee4a5bee298d')
    ) AS x(sig, post)
    WHERE md5(pg_get_functiondef(x.sig::regprocedure)) IS DISTINCT FROM x.post) THEN
    RAISE EXCEPTION 'table writer lane: a post-image is not the reviewed text';
  END IF;
  -- The authorities did not move.
  IF md5(pg_get_functiondef('public.fn_ca_lock_settlement_lane_global()'::regprocedure)) <> '7c759bb7a639c3124de2607bdbf12577'
     OR md5(pg_get_functiondef('public.fn_ca_lock_settlement_lane_for_tournament(uuid,uuid)'::regprocedure)) <> '9877846ffabee004690e6b24a3ddcee2'
     OR md5(pg_get_functiondef('public.fn_ca_lock_settlement_lane_for_finish(uuid)'::regprocedure)) <> '1626c6807e525783fa0fae2f1d03d978' THEN
    RAISE EXCEPTION 'table writer lane: an authority lane helper is not its pinned text';
  END IF;
  v_doctrine := public.fn_ca_settlement_lane_doctrine();
  IF COALESCE((v_doctrine ->> 'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'table writer lane: the lane doctrine fails after the change: %', v_doctrine;
  END IF;
END $post$;

COMMIT;
