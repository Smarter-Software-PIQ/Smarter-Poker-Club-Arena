-- 20261126175930_weekly_prep_waits_for_the_closed_week_cash_and_late_admissio.sql
--
-- WEEKLY PREPARATION WAITS FOR THE CLOSED WEEK'S CASH (incident 6377941a, Monday 2026-11-23).
--
-- ROOT CAUSE, proved from accounting_cash_source_receipts:
-- The week closed at 08:00Z (02:00 Chicago). weekly-prep-shard-0..3 started at
-- 08:03Z, gated only on fn_accounting_commit_horizon() >= week end. At that
-- moment the engine's RakebackSettlerService (30-minute cadence, cursor in
-- public.daemon_state 'rakeback_settler') still owed the last half hour of the
-- week. Every preparation unit (smarter_private.weekly_prep_unit) holds the
-- scope's 'club-accounting:<club>:<start>:<end>' advisory key while it
-- computes, and every closed-week cash accrual calls
-- smarter_private.weekly_payout_source_changed, which only TRY-locks that same
-- key. 1,619 sources earned 07:30-08:00Z were refused 08:00-09:00Z: 1,459 with
-- closed_week_source_waits_for_owned_payout (55P03) and 160 with a lock
-- timeout. They sat in the blocked retry queue and came back on the settler's
-- 30-minute cycles (accrued in bursts at 09:00, 09:30, 10:00, 10:30, 11:00Z).
-- Each burst changed the week's sources, invalidated the prepared windows and
-- restarted the counts (3,627 units instead of ~1,300). The last source
-- accrued at 11:00Z; preparation finished at 11:45Z; payout ran at 11:50Z
-- (05:50 Chicago) instead of 10:00Z (04:00).
-- On 2026-11-16 a clean first pass finished in 16 minutes (08:00-08:16Z).
--
-- PERMANENT FIX:
-- 1. smarter_private.weekly_closed_week_cash_settled(period_end) answers true
--    once every positive cash rake record of the closed week is behind the
--    settler's durable keyset cursor (the same keyset rule that
--    fn_process_weekly_accounting_scope already enforces as
--    weekly_rake_source_not_fully_accrued) AND no cash source of that week is
--    waiting in the blocked retry queue (terminally parked 'infinity' rows are
--    excluded: they never retry).
-- 2. smarter_private.weekly_prep_shard does not start preparing the closed
--    week until that is true, so preparation never holds the scope key while
--    the week's own cash is still arriving. One hour before the payout time
--    (03:00 Chicago) it prepares regardless, so a stuck settler or a single
--    stuck source can never cost the payout itself; the 03:30 readiness check
--    still alarms on anything left unprepared.
-- 3. The two remaining per-source admissions that wiped a club's whole week of
--    split parts, smarter_private.admit_cash_funding_contracts and
--    smarter_private.admit_own_agent_source, now drop only the 2-hour counts
--    part (and 6-hour tq part) holding the source's earned_at, plus the
--    whole-week players/check/write aggregates, as 20261123163000 already does
--    for late sources in fn_rakeback_recompute_split and
--    weekly_refresh_changed_payout_windows. A tournament fee admission drops
--    every tq part (its fee recognition can reach later windows). The
--    one-time whole-week reset in prepare_own_agent_interpretation (first
--    preparation version only) is structural and unchanged.
--
-- Each function is rewritten from its own live definition: the preimage md5
-- is pinned, each anchor must occur exactly once, owner/ACL/security/config
-- are proven unchanged, and the postimage must equal the intended text.
--
-- @live-proof: (SELECT position('CLOSED WEEK CASH FIRST (20261126)' IN pg_get_functiondef('smarter_private.weekly_prep_shard(integer,integer)'::regprocedure)) > 0 AND position('PER-WINDOW ADMISSION INVALIDATION (20261126)' IN pg_get_functiondef('smarter_private.admit_cash_funding_contracts(uuid,jsonb)'::regprocedure)) > 0 AND position('PER-WINDOW ADMISSION INVALIDATION (20261126)' IN pg_get_functiondef('smarter_private.admit_own_agent_source(text,uuid)'::regprocedure)) > 0 AND smarter_private.weekly_closed_week_cash_settled(clock_timestamp() + interval '1 day') IS FALSE AND NOT has_function_privilege('anon', 'smarter_private.weekly_closed_week_cash_settled(timestamptz)', 'EXECUTE') AND NOT has_function_privilege('anon', 'smarter_private.weekly_split_part_covers(text,integer,timestamptz,timestamptz,timestamptz,boolean)', 'EXECUTE'))

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

CREATE OR REPLACE FUNCTION smarter_private.weekly_closed_week_cash_settled(p_end timestamptz)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $f$
-- CLOSED WEEK CASH FIRST (20261126): true once every positive cash rake record
-- of the week ending p_end has been read by the settler's durable keyset cursor
-- and none of the week's cash sources waits in the blocked retry queue.
DECLARE
  ps timestamptz;
  hw timestamptz;
  hid uuid;
BEGIN
  IF p_end IS NULL OR NOT isfinite(p_end) OR p_end > clock_timestamp() THEN
    RETURN false;
  END IF;
  ps := public.fn_union_week_start(p_end - interval '1 day');
  SELECT d.high_water_mark, d.high_water_mark_id INTO hw, hid
    FROM public.daemon_state d
   WHERE d.daemon = 'rakeback_settler';
  IF hw IS NULL THEN
    RETURN false;
  END IF;
  -- Same keyset rule as weekly_rake_source_not_fully_accrued in
  -- fn_process_weekly_accounting_scope: (created_at, id) after the cursor is unread.
  IF hw < p_end AND EXISTS (
    SELECT 1
      FROM public.rake_records rr
     WHERE rr.is_tournament IS NOT TRUE
       AND rr.tournament_id IS NULL
       AND rr.rake_amount > 0
       AND rr.created_at >= GREATEST(ps, hw)
       AND rr.created_at < p_end
       AND (rr.created_at > hw OR hid IS NULL OR rr.id > hid)
  ) THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.accounting_cash_source_work w
      JOIN public.accounting_cash_source_receipts r ON r.id = w.receipt_id
     WHERE w.status = 'blocked'
       AND w.next_attempt_at < 'infinity'::timestamptz
       AND r.earned_at >= ps
       AND r.earned_at < p_end
  ) THEN
    RETURN false;
  END IF;
  RETURN true;
END
$f$;

REVOKE ALL ON FUNCTION smarter_private.weekly_closed_week_cash_settled(timestamptz)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION smarter_private.weekly_split_part_covers(
  p_kind text,
  p_part integer,
  p_start timestamptz,
  p_end timestamptz,
  p_at timestamptz,
  p_all_tq boolean
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $f$
-- PER-WINDOW ADMISSION INVALIDATION (20261126): does a split part depend on a
-- source earned at p_at? counts part n covers [start + 2h*n, start + 2h*(n+1)),
-- tq part n covers [start + 6h*n, start + 6h*(n+1)), both clipped to the week
-- end and numbered exactly as weekly_refresh_changed_payout_windows numbers them;
-- a one-minute margin on each side, as 20261123163000. players/check/write (and
-- any other kind) aggregate the whole week and always depend on it.
SELECT CASE
  WHEN p_kind = 'counts' THEN
    p_at IS NULL OR p_part IS NULL OR p_start IS NULL OR p_end IS NULL
    OR (p_start + p_part * interval '2 hours' <= p_at + interval '1 minute'
        AND LEAST(p_start + (p_part + 1) * interval '2 hours', p_end) > p_at - interval '1 minute')
  WHEN p_kind = 'tq' THEN
    p_all_tq IS NOT FALSE OR p_at IS NULL OR p_part IS NULL OR p_start IS NULL OR p_end IS NULL
    OR (p_start + p_part * interval '6 hours' <= p_at + interval '1 minute'
        AND LEAST(p_start + (p_part + 1) * interval '6 hours', p_end) > p_at - interval '1 minute')
  ELSE true
END
$f$;

REVOKE ALL ON FUNCTION smarter_private.weekly_split_part_covers(text, integer, timestamptz, timestamptz, timestamptz, boolean)
  FROM PUBLIC, anon, authenticated;

DO $rewrite_weekly_closed_week_cash_first$
DECLARE
  c_prep constant text := 'smarter_private.weekly_prep_shard(integer,integer)';
  c_fund constant text := 'smarter_private.admit_cash_funding_contracts(uuid,jsonb)';
  c_adm constant text := 'smarter_private.admit_own_agent_source(text,uuid)';
  old_prep constant text := 'f412aa3847adec2b5a50cff631074502';
  old_fund constant text := '7e474a2d701a3b4475d2b3070d5ad661';
  old_adm constant text := '48733d7e37ad8cd532a9c7973cf3bfe0';
  targets text[] := ARRAY[c_prep, c_fund, c_adm];
  pins text[] := ARRAY[old_prep, old_fund, old_adm];
  anchors text[];
  repls text[];
  d text;
  p text;
  m jsonb;
  m2 jsonb;
  k int;
  i int;
BEGIN
  anchors := ARRAY[
    'IF (public.fn_accounting_commit_horizon()>=e) IS DISTINCT FROM true THEN RETURN; END IF;',
    'DELETE FROM public.accounting_recompute_split_parts WHERE club_id IN(s.club_id,funding) AND period_start=(w_from AT TIME ZONE ''America/Los_Angeles'')::date;',
    'DELETE FROM public.accounting_recompute_split_parts WHERE club_id=s.club_id AND period_start=(w_from AT TIME ZONE''America/Los_Angeles'')::date AND period_end=(w_to AT TIME ZONE''America/Los_Angeles'')::date-1;'
  ];
  repls := ARRAY[
    'IF (public.fn_accounting_commit_horizon()>=e) IS DISTINCT FROM true THEN RETURN; END IF;' || E'\n'
    || E' -- CLOSED WEEK CASH FIRST (20261126): a preparation unit holds the scope key that every\n'
    || E' -- closed-week cash accrual try-locks (weekly_payout_source_changed), so preparing while the\n'
    || E' -- settler still owes the week refused 1,619 sources on 2026-11-23 and redid the week nine\n'
    || E' -- times. Wait for the week''s cash; an hour before the payout, prepare regardless.\n'
    || ' IF n<due-interval ''1 hour'' AND smarter_private.weekly_closed_week_cash_settled(e) IS DISTINCT FROM true THEN RETURN; END IF;',
    E'-- PER-WINDOW ADMISSION INVALIDATION (20261126): only the source''s own 2h counts / 6h tq part\n'
    || E'  -- and the whole-week players/check/write aggregates depend on this admission.\n'
    || '  DELETE FROM public.accounting_recompute_split_parts sp WHERE sp.club_id IN(s.club_id,funding) AND sp.period_start=(w_from AT TIME ZONE ''America/Los_Angeles'')::date'
    || ' AND smarter_private.weekly_split_part_covers(sp.kind,sp.part,w_from,w_to,s.earned_at,false);',
    E'-- PER-WINDOW ADMISSION INVALIDATION (20261126): only the source''s own 2h counts part, its 6h tq\n'
    || E' -- part (every tq part for a tournament fee) and the whole-week players/check/write aggregates.\n'
    || ' DELETE FROM public.accounting_recompute_split_parts sp WHERE sp.club_id=s.club_id AND sp.period_start=(w_from AT TIME ZONE''America/Los_Angeles'')::date AND sp.period_end=(w_to AT TIME ZONE''America/Los_Angeles'')::date-1'
    || ' AND smarter_private.weekly_split_part_covers(sp.kind,sp.part,w_from,w_to,s.earned_at,p_type=''tournament_fee_accrual'');'
  ];
  FOR i IN 1..3 LOOP
    d := pg_get_functiondef(targets[i]::regprocedure);
    IF md5(d) IS DISTINCT FROM pins[i] THEN
      RAISE EXCEPTION 'CLOSED_WEEK_CASH_FIRST_PREIMAGE % %', targets[i], md5(d) USING ERRCODE = '55000';
    END IF;
    k := (length(d) - length(replace(d, anchors[i], ''))) / length(anchors[i]);
    IF k <> 1 THEN
      RAISE EXCEPTION 'CLOSED_WEEK_CASH_FIRST_ANCHOR_COUNT % %', targets[i], k USING ERRCODE = '55000';
    END IF;
    SELECT jsonb_build_object('o', proowner, 'a', proacl, 's', prosecdef, 'c', proconfig, 'v', provolatile, 'k', prokind)
      INTO m FROM pg_proc WHERE oid = targets[i]::regprocedure;
    p := replace(d, anchors[i], repls[i]);
    EXECUTE p;
    SELECT jsonb_build_object('o', proowner, 'a', proacl, 's', prosecdef, 'c', proconfig, 'v', provolatile, 'k', prokind)
      INTO m2 FROM pg_proc WHERE oid = targets[i]::regprocedure;
    IF m2 IS DISTINCT FROM m OR pg_get_functiondef(targets[i]::regprocedure) <> p THEN
      RAISE EXCEPTION 'CLOSED_WEEK_CASH_FIRST_POSTIMAGE %', targets[i] USING ERRCODE = '55000';
    END IF;
  END LOOP;
END
$rewrite_weekly_closed_week_cash_first$;

-- Behaviour probe of the window rule (pure function; no data written).
DO $probe_weekly_split_part_covers$
DECLARE
  s constant timestamptz := '2026-11-23 08:00:00+00';
  e constant timestamptz := '2026-11-30 08:00:00+00';
BEGIN
  IF NOT smarter_private.weekly_split_part_covers('counts', 0, s, e, s + interval '30 minutes', false)
    OR smarter_private.weekly_split_part_covers('counts', 1, s, e, s + interval '30 minutes', false)
    OR NOT smarter_private.weekly_split_part_covers('counts', 83, s, e, e - interval '1 second', false)
    OR smarter_private.weekly_split_part_covers('counts', 0, s, e, e - interval '1 second', false)
    -- one-minute margin reaches the neighbouring window at a boundary
    OR NOT smarter_private.weekly_split_part_covers('counts', 0, s, e, s + interval '2 hours', false)
    OR NOT smarter_private.weekly_split_part_covers('counts', 1, s, e, s + interval '2 hours', false)
    OR NOT smarter_private.weekly_split_part_covers('tq', 27, s, e, e - interval '1 second', false)
    OR smarter_private.weekly_split_part_covers('tq', 0, s, e, e - interval '1 second', false)
    OR NOT smarter_private.weekly_split_part_covers('tq', 0, s, e, e - interval '1 second', true)
    OR NOT smarter_private.weekly_split_part_covers('players', 0, s, e, s, false)
    OR NOT smarter_private.weekly_split_part_covers('check', 3, s, e, s, false)
    OR NOT smarter_private.weekly_split_part_covers('write', 0, s, e, s, false)
    OR NOT smarter_private.weekly_split_part_covers('counts', 5, s, e, NULL, false)
    OR smarter_private.weekly_closed_week_cash_settled(clock_timestamp() + interval '1 day') IS DISTINCT FROM false
    OR smarter_private.weekly_closed_week_cash_settled(NULL) IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'CLOSED_WEEK_CASH_FIRST_PROBE' USING ERRCODE = '55000';
  END IF;
END
$probe_weekly_split_part_covers$;

COMMIT;
