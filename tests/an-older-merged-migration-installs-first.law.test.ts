/**
 * LAW: AN OLDER MERGED MIGRATION INSTALLS FIRST (incident 90972d77, 2026-11-21).
 *
 * At 04:15 UTC four Apply Merged Migration runs released by the same hold
 * started within two seconds; 20261121024624 installed before
 * 20261121005533, whose switch-list chain guard then refused it, and the
 * install watch paged MergedMigrationNotInstalled. Each dispatcher now
 * watches the applier's runs for a minimum observation period and waits,
 * bounded, while an older version is still queued or installing; a stuck
 * older run never holds a later fix hostage.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import {
  awaitOlderMergedApplies,
  olderInFlight,
  BUDGET_MS,
  OBSERVE_MS,
} from '../scripts/ci/await-older-merged-applies.mjs';

const ROOT = resolve(__dirname, '..');
const SHELL = readFileSync(resolve(ROOT, '.github/scripts/dispatch-merged-migrations.sh'), 'utf8');
const WF = parse(
  readFileSync(resolve(ROOT, '.github/workflows/dispatch-merged-migrations.yml'), 'utf8')
);

const run = (status: string, file: string) => ({
  status,
  display_title: `Apply Merged Migration ${file}`,
});

function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms), log: () => {} };
}

describe('an older merged migration installs first', () => {
  it('names only older versions still queued or installing', () => {
    expect(
      olderInFlight(
        [
          run('in_progress', '20261121005533_a.sql'),
          run('queued', '20261121020000_b.sql abc123'),
          run('completed', '20261121001000_c.sql'),
          run('in_progress', '20261121032246_d.sql'),
          { status: 'in_progress', display_title: 'something else' },
        ],
        '20261121024624'
      )
    ).toEqual(['20261121005533', '20261121020000']);
  });

  it('the 04:15 race: the newer dispatcher waits until the older install finishes', async () => {
    let polls = 0;
    const c = clock();
    const r = await awaitOlderMergedApplies('20261121024624', {
      ...c,
      // The older sibling's run appears after 15 s and finishes at 70 s.
      listRuns: async () => {
        polls++;
        const t = c.now();
        return t >= 15_000 && t < 70_000 ? [run('in_progress', '20261121005533_a.sql')] : [];
      },
    });
    expect(r.older).toEqual([]);
    expect(r.waitedMs).toBeGreaterThanOrEqual(70_000);
    expect(r.waitedMs).toBeLessThan(BUDGET_MS);
    expect(polls).toBeGreaterThan(3);
  });

  it('observes long enough for a sibling woken in the same second to send', async () => {
    const r = await awaitOlderMergedApplies('20261121024624', {
      ...clock(),
      listRuns: async () => [],
    });
    expect(r.waitedMs).toBeGreaterThanOrEqual(OBSERVE_MS);
  });

  it('a stuck older run never holds a later fix hostage', async () => {
    const r = await awaitOlderMergedApplies('20261121024624', {
      ...clock(),
      listRuns: async () => [run('in_progress', '20261121005533_a.sql')],
    });
    expect(r.waitedMs).toBe(BUDGET_MS);
    expect(r.older).toEqual(['20261121005533']);
  });

  it('an unreadable run list is COULD NOT TELL and the send goes on', async () => {
    const lines: string[] = [];
    const r = await awaitOlderMergedApplies('20261121024624', {
      ...clock(),
      log: (m: string) => lines.push(m),
      listRuns: async () => {
        throw new Error('GitHub answered 403');
      },
    });
    expect(r.older).toBeNull();
    expect(lines.join('\n')).toContain('COULD NOT TELL');
  });

  it('every dispatcher runs the gate before its first send and can read the runs', () => {
    const gate = SHELL.indexOf('node scripts/ci/await-older-merged-applies.mjs');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(SHELL.indexOf('SENT=0'));
    expect(SHELL).toMatch(/^node scripts\/ci\/await-older-merged-applies\.mjs [^\n]*\|\| true$/m);
    expect(WF.permissions.actions).toBe('read');
  });
});
