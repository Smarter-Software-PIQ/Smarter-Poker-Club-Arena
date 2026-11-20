-- 20261119232617_hand_stacks_and_finishers_never_upgrade_event_row_lock.sql
--
-- HAND STACKS AND FINISHERS NEVER UPGRADE THE EVENT ROW LOCK
-- (incident 2ac23dbf-455f-4edd-823e-ca5cc9b06ac8, DatabaseDeadlocksElevated).
--
-- ROOT CAUSE.
-- Migration 20261119181500 (lane E4) downgraded the two outer hand-commit doors
-- (fn_ca_commit_hand_settlement_exact_before_obligations and
-- fn_ca_commit_hand_settlement_before_lease_generation) from FOR SHARE to
-- FOR KEY SHARE on public.tournaments, and downgraded 17 shared-lane writers
-- (rebuys, eliminations, moves, breaks, sweeps, entry close) from FOR UPDATE
-- to FOR NO KEY UPDATE on public.tournaments. Because FOR KEY SHARE and
-- FOR NO KEY UPDATE are compatible in PostgreSQL, a hand commit at Table A and
-- a shared-lane writer at Table A now hold public.tournaments concurrently.
--
-- Three nested/companion functions were missed by 20261119181500, creating two
-- live lock-upgrade deadlock cycles immediately after 20261119181500 installed
-- (46 deadlocks in 10 minutes during Afternoon Free Buy 1b630c53):
--
-- 1. fn_ca_settle_hand_stacks_absolute (called INSIDE every tournament hand
--    commit AFTER tables(A) FOR UPDATE is already held) still took
--    public.tournaments FOR SHARE. A concurrent rebuy, elimination or move on
--    Table A held tournaments FOR NO KEY UPDATE and waited for tables(A)
--    FOR UPDATE, while the hand commit held tables(A) FOR UPDATE and waited
--    to upgrade tournaments from FOR KEY SHARE to FOR SHARE -> 40P01 deadlock.
--
-- 2. fn_ca_pay_tournament_finishers_now (called at COMMIT by the deferred
--    trigger trg_ca_pay_tournament_finishers_at_commit on every elimination)
--    took T(id) EXCLUSIVE and public.tournaments FOR UPDATE BEFORE even
--    checking prize_pool_finalized. An elimination on Table A held tournaments
--    FOR NO KEY UPDATE + tables(A) FOR UPDATE; a hand commit on Table A held
--    tournaments FOR KEY SHARE and waited for tables(A) FOR UPDATE; at COMMIT
--    the elimination tried to upgrade tournaments to FOR UPDATE -> 40P01
--    deadlock (even during late registration when prize_pool_finalized=false).
--
-- 3. fn_decline_tournament_rebuy still took public.tournaments FOR UPDATE,
--    conflicting with hand commits' FOR KEY SHARE and shared-lane FOR NO KEY
--    UPDATE even though it never updates public.tournaments.
--
-- THE FIX & HARDENING.
-- 1. fn_ca_settle_hand_stacks_absolute takes public.tournaments FOR KEY SHARE
--    (matching both outer hand-commit doors).
-- 2. fn_ca_pay_tournament_finishers_now fast-exits before taking T(id) or
--    locking tournaments when status <> 'RUNNING' or prize_pool_finalized is
--    false (prize_pool_finalized is monotonic false->true and the finalizer's
--    own commit calls this trigger again), and locks public.tournaments
--    FOR NO KEY UPDATE (never FOR UPDATE) when paying finishers.
-- 3. fn_decline_tournament_rebuy takes public.tournaments FOR NO KEY UPDATE.
-- 4. Doctrine rule 9 (fn_ca_settlement_lane_doctrine) is expanded to enforce
--    all three functions on every future migration PR.
--
-- LOCK FOOTPRINT. CREATE OR REPLACE FUNCTION only: no table or row lock, no
-- install window, one transaction, one schema reload.
--
-- @stale-pin-ok: ff16a5b791b4e2d01b7ab4ee62a85c0e original_hand_correction_sources_match already answers false on production; moving one of its pins would not revive it
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_ca_settle_hand_stacks_absolute(uuid,bigint,jsonb,numeric,numeric,text,numeric)'::regprocedure)) = '23ca2aeef6fb62b0f329d52bf838217b' AND md5(pg_get_functiondef('public.fn_ca_pay_tournament_finishers_now(uuid)'::regprocedure)) = 'd340469dabb8ed33596f88169dd82635' AND md5(pg_get_functiondef('public.fn_decline_tournament_rebuy(uuid,uuid)'::regprocedure)) = 'ed8a4453012abc37046754d1dc02b975' AND md5(pg_get_functiondef('public.fn_ca_settlement_lane_doctrine()'::regprocedure)) = '217b2a2adab0c339ac48723a148d554c' AND (public.fn_ca_settlement_lane_doctrine()->>'ok')::boolean IS TRUE)

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $requires$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.fn_ca_settlement_lane_doctrine()'))) IS DISTINCT FROM 'e4ccdf257e371123a198e8a132889fab' THEN
    RAISE EXCEPTION 'deadlock fix 2ac23dbf: 20261119181500 (lane E4) must be installed first';
  END IF;
END $requires$;

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
    (
      'public.fn_ca_settle_hand_stacks_absolute(uuid,bigint,jsonb,numeric,numeric,text,numeric)',
      'ff16a5b791b4e2d01b7ab4ee62a85c0e',
      '23ca2aeef6fb62b0f329d52bf838217b',
      ARRAY[$o1$      SELECT upper(COALESCE(t.status::text,'')) INTO v_tournament_status
        FROM public.tournaments t
       WHERE t.id = v_tournament_id
       FOR SHARE;$o1$],
      ARRAY[$n1$      SELECT upper(COALESCE(t.status::text,'')) INTO v_tournament_status
        FROM public.tournaments t
       WHERE t.id = v_tournament_id
       FOR KEY SHARE;$n1$]
    ),
    (
      'public.fn_ca_pay_tournament_finishers_now(uuid)',
      'a5cdbc0cc72276d131ce9037599c4351',
      'd340469dabb8ed33596f88169dd82635',
      ARRAY[$o2$  -- The same rolling lane every place/bounty authority enters, then the row.
  PERFORM public.fn_ca_lock_settlement_lane_for_tournament(p_tournament_id);
  SELECT t.id, t.status, t.variant, t.tournament_type, t.satellite_target_id,
         t.satellite_target, t.prize_pool, t.prize_pool_finalized,
         t.bubble_protection, t.buy_in_amount
    INTO v_t FROM public.tournaments t
   WHERE t.id = p_tournament_id FOR UPDATE;$o2$],
      ARRAY[$n2$  -- Fast-exit before taking T(id) EXCLUSIVE or locking tournaments when the
  -- pool is not yet finalized (incident 2ac23dbf). prize_pool_finalized is
  -- monotonic false->true and the finalizer's own commit calls this again.
  SELECT t.status, t.prize_pool_finalized
    INTO v_t FROM public.tournaments t
   WHERE t.id = p_tournament_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'skipped','tournament_not_found');
  END IF;
  IF upper(COALESCE(v_t.status,'')) <> 'RUNNING' THEN
    RETURN jsonb_build_object('ok',true,'skipped','not_running');
  END IF;
  IF NOT COALESCE(v_t.prize_pool_finalized,false) THEN
    RETURN jsonb_build_object('ok',true,'skipped','pool_not_finalized');
  END IF;

  -- The same rolling lane every place/bounty authority enters, then the row
  -- FOR NO KEY UPDATE (never FOR UPDATE, so a deferred commit inside a
  -- shared-lane elimination never upgrades against a hand commit's FOR KEY SHARE).
  PERFORM public.fn_ca_lock_settlement_lane_for_tournament(p_tournament_id);
  SELECT t.id, t.status, t.variant, t.tournament_type, t.satellite_target_id,
         t.satellite_target, t.prize_pool, t.prize_pool_finalized,
         t.bubble_protection, t.buy_in_amount
    INTO v_t FROM public.tournaments t
   WHERE t.id = p_tournament_id FOR NO KEY UPDATE;$n2$]
    ),
    (
      'public.fn_decline_tournament_rebuy(uuid,uuid)',
      '54f45a527355428efbe7739dab2973cf',
      'ed8a4453012abc37046754d1dc02b975',
      ARRAY[$o3$  PERFORM 1 FROM public.tournaments t WHERE t.id=p_tournament_id FOR UPDATE;$o3$],
      ARRAY[$n3$  PERFORM 1 FROM public.tournaments t WHERE t.id=p_tournament_id FOR NO KEY UPDATE;$n3$]
    ),
    (
      'public.fn_ca_settlement_lane_doctrine()',
      'e4ccdf257e371123a198e8a132889fab',
      '217b2a2adab0c339ac48723a148d554c',
      ARRAY[$o4$                to_regprocedure('public.fn_ca_commit_hand_settlement_before_lease_generation(uuid,bigint,jsonb,numeric,numeric,text,numeric,jsonb,jsonb)'))
          AND (p.prosrc !~* 'FROM\s+public\.tournaments\s+t\s+WHERE\s+t\.id\s*=\s*v_tournament_id\s+FOR\s+KEY\s+SHARE'
               OR p.prosrc ~* 'FROM\s+public\.tournaments\s+t\s+WHERE\s+t\.id\s*=\s*v_tournament_id\s+FOR\s+SHARE'))
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid IN (
                to_regprocedure('public.fn_ca_share_tournament_lane_for_tables(uuid,uuid,uuid[],boolean)'),$o4$],
      ARRAY[$n4$                to_regprocedure('public.fn_ca_commit_hand_settlement_before_lease_generation(uuid,bigint,jsonb,numeric,numeric,text,numeric,jsonb,jsonb)'),
                to_regprocedure('public.fn_ca_settle_hand_stacks_absolute(uuid,bigint,jsonb,numeric,numeric,text,numeric)'))
          AND (p.prosrc !~* 'FROM\s+public\.tournaments\s+t\s+WHERE\s+t\.id\s*=\s*v_tournament_id\s+FOR\s+KEY\s+SHARE'
               OR p.prosrc ~* 'FROM\s+public\.tournaments\s+t\s+WHERE\s+t\.id\s*=\s*v_tournament_id\s+FOR\s+SHARE'))
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid IN (
                to_regprocedure('public.fn_ca_share_tournament_lane_for_tables(uuid,uuid,uuid[],boolean)'),
                to_regprocedure('public.fn_ca_pay_tournament_finishers_now(uuid)'),
                to_regprocedure('public.fn_decline_tournament_rebuy(uuid,uuid)'),$n4$]
    )
    ) AS t(sig, pre_md5, post_md5, olds, news)
  LOOP
    v_sig := to_regprocedure(r.sig);
    IF v_sig IS NULL THEN
      RAISE EXCEPTION 'deadlock fix 2ac23dbf: missing function %', r.sig;
    END IF;
    SELECT p.proowner, p.prosecdef, p.proconfig, COALESCE(p.proacl::text, '')
      INTO v_owner, v_definer, v_config, v_acl
      FROM pg_catalog.pg_proc p
     WHERE p.oid = v_sig;
    v_def := pg_get_functiondef(v_sig);
    IF md5(v_def) IS DISTINCT FROM r.pre_md5 THEN
      RAISE EXCEPTION 'deadlock fix 2ac23dbf: % pre-image drifted: got %, expected %',
        r.sig, md5(v_def), r.pre_md5;
    END IF;
    FOR i IN 1..array_length(r.olds, 1) LOOP
      v_n := (length(v_def) - length(replace(v_def, r.olds[i], ''))) / length(r.olds[i]);
      IF v_n <> 1 THEN
        RAISE EXCEPTION 'deadlock fix 2ac23dbf: % anchor % occurred % times (expected 1)',
          r.sig, i, v_n;
      END IF;
      v_def := replace(v_def, r.olds[i], r.news[i]);
    END LOOP;
    EXECUTE v_def;
    IF md5(pg_get_functiondef(v_sig)) IS DISTINCT FROM r.post_md5 THEN
      RAISE EXCEPTION 'deadlock fix 2ac23dbf: % post-image mismatch: got %, expected %',
        r.sig, md5(pg_get_functiondef(v_sig)), r.post_md5;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
       WHERE p.oid = v_sig
         AND (p.proowner IS DISTINCT FROM v_owner
              OR p.prosecdef IS DISTINCT FROM v_definer
              OR p.proconfig IS DISTINCT FROM v_config
              OR COALESCE(p.proacl::text, '') IS DISTINCT FROM v_acl)) THEN
      RAISE EXCEPTION 'deadlock fix 2ac23dbf: % metadata changed', r.sig;
    END IF;
  END LOOP;
END $subs$;

DO $verify_doctrine$
DECLARE
  v_doc jsonb;
BEGIN
  v_doc := public.fn_ca_settlement_lane_doctrine();
  IF COALESCE((v_doc->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'deadlock fix 2ac23dbf: settlement lane doctrine failed: %', v_doc;
  END IF;
END $verify_doctrine$;

NOTIFY pgrst, 'reload schema';

COMMIT;
