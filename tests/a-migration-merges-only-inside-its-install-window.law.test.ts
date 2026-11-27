/**
 * A MIGRATION MERGES ONLY INSIDE ITS INSTALL WINDOW (2026-11-26)
 *
 * On 2026-11-25 #12035 merged at 22:54 Chicago with an ordinary migration. The
 * dispatcher held it (correctly) to 04:15, but the merge had already put an
 * uninstalled migration on main: backup-engine.yml refused every later commit
 * and the 01:00 cycle kept serving. #12052 reverted it at 01:10, and at 04:15
 * the held dispatch still sent the reverted file (run 45799563014), refused
 * only because the applier looked for it.
 *
 * Two laws:
 *  1. The required status "Migration merge window" is success for a pull
 *     request with an ordinary migration only while releaseFreezeAdmission
 *     admits an install now and through the in-flight margin, or under a
 *     written outage override. Everything else in it is success.
 *  2. A held dispatch re-reads each file from the default branch after its
 *     wait and sends nothing for a file that left it.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  MERGE_WINDOW_CONTEXT,
  MERGE_WINDOW_OVERRIDE_LABEL,
  mergeWindowCloses,
  mergeWindowOpen,
  mergeWindowVerdict,
  nextMergeWindow,
  ordinaryMigrations,
  outageOverride,
  pushAction,
} from '../scripts/ci/migration-merge-window.mjs';
import { releaseFreezeAdmission } from '../scripts/ci/release-freeze-admission.mjs';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const at = (iso: string) => Date.parse(iso);
const C = 'three-hourly';
const ORDINARY = 'BEGIN;\nSELECT 1;\nCOMMIT;\n';
const WINDOWED = '-- @install-window: daily-maintenance\nBEGIN;\nSELECT 1;\nCOMMIT;\n';
const mig = (sql: string | undefined, changeType = 'ADDED') => ({
  path: 'supabase/migrations/20261126000000_x.sql',
  changeType,
  sql,
});
const verdict = (iso: string, files: unknown[], labels: string[] = [], body = '') =>
  mergeWindowVerdict({ nowMs: at(iso), cadence: C, baseRef: 'main', files, labels, body });

describe('a migration merges only inside its install window', () => {
  it('refuses the merge of 2026-11-25 22:54 Chicago that kept the 01:00 cycle serving', () => {
    // 22:54 CST = 04:54Z: inside the 01:00 cycle hold, before the 23:45 freeze.
    const v = verdict('2026-11-26T04:54:00Z', [mig(ORDINARY)]);
    expect(v.state).toBe('failure');
    expect(v.description).toMatch(
      /next 4:15 AM CST\. Open: gh workflow run migration-merge-window\.yml -f mode=keep$/
    );
  });

  it('opens exactly where the applier admits: 10-30 minutes after a cycle and 4:15-4:30 AM', () => {
    // 13:00 CST cycle = 19:00Z.
    expect(verdict('2026-11-26T19:09:00Z', [mig(ORDINARY)]).state).toBe('failure');
    expect(verdict('2026-11-26T19:10:00Z', [mig(ORDINARY)]).state).toBe('success');
    expect(verdict('2026-11-26T19:20:00Z', [mig(ORDINARY)]).description).toBe(
      'Install window open: merge before 1:27 PM CST'
    );
    // The in-flight margin: a merge at 13:27 could land after 13:30.
    expect(verdict('2026-11-26T19:27:00Z', [mig(ORDINARY)]).state).toBe('failure');
    // Nightly: the 04:00 cycle and the freeze leave only 04:15-04:27.
    expect(verdict('2026-11-26T10:14:00Z', [mig(ORDINARY)]).state).toBe('failure');
    expect(verdict('2026-11-26T10:15:00Z', [mig(ORDINARY)]).state).toBe('success');
    expect(verdict('2026-11-26T07:20:00Z', [mig(ORDINARY)]).state).toBe('failure'); // 01:20, in the freeze
  });

  it('never opens a minute the applier would refuse, all day', () => {
    const start = at('2026-11-26T06:00:00Z');
    for (let t = start; t < start + 24 * 3_600_000; t += 60_000) {
      if (mergeWindowOpen(t, C)) {
        expect(releaseFreezeAdmission({ nowMs: t, cadence: C }).admit).toBe(true);
        expect(releaseFreezeAdmission({ nowMs: t + 3 * 60_000, cadence: C }).admit).toBe(true);
      }
    }
    expect(nextMergeWindow(at('2026-11-26T04:54:00Z'), C)).toBe(at('2026-11-26T10:15:00Z'));
    expect(mergeWindowCloses(at('2026-11-26T10:15:00Z'), C)).toBe(at('2026-11-26T10:27:00Z'));
  });

  it('holds an unknown cadence like three-hourly, as the applier does', () => {
    expect(mergeWindowOpen(at('2026-11-26T18:00:00Z'), 'unknown')).toBe(false);
  });

  it('is success for a pull request with no ordinary migration, at any minute', () => {
    expect(
      verdict('2026-11-26T04:54:00Z', [{ path: 'src/a.ts', changeType: 'MODIFIED' }]).state
    ).toBe('success');
    expect(verdict('2026-11-26T04:54:00Z', [mig(WINDOWED)]).state).toBe('success');
    expect(verdict('2026-11-26T04:54:00Z', [mig(ORDINARY, 'DELETED')]).state).toBe('success');
    expect(
      mergeWindowVerdict({
        nowMs: at('2026-11-26T04:54:00Z'),
        cadence: C,
        baseRef: 'feature',
        files: [mig(ORDINARY)],
        labels: [],
        body: '',
      }).state
    ).toBe('success');
  });

  it('fails closed: a migration it cannot read or classify is ordinary', () => {
    expect(ordinaryMigrations([mig(undefined)])).toHaveLength(1);
    expect(
      ordinaryMigrations([mig('-- @install-window: daily-maintenance\n-- @install-window: x\n')])
    ).toHaveLength(1);
    expect(verdict('2026-11-26T04:54:00Z', [mig(undefined)]).state).toBe('failure');
  });

  it('admits an outage only with the label AND a written justification of 20+ characters', () => {
    const body = 'Fix.\nOutage override: cashier refuses every deposit since 22:40\n';
    expect(outageOverride([MERGE_WINDOW_OVERRIDE_LABEL], body)).toBe(
      'cashier refuses every deposit since 22:40'
    );
    expect(outageOverride([], body)).toBeNull();
    expect(outageOverride([MERGE_WINDOW_OVERRIDE_LABEL], 'Outage override: urgent')).toBeNull();
    const v = verdict('2026-11-26T04:54:00Z', [mig(ORDINARY)], [MERGE_WINDOW_OVERRIDE_LABEL], body);
    expect(v).toEqual({
      state: 'success',
      description: 'Outage override: cashier refuses every deposit since 22:40',
    });
  });

  it('no window depends on the schedule: a held run closes its own window, for one pull request or all', async () => {
    const src = read('scripts/ci/migration-merge-window.mjs');
    expect(src).toContain('export async function keep({ repo, number = null,');
    expect(src).toContain('sweep({ repo, number, nowMs: t, cadence, targetUrl, log });');
    expect(src).toMatch(
      /if \(t >= closes \|\| t - started > KEEPER_MAX_MINUTES \* MINUTE\) break;/
    );
  });

  it('a push to main opens a near window, closes a just-ended one, and otherwise does nothing', () => {
    // 13:00 cycle window 13:10-13:27 CST = 19:10-19:27Z.
    expect(pushAction(at('2026-11-26T18:50:00Z'), C)).toBe('keep'); // opens in 20 min
    expect(pushAction(at('2026-11-26T19:15:00Z'), C)).toBe('keep'); // open now
    expect(pushAction(at('2026-11-26T19:35:00Z'), C)).toBe('sweep'); // closed 8 min ago
    expect(pushAction(at('2026-11-26T20:00:00Z'), C)).toBe('none');
    expect(pushAction(at('2026-11-26T04:54:00Z'), C)).toBe('none'); // the 22:54 merge
  });

  it('a real cron opens every window: the OpenClaw job fires within the keeper horizon before each one', () => {
    const job = JSON.parse(read('ops/openclaw/ca-migration-merge-window-open.json'));
    expect(job.schedule.kind).toBe('cron');
    expect(job.schedule.tz).toBe('America/Chicago');
    expect(job.delivery.mode).toBe('none');
    expect(job.payload.argv.join(' ')).toContain(
      'gh workflow run migration-merge-window.yml --repo Smarter-Software-PIQ/Smarter-Poker-Club-Arena --ref main -f mode=keep'
    );
    const [minute, hours] = String(job.schedule.expr).split(' ');
    const fires = hours.split(',').map((h: string) => [Number(h), Number(minute)]);
    // Every window opening over a whole day (Chicago is UTC-6 on this date).
    const day = at('2026-11-26T06:00:00Z');
    let t = day;
    const openings: number[] = [];
    while (t < day + 24 * 3_600_000) {
      const next = nextMergeWindow(t, C);
      if (next === null || next >= day + 24 * 3_600_000) break;
      openings.push(next);
      t = mergeWindowCloses(next, C) + 60_000;
    }
    expect(openings.length).toBe(7); // the 01:00 cycle window is inside the nightly freeze
    for (const open of openings) {
      const fired = fires.some(([h, m]: [number, number]) => {
        const f = day + (h * 60 + m) * 60_000; // 06:00Z is 00:00 Chicago
        const before = open - f;
        return before >= 0 && before <= 25 * 60_000;
      });
      expect(fired, new Date(open).toISOString()).toBe(true);
    }
    expect(read('.github/workflows/migration-merge-window.yml')).toContain('ops/openclaw/');
  });

  it('every description fits the 140-character status limit', () => {
    for (const iso of ['2026-11-26T22:31:00Z', '2026-11-26T18:31:00Z']) {
      expect(verdict(iso, [mig(ORDINARY)]).description.length).toBeLessThanOrEqual(140);
    }
    for (const iso of ['2026-11-26T04:54:00Z', '2026-11-26T19:20:00Z', '2026-11-26T07:20:00Z']) {
      expect(verdict(iso, [mig(ORDINARY)]).description.length).toBeLessThanOrEqual(140);
    }
    const long = `Outage override: ${'x'.repeat(300)}`;
    expect(
      verdict('2026-11-26T04:54:00Z', [mig(ORDINARY)], [MERGE_WINDOW_OVERRIDE_LABEL], long)
        .description.length
    ).toBe(140);
  });

  it('is kept by a trusted workflow: default-branch code only, a keeper at :10 and a closing sweep at :40', () => {
    const raw = read('.github/workflows/migration-merge-window.yml');
    const wf = parse(raw) as Record<string, any>;
    expect(Object.keys(wf.on)).toEqual([
      'pull_request_target',
      'push',
      'schedule',
      'workflow_dispatch',
    ]);
    expect(wf.on.push.branches).toEqual(['main']);
    expect(raw).toContain('push) node scripts/ci/migration-merge-window.mjs on-push ;;');
    expect(wf.on.pull_request_target.types).toEqual(
      expect.arrayContaining([
        'opened',
        'synchronize',
        'reopened',
        'labeled',
        'unlabeled',
        'edited',
      ])
    );
    expect(wf.on.schedule.map((s: { cron: string }) => s.cron)).toEqual([
      '10 * * * *',
      '40 * * * *',
    ]);
    expect(wf.permissions).toEqual({
      contents: 'read',
      'pull-requests': 'read',
      statuses: 'write',
    });
    const steps = wf.jobs['merge-window'].steps;
    expect(steps[0].with.ref).toBe('${{ github.event.repository.default_branch }}');
    expect(steps[0].with['persist-credentials']).toBe(false);
    expect(raw).not.toMatch(/head\.sha|head\.ref|github\.head_ref/);
    const run = steps[steps.length - 1].run as string;
    expect(run).toContain(
      'if [ "$SCHEDULE" = \'10 * * * *\' ]; then node scripts/ci/migration-merge-window.mjs keep'
    );
    // GitHub's schedule drops most ticks here: a pull request event holds its own window.
    expect(run).toContain('node scripts/ci/migration-merge-window.mjs keep --pr "$PR_NUMBER"');
    expect(MERGE_WINDOW_CONTEXT).toBe('Migration merge window');
  });
});

describe('a held dispatch sends nothing for a file reverted during its wait', () => {
  const ordinaryOnDisk = readdirSync(resolve(ROOT, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => !/@install-window|CONCURRENTLY/.test(read(`supabase/migrations/${f}`)))
    .slice(-2);
  const [KEPT, REVERTED] = ordinaryOnDisk;

  it('re-reads the default branch after the wait, names the reverted file and sends only the rest', () => {
    const box = mkdtempSync(join(tmpdir(), 'merged-dispatch-reverted-'));
    try {
      const calls = join(box, 'calls');
      const files = join(box, 'files.json');
      writeFileSync(
        files,
        JSON.stringify([
          { filename: `supabase/migrations/${KEPT}`, status: 'added' },
          { filename: `supabase/migrations/${REVERTED}`, status: 'added' },
        ])
      );
      writeFileSync(
        join(box, 'gh'),
        `#!/usr/bin/env bash
echo "$*" >> '${calls}'
case "$*" in
  *pulls/12035/files*)
    while [ $# -gt 0 ]; do [ "$1" = --jq ] && { jq -r "$2" '${files}'; exit; }; shift; done
    exit 9 ;;
  *contents/supabase/migrations/${REVERTED}*) echo 'gh: Not Found (HTTP 404)' >&2; exit 1 ;;
  *contents/supabase/migrations/*) echo abc; exit 0 ;;
esac
`
      );
      chmodSync(join(box, 'gh'), 0o755);
      writeFileSync(
        join(box, 'curl'),
        `#!/usr/bin/env bash\necho '{"maintenance":{"schedule":{"frequency":"daily"}}}'\n`
      );
      chmodSync(join(box, 'curl'), 0o755);
      const summary = join(box, 'summary');
      const event = join(box, 'event.json');
      writeFileSync(
        event,
        JSON.stringify({
          repository: { default_branch: 'main' },
          pull_request: {
            number: 12035,
            merged: true,
            base: { ref: 'main', repo: { full_name: 'o/r' } },
            head: { sha: 'b'.repeat(40), repo: { full_name: 'o/r' } },
          },
        })
      );
      const intents = join(box, 'intents');
      for (const phase of ['plan', 'send']) {
        const r = spawnSync('bash', ['.github/scripts/dispatch-merged-migrations.sh'], {
          cwd: ROOT,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${box}:${process.env.PATH}`,
            GH_TOKEN: 'x',
            REPO: 'o/r',
            PR: '12035',
            MERGED_BY: 'Smarter-Poker',
            GITHUB_STEP_SUMMARY: summary,
            GITHUB_RUN_ID: '1',
            GITHUB_RUN_ATTEMPT: '1',
            GITHUB_REPOSITORY: 'o/r',
            GITHUB_WORKFLOW_REF:
              'o/r/.github/workflows/dispatch-merged-migrations.yml@refs/heads/main',
            GITHUB_SHA: 'a'.repeat(40),
            GITHUB_EVENT_NAME: 'pull_request_target',
            GITHUB_EVENT_PATH: event,
            GITHUB_OUTPUT: join(box, 'output'),
            DISPATCH_PHASE: phase,
            INTENT_DIR: intents,
            INTENT_STATE: join(box, 'state.jsonl'),
            DISPATCH_NOW_MS: String(at('2026-10-25T02:10:00Z')),
          },
        });
        expect(r.status, r.stderr + r.stdout).toBe(0);
      }
      const sent = readFileSync(calls, 'utf8')
        .split('\n')
        .filter((l) => l.includes('repos/o/r/dispatches'))
        .map((l) => /client_payload\[migration\]=(\S+)/.exec(l)?.[1]);
      expect(sent).toEqual([KEPT]);
      const said = existsSync(summary) ? readFileSync(summary, 'utf8') : '';
      expect(said).toContain(`**NOT SENT** \`${REVERTED}\``);
    } finally {
      rmSync(box, { recursive: true, force: true });
    }
  });

  it('the check sits after the wait and before the first send', () => {
    const script = read('.github/scripts/dispatch-merged-migrations.sh');
    const check = script.indexOf('# A FILE REVERTED WHILE HELD IS NOT SENT');
    expect(check).toBeGreaterThan(script.indexOf('sleep "$WAIT"'));
    expect(check).toBeLessThan(script.indexOf('repos/$REPO/dispatches'));
  });
});
