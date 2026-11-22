import { describe, expect, it } from 'vitest';
import { OpponentHudAsOf } from './OpponentHudAsOf.js';
import {
  applyHudHand,
  emptyHudProfile,
  handRecordFromRow,
  type HudHandRecord,
} from './OpponentHudProfile.js';
import { buildHudPacket } from './OpponentHud.js';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const H = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = 1_800_000_000_000;
const row = (id: number, a: number, b: number) => ({
  id: H(id),
  created_at: new Date(T + id * 60_000).toISOString(),
  game_variant: 'plo5',
  tournament_id: null,
  big_blind: 2,
  button_seat: 1,
  players: [
    { seat: 1, userId: U(a), stack: 400, cards: ['As', 'Ks', 'Qs', 'Js', 'Ts'] },
    { seat: 2, userId: U(b), stack: 400, cards: ['2c', '3c', '4c', '5c', '6c'] },
  ],
  actions: [
    { seat: 1, userId: U(a), stage: 'preflop', action: 'sb', amount: 1 },
    { seat: 2, userId: U(b), stage: 'preflop', action: 'bb', amount: 2 },
    { seat: 1, userId: U(a), stage: 'preflop', action: 'raise', amount: 6 },
    { seat: 2, userId: U(b), stage: 'preflop', action: 'fold', amount: 0 },
  ],
  community_cards: [],
  showdown: [],
  winners: [{ userId: U(a), amount: 8 }],
});

describe('OpponentHudAsOf: the profile as of a hand, the same structure production builds', () => {
  const rows = [5, 1, 3, 2, 4].map((i) => row(i, 1, 2)); // out of order on purpose
  it('excludes the target hand and every later hand, whatever order the rows came in', () => {
    const b = new OpponentHudAsOf(rows);
    expect(b.profilesBefore(H(1), 'plo5')).toEqual([]);
    expect(b.profilesBefore(H(4), 'plo5', [U(1)])![0].hands).toBe(3);
    // an earlier query after a later one rebuilds
    expect(b.profilesBefore(H(2), 'plo5', [U(1)])![0].hands).toBe(1);
    expect(b.profilesBefore(H(99), 'plo5')).toBeNull();
  });
  it('equals hand-by-hand production application, and its packet equals the production packet', () => {
    const b = new OpponentHudAsOf(rows);
    const p = emptyHudProfile(U(2), 'plo5');
    for (const i of [1, 2, 3, 4]) applyHudHand(p, handRecordFromRow(row(i, 1, 2)) as HudHandRecord);
    const got = b.profilesBefore(H(5), 'plo5', [U(2)])![0];
    expect(JSON.stringify(got)).toBe(JSON.stringify(p));
    expect(b.packetBefore(H(5), 'plo5', [U(2)], {}, T, 'preflop')).toEqual(
      buildHudPacket('plo5', [p], {}, T, 'preflop')
    );
    expect(JSON.stringify(got)).not.toMatch(/"cards"|As|2c/);
  });
});
