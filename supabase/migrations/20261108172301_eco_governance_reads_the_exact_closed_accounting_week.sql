-- 20261108172301_eco_governance_reads_the_exact_closed_accounting_week
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-08 17:23:01 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
-- Say what was wrong, what this changes, and what you measured. A
-- migration whose header is its own filename is the next agent's mystery.
-- The ECO completeness check used the preceding 168 UTC hours as a
-- lower bound for the period start. The November 2 close has 169 hours:
-- October 26 07:00 UTC through November 2 08:00 UTC. Its own ECO rows
-- would remain invisible to the check. Match both canonical week boundaries.
-- @live-proof: position('l.period_end = fn_union_week_start()' IN pg_get_functiondef('public.fn_union_credit_risk_check()'::regprocedure))>0

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '8s';

DO $patch$
DECLARE
  definition text := pg_get_functiondef('public.fn_union_credit_risk_check()'::regprocedure);
  old_predicate constant text := $old$                        AND l.period_start >= fn_union_week_start() - interval '7 days')$old$;
  new_predicate constant text := $new$                        AND l.period_start = fn_union_prev_week_start()
                        AND l.period_end = fn_union_week_start())$new$;
BEGIN
  IF cardinality(string_to_array(definition, old_predicate)) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'ECO_GOVERNANCE_WEEK_PREIMAGE_CHANGED';
  END IF;
  EXECUTE replace(definition, old_predicate, new_predicate);
END
$patch$;

COMMIT;
