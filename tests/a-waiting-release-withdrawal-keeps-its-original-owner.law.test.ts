import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { parse } from 'yaml';

// Fixture transport is explicit preparation, separate from the unchanged
// network-free behavior deadline. The helper kills its owned transport group
// within90seconds; the outer process/hook retain cleanup/reporting headroom.
beforeAll(() => {
  const prepared = spawnSync(
    'python3',
    ['-B', 'tests/operations/waiting-engine-release-withdrawal.test.py', '--prepare-history'],
    {
      cwd: resolve(import.meta.dirname, '..'),
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      encoding: 'utf8',
      timeout: 95000,
    }
  );
  expect(prepared.error, prepared.stdout + prepared.stderr).toBeUndefined();
  expect(prepared.signal, prepared.stdout + prepared.stderr).toBeNull();
  expect(prepared.status, prepared.stdout + prepared.stderr).toBe(0);
}, 100000);

it('qualifies exact waiting attempt admission and its original terminal signal boundary', () => {
  const sentinel = mkdtempSync(join(tmpdir(), 'withdrawal-git-owner-'));
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))
  );
  try {
    const initialized = spawnSync('git', ['init', '--bare', '--template=', '-q', sentinel], {
      env: cleanEnv,
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(initialized.status, initialized.stderr).toBe(0);
    const originalHead = readFileSync(join(sentinel, 'HEAD'), 'utf8');
    const result = spawnSync(
      'python3',
      ['-B', 'tests/operations/waiting-engine-release-withdrawal.test.py'],
      {
        cwd: resolve(import.meta.dirname, '..'),
        env: {
          ...process.env,
          GIT_DIR: sentinel,
          GIT_WORK_TREE: sentinel,
          PYTHONDONTWRITEBYTECODE: '1',
        },
        encoding: 'utf8',
        // Local Mac transport needs headroom, and so does hosted Linux: CI
        // checks out with `filter: blob:none`, so every `git show <sha>:...`
        // of a historical source is a lazy blob fetch (60 s was exceeded on
        // busy runners with the cases themselves passing). A shared local Mac
        // under pre-push load took 90 to 110 s for 83 passing cases, and 236 s at
        // load 69 (2026-11-07). This is a hang guard, not a speed budget: the
        // cases read fixture clocks, so a slow host may only make them slow.
        timeout: 600000,
      }
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stderr).toContain('Ran 83 tests');
    expect(readFileSync(join(sentinel, 'HEAD'), 'utf8')).toBe(originalHead);
    const refs = spawnSync('git', ['--git-dir', sentinel, 'for-each-ref'], {
      env: cleanEnv,
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(refs.status, refs.stderr).toBe(0);
    expect(refs.stdout).toBe('');
  } finally {
    rmSync(sentinel, { recursive: true, force: true });
  }
}, 615000);

it('keeps the revoked off-cycle owner order closed', () => {
  const windows = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '../server/release/owner-maintenance-windows.json'),
      'utf8'
    )
  );
  expect(windows.version).toBe(1);
  // The withdrawn river order stays withdrawn. A later explicit owner order
  // for a different assignment is separately bounded and qualified by the
  // maintenance-window tests; it does not revive that revoked authority.
  expect(windows.windows.some((w: { id: string }) => w.id === '2026-10-23-river-nuts-v2')).toBe(
    false
  );
  expect(
    windows.windows.some(
      (w: { contains: string }) => w.contains === '6416f795ba314647f381856f1dd645be48920f22'
    )
  ).toBe(false);
});

it('withdrawal qualification reads its pinned original generation from full protected history', () => {
  const hydration = readFileSync(
    resolve(import.meta.dirname, 'operations/pinned-history-sources.py'),
    'utf8'
  );
  expect(hydration).toContain("GIT_NO_LAZY_FETCH='1'");
  const workflow = parse(
    readFileSync(
      resolve(import.meta.dirname, '../.github/workflows/auto-deploy-hetzner.yml'),
      'utf8'
    )
  );
  const steps = workflow.jobs['withdraw-waiting-release'].steps;
  const checkout = steps.find((step: { uses?: string }) => step.uses === 'actions/checkout@v4');
  const artifact = steps.find(
    (step: { uses?: string }) => step.uses === 'actions/upload-artifact@v4'
  );
  expect(artifact.if).toBe('always()');
  expect(artifact.with.path).toContain('artifacts/engine-withdrawal/receipt.json');
  expect(artifact.with.path).toContain('artifacts/engine-withdrawal/diagnostic.json');
  expect(artifact.with['if-no-files-found']).toBe('error');
  expect(checkout.with.ref).toBe('${{ github.sha }}');
  expect(checkout.with['fetch-depth']).toBe(0);
  expect(checkout.with['persist-credentials']).toBe(false);
  const original = spawnSync(
    'git',
    [
      'cat-file',
      '-e',
      'bd11ad35ca27843fd2f4910e5a8fc6a76d8c9d4e:server/release/activation-floor.json',
    ],
    {
      cwd: resolve(import.meta.dirname, '..'),
      env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1' },
      encoding: 'utf8',
      timeout: 10000,
    }
  );
  expect(original.status, original.stderr).toBe(0);
});
