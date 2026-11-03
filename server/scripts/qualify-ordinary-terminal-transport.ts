/** Called only by the ordinary tournament native Execution owner, never production. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import pg from 'pg';

const [host, port, database, scenario, output, source, winner, expectedAmountText, format] =
  process.argv.slice(2);
assert(host?.startsWith('/'));
assert(/^r46_mtt_isolation_[0-9a-f]{32}$/.test(database));
assert(
  ['committed-response-lost', 'inflight-commit', 'inflight-rollback', 'unresolved'].includes(
    scenario
  )
);
const expectedAmount = Number(expectedAmountText);
assert(Number.isFinite(expectedAmount) && expectedAmount > 0);
const config = {
  host,
  port: Number(port),
  database,
  user: 'postgres',
  connectionTimeoutMillis: 5000,
};
const writer = new pg.Client(config);
const resolver = new pg.Client(config);
const observer = new pg.Client(config);
const clients = [writer, resolver, observer];
const calls: string[] = [];
let originalReceipt: unknown;
let resolverOutcome: any;
let handlerFailure: unknown;
let waiterProven = false;
let writerPid: number;
let resolverPid: number;
let releaseAt = 0;
let requestStartedAt = 0;
let closeRuntime = () => {};
let tables: string[] = [];
async function snapshot(client: pg.Client) {
  const result: Record<string, unknown> = {};
  for (const table of tables) {
    result[table] = (
      await client.query(
        `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM ${table} t`
      )
    ).rows[0].rows;
  }
  return result;
}
async function begin(client: pg.Client, name: string, headers: Record<string, unknown>) {
  await client.query('BEGIN');
  await client.query(
    "SET LOCAL statement_timeout='12s'; SET LOCAL lock_timeout='8s'; SET LOCAL ROLE service_role"
  );
  await client.query(
    "SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true), set_config('request.jwt.claim.role','service_role',true), set_config('request.jwt.claim.sub','',true), set_config('request.method','POST',true), set_config('request.path',$1,true), set_config('request.headers',$2,true)",
    ['rpc/' + name, JSON.stringify(headers)]
  );
}
async function rpc(client: pg.Client, name: string) {
  assert(
    ['fn_complete_tournament_terminal', 'fn_resolve_tournament_terminal_outcome'].includes(name)
  );
  return (
    await client.query(`SELECT public.${name}($1::uuid,$2::uuid,'places') AS value`, [
      source,
      winner,
    ])
  ).rows[0].value;
}
async function releaseWhenBlocked() {
  // Test-only bounded observation: release by proven lock dependency, never by sleep alone.
  const deadline = performance.now() + 4000;
  while (performance.now() < deadline) {
    const { rows } = await observer.query(
      'SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked',
      [writerPid, resolverPid]
    );
    if (rows[0].blocked) {
      waiterProven = true;
      await writer.query(scenario === 'inflight-rollback' ? 'ROLLBACK' : 'COMMIT');
      releaseAt = performance.now();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('resolver never waited on original terminal transaction');
}
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.method, 'POST');
    const name = req.url?.replace('/rest/v1/rpc/', '') ?? '';
    assert(
      ['fn_complete_tournament_terminal', 'fn_resolve_tournament_terminal_outcome'].includes(name)
    );
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), {
      p_tournament_id: source,
      p_observed_winner_id: winner,
      p_settlement_mode: 'places',
    });
    assert.equal(req.headers['x-smarter-data-actor'], 'service');
    calls.push(name);
    if (name === 'fn_complete_tournament_terminal') {
      assert.equal(calls.length, 1);
      await begin(writer, name, req.headers);
      originalReceipt = await rpc(writer, name);
      assert.equal((originalReceipt as any).fully_settled, true);
      if (scenario === 'committed-response-lost') {
        await writer.query('COMMIT');
        releaseAt = performance.now();
      }
      // The real client sees a dropped TCP response, never a manufactured RPC error.
      res.destroy();
      return;
    }
    assert.equal(calls.length, 2);
    if (scenario === 'unresolved') {
      res.destroy(); // Original DB transaction is deliberately still unresolved.
      return;
    }
    await begin(resolver, name, req.headers);
    const query = rpc(resolver, name).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    );
    if (scenario.startsWith('inflight-')) await releaseWhenBlocked();
    const reply = await query;
    if (!reply.ok) throw reply.error;
    resolverOutcome = reply.value;
    await resolver.query('COMMIT');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(resolverOutcome));
  } catch (error) {
    handlerFailure = error;
    res.destroy();
  }
});
try {
  await Promise.all(clients.map((client) => client.connect()));
  for (const client of clients) {
    const { rows } = await client.query(
      "SELECT current_database() AS db,current_user AS usr,inet_server_addr() IS NULL AS local,current_setting('server_version_num')::int AS version,pg_backend_pid() AS pid"
    );
    assert.equal(rows[0].db, database);
    assert.equal(rows[0].usr, 'postgres');
    assert.equal(rows[0].local, true);
    assert(rows[0].version >= 170000 && rows[0].version < 180000);
    if (client === writer) writerPid = rows[0].pid;
    if (client === resolver) resolverPid = rows[0].pid;
  }
  assert(['MTT', 'SNG', 'SPIN'].includes(format));
  const actual = (
    await observer.query('SELECT tournament_type, prize_pool FROM public.tournaments WHERE id=$1', [
      source,
    ])
  ).rows[0];
  assert.equal(actual.tournament_type, format);
  tables = (
    await observer.query(
      "SELECT n.nspname||'.'||c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','smarter_private') AND c.relkind IN ('r','p') ORDER BY 1"
    )
  ).rows.map((row) => row.name);
  assert(tables.length > 28);
  assert(tables.every((name) => /^(public|smarter_private)\.[a-z_][a-z_0-9]*$/.test(name)));
  let expectedPayouts: Array<{ userId: string; place: number; amount: number }> = [
    { userId: winner, place: 1, amount: expectedAmount },
  ];
  if (format === 'SPIN') {
    const draw = (
      await observer.query('SELECT receipt FROM public.spin_draw_receipts WHERE tournament_id=$1', [
        source,
      ])
    ).rows[0].receipt;
    const roster = (
      await observer.query(
        'SELECT user_id,position FROM public.tournament_players WHERE tournament_id=$1',
        [source]
      )
    ).rows;
    expectedPayouts = draw.payout_structure.map((row: { place: number; percentage: number }) => ({
      userId:
        row.place === 1 ? winner : roster.find((player) => player.position === row.place).user_id,
      place: row.place,
      amount: Math.round(Number(draw.prize_pool) * Number(row.percentage)) / 100,
    }));
    assert.equal(
      expectedPayouts.reduce((sum, row) => sum + row.amount, 0),
      Number(draw.prize_pool)
    );
  }
  assert.equal(expectedPayouts[0].amount, expectedAmount);
  const before = await snapshot(observer);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  // Explicit harmless local configuration before importing the real runtime client.
  process.env.SUPABASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'native-transport-no-production-credential';
  const {
    requestTournamentTerminalReceipt,
    TerminalSettlementRefusedError,
    TerminalSettlementOutcomeUnknownError,
  } = await import('../src/tournament/terminalSettlementRpc.js');
  const { channelHub } = await import('../src/hub/ChannelHub.js');
  closeRuntime = () => channelHub.close();
  requestStartedAt = performance.now();
  let result: unknown;
  let failure: unknown;
  try {
    result = await requestTournamentTerminalReceipt(source, 'places', winner, { attempts: 1 });
  } catch (error) {
    failure = error;
  }
  const answeredAt = performance.now();
  if (handlerFailure) throw handlerFailure;
  assert.deepEqual(calls, [
    'fn_complete_tournament_terminal',
    'fn_resolve_tournament_terminal_outcome',
  ]);
  if (scenario === 'unresolved') {
    assert(failure instanceof TerminalSettlementOutcomeUnknownError);
    assert.equal(result, undefined);
    assert.deepEqual(
      await snapshot(observer),
      before,
      'MVCC miss remains unknown, never a rollback verdict'
    );
    await writer.query('ROLLBACK');
    assert.deepEqual(await snapshot(observer), before);
  } else if (scenario === 'inflight-rollback') {
    assert(waiterProven);
    assert(failure instanceof TerminalSettlementRefusedError);
    assert.equal(resolverOutcome.definitively_not_committed, true);
    assert.deepEqual(
      await snapshot(observer),
      before,
      'authoritative rollback leaves no financial effects'
    );
  } else {
    assert.equal(failure, undefined);
    assert.equal((result as any).tournamentId, source);
    assert.equal((result as any).winnerId, winner);
    assert.equal((result as any).winnerAmount, expectedAmount);
    assert.deepEqual((result as any).payouts, expectedPayouts);
    const paid = (
      await observer.query(
        'SELECT user_id AS "userId",position AS place,amount::float8 AS amount FROM public.tournament_payouts WHERE tournament_id=$1 ORDER BY position',
        [source]
      )
    ).rows;
    assert.deepEqual(paid, expectedPayouts);
    assert.deepEqual(resolverOutcome.receipt, originalReceipt);
    assert.equal(resolverOutcome.definitively_not_committed, false);
    if (scenario === 'inflight-commit') assert(waiterProven);
    const settled = await snapshot(observer);
    assert.notDeepEqual(settled, before);
    assert.equal(
      (
        await observer.query(
          'SELECT count(*)::int AS n FROM public.tournament_payouts WHERE tournament_id=$1 AND user_id=$2 AND amount=$3',
          [source, winner, expectedAmount]
        )
      ).rows[0].n,
      1
    );
    await begin(writer, 'fn_complete_tournament_terminal', {
      'x-smarter-data-actor': 'service',
      'x-smarter-data-protocol': '1',
    });
    assert.deepEqual(await rpc(writer, 'fn_complete_tournament_terminal'), originalReceipt);
    await writer.query('COMMIT');
    assert.deepEqual(
      await snapshot(observer),
      settled,
      'exact replay cannot duplicate money or seat effects'
    );
  }
  if (releaseAt)
    assert(
      answeredAt - releaseAt < 2000,
      'qualified original transaction result must reach caller within two seconds of release'
    );
  await writeFile(
    output,
    JSON.stringify(
      {
        passed: true,
        scenario,
        format,
        expectedPayouts,
        calls,
        waiterProven,
        elapsedMs: answeredAt - requestStartedAt,
        afterReleaseMs: releaseAt ? answeredAt - releaseAt : null,
        realRuntimeClient: true,
        financialRelationsCompared: tables.length,
        outcome:
          scenario === 'unresolved'
            ? 'unknown'
            : scenario === 'inflight-rollback'
              ? 'refused'
              : 'committed',
      },
      null,
      2
    ) + '\n'
  );
} finally {
  closeRuntime();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await Promise.allSettled(
    clients.map(async (client) => {
      try {
        await client.query('ROLLBACK');
      } finally {
        await client.end();
      }
    })
  );
}
