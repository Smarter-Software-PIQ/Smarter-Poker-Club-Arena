-- 20261127005018_invoker_functions_pin_their_search_path.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- The Supabase security advisor reported 37 routines in public and
-- smarter_private whose search_path is not pinned
-- (function_search_path_mutable), read on 2026-11-27. None of the 37 is
-- SECURITY DEFINER and every one is owned by postgres, so none of them runs
-- with rights its caller does not already hold. A pinned path still matters:
-- a routine without one resolves every unqualified name through whatever path
-- its CALLER has set, so a caller that puts its own schema first can hand it a
-- different table, operator or function than the one its author meant. This
-- pins 23 of them to `public, pg_temp`: public is where every relation they
-- name lives, pg_catalog is always searched first, and pg_temp is named last so
-- that a session's temporary table can never shadow a public one.
--
-- Every body was read before choosing the value. All 23 resolve only
-- pg_catalog built-ins and public objects (most name public.* explicitly; the
-- one unqualified relation, notice_board_entries in
-- fn_escalate_cashout_to_notice_board, is public). None calls an extension
-- function (gen_random_uuid, digest, crypt, ...) unqualified, so none needs
-- `extensions` on its path. The behaviour of every one is unchanged.
--
-- THE 14 THAT STAY UNPINNED, each for a reason a pin would make worse:
--
--   * Five procedures COMMIT inside their bodies. PostgreSQL refuses
--     transaction control in a procedure that carries a SET clause ("invalid
--     transaction termination"), so a pin would stop each at its first COMMIT:
--       public.sp_ca_promo_profit_hourly_sweep(integer)
--       public.sp_ca_resolve_settled_financial_alerts_in_pages(integer,integer)
--       public.sp_drain_daily_challenge_event_outbox(integer,integer,integer)
--       public.sp_union_pnl_projection_build(integer,integer,integer,integer)
--       smarter_private.weekly_prep_shard(integer,integer)
--     Three of them already pin their path from inside, with
--     set_config('search_path', ..., true) after each COMMIT, which is the only
--     way a committing procedure can.
--
--   * Three solver functions are part of the sealed qualification fingerprint.
--     fn_gto_v31_seal_qualification_fingerprint() hashes the definition and
--     proconfig of every public function whose name contains gto_v31, and
--     gto_v31_seal_cell_preparations rows are matched on that fingerprint, so a
--     pin would orphan every stored preparation:
--       public.fn_gto_v31_public215_cards(text,jsonb)
--       public.fn_gto_v31_public215_keys(jsonb,text[])
--       public.fn_gto_v31_public215_runtime_protocol_valid(jsonb,jsonb)
--
--   * Six SQL functions are inlined by the planner into set-oriented reads over
--     large tables (confirmed on production with EXPLAIN VERBOSE). A SET clause
--     disables inlining: measured on PostgreSQL 16 over a million rows, the
--     snapshot predicate went from 0.42 s to 4.0 s and a one-line predicate
--     from 0.09 s to 1.1 s. Every one names only pg_catalog built-ins and
--     public objects explicitly (the union_pnl pair even spells
--     OPERATOR(pg_catalog.=)), so a caller's path has nothing to redirect, and
--     no browser role may EXECUTE any of them:
--       public.fn_ca_club_acct_in_snapshot(xid,pg_snapshot)
--         per row of a club history day load
--       public.fn_ca_club_acct_before_snapshot(xid,pg_snapshot)
--         per row of a club history day load
--       public.fn_union_pnl_tournament_entry_club_of(text,numeric,uuid,uuid,uuid,jsonb)
--         per touched registration (4.9M calls observed)
--       public.fn_union_pnl_touched_registrations(timestamptz,timestamptz,boolean)
--         set-returning, read by the union P&L evidence report
--       public.fn_messenger_continuity_visible(uuid,uuid)
--         its own header says it must inline so its predicates reach indexes
--       public.fn_diamond_kind_bucket(text,text,text,bigint)
--         lateral per row of diamond_transactions (613k rows)
--
-- The advisor therefore reports 14 after this, each one listed above.
--
-- SIDE EFFECTS, checked against production before writing this:
--   * fn_ca_guard_watchlist() is itself on the guard watchlist, so its
--     definition hash moves; it is declared in this transaction through
--     fn_ca_declare_guard_redefinition, so fn_ca_guard_defs_watch has nothing
--     to raise.
--   * trg_autorevoke_privileged_anon fires on ALTER FUNCTION and, by name,
--     revokes PUBLIC/anon EXECUTE on six of these (diamond, cashout, promo,
--     treasury). None of the six holds a PUBLIC or anon grant and all six are
--     already in privileged_function_lock, so that is a no-op. No grant is
--     changed here: the verify step below refuses the transaction if any ACL
--     differs from what it was before the first ALTER.
--   * No function body, owner, volatility or grant changes, and no relation is
--     locked: ALTER FUNCTION locks only the function object, and calling a
--     function takes no lock on it.
--
-- A function absent on a fresh rebuild is skipped (to_regprocedure), never an
-- error. Not a repair job; no row is written except the guard declaration.
--
-- @live-proof: (SELECT count(p.oid) > 0 AND bool_and(p.oid IS NULL OR EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c = 'search_path=public, pg_temp')) FROM unnest(ARRAY['public.fn_accounting_close_report_is_ready(jsonb)','public.fn_accounting_tournament_source_terms_at(uuid,timestamp with time zone,jsonb)','public.fn_agent_commission_paid_by_period(uuid,uuid,timestamp with time zone)','public.fn_ca_bust_backlog_stalled(integer)','public.fn_ca_guard_watchlist()','public.fn_ca_hand_notes_touch()','public.fn_ca_hand_tags_ok(text[])','public.fn_ca_horse_split_op_key(uuid,text,uuid,uuid)','public.fn_ca_knockout_door_stalled(integer)','public.fn_ca_normalize_alert_text(text)','public.fn_ca_promo_profit_generation_immutable()','public.fn_ca_stable_dedupe_key(text)','public.fn_ca_stranded_fee_reconciliations_immutable()','public.fn_diamond_kind_row_label(text,bigint)','public.fn_diamond_ledger_line(text,text,text,bigint,text)','public.fn_enforce_tournament_capacity()','public.fn_escalate_cashout_to_notice_board(uuid,uuid,text)','public.fn_platform_push_recipient_guard()','public.fn_post_commit_handoff_is_a_warning()','public.fn_sp_relaunch_award_guard()','public.fn_union_treasury_is_collection(text)','public.player_line(public.diamond_transactions)','public.zz_a_payout_row_carries_its_key()']) s(sig) LEFT JOIN pg_proc p ON p.oid = to_regprocedure(s.sig))

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '8s';

DO $pin_search_path$
DECLARE
  -- The 23 routines this pins. The verify step below checks exactly this list.
  c_pinned CONSTANT text[] := ARRAY[
    'public.fn_accounting_close_report_is_ready(jsonb)',
    'public.fn_accounting_tournament_source_terms_at(uuid,timestamp with time zone,jsonb)',
    'public.fn_agent_commission_paid_by_period(uuid,uuid,timestamp with time zone)',
    'public.fn_ca_bust_backlog_stalled(integer)',
    'public.fn_ca_guard_watchlist()',
    'public.fn_ca_hand_notes_touch()',
    'public.fn_ca_hand_tags_ok(text[])',
    'public.fn_ca_horse_split_op_key(uuid,text,uuid,uuid)',
    'public.fn_ca_knockout_door_stalled(integer)',
    'public.fn_ca_normalize_alert_text(text)',
    'public.fn_ca_promo_profit_generation_immutable()',
    'public.fn_ca_stable_dedupe_key(text)',
    'public.fn_ca_stranded_fee_reconciliations_immutable()',
    'public.fn_diamond_kind_row_label(text,bigint)',
    'public.fn_diamond_ledger_line(text,text,text,bigint,text)',
    'public.fn_enforce_tournament_capacity()',
    'public.fn_escalate_cashout_to_notice_board(uuid,uuid,text)',
    'public.fn_platform_push_recipient_guard()',
    'public.fn_post_commit_handoff_is_a_warning()',
    'public.fn_sp_relaunch_award_guard()',
    'public.fn_union_treasury_is_collection(text)',
    'public.player_line(public.diamond_transactions)',
    'public.zz_a_payout_row_carries_its_key()'
  ];
  v_sig     text;
  v_fn      regprocedure;
  v_acl     jsonb := '{}'::jsonb;
  v_present integer := 0;
  v_bad     text;
BEGIN
  -- Record every grant first, so the verify step can prove none moved.
  FOREACH v_sig IN ARRAY c_pinned LOOP
    v_fn := to_regprocedure(v_sig);
    IF v_fn IS NULL THEN
      RAISE NOTICE 'pin search_path: % is absent here; skipped', v_sig;
      CONTINUE;
    END IF;
    v_acl := v_acl || jsonb_build_object(v_sig,
      (SELECT COALESCE(p.proacl::text, '') FROM pg_proc p WHERE p.oid = v_fn));
  END LOOP;

  FOREACH v_sig IN ARRAY c_pinned LOOP
    v_fn := to_regprocedure(v_sig);
    CONTINUE WHEN v_fn IS NULL;
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', v_fn);
    v_present := v_present + 1;
  END LOOP;

  -- fn_ca_guard_watchlist is a watched guard; declare its new definition in
  -- this same transaction so fn_ca_guard_defs_watch records it, not raises it.
  IF to_regprocedure('public.fn_ca_guard_watchlist()') IS NOT NULL
     AND to_regprocedure('public.fn_ca_declare_guard_redefinition(text,text)') IS NOT NULL THEN
    PERFORM public.fn_ca_declare_guard_redefinition('fn_ca_guard_watchlist',
      'migration 20261127005018_invoker_functions_pin_their_search_path');
  END IF;

  -- VERIFY: none of the listed routines is still mutable, and every one holds
  -- exactly the path this set.
  SELECT string_agg(s.sig, ', ' ORDER BY s.sig) INTO v_bad
    FROM unnest(c_pinned) s(sig)
    JOIN pg_proc p ON p.oid = to_regprocedure(s.sig)
   WHERE NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c = 'search_path=public, pg_temp');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'pin search_path: still mutable after ALTER: %', v_bad;
  END IF;

  -- VERIFY: no grant moved (trg_autorevoke_privileged_anon fires on ALTER FUNCTION).
  SELECT string_agg(s.sig, ', ' ORDER BY s.sig) INTO v_bad
    FROM unnest(c_pinned) s(sig)
    JOIN pg_proc p ON p.oid = to_regprocedure(s.sig)
   WHERE COALESCE(p.proacl::text, '') IS DISTINCT FROM v_acl ->> s.sig;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'pin search_path: EXECUTE grants changed on: %', v_bad;
  END IF;

  RAISE NOTICE 'pin search_path: % of % routines pinned to public, pg_temp',
    v_present, cardinality(c_pinned);
END
$pin_search_path$;

COMMIT;
