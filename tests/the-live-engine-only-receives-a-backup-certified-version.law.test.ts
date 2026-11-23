/**
 * LAW: the live engine only ever receives a version the Backup Engine certified.
 *
 * stage-engine-release.yml offers only commits whose commit status
 * backup-engine/certified is success, but auto-deploy-hetzner.yml also accepts
 * deploy-club-arena-engine repository_dispatch events sent directly (agents did
 * this on 2026-11-06 with a shared token while staging was disabled). The
 * receiver itself must therefore refuse any exact SHA the Backup Engine has not
 * certified, before tests, database doors, SSH or any Hetzner contact.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

const workflowPath = resolve(__dirname, '../.github/workflows/auto-deploy-hetzner.yml');
const workflow = parse(readFileSync(workflowPath, 'utf8'));
const preflight = workflow.jobs.preflight;
const steps: Array<Record<string, any>> = preflight.steps;
const gate = steps.find((s) => s.id === 'backup_certificate')!;
const SHA = 'a'.repeat(40);
const transaction = readFileSync(
  resolve(__dirname, '../server/scripts/engine-release-transaction.sh'),
  'utf8'
);
const hostGate = transaction.slice(
  transaction.indexOf('require_backup_certificate() {'),
  transaction.indexOf('\ndaily_cutover_clock() {')
);

const scratch: string[] = [];
afterEach(() => {
  while (scratch.length) rmSync(scratch.pop()!, { recursive: true, force: true });
});

/** Run the gate's exact script with a fake gh that answers the statuses read. */
function runGate(ghBehaviour: string, sha = SHA) {
  const dir = mkdtempSync(join(tmpdir(), 'backup-cert-gate-'));
  scratch.push(dir);
  const fakeGh = join(dir, 'gh');
  writeFileSync(
    fakeGh,
    `#!/usr/bin/env bash\necho "$@" >> "${join(dir, 'gh.calls')}"\n${ghBehaviour}\n`
  );
  chmodSync(fakeGh, 0o755);
  const output = join(dir, 'out');
  writeFileSync(output, '');
  const result = spawnSync('bash', ['-c', gate.run], {
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      GITHUB_OUTPUT: output,
      GH_TOKEN: 'fake',
      REPO: 'owner/repo',
      CERTIFIED_SHA: sha,
    },
  });
  let calls = '';
  try {
    calls = readFileSync(join(dir, 'gh.calls'), 'utf8');
  } catch {
    calls = '';
  }
  return { ...result, output: readFileSync(output, 'utf8'), calls };
}

function runHostGate(body: string, rc = 0, sha = SHA, stopped = false) {
  const dir = mkdtempSync(join(tmpdir(), 'backup-host-cert-'));
  scratch.push(dir);
  writeFileSync(join(dir, 'body'), body);
  if (stopped) writeFileSync(join(dir, 'owner-stop-engine-replacement'), '');
  writeFileSync(
    join(dir, 'curl'),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > '${dir}/calls'\ncat '${dir}/body'\nexit ${rc}\n`
  );
  chmodSync(join(dir, 'curl'), 0o755);
  const result = spawnSync('bash', ['-c', `${hostGate}\nrequire_backup_certificate`], {
    encoding: 'utf8',
    env: { PATH: `${dir}:${process.env.PATH}`, SHA: sha, ENGINE_RELEASE_STATE_DIR: dir },
  });
  let calls = '';
  try {
    calls = readFileSync(join(dir, 'calls'), 'utf8');
  } catch {
    /* SHA rejected before HTTP */
  }
  return { ...result, calls };
}

describe('host revalidates the exact Backup certificate before new ownership and mutation', () => {
  it('checks before reservation, prepare and the final clock/mutation boundary', () => {
    expect(transaction).toMatch(/require_backup_certificate[^\n]+\ninitialise_phase1_cycle/);
    expect(transaction).toMatch(
      /require_backup_certificate[^\n]+\n {2}record_floor_runtime_entry\n {2}set \+e\n {2}PREPARE_OUTPUT=/
    );
    expect(transaction).toMatch(
      /PREPARED=1\nrequire_backup_certificate[^\n]+\ndaily_cutover_clock[^\n]+\nMUTATION_STARTED=1/
    );
  });

  it('refuses a certified queued candidate while the durable owner stop is present', () => {
    const result = runHostGate(
      JSON.stringify([{ context: 'backup-engine/certified', state: 'success' }]),
      0,
      SHA,
      true
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('owner stop active');
  });

  it('admits success from the fixed bounded HTTPS endpoint without redirects', () => {
    const result = runHostGate(
      JSON.stringify([{ context: 'backup-engine/certified', state: 'success' }])
    );
    expect(result.status).toBe(0);
    expect(result.calls).toContain(
      `https://api.github.com/repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/commits/${SHA}/statuses?per_page=100`
    );
    expect(result.calls).toContain('--max-time\n8');
    expect(result.calls).toContain('--disable');
    expect(result.calls).not.toMatch(/--location|\n-L\n/);
  });

  it.each(['pending', 'failure', 'error'])(
    'rejects newer %s instead of reusing old success',
    (state) => {
      expect(
        runHostGate(
          JSON.stringify([
            { context: 'unrelated', state: 'success' },
            { context: 'backup-engine/certified', state },
            { context: 'backup-engine/certified', state: 'success' },
          ])
        ).status
      ).not.toBe(0);
    }
  );

  it.each(['[]', '{}', 'not json', '[null]', '[{"context":"backup-engine/certified"}]'])(
    'rejects missing or malformed evidence: %s',
    (body) => {
      expect(runHostGate(body).status).not.toBe(0);
    }
  );

  it('rejects HTTP failure even if the response contains success', () => {
    expect(
      runHostGate('[{"context":"backup-engine/certified","state":"success"}]', 22).status
    ).not.toBe(0);
  });

  it('rejects a nonexact SHA without an HTTP request', () => {
    const result = runHostGate('[]', 0, 'HEAD');
    expect(result.status).not.toBe(0);
    expect(result.calls).toBe('');
  });
});

describe('auto-deploy-hetzner.yml requires the Backup Engine certificate', () => {
  it('gates every deploy request in the first job that resolves the exact SHA', () => {
    expect(workflow.on.repository_dispatch.types).toContain('deploy-club-arena-engine');
    expect(preflight.if).toBe("github.event.action == 'deploy-club-arena-engine'");
    expect(gate).toBeDefined();
    expect(gate.name).toBe('Require the Backup Engine certificate for this exact SHA');
    // Unconditional: no if, no continue-on-error, no way to skip the gate.
    expect(gate.if).toBeUndefined();
    expect(gate['continue-on-error']).toBeUndefined();
    // Directly after the exact SHA is resolved, before Node, npm and tests.
    const target = steps.findIndex((s) => s.id === 'target');
    expect(target).toBeGreaterThanOrEqual(0);
    expect(steps.indexOf(gate)).toBe(target + 1);
    expect(gate.env.CERTIFIED_SHA).toBe('${{ steps.target.outputs.sha }}');
    expect(gate.env.GH_TOKEN).toBe('${{ github.token }}');
    expect(preflight.permissions).toEqual({ contents: 'read', statuses: 'read', actions: 'read' });
    expect(gate.run).toContain('repos/$REPO/commits/$CERTIFIED_SHA/statuses');
    expect(gate.run).toContain('select(.context == "backup-engine/certified")');
    expect(gate.run).toContain('::error title=Backup Engine certificate gate::');
  });

  it('runs before any host contact: every SSH-holding job depends on the gated matrix', () => {
    expect(workflow.jobs['engine-doors'].needs).toBe('preflight');
    expect(workflow.jobs.deploy.needs).toEqual(['preflight', 'engine-doors']);
    expect(workflow.jobs.deploy.env.SHA).toBe('${{ needs.preflight.outputs.target_sha }}');
    // The gated job itself holds no host or database authority.
    const text = JSON.stringify(preflight);
    expect(text).not.toMatch(/secrets\./);
    expect(text).not.toMatch(/HETZNER|SSH_/);
  });

  it('admits only an exact SHA whose newest backup-engine/certified status is success', () => {
    const pass = runGate(`echo success`);
    expect(pass.status).toBe(0);
    expect(pass.output).toContain('certified=true');
    expect(pass.calls).toContain(`repos/owner/repo/commits/${SHA}/statuses`);
  });

  it.each([
    ['failure', 'echo failure'],
    ['pending', 'echo pending'],
    ['missing', 'echo missing'],
  ])('refuses by name when the certificate is %s', (state, behaviour) => {
    const refused = runGate(behaviour);
    expect(refused.status).not.toBe(0);
    expect(refused.stdout).toContain('::error title=Backup Engine certificate gate::');
    expect(refused.stdout).toContain(`backup-engine/certified = ${state}`);
    expect(refused.output).not.toContain('certified=true');
  });

  it.each(['pending', 'failure'])('does not reuse an older success after a newer %s', (state) => {
    const statuses = JSON.stringify([
      { context: 'unrelated/check', state: 'success' },
      { context: 'backup-engine/certified', state },
      { context: 'backup-engine/certified', state: 'success' },
    ]);
    // Execute the receiver's actual jq selector, not a preselected fake state.
    const refused = runGate(`printf '%s' '${statuses}' | jq -r "\${!#}"`);
    expect(refused.status).toBe(1);
    expect(refused.calls).toContain(`repos/owner/repo/commits/${SHA}/statuses`);
    expect(refused.stdout).toContain(`backup-engine/certified = ${state}`);
    expect(refused.output).not.toContain('certified=true');
  });

  it('refuses when the statuses cannot be read', () => {
    const refused = runGate('exit 1');
    expect(refused.status).not.toBe(0);
    expect(refused.stdout).toContain('could not read commit statuses');
    expect(refused.output).not.toContain('certified=true');
  });

  it('refuses a malformed SHA without asking GitHub', () => {
    const refused = runGate('echo success', 'HEAD');
    expect(refused.status).not.toBe(0);
    expect(refused.stdout).toContain('::error title=Backup Engine certificate gate::');
    expect(refused.calls).toBe('');
  });
});

it('refuses missing, superseded and incompatible daytime qualification evidence', () => {
  const result = spawnSync('python3', ['-B', 'tests/operations/engine-prequalification.test.py'], {
    encoding: 'utf8',
    timeout: 10000,
  });
  expect(result.status, result.stderr).toBe(0);
});

it('binds explicit finite owner selection to the existing receiver without authorizing database work', () => {
  const stage = parse(
    readFileSync(resolve(__dirname, '..', '.github/workflows/stage-engine-release.yml'), 'utf8')
  );
  const receiver = parse(
    readFileSync(resolve(__dirname, '..', '.github/workflows/auto-deploy-hetzner.yml'), 'utf8')
  );
  expect(stage.on.workflow_dispatch.inputs.request_engine_release.default).toBe(false);
  expect(stage.jobs.detect.if).toContain('!inputs.request_database_break');
  expect(stage.jobs['window-migrations'].if).toContain('!inputs.request_engine_release');
  const admission = stage.jobs.detect.steps.find((step: any) => step.id === 'admission');
  expect(admission.run).toContain('reader.owner_selection_policy(');
  const selection = stage.jobs.selection.steps.find((step: any) => step.id === 'freeze');
  expect(selection.run).toContain(
    '--owner-window "$OWNER_WINDOW_ID" --selection-run-id "$GITHUB_RUN_ID"'
  );
  const signal = stage.jobs.signal.steps.at(-1);
  expect(signal.run).toContain('client_payload[owner_window_id]=$OWNER_WINDOW_ID');
  const preparation = receiver.jobs.preflight.steps.find((step: any) => step.id === 'preparation');
  expect(preparation.run).toContain('selection_args=(--owner-window "$OWNER_WINDOW_ID")');
  expect(preparation.run).toContain('--selection-run-id "$SELECTION_RUN"');
});

describe('Stage emits a visible error annotation when keep-serving defers candidates', () => {
  const stage = parse(
    readFileSync(resolve(__dirname, '..', '.github/workflows/stage-engine-release.yml'), 'utf8')
  );
  const freeze = stage.jobs.selection.steps.find((step: any) => step.id === 'freeze');
  const serving = 'c'.repeat(40);
  const control = 'b'.repeat(40);
  const candidate = 'd'.repeat(40);

  function runFreeze(report: Record<string, unknown>) {
    const dir = mkdtempSync(join(tmpdir(), 'stage-freeze-h2-'));
    const output = join(dir, 'github-output');
    writeFileSync(output, '');
    const stub = join(dir, 'fake-select.json');
    writeFileSync(stub, JSON.stringify(report));
    const harness = `
curl() { printf '{"releaseSha":"${serving}"}'; }
python3() { cp "${stub}" daily-selection.json; return 0; }
`;
    try {
      const result = spawnSync('bash', ['-c', harness + freeze.run], {
        cwd: dir,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_RUN_ATTEMPT: '1',
          GITHUB_OUTPUT: output,
          GITHUB_REPOSITORY: 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena',
          GITHUB_SHA: control,
          GITHUB_RUN_ID: '12345',
          RELEASE_DATE: '2026-11-21',
          RELEASE_REQUIRED: 'true',
          OFFER_REASON: 'behind',
          OBSERVED_LIVE_SHA: serving,
          CUTOFF_CONTROL: control,
          OWNER_WINDOW_ID: '',
        },
      });
      return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        outputs: readFileSync(output, 'utf8'),
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('emits ::error:: with reason, detail and failing run id while preserving exit 0 for artifact upload', () => {
    const r = runFreeze({
      schema: 1,
      outcome: 'keep-serving',
      targetSha: null,
      controlSha: control,
      servingSha: serving,
      deferredCandidates: [
        {
          sha: candidate,
          reason: 'prequalification unavailable',
          detail:
            'latest qualification is incomplete, unsuccessful or untrusted (run 44878744051, status=completed, conclusion=failure)',
        },
      ],
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.outputs).toContain('send=false');
    expect(r.stdout).toContain(
      '::error title=Engine selection deferred candidate(s) (keep-serving)::'
    );
    expect(r.stdout).toContain(candidate.slice(0, 12));
    expect(r.stdout).toContain('prequalification unavailable');
    expect(r.stdout).toContain('run 44878744051');
  });

  it('does not emit ::error:: when a candidate is selected or no candidates were deferred', () => {
    const selected = runFreeze({
      schema: 1,
      outcome: 'selected',
      targetSha: candidate,
      controlSha: control,
      servingSha: serving,
      deferredCandidates: [],
    });
    expect(selected.status, selected.stderr).toBe(0);
    expect(selected.outputs).toContain('send=true');
    expect(selected.stdout).not.toContain('::error');

    const quietKeepServing = runFreeze({
      schema: 1,
      outcome: 'keep-serving',
      targetSha: null,
      controlSha: control,
      servingSha: serving,
      deferredCandidates: [],
    });
    expect(quietKeepServing.status, quietKeepServing.stderr).toBe(0);
    expect(quietKeepServing.outputs).toContain('send=false');
    expect(quietKeepServing.stdout).not.toContain('::error');
  });
});

describe('O20: Stage posts keep-serving cycles to issue #11599 without altering release authority', () => {
  const stage = parse(
    readFileSync(resolve(__dirname, '..', '.github/workflows/stage-engine-release.yml'), 'utf8')
  );
  const job = stage.jobs['cutover-log-keep-serving'];
  const serving = '735299cd5fda6b59c43d1379371d1a3dfb1a050f';
  const candidate = 'c0706e2b35631627a88dc26aec4bce830c3ec615';

  it('is reporting-only, gated to daily keep-serving on attempt 1, and holds no contents:write', () => {
    expect(job).toBeDefined();
    expect(job['continue-on-error']).toBe(true);
    expect(job.needs).toEqual(['detect', 'selection']);
    expect(job.permissions).toEqual({ actions: 'read', contents: 'read', issues: 'write' });
    expect(job.if).toContain("needs.detect.outputs.admission_allowed == 'true'");
    expect(job.if).toContain("needs.detect.outputs.daily_preparation == 'true'");
    expect(job.if).toContain("needs.selection.result == 'success'");
    expect(job.if).toContain("needs.selection.outputs.send != 'true'");
    expect(job.if).toContain('github.run_attempt == 1');
  });

  function runComment(releaseDate: string, selection: Record<string, unknown> | null) {
    const step = job.steps.find((s: any) => s.id === 'comment');
    expect(step).toBeDefined();
    const dir = mkdtempSync(join(tmpdir(), 'stage-log-o20-'));
    const postedFile = join(dir, 'posted.txt');
    const artifactDir = join(dir, 'selection-artifact');
    if (selection !== null) {
      mkdirSync(artifactDir, { recursive: true });
      writeFileSync(join(artifactDir, 'daily-selection.json'), JSON.stringify(selection));
    }
    const harness = `
gh() {
  printf '%s\\n' "$@" > "${postedFile}"
  return 0
}
`;
    try {
      const result = spawnSync('bash', ['-c', harness + step.run], {
        cwd: dir,
        encoding: 'utf8',
        env: {
          ...process.env,
          REPO: 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena',
          LOG_ISSUE: '11599',
          RELEASE_DATE: releaseDate,
          RUN_URL:
            'https://github.com/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/actions/runs/45134198393',
        },
      });
      let posted = '';
      try {
        posted = readFileSync(postedFile, 'utf8');
      } catch {
        posted = '';
      }
      return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        posted,
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('posts one KEEP-SERVING comment with cycle, serving SHA, reason, deferred details and never Sealed SHA', () => {
    const r = runComment('2026-11-23', {
      schema: 1,
      outcome: 'keep-serving',
      reason: 'no selectable candidate matched production schema',
      servingSha: serving,
      targetSha: null,
      deferredCandidates: [
        {
          sha: candidate,
          reason: 'backup copy schema mismatch',
          detail: 'copy held 20261123002808 absent from production',
        },
      ],
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.posted).toContain(
      'repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/issues/11599/comments'
    );
    expect(r.posted).toContain('Cycle: 2026-11-23 04:00 CST');
    expect(r.posted).toContain('Result: KEEP-SERVING (the serving engine keeps running)');
    expect(r.posted).toContain(`Serving SHA: \`${serving}\``);
    expect(r.posted).toContain('c0706e2b3563: backup copy schema mismatch');
    expect(r.posted).not.toContain('Sealed SHA:');

    const threeHourly = runComment('2026-11-23T01', {
      schema: 1,
      outcome: 'keep-serving',
      reason: 'current',
      servingSha: serving,
      targetSha: null,
      deferredCandidates: [],
    });
    expect(threeHourly.status, threeHourly.stderr).toBe(0);
    expect(threeHourly.posted).toContain('Cycle: 2026-11-23 01:00 CST');
    expect(threeHourly.posted).toContain('Deferred candidates: (none)');
  });

  it('skips posting when outcome is selected or the selection artifact is missing', () => {
    const selected = runComment('2026-11-23T10', {
      schema: 1,
      outcome: 'selected',
      servingSha: serving,
      targetSha: candidate,
      deferredCandidates: [],
    });
    expect(selected.status, selected.stderr).toBe(0);
    expect(selected.posted).toBe('');

    const missing = runComment('2026-11-23T10', null);
    expect(missing.status, missing.stderr).toBe(0);
    expect(missing.posted).toBe('');
    expect(missing.stdout).toContain('daily-selection.json missing');
  });
});
