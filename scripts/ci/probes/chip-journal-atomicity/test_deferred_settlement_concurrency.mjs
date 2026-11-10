// Two real sessions on one table/wallet: session A holds its transaction open
// while session B runs; B either waits on A's lock (expect_b_waits) or runs
// straight through, then both commit and the verify block checks the result.
import pg from './postgres-runtime/node_modules/pg/lib/index.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const input = JSON.parse(readFileSync(0, 'utf8'));
const opts = input.database ? { database: input.database } : {};
const a = new pg.Client(opts),
  b = new pg.Client(opts);
await a.connect();
await b.connect();
try {
  await a.query(input.setup);
  await a.query('BEGIN');
  await b.query('BEGIN');
  const pid = (await b.query('SELECT pg_backend_pid() pid')).rows[0].pid;
  await a.query(input.a);
  let settled = false;
  const pending = b
    .query(input.b)
    .then(
      (r) => ({ r }),
      (error) => ({ error })
    )
    .finally(() => {
      settled = true;
    });
  let waited = false;
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline && !settled) {
    const s = (await a.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid]))
      .rows[0];
    if (s?.wait_event_type === 'Lock') {
      waited = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(
    waited,
    input.expect_b_waits,
    `session B ${input.expect_b_waits ? 'must' : 'must not'} wait on session A`
  );
  await a.query('COMMIT');
  const second = await pending;
  assert.equal(second.error, undefined, String(second.error?.message));
  await b.query('COMMIT');
  await a.query(input.verify);
  console.log(
    'PASS concurrent ' + input.name + (waited ? ' (serialized on the shared row)' : ' (no wait)')
  );
} finally {
  await a.query('ROLLBACK').catch(() => {});
  await b.query('ROLLBACK').catch(() => {});
  if (input.cleanup) await a.query(input.cleanup).catch(() => {});
  await a.end();
  await b.end();
}
