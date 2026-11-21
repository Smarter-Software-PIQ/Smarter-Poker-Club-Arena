import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// scripts/lib/heavy-queue.sh and scripts/heavy-queue.sh: the Mac's host-wide
// FIFO admission queue for heavy local jobs (Dan, 2026-11-19 17:26 Chicago).
// Every case uses a private queue directory (CA_HEAVY_QUEUE_DIR) so it never
// touches the real queue on the SSD.
vi.setConfig({ testTimeout: 60_000 });

const cli = resolve('scripts/heavy-queue.sh');
const lib = resolve('scripts/lib/heavy-queue.sh');
let dir: string;
let queue: string;

const env = (extra: Record<string, string> = {}) => ({
  ...process.env,
  CA_HEAVY_QUEUE_DIR: queue,
  CA_HEAVY_QUEUE_SLOTS: '1',
  CA_HEAVY_QUEUE_POLL: '0.1',
  HQ_HELD_TICKET: '',
  CA_HEAVY_QUEUE: 'on',
  // The load hold has its own tests (tests/operations/heavy-queue.test.mjs); here slots alone decide.
  CA_HEAVY_QUEUE_LOAD_CEILING: '0',
  ...extra,
});

const run = (args: string[], extra: Record<string, string> = {}) =>
  spawnSync('bash', [cli, ...args], { encoding: 'utf8', env: env(extra), cwd: dir });

const runAsync = (label: string, script: string, extra: Record<string, string> = {}) =>
  new Promise<{ code: number | null; stderr: string }>((done) => {
    const child = spawn('bash', [cli, 'run', '--label', label, '--', 'bash', '-c', script], {
      env: env(extra),
      cwd: dir,
    });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => done({ code, stderr }));
  });

const tickets = () =>
  existsSync(join(queue, 'tickets')) ? readdirSync(join(queue, 'tickets')) : [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (pred: () => boolean, ms = 20_000) => {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await sleep(50);
  }
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'heavy-queue-'));
  queue = join(dir, 'queue');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('heavy-job queue', () => {
  it('admits at most SLOTS jobs at once, in FIFO order, and frees the slot after each', async () => {
    const log = join(dir, 'log');
    const gate = join(dir, 'gate');
    const job = (name: string) =>
      `echo "start ${name}" >> ${log}; while [ ! -f ${gate} ]; do sleep 0.05; done; echo "end ${name}" >> ${log}`;
    const a = runAsync('A', job('A'));
    await waitFor(() => existsSync(log) && readFileSync(log, 'utf8').includes('start A'));
    const b = runAsync('B', job('B'));
    await waitFor(() => tickets().filter((t) => !t.endsWith('.run')).length === 2);
    const c = runAsync('C', job('C'));
    await waitFor(() => tickets().filter((t) => !t.endsWith('.run')).length === 3);

    const status = run(['status']);
    expect(status.stdout).toMatch(/RUNNING .* A /);
    expect(status.stdout).toMatch(/WAITING .* B /);
    expect(status.stdout).toMatch(/WAITING .* C /);
    expect(status.stdout).toContain('running 1, waiting 2, stale 0');

    await sleep(500);
    expect(readFileSync(log, 'utf8')).toBe('start A\n');
    writeFileSync(gate, '');
    const results = await Promise.all([a, b, c]);
    expect(results.map((r) => r.code)).toEqual([0, 0, 0]);
    expect(readFileSync(log, 'utf8')).toBe('start A\nend A\nstart B\nend B\nstart C\nend C\n');
    expect(tickets()).toEqual([]);
  });

  it('runs two jobs together when two slots exist', async () => {
    const log = join(dir, 'log');
    const gate = join(dir, 'gate');
    const job = (name: string) =>
      `echo "start ${name}" >> ${log}; while [ ! -f ${gate} ]; do sleep 0.05; done`;
    const a = runAsync('A', job('A'), { CA_HEAVY_QUEUE_SLOTS: '2' });
    const b = runAsync('B', job('B'), { CA_HEAVY_QUEUE_SLOTS: '2' });
    await waitFor(() => existsSync(log) && readFileSync(log, 'utf8').split('\n').length === 3);
    writeFileSync(gate, '');
    expect((await Promise.all([a, b])).map((r) => r.code)).toEqual([0, 0]);
  });

  it('recovers a slot whose holder process is gone', () => {
    mkdirSync(join(queue, 'tickets'), { recursive: true });
    writeFileSync(join(queue, 'tickets', '000000000001'), 'pid=999999\nstart=\nlabel=ghost\n');
    writeFileSync(join(queue, 'tickets', '000000000001.run'), '1');
    writeFileSync(join(queue, 'seq'), '1\n');
    const r = run(['run', '--', 'echo', 'ran']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('ran\n');
    expect(r.stderr).toContain('recovered a stale slot: ticket 000000000001 (ghost, pid 999999)');
    expect(tickets()).toEqual([]);
  });

  it('treats a live pid that now belongs to a later process as stale', () => {
    mkdirSync(join(queue, 'tickets'), { recursive: true });
    writeFileSync(
      join(queue, 'tickets', '000000000001'),
      `pid=${process.pid}\nstart=Mon Jan 1 00:00:00 2001\nlabel=reused\n`
    );
    writeFileSync(join(queue, 'seq'), '1\n');
    const r = run(['run', '--', 'true']);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('recovered a stale slot');
  });

  it('keeps a live holder and does not run past it', async () => {
    mkdirSync(join(queue, 'tickets'), { recursive: true });
    const start = spawnSync('ps', ['-o', 'lstart=', '-p', String(process.pid)], {
      encoding: 'utf8',
    })
      .stdout.trim()
      .replace(/\s+/g, ' ');
    writeFileSync(
      join(queue, 'tickets', '000000000001'),
      `pid=${process.pid}\nstart=${start}\nlabel=holder\n`
    );
    writeFileSync(join(queue, 'seq'), '1\n');
    const r = run(['run', '--', 'echo', 'ran'], { CA_HEAVY_QUEUE_MAX_WAIT: '1' });
    // It waited the whole budget, said so, and only then ran (fail open on time).
    expect(r.stderr).toContain('waiting for a heavy-job slot');
    expect(r.stderr).toContain('CA_HEAVY_QUEUE_MAX_WAIT');
    expect(r.stdout).toBe('ran\n');
    expect(tickets()).toEqual(['000000000001']);
  });

  it('fails open with a warning when the queue cannot be used, and keeps the exit code', () => {
    const blocker = join(dir, 'not-a-directory');
    writeFileSync(blocker, '');
    const r = run(['run', '--', 'bash', '-c', 'echo still-ran; exit 7'], {
      CA_HEAVY_QUEUE_DIR: blocker,
    });
    expect(r.status).toBe(7);
    expect(r.stdout).toBe('still-ran\n');
    expect(r.stderr).toContain('WARNING: the heavy-job queue is unavailable');
    expect(r.stderr).toContain('No check is skipped');
  });

  it('returns the command exit code and leaves no ticket behind', () => {
    const r = run(['run', '--', 'bash', '-c', 'exit 3']);
    expect(r.status).toBe(3);
    expect(tickets()).toEqual([]);
  });

  it('a nested acquire under a held slot is a no-op (a push never takes two slots)', () => {
    const r = spawnSync(
      'bash',
      [
        '-c',
        `. ${lib}; hq_acquire outer; echo "outer=$HQ_STATE"; ` +
          `bash -c '. ${lib}; hq_acquire inner; echo "inner=$HQ_STATE"'; ` +
          `ls "$CA_HEAVY_QUEUE_DIR/tickets" | grep -vc run; hq_release; ls "$CA_HEAVY_QUEUE_DIR/tickets" | wc -l`,
      ],
      { encoding: 'utf8', env: env() }
    );
    expect(r.stdout.split('\n').map((l) => l.trim())).toEqual([
      'outer=admitted',
      'inner=nested',
      '1',
      '0',
      '',
    ]);
  });

  it('derives slots from the core count (cores / 7, at least 2) unless told', () => {
    const slots = (extra: Record<string, string>) =>
      spawnSync('bash', ['-c', `. ${lib}; hq_slots`], {
        encoding: 'utf8',
        env: env(extra),
      }).stdout.trim();
    expect(slots({ CA_HEAVY_QUEUE_SLOTS: '3' })).toBe('3');
    const cores = Number(
      spawnSync('bash', ['-c', `. ${lib}; hq_cores`], {
        encoding: 'utf8',
        env: env(),
      }).stdout.trim()
    );
    const derived = Number(slots({ CA_HEAVY_QUEUE_SLOTS: '' }));
    expect(derived).toBe(Math.max(2, Math.floor(cores / 7)));
  });

  it('outside a Club Arena clone the queue is the one fixed boot-disk folder, whatever the .env says, so every repository shares one line', () => {
    const home = join(dir, 'home');
    const ssd = join(dir, 'ssd-shared');
    mkdirSync(join(home, 'Documents', 'club-arena'), { recursive: true });
    mkdirSync(ssd, { recursive: true });
    writeFileSync(
      join(home, 'Documents', 'club-arena', '.env'),
      `AGENT_SSD_USE_AUTHORIZED=true\nSSD1_WORK_SHARED_DIR=${ssd}\nSECRET_TOKEN=never-read\n`
    );
    const outside = join(dir, 'not-a-repo');
    mkdirSync(outside);
    const r = spawnSync('bash', ['-c', `. ${lib}; hq_dir`], {
      encoding: 'utf8',
      cwd: outside,
      env: { ...env(), HOME: home, CA_HEAVY_QUEUE_DIR: '', GIT_CEILING_DIRECTORIES: dir },
    });
    expect(r.stdout.trim()).toBe(join(home, '.cache', 'club-arena-heavy-queue'));
  });

  it('reads only the SSD variables it names from the main clone .env (legacy queue folders), and never sources it', () => {
    const text = readFileSync(lib, 'utf8');
    expect(text).not.toMatch(/^\s*(\.|source)\s+[^\n]*\.env/m);
    for (const name of ['SSD1_WORK_SHARED_DIR', 'SSD2_WORK_DIR']) {
      expect(text).toContain(`hq_env_value ${name}`);
    }
  });
});

describe('heavy-job queue wiring', () => {
  const helper = readFileSync('scripts/agent-push.sh', 'utf8');
  const hook = readFileSync('.husky/pre-push', 'utf8');

  it('agent-push takes a slot for a heavy push before the load wait, and releases it on exit', () => {
    const branch = helper.slice(helper.indexOf('elif [ "$(uname -s)" = Darwin ]; then'));
    expect(branch.indexOf('hq_acquire "agent-push $BRANCH"')).toBeGreaterThan(0);
    expect(branch.indexOf('hq_acquire')).toBeLessThan(branch.indexOf('while [ "$cores" -gt 0 ]'));
    expect(helper).toMatch(/trap '[^']*hq_release[^']*' EXIT/);
  });

  it('the hook queues before every suite it starts and releases in its exit handler', () => {
    const slot = hook.indexOf('ca_heavy_slot() {');
    expect(slot).toBeGreaterThan(0);
    for (const suite of [
      '"$VITEST" run $CHANGED_TESTS',
      '"$SERVER_TSC" --noEmit',
      '"$SERVER_VITEST" run $SRV_TESTS',
    ]) {
      const at = hook.indexOf(suite);
      expect(at).toBeGreaterThan(slot);
      expect(hook.lastIndexOf('ca_heavy_slot', at)).toBeGreaterThan(slot);
    }
    expect(hook).toMatch(/policy_precheck_result\(\) \{[\s\S]*?hq_release[\s\S]*?\n\}/);
  });

  it('the queue never disables or skips a check', () => {
    for (const text of [readFileSync(lib, 'utf8'), readFileSync(cli, 'utf8')]) {
      expect(text).not.toContain('--no-verify');
      expect(text).not.toMatch(/\bexit 0\b/);
    }
    for (const text of [helper, hook]) {
      expect(text).not.toMatch(/CA_HEAVY_QUEUE=off/);
      expect(text).not.toMatch(/git [^\n]*--no-verify/);
    }
  });
});
