/**
 * LAW: A DOCS CHANGE RUNS THE TESTS THAT READ IT (2026-11-22).
 *
 * A docs-only pull request skips the client unit suite and the server shards.
 * On 2026-11-22 #11791 changed only
 * docs/horse-option-authority.d/holdemValueAndCallsArePriced.md, dropped the
 * words "Evidence NOT MET" that tests/unit/holdemBlanketScoreboard.test.ts
 * reads, skipped that test, and every later pull request failed Client Unit
 * Tests. docs/laws.d/ (2026-09-20) and docs/evidence/ (2026-10-11) had done
 * the same and were each named by hand in the classifier.
 *
 * The ungated compile job now runs the tests that read a changed docs/ path
 * whenever their suite is skipped (scripts/ci/run-docs-readers.mjs).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(__dirname, '..');
const load = (rel: string) => import(/* @vite-ignore */ pathToFileURL(resolve(ROOT, rel)).href);
const BROKE_MAIN = 'docs/horse-option-authority.d/holdemValueAndCallsArePriced.md';

describe('a docs change runs the tests that read it', () => {
  it('the change that broke main on 2026-11-22 runs the client test it broke', async () => {
    const { docsReaderPlan } = await load('scripts/ci/run-docs-readers.mjs');
    const { classifyChangedPaths } = await load('scripts/ci/classify-ci-changes.mjs');
    const flags = classifyChangedPaths([BROKE_MAIN]);
    expect(flags.tests).toBe(false);
    const plan = docsReaderPlan(ROOT, [BROKE_MAIN], flags);
    expect(plan.client).toContain('tests/unit/holdemBlanketScoreboard.test.ts');
  });

  it('a doc only the whole-tree sweep reads runs only that, and a running suite is not run twice', async () => {
    const { docsReaderPlan } = await load('scripts/ci/run-docs-readers.mjs');
    // Spelled in two pieces so this file does not itself read the path.
    const unread = ['doc', 's/nobody-reads-this/README.md'].join('');
    const quiet = docsReaderPlan(ROOT, [unread], {});
    expect(quiet.client).toEqual(['tests/unit/theDeployDocsNameTheLiveRoute.test.ts']);
    expect(quiet.server).toEqual([]);
    const running = docsReaderPlan(ROOT, [BROKE_MAIN], { tests: true, server: true });
    expect(running.client).toEqual([]);
    expect(running.server).toEqual([]);
  });

  it('a sweep no scanner can see is found by its declaration, and honours its skips', async () => {
    const { declaredDocs, sourceReads, docsReaderPlan } = await load(
      'scripts/ci/run-docs-readers.mjs'
    );
    // The marker is assembled so this file does not itself declare a sweep.
    const marker = ['@reads', '-docs:'].join('');
    const declared = declaredDocs(
      `// ${marker} docs !docs/changelog/ src/not-docs\n/* ${marker} docs/laws.d */`
    );
    expect(declared).toEqual({ reads: ['docs', 'docs/laws.d'], skips: ['docs/changelog'] });
    expect(sourceReads([], declared, 'docs/runbooks/x.md')).toBe(true);
    expect(sourceReads([], declared, 'docs/changelog/x.md')).toBe(false);
    // A declared skip wins over a literal the walker names in order to skip it.
    expect(sourceReads(['docs/changelog'], declared, 'docs/changelog/x.md')).toBe(false);
    // The deploy-docs law walks every doc from the repository root.
    const deploy = 'tests/unit/theDeployDocsNameTheLiveRoute.test.ts';
    const plan = (path: string) => docsReaderPlan(ROOT, [path], {}).client as string[];
    expect(plan(['doc', 's/club-operations/OPERATIONS-UPGRADE-PLAN.md'].join(''))).toContain(
      deploy
    );
    expect(plan(['doc', 's/handoffs/anything.md'].join(''))).not.toContain(deploy);
  });

  it('reads literals, templates and path pieces, but not comments', async () => {
    const { docsLiterals, covers } = await load('scripts/ci/run-docs-readers.mjs');
    const literals = docsLiterals(
      [
        '// docs/changelog/cited-only.md',
        '/* docs/laws.d */',
        "const a = readFileSync('docs/LAWS.md');",
        'const b = `docs/horse-option-authority.d/${option}.md`;',
        "const c = resolve(ROOT, 'docs', 'evidence', 'phase13');",
        "const d = 'https://example.com/x'; const e = 'docs/runbooks/';",
      ].join('\n')
    );
    expect(literals).toContain('docs/LAWS.md');
    expect(literals).toContain('docs/horse-option-authority.d');
    expect(literals).toContain('docs/evidence/phase13');
    expect(literals).toContain('docs/runbooks');
    expect(literals).not.toContain('docs/changelog/cited-only.md');
    expect(literals).not.toContain('docs/laws.d');
    expect(covers(['docs/runbooks'], 'docs/runbooks/x.md')).toBe(true);
    expect(covers(['docs/runbooks'], 'docs/runbooks-old/x.md')).toBe(false);
  });

  it('a test that reads docs through a script it names is a reader', async () => {
    const { readersOf } = await load('scripts/ci/run-docs-readers.mjs');
    // holdemBlanketScoreboard.test.ts reads the authority docs through
    // scripts/ops/holdem-blanket-scoreboard-lib.mjs.
    expect(readersOf(ROOT, [BROKE_MAIN], ['tests/unit/holdemBlanketScoreboard.test.ts'])).toEqual([
      'tests/unit/holdemBlanketScoreboard.test.ts',
    ]);
  });

  it('runs in the ungated compile job behind the required TypeScript Check', () => {
    const ci = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8');
    const job = (name: string) => {
      const start = ci.search(new RegExp(`^ {2}${name}:\\s*$`, 'm'));
      expect(start, `ci.yml has no ${name} job`).toBeGreaterThan(-1);
      const rest = ci.slice(start + 1);
      const end = rest.search(/^ {2}[A-Za-z0-9_-]+:\s*$/m);
      return end < 0 ? rest : rest.slice(0, end);
    };
    const compile = job('typecheck_compile');
    expect(compile).toContain('- name: A docs change runs the tests that read it');
    expect(compile).toContain('run: node scripts/ci/run-docs-readers.mjs');
    // Gated only on being a pull request, never on what changed.
    expect(compile).not.toMatch(/^ {4}(?:if|needs):.*changes/m);
    const step = compile.slice(
      compile.indexOf('- name: A docs change runs the tests that read it')
    );
    expect(step.slice(0, step.indexOf('run:'))).not.toMatch(/^ {8}if:/m);
    expect(job('typecheck')).toMatch(/^ {4}needs: \[typecheck_compile,/m);
  });
});
