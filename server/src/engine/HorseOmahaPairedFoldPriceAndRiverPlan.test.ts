/**
 * OMAHA: THE PAIRED-BOARD FOLD RESPECTS THE PRICE, AND A TURN BET NEEDS A
 * RIVER PLAN (lane owner 2026-11-15, hand 59521326; options
 * omahaPairedBoardFoldRespectsPrice and omahaTurnBetNeedsRiverPlan, each
 * default OFF).
 *
 * The recorded hand, anonymised to seat numbers: the Horse bet 373 into 669
 * on the turn card that paired the board with the nut straight, leaving 524
 * behind a pot of 1,415, then folded the straight to the river all-in at a
 * price of 0.213, 700 of its 1,224 already in.
 *
 *  - omahaPairedBoardFoldRespectsPrice: that river is no longer forced to
 *    fold (the reference decision, a call, stands); a price above 0.25, two
 *    pair and trips still fold; the 60% clause; unset identical;
 *  - omahaTurnBetNeedsRiverPlan: that turn bet is a check; a full house and
 *    deep stacks are unchanged; with the price exception on the same bet has
 *    a river plan and stands; unset identical.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { omahaTurnBetShortBehind } from './HorseOmahaOopChecks.js';
import {
  ploPairedBoardCallPrice,
  ploPairedBoardFoldRespectsPrice,
  ploPairedBoardMustFold,
} from './HorsePloPairedBoardFold.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import {
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ComplaintFixture,
} from './HorseComplaintReplay.js';
import type { Card, CardRank, CardSuit } from '../types.js';
import FIXTURE from './horseComplaints/plo5-straight-barrels-the-board-pairing-turn-then-folds-the-river.fixture.json';

const FX = FIXTURE as unknown as ComplaintFixture;
const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));

const TURN = 16;
const RIVER_CHECK = 18;
const RIVER_FOLD = 20;
const HERO = 5;
const CALLER = 1;
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [...FX.seeds, 101, 102, 103, 104, 105, 106];
const PRICE_ON: HorseDecideOpts = { omahaPairedBoardFoldRespectsPrice: true };
const PLAN_ON: HorseDecideOpts = { omahaTurnBetNeedsRiverPlan: true };

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

type Node = ReturnType<typeof stateAt>;
const clone = (): ComplaintFixture => JSON.parse(JSON.stringify(FX)) as ComplaintFixture;
interface Edit {
  hole?: string;
  /** chips behind for hero and for the caller at the node */
  stacks?: { hero?: number; caller?: number };
}
function nodeAt(ord: number, edit: Edit = {}): Node {
  const f = clone();
  if (edit.hole) f.hole[String(HERO)] = cards(edit.hole);
  const node = f.actions.find((a) => a.ord === ord)!;
  for (const [seat, v] of [
    [HERO, edit.stacks?.hero],
    [CALLER, edit.stacks?.caller],
  ] as const)
    if (v !== undefined) node.publicNode!.seats.find((s) => s[0] === seat)![1] = v;
  return stateAt(f, node);
}
/** Hero checked the river and the caller bet `x` (not all in) with `heroStack` behind hero. */
function riverFacingBet(x: number, heroStack: number, hole?: string): Node {
  const f = clone();
  if (hole) f.hole[String(HERO)] = cards(hole);
  const node = f.actions.find((a) => a.ord === RIVER_CHECK)!;
  const pn = JSON.parse(JSON.stringify(node.publicNode!)) as NonNullable<
    ComplaintAction['publicNode']
  >;
  f.actions = f.actions.filter((a) => a.ord <= RIVER_CHECK);
  f.actions.push({
    ord: RIVER_CHECK + 1,
    seat: CALLER,
    stage: 'river',
    action: 'bet',
    amount: x,
    origin: 'player',
    isFullRaise: true,
  });
  const opp = pn.seats.find((s) => s[0] === CALLER)!;
  opp[1] = 3000;
  opp[2] = x;
  opp[3] += x;
  pn.seats.find((s) => s[0] === HERO)![1] = heroStack;
  const pot = pn.pot;
  pn.pot = pot + x;
  pn.toCall = x;
  pn.currentBet = x;
  pn.minRaiseTo = 2 * x;
  pn.maxRaiseTo = pot + 3 * x;
  pn.legalActions = ['fold', 'call', 'raise', 'all_in'];
  const next: ComplaintAction = {
    ord: RIVER_CHECK + 2,
    seat: HERO,
    stage: 'river',
    action: 'fold',
    amount: 0,
    origin: 'horse_policy',
    publicNode: pn,
  };
  f.actions.push(next);
  return stateAt(f, next);
}

const decisionBytes = (d: unknown): string =>
  JSON.stringify(d, (k, v) => (k === 'latencyMs' || k === 'elapsedMs' ? undefined : v));
interface Outcome {
  bytes: string[];
  actions: string[];
  fires: string[][];
  next: number[];
  ms: number;
}
function play(build: () => Node, opts: HorseDecideOpts): Outcome {
  enableBrainTelemetry();
  const out: Outcome = { bytes: [], actions: [], fires: [], next: [], ms: 0 };
  for (const s of SEEDS) {
    HorseMind.reset();
    drainFires();
    seedFastRandom(s);
    const st = build();
    const t0 = performance.now();
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      ...opts,
    } as never);
    out.ms += performance.now() - t0;
    out.next.push(fastRandom());
    out.bytes.push(decisionBytes(d));
    out.actions.push(d.action);
    out.fires.push(drainFires().map((f) => f.feature));
  }
  out.ms /= SEEDS.length;
  return out;
}
const hasFire = (o: Outcome, f: string) => o.fires.filter((x) => x.includes(f)).length;
const only = (o: Outcome) => [...new Set(o.actions)].sort();
const priceInput = (st: Node) => ({
  gameVariant: st.gs.gameVariant,
  board: st.gs.communityCards ?? [],
  hero: st.hero,
  players: st.gs.players,
  currentBet: st.gs.currentBet,
  toCall: st.gs.toCall,
  pot: st.gs.pot,
});

describe('omahaPairedBoardFoldRespectsPrice', () => {
  it('the recorded river: the price is 0.213 with 57% of the stack in, and today the paired-board fold folds the straight', () => {
    const st = nodeAt(RIVER_FOLD);
    expect(ploPairedBoardCallPrice(priceInput(st))).toBeCloseTo(0.2128, 3);
    expect(
      (st.hero.totalInvested ?? 0) / ((st.hero.totalInvested ?? 0) + st.hero.stack)
    ).toBeCloseTo(0.572, 2);
    const off = play(() => nodeAt(RIVER_FOLD), {});
    expect(only(off)).toEqual(['fold']);
    expect(hasFire(off, 'plo_paired_board_fold')).toBe(SEEDS.length);
  });

  it('off: unset, false and a truthy non-boolean decide byte-identically', () => {
    const unset = play(() => nodeAt(RIVER_FOLD), {});
    for (const v of [false, 1 as unknown as boolean, 'true' as unknown as boolean])
      expect(
        play(() => nodeAt(RIVER_FOLD), { omahaPairedBoardFoldRespectsPrice: v }).bytes
      ).toEqual(unset.bytes);
  });

  it('on: the recorded river is no longer forced to fold; the reference decision, a call for the stack, stands', () => {
    const off = play(() => nodeAt(RIVER_FOLD), {});
    const on = play(() => nodeAt(RIVER_FOLD), PRICE_ON);
    expect(on.actions.filter((a) => a === 'fold')).toEqual([]);
    expect(hasFire(on, 'omaha_paired_board_fold_price_respected')).toBe(SEEDS.length);
    expect(hasFire(on, 'plo_paired_board_fold')).toBe(0);
    // what stands is what the brain decides with the fold switched off
    expect(on.actions).toEqual(
      play(() => nodeAt(RIVER_FOLD), { ploPairedBoardFold: false }).actions
    );
    expect(on.next).toEqual(off.next);
    // the mind off changes nothing about the exception
    expect(
      play(() => nodeAt(RIVER_FOLD), { ...PRICE_ON, mind: false }).actions.filter(
        (a) => a === 'fold'
      )
    ).toEqual([]);
  });

  it('on: the call it leaves is admitted by the worker receipt validator', () => {
    for (const s of SEEDS) {
      HorseMind.reset();
      seedFastRandom(s);
      const st = nodeAt(RIVER_FOLD);
      const d = structuredClone(HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, PRICE_ON));
      expect(d.action).not.toBe('fold');
      expect(
        horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
          player: st.hero,
          gameState: st.gs,
        })
      ).toBeNull();
    }
  });

  it('on: a straight facing a river bet of 70% of the pot or more at a price above 0.25 still folds', () => {
    for (const [x, heroStack] of [
      [1000, 1500], // 0.71 pot, price 0.293, not all in
      [1415, 2000], // the pot, price 0.333
      [1000, 900], // a call for the stack at 0.28
    ] as const) {
      const build = () => riverFacingBet(x, heroStack);
      const st = build();
      expect(ploPairedBoardCallPrice(priceInput(st))!).toBeGreaterThan(0.25);
      expect(ploPairedBoardFoldRespectsPrice(priceInput(st))).toBe(false);
      const off = play(build, {});
      expect(only(off)).toEqual(['fold']);
      expect(play(build, PRICE_ON).bytes).toEqual(off.bytes);
    }
  });

  it('on: two pair and trips at the recorded price still fold (57% in is under the 60% clause)', () => {
    for (const hole of ['AsKh5c9sQs', '4sKh9cJsQs']) {
      const build = () => nodeAt(RIVER_FOLD, { hole });
      const st = build();
      expect(ploPairedBoardCallPrice(priceInput(st))).toBeCloseTo(0.2128, 3);
      expect(ploPairedBoardFoldRespectsPrice(priceInput(st))).toBe(false);
      const off = play(build, {});
      expect(only(off)).toEqual(['fold']);
      expect(play(build, PRICE_ON).bytes).toEqual(off.bytes);
    }
  });

  it('the 60% clause: two pair calling the rest of a stack 62% in at 0.186 is left to the reference decision; PLO6 and a price over 0.25 are not', () => {
    const st = nodeAt(RIVER_FOLD, { hole: 'AsKh5c9sQs', stacks: { hero: 420 } });
    const input = priceInput(st);
    expect(ploPairedBoardCallPrice(input)).toBeCloseTo(420 / (1415 + 840), 3);
    expect(
      ploPairedBoardMustFold({ ...input, hiLo: false, multiBoard: false, hero: st.hero })
    ).toBe(true);
    expect(ploPairedBoardFoldRespectsPrice(input)).toBe(true);
    expect(ploPairedBoardFoldRespectsPrice({ ...input, gameVariant: 'plo6' })).toBe(false);
    const dear = nodeAt(RIVER_FOLD, { hole: 'AsKh5c9sQs', stacks: { hero: 1000 } });
    expect(ploPairedBoardFoldRespectsPrice(priceInput(dear))).toBe(false);
  });

  it('a tournament keeps the fold', () => {
    const build = () => {
      const st = nodeAt(RIVER_FOLD);
      (st.gs as { gameMode?: string }).gameMode = 'tournament';
      return st;
    };
    expect(hasFire(play(build, PRICE_ON), 'omaha_paired_board_fold_price_respected')).toBe(0);
  });
});

describe('omahaTurnBetNeedsRiverPlan', () => {
  const turn = () => nodeAt(TURN);

  it('the recorded turn bet of 373 leaves 524 behind a pot of 1,415: under half', () => {
    const st = turn();
    const geo = omahaTurnBetShortBehind(st.hero, st.gs, 373)!;
    expect(geo.behind).toBeCloseTo(524.02, 2);
    expect(geo.potAfter).toBeCloseTo(1415, 2);
    expect(omahaTurnBetShortBehind(st.hero, st.gs, 60)).toBeNull();
  });

  it('off: unset, false and a truthy non-boolean decide byte-identically', () => {
    const unset = play(turn, {});
    expect(only(unset)).toEqual(['bet']);
    for (const v of [false, 1 as unknown as boolean, 'true' as unknown as boolean])
      expect(play(turn, { omahaTurnBetNeedsRiverPlan: v }).bytes).toEqual(unset.bytes);
  });

  it('on, alone: a turn bet that leaves under half the pot behind is a check, with no opponent read, drawing no random number', () => {
    const off = play(turn, {});
    for (const extra of [{}, { mind: false }]) {
      const base = play(turn, extra);
      const on = play(turn, { ...PLAN_ON, ...extra });
      const st = turn();
      let checked = 0;
      base.bytes.forEach((b, i) => {
        // the smaller bets the brain makes with the mind off can leave half the pot behind
        const short = omahaTurnBetShortBehind(st.hero, st.gs, JSON.parse(b).amount) !== null;
        if (short) {
          checked++;
          expect(on.actions[i]).toBe('check');
        } else expect(on.bytes[i]).toEqual(b);
      });
      expect(checked).toBeGreaterThan(0);
      expect(hasFire(on, 'omaha_turn_bet_without_river_plan_checked')).toBe(checked);
      expect(on.next).toEqual(base.next);
    }
    // the mind on (the live sizes, 356 to 396): every seed
    expect(only(play(turn, PLAN_ON))).toEqual(['check']);
    const on = play(turn, PLAN_ON);
    // the added decision time, for the record (not a law)
    console.log(
      `omahaTurnBetNeedsRiverPlan decision ms: off ${off.ms.toFixed(2)}, on ${on.ms.toFixed(2)}`
    );
  });

  it('a full house still bets, and deep stacks are unchanged', () => {
    for (const edit of [
      { hole: '5c5hAs3hQs' }, // fives full of fours
      { stacks: { hero: 5000, caller: 5000 } },
    ]) {
      const build = () => nodeAt(TURN, edit);
      const off = play(build, {});
      expect(off.actions.filter((a) => a === 'bet').length).toBeGreaterThan(0);
      const on = play(build, PLAN_ON);
      expect(on.bytes).toEqual(off.bytes);
      expect(hasFire(on, 'omaha_turn_bet_without_river_plan_checked')).toBe(0);
    }
  });

  it('with the price exception on as well, the same bet has a river plan and stands', () => {
    const off = play(turn, {});
    const both = play(turn, { ...PLAN_ON, ...PRICE_ON });
    expect(both.bytes).toEqual(off.bytes);
  });

  it('the check is admitted by the worker receipt validator', () => {
    for (const s of SEEDS) {
      HorseMind.reset();
      seedFastRandom(s);
      const st = turn();
      const d = structuredClone(HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, PLAN_ON));
      expect(d.action).toBe('check');
      expect(
        horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
          player: st.hero,
          gameState: st.gs,
        })
      ).toBeNull();
    }
  });

  it('facing a bet nothing changes', () => {
    const build = () => nodeAt(RIVER_FOLD);
    expect(play(build, PLAN_ON).bytes).toEqual(play(build, {}).bytes);
  });
});
