/**
 * OMAHA: NO BARREL INTO THE TURN CARD THAT PAIRED THE BOARD WITHOUT A FULL
 * HOUSE (lane owner 2026-11-15, hand 59521326; option
 * omahaPairedTurnNoBarrelWithoutBoatVsValueLeader, default OFF).
 *
 * The recorded hand, anonymised to seat numbers: a Horse out of position
 * check-raises the 2-4-5 flop with the nut straight, is called, bets the turn
 * card that pairs the board (373 into 669, leaving 524 behind a pot of
 * 1,415), is called, checks the river and folds the straight to the all-in.
 *
 *  - unset, false and a truthy non-boolean decide byte-identically;
 *  - on, against a measured value leader the recorded turn bet is a check at
 *    every seed for every profile, with its receipt, drawing nothing from the
 *    brain's random stream, admitted by the worker receipt validator;
 *  - an unknown, presumed or measured non-leader opponent, and the mind off:
 *    today's decision (withheld receipt);
 *  - a full house, the Horse in position, a turn card that does not pair the
 *    board: today's decision;
 *  - facing a turn bet after the check nothing changes; what today's brain
 *    does there is pinned: all in over a third of the pot, and the
 *    2026-10-25 paired-board fold folds the straight to half the pot or more.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import type { OmahaReadConditional } from './HorseOmahaReadConditional.js';
import { omahaPairedTurnBarrelSpot } from './HorseOmahaOopChecks.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import {
  recordedPathMatches,
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ComplaintFixture,
  type ReplayProfile,
} from './HorseComplaintReplay.js';
import type { Card, CardRank, CardSuit } from '../types.js';
import FIXTURE from './horseComplaints/plo5-straight-barrels-the-board-pairing-turn-then-folds-the-river.fixture.json';

const FX = FIXTURE as unknown as ComplaintFixture;
const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));

const TURN = 16;
const HERO = 5;
const CALLER = 1;
const PROFILES = replayProfiles('cash');
const LIVE = PROFILES.find((p) => p.live)!;
const SEEDS = [...FX.seeds, 101, 102, 103, 104, 105, 106];
const ON: HorseDecideOpts = { omahaPairedTurnNoBarrelWithoutBoatVsValueLeader: true };

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

type Node = ReturnType<typeof stateAt>;
const clone = (): ComplaintFixture => JSON.parse(JSON.stringify(FX)) as ComplaintFixture;

/** The recorded turn node, optionally edited. */
function turnNode(edit: { hole?: string; board?: string; inPosition?: boolean } = {}): Node {
  const f = clone();
  if (edit.hole) f.hole[String(HERO)] = cards(edit.hole);
  const node = f.actions.find((a) => a.ord === TURN)!;
  if (edit.board) node.publicNode!.boards = [edit.board];
  if (edit.inPosition) {
    // The button moves so the caller acts first: he bets the flop, hero raises
    // and is called, and he checks the turn to hero.
    node.publicNode!.dealerSeat = 6;
    const before = f.actions.filter(
      (a) => a.ord < TURN && !(a.seat === HERO && a.stage === 'flop' && a.action === 'check')
    );
    before.push({
      ord: 0,
      seat: CALLER,
      stage: 'turn',
      action: 'check',
      amount: 0,
      origin: 'player',
    });
    before.forEach((a, i) => (a.ord = i + 1));
    node.ord = before.length + 1;
    f.actions = [...before, node];
  }
  return stateAt(f, node);
}

/** Hero checked the recorded turn and the caller bet `x`. */
function facingTurnBet(x: number): Node {
  const f = clone();
  const node = f.actions.find((a) => a.ord === TURN)!;
  const pn = JSON.parse(JSON.stringify(node.publicNode!)) as NonNullable<
    ComplaintAction['publicNode']
  >;
  f.actions = f.actions.filter((a) => a.ord < TURN);
  f.actions.push({
    ord: TURN,
    seat: HERO,
    stage: 'turn',
    action: 'check',
    amount: 0,
    origin: 'horse_policy',
  });
  f.actions.push({
    ord: TURN + 1,
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
    ord: TURN + 2,
    seat: HERO,
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
type Reads = (userId: string) => OmahaReadConditional | null;
function play(
  build: () => Node,
  opts: HorseDecideOpts,
  reads?: Reads,
  profile: ReplayProfile = LIVE
): Outcome {
  enableBrainTelemetry();
  const out: Outcome = { bytes: [], actions: [], fires: [], next: [] };
  for (const s of SEEDS) {
    HorseMind.reset();
    if (reads) vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation(reads as never);
    drainFires();
    seedFastRandom(s);
    const st = build();
    const d = HorseLogic.decide(st.hero, st.gs, profile.style, profile.mods, {
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
const leader = { measured: true, tightReRaiser: false, valueLeader: true } as OmahaReadConditional;
const notLeader = { ...leader, valueLeader: false } as OmahaReadConditional;
const presumed = { ...notLeader, measured: false } as OmahaReadConditional;
const WAGERS = ['bet', 'raise', 'all_in'];
const wagers = (o: Outcome) => o.actions.filter((a) => WAGERS.includes(a)).length;
const hasFire = (o: Outcome, f: string) => o.fires.filter((x) => x.includes(f)).length;

describe('hand 59521326, the recorded hand', () => {
  it('the fixture is the recorded hand: it bet the paired turn and folded the river', () => {
    expect(FX.handId).toBe('da517455-224c-4918-8774-ddfee4e82512');
    expect(recordedPathMatches(FX)).toBe(true);
    expect(JSON.stringify(FX)).not.toMatch(/userId|username/);
    const st = turnNode();
    expect(omahaPairedTurnBarrelSpot(st.hero, st.gs)).toBe(true);
    expect(wagers(play(turnNode, {}, () => null))).toBeGreaterThan(0);
  });
});

describe('omahaPairedTurnNoBarrelWithoutBoatVsValueLeader', () => {
  it('off: unset, false and a truthy non-boolean decide byte-identically', () => {
    const unset = play(turnNode, {}, () => leader);
    for (const v of [false, 1 as unknown as boolean, 'true' as unknown as boolean]) {
      const off = play(
        turnNode,
        { omahaPairedTurnNoBarrelWithoutBoatVsValueLeader: v },
        () => leader
      );
      expect(off.bytes).toEqual(unset.bytes);
      expect(off.next).toEqual(unset.next);
    }
  });

  it('on, against a measured value leader: the recorded turn bet is a check at every seed, for every profile', () => {
    for (const p of PROFILES) {
      const off = play(turnNode, {}, () => leader, p);
      const on = play(turnNode, ON, () => leader, p);
      expect(wagers(on)).toBe(0);
      expect(hasFire(on, 'omaha_paired_turn_barrel_checked')).toBe(wagers(off));
      on.actions.forEach((a, i) => {
        if (WAGERS.includes(off.actions[i])) expect(a).toBe('check');
        else expect(on.bytes[i]).toEqual(off.bytes[i]);
      });
      expect(on.next).toEqual(off.next);
    }
  });

  it('on, against an unknown, presumed or measured non-leader opponent: today’s decision, withheld', () => {
    const off = play(turnNode, {});
    for (const reads of [() => null, () => presumed, () => notLeader]) {
      const on = play(turnNode, ON, reads as Reads);
      expect(on.bytes).toEqual(off.bytes);
      expect(on.next).toEqual(off.next);
      expect(hasFire(on, 'omaha_paired_turn_barrel_withheld')).toBe(wagers(off));
    }
    expect(play(turnNode, { ...ON, mind: false }, () => leader).bytes).toEqual(
      play(turnNode, { mind: false }).bytes
    );
  });

  it('a full house, the Horse in position and a turn card that does not pair the board: today’s decision', () => {
    const cases: Array<[() => Node, boolean]> = [
      [() => turnNode({ hole: '5c5hAs3hQs' }), true], // fives full of fours
      [() => turnNode({ inPosition: true }), true],
      [() => turnNode({ board: '2d4h5s9d' }), true],
    ];
    for (const [build, wantsBet] of cases) {
      const st = build();
      expect(omahaPairedTurnBarrelSpot(st.hero, st.gs)).toBe(false);
      const off = play(build, {}, () => leader);
      expect(play(build, ON, () => leader).bytes).toEqual(off.bytes);
      if (wantsBet) expect(wagers(off)).toBeGreaterThan(0);
    }
  });

  it('a flush, trips and two pair on the paired turn are the spot; a flop bet that was not called is not', () => {
    const flush = turnNode({ board: '2d7dKd7s', hole: 'AdQd9s8h3c' });
    expect(omahaPairedTurnBarrelSpot(flush.hero, flush.gs)).toBe(true);
    const trips = turnNode({ hole: '4sKhAs9hQs' });
    expect(omahaPairedTurnBarrelSpot(trips.hero, trips.gs)).toBe(true);
    const st = turnNode();
    const noFlop = {
      ...st.gs,
      actionHistory: (st.gs.actionHistory ?? []).filter((a) => a.stage !== 'flop'),
    };
    expect(omahaPairedTurnBarrelSpot(st.hero, noFlop as never)).toBe(false);
    for (const over of [
      { gameVariant: 'plo6' },
      { gameMode: 'tournament' },
      { variantRules: { splitLow8OrBetter: true } },
      { toCall: 40, currentBet: 40 },
    ])
      expect(omahaPairedTurnBarrelSpot(st.hero, { ...st.gs, ...over } as never)).toBe(false);
  });

  it('the check is admitted by the worker receipt validator', () => {
    let changed = 0;
    for (const s of SEEDS) {
      HorseMind.reset();
      vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation((() => leader) as never);
      seedFastRandom(s);
      const st = turnNode();
      const d = structuredClone(HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, ON));
      vi.restoreAllMocks();
      expect(d.action).toBe('check');
      if (d.policyGraph?.transitions.some((t) => t.node === 'wager_rules' && t.changed)) changed++;
      expect(
        horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
          player: st.hero,
          gameState: st.gs,
        })
      ).toBeNull();
    }
    expect(changed).toBeGreaterThan(0);
  });
});

describe('facing a turn bet after the check', () => {
  const PRICES = [0.33, 0.5, 0.75, 1];
  it('the option changes nothing facing a bet', () => {
    for (const frac of PRICES) {
      const build = () => facingTurnBet(Math.round(669 * frac));
      expect(play(build, ON, () => leader).bytes).toEqual(play(build, {}, () => leader).bytes);
    }
  });

  it('pinned, today’s brain: it moves all in over a bet of a third of the pot, and the paired-board fold folds the straight to half the pot or more', () => {
    for (const reads of [() => null, () => leader]) {
      const small = play(() => facingTurnBet(Math.round(669 * 0.33)), ON, reads as Reads);
      expect(new Set(small.actions)).toEqual(new Set(['all_in']));
      for (const frac of [0.5, 0.75, 1]) {
        const big = play(() => facingTurnBet(Math.round(669 * frac)), ON, reads as Reads);
        expect(new Set(big.actions)).toEqual(new Set(['fold']));
        expect(hasFire(big, 'plo_paired_board_fold')).toBe(SEEDS.length);
      }
    }
  });
});
