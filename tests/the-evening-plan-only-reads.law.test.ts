/**
 * ===========================================================================
 *  LAW: THE EVENING PLAN ONLY READS
 * ===========================================================================
 *
 * Owner request 2026-11-07: a report, run at 20:00 America/Chicago, of what
 * tomorrow's 04:00 engine preparation would select. CLAUDE.md 10.85 forbids
 * any timer, watcher or recurring agent from initiating, advancing, retrying
 * or certifying a release; the plan is admissible under that rule ONLY while
 * it cannot act. This law keeps it that way:
 *
 *   1. evening-release-plan.yml holds read-only permissions and nothing else;
 *   2. neither the workflow nor scripts/ops/release-plan.mjs can dispatch,
 *      cancel, rerun or write through GitHub (no `gh run`, `gh workflow run`,
 *      `/dispatches`, `-X POST|PUT|PATCH|DELETE`, `--method POST`,
 *      `curl -X POST`); every GitHub and engine read is an explicit GET;
 *   3. the script never imports or spawns the applier, the window installer,
 *      the deploy or maintenance scripts, and never opens child_process;
 *   4. its only SQL is a SELECT on supabase_migrations.schema_migrations;
 *   5. the job fails on NOT_READY and UNKNOWN (exit 1 and 3), never on
 *      READY or NOTHING_OWED, so the red-main detector is its reader
 *      (CLAUDE.md 10.83) and an unreadable plan is never green (10.86).
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { EXIT_CODES, VERDICTS } from '../scripts/ops/release-plan.mjs';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const WORKFLOW = '.github/workflows/evening-release-plan.yml';
const SCRIPT = 'scripts/ops/release-plan.mjs';
const workflowText = read(WORKFLOW);
const workflow = parse(workflowText);
const scriptText = read(SCRIPT);

/** JavaScript with line and block comments blanked, so prose cannot trip a rule. */
const jsCode = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
/** YAML with `#` comments blanked (quote-aware). */
const yamlCode = (src: string) =>
  src
    .split('\n')
    .map((line) => {
      let quote: string | null = null;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === "'" || c === '"') quote = c;
        else if (c === '#') return line.slice(0, i);
      }
      return line;
    })
    .join('\n');

const scriptCode = jsCode(scriptText);
const workflowCode = yamlCode(workflowText);

const WRITE_SHAPES: ReadonlyArray<[string, RegExp]> = [
  ['gh run', /\bgh\s+run\b/],
  ['gh workflow run/enable/disable', /\bgh\s+workflow\s+(run|enable|disable)\b/],
  ['a repository or workflow dispatch URL', /\/dispatches\b/],
  ['a dispatch event type', /event_type\s*[:=]/],
  [
    'gh api with a writing method',
    /\bgh\s+api\b[^\n]*(-X|--method)\s*['"]?(POST|PUT|PATCH|DELETE)\b/i,
  ],
  ['curl with a writing method', /\bcurl\b[^\n]*(-X|--request)\s*['"]?(POST|PUT|PATCH|DELETE)\b/i],
  ['a cancel or rerun endpoint', /\/(cancel|rerun|rerun-failed-jobs)\b/],
  ['a status write', /repos\/[^\n]*\/statuses\/\$/],
  ['ssh or scp to a host', /\b(ssh|scp)\s+-/],
];

describe('the evening plan only reads', () => {
  it('the workflow holds read-only permissions and no job widens them', () => {
    expect(workflow.permissions).toEqual({ contents: 'read', statuses: 'read', actions: 'read' });
    for (const [name, job] of Object.entries<any>(workflow.jobs)) {
      expect(job.permissions, `${name} must not declare its own permissions`).toBeUndefined();
    }
    expect(workflowCode).not.toMatch(/:\s*write\b/);
  });

  it('runs on its schedule and on dispatch, on protected main only', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['schedule', 'workflow_dispatch']);
    expect(workflow.on.schedule.map((s: any) => s.cron)).toEqual(['7 1 * * *', '7 2 * * *']);
    expect(workflow.jobs.plan.if).toBe(
      "github.ref == 'refs/heads/main' && !((github.event_name == 'workflow_dispatch' || github.event_name == 'repository_dispatch') && github.triggering_actor == 'github-actions[bot]')"
    );
    expect(workflow.concurrency).toEqual({
      group: 'evening-release-plan',
      'cancel-in-progress': false,
    });
    expect(workflowCode).toContain('node scripts/ops/release-plan.mjs');
  });

  it.each(WRITE_SHAPES)('the workflow cannot write through %s', (_name, shape) => {
    expect(workflowCode).not.toMatch(shape);
  });

  it.each(WRITE_SHAPES)('the script cannot write through %s', (_name, shape) => {
    expect(scriptCode).not.toMatch(shape);
  });

  it('runs the report-only contents and timing reader between snapshot and final publication', () => {
    const shell = workflow.jobs.plan.steps.find((step: any) => step.id === 'plan').run;
    const helper = 'scripts/ops/evening-backup-readiness.py';
    expect(shell.indexOf('--snapshot')).toBeLessThan(shell.indexOf(helper));
    expect(shell.indexOf(helper)).toBeLessThan(shell.indexOf('--readiness'));
    expect(shell).toContain('|| code=$?');
    expect(workflow.jobs.plan.steps[0].with['fetch-depth']).toBe(0);
    const source = read(helper);
    expect(source).toContain("['gh', 'api', '--method', 'GET',");
    expect(source).not.toMatch(
      /dispatches|--method.{1,5}(?:POST|PATCH|DELETE|PUT)|select-daily-engine/
    );
    execFileSync('python3', ['-B', 'tests/operations/evening-backup-readiness.test.py'], {
      cwd: ROOT,
    });
  });

  it('every GitHub and engine read in the script is an explicit GET and nothing else', () => {
    const methods = [...scriptCode.matchAll(/method:\s*['"]([A-Z]+)['"]/g)].map((m) => m[1]);
    expect(methods.length).toBeGreaterThanOrEqual(2);
    expect(new Set(methods)).toEqual(new Set(['GET']));
    // Every fetch call passes the GET options object; none is a bare fetch(url).
    const fetches = [...scriptCode.matchAll(/deps\.fetch\(([^)]*)\)/g)];
    expect(fetches.length).toBeGreaterThanOrEqual(2);
    for (const f of fetches) expect(f[1]).toMatch(/,\s*\{/);
  });

  it('the script never imports or spawns the applier, installer, deploy or maintenance scripts', () => {
    for (const forbidden of [
      'apply-recorded-migration',
      'install-window-migrations',
      'engine-release-transaction',
      'database-maintenance-window',
      'select-daily-engine',
      'deploy.sh',
      'child_process',
      'spawnSync',
      'execSync',
      'execFile',
    ]) {
      expect(scriptCode, forbidden).not.toContain(forbidden);
    }
    const imports = [...scriptCode.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const spec of imports.filter((s) => s.startsWith('.'))) {
      expect(
        [
          '../ci/maintenance-window-migrations.mjs',
          '../ci/migration-concurrent-preamble.mjs',
          '../ci/check-migrations-are-live.mjs',
        ],
        `unexpected local import ${spec}`
      ).toContain(spec);
    }
  });

  it('its only SQL is a SELECT on schema_migrations', () => {
    const sql = [...scriptCode.matchAll(/`\s*SELECT[\s\S]*?`/g)].map((m) => m[0]);
    expect(sql).toHaveLength(1);
    expect(sql[0]).toMatch(/FROM supabase_migrations\.schema_migrations/);
    expect(scriptCode).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|LOCK)\s+(INTO|TABLE|FUNCTION|INDEX|ON|FROM)?\b/
    );
    expect(scriptCode).toContain('statement_timeout: 5000');
  });

  it('fails the job on NOT_READY and UNKNOWN, never on READY or NOTHING_OWED', () => {
    expect(EXIT_CODES[VERDICTS.READY]).toBe(0);
    expect(EXIT_CODES[VERDICTS.NOTHING_OWED]).toBe(0);
    expect(EXIT_CODES[VERDICTS.NOT_READY]).toBe(1);
    expect(EXIT_CODES[VERDICTS.UNKNOWN]).toBe(3);
    expect(EXIT_CODES.UNKNOWN).not.toBe(EXIT_CODES.READY);
    expect(EXIT_CODES.UNKNOWN).not.toBe(EXIT_CODES.NOT_READY);
    const steps: any[] = workflow.jobs.plan.steps;
    const run = steps.find((s) => s.id === 'plan');
    expect(run.run).toContain('code=$?');
    expect(run.run).toContain('echo "code=$code" >> "$GITHUB_OUTPUT"');
    const fail = steps.at(-1);
    expect(fail.name).toMatch(/Fail on NOT_READY or UNKNOWN/);
    expect(fail.env.CODE).toBe('${{ steps.plan.outputs.code }}');
    // An unset code is UNKNOWN (3), not success: the default is never 0.
    expect(fail.run.trim()).toBe('[ "${CODE:-3}" = 0 ]');
    // The artifact and summary are kept even when the verdict is red.
    const upload = steps.find((s) => String(s.uses || '').startsWith('actions/upload-artifact'));
    expect(upload.if).toBe('always()');
    expect(run.run).toContain('--summary');
  });

  it('the uncaught path of the script is UNKNOWN, not silence', () => {
    expect(scriptCode).toContain('process.exit(EXIT_CODES.UNKNOWN)');
    // 10.86 rule 2: an HTTP failure is thrown, never read as an empty list.
    expect(scriptCode).toMatch(/if \(!res\.ok\) throw new Error/);
  });
});
