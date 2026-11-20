-- 20261119185300_remaining_tournament_row_locks_never_block_hands.sql
--
-- REMAINING SHARED-LANE TOURNAMENT ROW LOCKS NEVER BLOCK A HAND COMMIT
-- (incident 075013fd, lag-finish lane 6). Owner rules: "REBUYS IN A TOURNAMENT
-- SHOULD NOT PAUSE THE ACTION" (Dan, 2026-08-30); "i just don't want any
-- 'un intended delays'" (Dan, 2026-11-18).
--
-- COORDINATION WITH 20261119181500 (#11437 / #11451, installed on production).
-- Migration 20261119181500 already downgraded fn_sweep_pending_tournament_bounties
-- (a0c5e323a496d8630894d1cb4866c76b) and fn_move_tournament_player
-- (272f9aeeee9ba5a63069b54ff565f1ba) to FOR NO KEY UPDATE on public.tournaments.
--
-- Four remaining shared-lane paths still took FOR UPDATE (3) or FOR SHARE (1)
-- on public.tournaments:
--
--   1. public.fn_register_for_tournament_before_atomic_capacity_20260907(uuid,boolean)
--      locked public.tournaments FOR UPDATE during human late registration and
--      updated only non-key columns (current_players, prize_pool, bounty_pool,
--      total_rake).
--   2. public.fn_register_horse_for_tournament_before_maintenance_gate(uuid,uuid)
--      locked public.tournaments FOR UPDATE during horse late registration and
--      updated only non-key columns (current_players, prize_pool, bounty_pool,
--      total_rake).
--   3. public.trg_refuse_finalized_tournament_entry()
--      BEFORE INSERT trigger on public.tournament_players locked
--      public.tournaments FOR UPDATE (read-only check of prize_pool_finalized).
--   4. public.fn_terminal_tournament_seat_is_immutable()
--      BEFORE INSERT trigger on public.table_seats locked public.tournaments
--      and public.tables FOR SHARE, which conflicts with FOR NO KEY UPDATE and
--      non-key UPDATEs on tournaments (prize_pool/current_players) and tables.
--
-- THE FIX (PostgreSQL native row-lock hierarchy, completing lanes 3 & 20261119181500).
--   - Require 20261119181500's post-images for fn_sweep_pending_tournament_bounties
--     and fn_move_tournament_player without touching them.
--   - Downgrade the 3 remaining shared-lane FOR UPDATE locks on public.tournaments
--     to FOR NO KEY UPDATE. None updates any primary or unique key column on
--     public.tournaments.
--   - Downgrade the BEFORE INSERT branch of fn_terminal_tournament_seat_is_immutable
--     from FOR SHARE to FOR KEY SHARE on public.tournaments and public.tables.
--
-- SAFETY & INVARIANTS.
--   - FOR NO KEY UPDATE is 100% compatible with FOR KEY SHARE (hand commits,
--     hand retention, and terminal-seat INSERT guard), so late registration
--     never blocks unrelated tables' hand commits on the tournament row.
--   - FOR NO KEY UPDATE still conflicts with FOR UPDATE, FOR NO KEY UPDATE,
--     FOR SHARE and UPDATE, so concurrent registrations, pool/bounty writers,
--     pool finalization (prize_pool_finalized) and every lifecycle/terminal
--     authority remain 100% serialized.
--   - FOR KEY SHARE still conflicts with FOR UPDATE (and DELETE / key UPDATE),
--     so terminal settlement, cancellation and table closure still exclude new
--     tournament seats 100%.
--   - Zero schema changes, zero moved columns, 100% of financial accounting
--     invariants preserved unchanged.
--
-- Native proof (PostgreSQL 16/17, production pre-images md5-pinned):
-- scripts/ci/test-remaining-tournament-row-locks-never-block-hands.py.
-- Law: tests/remaining-tournament-row-locks-never-block-hands.law.test.ts.
--
-- LOCK FOOTPRINT. CREATE OR REPLACE FUNCTION only: no table or row lock, no
-- install window, one bounded transaction.
--
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_register_for_tournament_before_atomic_capacity_20260907(uuid,boolean)'::regprocedure)) = '37900645f6ca68121485fac99da09c29' AND md5(pg_get_functiondef('public.fn_register_horse_for_tournament_before_maintenance_gate(uuid,uuid)'::regprocedure)) = '8c8c58ba94bb0badf32402390385fff2' AND md5(pg_get_functiondef('public.trg_refuse_finalized_tournament_entry()'::regprocedure)) = 'fb1b875a9ee6a36fb37b2ef26ec6e8b4' AND md5(pg_get_functiondef('public.fn_terminal_tournament_seat_is_immutable()'::regprocedure)) = 'e6ced6a8a4470861f551d3a0c699040c')

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Require 20261119181500 (#11437) to be live (already converted sweep and move).
DO $requires$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.fn_sweep_pending_tournament_bounties(uuid,integer)'))) IS DISTINCT FROM 'a0c5e323a496d8630894d1cb4866c76b'
     OR md5(pg_get_functiondef(to_regprocedure('public.fn_move_tournament_player(uuid,uuid,uuid,uuid,integer,uuid,text)'))) IS DISTINCT FROM '272f9aeeee9ba5a63069b54ff565f1ba' THEN
    RAISE EXCEPTION 'remaining-tournament-row-locks: 20261119181500 must be installed first';
  END IF;
END $requires$;

-- Exact anchored substitutions on the remaining 4 pinned production pre-images.
-- Preserves owner, ACL, SECURITY DEFINER and proconfig on every function.
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
    ('public.fn_register_for_tournament_before_atomic_capacity_20260907(uuid,boolean)',
     'fd5e622d7edfbcb3e61938d57b8eb0c2', '37900645f6ca68121485fac99da09c29',
     ARRAY[$o1$    INTO v_t FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;$o1$],
     ARRAY[$n1$    INTO v_t FROM public.tournaments WHERE id = p_tournament_id FOR NO KEY UPDATE;$n1$]),

    ('public.fn_register_horse_for_tournament_before_maintenance_gate(uuid,uuid)',
     '0d9c8b345a093565b9e7b6f9cc1afe6b', '8c8c58ba94bb0badf32402390385fff2',
     ARRAY[$o2$    INTO v_t FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;$o2$],
     ARRAY[$n2$    INTO v_t FROM public.tournaments WHERE id = p_tournament_id FOR NO KEY UPDATE;$n2$]),

    ('public.trg_refuse_finalized_tournament_entry()',
     'd86d79923949a7f5434c5d2a286fdb49', 'fb1b875a9ee6a36fb37b2ef26ec6e8b4',
     ARRAY[$o3$    FROM public.tournaments t
   WHERE t.id = NEW.tournament_id
   FOR UPDATE;$o3$],
     ARRAY[$n3$    FROM public.tournaments t
   WHERE t.id = NEW.tournament_id
   FOR NO KEY UPDATE;$n3$]),

    ('public.fn_terminal_tournament_seat_is_immutable()',
     '10a5d9082f7770127359f9eca7068ed6', 'e6ced6a8a4470861f551d3a0c699040c',
     ARRAY[$o4$    SELECT upper(COALESCE(t.status::text,'')) INTO v_status
      FROM public.tournaments t
     WHERE t.id = v_new_tournament_id
     FOR SHARE;
    SELECT tb.terminal_closed_at INTO v_marker
      FROM public.tables tb
     WHERE tb.id = NEW.table_id
       AND tb.tournament_id = v_new_tournament_id
     FOR SHARE;$o4$],
     ARRAY[$n4$    SELECT upper(COALESCE(t.status::text,'')) INTO v_status
      FROM public.tournaments t
     WHERE t.id = v_new_tournament_id
     FOR KEY SHARE;
    SELECT tb.terminal_closed_at INTO v_marker
      FROM public.tables tb
     WHERE tb.id = NEW.table_id
       AND tb.tournament_id = v_new_tournament_id
     FOR KEY SHARE;$n4$])
    ) AS t(sig, pre_md5, post_md5, olds, news)
  LOOP
    v_sig := r.sig::regprocedure;
    SELECT proacl::text, proowner, prosecdef, proconfig
      INTO v_acl, v_owner, v_definer, v_config
      FROM pg_catalog.pg_proc WHERE oid = v_sig;
    v_def := pg_get_functiondef(v_sig);
    IF md5(v_def) <> r.pre_md5 THEN
      RAISE EXCEPTION 'remaining-tournament-row-locks: % pre-image drifted (got %, expected %)',
        r.sig, md5(v_def), r.pre_md5;
    END IF;
    FOR i IN 1..array_length(r.olds, 1) LOOP
      v_n := (length(v_def) - length(replace(v_def, r.olds[i], ''))) / length(r.olds[i]);
      IF v_n <> 1 THEN
        RAISE EXCEPTION 'remaining-tournament-row-locks: % anchor % found % times, expected 1',
          r.sig, i, v_n;
      END IF;
      v_def := replace(v_def, r.olds[i], r.news[i]);
    END LOOP;
    EXECUTE v_def;
    IF md5(pg_get_functiondef(v_sig)) <> r.post_md5 THEN
      RAISE EXCEPTION 'remaining-tournament-row-locks: % post-image mismatch (got %, expected %)',
        r.sig, md5(pg_get_functiondef(v_sig)), r.post_md5;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc
       WHERE oid = v_sig
         AND (proacl::text IS DISTINCT FROM v_acl
              OR proowner IS DISTINCT FROM v_owner
              OR prosecdef IS DISTINCT FROM v_definer
              OR proconfig IS DISTINCT FROM v_config)
    ) THEN
      RAISE EXCEPTION 'remaining-tournament-row-locks: % metadata changed on replace', r.sig;
    END IF;
  END LOOP;
END $subs$;

-- Install-time probe (always rolled back via probe-unwind).

-- @probe-for: public.fn_register_horse_for_tournament_before_maintenance_gate
DO $probe$
DECLARE v_r jsonb;
BEGIN
  v_r := public.fn_register_horse_for_tournament_before_maintenance_gate(gen_random_uuid(), gen_random_uuid());
  IF v_r->>'reason' IS DISTINCT FROM 'not_a_horse' THEN
    RAISE EXCEPTION 'register_horse probe unexpected: %', v_r;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-exempt: public.fn_register_for_tournament_before_atomic_capacity_20260907 requires an authenticated caller (auth.uid()) and live MTT admission contract; executed natively by the PG proof harness
-- @probe-exempt: public.trg_refuse_finalized_tournament_entry is a BEFORE INSERT trigger function on tournament_players; executed natively via INSERT in the PG proof harness
-- @probe-exempt: public.fn_terminal_tournament_seat_is_immutable is a BEFORE INSERT/UPDATE/DELETE trigger function on table_seats; executed natively via INSERT in the PG proof harness

COMMIT;
