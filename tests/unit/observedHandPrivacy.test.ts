import { execFileSync } from 'node:child_process';
import { it, expect } from 'vitest';
it('qualifies observer authorization and public-only replay in real PostgreSQL', () => {
  const output = execFileSync('python3', ['scripts/ci/test-observed-hands-postgres.py'], {
    encoding: 'utf8',
    timeout: 55_000,
  });
  expect(output).toContain('public cards PASS');
}, 60_000);
