/** Native isolated request lifecycle, crash adoption and queued-send qualification. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
const [host, port, database, scenario, output] = process.argv.slice(2);
assert(host.startsWith('/'));
assert(/^r46_mtt_isolation_[0-9a-f]{32}$/.test(database));
assert(['commit-replay', 'close-queued-send', 'adopt-original'].includes(scenario));
const config = {
  host,
  port: Number(port),
  database,
  user: 'postgres',
  connectionTimeoutMillis: 5000,
};
const a = new pg.Client(config),
  b = new pg.Client(config),
  observer = new pg.Client(config);
const event = '92010000-0000-0000-0000-000000000001';
const generation = '92090000-0000-4000-8000-000000000002';
const successor = '92090000-0000-4000-8000-000000000005';
const id = '92090000-0000-4000-8000-000000000003';
let waiterProven = false;
async function actor(c: pg.Client, g = generation) {
  await c.query('BEGIN');
  await c.query("SET LOCAL statement_timeout='12s'; SET LOCAL lock_timeout='8s'");
  await c.query(
    "SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true),set_config('request.jwt.claim.role','service_role',true),set_config('app.smarter_data_actor','tournament-manager',true),set_config('app.smarter_tournament_id',$1,true),set_config('app.smarter_tournament_lease_generation',$2,true)",
    [event, g]
  );
  await c.query('SET LOCAL ROLE service_role');
}
async function snapshot() {
  const names = (
    await observer.query(
      "SELECT n.nspname||'.'||c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','smarter_private') AND c.relkind='r' ORDER BY 1"
    )
  ).rows;
  const rows: Record<string, unknown> = {};
  for (const { name } of names) {
    assert(/^(public|smarter_private)\.[a-z_0-9]+$/.test(name));
    rows[name] = (
      await observer.query(
        `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM ${name} t`
      )
    ).rows[0].rows;
  }
  return rows;
}
async function execute(c: pg.Client, g = generation) {
  return (
    await c.query('SELECT public.fn_execute_tournament_terminal_request($1,$2) AS value', [id, g])
  ).rows[0].value;
}
try {
  await Promise.all([a, b, observer].map((c) => c.connect()));
  for (const c of [a, b, observer]) {
    const proof = (
      await c.query(
        "SELECT inet_server_addr() IS NULL AS local,current_setting('server_version_num')::int AS version"
      )
    ).rows[0];
    assert(proof.local && proof.version >= 170000 && proof.version < 180000);
  }
  const winner = (await observer.query("SELECT md5('zero-default-spin-launch-user:2')::uuid AS id"))
    .rows[0].id;
  const identity = { kind: 'places', tournamentId: event, observedWinnerId: winner };
  await a.query('SELECT * FROM public.claim_tournament_lease_v2($1,$2,$3,$4,30)', [
    event,
    'original',
    'native',
    generation,
  ]);
  await actor(a);
  const prepared = (
    await a.query('SELECT public.fn_prepare_tournament_terminal_request($1,$2,$3) AS value', [
      id,
      identity,
      generation,
    ])
  ).rows[0].value;
  assert.equal(prepared.request.phase, 'prepared');
  assert.deepEqual(prepared.request.original_request, identity);
  await a.query('COMMIT');
  const original = await snapshot();
  if (scenario === 'commit-replay') {
    await actor(a);
    const first = await execute(a);
    await a.query('COMMIT');
    assert.equal(first.request.phase, 'committed');
    assert.equal(first.receipt.fully_settled, true);
    const paid = await snapshot();
    // Simulated process loss: original result is not used by the fresh reader.
    const resolved = (
      await b.query('SELECT public.fn_resolve_tournament_terminal_request($1) AS value', [id])
    ).rows[0].value;
    assert.deepEqual(resolved.outcome.receipt, first.receipt);
    await actor(b);
    assert.deepEqual(await execute(b), first);
    await b.query('COMMIT');
    assert.deepEqual(await snapshot(), paid);
    const prizes = (
      await observer.query('SELECT amount FROM public.tournament_payouts WHERE tournament_id=$1', [
        event,
      ])
    ).rows;
    assert.deepEqual(
      prizes.map((r) => Number(r.amount)),
      [2]
    );
  } else if (scenario === 'close-queued-send') {
    await actor(a);
    const closed = (
      await a.query(
        'SELECT public.fn_close_uncommitted_tournament_terminal_request($1,$2) AS value',
        [id, generation]
      )
    ).rows[0].value;
    assert.equal(closed.request.phase, 'closed');
    assert.equal(closed.outcome.definitively_not_committed, true);
    await actor(b);
    const aPid = (await a.query('SELECT pg_backend_pid() AS id')).rows[0].id;
    const bPid = (await b.query('SELECT pg_backend_pid() AS id')).rows[0].id;
    const queued = execute(b).then(
      (value) => ({ value, error: null }),
      (error) => ({ value: null, error })
    );
    const until = performance.now() + 3000;
    while (performance.now() < until) {
      const blocked = (
        await observer.query('SELECT $1::int=ANY(pg_blocking_pids($2::int)) AS blocked', [
          aPid,
          bPid,
        ])
      ).rows[0].blocked;
      if (blocked) {
        waiterProven = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert(waiterProven, 'late original sender must actually wait behind close');
    await a.query('COMMIT');
    const answer = await queued;
    assert.equal(answer.error?.code, '55000');
    await b.query('ROLLBACK');
    const after = await snapshot();
    delete original['smarter_private.tournament_terminal_requests'];
    delete after['smarter_private.tournament_terminal_requests'];
    assert.deepEqual(after, original);
  } else {
    // Isolated clock advance simulates expiry after the original process dies.
    await observer.query(
      "UPDATE public.engine_tournament_leases SET heartbeat_at=clock_timestamp()-interval '31 seconds' WHERE tournament_id=$1",
      [event]
    );
    const claim = (
      await b.query('SELECT * FROM public.claim_tournament_lease_v2($1,$2,$3,$4,30)', [
        event,
        'successor',
        'native',
        successor,
      ])
    ).rows[0];
    assert.equal(claim.granted, true);
    await actor(b, successor);
    const adopted = (
      await b.query('SELECT public.fn_adopt_tournament_terminal_request($1,$2,$3) AS value', [
        id,
        generation,
        successor,
      ])
    ).rows[0].value;
    assert.deepEqual(adopted.request.original_request, identity);
    assert.equal(adopted.request.original_generation, generation);
    assert.equal(adopted.request.current_generation, successor);
    await b.query('COMMIT');
    await actor(a);
    const stale = await execute(a).then(
      () => null,
      (e) => e
    );
    assert.equal(stale?.code, '42501');
    await a.query('ROLLBACK');
    await actor(b, successor);
    const final = await execute(b, successor);
    assert.equal(final.request.phase, 'committed');
    await b.query('COMMIT');
    assert.equal(
      (
        await observer.query(
          'SELECT count(*)::int AS n FROM public.tournament_payouts WHERE tournament_id=$1',
          [event]
        )
      ).rows[0].n,
      1
    );
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        passed: true,
        scenario,
        waiterProven,
        limits: [
          'Isolated synthetic final roster; actual funded SNG and canonical financial functions.',
          'PostgreSQL concurrency and process-adoption identity; no production or hand-engine continuity claim.',
        ],
      },
      null,
      2
    )
  );
} finally {
  for (const c of [a, b, observer]) {
    await c.query('ROLLBACK').catch(() => {});
    await c.end().catch(() => {});
  }
}
