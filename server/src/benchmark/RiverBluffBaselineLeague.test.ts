/**
 * The baseline river bluff measurement (RiverBluffBaselineLeague.ts) measures
 * what it says: the arms differ only in `riverBluffBaseline`, the pools play
 * the tendencies they are named for, a cell replays exactly, and the hand
 * observer it reads through changes nothing about how a hand is played.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { enableBrainTelemetry } from '../engine/BrainTelemetry.js';
import { humanCalibratedProfileFor } from './HumanCalibratedPopulation.js';
import { playHand } from './HorseLeague.js';
import {
  RBLM_ARMS,
  RBLM_HERO_SEAT,
  rblmSeatKind,
  rblmTendencyProfile,
  rblmWeakHand,
  runRiverBluffBaselineCell,
} from './RiverBluffBaselineLeague.js';

describe('river bluff baseline league', { timeout: 600_000 }, () => {
  beforeAll(() => enableBrainTelemetry());

  it('the arms differ only in the baseline flag', () => {
    expect(RBLM_ARMS.a).toEqual({});
    expect(RBLM_ARMS.b).toEqual({ riverBluffBaseline: false });
  });

  it('stations and over-folders move only the facing-bet fold cutoffs', () => {
    for (const v of ['nlh', 'plo4']) {
      const base = humanCalibratedProfileFor(v);
      const st = rblmTendencyProfile(v, 'stations');
      const fo = rblmTendencyProfile(v, 'folders');
      for (const street of ['flop', 'turn', 'river'] as const) {
        const node = `${street}/facing_bet` as const;
        expect(st.cutoffs![node]!.raise).toBe(base.cutoffs![node]!.raise);
        expect(st.cutoffs![node]!.fold!).toBeLessThan(base.cutoffs![node]!.fold!);
        expect(fo.cutoffs![node]!.fold!).toBeGreaterThan(base.cutoffs![node]!.fold!);
      }
      expect(st.cutoffs!['river/checked_to']).toEqual(base.cutoffs!['river/checked_to']);
    }
  });

  it('every pool seats the hero once and the field it names', () => {
    expect(rblmSeatKind('mixed', RBLM_HERO_SEAT)).toBe('hero');
    expect([1, 2, 3, 4, 5].map((s) => rblmSeatKind('mixed', s))).toEqual([
      'horse',
      'calibrated',
      'stations',
      'folders',
      'horse',
    ]);
    expect([1, 2, 3, 4, 5].every((s) => rblmSeatKind('standard', s) === 'horse')).toBe(true);
    // Heads-up the one opponent rotates through the mixed field by deal.
    expect([0, 1, 2, 3, 4].map((p) => rblmSeatKind('mixed', 1, 2, p))).toEqual([
      'horse',
      'calibrated',
      'stations',
      'folders',
      'horse',
    ]);
  });

  it('weak hands are high card, a board pair, or an Omaha one pair', () => {
    const c = (rank: string, suit: string) => ({ rank, suit }) as never;
    const board = [
      c('K', 'spades'),
      c('9', 'hearts'),
      c('6', 'diamonds'),
      c('2', 'clubs'),
      c('2', 'spades'),
    ];
    expect(rblmWeakHand([c('Q', 'hearts'), c('J', 'clubs')], board, 'nlh')).toBe(true);
    expect(rblmWeakHand([c('K', 'hearts'), c('J', 'clubs')], board, 'nlh')).toBe(false);
    expect(rblmWeakHand([c('4', 'hearts'), c('4', 'clubs')], board, 'nlh')).toBe(false);
  });

  it('the observer reads a hand without changing it', () => {
    for (let h = 0; h < 30; h++) {
      const seed = 9100 + h * 7919;
      const plain = playHand(seed, (h % 6) + 1, () => ({}));
      let actions = 0;
      let ended: number[] | null = null;
      const observed = playHand(
        seed,
        (h % 6) + 1,
        () => ({}),
        undefined,
        undefined,
        'nlh',
        6,
        100,
        undefined,
        undefined,
        undefined,
        undefined,
        true,
        { onAction: () => actions++, onEnd: (e) => (ended = e.net) }
      );
      expect(observed).toEqual(plain);
      expect(ended).toEqual(plain);
      expect(actions).toBeGreaterThan(0);
    }
  });

  it('a cell replays exactly, plays legally, and its pools play their tendencies', async () => {
    const one = await runRiverBluffBaselineCell('nlh', 'cash', 'folders', 150, 4242);
    const two = await runRiverBluffBaselineCell('nlh', 'cash', 'folders', 150, 4242);
    expect({ ...two, durationMs: 0 }).toEqual({ ...one, durationMs: 0 });
    expect(one.armA.hands).toBe(150);
    expect(one.armB.hands).toBe(150);
    expect(one.illegalActions).toBe(0);
    expect(one.truncatedStreets).toBe(0);
    expect(one.brainExceptionFallbacks).toBe(0);
    // Arm B never places a baseline bluff: the flag is off.
    expect(one.armB.baselineBluffs).toBe(0);
    const st = await runRiverBluffBaselineCell('nlh', 'cash', 'stations', 150, 4242);
    expect(st.illegalActions).toBe(0);
    // A station reaches showdown more often than an over-folder lets the hero.
    expect(st.armB.showdowns).toBeGreaterThan(one.armB.showdowns);
  });
});
