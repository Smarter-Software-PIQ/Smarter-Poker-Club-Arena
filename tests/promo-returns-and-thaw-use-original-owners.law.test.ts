import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');
const promo = parse(read('.github/workflows/promo-play-through.yml'));
// The workflow is a required check (2026-11-17): its watched paths live in the
// relevance step, not in a pull_request path filter.
const promoPaths = (): string[] =>
  promo.jobs['promo-play-through'].steps
    .find((step: any) => step.id === 'relevant')
    .env.PROMO_PATHS.split('\n')
    .filter(Boolean);
describe('promo returns and expiry retain their original owners', () => {
  it('gives nested financial fixtures the short private runner directory in step scope', () => {
    expect(promo.jobs['promo-play-through'].env).toBeUndefined();
    const steps = promo.jobs['promo-play-through'].steps;
    const configure = steps.findIndex((step: any) =>
      step.run?.includes('"${RUNNER_TEMP:?}" >> "$GITHUB_ENV"')
    );
    expect(configure).toBeGreaterThanOrEqual(0);
    expect(steps[configure].run).toContain("printf 'TMPDIR=%s\\n'");
    for (const [index, step] of steps.entries()) {
      if (step.run?.includes('scripts/ci/')) expect(index).toBeGreaterThan(configure);
    }
    for (const name of [
      'test-promo-tournament-earning-generation.py',
      'test-promo-profit-bbj.py',
      'test-promo-profit-movements-financial.py',
      'test-promo-ticket-principal-returns.py',
      'test-promo-principal-returns.py',
    ]) {
      expect(steps.find((step: any) => step.run?.includes(name)).env.TMPDIR).toBe(
        '${{ runner.temp }}'
      );
    }
  });
  it('runs real journal and isolation proof after the promo stock builder', () => {
    const steps = promo.jobs['promo-play-through'].steps;
    const index = steps.findIndex((step: any) =>
      step.run?.includes('scripts/ci/test-promo-principal-returns.py')
    );
    expect(index).toBeGreaterThan(
      steps.findIndex((step: any) => step.run?.includes('scripts/ci/build_pg17_isolationtester.py'))
    );
    const proof = steps[index];
    // Only the required-check relevance gate may condition it (2026-11-17).
    expect(proof.if).toBe("steps.relevant.outputs.run == 'true'");
    expect(proof.run).toContain('--pg-bin /usr/lib/postgresql/17/bin');
    expect(proof.env.TMPDIR).toBe('${{ runner.temp }}');
    expect(proof.env.PG_ISOLATION_TESTER).toContain('postgresql-17-isolationtester/toolchain/');
    expect(proof.run).toContain('scripts/ci/test-promo-principal-returns.py');
    expect(
      steps.filter((step: any) => step.run?.includes('scripts/ci/build_pg17_isolationtester.py'))
    ).toHaveLength(1);
  });
  it('retains return evidence and original owner inputs in promo admission', () => {
    const steps = promo.jobs['promo-play-through'].steps;
    const artifacts = steps.find((step: any) => step.uses === 'actions/upload-artifact@v4').with
      .path;
    for (const path of ['RESULTS.json', 'source-manifest.json', '*race*.stdout', '*race*.stderr']) {
      expect(artifacts).toContain(`artifacts/promo-principal-returns/${path}`);
    }
    expect(promoPaths()).toContain('scripts/ci/test-promo-principal-returns.py');
    expect(promoPaths()).toContain('tests/fixtures/promo-principal-returns/**');
    expect(promoPaths()).toContain('tests/fixtures/promo-custody-inventory-pin.json');
    const owner = read('scripts/ci/test-promo-principal-returns.py');
    for (const name of [
      'self-stake.sql',
      'agent-send.sql',
      'claim-back.sql',
      'member-leave.sql',
      'current-financial-owners.json',
      'journal-owners.json',
      'disburse.sql',
    ]) {
      expect(owner).toContain(name);
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
    expect(promoPaths()).toContain('scripts/ci/test-promo-expiry-thaw.py');
    expect(
      steps.find((step: any) => step.uses === 'actions/upload-artifact@v4').with.path
    ).toContain('artifacts/promo-expiry-thaw/RESULTS.json');
  });
});
