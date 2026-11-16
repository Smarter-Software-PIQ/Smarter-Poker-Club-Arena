import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');
const ci = parse(read('.github/workflows/ci.yml'));
const promo = parse(read('.github/workflows/promo-play-through.yml'));
describe('promo returns and expiry retain their original owners', () => {
  it('runs real journal and isolation proof on accounting shard three after its existing builder', () => {
    const steps = ci.jobs.accounting_postgres.steps;
    const index = steps.findIndex((step: any) => step.id === 'promo_principal_returns');
    expect(index).toBeGreaterThan(
      steps.findIndex((step: any) => step.id === 'pg17_isolation_tool')
    );
    const proof = steps[index];
    expect(proof.if).toBe('matrix.shard == 3');
    expect(proof.env.PG_ISOLATION_TESTER).toContain('postgresql-17-isolationtester/toolchain/');
    expect(proof.run).toContain('scripts/ci/test-promo-principal-returns.py');
    expect(
      steps.filter((step: any) => step.run === 'python3 scripts/ci/build_pg17_isolationtester.py')
    ).toHaveLength(1);
  });
  it('retains return evidence and original owner inputs in accounting admission', () => {
    const steps = ci.jobs.accounting_postgres.steps;
    expect(
      steps.some((step: any) => step.with?.path === 'artifacts/promo-principal-returns/')
    ).toBe(true);
    const inputs = JSON.parse(read('scripts/ci/accounting-harness-reads.json')).files;
    expect(inputs).toContain('tests/fixtures/promo-custody-inventory-pin.json');
    for (const name of [
      'self-stake.sql',
      'agent-send.sql',
      'claim-back.sql',
      'member-leave.sql',
      'current-financial-owners.json',
      'journal-owners.json',
      'disburse.sql',
    ]) {
      expect(inputs).toContain(`tests/fixtures/promo-principal-returns/${name}`);
    }
  });
  it('runs the original bounded thaw proof and keeps notices and fee proofs connected', () => {
    const steps = promo.jobs['promo-play-through'].steps;
    for (const name of [
      'test-promo-expiry-thaw.py',
      'test-promo-notices.py',
      'test-promo-fee-basis.py',
    ]) {
      expect(steps.some((step: any) => step.run?.includes(name))).toBe(true);
    }
    expect(promo.on.pull_request.paths).toContain('scripts/ci/test-promo-expiry-thaw.py');
    expect(
      steps.find((step: any) => step.uses === 'actions/upload-artifact@v4').with.path
    ).toContain('artifacts/promo-expiry-thaw/RESULTS.json');
  });
});
