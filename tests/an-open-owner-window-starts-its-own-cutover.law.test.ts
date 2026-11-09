/**
 * ===========================================================================
 *  LAW: AN OPEN OWNER WINDOW STARTS ITS OWN CUTOVER (2026-11-08)
 * ===========================================================================
 *
 * A booked owner window did nothing until a person dispatched the explicit
 * owner selection: the November 7 booking expired unused, the November 8
 * 18:20Z window sat idle for about seventy minutes, and every retry after new
 * evidence waited for someone to notice. stage-engine-release.yml now decides
 * on events it already receives (protected pushes, the existing schedule,
 * successful push Backup and prequalification completions) and, when the
 * window is ready, sends the SAME manual owner dispatch. The decision itself
 * is exercised in tests/operations/owner-window-autostart.test.py.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const root = process.cwd();
const stage = parse(readFileSync(join(root, '.github/workflows/stage-engine-release.yml'), 'utf8'));
const job = stage.jobs['owner-window'];
const step = (name: RegExp) => job.steps.find((s: { name?: string }) => name.test(s.name ?? ''));

describe('an open owner window starts its own cutover', () => {
  it('exercises the start, refusal, re-attempt and sealed-window decisions', () => {
    execFileSync('python3', ['-B', 'tests/operations/owner-window-autostart.test.py'], { cwd: root });
  });

  it('decides on events the workflow already receives; no timer is added', () => {
    expect(stage.on.schedule).toEqual([
      { cron: '31,35,39,43 3,8 * * *' },
      { cron: '31,35,39,43 4,9 * * *' },
    ]);
    expect(stage.on.workflow_run.workflows).toEqual([
      'Backup Engine (Clone, Stage, Certify)',
      'Engine release prequalification',
    ]);
    expect(job.if).toContain('github.run_attempt == 1');
    expect(job.if).toContain("github.ref == 'refs/heads/main'");
    expect(job.if).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(job.if).not.toContain('workflow_dispatch');
    // Prequalification completions never enter the daily election.
    expect(stage.jobs.detect.if).toContain(
      "github.event.workflow_run.name == 'Backup Engine (Clone, Stage, Certify)'"
    );
  });

  it('one decision at a time, never cancelled, and it only reads before it dispatches', () => {
    expect(job.concurrency).toEqual({ group: 'owner-window-start', 'cancel-in-progress': false });
    expect(job.permissions).toEqual({ actions: 'write', contents: 'read', statuses: 'read' });
    const decide = step(/^Decide whether the open owner window starts now$/);
    expect(decide.run).toContain('scripts/ci/select-daily-engine.py');
    expect(decide.run).toContain('--owner-start');
    expect(decide.run).not.toMatch(/dispatches|--method/);
  });

  it('sends only the existing manual owner selection, with a database break refused', () => {
    const send = step(/^Dispatch the existing explicit owner selection$/);
    expect(send.if).toBe("steps.decide.outputs.start == 'true'");
    expect(send.run).toContain('repos/$REPO/actions/workflows/stage-engine-release.yml/dispatches');
    expect(send.run).toContain("-f 'inputs[request_engine_release]=true'");
    expect(send.run).toContain("-f 'inputs[request_database_break]=false'");
    expect(send.run).toContain('-f ref=main');
    expect(send.run).not.toContain('deploy-club-arena-engine');
    expect(stage['run-name']).toContain("format('Owner engine window {0}', inputs.owner_window_id)");
  });

  it('the manual owner route is unchanged and still validated by the protected admission', () => {
    expect(stage.on.workflow_dispatch.inputs.owner_window_id.required).toBe(true);
    expect(stage.on.workflow_dispatch.inputs.request_engine_release.default).toBe(false);
    const admission = stage.jobs.detect.steps.find((s: { id?: string }) => s.id === 'admission');
    expect(admission.run).toContain('reader.owner_selection_policy(');
    expect(stage.jobs.detect.if).toContain(
      "(inputs.request_engine_release && !inputs.request_database_break && github.ref == 'refs/heads/main')"
    );
  });
});
