/**
 * LAW: A WINDOW MIGRATION'S DOOR IS ADMITTED ONLY ON CONDITION (2026-11-07).
 *
 * At the 04:00 America/Chicago window on 2026-11-07 the Backup Engine had
 * certified e6e26ab8, and Engine Release run 42360536751 refused it at 09:52Z
 * in job engine-doors: fn_cash_session_set_blind_off() and
 * fn_lightning_blind_off_players() did not exist in production. Both are
 * created by 20261106203853_hit_and_run_ten_hands_in_profit.sql, which declares
 * "-- @install-window: daily-maintenance" and so can only install INSIDE the
 * 04:00 freeze. The door check ran eight minutes before the break, so a build
 * calling a door that a queued window migration creates could never pass it:
 * a deadlock in the release order, not a missing migration.
 *
 * What this pins:
 *  1. Before the break, a missing door created by a queued (not in
 *     schema_migrations), not-superseded, byte-identical-to-main window
 *     migration on the exact target is CONDITIONAL - a named third verdict,
 *     never "OK" - and the run continues.
 *  2. A missing door no queued window migration creates is refused exactly as
 *     before, and so is one whose window file is recorded, unknown, or differs
 *     from protected main.
 *  3. Inside the break the host re-reads pg_proc for the target's window
 *     doors after the admission certificate and before the engine lock and
 *     prepare: still missing after this break's install finished, or with no
 *     install job for this break, is a named refusal (the current engine keeps
 *     running); a still-running install, or an install signal that cannot be
 *     read (moved 2026-11-07), waits inside the same certificate budget; a
 *     passed budget refuses by name.
 *  4. The host derives the doors from the target tree with the same extractor
 *     as the pre-break check, and ships the helper in its control generation.
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

// Subprocess contract suite (real node, python and git children): see the
// note in the-engine-ships-only-with-its-doors.law.test.ts on timeouts.
vi.setConfig({ testTimeout: 90_000 });

const root = resolve(__dirname, '..');
const DOORS = resolve(root, 'scripts/ci/check-engine-doors-exist.mjs');
const HELPER = resolve(root, 'server/scripts/engine-release-window-doors.py');
const TRANSACTION = readFileSync(
  resolve(root, 'server/scripts/engine-release-transaction.sh'),
  'utf8'
);
const INSTALLER = readFileSync(
  resolve(root, 'server/scripts/install-engine-supervisor.sh'),
  'utf8'
);
const WORKFLOW = readFileSync(resolve(root, '.github/workflows/auto-deploy-hetzner.yml'), 'utf8');

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
};

const WINDOW_FILE = '20991231000001_creates_the_window_door.sql';
const WINDOW_SQL = `-- ${WINDOW_FILE}
-- @install-window: daily-maintenance
BEGIN;
SET LOCAL lock_timeout = '1s';
CREATE OR REPLACE FUNCTION public.fn_window_door(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
COMMIT;
`;
const SUPERSEDED_FILE = '20991231000002_a_superseded_window_door.sql';
const SUPERSEDED_SQL = `-- SUPERSEDED BY 20991231000003
-- @install-window: daily-maintenance
BEGIN;
CREATE OR REPLACE FUNCTION public.fn_superseded_door() RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
COMMIT;
`;
const SUCCESSOR_FILE = '20991231000003_the_successor.sql';
const ORDINARY_FILE = '20991231000004_an_ordinary_door.sql';

/** A target checkout: engine sources, migrations, and a protected-main ref. */
function target(extra: (dir: string) => void = () => {}) {
  const dir = temp('window-door-target-');
  mkdirSync(join(dir, 'server/src'), { recursive: true });
  mkdirSync(join(dir, 'supabase/migrations'), { recursive: true });
  mkdirSync(join(dir, 'scripts/ci'), { recursive: true });
  writeFileSync(
    join(dir, 'server/src/caller.ts'),
    [
      "await supabase.rpc('fn_window_door', { p });",
      "await supabase.rpc('fn_plain_door');",
      "await supabase.rpc('fn_superseded_door');",
      "await supabase.rpc('fn_allowed_window_door');",
      "// supabase.rpc('fn_only_in_a_comment')",
    ].join('\n')
  );
  writeFileSync(join(dir, 'server/src/caller.test.ts'), "supabase.rpc('fn_test_only_door');");
  writeFileSync(join(dir, 'supabase/migrations', WINDOW_FILE), WINDOW_SQL);
  writeFileSync(join(dir, 'supabase/migrations', SUPERSEDED_FILE), SUPERSEDED_SQL);
  writeFileSync(join(dir, 'supabase/migrations', SUCCESSOR_FILE), '-- successor\nSELECT 1;\n');
  writeFileSync(
    join(dir, 'supabase/migrations', ORDINARY_FILE),
    'BEGIN;\nCREATE FUNCTION public.fn_plain_door() RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;\nCOMMIT;\n'
  );
  writeFileSync(
    join(dir, 'supabase/migrations', '20991231000005_allowed_window_door.sql'),
    '-- @install-window: daily-maintenance\nBEGIN;\nCREATE FUNCTION fn_allowed_window_door() RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;\nCOMMIT;\n'
  );
  writeFileSync(
    join(dir, 'scripts/ci/engine-doors.allowlist.json'),
    JSON.stringify({
      fn_allowed_window_door:
        'Optional door the engine tolerates while absent; fixture reason text.',
    })
  );
  extra(dir);
  // A git hook exports GIT_DIR and friends; inheriting them would point these
  // commands at the repository being pushed instead of the scratch target.
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
  );
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', dir, ...args], {
      env: {
        ...clean,
        GIT_AUTHOR_NAME: 'law',
        GIT_AUTHOR_EMAIL: 'law@example.invalid',
        GIT_COMMITTER_NAME: 'law',
        GIT_COMMITTER_EMAIL: 'law@example.invalid',
      },
      encoding: 'utf8',
    }).trim();
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '--no-gpg-sign', '-m', 'target');
  const sha = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/main', sha);
  return { dir, sha };
}

function doorCheck(
  dir: string,
  opts: { live: string[]; recorded?: unknown; env?: Record<string, string> }
) {
  const files = temp('window-door-fixture-');
  const live = join(files, 'live.json');
  const output = join(files, 'github-output');
  writeFileSync(live, JSON.stringify(opts.live));
  writeFileSync(output, '');
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    ENGINE_DOORS_LIVE_FIXTURE: live,
    GITHUB_OUTPUT: output,
    ...opts.env,
  };
  if (opts.recorded !== undefined) {
    const recorded = join(files, 'recorded.json');
    writeFileSync(recorded, JSON.stringify(opts.recorded));
    env.ENGINE_DOORS_RECORDED_FIXTURE = recorded;
  }
  const res = spawnSync(process.execPath, [DOORS], { cwd: dir, env, encoding: 'utf8' });
  const outputs: Record<string, string> = {};
  for (const line of readFileSync(output, 'utf8').split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) outputs[line.slice(0, at)] = line.slice(at + 1);
  }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, outputs };
}

const ALL = ['fn_window_door', 'fn_plain_door', 'fn_superseded_door', 'fn_allowed_window_door'];

describe('before the break: a queued window migration door is conditional, never OK', () => {
  it('admits a door created by a queued, byte-identical window migration as a named third verdict', () => {
    const { dir } = target();
    const res = doorCheck(dir, {
      live: ALL.filter((n) => n !== 'fn_window_door'),
      recorded: [],
    });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).toContain('::notice title=CONDITIONAL DATABASE DOOR::fn_window_door()');
    expect(res.stdout).toMatch(/^CONDITIONAL - 1 of \d+ database functions/m);
    expect(res.stdout).not.toMatch(/^OK - /m);
    expect(res.outputs.verdict).toBe('conditional');
    expect(res.outputs.conditional).toBe('fn_window_door');
    expect(res.outputs.conditional_migrations).toBe(WINDOW_FILE);
  });

  it('refuses a missing door that no queued window migration creates, exactly as before', () => {
    const { dir } = target();
    const res = doorCheck(dir, {
      live: ALL.filter((n) => n !== 'fn_window_door' && n !== 'fn_plain_door'),
      recorded: [],
    });
    expect(res.status).toBe(1);
    expect(res.stdout).toContain('::error title=MISSING DATABASE DOOR::fn_plain_door()');
    expect(res.stdout).toMatch(
      /1 of \d+ database functions this build calls are missing in production\. Nothing was deployed\./
    );
    expect(res.outputs.verdict).toBe('refused');
    expect(res.outputs.refusal).toBe('missing database function fn_plain_door()');
  });

  it('refuses a door whose only window migration is superseded and never installs', () => {
    const { dir } = target();
    const res = doorCheck(dir, {
      live: ALL.filter((n) => n !== 'fn_superseded_door'),
      recorded: [],
    });
    expect(res.status).toBe(1);
    expect(res.outputs.refusal).toBe('missing database function fn_superseded_door()');
  });

  it('refuses when the window migration is already recorded: the door was installed and is gone', () => {
    const { dir } = target();
    const res = doorCheck(dir, {
      live: ALL.filter((n) => n !== 'fn_window_door'),
      recorded: [{ version: WINDOW_FILE.slice(0, 14), name: 'something_else' }],
    });
    expect(res.status).toBe(1);
    expect(res.stdout).toContain('cannot be admitted on a window condition');
  });

  it('refuses when schema_migrations could not be read: unknown history admits nothing', () => {
    const { dir } = target();
    const res = doorCheck(dir, { live: ALL.filter((n) => n !== 'fn_window_door') });
    expect(res.status).toBe(1);
    expect(res.stdout).toContain('schema_migrations could not be read');
  });

  it('refuses when the window file is not byte-identical to protected main', () => {
    const { dir } = target();
    writeFileSync(join(dir, 'supabase/migrations', WINDOW_FILE), WINDOW_SQL + '-- edited\n');
    const res = doorCheck(dir, { live: ALL.filter((n) => n !== 'fn_window_door'), recorded: [] });
    expect(res.status).toBe(1);
    expect(res.stdout).toContain('not byte-identical to protected main');
  });

  it('refuses when protected main cannot be read at all', () => {
    const { dir } = target();
    const res = doorCheck(dir, {
      live: ALL.filter((n) => n !== 'fn_window_door'),
      recorded: [],
      env: { ENGINE_DOORS_MAIN_REF: 'refs/remotes/origin/no-such-main' },
    });
    expect(res.status).toBe(1);
  });

  it('names a fully proved run as proved', () => {
    const { dir } = target();
    const res = doorCheck(dir, { live: ALL, recorded: [] });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/^OK - all \d+ database functions/m);
    expect(res.outputs.verdict).toBe('proved');
  });

  it('a rollback is never admitted on a window condition', () => {
    const { dir } = target();
    const res = doorCheck(dir, {
      live: ALL.filter((n) => n !== 'fn_window_door'),
      recorded: [],
      env: { ROLLBACK_REQUESTED: 'true' },
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('::warning title=MISSING DATABASE DOOR::fn_window_door()');
    expect(res.outputs.verdict).toBe('rollback');
  });

  it('the receiver fetches protected main for the byte proof and exposes the verdict', () => {
    const job = WORKFLOW.slice(
      WORKFLOW.indexOf('\n  engine-doors:'),
      WORKFLOW.indexOf('\n  deploy:')
    );
    expect(job).toContain("verdict: ${{ steps.doors.outputs.verdict || '' }}");
    expect(job).toContain("conditional: ${{ steps.doors.outputs.conditional || '' }}");
    expect(job).toContain("'+refs/heads/main:refs/remotes/origin/main'");
    expect(job.indexOf('git fetch --no-tags --depth=1 origin')).toBeLessThan(
      job.indexOf('node scripts/ci/check-engine-doors-exist.mjs')
    );
  });
});

function helper(args: string[], env: Record<string, string> = {}) {
  return spawnSync('python3', ['-B', HELPER, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', ...env },
  });
}

/** The door's parameter names as the target defines them (2026-11-07). */
const SIGNATURES = '{"fn_window_door":["p_a"]}';
/** PostgREST's own answer when its schema cache exposes fn_window_door(p_a). */
const EXPOSED = {
  fn_window_door: {
    status: 404,
    body: {
      code: 'PGRST202',
      hint: 'Perhaps you meant to call the function public.fn_window_door(p_a)',
    },
  },
};

function fixtures(catalog: unknown, install?: unknown, cache: unknown = EXPOSED) {
  const dir = temp('window-door-status-');
  const env: Record<string, string> = {};
  env.ENGINE_WINDOW_DOORS_CATALOG_FIXTURE = join(dir, 'catalog.json');
  writeFileSync(env.ENGINE_WINDOW_DOORS_CATALOG_FIXTURE, JSON.stringify(catalog));
  if (install !== undefined) {
    env.ENGINE_WINDOW_DOORS_INSTALL_FIXTURE = join(dir, 'install.json');
    writeFileSync(env.ENGINE_WINDOW_DOORS_INSTALL_FIXTURE, JSON.stringify(install));
  }
  // Every door is exposed by PostgREST unless a case says otherwise; the
  // schema cache cases live in
  // the-engine-can-call-its-window-doors-before-the-cutover.law.test.ts.
  env.ENGINE_WINDOW_DOORS_CACHE_FIXTURE = join(dir, 'cache.json');
  writeFileSync(env.ENGINE_WINDOW_DOORS_CACHE_FIXTURE, JSON.stringify(cache));
  return env;
}

describe('the host derives the window doors from the exact target tree', () => {
  it('lists only engine-called, non-superseded, non-allowlisted window doors', () => {
    const { dir, sha } = target();
    const res = helper(['list', '--repo', dir, '--sha', sha]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout.trim()).toBe('fn_window_door');
  });

  it('is empty when the target has no window door, so no release pays a database read', () => {
    const { dir, sha } = target((d) =>
      writeFileSync(join(d, 'server/src/caller.ts'), "await supabase.rpc('fn_plain_door');")
    );
    const res = helper(['list', '--repo', dir, '--sha', sha]);
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe('');
  });

  it('is UNKNOWN, never empty, when the target cannot be read', () => {
    const { dir } = target();
    const res = helper(['list', '--repo', dir, '--sha', 'f'.repeat(40)]);
    expect(res.status).toBe(3);
  });

  it('agrees with the pre-break extractor on this repository at HEAD', async () => {
    const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' },
    }).trim();
    const res = helper(['list', '--repo', root, '--sha', head]);
    expect(res.status, res.stderr).toBe(0);
    const host = new Set(res.stdout.trim().split(',').filter(Boolean));
    const doors = (await import(DOORS)) as {
      engineDoors: (dir: string) => Map<string, string[]>;
      doorsIn: (src: string) => Set<string>;
    };
    const window = (await import(resolve(root, 'scripts/ci/window-migration-doors.mjs'))) as {
      windowMigrationCreators: (root: string) => Map<string, Set<string>>;
    };
    const called = new Set(doors.engineDoors(resolve(root, 'server/src')).keys());
    const guard = resolve(root, 'server/scripts/retained-original-checkpoint-guard.mjs');
    try {
      for (const name of doors.doorsIn(readFileSync(guard, 'utf8'))) called.add(name);
    } catch {
      /* a target without the guard */
    }
    const allow = JSON.parse(
      readFileSync(resolve(root, 'scripts/ci/engine-doors.allowlist.json'), 'utf8')
    );
    const expected = new Set<string>();
    for (const names of window.windowMigrationCreators(root).values())
      for (const name of names) if (called.has(name) && !(name in allow)) expected.add(name);
    expect([...host].sort()).toEqual([...expected].sort());
    // The two doors that refused e6e26ab8, while their window migration is on main.
    const incident = resolve(
      root,
      'supabase/migrations/20261106203853_hit_and_run_ten_hands_in_profit.sql'
    );
    let declared = false;
    try {
      declared = /^-- @install-window: daily-maintenance$/m.test(readFileSync(incident, 'utf8'));
    } catch {
      declared = false;
    }
    if (declared && called.has('fn_cash_session_set_blind_off'))
      expect(host.has('fn_cash_session_set_blind_off')).toBe(true);
  });
});

describe('inside the break: the window doors are re-read before any cutover', () => {
  it("READY when every door is in pg_proc and PostgREST's schema cache", () => {
    const res = helper(
      [
        'status',
        '--env-file',
        '/nonexistent',
        '--names',
        'fn_window_door',
        '--signatures',
        SIGNATURES,
      ],
      fixtures(['fn_window_door'])
    );
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/^READY - /);
  });

  it("PENDING while this break's window install job is still running", () => {
    const res = helper(
      ['status', '--env-file', '/nonexistent', '--names', 'fn_window_door'],
      fixtures([], { status: 'in_progress', conclusion: null, url: 'u' })
    );
    expect(res.status).toBe(10);
    expect(res.stdout).toMatch(/^PENDING - fn_window_door\(\) not yet in pg_proc/);
  });

  it.each([
    ['failure', 'the install was refused'],
    ['success', 'the install finished but the door is absent'],
  ])('REFUSED when the install finished (%s) and the door is still missing: %s', (conclusion) => {
    const res = helper(
      ['status', '--env-file', '/nonexistent', '--names', 'fn_window_door'],
      fixtures([], { status: 'completed', conclusion, url: 'u' })
    );
    expect(res.status).toBe(1);
    expect(res.stdout).toContain(`window install finished (${conclusion}`);
    expect(res.stdout).toContain('fn_window_door() are still missing from pg_proc');
  });

  it('REFUSED, the plain refusal, when no install job exists for this break', () => {
    const absent = helper(
      ['status', '--env-file', '/nonexistent', '--names', 'fn_window_door'],
      fixtures([], null)
    );
    expect(absent.status).toBe(1);
    expect(absent.stdout).toContain('no window install job exists for this break');
  });

  // MOVED 2026-11-07 (fix/release-window-resilience). An unreadable install
  // signal was REFUSED at once; it is now PENDING, and the break's own clock
  // refuses it by name once the admission certificate no longer holds
  // (refuse_unready_window_doors, pinned below). The signal is an
  // unauthenticated GitHub read (60 requests an hour per address); one
  // rate-limited or dropped read refused a release whose install was still
  // running. Unreadable says nothing about the install (CLAUDE.md 10.86), and
  // the release still never cuts over with a door missing.
  it('PENDING, bounded by the break, when the install signal is unreadable', () => {
    const unreadable = helper(
      ['status', '--env-file', '/nonexistent', '--names', 'fn_window_door'],
      fixtures([], 'unreadable')
    );
    expect(unreadable.status).toBe(10);
    expect(unreadable.stdout).toContain('install signal is unreadable');
    expect(unreadable.stdout).toContain("waiting only within the break's admission budget");
  });

  it('UNKNOWN, not READY and not REFUSED, when pg_proc cannot be read', () => {
    const res = helper(
      ['status', '--env-file', '/nonexistent', '--names', 'fn_window_door'],
      fixtures({ not: 'a list' })
    );
    expect(res.status).toBe(3);
    expect(res.stdout).toMatch(/^UNKNOWN - /);
    const noEnv = helper(['status', '--env-file', '/nonexistent', '--names', 'fn_window_door']);
    expect(noEnv.status).toBe(3);
  });

  /** The transaction's own window_doors_ready, executed with the real helper. */
  function gate(env: Record<string, string>) {
    const start = TRANSACTION.indexOf('window_doors_ready() {');
    const end = TRANSACTION.indexOf('\n}\n', start) + 3;
    const script = [
      'set -Eeuo pipefail',
      'die() { echo "[engine-release-transaction] FATAL: $*" >&2; exit 1; }',
      TRANSACTION.slice(start, end),
      'rc=0; window_doors_ready || rc=$?; echo "rc=$rc ready=$WINDOW_DOORS_READY waiting=$WINDOW_DOORS_WAITING"',
    ].join('\n');
    return spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        WINDOW_DOORS: HELPER,
        ENV_FILE: '/nonexistent',
        WINDOW_DOOR_NAMES: 'fn_window_door',
        WINDOW_DOOR_SIGNATURES: SIGNATURES,
        WINDOW_DOORS_READY: '0',
        WINDOW_DOORS_WAITING: '0',
        ...env,
      },
    });
  }

  it('the in-break gate refuses by name when the door is still missing after the install', () => {
    const res = gate(fixtures([], { status: 'completed', conclusion: 'failure', url: 'u' }));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('FATAL: WINDOW MIGRATION DOORS REFUSED: REFUSED - ');
    expect(res.stderr).toContain('the current engine keeps running');
  });

  it('the in-break gate waits (10) while the install runs, and opens once the door exists', () => {
    const waiting = gate(fixtures([], { status: 'in_progress', conclusion: null, url: 'u' }));
    expect(waiting.status).toBe(0);
    expect(waiting.stdout).toContain('rc=10 ready=0 waiting=1');
    const ready = gate(fixtures(['fn_window_door']));
    expect(ready.stdout).toContain('rc=0 ready=1');
  });

  it('the in-break gate refuses an unreadable pg_proc as UNKNOWN, never as ready', () => {
    const res = gate(fixtures({ not: 'a list' }));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('WINDOW MIGRATION DOORS REFUSED: UNKNOWN (status 3)');
  });

  it('runs after the break admits the release and before the lock, prepare and replacement', () => {
    const admit = TRANSACTION.indexOf(
      'BREAK_REMAINING_MS="$(maintenance_certificate "$ADMISSION_MIN_BREAK_MS")"'
    );
    // The certificate loop: the one that holds the admission read.
    const loop = TRANSACTION.lastIndexOf('\nwhile :; do\n', admit);
    const check = TRANSACTION.indexOf('window_doors_ready || WINDOW_DOORS_RC=$?', loop);
    const lock = TRANSACTION.indexOf("acquire_engine_lock 'maintenance cutover'", loop);
    const prepare = TRANSACTION.indexOf('"$RELEASE_SEAL" prepare', loop);
    const replace = TRANSACTION.indexOf('"$ENGINE_UP" 3<<<"$TOKEN"', loop);
    expect(loop).toBeGreaterThan(0);
    expect(admit).toBeGreaterThan(loop);
    expect(check).toBeGreaterThan(admit);
    expect(lock).toBeGreaterThan(check);
    expect(prepare).toBeGreaterThan(lock);
    expect(replace).toBeGreaterThan(prepare);
    // The list is derived from the exact target before the loop, not taken from a request.
    const list = TRANSACTION.indexOf('"$WINDOW_DOORS" list --repo "$REPO_DIR" --sha "$SHA"');
    expect(list).toBeGreaterThan(0);
    expect(list).toBeLessThan(loop);
  });

  it('a passed certificate budget while still waiting is a named refusal, not a silent wait', () => {
    const loop = TRANSACTION.slice(
      TRANSACTION.lastIndexOf(
        '\nwhile :; do\n',
        TRANSACTION.indexOf('maintenance_certificate "$ADMISSION_MIN_BREAK_MS"')
      )
    );
    expect(loop).toMatch(
      /elif \[ "\$CERTIFICATE_RC" -eq 2 \]; then\n\s+refuse_unready_window_doors\n/
    );
    expect(loop).toMatch(
      /\[ "\$CERTIFICATE_RC" -ne 0 \]; then\n\s+refuse_unready_window_doors\n\s+request_recovery_window/
    );
    expect(TRANSACTION).toContain(
      "the break's cutover budget passed while $WINDOW_DOOR_NAMES were not all in pg_proc and PostgREST's schema cache"
    );
  });

  it('ships the helper in every control generation and syntax-checks it', () => {
    const files = /\nREQUIRED_FILES=\(\n([\s\S]*?)\n\)\n/.exec(INSTALLER)?.[1] ?? '';
    expect(files.split('\n').map((l) => l.trim())).toContain('engine-release-window-doors.py');
    expect(INSTALLER).toMatch(
      /for script in engine-release-seal\.py[\s\S]*?engine-release-window-doors\.py[\s\S]*?; do\n\s+python3 -c 'compile/
    );
    expect(TRANSACTION).toContain('WINDOW_DOORS="$CONTROL_DIR/engine-release-window-doors.py"');
  });

  it('the receipt names a host window-door refusal in the failed stage', () => {
    expect(WORKFLOW).toContain('s/.*FATAL: WINDOW MIGRATION DOORS REFUSED: //p');
    expect(WORKFLOW).toContain(
      'echo "failed_stage=$RELEASE_STAGE (exit $rc): window migration doors refused: $doors" >> "$GITHUB_OUTPUT"'
    );
  });
});
