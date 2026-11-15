import { execFileSync } from 'node:child_process';
import { it, expect } from 'vitest';
it('an undealable pool uses the existing drain without waiting through population dwell', () => {
  expect(
    execFileSync('python3', ['scripts/ci/test-lightning-undealable-dwell-postgres.py'], {
      encoding: 'utf8',
      timeout: 55_000,
    })
  ).toContain('always-on preserved PASS');
}, 60_000);
