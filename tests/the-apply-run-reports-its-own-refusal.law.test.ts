/**
 * ===========================================================================
 *  LAW: THE APPLY RUN REPORTS ITS OWN REFUSAL
 * ===========================================================================
 *
 * WHAT HAPPENED (2026-11-27). Apply Merged Migration run 46054847104 refused
 * 20261127172908 (statement timeout) at 13:13 CST. The alert for exactly that
 * was a separate workflow listening for `workflow_run` of the applier. The
 * merge dispatcher starts the applier with the Actions job token, and GitHub
 * raises no `workflow_run` event for a run the job token started, so the alert
 * workflow never ran: its whole history was one manual dispatch
 * (45943016172). Nothing was posted on pull request #12217 or on custody issue
 * #11599. A detector with no reader (CLAUDE.md 10.83).
 *
 * THE LAW. The failed run is its own reader: apply-merged-migration.yml
 * carries a job that needs the apply job, runs when (and only when) that job
 * concluded failure, and posts through
 * scripts/ci/migration-apply-refusal-alert.mjs. It holds no environment and no
 * secret, so it can never reach the database, and it has the two write scopes
 * a comment needs and no other.
 *
 * This reads the workflow as parsed YAML, so a comment that quotes any of the
 * forbidden shapes cannot satisfy or trip it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
// @ts-expect-error untyped CI module
import * as alert from '../scripts/ci/migration-apply-refusal-alert.mjs';

const ROOT = join(__dirname, '..');
const WORKFLOW = '.github/workflows/apply-merged-migration.yml';
const SCRIPT = 'scripts/ci/migration-apply-refusal-alert.mjs';

type Step = Record<string, any>;
type Job = Record<string, any> & { steps?: Step[] };
const wf = parse(readFileSync(join(ROOT, WORKFLOW), 'utf8')) as {
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
};
const runsTheScript = (job: Job) =>
  (job.steps ?? []).some((s) => typeof s.run === 'string' && s.run.includes(SCRIPT));
const reporters = Object.entries(wf.jobs).filter(([, job]) => runsTheScript(job));
const report: Job = reporters[0]?.[1] ?? {};
const condition = String(report.if ?? '').replace(/\s+/g, ' ');

// The condition with everything inside parentheses removed: what is left is
// joined at the top level, where an || would widen the gate past the failure.
const topLevel = (text: string) => {
  let depth = 0;
  let out = '';
  for (const ch of text.replace(/^\$\{\{\s*|\s*\}\}$/g, '')) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0) out += ch;
  }
  return out;
};

describe('the apply run reports its own refusal', () => {
  it('has exactly one job that runs the refusal alert, and it is not the apply job', () => {
    expect(
      reporters.map(([name]) => name),
      `${WORKFLOW} must carry one job that runs ${SCRIPT}`
    ).toHaveLength(1);
    expect(reporters[0][0]).not.toBe('apply');
    expect(wf.jobs.apply, 'the apply job itself').toBeDefined();
  });

  it('needs the apply job and runs only when that job concluded failure', () => {
    expect([report.needs].flat()).toEqual(['apply']);
    // Without always() a job whose need failed is skipped, so it must be there.
    expect(condition).toContain('always()');
    expect(condition).toContain("needs.apply.result == 'failure'");
    // Joined by && at the top level: no || may widen it past the failure.
    expect(topLevel(condition), 'no top-level || beside the failure gate').not.toContain('||');
    expect(topLevel(condition)).toContain("needs.apply.result == 'failure'");
    expect(condition).not.toMatch(/needs\.apply\.result (?:==|!=) '(?!failure')/);
    expect(report['continue-on-error']).toBeUndefined();
  });

  it('does not report a dry run, which sends nothing', () => {
    expect(condition).toContain(
      "!(inputs.dry_run || toJSON(github.event.client_payload.dry_run) == 'true')"
    );
  });

  it('holds no environment and no secret, so it can never reach the database', () => {
    expect('environment' in report).toBe(false);
    const text = JSON.stringify(report);
    expect(text).not.toMatch(/secrets\./);
    expect(report.secrets).toBeUndefined();
    expect(text).not.toMatch(/DATABASE_URL|SUPABASE|PGPASSWORD/i);
    expect(text).not.toMatch(/npm (?:i|install|ci)\b/);
  });

  it('holds the two write scopes a comment needs and nothing wider', () => {
    expect(report.permissions).toEqual({
      contents: 'read',
      actions: 'read',
      issues: 'write',
      'pull-requests': 'write',
    });
    // The apply job, which holds the database credential, gained no write scope.
    expect(wf.permissions).toEqual({ contents: 'read', actions: 'read', 'pull-requests': 'read' });
    expect(wf.jobs.apply.permissions).toBeUndefined();
  });

  it('runs reviewed default-branch code on its own run id, bounded, with no stored credential', () => {
    const checkout = (report.steps ?? []).find((s) =>
      String(s.uses ?? '').startsWith('actions/checkout@')
    );
    expect(checkout?.with?.ref).toBe('${{ github.event.repository.default_branch }}');
    expect(checkout?.with?.['persist-credentials']).toBe(false);
    const step = (report.steps ?? []).find(
      (s) => typeof s.run === 'string' && s.run.includes(SCRIPT)
    )!;
    expect(step.run.trim()).toBe(`node ${SCRIPT}`);
    expect(step.env).toEqual({
      GH_TOKEN: '${{ github.token }}',
      REPO: '${{ github.repository }}',
      APPLY_RUN_ID: '${{ github.run_id }}',
    });
    expect(report['runs-on']).toBe('ubuntu-latest');
    expect(Number(report['timeout-minutes'])).toBeLessThanOrEqual(5);
  });

  it('names the two jobs the way the script tells them apart', () => {
    // The jobs API gives a job's rendered name, never its key.
    expect(report.name).toBe(alert.REPORT_JOB_NAME);
    expect(String(wf.jobs.apply.name).startsWith(alert.APPLY_JOB_NAME_PREFIX)).toBe(true);
    expect(String(report.name).startsWith(alert.APPLY_JOB_NAME_PREFIX)).toBe(false);
    const pick = alert.pickFailedApplyJob;
    const failedApply = {
      id: 1,
      name: 'Apply 20261127172908_x.sql',
      status: 'completed',
      conclusion: 'failure',
    };
    const reporter = { id: 2, name: report.name, status: 'in_progress', conclusion: null };
    expect(pick([reporter, failedApply])?.id).toBe(1);
    expect(pick([{ ...reporter, status: 'completed', conclusion: 'failure' }])).toBeNull();
  });
});
