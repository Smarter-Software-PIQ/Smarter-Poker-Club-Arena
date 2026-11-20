/**
 * omahaTurnStabLightningRow (AUDIT48-TURN lane 2026-11-19, default OFF): with omahaTurnStabDefenceIsPriced and
 * omahaPricedInLightning on, a person's Lightning turn stab after a checked-through flop is priced against the
 * Lightning-measured non-value row (HorseOmahaTurnStabDefence.OMAHA_TURN_STAB_PERSON_BLUFF_LIGHTNING). The audited
 * spots (PLO5 Lightning, flop checked through heads-up, the person leads the turn at 70 to 110 percent of the pot,
 * the Horse folds) are carried here in their public shape only (no ids, no person's cards): the line of
 * HorseOmahaTurnStabDefence.test.ts with the Lightning domain set.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { replayProfiles, stateAt } from './HorseComplaintReplay.js';
import { omahaFacingBetEvSpot, type OmahaFacingBetEvSpot } from './HorseOmahaFacingBetEv.js';
import { omahaPricedBySize } from './HorseOmahaPricedMode.js';
import {
  OMAHA_TURN_STAB_PERSON_BLUFF,
  OMAHA_TURN_STAB_PERSON_BLUFF_LIGHTNING,
  omahaTurnStabSpot,
} from './HorseOmahaTurnStabDefence.js';
import { expand, type RecordedFacingBet } from './HorseOmahaFacingBetEv.test-support.js';
import { horseDecisionReceiptRefusalForGates } from './horseDecision/responseValidation.js';

const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [1, 2, 3, 4];
const STAB_ON: HorseDecideOpts = {
  omahaFacingBetEv: true,
  omahaTurnStabDefenceIsPriced: true,
  omahaPricedInLightning: true,
};
const ROW_ON: HorseDecideOpts = { ...STAB_ON, omahaTurnStabLightningRow: true };

/** PLO5 1/2: seat 5 (the person, small blind) raises to 6, seat 6 (the Horse, big blind) calls; the flop checks
 *  through; the person bets `bet` into 14 first on the turn; the Horse answers. */
function stab(hole: string, bet = 12): RecordedFacingBet {
  const a =
    `5|p|sb|1|f|0|0;6|p|bb|2|f|0|0;6|p|ante|2|f|0|1;2|p|fold|0|h|0|0;3|p|fold|0|h|0|0;4|p|fold|0|h|0|0;` +
    `5|p|raise|6|p|1|0;6|p|call|4|h|0|0;5|f|check|0|p|0|0;6|f|check|0|h|0|0;5|t|bet|${bet}|p|1|0;6|t|fold|0|h|0|0`;
  return {
    n: 1,
    st: 'turn',
    held: 'test spot',
    best: false,
    pl: '2H 3H 4H 5P 6H',
    dealer: 4,
    a,
    boards: ['Kd9s4c2h'],
    seat: 6,
    ord: a.split(';').length,
    hole,
    pot: 14 + bet,
    bet,
    min: null,
    max: null,
    seats: [
      [2, 500, 0, 0, 0, 0, 1],
      [3, 500, 0, 0, 0, 0, 1],
      [4, 500, 0, 0, 0, 0, 1],
      [5, 500 - 6 - bet, bet, 6 + bet, 0, 0, 0],
      [6, 492, 0, 8, 2, 0, 0],
    ],
  };
}
function stateOf(r: RecordedFacingBet, lightning: boolean) {
  const { fx, node } = expand(r);
  const st = stateAt(fx, node);
  if (lightning)
    (st.gs as { publicMemoryDomain?: unknown }).publicMemoryDomain = { speed: 'lightning' };
  return st;
}
const spotOf = (r: RecordedFacingBet, lightning: boolean) => {
  const st = stateOf(r, lightning);
  return { spot: omahaFacingBetEvSpot(st.hero, st.gs as never)! as OmahaFacingBetEvSpot, st };
};
function play(r: RecordedFacingBet, opts: HorseDecideOpts, lightning: boolean) {
  enableBrainTelemetry();
  const out = { bytes: [] as string[], fires: [] as string[][] };
  for (const seed of SEEDS) {
    HorseMind.reset();
    drainFires();
    seedFastRandom(seed);
    const st = stateOf(r, lightning);
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      observeMind: false,
      ...opts,
    } as never);
    out.bytes.push(JSON.stringify(withoutMeasurements(d)));
    out.fires.push(drainFires().map((f) => f.feature));
  }
  return out;
}

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('the Lightning-measured row', () => {
  it('is the Lightning measurement shrunk with 8 pseudo-bets toward the pooled row', () => {
    // MODE-READ re-fit 2026-11-20 (population_all_cards_capped): capped q over the capped effective n
    expect(OMAHA_TURN_STAB_PERSON_BLUFF_LIGHTNING).toEqual([0.156, 0.428, 0.385, 0.385]);
    const [u, m, b] = OMAHA_TURN_STAB_PERSON_BLUFF;
    expect((0.0758 * 12 + u * 8) / 20).toBeCloseTo(0.156, 2);
    expect((0.3567 * 9.55 + m * 8) / 17.55).toBeCloseTo(0.428, 2);
    expect((0.3623 * 29.49 + b * 8) / 37.49).toBeCloseTo(0.385, 2);
  });

  it('in the Lightning line it reads the Lightning row; at the table, or with the row off, the pooled row', () => {
    for (const bet of [4, 7, 12, 14]) {
      const lt = spotOf(stab('9h8h7c6d5s', bet), true);
      const withRow = omahaTurnStabSpot(lt.spot, lt.st.hero, lt.st.gs as never, true, true);
      expect(withRow.priorBluff).toBeCloseTo(
        omahaPricedBySize(OMAHA_TURN_STAB_PERSON_BLUFF_LIGHTNING, lt.spot.potFrac),
        9
      );
      expect({ ...withRow, priorBluff: lt.spot.priorBluff }).toEqual(lt.spot);
      const noRow = omahaTurnStabSpot(lt.spot, lt.st.hero, lt.st.gs as never, true, false);
      expect(noRow.priorBluff).toBeCloseTo(
        omahaPricedBySize(OMAHA_TURN_STAB_PERSON_BLUFF, lt.spot.potFrac),
        9
      );
      // Lightning closed (omahaPricedInLightning off): the very same spot, row or not.
      expect(omahaTurnStabSpot(lt.spot, lt.st.hero, lt.st.gs as never, false, true)).toBe(lt.spot);
      const table = spotOf(stab('9h8h7c6d5s', bet), false);
      const tRow = omahaTurnStabSpot(table.spot, table.st.hero, table.st.gs as never, true, true);
      expect(tRow).toEqual(
        omahaTurnStabSpot(table.spot, table.st.hero, table.st.gs as never, true, false)
      );
    }
  });
});

describe('the decision', () => {
  const HANDS = [
    '9h8h7c6d5s',
    'Kc8s7h3d2s',
    'QhJhTd8c3s',
    'As9c8d5h3h',
    'Ts9h8c6c2d',
    'JcTc7s6h4d',
  ];

  it('at the table the row option is byte-identical and fires nothing of its own', () => {
    for (const hole of HANDS) {
      const on = play(stab(hole), ROW_ON, false);
      expect(on.bytes).toEqual(play(stab(hole), STAB_ON, false).bytes);
      expect(on.fires.flat()).not.toContain('omaha_turn_stab_lightning_row_seen');
    }
  });

  it('without the stab option the row option is byte-identical in Lightning', () => {
    const NO_STAB: HorseDecideOpts = { omahaFacingBetEv: true, omahaPricedInLightning: true };
    for (const hole of HANDS)
      expect(play(stab(hole), { ...NO_STAB, omahaTurnStabLightningRow: true }, true).bytes).toEqual(
        play(stab(hole), NO_STAB, true).bytes
      );
  });

  it('in the Lightning line the receipt fires and it never folds a hand the pooled row continues with', () => {
    let seen = 0;
    for (const hole of HANDS) {
      const base = play(stab(hole), STAB_ON, true);
      const row = play(stab(hole), ROW_ON, true);
      row.fires.forEach((f, i) => {
        if (f.includes('omaha_turn_stab_defence_priced_seen')) {
          seen++;
          expect(f).toContain('omaha_turn_stab_lightning_row_seen');
        }
        const b = JSON.parse(base.bytes[i]).action;
        const a = JSON.parse(row.bytes[i]).action;
        if (b !== 'fold') expect(a).not.toBe('fold');
      });
    }
    expect(seen).toBeGreaterThan(0);
  });
});

// MATHCORE ask (INTEGRATE-6, 2026-11-19): every Lightning decision the row changes, and every decision the stab
// defence changes in Lightning, passes the worker receipt validator under the gates the lane tries for it
// (omahaPricedInLightning is on: the row acts only with it).
describe('omahaTurnStabLightningRow: every changed Lightning decision passes the worker receipt validator', () => {
  const HANDS = [
    '9h8h7c6d5s',
    'Kc8s7h3d2s',
    'QhJhTd8c3s',
    'As9c8d5h3h',
    'Ts9h8c6c2d',
    'JcTc7s6h4d',
  ];
  const NO_STAB: HorseDecideOpts = { omahaFacingBetEv: true, omahaPricedInLightning: true };
  const decideAt = (r: RecordedFacingBet, opts: HorseDecideOpts, seed: number) => {
    HorseMind.reset();
    seedFastRandom(seed);
    const st = stateOf(r, true);
    const d = structuredClone(
      HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
        observeMind: false,
        ...opts,
      } as never)
    );
    return { st, d };
  };
  it('Lightning: no stab -> stab -> row, every change is admitted', () => {
    let changed = 0;
    for (const hole of HANDS)
      for (const bet of [6, 12, 14])
        for (const seed of SEEDS) {
          const none = decideAt(stab(hole, bet), NO_STAB, seed);
          const stabbed = decideAt(stab(hole, bet), STAB_ON, seed);
          const row = decideAt(stab(hole, bet), ROW_ON, seed);
          for (const [label, from, to] of [
            ['stab', none, stabbed],
            ['row', none, row],
          ] as const) {
            if (to.d.action === from.d.action && to.d.amount === from.d.amount) continue;
            changed++;
            expect(
              horseDecisionReceiptRefusalForGates(
                structuredClone(to.d),
                'plo5',
                { player: to.st.hero, gameState: to.st.gs },
                [false],
                [false],
                [true]
              ),
              `${label} ${hole} bet ${bet} seed ${seed} ${from.d.action}->${to.d.action}`
            ).toBeNull();
          }
        }
    expect(changed).toBeGreaterThan(0);
  });
});
