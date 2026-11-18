/**
 * The two read-only questions the pin pre-check asks production (2026-11-18,
 * incident 075013fd). Constant SQL with no input from any branch: the capture
 * job of window-migrations-install-before-merge.yml runs them on the default
 * branch's checkout with `default_transaction_read_only=on`, beside the schema
 * export it already makes, and hands the answers to the job that reads the
 * pull request's files (migration-pins-before-merge.mjs). No import, so the
 * capture's sparse checkout needs only this file.
 *
 *   catalog  every function and procedure in public and smarter_private, with
 *            its body md5 in BOTH forms the applier's guard takes
 *            (migration-stale-pins.mjs SNAPSHOT: search_path pg_catalog, then
 *            public). Signatures are printed with search_path pg_catalog, so
 *            every one is schema-qualified. About 0.2 s per pass on production.
 *   pins     every maximal run of 32 or more lowercase hex characters in the
 *            source of ANY installed function (the guard searches every
 *            pg_proc row, so this does too), with the function that holds it.
 *            The guard's test is strpos(prosrc, md5) > 0; a 32-character md5
 *            occurs in a source exactly when it occurs inside one of these
 *            runs, so substring tests on the runs give the guard's answer.
 */
// Two statements, joined by oid in migration-pins-before-merge.mjs: the guard
// takes the md5 under search_path pg_catalog and again under public.
export const CATALOG_SQL_CATALOG_PATH = `
SET search_path = pg_catalog;
SELECT p.oid, p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname IN ('public', 'smarter_private') AND p.prokind IN ('f', 'p')
 ORDER BY 1;
`.trim();

export const CATALOG_SQL_PUBLIC_PATH = `
SET search_path = public;
SELECT p.oid, pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid))
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname IN ('public', 'smarter_private') AND p.prokind IN ('f', 'p')
 ORDER BY 1;
`.trim();

export const PINS_SQL = `
SET search_path = pg_catalog;
SELECT DISTINCT p.oid::regprocedure::text, m[1]
  FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL regexp_matches(p.prosrc, '[0-9a-f]{32,}', 'g') m
 ORDER BY 1, 2;
`.trim();

const QUERIES = {
  'catalog-catalog-path': CATALOG_SQL_CATALOG_PATH,
  'catalog-public-path': CATALOG_SQL_PUBLIC_PATH,
  pins: PINS_SQL,
};

// CLI: node scripts/ci/migration-pins-capture.mjs <catalog-catalog-path|catalog-public-path|pins>
if (process.argv[1] && process.argv[1].endsWith('migration-pins-capture.mjs')) {
  const q = QUERIES[process.argv[2]];
  if (!q) {
    console.error(`usage: migration-pins-capture.mjs <${Object.keys(QUERIES).join('|')}>`);
    process.exit(2);
  }
  process.stdout.write(q + '\n');
}
