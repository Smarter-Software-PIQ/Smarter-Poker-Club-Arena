/**
 * LAW (2026-11-24, O24): the Backup run that answers a seal certifies the NEXT
 * candidate, not the build that just sealed, and one schema-evidence drift
 * during the export costs one bounded re-export instead of the cycle.
 *
 * Right after every seal the receiver starts "Backup after seal <run>-<attempt>".
 * It used to spend about 48 minutes of the one Backup host re-certifying the
 * serving build (45370915542 held the host 10:02-10:50Z and 45399317563
 * 13:02-13:48Z on 2026-11-24), a certificate nothing shippable reads:
 * select-daily-engine.py walks only the commits AFTER the serving release.
 * The cycle's real candidate could start only afterwards, so one refusal lost
 * the cycle. Run 45324579997 (04:18Z) was such a refusal: production installed
 * a migration between the export's two schema-evidence captures.
 *
 * Every scenario runs the workflow's own shell with gh, ssh and the provider
 * replaced by local functions; git is real, on a disposable repository.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const backup = parse(read('.github/workflows/backup-engine.yml'));
const planJob = backup.jobs.plan;
const refresh = backup.jobs.refresh;
const certifyJob = backup.jobs.certify;
const stepOf = (job: any, id: string) => job.steps.find((s: any) => s.id === id);
const next = stepOf(planJob, 'next');
const plan = stepOf(planJob, 'plan');
const turn = stepOf(refresh, 'turn');
const due = stepOf(refresh, 'due');
const exportStep = refresh.steps.find((s: any) =>
  /^Export the production structure/.test(s.name ?? '')
);
const certify = stepOf(certifyJob, 'certify');
const run = (step: any): string => String(step?.run ?? 'echo "step missing on this tree"; exit 97');

// A pre-push hook exports GIT_DIR and friends; a step reading a disposable
// fixture repository must not be pointed at the repository being pushed.
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
  const dir = temp('o24-run-');
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

/** main: c0 server, c1 server (SEALED), c2 docs, c3 server, c4 release control, c5 docs. */
function repository() {
  const dir = temp('o24-repo-');
  const git = (...args: string[]) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: cleanEnv() });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const write = (path: string, body: string) => {
    mkdirSync(dirname(resolve(dir, path)), { recursive: true });
    writeFileSync(resolve(dir, path), body);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'law@example.invalid');
  git('config', 'user.name', 'law');
  git('config', 'commit.gpgsign', 'false');
  const commit = (path: string, body: string) => {
    write(path, body);
    git('add', '-A');
    git('commit', '-q', '-m', path);
    return git('rev-parse', 'HEAD');
  };
  write(
    'scripts/ci/read-engine-prequalification.py',
    'CONTROL_INPUTS = ["scripts/ci/select-daily-engine.py", "server/scripts"]\n'
  );
  const c0 = commit('server/src/a.ts', '0\n');
  const c1 = commit('server/src/a.ts', '1\n');
  const c2 = commit('docs/x.md', 'x\n');
  const c3 = commit('server/src/a.ts', '3\n');
  const c4 = commit('scripts/ci/select-daily-engine.py', '# control\n');
  const c5 = commit('docs/y.md', 'y\n');
  return { dir, git, write, shas: { c0, c1, c2, c3, c4, c5 } };
}

const repo = repository();
const { c0, c1: SEALED, c2, c3, c4, c5 } = repo.shas;

function runNext(opts: {
  githubSha: string;
  sealed?: string;
  baseline?: string; // the reader's verdict lines, or FAIL
  cwd?: string;
}) {
  const verdict = opts.baseline ?? 'state=outside';
  const tool =
    verdict === 'FAIL'
      ? 'echo "HTTP 502" >&2; return 1'
      : `printf '%s\\n' ${verdict
          .split('\n')
          .map((line) => `"print('${line}')"`)
          .join(' ')}`;
  const harness = `
gh() {
  echo "gh $*" >> "$CALLS"
  case "$*" in
    *contents/scripts/ci/backup-freeze-baseline.py*) ${tool} ;;
    *"/statuses/"*) return 0 ;;
    *) echo "HTTP 502" >&2; return 1 ;;
  esac
}
`;
  return shell(
    harness + run(next),
    {
      SEALED_SHA: opts.sealed ?? SEALED,
      RUN_KEY: '11-1',
      RUN_ID: '900',
      GITHUB_SHA: opts.githubSha,
    },
    opts.cwd ?? repo.dir
  );
}
function runPlan(env: NodeJS.ProcessEnv) {
  return shell(
    'gh() { echo "gh $*" >> "$CALLS"; return 1; }\n' + run(plan),
    {
      EVENT: 'repository_dispatch',
      INPUT_SHA: '',
      INPUT_REFRESH: '',
      RUN_ID: '900',
      GITHUB_SHA: c5,
      ...env,
    },
    repo.dir
  );
}

describe('the post-seal Backup certifies the next candidate (O24)', () => {
  it('is wired after the unchanged custody proof and plans nothing when the next step names nothing', () => {
    const ids = planJob.steps.map((s: any) => s.id ?? s.uses);
    expect(ids.slice(0, 4)).toEqual(['seal', 'actions/checkout@v4', 'next', 'plan']);
    const checkout = planJob.steps[1];
    expect(checkout.if).toBe(next.if);
    expect(next.if).toBe(
      "github.event_name == 'repository_dispatch' && steps.seal.outputs.sha != ''"
    );
    // An unreadable checkout must not fail the plan: the next step falls back.
    expect(checkout['continue-on-error']).toBe(true);
    expect(checkout.with['fetch-depth']).toBe(0);
    expect(checkout.with['sparse-checkout']).toContain(
      'scripts/ci/read-engine-prequalification.py'
    );
    expect(next.env.SEALED_SHA).toBe('${{ steps.seal.outputs.sha }}');
    expect(plan.if).toBe(
      "github.event_name != 'repository_dispatch' || steps.next.outputs.sha != ''"
    );
    expect(plan.env.SEALED_SHA).toBe('${{ steps.seal.outputs.sha }}');
    expect(plan.env.NEXT_SHA).toBe('${{ steps.next.outputs.sha }}');
    expect(planJob.outputs.post_seal).toBe('${{ steps.next.outputs.post_seal }}');
    expect(planJob.outputs.sealed_sha).toBe('${{ steps.seal.outputs.sha }}');
    // No plan, no host: refresh and certify both require a planned sha.
    expect(refresh.if).toContain("needs.plan.outputs.sha != ''");
    expect(certifyJob.if).toContain("needs.plan.outputs.sha != ''");
    // The selector admits a retargeted control from push runs only, so a
    // dispatch run never retargets: its control stays its own commit.
    expect(stepOf(refresh, 'late_retarget').if).toMatch(/^github\.event_name == 'push' && /);
    expect(planJob.outputs.control_sha).toBe('${{ steps.plan.outputs.control_sha || github.sha }}');
    expect(run(next)).not.toContain('control_sha=');
    // No timer, no chained trigger: the receiver's one existing event starts it.
    expect(backup.on.workflow_run).toBeUndefined();
    expect(backup.on.schedule).toHaveLength(2);
    expect(backup.on.repository_dispatch.types).toEqual([
      'run-post-deploy-e2e',
      'refresh-sealed-engine-backup',
    ]);
  });

  it('targets the newest server commit ahead of the sealed build, forces the refresh and rehearses against the sealed build', () => {
    const r = runNext({ githubSha: c3 });
    expect(r.status, r.stderr).toBe(0);
    expect(r.out).toContain(`sha=${c3}\n`);
    expect(r.out).toContain('post_seal=1');
    expect(r.out).not.toContain('freeze_baseline=1');
    expect(r.stdout).toContain(`POST-SEAL NEXT CANDIDATE: ${SEALED} sealed and is serving`);
    expect(r.stdout).toContain(`certifying ${c3}`);
    expect(r.stdout).toContain(`rollback rehearsed against ${SEALED}`);
    expect(r.calls).not.toContain('/statuses/');
    const planned = runPlan({ SEALED_SHA: SEALED, NEXT_SHA: c3, GITHUB_SHA: c3 });
    expect(planned.status, planned.stderr).toBe(0);
    expect(planned.out).toContain(`sha=${c3}\n`);
    expect(planned.out).toContain('refresh=force');
    expect(planned.out).not.toContain('control_sha=');
    // The standby reads the serving release from live /health when it
    // rehearses; the custody proof has just shown that to be the sealed build.
    const standby = read('server/standby/standby-engine.sh');
    const certifyBody = standby.slice(standby.indexOf('cmd_certify() {'));
    expect(certifyBody).toMatch(
      /serving=\$\(curl -fsS -m 10 https:\/\/engine\.smarter\.poker\/health \| health_field releaseSha\)/
    );
    expect(certifyBody).toContain('certified_player_swap "$sha" "$serving"');
    expect(certifyBody).toContain('"rehearsedServingSha": sys.argv[2]');
    expect(stepOf(planJob, 'seal').run).toContain('.running==true and .releaseSha==$sha');
  });

  it('follows a newer release-control commit (the O13 rule), never past its own commit, and the server commit alone when CONTROL_INPUTS is unreadable', () => {
    const control = runNext({ githubSha: c5 });
    expect(control.status, control.stderr).toBe(0);
    expect(control.out).toContain(`sha=${c4}\n`);
    expect(control.out).toContain('post_seal=1');
    const own = runNext({ githubSha: c3 });
    expect(own.out).toContain(`sha=${c3}\n`);
    const original = read('.github/workflows/backup-engine.yml');
    expect(original).toContain('m["CONTROL_INPUTS"]');
    const preq = resolve(repo.dir, 'scripts/ci/read-engine-prequalification.py');
    const saved = readFileSync(preq, 'utf8');
    writeFileSync(preq, 'raise RuntimeError("unreadable")\n');
    try {
      const serverOnly = runNext({ githubSha: c5 });
      expect(serverOnly.status, serverOnly.stderr).toBe(0);
      expect(serverOnly.stdout).toContain('could not read CONTROL_INPUTS');
      expect(serverOnly.out).toContain(`sha=${c3}\n`);
    } finally {
      writeFileSync(preq, saved);
    }
  });

  it.each([
    ['the sealed build is the newest server commit', c2],
    ['the run commit is the sealed build itself', SEALED],
  ])('ends without taking the host and writes no status when %s', (_label, githubSha) => {
    const r = runNext({ githubSha });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('NOTHING TO CERTIFY AFTER THE SEAL');
    expect(r.stdout).toContain('the Backup host is not taken and no status is written');
    expect(r.out).toBe('sha=\n');
    expect(r.calls).not.toContain('/statuses/');
    expect(r.summary).toContain('Nothing to certify after the seal');
  });

  it('nothing ahead also covers a sealed release-control commit followed only by docs', () => {
    // Sealed c4 (a release-control commit) with run commit c5: the newest
    // server or release-control commit is c4 itself, with docs after it.
    const r = runNext({ githubSha: c5, sealed: c4 });
    expect(r.status, r.stderr).toBe(0);
    expect(r.out).toBe('sha=\n');
  });

  it.each([
    ['no checkout (git unreadable)', () => runNext({ githubSha: c5, cwd: temp('o24-nogit-') })],
    ['a sealed build that is not an ancestor of the run commit', () => runNext({ githubSha: c0 })],
  ])('behaves exactly as before when unreadable: %s', (_label, go) => {
    const r = go();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('POST-SEAL TARGET UNREADABLE');
    expect(r.stdout).toContain(`certifying the sealed build ${SEALED} exactly as before`);
    expect(r.out).toBe(`sha=${SEALED}\n`);
    expect(r.calls).not.toContain('/statuses/');
    // The plan step then certifies the sealed build with a forced refresh,
    // with none of the next-candidate behaviour switched on.
    const planned = runPlan({ SEALED_SHA: SEALED, NEXT_SHA: SEALED });
    expect(planned.out).toContain(`sha=${SEALED}\n`);
    expect(planned.out).toContain('refresh=force');
    expect(planned.out).not.toContain('freeze_baseline=1');
  });

  it('an unreadable freeze reader is not an answer: the next-candidate rule still decides', () => {
    const r = runNext({ githubSha: c5, baseline: 'FAIL' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('freeze baseline: unknown');
    expect(r.out).toContain(`sha=${c4}\n`);
  });

  describe('inside the freeze the baseline rule decides', () => {
    it('`due`: claims and certifies the baseline exactly as a push run would, never as a next candidate', () => {
      const r = runNext({ githubSha: c5, baseline: `state=due\nbaseline=${c3}` });
      expect(r.status, r.stderr).toBe(0);
      expect(r.out).toContain(`sha=${c3}\n`);
      expect(r.out).toContain('freeze_baseline=1');
      expect(r.out).not.toContain('post_seal=1');
      expect(r.calls).toMatch(
        new RegExp(
          `gh api repos/o/r/statuses/${c3} -f state=pending .*claimed tonight's freeze baseline \\(run 900\\)`
        )
      );
      const planned = runPlan({ SEALED_SHA: SEALED, NEXT_SHA: c3, NEXT_FREEZE_BASELINE: '1' });
      expect(planned.out).toContain(`sha=${c3}\n`);
      expect(planned.out).toContain('refresh=force');
      expect(planned.out).toContain('freeze_baseline=1');
    });

    it.each(['claimed', 'done', 'served', 'refused', 'unselectable'])(
      '`%s`: certifies nothing, takes no host and never writes over the baseline claim',
      (state) => {
        const r = runNext({ githubSha: c5, baseline: `state=${state}\nbaseline=${c3}` });
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).toContain('NOTHING TO CERTIFY AFTER THE SEAL');
        expect(r.stdout).toContain(`answers ${state} for ${c3}`);
        expect(r.out).toBe('sha=\n');
        expect(r.calls).not.toContain('/statuses/');
      }
    );

    it('a `due` baseline the sealed build already holds is not certified again', () => {
      const r = runNext({ githubSha: c5, baseline: `state=due\nbaseline=${c0}` });
      expect(r.status, r.stderr).toBe(0);
      expect(r.out).toBe('sha=\n');
      expect(r.calls).not.toContain('/statuses/');
    });
  });

  describe('the copy is taken after the post-seal installs, the host is never held for nothing', () => {
    const digest = 'c'.repeat(64);
    function zipOf(rehearsed: string) {
      const dir = temp('o24-zip-');
      const file = resolve(dir, 'certificate.zip');
      const made = spawnSync(
        'python3',
        [
          '-c',
          'import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w") as z: z.writestr("certificate.json", json.dumps({"rehearsedServingSha": sys.argv[2]}))',
          file,
          rehearsed,
        ],
        { encoding: 'utf8' }
      );
      if (made.status !== 0) throw new Error(made.stderr);
      return file;
    }
    function runDue(
      verdictOut: string,
      env: NodeJS.ProcessEnv = {},
      standing: { line?: string; zip?: string } = {}
    ) {
      const statusReply =
        standing.line === undefined
          ? 'echo "HTTP 502" >&2; return 1'
          : `printf '%s\\n' ${JSON.stringify(standing.line)}`;
      const harness = `sha256sum() { echo "0000000000000000000000000000000000000000000000000000000000000000  $1"; }
ssh() {
  echo "ssh $*" >> "$CALLS"
  case "$*" in
    *"python3 - '"*) cat > /dev/null; echo "LEASE_RELEASED $*" >> "$CALLS" ;;
    *"database.json"*) echo "2026-11-24T07:00:00Z" ;;
    *"schema-evidence.json"*) echo "{}" ;;
  esac
}
gh() {
  echo "gh $*" >> "$CALLS"
  case "$*" in
    *commits/*/statuses*) ${statusReply} ;;
    *actions/runs/555/artifacts*) echo 77 ;;
    *actions/artifacts/77/zip*) cat "${standing.zip ?? '/nonexistent'}" ;;
    *) return 1 ;;
  esac
}
python3() {
  if [ "$1" = -B ] && [ "$2" = server/scripts/engine-release-installed-migrations.py ]; then
    echo "refresh-due $*" >> "$CALLS"
    printf '%s\\n' ${verdictOut
      .split('\n')
      .map((line) => JSON.stringify(line))
      .join(' ')}
    echo "reason=mock contents" >&2
    return 0
  fi
  command python3 "$@"
}
date() { echo "2026-11-24"; }
git() { echo "2026-11-24T07:00:00Z"; }
`;
      return shell(
        harness + run(due),
        {
          DATABASE_URL: 'postgres://fixture',
          MODE: 'force',
          EVENT: 'repository_dispatch',
          CONTROL: c5,
          RUN_ID: '900',
          RUN_ATTEMPT: '1',
          SHA: c4,
          FREEZE_BASELINE: '',
          PLAN_PRIORITY: '',
          POST_SEAL: '1',
          SEALED_SHA: SEALED,
          ...env,
        },
        temp('o24-due-')
      );
    }
    const installed = `due=true\nproduction=${'a'.repeat(64)}\npending=\ncomparable=${digest}`;

    it('wires the next-candidate flag and the sealed build into turn, due and certify', () => {
      for (const step of [turn, due, certify])
        expect(step.env.POST_SEAL).toBe('${{ needs.plan.outputs.post_seal }}');
      for (const step of [due, certify])
        expect(step.env.SEALED_SHA).toBe('${{ needs.plan.outputs.sealed_sha }}');
    });

    it('waits inside the one existing read, bounded at 25 minutes, and only for a next-candidate run', () => {
      const waited = runDue(installed);
      expect(waited.status, waited.stderr).toBe(0);
      expect(waited.calls).toMatch(/refresh-due .* --wait 240 --wait 1500\n/);
      expect(waited.out).toContain('due=true');
      expect(waited.out).not.toContain('deferred=1');
      const asBefore = runDue(installed, { POST_SEAL: '' });
      expect(asBefore.calls).toMatch(/refresh-due .* --wait 240\n/);
      expect(asBefore.calls).not.toContain('--wait 1500');
      // argparse keeps the last --wait; every bound in the step is <= 30 minutes.
      const bounds = [...run(due).matchAll(/--wait (\d+)/g)].map((m) => Number(m[1]));
      expect(bounds).toEqual([1500, 240]);
      expect(Math.max(...bounds)).toBeLessThanOrEqual(1800);
      const parsed = spawnSync(
        'python3',
        [
          '-c',
          'import argparse\np=argparse.ArgumentParser()\np.add_argument("--wait",type=int,default=0)\nprint(p.parse_args(["--wait","240","--wait","1500"]).wait)',
        ],
        { encoding: 'utf8' }
      );
      expect(parsed.stdout.trim()).toBe('1500');
      // One waiting read, no loop around it: the wait cannot be repeated. The
      // second read (O29, 2026-11-26) judges the copy for a stepped-down commit
      // and carries no --wait at all.
      const reads = run(due).split('engine-release-installed-migrations.py refresh-due').slice(1);
      expect(reads).toHaveLength(2);
      expect(reads.map((text) => text.split(') ||')[0].includes('--wait'))).toEqual([true, false]);
    });

    it('still uninstalled after the wait: hands the host back as a push run does, no status, no soak', () => {
      const r = runDue(`due=true\nproduction=${'a'.repeat(64)}\npending=20261124160000`);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain(
        `DEFERRED: ${c4} carries uninstalled ordinary migration(s) (20261124160000)`
      );
      expect(r.out).toContain('deferred=1');
      expect(r.calls).toContain('LEASE_RELEASED');
      expect(r.calls).not.toContain('/statuses/');
      // The sealed-build fallback and tonight's baseline keep their exemption.
      for (const env of [{ POST_SEAL: '' }, { FREEZE_BASELINE: '1' }]) {
        const exempt = runDue(
          `due=true\nproduction=${'a'.repeat(64)}\npending=20261124160000`,
          env
        );
        expect(exempt.stdout).not.toContain('DEFERRED:');
        expect(exempt.out).not.toContain('deferred=1');
        expect(exempt.calls).not.toContain('LEASE_RELEASED');
      }
    });

    it('a same-target run that took the host first certified it: exactly one soak', () => {
      const line = `success|https://github.example/o/r/actions/runs/555|Certified on the Backup Engine; installed migrations ${digest}`;
      const r = runDue(installed, {}, { line, zip: zipOf(SEALED) });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain(
        `ALREADY CERTIFIED: ${c4} already carries backup-engine/certified = success from run 555`
      );
      expect(r.stdout).toContain(`rehearsed against the sealed build ${SEALED}`);
      expect(r.out).toContain('due=false');
      expect(r.out).toContain('deferred=1');
      expect(r.calls).toContain('LEASE_RELEASED');
      expect(r.calls).not.toContain(' -f state=');
      expect(refresh.outputs.deferred).toContain("steps.due.outputs.deferred == '1'");
      expect(certifyJob.if).toContain("needs.refresh.outputs.deferred != '1'");
      // The other order: a push run behind this one reads its success and stops.
      expect(stepOf(refresh, 'late_inherit').run).toContain('if [ "$self_state" = success ]; then');
    });

    it.each([
      [
        'rehearsed against the previous engine',
        {
          line: `success|https://github.example/o/r/actions/runs/555|Certified on the Backup Engine; installed migrations ${digest}`,
          zip: zipOf(c0),
        },
      ],
      [
        'certified for another installed set',
        {
          line: `success|https://github.example/o/r/actions/runs/555|Certified on the Backup Engine; installed migrations ${'d'.repeat(64)}`,
          zip: zipOf(SEALED),
        },
      ],
      [
        'a refusal',
        {
          line: `failure|https://github.example/o/r/actions/runs/555|Backup Engine refused: hand_gap_unintended_delay_exceeded`,
          zip: zipOf(SEALED),
        },
      ],
      [
        'an unreadable certificate bundle',
        {
          line: `success|https://github.example/o/r/actions/runs/555|Certified on the Backup Engine; installed migrations ${digest}`,
        },
      ],
      ['unreadable statuses', {}],
    ])('certifies in full when the standing verdict is %s', (_label, standing) => {
      const r = runDue(installed, {}, standing);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).not.toContain('ALREADY CERTIFIED');
      expect(r.out).toContain('due=true');
      expect(r.out).not.toContain('deferred=1');
      expect(r.calls).not.toContain('LEASE_RELEASED');
    });
  });

  describe('a newer push run takes over exactly as it would from a push run', () => {
    function runTurn(env: NodeJS.ProcessEnv) {
      const count = resolve(temp('o24-turn-count-'), 'n');
      const harness = `
ssh() {
  echo "ssh $*" >> "$CALLS"
  cat > /dev/null
  n=0; [ -f "${count}" ] && n=$(cat "${count}"); n=$((n + 1)); echo "$n" > "${count}"
  if [ "$n" -eq 1 ]; then echo "held:999"; else echo "acquired"; fi
}
sleep() { echo "sleep $*" >> "$CALLS"; }
gh() {
  echo "gh $*" >> "$CALLS"
  case "$*" in
    *actions/workflows/backup-engine.yml/runs*) echo '${'e'.repeat(40)}' ;;
    *contents/scripts/ci/backup-candidate-priority.py*) printf '%s\\n' "print('priority=none')" ;;
    *actions/runs/999*) echo "in_progress" ;;
    *) return 1 ;;
  esac
}
`;
      return shell(
        harness + run(turn),
        {
          GITHUB_SHA: c5,
          SHA: c4,
          RUN_ID: '900',
          RUN_ATTEMPT: '1',
          EVENT: 'repository_dispatch',
          FREEZE_BASELINE: '',
          PLAN_PRIORITY: '',
          ...env,
        },
        temp('o24-turn-')
      );
    }
    it('a waiting next-candidate run yields to a newer active push run without the lease or a status', () => {
      const r = runTurn({ POST_SEAL: '1' });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain('SUPERSEDED: 1 newer active push run(s)');
      expect(r.out).toContain('superseded=1');
      expect(r.out).not.toContain('acquired=1');
      expect(r.calls).not.toContain('/statuses/');
    });
    it.each([
      ['the sealed-build fallback', { POST_SEAL: '' }],
      ["tonight's freeze baseline", { POST_SEAL: '', FREEZE_BASELINE: '1' }],
    ])('%s is never superseded, as before', (_label, env) => {
      const r = runTurn(env);
      expect(r.status, r.stderr).toBe(0);
      expect(r.out).toContain('acquired=1');
      expect(r.stdout).not.toContain('SUPERSEDED');
    });
    it('the mid-soak yield (O1/O16) judges a next-candidate run by the push rule', () => {
      const gate =
        'if { [ "${EVENT:-}" = push ] || [ "${POST_SEAL:-}" = 1 ]; } && [ "${FREEZE_BASELINE:-}" != 1 ] && [ "${PLAN_PRIORITY:-}" != booking ] && [[ "${RUN_ID:-}" =~ ^[0-9]+$ ]]; then';
      expect(run(certify)).toContain(gate + '\n  while kill -0 "$ssh_pid" 2>/dev/null; do');
      expect(run(turn)).toContain(gate);
    });
  });
});

describe('one schema-evidence drift costs one bounded re-export, not the cycle (O24)', () => {
  function runExport(env: NodeJS.ProcessEnv) {
    const dir = temp('o24-export-');
    const harness = `
python3() {
  echo "python3 $*" >> "$CALLS"
  case "$*" in
    *"schema-evidence.py capture"*)
      if [ "\${CAPTURE_RC:-0}" != 0 ]; then echo 'Schema evidence refused; capture, signatures, migration set or dump binding invalid' >&2; return 1; fi ;;
    *"schema-evidence.py compare"*)
      n=0; [ -f "$RUNNER_TEMP/compares" ] && n=$(cat "$RUNNER_TEMP/compares"); n=$((n + 1)); echo "$n" > "$RUNNER_TEMP/compares"
      if [ "$n" -le "\${REFUSALS:-0}" ]; then echo 'Schema evidence refused; capture, signatures, migration set or dump binding invalid' >&2; return 1; fi
      echo 'Schema evidence matches' ;;
    *seed-extract.py*) return "\${SEED_RC:-0}" ;;
  esac
}
timeout() { echo "dump $1" >> "$CALLS"; return "\${DUMP_RC:-0}"; }
sleep() { echo "sleep $*" >> "$CALLS"; }
tar() { echo "tar $*" >> "$CALLS"; }
`;
    const r = shell(
      harness + run(exportStep),
      {
        DATABASE_URL: 'postgres://fixture',
        PG_DUMP: '/nonexistent/pg_dump',
        PG_LIB: '/nonexistent',
        ...env,
      },
      dir
    );
    const count = (pattern: RegExp) => (r.calls.match(pattern) ?? []).length;
    return {
      ...r,
      dumps: count(/^dump 270$/gm),
      compares: count(/schema-evidence\.py compare/g),
      sleeps: r.calls.match(/^sleep .*$/gm) ?? [],
      shipped: count(/^tar /gm),
    };
  }

  it('no drift: one export, no pause', () => {
    const r = runExport({});
    expect(r.status, r.stderr).toBe(0);
    expect([r.dumps, r.compares, r.sleeps.length, r.shipped]).toEqual([1, 1, 0, 1]);
  });

  it('refused once then accepted: exported exactly once more after one fixed pause, then shipped', () => {
    const r = runExport({ REFUSALS: '1' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('EXPORT REPEATED ONCE');
    expect([r.dumps, r.compares, r.shipped]).toEqual([2, 2, 1]);
    expect(r.sleeps).toEqual(['sleep 45']);
    expect(45).toBeLessThanOrEqual(60);
    // The second export starts from an empty directory: capture opens its
    // output exclusively and would refuse a leftover file.
    expect(run(exportStep)).toMatch(/export_once\(\) \{\n\s*rm -rf "\$RUNNER_TEMP\/out"\n/);
  });

  it('refused twice: the step fails exactly as before, nothing is shipped, no third export', () => {
    const r = runExport({ REFUSALS: '2' });
    expect(r.status).not.toBe(0);
    expect([r.dumps, r.compares, r.shipped]).toEqual([2, 2, 0]);
    expect(r.sleeps).toEqual(['sleep 45']);
    // A failed refresh is still a refusal on the exact commit.
    expect(run(certify)).toContain('database_refresh_failed');
  });

  it.each([
    ['a capture error (auth, network)', { CAPTURE_RC: '1' }, 0],
    ['a dump error', { DUMP_RC: '124' }, 1],
    ['a seed error', { SEED_RC: '1' }, 1],
  ])('%s is not drift: no retry, no pause, failure as before', (_label, env, dumps) => {
    const r = runExport(env);
    expect(r.status).not.toBe(0);
    expect([r.dumps, r.compares, r.sleeps.length, r.shipped]).toEqual([dumps, 0, 0, 0]);
    expect(r.stdout).not.toContain('EXPORT REPEATED ONCE');
  });

  it('the only refusal the offline compare can make between two fresh captures is drift', () => {
    // The retry signal is the compare's own exit: it reads two files this step
    // wrote, no network, no credential (server/standby/schema-evidence.py).
    const evidence = read('server/standby/schema-evidence.py');
    const compare = evidence.slice(evidence.indexOf('def compare('), evidence.indexOf('def main('));
    expect(compare).toContain("raise ValueError('Function definitions changed')");
    expect(compare).toContain("raise ValueError('Installed migration set changed')");
    expect(compare).not.toMatch(/psql|subprocess|urlopen|DATABASE_URL/);
    const body = run(exportStep);
    expect(body.match(/export_once$/gm)).toHaveLength(2);
    expect(body.match(/schema-evidence\.py compare/g)).toHaveLength(2);
    expect(body.indexOf('if ! python3 -B server/standby/schema-evidence.py compare')).toBeLessThan(
      body.indexOf('sleep 45')
    );
  });
});
