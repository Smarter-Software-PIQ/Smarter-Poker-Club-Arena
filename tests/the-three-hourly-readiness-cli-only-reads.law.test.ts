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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = resolve(__dirname, '..');
const SCRIPT = 'scripts/release/three-hourly-readiness.py';
const SUITE = 'tests/operations/three-hourly-readiness.test.py';
const DOC = 'docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md';
const STAGE = '.github/workflows/stage-engine-release.yml';

const scriptSource = readFileSync(resolve(ROOT, SCRIPT), 'utf8');
const docSource = readFileSync(resolve(ROOT, DOC), 'utf8');
const stageSource = readFileSync(resolve(ROOT, STAGE), 'utf8');

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

  it('uses explicit GET for GitHub and /health, imports read-engine-prequalification, supports --repo-dir, and exits 3 on UNKNOWN', () => {
    expect(scriptSource).toContain('["gh", "api", "--method", "GET", path]');
    expect(scriptSource).toContain('method="GET"');
    expect(scriptSource).toContain('scripts/ci/read-engine-prequalification.py');
    expect(scriptSource).toContain('--repo-dir');
    expect(scriptSource).toContain('VERDICT_UNKNOWN: 3');
    expect(scriptSource).not.toContain('\u2014');
    expect(scriptSource).not.toContain('\u2013');
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
    expect(result.stderr).toMatch(/Ran 23 tests/);
    expect(result.stderr).not.toMatch(/skipped=/);
  });

  it('is documented in docs/ENGINE-CUTOVER-EVERY-THREE-HOURS.md with --repo-dir, NEXT OPEN CYCLE, MIGRATION GATE, and no Unicode dashes', () => {
    expect(docSource).toContain('python3 -B scripts/release/three-hourly-readiness.py');
    expect(docSource).toContain('--json');
    expect(docSource).toContain('--limit');
    expect(docSource).toContain('--repo-dir');
    expect(docSource).toContain('NEXT OPEN CYCLE');
    expect(docSource).toContain('MIGRATION GATE');
    expect(docSource).not.toContain('\u2014');
    expect(docSource).not.toContain('\u2013');
  });

  it('appends a strictly read-only, non-blocking readiness summary in stage-engine-release.yml selection job', () => {
    const wf = parse(stageSource);
    const selection = wf.jobs.selection;
    const checkout = selection.steps.find((s: any) => /actions\/checkout/.test(s?.uses ?? ''));
    expect(String(checkout?.with?.['sparse-checkout'] ?? '')).toContain('scripts/release');

    const step = selection.steps.find((s: any) => s?.id === 'readiness_summary');
    expect(step).toBeDefined();
    expect(step.if).toBe("always() && steps.freeze.outcome != 'skipped'");
    expect(step['continue-on-error']).toBe(true);
    expect(step.run).toContain('GITHUB_STEP_SUMMARY');
    expect(step.run).toContain('daily-selection.json');
    expect(step.run).toContain('scripts/release/three-hourly-readiness.py');
    expect(step.run).not.toContain('GITHUB_OUTPUT');
    expect(step.run).not.toContain('\u2014');
    expect(step.run).not.toContain('\u2013');

    const syntax = spawnSync('bash', ['-n'], { input: step.run, encoding: 'utf8' });
    expect(syntax.status, syntax.stderr).toBe(0);

    // Execute the summary step with stubbed daily-selection.json and readiness CLI.
    const dir = mkdtempSync(join(tmpdir(), 'stage-readiness-summary-'));
    try {
      const summaryFile = join(dir, 'summary.md');
      writeFileSync(summaryFile, '');
      const serving = 'a'.repeat(40);
      const target = 'b'.repeat(40);
      const deferred = 'c'.repeat(40);
      writeFileSync(
        join(dir, 'daily-selection.json'),
        JSON.stringify({
          schema: 1,
          outcome: 'keep-serving',
          reason: 'no newer candidate',
          servingSha: serving,
          targetSha: null,
          deferredCandidates: [
            { sha: deferred, reason: 'prequalification unavailable', detail: 'run 12345 failed' },
          ],
        })
      );
      const harness = `
mkdir -p scripts/release
: > scripts/release/three-hourly-readiness.py
python3() { printf '{"verdict":"IN_FLIGHT","summary":"candidate %s awaiting prequal"}'; return 0; }
`;
      const run = spawnSync('bash', ['-c', harness + step.run], {
        cwd: dir,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_STEP_SUMMARY: summaryFile,
          GITHUB_REPOSITORY: 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena',
          RELEASE_DATE: '2026-11-21T22',
          OWNER_WINDOW_ID: '',
          CUTOFF_CONTROL: target,
        },
      });
      expect(run.status, run.stderr).toBe(0);
      const md = readFileSync(summaryFile, 'utf8');
      expect(md).toContain('2026-11-21T22');
      expect(md).toContain('keep-serving');
      expect(md).toContain(serving);
      expect(md).toContain(deferred.slice(0, 12));
      expect(md).toContain('prequalification unavailable');
      expect(md).toContain('run 12345 failed');
      expect(md).toContain('IN_FLIGHT');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
