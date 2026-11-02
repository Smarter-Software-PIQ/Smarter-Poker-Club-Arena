// The engine-locked activation, exercised end to end through the real host
// script (and the exact command remoteCommand() sends) with a scripted fake
// docker/flock/date, plus the in-container promotion against a fake database.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostTranscript, promotionVerdict, remoteCommand, readinessRequest } from './gto-v31-qualification.mjs';
import { promoteOnce } from './v31-atomic-promotion-container.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOST = join(HERE, 'v31-atomic-promotion-host.sh');
const DATASET = '187815b1-3701-46c8-8514-93db3cdb6d07';
const CHECKSUM = 'afad6a663fffe4566e2b82966ebd5cd673cfbd55852af6ac4d3ab738008ec422';
const ENGINE = 'a'.repeat(40), SERVING = 'b'.repeat(40), OTHER = 'c'.repeat(40);
const REQUEST = '2687c795-6014-4543-85fd-460f418da6c3';
const SAFE = Date.UTC(2026, 10, 2, 15, 20, 0) / 1000; // 15:20Z = 09:20 Chicago

const FAKE_DOCKER = `#!/usr/bin/env bash
S=$FAKE_STATE
echo "$*" >> "$S/calls"
if [ "$1 $2" = "container inspect" ]; then cat "$S/identity"; exit 0; fi
if [ "$1" = exec ]; then
  if [ "$2" = -i ]; then
    cat > /dev/null
    if [ "$#" -eq 10 ]; then
      [ -f "$S/promote_hang" ] && exec /bin/sleep 30
      cat "$S/promote_out"; rc=$(cat "$S/promote_rc")
      [ -f "$S/swap_after_promote" ] && cp "$S/swap_after_promote" "$S/identity"
      exit "$rc"
    fi
    n=$(cat "$S/ready_n" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$S/ready_n"
    rc=$(sed -n "\${n}p" "$S/ready_rcs"); [ -n "$rc" ] || rc=$(tail -n 1 "$S/ready_rcs")
    echo "{\\"stage\\":\\"readiness\\",\\"attempt\\":$n}"; exit "$rc"
  fi
  op=$5
  [ -f "$S/\${op}_hang" ] && exec /bin/sleep 30
  echo "{\\"operation\\":\\"$op\\"}"; exit "$(cat "$S/\${op}_rc")"
fi
exit 99
`;
// Only where GNU timeout is absent (macOS): same contract, kill on expiry, exit 124.
const FAKE_TIMEOUT = `#!/usr/bin/env bash
while [[ $1 == --* ]]; do shift; done
t=$1; shift
exec 3<&0
"$@" <&3 & pid=$!
( /bin/sleep "$t"; kill -TERM "$pid" 2>/dev/null ) >/dev/null 2>&1 & killer=$!
wait "$pid"; rc=$?
if kill -0 "$killer" 2>/dev/null; then kill "$killer" 2>/dev/null; else rc=124; fi
exit "$rc"
`;
const HAS_TIMEOUT = spawnSync('bash', ['-c', 'command -v timeout'], { encoding: 'utf8' }).status === 0;
const FAKE_FLOCK = '#!/usr/bin/env bash\nexit "${FAKE_FLOCK_RC:-0}"\n';
const FAKE_DATE = `#!/usr/bin/env bash
for a in "$@"; do
  case "$a" in +%s) echo "$FAKE_EPOCH"; exit 0;; +%H%M) echo "$FAKE_CHICAGO"; exit 0;; esac
done
exit 1
`;

function world(overrides = {}) {
  const root = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'v31-atomic-'));
  const bin = join(root, 'bin'), state = join(root, 'state');
  for (const dir of [bin, state]) spawnSync('mkdir', ['-p', dir]);
  for (const [name, body] of [['docker', FAKE_DOCKER], ['flock', FAKE_FLOCK], ['date', FAKE_DATE], ['sleep', '#!/bin/sh\nexit 0\n'],
    ...(HAS_TIMEOUT ? [] : [['timeout', FAKE_TIMEOUT]])]) {
    writeFileSync(join(bin, name), body); chmodSync(join(bin, name), 0o755);
  }
  const s = {
    identity: `cid|img|2026-11-02T14:00:00Z|running|${SERVING}`,
    promote_out: JSON.stringify({ stage: 'promote', result: 'promoted', engineCommit: ENGINE }),
    promote_rc: '0', reload_rc: '0', status_rc: '0', ready_rcs: '0', ...overrides.state,
  };
  for (const [k, v] of Object.entries(s)) if (v !== null) writeFileSync(join(state, k), `${v}\n`);
  const lock = join(root, 'engine-up.lock');
  if (overrides.lock !== false) writeFileSync(lock, '');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_STATE: state, V31_ENGINE_LOCK: lock,
    V31_READINESS_PAUSE: '0', ...(overrides.budget ? { V31_BUDGET_SECONDS: String(overrides.budget) } : {}), FAKE_EPOCH: String(overrides.epoch ?? SAFE), FAKE_CHICAGO: overrides.chicago ?? '0920',
    FAKE_FLOCK_RC: overrides.flock ?? '0' };
  return { root, state, env, calls: () => (existsSync(join(state, 'calls')) ? readFileSync(join(state, 'calls'), 'utf8').trim().split('\n') : []) };
}

const ARGS = [DATASET, CHECKSUM, ENGINE, SERVING, REQUEST, Buffer.from('{}').toString('base64'),
  Buffer.from('promote').toString('base64'), Buffer.from('ready').toString('base64')];
function host(w, args = ARGS) {
  const r = spawnSync('bash', [HOST, ...args], { env: w.env, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, t: hostTranscript(r.stdout, r.status) };
}
const kinds = (calls) => calls.map((c) => c.startsWith('container inspect') ? 'inspect'
  : c.includes('reloadPublic215Stores.js reload') ? 'reload' : c.includes('reloadPublic215Stores.js status') ? 'status'
  : c.split(' ').length === 10 ? 'promote' : 'readiness');

test('success promotes, loads all workers, re-reads them and proves readiness under one lock', () => {
  const w = world();
  try {
    const r = host(w);
    assert.equal(r.code, 0, r.out);
    assert.equal(r.t.outcome, 'promoted-loaded-ready');
    assert.deepEqual(kinds(w.calls()), ['inspect', 'promote', 'inspect', 'reload', 'inspect', 'status', 'readiness', 'inspect']);
    assert.equal(r.t.stages.promote[0].result, 'promoted');
  } finally { rmSync(w.root, { recursive: true, force: true }); }
});

test('the exact remote command quotes and delivers every argument to the host script', () => {
  const w = world();
  try {
    const p = { datasetId: DATASET, checksum: CHECKSUM, engineSha: ENGINE, servingSha: SERVING, requestId: REQUEST,
      cellCount: 107, afterUtc: '2026-11-02T15:20:00.000Z' };
    const r = spawnSync('bash', ['-c', remoteCommand(p)], { env: w.env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const call = w.calls().find((c) => c.includes('reloadPublic215Stores.js reload'));
    assert.equal(call, `exec club-arena-engine node dist/scripts/reloadPublic215Stores.js reload ${REQUEST} ${DATASET} ${CHECKSUM}`);
    const ready = w.calls().find((c) => c.startsWith('exec -i club-arena-engine node --input-type=module - ') && c.split(' ').length === 7);
    const sent = JSON.parse(Buffer.from(ready.split(' ').at(-1), 'base64').toString('utf8'));
    assert.deepEqual(sent, readinessRequest(p));
    assert.throws(() => remoteCommand({ ...p, servingSha: `${SERVING}'; reboot; '` }));
  } finally { rmSync(w.root, { recursive: true, force: true }); }
});

test('nothing runs without the lock, outside the window or on another image', () => {
  for (const [label, overrides, outcome, code] of [
    ['busy', { flock: '1' }, 'refused-lock-busy', 75],
    ['missing', { lock: false }, 'refused-lock-missing', 75],
    ['minute 05', { epoch: SAFE - 15 * 60 }, 'refused-maintenance-boundary', 75],
    ['minute 41', { epoch: SAFE + 21 * 60 }, 'refused-maintenance-boundary', 75],
    ['minute 52', { epoch: SAFE + 32 * 60 }, 'refused-maintenance-boundary', 75],
    ['chicago 03:41', { chicago: '0341' }, 'refused-daily-maintenance', 75],
    ['chicago 04:06', { chicago: '0406' }, 'refused-daily-maintenance', 75],
    ['other image', { state: { identity: `cid|img|t|running|${OTHER}` } }, 'refused-serving-identity', 65],
    ['stopped', { state: { identity: `cid|img|t|exited|${SERVING}` } }, 'refused-serving-identity', 65],
  ]) {
    const w = world(overrides);
    try {
      const r = host(w);
      assert.equal(r.code, code, label);
      assert.equal(r.t.printed, outcome, label);
      assert.equal(r.t.changed, false, label);
      assert.ok(!kinds(w.calls()).some((k) => k !== 'inspect'), `${label}: no exec`);
    } finally { rmSync(w.root, { recursive: true, force: true }); }
  }
  for (const [label, overrides] of [['minute 10', { epoch: SAFE - 10 * 60 }], ['minute 40', { epoch: SAFE + 20 * 60 + 59 }],
    ['chicago 03:40', { chicago: '0340' }], ['chicago 04:07', { chicago: '0407' }]]) {
    const w = world(overrides);
    try { assert.equal(host(w).code, 0, label); } finally { rmSync(w.root, { recursive: true, force: true }); }
  }
  const w = world();
  try {
    assert.equal(host(w, ARGS.slice(1)).code, 64);
    assert.equal(host(w, [DATASET, CHECKSUM, ENGINE, 'b'.repeat(39), ...ARGS.slice(4)]).code, 64);
    assert.equal(host(w, [...ARGS.slice(0, 7), 'not base64!']).code, 64);
  } finally { rmSync(w.root, { recursive: true, force: true }); }
});

test('a serving version change mid-promotion stops before any load', () => {
  const w = world({ state: { swap_after_promote: `cid2|img2|t2|running|${OTHER}` } });
  try {
    const r = host(w);
    assert.equal(r.code, 70);
    assert.equal(r.t.outcome, 'serving-identity-changed');
    assert.equal(r.t.rerun, true);
    assert.ok(!kinds(w.calls()).includes('reload'));
  } finally { rmSync(w.root, { recursive: true, force: true }); }
});

test('a refused or unknown promotion never loads', () => {
  for (const [rc, outcome, code] of [['10', 'promotion-refused', 66], ['20', 'promotion-outcome-unknown', 67]]) {
    const w = world({ state: { promote_rc: rc } });
    try {
      const r = host(w);
      assert.equal(r.code, code);
      assert.equal(r.t.outcome, outcome);
      assert.ok(!kinds(w.calls()).includes('reload'));
    } finally { rmSync(w.root, { recursive: true, force: true }); }
  }
});

test('a partial worker load is explicit and re-runnable without re-promoting', () => {
  const w = world({ state: { reload_rc: '1' } });
  try {
    const r = host(w);
    assert.equal(r.code, 68);
    assert.deepEqual({ outcome: r.t.outcome, changed: r.t.changed, rerun: r.t.rerun },
      { outcome: 'promoted-load-incomplete', changed: true, rerun: true });
    assert.ok(!kinds(w.calls()).includes('readiness'));
  } finally { rmSync(w.root, { recursive: true, force: true }); }
  // The re-run finds the epoch already promoted and only loads.
  const again = world({ state: { promote_out: JSON.stringify({ stage: 'promote', result: 'already-promoted', engineCommit: ENGINE }) } });
  try {
    const r = host(again);
    assert.equal(r.code, 0);
    assert.equal(r.t.stages.promote[0].result, 'already-promoted');
  } finally { rmSync(again.root, { recursive: true, force: true }); }
});

test('readiness failure is explicit; incomplete readiness is retried within the bound', () => {
  for (const [rcs, code, attempts] of [['3', 69, 1], ['2\n2\n0', 0, 3], ['2', 69, 6]]) {
    const w = world({ state: { ready_rcs: rcs } });
    try {
      const r = host(w);
      assert.equal(r.code, code, rcs);
      assert.equal(kinds(w.calls()).filter((k) => k === 'readiness').length, attempts, rcs);
      if (code) assert.equal(r.t.outcome, 'promoted-loaded-readiness-unproved');
    } finally { rmSync(w.root, { recursive: true, force: true }); }
  }
  const w = world({ state: { status_rc: '1' } });
  try { assert.equal(host(w).code, 69); } finally { rmSync(w.root, { recursive: true, force: true }); }
});

test('a successful host exit still needs eight valid receipts and the loaded health', () => {
  const p = { datasetId: DATASET, checksum: CHECKSUM, engineSha: ENGINE, servingSha: SERVING, requestId: REQUEST,
    cellCount: 107, afterUtc: '2026-11-02T15:20:00.000Z' };
  const now = Date.parse('2026-11-02T15:24:00.000Z');
  const ack = (worker, operation) => ({ worker, type: 'V31_STORE_CONTROL_ACK', operation, requestId: REQUEST, ok: true,
    count: 107, dataset: { id: DATASET, checksum: CHECKSUM }, error: null });
  const store = (operation, workers = 8) => ({ format: 'v31_explicit_store_control_receipt_v1', operation,
    observedAt: '2026-11-02T15:22:00.000Z', sourceSha: SERVING, receipt: { checksum: CHECKSUM, datasetId: DATASET,
      expectedCells: 107, requestId: REQUEST, state: 'complete', workers: [...Array(workers).keys()].map((i) => ack(i, operation)) } });
  const ready = { version: 1, scope: 'v31_loaded_before_natural_accepted_decisions', status: 'verified', sourceSha: SERVING,
    observedAt: now - 1000, qualified: false, activationAllowed: false, policyApplicationProven: false,
    workers: [...Array(8).keys()].map((worker) => ({ worker, atMs: now - 2000, loadedCells: 107, datasetId: DATASET,
      datasetChecksum: CHECKSUM, decisionSha256: 'd'.repeat(64), executionSha256: 'e'.repeat(64),
      acceptedHandSha256: 'f'.repeat(64), actionOrdinal: 3 })) };
  const health = { status: 'ok', releaseSha: SERVING, liveHorseDecision: { phase: 'ready', workerCount: 8,
    solverStores: { postflopV31: 107, postflopV31Dataset: { id: DATASET, checksum: CHECKSUM } } } };
  const transcript = (load, h = health) => ({ outcome: 'promoted-loaded-ready', changed: true, rerun: false, exitCode: 0,
    stages: { promote: [{ result: 'promoted', engineCommit: ENGINE }], load: [load], status: [store('status')], readiness: [ready] } });
  assert.equal(promotionVerdict(p, transcript(store('reload')), health, now).outcome, 'promoted-loaded-ready');
  for (const [label, t, h] of [['seven workers', transcript(store('reload', 7)), health],
    ['old dataset in health', transcript(store('reload')), { ...health, liveHorseDecision: { ...health.liveHorseDecision,
      solverStores: { postflopV31: 0, postflopV31Dataset: null } } }],
    ['other serving', transcript(store('reload')), { ...health, releaseSha: OTHER }]]) {
    const v = promotionVerdict(p, t, h, now);
    assert.equal(v.outcome, 'promoted-loaded-readiness-unproved', label);
    assert.equal(v.rerun, true, label);
  }
  assert.equal(hostTranscript('V31_ATOMIC_OUTCOME promoted-loaded-ready\n', 68).outcome, 'host-outcome-unknown');
  assert.equal(hostTranscript('', null).outcome, 'host-outcome-unknown');
});

function fakeDb({ state = 'candidate', epoch = { epoch_id: 'e1', epoch_no: 2, engine_commit: ENGINE, promoted_at: null,
  promoted_serving_commit: null }, promote = { data: CHECKSUM, error: null }, after } = {}) {
  const calls = [];
  let reads = 0;
  return { calls, rpc: async (name, args) => {
    calls.push([name, args]);
    if (name === 'ca_gto_v31_certification_status') {
      reads += 1;
      const row = reads > 1 && after ? after : { dataset_id: DATASET, dataset_checksum: CHECKSUM, state, current_epoch: epoch };
      return { data: { datasets: [row] }, error: null };
    }
    if (promote instanceof Error) throw promote;
    return promote;
  } };
}
const env = { GIT_COMMIT_SHA: SERVING };
const ARGV = [DATASET, CHECKSUM, ENGINE, SERVING];

test('the container promotes exactly the evaluated epoch for the serving commit', async () => {
  const promoted = { dataset_id: DATASET, dataset_checksum: CHECKSUM, state: 'active',
    current_epoch: { epoch_id: 'e1', epoch_no: 2, engine_commit: ENGINE, promoted_at: 'now', promoted_serving_commit: SERVING } };
  const db = fakeDb({ after: promoted });
  assert.deepEqual((await promoteOnce(ARGV, env, db))[0], 0);
  assert.deepEqual(db.calls[1], ['fn_gto_v31_promote_dataset_epoch', { p_dataset_id: DATASET, p_engine_commit: ENGINE, p_serving_commit: SERVING }]);
  // Re-run after a partial load: never promotes again.
  const rerun = fakeDb({ state: 'active', epoch: promoted.current_epoch });
  const [code, body] = await promoteOnce(ARGV, env, rerun);
  assert.equal(code, 0); assert.equal(body.result, 'already-promoted');
  assert.ok(!rerun.calls.some(([n]) => n === 'fn_gto_v31_promote_dataset_epoch'));
});

test('the container refuses before any change, and reports unknown outcomes as unknown', async () => {
  for (const [label, argv, e, db, code] of [
    ['image is not the serving commit', ARGV, { GIT_COMMIT_SHA: OTHER }, fakeDb(), 10],
    ['epoch pins another engine', ARGV, env, fakeDb({ epoch: { epoch_id: 'e1', epoch_no: 1, engine_commit: OTHER, promoted_at: null } }), 10],
    ['not a candidate', ARGV, env, fakeDb({ state: 'evaluating' }), 10],
    ['database gate raised', ARGV, env, fakeDb({ promote: { data: null, error: { code: 'P0001', message: 'gates' } } }), 10],
    ['transport error', ARGV, env, fakeDb({ promote: { data: null, error: { code: '57014', message: 'timeout' } } }), 20],
    ['thrown transport', ARGV, env, fakeDb({ promote: new Error('reset') }), 20],
    ['version changed during promotion', ARGV, env, fakeDb({ after: { dataset_id: DATASET, dataset_checksum: CHECKSUM,
      state: 'active', current_epoch: { epoch_id: 'e1', epoch_no: 2, engine_commit: ENGINE, promoted_at: 'now',
        promoted_serving_commit: OTHER } } }), 20],
    ['bad arguments', [DATASET, CHECKSUM, ENGINE], env, fakeDb(), 10],
  ]) {
    const [got] = await promoteOnce(argv, e, db);
    assert.equal(got, code, label);
    if (code === 10 && label !== 'database gate raised')
      assert.ok(!db.calls.some(([n]) => n === 'fn_gto_v31_promote_dataset_epoch'), label);
  }
});

test('a hung step is killed at the deadline and reported explicitly, never holding the lock past the budget', () => {
  for (const [hang, code, outcome, absent] of [['promote_hang', 67, 'promotion-outcome-unknown', 'reload'],
    ['reload_hang', 68, 'promoted-load-incomplete', 'readiness']]) {
    const w = world({ state: { [hang]: '1' }, budget: 4 });
    try {
      const started = Date.now();
      const r = host(w);
      const elapsed = Date.now() - started;
      assert.equal(r.code, code, hang);
      assert.equal(r.t.outcome, outcome, hang);
      assert.ok(elapsed < 15000, `${hang} took ${elapsed} ms`);
      assert.ok(!kinds(w.calls()).includes(absent), hang);
    } finally { rmSync(w.root, { recursive: true, force: true }); }
  }
  // The budget can only shrink: a larger override is ignored.
  const host_sh = readFileSync(HOST, 'utf8');
  assert.match(host_sh, /BUDGET_SECONDS=480\n/);
  assert.match(host_sh, /\(\( V31_BUDGET_SECONDS < BUDGET_SECONDS \)\)/);
  for (const step of ['bounded 60 docker exec -i', 'bounded 170 docker exec', 'bounded 60 docker exec "$CONTAINER" node dist/scripts/reloadPublic215Stores.js status',
    'bounded 45 docker exec -i', 'bounded 20 docker container inspect'])
    assert.ok(host_sh.includes(step), step);
  const calls = host_sh.split('\n').filter((line) => !line.trim().startsWith('#') && /\bdocker (?:exec|container)/.test(line));
  assert.equal(calls.length, 5);
  for (const line of calls) assert.match(line, /bounded \d+ docker /, line);
});
