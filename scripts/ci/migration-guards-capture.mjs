/**
 * What the pre-merge DDL-guard check reads from production (2026-11-18,
 * incident 075013fd). Constant SQL with no input from any branch: the capture
 * job of window-migrations-install-before-merge.yml runs each query on the
 * default branch's checkout with `default_transaction_read_only=on`, beside
 * the schema export it already makes, and hands the answers to the job that
 * reads the pull request's files (migration-guards-before-merge.mjs). No
 * import, so the capture's sparse checkout needs only this file.
 *
 *   guards-catalog.tsv / guards-public.tsv
 *            every function and procedure in public and smarter_private with
 *            its body md5 in BOTH forms the applier's stale-pin guard takes
 *            (migration-stale-pins.mjs SNAPSHOT: search_path pg_catalog, then
 *            public), joined by oid. Signatures print schema-qualified.
 *   guards-hex.tsv / guards-hex-public.tsv
 *            every (pinning function, md5) pair where an installed function's
 *            source (any pg_proc row, as the guard searches) contains a
 *            CURRENT function body md5 of public/smarter_private in either
 *            form. Nothing else from any source leaves production.
 *   guards-event-triggers.tsv
 *            production's enabled event triggers: the DDL guards that run on
 *            production and nowhere else. A schema-only archive taken with
 *            -n does not carry them; the check re-creates them on its copy.
 *   guards-copy-<table>.txt
 *            the rows those guards read (COPY ... TO STDOUT is read-only): the
 *            money-RPC registry fn_ca_money_rpc_registry_guard consults, and
 *            the body lineage fn_ca_function_lineage_on_create refuses from.
 * About 0.5 s on production 2026-11-18 (10,953 functions, 3,387 hex runs,
 * 607 registry rows, 12,514 lineage rows).
 */
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

// A pin is an installed function's source containing a CURRENT function's body
// md5 (either form the guard takes). Only those pairs leave production: every
// other hex string in any source stays there (the repository is public, and so
// is this run's artifact). strpos(prosrc, md5) > 0 exactly when the md5 lies
// inside a maximal [0-9a-f]{32,} run, so runs are matched, never sources
// shipped: equality for a 32-character run (a hash join), strpos for a longer
// one. The pinner is any pg_proc row, as the guard searches; the public-path
// query prints its oid (search_path public would print it unqualified), which
// the loader maps through guards-catalog.tsv.
const pinsSQL = (path, pinner) =>
  `
SET search_path = ${path};
WITH cur AS (
  SELECT DISTINCT pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) AS m
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'smarter_private') AND p.prokind IN ('f', 'p')
), runs AS (
  SELECT DISTINCT q.oid, r[1] AS run
    FROM pg_catalog.pg_proc q
    CROSS JOIN LATERAL pg_catalog.regexp_matches(q.prosrc, '[0-9a-f]{32,}', 'g') r
)
SELECT DISTINCT ${pinner}, cur.m
  FROM runs JOIN cur ON runs.run = cur.m
UNION
SELECT DISTINCT ${pinner}, cur.m
  FROM runs JOIN cur ON pg_catalog.length(runs.run) > 32 AND pg_catalog.strpos(runs.run, cur.m) > 0
 ORDER BY 1, 2;
`.trim();

export const PINS_SQL = pinsSQL('pg_catalog', 'runs.oid::pg_catalog.regprocedure::text');
export const PINS_SQL_PUBLIC_PATH = pinsSQL('public', "'oid:' || runs.oid::text");

export const EVENT_TRIGGERS_SQL = `
SET search_path = pg_catalog;
SELECT e.evtname, e.evtevent, e.evtfoid::regprocedure::text, n.nspname,
       COALESCE(array_to_string(e.evttags, '|'), '')
  FROM pg_catalog.pg_event_trigger e
  JOIN pg_catalog.pg_proc p ON p.oid = e.evtfoid
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE e.evtenabled <> 'D'
 ORDER BY 1;
`.trim();

export const INSTALLED_NAMES_SQL = `
SELECT version, COALESCE(name, '') FROM supabase_migrations.schema_migrations ORDER BY 1;
`.trim();

/** Tables the production DDL guards read, copied so the copy's guards answer as production's do. */
export const GUARD_TABLES = [
  'public.ca_money_rpc_registry',
  'smarter_private.function_body_lineage',
];

export const copyFile = (table) => `guards-copy-${table.split('.')[1]}.txt`;

/** query name -> [SQL, output file under the capture directory] */
export const CAPTURES = {
  'catalog-catalog-path': [CATALOG_SQL_CATALOG_PATH, 'guards-catalog.tsv'],
  'catalog-public-path': [CATALOG_SQL_PUBLIC_PATH, 'guards-public.tsv'],
  pins: [PINS_SQL, 'guards-hex.tsv'],
  'pins-public-path': [PINS_SQL_PUBLIC_PATH, 'guards-hex-public.tsv'],
  'event-triggers': [EVENT_TRIGGERS_SQL, 'guards-event-triggers.tsv'],
  // Names production recorded each version under (isPending's name evidence).
  'installed-names': [INSTALLED_NAMES_SQL, 'installed-names.tsv'],
  ...Object.fromEntries(
    GUARD_TABLES.map((t) => [`copy-${t.split('.')[1]}`, [`COPY ${t} TO STDOUT;`, copyFile(t)]])
  ),
};

// CLI: node scripts/ci/migration-guards-capture.mjs list          -> "<name> <file>" per line
//      node scripts/ci/migration-guards-capture.mjs sql <name>    -> that query
if (process.argv[1] && process.argv[1].endsWith('migration-guards-capture.mjs')) {
  const [cmd, name] = process.argv.slice(2);
  if (cmd === 'list') {
    for (const [n, [, file]] of Object.entries(CAPTURES)) process.stdout.write(`${n} ${file}\n`);
  } else if (cmd === 'sql' && CAPTURES[name]) {
    process.stdout.write(CAPTURES[name][0] + '\n');
  } else {
    console.error(
      `usage: migration-guards-capture.mjs list | sql <${Object.keys(CAPTURES).join('|')}>`
    );
    process.exit(2);
  }
}
