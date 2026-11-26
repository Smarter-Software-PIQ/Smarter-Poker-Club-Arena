/**
 * LAW: EVERY CYCLE HAS AN OWNER OR SAYS SO (O32, 2026-11-26).
 *
 * A certified engine cutover is scheduled every three hours. One Stage run
 * owns each cycle: the first eligible run created inside the cycle's election
 * window. On 2026-11-26 the 10:00 America/Chicago cycle (16:00Z; window 13:50Z
 * to 15:50Z) had no owner. The pushes were before and after the window, no
 * schedule run was delivered, and the only events inside it were the
 * completions of two failed push Backups (Stage runs 45842790604 and
 * 45846574486), which the election refused because the Backup had not
 * succeeded. No selection ran, nothing reached the cutover log (issue #11599)
 * and nobody was told.
 *
 * Two rules, pinned here:
 *
 * 1. THE ELECTION NEEDS AN EVENT, NOT A CERTIFICATE. A first-attempt Backup
 *    completion on main elects whether the Backup succeeded, failed or timed
 *    out. Nothing after the admission reads the Backup that woke the run.
 * 2. NO SILENT CYCLE. Every Stage run looks back once (job cycle-look-back,
 *    scripts/release/cycle-without-outcome.py) and posts NO OWNER or
 *    NO OUTCOME on the cutover log for a cycle whose election closed with no
 *    result; the owner gets one Messenger note and the outcome ledger gets
 *    the gap. Reporting only: no trigger, timer, dispatch or retry of a
 *    release, and "could not tell" posts nothing.
 *
 * WHAT THIS LAW DOES NOT CLAIM. A window with no push, no delivered schedule
 * and no Backup completion still has no owner; only an identity that is not
 * the job token can start a run then (docs/changelog/2026-11-26-o32-*.md).
 * Such a cycle is now announced, not prevented.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const stageText = read('.github/workflows/stage-engine-release.yml');
const stage = parse(stageText);
const script = read('scripts/release/cycle-without-outcome.py');
const ledger = read('scripts/ci/cutover-outcome-ledger.py');
const admission: string = stage.jobs.detect.steps.find(
  (s: { id?: string }) => s.id === 'admission'
).run;

const FULL =
  "!((github.event_name == 'workflow_dispatch' || github.event_name == 'repository_dispatch') && (github.actor == 'github-actions[bot]' || github.triggering_actor == 'github-actions[bot]'))";
const RERUN = "!(github.run_attempt != '1' && github.triggering_actor == 'github-actions[bot]')";

const evaluate = (expression: string, context: Record<string, unknown>) => {
  const body = expression
    .replace(/^\$\{\{\s*/, '')
    .replace(/\s*\}\}$/, '')
    .replace(/\b(?:github|inputs)(?:\.[A-Za-z_]+)+/g, (path) => `get(${JSON.stringify(path)})`);
  const get = (path: string) =>
    path
      .split('.')
      .reduce<unknown>(
        (value, key) =>
          value !== null && typeof value === 'object'
            ? ((value as Record<string, unknown>)[key] ?? null)
            : null,
        context
      );
  const startsWith = (value: unknown, prefix: string) =>
    String(value ?? '')
      .toLowerCase()
      .startsWith(prefix.toLowerCase());
  return new Function('get', 'startsWith', `return (${body});`)(get, startsWith);
};
const completion = (run: Record<string, unknown>) => ({
  github: {
    event_name: 'workflow_run',
    repository: 'test/repo',
    ref: 'refs/heads/main',
    event: {
      workflow_run: {
        event: 'push',
        path: '.github/workflows/backup-engine.yml',
        head_repository: { full_name: 'test/repo' },
        head_branch: 'main',
        run_attempt: 1,
        conclusion: 'success',
        display_title: 'fix: something (#1)',
        ...run,
      },
    },
  },
  inputs: {},
});
const RESERVATION = 'Automatic Backup daily reservation';
const OUTSIDE = 'Backup completion outside election';

describe('the election needs an event, not a certificate', () => {
  it('2026-11-26: the two failed push Backups elect, the failed scheduled one does not', () => {
    // Backup runs 45827343954 and 45827378798 (push, failure) and 45845308550
    // (schedule, failure), whose completions were Stage runs 45842790604,
    // 45846574486 and 45850278483.
    for (const title of [
      'feat(horses): five Horse option PRs',
      'perf(horse): the big-draw sampler',
    ]) {
      const ctx = completion({ conclusion: 'failure', display_title: title });
      expect(evaluate(stage['run-name'], ctx)).toBe(RESERVATION);
      expect(evaluate(stage.jobs.detect.if, ctx)).toBe(true);
    }
    const scheduled = completion({ event: 'schedule', conclusion: 'failure' });
    expect(evaluate(stage['run-name'], scheduled)).toBe(OUTSIDE);
    expect(evaluate(stage.jobs.detect.if, scheduled)).toBe(false);
  });

  it('admits success, failure and timed_out, and no other conclusion', () => {
    const verdicts = Object.fromEntries(
      [
        'success',
        'failure',
        'timed_out',
        'cancelled',
        'skipped',
        'neutral',
        'action_required',
        'stale',
        'startup_failure',
        null,
      ].map((conclusion) => [
        String(conclusion),
        [
          evaluate(stage['run-name'], completion({ conclusion })),
          evaluate(stage.jobs.detect.if, completion({ conclusion })),
        ],
      ])
    );
    expect(verdicts).toEqual({
      success: [RESERVATION, true],
      failure: [RESERVATION, true],
      timed_out: [RESERVATION, true],
      cancelled: [OUTSIDE, false],
      skipped: [OUTSIDE, false],
      neutral: [OUTSIDE, false],
      action_required: [OUTSIDE, false],
      stale: [OUTSIDE, false],
      startup_failure: [OUTSIDE, false],
      null: [OUTSIDE, false],
    });
  });

  it('widens nothing else: a replay, another branch, repository, workflow or starting event stays outside', () => {
    for (const run of [
      { run_attempt: 2 },
      { head_branch: 'other' },
      { head_repository: { full_name: 'fork/repo' } },
      { path: '.github/workflows/other.yml' },
      { event: 'schedule' },
      { event: 'workflow_dispatch' },
      { event: 'repository_dispatch' },
    ]) {
      const ctx = completion({ ...run, conclusion: 'failure' });
      expect(evaluate(stage['run-name'], ctx), JSON.stringify(run)).toBe(OUTSIDE);
      expect(evaluate(stage.jobs.detect.if, ctx), JSON.stringify(run)).toBe(false);
    }
  });

  it('nothing after the admission reads the Backup that woke the run', () => {
    const uses = stageText.split('\n').filter((line) => line.includes('github.event.workflow_run'));
    expect(uses.length).toBe(2);
    expect(uses[0].startsWith('run-name: ')).toBe(true);
    expect(uses[1].trimStart().startsWith('if: ')).toBe(true);
    expect(read('scripts/ci/select-daily-engine.py')).not.toMatch(/workflow_run\b.*conclusion/);
  });

  it('adds no title, trigger or timer: every reader of the election names the same runs', () => {
    expect(admission).toContain(
      'automatic_backup = run.get("event") == "workflow_run" and (title == "Automatic Backup daily reservation"'
    );
    expect(read('scripts/ci/read-engine-prequalification.py')).toContain(
      '(run["event"] == "workflow_run" and run.get("display_title") == "Automatic Backup daily reservation")'
    );
    expect(read('server/scripts/engine-release-window-doors.py')).toContain(
      "title == 'Automatic Backup daily reservation'"
    );
    expect(Object.keys(stage.on)).toEqual([
      'repository_dispatch',
      'workflow_run',
      'workflow_dispatch',
      'push',
      'schedule',
    ]);
    expect(stage.on.schedule.length).toBe(2);
    expect(stage.on.workflow_run).toEqual({
      workflows: ['Backup Engine (Clone, Stage, Certify)'],
      branches: ['main'],
      types: ['completed'],
    });
  });
});

describe('no cycle passes in silence', () => {
  const look = stage.jobs['cycle-look-back'];
  const note = stage.jobs['cycle-without-outcome-note'];
  const record = stage.jobs['cutover-outcome-record'];

  it('replays 2026-11-26, both DST days, two callers and every unreadable read (python)', () => {
    const result = spawnSync('python3', ['-B', 'tests/operations/cycle-without-outcome.test.py'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 170_000,
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stderr).toMatch(/Ran \d\d tests/);
  }, 180_000);

  it('every Stage run looks back once: no needs, no wait, no secret, and it cannot fail the run', () => {
    expect(look.if).toBe(`github.ref == 'refs/heads/main' && ${FULL} && ${RERUN}`);
    expect(look.needs).toBeUndefined();
    // The election reads a failed earlier run as one that keeps its cycle, so
    // this job may never turn a run red or hold it open.
    expect(look['continue-on-error']).toBe(true);
    expect(look['timeout-minutes']).toBeLessThanOrEqual(4);
    expect(look.environment).toBeUndefined();
    expect(JSON.stringify(look)).not.toMatch(/secrets\./);
    expect(look.permissions).toEqual({ actions: 'read', contents: 'read', issues: 'write' });
    expect(look.outputs).toEqual({
      notes: '${{ steps.look.outputs.notes }}',
      gaps: '${{ steps.look.outputs.gaps }}',
    });
    expect(look.steps.length).toBe(2);
    expect(look.steps[0].with['sparse-checkout']).toBe(
      'scripts/release/cycle-without-outcome.py\nscripts/ci/cutover-outcome-ledger-seed.json\nserver/src/maintenance/maintenanceSchedulePolicy.json\n'
    );
    const run: string = look.steps[1].run;
    expect(run).toContain('python3 -B scripts/release/cycle-without-outcome.py run --repo "$REPO"');
    expect(run).toContain('--post');
    expect(run).not.toMatch(/\bsleep\b|\buntil\b|\bwhile\b|gh (?:api|workflow|run)/);
  });

  it('the owner note holds the only secret, runs only when a line was posted, and refuses the job token', () => {
    expect(note.if).toBe(
      `needs.cycle-look-back.outputs.notes != '' && github.ref == 'refs/heads/main' && ${FULL} && ${RERUN}`
    );
    expect(note.needs).toBe('cycle-look-back');
    expect(note['continue-on-error']).toBe(true);
    expect(note['timeout-minutes']).toBeLessThanOrEqual(3);
    expect(note.environment).toBe('ci-main');
    expect(note.permissions).toEqual({});
    expect(note.steps.length).toBe(1);
    expect(
      [...JSON.stringify(note).matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]).sort()
    ).toEqual(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL']);
    expect(note.steps[0].run).toContain(
      '"$SUPABASE_URL/rest/v1/rpc/fn_ca_note_cycle_did_not_seal"'
    );
    expect(note.steps[0].run).not.toMatch(/\bsleep\b|gh api|dispatches/);
  });

  it('no release job waits for the look-back; only the ledger record reads it', () => {
    const readers = Object.entries(stage.jobs as Record<string, { needs?: string | string[] }>)
      .filter(([, job]) => [job.needs ?? []].flat().includes('cycle-look-back'))
      .map(([name]) => name)
      .sort();
    expect(readers).toEqual(['cutover-outcome-record', 'cycle-without-outcome-note']);
    expect(record.needs).toEqual(['detect', 'selection', 'cycle-look-back']);
    expect(String(record.if).startsWith('always() && ')).toBe(true);
    const step = record.steps.find((s: { id?: string }) => s.id === 'record');
    expect(step.env.GAPS).toBe('${{ needs.cycle-look-back.outputs.gaps }}');
    expect(step.run).toContain('--gaps look-back-gaps.json');
    expect(ledger).toContain('GAP_OUTCOMES = {"no-owner", "no-outcome"}');
    expect(ledger).toContain('ledger = [r for r in ledger if not is_gap(r)]');
  });

  it("the script replays the admission's own election and only ever writes one issue comment", () => {
    // The same windows and names as the admission step and the workflow.
    expect(admission).toContain('WINDOW_MINUTES = 20');
    expect(script).toContain('WINDOW_AFTER_CUTOFF = 1200');
    expect(admission).toContain(
      'timedelta(hours=5) if not three_hourly else timedelta(minutes=100)'
    );
    expect(script).toContain('LOOKBACK_THREE_HOURLY = 100 * 60');
    expect(script).toContain('LOOKBACK_DAILY = 5 * 3600');
    expect(admission).toContain('STOOD_DOWN_MARGIN = 120');
    expect(script).toContain('STOOD_DOWN_MARGIN = 120');
    expect(script).toContain(`DETECT_JOB = "${stage.jobs.detect.name}"`);
    const cutoff = stage.jobs.detect.steps.find((s: { id?: string }) => s.id === 'cutoff');
    expect(script).toContain(`CUTOFF_STEP = "${cutoff.name}"`);
    expect(admission).toContain(`CUTOFF_STEP = "${cutoff.name}"`);
    for (const title of [
      'Automatic Backup daily reservation',
      'Daily engine reservation',
      'Original operator daily preparation',
    ]) {
      expect(stage['run-name']).toContain(`'${title}'`);
      expect(script).toContain(`"${title}"`);
    }
    expect(script).toContain('LOG_ISSUE = "11599"');
    // Reporting only: one write, the cutover log comment.
    const methods = script.split('\n').filter((line) => line.includes('"--method"'));
    expect(methods.length).toBe(1);
    expect(methods[0]).toContain('"POST", f"repos/{args.repo}/issues/{LOG_ISSUE}/comments"');
    expect(script).not.toMatch(/\/dispatches|\/rerun|\/cancel|time\.sleep|SUPABASE|secrets/);
    expect(script).toContain('class CouldNotTell(Exception)');
  });

  it('the note is plain and carries no em dash', () => {
    expect(script).toContain('did not run: nothing started it. "');
    expect(script).toContain('"The engine kept running the current version."');
    for (const text of [script, ledger, read('tests/operations/cycle-without-outcome.test.py')])
      expect(text.includes(String.fromCharCode(0x2014))).toBe(false);
  });
});
