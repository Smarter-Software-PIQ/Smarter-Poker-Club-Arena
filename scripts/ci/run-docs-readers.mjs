// A DOCS CHANGE RUNS THE TESTS THAT READ IT (2026-11-22).
//
// classify-ci-changes.mjs skips the client unit suite and the server shards
// for a pull request that changes only docs/, so a docs-only pull request goes
// green in minutes. That is right for a plan nobody's test opens, and wrong for
// a file a test reads: the pull request skips the one check that reads the
// file it just changed, and main goes red on the next pull request that runs
// the suite.
//
// It happened three times. docs/laws.d/ (2026-09-20) and docs/evidence/
// (2026-10-11) were each closed by naming the directory in the classifier.
// Then on 2026-11-22 #11791 rewrote
// docs/horse-option-authority.d/holdemValueAndCallsArePriced.md as docs only:
// its state line lost the words "Evidence NOT MET" that
// tests/unit/holdemBlanketScoreboard.test.ts reads, the suite was skipped, and
// every pull request after it failed Client Unit Tests. When this was written
// the tests read 44 docs/ entries on the client side and 20 on the server
// side; the classifier named three.
//
// So instead of naming a fourth, the ungated compile job (typecheck_compile in
// ci.yml, behind the required TypeScript Check) runs exactly the tests that
// read a docs/ path this change touched, whenever the suite that holds them is
// skipped. The docs fast path stays fast: a plan nobody reads runs nothing.
//
// A test reads a docs/ path when the test file, or a scripts/ file it names,
// holds, in code rather than a comment, a literal for that path or a
// directory above it: 'docs/a/b.md', `docs/a/${name}.md`, or path pieces
// resolve(ROOT, 'docs', 'a'). A path assembled any other way is invisible
// here; write it as one of those.
//
// "Could not tell" is not "nothing to run" (CLAUDE.md 10.86): when the changed
// files cannot be read, the classifier admits every suite and this step has
// nothing to add; when a test cannot be read, the step fails.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const DOCS_LITERAL = /docs\/[A-Za-z0-9_.@/-]+/g;
const DOCS_PIECES =
  /['"`]docs['"`]\s*,\s*['"`]([A-Za-z0-9_.@-]+)['"`](?:\s*,\s*['"`]([A-Za-z0-9_.@-]+)['"`])?/g;
const SCRIPT_LITERAL = /scripts\/[A-Za-z0-9_./-]+\.(?:mjs|cjs|js|ts)\b/g;
const CLIENT_TEST = /^tests\/(?!_archive\/).+\.test\.tsx?$/;
const SERVER_TEST = /^server\/src\/(?:.+\.test\.ts|testing\/horseRegression\/.+\.test\.mjs)$/;

/** The source with its comments blanked: a comment citing a doc does not read it. */
export function withoutComments(source) {
  return String(source)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

/** Every docs/ path a source's code names, as a literal or as path pieces. */
export function docsLiterals(rawSource) {
  const source = withoutComments(rawSource);
  const out = new Set();
  for (const m of source.match(DOCS_LITERAL) || []) {
    const path = m.replace(/[./]+$/, '');
    if (path.length > 'docs/'.length) out.add(path);
  }
  for (const m of source.matchAll(DOCS_PIECES)) {
    out.add(m[2] ? `docs/${m[1]}/${m[2]}` : `docs/${m[1]}`);
  }
  return [...out];
}

/** Does a named path (a file, or a directory above it) cover the changed path? */
export function covers(literals, path) {
  return literals.some((l) => path === l || path.startsWith(`${l}/`));
}

function readSource(root, file) {
  return readFileSync(resolve(root, file), 'utf8');
}

/** The test files among `tests` that read any of `changedDocs`. */
export function readersOf(root, changedDocs, tests) {
  if (changedDocs.length === 0) return [];
  const scriptLiterals = new Map();
  const literalsOfScript = (script) => {
    if (!scriptLiterals.has(script)) {
      scriptLiterals.set(
        script,
        existsSync(resolve(root, script)) ? docsLiterals(readSource(root, script)) : []
      );
    }
    return scriptLiterals.get(script);
  };
  return tests.filter((test) => {
    const source = readSource(root, test);
    const literals = docsLiterals(source);
    for (const script of source.match(SCRIPT_LITERAL) || []) {
      literals.push(...literalsOfScript(script));
    }
    return changedDocs.some((path) => covers(literals, path));
  });
}

function tracked(root, dir) {
  return execFileSync('git', ['ls-files', '-z', '--', dir], { cwd: root, maxBuffer: 1 << 28 })
    .toString()
    .split('\0')
    .filter(Boolean);
}

/** The client and server tests a set of changed paths makes the step run. */
export function docsReaderPlan(root, paths, flags) {
  const changedDocs = paths.filter((p) => p.startsWith('docs/'));
  const clientSkipped = flags.src !== true && flags.tests !== true;
  const serverSkipped = flags.server !== true;
  return {
    changedDocs,
    client: clientSkipped
      ? readersOf(
          root,
          changedDocs,
          tracked(root, 'tests').filter((f) => CLIENT_TEST.test(f))
        )
      : [],
    server: serverSkipped
      ? readersOf(
          root,
          changedDocs,
          tracked(root, 'server').filter((f) => SERVER_TEST.test(f))
        )
      : [],
  };
}

function run(command, args, cwd) {
  console.log(`$ ${command} ${args.join(' ')}`);
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { classifyGitChanges } = await import('./classify-ci-changes.mjs');
  const result = classifyGitChanges({
    cwd: REPO_ROOT,
    base: process.env.CI_BASE_SHA,
    head: process.env.CI_HEAD_SHA,
  });
  if (!result.complete) {
    console.log('Changed files unavailable: every suite runs, so no docs reader needs adding.');
    process.exit(0);
  }
  const plan = docsReaderPlan(REPO_ROOT, result.paths, result.flags);
  console.log(
    `${plan.changedDocs.length} docs/ path(s) changed; ` +
      `${plan.client.length} client and ${plan.server.length} server test(s) read them ` +
      `and their suite is skipped.`
  );
  if (plan.client.length > 0) {
    run('npx', ['vitest', 'run', ...plan.client], REPO_ROOT);
  }
  if (plan.server.length > 0) {
    const server = resolve(REPO_ROOT, 'server');
    if (!existsSync(resolve(server, 'node_modules', 'vitest'))) {
      run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], server);
    }
    run('npx', ['vitest', 'run', ...plan.server.map((f) => f.slice('server/'.length))], server);
  }
}
