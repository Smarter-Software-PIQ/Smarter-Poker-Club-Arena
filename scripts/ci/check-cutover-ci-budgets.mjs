#!/usr/bin/env node
/**
 * CUTOVER CI BUDGET GUARD — test-file size/split budgets & server/ Docker
 * build context hygiene.
 *
 * Enforces four shift-left invariants so PR CI and post-merge Engine
 * Prequalification stay fast and Docker image builds stay lean:
 *   1. `server/.dockerignore` keeps strictly positive glob rules (matching
 *      `scripts/ci/engine-source-identity.sh`) and excludes all test,
 *      test-support, `src/testing`, and `src/benchmark/fixtures` paths.
 *   2. Non-dockerignored `server/` Docker build context contains zero leaked
 *      test/fixture files, stays <= 90 MiB total, and has no single file > 8 MiB.
 *   3. Split mega-benchmark suites (`HoldemPersonaReplayVsMain*.test.ts` >= 4
 *      files; `HorseV54RiverBluff*.test.ts` >= 3 files, <= 360 lines each)
 *      cannot re-monolith into a single slow shard.
 *   4. New `server/src` test files stay <= 2,000 lines (pre-existing >2,000-line
 *      files carry explicit bounded ceilings in `GRANDFATHERED_LARGE_TEST_CEILINGS`).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SCRIPT_DIR, '../..');

export const MAX_DOCKER_CONTEXT_BYTES = 90 * 1024 * 1024; // 90 MiB (current ~70.6 MiB)
export const MAX_DOCKER_CONTEXT_FILE_BYTES = 8 * 1024 * 1024; // 8 MiB (current max 4.43 MiB)
export const MAX_NEW_SERVER_TEST_LINES = 2000;
export const MAX_V54_SPLIT_LINES = 360;
export const MIN_HOLDEM_REPLAY_SPLIT_FILES = 4;
export const MIN_V54_SPLIT_FILES = 3;
export const MAX_HOLDEM_REPLAY_PASSES_PER_FILE = 2;

export const REQUIRED_DOCKERIGNORE_RULES = [
  'src/**/*.test.ts',
  'src/**/*.spec.ts',
  'src/**/*.test-support.*',
  'src/testing/**',
  'src/benchmark/fixtures/**',
];

/**
 * Bounded ceilings for the 17 pre-existing >2,000-line server test files so
 * unrelated PRs can add targeted regression tests without unblocking new
 * monolithic test files.
 */
export const GRANDFATHERED_LARGE_TEST_CEILINGS = Object.freeze({
  'server/src/engine/horseDecision/workerRuntime.test.ts': 7200,
  'server/src/engine/horseDecision/client.test.ts': 4500,
  'server/src/engine/HorsePloEliteOverhaul.test.ts': 4300,
  'server/src/engine/HorseDecisionEffectCommit.test.ts': 3900,
  'server/src/engine/HorseHoldemEliteOverhaul.test.ts': 3200,
  'server/src/services/horseDecisionJournal/review.test.ts': 3100,
  'server/src/engine/HorseLogic.test.ts': 3100,
  'server/src/services/supabase/handHistory.test.ts': 3100,
  'server/src/engine/HorsePhase7TournamentUtility.test.ts': 2900,
  'server/src/engine/CashoutDeparturePostgres.test.ts': 2900,
  'server/src/maintenance/MaintenanceBreak.test.ts': 2800,
  'server/src/engine/OriginalControllerRuntime.test.ts': 2700,
  'server/src/engine/HorseActionSpaceFreedom.law.test.ts': 2600,
  'server/src/engine/HorseOmahaOopReraisedPot.test.ts': 2450,
  'server/src/services/HorseDecisionJournal.test.ts': 2400,
  'server/src/engine/HorsePloPostflopMinBetRegression.test.ts': 2350,
  'server/src/services/rakebackWatermark.test.ts': 2300,
});

const TEST_FILE_RE = /\.(?:test|spec)\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;
const FORBIDDEN_CONTEXT_RE =
  /^src\/(?:(?:.+\/)?[^/]+\.(?:test|spec)\.(?:ts|tsx|mts|cts|js|mjs|cjs)|(?:.+\/)?[^/]+\.test-support\.[^/]+|(?:.+\/)?__tests__(?:\/|$)|testing(?:\/|$)|engine\/testing(?:\/|$)|benchmark\/fixtures(?:\/|$))/;

// Untracked local build/install outputs excluded from git-archive Docker builds.
const LOCAL_SKIP_PREFIXES = [
  'node_modules/',
  'dist/',
  '.git/',
  'native/build/',
  'native/legacy-census/',
];

export function parseDockerignore(text) {
  const rules = [];
  const syntaxErrors = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('!')) {
      syntaxErrors.push(`line ${i + 1}: negation rule '${trimmed}' breaks engine-source-identity.sh`);
    }
    if (/[\[\]]/.test(trimmed)) {
      syntaxErrors.push(
        `line ${i + 1}: bracket character class '${trimmed}' breaks engine-source-identity.sh`
      );
    }
    if (trimmed.includes('\\')) {
      syntaxErrors.push(`line ${i + 1}: backslash escape '${trimmed}' breaks engine-source-identity.sh`);
    }
    rules.push(trimmed);
  }
  return { rules, syntaxErrors };
}

export function positiveGlobToRegex(pat) {
  const norm = String(pat).replace(/^\/+/, '').replace(/\/+$/, '');
  if (!norm) return /(?!)/;
  let out = '^';
  for (let i = 0; i < norm.length; i++) {
    if (norm.slice(i, i + 3) === '**/') {
      out += '(?:.+/)?';
      i += 2;
    } else if (norm.slice(i, i + 2) === '**') {
      out += '.*';
      i += 1;
    } else if (norm[i] === '*') {
      out += '[^/]*';
    } else if (norm[i] === '?') {
      out += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(norm[i])) {
      out += '\\' + norm[i];
    } else {
      out += norm[i];
    }
  }
  return new RegExp(out + '(?:/.*)?$');
}

function walkFiles(baseDir, currentDir = baseDir, out = []) {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    const full = join(currentDir, entry.name);
    const rel = relative(baseDir, full).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (LOCAL_SKIP_PREFIXES.some((p) => `${rel}/`.startsWith(p))) continue;
      walkFiles(baseDir, full, out);
    } else if (entry.isFile()) {
      if (LOCAL_SKIP_PREFIXES.some((p) => rel.startsWith(p))) continue;
      out.push({ rel, full });
    }
  }
  return out;
}

function stripForOfArrayLoops(code) {
  const headerRe = /for\s*\([^)]*\bof\s*\[[\s\S]*?\]\s*(?:as\s+const)?\s*\)\s*\{/g;
  let result = '';
  let lastIdx = 0;
  let match;
  while ((match = headerRe.exec(code)) !== null) {
    const start = match.index;
    const openBrace = start + match[0].length - 1;
    let depth = 1;
    let i = openBrace + 1;
    while (i < code.length && depth > 0) {
      const ch = code[i];
      if (ch === "'" || ch === '"' || ch === '`') {
        const quote = ch;
        i++;
        while (i < code.length) {
          if (code[i] === '\\' && i + 1 < code.length) {
            i += 2;
            continue;
          }
          if (code[i] === quote) {
            i++;
            break;
          }
          i++;
        }
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    result += code.slice(lastIdx, start);
    lastIdx = i;
    headerRe.lastIndex = i;
  }
  result += code.slice(lastIdx);
  return result;
}

export function countReplayPasses(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  // Count explicit `it(` invocations inside a HoldemPersonaReplayVsMain*.test.ts
  // excluding the HOLDEM_REPLAY_RECORD block.
  const withoutRecord = code.replace(
    /if\s*\(\s*process\.env\.HOLDEM_REPLAY_RECORD\s*\)\s*\{[\s\S]*?\breturn\s*;\s*\}/g,
    ''
  );
  // Also account for `for (const [...] of [ ... ]) { it(...) }` loops.
  const loopMatch = withoutRecord.match(/for\s*\([^)]*\bof\s*\[([\s\S]*?)\]\s*(?:as\s+const)?\s*\)/g);
  let passes = 0;
  if (loopMatch) {
    for (const loop of loopMatch) {
      const tupleCount = (loop.match(/\[\s*['"`]/g) ?? []).length;
      passes += Math.max(1, tupleCount);
    }
    const strippedLoops = stripForOfArrayLoops(withoutRecord);
    passes += (strippedLoops.match(/\bit\s*\(/g) ?? []).length;
  } else {
    passes = (withoutRecord.match(/\bit\s*\(/g) ?? []).length;
  }
  return passes;
}

export function evaluateCutoverCiBudgets({
  rootDir = REPO_ROOT,
  maxDockerContextBytes = MAX_DOCKER_CONTEXT_BYTES,
  maxDockerContextFileBytes = MAX_DOCKER_CONTEXT_FILE_BYTES,
  maxNewServerTestLines = MAX_NEW_SERVER_TEST_LINES,
} = {}) {
  const violations = [];
  const serverDir = join(rootDir, 'server');
  const dockerignorePath = join(serverDir, '.dockerignore');

  if (!existsSync(dockerignorePath)) {
    return {
      violations: ['server/.dockerignore is missing'],
      metrics: { contextFiles: 0, contextBytes: 0, testFiles: 0 },
    };
  }

  const { rules, syntaxErrors } = parseDockerignore(readFileSync(dockerignorePath, 'utf8'));
  for (const err of syntaxErrors) {
    violations.push(`server/.dockerignore: ${err}`);
  }
  for (const req of REQUIRED_DOCKERIGNORE_RULES) {
    if (!rules.includes(req)) {
      violations.push(`server/.dockerignore is missing required exclusion rule '${req}'`);
    }
  }

  const matchers = rules.map(positiveGlobToRegex);
  const allServerFiles = walkFiles(serverDir);

  let contextFiles = 0;
  let contextBytes = 0;
  let maxFileBytes = 0;
  let maxFilePath = '';

  const serverTests = [];

  for (const { rel, full } of allServerFiles) {
    const repoRel = `server/${rel}`;
    if (rel.startsWith('src/') && TEST_FILE_RE.test(rel)) {
      serverTests.push({ rel, repoRel, full });
    }

    const ignored = matchers.some((re) => re.test(rel));
    if (ignored) continue;

    if (FORBIDDEN_CONTEXT_RE.test(rel)) {
      violations.push(
        `Docker context leak: server/${rel} is not excluded by server/.dockerignore`
      );
    }
    const sz = statSync(full).size;
    contextFiles++;
    contextBytes += sz;
    if (sz > maxFileBytes) {
      maxFileBytes = sz;
      maxFilePath = repoRel;
    }
    if (sz > maxDockerContextFileBytes) {
      violations.push(
        `Docker context single-file budget exceeded: ${repoRel} is ${(sz / 1024 / 1024).toFixed(2)} MiB (limit ${(maxDockerContextFileBytes / 1024 / 1024).toFixed(2)} MiB)`
      );
    }
  }

  if (contextBytes > maxDockerContextBytes) {
    violations.push(
      `Docker context total size budget exceeded: ${(contextBytes / 1024 / 1024).toFixed(2)} MiB > ${(maxDockerContextBytes / 1024 / 1024).toFixed(2)} MiB limit`
    );
  }

  // Split mega-benchmark budgets
  const holdemReplayFiles = serverTests.filter((t) =>
    /^src\/benchmark\/HoldemPersonaReplayVsMain.*\.test\.ts$/.test(t.rel)
  );
  if (holdemReplayFiles.length < MIN_HOLDEM_REPLAY_SPLIT_FILES) {
    violations.push(
      `HoldemPersonaReplayVsMain split budget violated: expected >= ${MIN_HOLDEM_REPLAY_SPLIT_FILES} sibling test files, found ${holdemReplayFiles.length}`
    );
  }
  for (const t of holdemReplayFiles) {
    const passes = countReplayPasses(readFileSync(t.full, 'utf8'));
    if (passes > MAX_HOLDEM_REPLAY_PASSES_PER_FILE) {
      violations.push(
        `${t.repoRel}: runs ${passes} full-hand replay passes (budget <= ${MAX_HOLDEM_REPLAY_PASSES_PER_FILE} per file to preserve shard parallelism)`
      );
    }
  }

  const v54Files = serverTests.filter((t) =>
    /^src\/engine\/HorseV54RiverBluff.*\.test\.ts$/.test(t.rel)
  );
  if (v54Files.length < MIN_V54_SPLIT_FILES) {
    violations.push(
      `HorseV54RiverBluff split budget violated: expected >= ${MIN_V54_SPLIT_FILES} sibling test files, found ${v54Files.length}`
    );
  }
  for (const t of v54Files) {
    const lines = readFileSync(t.full, 'utf8').split('\n').length;
    if (lines > MAX_V54_SPLIT_LINES) {
      violations.push(
        `${t.repoRel}: ${lines} lines exceeds split budget of ${MAX_V54_SPLIT_LINES} lines`
      );
    }
  }

  // General server test-file line budget
  for (const t of serverTests) {
    const lines = readFileSync(t.full, 'utf8').split('\n').length;
    const ceiling = GRANDFATHERED_LARGE_TEST_CEILINGS[t.repoRel] ?? maxNewServerTestLines;
    if (lines > ceiling) {
      violations.push(
        `${t.repoRel}: ${lines} lines exceeds server test-file size budget of ${ceiling} lines (split into focused sibling test files for balanced sharding)`
      );
    }
  }

  return {
    violations,
    metrics: {
      contextFiles,
      contextBytes,
      maxFileBytes,
      maxFilePath,
      testFiles: serverTests.length,
      holdemReplaySplitFiles: holdemReplayFiles.length,
      v54SplitFiles: v54Files.length,
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { violations, metrics } = evaluateCutoverCiBudgets();
  if (violations.length > 0) {
    console.error(`[check-cutover-ci-budgets] FAIL (${violations.length} violation(s)):`);
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log(
    `[check-cutover-ci-budgets] PASS: Docker context ${metrics.contextFiles} files (${(metrics.contextBytes / 1024 / 1024).toFixed(2)} MiB / ${(MAX_DOCKER_CONTEXT_BYTES / 1024 / 1024).toFixed(0)} MiB), ${metrics.testFiles} server test files checked (HoldemReplay=${metrics.holdemReplaySplitFiles} files, V54=${metrics.v54SplitFiles} files).`
  );
}
