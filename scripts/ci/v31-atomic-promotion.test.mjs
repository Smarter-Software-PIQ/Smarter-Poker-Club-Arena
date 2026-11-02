// The V31 activation, exercised end to end through the real host script (and
// the exact command remoteCommand() sends) with a scripted fake docker whose
// "in-container" processes really run, record their PID and outlive a killed
// docker client exactly like docker exec does, plus the in-container modes
// against a fake database.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostTranscript, promotionVerdict, remoteCommand, readinessRequest, OUTCOMES } from './gto-v31-qualification.mjs';
import { promoteOnce, bindOnce, revokeOnce } from './v31-atomic-promotion-container.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOST = join(HERE, 'v31-atomic-promotion-host.sh');
const DATASET = '187815b1-3701-46c8-8514-93db3cdb6d07';
const CHECKSUM = 'afad6a663fffe4566e2b82966ebd5cd673cfbd55852af6ac4d3ab738008ec422';
const DIGEST = 'd'.repeat(64);
const ENGINE = 'a'.repeat(40), SERVING = 'b'.repeat(40), OTHER = 'c'.repeat(40);
const REQUEST = '2687c795-6014-4543-85fd-460f418da6c3';
const BY = 'github-actions:Smarter-Software-PIQ/Smarter-Poker-Club-Arena:run-1-1:dan';
const SAFE = Date.UTC(2026, 10, 2, 15, 20, 0) / 1000; // 15:20Z = 09:20 Chicago

// docker exec [-i] CONTAINER sh -c SCRIPT PIDFILE CMD...: the "container" is
// this host. The child is started in the background so killing the docker
// client (what `timeout` does) leaves it running, as a real docker exec does.
const FAKE_DOCKER = `#!/usr/bin/env bash
S=$FAKE_STATE
echo "$*" >> "$S/calls"
if [ "$1 $2" = "container inspect" ]; then cat "$S/identity"; exit 0; fi
[ "$1" = exec ] || exit 99
shift
[ "$1" = -i ] && shift
shift
[ "$1" = sh ] && [ "$2" = -c ] || exit 98
script=$3; shift 3
case "$script" in 'p=$(cat'*) [ -f "$S/kill_fails" ] && exit 1 ;; esac
pidfile="$S/$(basename "$1")"; shift
exec 3<&0
# The child's output goes through a file, not this client's pipe: killing the
# client must not keep the caller's pipe open (a real docker exec client does not).
out="$S/out.$$"
sh -c "$script" "$pidfile" "$@" <&3 > "$out" 2>/dev/null & child=$!
wait "$child"; rc=$?
cat "$out"; rm -f "$out"
exit "$rc"
`;
// The engine's node, by step: modes promote/bind/revoke, the readiness inspector, the reload CLI.
const FAKE_NODE = `#!/usr/bin/env bash
S=$FAKE_STATE
if [ "$1" = --input-type=module ]; then
  cat > /dev/null
  mode=$3
  case "$mode" in promote|bind|revoke) ;; *) mode=readiness ;; esac
else
  mode=$2
fi
echo "$mode" >> "$S/steps"
if [ -f "$S/\${mode}_hang" ]; then echo $$ > "$S/hung_pid"; exec /bin/sleep 30; fi
[ -f "$S/swap_after_\${mode}" ] && cp "$S/swap_after_\${mode}" "$S/identity"
n=$(cat "$S/\${mode}_n" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$S/\${mode}_n"
rc=$(sed -n "\${n}p" "$S/\${mode}_rcs" 2>/dev/null); [ -n "$rc" ] || rc=$(tail -n 1 "$S/\${mode}_rcs" 2>/dev/null); [ -n "$rc" ] || rc=0
if [ -f "$S/\${mode}_out" ]; then cat "$S/\${mode}_out"; else echo "{\\"stage\\":\\"$mode\\",\\"n\\":$n}"; fi
exit "$rc"
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
const REAL_FLOCK = ['/usr/bin/flock', '/bin/flock'].find((path) => existsSync(path));
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
  for (const [name, body] of [['docker', FAKE_DOCKER], ['node', FAKE_NODE], ['flock', FAKE_FLOCK], ['date', FAKE_DATE],
    ['sleep', '#!/bin/sh\nexit 0\n'], ...(HAS_TIMEOUT ? [] : [['timeout', FAKE_TIMEOUT]])]) {
    writeFileSync(join(bin, name), body); chmodSync(join(bin, name), 0o755);
  }
  const s = {
    identity: `cid|img|2026-11-02T14:00:00Z|running|${SERVING}`,
    promote_out: JSON.stringify({ stage: 'promote', result: 'promoted', engineCommit: ENGINE }),
    ...overrides.state,
  };
  for (const [k, v] of Object.entries(s)) if (v !== null) writeFileSync(join(state, k), `${v}\n`);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_STATE: state,
    V31_ACTIVATION_LOCK: join(root, 'v31-activation.lock'), V31_READINESS_PAUSE: '0',
    ...(overrides.budget ? { V31_BUDGET_SECONDS: String(overrides.budget) } : {}),
    FAKE_EPOCH: String(overrides.epoch ?? SAFE), FAKE_CHICAGO: overrides.chicago ?? '0920', FAKE_FLOCK_RC: overrides.flock ?? '0' };
  const read = (name) => (existsSync(join(state, name)) ? readFileSync(join(state, name), 'utf8').trim().split('\n') : []);
  return { root, state, env, steps: () => read('steps'), calls: () => read('calls'),
    cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const ARGS = [DATASET, CHECKSUM, ENGINE, SERVING, REQUEST, DIGEST, BY, Buffer.from('{}').toString('base64'),
  Buffer.from('container').toString('base64'), Buffer.from('ready').toString('base64')];
function host(w, args = ARGS) {
  const r = spawnSync('bash', [HOST, ...args], { env: w.env, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, t: hostTranscript(r.stdout, r.status) };
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('success promotes, binds the serving commit, loads all workers, re-reads them and proves readiness', () => {
  const w = world();
  try {
    const r = host(w);
    assert.equal(r.code, 0, r.out);
    assert.equal(r.t.outcome, 'promoted-loaded-ready');
    assert.deepEqual(w.steps(), ['promote', 'bind', 'reload', 'status', 'readiness']);
    assert.deepEqual(readdirSync(w.state).filter((f) => f.endsWith('.pid')), [], 'no PID file outlives its step');
    assert.equal(r.t.stages.promote[0].result, 'promoted');
  } finally { w.cleanup(); }
});

test('the exact remote command quotes and delivers every argument to the host script', () => {
  const w = world();
  try {
    const p = { datasetId: DATASET, checksum: CHECKSUM, engineSha: ENGINE, servingSha: SERVING, requestId: REQUEST,
      cellCount: 107, afterUtc: '2026-11-02T15:20:00.000Z', closureDigest: DIGEST, boundBy: BY };
    const r = spawnSync('bash', ['-c', remoteCommand(p)], { env: w.env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const reload = w.calls().find((c) => c.includes('reloadPublic215Stores.js reload'));
    assert.ok(reload.endsWith(`node dist/scripts/reloadPublic215Stores.js reload ${REQUEST} ${DATASET} ${CHECKSUM}`), reload);
    const bind = w.calls().find((c) => c.includes(' - bind '));
    assert.ok(bind.endsWith(`node --input-type=module - bind ${DATASET} ${ENGINE} ${SERVING} ${DIGEST} ${BY}`), bind);
    const ready = w.calls().find((c) => /node --input-type=module - [A-Za-z0-9+/=]{20,}$/.test(c));
    const sent = JSON.parse(Buffer.from(ready.split(' ').at(-1), 'base64').toString('utf8'));
    assert.deepEqual(sent, readinessRequest(p));
    for (const bad of [{ servingSha: `${SERVING}'; reboot; '` }, { boundBy: "x'; reboot; '" }, { closureDigest: '0'.repeat(64) }])
      assert.throws(() => remoteCommand({ ...p, ...bad }));
  } finally { w.cleanup(); }
});

test('nothing runs on a busy activation, near a boundary or on another image', () => {
  for (const [label, overrides, outcome, code] of [
    ['activation busy', { flock: '1' }, 'refused-lock-busy', 75],
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
      assert.deepEqual(w.steps(), [], `${label}: no in-container step`);
    } finally { w.cleanup(); }
  }
  for (const [label, overrides] of [['minute 10', { epoch: SAFE - 10 * 60 }], ['minute 40', { epoch: SAFE + 20 * 60 + 59 }],
    ['chicago 03:40', { chicago: '0340' }], ['chicago 04:07', { chicago: '0407' }]]) {
    const w = world(overrides);
    try { assert.equal(host(w).code, 0, label); } finally { w.cleanup(); }
  }
  const w = world();
  try {
    assert.equal(host(w, ARGS.slice(1)).code, 64);
    assert.equal(host(w, [DATASET, CHECKSUM, ENGINE, 'b'.repeat(39), ...ARGS.slice(4)]).code, 64);
    assert.equal(host(w, [...ARGS.slice(0, 6), 'bad by;', ...ARGS.slice(7)]).code, 64);
    assert.equal(host(w, [...ARGS.slice(0, 9), 'not base64!']).code, 64);
  } finally { w.cleanup(); }
});

test('the activation never takes the engine mutation lock, so crash and release recovery never wait on it', () => {
  const lines = readFileSync(HOST, 'utf8').split('\n').filter((line) => !line.trim().startsWith('#'));
  assert.ok(!lines.some((line) => line.includes('club-arena-engine-up.lock')), 'no executable line names the engine lock');
  assert.ok(lines.some((line) => line.includes('/var/lock/club-arena-v31-activation.lock')));
});

test('a held activation leaves the engine lock free for a 5 s recovery wait (real flock)', { skip: !REAL_FLOCK && 'util-linux flock is not installed here' }, async () => {
  const w = world({ state: { reload_hang: '1' }, budget: 6 });
  const engineLock = join(w.root, 'engine-up.lock');
  writeFileSync(engineLock, '');
  // The activation runs with the REAL flock (its own lock), hung inside the load.
  const env = { ...w.env, PATH: w.env.PATH.replace(`${join(w.root, 'bin')}:`, `${join(w.root, 'realbin')}:${join(w.root, 'bin')}:`) };
  spawnSync('mkdir', ['-p', join(w.root, 'realbin')]);
  writeFileSync(join(w.root, 'realbin', 'flock'), `#!/bin/sh\nexec ${REAL_FLOCK} "$@"\n`);
  chmodSync(join(w.root, 'realbin', 'flock'), 0o755);
  try {
    const activation = spawn('bash', [HOST, ...ARGS], { env, stdio: 'ignore' });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const started = Date.now();
    // The activation really holds its own lock while it runs...
    assert.equal(spawnSync(REAL_FLOCK, ['-n', w.env.V31_ACTIVATION_LOCK, 'true']).status, 1, 'activation lock must be held');
    // ...and the engine lock stays free for a release recovery.
    const recovery = spawnSync(REAL_FLOCK, ['-w', '5', engineLock, 'true']);
    assert.equal(recovery.status, 0, 'engine-release-recover.sh style 5 s wait must acquire the engine lock');
    assert.ok(Date.now() - started < 2000);
    await new Promise((resolve) => activation.on('exit', resolve));
  } finally { w.cleanup(); }
});

test('a refused or unknown promotion never binds or loads; an unbound promotion proves every worker empty', () => {
  for (const [state, code, outcome, steps] of [
    [{ promote_rcs: '10' }, 66, 'promotion-refused', ['promote']],
    [{ promote_rcs: '20' }, 67, 'promotion-outcome-unknown', ['promote', 'clear']],
    [{ bind_rcs: '10' }, 70, 'promoted-unbound', ['promote', 'bind', 'clear']],
    [{ swap_after_promote: `cid2|img|t2|running|${OTHER}` }, 70, 'promoted-unbound', ['promote', 'clear']],
    [{ promote_rcs: '20', clear_rcs: '1' }, 73, 'promotion-outcome-unknown-uncleared', ['promote', 'clear', 'clear', 'clear']],
    [{ bind_rcs: '10', clear_rcs: '1' }, 72, 'rollback-incomplete', ['promote', 'bind', 'clear', 'clear', 'clear']],
  ]) {
    const w = world({ state });
    try {
      const r = host(w);
      assert.equal(r.code, code, outcome);
      assert.equal(r.t.outcome, outcome);
      assert.deepEqual(w.steps(), steps, outcome);
      assert.equal(OUTCOMES[code].serving, { 66: 'unchanged', 72: 'converging', 73: 'unknown' }[code] ?? 'empty');
    } finally { w.cleanup(); }
  }
});

test('a partial worker load revokes the binding and proves all eight workers empty: zero mixed workers', () => {
  for (const [label, state] of [['load fails', { reload_rcs: '1' }], ['status unconfirmed', { status_rcs: '1' }],
    ['bind outcome unknown', { bind_rcs: '20' }], ['image replaced mid-load', { swap_after_reload: `cid2|img|t2|running|${OTHER}` }]]) {
    const w = world({ state });
    try {
      const r = host(w);
      assert.equal(r.code, 68, `${label}: ${r.out}`);
      assert.equal(r.t.outcome, 'rolled-back-empty');
      const steps = w.steps();
      assert.deepEqual(steps.slice(-2), ['revoke', 'clear'], label);
      assert.ok(!steps.includes('readiness'), label);
      assert.equal(OUTCOMES[68].serving, 'empty');
    } finally { w.cleanup(); }
  }
  // A worker still busy with an older load is not proof: clear again.
  const busy = world({ state: { reload_rcs: '1', clear_rcs: '1\n0' } });
  try {
    assert.equal(host(busy).code, 68);
    assert.deepEqual(busy.steps().filter((s) => s === 'clear').length, 2);
  } finally { busy.cleanup(); }
  for (const [label, state] of [['clear never proven', { reload_rcs: '1', clear_rcs: '1' }],
    ['revoke unconfirmed', { reload_rcs: '1', revoke_rcs: '20' }]]) {
    const w = world({ state });
    try {
      const r = host(w);
      assert.equal(r.code, 72, label);
      assert.equal(r.t.outcome, 'rollback-incomplete');
      assert.equal(OUTCOMES[72].serving, 'converging');
      if (label === 'revoke unconfirmed') assert.ok(!w.steps().includes('clear'), 'never clear before the binding is revoked');
    } finally { w.cleanup(); }
  }
});

test('readiness failure with all eight proven loaded keeps one consistent model; retries stay bounded', () => {
  for (const [rcs, code, attempts] of [['3', 69, 1], ['2\n2\n0', 0, 3], ['2', 69, 6]]) {
    const w = world({ state: { readiness_rcs: rcs } });
    try {
      const r = host(w);
      assert.equal(r.code, code, rcs);
      assert.equal(w.steps().filter((k) => k === 'readiness').length, attempts, rcs);
      assert.ok(!w.steps().includes('revoke'), rcs);
      if (code) assert.equal(r.t.outcome, 'promoted-loaded-readiness-unproved');
    } finally { w.cleanup(); }
  }
});

test('a hung in-container step is killed inside the container and proven gone before anything else runs', () => {
  for (const [hang, code, after] of [['promote_hang', 67, ['clear']], ['reload_hang', 68, ['revoke', 'clear']],
    ['readiness_hang', 69, []]]) {
    const w = world({ state: { [hang]: '1' }, budget: 4 });
    try {
      const started = Date.now();
      const r = host(w);
      assert.ok(Date.now() - started < 20000, hang);
      assert.equal(r.code, code, `${hang}: ${r.out}`);
      assert.ok(r.t.stages.terminate?.length >= 1, `${hang}: termination recorded`);
      const pid = Number(readFileSync(join(w.state, 'hung_pid'), 'utf8'));
      assert.ok(Number.isInteger(pid) && pid > 1);
      assert.equal(alive(pid), false, `${hang}: the in-container process ${pid} must be gone`);
      const steps = w.steps(), at = steps.indexOf(hang.replace('_hang', ''));
      assert.deepEqual(steps.slice(at + 1).filter((s) => s !== 'readiness'), after, hang);
    } finally { w.cleanup(); }
  }
  // A step that cannot be proven killed stops the run with an explicit outcome.
  const w = world({ state: { reload_hang: '1', kill_fails: '1' }, budget: 4 });
  try {
    const r = host(w);
    assert.equal(r.code, 71);
    assert.equal(r.t.outcome, 'in-container-step-not-terminated');
    assert.ok(!w.steps().includes('revoke'));
    try { process.kill(Number(readFileSync(join(w.state, 'hung_pid'), 'utf8')), 'SIGKILL'); } catch {}
  } finally { w.cleanup(); }
  // Every docker exec is bounded and runs under a recorded PID.
  const lines = readFileSync(HOST, 'utf8').split('\n').filter((line) => !line.trim().startsWith('#') && /\bdocker (?:exec|container)/.test(line));
  for (const line of lines) assert.match(line, /(?:bounded (?:\d+|"\$cap")|timeout --signal=TERM --kill-after=2 20) docker /, line);
  assert.equal(lines.filter((line) => line.includes('sh -c "$WRAP" "$pidfile"')).length, 2);
  // The revert never extends the deadline past the window the start refusal leaves.
  const hostSource = readFileSync(HOST, 'utf8');
  assert.match(hostSource, /window_end=\$\(\( now - now % 3600 \+ 49 \* 60 \+ 30 \)\)/);
  assert.equal((hostSource.match(/^\s*deadline=/gm) ?? []).length, 3);
  for (const line of hostSource.match(/^\s*deadline=.*$/gm)) assert.match(line, /deadline=(?:\$\(\( now \+ BUDGET_SECONDS \)\)|\$window_end)/, line);
});

test('a successful host exit still needs eight valid receipts and the loaded health', () => {
  const p = { datasetId: DATASET, checksum: CHECKSUM, engineSha: ENGINE, servingSha: SERVING, requestId: REQUEST,
    cellCount: 107, afterUtc: '2026-11-02T15:20:00.000Z', closureDigest: DIGEST, boundBy: BY };
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
  const transcript = (load, bind = { result: 'bound', servingCommit: SERVING }) => ({ outcome: 'promoted-loaded-ready', changed: true, rerun: false, exitCode: 0,
    stages: { promote: [{ result: 'promoted', engineCommit: ENGINE }], bind: [bind], load: [load], status: [store('status')], readiness: [ready] } });
  assert.equal(promotionVerdict(p, transcript(store('reload')), health, now).outcome, 'promoted-loaded-ready');
  for (const [label, t, h] of [['seven workers', transcript(store('reload', 7)), health],
    ['old dataset in health', transcript(store('reload')), { ...health, liveHorseDecision: { ...health.liveHorseDecision,
      solverStores: { postflopV31: 0, postflopV31Dataset: null } } }],
    ['other serving', transcript(store('reload')), { ...health, releaseSha: OTHER }],
    ['bound another commit', transcript(store('reload'), { result: 'bound', servingCommit: OTHER }), health],
    ['never bound', transcript(store('reload'), null), health]]) {
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


test('the container binds only the serving commit it runs as, and proves the binding by an admission read', async () => {
  const calls = [];
  const db = (bind, admission) => ({ calls, rpc: async (name, args) => {
    calls.push([name, args]);
    if (name === 'fn_gto_v31_bind_serving') { if (bind instanceof Error) throw bind; return bind; }
    return admission;
  } });
  const ok = { data: { active: { dataset_id: DATASET }, admitted: true }, error: null };
  const argv = [DATASET, ENGINE, SERVING, DIGEST, BY];
  assert.deepEqual(await bindOnce(argv, env, db({ data: { bound: true }, error: null }, ok)), [0, { result: 'bound', servingCommit: SERVING }]);
  assert.equal((await bindOnce(argv, env, db({ data: { bound: false }, error: null }, ok)))[1].result, 'already-bound');
  for (const [label, a, e, d, code] of [
    ['other image', argv, { GIT_COMMIT_SHA: OTHER }, db({ data: {}, error: null }, ok), 10],
    ['bad digest', [DATASET, ENGINE, SERVING, 'x', BY], env, db({ data: {}, error: null }, ok), 10],
    ['gate refused', argv, env, db({ data: null, error: { code: 'P0001', message: 'no' } }, ok), 10],
    ['transport', argv, env, db(new Error('reset'), ok), 20],
    ['not admitted after bind', argv, env, db({ data: { bound: true }, error: null }, { data: { active: { dataset_id: DATASET }, admitted: false }, error: null }), 20],
  ]) assert.equal((await bindOnce(a, e, d))[0], code, label);
});

test('the container revokes and proves the serving commit is no longer admitted', async () => {
  const db = (revoke, admitted) => ({ rpc: async (name) => name === 'fn_gto_v31_revoke_serving' ? revoke
    : { data: { active: { dataset_id: DATASET }, admitted }, error: null } });
  assert.deepEqual(await revokeOnce([DATASET, SERVING, BY], env, db({ data: true, error: null }, false)), [0, { result: 'revoked' }]);
  assert.deepEqual(await revokeOnce([DATASET, SERVING, BY], env, db({ data: false, error: null }, false)), [0, { result: 'not-bound' }]);
  assert.equal((await revokeOnce([DATASET, SERVING, BY], env, db({ data: true, error: null }, true)))[0], 20);
  assert.equal((await revokeOnce([DATASET, SERVING, BY], env, db({ data: null, error: { code: '57014' } }, false)))[0], 20);
  assert.equal((await revokeOnce([DATASET, 'x', BY], env, db({ data: true, error: null }, false)))[0], 10);
});
