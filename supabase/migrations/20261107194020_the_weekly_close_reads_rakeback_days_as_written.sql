-- 20261107194020_the_weekly_close_reads_rakeback_days_as_written
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-07 19:40:20 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
-- Say what was wrong, what this changes, and what you measured. A
-- migration whose header is its own filename is the next agent's mystery.
-- THE WEEKLY CLOSE READS RAKEBACK DAYS THE WAY THEY ARE WRITTEN (2026-11-07).
--
-- Midway Union's 2026-10-19 07:00Z..10-26 07:00Z book has refused 190 times
-- with union_rakeback_wrong_club {"pending_periods": 6, "pending_amount": 54.95}.
-- Those six rakeback_periods are not in that week at all. They are dated
-- 2026-10-26..2026-11-01, and rakeback_periods dates are Los Angeles calendar
-- days: fn_calculate_cash_rakeback_periods builds every period with
--   v_from := p_period_start::timestamp AT TIME ZONE 'America/Los_Angeles'
-- so 10-26..11-01 is 2026-10-26 07:00Z..2026-11-02 08:00Z - exactly the NEXT
-- accounting week. fn_process_weekly_accounting_scope already reads these
-- dates as Los Angeles days where it schedules them (its two
-- fn_union_week_start(rp.period_start::timestamp AT TIME ZONE
-- 'America/Los_Angeles') reads), but its orphan guard and its completion test
-- read the same dates as UTC midnights. As UTC, 10-26 starts at 00:00Z, seven
-- hours before the 10-19 book ends, so the guard counts the next week's six
-- periods against this one and the head-of-line queue never moves.
--
-- Measured on production 2026-11-07 with the guard's own predicate, Midway's
-- pending union-club periods per book:
--   book       as UTC (today)   as Los Angeles days (this file)
--   10-12      0                0
--   10-19      6 / 54.95        0
--   10-26      6 / 54.95        6 / 54.95
--   11-02      0                0
-- So the 10-19 book is unblocked and the six stay counted in the week they
-- belong to. Whatever is owed on them is that week's question, not this one's.
-- The completion test (periods wholly inside the book) gives the same answer
-- under either reading for every Monday book; it moves to Los Angeles days too
-- so the function has one reading of one column.
--
-- THE PAYOUT PLAN PINS THIS FUNCTION. smarter_private.weekly_payout_eligible_
-- scopes refuses with weekly_payout_original_scope_authority_changed unless
-- md5(fn_process_weekly_accounting_scope) is 023efba44914bad5d05e2538e951e59f.
-- Both are changed here in one transaction: the four anchored lines, then that
-- one pinned hash, each preimage and postimage md5-pinned, owner/ACL/config/
-- volatility unchanged. Rehearsed on production in a rolled-back transaction
-- under the installer's 12 s budget: 47 ms, postimages as pinned below.
--
-- @live-proof: md5(pg_get_functiondef('public.fn_process_weekly_accounting_scope(uuid,uuid)'::regprocedure))='12bfc8d8f09be5fa21b951efe3a77d62' AND md5(pg_get_functiondef('smarter_private.weekly_payout_eligible_scopes(timestamptz,timestamptz)'::regprocedure))='9c5e482c4d435f9c33bcc77a5e46edac'

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $weekly_close_reads_rakeback_days_as_written$
DECLARE
  c_scope   constant text := 'public.fn_process_weekly_accounting_scope(uuid,uuid)';
  c_payout  constant text := 'smarter_private.weekly_payout_eligible_scopes(timestamptz,timestamptz)';
  c_scope_pre  constant text := '023efba44914bad5d05e2538e951e59f';
  c_payout_pre constant text := 'f28a58c12720f40e354ddb3cf1c73677';
  a1 constant text := $a$AND (rp.period_start::timestamp AT TIME ZONE 'UTC') < v_end$a$;
  r1 constant text := $a$AND (rp.period_start::timestamp AT TIME ZONE 'America/Los_Angeles') < v_end$a$;
  a2 constant text := $a$AND ((rp.period_end+1)::timestamp AT TIME ZONE 'UTC') > v_from;$a$;
  r2 constant text := $a$AND ((rp.period_end+1)::timestamp AT TIME ZONE 'America/Los_Angeles') > v_from;$a$;
  a3 constant text := $a$AND rp.period_start >= (v_from AT TIME ZONE 'UTC')::date$a$;
  r3 constant text := $a$AND rp.period_start >= (v_from AT TIME ZONE 'America/Los_Angeles')::date$a$;
  a4 constant text := $a$AND ((rp.period_end+1)::timestamp AT TIME ZONE 'UTC') <= v_end)$a$;
  r4 constant text := $a$AND ((rp.period_end+1)::timestamp AT TIME ZONE 'America/Los_Angeles') <= v_end)$a$;
  d text; p text; e text; q text; s_meta jsonb; s_after jsonb; e_meta jsonb; e_after jsonb; s_post text;
BEGIN
  d := pg_get_functiondef(c_scope::regprocedure);
  e := pg_get_functiondef(c_payout::regprocedure);
  IF md5(d) IS DISTINCT FROM c_scope_pre THEN RAISE EXCEPTION 'WEEKLY_CLOSE_LA_DAYS_SCOPE_PREIMAGE_DRIFT %', md5(d) USING ERRCODE='55000'; END IF;
  IF md5(e) IS DISTINCT FROM c_payout_pre THEN RAISE EXCEPTION 'WEEKLY_CLOSE_LA_DAYS_PAYOUT_PREIMAGE_DRIFT %', md5(e) USING ERRCODE='55000'; END IF;
  IF (length(d)-length(replace(d,a1,'')))/length(a1)<>1 OR (length(d)-length(replace(d,a2,'')))/length(a2)<>1
     OR (length(d)-length(replace(d,a3,'')))/length(a3)<>1 OR (length(d)-length(replace(d,a4,'')))/length(a4)<>1
     OR (length(e)-length(replace(e,c_scope_pre,'')))/32<>1 THEN
    RAISE EXCEPTION 'WEEKLY_CLOSE_LA_DAYS_ANCHORS' USING ERRCODE='55000';
  END IF;
  SELECT jsonb_build_object('owner',proowner,'acl',proacl,'secdef',prosecdef,'cfg',proconfig,'vol',provolatile) INTO s_meta FROM pg_proc WHERE oid=c_scope::regprocedure;
  SELECT jsonb_build_object('owner',proowner,'acl',proacl,'secdef',prosecdef,'cfg',proconfig,'vol',provolatile) INTO e_meta FROM pg_proc WHERE oid=c_payout::regprocedure;
  p := replace(replace(replace(replace(d,a1,r1),a2,r2),a3,r3),a4,r4);
  EXECUTE p;
  s_post := md5(pg_get_functiondef(c_scope::regprocedure));
  q := replace(e, c_scope_pre, s_post);
  EXECUTE q;
  SELECT jsonb_build_object('owner',proowner,'acl',proacl,'secdef',prosecdef,'cfg',proconfig,'vol',provolatile) INTO s_after FROM pg_proc WHERE oid=c_scope::regprocedure;
  SELECT jsonb_build_object('owner',proowner,'acl',proacl,'secdef',prosecdef,'cfg',proconfig,'vol',provolatile) INTO e_after FROM pg_proc WHERE oid=c_payout::regprocedure;
  IF s_after IS DISTINCT FROM s_meta OR e_after IS DISTINCT FROM e_meta
     OR pg_get_functiondef(c_scope::regprocedure)<>p OR pg_get_functiondef(c_payout::regprocedure)<>q THEN
    RAISE EXCEPTION 'WEEKLY_CLOSE_LA_DAYS_INSTALL_MISMATCH' USING ERRCODE='55000';
  END IF;
  IF md5(pg_get_functiondef(c_scope::regprocedure)) IS DISTINCT FROM '12bfc8d8f09be5fa21b951efe3a77d62'
     OR md5(pg_get_functiondef(c_payout::regprocedure)) IS DISTINCT FROM '9c5e482c4d435f9c33bcc77a5e46edac' THEN
    RAISE EXCEPTION 'WEEKLY_CLOSE_LA_DAYS_POSTIMAGE_DRIFT' USING ERRCODE='55000';
  END IF;
END $weekly_close_reads_rakeback_days_as_written$;

COMMIT;
