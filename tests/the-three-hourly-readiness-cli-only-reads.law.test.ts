/**
 * LAW: THE THREE-HOURLY READINESS CLI ONLY READS.
 * ===========================================================================
 * Enhancement E4 (2026-11-21): `scripts/release/three-hourly-readiness.py`
 * gives all four lanes (PLO Strategy, Horse On/Off Switches, Antigravity
 * Coordinator, Horse Decisions) and the Dedicated Engine Cutover owner a
 * single on-demand readiness check before every three-hourly cycle.
 *
 * Under CLAUDE.md 10.85 and 10.86 it is admissible ONLY while it is strictly
 * read-only and fails closed to UNKNOWN (exit 3) whenever any health, git or
 * GitHub read is unavailable:
 *
 *   1. zero writes, dispatches, reruns, cancels, ssh/scp, or `.env` reads;
 *   2. every `gh api` call uses explicit `--method GET`;
 *   3. `scripts/ci/read-engine-prequalification.py` supplies `projection()`;
 *   4. its pure mocked Python unit suite passes with zero skipped tests;
 *   5. `docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md` names the one-liner and
 *      carries no em dash.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const SCRIPT = 'scripts/release/three-hourly-readiness.py';
const SUITE = 'tests/operations/three-hourly-readiness.test.py';
const DOC = 'docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md';

const scriptSource = readFileSync(resolve(ROOT, SCRIPT), 'utf8');
const docSource = readFileSync(resolve(ROOT, DOC), 'utf8');

const WRITE_SHAPES: ReadonlyArray<[string, RegExp]> = [
  ['gh run', /\bgh\s+run\b/],
  ['gh workflow run/enable/disable', /\bgh\s+workflow\s+(run|enable|disable)\b/],
  ['dispatch endpoint', /\/dispatches\b/],
  ['gh api writing method', /--method['",\s]+(POST|PUT|PATCH|DELETE)\b/i],
  ['cancel or rerun endpoint', /\/(cancel|rerun|rerun-failed-jobs)\b/],
  ['ssh or scp', /\b(ssh|scp)\s+-/],
  ['.env credential file access', /\.env\b/],
  [
    'git write subcommand',
    /(?:\bgit_(?:fn|read)\b|['"]git['"])[^\n]*['"](fetch|push|commit|checkout|reset|tag|branch|merge)['"]/,
  ],
];

describe('the three-hourly readiness CLI only reads', () => {
  it.each(WRITE_SHAPES)('the script cannot perform %s', (_name, pattern) => {
    expect(scriptSource).not.toMatch(pattern);
  });

  it('uses explicit GET for GitHub and /health, imports read-engine-prequalification, and exits 3 on UNKNOWN', () => {
    expect(scriptSource).toContain('["gh", "api", "--method", "GET", path]');
    expect(scriptSource).toContain('method="GET"');
    expect(scriptSource).toContain('scripts/ci/read-engine-prequalification.py');
    expect(scriptSource).toContain('VERDICT_UNKNOWN: 3');
    expect(scriptSource).not.toContain('\u2014');
  });

  it('passes its pure mocked unit test suite with zero skipped tests', () => {
    const result = spawnSync('python3', ['-B', SUITE], {
      cwd: ROOT,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stderr).toMatch(/Ran 8 tests/);
    expect(result.stderr).not.toMatch(/skipped=/);
  });

  it('is documented in docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md with no em dash', () => {
    expect(docSource).toContain('python3 -B scripts/release/three-hourly-readiness.py');
    expect(docSource).toContain('--json');
    expect(docSource).toContain('--limit');
    expect(docSource).not.toContain('\u2014');
  });
});
