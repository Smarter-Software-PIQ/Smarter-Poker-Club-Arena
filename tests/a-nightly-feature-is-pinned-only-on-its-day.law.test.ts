/** Owner update October 31, 2026: only today's top events are pinned.
 * Future editions stay in the normal schedule, including weekly flagships.
 * This supersedes the historical October 19 weekly/single-instance exception.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { featuredNow, hasStarted, type PinFacts } from '../src/lib/featuredOnItsDay';

const CLUB = 'fade0000-0000-0000-0000-000000000001';
const row = (id: string, name: string, start: string, extra: Partial<PinFacts> = {}) => ({
  id,
  facts: {
    pinned: true,
    started: false,
    startTime: start,
    clubId: CLUB,
    name,
    ...extra,
  } as PinFacts,
});
const ids = (rows: ReturnType<typeof row>[], now: Date) =>
  [...featuredNow(rows, (r) => r.facts, now)].map((r) => r.id).sort();

/* Local wall-clock dates, so the test means the same thing in any zone CI runs in. */
const at = (y: number, m: number, d: number, h: number) =>
  new Date(y, m - 1, d, h, 0, 0).toISOString();

describe('a featured nightly event floats only on its own day', () => {
  const board = [
    row('tue', 'Nightly 10K (NLH)', at(2026, 10, 20, 19)),
    row('wed', 'Nightly 10K (NLH)', at(2026, 10, 21, 19)),
    row('thu', 'Nightly 10K (NLH)', at(2026, 10, 22, 19)),
    row('sun', 'Sunday 200 Deep Stack', at(2026, 10, 25, 13)),
  ];

  it('no future nightly or weekly event is pinned', () => {
    expect(ids(board, new Date(2026, 9, 19, 21, 52))).toEqual([]);
  });

  it("Tuesday: only Tuesday's Nightly 10K is pinned", () => {
    expect(ids(board, new Date(2026, 9, 20, 9))).toEqual(['tue']);
  });

  it("today's nightly keeps its pin once it is running", () => {
    const live = [
      row('mon', 'Nightly 10K (NLH)', at(2026, 10, 19, 19), { started: true }),
      ...board,
    ];
    expect(ids(live, new Date(2026, 9, 19, 21, 52))).toEqual(['mon']);
  });

  it('a row the host never pinned is never featured', () => {
    expect(
      ids(
        [row('x', 'Freeroll', at(2026, 10, 19, 22), { pinned: false })],
        new Date(2026, 9, 19, 12)
      )
    ).toEqual([]);
  });

  it('future instances in different clubs are still unpinned', () => {
    const union = [
      row('a', 'Nightly 10K (NLH)', at(2026, 10, 21, 19), { clubId: 'club-a' }),
      row('b', 'Nightly 10K (NLH)', at(2026, 10, 21, 19), { clubId: 'club-b' }),
    ];
    expect(ids(union, new Date(2026, 9, 19, 12))).toEqual([]);
  });

  it('a running edition today never promotes its only remaining future edition', () => {
    const live = [
      row('today', 'Nightly 10K (NLH)', at(2026, 10, 31, 19), { started: true }),
      row('future', 'Nightly 10K (NLH)', at(2026, 11, 2, 19)),
    ];
    expect(ids(live, new Date(2026, 9, 31, 20))).toEqual(['today']);
  });

  it('an old running event and an invalid or missing date cannot be pinned', () => {
    expect(
      ids(
        [
          row('old', 'Nightly 10K (NLH)', at(2026, 10, 30, 19), { started: true }),
          row('unknown', 'Top Event', 'invalid'),
          row('missing', 'Top Event', '', { startTime: null }),
        ],
        new Date(2026, 9, 31, 20)
      )
    ).toEqual([]);
  });

  it('weekly top events qualify on their own day and demote at local midnight', () => {
    const weekly = [row('sun', 'Sunday 200 Deep Stack', at(2026, 10, 25, 13))];
    expect(ids(weekly, new Date(2026, 9, 25, 23, 59))).toEqual(['sun']);
    expect(ids(weekly, new Date(2026, 9, 26, 0))).toEqual([]);
  });

  it('started statuses read in either case', () => {
    expect(hasStarted('RUNNING')).toBe(true);
    expect(hasStarted('late_reg')).toBe(true);
    expect(hasStarted('BAGGED')).toBe(true);
    expect(hasStarted('REGISTERING')).toBe(false);
  });

  it('every tournament display that floats pinned events goes through the rule', () => {
    for (const file of [
      'src/components/lobby/LobbyTable.tsx',
      'src/pages/TournamentPage.tsx',
      'src/pages/tournament/TournamentLobbyPage.tsx',
    ]) {
      const src = readFileSync(join(__dirname, '..', file), 'utf8');
      expect(src, file).toMatch(/featuredNow\(/);
    }
  });
});
