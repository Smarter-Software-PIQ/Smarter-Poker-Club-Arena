-- 20261107204839_the_union_cascade_reads_rakeback_days_as_written
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-07 20:48:39 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
-- Say what was wrong, what this changes, and what you measured. A
-- migration whose header is its own filename is the next agent's mystery.
--
-- THE UNION CASCADE READS RAKEBACK DAYS THE WAY THEY ARE WRITTEN (2026-11-07).
--
-- 20261107194020 moved fn_process_weekly_accounting_scope's reads of
-- rakeback_periods dates to Los Angeles calendar days, the way
-- fn_calculate_cash_rakeback_periods writes them. Applied at 20:21Z, the
-- 20:40Z visit of Midway's 2026-10-19 book got past that guard and stopped on
-- the same refusal raised by a second function:
--   union_rakeback_wrong_club "Pending player rakeback is booked under the
--   union ID" from fn_union_settlement_cascade
-- which carries the same two readings (orphan guard and completion test) as
-- UTC midnights. It is the only remaining function in public or
-- smarter_private that reads rp.period_start / rp.period_end AT TIME ZONE
-- 'UTC' (searched 2026-11-07), and no function pins its md5. Its four reads
-- move to Los Angeles days exactly as in 20261107194020; md5-pinned preimage
-- and postimage, metadata unchanged.
--
-- @live-proof: md5(pg_get_functiondef('public.fn_union_settlement_cascade(uuid,timestamptz,timestamptz)'::regprocedure))='a68664588b6e7f83806f10b122a2bccc'

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $cascade_reads_rakeback_days_as_written$
DECLARE
  c_fn constant text := 'public.fn_union_settlement_cascade(uuid,timestamptz,timestamptz)';
  a1 constant text := $a$AND (rp.period_start::timestamp AT TIME ZONE 'UTC') < v_to$a$;
  r1 constant text := $a$AND (rp.period_start::timestamp AT TIME ZONE 'America/Los_Angeles') < v_to$a$;
  a2 constant text := $a$AND ((rp.period_end + 1)::timestamp AT TIME ZONE 'UTC') > v_from) THEN$a$;
  r2 constant text := $a$AND ((rp.period_end + 1)::timestamp AT TIME ZONE 'America/Los_Angeles') > v_from) THEN$a$;
  a3 constant text := $a$AND rp.period_start >= (v_from AT TIME ZONE 'UTC')::date$a$;
  r3 constant text := $a$AND rp.period_start >= (v_from AT TIME ZONE 'America/Los_Angeles')::date$a$;
  a4 constant text := $a$AND ((rp.period_end+1)::timestamp AT TIME ZONE 'UTC') <= v_to) THEN$a$;
  r4 constant text := $a$AND ((rp.period_end+1)::timestamp AT TIME ZONE 'America/Los_Angeles') <= v_to) THEN$a$;
  d text; p text; m jsonb; m2 jsonb;
BEGIN
  d := pg_get_functiondef(c_fn::regprocedure);
  IF md5(d) IS DISTINCT FROM '9dadc71929579ecb5d525f975cce9b49' THEN
    RAISE EXCEPTION 'CASCADE_LA_DAYS_PREIMAGE_DRIFT %', md5(d) USING ERRCODE='55000';
  END IF;
  IF (length(d)-length(replace(d,a1,'')))/length(a1)<>1 OR (length(d)-length(replace(d,a2,'')))/length(a2)<>1
     OR (length(d)-length(replace(d,a3,'')))/length(a3)<>1 OR (length(d)-length(replace(d,a4,'')))/length(a4)<>1 THEN
    RAISE EXCEPTION 'CASCADE_LA_DAYS_ANCHORS' USING ERRCODE='55000';
  END IF;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile) INTO m FROM pg_proc WHERE oid=c_fn::regprocedure;
  p := replace(replace(replace(replace(d,a1,r1),a2,r2),a3,r3),a4,r4);
  EXECUTE p;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile) INTO m2 FROM pg_proc WHERE oid=c_fn::regprocedure;
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_fn::regprocedure)<>p
     OR md5(pg_get_functiondef(c_fn::regprocedure)) IS DISTINCT FROM 'a68664588b6e7f83806f10b122a2bccc' THEN
    RAISE EXCEPTION 'CASCADE_LA_DAYS_POSTIMAGE %', md5(pg_get_functiondef(c_fn::regprocedure)) USING ERRCODE='55000';
  END IF;
END $cascade_reads_rakeback_days_as_written$;

COMMIT;
