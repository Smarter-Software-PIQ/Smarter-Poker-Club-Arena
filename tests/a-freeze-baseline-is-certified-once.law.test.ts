/**
 * A FREEZE BASELINE IS CERTIFIED ONCE, AND A RUN THAT TESTED NOTHING NEVER
 * OVERWRITES ITS CERTIFICATE (incident 076ff467, EngineCutoverMissed 2026-11-20).
 *
 * The baseline 62520794 was certified at 02:18 Chicago. Pushes merged while it
 * soaked each planned `due` again; two duplicates queued for the Backup host,
 * one timed out waiting for its turn and published `failure` over the success
 * at 03:18, and the 03:30 selection (which reads the newest status) found no
 * certified candidate. The 04:00 cutover kept serving.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const workflow = readFileSync(join(ROOT, '.github/workflows/backup-engine.yml'), 'utf8');
const START = '2026-11-20T05:45:00+00:00';

type Row = { context: string; state: string; created_at: string; target_url?: string };
function state(rows: Row[], runs: Record<string, string | null> = {}): string | null {
  const script = [
    'import importlib.util, json, sys',
    'from datetime import datetime',
    `spec = importlib.util.spec_from_file_location('b', ${JSON.stringify(join(ROOT, 'scripts/ci/backup-freeze-baseline.py'))})`,
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    `rows = json.loads(${JSON.stringify(JSON.stringify(rows))})`,
    `runs = json.loads(${JSON.stringify(JSON.stringify(runs))})`,
    `start = datetime.fromisoformat(${JSON.stringify(START)})`,
    'print(json.dumps(m.certification_state(rows, start, lambda rid: runs.get(rid))))',
  ].join('\n');
  return JSON.parse(execFileSync('python3', ['-c', script], { encoding: 'utf8' }));
}
const C = 'backup-engine/certified';
const run = (id: string) => `https://github.com/o/r/actions/runs/${id}`;

describe('the freeze-baseline reader certifies a baseline once', () => {
  it('a success written after the freeze began is done, even under a newer refusal', () => {
    expect(
      state([
        { context: C, state: 'failure', created_at: '2026-11-20T09:18:36Z' },
        { context: C, state: 'success', created_at: '2026-11-20T08:18:30Z' },
      ])
    ).toBe('done');
  });
  it('a pending status whose run is still active is a claim, not due', () => {
    for (const status of ['queued', 'in_progress', 'waiting'])
      expect(
        state(
          [
            {
              context: C,
              state: 'pending',
              created_at: '2026-11-20T07:24:58Z',
              target_url: run('44689115500'),
            },
          ],
          { '44689115500': status }
        )
      ).toBe('claimed');
  });
  it('a pending left by a run that ended, a refusal, or nothing is due', () => {
    expect(
      state(
        [
          {
            context: C,
            state: 'pending',
            created_at: '2026-11-20T07:24:58Z',
            target_url: run('1'),
          },
        ],
        { '1': 'completed' }
      )
    ).toBe('due');
    expect(state([{ context: C, state: 'failure', created_at: '2026-11-20T06:12:27Z' }])).toBe(
      'due'
    );
    expect(state([])).toBe('due');
  });
  it('a status from before the freeze began never counts', () => {
    expect(state([{ context: C, state: 'success', created_at: '2026-11-20T04:00:00Z' }])).toBe(
      'due'
    );
  });
  it('an unreadable claim run is unknown, never due', () => {
    expect(
      state(
        [
          {
            context: C,
            state: 'pending',
            created_at: '2026-11-20T07:24:58Z',
            target_url: run('9'),
          },
        ],
        { '9': null }
      )
    ).toBeNull();
  });
});

describe('the Backup workflow writes one claim and never lets a turnless run refuse', () => {
  const plan = workflow.slice(workflow.indexOf('      - id: plan'));
  it('a due answer writes the pending claim before it plans the baseline', () => {
    const due = plan.indexOf('if [ "$baseline_state" = due ]');
    const claim = plan.indexOf('-f state=pending', due);
    const out = plan.indexOf('echo "sha=$baseline" >> "$GITHUB_OUTPUT"', due);
    expect(due).toBeGreaterThan(0);
    expect(claim).toBeGreaterThan(due);
    expect(out).toBeGreaterThan(claim);
  });
  it('the refresh job reports whether it held the Backup host', () => {
    expect(workflow).toMatch(/outputs:\n\s+turn: \$\{\{ steps\.turn\.outputs\.acquired \}\}/);
    expect(workflow).toContain('echo "acquired=1" >> "$GITHUB_OUTPUT"');
  });
  it('a run that never held the host neither marks pending nor publishes a refusal', () => {
    expect(workflow).toMatch(
      /id: pending\n(?:\s+#.*\n)*\s+if: needs\.refresh\.result == 'success' \|\| needs\.refresh\.outputs\.turn == '1'/
    );
    const noturn = workflow.indexOf('[ "${TURN:-}" != 1 ]');
    const refusal = workflow.indexOf(
      'elif [ -n "$RC" ] || [ "$POLICY" = failure ] || [ "$REFRESH" != success ]; then state=failure'
    );
    expect(noturn).toBeGreaterThan(0);
    expect(noturn).toBeLessThan(refusal);
    expect(workflow).toContain('success) write=0;');
  });
});
