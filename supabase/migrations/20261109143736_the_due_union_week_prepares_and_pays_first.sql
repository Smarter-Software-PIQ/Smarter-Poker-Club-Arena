-- THE 2026-11-09 READY-AT-FOUR MISS, CORRECTED AT ITS CAUSE. The scope plan
-- ordered by period_start first, union-kind second, so any backlog scope
-- from an earlier period (on Nov 9, the Oct 26 - Nov 2 standalone replay)
-- sorted ahead of the due union week, and the four 45-second prep shards
-- spent their minutes on the backlog while the union's 4:00 AM payment
-- waited ~49 minutes for its own preparation. The union's weekly payment
-- IS the four o'clock commitment; the backlog has twelve hours. This swaps
-- the first two sort keys: every union week sorts ahead of every other
-- scope, and WITHIN each scope weeks keep their oldest-first order, so no
-- scope ever pays a later week before its own earlier one. The set of
-- planned scopes is unchanged; only their order moves. Prep shards and the
-- payout runner both read this plan, so the union prepares first and pays
-- first.
-- @live-proof: md5(pg_get_functiondef('smarter_private.weekly_payout_scope_plan(timestamptz,timestamptz)'::regprocedure))='ec30840469438a995d15dbbbefafefb0'
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $patch$
DECLARE
 src text;
 needle text := $o$jsonb_agg(j ORDER BY (j->>'period_start')::timestamptz,(j->>'kind'='union') DESC,j->>'id')$o$;
 repl text := $n$jsonb_agg(j ORDER BY (j->>'kind'='union') DESC,(j->>'period_start')::timestamptz,j->>'id')$n$;
BEGIN
 src := pg_get_functiondef('smarter_private.weekly_payout_scope_plan(timestamptz,timestamptz)'::regprocedure);
 IF md5(src) IS DISTINCT FROM '1546f676967f07f809050b210e006a65' THEN
  RAISE EXCEPTION 'scope_plan_preimage_changed md5=%', md5(src);
 END IF;
 IF (length(src)-length(replace(src,needle,'')))/length(needle) <> 1 THEN
  RAISE EXCEPTION 'expected exactly one plan ordering';
 END IF;
 EXECUTE replace(src, needle, repl);
 IF md5(pg_get_functiondef('smarter_private.weekly_payout_scope_plan(timestamptz,timestamptz)'::regprocedure))
    IS DISTINCT FROM 'ec30840469438a995d15dbbbefafefb0' THEN
  RAISE EXCEPTION 'scope_plan_postimage_changed';
 END IF;
END $patch$;
COMMIT;
