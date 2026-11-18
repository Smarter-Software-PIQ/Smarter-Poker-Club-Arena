/** Real sockets in a disposable PG17. A missing client error listener kills this
 * child process: no uncaughtException handler can turn that crash into a pass. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createLightningLaneSession } from '../../src/services/lightningLaneSession.js';
import { createLightningFoldSession } from '../../src/services/lightningFoldSession.js';

const [kind, mode] = process.argv.slice(2);
assert(['lane', 'fold'].includes(kind));
assert(['commit', 'idle', 'inflight'].includes(mode));
// Only the runner's newly-created local Unix socket is accepted. Never read a
// database URL or inherited PGHOST, and never terminate a remote backend.
const host = process.env.LIGHTNING_FIXTURE_SOCKET;
assert(host?.startsWith('/') && !host.includes('..'));
const connection = { host, port: 5432, database: 'postgres' };
const admin = new pg.Pool({ ...connection, user: 'postgres', max: 1 });
const role = `engine_lightning_${kind}`;
const applicationName = `socket-loss-${randomUUID()}`;
const lines: string[] = [];
let inspectCheckout = false;
let checkedOutErrorListeners = -1;
const pool = () => {
  const real = new pg.Pool({
    ...connection,
    user: role,
    max: kind === 'lane' ? 6 : 4,
    idleTimeoutMillis: 0,
    connectionTimeoutMillis: 5000,
    application_name: applicationName,
  });
  return {
    on: real.on.bind(real),
    end: () => real.end(),
    connect: async () => {
      const client = await real.connect();
      // pg-pool has removed its idle listener before resolving connect().
      // Capture coverage while the socket is held, before termination/release
      // ordering can mask a missing lifetime listener on some pg versions.
      if (inspectCheckout) checkedOutErrorListeners = client.listenerCount('error');
      return client;
    },
  };
};
const session =
  kind === 'lane'
    ? createLightningLaneSession({
        readUrl: async () => 'postgres://engine_lightning_lane:fixture@localhost/postgres',
        openPool: pool,
        actorHeaders: () => ({}),
        log: (line) => lines.push(line),
        timeoutMs: 15000,
      })
    : createLightningFoldSession({
        readUrl: async () => 'postgres://engine_lightning_fold:fixture@localhost/postgres',
        openPool: pool,
        log: (line) => lines.push(line),
        timeoutMs: 15000,
      });
const query = async (sql: string, args: unknown[] = []) => (await admin.query(sql, args)).rows;
const attempts = async () =>
  Number(
    (
      await query(
        'SELECT CASE WHEN is_called THEN last_value ELSE 0 END AS n FROM smarter_private.attempts'
      )
    )[0].n
  );
const effects = async (id: string) =>
  Number(
    (await query('SELECT count(*) AS n FROM smarter_private.effects WHERE request_id=$1', [id]))[0]
      .n
  );
const idleReports = () => lines.filter((line) => line.includes('idle socket lost')).length;
const call = (id: string) =>
  kind === 'lane'
    ? (session as ReturnType<typeof createLightningLaneSession>).call('fn_lightning_settle_hand', {
        p_request_id: id,
      })
    : (session as ReturnType<typeof createLightningFoldSession>).call({
        p_hand_id: randomUUID(),
        p_player_id: randomUUID(),
        p_request_id: id,
        p_fold_type: 'fast',
        p_committed: 0,
      });
async function until<T>(
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  label: string
): Promise<T> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const value = await read();
    if (ready(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
try {
  assert.equal(await session.start(), true);
  const initial = await attempts();
  const id = randomUUID();
  if (mode === 'idle') {
    const before = idleReports();
    const killed = await query(
      "SELECT pid, pg_terminate_backend(pid) AS killed FROM pg_stat_activity WHERE usename=$1 AND application_name=$2 AND state='idle'",
      [role, applicationName]
    );
    assert(killed.length > 0 && killed.every((row) => row.killed));
    await until(
      async () => idleReports() - before,
      (n) => n === killed.length,
      'one idle report per lost socket'
    );
  }
  if (mode === 'inflight') {
    await query('UPDATE smarter_private.ctl SET sleep_ms=30000');
    const before = idleReports();
    inspectCheckout = true;
    const pending = call(id);
    // Attach immediately, even if the acquisition/query unexpectedly rejects.
    pending.catch(() => undefined);
    const active = await until(
      () =>
        query(
          "SELECT pid FROM pg_stat_activity WHERE usename=$1 AND application_name=$2 AND state='active' AND wait_event='PgSleep'",
          [role, applicationName]
        ),
      (rows) => rows.length === 1,
      'this request inside the fixture wrapper'
    );
    assert.equal(
      (await query('SELECT pg_terminate_backend($1) AS killed', [active[0].pid]))[0].killed,
      true
    );
    const result = await pending;
    inspectCheckout = false;
    assert(checkedOutErrorListeners > 0, 'checked-out socket retains an error listener');
    assert.equal(
      result?.error?.code,
      kind === 'lane' ? 'LIGHTNING_LANE_UNKNOWN' : 'LIGHTNING_FOLD_UNKNOWN'
    );
    assert.equal((await attempts()) - initial, 1, 'interrupted request dispatched exactly once');
    assert.equal(
      await effects(id),
      0,
      'request-id readback proves this aborted fixture has no effect'
    );
    assert.equal(idleReports(), before, 'in-use loss must not use the idle reporter');
    await query('UPDATE smarter_private.ctl SET sleep_ms=0');
  } else {
    assert.equal((await call(id))?.error, null);
    assert.equal(await effects(id), 1);
  }
  // A successful subsequent commit proves this same process survived and the
  // original session reacquired a usable socket. Check attempts again afterward.
  const next = randomUUID();
  assert.equal((await call(next))?.error, null);
  assert.equal(await effects(next), 1);
  assert.equal((await attempts()) - initial, 2, 'no automatic resend before subsequent commit');
  console.log(
    JSON.stringify({
      kind,
      mode,
      passed: true,
      attempts: 2,
      interruptedRequestEffects: await effects(id),
    })
  );
} finally {
  await session.stop();
  await admin.end();
}
