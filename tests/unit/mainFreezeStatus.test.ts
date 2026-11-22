// Runs the fixture-only node:test suite for the main-freeze tooling
// (scripts/ci/main-freeze.mjs, scripts/ci/main-freeze-status.mjs) inside the
// required vitest run. No network: the suite injects a fake GitHub transport.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..', '..');

describe('main freeze states its owner window and its end', () => {
  it('passes the fixture suite', () => {
    const r = spawnSync(
      process.execPath,
      ['--test', '--test-reporter=tap', 'tests/operations/main-freeze-status.test.mjs'],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, NODE_OPTIONS: '' },
      }
    );
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/# pass 16\b/);
    expect(r.stdout + r.stderr).toMatch(/# fail 0\b/);
  }, 60_000);
});
