// Causal ordering regression in the maintained native TLS PostgreSQL fixture.
// Execute the actual applier's observation/budget seam, with a real reader
// beginning on the first budget round trip. No production database is used.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import {
  observeWheelWalletReaders,
  WHEEL_WALLET_CUTOVER,
} from '../../wheel-wallet-lock-observation.mjs';
const [root, ca] = process.argv.slice(2);
const source = readFileSync(`${root}/scripts/ci/apply-recorded-migration.mjs`, 'utf8');
const observationStart = source.indexOf(
  'if (ordinaryTransaction && file === WHEEL_WALLET_CUTOVER) {'
);
const observationEnd = source.indexOf('const started = Date.now();', observationStart);
const budgetStart = source.indexOf(
  'if (MAINTENANCE_WINDOW || ordinaryTransaction) {',
  source.indexOf('// Ordinary installs must not retain')
);
assert(budgetStart >= 0 && observationStart > budgetStart);
const observation = source.slice(observationStart, observationEnd);
const budget = source.slice(budgetStart, observationStart);
const migration = readFileSync(`${root}/supabase/migrations/${WHEEL_WALLET_CUTOVER}`, 'utf8');
const lock = /^\s*LOCK TABLE ([a-z0-9_., ]+) IN ACCESS EXCLUSIVE MODE NOWAIT;$/m.exec(migration);
assert(lock);
const tables = lock[1].split(',').map((t) => t.trim());
assert.equal(tables.length, 15);
const connect = async () => {
  const c = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { ca: readFileSync(ca, 'utf8'), rejectUnauthorized: true },
  });
  await c.connect();
  return c;
};
const client = await connect();
const holder = await connect();
const setup = new pg.Client({
  host: process.env.WINDOW_WORK,
  port: Number(process.env.WINDOW_PORT),
  user: 'supabase_admin',
  database: 'postgres',
});
await setup.connect();
// Reuse the ordinary-budget fixture's clock isolation, then restore the exact
// baseline function before the existing window qualification proceeds.
const originalDoor = (
  await setup.query(
    "SELECT pg_get_functiondef('public.fn_ca_break_window_refuses_migrations(timestamptz)'::regprocedure) AS definition"
  )
).rows[0].definition;
await setup.query(
  "CREATE OR REPLACE FUNCTION public.fn_ca_break_window_refuses_migrations(p_at timestamptz) RETURNS text LANGUAGE sql AS 'SELECT NULL::text'"
);

// Preserve the baseline database after this case; these names are fixture-only.
await setup.query(
  tables.map((t) => `CREATE TABLE ${t}(id int); ALTER TABLE ${t} OWNER TO postgres`).join(';')
);
const quietStart = migration.indexOf('DO $quiet$');
const quietEnd = migration.indexOf('-- Require a finished', quietStart);
assert(quietStart >= 0 && quietEnd > quietStart);
const transactionSQL = `BEGIN; SET LOCAL lock_timeout='1s'; SET LOCAL statement_timeout='5s'; ${migration.slice(quietStart, quietEnd)} CREATE TABLE public.wallet_order_receipt AS SELECT session_user::text AS actor; COMMIT;`;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = async (code) => {
  let armed = false;
  let release;
  const proxy = {
    query: async (...args) => {
      if (
        !armed &&
        typeof args[0] === 'string' &&
        args[0].includes("current_setting('server_version_num')")
      ) {
        armed = true;
        await holder.query('BEGIN; LOCK TABLE public.profiles IN ACCESS SHARE MODE');
        release = new Promise((resolve, reject) =>
          setTimeout(() => holder.query('COMMIT').then(resolve, reject), 3200)
        );
      }
      return client.query(...args);
    },
    end: async () => {},
  };
  const fail = (message) => {
    throw new Error(message);
  };
  const execute = new AsyncFunction(
    'client',
    'sql',
    'observeWheelWalletReaders',
    'WHEEL_WALLET_CUTOVER',
    'file',
    'ordinaryTransaction',
    'MAINTENANCE_WINDOW',
    'ordinaryBudgetMs',
    'TRANSACTION_BUDGET_SECONDS',
    'refusalNow',
    'refused',
    'unknown',
    'transactionSQL',
    `${code}\nawait client.query(transactionSQL);`
  );
  let error;
  try {
    await execute(
      proxy,
      migration,
      observeWheelWalletReaders,
      WHEEL_WALLET_CUTOVER,
      WHEEL_WALLET_CUTOVER,
      true,
      false,
      12000,
      8,
      async () => null,
      fail,
      fail,
      transactionSQL
    );
  } catch (e) {
    error = e;
    await client.query('ROLLBACK');
  }
  await release;
  assert(armed);
  return error;
};
try {
  // Exact predecessor order: observe first, two budget queries, then one send.
  const before = await run(observation + budget);
  assert.equal(before?.code, '55P03', before?.message);
  assert.equal(
    (await client.query("SELECT to_regclass('public.wallet_order_receipt') AS receipt")).rows[0]
      .receipt,
    null
  );
  // Actual candidate order: finish budget setup, then observe immediately.
  const after = await run(budget + observation);
  assert.equal(after, undefined, after?.message);
  assert.deepEqual((await client.query('SELECT * FROM public.wallet_order_receipt')).rows, [
    { actor: 'postgres' },
  ]);
  console.log(
    'PASS wallet ordering: actual two-budget-query reader race refuses before; observation-last waits for natural completion and one unchanged NOWAIT transaction succeeds'
  );
} finally {
  await setup.query(
    'DROP TABLE IF EXISTS public.wallet_order_receipt; ' +
      tables.map((t) => `DROP TABLE ${t}`).join(';')
  );
  await setup.query(originalDoor);
  await setup.end();
  await holder.end();
  await client.end();
}
