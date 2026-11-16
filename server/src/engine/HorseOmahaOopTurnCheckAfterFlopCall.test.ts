/**
 * OMAHA: OUT OF POSITION ON THE TURN AFTER THE FLOP BET WAS CALLED, CHECK
 * (owner 2026-11-15 12:09, hands 59517323, 59521326 and 59526261; option
 * omahaOopTurnCheckAfterFlopCall, default OFF, no opponent read).
 *
 * "THIS SHOULD BE A CHECK CALL 100% OF THE TIME ... CHECK CALL WHEN DRAWING
 * TO THE NUTS, CHECK FOLD WHEN YOU CAN'T IMPROVE".
 *
 *  - the check: heads-up, out of position, the flop bet or raise called, no
 *    nut-class hand: the turn bet is a check at every seed; the nuts still
 *    bet; in position and multiway are unchanged;
 *  - facing the turn bet after the check (also after calling a flop raise):
 *    never a raise; a call with four or more nut outs at a price within
 *    their share plus 0.15; a fold with no nut out and one pair at 0.15 or
 *    more; otherwise today's call or fold;
 *  - unset, false and a truthy non-boolean decide byte-identically; the
 *    check, the call and the fold are admitted by the receipt validator.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import type { OmahaReadConditional } from './HorseOmahaReadConditional.js';
import {
  omahaGradedTurnOuts,
  omahaOopTurnCheckAfterFlopCallSpot,
  omahaOopTurnFacingBetVerdict,
} from './HorseOmahaOopChecks.js';
import { omahaNutClassNow } from './HorseOmahaMadeHandDefense.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import {
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ComplaintFixture,
} from './HorseComplaintReplay.js';
import type { Card, CardRank, CardSuit } from '../types.js';
import ACES from './horseComplaints/plo5-aces-up-leads-the-board-pairing-river-into-a-two-street-caller.fixture.json';
import STRAIGHT from './horseComplaints/plo5-straight-barrels-the-board-pairing-turn-then-folds-the-river.fixture.json';
import TOP_SET from './horseComplaints/plo5-top-set-check-raises-pot-on-the-four-straight-turn.fixture.json';

const FX_ACES = ACES as unknown as ComplaintFixture; // 59517323, hero seat 5, turn node 16
const FX_STRAIGHT = STRAIGHT as unknown as ComplaintFixture; // 59521326, hero seat 5, turn node 16
const FX_SET = TOP_SET as unknown as ComplaintFixture; // 59526261, hero seat 6, turn nodes 18 and 20
const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));

const TURN = 16;
const CALLER = 1;
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [1, 7, 42, 99, 2026, 3, 11, 17, 23, 31, 101, 102, 103, 104, 105, 106];
const ON: HorseDecideOpts = { omahaOopTurnCheckAfterFlopCall: true };

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

type Node = ReturnType<typeof stateAt>;
interface Edit {
  hole?: string;
  inPosition?: boolean;
  /** a third player still in the hand */
  thirdLive?: number;
}
const heroSeat = (fx: ComplaintFixture) => Number(Object.keys(fx.hole)[0]);
function nodeAt(fx: ComplaintFixture, ord: number, edit: Edit = {}): Node {
  const f = JSON.parse(JSON.stringify(fx)) as ComplaintFixture;
  if (edit.hole) f.hole[String(heroSeat(fx))] = cards(edit.hole);
  const node = f.actions.find((a) => a.ord === ord)!;
  if (edit.thirdLive) node.publicNode!.seats.find((s) => s[0] === edit.thirdLive)![6] = 0;
  if (edit.inPosition) {
    node.publicNode!.dealerSeat = 6;
    const out: ComplaintAction[] = [];
    let n = 0;
    const push = (a: Partial<ComplaintAction>) => out.push({ ...a, ord: ++n } as ComplaintAction);
    const check = (stage: string) =>
      push({ seat: CALLER, stage, action: 'check', amount: 0, origin: 'player' });
    let street = 'preflop';
    for (const a of f.actions.filter((x) => x.ord < ord)) {
      if (a.stage !== street) {
        street = a.stage;
        check(street);
      }
      push(a);
    }
    if (node.stage !== street) check(node.stage);
    node.ord = n + 1;
    f.actions = [...out, node];
  }
  return stateAt(f, node);
}
/** Hero checked the turn node `ord` of `fx` and the caller bet `x`. */
function facingTurnBet(fx: ComplaintFixture, ord: number, x: number, hole?: string): Node {
  const f = JSON.parse(JSON.stringify(fx)) as ComplaintFixture;
  const hero = heroSeat(fx);
  if (hole) f.hole[String(hero)] = cards(hole);
  const node = f.actions.find((a) => a.ord === ord)!;
  const pn = JSON.parse(JSON.stringify(node.publicNode!)) as NonNullable<
    ComplaintAction['publicNode']
  >;
  f.actions = f.actions.filter((a) => a.ord < ord);
  f.actions.push({
    ord,
    seat: hero,
    stage: 'turn',
    action: 'check',
    amount: 0,
    origin: 'horse_policy',
  });
  f.actions.push({
    ord: ord + 1,
    seat: CALLER,
    stage: 'turn',
    action: 'bet',
    amount: x,
    origin: 'player',
    isFullRaise: true,
  });
  const row = pn.seats.find((s) => s[0] === CALLER)!;
  row[1] = Math.round((row[1] - x) * 100) / 100;
  row[2] = x;
  row[3] += x;
  const pot = pn.pot;
  pn.pot = pot + x;
  pn.toCall = x;
  pn.currentBet = x;
  pn.minRaiseTo = 2 * x;
  pn.maxRaiseTo = pot + 3 * x;
  pn.legalActions = ['fold', 'call', 'raise', 'all_in'];
  const next: ComplaintAction = {
    ord: ord + 2,
    seat: hero,
    stage: 'turn',
    action: 'call',
    amount: x,
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
}
function play(
  build: () => Node,
  opts: HorseDecideOpts,
  reads?: (id: string) => OmahaReadConditional | null
): Outcome {
  enableBrainTelemetry();
  const out: Outcome = { bytes: [], actions: [], fires: [], next: [] };
  for (const s of SEEDS) {
    HorseMind.reset();
    if (reads) vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation(reads as never);
    drainFires();
    seedFastRandom(s);
    const st = build();
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      ...opts,
    } as never);
    out.next.push(fastRandom());
    out.bytes.push(decisionBytes(d));
    out.actions.push(d.action);
    out.fires.push(drainFires().map((f) => f.feature));
    vi.restoreAllMocks();
  }
  return out;
}
const WAGERS = ['bet', 'raise', 'all_in'];
const wagers = (o: Outcome) => o.actions.filter((a) => WAGERS.includes(a)).length;
const hasFire = (o: Outcome, f: string) => o.fires.filter((x) => x.includes(f)).length;
const only = (o: Outcome) => [...new Set(o.actions)].sort();
const BEATEN_BOATS = '9s5sKcJc3c'; // two pair, nines and fives, on 5d 8d 9h 2h
const NO_OUTS = 'AsAdQs7c4c'; // aces, no flush draw, no nut straight out, on 5d 8d 9h 2h
const NUTS = 'As6s7cQs4h'; // 6-7: the nut straight on 5d 8d 9h 2h

describe('the check', () => {
  it('hands 59517323 and 59521326: the turn bet is a check at every seed, with no read and the mind off', () => {
    for (const fx of [FX_ACES, FX_STRAIGHT]) {
      const build = () => nodeAt(fx, TURN);
      const st = build();
      expect(omahaOopTurnCheckAfterFlopCallSpot(st.hero, st.gs)).toBe(true);
      for (const extra of [{}, { mind: false }]) {
        const off = play(build, extra);
        const on = play(build, { ...ON, ...extra });
        expect(wagers(off)).toBeGreaterThan(0);
        expect(only(on)).toEqual(['check']);
        expect(hasFire(on, 'omaha_oop_turn_check_after_flop_call')).toBe(wagers(off));
        expect(on.next).toEqual(off.next);
      }
    }
  });

  it('off: unset, false and a truthy non-boolean decide byte-identically', () => {
    for (const build of [
      () => nodeAt(FX_ACES, TURN),
      () => facingTurnBet(FX_ACES, TURN, 278),
      () => nodeAt(FX_SET, 20),
    ]) {
      const unset = play(build, {});
      for (const v of [false, 1 as unknown as boolean, 'true' as unknown as boolean])
        expect(play(build, { omahaOopTurnCheckAfterFlopCall: v }).bytes).toEqual(unset.bytes);
    }
  });

  it('the nuts on the turn still bet as today; in position and multiway are unchanged', () => {
    const nuts = () => nodeAt(FX_ACES, TURN, { hole: NUTS });
    expect(omahaNutClassNow(nuts().hero, nuts().gs)).toBe(true);
    expect(omahaOopTurnCheckAfterFlopCallSpot(nuts().hero, nuts().gs)).toBe(false);
    const offNuts = play(nuts, {});
    expect(wagers(offNuts)).toBeGreaterThan(0);
    expect(play(nuts, ON).bytes).toEqual(offNuts.bytes);
    for (const edit of [{ inPosition: true }, { thirdLive: 6 }]) {
      const build = () => nodeAt(FX_ACES, TURN, edit);
      expect(omahaOopTurnCheckAfterFlopCallSpot(build().hero, build().gs)).toBe(false);
      expect(play(build, ON).bytes).toEqual(play(build, {}).bytes);
    }
  });

  it('it runs before the two narrower turn options', () => {
    const leader = {
      measured: true,
      tightReRaiser: false,
      valueLeader: true,
    } as OmahaReadConditional;
    const all = play(
      () => nodeAt(FX_STRAIGHT, TURN),
      {
        ...ON,
        omahaOverpairNoOopBarrelVsValueLeader: true,
        omahaPairedTurnNoBarrelWithoutBoatVsValueLeader: true,
      },
      () => leader
    );
    expect(only(all)).toEqual(['check']);
    expect(hasFire(all, 'omaha_oop_turn_check_after_flop_call')).toBe(SEEDS.length);
    expect(hasFire(all, 'omaha_paired_turn_barrel_checked')).toBe(0);
  });
});

describe('facing the turn bet after the check', () => {
  it('59517323, the overpair with the nut flush draw: seven nut outs, it calls a bet of a third to two thirds of the pot and never raises', () => {
    for (const frac of [0.33, 0.5, 0.667]) {
      const build = () => facingTurnBet(FX_ACES, TURN, Math.round(555 * frac));
      expect(omahaOopTurnFacingBetVerdict(build().hero, build().gs)).toBe('call_nut_draw');
      const off = play(build, {});
      const on = play(build, ON);
      expect(only(on)).toEqual(['call']);
      expect(hasFire(on, 'omaha_oop_turn_check_call_nut_draw')).toBe(
        off.actions.filter((a) => a !== 'call').length
      );
    }
    // a pot-sized bet is past the price the outs and the credit meet: today's call or fold, never a raise
    const pot = () => facingTurnBet(FX_ACES, TURN, 555);
    expect(omahaOopTurnFacingBetVerdict(pot().hero, pot().gs)).toBe('no_raise');
    expect(wagers(play(pot, ON))).toBe(0);
  });

  it('one pair with no nut out: check, then fold to a bet of two thirds of the pot; a token bet is left to today’s decision', () => {
    const turn = () => nodeAt(FX_ACES, TURN, { hole: NO_OUTS });
    expect(wagers(play(turn, ON))).toBe(0);
    const build = () => facingTurnBet(FX_ACES, TURN, 370, NO_OUTS);
    expect(omahaOopTurnFacingBetVerdict(build().hero, build().gs)).toBe('fold_no_outs');
    const off = play(build, {});
    const on = play(build, ON);
    expect(only(on)).toEqual(['fold']);
    expect(hasFire(on, 'omaha_oop_turn_check_fold_no_outs')).toBe(
      off.actions.filter((a) => a !== 'fold').length
    );
    const token = () => facingTurnBet(FX_ACES, TURN, 60, NO_OUTS);
    expect(omahaOopTurnFacingBetVerdict(token().hero, token().gs)).toBe('no_raise');
  });

  it('graded nut outs (PLO4/PLO5): a two-pair hand whose four full-house outs a bigger full house beats does not reach the 4-out call; a nut full house counts whole', () => {
    const board = cards('5d8d9h2h');
    // nines and fives: four river cards fill it, every one beaten by a bigger full house
    expect(omahaGradedTurnOuts(cards(BEATEN_BOATS), board)).toBeCloseTo(2.8, 6);
    // a set of nines: ten river cards, every full house or quads the nuts or beaten by none
    expect(omahaGradedTurnOuts(cards('9s9cKcJs3c'), board)).toBe(10);
    // the aces' seven nut outs (flush and straight) count whole
    expect(omahaGradedTurnOuts(cards('AsAhQs7c4h'), board)).toBe(7);
    const build = () => facingTurnBet(FX_ACES, TURN, 185, BEATEN_BOATS);
    // the whole-card count is four (the threshold); the graded sum is 2.8
    expect(omahaOopTurnFacingBetVerdict(build().hero, build().gs)).toBe('no_raise');
    const off = play(build, {});
    const on = play(build, ON);
    expect(wagers(on)).toBe(0);
    on.actions.forEach((a, i) => {
      // no forced call: today's call or fold stands, a raise becomes a call
      if (off.actions[i] === 'fold' || off.actions[i] === 'call') expect(a).toBe(off.actions[i]);
      else expect(a).toBe('call');
    });
    expect(hasFire(on, 'omaha_oop_turn_check_call_nut_draw')).toBe(0);
  });

  it('59526261, top set after calling the flop raise: the turn is a check, then a CALL of the 162 bet, never the raise', () => {
    const check = () => nodeAt(FX_SET, 18);
    expect(play(check, ON).bytes).toEqual(play(check, {}).bytes);
    expect(only(play(check, ON))).toEqual(['check']);
    const build = () => nodeAt(FX_SET, 20);
    // ten river cards make a full house or quads; 162 to win 540 is a price of 0.30
    expect(omahaOopTurnFacingBetVerdict(build().hero, build().gs)).toBe('call_nut_draw');
    const off = play(build, {});
    expect(wagers(off)).toBeGreaterThan(8);
    const on = play(build, ON);
    expect(only(on)).toEqual(['call']);
    expect(hasFire(on, 'omaha_oop_turn_check_call_nut_draw')).toBe(wagers(off));
    expect(on.next).toEqual(off.next);
  });

  it('59521326, the straight on the paired turn: no nut out but not beaten by a straight or flush: today’s call or fold, the raise becomes a call', () => {
    for (const frac of [0.33, 0.5, 1]) {
      const build = () => facingTurnBet(FX_STRAIGHT, TURN, Math.round(669 * frac));
      expect(omahaOopTurnFacingBetVerdict(build().hero, build().gs)).toBe('no_raise');
      const off = play(build, {});
      const on = play(build, ON);
      expect(wagers(on)).toBe(0);
      on.actions.forEach((a, i) => {
        if (WAGERS.includes(off.actions[i])) expect(a).toBe('call');
        else expect(on.bytes[i]).toEqual(off.bytes[i]);
      });
    }
  });

  it('outside the spot the verdict is null: the nuts, in position, multiway, a turn the Horse bet, PLO6, a tournament', () => {
    const st = facingTurnBet(FX_ACES, TURN, 278);
    expect(omahaOopTurnFacingBetVerdict(st.hero, st.gs)).not.toBeNull();
    const nuts = facingTurnBet(FX_ACES, TURN, 278, NUTS);
    expect(omahaOopTurnFacingBetVerdict(nuts.hero, nuts.gs)).toBeNull();
    for (const over of [
      { gameVariant: 'plo6' },
      { gameMode: 'tournament' },
      { variantRules: { splitLow8OrBetter: true } },
      { players: st.gs.players.map((p) => (p.seat === 6 ? { ...p, is_folded: false } : p)) },
      {
        actionHistory: (st.gs.actionHistory ?? []).map((a) =>
          a.stage === 'turn' && a.seat === st.hero.seat ? { ...a, action: 'bet', amount: 100 } : a
        ),
      },
      { actionHistory: (st.gs.actionHistory ?? []).filter((a) => a.stage !== 'flop') },
    ])
      expect(omahaOopTurnFacingBetVerdict(st.hero, { ...st.gs, ...over } as never)).toBeNull();
    expect(omahaOopTurnFacingBetVerdict({ ...st.hero, bet: 50 }, st.gs)).toBeNull();
  });
});

describe('the worker receipt validator', () => {
  it('admits the check, the call and the fold with the request that produces them', () => {
    const cases: Array<[() => Node, string]> = [
      [() => nodeAt(FX_ACES, TURN), 'check'],
      [() => nodeAt(FX_SET, 20), 'call'],
      [() => facingTurnBet(FX_ACES, TURN, 278), 'call'],
      [() => facingTurnBet(FX_ACES, TURN, 370, NO_OUTS), 'fold'],
    ];
    for (const [build, want] of cases)
      for (const s of SEEDS) {
        HorseMind.reset();
        seedFastRandom(s);
        const st = build();
        const d = structuredClone(HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, ON));
        expect(d.action).toBe(want);
        expect(
          horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
            player: st.hero,
            gameState: st.gs,
          })
        ).toBeNull();
      }
  });

  it('refuses the call the rule would not make: a fold turned into a call without the nut-draw verdict', () => {
    HorseMind.reset();
    seedFastRandom(1);
    const st = nodeAt(FX_SET, 20);
    const d = structuredClone(HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, ON));
    expect(d.action).toBe('call');
    const changed = d.policyGraph?.transitions.find((t) => t.node === 'wager_rules' && t.changed);
    if (!changed) return;
    // the same receipt against a request where the Horse holds no nut out and one pair
    const other = nodeAt(FX_SET, 20, { hole: 'KcKdQc7s6c' });
    expect(omahaOopTurnFacingBetVerdict(other.hero, other.gs)).not.toBe('call_nut_draw');
    if (changed.before?.action === 'fold')
      expect(
        horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
          player: other.hero,
          gameState: other.gs,
        })
      ).toBe('policy_graph');
  });
});
