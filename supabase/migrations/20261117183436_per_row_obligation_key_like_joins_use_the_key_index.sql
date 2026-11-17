-- @live-proof: (length(pg_get_functiondef('public.fn_settle_tournament_final_table_deal(uuid)'::regprocedure)) - length(replace(pg_get_functiondef('public.fn_settle_tournament_final_table_deal(uuid)'::regprocedure), 'k.key OPERATOR(pg_catalog.~>=~)', ''))) / length('k.key OPERATOR(pg_catalog.~>=~)') = 6
-- @live-proof: position('k.key OPERATOR(pg_catalog.~>=~)' in pg_get_functiondef('public.fn_ca_verify_terminal_final_deal_batch(uuid,boolean)'::regprocedure)) > 0
-- 20261117183436_per_row_obligation_key_like_joins_use_the_key_index.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- 20261117085019 fixed the Nightly 20K 10d3c9b3 outage: a guard in
-- fn_settle_tournament_places matched wallet_credit_idempotency keys with a
-- LIKE pattern computed per obligation, which no index can serve, so it
-- seq-scanned all 1.9M wallet credits once per paid place.
--
-- The same shape is still live in two other terminal money functions:
--
--   fn_settle_tournament_final_table_deal(uuid)          6 sites
--   fn_ca_verify_terminal_final_deal_batch(uuid,boolean) 1 site
--
--   k.key LIKE 'tourney:' || p_tournament_id::text || ':obl:' || <x>.id::text || ':%'
--
-- where <x> is the joined obligation row (o) or a loop variable (v_ob). Four
-- of the seven are per-row joins or correlated subqueries and can never use an
-- index; the other three depend on PL/pgSQL keeping a custom plan.
--
-- Measured read-only on production with the Nightly 20K's 94 obligations,
-- the join used by both functions:
--   before: 28,791 ms (two parallel workers, 59.6M rows removed by filter)
--   after:      13 ms (index-only scan on wallet_credit_idempotency_key_pattern_idx)
-- A final-table deal or deal verification in a field that size would have
-- exceeded the functions' 30 s statement budget, and the cost grows with all
-- wallet-credit history.
--
-- Each site keeps its LIKE and gains the byte-wise prefix range on
-- wallet_credit_idempotency_key_pattern_idx (text_pattern_ops):
--   k.key ~>=~ 'tourney:<t>:obl:<x>:'  AND  k.key ~<~ 'tourney:<t>:obl:<x>;'
-- ';' is the byte after ':'. The prefix holds only hex digits, '-' and ':',
-- never a LIKE wildcard, so every key the LIKE can match lies inside the range:
-- the range is a pure superset filter and the answer cannot change. The three
-- predicates are parenthesised so AND/OR precedence around the site is exact.
-- Read-only comparison on production over 10d3c9b3 and 3e281f5c: 96 rows
-- before, 96 after, 0 differences either way.
--
-- No money moves and no row is written. Function-only DDL, guarded: each
-- function must contain exactly the expected number of sites, the rewrite is
-- re-read to confirm it landed, and a second run is a no-op. Owner, ACL,
-- SECURITY DEFINER and SET clauses are carried by pg_get_functiondef.

BEGIN;

DO $migration$
DECLARE
  v_re text := $re$(k\.key\s+LIKE\s+'tourney:'\s*\|\|\s*p_tournament_id::text\s*\|\|\s*':obl:'\s*\|\|\s*(\w+)\.id::text\s*\|\|\s*':%')$re$;
  v_rep text := $rep$(k.key OPERATOR(pg_catalog.~>=~) ('tourney:' || p_tournament_id::text || ':obl:' || \2.id::text || ':') AND k.key OPERATOR(pg_catalog.~<~) ('tourney:' || p_tournament_id::text || ':obl:' || \2.id::text || ';') AND \1)$rep$;
  v_marker text := 'k.key OPERATOR(pg_catalog.~>=~)';
  v_target record;
  v_def text;
  v_sites int;
  v_ranges int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
     WHERE i.indexrelid = 'public.wallet_credit_idempotency_key_pattern_idx'::regclass
       AND i.indrelid = 'public.wallet_credit_idempotency'::regclass
       AND i.indisvalid
  ) THEN
    RAISE EXCEPTION 'wallet_credit_idempotency_key_pattern_idx is missing or invalid';
  END IF;

  FOR v_target IN
    SELECT * FROM (VALUES
      ('public.fn_settle_tournament_final_table_deal(uuid)'::regprocedure, 6),
      ('public.fn_ca_verify_terminal_final_deal_batch(uuid,boolean)'::regprocedure, 1)
    ) AS t(fn, expected)
  LOOP
    v_def := pg_get_functiondef(v_target.fn);
    v_ranges := (length(v_def) - length(replace(v_def, v_marker, ''))) / length(v_marker);
    SELECT count(*) INTO v_sites FROM regexp_matches(v_def, v_re, 'g');

    IF v_ranges = v_target.expected AND v_sites = v_target.expected THEN
      CONTINUE;  -- already bounded: idempotent re-run
    END IF;
    IF v_ranges <> 0 OR v_sites <> v_target.expected THEN
      RAISE EXCEPTION '%: expected % unbounded obligation-key LIKE sites and no range, found % sites and % ranges',
        v_target.fn, v_target.expected, v_sites, v_ranges;
    END IF;

    EXECUTE regexp_replace(v_def, v_re, v_rep, 'g');

    v_def := pg_get_functiondef(v_target.fn);
    v_ranges := (length(v_def) - length(replace(v_def, v_marker, ''))) / length(v_marker);
    SELECT count(*) INTO v_sites FROM regexp_matches(v_def, v_re, 'g');
    IF v_ranges <> v_target.expected OR v_sites <> v_target.expected THEN
      RAISE EXCEPTION '%: obligation-key range did not land (% ranges, % sites)', v_target.fn, v_ranges, v_sites;
    END IF;
  END LOOP;
END
$migration$;

COMMIT;
