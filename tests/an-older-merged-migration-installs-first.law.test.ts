/**
 * LAW: AN OLDER MERGED MIGRATION INSTALLS FIRST (incident 90972d77, 2026-11-21).
 *
 * At 04:15 UTC four Apply Merged Migration runs released by the same hold
 * started within two seconds; 20261121024624 installed before
 * 20261121005533, whose switch-list chain guard then refused it, and the
 * install watch paged MergedMigrationNotInstalled. The applier now waits,
 * bounded, for older merged files still waiting, and never lets a refused
 * older file hold a later one hostage.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  awaitOlderMergedMigrations,
  olderWaiting,
  OLDER_WAITING_SQL,
  ORDER_WAIT_BUDGET_MS,
} from '../scripts/ci/merged-migration-order.mjs';

const APPLIER = readFileSync(
  resolve(__dirname, '../scripts/ci/apply-recorded-migration.mjs'),
  'utf8'
);

function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

describe('an older merged migration installs first', () => {
  it('selects only lower, waiting, non-superseded, non-window files from the last day', () => {
    expect(OLDER_WAITING_SQL).toMatch(/w\.version < \$1/);
    expect(OLDER_WAITING_SQL).toMatch(/installed_seen_at IS NULL/);
    expect(OLDER_WAITING_SQL).toMatch(/superseded_by IS NULL/);
    expect(OLDER_WAITING_SQL).toMatch(/NOT w\.window_install/);
    expect(OLDER_WAITING_SQL).toMatch(/schema_migrations/);
    expect(
      olderWaiting(
        [
          { version: '20261121024624', file: 'b' },
          { version: '20261121005533', file: 'a' },
          { version: '20261121032246', file: 'c' },
          { version: 'bogus', file: 'x' },
        ],
        '20261121032246'
      ).map((r) => r.version)
    ).toEqual(['20261121005533', '20261121024624']);
  });

  it('the 04:15 race: the newer file waits until the older one installs, then proceeds', async () => {
    const clock = fakeClock();
    let calls = 0;
    const client = {
      query: async () => ({
        rows: ++calls < 4 ? [{ version: '20261121005533', file: 'a.sql' }] : [],
      }),
    };
    const r = await awaitOlderMergedMigrations(client, '20261121024624', {
      ...clock,
      log: () => {},
    });
    expect(r.stillWaiting).toEqual([]);
    expect(r.waitedMs).toBeGreaterThan(0);
    expect(r.waitedMs).toBeLessThan(ORDER_WAIT_BUDGET_MS);
  });

  it('a refused older file never holds a later fix hostage: the wait is bounded', async () => {
    const clock = fakeClock();
    const client = {
      query: async () => ({ rows: [{ version: '20261121005533', file: 'a.sql' }] }),
    };
    const r = await awaitOlderMergedMigrations(client, '20261121024624', {
      ...clock,
      log: () => {},
    });
    expect(r.waitedMs).toBe(ORDER_WAIT_BUDGET_MS);
    expect(r.stillWaiting?.map((w) => w.version)).toEqual(['20261121005533']);
  });

  it('an unreadable watch is named and does not stop the install', async () => {
    const lines: string[] = [];
    const client = {
      query: async () => {
        throw new Error('permission denied');
      },
    };
    const r = await awaitOlderMergedMigrations(client, '20261121024624', {
      ...fakeClock(),
      log: (m: string) => lines.push(m),
    });
    expect(r.stillWaiting).toBeNull();
    expect(lines.join('\n')).toContain('COULD NOT TELL');
  });

  it('the applier runs the gate for every ordinary install before it sends anything', () => {
    const gate = APPLIER.indexOf('await awaitOlderMergedMigrations(client, version)');
    expect(gate).toBeGreaterThan(0);
    expect(APPLIER.slice(gate - 200, gate)).toContain('ordinaryTransaction && !DRY_RUN');
    expect(gate).toBeLessThan(APPLIER.indexOf('applying the migration as ONE transaction'));
  });
});
