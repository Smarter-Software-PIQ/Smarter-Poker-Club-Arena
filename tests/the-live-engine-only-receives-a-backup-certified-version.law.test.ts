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
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function runHostGate(body: string, rc = 0, sha = SHA) {
  const dir = mkdtempSync(join(tmpdir(), 'backup-host-cert-'));
  scratch.push(dir);
  writeFileSync(join(dir, 'body'), body);
  writeFileSync(
    join(dir, 'curl'),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > '${dir}/calls'\ncat '${dir}/body'\nexit ${rc}\n`
  );
  chmodSync(join(dir, 'curl'), 0o755);
  const result = spawnSync('bash', ['-c', `${hostGate}\nrequire_backup_certificate`], {
    encoding: 'utf8',
    env: { PATH: `${dir}:${process.env.PATH}`, SHA: sha },
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
