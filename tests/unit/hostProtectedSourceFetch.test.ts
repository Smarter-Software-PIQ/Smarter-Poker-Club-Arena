import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('executes every host protected-source fetch with exact identity and fail-closed transport', () => {
  for (const file of [
    '.github/workflows/auto-deploy-hetzner.yml',
    'server/scripts/install-engine-supervisor.sh',
    'server/scripts/engine-release-transaction.sh',
  ])
    expect(readFileSync(file, 'utf8')).toContain('GIT_CONFIG_GLOBAL=/dev/null');
  const result = spawnSync('python3', ['-B', 'tests/operations/host-protected-source-fetch.py'], {
    encoding: 'utf8',
    timeout: 45000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(0);
}, 50000);
