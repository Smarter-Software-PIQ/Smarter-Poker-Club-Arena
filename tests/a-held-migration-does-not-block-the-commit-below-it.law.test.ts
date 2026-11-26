/**
 * LAW (2026-11-26, O29): a held migration does not block the commit below it.
 *
 * On 2026-11-25 22:54 CST (04:54Z on the 26th) main gained 6f062e8f0d1d, which
 * adds migration 20261126021630. It merged inside the migration hold before
 * the 01:00 CST cycle and the nightly release schema freeze, so it could not
 * install until 04:15 CST. Backup run 45758112198 answered the O7 rule,
 * "DEFERRED ... carries uninstalled ordinary migration(s)", and handed the
 * host back. One commit below sat a5e971803865: current release controls,
 * nothing uninstalled, ahead of the serving build. Nothing certified it, the
 * 01:00 CST cycle kept serving, and for more than five hours no commit on
 * main could be certified.
 *
 * Before the hand-back the `due` step now asks once for the newest shippable
 * commit below the held migration and certifies that instead. No fallback, or
 * any answer it could not read, is exactly the old hand-back.
 *
 * The scenarios run the workflow's own shell on a disposable git repository
 * with the real step-down script, the real release-control reader and the
 * real installed-migrations reader; ssh, gh, production and /health are local.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const backup = parse(read('.github/workflows/backup-engine.yml'));
const refresh = backup.jobs.refresh;
const certify = backup.jobs.certify;
const due = refresh.steps.find((s: any) => s.id === 'due');
const SCRIPT = 'scripts/release/step-down-past-held-migration.py';
const HELD = '20261126021630';

const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});
function temp(prefix: string) {
  const dir = mkdtempSync(resolve(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

type Fixture = { repo: string; production: string; health: string; shas: Record<string, string> };

function fixture(controlMovesWithMigration = false): Fixture {
  const dir = temp('o29-law-');
  const repo = resolve(dir, 'repo');
  mkdirSync(repo);
  const git = (...args: string[]) => {
    const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: cleanEnv() });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const commit = (message: string, files: Record<string, string>) => {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(resolve(repo, name)), { recursive: true });
      writeFileSync(resolve(repo, name), text);
    }
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'O29 fixture');
  git('config', 'commit.gpgsign', 'false');
  const stage = '.github/workflows/stage-engine-release.yml';
  const shas: Record<string, string> = {};
  shas.serving = commit('serving build', { 'server/src/a.ts': 'a\n', [stage]: 'v1\n' });
  shas.server = commit('engine change', { 'server/src/a.ts': 'b\n' });
  shas.control = controlMovesWithMigration
    ? shas.server
    : commit('release control change', { [stage]: 'v2\n' });
  shas.migration = commit('fix with a migration', {
    [`supabase/migrations/${HELD}_fix.sql`]: 'SELECT 1;\n',
    ...(controlMovesWithMigration ? { [stage]: 'v2\n' } : {}),
  });
  shas.docs = commit('docs only', { 'docs/note.md': 'n\n' });
  // Production's saved rows: one old installed migration, the held one absent.
  const signatures = spawnSync(
    'python3',
    [
      '-B',
      '-c',
      'import importlib.util,json,sys;s=importlib.util.spec_from_file_location("se",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps({"migrations":[["20260101000000","fixture"]],"functions":{k:k for k in m.SIGNATURES}}))',
      resolve(ROOT, 'server/standby/schema-evidence.py'),
    ],
    { encoding: 'utf8' }
  );
  const production = resolve(dir, 'production.json');
  writeFileSync(production, signatures.stdout);
  const health = resolve(dir, 'health.json');
  writeFileSync(health, JSON.stringify({ running: true, releaseSha: shas.serving }));
  return { repo, production, health: pathToFileURL(health).href, shas };
}

// The step's two readers run for real from this checkout, against the saved
// production rows; its bounded waits are shortened to one second.
const HARNESS = `sha256sum() { echo "0000000000000000000000000000000000000000000000000000000000000000  $1"; }
ssh() {
  echo "ssh $*" >> "$CALLS"
  case "$*" in
    *"python3 - '"*) cat > /dev/null; echo "LEASE_RELEASED" >> "$CALLS" ;;
    *"restoredAt"*) echo "2026-11-26T04:00:00Z" ;;
    *) echo "" ;;
  esac
}
gh() { echo "gh $*" >> "$CALLS"; return 1; }
curl() { echo "curl $*" >> "$CALLS"; return 1; }
python3() {
  if [ "\${1:-}" = -B ] && [ "\${2:-}" = ${SCRIPT} ]; then
    shift 2
    command python3 -B "$LAW_ROOT/${SCRIPT}" "$@" --prequal "$LAW_ROOT/scripts/ci/read-engine-prequalification.py" \\
      --installed-tool "$LAW_ROOT/server/scripts/engine-release-installed-migrations.py" \\
      --production "$PRODUCTION" --health-url "$HEALTH_URL"
    return
  fi
  if [ "\${1:-}" = -B ] && [ "\${2:-}" = server/scripts/engine-release-installed-migrations.py ]; then
    shift 2
    local args=() previous=''
    for arg in "$@"; do
      if [ "$previous" = --wait ]; then args+=(1); else args+=("$arg"); fi
      previous="$arg"
    done
    echo "refresh-due \${args[*]}" >> "$CALLS"
    command python3 -B "$LAW_ROOT/server/scripts/engine-release-installed-migrations.py" "\${args[@]}" --production "$PRODUCTION"
    return
  fi
  command python3 "$@"
}
`;

function runDue(f: Fixture, env: Record<string, string>) {
  const dir = temp('o29-run-');
  const output = resolve(dir, 'github-output');
  const calls = resolve(dir, 'calls');
  const summary = resolve(dir, 'summary.md');
  const result = spawnSync('bash', ['-c', HARNESS + String(due.run)], {
    encoding: 'utf8',
    cwd: f.repo,
    env: {
      ...cleanEnv(),
      HOME: dir,
      CALLS: calls,
      LAW_ROOT: ROOT,
      PRODUCTION: f.production,
      HEALTH_URL: f.health,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      SSH_KEY: 'fixture-key-not-a-credential',
      STANDBY_HOST: '192.0.2.1',
      STANDBY_HOST_KEY: '192.0.2.1 ssh-ed25519 AAAA',
      STATUS_CONTEXT: 'backup-engine/certified',
      DATABASE_URL: 'postgres://fixture',
      GITHUB_REPOSITORY: 'fixture/repo',
      MODE: 'auto',
      EVENT: 'push',
      RUN_ID: '888',
      RUN_ATTEMPT: '1',
      FREEZE_BASELINE: '',
      PLAN_PRIORITY: 'none',
      POST_SEAL: '',
      SEALED_SHA: '',
      INPUT_SHA: '',
      AFTER_CYCLE: '',
      ...env,
    },
  });
  const text = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
  return { ...result, out: text(output), calls: text(calls), summary: text(summary) };
}

describe('a held migration does not block the commit below it (O29)', () => {
  it('the decision logic passes its own offline cases on a real git repository', () => {
    const r = spawnSync(
      'python3',
      ['-B', resolve(ROOT, 'tests/operations/step-down-past-held-migration.test.py')],
      { encoding: 'utf8', env: cleanEnv() }
    );
    expect(r.status, r.stderr).toBe(0);
  }, 120_000);

  it('the due step asks the step-down script once, and every later consumer prefers its answer', () => {
    const run = String(due.run);
    expect(run.split(`python3 -B ${SCRIPT}`).length - 1).toBe(1);
    expect(run).toContain('--producer "${GITHUB_SHA:-}"');
    expect(run).toContain('--input-sha "${INPUT_SHA:-}"');
    // The step-down is tried before the hand-back, never after it.
    expect(run.indexOf(`python3 -B ${SCRIPT}`)).toBeLessThan(run.indexOf('DEFERRED: $SHA carries'));
    expect(run).toContain('echo "sha=$fallback" >> "$GITHUB_OUTPUT"');
    expect(due.env.INPUT_SHA).toBe('${{ github.event.inputs.sha }}');
    expect(due.env.AFTER_CYCLE).toBe('${{ github.event.inputs.after_cycle }}');
    // The control is never moved: the selector's producer provenance depends on it.
    expect(run).not.toMatch(/control_sha=.*GITHUB_OUTPUT/);
    const preferred =
      '${{ steps.due.outputs.sha || steps.late_retarget.outputs.sha || needs.plan.outputs.sha }}';
    expect(refresh.outputs.sha).toBe(preferred);
    expect(refresh.steps.find((s: any) => s.id === 'late_priority').env.SHA).toBe(preferred);
    // Certify reads the refresh job's sha for its pending mark, policy, soak, artifact and verdict.
    const fromRefresh = JSON.stringify(certify).split(
      'needs.refresh.outputs.sha || needs.plan.outputs.sha'
    );
    expect(fromRefresh.length - 1).toBeGreaterThanOrEqual(5);
    // The refresh job's sparse checkout holds the script it runs.
    const checkout = refresh.steps.find((s: any) =>
      String(s.uses ?? '').startsWith('actions/checkout')
    );
    expect(String(checkout.with['sparse-checkout']).split('\n')).toContain(SCRIPT);
    // No new trigger, timer or dispatch came with it.
    expect(run).not.toMatch(/gh workflow run|\/dispatches/);
  });

  it("tonight's shape: the push run of the migration commit certifies the release-control commit below it", () => {
    const f = fixture();
    const { migration, control } = f.shas;
    const r = runDue(f, { SHA: migration, CONTROL: migration, GITHUB_SHA: migration });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(
      `STEPPED DOWN: ${migration} carries held migration(s) (${HELD}) not installed until the dispatcher's window; certifying ${control}, the newest shippable commit below it.`
    );
    expect(r.out).toContain(`sha=${control}\n`);
    expect(r.out).toMatch(/^due=true$/m);
    expect(r.out).not.toContain('deferred=1');
    expect(r.stdout).not.toContain('DEFERRED:');
    expect(r.calls).not.toContain('LEASE_RELEASED');
    expect(r.summary).toContain(`STEPPED DOWN \`${migration}\` -> \`${control}\``);
    // The copy is judged again for the commit that will be certified, with the run's own control.
    expect(r.calls).toContain(`--control ${migration} --sha ${control}`);
  }, 60_000);

  it('a post-seal run whose target already sits below the held migration certifies that target', () => {
    const f = fixture();
    const { serving, control, docs } = f.shas;
    const r = runDue(f, {
      EVENT: 'repository_dispatch',
      MODE: 'force',
      POST_SEAL: '1',
      SEALED_SHA: serving,
      SHA: control,
      CONTROL: docs,
      GITHUB_SHA: docs,
      HEALTH_URL: 'file:///nonexistent-o29-health.json',
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(`NOT HELD: migration(s) (${HELD})`);
    expect(r.out).toContain(`sha=${control}\n`);
    expect(r.out).not.toContain('deferred=1');
    expect(r.calls).not.toContain('LEASE_RELEASED');
  }, 60_000);

  it('a Backup after keep-serving run steps down; with an explicit sha it certifies exactly that sha', () => {
    const f = fixture();
    const { control, docs, migration } = f.shas;
    const after = runDue(f, {
      EVENT: 'workflow_dispatch',
      MODE: 'force',
      AFTER_CYCLE: '2026-11-26T01',
      SHA: docs,
      CONTROL: docs,
      GITHUB_SHA: docs,
    });
    expect(after.status, after.stderr).toBe(0);
    expect(after.stdout).toContain(`STEPPED DOWN: ${docs} carries held migration(s) (${HELD})`);
    expect(after.out).toContain(`sha=${control}\n`);
    for (const env of [
      { AFTER_CYCLE: '2026-11-26T01', INPUT_SHA: migration },
      { AFTER_CYCLE: '', INPUT_SHA: '' },
      { AFTER_CYCLE: '', INPUT_SHA: migration },
    ]) {
      const exact = runDue(f, {
        EVENT: 'workflow_dispatch',
        MODE: 'force',
        SHA: migration,
        CONTROL: docs,
        GITHUB_SHA: docs,
        ...env,
      });
      expect(exact.status, exact.stderr).toBe(0);
      expect(exact.stdout).not.toContain('STEPPED DOWN');
      expect(exact.stdout).not.toContain('NOT HELD');
      expect(exact.stdout).not.toContain('DEFERRED:');
      expect(exact.out).not.toMatch(/^sha=/m);
      expect(exact.out).not.toContain('deferred=1');
    }
  }, 120_000);

  it('no shippable commit below: a push run hands back exactly as before and says why', () => {
    const f = fixture(true);
    const { migration, docs } = f.shas;
    const r = runDue(f, { SHA: migration, CONTROL: migration, GITHUB_SHA: migration });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(
      `DEFERRED: ${migration} carries uninstalled ordinary migration(s) (${HELD}) still absent from production after wait; certifying on a copy lacking them can never be selected. Host handed back cleanly, no status written. No commit below was certified:`
    );
    expect(r.stdout).toContain('release controls that differ');
    expect(r.out).toContain('deferred=1');
    expect(r.out).not.toMatch(/^sha=/m);
    expect(r.calls).toContain('LEASE_RELEASED');
    // The keep-serving run in the same position certifies main exactly as before.
    const after = runDue(f, {
      EVENT: 'workflow_dispatch',
      MODE: 'force',
      AFTER_CYCLE: '2026-11-26T01',
      SHA: docs,
      CONTROL: docs,
      GITHUB_SHA: docs,
    });
    expect(after.status, after.stderr).toBe(0);
    expect(after.stdout).toContain(`KEEP-SERVING BACKUP NOT STEPPED DOWN: ${docs}`);
    expect(after.out).not.toContain('deferred=1');
    expect(after.out).not.toMatch(/^sha=/m);
    expect(after.calls).not.toContain('LEASE_RELEASED');
  }, 120_000);

  it('could not tell is never a step down: an unreadable serving build or a retargeted run hands back', () => {
    const f = fixture();
    const { migration, docs } = f.shas;
    const blind = runDue(f, {
      SHA: migration,
      CONTROL: migration,
      GITHUB_SHA: migration,
      HEALTH_URL: 'file:///nonexistent-o29-health.json',
    });
    expect(blind.status, blind.stderr).toBe(0);
    expect(blind.stdout).toContain(`DEFERRED: ${migration} carries`);
    expect(blind.stdout).toContain(
      'No commit below was certified: could not tell (the serving build could not be read) (CLAUDE.md 10.86).'
    );
    expect(blind.out).toContain('deferred=1');
    expect(blind.out).not.toMatch(/^sha=/m);
    // A retargeted run's control is not its own commit: the selector would refuse the certificate.
    const retargeted = runDue(f, { SHA: docs, CONTROL: docs, GITHUB_SHA: migration });
    expect(retargeted.status, retargeted.stderr).toBe(0);
    expect(retargeted.stdout).toContain(`DEFERRED: ${docs} carries`);
    expect(retargeted.stdout).toContain('retargeted');
    expect(retargeted.out).toContain('deferred=1');
    expect(retargeted.out).not.toMatch(/^sha=/m);
  }, 120_000);

  it('the freeze baseline, a booking and a forced push are still exempt from both rules', () => {
    const f = fixture();
    const { migration } = f.shas;
    for (const env of [{ FREEZE_BASELINE: '1' }, { PLAN_PRIORITY: 'booking' }, { MODE: 'force' }]) {
      const r = runDue(f, { SHA: migration, CONTROL: migration, GITHUB_SHA: migration, ...env });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).not.toContain('STEPPED DOWN');
      expect(r.stdout).not.toContain('DEFERRED:');
      expect(r.out).not.toMatch(/^sha=/m);
      expect(r.out).not.toContain('deferred=1');
    }
  }, 120_000);

  it('the step-down script stays outside the release-control projection and is documented', () => {
    const prequal = read('scripts/ci/read-engine-prequalification.py');
    const inputs = prequal.slice(
      prequal.indexOf('CONTROL_INPUTS = ['),
      prequal.indexOf(']', prequal.indexOf('CONTROL_INPUTS = ['))
    );
    expect(inputs).not.toContain('scripts/release');
    expect(read('docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md')).toContain(
      '## A Held Migration Does Not Block The Commit Below It (O29, 2026-11-26)'
    );
  });
});
