-- 20261119181500_tournament_tables_never_wait_on_another_tables_event_row.sql
--
-- TOURNAMENT TABLES NEVER WAIT ON ANOTHER TABLE'S EVENT ROW (incident 075013fd,
-- lane E4). Owner rulings: "a tournament issue must always be isolated and
-- never affect other tournaments or cash games" (2026-11-17); "REBUYS IN A
-- TOURNAMENT SHOULD NOT PAUSE THE ACTION" (2026-08-30); "I don't want any
-- unintended delays" (2026-11-18).
--
-- Requires 20261119053909 (lane E2: moves, breaks, entry close, bounty sweeps
-- and single-event cancels fence only their own event/tables) and
-- 20261119054539 (lane E3: rebuy reads promo fee state outside its event lane).
-- Refuses to run if their post-images are not installed.
--
-- WHAT WAS LEFT AFTER LANES R, R2, B7, L AND E2.
-- Every per-hand commit (fn_ca_commit_hand_settlement_exact_before_obligations
-- and fn_ca_commit_hand_settlement_before_lease_generation) took
-- public.tournaments FOR SHARE before locking its own table row. Meanwhile,
-- every shared-change-lane writer (moves, breaks, rebuys, add-ons, busts,
-- bounty claims/sweeps/collections, entry close, and live-seat launch-proof
-- validation) took public.tournaments FOR UPDATE.
-- In PostgreSQL, FOR SHARE conflicts with BOTH FOR UPDATE and FOR NO KEY UPDATE,
-- so a hand commit at Table B still waited for the full duration of a move,
-- break, rebuy, bust, sweep or entry close at Table A (~0.3-2.0 s).
--
-- THE FIX.
-- 1. Hand commits (fn_ca_commit_hand_settlement_exact_before_obligations and
--    fn_ca_commit_hand_settlement_before_lease_generation) take
--    public.tournaments FOR KEY SHARE instead of FOR SHARE.
-- 2. Shared-change-lane writers (fn_ca_share_tournament_lane_for_tables,
--    fn_lock_tournament_launch_proof_parents,
--    fn_ca_lock_tournament_rebuy_acquisition, process_tournament_rebuy,
--    fn_ca_process_tournament_chip_purchase_money_v1,
--    fn_ca_settle_bounty_rebuy_generation_v1, fn_move_tournament_player,
--    smarter_private.f06_prefix, fn_close_tournament_entry_window,
--    fn_sweep_pending_tournament_bounties, fn_collect_bounty,
--    fn_eliminate_tournament_player_atomic,
--    fn_eliminate_player_legacy_candidate_20260907,
--    fn_claim_tournament_bounty_elimination,
--    fn_ca_open_tournament_seat_exit_authority, and
--    fn_close_empty_tournament_table) take public.tournaments FOR NO KEY UPDATE
--    instead of FOR UPDATE.
-- 3. In PostgreSQL, FOR KEY SHARE is 100% compatible with FOR NO KEY UPDATE
--    (and with plain UPDATE of non-key columns such as prize_pool, bounty_pool,
--    total_rake, current_players, updated_at), while still conflicting with
--    DELETE, key updates, and explicit FOR UPDATE lifecycle transitions.
--    Exclusive tournament lifecycle transitions (start, finish, cancel, abort)
--    continue to exclude all hand commits through T(id) EXCLUSIVE and FOR UPDATE.
--    Two shared-lane writers continue to serialize through R(id) EXCLUSIVE and
--    FOR NO KEY UPDATE. A move/break/rebuy/bust at Table A and a hand commit at
--    Table A continue to serialize cleanly on public.tables(A) FOR UPDATE.
--    A hand commit at Table B never blocks on Table A's move/break/rebuy/bust.
-- 4. Doctrine rule 9 pins this lock-mode contract on both hand commit doors and
--    all 16 shared-lane writers.
--
-- LOCK ORDER & DEADLOCK SAFETY.
-- Hand commit: G S -> T(id) S -> lease FOR KEY SHARE -> tournaments FOR KEY SHARE
-- -> tables(self) FOR UPDATE -> atomic-table:self -> seats/roster(self).
-- Shared-lane writer: R(id) X -> G S -> T(id) S -> launch_receipt FOR UPDATE
-- -> tournaments FOR NO KEY UPDATE -> tables(touched, id order) FOR UPDATE
-- -> atomic-table:touched -> seats/roster(touched).
-- Hand commits never update public.tournaments (never upgrade FOR KEY SHARE),
-- so no cycle can form between FOR KEY SHARE and FOR NO KEY UPDATE.
-- Native proof: scripts/ci/test-rebuy-never-pauses-the-tournament.py (section LANE E4).
--
-- LOCK FOOTPRINT. CREATE OR REPLACE FUNCTION only: no table or row lock, no
-- install window, one transaction, one schema reload.
--
-- STALE PINS. smarter_private.original_hand_correction_sources_match() pins
-- fn_ca_commit_hand_settlement_exact_before_obligations and
-- fn_ca_commit_hand_settlement_before_lease_generation in its 26-function list;
-- it already answers false on production (read 2026-11-19 in 20261119053909),
-- so its outcome does not change. public.fn_ca_guard_mtt_admission_contract()
-- pins fn_ca_process_tournament_chip_purchase_money_v1 in its activation
-- manifest, read only on the legacy-capacity-v1 -> unlimited-mtt-v2 transition,
-- which production completed (abi = unlimited-mtt-v2, immutable).
-- @stale-pin-ok: c555fb7b83c889312995bc0038c1b275 original_hand_correction_sources_match already answers false on production; moving one of its pins would not revive it
-- @stale-pin-ok: b49192e78f472d7a931bcf20de46a702 original_hand_correction_sources_match already answers false on production; moving one of its pins would not revive it
-- @stale-pin-ok: 5ae262f9a0cffeb1908172c756ca5bf8 fn_ca_guard_mtt_admission_contract activation manifest; the transition it guards is complete and immutable
--
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_ca_commit_hand_settlement_exact_before_obligations(uuid,bigint,jsonb,numeric,numeric,text,numeric,jsonb,jsonb,text,uuid)'::regprocedure)) = '95863075b8d44c6177dd893c946cd1b4' AND md5(pg_get_functiondef('public.fn_ca_share_tournament_lane_for_tables(uuid,uuid,uuid[],boolean)'::regprocedure)) = 'da69a271d8cbcf56efdf61740fb4dcca' AND md5(pg_get_functiondef('public.fn_lock_tournament_launch_proof_parents(uuid[])'::regprocedure)) = 'c5cd3f9bd38ad283df7cdff0c572cf17' AND md5(pg_get_functiondef('public.fn_ca_settlement_lane_doctrine()'::regprocedure)) = 'e4ccdf257e371123a198e8a132889fab')

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $requires$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.fn_ca_share_tournament_lane_for_tables(uuid,uuid,uuid[],boolean)'))) IS DISTINCT FROM '76dddeb34b3508a48b777c2c79442072'
     OR md5(pg_get_functiondef(to_regprocedure('public.fn_ca_settlement_lane_doctrine()'))) IS DISTINCT FROM 'dba20d4f19dd94eab19506582ffb04f3'
     OR strpos(pg_get_functiondef(to_regprocedure('public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)')), 'fn_ca_promo_fee_state_ensure') = 0 THEN
    RAISE EXCEPTION 'event lane E4: 20261119053909 (lane E2) and 20261119054539 (lane E3) must be installed first';
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
    ('public.fn_ca_commit_hand_settlement_exact_before_obligations(uuid,bigint,jsonb,numeric,numeric,text,numeric,jsonb,jsonb,text,uuid)',
     'c555fb7b83c889312995bc0038c1b275', '95863075b8d44c6177dd893c946cd1b4',
     ARRAY[$o1$  /* Match the unchanged core and manager lock order before taking the mutable
     table row.  FOR SHARE excludes tournament lifecycle updates without
     serializing hands at distinct tables in the same event. */
  IF v_tournament_id IS NOT NULL THEN
    PERFORM 1
      FROM public.tournaments t
     WHERE t.id = v_tournament_id
     FOR SHARE;
$o1$],
     ARRAY[$n1$  /* Match the unchanged core and manager lock order before taking the mutable
     table row.  FOR KEY SHARE excludes DELETE, key updates and exclusive
     FOR UPDATE lifecycle transitions (which also hold T(id) EXCLUSIVE),
     while remaining compatible with FOR NO KEY UPDATE on the event's
     shared change lane so a move, break, rebuy or bust at another table
     never blocks this hand commit (incident 075013fd). */
  IF v_tournament_id IS NOT NULL THEN
    PERFORM 1
      FROM public.tournaments t
     WHERE t.id = v_tournament_id
     FOR KEY SHARE;
$n1$]),
    ('public.fn_ca_share_tournament_lane_for_tables(uuid,uuid,uuid[],boolean)',
     '76dddeb34b3508a48b777c2c79442072', 'da69a271d8cbcf56efdf61740fb4dcca',
     ARRAY[$o3$    PERFORM 1 FROM public.tournaments t WHERE t.id = p_tournament_id FOR UPDATE;
$o3$],
     ARRAY[$n3$    PERFORM 1 FROM public.tournaments t WHERE t.id = p_tournament_id FOR NO KEY UPDATE;
$n3$]),
    ('public.fn_lock_tournament_launch_proof_parents(uuid[])',
     '77e46e6a692bfadfa5537fe634791b9f', 'c5cd3f9bd38ad283df7cdff0c572cf17',
     ARRAY[$o4$  PERFORM 1
    FROM public.tournaments t
   WHERE t.id = ANY(v_ids)
   ORDER BY t.id
   FOR UPDATE;
$o4$],
     ARRAY[$n4$  PERFORM 1
    FROM public.tournaments t
   WHERE t.id = ANY(v_ids)
   ORDER BY t.id
   FOR NO KEY UPDATE;
$n4$]),
    ('public.fn_ca_lock_tournament_rebuy_acquisition(uuid,uuid,uuid)',
     '2ea19582f62ecd683304b1f85f17466c', '994a5f635442c907a9619186a718b9d3',
     ARRAY[$o5$  FROM public.tournaments t
  WHERE t.id = p_tournament_id
  FOR UPDATE;
$o5$],
     ARRAY[$n5$  FROM public.tournaments t
  WHERE t.id = p_tournament_id
  FOR NO KEY UPDATE;
$n5$]),
    ('public.fn_ca_process_tournament_chip_purchase_money_v1(uuid,uuid,text,numeric,numeric,integer,text)',
     '5ae262f9a0cffeb1908172c756ca5bf8', '3f70346d08dab755b774459900f89795',
     ARRAY[$o7$    FROM public.tournaments
   WHERE id=p_tournament_id
   FOR UPDATE;
$o7$],
     ARRAY[$n7$    FROM public.tournaments
   WHERE id=p_tournament_id
   FOR NO KEY UPDATE;
$n7$]),
    ('public.fn_ca_settle_bounty_rebuy_generation_v1(uuid,uuid,uuid)',
     'c879b710d42ee6514e603c1983558330', '1d249875178e01b1277bf11048b69d15',
     ARRAY[$o8$  SELECT * INTO v_t
    FROM public.tournaments t
   WHERE t.id=p_tournament_id
   FOR UPDATE;
$o8$],
     ARRAY[$n8$  SELECT * INTO v_t
    FROM public.tournaments t
   WHERE t.id=p_tournament_id
   FOR NO KEY UPDATE;
$n8$]),
    ('public.fn_move_tournament_player(uuid,uuid,uuid,uuid,integer,uuid,text)',
     '6feaec933d08af1aa821d17f3c5dc093', '272f9aeeee9ba5a63069b54ff565f1ba',
     ARRAY[$o9$  SELECT * INTO v_t FROM public.tournaments t
   WHERE t.id=p_tournament_id FOR UPDATE;
$o9$],
     ARRAY[$n9$  SELECT * INTO v_t FROM public.tournaments t
   WHERE t.id=p_tournament_id FOR NO KEY UPDATE;
$n9$]),
    ('smarter_private.f06_prefix(uuid,uuid,uuid[],uuid[])',
     '4c5e4678099189489491ea66d02d1e7a', '1e16d5871ead1df474172ca12cc2f0df',
     ARRAY[$o10$ PERFORM 1 FROM public.tournaments WHERE id=t FOR UPDATE;
$o10$],
     ARRAY[$n10$ PERFORM 1 FROM public.tournaments WHERE id=t FOR NO KEY UPDATE;
$n10$]),
    ('public.fn_close_tournament_entry_window(uuid,text)',
     'd0769704a1b0d503aa165c6b9d865502', '5588c742331539e4007ddd6f830e7295',
     ARRAY[$o11$  SELECT * INTO v_t
    FROM public.tournaments t
   WHERE t.id=p_tournament_id
   FOR UPDATE;
$o11$],
     ARRAY[$n11$  SELECT * INTO v_t
    FROM public.tournaments t
   WHERE t.id=p_tournament_id
   FOR NO KEY UPDATE;
$n11$]),
    ('public.fn_sweep_pending_tournament_bounties(uuid,integer)',
     'c023c1ff8910890f17132fee6d373252', 'a0c5e323a496d8630894d1cb4866c76b',
     ARRAY[$o12$      PERFORM 1 FROM public.tournaments t WHERE t.id=candidate.tournament_id FOR UPDATE;
$o12$],
     ARRAY[$n12$      PERFORM 1 FROM public.tournaments t WHERE t.id=candidate.tournament_id FOR NO KEY UPDATE;
$n12$]),
    ('public.fn_collect_bounty(uuid,uuid,uuid,jsonb)',
     '208d836177414ccc989bd47e941d83bb', '5cb29ef05c152217a3f4cf954522c1ad',
     ARRAY[$o13$  PERFORM 1 FROM public.tournaments t WHERE t.id=p_tournament_id FOR UPDATE;
$o13$, $o14$      INTO v_t FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
$o14$],
     ARRAY[$n13$  PERFORM 1 FROM public.tournaments t WHERE t.id=p_tournament_id FOR NO KEY UPDATE;
$n13$, $n14$      INTO v_t FROM tournaments WHERE id = p_tournament_id FOR NO KEY UPDATE;
$n14$]),
    ('public.fn_eliminate_tournament_player_atomic(uuid,uuid,integer,numeric,numeric)',
     '5098a06e22430936b7e40bbd59edc5c7', 'fa9815c71bff2884e2e752af2cfc0d20',
     ARRAY[$o15$  SELECT * INTO v_t FROM public.tournaments t
   WHERE t.id=p_tournament_id FOR UPDATE;
$o15$],
     ARRAY[$n15$  SELECT * INTO v_t FROM public.tournaments t
   WHERE t.id=p_tournament_id FOR NO KEY UPDATE;
$n15$]),
    ('public.fn_eliminate_player_legacy_candidate_20260907(uuid,uuid,integer,numeric,numeric)',
     '3c91100d1331ffb2a5710f5a2eeec60a', '98be141cf7a0b1d46823093f1ec581a1',
     ARRAY[$o16$  SELECT * INTO v_t FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
$o16$],
     ARRAY[$n16$  SELECT * INTO v_t FROM public.tournaments WHERE id=p_tournament_id FOR NO KEY UPDATE;
$n16$]),
    ('public.fn_claim_tournament_bounty_elimination(uuid,uuid,integer,numeric,uuid,uuid,bigint,timestamp with time zone,uuid,jsonb,numeric,boolean)',
     'd5bc2c4fdd9fa012371d069182f85f51', 'e87bec2423904ef2dadd67ddb3e8145e',
     ARRAY[$o17$  SELECT * INTO v_t FROM public.tournaments t
   WHERE t.id=p_tournament_id FOR UPDATE;
$o17$],
     ARRAY[$n17$  SELECT * INTO v_t FROM public.tournaments t
   WHERE t.id=p_tournament_id FOR NO KEY UPDATE;
$n17$]),
    ('public.fn_ca_open_tournament_seat_exit_authority(uuid,text,uuid)',
     '1b03285a00dc01df0f177e25ebe57147', '1a90f4f2de8d66dce95d29367a5478f4',
     ARRAY[$o18$  PERFORM 1 FROM public.tournaments t
   WHERE t.id=p_tournament_id FOR UPDATE;
$o18$],
     ARRAY[$n18$  PERFORM 1 FROM public.tournaments t
   WHERE t.id=p_tournament_id FOR NO KEY UPDATE;
$n18$]),
    ('public.fn_close_empty_tournament_table(uuid,uuid,uuid)',
     '0af954ab1264dc12ebce7741b7845343', '1aeb3847036a0f25f730794e1cbf1c4e',
     ARRAY[$o19$    FROM public.tournaments t
   WHERE t.id = p_tournament_id
   FOR UPDATE;
$o19$],
     ARRAY[$n19$    FROM public.tournaments t
   WHERE t.id = p_tournament_id
   FOR NO KEY UPDATE;
$n19$]),
    ('public.fn_sync_seat_first_player_count(uuid)',
     'a21e76bf87b92436866d0b4cd59735c1', '82936216ef62a12bcfb2f6d651055d1e',
     ARRAY[$o21$    FROM public.tournaments t
   WHERE t.id = p_tournament_id
   FOR UPDATE;
$o21$],
     ARRAY[$n21$    FROM public.tournaments t
   WHERE t.id = p_tournament_id
   FOR NO KEY UPDATE;
$n21$]),
    ('public.fn_ca_settlement_lane_doctrine()',
     'dba20d4f19dd94eab19506582ffb04f3', 'e4ccdf257e371123a198e8a132889fab',
     ARRAY[$o20$  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_violations) = 0,
$o20$],
     ARRAY[$n20$  -- 9. Hand commits and shared-change-lane writers never contend on the
  --    event row (20261119181500, incident 075013fd). Hand commits hold
  --    public.tournaments FOR KEY SHARE (never FOR SHARE), and shared-lane
  --    writers hold it FOR NO KEY UPDATE (never FOR UPDATE), so a move,
  --    break, rebuy, add-on, bust, sweep or entry close at Table A never
  --    blocks a hand commit at Table B.
  IF EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid IN (
                to_regprocedure('public.fn_ca_commit_hand_settlement_exact_before_obligations(uuid,bigint,jsonb,numeric,numeric,text,numeric,jsonb,jsonb,text,uuid)'),
                to_regprocedure('public.fn_ca_commit_hand_settlement_before_lease_generation(uuid,bigint,jsonb,numeric,numeric,text,numeric,jsonb,jsonb)'))
          AND (p.prosrc !~* 'FROM\s+public\.tournaments\s+t\s+WHERE\s+t\.id\s*=\s*v_tournament_id\s+FOR\s+KEY\s+SHARE'
               OR p.prosrc ~* 'FROM\s+public\.tournaments\s+t\s+WHERE\s+t\.id\s*=\s*v_tournament_id\s+FOR\s+SHARE'))
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid IN (
                to_regprocedure('public.fn_ca_share_tournament_lane_for_tables(uuid,uuid,uuid[],boolean)'),
                to_regprocedure('public.fn_lock_tournament_launch_proof_parents(uuid[])'),
                to_regprocedure('public.fn_ca_lock_tournament_rebuy_acquisition(uuid,uuid,uuid)'),
                to_regprocedure('public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)'),
                to_regprocedure('public.fn_ca_process_tournament_chip_purchase_money_v1(uuid,uuid,text,numeric,numeric,integer,text)'),
                to_regprocedure('public.fn_ca_settle_bounty_rebuy_generation_v1(uuid,uuid,uuid)'),
                to_regprocedure('public.fn_move_tournament_player(uuid,uuid,uuid,uuid,integer,uuid,text)'),
                to_regprocedure('smarter_private.f06_prefix(uuid,uuid,uuid[],uuid[])'),
                to_regprocedure('public.fn_close_tournament_entry_window(uuid,text)'),
                to_regprocedure('public.fn_sweep_pending_tournament_bounties(uuid,integer)'),
                to_regprocedure('public.fn_collect_bounty(uuid,uuid,uuid,jsonb)'),
                to_regprocedure('public.fn_eliminate_tournament_player_atomic(uuid,uuid,integer,numeric,numeric)'),
                to_regprocedure('public.fn_eliminate_player_legacy_candidate_20260907(uuid,uuid,integer,numeric,numeric)'),
                to_regprocedure('public.fn_claim_tournament_bounty_elimination(uuid,uuid,integer,numeric,uuid,uuid,bigint,timestamp with time zone,uuid,jsonb,numeric,boolean)'),
                to_regprocedure('public.fn_ca_open_tournament_seat_exit_authority(uuid,text,uuid)'),
                to_regprocedure('public.fn_close_empty_tournament_table(uuid,uuid,uuid)'),
                to_regprocedure('public.fn_sync_seat_first_player_count(uuid)'))
          AND p.prosrc ~* 'FROM\s+(?:public\.)?tournaments\b[^;]*FOR\s+UPDATE') THEN
    v_violations := v_violations || jsonb_build_object('rule', 'shared_lane_and_hand_commit_never_contend_on_event_row');
  END IF;

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_violations) = 0,
$n20$])
    ) AS s(signature, preimage, postimage, olds, news)
  LOOP
    v_sig := r.signature::regprocedure;
    v_def := pg_get_functiondef(v_sig);
    IF md5(v_def) <> r.preimage THEN
      RAISE EXCEPTION 'event lane E4: % is not the pinned pre-image (md5 %)', r.signature, md5(v_def);
    END IF;
    FOR i IN 1 .. cardinality(r.olds) LOOP
      v_n := (length(v_def) - length(replace(v_def, r.olds[i], ''))) / length(r.olds[i]);
      IF v_n <> 1 THEN
        RAISE EXCEPTION 'event lane E4: % anchor % occurs % times', r.signature, i, v_n;
      END IF;
      v_def := replace(v_def, r.olds[i], r.news[i]);
    END LOOP;
    IF md5(v_def) <> r.postimage THEN
      RAISE EXCEPTION 'event lane E4: % would not land on its reviewed post-image (md5 %)', r.signature, md5(v_def);
    END IF;
    SELECT p.proacl::text, p.proowner, p.prosecdef, p.proconfig
      INTO v_acl, v_owner, v_definer, v_config FROM pg_proc p WHERE p.oid = v_sig;
    EXECUTE v_def;
    IF md5(pg_get_functiondef(v_sig)) <> r.postimage
       OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_sig
            AND p.proacl::text IS NOT DISTINCT FROM v_acl AND p.proowner = v_owner
            AND p.prosecdef = v_definer AND p.proconfig IS NOT DISTINCT FROM v_config) THEN
      RAISE EXCEPTION 'event lane E4: % did not land on its post-image, or its metadata changed', r.signature;
    END IF;
  END LOOP;
END $subs$;

-- Anchored rewrite for fn_ca_commit_hand_settlement_before_lease_generation so
-- this migration composes cleanly with 20261119141104 (#11409) regardless of
-- pre-image MD5.
DO $hand_before_lease$
DECLARE
  v_sig regprocedure := 'public.fn_ca_commit_hand_settlement_before_lease_generation(uuid,bigint,jsonb,numeric,numeric,text,numeric,jsonb,jsonb)'::regprocedure;
  v_def text := pg_get_functiondef(v_sig);
  v_old text := $o2$    IF v_tournament_id IS NOT NULL THEN
      PERFORM 1 FROM public.tournaments t WHERE t.id=v_tournament_id FOR SHARE;
$o2$;
  v_new text := $n2$    IF v_tournament_id IS NOT NULL THEN
      PERFORM 1 FROM public.tournaments t WHERE t.id=v_tournament_id FOR KEY SHARE;
$n2$;
  v_n integer;
  v_acl text; v_owner oid; v_definer boolean; v_config text[];
BEGIN
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'event lane E4: fn_ca_commit_hand_settlement_before_lease_generation anchor occurs % times', v_n;
  END IF;
  SELECT p.proacl::text, p.proowner, p.prosecdef, p.proconfig
    INTO v_acl, v_owner, v_definer, v_config FROM pg_proc p WHERE p.oid = v_sig;
  EXECUTE replace(v_def, v_old, v_new);
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_sig
       AND p.prosrc ~* 'FROM\s+public\.tournaments\s+t\s+WHERE\s+t\.id=v_tournament_id\s+FOR\s+KEY\s+SHARE;'
       AND p.prosrc !~* 'FROM\s+public\.tournaments\s+t\s+WHERE\s+t\.id=v_tournament_id\s+FOR\s+SHARE;'
       AND p.proacl::text IS NOT DISTINCT FROM v_acl AND p.proowner = v_owner
       AND p.prosecdef = v_definer AND p.proconfig IS NOT DISTINCT FROM v_config) THEN
    RAISE EXCEPTION 'event lane E4: fn_ca_commit_hand_settlement_before_lease_generation did not land on FOR KEY SHARE, or its metadata changed';
  END IF;
END $hand_before_lease$;

-- Anchored rewrite for process_tournament_rebuy (add-on path) so this
-- migration composes cleanly in either merge order with 20261119175942
-- (which edits the disjoint pre-lane block of process_tournament_rebuy).
DO $rebuy_addon$
DECLARE
  v_sig regprocedure := 'public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure;
  v_def text := pg_get_functiondef(v_sig);
  v_old text := $o6$    SELECT * INTO v_t FROM public.tournaments t
     WHERE t.id=p_tournament_id FOR UPDATE;
$o6$;
  v_new text := $n6$    SELECT * INTO v_t FROM public.tournaments t
     WHERE t.id=p_tournament_id FOR NO KEY UPDATE;
$n6$;
  v_n integer;
  v_acl text; v_owner oid; v_definer boolean; v_config text[];
BEGIN
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'event lane E4: process_tournament_rebuy anchor occurs % times', v_n;
  END IF;
  SELECT p.proacl::text, p.proowner, p.prosecdef, p.proconfig
    INTO v_acl, v_owner, v_definer, v_config FROM pg_proc p WHERE p.oid = v_sig;
  EXECUTE replace(v_def, v_old, v_new);
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_sig
       AND p.prosrc ~* 'FROM\s+public\.tournaments\s+t\s+WHERE\s+t\.id=p_tournament_id\s+FOR\s+NO\s+KEY\s+UPDATE;'
       AND p.prosrc !~* 'FROM\s+(?:public\.)?tournaments\b[^;]*FOR\s+UPDATE'
       AND p.proacl::text IS NOT DISTINCT FROM v_acl AND p.proowner = v_owner
       AND p.prosecdef = v_definer AND p.proconfig IS NOT DISTINCT FROM v_config) THEN
    RAISE EXCEPTION 'event lane E4: process_tournament_rebuy did not land on FOR NO KEY UPDATE, or its metadata changed';
  END IF;
END $rebuy_addon$;

-- Probes (scripts/ci/templates/function-probe.sql): each probe runs once in a
-- subtransaction that is always undone, using a non-existent id so no live
-- lock is held. Full concurrent behaviour runs natively in
-- scripts/ci/test-rebuy-never-pauses-the-tournament.py (section LANE E4).

-- @probe-for: public.fn_ca_share_tournament_lane_for_tables
DO $probe$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  IF NOT public.fn_ca_share_tournament_lane_for_tables(v_id, NULL, ARRAY[gen_random_uuid()])
     OR NOT smarter_private.tournament_rebuy_lane_held(v_id, NULL) THEN
    RAISE EXCEPTION 'event lane E4: fn_ca_share_tournament_lane_for_tables probe failed';
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_lock_tournament_launch_proof_parents
DO $probe$
BEGIN
  PERFORM * FROM public.fn_lock_tournament_launch_proof_parents(ARRAY[]::uuid[]);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_ca_lock_tournament_rebuy_acquisition
DO $probe$
DECLARE v_t uuid := gen_random_uuid(); v_u uuid := gen_random_uuid(); v_r jsonb;
BEGIN
  PERFORM public.fn_ca_share_tournament_lane_for_rebuy(v_t, v_u);
  v_r := public.fn_ca_lock_tournament_rebuy_acquisition(v_t, NULL, v_u);
  IF v_r->>'reason' IS DISTINCT FROM 'tournament_not_found' THEN
    RAISE EXCEPTION 'event lane E4: fn_ca_lock_tournament_rebuy_acquisition probe unexpected: %', v_r;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_close_tournament_entry_window
DO $probe$
BEGIN
  PERFORM public.fn_close_tournament_entry_window(gen_random_uuid(), 'migration.probe');
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_sweep_pending_tournament_bounties
DO $probe$
BEGIN
  PERFORM public.fn_sweep_pending_tournament_bounties(gen_random_uuid(), 1);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_collect_bounty
DO $probe$
BEGIN
  PERFORM public.fn_collect_bounty(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), '[]'::jsonb);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_eliminate_tournament_player_atomic
DO $probe$
BEGIN
  PERFORM public.fn_eliminate_tournament_player_atomic(gen_random_uuid(), gen_random_uuid(), 1, 0, 0);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_sync_seat_first_player_count
DO $probe$
BEGIN
  PERFORM public.fn_sync_seat_first_player_count(gen_random_uuid());
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_ca_settlement_lane_doctrine
DO $probe$
DECLARE v_doctrine jsonb;
BEGIN
  v_doctrine := public.fn_ca_settlement_lane_doctrine();
  IF COALESCE((v_doctrine ->> 'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'event lane E4: the lane doctrine fails after the change: %', v_doctrine;
  END IF;
END $probe$;

-- @probe-exempt: public.fn_ca_commit_hand_settlement_exact_before_obligations is an internal postgres-only hand commit authority; executed natively by the harness
-- @probe-exempt: public.fn_ca_commit_hand_settlement_before_lease_generation is an internal postgres-only hand commit authority; executed natively by the harness
-- @probe-exempt: public.process_tournament_rebuy requires an authenticated/service purchase context and idempotency receipt; executed natively by the harness
-- @probe-exempt: public.fn_ca_process_tournament_chip_purchase_money_v1 is an internal purchase money core; executed natively by the harness
-- @probe-exempt: public.fn_ca_settle_bounty_rebuy_generation_v1 requires a knockout candidate under the rebuy lane; executed natively by the harness
-- @probe-exempt: public.fn_move_tournament_player requires the engine's service authority (fn_caller_is_engine); executed natively by the harness
-- @probe-exempt: smarter_private.f06_prefix requires a live protocol-2 engine lease (f06_authority); executed natively by the harness
-- @probe-exempt: public.fn_eliminate_player_legacy_candidate_20260907 is an internal elimination authority; executed natively by the harness
-- @probe-exempt: public.fn_claim_tournament_bounty_elimination requires engine/service elimination context; executed natively by the harness
-- @probe-exempt: public.fn_ca_open_tournament_seat_exit_authority requires a live tournament row; executed natively by the harness
-- @probe-exempt: public.fn_close_empty_tournament_table requires a live protocol-2 engine lease; executed natively by the harness

COMMIT;
