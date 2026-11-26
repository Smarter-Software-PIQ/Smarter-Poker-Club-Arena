-- 20261126181638_weekly_pnl_is_certified_before_the_money.sql
--
-- THE WEEK'S P&L IS CERTIFIED BEFORE THE MONEY, SO UNION INVOICES GO OUT
-- RIGHT AFTER THE 04:00 CHICAGO PAYOUT (Mondays 2026-11-16 and 2026-11-23).
--
-- ROOT CAUSE, proved from accounting_close_partials / accounting_close_certificates:
-- Union invoices are round 4 of fn_union_settlement_cascade, reached only
-- through fn_process_weekly_accounting_scope from job 564
-- (smarter_private.weekly_union_books_due), which waits for the payout
-- rounds to release the week. Only then does the scope's "postpaid
-- qualification" begin certifying the union P&L (fn_union_pnl_close_quality:
-- earned plan, pnl flows, linked, hands, touched, clubs), one budgeted step
-- per two-minute tick, and only after the scope's first visit had sealed the
-- week boundary's original inventory (fn_union_pnl_inventory_checkpoint_due,
-- called only from fn_process_weekly_accounting; sealed 2026-11-16 at 12:14,
-- 2026-11-23 at 06:23). Its inputs were final hours earlier: the week's
-- earned_plan_window partials were complete at 02:49 on 2026-11-16, and the
-- P&L reads nothing the payout writes. So every week the P&L started after
-- the money, and every P&L problem was discovered only after the payout:
--   2026-11-16: released 04:32, earned_plan certified 18:36, a pnl_flows
--               problem at 19:05, P&L ready 20:47, invoices 20:49.
--   2026-11-23: released 05:56, three defects found and fixed by hand
--               (11:47, 16:40, 20:05), invoices 20:05.
--
-- PERMANENT FIX:
-- 1. smarter_private.weekly_prep_caught_up(period_end, at) is true when the
--    closed week's preparation shards are idle: each shard's latest run for
--    the week (started by `at`) finished, did no unit, raised nothing, and
--    started in the last 10 minutes.
-- 2. smarter_private.weekly_pnl_precertify(period_end, at) works between the
--    week close (02:00) and ten minutes before the payout (03:50). First it
--    seals the boundary's original inventory exactly as
--    fn_process_weekly_accounting does (fn_union_pnl_inventory_checkpoint_due,
--    one bounded step a tick, under the scheduler's own try-lock, never in
--    the last 15 minutes before the payout). Then it certifies the closed
--    week's union P&L, once the week's cash is settled
--    (weekly_closed_week_cash_settled, 20261126175930) and preparation is
--    caught up. It runs the scope's own nonpaying qualification sequence,
--    verbatim in order and budget: fn_union_pnl_closed_book_barrier, the
--    scope's 'union-accounting:' key (TRY, never waits; preparation units
--    and late-source admissions share that key), attempt_begin(memo),
--    report_seed, fn_union_pnl_close_quality, the earned-plan advance loop,
--    report_keep, attempt_end. It moves no chips and writes no union run.
--    Its attempt deadline ends two minutes before the payout so it never
--    holds the scope key into the money. A ready report it keeps is the
--    one the post-payout scope seeds (fn_accounting_close_report_seed: same
--    inventory generation, computed after the week end, 72-hour proof,
--    no later certificate; the payout rounds write none), so after release
--    the scope goes straight to the cascade and round 4 sends the invoices.
--    A late source still invalidates as before: its admission deletes the
--    week's certificates and receipts, and the post-payout path recertifies.
-- 3. A P&L that is blocked by anything other than work in progress raises
--    ONE critical financial alert (deduplicated per union and week) before
--    the payout, instead of being found by hand in the afternoon.
-- 4. smarter_private.weekly_union_books_due calls it first while the week's
--    payout is not yet released; a NULL answer (nothing to do, gated, or
--    already certified) falls through to the unchanged logic.
--
-- weekly_union_books_due is rewritten from its own live definition: the
-- preimage md5 is pinned, the anchor must occur exactly once, owner/ACL/
-- security/config are proven unchanged, and the postimage must equal the
-- intended text.
--
-- @live-proof: (SELECT position('P&L IS CERTIFIED BEFORE THE MONEY (20261126)' IN pg_get_functiondef('smarter_private.weekly_union_books_due()'::regprocedure)) > 0 AND smarter_private.weekly_pnl_precertify(public.fn_union_week_start(clock_timestamp()) + interval '7 days', clock_timestamp()) IS NULL AND smarter_private.weekly_prep_caught_up(NULL, clock_timestamp()) IS FALSE AND NOT has_function_privilege('anon', 'smarter_private.weekly_pnl_precertify(timestamptz,timestamptz)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'smarter_private.weekly_pnl_precertify(timestamptz,timestamptz)', 'EXECUTE') AND NOT has_function_privilege('anon', 'smarter_private.weekly_prep_caught_up(timestamptz,timestamptz)', 'EXECUTE'))

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

DO $requires_closed_week_cash_settled$
BEGIN
  IF to_regprocedure('smarter_private.weekly_closed_week_cash_settled(timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'PNL_BEFORE_MONEY_REQUIRES_20261126175930' USING ERRCODE = '55000';
  END IF;
END
$requires_closed_week_cash_settled$;

CREATE OR REPLACE FUNCTION smarter_private.weekly_prep_caught_up(p_end timestamptz, p_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $f$
-- P&L IS CERTIFIED BEFORE THE MONEY (20261126): the closed week's
-- preparation shards are idle. Each shard inserts its run row (finished_at
-- NULL) and commits before it works, so a shard that is working is seen.
SELECT p_end IS NOT NULL AND p_at IS NOT NULL
  AND EXISTS (SELECT 1 FROM smarter_private.weekly_prep_shard_runs r
               WHERE r.period_end = p_end AND r.started_at <= p_at)
  AND NOT EXISTS (
    SELECT 1 FROM (
      SELECT DISTINCT ON (r.shard) r.started_at, r.finished_at, r.units, r.last_error
        FROM smarter_private.weekly_prep_shard_runs r
       WHERE r.period_end = p_end AND r.started_at <= p_at
       ORDER BY r.shard, r.started_at DESC, r.id DESC) l
     WHERE l.finished_at IS NULL OR l.units IS DISTINCT FROM 0 OR l.last_error IS NOT NULL
        OR l.started_at < p_at - interval '10 minutes')
$f$;

REVOKE ALL ON FUNCTION smarter_private.weekly_prep_caught_up(timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION smarter_private.weekly_pnl_precertify(p_end timestamptz, p_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, public
AS $f$
-- P&L IS CERTIFIED BEFORE THE MONEY (20261126): certify the closed week's
-- union P&L between the week close and ten minutes before the payout, with
-- the scope's own nonpaying qualification sequence. NULL = nothing to do.
DECLARE
  s timestamptz;
  due timestamptz;
  v_unions uuid[];
  u uuid;
  q jsonb;
  kept boolean;
  quality_started timestamptz;
  batch_started timestamptz;
  batch_stop timestamptz;
  longest_step interval;
  prior_proof timestamptz;
  next_proof timestamptz;
  advance_result boolean;
  v_seal jsonb;
BEGIN
  IF p_end IS NULL OR p_at IS NULL OR NOT isfinite(p_end) OR p_end <> public.fn_union_week_start(p_end)
    OR p_at < p_end OR p_end > clock_timestamp() THEN
    RETURN NULL;
  END IF;
  due := public.fn_union_accounting_run_at(p_end);
  IF due IS NULL OR p_at >= due - interval '10 minutes' THEN RETURN NULL; END IF;
  IF COALESCE(current_setting('app.weekly_accounting_chunked', true), '') <> 'on'
    OR current_setting('transaction_isolation') <> 'read committed' THEN
    RETURN NULL;
  END IF;
  IF public.fn_platform_frozen() IS NOT FALSE OR public.fn_entry_purchases_frozen() IS NOT FALSE THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.weekly_accounting_payout_pauses p
              WHERE p.period_end = p_end AND p.instance_id = 'weekly-payout-rounds') THEN
    RETURN NULL;
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('union-pnl-precertify', 0)) THEN
    RETURN NULL;
  END IF;
  -- 1. The boundary's original inventory is sealed before any P&L reads it,
  --    one bounded step a tick, as fn_process_weekly_accounting seals it.
  IF NOT EXISTS (SELECT 1 FROM public.union_pnl_inventory_checkpoints c WHERE c.boundary = p_end) THEN
    IF p_at >= due - interval '15 minutes' OR public.fn_accounting_close_seal_held(p_end) IS NOT FALSE THEN
      RETURN NULL;
    END IF;
    IF NOT pg_try_advisory_xact_lock(hashtextextended('union-accounting-scheduler', 0)) THEN
      RETURN NULL;
    END IF;
    BEGIN
      v_seal := public.fn_union_pnl_inventory_checkpoint_due();
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.fn_raise_server_financial_alert(
        'warning', 'weekly_pnl_precertify',
        'Sealing the closed week''s original inventory before the payout failed; it is sealed after the payout as before.',
        jsonb_build_object('period_end', p_end, 'sqlstate', SQLSTATE, 'error', left(SQLERRM, 500)),
        'weekly-pnl-precertify-seal-failed:'||extract(epoch FROM p_end)::bigint::text,
        NULL);
      RETURN NULL;
    END;
    RETURN jsonb_build_object('stage', 'weekly_pnl_precertify_seal', 'period_end', p_end, 'seal', v_seal);
  END IF;
  -- 2. The P&L, once the week's cash is in and preparation is idle.
  IF public.fn_union_pnl_inventory_seal_in_progress() IS NOT FALSE
    OR smarter_private.weekly_closed_week_cash_settled(p_end) IS DISTINCT FROM true
    OR smarter_private.weekly_prep_caught_up(p_end, p_at) IS DISTINCT FROM true THEN
    RETURN NULL;
  END IF;
  s := public.fn_union_prev_week_start(p_end);
  SELECT array_agg(DISTINCT (j->>'id')::uuid) INTO v_unions
    FROM jsonb_array_elements(smarter_private.weekly_payout_scope_plan(p_end, p_at)) j
   WHERE j->>'kind' = 'union' AND (j->>'period_start')::timestamptz = s
     AND (j->>'period_end')::timestamptz = p_end;
  IF v_unions IS NULL THEN RETURN NULL; END IF;

  PERFORM public.fn_union_pnl_closed_book_barrier(p_end);
  FOREACH u IN ARRAY v_unions LOOP
   -- A week whose first close waits for a quiet hour (accounting_close_gates)
   -- waits here too; read passively, so its held-visit count is untouched.
   CONTINUE WHEN EXISTS (SELECT 1 FROM public.accounting_close_gates g
     WHERE g.scope_kind = 'union' AND g.scope_id = u AND g.period_start = s AND g.period_end = p_end
       AND clock_timestamp() < g.gate_until);
   -- A failed step rolls back only itself, files one warning, and lets the
   -- unchanged books logic run; the post-payout scope certifies as before.
   BEGIN
    -- Preparation units share this key and late-source admissions try it;
    -- never wait for it, never hold it into the money.
    IF NOT pg_try_advisory_xact_lock(hashtextextended('union-accounting:'||u::text||':'||extract(epoch FROM s)::text||':'||extract(epoch FROM p_end)::text,0)) THEN
      RETURN jsonb_build_object('stage', 'weekly_pnl_precertify_busy', 'union_id', u, 'period_end', p_end);
    END IF;
    PERFORM public.fn_weekly_accounting_attempt_begin(true);
    PERFORM set_config('app.weekly_accounting_scope_deadline',
      LEAST(NULLIF(current_setting('app.weekly_accounting_scope_deadline', true), '')::timestamptz,
            due - interval '2 minutes')::text, true);
    IF public.fn_accounting_close_report_seed(u, s, p_end) THEN
      -- Already certified and kept: the post-payout scope seeds this report.
      PERFORM public.fn_weekly_accounting_attempt_end();
      CONTINUE;
    END IF;
    quality_started := clock_timestamp();
    q := public.fn_union_pnl_close_quality(u, s, p_end);
    -- The scope's own earned-plan advance loop (fn_process_weekly_accounting_scope,
    -- postpaid qualification), verbatim in budget and exit rules.
    IF q->'issues' = '["union_pnl_certification_in_progress"]'::jsonb
      AND EXISTS (SELECT 1 FROM public.accounting_close_partials p
        WHERE p.kind = 'pnl_linked_window' AND p.union_id = u
          AND p.period_start = s AND p.period_end = p_end
          AND p.computed_at >= quality_started) THEN
      batch_stop := LEAST(
        NULLIF(current_setting('app.weekly_accounting_scope_deadline', true), '')::timestamptz - interval '60 seconds',
        NULLIF(current_setting('app.weekly_accounting_scope_deadline', true), '')::timestamptz
          - COALESCE(NULLIF(current_setting('app.weekly_accounting_scope_budget', true), ''), '8 minutes')::interval
          + interval '120 seconds');
      IF current_setting('statement_timeout') NOT IN ('0', '0ms') THEN
        batch_stop := LEAST(batch_stop,
          statement_timestamp() + current_setting('statement_timeout')::interval - interval '60 seconds');
      END IF;
      longest_step := clock_timestamp() - quality_started;
      LOOP
        EXIT WHEN batch_stop IS NULL OR clock_timestamp() + longest_step + interval '5 seconds' >= batch_stop;
        SELECT max(p.computed_at) INTO prior_proof
          FROM public.accounting_close_partials p
         WHERE p.kind IN ('pnl_linked_window', 'pnl_hands_window')
           AND p.union_id = u AND p.period_start = s AND p.period_end = p_end;
        batch_started := clock_timestamp();
        advance_result := public.fn_accounting_union_earned_plan_advance(u, s, p_end);
        longest_step := GREATEST(longest_step, clock_timestamp() - batch_started);
        EXIT WHEN advance_result IS DISTINCT FROM false;
        SELECT max(p.computed_at) INTO next_proof
          FROM public.accounting_close_partials p
         WHERE p.kind IN ('pnl_linked_window', 'pnl_hands_window')
           AND p.union_id = u AND p.period_start = s AND p.period_end = p_end;
        EXIT WHEN next_proof IS NOT DISTINCT FROM prior_proof;
      END LOOP;
    END IF;
    kept := public.fn_accounting_close_report_keep(u, s, p_end);
    PERFORM public.fn_weekly_accounting_attempt_end();
    IF q->>'status' IS DISTINCT FROM 'ready'
      AND q->'issues' IS DISTINCT FROM '["union_pnl_certification_in_progress"]'::jsonb THEN
      PERFORM public.fn_raise_server_financial_alert(
        'critical', 'weekly_pnl_precertify',
        'The closed week''s union P&L is blocked before the payout; union invoices wait until it is fixed.',
        jsonb_build_object('union_id', u, 'period_start', s, 'period_end', p_end,
          'payout_at', due, 'issues', q->'issues', 'reason', q->>'reason'),
        'weekly-pnl-precertify-blocked:'||u::text||':'||extract(epoch FROM p_end)::bigint::text,
        u::text);
    END IF;
    RETURN jsonb_build_object('stage', 'weekly_pnl_precertify', 'union_id', u, 'period_end', p_end,
      'status', q->>'status', 'issues', q->'issues', 'kept', COALESCE(kept, false));
   EXCEPTION WHEN OTHERS THEN
    PERFORM public.fn_weekly_accounting_attempt_end();
    PERFORM public.fn_raise_server_financial_alert(
      'warning', 'weekly_pnl_precertify',
      'Certifying the closed week''s union P&L before the payout failed; it is certified after the payout as before.',
      jsonb_build_object('union_id', u, 'period_end', p_end, 'sqlstate', SQLSTATE, 'error', left(SQLERRM, 500)),
      'weekly-pnl-precertify-failed:'||u::text||':'||extract(epoch FROM p_end)::bigint::text,
      u::text);
    RETURN NULL;
   END;
  END LOOP;
  RETURN NULL;
END
$f$;

REVOKE ALL ON FUNCTION smarter_private.weekly_pnl_precertify(timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;

DO $rewrite_weekly_union_books_precertify$
DECLARE
  c_books constant text := 'smarter_private.weekly_union_books_due()';
  old_books constant text := 'c4b8c5572632490aaa7fb03ac79de49e';
  anchor constant text := E'  due := public.fn_union_accounting_run_at(e);\n';
  repl text;
  d text;
  p text;
  m jsonb;
  m2 jsonb;
  k int;
BEGIN
  repl := anchor
    || E'  -- P&L IS CERTIFIED BEFORE THE MONEY (20261126): between the week close and\n'
    || E'  -- ten minutes before the payout, certify the closed week''s union P&L so the\n'
    || E'  -- released week goes straight to the cascade and its invoices. NULL = nothing\n'
    || E'  -- to do; the logic below is unchanged.\n'
    || E'  IF n >= e AND n < due THEN\n'
    || E'    v_tick := smarter_private.weekly_pnl_precertify(e, n);\n'
    || E'    IF v_tick IS NOT NULL THEN RETURN v_tick; END IF;\n'
    || E'  END IF;\n';
  d := pg_get_functiondef(c_books::regprocedure);
  IF md5(d) IS DISTINCT FROM old_books THEN
    RAISE EXCEPTION 'PNL_BEFORE_MONEY_PREIMAGE %', md5(d) USING ERRCODE = '55000';
  END IF;
  k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
  IF k <> 1 THEN
    RAISE EXCEPTION 'PNL_BEFORE_MONEY_ANCHOR_COUNT %', k USING ERRCODE = '55000';
  END IF;
  SELECT jsonb_build_object('o', proowner, 'a', proacl, 's', prosecdef, 'c', proconfig, 'v', provolatile, 'k', prokind)
    INTO m FROM pg_proc WHERE oid = c_books::regprocedure;
  p := replace(d, anchor, repl);
  EXECUTE p;
  SELECT jsonb_build_object('o', proowner, 'a', proacl, 's', prosecdef, 'c', proconfig, 'v', provolatile, 'k', prokind)
    INTO m2 FROM pg_proc WHERE oid = c_books::regprocedure;
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_books::regprocedure) <> p THEN
    RAISE EXCEPTION 'PNL_BEFORE_MONEY_POSTIMAGE' USING ERRCODE = '55000';
  END IF;
END
$rewrite_weekly_union_books_precertify$;

-- Behaviour probe (no data written: every case returns before any lock or write).
DO $probe_weekly_pnl_precertify$
DECLARE
  e constant timestamptz := public.fn_union_week_start(clock_timestamp());
BEGIN
  IF smarter_private.weekly_pnl_precertify(NULL, clock_timestamp()) IS NOT NULL
    OR smarter_private.weekly_pnl_precertify(e, NULL) IS NOT NULL
    -- not a week boundary
    OR smarter_private.weekly_pnl_precertify(e + interval '1 hour', clock_timestamp()) IS NOT NULL
    -- a week that has not closed
    OR smarter_private.weekly_pnl_precertify(e + interval '7 days', clock_timestamp()) IS NOT NULL
    -- at or after ten minutes before the payout
    OR smarter_private.weekly_pnl_precertify(e, public.fn_union_accounting_run_at(e) - interval '10 minutes') IS NOT NULL
    -- before the week close
    OR smarter_private.weekly_pnl_precertify(e, e - interval '1 second') IS NOT NULL
    OR smarter_private.weekly_prep_caught_up(NULL, clock_timestamp()) IS DISTINCT FROM false
    OR smarter_private.weekly_prep_caught_up(e + interval '7 days', clock_timestamp()) IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'PNL_BEFORE_MONEY_PROBE' USING ERRCODE = '55000';
  END IF;
END
$probe_weekly_pnl_precertify$;

COMMIT;
