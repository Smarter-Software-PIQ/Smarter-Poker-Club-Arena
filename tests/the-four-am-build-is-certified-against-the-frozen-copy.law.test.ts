/**
 * THE 04:00 BUILD IS CERTIFIED AGAINST THE FROZEN COPY (incident 076ff467,
 * EngineCutoverMissed fired 2026-11-16, 17, 18 and 19).
 *
 * Every 03:30 selection those mornings answered keep-serving: certificates
 * made before the last pre-freeze install held a stale copy, and candidates
 * merged inside the release schema freeze carried migrations the freeze holds
 * until 04:15. The one run meant to certify the shippable build on a fresh
 * copy (the 00:01 nightly schedule) was delivered by GitHub 7-10 hours late on
 * every day checked. These laws pin the replacement:
 *
 *   1. the Backup plan job asks scripts/ci/backup-freeze-baseline.py first,
 *      and a `due` answer certifies that exact build with the refresh forced,
 *      before any superseded / retarget / already-certified step can skip it;
 *   2. the reader's window is derived from the dispatcher's freeze start and
 *      the selector's own 03:30 cutoff,
 *      and a run started at its last minute still finishes before 03:30;
 *   3. the cutover watch owes the same build (freeze start minus SETTLE);
 *   4. the 2026-11-19 night replays as `due` inside the freeze and `outside`
 *      before it and after the last useful start.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const workflow = read('.github/workflows/backup-engine.yml');
const reader = read('scripts/ci/backup-freeze-baseline.py');
const dispatcher = read('scripts/ci/merged-migration-dispatch.mjs');

const num = (re: RegExp, text: string) => {
  const m = re.exec(text);
  if (!m) throw new Error(`not found: ${re}`);
  return m.slice(1).map(Number);
};
const [freezeH, freezeM] = num(
  /RELEASE_SCHEMA_FREEZE_CHICAGO\s*=\s*\{\s*from:\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/,
  dispatcher
);
const selector = read('scripts/ci/select-daily-engine.py');
const [selH, selM] = num(
  /def cutoff\(day\):\s*\n\s*return [\s\S]*?time\((\d+),\s*(\d+)\)/,
  selector
);
const [runWorst] = num(/BACKUP_RUN_WORST_MINUTES\s*=\s*(\d+)/, reader);
const [settle] = num(/SETTLE\s*=\s*timedelta\(minutes=(\d+)\)/, reader);

function decide(nowIso: string): Record<string, string> {
  const script = [
    'import importlib.util, json, sys',
    'from datetime import datetime',
    `spec = importlib.util.spec_from_file_location('b', ${JSON.stringify(join(ROOT, 'scripts/ci/backup-freeze-baseline.py'))})`,
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    `clock = m.clock_of(open(${JSON.stringify(join(ROOT, 'scripts/ci/merged-migration-dispatch.mjs'))}).read(), open(${JSON.stringify(join(ROOT, 'scripts/ci/select-daily-engine.py'))}).read())`,
    `now = datetime.fromisoformat(${JSON.stringify(nowIso)}.replace('Z', '+00:00'))`,
    "print(json.dumps(m.decide(now, clock, lambda until: 'a' * 40, lambda sha, start: False)))",
  ].join('\n');
  return JSON.parse(execFileSync('python3', ['-c', script], { encoding: 'utf8' }));
}

describe('the Backup certifies the build the freeze can ship', () => {
  const plan = workflow.slice(workflow.indexOf('      - id: plan'));

  it('asks the freeze-baseline reader before anything can supersede or skip the run', () => {
    const ask = plan.indexOf('scripts/ci/backup-freeze-baseline.py?ref=main');
    expect(ask).toBeGreaterThan(0);
    for (const later of [
      'SUPERSEDED:',
      'RETARGETED:',
      'ALREADY CERTIFIED:',
      'inherit_eligible=true',
    ]) {
      expect(plan.indexOf(later)).toBeGreaterThan(ask);
    }
  });

  it('a due answer certifies exactly that build with the copy refreshed, and stops planning', () => {
    const block = plan.slice(
      plan.indexOf('if [ "$baseline_state" = due ]'),
      plan.indexOf('SUPERSEDED:')
    );
    expect(block).toContain('echo "sha=$baseline" >> "$GITHUB_OUTPUT"');
    expect(block).toContain('echo "refresh=force" >> "$GITHUB_OUTPUT"');
    expect(block).toContain('exit 0');
    expect(block).not.toContain('inherit_eligible');
  });

  it('only push and schedule runs ask, and any other answer plans as before', () => {
    expect(plan).toContain('if [ "$EVENT" = push ] || [ "$EVENT" = schedule ]; then');
    expect(plan).toMatch(/baseline_state=unknown/);
  });
});

describe('the reader follows the dispatcher release clock', () => {
  it('a run started at the window end still certifies before the selection reads', () => {
    const windowEnd = selH * 60 + selM - runWorst;
    expect(windowEnd + runWorst).toBeLessThanOrEqual(selH * 60 + selM);
    // The freeze may start the evening before (23:45): place it on the same
    // timeline as the window end, minutes from the cutover date's midnight.
    const start = freezeH * 60 + freezeM;
    expect(windowEnd).toBeGreaterThan(start >= 12 * 60 ? start - 24 * 60 : start);
  });

  it('replays the 2026-11-19 night against the dispatcher clock', () => {
    // Chicago is UTC-6 on 2026-11-19. Instants one minute either side of the
    // freeze start and of the window end, read from the dispatcher clock.
    const end = selH * 60 + selM - runWorst;
    const start = freezeH * 60 + freezeM;
    const utc = (chicagoMinutes: number) => {
      const day = chicagoMinutes < 12 * 60 ? 19 : 18; // morning of the 19th, evening of the 18th
      const t = new Date(Date.UTC(2026, 10, day, 6, 0, 0) + chicagoMinutes * 60_000);
      return t.toISOString().replace('.000Z', 'Z');
    };
    expect(decide(utc(start - 1)).state).toBe('outside');
    const due = decide(utc(start + 1));
    expect(due.state).toBe('due');
    expect(due.baseline).toBe('a'.repeat(40));
    expect(decide(utc(end - 1)).state).toBe('due');
    expect(decide(utc(end + 1)).state).toBe('outside');
    expect(decide('2026-11-19T18:00:00Z').state).toBe('outside');
  });
});

describe('the cutover watch owes the same build', () => {
  const dir = join(ROOT, 'supabase/migrations');
  const latest = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => readFileSync(join(dir, f), 'utf8').includes('ca_cutover_owed_build(v_serving'))
    .pop()!;
  const sql = readFileSync(join(dir, latest), 'utf8');

  it('reads the owed build at freeze start minus SETTLE, counted from the cutover date midnight', () => {
    // A freeze that starts in the evening (23:45) belongs to the night before
    // the cutover date: its offset from that date's midnight is negative.
    const start = freezeH * 60 + freezeM;
    const fromMidnight = (start >= 12 * 60 ? start - 24 * 60 : start) - settle;
    expect(sql).toMatch(
      new RegExp(
        `\\(v_day::timestamp \\+ interval ''?${fromMidnight} minutes''?\\) AT TIME ZONE c_tz`
      )
    );
  });
});
