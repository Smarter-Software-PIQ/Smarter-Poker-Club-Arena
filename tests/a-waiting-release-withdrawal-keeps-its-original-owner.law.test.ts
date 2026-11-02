import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parse } from 'yaml';

it(
  'qualifies exact waiting attempt admission and its original terminal signal boundary',
  () => {
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
          // Local Mac transport needs headroom; hosted Linux retains its limit.
          timeout: process.platform === 'darwin' ? 120000 : 60000,
        }
      );
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stderr).toContain('Ran 64 tests');
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
  },
  process.platform === 'darwin' ? 135000 : 75000
);

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
    { cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8' }
  );
  expect(original.status, original.stderr).toBe(0);
});
