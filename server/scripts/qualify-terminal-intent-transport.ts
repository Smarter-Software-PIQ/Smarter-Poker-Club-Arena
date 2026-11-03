/** Real manager client -> local HTTP loss -> original PG terminal request. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';
const [host, port, database, output, event, winner, format] = process.argv.slice(2);
assert(host.startsWith('/') && /^r46_mtt_isolation_[0-9a-f]{32}$/.test(database));
let generation = '92090000-0000-4000-8000-000000000002';
const db = new pg.Client({ host, port: Number(port), database, user: 'postgres' });
const calls: string[] = [];
let original: any;
let execution: any;
let failure: unknown;
let loseExecution = true;
let closeRuntime = () => {};
async function snapshot() {
  const names = (
    await db.query(
      "SELECT n.nspname||'.'||c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','smarter_private') AND c.relkind IN ('r','p') ORDER BY 1"
    )
  ).rows;
  const rows: Record<string, unknown> = {};
  for (const { name } of names) {
    assert(/^(public|smarter_private)\.[a-z_0-9]+$/.test(name));
    rows[name] = (
      await db.query(
        `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM ${name} t`
      )
    ).rows[0].rows;
  }
  return rows;
}
const server = createServer(async (req, res) => {
  try {
    const name = req.url?.replace('/rest/v1/rpc/', '') ?? '';
    assert.equal(req.method, 'POST');
    assert(
      [
        'fn_prepare_tournament_terminal_request',
        'fn_execute_tournament_terminal_request',
        'fn_resolve_tournament_terminal_request',
      ].includes(name)
    );
    assert.equal(req.headers['x-smarter-data-actor'], 'tournament-manager');
    assert.equal(req.headers['x-smarter-tournament-id'], event);
    assert.equal(req.headers['x-smarter-tournament-lease-generation'], generation);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const args = JSON.parse(Buffer.concat(chunks).toString());
    calls.push(name);
    await db.query('BEGIN');
    await db.query("SET LOCAL statement_timeout='12s'; SET LOCAL lock_timeout='8s'");
    await db.query(
      "SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true),set_config('request.jwt.claim.role','service_role',true),set_config('request.headers',$1,true),set_config('app.smarter_data_actor','tournament-manager',true),set_config('app.smarter_tournament_id',$2,true),set_config('app.smarter_tournament_lease_generation',$3,true)",
      [JSON.stringify(req.headers), event, generation]
    );
    await db.query('SET LOCAL ROLE service_role');
    let result: any;
    if (name === 'fn_prepare_tournament_terminal_request') {
      assert.deepEqual(Object.keys(args).sort(), ['p_generation', 'p_request', 'p_request_id']);
      assert.equal(args.p_generation, generation);
      result = (
        await db.query('SELECT public.fn_prepare_tournament_terminal_request($1,$2,$3) AS value', [
          args.p_request_id,
          args.p_request,
          args.p_generation,
        ])
      ).rows[0].value;
      original = result.request;
      assert.equal(original.phase, 'prepared');
    } else if (name === 'fn_execute_tournament_terminal_request') {
      assert.deepEqual(args, { p_request_id: original.request_id, p_generation: generation });
      result = (
        await db.query('SELECT public.fn_execute_tournament_terminal_request($1,$2) AS value', [
          args.p_request_id,
          args.p_generation,
        ])
      ).rows[0].value;
      assert.equal(result.request.phase, 'committed');
      if (!execution) execution = result;
      else assert.deepEqual(result, execution);
    } else {
      assert.deepEqual(args, { p_request_id: original.request_id });
      result = (
        await db.query('SELECT public.fn_resolve_tournament_terminal_request($1) AS value', [
          args.p_request_id,
        ])
      ).rows[0].value;
      assert.deepEqual(result.outcome.receipt, execution.receipt);
    }
    await db.query('COMMIT');
    if (name === 'fn_execute_tournament_terminal_request' && loseExecution) {
      loseExecution = false;
      res.destroy();
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
  } catch (error) {
    failure = error;
    await db.query('ROLLBACK');
    res.destroy();
  }
});
try {
  await db.connect();
  const local = (
    await db.query(
      "SELECT inet_server_addr() IS NULL AS local,current_setting('server_version_num')::int AS version"
    )
  ).rows[0];
  assert(local.local && local.version >= 170000 && local.version < 180000);
  const lease = (
    await db.query(
      'SELECT instance_id,lease_generation FROM public.engine_tournament_leases WHERE tournament_id=$1',
      [event]
    )
  ).rows[0];
  if (lease) generation = lease.lease_generation;
  assert(
    (
      await db.query('SELECT * FROM public.claim_tournament_lease_v2($1,$2,$3,$4,30)', [
        event,
        lease?.instance_id ?? 'transport',
        'native',
        generation,
      ])
    ).rows[0].granted
  );
  const before = await snapshot();
  const roster = (
    await db.query(
      'SELECT user_id,position FROM public.tournament_players WHERE tournament_id=$1',
      [event]
    )
  ).rows;
  const qualifiers =
    format === 'QUALIFIERS'
      ? (
          await db.query(
            "SELECT user_id FROM public.tournament_players WHERE tournament_id=$1 AND status='playing' ORDER BY user_id",
            [event]
          )
        ).rows.map((r) => r.user_id)
      : [];
  const payoutOracle =
    format === 'SPIN'
      ? (
          await db.query('SELECT receipt FROM public.spin_draw_receipts WHERE tournament_id=$1', [
            event,
          ])
        ).rows[0].receipt
      : null;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  process.env.SUPABASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'native-durable-no-production-credential';
  const { runWithTournamentDataAuthority } =
    await import('../src/services/supabase/dataActorContext.js');
  const { requestTournamentTerminalReceipt } =
    await import('../src/tournament/terminalSettlementRpc.js');
  const { requestSatelliteSettlementReceipt } =
    await import('../src/tournament/satelliteSettlementRpc.js');
  const { requestSatelliteQualifierReceipt } =
    await import('../src/tournament/satelliteQualifierRpc.js');
  const { parseDurableTerminalRequest, executeDurableTerminalRequest } =
    await import('../src/tournament/terminalDurableRequest.js');
  const { channelHub } = await import('../src/hub/ChannelHub.js');
  closeRuntime = () => channelHub.close();
  const authority = { tournamentId: event, leaseGeneration: generation };
  const result: any = await runWithTournamentDataAuthority(authority, () =>
    format === 'SATELLITE'
      ? requestSatelliteSettlementReceipt(event, winner, { attempts: 1 })
      : format === 'QUALIFIERS'
        ? requestSatelliteQualifierReceipt(event, qualifiers, { resolverAttempts: 1 })
        : requestTournamentTerminalReceipt(event, 'places', winner, { attempts: 1 })
  );
  if (failure) throw failure;
  assert.deepEqual(calls, [
    'fn_prepare_tournament_terminal_request',
    'fn_execute_tournament_terminal_request',
    'fn_resolve_tournament_terminal_request',
  ]);
  assert.equal(result.tournamentId, event);
  const payouts = (
    await db.query(
      'SELECT user_id,amount::float8 AS amount,source FROM public.tournament_payouts WHERE tournament_id=$1 ORDER BY user_id',
      [event]
    )
  ).rows;
  if (format === 'SATELLITE') {
    assert.equal(result.winnerAmount, 100);
    assert.deepEqual(payouts, [{ user_id: winner, amount: 100, source: 'satellite_seat' }]);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM public.tournament_refund_entitlements WHERE source_satellite_id=$1 AND user_id=$2 AND entitlement_kind='satellite_seat' AND gross=100 AND refund_prize=90 AND refund_fee=10",
          [event, winner]
        )
      ).rows[0].n,
      1
    );
  } else if (format === 'QUALIFIERS') {
    assert.deepEqual(
      payouts.map((r) => r.amount).sort((a, b) => a - b),
      [5, 50, 50]
    );
    assert.equal(payouts.filter((r) => r.source === 'satellite_seat').length, 2);
    assert.deepEqual(result.qualifierIds, qualifiers);
    assert.deepEqual(
      payouts
        .filter((r) => r.source === 'satellite_seat')
        .map((r) => r.user_id)
        .sort(),
      qualifiers
    );
    const bubble = roster.find((r) => r.position === 3).user_id;
    assert.equal(payouts.find((r) => r.amount === 5)?.user_id, bubble);
    const entitlements = (
      await db.query(
        "SELECT user_id,gross::float8 AS gross,refund_prize::float8 AS prize,refund_fee::float8 AS fee FROM public.tournament_refund_entitlements WHERE source_satellite_id=$1 AND entitlement_kind='satellite_seat' ORDER BY user_id",
        [event]
      )
    ).rows;
    assert.deepEqual(
      entitlements,
      qualifiers.map((user_id: string) => ({ user_id, gross: 50, prize: 45, fee: 5 }))
    );
    const target = (
      await db.query('SELECT satellite_target_id FROM public.tournaments WHERE id=$1', [event])
    ).rows[0].satellite_target_id;
    assert.deepEqual(
      (
        await db.query(
          'SELECT prize_balance::float8 AS prize,fee_balance::float8 AS fee FROM public.tournament_escrow WHERE tournament_id=$1',
          [target]
        )
      ).rows,
      [{ prize: 90, fee: 10 }]
    );
  } else {
    const expected =
      format === 'MTT' ? 300 : format === 'SNG' ? 2 : Number(payoutOracle.prize_pool);
    assert.equal(
      payouts.reduce((n, r) => n + r.amount, 0),
      expected
    );
    const expectedWinner = payoutOracle
      ? Math.round(
          Number(payoutOracle.prize_pool) * Number(payoutOracle.payout_structure[0].percentage)
        ) / 100
      : expected;
    assert.equal(result.winnerAmount, expectedWinner);
    const expectedPayouts = payoutOracle
      ? payoutOracle.payout_structure.map((r: { place: number; percentage: number }) => ({
          user_id: r.place === 1 ? winner : roster.find((p) => p.position === r.place).user_id,
          position: r.place,
          amount: Math.round(Number(payoutOracle.prize_pool) * Number(r.percentage)) / 100,
        }))
      : [{ user_id: winner, position: 1, amount: expected }];
    assert.deepEqual(
      (
        await db.query(
          'SELECT user_id,position,amount::float8 AS amount FROM public.tournament_payouts WHERE tournament_id=$1 ORDER BY position',
          [event]
        )
      ).rows,
      expectedPayouts
    );
  }
  const settled = await snapshot();
  assert.notDeepEqual(settled, before);
  const request = parseDurableTerminalRequest(original, event);
  assert(request);
  const replay = await runWithTournamentDataAuthority(authority, () =>
    executeDurableTerminalRequest(request)
  );
  if (failure) throw failure;
  assert.equal(replay.error, null);
  assert.deepEqual(replay.data, execution.receipt);
  assert.deepEqual(
    await snapshot(),
    settled,
    'durable replay must preserve every financial/ticket/seat row'
  );
  await writeFile(
    output,
    JSON.stringify(
      {
        passed: true,
        format,
        calls,
        relationCount: Object.keys(settled).length,
        realManagerHeaders: true,
        originalRequest: original.original_request,
        lostCommittedTcpResponse: true,
        exactReplay: true,
        limits: [
          'Local HTTP shim models validated actor GUCs; it is not hosted PostgREST.',
          'Synthetic final roster; no runtime manager restart or live hand continuity claim.',
        ],
      },
      null,
      2
    ) + '\n'
  );
} finally {
  closeRuntime();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.query('ROLLBACK').catch(() => {});
  await db.end();
}
