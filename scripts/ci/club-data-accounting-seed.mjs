#!/usr/bin/env node
// Explicit, finite load of Club Data's accounting read model history
// (20261115020010): first every kept week boundary
// (fn_ca_club_acct_load_boundaries, its own transaction), then every
// accounting day in [from, through] that the load log does not hold yet
// (every day in the range when rebuild is "true"), oldest first, one
// REPEATABLE READ transaction per day through fn_ca_club_acct_seed_day (the
// whole day minus the live projection's aggregate rows, one snapshot).
// Resumable: a loaded day is skipped, never re-sent, unless a rebuild is
// asked for. The first error stops the run (no retry); the next dispatch
// resumes after the last committed day. Never runs on a schedule.
import { pathToFileURL } from 'node:url';
import pg from 'pg';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export function parseRange(from, through) {
  if (!DAY.test(from || '') || !DAY.test(through || '')) throw new Error('from/through must be YYYY-MM-DD');
  const a = Date.parse(from + 'T00:00:00Z');
  const b = Date.parse(through + 'T00:00:00Z');
  if (!(a <= b)) throw new Error('from must not be after through');
  const n = Math.round((b - a) / 86400000) + 1;
  if (n > 120) throw new Error('at most 120 accounting days per run');
  return Array.from({ length: n }, (_, i) => new Date(a + i * 86400000).toISOString().slice(0, 10));
}

async function inTransaction(client, isolation, timeouts, fn) {
  await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
  try {
    // Timeouts are LOCAL to this transaction, so nothing outlives it.
    await client.query(`SET LOCAL lock_timeout = '1s'`);
    await client.query(`SET LOCAL statement_timeout = '${timeouts}'`);
    const r = await fn();
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  }
}

async function main() {
  const [from, through, rebuildArg] = process.argv.slice(2);
  const days = parseRange(from, through);
  if (![undefined, '', 'true', 'false'].includes(rebuildArg)) throw new Error('rebuild must be true or false');
  const rebuild = rebuildArg === 'true';
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, application_name: 'club-data-accounting-seed' });
  await client.connect();
  try {
    const live = await inTransaction(client, 'READ COMMITTED', '10s', () =>
      client.query('SELECT live_from FROM public.ca_club_acct_state')
    );
    if (live.rowCount !== 1) throw new Error('the live projection (20261115020011) is not installed yet');
    console.log(`[seed] live projection since ${live.rows[0].live_from.toISOString()}`);
    const b = await inTransaction(client, 'READ COMMITTED', '300s', () =>
      client.query('SELECT public.fn_ca_club_acct_load_boundaries() AS receipt')
    );
    console.log(`[seed] boundaries ${JSON.stringify(b.rows[0].receipt)}`);
    for (const day of days) {
      const seeded = await client.query('SELECT 1 FROM public.ca_club_acct_seed_log WHERE acct_day = $1', [day]);
      if (seeded.rowCount && !rebuild) {
        console.log(`[seed] ${day} already loaded`);
        continue;
      }
      const t0 = Date.now();
      const r = await inTransaction(client, 'REPEATABLE READ', '660s', () =>
        client.query('SELECT public.fn_ca_club_acct_seed_day($1::date, $2::boolean) AS receipt', [day, rebuild])
      );
      console.log(`[seed] ${day} ${JSON.stringify(r.rows[0].receipt)} ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('[seed] STOPPED: ' + e.message + ' (no retry; the next dispatch resumes after the last seeded day)');
    process.exit(1);
  });
}
