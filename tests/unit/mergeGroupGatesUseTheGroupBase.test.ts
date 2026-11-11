import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';

// MERGE QUEUE (2026-11-11): a merge group has no GITHUB_BASE_REF, so every
// diff gate in typecheck_compile would otherwise fall back to HEAD~1 and check
// only the last commit. They receive the group's base explicitly instead, the
// base is proven to be an ancestor first, and pull requests are unchanged.
const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
const job = ci.jobs.typecheck_compile;
const GATES = [
  'check-migrations-applied',
  'check-diamond-contract-parity',
  'check-definer-authorization',
  'check-unqualified-writes',
  'check-lease-lock-strength',
  'check-accounting-week-lock-mode',
  'check-money-trigger-declared',
  'check-no-new-band-aids',
];

describe('merge group diff gates use the group base', () => {
  it('binds CA_GATE_BASE to the merge group base, empty on pull requests', () => {
    expect(job.env.CA_GATE_BASE).toBe('${{ github.event.merge_group.base_sha }}');
  });

  it('refuses a merge group whose base is not a commit that the checkout descends from', () => {
    const bind = job.steps.find(
      (s: { name?: string }) => s.name === 'Bind the merge group base for the diff gates'
    );
    expect(bind.if).toBe("github.event_name == 'merge_group'");
    expect(bind.run).toContain('^[0-9a-f]{40}$');
    expect(bind.run).toContain('git merge-base --is-ancestor "$CA_GATE_BASE" HEAD');
    expect(bind.run).toContain('"$(git rev-parse HEAD)"');
    const order = job.steps.map((s: { name?: string }) => s.name);
    const first = job.steps.findIndex((s: { run?: string }) =>
      GATES.some((g) => s.run?.includes(`scripts/ci/${g}.mjs`))
    );
    expect(order.indexOf(bind.name)).toBeLessThan(first);
  });

  it.each(GATES)('passes the group base to %s and only when it is set', (gate) => {
    const step = job.steps.find((s: { run?: string }) => s.run?.includes(`scripts/ci/${gate}.mjs`));
    expect(step.run).toMatch(
      new RegExp(
        `node scripts/ci/${gate}\\.mjs (--source )?\\$\\{CA_GATE_BASE:\\+"\\$CA_GATE_BASE"\\} 2>&1`
      )
    );
    const source = readFileSync(`scripts/ci/${gate}.mjs`, 'utf8');
    // The explicit argument wins over GITHUB_BASE_REF and the HEAD~1 fallback.
    expect(source).toMatch(/process\.argv\[2\]|find\(\(a\) => !a\.startsWith\('--'\)\)/);
  });

  it('expands to exactly one argument when set and none when empty', () => {
    const count = (value: string) =>
      spawnSync('bash', ['-c', 'set -- ${CA_GATE_BASE:+"$CA_GATE_BASE"}; echo "$#:$1"'], {
        env: { PATH: process.env.PATH, CA_GATE_BASE: value },
        encoding: 'utf8',
      }).stdout.trim();
    expect(count('')).toBe('0:');
    expect(count('a'.repeat(40))).toBe(`1:${'a'.repeat(40)}`);
  });

  it('lets an explicit base override the HEAD~1 fallback in the shared base reader', async () => {
    const { baseRef } = await import('../../scripts/ci/check-diamond-contract-parity.mjs');
    const saved = process.env.GITHUB_BASE_REF;
    delete process.env.GITHUB_BASE_REF;
    try {
      expect(baseRef(['--source', 'b'.repeat(40)])).toBe('b'.repeat(40));
      expect(baseRef(['--source'])).toBe('HEAD~1');
    } finally {
      if (saved !== undefined) process.env.GITHUB_BASE_REF = saved;
    }
  });
});
