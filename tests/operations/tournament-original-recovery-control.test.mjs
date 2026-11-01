import test from 'node:test';
import assert from 'node:assert/strict';
import { controlOriginalRecovery } from '../../.github/scripts/tournament-original-recovery-control.mjs';
const input = {
  action: 'prepare',
  tournamentId: '095d7449-3282-46c5-8a39-768fe14dce5a',
  nonce: '13000000-0000-4000-8000-000000000001',
  generation: 'ab000000-0000-4000-8000-000000000001',
  instance: '1-1234abcd',
  sha: '1234567890123456789012345678901234567890',
};
const health = {
  releaseSha: input.sha,
  version: input.sha.slice(0, 8),
  instanceId: input.instance,
  running: true,
  status: 'ok',
  maintenance: { active: false, phase: 'idle' },
};
const runtime = {
  state: 'prepared',
  operation_id: 'd44c4440-2911-430c-8ee7-376611ef3f38',
  tournament_id: input.tournamentId,
  nonce: input.nonce,
  current_generation: input.generation,
  instance_id: input.instance,
  release_sha: input.sha,
  abort_fenced: true,
  custody_certified: false,
  disposition_committed: false,
};
function fixture(change = {}) {
  const calls = [];
  let reads = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'POST') {
      if (change.timeout) throw Error('unknown');
      return {
        ok: true,
        json: async () => ({ success: true, runtime: { ...runtime, ...change.runtime } }),
      };
    }
    return {
      ok: true,
      json: async () => ({ ...health, ...(++reads === 2 ? change.after : change.before) }),
    };
  };
  return { calls, fetchImpl };
}
test('one canonical service POST retains exact receipt and both actual identity reads', async () => {
  const f = fixture();
  const r = await controlOriginalRecovery(input, { ...f, serviceIdentity: 'isolated-key' });
  assert.equal(r.outcome, 'prepared_readback');
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[1].options.headers.authorization, 'Bearer isolated-key');
  assert.equal(JSON.stringify(r).includes('isolated-key'), false);
});
test('refuses wrong cohort before network', async () => {
  const f = fixture();
  await assert.rejects(
    controlOriginalRecovery(
      { ...input, tournamentId: '68000000-0000-4000-8000-000000000001' },
      { ...f, serviceIdentity: 'isolated-key' }
    )
  );
  assert.equal(f.calls.length, 0);
});
test('HTTP200 without exact nonce is unknown, never preparation proof', async () => {
  const f = fixture({ runtime: { nonce: 'changed' } });
  const r = await controlOriginalRecovery(input, { ...f, serviceIdentity: 'isolated-key' });
  assert.equal(r.outcome, 'unknown');
  assert.equal(f.calls.filter((x) => x.options.method === 'POST').length, 1);
});
test('lost ACK never retries a control request or exposes credentials', async () => {
  const f = fixture({ timeout: true });
  const r = await controlOriginalRecovery(input, { ...f, serviceIdentity: 'isolated-key' });
  assert.equal(r.outcome, 'unknown');
  assert.equal(f.calls.filter((x) => x.options.method === 'POST').length, 1);
  assert.equal(JSON.stringify(r).includes('isolated-key'), false);
});
test('changed serving instance prevents control before actuation', async () => {
  const f = fixture({ before: { instanceId: '1-deadbeef' } });
  assert.equal(
    (await controlOriginalRecovery(input, { ...f, serviceIdentity: 'isolated-key' })).outcome,
    'unknown'
  );
  assert.equal(f.calls.length, 1);
});
test('post-control identity drift cannot certify preparation', async () => {
  const f = fixture({ after: { instanceId: '1-deadbeef' } });
  assert.equal(
    (await controlOriginalRecovery(input, { ...f, serviceIdentity: 'isolated-key' })).outcome,
    'unknown'
  );
  assert.equal(f.calls.length, 3);
});
const other = '68af0f95-82f5-4047-b424-6780a4236f4d';
const db = 'https://kuklfnapbkmacvwxktbh.supabase.co';
function abortFixture({ timeout = false, hash = '0'.repeat(32), initiallySettled = false } = {}) {
  const calls = [];
  let mutated = initiallySettled;
  const state = () => ({
    ok: true,
    operation_id: runtime.operation_id,
    tournament_id: other,
    current_generation: input.generation,
    quiescence_generation: input.generation,
    current_boundary_valid: !mutated,
    money_hash: hash,
    state: mutated ? 'settled' : 'quiesced',
    tournament_status: mutated ? 'CANCELLED' : 'RUNNING',
    receipt: mutated
      ? {
          fully_settled: true,
          receipt_version: 3,
          mode: 'started_operator_abort',
          operation_id: runtime.operation_id,
          tournament_id: other,
        }
      : null,
  });
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/health')) return { ok: true, json: async () => health };
    if (url.endsWith('/fn_ca_tournament_abort_stop_state'))
      return { ok: true, json: async () => state() };
    if (url.endsWith('/fn_ca_settle_tournament_abort')) {
      mutated = true;
      if (timeout) throw Error('lost ACK');
      return { ok: true, json: async () => ({ fully_settled: true }) };
    }
    throw Error('Unexpected route');
  };
  return { calls, fetchImpl };
}
test('other69 settlement uses only the existing canonical RPC and reviewed hash once', async () => {
  const f = abortFixture();
  const r = await controlOriginalRecovery(
    { ...input, action: 'abort_settle', tournamentId: other, moneyHash: '0'.repeat(32) },
    { ...f, serviceIdentity: 'isolated-key', supabaseUrl: db }
  );
  assert.equal(r.outcome, 'original_abort_settled_readback');
  const writes = f.calls.filter((x) => x.url.endsWith('/fn_ca_settle_tournament_abort'));
  assert.equal(writes.length, 1);
  assert.equal(JSON.parse(writes[0].options.body).p_expected_money_hash, '0'.repeat(32));
  assert.equal(JSON.stringify(r).includes('isolated-key'), false);
});
test('natural20 can never enter abort mutation modes', async () => {
  const f = abortFixture();
  await assert.rejects(
    controlOriginalRecovery(
      { ...input, action: 'abort_settle', moneyHash: '0'.repeat(32) },
      { ...f, serviceIdentity: 'isolated-key', supabaseUrl: db }
    )
  );
  assert.equal(f.calls.length, 0);
});
test('lost settlement ACK stays unknown and reads its exact durable state without repayment', async () => {
  const f = abortFixture({ timeout: true });
  const r = await controlOriginalRecovery(
    { ...input, action: 'abort_settle', tournamentId: other, moneyHash: '0'.repeat(32) },
    { ...f, serviceIdentity: 'isolated-key', supabaseUrl: db }
  );
  assert.equal(r.outcome, 'unknown');
  assert.equal(r.canonicalAfter.state, 'settled');
  assert.equal(f.calls.filter((x) => x.url.endsWith('/fn_ca_settle_tournament_abort')).length, 1);
});
test('changed review hash prevents any settlement RPC', async () => {
  const f = abortFixture({ hash: '1'.repeat(32) });
  const r = await controlOriginalRecovery(
    { ...input, action: 'abort_settle', tournamentId: other, moneyHash: '0'.repeat(32) },
    { ...f, serviceIdentity: 'isolated-key', supabaseUrl: db }
  );
  assert.equal(r.outcome, 'unknown');
  assert.equal(f.calls.filter((x) => x.url.endsWith('/fn_ca_settle_tournament_abort')).length, 0);
});

test('abort ACK touches only the existing exact native boundary and rechecks canonical receipt', async () => {
  const f = abortFixture();
  const prior = f.fetchImpl;
  f.fetchImpl = async (url, options) => {
    if (url.endsWith('/admin/tournament-abort-boundary')) {
      f.calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          success: true,
          runtime: { state: 'acknowledged', operation_id: runtime.operation_id },
        }),
      };
    }
    return prior(url, options);
  };
  const r = await controlOriginalRecovery(
    { ...input, action: 'abort_ack', tournamentId: other },
    { ...f, serviceIdentity: 'isolated-key', supabaseUrl: db }
  );
  assert.equal(r.outcome, 'original_abort_boundary_readback');
  const body = JSON.parse(
    f.calls.find((x) => x.url.endsWith('/admin/tournament-abort-boundary')).options.body
  );
  assert.deepEqual(Object.keys(body).sort(), ['operationId', 'tournamentId']);
  assert.equal(f.calls.filter((x) => x.url.includes('/fn_ca_settle_tournament_abort')).length, 0);
});
test('abort_read performs no native ACK or settlement', async () => {
  const f = abortFixture();
  const r = await controlOriginalRecovery(
    { ...input, action: 'abort_read', tournamentId: other },
    { ...f, serviceIdentity: 'isolated-key', supabaseUrl: db }
  );
  assert.equal(r.outcome, 'original_abort_readback');
  assert.equal(
    f.calls.filter(
      (x) => x.url.includes('/admin/') || x.url.endsWith('/fn_ca_settle_tournament_abort')
    ).length,
    0
  );
});
test('control workflow is manual default-branch free compute with canonical configured identity', async () => {
  const { readFileSync } = await import('node:fs');
  const workflow = readFileSync(
    new URL('../../.github/workflows/tournament-original-recovery-control.yml', import.meta.url),
    'utf8'
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(
    workflow,
    /^  (?:push|pull_request|schedule|workflow_run|repository_dispatch):/m
  );
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /github\.event\.repository\.default_branch/);
  assert.match(workflow, /secrets\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(workflow, /secrets\.SUPABASE_URL/);
  assert.doesNotMatch(
    workflow,
    /HETZNER_SSH|engine-release-transaction|stage-engine-release|repository_dispatch|\.env/
  );
});

// Synthetic private values must never reach the returned Actions artifact,
// including a partial result after a later identity/read failure.
const privateCanary = 'PRIVATE_PLAYER_ROSTER_LEDGER_SECRET_CANARY';
function privateResponses(f, { failAfter = false, badCanonicalAfter = false } = {}) {
  const prior = f.fetchImpl;
  let healthReads = 0;
  let canonicalReads = 0;
  f.fetchImpl = async (url, options) => {
    if (url.includes('/health') && ++healthReads === 2 && failAfter) throw Error(privateCanary);
    const response = await prior(url, options);
    return {
      ...response,
      json: async () => {
        const value = await response.json();
        const privateFields = {
          future_field: privateCanary,
          refunds: [{ user_id: privateCanary, ledger_id: privateCanary }],
          pre_abort_roster: [privateCanary],
          money_snapshot: { private_basis: privateCanary },
          refunded_count: { user_id: privateCanary },
          financial: {
            total_refunded: 123,
            unused_overlay_returned: 4,
            refunds: [{ user_id: privateCanary }],
            future: privateCanary,
          },
          quiescence: {
            generation: input.generation,
            money_hash: '0'.repeat(32),
            future: privateCanary,
          },
        };
        const poisoned = { ...value, ...privateFields };
        if (value.runtime) poisoned.runtime = { ...value.runtime, ...privateFields };
        if (value.receipt) poisoned.receipt = { ...value.receipt, ...privateFields };
        if (
          url.endsWith('/fn_ca_tournament_abort_stop_state') &&
          ++canonicalReads === 2 &&
          badCanonicalAfter
        )
          poisoned.current_generation = 'changed';
        return poisoned;
      },
    };
  };
  return f;
}
for (const scenario of [
  { name: 'prepare', action: 'prepare' },
  { name: 'read', action: 'read' },
  { name: 'prepare partial after identity failure', action: 'prepare', failAfter: true },
  { name: 'abort read', action: 'abort_read' },
  { name: 'abort read partial', action: 'abort_read', failAfter: true },
  { name: 'settlement already settled', action: 'abort_settle', initiallySettled: true },
  { name: 'abort settlement', action: 'abort_settle' },
  { name: 'settlement lost ACK', action: 'abort_settle', timeout: true },
  { name: 'settlement partial after identity failure', action: 'abort_settle', failAfter: true },
  { name: 'settlement partial canonical refusal', action: 'abort_settle', badCanonicalAfter: true },
  { name: 'abort ACK runtime', action: 'abort_ack' },
  { name: 'abort ACK runtime retired', action: 'abort_ack', initiallySettled: true },
  { name: 'abort ACK partial', action: 'abort_ack', failAfter: true },
  { name: 'abort ACK lost ACK', action: 'abort_ack', timeout: true },
]) {
  test(`public receipt excludes private/future fields: ${scenario.name}`, async () => {
    const abort = scenario.action.startsWith('abort_');
    const f = abort
      ? abortFixture({ timeout: scenario.timeout, initiallySettled: scenario.initiallySettled })
      : fixture();
    if (scenario.action === 'abort_ack') {
      const prior = f.fetchImpl;
      f.fetchImpl = async (url, options) => {
        if (!url.endsWith('/admin/tournament-abort-boundary')) return prior(url, options);
        f.calls.push({ url, options });
        if (scenario.timeout) throw Error(privateCanary);
        return {
          ok: true,
          json: async () => ({
            success: true,
            runtime: {
              state: 'acknowledged',
              operation_id: runtime.operation_id,
              runtime_retired: scenario.initiallySettled === true,
            },
          }),
        };
      };
    }
    privateResponses(f, scenario);
    const r = await controlOriginalRecovery(
      {
        ...input,
        action: scenario.action,
        tournamentId: abort ? other : input.tournamentId,
        moneyHash: '0'.repeat(32),
        unexpected_input: privateCanary,
      },
      { ...f, serviceIdentity: privateCanary, supabaseUrl: db }
    );
    assert.equal(JSON.stringify(r).includes(privateCanary), false);
    assert.doesNotMatch(
      JSON.stringify(r),
      /pre_abort_roster|money_snapshot|future_field|ledger_id|unexpected_input/
    );
    const actions = f.calls.filter(
      (x) => x.url.includes('/admin/') || x.url.endsWith('/fn_ca_settle_tournament_abort')
    );
    assert.equal(
      actions.length,
      scenario.action === 'abort_read' ||
        (scenario.action === 'abort_settle' && scenario.initiallySettled)
        ? 0
        : 1
    );
    if (scenario.name === 'abort ACK runtime retired')
      assert.equal(r.outcome, 'original_abort_runtime_retired');
    if (scenario.name === 'settlement already settled')
      assert.equal(r.outcome, 'original_abort_already_settled');
    if (!abort && r.outcome === 'prepared_readback') {
      const { response_digest, ...tuple } = r.runtime;
      assert.deepEqual(tuple, runtime);
      assert.match(response_digest.sha256, /^[a-f0-9]{64}$/);
    }
    if (r.settlement) assert.match(r.settlement.response_digest.sha256, /^[a-f0-9]{64}$/);
    if (r.canonicalBefore) assert.match(r.canonicalBefore.response_digest.sha256, /^[a-f0-9]{64}$/);
  });
}

test('legal BREAK state survives the public canonical projection without private basis', async () => {
  const f = privateResponses(abortFixture());
  const prior = f.fetchImpl;
  f.fetchImpl = async (url, options) => {
    const response = await prior(url, options);
    if (!url.endsWith('/fn_ca_tournament_abort_stop_state')) return response;
    return {
      ...response,
      json: async () => ({ ...(await response.json()), tournament_status: 'BREAK' }),
    };
  };
  const r = await controlOriginalRecovery(
    { ...input, action: 'abort_read', tournamentId: other },
    { ...f, serviceIdentity: privateCanary, supabaseUrl: db }
  );
  assert.equal(r.outcome, 'original_abort_readback');
  assert.equal(r.canonicalBefore.tournament_status, 'BREAK');
  assert.equal(r.canonicalAfter.tournament_status, 'BREAK');
  assert.equal(JSON.stringify(r).includes(privateCanary), false);
  assert.equal(
    f.calls.filter(
      (x) => x.url.includes('/admin/') || x.url.endsWith('/fn_ca_settle_tournament_abort')
    ).length,
    0
  );
});

const nightly = '37b4adc0-f9f4-484e-a914-3c50749055df';
const nightlyOperation = '2b925cdd-aaa7-4d16-aff9-ef1fa22496f2';
function closureFixture({
  tournamentId = nightly,
  requested = false,
  failure,
  lease = {},
  state = {},
} = {}) {
  const calls = [];
  const operation = tournamentId === nightly ? nightlyOperation : runtime.operation_id;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/health')) return { ok: true, json: async () => health };
    if (url.includes('/engine_tournament_leases?'))
      return {
        ok: true,
        json: async () => [
          {
            lease_generation: input.generation,
            protocol_version: 2,
            heartbeat_at: new Date().toISOString(),
            ...lease,
          },
        ],
      };
    if (url.endsWith('/fn_ca_tournament_abort_stop_state'))
      return requested
        ? {
            ok: true,
            json: async () => ({
              ok: true,
              state: 'stop_requested',
              operation_id: operation,
              tournament_id: tournamentId,
              current_generation: input.generation,
              pending: true,
              ...state,
            }),
          }
        : {
            ok: false,
            json: async () => ({ code: '55000', message: 'operator_abort_target_not_owned' }),
          };
    if (url.endsWith('/fn_ca_request_tournament_abort')) {
      if (failure === 'busy')
        return {
          ok: false,
          json: async () => ({ code: '55P03', message: 'CANCELLATION_GLOBAL_LANE_BUSY' }),
        };
      requested = true;
      if (failure === 'timeout') throw Error('unknown');
      return {
        ok: true,
        json: async () => ({
          ok: true,
          operation_id: operation,
          tournament_ids: [tournamentId],
          stop_requested: true,
        }),
      };
    }
    if (url.endsWith('/admin/tournament-abort-boundary')) {
      // Pending original is a real refusal, never a synthetic ACK.
      return { ok: false, json: async () => ({ success: false }) };
    }
    throw Error('Unexpected Route');
  };
  return { calls, fetchImpl };
}
for (const tournamentId of [input.tournamentId, nightly]) {
  test(`closure read and actual boundary refusal retain exact operation: ${tournamentId}`, async () => {
    for (const action of ['abort_read', 'abort_ack']) {
      const f = closureFixture({ tournamentId, requested: true });
      const r = await controlOriginalRecovery(
        { ...input, tournamentId, action },
        { ...f, serviceIdentity: 'isolated-key', supabaseUrl: db }
      );
      assert.equal(
        r.request.operationId,
        tournamentId === nightly ? nightlyOperation : runtime.operation_id
      );
      assert.equal(r.outcome, action === 'abort_read' ? 'original_abort_readback' : 'unknown');
      assert.equal(r.canonicalAfter.pending, true);
      assert.equal(
        f.calls.filter((x) => x.url.endsWith('/admin/tournament-abort-boundary')).length,
        action === 'abort_ack' ? 1 : 0
      );
      assert.equal(
        f.calls.filter((x) => /settle|recovery-prepare|request_tournament_abort/.test(x.url))
          .length,
        0
      );
    }
  });
  test(`unqualified added cohort cannot settle: ${tournamentId}`, async () => {
    const f = closureFixture({ tournamentId, requested: true });
    await assert.rejects(
      controlOriginalRecovery(
        { ...input, tournamentId, action: 'abort_settle', moneyHash: '0'.repeat(32) },
        { ...f, serviceIdentity: 'isolated-key', supabaseUrl: db }
      )
    );
    assert.equal(f.calls.length, 0);
  });
}
for (const failure of [undefined, 'busy', 'timeout']) {
  test(`Nightly request uses fixed intent once with durable readback: ${failure ?? 'success'}`, async () => {
    const f = closureFixture({ failure });
    const r = await controlOriginalRecovery(
      { ...input, tournamentId: nightly, action: 'abort_request' },
      { ...f, serviceIdentity: 'isolated-key', supabaseUrl: db }
    );
    const writes = f.calls.filter((x) => x.url.endsWith('/fn_ca_request_tournament_abort'));
    assert.equal(writes.length, 1);
    const payload = JSON.parse(writes[0].options.body);
    assert.equal(payload.p_operation_id, nightlyOperation);
    assert.deepEqual(payload.p_tournament_ids, [nightly]);
    assert.equal(
      payload.p_reason,
      'Owner requested closure of all days-old frozen unfinished tournaments. Nightly 10K last recorded hand 2026-10-31T03:30:49Z; refund original charges while preserving earned prizes and hand history. Audit owner chat 01a193b0.'
    );
    assert.equal(
      f.calls.filter((x) => x.url.endsWith('/fn_ca_tournament_abort_stop_state')).length,
      2
    );
    assert.equal(r.outcome, failure ? 'unknown' : 'original_abort_requested_readback');
    assert.equal(r.canonicalAfter.state, failure === 'busy' ? 'not_requested' : 'stop_requested');
    assert.equal(JSON.stringify(r).includes('isolated-key'), false);
  });
}
test('already requested Nightly never replays its request', async () => {
  const f = closureFixture({ requested: true });
  const r = await controlOriginalRecovery(
    { ...input, tournamentId: nightly, action: 'abort_request' },
    { ...f, serviceIdentity: 'isolated-key', supabaseUrl: db }
  );
  assert.equal(r.outcome, 'original_abort_already_requested');
  assert.equal(f.calls.filter((x) => x.url.endsWith('/fn_ca_request_tournament_abort')).length, 0);
});
test('stale or changed lease refuses Nightly admission and still reads back', async () => {
  for (const lease of [
    { lease_generation: input.nonce },
    { heartbeat_at: '2000-01-01T00:00:00Z' },
    { heartbeat_at: 'invalid' },
    { protocol_version: 1 },
  ]) {
    const f = closureFixture({ lease });
    const r = await controlOriginalRecovery(
      { ...input, tournamentId: nightly, action: 'abort_request' },
      { ...f, serviceIdentity: 'isolated-key', supabaseUrl: db }
    );
    assert.equal(r.outcome, 'unknown');
    assert.equal(
      f.calls.filter((x) => x.url.endsWith('/fn_ca_request_tournament_abort')).length,
      0
    );
    assert.equal(r.canonicalAfter.state, 'not_requested');
  }
});
test('original89 cannot be re-requested and fixed Nightly cannot use recovery withdrawal', async () => {
  for (const patch of [
    { action: 'abort_request' },
    { action: 'prepare', tournamentId: nightly },
    { action: 'read', tournamentId: nightly },
  ]) {
    const f = closureFixture();
    await assert.rejects(
      controlOriginalRecovery(
        { ...input, ...patch },
        { ...f, serviceIdentity: 'isolated-key', supabaseUrl: db }
      )
    );
    assert.equal(f.calls.length, 0);
  }
});
test('intent is uploaded before any configured service actuation', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(
    new URL('../../.github/workflows/tournament-original-recovery-control.yml', import.meta.url),
    'utf8'
  );
  assert.ok(
    source.indexOf('original20-control-intent-') < source.indexOf('One exact operator action')
  );
  assert.ok(source.indexOf('mjs intent') < source.indexOf('original20-control-intent-'));
  assert.equal(
    source
      .slice(0, source.indexOf('One exact operator action'))
      .includes('secrets.SUPABASE_SERVICE_ROLE_KEY'),
    false
  );
  assert.match(source, /cancel-in-progress: false/);
});

const equalManifest = JSON.parse(
  (await import('node:fs')).readFileSync(
    new URL(
      '../../scripts/ci/fixtures/tournament-recovery20/equal-share-closure-intent.json',
      import.meta.url
    ),
    'utf8'
  )
);
const { originalControlIntent } =
  await import('../../.github/scripts/tournament-original-recovery-control.mjs');
const newEqual = equalManifest.members.find(
  (m) => ![runtime.operation_id, nightlyOperation].includes(m.operationId)
);
function equalFixture({
  member = newEqual,
  initial = 'quiesced',
  failure,
  patch = {},
  afterPatch = {},
  receiptPatch = {},
} = {}) {
  const calls = [];
  let state = initial;
  let reads = 0;
  const receipt = () => ({
    ok: true,
    success: true,
    fully_settled: true,
    receipt_version: 4,
    mode: 'started_operator_equal_share',
    status: 'CANCELLED',
    operation_id: member.operationId,
    tournament_id: member.tournamentId,
    quiescence: { generation: input.generation, money_hash: '0'.repeat(32) },
    financial: {
      asset: 'chips',
      fully_settled: true,
      total_distributed: 100,
      prize_before: 95,
      bounty_before: 5,
      fee_before: 10,
      unit_scale: 100,
      shares: [privateCanary],
    },
    private_payload: privateCanary,
    ...receiptPatch,
  });
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/health')) return { ok: true, json: async () => health };
    if (url.includes('/engine_tournament_leases?'))
      return {
        ok: true,
        json: async () => [
          {
            lease_generation: input.generation,
            protocol_version: 2,
            heartbeat_at: new Date().toISOString(),
          },
        ],
      };
    if (url.endsWith('/fn_ca_tournament_abort_stop_state')) {
      reads++;
      if (state === 'unowned')
        return {
          ok: false,
          json: async () => ({ code: '55000', message: 'operator_abort_target_not_owned' }),
        };
      return {
        ok: true,
        json: async () => ({
          ok: true,
          operation_id: member.operationId,
          tournament_id: member.tournamentId,
          current_generation: state === 'settled' ? null : input.generation,
          quiescence_generation: input.generation,
          current_boundary_valid: state === 'quiesced',
          money_hash: '0'.repeat(32),
          state,
          tournament_status: state === 'settled' ? 'CANCELLED' : 'RUNNING',
          receipt: state === 'settled' ? receipt() : null,
          ...patch,
          ...(reads > 1 ? afterPatch : {}),
        }),
      };
    }
    if (url.endsWith('/fn_ca_request_tournament_abort')) {
      if (failure === 'foreign' || failure === 'terminal')
        return { ok: false, json: async () => ({ code: '55000', message: privateCanary }) };
      state = 'stop_requested';
      if (failure === 'timeout') throw Error(privateCanary);
      return {
        ok: true,
        json: async () => ({
          ok: true,
          operation_id: member.operationId,
          tournament_ids: [member.tournamentId],
          stop_requested: true,
        }),
      };
    }
    if (url.endsWith('/admin/tournament-abort-boundary')) {
      state = 'quiesced';
      if (failure === 'timeout') throw Error(privateCanary);
      return {
        ok: true,
        json: async () => ({
          success: true,
          runtime: {
            operation_id: member.operationId,
            tournament_id: member.tournamentId,
            private_payload: privateCanary,
          },
        }),
      };
    }
    if (url.endsWith('/fn_ca_tournament_cancellation_receipt')) {
      if (failure === 'canonical')
        return { ok: false, json: async () => ({ message: privateCanary }) };
      return { ok: true, json: async () => receipt() };
    }
    if (url.endsWith('/fn_ca_settle_tournament_abort_equal_share')) {
      state = 'settled';
      if (failure === 'timeout') throw Error(privateCanary);
      return { ok: true, json: async () => receipt() };
    }
    throw Error('Unexpected Equal Route');
  };
  const run = (action, extra = {}) =>
    controlOriginalRecovery(
      { ...input, tournamentId: member.tournamentId, action, moneyHash: '0'.repeat(32), ...extra },
      { fetchImpl, serviceIdentity: privateCanary, supabaseUrl: db }
    );
  return { calls, run };
}
const equalWrites = (f) =>
  f.calls.filter(({ url }) =>
    /\/admin\/|\/fn_ca_(request_tournament_abort|settle_tournament_abort_equal_share)$/.test(url)
  );
test('fixed170 manifest preserves original89 and Nightly and binds other80 stable UUIDv5 operations', async () => {
  const { createHash } = await import('node:crypto');
  assert.equal(equalManifest.members.length, 170);
  const cohort = JSON.parse(
    (await import('node:fs')).readFileSync(
      new URL(
        '../../scripts/ci/fixtures/tournament-recovery20/cohort-membership.json',
        import.meta.url
      ),
      'utf8'
    )
  );
  assert.deepEqual(
    equalManifest.members
      .filter((m) => m.operationId === runtime.operation_id)
      .map((m) => m.tournamentId)
      .sort(),
    [...cohort.original89].sort()
  );
  assert.equal(
    new Set(
      equalManifest.members
        .filter((m) => m.operationId !== runtime.operation_id)
        .map((m) => m.operationId)
    ).size,
    81
  );
  assert.equal(new Set(equalManifest.members.map((m) => m.tournamentId)).size, 170);
  assert.equal(
    equalManifest.members.filter((m) => m.operationId === runtime.operation_id).length,
    89
  );
  assert.equal(
    equalManifest.members.find((m) => m.tournamentId === nightly).operationId,
    nightlyOperation
  );
  for (const member of equalManifest.members) {
    if ([runtime.operation_id, nightlyOperation].includes(member.operationId)) continue;
    const bytes = createHash('sha1')
      .update(Buffer.from(equalManifest.holdOperationId.replaceAll('-', ''), 'hex'))
      .update(member.tournamentId)
      .digest()
      .subarray(0, 16);
    bytes[6] = (bytes[6] & 15) | 80;
    bytes[8] = (bytes[8] & 63) | 128;
    assert.equal(member.operationId.replaceAll('-', ''), bytes.toString('hex'));
    assert.equal(
      originalControlIntent({
        ...input,
        action: 'equal_read',
        tournamentId: member.tournamentId,
        operationId: runtime.operation_id,
      }).operationId,
      member.operationId
    );
  }
});
test('equal request uses fixed owner/latest reason once, then exact owned readback', async () => {
  const f = equalFixture({ initial: 'unowned' });
  const r = await f.run('equal_request');
  assert.equal(r.outcome, 'equal_share_requested_readback');
  assert.equal(r.canonicalBefore.state, 'ownership_unproven');
  assert.equal(equalWrites(f).length, 1);
  assert.deepEqual(JSON.parse(equalWrites(f)[0].options.body), {
    p_operation_id: newEqual.operationId,
    p_tournament_ids: [newEqual.tournamentId],
    p_reason: equalManifest.reason,
  });
});
for (const action of ['equal_read', 'equal_ack', 'equal_settle'])
  test(`${action} refuses ambiguous missing or foreign ownership without writes`, async () => {
    const f = equalFixture({ initial: 'unowned' });
    const r = await f.run(action);
    assert.equal(r.outcome, 'unknown');
    assert.equal(equalWrites(f).length, 0);
  });
for (const failure of ['foreign', 'terminal', 'timeout'])
  test(`equal request ${failure} remains unknown, never retries or exposes error`, async () => {
    const f = equalFixture({ initial: 'unowned', failure });
    const r = await f.run('equal_request');
    assert.equal(r.outcome, 'unknown');
    assert.equal(equalWrites(f).length, 1);
    assert.equal(JSON.stringify(r).includes(privateCanary), false);
  });
test('original89 ownership cannot be reconstructed or re-requested', async () => {
  const f = equalFixture({
    initial: 'unowned',
    member: { tournamentId: other, operationId: runtime.operation_id },
  });
  assert.equal((await f.run('equal_request')).outcome, 'unknown');
  assert.equal(equalWrites(f).length, 0);
});
test('equal ACK carries explicit mode to existing endpoint and never settles', async () => {
  const f = equalFixture({ initial: 'stop_requested' });
  const r = await f.run('equal_ack');
  assert.equal(r.outcome, 'equal_share_boundary_readback');
  assert.equal(equalWrites(f).length, 1);
  assert.deepEqual(JSON.parse(equalWrites(f)[0].options.body), {
    operationId: newEqual.operationId,
    tournamentId: newEqual.tournamentId,
    closureMode: 'equal_share',
  });
});
test('equal settlement uses only v4 authority and exact hash; safe financial aggregates survive projection', async () => {
  const f = equalFixture();
  const r = await f.run('equal_settle');
  assert.equal(r.outcome, 'equal_share_settled_readback');
  assert.equal(equalWrites(f).length, 1);
  assert.ok(equalWrites(f)[0].url.endsWith('/fn_ca_settle_tournament_abort_equal_share'));
  assert.equal(JSON.parse(equalWrites(f)[0].options.body).p_expected_money_hash, '0'.repeat(32));
  assert.equal(r.canonicalAfter.receipt.receipt_version, 4);
  assert.equal(r.canonicalAfter.receipt.financial.total_distributed, 100);
  assert.equal(JSON.stringify(r).includes(privateCanary), false);
  assert.doesNotMatch(JSON.stringify(r), /shares|private_payload/);
});
for (const patch of [
  { money_hash: '1'.repeat(32) },
  { current_boundary_valid: false },
  { quiescence_generation: input.nonce },
  { current_generation: input.nonce },
  { operation_id: nightlyOperation },
  { tournament_status: 'COMPLETED' },
])
  test(`equal settlement refuses changed boundary ${JSON.stringify(patch)}`, async () => {
    const f = equalFixture({ patch });
    assert.equal((await f.run('equal_settle')).outcome, 'unknown');
    assert.equal(equalWrites(f).length, 0);
  });
for (const receiptPatch of [
  { receipt_version: 3 },
  { mode: 'started_operator_abort' },
  { fully_settled: false },
  { operation_id: nightlyOperation },
  { tournament_id: nightly },
  { quiescence: { generation: input.generation, money_hash: '1'.repeat(32) } },
])
  test(`equal settlement rejects incompatible canonical receipt ${JSON.stringify(receiptPatch)}`, async () => {
    const f = equalFixture({ receiptPatch });
    assert.equal((await f.run('equal_settle')).outcome, 'unknown');
    assert.equal(equalWrites(f).length, 1);
  });
test('equal settlement already committed reads v4 and never repays', async () => {
  const f = equalFixture({ initial: 'settled' });
  assert.equal((await f.run('equal_settle')).outcome, 'equal_share_already_settled');
  assert.equal(equalWrites(f).length, 0);
});
test('equal settlement lost ACK preserves durable receipt but stays unknown without retry', async () => {
  const f = equalFixture({ failure: 'timeout' });
  const r = await f.run('equal_settle');
  assert.equal(r.outcome, 'unknown');
  assert.equal(r.canonicalAfter.receipt.receipt_version, 4);
  assert.equal(equalWrites(f).length, 1);
});
test('historical abort actions still refuse v4 and do not broaden cohort', async () => {
  const f = equalFixture({
    initial: 'settled',
    member: { tournamentId: other, operationId: runtime.operation_id },
  });
  assert.equal((await f.run('abort_read')).outcome, 'unknown');
  assert.equal(equalWrites(f).length, 0);
  await assert.rejects(equalFixture().run('abort_settle'));
});
test('equal actions outside reviewed170 are rejected before network', async () => {
  const f = equalFixture();
  await assert.rejects(f.run('equal_request', { tournamentId: input.nonce }));
  assert.equal(f.calls.length, 0);
});

test('equal settlement requires actual canonical economic receipt validation', async () => {
  const f = equalFixture({ failure: 'canonical' });
  assert.equal((await f.run('equal_settle')).outcome, 'unknown');
  assert.equal(equalWrites(f).length, 1);
});

test('equal read is read-only and existing request is not replayed', async () => {
  for (const action of ['equal_read', 'equal_request']) {
    const f = equalFixture({ initial: 'stop_requested' });
    assert.equal(
      (await f.run(action)).outcome,
      action === 'equal_read' ? 'equal_share_readback' : 'equal_share_already_requested'
    );
    assert.equal(equalWrites(f).length, 0);
  }
});
test('equal settlement malformed review hash refuses before database work', async () => {
  const f = equalFixture();
  assert.equal((await f.run('equal_settle', { moneyHash: 'invalid' })).outcome, 'unknown');
  assert.equal(f.calls.length, 1);
});
test('equal ACK cannot certify changed boundary or a lost response', async () => {
  for (const options of [
    { afterPatch: { current_boundary_valid: false } },
    { failure: 'timeout' },
  ]) {
    const f = equalFixture({ initial: 'stop_requested', ...options });
    const r = await f.run('equal_ack');
    assert.equal(r.outcome, 'unknown');
    assert.equal(equalWrites(f).length, 1);
    assert.equal(JSON.stringify(r).includes(privateCanary), false);
  }
});
test('manual workflow explicitly exposes all four equal actions without broadening old actions', async () => {
  const source = (await import('node:fs')).readFileSync(
    new URL('../../.github/workflows/tournament-original-recovery-control.yml', import.meta.url),
    'utf8'
  );
  for (const action of [
    'equal_request',
    'equal_read',
    'equal_ack',
    'equal_settle',
    'prepare',
    'read',
    'abort_request',
    'abort_read',
    'abort_ack',
    'abort_settle',
  ])
    assert.match(source, new RegExp('\\b' + action + '\\b'));
});
