import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

describe('stall progress qualification', () => {
  it('executes the real PostgreSQL regression in the required accounting aggregate', () => {
    const workflow = parse(readFileSync(resolve('.github/workflows/ci.yml'), 'utf8'));
    const job = workflow.jobs.accounting_postgres;
    const steps = job.steps.filter((step: { run?: string }) =>
      step.run?.includes('python3 -B scripts/ci/test-stall-progress-proof.py')
    );
    expect(steps).toHaveLength(1);
    expect(steps[0].if).toBe('matrix.shard == 7');
    expect(steps[0]['continue-on-error']).toBeUndefined();
    expect(steps[0].env.PG_BIN).toBe('/usr/lib/postgresql/17/bin');
    expect(job.strategy.matrix.shard).toContain(7);
    expect(workflow.jobs.server.needs).toContain('accounting_postgres');
  });
});
