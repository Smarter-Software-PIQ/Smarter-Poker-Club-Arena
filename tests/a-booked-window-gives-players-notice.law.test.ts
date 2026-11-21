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
 *
 * ONE RELEASE WITHOUT ADVANCE NOTICE (Dan 2026-11-17, 11:05 Chicago). The owner
 * ordered the next qualified engine cutover "without an advance
 * player-warning announcement or notice countdown". An engine window that
 * carries that exact instruction as ownerNoticeWaiver (and in ownerOrder), no
 * playerNoticeAt (standing order of 2026-11-17 20:23 Chicago, no expiry) is exempt from
 * rule 1 and is not projected to the client, so no banner is shown for it.
 * Database windows and every later release keep the rule; a record that names
 * a waiver it may not use is refused (scripts/ci/owner-notice-waiver.mjs).
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
  OWNER_NOTICE_WAIVER_INSTRUCTION,
  ownerNoticeWaived,
  ownerNoticeWaiverProblem,
} from '../scripts/ci/owner-notice-waiver.mjs';
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
function noticeViolation(
  w: Record<string, unknown>,
  collection: 'windows' | 'databaseWindows' = 'windows'
): string | null {
  const notBefore = Date.parse(String(w.notBefore));
  if (notBefore < RULE_FROM || 'certifiedRecoveryProfile' in w) return null;
  const waiverProblem = ownerNoticeWaiverProblem(w, collection);
  if (waiverProblem) return waiverProblem;
  if (ownerNoticeWaived(w, collection)) return null;
  if (typeof w.playerNoticeAt !== 'string') return 'playerNoticeAt (ISO, UTC) is required';
  const noticeAt = Date.parse(w.playerNoticeAt);
  if (!Number.isFinite(noticeAt)) return 'playerNoticeAt is not a timestamp';
  if (notBefore - noticeAt < MIN_LEAD_MS)
    return 'playerNoticeAt must be at least 20 minutes before notBefore';
  return null;
}

describe('every new booking names when players are told', () => {
  it('every booked window passes', () => {
    const failures = [
      ...doc.windows.map((w) => [String(w.id), noticeViolation(w, 'windows')] as const),
      ...doc.databaseWindows.map(
        (w) => [String(w.id), noticeViolation(w, 'databaseWindows')] as const
      ),
    ].filter(([, why]) => why !== null);
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

describe('one release without advance notice (owner order 2026-11-17)', () => {
  const waived = {
    id: 'w',
    ownerOrder: `Synthetic order. ${OWNER_NOTICE_WAIVER_INSTRUCTION} Nothing else changes.`,
    ownerNoticeWaiver: OWNER_NOTICE_WAIVER_INSTRUCTION,
    notBefore: '2026-11-17T20:06:00Z',
    notAfter: '2026-11-17T23:00:00Z',
  };
  it('keeps the owner instruction word for word', () => {
    expect(OWNER_NOTICE_WAIVER_INSTRUCTION).toBe(
      'For this release, execute the earliest qualified engine cutover without an advance player-warning announcement or notice countdown. Preserve safe hand completion, settlement, certification, admission, recovery and live verification.'
    );
    // Standing order: no expiry. A later engine window on the waiver is exempt too.
    expect(ownerNoticeWaived({ ...waived, notAfter: '2026-12-01T08:00:00Z' }, 'windows')).toBe(
      true
    );
  });
  it('exempts an engine window that carries the exact waiver and no notice instant', () => {
    expect(ownerNoticeWaived(waived, 'windows')).toBe(true);
    expect(noticeViolation(waived, 'windows')).toBeNull();
  });
  it('refuses every other use of the waiver', () => {
    const refused = [
      [{ ...waived, ownerNoticeWaiver: 'no notice please' }, 'windows'],
      [{ ...waived, ownerNoticeWaiver: true }, 'windows'],
      [{ ...waived, ownerOrder: 'Synthetic order that does not quote the owner.' }, 'windows'],
      [{ ...waived, playerNoticeAt: '2026-11-17T19:40:00Z' }, 'windows'],
      [{ ...waived, notAfter: 'later' }, 'windows'],
      [waived, 'databaseWindows'],
    ] as const;
    for (const [w, collection] of refused) {
      expect(ownerNoticeWaived(w, collection)).toBe(false);
      expect(noticeViolation(w, collection)).toMatch(/^ownerNoticeWaiver is accepted only/);
    }
    // Without the field the ordinary rule still bites.
    const { ownerNoticeWaiver: _dropped, ...plain } = waived;
    expect(noticeViolation(plain, 'windows')).toBe('playerNoticeAt (ISO, UTC) is required');
  });
  it('ships no client notice for a waived engine window, and still ships the others', () => {
    const out = projectOwnerMaintenanceNotices({
      windows: [
        waived,
        {
          id: 'e',
          notBefore: '2026-11-17T21:00:00Z',
          notAfter: '2026-11-17T23:30:00Z',
          playerNoticeAt: '2026-11-17T20:30:00Z',
        },
      ],
      databaseWindows: [{ ...waived, id: 'd' }],
    });
    expect(out.notices.map((n: { id: string }) => n.id)).toEqual(['d', 'e']);
  });
  it('every booked record that names a waiver may use it', () => {
    const named = [
      ...doc.windows.map((w) => [w, 'windows'] as const),
      ...doc.databaseWindows.map((w) => [w, 'databaseWindows'] as const),
    ].filter(([w]) => 'ownerNoticeWaiver' in w);
    for (const [w, collection] of named) expect(ownerNoticeWaived(w, collection)).toBe(true);
    for (const [w] of named) {
      expect(BOOKED_MAINTENANCE_NOTICES.some((n) => n.id === w.id)).toBe(false);
    }
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
  expect(at('2026-11-13T03:00:00Z')).toBeUndefined();
  expect(at('2026-11-13T04:00:00Z')).toBeUndefined();
  expect(at('2026-11-13T04:45:00Z')).toBeUndefined();
  expect(at('2026-11-13T05:15:00Z')).toBe('2026-11-13-owner-now-55-break-engine-0538z');
  expect(at('2026-11-13T05:59:59Z')).toBe('2026-11-13-owner-now-55-break-engine-0538z');
  expect(at('2026-11-13T06:00:00Z')).toBeUndefined();
  expect(at('2026-11-13T06:15:00Z')).toBe('2026-11-13-rebuy-invariant-db-0220z');
  expect(at('2026-11-13T07:59:59Z')).toBe('2026-11-13-rebuy-invariant-db-0220z');
  // The rebuy promise ends at 08:00Z; the later-booked engine promise (07:15 to 09:00Z) is then primary.
  expect(at('2026-11-13T08:00:00Z')).toBe('2026-11-13-owner-asap-engine-0736z');
  expect(at('2026-11-13T09:00:00Z')).toBeUndefined();
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
  expect(bookedMaintenanceNotice(own.notAfterMs, [own])).toBeNull();
});

it('gives the corrected rebuy window its own primary lead after the consumed window', () => {
  const id = '2026-11-13-rebuy-invariant-db-0220z';
  const own = BOOKED_MAINTENANCE_NOTICES.find((n) => n.id === id)!;
  expect(own.kind).toBe('database');
  expect(own.noticeAtMs).toBe(Date.parse('2026-11-13T06:15:00Z'));
  expect(own.notBeforeMs).toBe(Date.parse('2026-11-13T06:50:00Z'));
  expect(own.notBeforeMs - own.noticeAtMs!).toBe(35 * 60 * 1000);
  expect(own.notAfterMs).toBe(Date.parse('2026-11-13T08:00:00Z'));
  expect(bookedMaintenanceNotice(own.noticeAtMs! - 1)).toBeNull();
  expect(bookedMaintenanceNotice(own.noticeAtMs!)?.id).toBe(id);
  expect(bookedMaintenanceNoticeText(own, own.noticeAtMs!)).toBe(
    'Short Maintenance Break Possible Between 12:50 AM And 2:00 AM Chicago Time. Play Pauses For About Five Minutes.'
  );
  expect(bookedMaintenanceNotice(own.notAfterMs, [own])).toBeNull();
  // Its own promise is over at 08:00Z; only the later-booked engine promise remains.
  expect(bookedMaintenanceNotice(own.notAfterMs)?.id).toBe('2026-11-13-owner-asap-engine-0736z');
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

it('publishes the owner as-soon-as-possible cutover promise with its lead and fixed expiry', () => {
  const own = BOOKED_MAINTENANCE_NOTICES.find((n) => n.id === '2026-11-13-owner-asap-engine-0736z');
  expect(own?.noticeAtMs).toBe(Date.parse('2026-11-13T07:15:00Z'));
  expect(own?.notBeforeMs).toBe(Date.parse('2026-11-13T07:36:00Z'));
  expect(own?.notAfterMs).toBe(Date.parse('2026-11-13T09:00:00Z'));
  expect((own?.notBeforeMs ?? 0) - (own?.noticeAtMs ?? 0)).toBeGreaterThanOrEqual(20 * 60_000);
  expect(BOOKED_MAINTENANCE_NOTICES.some((n) => n.id === own?.id)).toBe(true);
});

it('publishes the November 14 off-cycle cutover promise with its lead and fixed expiry', () => {
  const own = BOOKED_MAINTENANCE_NOTICES.find(
    (n) => n.id === '2026-11-14-owner-offcycle-engine-0506z'
  );
  expect(own?.noticeAtMs).toBe(Date.parse('2026-11-14T04:40:00Z'));
  expect(own?.notBeforeMs).toBe(Date.parse('2026-11-14T05:06:00Z'));
  expect(own?.notAfterMs).toBe(Date.parse('2026-11-14T07:30:00Z'));
  expect((own?.notBeforeMs ?? 0) - (own?.noticeAtMs ?? 0)).toBeGreaterThanOrEqual(20 * 60_000);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-14T04:39:59.999Z'))).toBeNull();
  expect(bookedMaintenanceNotice(Date.parse('2026-11-14T04:40:00Z'))?.id).toBe(own?.id);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-14T07:29:59.999Z'))?.id).toBe(own?.id);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-14T07:30:00Z'))).toBeNull();
});

it('publishes the 2026-11-14-owner-offcycle-engine-1706z engine window promise with its lead and fixed expiry', () => {
  const own = BOOKED_MAINTENANCE_NOTICES.find(
    (n) => n.id === '2026-11-14-owner-offcycle-engine-1706z'
  );
  expect(own?.noticeAtMs).toBe(Date.parse('2026-11-14T16:40:00Z'));
  expect(own?.notBeforeMs).toBe(Date.parse('2026-11-14T17:06:00Z'));
  expect(own?.notAfterMs).toBe(Date.parse('2026-11-14T23:00:00Z'));
  expect((own?.notBeforeMs ?? 0) - (own?.noticeAtMs ?? 0)).toBeGreaterThanOrEqual(20 * 60_000);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-14T16:39:59.999Z'))).toBeNull();
  expect(bookedMaintenanceNotice(Date.parse('2026-11-14T16:40:00Z'))?.id).toBe(own?.id);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-14T22:59:59.999Z'))?.id).toBe(own?.id);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-14T23:00:00Z'))).toBeNull();
});

it('publishes the 2026-11-15-owner-offcycle-engine-0806z engine window promise with its lead and fixed expiry', () => {
  const own = BOOKED_MAINTENANCE_NOTICES.find(
    (n) => n.id === '2026-11-15-owner-offcycle-engine-0806z'
  );
  expect(own?.noticeAtMs).toBe(Date.parse('2026-11-15T07:45:00Z'));
  expect(own?.notBeforeMs).toBe(Date.parse('2026-11-15T08:06:00Z'));
  expect(own?.notAfterMs).toBe(Date.parse('2026-11-15T09:25:00Z'));
  expect((own?.notBeforeMs ?? 0) - (own?.noticeAtMs ?? 0)).toBeGreaterThanOrEqual(20 * 60_000);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-15T07:44:59.999Z'))).toBeNull();
  expect(bookedMaintenanceNotice(Date.parse('2026-11-15T07:45:00Z'))?.id).toBe(own?.id);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-15T09:24:59.999Z'))?.id).toBe(own?.id);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-15T09:25:00Z'))).toBeNull();
});

it('publishes the 2026-11-15-owner-offcycle-engine-1206z engine window promise with its lead and fixed expiry', () => {
  const own = BOOKED_MAINTENANCE_NOTICES.find(
    (n) => n.id === '2026-11-15-owner-offcycle-engine-1206z'
  );
  expect(own?.noticeAtMs).toBe(Date.parse('2026-11-15T11:40:00Z'));
  expect(own?.notBeforeMs).toBe(Date.parse('2026-11-15T12:06:00Z'));
  expect(own?.notAfterMs).toBe(Date.parse('2026-11-15T15:00:00Z'));
  expect((own?.notBeforeMs ?? 0) - (own?.noticeAtMs ?? 0)).toBeGreaterThanOrEqual(20 * 60_000);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-15T11:39:59.999Z'))).toBeNull();
  expect(bookedMaintenanceNotice(Date.parse('2026-11-15T11:40:00Z'))?.id).toBe(own?.id);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-15T14:59:59.999Z'))?.id).toBe(own?.id);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-15T15:00:00Z'))).toBeNull();
});

it('publishes the 2026-11-15-owner-offcycle-engine-1806z engine window promise with its lead and fixed expiry', () => {
  const own = BOOKED_MAINTENANCE_NOTICES.find(
    (n) => n.id === '2026-11-15-owner-offcycle-engine-1806z'
  );
  expect(own?.noticeAtMs).toBe(Date.parse('2026-11-15T17:40:00Z'));
  expect(own?.notBeforeMs).toBe(Date.parse('2026-11-15T18:06:00Z'));
  expect(own?.notAfterMs).toBe(Date.parse('2026-11-15T21:00:00Z'));
  expect((own?.notBeforeMs ?? 0) - (own?.noticeAtMs ?? 0)).toBeGreaterThanOrEqual(20 * 60_000);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-15T17:39:59.999Z'))).toBeNull();
  expect(bookedMaintenanceNotice(Date.parse('2026-11-15T17:40:00Z'))?.id).toBe(own?.id);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-15T20:59:59.999Z'))?.id).toBe(own?.id);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-15T21:00:00Z'))).toBeNull();
});

it('publishes the 2026-11-15-owner-offcycle-engine-2245z engine window promise with its lead and fixed expiry', () => {
  const own = BOOKED_MAINTENANCE_NOTICES.find(
    (n) => n.id === '2026-11-15-owner-offcycle-engine-2245z'
  );
  expect(own?.noticeAtMs).toBe(Date.parse('2026-11-15T22:25:00Z'));
  expect(own?.notBeforeMs).toBe(Date.parse('2026-11-15T22:45:00Z'));
  expect(own?.notAfterMs).toBe(Date.parse('2026-11-16T02:30:00Z'));
  expect((own?.notBeforeMs ?? 0) - (own?.noticeAtMs ?? 0)).toBeGreaterThanOrEqual(20 * 60_000);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-15T22:24:59.999Z'))).toBeNull();
  expect(bookedMaintenanceNotice(Date.parse('2026-11-15T22:25:00Z'))?.id).toBe(own?.id);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-16T02:29:59.999Z'))?.id).toBe(own?.id);
  // The 0106z window's notice overlaps this one from 00:45Z; once this window's
  // fixed expiry passes, the later booking is the notice players see.
  expect(bookedMaintenanceNotice(Date.parse('2026-11-16T02:30:00Z'))?.id).toBe(
    '2026-11-16-owner-offcycle-engine-0106z'
  );
  expect(bookedMaintenanceNotice(Date.parse('2026-11-16T05:00:00Z'))).toBeNull();
});

it('publishes the 2026-11-16-owner-offcycle-engine-0106z engine window promise with its lead and fixed expiry', () => {
  const own = BOOKED_MAINTENANCE_NOTICES.find(
    (n) => n.id === '2026-11-16-owner-offcycle-engine-0106z'
  );
  expect(own?.noticeAtMs).toBe(Date.parse('2026-11-16T00:45:00Z'));
  expect(own?.notBeforeMs).toBe(Date.parse('2026-11-16T01:06:00Z'));
  expect(own?.notAfterMs).toBe(Date.parse('2026-11-16T05:00:00Z'));
  expect((own?.notBeforeMs ?? 0) - (own?.noticeAtMs ?? 0)).toBeGreaterThanOrEqual(20 * 60_000);
  expect(BOOKED_MAINTENANCE_NOTICES.some((n) => n.id === own?.id)).toBe(true);
});

it('publishes the 2026-11-16-owner-offcycle-engine-1906z engine window promise with its lead and fixed expiry', () => {
  const own = BOOKED_MAINTENANCE_NOTICES.find(
    (n) => n.id === '2026-11-16-owner-offcycle-engine-1906z'
  );
  expect(own?.noticeAtMs).toBe(Date.parse('2026-11-16T18:40:00Z'));
  expect(own?.notBeforeMs).toBe(Date.parse('2026-11-16T19:06:00Z'));
  expect(own?.notAfterMs).toBe(Date.parse('2026-11-16T23:00:00Z'));
  expect((own?.notBeforeMs ?? 0) - (own?.noticeAtMs ?? 0)).toBeGreaterThanOrEqual(20 * 60_000);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-16T18:39:59.999Z'))).toBeNull();
  expect(bookedMaintenanceNotice(Date.parse('2026-11-16T18:40:00Z'))?.id).toBe(own?.id);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-16T22:59:59.999Z'))?.id).toBe(own?.id);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-16T23:00:00Z'))?.id).toBe(
    '2026-11-16-owner-offcycle-engine-2320z'
  );
});

it('publishes the 2026-11-16-owner-offcycle-engine-2320z engine window promise with its lead and fixed expiry', () => {
  const own = BOOKED_MAINTENANCE_NOTICES.find(
    (n) => n.id === '2026-11-16-owner-offcycle-engine-2320z'
  );
  expect(own?.noticeAtMs).toBe(Date.parse('2026-11-16T23:00:00Z'));
  expect(own?.notBeforeMs).toBe(Date.parse('2026-11-16T23:20:00Z'));
  expect(own?.notAfterMs).toBe(Date.parse('2026-11-17T02:00:00Z'));
  expect((own?.notBeforeMs ?? 0) - (own?.noticeAtMs ?? 0)).toBeGreaterThanOrEqual(20 * 60_000);
  expect(BOOKED_MAINTENANCE_NOTICES.some((n) => n.id === own?.id)).toBe(true);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-16T23:19:59.999Z'))?.id).toBe(own?.id);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-17T01:59:59.999Z'))?.id).toBe(own?.id);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-17T02:00:00Z'))).toBeNull();
});

it('gives the drained promo database attempt its own primary notice and fixed expiry', () => {
  const id = '2026-11-17-promo-play-through-db-drained';
  const own = BOOKED_MAINTENANCE_NOTICES.find((n) => n.id === id);
  expect(own?.noticeAtMs).toBe(Date.parse('2026-11-17T11:00:00Z'));
  expect(own?.notBeforeMs).toBe(Date.parse('2026-11-17T11:20:00Z'));
  expect(own?.notAfterMs).toBe(Date.parse('2026-11-17T13:00:00Z'));
  expect(bookedMaintenanceNotice(Date.parse('2026-11-17T10:59:59.999Z'))).toBeNull();
  expect(bookedMaintenanceNotice(Date.parse('2026-11-17T11:00:00Z'))?.id).toBe(id);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-17T12:59:59.999Z'))?.id).toBe(id);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-17T13:00:00Z'))).toBeNull();
  for (const old of [
    '2026-11-17-promo-play-through-db',
    '2026-11-17-promo-play-through-db-corrected',
  ])
    expect(BOOKED_MAINTENANCE_NOTICES.find((n) => n.id === old)?.notAfterMs).toBe(
      Date.parse('2026-11-17T09:00:00Z')
    );
});

it('keeps the reserved promo attempt inside the continuous drained promise', () => {
  const own = BOOKED_MAINTENANCE_NOTICES.find(
    (n) => n.id === '2026-11-17-promo-play-through-db-reserved'
  );
  const earlier = BOOKED_MAINTENANCE_NOTICES.find(
    (n) => n.id === '2026-11-17-promo-play-through-db-drained'
  );
  expect(own?.noticeAtMs).toBe(Date.parse('2026-11-17T12:30:00Z'));
  expect(own?.notBeforeMs).toBe(Date.parse('2026-11-17T12:50:00Z'));
  expect(own?.notAfterMs).toBe(Date.parse('2026-11-17T13:00:00Z'));
  expect(earlier?.notAfterMs).toBe(own?.notAfterMs);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-17T12:30:00Z'))?.id).toBe(earlier?.id);
  const admittedAt = Date.parse('2026-11-17T12:50:00Z');
  expect(bookedMaintenanceNotice(admittedAt)?.id).toBe(earlier?.id);
  expect(own).toBeDefined();
  expect(earlier).toBeDefined();
  expect(bookedMaintenanceNoticeText(own!, admittedAt)).toBe(
    bookedMaintenanceNoticeText(earlier!, admittedAt)
  );
  expect(bookedMaintenanceNotice(Date.parse('2026-11-17T13:00:00Z'))).toBeNull();
});

it('gives the final one-file promo generation attempt its own later primary notice', () => {
  const id = '2026-11-17-promo-generation-db';
  const own = BOOKED_MAINTENANCE_NOTICES.find((n) => n.id === id);
  expect(own?.noticeAtMs).toBe(Date.parse('2026-11-17T13:55:00Z'));
  expect(own?.notBeforeMs).toBe(Date.parse('2026-11-17T14:15:00Z'));
  expect(own?.notAfterMs).toBe(Date.parse('2026-11-17T15:00:00Z'));
  expect(bookedMaintenanceNotice(Date.parse('2026-11-17T13:54:59.999Z'))).toBeNull();
  expect(bookedMaintenanceNotice(Date.parse('2026-11-17T13:55:00Z'))?.id).toBe(id);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-17T14:59:59.999Z'))?.id).toBe(id);
  expect(bookedMaintenanceNotice(Date.parse('2026-11-17T15:00:00Z'))).toBeNull();
  const row = doc.databaseWindows.find((w) => w.id === id);
  expect(row?.migrations).toEqual([
    '20261116200638_tournament_winnings_retain_original_earning_generation_and_c.sql',
  ]);
});

it('books the 2026-11-17-owner-no-notice-engine-2330z engine window on the owner notice waiver and ships no advance notice', () => {
  const id = '2026-11-17-owner-no-notice-engine-2330z';
  const own = doc.windows.find((w) => w.id === id);
  expect(own).toBeDefined();
  expect(ownerNoticeWaived(own, 'windows')).toBe(true);
  expect(own?.playerNoticeAt).toBeUndefined();
  expect(own?.ownerNoticeWaiver).toBe(OWNER_NOTICE_WAIVER_INSTRUCTION);
  expect([own?.notBefore, own?.notAfter]).toEqual(['2026-11-17T23:30:00Z', '2026-11-18T05:20:00Z']);
  expect(BOOKED_MAINTENANCE_NOTICES.some((n) => n.id === id)).toBe(false);
});

it('books the 2026-11-18-owner-no-notice-engine-0705z engine window on the owner notice waiver and ships no advance notice', () => {
  const id = '2026-11-18-owner-no-notice-engine-0705z';
  const own = doc.windows.find((w) => w.id === id);
  expect(own).toBeDefined();
  expect(ownerNoticeWaived(own, 'windows')).toBe(true);
  expect(own?.playerNoticeAt).toBeUndefined();
  expect(own?.ownerNoticeWaiver).toBe(OWNER_NOTICE_WAIVER_INSTRUCTION);
  expect([own?.notBefore, own?.notAfter]).toEqual(['2026-11-18T07:05:30Z', '2026-11-18T09:20:00Z']);
  expect(BOOKED_MAINTENANCE_NOTICES.some((n) => n.id === id)).toBe(false);
});

it('books the 2026-11-18-owner-no-notice-engine-1030z engine window on the owner notice waiver and ships no advance notice', () => {
  const id = '2026-11-18-owner-no-notice-engine-1030z';
  const own = doc.windows.find((w) => w.id === id);
  expect(own).toBeDefined();
  expect(ownerNoticeWaived(own, 'windows')).toBe(true);
  expect(own?.playerNoticeAt).toBeUndefined();
  expect(own?.ownerNoticeWaiver).toBe(OWNER_NOTICE_WAIVER_INSTRUCTION);
  expect([own?.notBefore, own?.notAfter]).toEqual(['2026-11-18T10:30:00Z', '2026-11-18T16:20:00Z']);
  expect(BOOKED_MAINTENANCE_NOTICES.some((n) => n.id === id)).toBe(false);
});

it('books the 2026-11-18-owner-no-notice-engine-1630z engine window on the owner notice waiver and ships no advance notice', () => {
  const id = '2026-11-18-owner-no-notice-engine-1630z';
  const own = doc.windows.find((w) => w.id === id);
  expect(own).toBeDefined();
  expect(ownerNoticeWaived(own, 'windows')).toBe(true);
  expect(own?.playerNoticeAt).toBeUndefined();
  expect(own?.ownerNoticeWaiver).toBe(OWNER_NOTICE_WAIVER_INSTRUCTION);
  expect([own?.notBefore, own?.notAfter]).toEqual(['2026-11-18T16:30:00Z', '2026-11-18T22:20:00Z']);
  expect(BOOKED_MAINTENANCE_NOTICES.some((n) => n.id === id)).toBe(false);
});

it('books the 2026-11-19-owner-no-notice-engine-1030z engine window on the owner notice waiver and ships no advance notice', () => {
  const id = '2026-11-19-owner-no-notice-engine-1030z';
  const own = doc.windows.find((w) => w.id === id);
  expect(own).toBeDefined();
  expect(ownerNoticeWaived(own, 'windows')).toBe(true);
  expect(own?.playerNoticeAt).toBeUndefined();
  expect(own?.ownerNoticeWaiver).toBe(OWNER_NOTICE_WAIVER_INSTRUCTION);
  expect([own?.notBefore, own?.notAfter]).toEqual(['2026-11-19T10:30:00Z', '2026-11-19T16:20:00Z']);
  expect(BOOKED_MAINTENANCE_NOTICES.some((n) => n.id === id)).toBe(false);
});

it('books the 2026-11-19-owner-no-notice-engine-1510z engine window on the owner notice waiver and ships no advance notice', () => {
  const id = '2026-11-19-owner-no-notice-engine-1510z';
  const own = doc.windows.find((w) => w.id === id);
  expect(own).toBeDefined();
  expect(ownerNoticeWaived(own, 'windows')).toBe(true);
  expect(own?.playerNoticeAt).toBeUndefined();
  expect(own?.ownerNoticeWaiver).toBe(OWNER_NOTICE_WAIVER_INSTRUCTION);
  expect([own?.notBefore, own?.notAfter]).toEqual(['2026-11-19T15:10:00Z', '2026-11-19T21:00:00Z']);
  expect(BOOKED_MAINTENANCE_NOTICES.some((n) => n.id === id)).toBe(false);
});

it('books the 2026-11-19-owner-no-notice-engine-2030z engine window on the owner notice waiver and ships no advance notice', () => {
  const id = '2026-11-19-owner-no-notice-engine-2030z';
  const own = doc.windows.find((w) => w.id === id);
  expect(own).toBeDefined();
  expect(ownerNoticeWaived(own, 'windows')).toBe(true);
  expect(own?.playerNoticeAt).toBeUndefined();
  expect(own?.ownerNoticeWaiver).toBe(OWNER_NOTICE_WAIVER_INSTRUCTION);
  expect([own?.notBefore, own?.notAfter]).toEqual(['2026-11-19T20:30:00Z', '2026-11-20T02:00:00Z']);
  expect(BOOKED_MAINTENANCE_NOTICES.some((n) => n.id === id)).toBe(false);
});

it('books the 2026-11-20-owner-no-notice-engine-0430z engine window on the owner notice waiver and ships no advance notice', () => {
  const id = '2026-11-20-owner-no-notice-engine-0430z';
  const own = doc.windows.find((w) => w.id === id);
  expect(own).toBeDefined();
  expect(ownerNoticeWaived(own, 'windows')).toBe(true);
  expect(own?.playerNoticeAt).toBeUndefined();
  expect(own?.ownerNoticeWaiver).toBe(OWNER_NOTICE_WAIVER_INSTRUCTION);
  expect([own?.notBefore, own?.notAfter]).toEqual(['2026-11-20T04:30:00Z', '2026-11-20T09:20:00Z']);
  expect(BOOKED_MAINTENANCE_NOTICES.some((n) => n.id === id)).toBe(false);
});

it('books the 2026-11-20-owner-no-notice-engine-1730z engine window on the owner notice waiver and ships no advance notice', () => {
  const id = '2026-11-20-owner-no-notice-engine-1730z';
  const own = doc.windows.find((w) => w.id === id);
  expect(own).toBeDefined();
  expect(ownerNoticeWaived(own, 'windows')).toBe(true);
  expect(own?.playerNoticeAt).toBeUndefined();
  expect(own?.ownerNoticeWaiver).toBe(OWNER_NOTICE_WAIVER_INSTRUCTION);
  expect([own?.notBefore, own?.notAfter]).toEqual(['2026-11-20T17:30:00Z', '2026-11-20T23:20:00Z']);
  expect(BOOKED_MAINTENANCE_NOTICES.some((n) => n.id === id)).toBe(false);
});

it('books the 2026-11-20-owner-no-notice-engine-2130z engine window on the owner notice waiver and ships no advance notice', () => {
  const id = '2026-11-20-owner-no-notice-engine-2130z';
  const own = doc.windows.find((w) => w.id === id);
  expect(own).toBeDefined();
  expect(ownerNoticeWaived(own, 'windows')).toBe(true);
  expect(own?.playerNoticeAt).toBeUndefined();
  expect(own?.ownerNoticeWaiver).toBe(OWNER_NOTICE_WAIVER_INSTRUCTION);
  expect([own?.notBefore, own?.notAfter]).toEqual(['2026-11-20T21:30:00Z', '2026-11-21T03:30:00Z']);
  expect(BOOKED_MAINTENANCE_NOTICES.some((n) => n.id === id)).toBe(false);
});

it('books the 2026-11-20-owner-no-notice-engine-2330z engine window on the owner notice waiver and ships no advance notice', () => {
  const id = '2026-11-20-owner-no-notice-engine-2330z';
  const own = doc.windows.find((w) => w.id === id);
  expect(own).toBeDefined();
  expect(ownerNoticeWaived(own, 'windows')).toBe(true);
  expect(own?.playerNoticeAt).toBeUndefined();
  expect(own?.ownerNoticeWaiver).toBe(OWNER_NOTICE_WAIVER_INSTRUCTION);
  expect([own?.notBefore, own?.notAfter]).toEqual(['2026-11-20T23:30:00Z', '2026-11-21T05:30:00Z']);
  expect(BOOKED_MAINTENANCE_NOTICES.some((n) => n.id === id)).toBe(false);
});

it('books the 2026-11-21-owner-no-notice-engine-0300z engine window on the owner notice waiver and ships no advance notice', () => {
  const id = '2026-11-21-owner-no-notice-engine-0300z';
  const own = doc.windows.find((w) => w.id === id);
  expect(own).toBeDefined();
  expect(ownerNoticeWaived(own, 'windows')).toBe(true);
  expect(own?.playerNoticeAt).toBeUndefined();
  expect(own?.ownerNoticeWaiver).toBe(OWNER_NOTICE_WAIVER_INSTRUCTION);
  expect([own?.notBefore, own?.notAfter]).toEqual(['2026-11-21T03:06:00Z', '2026-11-21T09:00:00Z']);
  expect(BOOKED_MAINTENANCE_NOTICES.some((n) => n.id === id)).toBe(false);
});

it('books the 2026-11-21-owner-no-notice-engine-0825z engine window on the owner notice waiver and ships no advance notice', () => {
  const id = '2026-11-21-owner-no-notice-engine-0825z';
  const own = doc.windows.find((w) => w.id === id);
  expect(own).toBeDefined();
  expect(ownerNoticeWaived(own, 'windows')).toBe(true);
  expect(own?.playerNoticeAt).toBeUndefined();
  expect(own?.ownerNoticeWaiver).toBe(OWNER_NOTICE_WAIVER_INSTRUCTION);
  expect([own?.notBefore, own?.notAfter]).toEqual(['2026-11-21T08:25:00Z', '2026-11-21T09:20:00Z']);
  expect(BOOKED_MAINTENANCE_NOTICES.some((n) => n.id === id)).toBe(false);
});

it('books the 2026-11-21-owner-no-notice-engine-1135z engine window on the owner notice waiver and ships no advance notice', () => {
  const id = '2026-11-21-owner-no-notice-engine-1135z';
  const own = doc.windows.find((w) => w.id === id);
  expect(own).toBeDefined();
  expect(ownerNoticeWaived(own, 'windows')).toBe(true);
  expect(own?.playerNoticeAt).toBeUndefined();
  expect(own?.ownerNoticeWaiver).toBe(OWNER_NOTICE_WAIVER_INSTRUCTION);
  expect([own?.notBefore, own?.notAfter]).toEqual(['2026-11-21T11:35:00Z', '2026-11-21T17:35:00Z']);
  expect(BOOKED_MAINTENANCE_NOTICES.some((n) => n.id === id)).toBe(false);
});

it('books the 2026-11-21-owner-no-notice-engine-1906z engine window on the owner notice waiver and ships no advance notice', () => {
  const id = '2026-11-21-owner-no-notice-engine-1906z';
  const own = doc.windows.find((w) => w.id === id);
  expect(own).toBeDefined();
  expect(ownerNoticeWaived(own, 'windows')).toBe(true);
  expect(own?.playerNoticeAt).toBeUndefined();
  expect(own?.ownerNoticeWaiver).toBe(OWNER_NOTICE_WAIVER_INSTRUCTION);
  expect([own?.notBefore, own?.notAfter]).toEqual(['2026-11-21T19:06:00Z', '2026-11-21T22:06:00Z']);
  expect(BOOKED_MAINTENANCE_NOTICES.some((n) => n.id === id)).toBe(false);
});
