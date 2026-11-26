/**
 * LAW - CLIENT LINT NEVER GETS WORSE
 *
 * Until 2026-11-26 no CI job linted the client; eslint ran only on staged files
 * at commit time. That day `eslint src/` reported 0 errors and 1,089 warnings.
 * .github/workflows/client-lint-ratchet.yml now fails a pull request with any
 * error or more warnings than MAX_WARNINGS. This law keeps the workflow in
 * place and keeps the cap from rising: it may only be lowered as warnings are
 * fixed.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const CAP_ON_2026_11_26 = 1089;
const wf = parse(
  readFileSync(join(__dirname, '..', '.github', 'workflows', 'client-lint-ratchet.yml'), 'utf8')
);
const job = wf.jobs.lint;

describe('LAW: client lint never gets worse', () => {
  it('runs on every pull request that changes the client', () => {
    expect(wf.on.pull_request.paths).toContain('src/**');
  });

  it('lints all of src and fails on any error or a warning over the cap', () => {
    const lint = job.steps.find((s: { run?: string }) => /eslint/.test(s.run ?? ''));
    expect(lint?.run).toMatch(/npx eslint src\/ --max-warnings "\$MAX_WARNINGS"/);
    expect(lint?.run).not.toMatch(/--quiet|continue-on-error|\|\|\s*true/);
    expect(lint?.['continue-on-error']).toBeUndefined();
  });

  it('the warning cap may only fall', () => {
    const cap = Number(job.env.MAX_WARNINGS);
    expect(Number.isInteger(cap)).toBe(true);
    expect(cap).toBeGreaterThanOrEqual(0);
    expect(cap).toBeLessThanOrEqual(CAP_ON_2026_11_26);
  });
});
