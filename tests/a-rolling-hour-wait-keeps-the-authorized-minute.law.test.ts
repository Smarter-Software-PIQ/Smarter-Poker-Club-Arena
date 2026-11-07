import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

// recovery-rolling-eligibility.py executes server/scripts/engine-release-transaction.sh
// and server/scripts/engine-release-seal.py; retain both transitive source bindings
// so the normal affected-test selector runs this law when either source changes.
const script = resolve('tests/operations/recovery-rolling-eligibility.py');
const cases = Array.from(
  readFileSync(script, 'utf8').matchAll(/^ {4}def (test_\w+)\(self\):/gm),
  ([, name]) => `RollingEligibility.${name}`
);
it('keeps all twelve independent native rolling-hour scenarios', () => {
  expect(cases).toHaveLength(12);
  expect(new Set(cases).size).toBe(cases.length);
});

// Each scenario has its own isolated seal and bounded shell commands. Give each
// native test the original process deadline without sharing it with eleven others.
it.each(cases)(
  'keeps authoritative rolling-hour eligibility: %s',
  (scenario) => {
    const result = spawnSync('python3', ['-B', script, scenario], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stderr).toContain('Ran 1 test');
  },
  35_000
);
