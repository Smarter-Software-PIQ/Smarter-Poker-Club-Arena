#!/usr/bin/env node
/**
 * Fast Exact-Candidate Local Pre-Push Selector for Strictly Isolated Non-Engine Paths.
 *
 * Fail-closed classifier used by `.husky/pre-push` and `scripts/agent-push.sh`:
 * returns `fast: true` ONLY when EVERY changed path in the push falls strictly inside
 * proven non-runtime paths:
 *   1. `scripts/ops/**` (strictly allowlisted non-SQL extensions; NEVER `.sql` or `.sql.template`)
 *   2. `tests/unit/**` (non-PG, non-E2E unit/law test files; NEVER `*.pg.test.*`, `*.e2e.*`, `*.spec.*`, `*.pw.*`)
 *   3. `docs/**.md` (non-policy Markdown docs; NEVER `docs/agent-policy/**`)
 *   4. `server/src/benchmark/**` (`.ts`, `.mjs`, `.json`, `.md`) and exact standalone CLI
 *      `server/src/scripts/horseLeagueCard.ts` (plus `server/src/scripts/horseLeagueCard.test.ts`)
 *
 * ANY single path outside this allowlist — including ANY runtime engine, lightning, services,
 * tournament, client `src/**`, `supabase/**`, `.github/**`, `scripts/ci/**`, `scripts/release/**`,
 * `server/release/**`, `package*.json`, `tsconfig*.json`, `.husky/**`, `docs/agent-policy/**` —
 * or an empty/unreadable/malformed path list FAILS CLOSED (`fast: false`) so the full unchanged
 * local pre-push suite executes.
 *
 * GitHub CI is never modified by this module and always runs 100% of required checks.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FAST_NONENGINE_CATEGORIES = Object.freeze(['ops', 'unit-tests', 'docs', 'benchmark']);

const OPS_ALLOWED_RE = /^scripts\/ops\/.+\.(?:mjs|cjs|js|ts|mts|py|sh|md|json|tsv|txt)$/;
const OPS_SQL_EXCLUDED_RE = /\.sql(?:\.template)?$/i;

const UNIT_TEST_ALLOWED_RE = /^tests\/unit\/.+\.(?:law\.)?test\.(?:ts|tsx|mjs)$/;
const UNIT_TEST_EXCLUDED_RE = /\.(?:pg|e2e|pw)\.test\.|\.(?:spec|pw)\./;

const DOCS_ALLOWED_RE = /^docs\/.+\.md$/;
const DOCS_POLICY_EXCLUDED_RE = /^docs\/agent-policy\//;

const BENCHMARK_ALLOWED_RE = /^server\/src\/benchmark\/.+\.(?:ts|mjs|json|md)$/;
const EXACT_BENCHMARK_SCRIPTS = new Set([
  'server/src/scripts/horseLeagueCard.ts',
  'server/src/scripts/horseLeagueCard.test.ts',
]);

const SERVER_TEST_RE = /^server\/src\/.+\.(?:law\.)?test\.(?:ts|mjs)$/;
const SERVER_TS_RE = /^server\/src\/.+\.ts$/;

/**
 * Validate a repo-relative POSIX path strictly (fail-closed against traversal, NULs, whitespace).
 * @param {unknown} value
 * @returns {value is string}
 */
export function isValidRepoRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value !== value.trim()) return false;
  if (/[\0\r\n\\]/.test(value)) return false;
  if (value.startsWith('/') || value.endsWith('/')) return false;
  const parts = value.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return false;
  return true;
}

/**
 * Classify a single repo-relative path into an allowlisted non-engine category, or `null` to fail closed.
 * @param {string} path
 * @returns {'ops' | 'unit-tests' | 'docs' | 'benchmark' | null}
 */
export function classifyFastPath(path) {
  if (!isValidRepoRelativePath(path)) return null;

  if (OPS_ALLOWED_RE.test(path) && !OPS_SQL_EXCLUDED_RE.test(path)) {
    return 'ops';
  }

  if (UNIT_TEST_ALLOWED_RE.test(path) && !UNIT_TEST_EXCLUDED_RE.test(path)) {
    return 'unit-tests';
  }

  if (DOCS_ALLOWED_RE.test(path) && !DOCS_POLICY_EXCLUDED_RE.test(path)) {
    return 'docs';
  }

  if (BENCHMARK_ALLOWED_RE.test(path) || EXACT_BENCHMARK_SCRIPTS.has(path)) {
    return 'benchmark';
  }

  return null;
}

/**
 * Resolve exact companion server test files (relative to `server/`) for a changed benchmark source file.
 * @param {string} repoPath
 * @param {string | null} root
 * @returns {string[]}
 */
export function exactCompanionServerTests(repoPath, root = null) {
  const candidates = [];

  if (repoPath === 'server/src/scripts/horseLeagueCard.ts') {
    candidates.push(
      'server/src/benchmark/HorseLeagueCard.test.ts',
      'server/src/scripts/horseLeagueCard.test.ts'
    );
  } else if (
    /^server\/src\/benchmark\/.+\.(?:ts|mjs)$/.test(repoPath) &&
    !SERVER_TEST_RE.test(repoPath) &&
    !repoPath.endsWith('.d.ts')
  ) {
    const stem = repoPath.replace(/\.(?:ts|mjs)$/, '');
    candidates.push(`${stem}.test.ts`, `${stem}.law.test.ts`, `${stem}.test.mjs`);
  }

  const out = [];
  for (const candidate of candidates) {
    if (root && !existsSync(join(root, candidate))) continue;
    out.push(candidate.slice('server/'.length));
  }
  return out;
}

/**
 * Evaluate whether a push candidate qualifies for strictly isolated non-engine fast local pre-push.
 *
 * Strictly fail-closed: returns `fast: false` for empty, non-array, malformed, or mixed diffs.
 *
 * @param {string[]} paths
 * @param {{ root?: string | null }} [options]
 */
export function selectFastNonEnginePrepush(paths, options = {}) {
  const root = options.root ? resolve(options.root) : null;
  const failClosed = (reason, blockedPaths = [], categories = []) => ({
    fast: false,
    reason,
    categories,
    blockedPaths,
    exactServerTests: [],
    needsServerTsc: false,
    needsLawRegistry: false,
    needsPhantomTableCheck: false,
  });

  if (!Array.isArray(paths) || paths.length === 0) {
    return failClosed('empty_or_invalid_paths');
  }

  const normalized = [];
  for (const p of paths) {
    if (!isValidRepoRelativePath(p)) {
      return failClosed('malformed_path', [String(p)]);
    }
    normalized.push(p);
  }

  const uniquePaths = [...new Set(normalized)].sort();
  const categories = new Set();
  const blockedPaths = [];

  for (const p of uniquePaths) {
    const category = classifyFastPath(p);
    if (category === null) {
      blockedPaths.push(p);
    } else {
      categories.add(category);
    }
  }

  if (blockedPaths.length > 0) {
    return failClosed('path_outside_nonengine_allowlist', blockedPaths, [...categories].sort());
  }

  const exactServerTests = new Set();
  let needsServerTsc = false;
  let needsPhantomTableCheck = false;

  for (const p of uniquePaths) {
    if (SERVER_TS_RE.test(p)) {
      needsServerTsc = true;
    }

    if (SERVER_TEST_RE.test(p)) {
      if (!root || existsSync(join(root, p))) {
        exactServerTests.add(p.slice('server/'.length));
      }
    } else if (p.startsWith('server/src/')) {
      for (const companion of exactCompanionServerTests(p, root)) {
        exactServerTests.add(companion);
      }
      if (root && existsSync(join(root, p))) {
        try {
          const content = readFileSync(join(root, p), 'utf8');
          if (/(?<!storage)\.from\s*\(|\.\s*rpc\s*\(/.test(content)) {
            needsPhantomTableCheck = true;
          }
        } catch {
          // If a changed server file cannot be read, fail closed on the phantom-table guard.
          needsPhantomTableCheck = true;
        }
      }
    }
  }

  const hasExecutableOrLawInput = uniquePaths.some(
    (p) =>
      p.startsWith('scripts/ops/') ||
      p.startsWith('tests/unit/') ||
      p.startsWith('server/src/') ||
      p.startsWith('docs/laws.d/')
  );

  return {
    fast: true,
    reason: 'strictly_isolated_nonengine_paths',
    categories: [...categories].sort(),
    blockedPaths: [],
    exactServerTests: [...exactServerTests].sort(),
    needsServerTsc,
    needsLawRegistry: hasExecutableOrLawInput,
    needsPhantomTableCheck,
  };
}

function parseCliArgs(argv) {
  let mode = 'plan';
  let root = null;
  let useStdin = false;
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--is-fast') {
      mode = 'is-fast';
    } else if (arg === '--plan') {
      mode = 'plan';
    } else if (arg === '--shell-vars') {
      mode = 'shell-vars';
    } else if (arg === '--stdin') {
      useStdin = true;
    } else if (arg === '--root') {
      const next = argv[++i];
      if (!next) throw new Error('--root requires a directory argument');
      root = next;
    } else if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  let paths = positional;
  if (useStdin) {
    const raw = readFileSync(0, 'utf8');
    paths = raw
      .split('\n')
      .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
      .filter((line) => line.length > 0);
  }

  return { mode, root, paths };
}

function main(argv) {
  const { mode, root, paths } = parseCliArgs(argv);
  const verdict = selectFastNonEnginePrepush(paths, { root });

  if (mode === 'is-fast') {
    process.exitCode = verdict.fast ? 0 : 1;
    return;
  }

  if (mode === 'shell-vars') {
    console.log(`FAST=${verdict.fast ? 'yes' : 'no'}`);
    console.log(`REASON=${verdict.reason}`);
    console.log(`CATEGORIES=${verdict.categories.join(',')}`);
    console.log(`NEEDS_SERVER_TSC=${verdict.needsServerTsc ? 'yes' : 'no'}`);
    console.log(`NEEDS_LAW_REGISTRY=${verdict.needsLawRegistry ? 'yes' : 'no'}`);
    console.log(`NEEDS_PHANTOM_TABLES=${verdict.needsPhantomTableCheck ? 'yes' : 'no'}`);
    for (const testPath of verdict.exactServerTests) {
      console.log(`EXACT_SRV_TEST=${testPath}`);
    }
    return;
  }

  console.log(JSON.stringify(verdict, null, 2));
}

let isEntrypoint = false;
if (process.argv[1]) {
  try {
    isEntrypoint = realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    isEntrypoint = resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  }
}
if (isEntrypoint) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(
      `[prepush-fast-selector] fail-closed error: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exitCode = 1;
  }
}
