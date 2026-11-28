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

const REGEX_PREFIX_KEYWORDS = new Set([
  'return',
  'case',
  'throw',
  'in',
  'instanceof',
  'typeof',
  'void',
  'delete',
  'new',
  'of',
  'await',
  'yield',
  'else',
  'do',
]);

const REGEX_PREFIX_PUNCT = new Set([
  '(',
  '[',
  '{',
  ',',
  ';',
  ':',
  '?',
  '=',
  '!',
  '&',
  '|',
  '^',
  '~',
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '>',
]);

function canStartRegex(lastToken) {
  if (lastToken.kind === 'start') return true;
  if (lastToken.kind === 'punct') return REGEX_PREFIX_PUNCT.has(lastToken.text);
  if (lastToken.kind === 'ident') return REGEX_PREFIX_KEYWORDS.has(lastToken.text);
  return false;
}

function scanTemplateChunk(source, startIdx, out, templateStack, atOpening) {
  const n = source.length;
  if (atOpening) {
    // Preserve simple identifier-only template literals like `now` or `Date`
    // so spyOn(Date, `now`) / stubGlobal(`Date`, ...) remain detectable.
    const closeIdx = source.indexOf('`', startIdx);
    if (closeIdx > startIdx) {
      const simple = source.slice(startIdx, closeIdx);
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(simple)) {
        out.push(simple, '`');
        return { nextIdx: closeIdx + 1, enteredExpr: false };
      }
    }
  }
  let i = startIdx;
  while (i < n) {
    const ch = source[i];
    if (ch === '\\' && i + 1 < n) {
      out.push(' ', source[i + 1] === '\n' ? '\n' : ' ');
      i += 2;
      continue;
    }
    if (ch === '`') {
      out.push('`');
      return { nextIdx: i + 1, enteredExpr: false };
    }
    if (ch === '$' && source[i + 1] === '{') {
      out.push('$', '{');
      templateStack.push({ braceDepth: 0 });
      return { nextIdx: i + 2, enteredExpr: true };
    }
    out.push(ch === '\n' ? '\n' : ' ');
    i++;
  }
  return { nextIdx: n, enteredExpr: false };
}

/**
 * Blank single-line comments, block comments, regex literal bodies, prose
 * single/double-quoted string literals, and static template-literal text while
 * preserving newlines (so line numbers stay exact) and preserving `${...}`
 * template expressions (with balanced brace-depth tracking, including nested
 * template literals).
 */
export function stripCommentsAndPlainStrings(source) {
  const out = [];
  const templateStack = [];
  let lastToken = { kind: 'start', text: '' };
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    // Whitespace (preserves lastToken)
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' || ch === '\f' || ch === '\v') {
      out.push(ch);
      i++;
      continue;
    }

    // Line comment (preserves lastToken)
    if (ch === '/' && next === '/') {
      out.push(' ', ' ');
      i += 2;
      while (i < n && source[i] !== '\n') {
        out.push(' ');
        i++;
      }
      continue;
    }

    // Block comment (preserves lastToken)
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
        lastToken = { kind: 'string', text: quote };
        continue;
      }
    }

    // Template literal (blank static text, preserve ${...} expressions with balanced braces)
    if (ch === '`') {
      out.push('`');
      const res = scanTemplateChunk(source, i + 1, out, templateStack, true);
      i = res.nextIdx;
      lastToken = res.enteredExpr ? { kind: 'punct', text: '{' } : { kind: 'string', text: '`' };
      continue;
    }

    // Braces inside template expressions
    if (ch === '{') {
      if (templateStack.length > 0) {
        templateStack[templateStack.length - 1].braceDepth++;
      }
      out.push('{');
      i++;
      lastToken = { kind: 'punct', text: '{' };
      continue;
    }
    if (ch === '}') {
      if (templateStack.length > 0) {
        const top = templateStack[templateStack.length - 1];
        if (top.braceDepth === 0) {
          templateStack.pop();
          out.push('}');
          const res = scanTemplateChunk(source, i + 1, out, templateStack, false);
          i = res.nextIdx;
          lastToken = res.enteredExpr
            ? { kind: 'punct', text: '{' }
            : { kind: 'string', text: '`' };
          continue;
        }
        top.braceDepth--;
      }
      out.push('}');
      i++;
      lastToken = { kind: 'punct', text: '}' };
      continue;
    }

    // Regex literal
    if (ch === '/' && canStartRegex(lastToken)) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n && source[j] !== '\n') {
        const rc = source[j];
        if (rc === '\\' && j + 1 < n && source[j + 1] !== '\n') {
          j += 2;
          continue;
        }
        if (rc === '[') {
          inClass = true;
          j++;
          continue;
        }
        if (rc === ']') {
          inClass = false;
          j++;
          continue;
        }
        if (rc === '/' && !inClass) {
          closed = true;
          break;
        }
        j++;
      }
      if (closed) {
        let flagsEnd = j + 1;
        while (flagsEnd < n && /[a-zA-Z]/.test(source[flagsEnd])) flagsEnd++;
        out.push('/', ' '.repeat(j - (i + 1)), '/', source.slice(j + 1, flagsEnd));
        i = flagsEnd;
        lastToken = { kind: 'string', text: '/' };
        continue;
      }
    }

    // Identifiers / keywords
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(source[j])) j++;
      const word = source.slice(i, j);
      out.push(word);
      i = j;
      lastToken = { kind: 'ident', text: word };
      continue;
    }

    // Numbers
    if (/[0-9]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[0-9a-zA-Z_.]/.test(source[j])) j++;
      const num = source.slice(i, j);
      out.push(num);
      i = j;
      lastToken = { kind: 'number', text: num };
      continue;
    }

    // Multi-char operators that affect regex-start classification (++ / -- vs =>)
    if ((ch === '+' && next === '+') || (ch === '-' && next === '-')) {
      out.push(ch, next);
      i += 2;
      lastToken = { kind: 'punct', text: ch + next };
      continue;
    }
    if (ch === '=' && next === '>') {
      out.push('=', '>');
      i += 2;
      lastToken = { kind: 'punct', text: '>' };
      continue;
    }

    out.push(ch);
    i++;
    lastToken = { kind: 'punct', text: ch };
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
