/**
 * A BOOKED WINDOW GIVES PLAYERS NOTICE (Dan 2026-11-07).
 *
 * The Horse fold provenance engine cutover was booked in
 * server/release/owner-maintenance-windows.json at 13:13 Chicago
 * (announcementPolicy earliest-certified, notBefore already passed), announced
 * at 13:14:37 and froze entry at 13:16:37. Players had the engine's two-minute
 * last-hand warning and nothing else; the owner's own Lightning joins were
 * refused. This law holds:
 *   1. every window booked from 2026-11-07 21:00 UTC carries playerNoticeAt,
 *      at least 20 minutes before notBefore (a certified recovery profile, the
 *      emergency path, is exempt);
 *   2. the client's projection is exactly what the generator produces from
 *      the booking, so a booked window reaches the banner on the next client
 *      publication;
 *   3. the banner sentence is shown from the notice instant until the window
 *      closes, names Chicago time and never promises a fixed minute.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  projectOwnerMaintenanceNotices,
  renderOwnerMaintenanceNotices,
  TARGET,
} from '../scripts/generate-owner-maintenance-notices.mjs';
import {
  BOOKED_MAINTENANCE_NOTICES,
  bookedMaintenanceNotice,
  bookedMaintenanceNoticeText,
  type BookedMaintenanceNotice,
} from '../src/utils/maintenanceSchedule';

const ROOT = resolve(__dirname, '..');
const doc = JSON.parse(
  readFileSync(join(ROOT, 'server/release/owner-maintenance-windows.json'), 'utf8')
) as {
  windows: Record<string, unknown>[];
  databaseWindows: Record<string, unknown>[];
};
const RULE_FROM = Date.parse('2026-11-07T21:00:00Z');
const MIN_LEAD_MS = 20 * 60 * 1000;

/** Why a booked window fails the notice rule, or null when it passes or is exempt. */
function noticeViolation(w: Record<string, unknown>): string | null {
  const notBefore = Date.parse(String(w.notBefore));
  if (notBefore < RULE_FROM || 'certifiedRecoveryProfile' in w) return null;
  if (typeof w.playerNoticeAt !== 'string') return 'playerNoticeAt (ISO, UTC) is required';
  const noticeAt = Date.parse(w.playerNoticeAt);
  if (!Number.isFinite(noticeAt)) return 'playerNoticeAt is not a timestamp';
  if (notBefore - noticeAt < MIN_LEAD_MS)
    return 'playerNoticeAt must be at least 20 minutes before notBefore';
  return null;
}

describe('every new booking names when players are told', () => {
  it('every booked window passes', () => {
    const failures = [...doc.windows, ...doc.databaseWindows]
      .map((w) => [String(w.id), noticeViolation(w)] as const)
      .filter(([, why]) => why !== null);
    expect(failures).toEqual([]);
  });

  it('the rule bites: a window booked like 2026-11-07 13:13 is refused', () => {
    const base = { id: 'x', notBefore: '2026-11-08T18:00:00Z', notAfter: '2026-11-09T00:00:00Z' };
    expect(noticeViolation(base)).toBe('playerNoticeAt (ISO, UTC) is required');
    expect(noticeViolation({ ...base, playerNoticeAt: '2026-11-08T17:45:00Z' })).toBe(
      'playerNoticeAt must be at least 20 minutes before notBefore'
    );
    expect(noticeViolation({ ...base, playerNoticeAt: '2026-11-08T17:40:00Z' })).toBeNull();
  });

  it('exempts the certified emergency path and windows booked before the rule', () => {
    expect(
      noticeViolation({ id: 'c', notBefore: '2026-11-08T18:00:00Z', certifiedRecoveryProfile: 'p' })
    ).toBeNull();
    expect(noticeViolation({ id: 'o', notBefore: '2026-11-07T18:00:00Z' })).toBeNull();
  });
});

describe('the client ships exactly the booked windows', () => {
  it(`${TARGET} is the generator output (run node scripts/generate-owner-maintenance-notices.mjs)`, () => {
    expect(readFileSync(join(ROOT, TARGET), 'utf8')).toBe(renderOwnerMaintenanceNotices(ROOT));
  });
  it('the shipped list parses completely', () => {
    const shipped = JSON.parse(readFileSync(join(ROOT, TARGET), 'utf8')).notices as unknown[];
    expect(BOOKED_MAINTENANCE_NOTICES).toHaveLength(shipped.length);
  });
  it('carries engine and database windows, with their notice instant', () => {
    const out = projectOwnerMaintenanceNotices({
      windows: [
        {
          id: 'e',
          notBefore: '2026-11-09T19:00:00Z',
          notAfter: '2026-11-10T01:00:00Z',
          playerNoticeAt: '2026-11-09T18:30:00Z',
        },
      ],
      databaseWindows: [
        { id: 'd', notBefore: '2026-11-09T18:00:00Z', notAfter: '2026-11-09T20:00:00Z' },
      ],
    });
    expect(out.notices).toEqual([
      {
        id: 'd',
        kind: 'database',
        noticeAt: null,
        notBefore: '2026-11-09T18:00:00Z',
        notAfter: '2026-11-09T20:00:00Z',
      },
      {
        id: 'e',
        kind: 'engine',
        noticeAt: '2026-11-09T18:30:00Z',
        notBefore: '2026-11-09T19:00:00Z',
        notAfter: '2026-11-10T01:00:00Z',
      },
    ]);
  });
});

describe('the banner sentence', () => {
  // 2026-11-09 12:30 PM Chicago notice, 1:00 PM start, 7:00 PM end (CST, UTC-6).
  const n: BookedMaintenanceNotice = {
    id: 'w',
    kind: 'engine',
    noticeAtMs: Date.parse('2026-11-09T18:30:00Z'),
    notBeforeMs: Date.parse('2026-11-09T19:00:00Z'),
    notAfterMs: Date.parse('2026-11-10T01:00:00Z'),
  };
  it('is silent before the notice instant and after the window closes', () => {
    expect(bookedMaintenanceNotice(Date.parse('2026-11-09T18:29:59Z'), [n])).toBeNull();
    expect(bookedMaintenanceNotice(Date.parse('2026-11-10T01:00:00Z'), [n])).toBeNull();
  });
  it('names the window before it opens', () => {
    const at = Date.parse('2026-11-09T18:30:00Z');
    expect(bookedMaintenanceNotice(at, [n])).toBe(n);
    expect(bookedMaintenanceNoticeText(n, at)).toBe(
      'Short Maintenance Break Possible Between 1:00 PM And 7:00 PM Chicago Time. Play Pauses For About Five Minutes.'
    );
  });
  it('says any time before the close once it is open, never a fixed minute', () => {
    const at = Date.parse('2026-11-09T20:00:00Z');
    const text = bookedMaintenanceNoticeText(n, at);
    expect(text).toBe(
      'A Short Maintenance Break Can Start Any Time Before 7:00 PM Chicago Time. Play Pauses For About Five Minutes.'
    );
    expect(text).not.toMatch(/top of the hour|[–—]/i);
  });
  it('a window with no notice instant is shown from one hour before it opens', () => {
    const old = { ...n, noticeAtMs: null };
    expect(bookedMaintenanceNotice(Date.parse('2026-11-09T17:59:59Z'), [old])).toBeNull();
    expect(bookedMaintenanceNotice(Date.parse('2026-11-09T18:00:00Z'), [old])).toBe(old);
  });
  it('names a different Chicago day', () => {
    const at = Date.parse('2026-11-08T23:00:00Z'); // 5:00 PM the day before
    expect(bookedMaintenanceNoticeText({ ...n, noticeAtMs: null }, at)).toContain(
      'Between Tomorrow 1:00 PM And Tomorrow 7:00 PM'
    );
  });
});

it('preserves the original notice until expiry before showing the separate successor', () => {
  expect(bookedMaintenanceNotice(Date.parse('2026-11-10T04:29:59Z'))?.id).toBe(
    '2026-11-09-owner-asap-engine-2230z'
  );
  expect(bookedMaintenanceNotice(Date.parse('2026-11-10T04:30:00Z'))).toBeNull();
  expect(bookedMaintenanceNotice(Date.parse('2026-11-10T04:50:37.346Z'))).toBeNull();
  const successor = bookedMaintenanceNotice(Date.parse('2026-11-10T04:50:37.347Z'));
  expect(successor?.id).toBe('2026-11-10-owner-asap-engine-0440z');
  expect(successor?.noticeAtMs).toBe(Date.parse('2026-11-10T04:50:37.347Z'));
  expect(successor?.notBeforeMs).toBe(Date.parse('2026-11-10T05:10:38Z'));
  expect(successor?.notAfterMs).toBe(Date.parse('2026-11-10T06:30:00Z'));
  expect(bookedMaintenanceNotice(Date.parse('2026-11-10T06:30:00Z'))).toBeNull();
  expect(bookedMaintenanceNotice(Date.parse('2026-11-10T08:29:59.999Z'))).toBeNull();
  const next = bookedMaintenanceNotice(Date.parse('2026-11-10T08:30:00Z'));
  expect(next?.id).toBe('2026-11-10-owner-asap-engine-0650z');
  expect(next?.noticeAtMs).toBe(Date.parse('2026-11-10T08:30:00Z'));
  expect(next?.notBeforeMs).toBe(Date.parse('2026-11-10T08:50:00Z'));
  expect(next?.notAfterMs).toBe(Date.parse('2026-11-10T10:30:00Z'));
  expect(bookedMaintenanceNotice(Date.parse('2026-11-10T10:30:00Z'))).toBeNull();
});

it('shows the earlier-starting database retry notice until it expires, then the cash Horse action cutover', () => {
  expect(bookedMaintenanceNotice(Date.parse('2026-11-10T21:59:59.999Z'))?.id).toBe(
    '2026-11-10-closed-person-name-policy-db'
  );
  expect(bookedMaintenanceNotice(Date.parse('2026-11-10T23:14:59.999Z'))).toBeNull();
  expect(bookedMaintenanceNotice(Date.parse('2026-11-10T23:30:00Z'))?.id).toBe(
    '2026-11-10-closed-person-name-policy-db-retry'
  );
  expect(bookedMaintenanceNotice(Date.parse('2026-11-11T03:59:59.999Z'))?.id).toBe(
    '2026-11-10-closed-person-name-policy-db-retry'
  );
  const cutover = bookedMaintenanceNotice(Date.parse('2026-11-11T04:00:00Z'));
  expect(cutover?.id).toBe('2026-11-10-owner-asap-engine-2350z');
  expect(cutover?.noticeAtMs).toBe(Date.parse('2026-11-10T23:30:00Z'));
  expect(cutover?.notBeforeMs).toBe(Date.parse('2026-11-10T23:50:00Z'));
  expect(cutover?.notAfterMs).toBe(Date.parse('2026-11-11T05:00:00Z'));
  expect(bookedMaintenanceNotice(Date.parse('2026-11-11T04:59:59.999Z'))?.id).toBe(
    '2026-11-10-owner-asap-engine-2350z'
  );
  expect(bookedMaintenanceNotice(Date.parse('2026-11-11T05:00:00Z'))?.id).toBe(
    '2026-11-11-horse-clock-receipts-engine-0050z'
  );
});

it('retains earlier notice priority before the amended receipt promise is visible', () => {
  const own = BOOKED_MAINTENANCE_NOTICES.find(
    (n) => n.id === '2026-11-11-horse-clock-receipts-engine-0050z'
  );
  expect(own?.noticeAtMs).toBe(Date.parse('2026-11-11T03:20:00Z'));
  expect(own?.notBeforeMs).toBe(Date.parse('2026-11-11T03:40:00Z'));
  expect(own?.notAfterMs).toBe(Date.parse('2026-11-11T06:30:00Z'));
  expect(bookedMaintenanceNotice(Date.parse('2026-11-11T03:40:00Z'))?.id).toBe(
    '2026-11-10-closed-person-name-policy-db-retry'
  );
  expect(bookedMaintenanceNotice(Date.parse('2026-11-11T04:59:59.999Z'))?.id).toBe(
    '2026-11-10-owner-asap-engine-2350z'
  );
  const at = Date.parse('2026-11-11T05:00:00Z');
  const primary = bookedMaintenanceNotice(at);
  expect(primary?.id).toBe(own?.id);
  expect(bookedMaintenanceNoticeText(primary!, at)).toBe(
    'A Short Maintenance Break Can Start Any Time Before Tomorrow 12:30 AM Chicago Time. Play Pauses For About Five Minutes.'
  );
  expect(bookedMaintenanceNotice(Date.parse('2026-11-11T06:30:00Z'))).toBeNull();
});

it('preserves the consumed receipt notice until the corrective promise becomes primary', () => {
  const own = BOOKED_MAINTENANCE_NOTICES.find(
    (n) => n.id === '2026-11-11-horse-clock-clone-engine-0650z'
  );
  expect(own?.noticeAtMs).toBe(Date.parse('2026-11-11T07:40:00Z'));
  expect(own?.notBeforeMs).toBe(Date.parse('2026-11-11T08:00:00Z'));
  expect(own?.notAfterMs).toBe(Date.parse('2026-11-11T10:30:00Z'));
  expect(bookedMaintenanceNotice(Date.parse('2026-11-11T06:29:59.999Z'))?.id).toBe(
    '2026-11-11-horse-clock-receipts-engine-0050z'
  );
  expect(bookedMaintenanceNotice(Date.parse('2026-11-11T06:30:00Z'))).toBeNull();
  expect(bookedMaintenanceNotice(Date.parse('2026-11-11T07:39:59.999Z'))).toBeNull();
  expect(bookedMaintenanceNotice(Date.parse('2026-11-11T07:40:00Z'))?.id).toBe(own?.id);
  const at = Date.parse('2026-11-11T08:00:00Z');
  const primary = bookedMaintenanceNotice(at);
  expect(primary?.id).toBe(own?.id);
  expect(bookedMaintenanceNoticeText(primary!, at)).toBe(
    'A Short Maintenance Break Can Start Any Time Before 4:30 AM Chicago Time. Play Pauses For About Five Minutes.'
  );
  expect(bookedMaintenanceNotice(Date.parse('2026-11-11T10:30:00Z'))).toBeNull();
});

it('publishes the fresh Horse upgrade promise with its full lead and finite expiry', () => {
  const own = BOOKED_MAINTENANCE_NOTICES.find(
    (n) => n.id === '2026-11-11-horse-realtime-10454-engine-1930z'
  );
  expect(own?.noticeAtMs).toBe(Date.parse('2026-11-11T19:10:00Z'));
  expect(own?.notBeforeMs).toBe(Date.parse('2026-11-11T19:30:00Z'));
  expect(own?.notAfterMs).toBe(Date.parse('2026-11-11T22:30:00Z'));
  expect(bookedMaintenanceNotice(Date.parse('2026-11-11T19:09:59.999Z'))).toBeNull();
  expect(bookedMaintenanceNotice(Date.parse('2026-11-11T19:10:00Z'))?.id).toBe(own?.id);
  const at = Date.parse('2026-11-11T19:30:00Z');
  const primary = bookedMaintenanceNotice(at);
  expect(primary?.id).toBe(own?.id);
  expect(bookedMaintenanceNoticeText(primary!, at)).toBe(
    'A Short Maintenance Break Can Start Any Time Before 4:30 PM Chicago Time. Play Pauses For About Five Minutes.'
  );
  expect(bookedMaintenanceNotice(Date.parse('2026-11-11T22:29:59.999Z'))?.id).toBe(own?.id);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-11T22:30:00Z'))).toBeNull();
});

it('publishes the corrected Horse engine promise with its full lead and finite expiry', () => {
  const own = BOOKED_MAINTENANCE_NOTICES.find(
    (n) => n.id === '2026-11-12-horse-corrections-10525-engine-0030z'
  );
  expect(own?.noticeAtMs).toBe(Date.parse('2026-11-12T00:10:00Z'));
  expect(own?.notBeforeMs).toBe(Date.parse('2026-11-12T00:30:00Z'));
  expect(own?.notAfterMs).toBe(Date.parse('2026-11-12T05:30:00Z'));
  expect(bookedMaintenanceNotice(Date.parse('2026-11-12T00:09:59.999Z'))).toBeNull();
  expect(bookedMaintenanceNotice(Date.parse('2026-11-12T00:10:00Z'))?.id).toBe(own?.id);
  const at = Date.parse('2026-11-12T00:30:00Z');
  const primary = bookedMaintenanceNotice(at);
  expect(primary?.id).toBe(own?.id);
  expect(bookedMaintenanceNoticeText(primary!, at)).toBe(
    'A Short Maintenance Break Can Start Any Time Before 11:30 PM Chicago Time. Play Pauses For About Five Minutes.'
  );
  expect(bookedMaintenanceNotice(Date.parse('2026-11-12T05:29:59.999Z'))?.id).toBe(own?.id);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-12T05:30:00Z'))).toBeNull();
});

it('publishes the rebooked corrected Horse engine promise with its full lead and finite expiry', () => {
  const own = BOOKED_MAINTENANCE_NOTICES.find(
    (n) => n.id === '2026-11-12-horse-corrections-engine-0700z'
  );
  expect(own?.noticeAtMs).toBe(Date.parse('2026-11-12T06:40:00Z'));
  expect(own?.notBeforeMs).toBe(Date.parse('2026-11-12T07:00:00Z'));
  expect(own?.notAfterMs).toBe(Date.parse('2026-11-12T09:15:00Z'));
  expect(bookedMaintenanceNotice(Date.parse('2026-11-12T06:39:59.999Z'))).toBeNull();
  expect(bookedMaintenanceNotice(Date.parse('2026-11-12T06:40:00Z'))?.id).toBe(own?.id);
  const at = Date.parse('2026-11-12T07:00:00Z');
  const primary = bookedMaintenanceNotice(at);
  expect(primary?.id).toBe(own?.id);
  expect(bookedMaintenanceNoticeText(primary!, at)).toBe(
    'A Short Maintenance Break Can Start Any Time Before 3:15 AM Chicago Time. Play Pauses For About Five Minutes.'
  );
  expect(bookedMaintenanceNotice(Date.parse('2026-11-12T09:14:59.999Z'))?.id).toBe(own?.id);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-12T09:15:00Z'))).toBeNull();
});

it('shows each missed-engine prerequisite before the successor and ends every promise', () => {
  const at = (stamp: string) => bookedMaintenanceNotice(Date.parse(stamp))?.id;
  expect(at('2026-11-12T15:14:59Z')).toBeUndefined();
  expect(at('2026-11-12T15:15:00Z')).toBe('2026-11-12-missed-engine-db-bank-win');
  expect(at('2026-11-12T16:19:59Z')).toBe('2026-11-12-missed-engine-db-bank-win');
  expect(at('2026-11-12T16:20:00Z')).toBe('2026-11-12-missed-engine-db-rebuy');
  expect(at('2026-11-12T17:19:59Z')).toBe('2026-11-12-missed-engine-db-rebuy');
  expect(at('2026-11-12T17:20:00Z')).toBe('2026-11-12-complete-missed-engine-1700z');
  expect(at('2026-11-12T21:59:59Z')).toBe('2026-11-12-complete-missed-engine-1700z');
  expect(at('2026-11-12T22:00:00Z')).toBe('2026-11-12-rebuy-invariant-db-2220z');
  expect(at('2026-11-13T01:59:59Z')).toBe('2026-11-12-rebuy-invariant-db-2220z');
  expect(at('2026-11-13T02:00:00Z')).toBeUndefined();
});

it('gives the authorized rebuy DB window its own primary lead without changing prior orders', () => {
  const id = '2026-11-12-rebuy-invariant-db-2220z';
  const own = BOOKED_MAINTENANCE_NOTICES.find((n) => n.id === id)!;
  expect(own.kind).toBe('database');
  expect(own.noticeAtMs).toBe(Date.parse('2026-11-12T22:00:00Z'));
  expect(own.notBeforeMs - own.noticeAtMs!).toBe(20 * 60 * 1000);
  expect(own.notAfterMs).toBe(Date.parse('2026-11-13T02:00:00Z'));
  expect(bookedMaintenanceNotice(own.noticeAtMs! - 1)?.id).toBe(
    '2026-11-12-complete-missed-engine-1700z'
  );
  expect(bookedMaintenanceNotice(own.noticeAtMs!)?.id).toBe(id);
  expect(bookedMaintenanceNotice(own.notBeforeMs)?.id).toBe(id);
  expect(bookedMaintenanceNoticeText(own, own.noticeAtMs!)).toBe(
    'Short Maintenance Break Possible Between 4:20 PM And 8:00 PM Chicago Time. Play Pauses For About Five Minutes.'
  );
  expect(bookedMaintenanceNotice(own.notAfterMs)).toBeNull();
});

it('publishes the owner-ordered :55 break cutover promise with its lead and fixed expiry', () => {
  const own = BOOKED_MAINTENANCE_NOTICES.find(
    (n) => n.id === '2026-11-13-owner-now-55-break-engine-0338z'
  );
  expect(own?.noticeAtMs).toBe(Date.parse('2026-11-13T03:15:00Z'));
  expect(own?.notBeforeMs).toBe(Date.parse('2026-11-13T03:38:00Z'));
  expect(own?.notAfterMs).toBe(Date.parse('2026-11-13T04:00:00Z'));
  expect((own?.notBeforeMs ?? 0) - (own?.noticeAtMs ?? 0)).toBeGreaterThanOrEqual(20 * 60_000);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-13T03:14:59.999Z'))).toBeNull();
  expect(bookedMaintenanceNotice(Date.parse('2026-11-13T03:15:00Z'))?.id).toBe(own?.id);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-13T03:59:59.999Z'))?.id).toBe(own?.id);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-13T04:00:00Z'))).toBeNull();
});

it('publishes the rebooked :55 break cutover promise with its lead and fixed expiry', () => {
  const own = BOOKED_MAINTENANCE_NOTICES.find(
    (n) => n.id === '2026-11-13-owner-now-55-break-engine-0538z'
  );
  expect(own?.noticeAtMs).toBe(Date.parse('2026-11-13T05:15:00Z'));
  expect(own?.notBeforeMs).toBe(Date.parse('2026-11-13T05:38:00Z'));
  expect(own?.notAfterMs).toBe(Date.parse('2026-11-13T06:00:00Z'));
  expect((own?.notBeforeMs ?? 0) - (own?.noticeAtMs ?? 0)).toBeGreaterThanOrEqual(20 * 60_000);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-13T05:14:59.999Z'))).toBeNull();
  expect(bookedMaintenanceNotice(Date.parse('2026-11-13T05:15:00Z'))?.id).toBe(own?.id);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-13T05:59:59.999Z'))?.id).toBe(own?.id);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-13T06:00:00Z'))).toBeNull();
});
