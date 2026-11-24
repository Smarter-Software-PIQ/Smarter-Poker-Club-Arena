// HOW WIDE IS THIS ENGINE CHANGE? (2026-11-24)
//
// The pre-push server gate ends with `vitest related --run <changed source>`.
// For a leaf file that is a handful of tests. For a file most of the engine
// imports it is nearly the whole server project: on 2026-11-22 two pushes that
// changed server/src/engine/HorseLogic.ts spent 41 of their 49 and 54 minutes
// in that one stage (1,503 test files), against a 60 minute cap, while every
// other lane waited on the one push lock. The required hosted check
// `Server Engine (typecheck + tests)` runs the whole server project, all four
// shards, for any pull request that changes a path under server/, so that
// crawl ran twice on the same commit.
//
// This script answers two questions for the hook and decides nothing itself:
//   HOSTED_SERVER=yes|no  the hosted classifier admits the Server Engine shards
//                         for exactly these changed paths
//   COUNT=<n>             server test files that reach a changed source file
//                         through static imports (the files `related` selects)
// The hook leaves the crawl to the hosted check only when HOSTED_SERVER=yes and
// COUNT is above its limit. Any error prints nothing and exits non-zero, which
// the hook reads as "run the crawl here".
//
// The count is a static walk of import / export-from / dynamic import() /
// require() specifiers under server/src (type-only imports excluded). A specifier it cannot resolve is
// ignored, which can only make the count smaller, and a smaller count keeps the
// local crawl. It never executes a test and never reads outside the tree.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCE_FILE = /\.(?:ts|mts|mjs|js)$/;
const TEST_FILE = /\.test\.(?:ts|mjs)$/;
const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"\n]+)\1/g;
// A type-only import or re-export is erased before the test runs, so `related`
// does not follow it and neither does this walk.
const TYPE_ONLY = /\b(?:import|export)\s+type\s[^;'"]*?\bfrom\s*(['"])[^'"\n]+\1/g;

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && SOURCE_FILE.test(entry.name) && !entry.name.endsWith('.d.ts'))
      out.push(full);
  }
  return out;
}

function resolveSpecifier(fromFile, specifier, known) {
  const base = resolve(dirname(fromFile), specifier);
  const stem = base.replace(/\.(?:js|mjs|ts|mts)$/, '');
  const candidates = [
    base,
    stem + '.ts',
    stem + '.mts',
    stem + '.mjs',
    stem + '.js',
    join(base, 'index.ts'),
    join(base, 'index.mjs'),
    join(base, 'index.js'),
  ];
  for (const candidate of candidates) if (known.has(candidate)) return candidate;
  return null;
}

/**
 * Server test files (relative to serverRoot, forward slashes) that reach any of
 * `changed` (relative to serverRoot) through static imports, the changed files
 * themselves excluded unless they are tests.
 */
export function relatedServerTests(serverRoot, changed) {
  const root = resolve(serverRoot);
  const files = walk(join(root, 'src'), []);
  const known = new Set(files);
  const importers = new Map();
  for (const file of files) {
    const text = readFileSync(file, 'utf8').replace(TYPE_ONLY, '');
    for (const match of text.matchAll(SPECIFIER)) {
      const target = resolveSpecifier(file, match[2], known);
      if (!target || target === file) continue;
      let set = importers.get(target);
      if (!set) importers.set(target, (set = new Set()));
      set.add(file);
    }
  }
  const seen = new Set();
  const queue = [];
  for (const rel of changed) {
    const full = resolve(root, rel);
    if (known.has(full) && !seen.has(full)) {
      seen.add(full);
      queue.push(full);
    }
  }
  while (queue.length) {
    const file = queue.pop();
    for (const importer of importers.get(file) || []) {
      if (seen.has(importer)) continue;
      seen.add(importer);
      queue.push(importer);
    }
  }
  return [...seen]
    .filter((file) => TEST_FILE.test(file))
    .map((file) => relative(root, file).split(sep).join('/'))
    .sort();
}

export async function engineRelatedVerdict(treeTop, changedPaths) {
  const top = resolve(treeTop);
  const { classifyChangedPaths } = await import(
    pathToFileURL(join(top, 'scripts/ci/classify-ci-changes.mjs')).href
  );
  const flags = classifyChangedPaths(changedPaths);
  const serverSource = changedPaths
    .filter((p) => /^server\/src\/.+\.(?:ts|mjs)$/.test(p) && !p.endsWith('.d.ts'))
    .filter((p) => !TEST_FILE.test(p))
    .map((p) => p.slice('server/'.length));
  const tests = relatedServerTests(join(top, 'server'), serverSource);
  return { hostedServer: flags.server === true, count: tests.length, tests };
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const args = process.argv.slice(2);
    const rootAt = args.indexOf('--root');
    if (rootAt < 0 || !args[rootAt + 1]) throw new Error('--root <tree top> is required');
    const treeTop = args[rootAt + 1];
    const paths = args.filter((_, i) => i !== rootAt && i !== rootAt + 1);
    if (!statSync(join(treeTop, 'server', 'src')).isDirectory()) throw new Error('no server/src');
    const verdict = await engineRelatedVerdict(treeTop, paths);
    process.stdout.write(
      `HOSTED_SERVER=${verdict.hostedServer ? 'yes' : 'no'}\nCOUNT=${verdict.count}\n`
    );
  } catch (error) {
    process.stderr.write(`[prepush-engine-related-count] ${error?.message || error}\n`);
    process.exit(2);
  }
}
