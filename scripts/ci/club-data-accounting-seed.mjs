#!/usr/bin/env node
// Explicit, finite load of Club Data's accounting read model history
// (20261115004729): every accounting day in [from, through] that the load log
// does not hold yet (every day in the range when rebuild is "true"), oldest
// first, one REPEATABLE READ transaction per day through
// fn_ca_club_acct_seed_day (the whole day minus the live projection's rows,
// one snapshot), then the pnl_boundary certificates whose boundary lies in
// the range. Resumable: a loaded day is skipped, never re-sent, unless a
// rebuild is asked for. The first error stops the run (no retry); the next
// dispatch resumes after the last committed day. Never runs on a schedule.
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

async function main() {
  const [from, through, rebuildArg] = process.argv.slice(2);
  const days = parseRange(from, through);
  if (![undefined, '', 'true', 'false'].includes(rebuildArg)) throw new Error('rebuild must be true or false');
  const rebuild = rebuildArg === 'true';
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, application_name: 'club-data-accounting-seed' });
  await client.connect();
  try {
    await client.query("SET lock_timeout = '1s'");
    const live = await client.query('SELECT live_from FROM public.ca_club_acct_state');
    if (live.rowCount !== 1) throw new Error('the live projection (20261115010436) is not installed yet');
    console.log(`[seed] live projection since ${live.rows[0].live_from.toISOString()}`);
    for (const day of days) {
      const seeded = await client.query('SELECT 1 FROM public.ca_club_acct_seed_log WHERE acct_day = $1', [day]);
      if (seeded.rowCount && !rebuild) {
        console.log(`[seed] ${day} already loaded`);
        continue;
      }
      const t0 = Date.now();
      await client.query("SET statement_timeout = '660s'");
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      let r;
      try {
        r = await client.query('SELECT public.fn_ca_club_acct_seed_day($1::date, $2::boolean) AS receipt', [
          day,
          rebuild,
        ]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      }
      console.log(`[seed] ${day} ${JSON.stringify(r.rows[0].receipt)} ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
    const b = await client.query(
      `SELECT c.union_id, c.period_start FROM public.accounting_close_certificates c
        WHERE c.kind = 'pnl_boundary' AND c.period_start = c.period_end
          AND c.period_start >= public.fn_ca_accounting_day_start($1::date)
          AND c.period_start <= public.fn_ca_accounting_day_start($2::date + 1)
        ORDER BY c.period_start`,
      [days[0], days[days.length - 1]]
    );
    for (const row of b.rows) {
      const r = await client.query('SELECT public.fn_ca_club_acct_load_boundary($1, $2) AS n', [row.union_id, row.period_start]);
      console.log(`[seed] boundary ${row.period_start.toISOString()} union ${row.union_id}: ${r.rows[0].n} rows`);
    }
  } finally {
    await client.end().catch(() => {});
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error('[seed] STOPPED: ' + e.message + ' (no retry; the next dispatch resumes after the last seeded day)');
    process.exit(1);
  });
}
