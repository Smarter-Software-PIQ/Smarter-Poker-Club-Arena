/**
 * omahaEvFoldModelHeadsUp (HU-OMAHA, default OFF), MATHCORE ask (INTEGRATE-6, 2026-11-19): every decision the
 * option changes is admitted by the worker receipt validator (responseValidation admits a wager_rules change only
 * from an enumerated list; a change it does not admit is an invalid response and the lane plays its CHECK/FOLD
 * fallback). The spots are synthetic public states (no ids, no recorded cards): PLO5 1/2, the person raises the
 * small blind, the Horse calls in the big blind, the flop (and on the turn spot the turn) checks to the Horse,
 * heads-up; the Horse checks or bets.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { replayProfiles, stateAt } from './HorseComplaintReplay.js';
import { expand, type RecordedFacingBet } from './HorseOmahaFacingBetEv.test-support.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';

const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [1, 2, 3, 4, 5, 6];
const BASE: HorseDecideOpts = { omahaEvFoldModel: true };
const ON: HorseDecideOpts = { ...BASE, omahaEvFoldModelHeadsUp: true };

function checkedTo(hole: string, street: 'flop' | 'turn', board: string): RecordedFacingBet {
  const pre =
    `5|p|sb|1|f|0|0;6|p|bb|2|f|0|0;6|p|ante|2|f|0|1;2|p|fold|0|h|0|0;3|p|fold|0|h|0|0;4|p|fold|0|h|0|0;` +
    `5|p|raise|6|p|1|0;6|p|call|4|h|0|0`;
  const flop =
    street === 'flop'
      ? `5|f|check|0|p|0|0;6|f|check|0|h|0|0`
      : `5|f|check|0|p|0|0;6|f|check|0|h|0|0;5|t|check|0|p|0|0;6|t|check|0|h|0|0`;
  const a = `${pre};${flop}`;
  return {
    n: 1,
    st: street as never,
    did: 'check' as never,
    held: 'test spot',
    best: false,
    pl: '2H 3H 4H 5P 6H',
    dealer: 4,
    a,
    boards: [board],
    seat: 6,
    ord: a.split(';').length,
    hole,
    pot: 14,
    bet: 0,
    cur: 0,
    legal: ['check', 'bet', 'all_in'],
    min: 2,
    max: 14,
    seats: [
      [2, 500, 0, 0, 0, 0, 1],
      [3, 500, 0, 0, 0, 0, 1],
      [4, 500, 0, 0, 0, 0, 1],
      [5, 494, 0, 6, 0, 0, 0],
      [6, 492, 0, 8, 2, 0, 0],
    ],
  };
}

const decideAt = (r: RecordedFacingBet, opts: HorseDecideOpts, seed: number) => {
  HorseMind.reset();
  seedFastRandom(seed);
  const { fx, node } = expand(r);
  const st = stateAt(fx, node);
  const d = structuredClone(
    HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      observeMind: false,
      ...opts,
    } as never)
  );
  return { st, d };
};

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('omahaEvFoldModelHeadsUp: every changed decision passes the worker receipt validator', () => {
  const HANDS = [
    '9h8h7c6d5s',
    'Kc8s7h3d2s',
    'QhJhTd8c3s',
    'As9c8d5h3h',
    'Ts9h8c6c2d',
    'JcTc7s6h4d',
    'AhAdKs7c2h',
  ];
  it('heads-up flop and turn, checked to the Horse: every on decision is admitted, changed or not', () => {
    let changed = 0;
    let decided = 0;
    for (const hole of HANDS)
      for (const [street, board] of [
        ['flop', 'Kd9s4c'],
        ['turn', 'Kd9s4c2h'],
        ['flop', '8d7s2c'],
      ] as const)
        for (const seed of SEEDS) {
          const base = decideAt(checkedTo(hole, street, board), BASE, seed);
          const on = decideAt(checkedTo(hole, street, board), ON, seed);
          decided++;
          if (on.d.action !== base.d.action || on.d.amount !== base.d.amount) changed++;
          expect(
            horseDecisionReceiptRefusal(structuredClone(on.d), 'plo5', {
              player: on.st.hero,
              gameState: on.st.gs,
            }),
            `${street} ${board} ${hole} seed ${seed} ${base.d.action}->${on.d.action}`
          ).toBeNull();
        }
    expect(decided).toBeGreaterThan(0);
    // the heads-up cell changes some of these decisions (else the admission above proves nothing)
    expect(changed).toBeGreaterThan(0);
  });
});
