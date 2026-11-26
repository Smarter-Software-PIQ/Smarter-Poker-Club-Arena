import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { classifyChangedPaths } from '../../scripts/ci/classify-ci-changes.mjs';
const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');
describe('Spin cancellation reporting qualification', () => {
  it('runs the native regression in required accounting CI and admits every input', () => {
    const ci = parse(read('.github/workflows/ci.yml'));
    const steps = ci.jobs.accounting_postgres.steps.filter((s: { run?: string }) =>
      s.run?.includes('test-undrawn-spin-cancellation.py')
    );
    expect(steps).toHaveLength(1);
    expect(steps[0].if).toBe('matrix.shard == 4');
    expect(steps[0]['continue-on-error']).toBeUndefined();
    expect(read('scripts/ci/test-undrawn-spin-cancellation.py')).toContain(
      "str(ROOT/'scripts/ci/test-spin-cancellation-reporting-postgres.py')"
    );
    expect(read('scripts/ci/test-undrawn-spin-cancellation.py')).toContain('check=True');
    for (const path of [
      'supabase/migrations/20261126160519_spin_cancellation_readers_count_fee_and_reserve_reversals.sql',
      'scripts/ci/test-spin-cancellation-reporting-postgres.py',
      'scripts/ci/fixtures/spin-cancellation-reporting/current-readers.json',
      'scripts/ci/fixtures/spin-cancellation-reporting/setup.sql',
    ])
      expect(classifyChangedPaths([path]).server, path).toBe(true);
  });
});
