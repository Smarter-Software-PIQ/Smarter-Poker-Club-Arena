/**
 * THE DAILY SELECTION CAN READ ITS OWN DEPENDENCIES (2026-11-09).
 *
 * The 03:30 Chicago preparation for 2026-11-09 produced
 * outcome "blocked", targetSha null, and this reason:
 *
 *   [Errno 2] No such file or directory:
 *   '/home/runner/work/.../server/standby/schema-evidence.py'
 *
 * Nothing was wrong with any candidate. The selection job checks out the
 * repository SPARSELY - scripts/ci and server/scripts - and #10113 had just
 * made the selector depend on server/standby/schema-evidence.py, which that
 * list does not include. So the engine was not replaced that night, the
 * current engine kept serving (correctly: a selection that cannot decide
 * never offers a release), and the same failure would have recurred every
 * night until the list was corrected. Re-running does not help either: the
 * step refuses attempt 2 to retain the original decision.
 *
 * The lesson is CLAUDE.md 10.86 rule 4, a fix that leaves the same trap one
 * level up: the selector correctly replaced a clock test with a contents
 * test, and the contents test lives in a directory the job cannot see.
 *
 * This test walks the chain the selection step actually executes and asserts
 * that every repository path it opens FROM THE FILESYSTEM is inside the
 * sparse set, so adding a dependency to the chain cannot quietly leave the
 * job unable to read it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';

const ROOT = resolve(__dirname, '../..');
const WORKFLOW = '.github/workflows/stage-engine-release.yml';
const FREEZE_STEP = 'Freeze the exact daily candidate and report inclusion';

/** The selection chain: the entry point and every file it loads by path. */
const CHAIN = [
  'scripts/ci/select-daily-engine.py',
  'server/scripts/engine-release-installed-migrations.py',
];

/** `Path(__file__).resolve().parents[N] / 'a/b/c.py'` and the plain-string form. */
const REPO_PATH = /parents\[\d+\]\s*\/\s*'([^']+)'/g;

function sparseSetFor(stepName: string): string[] {
  const wf = parse(readFileSync(join(ROOT, WORKFLOW), 'utf8')) as {
    jobs: Record<string, { steps?: Array<Record<string, unknown>> }>;
  };
  for (const job of Object.values(wf.jobs ?? {})) {
    const steps = job.steps ?? [];
    if (!steps.some((s) => s.name === stepName)) continue;
    const checkout = steps.find((s) => String(s.uses ?? '').startsWith('actions/checkout@'));
    expect(checkout, `${stepName}: the job checks out the repository`).toBeTruthy();
    const using = (checkout as { with?: Record<string, unknown> }).with ?? {};
    const sparse = using['sparse-checkout'];
    // A full checkout can read everything, and needs no list.
    if (sparse === undefined) return ['.'];
    return String(sparse)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }
  throw new Error(`${WORKFLOW} has no job containing the step "${stepName}"`);
}

function covered(path: string, sparse: string[]): boolean {
  return sparse.some((prefix) => prefix === '.' || path === prefix || path.startsWith(prefix + '/'));
}

describe('the daily selection can read its own dependencies', () => {
  it('every file the selection chain opens by path is inside the sparse checkout', () => {
    const sparse = sparseSetFor(FREEZE_STEP);
    expect(sparse.length, 'the sparse list is readable').toBeGreaterThan(0);

    const needed = new Set<string>(CHAIN);
    for (const file of CHAIN) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      for (const match of source.matchAll(REPO_PATH)) needed.add(match[1]);
    }

    // The regression itself, named so a reader knows what this is about.
    expect(needed, 'the chain still loads the schema evidence by path').toContain(
      'server/standby/schema-evidence.py'
    );

    const missing = [...needed].filter((path) => !covered(path, sparse));
    expect(
      missing,
      `${WORKFLOW} sparse-checkout [${sparse.join(', ')}] cannot read: ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('the step still refuses a second attempt, so a re-run cannot rewrite the decision', () => {
    const wf = readFileSync(join(ROOT, WORKFLOW), 'utf8');
    expect(wf).toMatch(/GITHUB_RUN_ATTEMPT" = 1 \]/);
    expect(wf).toMatch(/Daily selection already attempted/);
  });
});
