#!/usr/bin/env node
// Explicit, finite load of Club Data's accounting read model history
// (20261115020010): first every kept week boundary (each in its own
// transaction), then every
// accounting day in [from, through] that the load log does not hold yet
// (every day in the range when rebuild is "true"), oldest first, each in
// bounded parts (20261115063000): fn_ca_club_acct_seed_begin in one REPEATABLE
// READ transaction (the day's snapshot, minus the live projection's rows),
// then one short transaction per two-hour slice reading only source rows
// visible in that snapshot, then fn_ca_club_acct_seed_finish. No transaction
// comes near the five-minute snapshot bound (fn_ca_bound_outside_snapshots),
// which cancelled the one-transaction day load on 2026-11-15.
// Resumable: a loaded day is skipped, never re-sent, unless a rebuild is
// asked for. The first error stops the run (no retry); the next dispatch
// begins that day again. Never runs on a schedule.
import { pathToFileURL } from 'node:url';
import pg from 'pg';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export function parseRange(from, through) {
  if (!DAY.test(from || '') || !DAY.test(through || ''))
    throw new Error('from/through must be YYYY-MM-DD');
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

export async function loadLegacyPacific(client, days, rebuild) {
  const failed = [];
  const deadline = Date.now() + 250 * 60_000;
  for (const day of days) {
    if (Date.now() > deadline)
      throw new Error(
        'legacy Pacific finite runtime budget exhausted; remaining days stay incomplete'
      );
    const existing = await client.query(
      'SELECT 1 FROM public.ca_club_data_pacific_seed_log WHERE utc_day=$1 AND basis_version=1',
      [day]
    );
    if (existing.rowCount && !rebuild) {
      const failures = await client.query(
        'SELECT count(*)::int AS n FROM public.ca_club_data_pacific_failures WHERE utc_day=$1',
        [day]
      );
      if (failures.rows[0].n) failed.push(day);
      console.log(`[seed] Pacific UTC source ${day} already loaded; original receipt retained`);
      continue;
    }
    const result = await inTransaction(client, 'REPEATABLE READ', '240s', () =>
      client.query('SELECT public.fn_ca_club_data_pacific_seed($1::date,$2::boolean) AS receipt', [
        day,
        rebuild,
      ])
    );
    const receipt = result.rows[0].receipt;
    console.log(`[seed] Pacific UTC source ${day} ${JSON.stringify(receipt)}`);
    if (!receipt.complete) failed.push(day);
  }
  // A reconciled later day is useful even when earlier retained evidence is
  // incomplete. Every day is attempted once; unresolved days remain explicit.
  if (failed.length)
    throw new Error(`legacy Pacific source evidence incomplete: ${failed.join(', ')}`);
}

async function main() {
  const [from, through, rebuildArg, basisArg = 'union_accounting'] = process.argv.slice(2);
  const days = parseRange(from, through);
  if (![undefined, '', 'true', 'false'].includes(rebuildArg))
    throw new Error('rebuild must be true or false');
  const rebuild = rebuildArg === 'true';
  if (!['union_accounting', 'legacy_pacific'].includes(basisArg))
    throw new Error('unknown report basis');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    application_name: 'club-data-accounting-seed',
  });
  await client.connect();
  try {
    if (basisArg === 'legacy_pacific') {
      await loadLegacyPacific(client, days, rebuild);
      return;
    }
    const live = await inTransaction(client, 'READ COMMITTED', '10s', () =>
      client.query('SELECT live_from FROM public.ca_club_acct_state')
    );
    if (live.rowCount !== 1)
      throw new Error('the live projection (20261115020011) is not installed yet');
    console.log(`[seed] live projection since ${live.rows[0].live_from.toISOString()}`);
    // Every kept week boundary, each in its own short transaction, so a
    // certificate version arriving meanwhile waits at most one boundary.
    // Loaded before the days and again after them: a week whose boundary
    // certificate followed its invoice reconciles to the invoice only once
    // its days are loaded (20261115080136).
    async function loadBoundaries(when) {
      const kept = await client.query(
        'SELECT DISTINCT k.union_id, k.boundary FROM public.ca_union_pnl_boundary_capture k ORDER BY 1, 2'
      );
      for (const row of kept.rows) {
        const b = await inTransaction(client, 'READ COMMITTED', '120s', () =>
          client.query('SELECT public.fn_ca_club_acct_load_boundary($1, $2) AS n', [
            row.union_id,
            row.boundary,
          ])
        );
        if (b.rows[0].n === null)
          throw new Error(
            `boundary ${row.boundary.toISOString()} is being loaded by another transaction`
          );
        console.log(
          `[seed] ${when}: boundary ${row.boundary.toISOString()} union ${row.union_id}: ${b.rows[0].n} rows`
        );
      }
      const exact = await client.query(
        'SELECT boundary, opening_exact, closing_exact, opening_basis, closing_basis FROM public.ca_club_acct_boundary_log ORDER BY boundary'
      );
      for (const r of exact.rows)
        console.log(
          `[seed] ${when}: boundary ${r.boundary.toISOString()} opening ${r.opening_exact} (${r.opening_basis}), closing ${r.closing_exact} (${r.closing_basis})`
        );
    }
    await loadBoundaries('before the days');
    for (const day of days) {
      const seeded = await client.query(
        'SELECT bbj_version FROM public.ca_club_acct_seed_log WHERE acct_day = $1',
        [day]
      );
      if (seeded.rowCount && seeded.rows[0].bbj_version === 1 && !rebuild) {
        console.log(`[seed] ${day} already loaded`);
        continue;
      }
      const t0 = Date.now();
      const begun = await inTransaction(client, 'REPEATABLE READ', '240s', () =>
        client.query('SELECT public.fn_ca_club_acct_seed_begin($1::date, $2::boolean) AS receipt', [
          day,
          rebuild || seeded.rowCount > 0,
        ])
      );
      const snap = begun.rows[0].receipt.snapshot;
      const windows = await client.query(
        `SELECT g AS lo, LEAST(g + interval '2 hours', public.fn_ca_accounting_day_start($1::date + 1)) AS hi
           FROM generate_series(public.fn_ca_accounting_day_start($1::date),
                                public.fn_ca_accounting_day_start($1::date + 1) - interval '1 microsecond',
                                interval '2 hours') g ORDER BY g`,
        [day]
      );
      let facts = 0;
      let hands = 0;
      let unclassified = 0;
      let slowest = 0;
      for (const w of windows.rows) {
        const s0 = Date.now();
        const part = await inTransaction(client, 'READ COMMITTED', '240s', () =>
          client.query(
            'SELECT public.fn_ca_club_acct_seed_slice($1::date, $2, $3, $4::pg_snapshot) AS receipt',
            [day, w.lo, w.hi, snap]
          )
        );
        const p = part.rows[0].receipt;
        facts += Number(p.fact_inputs);
        hands += Number(p.hand_inputs);
        unclassified += Number(p.unclassified_flows);
        slowest = Math.max(slowest, Date.now() - s0);
      }
      const r = await inTransaction(client, 'READ COMMITTED', '240s', () =>
        client.query(
          'SELECT public.fn_ca_club_acct_seed_finish($1::date, $2::pg_snapshot, $3::bigint, $4::bigint, $5::bigint) AS receipt',
          [day, snap, unclassified, facts, hands]
        )
      );
      console.log(
        `[seed] ${day} ${JSON.stringify(r.rows[0].receipt)} ${((Date.now() - t0) / 1000).toFixed(1)} s ` +
          `(${windows.rowCount} parts, slowest ${(slowest / 1000).toFixed(1)} s)`
      );
    }
    await loadBoundaries('after the days');
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(
      '[seed] STOPPED: ' +
        e.message +
        ' (no retry; the next dispatch resumes after the last seeded day)'
    );
    process.exit(1);
  });
}
