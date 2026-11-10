import { describe, expect, it } from 'vitest';
import {
  LIGHTNING_FOUR_HANDED_POOL_MAX,
  LIGHTNING_MATCHER_PARAM_DEFAULTS,
  lightningMatcherModel,
  type LightningPoolPlayer,
} from './LightningMatcherModel.js';

const players = (n: number, idle = 10_000): LightningPoolPlayer[] =>
  Array.from({ length: n }, (_, i) => ({
    playerId: `player-${String(i).padStart(2, '0')}`,
    legal: true,
    reasonCode: null,
    idleSinceMs: idle,
    enteredAtMs: 0,
    // Every player here has been the big blind before: this file is about
    // group sizes, not the first-entry rule (a never-BB slot is a newcomer,
    // held until it is a big blind; ANewPlayersFirstLightningHandIsTheBigBlind).
    lastBbAtMs: 0,
    bbUnresolved: false,
    debtSinceMs: 0,
    handsSinceBb: null,
    newcomer: false,
    positions: { btn: 0, co: 0, hj: 0, utg: 0 },
  }));
const plan = (population: LightningPoolPlayer[], now: number, size: number) =>
  lightningMatcherModel('m1')!.plan(
    { nowMs: now, players: population, recentHands: [] },
    { ...LIGHTNING_MATCHER_PARAM_DEFAULTS, instanceTarget: size, instanceMax: size }
  );

// Dan, 2026-10-26 (six at once, five after one second), and 2026-11-10
// (20261110214134, form tables sooner when the pool is thin): four ready
// players deal four-handed once the latest has waited 1.5 s, only while the
// whole pool is at most LIGHTNING_FOUR_HANDED_POOL_MAX; never fewer than four.
describe('Lightning deals six immediately or five after one second from the fifth arrival (Dan, 2026-10-26)', () => {
  it.each([0, 1, 2, 3])('never forms a %i-player hand, regardless of queue age', (n) => {
    expect(plan(players(n), 1_000_000, 6).groups).toHaveLength(0);
  });
  it('forms four only in a thin pool, after 1.5 s from the fourth arrival', () => {
    expect(plan(players(4), 11_499, 6).groups).toHaveLength(0);
    expect(plan(players(4), 11_500, 6).groups.map((g) => g.players.length)).toEqual([4]);
    // A healthy pool (players in hands count) never deals four, however long they wait.
    const healthy = [
      ...players(4),
      ...players(LIGHTNING_FOUR_HANDED_POOL_MAX - 3).map((x, i) => ({
        ...x,
        playerId: `busy-${String(i).padStart(2, '0')}`,
        legal: false,
        reasonCode: 'IN_HAND',
      })),
    ];
    expect(plan(healthy, 1_000_000, 6).groups).toHaveLength(0);
  });
  it('holds five until the exact deadline, then forms five', () => {
    expect(plan(players(5), 10_999, 6).groups).toHaveLength(0);
    expect(plan(players(5), 11_000, 6).groups.map((g) => g.players.length)).toEqual([5]);
  });
  it('deals six immediately and leaves a fresh five waiting', () => {
    expect(plan(players(6), 10_000, 6).groups.map((g) => g.players.length)).toEqual([6]);
    expect(plan(players(11), 10_000, 6).groups.map((g) => g.players.length)).toEqual([6]);
    expect(plan(players(11), 11_000, 6).groups.map((g) => g.players.length)).toEqual([6, 5]);
  });
  it('starts the wait at the fifth ready player, never at the oldest arrival', () => {
    const p = players(5);
    p[0].idleSinceMs = 0;
    p[4].idleSinceMs = 20_000;
    const before = structuredClone(p);
    expect(plan(p, 20_999, 6).groups).toHaveLength(0);
    expect(plan(p, 21_000, 6).groups.map((g) => g.players.length)).toEqual([5]);
    expect(p).toEqual(before);
  });
  it.each(['m1', 'm1-port', 'm2'])(
    'keeps every matcher version within five or six (four in a thin pool), independently of legacy size configuration: %s',
    (version) => {
      for (let n = 0; n <= 35; n++) {
        const p = players(n);
        const before = structuredClone(p);
        const model = lightningMatcherModel(version)!;
        const snapshot = { nowMs: 13_000, players: p, recentHands: [] };
        const result = model.plan(snapshot, {
          ...LIGHTNING_MATCHER_PARAM_DEFAULTS,
          instanceMin: 2,
          instanceTarget: 9,
          instanceMax: 9,
        });
        const sizes = result.groups.map((g) => g.players.length);
        expect(sizes).toEqual([
          ...Array(Math.floor(n / 6)).fill(6),
          ...(n % 6 === 5 ? [5] : []),
          ...(n % 6 === 4 && n <= LIGHTNING_FOUR_HANDED_POOL_MAX ? [4] : []),
        ]);
        const seated = result.groups.flatMap((g) => g.players);
        expect(new Set(seated).size).toBe(seated.length);
        expect(p).toEqual(before);
      }
    }
  );
  it('holds a replacement fifth player for their own one-second wait', () => {
    const p = players(5, 0);
    expect(plan(p, 10_000, 6).groups).toHaveLength(1);
    p[4] = { ...p[4], playerId: 'replacement', idleSinceMs: 10_000 };
    expect(plan(p, 10_999, 6).groups).toHaveLength(0);
    expect(plan(p, 11_000, 6).groups.map((g) => g.players.length)).toEqual([5]);
  });
  it('does not reset an aged five-player group for a fresh player assigned to the full six', () => {
    const p = players(11, 0);
    p[0].idleSinceMs = 10_000;
    const groups = plan(p, 10_000, 6).groups;
    expect(groups.map((g) => g.players.length)).toEqual([6, 5]);
    expect(groups[0].players).toContain(p[0].playerId);
    expect(groups[1].players).not.toContain(p[0].playerId);
  });
  it('counts only legal players toward the minimum and the wait', () => {
    const p = players(6);
    p[0].legal = false;
    p[0].idleSinceMs = 100_000;
    expect(plan(p, 13_000, 6).groups.map((g) => g.players.length)).toEqual([5]);
    p[1].legal = false;
    // Four legal in a thin pool of six: four-handed once aged (20261110214134).
    expect(plan(p, 1_000_000, 6).groups.map((g) => g.players.length)).toEqual([4]);
    p[2].legal = false;
    expect(plan(p, 1_000_000, 6).groups).toHaveLength(0);
  });
});
