/**
 * LAW (2026-11-26): the Backup certifies what can ship, and the install
 * window's last install starts one certification.
 *
 * On 2026-11-25 a migration merged outside the post-cutover install window sat
 * uninstalled on main for up to 150 minutes. The O7 guard deferred every push
 * run whose commit carried it, so every later push was uncertifiable until the
 * next window, while the last certifiable build (c951436a6ead) lost its own run
 * to supersession and had to be dispatched by hand (45759269821, runbook 3.5).
 * Nothing certified again after a window's installs completed either: the
 * 10:15Z and 19:10Z installs left b7948ca90719 stale for good.
 *
 *   1. A run whose target carries an uninstalled migration certifies the newest
 *      first-parent server commit behind it that carries none, when that commit
 *      is ahead of the serving engine; its control stays the run's own commit.
 *      A target that carries none of the pending files is not deferred at all.
 *      Anything unreadable defers exactly as before.
 *   2. A successful dispatcher install of apply-merged-migration.yml starts a
 *      Backup run (workflow_run); it plans only when no other install run is
 *      still going and no newer after-install run exists, and certifies main's
 *      newest server commit. Stage admits its success as an election trigger.
 *
 * Every scenario runs the workflow's own shell with gh, ssh, curl and the
 * provider replaced by local functions; git is real, on a disposable repository.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const backupText = read('.github/workflows/backup-engine.yml');
const backup = parse(backupText);
const stage = parse(read('.github/workflows/stage-engine-release.yml'));
const planJob = backup.jobs.plan;
const refresh = backup.jobs.refresh;
const stepOf = (job: any, id: string) => job.steps.find((s: any) => s.id === id);
const plan = stepOf(planJob, 'plan');
const due = stepOf(refresh, 'due');
const run = (step: any): string => String(step?.run ?? 'echo "step missing on this tree"; exit 97');

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
function shell(script: string, env: NodeJS.ProcessEnv, cwd: string) {
  const dir = temp('ship-run-');
  const output = resolve(dir, 'github-output');
  const calls = resolve(dir, 'calls');
  const summary = resolve(dir, 'summary.md');
  const result = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    cwd,
    env: {
      ...cleanEnv(),
      HOME: dir,
      RUNNER_TEMP: dir,
      CALLS: calls,
      GITHUB_STEP_SUMMARY: summary,
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_SERVER_URL: 'https://github.example',
      STATUS_CONTEXT: 'backup-engine/certified',
      STANDBY_HOST: '192.0.2.1',
      STANDBY_HOST_KEY: '192.0.2.1 ssh-ed25519 AAAA',
      SSH_KEY: 'fixture-key-not-a-credential',
      ...env,
      GITHUB_OUTPUT: output,
    },
  });
  const text = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
  return { ...result, out: text(output), calls: text(calls), summary: text(summary) };
}

const P = '20261126000707';
/**
 * main: s0 server (SERVING), s1 server, k release control (certifiable),
 * m adds migration P, s2 server, d docs. With `controlAfter`, a release-control
 * commit k2 follows m instead of k preceding it (k2 carries P).
 */
const PREQUAL = `import subprocess
CONTROL_INPUTS = ["scripts/ci/select-daily-engine.py", "server/scripts"]
def projection(sha):
    return subprocess.check_output(["git", "ls-tree", "-r", sha, "--", *CONTROL_INPUTS], text=True)
`;
function repository(controlAfter = false) {
  const dir = temp('ship-repo-');
  const git = (...args: string[]) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: cleanEnv() });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'law@example.invalid');
  git('config', 'user.name', 'law');
  git('config', 'commit.gpgsign', 'false');
  const commit = (path: string, body: string) => {
    mkdirSync(dirname(resolve(dir, path)), { recursive: true });
    writeFileSync(resolve(dir, path), body);
    git('add', '-A');
    git('commit', '-q', '-m', path);
    return git('rev-parse', 'HEAD');
  };
  mkdirSync(resolve(dir, 'scripts/ci'), { recursive: true });
  writeFileSync(resolve(dir, 'scripts/ci/read-engine-prequalification.py'), PREQUAL);
  commit('server/standby/standby-owners.sql', '-- owners\n');
  const s0 = commit('server/src/a.ts', '0\n');
  const s1 = commit('server/src/a.ts', '1\n');
  const k = controlAfter ? '' : commit('scripts/ci/select-daily-engine.py', '# control 2\n');
  const m = commit(`supabase/migrations/${P}_held.sql`, 'select 1;\n');
  const k2 = controlAfter ? commit('scripts/ci/select-daily-engine.py', '# control 3\n') : '';
  const s2 = commit('server/src/a.ts', '2\n');
  const d = commit('docs/x.md', 'x\n');
  return { dir, shas: { s0, s1, k, m, k2, s2, d } };
}
const repo = repository();
const { s0: SERVING, s1, k, m, s2, d } = repo.shas;
const lateControl = repository(true);

function runDue(opts: {
  sha: string;
  control?: string;
  githubSha?: string;
  pending?: string;
  event?: string;
  serving?: string | 'FAIL';
  fakeGit?: boolean;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}) {
  const verdict = `due=true\nproduction=${'a'.repeat(64)}\npending=${opts.pending ?? P}\ncomparable=${'c'.repeat(64)}`;
  const health =
    opts.serving === 'FAIL'
      ? 'return 22'
      : `printf '{"releaseSha":"%s"}' '${opts.serving ?? SERVING}'`;
  const harness = `sha256sum() { echo "0000000000000000000000000000000000000000000000000000000000000000  $1"; }
ssh() {
  echo "ssh $*" >> "$CALLS"
  case "$*" in
    *"python3 - '"*) cat > /dev/null; echo "LEASE_RELEASED" >> "$CALLS" ;;
    *"database.json"*) echo "2026-11-26T07:00:00Z" ;;
    *"schema-evidence.json"*) echo "{}" ;;
  esac
}
curl() { echo "curl $*" >> "$CALLS"; ${health}; }
gh() { echo "gh $*" >> "$CALLS"; return 1; }
python3() {
  if [ "$1" = -B ] && [ "$2" = server/scripts/engine-release-installed-migrations.py ]; then
    echo "refresh-due $*" >> "$CALLS"
    printf '%s\\n' ${verdict
      .split('\n')
      .map((line) => JSON.stringify(line))
      .join(' ')}
    echo "reason=mock contents" >&2
    return 0
  fi
  command python3 "$@"
}
date() { echo "2026-11-26"; }
${opts.fakeGit ? 'git() { echo "2026-11-26T07:00:00Z"; }' : ''}
`;
  return shell(
    harness + run(due),
    {
      DATABASE_URL: 'postgres://fixture',
      MODE: 'auto',
      EVENT: opts.event ?? 'push',
      CONTROL: opts.control ?? opts.sha,
      RUN_ID: '900',
      RUN_ATTEMPT: '1',
      SHA: opts.sha,
      GITHUB_SHA: opts.githubSha ?? opts.sha,
      FREEZE_BASELINE: '',
      PLAN_PRIORITY: '',
      POST_SEAL: '',
      SEALED_SHA: '',
      ...opts.env,
    },
    opts.cwd ?? repo.dir
  );
}

describe('the Backup certifies what can ship (2026-11-26)', () => {
  it('a target carrying an uninstalled migration certifies the newest server or release-control commit behind it that carries none', () => {
    const r = runDue({ sha: s2 });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(
      `RETARGETED TO WHAT CAN SHIP: ${s2} carries uninstalled migration(s) (${P})`
    );
    // The release-control commit k, not the older server commit s1.
    expect(r.stdout).toContain(`certifying ${k}`);
    expect(r.out).toContain(`sha=${k}\n`);
    // The control stays the run's own commit, which the selector admits.
    expect(r.out).toContain(`control_sha=${s2}\n`);
    expect(r.out).not.toContain('deferred=1');
    expect(r.calls).not.toContain('LEASE_RELEASED');
    expect(r.stdout).not.toContain('DEFERRED:');
    expect(r.summary).toContain('RETARGETED TO WHAT CAN SHIP');
  });

  it('a push run whose own commit is the docs commit after it keeps its own commit as control', () => {
    const r = runDue({ sha: d, githubSha: d });
    expect(r.status, r.stderr).toBe(0);
    expect(r.out).toContain(`sha=${k}\n`);
    expect(r.out).toContain(`control_sha=${d}\n`);
  });

  it('a target that carries none of the pending files is certified as planned, never deferred', () => {
    const r = runDue({ sha: k, control: s2, githubSha: s2, event: 'workflow_run' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(`UNINSTALLED BUT NOT CARRIED: ${k} holds none of ${P}`);
    // An older commit with other release controls keeps deferring.
    const older = runDue({ sha: s1, control: s2, githubSha: s2, event: 'workflow_run' });
    expect(older.stdout).toContain(
      `${s1} holds none of ${P} but its release controls differ from ${s2}`
    );
    expect(older.out).toContain('deferred=1');
    expect(r.out).not.toContain('sha=');
    expect(r.out).not.toContain('deferred=1');
    expect(r.calls).not.toContain('LEASE_RELEASED');
  });

  it('a commit whose release controls differ from the control is never a target (2026-11-26, c951436a6ead after #12038)', () => {
    const { s1: old, s2: head } = lateControl.shas;
    const r = runDue({ sha: head, cwd: lateControl.dir });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(
      `the newest commit without the uninstalled files, ${old}, has release controls that differ from ${head}`
    );
    expect(r.stdout).toContain(
      `DEFERRED: ${head} carries uninstalled ordinary migration(s) (${P})`
    );
    expect(r.out).not.toContain(`sha=${old}`);
  });

  it.each([
    ['nothing behind the target is ahead of the serving engine', { serving: k }],
    ['live /health is unreadable', { serving: 'FAIL' as const }],
    ['git cannot read the commits', { fakeGit: true }],
  ])('defers exactly as before when %s', (_label, extra) => {
    const r = runDue({ sha: s2, ...extra });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(`DEFERRED: ${s2} carries uninstalled ordinary migration(s) (${P})`);
    expect(r.out).toContain('deferred=1');
    expect(r.out).not.toContain(`sha=${k}`);
    expect(r.calls).toContain('LEASE_RELEASED');
  });

  it('the commit that adds the migration is never a target, and exempt runs are untouched', () => {
    const r = runDue({ sha: m });
    expect(r.out).toContain(`sha=${k}\n`);
    for (const env of [{ FREEZE_BASELINE: '1' }, { PLAN_PRIORITY: 'booking' }, { MODE: 'force' }]) {
      const exempt = runDue({ sha: s2, env });
      expect(exempt.stdout).not.toContain('RETARGETED TO WHAT CAN SHIP');
      expect(exempt.stdout).not.toContain('DEFERRED:');
      expect(exempt.out).not.toContain('deferred=1');
    }
  });

  it('the retargeted commit and control reach every later reader', () => {
    expect(refresh.outputs.sha).toBe(
      '${{ steps.due.outputs.sha || steps.late_retarget.outputs.sha || needs.plan.outputs.sha }}'
    );
    expect(refresh.outputs.control_sha).toBe(
      '${{ steps.due.outputs.control_sha || steps.late_retarget.outputs.control_sha || needs.plan.outputs.control_sha }}'
    );
    expect(stepOf(refresh, 'late_priority').env.SHA).toBe(
      '${{ steps.due.outputs.sha || steps.late_retarget.outputs.sha || needs.plan.outputs.sha }}'
    );
    // The certify job reads only the refresh job's outputs.
    expect(backup.jobs.certify.env.CONTROL_SHA).toBe(
      '${{ needs.refresh.outputs.control_sha || needs.plan.outputs.control_sha }}'
    );
    // An after-install run already certified for the current set hands back (O10).
    expect(run(due)).toContain(
      '&& { [ "$EVENT" = schedule ] || [ "$EVENT" = push ] || [ "$EVENT" = workflow_run ]; } \\'
    );
  });
});

describe("the install window's last install starts one certification (2026-11-26)", () => {
  function runPlan(replies: { going?: string; newer?: string; head?: string }) {
    const harness = `
gh() {
  echo "gh $*" >> "$CALLS"
  case "$*" in
    *apply-merged-migration.yml/runs*) ${replies.going === undefined ? 'return 1' : `echo ${replies.going}`} ;;
    *backup-engine.yml/runs?event=workflow_run*) ${replies.newer === undefined ? 'return 1' : `echo ${replies.newer}`} ;;
    *"commits?sha="*) ${replies.head === undefined ? 'return 1' : `echo ${replies.head}`} ;;
    *) return 1 ;;
  esac
}
`;
    return shell(
      harness + run(plan),
      {
        EVENT: 'workflow_run',
        INPUT_SHA: '',
        INPUT_REFRESH: '',
        RUN_ID: '900',
        INSTALL_RUN: '800',
        GITHUB_SHA: d,
      },
      repo.dir
    );
  }

  it('listens to Apply Merged Migration completions only, and admits only a successful dispatcher install on main', () => {
    expect(backup.on.workflow_run).toEqual({
      workflows: ['Apply Merged Migration'],
      types: ['completed'],
    });
    for (const clause of [
      "github.event.workflow_run.conclusion == 'success'",
      "github.event.workflow_run.event == 'repository_dispatch'",
      "github.event.workflow_run.path == '.github/workflows/apply-merged-migration.yml'",
      'github.event.workflow_run.head_repository.full_name == github.repository',
      "github.event.workflow_run.head_branch == 'main'",
    ])
      expect(planJob.if).toContain(clause);
    expect(parse(read('.github/workflows/apply-merged-migration.yml')).name).toBe(
      'Apply Merged Migration'
    );
    expect(backup['run-name']).toContain(
      "github.event_name == 'workflow_run' && format('Backup after installs {0}', github.event.workflow_run.id)"
    );
    expect(plan.env.INSTALL_RUN).toBe('${{ github.event.workflow_run.id }}');
    // No timer was added.
    expect(backup.on.schedule).toHaveLength(2);
  });

  it("the window's last install plans main's head with an automatic refresh", () => {
    const r = runPlan({ going: '0', newer: '0', head: s2 });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('AFTER INSTALLS: Apply Merged Migration run 800 was the window');
    // Main's head carries main's release controls; an older server commit may not.
    expect(r.out).toBe(`sha=${d}\nrefresh=auto\n`);
    expect(r.calls).not.toContain('commits?sha=');
    const blind = runPlan({});
    expect(blind.status, blind.stderr).toBe(0);
    expect(blind.out).toBe(`sha=${d}\nrefresh=auto\n`);
  });

  it('plans nothing while another install is still going, or when a newer after-install run exists', () => {
    const going = runPlan({ going: '1', newer: '0', head: s2 });
    expect(going.status, going.stderr).toBe(0);
    expect(going.stdout).toContain('NOT THE LAST INSTALL');
    expect(going.out).toBe('sha=\nrefresh=\n');
    const newer = runPlan({ going: '0', newer: '2', head: s2 });
    expect(newer.stdout).toContain(
      'SUPERSEDED AFTER INSTALLS: 2 newer after-install Backup run(s)'
    );
    expect(newer.out).toBe('sha=\nrefresh=\n');
    expect(refresh.if).toContain("needs.plan.outputs.sha != ''");
  });

  it('Stage admits its successful completion as the next election trigger', () => {
    const clause =
      "(github.event.workflow_run.event == 'workflow_run' && startsWith(github.event.workflow_run.display_title, 'Backup after installs '))";
    expect(stage.jobs.detect.if).toContain(clause);
    expect(stage['run-name']).toContain(clause);
    expect(stage.jobs.detect.if).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(stage.jobs.detect.if).toContain('github.event.workflow_run.run_attempt == 1');
  });

  it('the after-install run is never refused as a job-token dispatch', () => {
    // The refusal applies to workflow_dispatch and repository_dispatch only.
    expect(refresh.if).toContain(
      "!((github.event_name == 'workflow_dispatch' || github.event_name == 'repository_dispatch') && (github.actor == 'github-actions[bot]' || github.triggering_actor == 'github-actions[bot]'))"
    );
    expect(backupText).not.toMatch(/github\.event_name == 'workflow_run' && \(github\.actor/);
  });
});
