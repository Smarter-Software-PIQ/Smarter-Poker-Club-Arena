/**
 * AN ACCOUNTING SUITE CARRIES ITS OWN PREREQUISITES (2026-11-07).
 *
 * The seven accounting shards are independent runners. A suite may only rely
 * on what its own shard's setup provides, never on another suite having run
 * earlier on the same runner. Run 42344546975 proved two hidden couplings
 * when the scoped launch reset moved from shard 1 to shard 7:
 *   - it compiles a PostgreSQL extension, and only shard 1's installer arm
 *     provided postgresql-server-dev-17 (postgres.h: No such file);
 *   - On-time starts on shard 1 resolved `typescript` from the root
 *     node_modules that the scoped launch reset's own `npm ci` created
 *     (ERR_MODULE_NOT_FOUND once it left).
 * Root dependencies are therefore common setup, and every suite that
 * compiles against the server headers must sit on a shard whose installer
 * arm installs them. Moving a suite can no longer silently break another.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';

type Step = { name: string; if?: string; run?: string; 'working-directory'?: string };
const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
const job = ci.jobs.accounting_postgres as {
  steps: Step[];
  strategy: { matrix: { shard: number[] } };
};
const steps = job.steps;
const shardsOf = (step: Step) =>
  [...String(step.if ?? '').matchAll(/matrix\.shard == (\d)/g)].map((m) => Number(m[1]));
const isSuite = (step: Step) => shardsOf(step).length > 0;

const COMPILES_AGAINST_SERVER_HEADERS = /PG_CONFIG=|postgres\.h|--includedir-server/;
const scriptRefs = (text: string) =>
  [...text.matchAll(/((?:scripts|tests|tools)\/[\w./@-]+\.(?:py|sh))/g)].map((m) => m[1]);
/** The step's own command, or a script it invokes directly, compiles against the headers. */
const compilesAgainstHeaders = (step: Step) => {
  const run = step.run ?? '';
  if (COMPILES_AGAINST_SERVER_HEADERS.test(run)) return true;
  return scriptRefs(run).some(
    (file) => existsSync(file) && COMPILES_AGAINST_SERVER_HEADERS.test(readFileSync(file, 'utf8'))
  );
};

/** Shards whose installer `case` arm installs postgresql-server-dev-17. */
const headerShards = (() => {
  const installer = steps.find((s) =>
    s.name.startsWith('Install PostgreSQL 17 tools without a default database service')
  )!;
  const shards = new Set<number>();
  const arms = String(installer.run).split(/\n\s{2}(?=[\d|*]+\))/);
  for (const arm of arms) {
    const label = /^([\d|]+)\)/.exec(arm.trim());
    if (!label) continue;
    if (/pg_ci_build_packages=\([^)]*postgresql-server-dev-17/.test(arm))
      for (const n of label[1].split('|')) shards.add(Number(n));
  }
  return shards;
})();

describe('every accounting suite carries its own prerequisites', () => {
  it('installs root dependencies as common setup before any suite', () => {
    const index = steps.findIndex((s) => s.name === 'Install root test dependencies');
    expect(index, 'root dependencies must be a named setup step').toBeGreaterThan(-1);
    const install = steps[index];
    expect(install.if, 'root install runs on every shard').toBeUndefined();
    expect(install['working-directory'], 'installs the repository root').toBeUndefined();
    expect(install.run?.trim()).toBe('npm ci --ignore-scripts');
    const firstSuite = steps.findIndex(isSuite);
    expect(index, 'root install precedes every suite').toBeLessThan(firstSuite);
  });

  it('knows which shards install the server headers', () => {
    // Read from the installer itself, so a changed arm changes the rule.
    expect([...headerShards].sort()).toEqual([1, 3, 4]);
  });

  it('keeps every suite that compiles against the server headers on such a shard', () => {
    const compiling = steps.filter((s) => isSuite(s) && compilesAgainstHeaders(s));
    expect(compiling.length, 'the rule must see the real compiling suites').toBeGreaterThan(0);
    expect(compiling.map((s) => s.name)).toContain(
      'Scoped launch reset preserves original money and reporting owners'
    );
    for (const step of compiling)
      for (const shard of shardsOf(step))
        expect(
          headerShards.has(shard),
          `${step.name} compiles against postgres.h on shard ${shard}`
        ).toBe(true);
  });

  it('detects the real coupling it was written for', () => {
    const scoped = steps.find((s) => s.name.startsWith('Scoped launch reset preserves'))!;
    expect(compilesAgainstHeaders(scoped)).toBe(true);
    const moved = { ...scoped, if: 'matrix.shard == 7' };
    expect(headerShards.has(shardsOf(moved)[0])).toBe(false);
  });
});
