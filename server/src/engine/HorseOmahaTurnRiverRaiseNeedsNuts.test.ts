/**
 * OMAHA TURN AND RIVER: A RAISE FACING A BET NEEDS THE NUTS (owner 2026-11-15
 * 12:52 / 12:53, hand 59534208; option omahaTurnRiverRaiseNeedsNuts, default
 * OFF). "HE SHOULD BE FOLDING THE TURN ... NEVER A RAISE".
 *
 * Classes, many seeds: the exact hand class (PLO5 heads-up, 9d Qd Jh 7h turn,
 * Qc Jd 6c 6d 4h out of position, checked, facing a pot bet) under an unknown,
 * a measured maniac and a value-leader read never raises; sets, two pair,
 * non-nut straights and flushes on the turn and the river never raise; the
 * nut straight, nut flush and nut full house keep their raise; the in-position
 * turn combo draw keeps its raise; the flop is unchanged; unset / false are
 * byte-identical; every action is legal.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { seedFastRandom } from './HorseEval.js';
import {
  HorseLogic,
  omahaTurnRiverRaiseNeedsNutsRule,
  type HorseDecideOpts,
} from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import { omahaFacingBetEvSpot, omahaFacingBetEvVerdict } from './HorseOmahaFacingBetEv.js';
import { omahaNutClassNow } from './HorseOmahaMadeHandDefense.js';
import {
  omahaRaiseNeedsNutsScope,
  omahaRaiseNeedsNutsAdmitsCall,
} from './HorseOmahaTurnRiverRaiseNeedsNuts.js';
import {
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ComplaintFixture,
} from './HorseComplaintReplay.js';
import type { Card, CardRank, CardSuit, HorseDecision } from '../types.js';
import TOP_SET from './horseComplaints/plo5-top-set-check-raises-pot-on-the-four-straight-turn.fixture.json';

const FX = TOP_SET as unknown as ComplaintFixture; // hero seat 6 OOP, opponent seat 1, turn raise node 20
const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [1, 3, 7, 11, 17, 23, 31, 42, 99, 101, 102, 103, 104, 105, 2026, 4242];
const ON: HorseDecideOpts = { omahaTurnRiverRaiseNeedsNuts: true };
const RAISES = new Set(['raise', 'bet', 'all_in']);

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

interface Spot {
  hole: string;
  board: string;
  /** the pot before the opponent's bet, and the bet */
  potBefore?: number;
  bet?: number;
  /** hero acts last (dealer moved to the hero) */
  inPosition?: boolean;
  street?: 'flop' | 'turn' | 'river';
}
/** Heads-up PLO5 cash: hero (seat 6) checked, the opponent (seat 1) bet `bet` into `potBefore`. */
function spot(s: Spot) {
  const f = JSON.parse(JSON.stringify(FX)) as ComplaintFixture;
  f.hole['6'] = cards(s.hole);
  const node = f.actions.find((a) => a.ord === 20)!;
  const pn = node.publicNode!;
  const street =
    s.street ?? (s.board.length === 8 ? 'turn' : s.board.length === 10 ? 'river' : 'flop');
  const potBefore = s.potBefore ?? 216;
  const bet = s.bet ?? potBefore;
  pn.boards = [s.board];
  pn.street = street;
  node.stage = street;
  const opp = pn.seats.find((r) => r[0] === 1)!;
  opp[1] = Math.round((2095.3 - bet) * 100) / 100;
  opp[2] = bet;
  opp[3] = 95 + bet;
  pn.pot = potBefore + bet;
  pn.toCall = bet;
  pn.currentBet = bet;
  pn.minRaiseTo = 2 * bet;
  pn.maxRaiseTo = potBefore + 3 * bet;
  pn.legalActions = ['fold', 'call', 'raise', 'all_in'];
  if (s.inPosition) pn.dealerSeat = 6;
  const before = f.actions.filter((a) => (street === 'flop' ? a.stage === 'preflop' : a.ord < 18));
  const acts: ComplaintAction[] = [...before];
  let ord = before.length ? before[before.length - 1].ord : 0;
  const push = (a: Partial<ComplaintAction>) =>
    acts.push({ isFullRaise: false, dead: false, ...a, ord: ++ord } as ComplaintAction);
  if (street === 'river') {
    push({ seat: 6, stage: 'turn', action: 'check', amount: 0, origin: 'horse_policy' });
    push({ seat: 1, stage: 'turn', action: 'check', amount: 0, origin: 'player' });
  }
  if (!s.inPosition)
    push({ seat: 6, stage: street, action: 'check', amount: 0, origin: 'horse_policy' });
  push({ seat: 1, stage: street, action: 'bet', amount: bet, origin: 'player', isFullRaise: true });
  node.ord = ++ord;
  f.actions = [...acts, node];
  return stateAt(f, node);
}
type St = ReturnType<typeof spot>;

const decide = (st: St, opts: HorseDecideOpts, seed: number): HorseDecision => {
  seedFastRandom(seed);
  return structuredClone(HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, opts));
};
const raiseOf = (st: St): HorseDecision => ({
  action: 'raise',
  amount: st.gs.maxRaiseTo as number,
  thinkTime: 1000,
});
const legal = (st: St, d: HorseDecision) => {
  expect(st.gs.legalActions).toContain(d.action === 'check' ? 'check' : d.action);
  if (d.action === 'call') {
    const owed = Number.isFinite(st.gs.toCall)
      ? (st.gs.toCall as number)
      : st.gs.currentBet - st.hero.bet;
    expect(d.amount).toBeCloseTo(Math.min(owed, st.hero.stack), 9);
  }
};

const EXACT: Spot = { hole: 'QcJd6c6d4h', board: '9dQdJh7h' };

describe('the exact hand class (59534208): PLO5 turn, top two pair, OOP, checked, facing a pot bet', () => {
  const reads = {
    unknown: null,
    maniac: { measured: true, betCheckedToRatio: 1.5, postflopManiac: true, sizeShown: null },
    value_leader: {
      measured: true,
      betCheckedToRatio: 0.7,
      postflopManiac: false,
      sizeShown: null,
    },
  } as const;
  for (const [name, read] of Object.entries(reads)) {
    it(`never raises at any seed, read ${name}; a forced raise becomes the EV call or fold`, () => {
      vi.spyOn(HorseMind, 'omahaFacingBetEvReadOf').mockReturnValue(read as never);
      const st = spot(EXACT);
      expect(omahaRaiseNeedsNutsScope(st.hero, st.gs)?.street).toBe('turn');
      expect(omahaNutClassNow(st.hero, st.gs)).toBe(false);
      const sp = omahaFacingBetEvSpot(st.hero, st.gs)!;
      expect(sp).not.toBeNull();
      const v = omahaFacingBetEvVerdict(
        sp,
        st.hero.cards,
        st.gs.communityCards,
        [],
        read as never
      )!;
      expect(v).not.toBeNull();
      const forced = omahaTurnRiverRaiseNeedsNutsRule(raiseOf(st), st.hero, st.gs, ON);
      expect(forced.action).toBe(v.call ? 'call' : 'fold');
      legal(st, forced);
      // eslint-disable-next-line no-console
      console.log(
        `[59534208 class] read=${name} verdict=${v.call ? 'CALL' : 'FOLD'} pWin=${v.pWin.toFixed(4)} pTie=${v.pTie.toFixed(4)} vsValue=${v.vsValue.toFixed(4)} vsOther=${v.vsOther.toFixed(4)} bluffShare=${v.bluffShare.toFixed(4)} price=${v.price.toFixed(4)} ev=${v.ev.toFixed(2)} margin=${v.margin.toFixed(2)}`
      );
      for (const seed of SEEDS) {
        const t0 = Date.now();
        const d = decide(st, ON, seed);
        expect(Date.now() - t0).toBeLessThan(5000);
        expect(RAISES.has(d.action)).toBe(false);
        legal(st, d);
      }
    });
  }
});

const NON_NUT: Array<[string, Spot]> = [
  ['turn set (bottom set, straight possible)', { hole: '7c7d2s3s4c', board: '9dQdJh7h' }],
  ['turn two pair (top and bottom)', { hole: 'Qc7c2s3s4c', board: '9dQdJh7h' }],
  ['turn non-nut straight (low end)', { hole: '8c6c2s3s4d', board: '9dQdJh7h' }],
  ['turn non-nut flush', { hole: '5d3d2c8s4s', board: '9dQdJh7h' }],
  ['river set', { hole: 'JcJs2s3s4c', board: '9dQdJh7h2h' }],
  ['river two pair', { hole: 'QcJs5s3s4c', board: '9dQdJh7h2c' }],
  ['river non-nut straight', { hole: '8c6c2s3s4d', board: '9dQdJh7h2c' }],
  ['river non-nut flush', { hole: '5h3h2c8s4s', board: '9dQdJh7h2h' }],
];
describe('sets, two pair, non-nut straights and flushes facing a bet on the turn and the river', () => {
  for (const [name, s] of NON_NUT)
    it(`${name}: never raises (forced raise and every seed)`, () => {
      const st = spot(s);
      expect(omahaNutClassNow(st.hero, st.gs)).toBe(false);
      enableBrainTelemetry();
      drainFires();
      const forced = omahaTurnRiverRaiseNeedsNutsRule(raiseOf(st), st.hero, st.gs, {
        ...ON,
        telemetry: true,
      });
      // eslint-disable-next-line no-console
      console.log(`[class] ${name}: forced raise -> ${forced.action} ${forced.amount ?? ''}`);
      expect(['call', 'fold']).toContain(forced.action);
      legal(st, forced);
      const fires = drainFires();
      expect(
        fires.some((f) =>
          f.feature.startsWith(
            forced.action === 'call'
              ? 'omaha_turn_river_raise_needs_nuts_called'
              : 'omaha_turn_river_raise_needs_nuts_folded'
          )
        )
      ).toBe(true);
      if (forced.action === 'call')
        expect(omahaRaiseNeedsNutsAdmitsCall(st.hero, st.gs, forced.amount)).toBe(true);
      for (const seed of SEEDS.slice(0, 8)) {
        const d = decide(st, ON, seed);
        expect(RAISES.has(d.action)).toBe(false);
        legal(st, d);
      }
    });
});

const NUTS: Array<[string, Spot]> = [
  ['turn nut straight', { hole: 'KcTc2s3s4c', board: '9dQdJh7c' }],
  ['river nut flush', { hole: 'AhKh2c3s4c', board: '9dQdJh7h2h' }],
  ['river nut full house', { hole: 'QcQs2c3s4c', board: '9dQdJh7hQh' }],
];
describe('nut class is unchanged', () => {
  for (const [name, s] of NUTS)
    it(`${name}: a raise stands`, () => {
      const st = spot(s);
      expect(omahaNutClassNow(st.hero, st.gs)).toBe(true);
      const r = raiseOf(st);
      expect(omahaTurnRiverRaiseNeedsNutsRule(r, st.hero, st.gs, ON)).toEqual(r);
      expect(omahaRaiseNeedsNutsAdmitsCall(st.hero, st.gs, st.gs.toCall)).toBe(false);
    });
});

describe('the in-position turn combo draw of 12:30 is unchanged; out of position it is not', () => {
  // Kd Td 8c: diamond flush draw + K-T-8 straight draw on 9d Qd Jh 2c (8+ outs)
  const combo: Spot = { hole: 'KdTd8c3s4c', board: '9dQd5h2c', inPosition: true };
  it('in position: the raise stands', () => {
    const st = spot(combo);
    const r = raiseOf(st);
    expect(omahaTurnRiverRaiseNeedsNutsRule(r, st.hero, st.gs, ON)).toEqual(r);
  });
  it('out of position: the raise is a call or a fold', () => {
    const st = spot({ ...combo, inPosition: false });
    const d = omahaTurnRiverRaiseNeedsNutsRule(raiseOf(st), st.hero, st.gs, ON);
    expect(['call', 'fold']).toContain(d.action);
  });
});

describe('the flop, and the option unset or false', () => {
  it('flop: a raise is unchanged', () => {
    const st = spot({ hole: 'QcJd6c6d4h', board: '9dQdJh' });
    const r = raiseOf(st);
    expect(omahaTurnRiverRaiseNeedsNutsRule(r, st.hero, st.gs, ON)).toEqual(r);
  });
  it('unset and false: the rule returns the decision it was given', () => {
    const st = spot(EXACT);
    const r = raiseOf(st);
    expect(omahaTurnRiverRaiseNeedsNutsRule(r, st.hero, st.gs, {})).toBe(r);
    expect(
      omahaTurnRiverRaiseNeedsNutsRule(r, st.hero, st.gs, { omahaTurnRiverRaiseNeedsNuts: false })
    ).toBe(r);
  });
  it('unset, false and a truthy non-boolean decide byte-identically over a seeded set', () => {
    const states = [EXACT, ...NON_NUT.map((x) => x[1]), ...NUTS.map((x) => x[1])].map(spot);
    const digest = (opts: HorseDecideOpts) => {
      const h = createHash('sha256');
      for (const st of states)
        for (const seed of SEEDS.slice(0, 6)) {
          const d = decide(st, opts, seed);
          h.update(JSON.stringify([d.action, d.amount ?? null]));
        }
      return h.digest('hex');
    };
    const base = digest({});
    expect(digest({ omahaTurnRiverRaiseNeedsNuts: false })).toBe(base);
    expect(digest({ omahaTurnRiverRaiseNeedsNuts: 1 as unknown as boolean })).toBe(base);
  });
});

describe('base brain against the option: what changed, every receipt valid', () => {
  it('over the classes and seeds, the option never leaves a non-nut raise and its receipts validate', () => {
    let baseRaises = 0;
    let changed = 0;
    for (const s of [EXACT, ...NON_NUT.map((x) => x[1])]) {
      const st = spot(s);
      for (const seed of SEEDS) {
        const b = decide(st, {}, seed);
        const d = decide(st, ON, seed);
        if (RAISES.has(b.action)) baseRaises++;
        if (b.action !== d.action || (b.amount ?? null) !== (d.amount ?? null)) changed++;
        expect(RAISES.has(d.action)).toBe(false);
        legal(st, d);
        expect(
          horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
            player: st.hero,
            gameState: st.gs,
          })
        ).toBeNull();
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `[base-vs-on] base raises=${baseRaises} changed=${changed} of ${(1 + NON_NUT.length) * SEEDS.length}`
    );
  });
});

describe('end to end: the recorded turn check-raise (top set on a four-straight turn, fixture node 20)', () => {
  it('base may raise; with the option no seed raises and every receipt validates', () => {
    const node = FX.actions.find((a) => a.ord === 20)!;
    const st = stateAt(FX, node);
    expect(omahaNutClassNow(st.hero, st.gs)).toBe(false);
    let baseRaises = 0;
    for (const seed of SEEDS) {
      const b = decide(st, {}, seed);
      if (RAISES.has(b.action)) baseRaises++;
      const d = decide(st, ON, seed);
      expect(RAISES.has(d.action)).toBe(false);
      legal(st, d);
      expect(
        horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
          player: st.hero,
          gameState: st.gs,
        })
      ).toBeNull();
    }
    // eslint-disable-next-line no-console
    console.log(`[fixture node 20] base raises=${baseRaises} of ${SEEDS.length}`);
  });
});

// horsePlayStyles (owner 2026-11-15 16:40 / 16:42): the style dials act before
// this rule, so it is final for the tight, the current and the pressure style,
// in and out of position (the pressure style differs from current in position).
describe.each(['tight', 'current', 'pressure'] as const)(
  "the Horse's playing style %s: no raise without the nuts on the turn or the river",
  (style) => {
    const STYLED: HorseDecideOpts = { ...ON, horsePlayStyles: true, horsePlayStyleForce: style };
    it('over the classes, both positions and the seeds no non-nut raise is left and every receipt validates', () => {
      for (const s of [EXACT, ...NON_NUT.map((x) => x[1])])
        for (const inPosition of [false, true]) {
          const st = spot({ ...s, inPosition });
          for (const seed of SEEDS) {
            const d = decide(st, STYLED, seed);
            expect(RAISES.has(d.action)).toBe(false);
            legal(st, d);
            expect(
              horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
                player: st.hero,
                gameState: st.gs,
              })
            ).toBeNull();
          }
        }
    });
  }
);

describe('a failure inside scope never folds a hand the brain raised (AUDIT-FILES-B 2026-11-19)', () => {
  it('59534208 class, a pot bet (price exactly 1/3): an exception after the scope calls, never folds', () => {
    const st = spot(EXACT);
    expect(omahaRaiseNeedsNutsScope(st.hero, st.gs)?.street).toBe('turn');
    expect(omahaNutClassNow(st.hero, st.gs)).toBe(false);
    // The rule's telemetry read throws once it is inside scope: the failure path decides.
    const failing = { omahaTurnRiverRaiseNeedsNuts: true } as HorseDecideOpts;
    Object.defineProperty(failing, 'telemetry', {
      get() {
        throw new Error('forced failure inside scope');
      },
    });
    const d = omahaTurnRiverRaiseNeedsNutsRule(raiseOf(st), st.hero, st.gs, failing);
    expect(d.action).toBe('call');
    legal(st, d);
  });
});
