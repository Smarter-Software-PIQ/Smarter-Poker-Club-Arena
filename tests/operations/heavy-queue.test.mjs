// The host-wide heavy-job queue (scripts/lib/heavy-queue.sh), driven through
// bash exactly as the pre-push hook and scripts/agent-push.sh drive it.
// Each case uses its own queue directory (CA_HEAVY_QUEUE_DIR) and a load file
// (CA_HEAVY_QUEUE_LOAD_FILE), so nothing here depends on the machine's queue,
// drives or load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIB = join(ROOT, 'scripts/lib/heavy-queue.sh');

const fresh = () => mkdtempSync(join(tmpdir(), 'hq-test-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n') : []);

function env(q, extra = {}) {
  return {
    ...process.env,
    CA_HEAVY_QUEUE: 'on',
    CA_HEAVY_QUEUE_DIR: q,
    CA_HEAVY_QUEUE_POLL: '0.1',
    CA_HEAVY_QUEUE_SLOTS: '1',
    CA_HEAVY_QUEUE_LOAD_CEILING: '0',
    CA_HEAVY_QUEUE_LOAD_FILE: '',
    CA_HEAVY_QUEUE_LEGACY_DIRS: '',
    HQ_HELD_TICKET: '',
    ...extra,
  };
}

/** acquire, log "<name> start <state>", hold, log "<name> end", release */
function job(q, name, holdSeconds, log, extra = {}) {
  const script =
    `. "${LIB}"; hq_acquire "${name}"; echo "${name} start $HQ_STATE" >> "${log}"; ` +
    `sleep ${holdSeconds}; echo "${name} end" >> "${log}"; hq_release`;
  const p = spawn('bash', ['-c', script], { env: env(q, extra), stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => (err += d));
  return new Promise((res) => p.on('exit', (code) => res({ code, err })));
}

test('two concurrent acquirers serialize on one slot', async () => {
  const q = fresh();
  const log = join(q, 'log');
  const a = job(q, 'A', 1.2, log);
  await sleep(400);
  const b = job(q, 'B', 0.1, log);
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.code, 0);
  assert.equal(rb.code, 0);
  assert.deepEqual(lines(log), ['A start admitted', 'A end', 'B start admitted', 'B end']);
});

test('waiters are admitted in the order they queued (FIFO)', async () => {
  const q = fresh();
  const log = join(q, 'log');
  const a = job(q, 'A', 1.5, log);
  await sleep(400);
  const b = job(q, 'B', 0.3, log);
  await sleep(400);
  const c = job(q, 'C', 0.1, log);
  await Promise.all([a, b, c]);
  const starts = lines(log).filter((l) => l.includes(' start '));
  assert.deepEqual(starts, ['A start admitted', 'B start admitted', 'C start admitted']);
});

test('a ticket whose holder died is recovered, not waited on', async () => {
  const q = fresh();
  mkdirSync(join(q, 'tickets'), { recursive: true });
  const dead = Number(spawnSync('bash', ['-c', 'echo $$'], { encoding: 'utf8' }).stdout.trim());
  writeFileSync(join(q, 'seq'), '5\n');
  writeFileSync(join(q, 'tickets', '000000000003'), `pid=${dead}\nstart=\nlabel=ghost gate\ncwd=/x\nenqueued=1\n`);
  writeFileSync(join(q, 'tickets', '000000000003.run'), '1\n');
  const log = join(q, 'log');
  const began = Date.now();
  const r = await job(q, 'A', 0.1, log);
  assert.equal(r.code, 0);
  assert.match(r.err, /recovered a stale slot: ticket 000000000003 \(ghost gate/);
  assert.ok(Date.now() - began < 5000, 'admitted without waiting on the dead holder');
  assert.deepEqual(lines(log), ['A start admitted', 'A end']);
});

test('a free slot waits while the load is above the ceiling and a heavy job runs', async () => {
  const q = fresh();
  const load = join(q, 'load');
  writeFileSync(load, '50\n');
  const log = join(q, 'log');
  const extra = { CA_HEAVY_QUEUE_SLOTS: '2', CA_HEAVY_QUEUE_LOAD_CEILING: '10', CA_HEAVY_QUEUE_LOAD_FILE: load };
  // A: nothing is running, so it is admitted whatever the load (no deadlock).
  const a = job(q, 'A', 1.2, log, extra);
  await sleep(400);
  const b = job(q, 'B', 0.1, log, extra);
  const [, rb] = await Promise.all([a, b]);
  assert.deepEqual(lines(log), ['A start admitted', 'A end', 'B start admitted', 'B end']);
  assert.match(rb.err, /a slot is free for B, but the 1-minute load 50 is above the ceiling 10/);
});

test('under the ceiling both slots run at once', async () => {
  const q = fresh();
  const load = join(q, 'load');
  writeFileSync(load, '5\n');
  const log = join(q, 'log');
  const extra = { CA_HEAVY_QUEUE_SLOTS: '2', CA_HEAVY_QUEUE_LOAD_CEILING: '10', CA_HEAVY_QUEUE_LOAD_FILE: load };
  const a = job(q, 'A', 1.2, log, extra);
  await sleep(400);
  const b = job(q, 'B', 0.1, log, extra);
  await Promise.all([a, b]);
  assert.deepEqual(lines(log), ['A start admitted', 'B start admitted', 'B end', 'A end']);
});

test('a job still running in an old queue folder holds a slot until it ends', async () => {
  const q = fresh();
  const legacy = fresh();
  mkdirSync(join(legacy, 'tickets'), { recursive: true });
  const holder = spawn('sleep', ['30'], { stdio: 'ignore' });
  writeFileSync(join(legacy, 'tickets', '000000000121'), `pid=${holder.pid}\nstart=\nlabel=core gate\ncwd=/x\nenqueued=1\n`);
  writeFileSync(join(legacy, 'tickets', '000000000121.run'), '1\n');
  const log = join(q, 'log');
  const b = job(q, 'B', 0.1, log, { CA_HEAVY_QUEUE_LEGACY_DIRS: legacy });
  await sleep(1200);
  assert.deepEqual(lines(log), [], 'B waits while the old-folder job runs');
  holder.kill('SIGKILL');
  const rb = await b;
  assert.equal(rb.code, 0);
  assert.deepEqual(lines(log), ['B start admitted', 'B end']);
  assert.ok(existsSync(join(legacy, 'tickets', '000000000121')), 'the old folder is read, never written');
});

test('a waiter is told its place and an ETA from recent run lengths; a release records its run', async () => {
  const q = fresh();
  mkdirSync(q, { recursive: true });
  writeFileSync(join(q, 'history'), '600\n600\n900\n');
  const log = join(q, 'log');
  const a = job(q, 'A', 1.0, log);
  await sleep(400);
  const rb = await job(q, 'B', 0.1, log);
  await a;
  assert.match(rb.err, /place 1 in the waiting line, about 10 min \(a heavy job typically runs 10 min\)/);
  const hist = lines(join(q, 'history'));
  assert.equal(hist.length, 5, 'A and B each recorded a run length');
});

test('the queue lives in one fixed place whatever drives are attached', () => {
  const home = fresh();
  const r = spawnSync('bash', ['-c', `. "${LIB}"; hq_dir`], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, CA_HEAVY_QUEUE_DIR: '' },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), join(home, '.cache', 'club-arena-heavy-queue'));
});
