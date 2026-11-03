/** Called only by the current satellite native Execution owner, never production. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import pg from 'pg';

const [host, port, database, scenario, output] = process.argv.slice(2);
assert(host?.startsWith('/'));
assert(/^r46_mtt_isolation_[0-9a-f]{32}$/.test(database));
assert(
  ['committed-response-lost', 'inflight-commit', 'inflight-rollback', 'unresolved'].includes(
    scenario
  )
);
const source = 'd3000000-0000-4000-8000-000000000001';
const winner = 'd1000000-0000-4000-8000-000000000002';
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
const tables = [
  'tournaments',
  'tournament_players',
  'tables',
  'table_seats',
  'club_members',
  'wallet_transactions',
  'wallet_credit_idempotency',
  'chip_ledger',
  'chip_ledger_idem',
  'tournament_escrow',
  'tournament_obligations',
  'tournament_payouts',
  'tournament_refund_entitlements',
  'tournament_tickets',
  'tournament_satellite_settlements',
  'tournament_satellite_awards',
  'tournament_satellite_remainders',
  'tournament_finish_receipts',
  'tournament_terminal_settlements',
  'tournament_rake_settlements',
  'rake_records',
  'rake_attributions',
  'agent_commissions',
  'player_stats',
  'vip_points_carry',
  'tournament_seat_exit_authorizations',
  'club_wallets',
  'union_wallets',
];
async function snapshot(client: pg.Client) {
  const result: Record<string, unknown> = {};
  for (const table of tables) {
    result[table] = (
      await client.query(
        `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM public.${table} t`
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
    ['fn_settle_satellite_tournament', 'fn_resolve_satellite_settlement_outcome'].includes(name)
  );
  return (await client.query(`SELECT public.${name}($1::uuid,$2::uuid) AS value`, [source, winner]))
    .rows[0].value;
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
      ['fn_settle_satellite_tournament', 'fn_resolve_satellite_settlement_outcome'].includes(name)
    );
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), {
      p_tournament_id: source,
      p_observed_winner_id: winner,
    });
    assert.equal(req.headers['x-smarter-data-actor'], 'service');
    calls.push(name);
    if (name === 'fn_settle_satellite_tournament') {
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
  const before = await snapshot(observer);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  // Explicit harmless local configuration before importing the real runtime client.
  process.env.SUPABASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'native-transport-no-production-credential';
  const {
    requestSatelliteSettlementReceipt,
    SatelliteSettlementRefusedError,
    SatelliteSettlementOutcomeUnknownError,
  } = await import('../src/tournament/satelliteSettlementRpc.js');
  const { channelHub } = await import('../src/hub/ChannelHub.js');
  closeRuntime = () => channelHub.close();
  requestStartedAt = performance.now();
  let result: unknown;
  let failure: unknown;
  try {
    result = await requestSatelliteSettlementReceipt(source, winner, { attempts: 1 });
  } catch (error) {
    failure = error;
  }
  const answeredAt = performance.now();
  if (handlerFailure) throw handlerFailure;
  assert.deepEqual(calls, [
    'fn_settle_satellite_tournament',
    'fn_resolve_satellite_settlement_outcome',
  ]);
  if (scenario === 'unresolved') {
    assert(failure instanceof SatelliteSettlementOutcomeUnknownError);
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
    assert(failure instanceof SatelliteSettlementRefusedError);
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
    assert.equal((result as any).winnerAmount, 100);
    assert.equal((result as any).awards.length, 1);
    assert.equal((result as any).awards[0].payoutId, (originalReceipt as any).awards[0].payout_id);
    assert.deepEqual(resolverOutcome.receipt, originalReceipt);
    assert.equal(resolverOutcome.definitively_not_committed, false);
    if (scenario === 'inflight-commit') assert(waiterProven);
    const settled = await snapshot(observer);
    assert.notDeepEqual(settled, before);
    assert.equal(
      (
        await observer.query(
          "SELECT count(*)::int AS n FROM public.tournament_payouts WHERE tournament_id=$1 AND user_id=$2 AND amount=100 AND source='satellite_seat'",
          [source, winner]
        )
      ).rows[0].n,
      1
    );
    assert.equal(
      (
        await observer.query(
          "SELECT count(*)::int AS n FROM public.tournament_refund_entitlements WHERE source_satellite_id=$1 AND user_id=$2 AND entitlement_kind='satellite_seat' AND gross=100 AND refund_prize=90 AND refund_fee=10",
          [source, winner]
        )
      ).rows[0].n,
      1
    );
    await begin(writer, 'fn_settle_satellite_tournament', {
      'x-smarter-data-actor': 'service',
      'x-smarter-data-protocol': '1',
    });
    assert.deepEqual(await rpc(writer, 'fn_settle_satellite_tournament'), originalReceipt);
    await writer.query('COMMIT');
    assert.deepEqual(
      await snapshot(observer),
      settled,
      'exact replay cannot duplicate money, award, ticket or seat effects'
    );
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        passed: true,
        scenario,
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
