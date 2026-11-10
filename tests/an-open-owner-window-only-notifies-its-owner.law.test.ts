/**
 * ===========================================================================
 *  LAW: AN OPEN OWNER WINDOW ONLY NOTIFIES ITS OWNER (2026-11-09)
 * ===========================================================================
 *
 * Owner order: "Phase 3 must notify the release owner without dispatching."
 * The first Phase 3 build dispatched the explicit owner selection itself and
 * re-dispatched on new evidence. That broke the standing rule (CLAUDE.md,
 * AGENTS.md) that no timer, watcher or scheduled agent may initiate, retry or
 * certify a release.
 *
 * Phase 3 is now .github/workflows/owner-window-ready.yml running
 * scripts/ci/owner-window-ready.py, which reuses the selector read-only. This
 * law fails if any file on that path calls a workflow dispatch, a
 * repository_dispatch, `gh workflow run`, `gh run rerun`, `gh run cancel` (or
 * their REST and Octokit forms), or if the workflow asks for actions: write,
 * gains a timer, or adds an action that could do any of that for it. The
 * decision itself is exercised in tests/operations/owner-window-ready.test.py.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const root = join(__dirname, '..');
const WORKFLOW = '.github/workflows/owner-window-ready.yml';
/** The Phase 3 workflow and every repository script it runs or loads. */
const PATH = [
  WORKFLOW,
  'scripts/ci/owner-window-ready.py',
  'scripts/ci/select-daily-engine.py',
  'scripts/ci/read-engine-prequalification.py',
];

/** Anything that starts, retries or cancels a workflow run. */
const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ['workflow or repository dispatch (REST)', /\/dispatches\b/],
  ['gh workflow run', /\bgh\s+workflow\s+run\b/],
  ['gh run rerun', /\bgh\s+run\s+rerun\b/],
  ['gh run cancel', /\bgh\s+run\s+cancel\b/],
  ['run rerun or cancel (REST)', /\/(?:rerun|rerun-failed-jobs|cancel|force-cancel)\b/],
  [
    'Octokit dispatch, rerun or cancel',
    /\b(?:createWorkflowDispatch|createDispatchEvent|reRunWorkflow\w*|reRunJob\w*|cancelWorkflowRun|forceCancelWorkflowRun)\b/,
  ],
  ['actions: write', /\bactions['"]?\s*:\s*['"]?write\b/],
  ['write-all permissions', /\bwrite-all\b/],
];

/** Code only: YAML comments vanish in the parse; Python `#` lines are prose. */
const code = (path: string): string => {
  const text = readFileSync(join(root, path), 'utf8');
  return path.endsWith('.yml') ? JSON.stringify(parse(text)) : text.replace(/^\s*#.*$/gm, '');
};

const violations = (text: string): string[] =>
  FORBIDDEN.filter(([, re]) => re.test(text)).map(([name]) => name);

describe('an open owner window only notifies its owner', () => {
  it('exercises the notice, the refusals and once-per-evidence', () => {
    execFileSync('python3', ['-B', 'tests/operations/owner-window-ready.test.py'], { cwd: root });
  });

  it('nothing on the Phase 3 path dispatches, retries or cancels a run, or asks for actions: write', () => {
    for (const path of PATH) expect(violations(code(path)), path).toEqual([]);
  });

  it('the detector catches every form it forbids', () => {
    for (const sample of [
      'gh api --method POST "repos/$REPO/actions/workflows/stage-engine-release.yml/dispatches"',
      'gh api -X POST repos/o/r/dispatches -f event_type=deploy-club-arena-engine',
      'gh workflow run stage-engine-release.yml -f owner_window_id=x',
      'gh run rerun 123',
      'gh run cancel 123',
      "api(f'repos/{repo}/actions/runs/{run}/rerun')",
      "api(f'repos/{repo}/actions/runs/{run}/cancel')",
      'await github.rest.actions.createWorkflowDispatch({})',
      'await github.rest.repos.createDispatchEvent({})',
      '    permissions:\n      actions: write',
      JSON.stringify({ permissions: { actions: 'write' } }),
      'permissions: write-all',
    ]) {
      expect(violations(sample), sample).not.toEqual([]);
    }
    // cancel-in-progress is the job's own queue, not a run cancellation.
    expect(violations('  cancel-in-progress: false')).toEqual([]);
  });

  it('the workflow reads, comments on an issue, adds no timer and runs no other action', () => {
    const wf = parse(readFileSync(join(root, WORKFLOW), 'utf8'));
    expect(wf.permissions).toEqual({});
    expect(Object.keys(wf.on).sort()).toEqual(['push', 'workflow_run']);
    expect(wf.on.workflow_run.workflows).toEqual([
      'Backup Engine (Clone, Stage, Certify)',
      'Engine release prequalification',
    ]);
    expect(wf.concurrency).toEqual({ group: 'owner-window-ready', 'cancel-in-progress': false });
    expect(Object.keys(wf.jobs)).toEqual(['notify']);
    const job = wf.jobs.notify;
    expect(job.permissions).toEqual({
      actions: 'read',
      contents: 'read',
      issues: 'write',
      statuses: 'read',
    });
    expect(job.if).toContain('github.run_attempt == 1');
    for (const step of job.steps) {
      if (step.uses) expect(step.uses).toBe('actions/checkout@v4');
    }
    const notify = job.steps.find((s: { name?: string }) => s.name === 'Notify the release owner');
    expect(notify.if).toBe("steps.decide.outputs.notify == 'true'");
    expect(notify.run).toMatch(/gh issue comment "\$ISSUE"/);
    expect(notify.run).toMatch(/gh issue create/);
    const writes = job.steps.map((s: { run?: string }) => s.run ?? '').join('\n');
    expect(
      writes
        .match(/\bgh\s+\w+\s+\w+/g)
        ?.filter((c: string) => !/^gh issue (comment|create)$/.test(c))
    ).toEqual([]);
  });
});
