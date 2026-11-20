/**
 * IDENTICAL ARMS NEVER DIVERGE, WITH THE PUBLIC BET SIZE ON (law, 2026-11-19).
 *
 * omahaBetSizeByPublicState sizes every own postflop bet from a stream of its
 * own (horsePublicBetSize.horseBetSizeRandom) that production seeds from the
 * operating system at load, never from a deal. The league played both passes
 * of a duplicate pair on that one free-running stream, so the two passes drew
 * different sizes and two IDENTICAL arms diverged: 38 and 39 of 300 pairs
 * (refused matchup plo5_omaha_public_bet_size_in_lightning, seed 20261119),
 * 0 of 300 with the stream held. Any card with the option on in both arms
 * carried that unpaired noise.
 *
 * playHand now seeds the stream before every decision from the deal, the seat
 * and the decision's place in the hand (leaguePinPublicStreams). This law
 * holds it: identical arms diverge in 0 pairs, a card is the same on a second
 * run in the same process, the sizes are still drawn (another seed, another
 * size), and production's stream is still seeded from the operating system.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as publicBetSize from '../engine/horsePublicBetSize.js';
import { HorseLogic } from '../engine/HorseLogic.js';
import {
  leaguePinPublicStreams,
  runMatchup,
  type LeagueMatchup,
  type LeagueResult,
} from './HorseLeague.js';

const SIZE_ON = { omahaBetSizeByPublicState: true };

const identicalArms = (variant: 'plo4' | 'plo5'): LeagueMatchup => ({
  name: `${variant}_identical_arms_public_bet_size`,
  variant,
  hybridBaseline: true,
  a: { ...SIZE_ON },
  b: { ...SIZE_ON },
});

const measured = (r: LeagueResult) => {
  const { durationMs: _d, benchmarkComponents, ...rest } = r;
  return {
    ...rest,
    benchmarkComponents: benchmarkComponents.map(({ durationMs: _c, ...c }) => c),
  };
};

/** Runs a matchup recording every bet and raise amount the brain answered. */
async function runRecordingSizes(matchup: LeagueMatchup, pairs: number, seed: number) {
  const sizes: number[] = [];
  const original = HorseLogic.decide.bind(HorseLogic);
  const spy = vi.spyOn(HorseLogic, 'decide').mockImplementation((player, gs, style, mods, opts) => {
    const d = original(player, gs, style, mods, opts);
    if (gs.stage !== 'preflop' && (d.action === 'bet' || d.action === 'raise'))
      sizes.push(Number(d.amount));
    return d;
  });
  try {
    return { result: await runMatchup(matchup, pairs, seed), sizes };
  } finally {
    spy.mockRestore();
  }
}

describe('a paired league evaluation repeats itself with the public bet size on', () => {
  it.each(['plo4', 'plo5'] as const)(
    '%s: identical arms diverge in 0 of 150 pairs, and a second run is the same run',
    async (variant) => {
      const first = await runRecordingSizes(identicalArms(variant), 150, 41990913);
      const second = await runRecordingSizes(identicalArms(variant), 150, 41990913);
      expect(first.result.hands).toBe(300);
      expect(first.result.divergentPairs).toBe(0);
      expect(first.result.bb100).toBe(0);
      // The public sizes were really bet: many postflop wagers, several sizes.
      expect(first.sizes.length).toBeGreaterThan(100);
      expect(new Set(first.sizes).size).toBeGreaterThan(10);
      expect(second.sizes).toEqual(first.sizes);
      expect(measured(second.result)).toEqual(measured(first.result));
      // Another run seed is another set of deals and of size draws.
      const other = await runRecordingSizes(identicalArms(variant), 40, 41990914);
      expect(other.result.divergentPairs).toBe(0);
      expect(other.sizes.slice(0, 40)).not.toEqual(first.sizes.slice(0, 40));
    },
    900_000
  );

  it('the pin is a function of the deal, the seat and the decision, and of nothing else', () => {
    const draws = (handSeed: number, seat: number, decision: number) => {
      leaguePinPublicStreams(handSeed, seat, decision);
      return [publicBetSize.horseBetSizeRandom(), publicBetSize.horseBetSizeRandom()];
    };
    const base = draws(41990913, 2, 5);
    publicBetSize.horseBetSizeRandom();
    expect(draws(41990913, 2, 5)).toEqual(base);
    expect(draws(41990914, 2, 5)).not.toEqual(base);
    expect(draws(41990913, 3, 5)).not.toEqual(base);
    expect(draws(41990913, 2, 6)).not.toEqual(base);
    const seen = new Set<number>();
    for (let seat = 0; seat < 6; seat++)
      for (let d = 0; d < 40; d++) seen.add(draws(41990913, seat, d)[0]!);
    expect(seen.size).toBe(240);
  });

  it('production still seeds both public streams from the operating system', () => {
    const read = (name: string) =>
      readFileSync(new URL(`../engine/${name}`, import.meta.url), 'utf8');
    expect(read('horsePublicBetSize.ts')).toMatch(
      /let sizeState = \(randomBytes\(4\)\.readUInt32LE\(0\) \|\| 0x6d2b79f5\) >>> 0;/
    );
    expect(read('horsePublicActionTime.ts')).toMatch(
      /let timingState = \(randomBytes\(4\)\.readUInt32LE\(0\) \|\| 0x9e3779b9\) >>> 0;/
    );
    // The only callers of the seeding hooks outside the engine's own tests are harnesses.
    expect(read('HorseLogic.ts')).not.toMatch(/seedHorseBetSizeRandom|seedHorseTimingRandom/);
  });
});
