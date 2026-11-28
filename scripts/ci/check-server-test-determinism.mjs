#!/usr/bin/env node
/**
 * SHIFT-LEFT ANTI-FLAKE DETERMINISM GUARD (server/src test suite).
 *
 * Refuses unpinned `Date.now()` and `Math.random()` calls in `server/src` test
 * files unless the file explicitly pins/mocks the clock or RNG (e.g.
 * `vi.useFakeTimers()`, `vi.setSystemTime()`, `vi.spyOn(Date, 'now')`,
 * `vi.spyOn(Math, 'random')`, `Date.now = ...`, `Math.random = ...`, or
 * `vi.stubGlobal(...)`) or carries a documented `// @determinism-exempt: <reason>`.
 *
 * Pre-existing files are frozen in `scripts/ci/server-test-determinism-baseline.json`
 * as a strict count ratchet:
 *   - New test files have ZERO allowance.
 *   - Grandfathered files cannot add a single additional unpinned call.
 *   - Fixing a grandfathered file requires shrinking/removing its baseline entry
 *     so the baseline only ever moves toward zero.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SCRIPT_DIR, '../..');
export const DEFAULT_BASELINE_PATH = join(SCRIPT_DIR, 'server-test-determinism-baseline.json');

const TEST_FILE_RE = /\.(?:test|spec)\.(?:ts|mts|cts|js|mjs|cjs)$/;
const EXEMPT_RE = /\/\/\s*@determinism-exempt:\s*\S+/;

const FAKE_CLOCK_RE =
  /\buseFakeTimers\s*\(|\bsetSystemTime\s*\(|spyOn\s*\(\s*Date\s*,\s*['"`]now['"`]\s*\)|\bDate\.now\s*=[^=]|stubGlobal\s*\(\s*['"`]Date['"`]/;

const MOCK_RANDOM_RE =
  /spyOn\s*\(\s*Math\s*,\s*['"`]random['"`]\s*\)|\bMath\.random\s*=[^=]|stubGlobal\s*\(\s*['"`]Math['"`]/;

const DATE_NOW_CALL_RE = /\bDate\.now\s*\(/g;
const MATH_RANDOM_CALL_RE = /\bMath\.random\s*\(/g;

/**
 * Blank single-line comments, block comments, and single/double-quoted string
 * literals while preserving newlines (so line numbers stay exact). Template
 * literals are left intact so `${Date.now()}` interpolations are still detected.
 */
export function stripCommentsAndPlainStrings(source) {
  const out = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    // Line comment
    if (ch === '/' && next === '/') {
      out.push(' ', ' ');
      i += 2;
      while (i < n && source[i] !== '\n') {
        out.push(' ');
        i++;
      }
      continue;
    }
    // Block comment
    if (ch === '/' && next === '*') {
      out.push(' ', ' ');
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        out.push(source[i] === '\n' ? '\n' : ' ');
        i++;
      }
      if (i < n) {
        out.push(' ', ' ');
        i += 2;
      }
      continue;
    }
    // Single or double quoted string (preserve quotes so spyOn(Date, 'now') still matches!)
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      let content = '';
      while (j < n && source[j] !== quote && source[j] !== '\n') {
        if (source[j] === '\\' && j + 1 < n) {
          content += source[j] + source[j + 1];
          j += 2;
        } else {
          content += source[j];
          j++;
        }
      }
      if (j < n && source[j] === quote) {
        // Keep short identifier-like strings (like 'now', 'random', 'Date', 'Math')
        // so spyOn/stubGlobal checks remain exact, and blank strings that contain
        // Date.now( or Math.random( prose/code snippets.
        if (DATE_NOW_CALL_RE.test(content) || MATH_RANDOM_CALL_RE.test(content)) {
          DATE_NOW_CALL_RE.lastIndex = 0;
          MATH_RANDOM_CALL_RE.lastIndex = 0;
          out.push(quote, ' '.repeat(content.length), quote);
        } else {
          DATE_NOW_CALL_RE.lastIndex = 0;
          MATH_RANDOM_CALL_RE.lastIndex = 0;
          out.push(source.slice(i, j + 1));
        }
        i = j + 1;
        continue;
      }
    }
    out.push(ch);
    i++;
  }
  return out.join('');
}

function matchingLines(code, regex) {
  const lines = code.split('\n');
  const hits = [];
  for (let idx = 0; idx < lines.length; idx++) {
    regex.lastIndex = 0;
    const matches = lines[idx].match(regex);
    if (matches) {
      for (let k = 0; k < matches.length; k++) hits.push(idx + 1);
    }
  }
  return hits;
}

export function analyzeTestSource(source, relPath = '<memory>') {
  const exempt = EXEMPT_RE.test(source);
  const code = stripCommentsAndPlainStrings(source);
  const clockPinned = FAKE_CLOCK_RE.test(code);
  const randomPinned = MOCK_RANDOM_RE.test(code);
  const dateNowLines = exempt || clockPinned ? [] : matchingLines(code, DATE_NOW_CALL_RE);
  const mathRandomLines = exempt || randomPinned ? [] : matchingLines(code, MATH_RANDOM_CALL_RE);
  return {
    relPath,
    exempt,
    clockPinned,
    randomPinned,
    dateNowLines,
    mathRandomLines,
  };
}

export function collectServerTestFiles(rootDir = REPO_ROOT) {
  const serverSrc = join(rootDir, 'server', 'src');
  const files = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        walk(full);
      } else if (entry.isFile() && TEST_FILE_RE.test(entry.name)) {
        files.push(relative(rootDir, full).replace(/\\/g, '/'));
      }
    }
  }
  walk(serverSrc);
  return files.sort();
}

export function evaluateDeterminism(analyses, baseline) {
  const violations = [];
  const seen = new Set();
  const baseFiles = baseline?.files ?? {};

  for (const item of analyses) {
    seen.add(item.relPath);
    const dn = item.dateNowLines.length;
    const mr = item.mathRandomLines.length;
    const allowed = baseFiles[item.relPath];

    if (!allowed) {
      if (dn > 0 || mr > 0) {
        violations.push({
          kind: 'new_unpinned',
          relPath: item.relPath,
          dateNowLines: item.dateNowLines,
          mathRandomLines: item.mathRandomLines,
          message:
            `${item.relPath}: unpinned non-determinism detected ` +
            `(Date.now=${dn}${dn ? ` @L${item.dateNowLines.join(',L')}` : ''}, ` +
            `Math.random=${mr}${mr ? ` @L${item.mathRandomLines.join(',L')}` : ''}). ` +
            `Pin the clock (vi.useFakeTimers / vi.spyOn(Date, 'now') / fixed Date.UTC) ` +
            `and RNG (seedFastRandom / vi.spyOn(Math, 'random')) before merging.`,
        });
      }
      continue;
    }

    const allowDn = Number(allowed.dateNow ?? 0);
    const allowMr = Number(allowed.mathRandom ?? 0);
    if (dn > allowDn || mr > allowMr) {
      violations.push({
        kind: 'baseline_exceeded',
        relPath: item.relPath,
        dateNowLines: item.dateNowLines,
        mathRandomLines: item.mathRandomLines,
        expected: { dateNow: allowDn, mathRandom: allowMr },
        actual: { dateNow: dn, mathRandom: mr },
        message:
          `${item.relPath}: unpinned non-determinism increased above grandfathered baseline ` +
          `(Date.now ${dn} > ${allowDn}, Math.random ${mr} > ${allowMr}). ` +
          `Pin new usages instead of growing the baseline.`,
      });
    } else if (dn < allowDn || mr < allowMr) {
      violations.push({
        kind: 'stale_baseline',
        relPath: item.relPath,
        expected: { dateNow: allowDn, mathRandom: allowMr },
        actual: { dateNow: dn, mathRandom: mr },
        message:
          `${item.relPath}: baseline is stale (Date.now ${dn} < ${allowDn} or Math.random ${mr} < ${allowMr}). ` +
          `Shrink or remove this entry from scripts/ci/server-test-determinism-baseline.json.`,
      });
    }
  }

  for (const relPath of Object.keys(baseFiles).sort()) {
    if (!seen.has(relPath)) {
      violations.push({
        kind: 'missing_baseline_file',
        relPath,
        message: `${relPath}: listed in determinism baseline but file no longer exists; remove it from scripts/ci/server-test-determinism-baseline.json.`,
      });
    }
  }

  return violations;
}

export function buildBaseline(analyses) {
  const files = {};
  for (const item of [...analyses].sort((a, b) => a.relPath.localeCompare(b.relPath))) {
    const dn = item.dateNowLines.length;
    const mr = item.mathRandomLines.length;
    if (dn > 0 || mr > 0) {
      files[item.relPath] = { dateNow: dn, mathRandom: mr };
    }
  }
  return {
    schemaVersion: 1,
    description:
      'Closed ratchet baseline of pre-existing server/src test files with unpinned Date.now() or Math.random(). New files must be zero; entries may only shrink or be removed.',
    files,
  };
}

export function runCheck({ rootDir = REPO_ROOT, baselinePath = DEFAULT_BASELINE_PATH } = {}) {
  const relPaths = collectServerTestFiles(rootDir);
  const analyses = relPaths.map((relPath) =>
    analyzeTestSource(readFileSync(join(rootDir, relPath), 'utf8'), relPath)
  );
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const violations = evaluateDeterminism(analyses, baseline);
  return { scanned: relPaths.length, grandfathered: Object.keys(baseline.files ?? {}).length, violations, analyses };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const write = process.argv.includes('--write-baseline');
  if (write) {
    const relPaths = collectServerTestFiles(REPO_ROOT);
    const analyses = relPaths.map((relPath) =>
      analyzeTestSource(readFileSync(join(REPO_ROOT, relPath), 'utf8'), relPath)
    );
    const baseline = buildBaseline(analyses);
    writeFileSync(DEFAULT_BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
    console.log(
      `[check-server-test-determinism] wrote baseline: ${Object.keys(baseline.files).length} grandfathered files out of ${relPaths.length} scanned.`
    );
    process.exit(0);
  }

  const { scanned, grandfathered, violations } = runCheck();
  if (violations.length > 0) {
    console.error(
      `[check-server-test-determinism] FAIL: ${violations.length} violation(s) across ${scanned} server test files:`
    );
    for (const v of violations) console.error(`  - ${v.message}`);
    process.exit(1);
  }
  console.log(
    `[check-server-test-determinism] PASS: ${scanned} server test files checked (${grandfathered} grandfathered in closed ratchet baseline, 0 new unpinned Date.now()/Math.random()).`
  );
}
