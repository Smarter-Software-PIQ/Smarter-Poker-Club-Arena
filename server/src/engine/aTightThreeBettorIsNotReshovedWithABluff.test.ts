/**
 * LATER LAYERS KEEP THE STYLE READ, rule 2b (2026-11-15).
 *
 * Facing a 3-bet at 26 to 35bb effective, the V87 reshove decides by hand
 * class and never read the bars styleTightReRaiserRespect had just raised:
 * A5s-A2s blocker hands jammed into a credibly tight 3-bettor while the
 * respect receipt fired (reproduction claim 2b on a796551420a5). Now the
 * bluff and blocker reshoves are dropped against such a 3-bettor; the value
 * reshoves are unchanged and the tournament utility still runs afterwards.
 * Option off: byte-identical to the commit before.
 *
 * Spot: hero opened to 6 under the gun, a credibly tight 3-bettor
 * (valueHeavyGrinder, 0 of 20) 3-bets to 20 on the button; 30bb or 100bb.
 */
import { describe, expect, it } from 'vitest';
import { install, preflopThreeBet, VILLAINS } from './HorseOpponentStyle.contexts.test-support.js';
import {
  decide,
  pinAll,
  seeds,
  supply,
  tally,
} from './laterLayersKeepTheStyleRead.test-support.js';

const RESPECT = { styleTightReRaiserRespect: true };
type Mode = 'tournament' | 'cash';
const run = (mode: Mode, hand: string, stack: number, opts: Record<string, unknown>) =>
  seeds(30).map((s) => {
    install(VILLAINS.grinder!, mode);
    supply(120);
    return decide(preflopThreeBet(mode, hand, stack), opts, s);
  });
// Captured on a668406c (before the change), seeds 1..30.
const JAM_T = 'c6ac34440bf2239e58b3b721';
const JAM_C = '56641c9cf0fc89cf7f68013d';
const OFF: Array<[Mode, string, number, string]> = [
  ['tournament', 'As4s', 60, JAM_T],
  ['tournament', 'As2s', 60, JAM_T],
  ['tournament', 'QsQh', 60, JAM_T],
  ['tournament', 'AsKd', 60, JAM_T],
  ['tournament', 'As4s', 200, 'd88315821ca1fe119337b1ef'],
  ['tournament', 'QsQh', 200, '7d58df6992a2a966553470f3'],
  ['cash', 'As4s', 60, JAM_C],
  ['cash', 'As2s', 60, JAM_C],
  ['cash', 'QsQh', 60, JAM_C],
  ['cash', 'AsKd', 60, JAM_C],
  ['cash', 'As4s', 200, '5d08fc186620df97ad87ea7e'],
  ['cash', 'QsQh', 200, '708a959281897b5e00e25d5c'],
];

describe('a tight 3-bettor is not reshoved with a bluff', () => {
  it('option off: byte-identical to the commit before', () => {
    for (const [mode, hand, stack, base] of OFF)
      expect(pinAll(run(mode, hand, stack, {})), `${mode} ${hand} ${stack}`).toBe(base);
  });

  it('blocker reshoves at 30bb are dropped against a credibly tight 3-bettor', () => {
    // Before: all_in 30 of 30 in every one of these cells, the respect receipt fired.
    for (const mode of ['tournament', 'cash'] as const)
      for (const hand of ['As4s', 'As2s']) {
        const ds = run(mode, hand, 60, RESPECT);
        expect(
          ds.some((d) => d.decision.action === 'all_in' || d.decision.action === 'raise'),
          `${mode} ${hand}`
        ).toBe(false);
        expect(ds.every((d) => d.fires.style_tight_reraiser_respect_seen === 1)).toBe(true);
      }
    expect(tally(run('tournament', 'As4s', 60, RESPECT))).toEqual({ fold: 30 });
    expect(tally(run('cash', 'As4s', 60, RESPECT))).toEqual({ call: 30 });
  });

  it('value reshoves and the deeper spots are unchanged with the option on', () => {
    expect(pinAll(run('tournament', 'QsQh', 60, RESPECT))).toBe(JAM_T);
    expect(pinAll(run('tournament', 'AsKd', 60, RESPECT))).toBe(JAM_T);
    expect(pinAll(run('cash', 'QsQh', 60, RESPECT))).toBe(JAM_C);
    expect(pinAll(run('cash', 'AsKd', 60, RESPECT))).toBe(JAM_C);
    expect(pinAll(run('tournament', 'As4s', 200, RESPECT))).toBe('9528ead8259e7847cb147bc0');
    expect(pinAll(run('cash', 'QsQh', 200, RESPECT))).toBe('49b5be5741207908f46f441b');
  });
});
