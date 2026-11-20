/**
 * omahaTurnStabDefenceIsPriced (TURN-STAB lane 2026-11-19, default OFF): a person's first wager of the turn
 * after a checked-through flop, heads-up, PLO4/PLO5 cash, is priced inside omahaFacingBetEv against that line's
 * measured non-value share (HorseOmahaTurnStabDefence.ts). The spots below are the public shape of the measured
 * line (no ids, no person's cards): PLO5 1/2, the person raises the small blind, the Horse calls in the big
 * blind, both check the flop, the person bets the turn first and the Horse answers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { replayProfiles, stateAt } from './HorseComplaintReplay.js';
import {
  OMAHA_EV_PRIOR_BLUFF,
  omahaFacingBetEvSpot,
  type OmahaFacingBetEvSpot,
} from './HorseOmahaFacingBetEv.js';
import { omahaPricedBySize, OMAHA_PRICED_MEASURED_BLUFF } from './HorseOmahaPricedMode.js';
import {
  OMAHA_TURN_STAB_PERSON_BLUFF,
  omahaTurnStabLine,
  omahaTurnStabSpot,
} from './HorseOmahaTurnStabDefence.js';
import { expand, type RecordedFacingBet } from './HorseOmahaFacingBetEv.test-support.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';

const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [1, 2, 3, 4];
const BASE: HorseDecideOpts = { omahaFacingBetEv: true };
const ON: HorseDecideOpts = { ...BASE, omahaTurnStabDefenceIsPriced: true };

/** The line: seat 5 (the person, small blind) raises to 6, seat 6 (the Horse, big blind) calls; the flop checks
 *  through; the person bets `bet` into 14 first on the turn; the Horse answers. */
function stab(
  hole: string,
  o: { bet?: number; bettor?: 'P' | 'H'; flopBet?: boolean; board?: string } = {}
): RecordedFacingBet {
  const bet = o.bet ?? 12;
  const kind = o.bettor ?? 'P';
  const origin = kind === 'P' ? 'p' : 'h';
  const flop = o.flopBet
    ? `5|f|bet|6|${origin}|1|0;6|f|call|6|h|0|0`
    : `5|f|check|0|${origin}|0|0;6|f|check|0|h|0|0`;
  const potBefore = o.flopBet ? 26 : 14;
  const a =
    `5|p|sb|1|f|0|0;6|p|bb|2|f|0|0;6|p|ante|2|f|0|1;2|p|fold|0|h|0|0;3|p|fold|0|h|0|0;4|p|fold|0|h|0|0;` +
    `5|p|raise|6|${origin}|1|0;6|p|call|4|h|0|0;${flop};5|t|bet|${bet}|${origin}|1|0;6|t|fold|0|h|0|0`;
  const ord = a.split(';').length;
  const in5 = (o.flopBet ? 12 : 6) + bet;
  const in6 = o.flopBet ? 14 : 8;
  return {
    n: 1,
    st: 'turn',
    held: 'test spot',
    best: false,
    pl: `2H 3H 4H 5${kind} 6H`,
    dealer: 4,
    a,
    boards: [o.board ?? 'Kd9s4c2h'],
    seat: 6,
    ord,
    hole,
    pot: potBefore + bet,
    bet,
    min: null,
    max: null,
    seats: [
      [2, 500, 0, 0, 0, 0, 1],
      [3, 500, 0, 0, 0, 0, 1],
      [4, 500, 0, 0, 0, 0, 1],
      [5, 500 - in5, bet, in5, 0, 0, 0],
      [6, 500 - in6, 0, in6, 2, 0, 0],
    ],
  };
}
function stateOf(r: RecordedFacingBet) {
  const { fx, node } = expand(r);
  return stateAt(fx, node);
}
function play(r: RecordedFacingBet, opts: HorseDecideOpts) {
  enableBrainTelemetry();
  const out = { bytes: [] as string[], actions: [] as string[], fires: [] as string[][] };
  for (const seed of SEEDS) {
    HorseMind.reset();
    drainFires();
    seedFastRandom(seed);
    const st = stateOf(r);
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      observeMind: false,
      ...opts,
    } as never);
    out.bytes.push(JSON.stringify(withoutMeasurements(d)));
    out.actions.push(d.action);
    out.fires.push(drainFires().map((f) => f.feature));
  }
  return out;
}
const spotOf = (
  r: RecordedFacingBet
): { spot: OmahaFacingBetEvSpot; st: ReturnType<typeof stateOf> } => {
  const st = stateOf(r);
  return { spot: omahaFacingBetEvSpot(st.hero, st.gs as never)!, st };
};

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('the measured line', () => {
  it('the table is the measured line shrunk toward the person table, and differs from the prior in force', () => {
    // MODE-READ re-fit 2026-11-20 (population_all_cards_capped): shrunk toward the person table with its 8
    // pseudo-bets over the capped effective n: (q n_eff + prior 8) / (n_eff + 8)
    expect(OMAHA_TURN_STAB_PERSON_BLUFF).toEqual([0.275, 0.512, 0.468, 0.468]);
    const t = OMAHA_PRICED_MEASURED_BLUFF.turn;
    expect((0.2596 * 48 + t.under40 * 8) / 56).toBeCloseTo(0.275, 2);
    expect((0.5218 * 68.82 + t.mid * 8) / 76.82).toBeCloseTo(0.512, 2);
    expect((0.4749 * 183.81 + t.big * 8) / 191.81).toBeCloseTo(0.468, 2);
    expect(OMAHA_EV_PRIOR_BLUFF.turn.big).toBe(0.22);
  });

  it('holds for any bettor first to wager on the turn after a checked-through flop, heads-up', () => {
    const { spot, st } = spotOf(stab('9h8h7c6d5s'));
    expect(spot.street).toBe('turn');
    expect(spot.aggressorStreets).toBe(0);
    expect(omahaTurnStabLine(spot, st.hero, st.gs as never, false)).toBe(true);
    // MODE-READ 2026-11-20: one rule for every opponent (the line never asks whether the bettor is a person)
    const horse = spotOf(stab('9h8h7c6d5s', { bettor: 'H' }));
    expect(omahaTurnStabLine(horse.spot, horse.st.hero, horse.st.gs as never, false)).toBe(true);
    const flopBet = spotOf(stab('9h8h7c6d5s', { flopBet: true }));
    expect(omahaTurnStabLine(flopBet.spot, flopBet.st.hero, flopBet.st.gs as never, false)).toBe(
      false
    );
    const lightning = {
      ...(st.gs as object),
      publicMemoryDomain: { speed: 'lightning' },
    } as never;
    expect(omahaTurnStabLine(spot, st.hero, lightning, false)).toBe(false);
    expect(omahaTurnStabLine(spot, st.hero, lightning, true)).toBe(true);
    expect(omahaTurnStabLine({ ...spot, isRaise: true }, st.hero, st.gs as never, false)).toBe(
      false
    );
    expect(omahaTurnStabLine({ ...spot, behind: 1 }, st.hero, st.gs as never, false)).toBe(false);
    expect(
      omahaTurnStabLine(
        spot,
        st.hero,
        { ...(st.gs as object), gameVariant: 'plo6' } as never,
        false
      )
    ).toBe(false);
  });

  it('in the line the prior is the table at the size; outside it the very same spot', () => {
    for (const bet of [4, 7, 12, 14]) {
      const { spot, st } = spotOf(stab('9h8h7c6d5s', { bet }));
      const priced = omahaTurnStabSpot(spot, st.hero, st.gs as never, false);
      expect(priced).not.toBe(spot);
      expect(priced.priorBluff).toBeCloseTo(
        omahaPricedBySize(OMAHA_TURN_STAB_PERSON_BLUFF, spot.potFrac),
        9
      );
      expect({ ...priced, priorBluff: spot.priorBluff }).toEqual(spot);
    }
    const horse = spotOf(stab('9h8h7c6d5s', { bettor: 'H' }));
    expect(
      omahaTurnStabSpot(horse.spot, horse.st.hero, horse.st.gs as never, false).priorBluff
    ).toBeCloseTo(omahaPricedBySize(OMAHA_TURN_STAB_PERSON_BLUFF, horse.spot.potFrac), 9);
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

  it('off, unset and false are byte-identical on every spot and seed', () => {
    for (const hole of HANDS)
      for (const r of [stab(hole), stab(hole, { bettor: 'H' }), stab(hole, { flopBet: true })]) {
        const unset = play(r, BASE);
        expect(play(r, { ...BASE, omahaTurnStabDefenceIsPriced: false }).bytes).toEqual(
          unset.bytes
        );
        expect(unset.fires.flat().some((f) => f.startsWith('omaha_turn_stab_defence'))).toBe(false);
      }
  });

  it('on, outside the line nothing changes and no receipt fires', () => {
    for (const hole of HANDS)
      for (const r of [stab(hole, { flopBet: true })]) {
        const on = play(r, ON);
        expect(on.bytes).toEqual(play(r, BASE).bytes);
        expect(on.fires.flat().some((f) => f.startsWith('omaha_turn_stab_defence'))).toBe(false);
      }
  });

  it('on, a Horse bettor is in the line too: one rule for every opponent (MODE-READ 2026-11-20)', () => {
    let priced = false;
    for (const hole of HANDS) {
      const on = play(stab(hole, { bettor: 'H' }), ON);
      if (on.fires.flat().some((f) => f === 'omaha_turn_stab_defence_priced_seen')) priced = true;
    }
    expect(priced).toBe(true);
  });

  it('on, in the line the stab is priced (receipt), it never folds a hand the base calls, and it calls more', () => {
    let changed = 0;
    for (const hole of HANDS) {
      const base = play(stab(hole), BASE);
      const on = play(stab(hole), ON);
      expect(on.fires.every((f) => f.includes('omaha_turn_stab_defence_priced_seen'))).toBe(true);
      on.actions.forEach((a, i) => {
        if (base.actions[i] !== 'fold') expect(a).not.toBe('fold');
        if (a !== base.actions[i]) {
          changed++;
          expect(on.fires[i]).toContain('omaha_turn_stab_defence_changed');
        }
      });
    }
    expect(changed).toBeGreaterThan(0);
  });
});

// MATHCORE ask (INTEGRATE-6, 2026-11-19): responseValidation admits a wager_rules change only from an enumerated
// list; a change it does not admit is an invalid response and the lane plays its CHECK/FOLD fallback. Every
// decision the option changes is run through the worker validator with the decision's own request.
describe('omahaTurnStabDefenceIsPriced: every changed decision passes the worker receipt validator', () => {
  const HANDS = [
    '9h8h7c6d5s',
    'Kc8s7h3d2s',
    'QhJhTd8c3s',
    'As9c8d5h3h',
    'Ts9h8c6c2d',
    'JcTc7s6h4d',
  ];
  const decideAt = (r: RecordedFacingBet, opts: HorseDecideOpts, seed: number) => {
    HorseMind.reset();
    seedFastRandom(seed);
    const st = stateOf(r);
    const d = structuredClone(
      HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
        observeMind: false,
        ...opts,
      } as never)
    );
    return { st, d };
  };
  it('a fold the base makes that the priced stab defence calls (or raises) is admitted', () => {
    let changed = 0;
    for (const hole of HANDS)
      for (const bet of [6, 12, 14])
        for (const seed of SEEDS) {
          const base = decideAt(stab(hole, { bet }), BASE, seed);
          const on = decideAt(stab(hole, { bet }), ON, seed);
          if (on.d.action === base.d.action && on.d.amount === base.d.amount) continue;
          changed++;
          expect(
            horseDecisionReceiptRefusal(structuredClone(on.d), 'plo5', {
              player: on.st.hero,
              gameState: on.st.gs,
            }),
            `${hole} bet ${bet} seed ${seed} ${base.d.action}->${on.d.action}`
          ).toBeNull();
        }
    expect(changed).toBeGreaterThan(0);
  });
});

// OWNER 2026-11-19 8:26 PM Chicago: the emergency batch is PLO4/PLO5 only; PLO6 is separate. Every facing-bet option of
// the batch, switched on, leaves a PLO6 decision byte-identical (the same line, played with six cards).
describe('PLO6 is untouched by the PLO4/PLO5 batch options (facing a turn stab)', () => {
  const HANDS6 = ['9h8h7c6d5s2c', 'Kc8s7h3d2sQd', 'QhJhTd8c3s4h', 'As9c8d5h3hJc'];
  const plo6 = (hole: string, bet: number): RecordedFacingBet =>
    ({ ...stab(hole, { bet }), variant: 'plo6' }) as unknown as RecordedFacingBet;
  const OPTIONS: HorseDecideOpts[] = [
    { omahaTurnStabDefenceIsPriced: true },
    {
      omahaTurnStabDefenceIsPriced: true,
      omahaPricedInLightning: true,
      omahaTurnStabLightningRow: true,
    },
    { omahaFacingBetIsPricedByEquity: true },
    { omahaEvFoldModel: true, omahaEvFoldModelHeadsUp: true },
    { omahaPreflopJamFacingReraiseIsPriced: true },
    { horseRiverNoBlockerBet: true },
    { omahaPackEffectiveDepth: true, omahaPackClampDeepDepth: true },
  ];
  it('each option on: every PLO6 decision and receipt is the one with it off', () => {
    for (const hole of HANDS6)
      for (const bet of [6, 12])
        for (const o of OPTIONS) {
          const r = plo6(hole, bet);
          expect(
            play(r, { ...BASE, ...o }).bytes,
            `${hole} ${bet} ${Object.keys(o).join('+')}`
          ).toEqual(play(r, BASE).bytes);
        }
  });
});
