/** Native isolated request lifecycle, crash adoption and queued-send qualification. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
const [host, port, database, scenario, output] = process.argv.slice(2);
assert(host.startsWith('/'));
assert(/^r46_mtt_isolation_[0-9a-f]{32}$/.test(database));
assert(
  [
    'commit-replay',
    'close-queued-send',
    'adopt-original',
    'maintenance-before',
    'maintenance-after',
    'reservation-before',
    'reservation-after',
  ].includes(scenario)
);
const config = {
  host,
  port: Number(port),
  database,
  user: 'postgres',
  connectionTimeoutMillis: 5000,
};
const a = new pg.Client(config),
  b = new pg.Client(config),
  observer = new pg.Client(config),
  incoming = new pg.Client(config);
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
    await c.query(
      `SELECT public.${['maintenance-after', 'reservation-after'].includes(scenario) ? 'fn_execute_capped_satellite_terminal_request' : 'fn_execute_tournament_terminal_request'}($1,$2) AS value`,
      [id, g]
    )
  ).rows[0].value;
}
try {
  await Promise.all([a, b, observer, incoming].map((c) => c.connect()));
  for (const c of [a, b, observer, incoming]) {
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
  await observer.query(
    "BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.tournaments SET status='COMPLETING' WHERE id='92010000-0000-0000-0000-000000000001'; COMMIT"
  );
  await actor(a);
  const absent = await a
    .query("SELECT public.fn_f06_assert_drained_manager_custody($1,$2,NULL,'[]'::jsonb,NULL)", [
      event,
      generation,
    ])
    .then(
      () => null,
      (error) => error
    );
  assert.equal(absent?.code, '55000');
  await a.query('ROLLBACK');
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
  if (scenario === 'commit-replay') {
    const unchanged = await snapshot();
    for (const conflictingId of [id, '92090000-0000-4000-8000-000000000006']) {
      await actor(a);
      const refusal = await a
        .query('SELECT public.fn_prepare_tournament_terminal_request($1,$2,$3)', [
          conflictingId,
          { ...identity, observedWinnerId: '92090000-0000-4000-8000-000000000007' },
          generation,
        ])
        .then(
          () => null,
          (error) => error
        );
      assert.equal(
        refusal?.code,
        '55000',
        'stable original-identity refusal must not trigger PostgREST serialization retries'
      );
      await a.query('ROLLBACK');
      assert.deepEqual(await snapshot(), unchanged);
    }
  }
  await actor(a);
  const custody = (
    await a.query(
      "SELECT public.fn_f06_assert_drained_manager_custody($1,$2,NULL,'[]'::jsonb,NULL) AS value",
      [event, generation]
    )
  ).rows[0].value;
  assert.equal(custody.ok, true);
  assert.equal(custody.recovery_required, false);
  await a.query('COMMIT');
  if (scenario === 'close-queued-send') {
    // RUNNING misses may reopen gameplay only after their old send is closed.
    await observer.query(
      "BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.tournaments SET status='RUNNING' WHERE id='92010000-0000-0000-0000-000000000001'; COMMIT"
    );
  } else {
    await actor(a);
    const retained = (
      await a.query(
        'SELECT public.fn_close_uncommitted_tournament_terminal_request($1,$2) AS value',
        [id, generation]
      )
    ).rows[0].value;
    assert.equal(
      retained.request.phase,
      'prepared',
      'COMPLETING cannot discard its original continuation'
    );
    await a.query('COMMIT');
  }
  const original = await snapshot();
  if (scenario.startsWith('reservation-')) {
    const aPid = (await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const bPid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const incomingPid = (await incoming.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const token = '92090000-0000-4000-8000-000000000098';
    const times = (
      await observer.query(
        "SELECT clock_timestamp()-interval '2 minutes' AS announced,clock_timestamp() AS started,clock_timestamp()+interval '5 minutes' AS ended"
      )
    ).rows[0];
    const freeze = () =>
      b.query(
        "SELECT public.fn_save_engine_maintenance_break('counting_down',$1,$2,$3,'native','native',$4)",
        [times.announced, times.started, times.ended, token]
      );
    await actor(a);
    const paid = await execute(a);
    assert.equal(paid.request.phase, 'committed');
    if (scenario === 'reservation-before') {
      assert.equal(
        (
          await freeze().then(
            () => null,
            (e) => e
          )
        )?.code,
        '55P03'
      );
      await actor(incoming);
      const next = execute(incoming);
      const until = performance.now() + 3000;
      let admitted = false;
      while (performance.now() < until) {
        admitted = (
          await observer.query(
            "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND classid=530090 AND objid=1 AND objsubid=2 AND mode='ShareLock' AND granted) AS held",
            [incomingPid]
          )
        ).rows[0].held;
        if (admitted) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert(admitted, 'installed preimage lets another long reader join the busy global lane');
      await a.query('COMMIT');
      assert.deepEqual(await next, paid);
      assert.equal(
        (
          await freeze().then(
            () => null,
            (e) => e
          )
        )?.code,
        '55P03',
        'overlapping admitted readers refuse the next writer too'
      );
      await incoming.query('COMMIT');
      await freeze();
    } else {
      assert(
        (
          await observer.query(
            "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND classid=530090 AND objid=2 AND objsubid=2 AND mode='ShareLock' AND granted) AS held",
            [aPid]
          )
        ).rows[0].held
      );
      // A second real terminal sender is admitted concurrently on shared lane 2.
      // Its original event lane waits for the first sender, exactly as before.
      await actor(incoming);
      const alreadyAdmitted = execute(incoming);
      let sharedGroup = false;
      const groupUntil = performance.now() + 3000;
      while (performance.now() < groupUntil) {
        sharedGroup =
          (
            await observer.query(
              "SELECT count(*)::int AS n FROM pg_locks WHERE pid=ANY($1::int[]) AND locktype='advisory' AND classid=530090 AND objid=2 AND objsubid=2 AND mode='ShareLock' AND granted",
              [[aPid, incomingPid]]
            )
          ).rows[0].n === 2;
        if (sharedGroup) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert(sharedGroup, 'terminal admission stays shared before maintenance reserves its turn');
      const writing = freeze();
      const until = performance.now() + 3000;
      let queued = false;
      while (performance.now() < until) {
        queued = (
          await observer.query(
            "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND classid=530090 AND objid=2 AND objsubid=2 AND mode='ExclusiveLock' AND NOT granted) AS waiting",
            [bPid]
          )
        ).rows[0].waiting;
        if (queued) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert(queued, 'actual original maintenance writer must queue on existing reservation 2');
      await observer.query('BEGIN');
      assert(
        (await observer.query('SELECT pg_try_advisory_xact_lock_shared(530090,1) AS hand')).rows[0]
          .hand,
        'ordinary hand continuation remains admitted while maintenance reserves lane 2'
      );
      await observer.query('COMMIT');
      await actor(observer);
      const busy = await execute(observer).then(
        () => null,
        (e) => e
      );
      assert.equal(busy?.code, '55P03');
      assert.match(busy.message, /TERMINAL_MAINTENANCE_RESERVATION_BUSY/);
      await observer.query('ROLLBACK');
      await a.query('COMMIT');
      assert.deepEqual(await alreadyAdmitted, paid);
      assert(
        (
          await observer.query('SELECT $1::int=ANY(pg_blocking_pids($2::int)) AS waiting', [
            incomingPid,
            bPid,
          ])
        ).rows[0].waiting,
        'maintenance still drains the second original admitted terminal'
      );
      await incoming.query('COMMIT');
      await writing;
      assert((await observer.query('SELECT public.fn_platform_frozen() AS frozen')).rows[0].frozen);
      await actor(incoming);
      assert.equal(
        (
          await execute(incoming).then(
            () => null,
            (e) => e
          )
        )?.code,
        '55006'
      );
      await incoming.query('ROLLBACK');
    }
    await b.query(
      "SELECT public.fn_clear_engine_maintenance_break('counting_down',$1,$2,$3,'native',$4)",
      [times.announced, times.started, times.ended, token]
    );
    await actor(incoming);
    assert.deepEqual(await execute(incoming), paid);
    await incoming.query('COMMIT');
    assert.equal(
      (
        await observer.query(
          'SELECT count(*)::int AS n FROM public.tournament_payouts WHERE tournament_id=$1',
          [event]
        )
      ).rows[0].n,
      1
    );
    if (scenario === 'reservation-after') {
      const early = (
        await observer.query("SELECT clock_timestamp()-interval '20 seconds' AS announced")
      ).rows[0].announced;
      await b.query(
        "SELECT public.fn_save_engine_maintenance_break('last_hand',$1,NULL,NULL,'native','native',$2)",
        [early, token]
      );
      assert(
        !(await observer.query('SELECT public.fn_platform_frozen() AS frozen')).rows[0].frozen
      );
      await actor(incoming);
      assert.deepEqual(
        await execute(incoming),
        paid,
        'early last-hand terminal replay remains allowed'
      );
      await incoming.query('COMMIT');
      const late = (
        await observer.query("SELECT clock_timestamp()-interval '95 seconds' AS announced")
      ).rows[0].announced;
      await b.query(
        "SELECT public.fn_save_engine_maintenance_break('last_hand',$1,NULL,NULL,'native','native',$2)",
        [late, token]
      );
      assert(
        !(await observer.query('SELECT public.fn_platform_frozen() AS frozen')).rows[0].frozen,
        '95 seconds is before the original 120-second full freeze'
      );
      const beforeLate = await snapshot();
      const correct = (
        await observer.query(
          "SELECT pg_get_functiondef('public.fn_execute_tournament_terminal_request(uuid,uuid)'::regprocedure) AS definition"
        )
      ).rows[0].definition;
      // Exact prior candidate counterfactual, confined to this isolated catalog.
      const cutoffStart = correct.indexOf('  -- The announced last-hand terminal window');
      const cutoffEnd = correct.indexOf(
        '  PERFORM pg_catalog.pg_advisory_xact_lock_shared(530090,1);',
        cutoffStart
      );
      assert(cutoffStart > 0 && cutoffEnd > cutoffStart);
      await observer.query(correct.slice(0, cutoffStart) + correct.slice(cutoffEnd));
      assert.equal(
        (
          await observer.query(
            "SELECT md5(pg_get_functiondef('public.fn_execute_tournament_terminal_request(uuid,uuid)'::regprocedure)) AS digest"
          )
        ).rows[0].digest,
        'fc2dd75d5e2c2c7bb9ebbda2dc9d7794'
      );
      await actor(incoming);
      assert.deepEqual(
        await execute(incoming),
        paid,
        'prior candidate wrongly admits a direct late last-hand replay'
      );
      await incoming.query('COMMIT');
      await observer.query(correct);
      await actor(incoming);
      const lateRefusal = await execute(incoming).then(
        () => null,
        (e) => e
      );
      assert.equal(lateRefusal?.code, '55006');
      assert.match(lateRefusal.message, /terminal settlement reserve has started/);
      await incoming.query('ROLLBACK');
      assert.deepEqual(
        await snapshot(),
        beforeLate,
        'late direct RPC refusal preserves every financial receipt and balance'
      );
      await observer.query('BEGIN');
      assert(
        (await observer.query('SELECT pg_try_advisory_xact_lock_shared(530090,1) AS hand')).rows[0]
          .hand,
        'hand continuation remains admitted during the terminal reserve'
      );
      await observer.query('COMMIT');
      await b.query(
        "SELECT public.fn_clear_engine_maintenance_break('last_hand',$1,NULL,NULL,'native',$2)",
        [late, token]
      );
      await actor(incoming);
      assert.deepEqual(await execute(incoming), paid);
      await incoming.query('COMMIT');
    }
  } else if (scenario.startsWith('maintenance-')) {
    const aPid = (await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const token = '92090000-0000-4000-8000-000000000099';
    const times = (
      await observer.query(
        "SELECT clock_timestamp()-interval '2 minutes' AS announced,clock_timestamp() AS started,clock_timestamp()+interval '5 minutes' AS ended"
      )
    ).rows[0];
    async function freeze() {
      return b.query(
        "SELECT public.fn_save_engine_maintenance_break('counting_down',$1,$2,$3,'native','native',$4)",
        [times.announced, times.started, times.ended, token]
      );
    }
    if (scenario === 'maintenance-before') {
      await freeze();
      await actor(a);
      const unsafe = await execute(a);
      assert.equal(unsafe.request.phase, 'committed');
      assert(
        (
          await observer.query(
            "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND relation='public.tournaments'::regclass AND granted AND mode='RowExclusiveLock') AS held",
            [aPid]
          )
        ).rows[0].held
      );
      await a.query('ROLLBACK');
    } else {
      await actor(a);
      const paid = await execute(a);
      assert.equal(paid.request.phase, 'committed');
      assert(
        (
          await observer.query(
            "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND classid=530090 AND objid=1 AND objsubid=2 AND mode='ShareLock' AND granted) AS held",
            [aPid]
          )
        ).rows[0].held
      );
      const busy = await freeze().then(
        () => null,
        (e) => e
      );
      assert.equal(busy?.code, '55P03');
      assert(
        !(await observer.query('SELECT public.fn_platform_frozen() AS frozen')).rows[0].frozen
      );
      await a.query('COMMIT');
      await freeze();
      const frozenSnapshot = await snapshot();
      await observer.query('BEGIN;LOCK TABLE public.tournaments IN ACCESS EXCLUSIVE MODE');
      await actor(a);
      const frozen = await execute(a).then(
        () => null,
        (e) => e
      );
      assert.equal(
        frozen?.code,
        '55006',
        'must refuse before needing the held tournament relation'
      );
      await a.query('ROLLBACK');
      await observer.query('ROLLBACK');
      assert.deepEqual(await snapshot(), frozenSnapshot);
      await b.query(
        "SELECT public.fn_clear_engine_maintenance_break('counting_down',$1,$2,$3,'native',$4)",
        [times.announced, times.started, times.ended, token]
      );
      assert(
        !(await observer.query('SELECT public.fn_platform_frozen() AS frozen')).rows[0].frozen
      );
      await actor(a);
      assert.deepEqual(await execute(a), paid);
      await a.query('COMMIT');
      assert.equal(
        (
          await observer.query(
            'SELECT count(*)::int AS n FROM tournament_payouts WHERE tournament_id=$1',
            [event]
          )
        ).rows[0].n,
        1
      );
    }
  } else if (scenario === 'commit-replay') {
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
  for (const c of [a, b, observer, incoming]) {
    await c.query('ROLLBACK').catch(() => {});
    await c.end().catch(() => {});
  }
}
