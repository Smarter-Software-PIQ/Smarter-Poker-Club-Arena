/**
 * OMAHA STREET PLAN, the flop, the turn three-way and the preflop
 * stack-to-pot layers (owner 2026-11-15 11:43; options omahaStreetPlanFlop,
 * omahaStreetPlanThreeWay, omahaPreflopStackPlan, each default OFF).
 *
 * Class-based: each layer is exercised on a class of recorded spots (the
 * recorded hands of the complaint fixtures, anonymised to seat numbers, and
 * the same spots re-dealt with other hole cards), at many seeds. For every
 * member of a class: unset, false and a truthy non-boolean decide
 * byte-identically; switched on, the only change is the layer's own (bet to
 * check or a smaller bet on the flop, bet to check three-way, call to fold
 * preflop), the action is legal, the receipt validator admits it, the
 * engine's random stream is not read, and the receipt names the final action.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import {
  OMAHA_FLOP_PLAN_COMMIT_SPR,
  omahaFlopPlanUncommitted,
  omahaFlopPlanChoice,
  omahaFlopPlanSizes,
  omahaPreflopStackPlan,
  omahaPreflopStackPlanSpot,
  omahaStreetPlanDomain,
  omahaStreetPlanFlop,
  omahaStreetPlanFlopSpot,
  omahaStreetPlanThreeWay,
  omahaStreetPlanThreeWaySpot,
  type OmahaFlopPlan,
  type OmahaFlopPlanLine,
  type OmahaFlopPlanInput,
} from './HorseOmahaStreetPlan.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import { replayProfiles, stateAt, type ComplaintFixture } from './HorseComplaintReplay.js';
import type { Card, CardRank, CardSuit, HorseDecision } from '../types.js';
import STRAIGHT from './horseComplaints/plo5-straight-barrels-the-board-pairing-turn-then-folds-the-river.fixture.json';
import ACES from './horseComplaints/plo5-aces-up-leads-the-board-pairing-river-into-a-two-street-caller.fixture.json';
import SUITED_ACES from './horseComplaints/plo5-suited-aces-flat-vs-3bet.fixture.json';
import MULTIWAY from './horseComplaints/plo5-turn-nut-straight-with-flush-redraw-flats-multiway.fixture.json';
import QUEENS from './HorseOmahaUnderpair.fixture.json';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));
const key = (c: Card) => `${c.rank}${c.suit[0]}`;
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [1, 7, 42, 99, 2026, 3, 11, 17];

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

type Node = ReturnType<typeof stateAt>;
interface Spot {
  name: string;
  fx: ComplaintFixture;
  ord: number;
  /** a re-deal of the actor's hole cards (0: as recorded, when recorded) */
  deal: number;
  /** seats marked folded at the node, and stacks set at the node */
  fold?: number[];
  stacks?: Record<number, number>;
}

/** Every card the hand shows on any board or in any recorded hole. */
function knownCards(fx: ComplaintFixture): Set<string> {
  const out = new Set<string>();
  const f = fx as unknown as {
    hole: Record<string, Card[]>;
    actions: { publicNode?: { boards?: string[] } }[];
  };
  for (const h of Object.values(f.hole ?? {})) for (const c of h) out.add(key(c));
  for (const a of f.actions)
    for (const b of a.publicNode?.boards ?? [])
      for (const c of cards(String(b).replace(/[^2-9TJQKAcdhs]/g, ''))) out.add(key(c));
  return out;
}
/** A deterministic re-deal of `size` cards the hand does not show. */
function redeal(fx: ComplaintFixture, size: number, deal: number): Card[] {
  const used = knownCards(fx);
  const deck: Card[] = [];
  for (const s of 'cdhs') for (const r of '23456789TJQKA') deck.push(...cards(r + s));
  const free = deck.filter((c) => !used.has(key(c)));
  let x = (deal * 2654435761) >>> 0 || 1;
  const rnd = () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [free[i], free[j]] = [free[j], free[i]];
  }
  return free.slice(0, size);
}
function build(spot: Spot): Node {
  const f = JSON.parse(JSON.stringify(spot.fx)) as ComplaintFixture & {
    hole: Record<string, Card[]>;
    variant: string;
  };
  const action = (f.actions as { ord: number; seat: number }[]).find((a) => a.ord === spot.ord)!;
  const size = f.variant === 'plo4' ? 4 : 5;
  if (spot.deal > 0 || !f.hole[String(action.seat)])
    f.hole[String(action.seat)] = redeal(spot.fx, size, spot.deal + 1);
  const st = stateAt(f, f.actions.find((a) => a.ord === spot.ord)!);
  for (const p of st.gs.players) {
    if (spot.fold?.includes(p.seat)) p.is_folded = true;
    if (spot.stacks?.[p.seat] != null) p.stack = spot.stacks[p.seat];
  }
  if (spot.stacks?.[st.hero.seat] != null) st.hero.stack = spot.stacks[st.hero.seat];
  return st;
}
const bytes = (d: unknown): string =>
  // wall-clock measurements are left out, the list the declared-work law leaves out
  // (HorseDeclaredWork.test-support.ts): omahaVariantPolicy.equity.analysisMs is a
  // performance.now() difference and differs between two runs of the same decision
  JSON.stringify(d, (k, v) =>
    typeof v === 'number' &&
    (k === 'latencyMs' ||
      k === 'analysisMs' ||
      k === 'simulationMs' ||
      k === 'policyMs' ||
      k === 'utilityLatencyMs' ||
      k === 'elapsedMs')
      ? undefined
      : v
  );

interface Run {
  d: HorseDecision;
  next: number;
  fires: string[];
  st: Node;
}
function run(spot: Spot, seed: number, opts: HorseDecideOpts): Run {
  enableBrainTelemetry();
  HorseMind.reset();
  drainFires();
  seedFastRandom(seed);
  const st = build(spot);
  const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
    telemetry: true,
    ...opts,
  } as never);
  return { d, next: fastRandom(), fires: drainFires().map((f) => f.feature), st };
}

const hands = (base: Omit<Spot, 'deal'>, n: number): Spot[] =>
  Array.from({ length: n }, (_, deal) => ({ ...base, deal }));

const FLOP_CLASS: Spot[] = [
  ...hands({ name: 'aces 4-bet pot flop', fx: ACES as never, ord: 14 }, 6),
  ...hands({ name: 'suited aces 3-bet pot flop', fx: SUITED_ACES as never, ord: 11 }, 6),
  ...hands({ name: 'limped and 3-bet straight flop', fx: STRAIGHT as never, ord: 12 }, 6),
];
const THREE_WAY_CLASS: Spot[] = [
  ...hands({ name: 'queens three-way turn', fx: QUEENS as never, ord: 17 }, 6),
  ...hands(
    { name: 'multiway turn cut to three, first', fx: MULTIWAY as never, ord: 16, fold: [1, 2, 3] },
    6
  ),
  ...hands(
    { name: 'multiway turn cut to three, second', fx: MULTIWAY as never, ord: 17, fold: [1, 2, 3] },
    6
  ),
];
const PREFLOP_CLASS: Spot[] = [
  ...hands(
    {
      name: 'suited aces calls the 3-bet, short',
      fx: SUITED_ACES as never,
      ord: 9,
      fold: [4],
      stacks: { 3: 90, 5: 90 },
    },
    8
  ),
  ...hands({ name: 'queens calls the 4-bet heads-up', fx: QUEENS as never, ord: 13, fold: [1] }, 8),
  ...hands(
    {
      name: 'the big blind calls the open, short',
      fx: SUITED_ACES as never,
      ord: 6,
      stacks: { 4: 50, 3: 50 },
    },
    8
  ),
  ...hands(
    {
      name: 'the cold caller calls the open, short',
      fx: MULTIWAY as never,
      ord: 5,
      stacks: { 1: 45, 6: 45 },
    },
    8
  ),
];

/** The class contract of one layer: inert unset, only its own change on, legal, admitted, quiet. */
function classContract(
  members: Spot[],
  option: keyof HorseDecideOpts,
  inSpot: (st: Node) => boolean,
  changeAllowed: (off: HorseDecision, on: HorseDecision, st: Node) => boolean,
  receipts: string[]
): { members: number; inSpot: number; changed: number } {
  let changed = 0;
  let spots = 0;
  for (const spot of members) {
    const st0 = build(spot);
    const variant = String(st0.gs.gameVariant).toLowerCase();
    if (inSpot(st0)) spots++;
    for (const seed of SEEDS) {
      const unset = run(spot, seed, {});
      for (const v of [false, 1 as unknown as boolean, 'true' as unknown as boolean]) {
        const same = run(spot, seed, { [option]: v } as HorseDecideOpts);
        expect(bytes(same.d), `${spot.name} #${spot.deal} seed ${seed} ${String(v)}`).toBe(
          bytes(unset.d)
        );
        expect(same.next).toBe(unset.next);
      }
      const on = run(spot, seed, { [option]: true } as HorseDecideOpts);
      const label = `${spot.name} #${spot.deal} seed ${seed}: ${unset.d.action} -> ${on.d.action}`;
      const legal = on.st.gs.legalActions;
      if (Array.isArray(legal)) expect(legal, label).toContain(on.d.action);
      expect(
        horseDecisionReceiptRefusal(structuredClone(on.d), variant, {
          player: on.st.hero,
          gameState: on.st.gs,
        }),
        label
      ).toBeNull();
      const mine = on.fires.filter((f) => receipts.some((r) => f === r || f === `${r}_vetoed`));
      if (on.d.action !== unset.d.action || (on.d.amount ?? 0) !== (unset.d.amount ?? 0)) {
        expect(changeAllowed(unset.d, on.d, on.st), label).toBe(true);
        expect(inSpot(st0), label).toBe(true);
        // the receipt of the final action fired, its vetoed twin did not
        expect(mine.filter((f) => !f.endsWith('_vetoed')).length, label).toBe(1);
        changed++;
      } else {
        expect(on.next, label).toBe(unset.next);
        expect(mine.filter((f) => !f.endsWith('_vetoed')).length, label).toBe(0);
      }
    }
  }
  return { members: members.length, inSpot: spots, changed };
}

describe('Omaha Street Plan Flop Layer: The Planner', () => {
  const st = build(FLOP_CLASS[0]);
  const opp = () => omahaStreetPlanDomain(st.hero, st.gs)!;
  const input = (bets: number[]): OmahaFlopPlanInput => ({
    hole: st.hero.cards,
    board: st.gs.communityCards,
    pot: st.gs.pot,
    heroStack: st.hero.stack,
    oppStack: opp().stack,
    heroInvested: st.hero.totalInvested ?? 0,
    heroInPosition: false,
    bets,
    oppLine: 'called_raise',
  });

  it('Prices The Check And Every Size As Two-Street Lines Whose Turn Classes Weigh To One', () => {
    expect(omahaStreetPlanFlopSpot(st.hero, st.gs)).toBe(true);
    const plan = omahaStreetPlanFlop(input([293, 120]))!;
    expect(plan.street).toBe('flop');
    expect(plan.lines.map((l) => l.kind)).toEqual(['check', 'bet', 'bet']);
    expect(plan.turnCards).toBeGreaterThanOrEqual(4);
    expect(plan.turnCards).toBeLessThanOrEqual(12);
    for (const line of plan.lines) {
      expect(Number.isFinite(line.ev)).toBe(true);
      expect(line.classes.reduce((n, c) => n + c.share, 0)).toBeCloseTo(1, 9);
      expect(line.oppFold + line.oppCall + line.oppRaise).toBeCloseTo(1, 9);
      expect(line.continueShare).toBeGreaterThanOrEqual(0);
      expect(line.continueShare).toBeLessThanOrEqual(1 + 1e-9);
    }
    // the stack-to-pot ratio after the call is the line's own
    const bet = plan.lines[1];
    expect(bet.sprAfterCall).toBeCloseTo(
      (Math.min(st.hero.stack, opp().stack) - 293) / (st.gs.pot + 586),
      9
    );
  });

  it('Is Deterministic And Neither Reads Nor Advances The Engine Random Stream', () => {
    seedFastRandom(5);
    const a = omahaStreetPlanFlop(input([293]));
    seedFastRandom(977);
    const b = omahaStreetPlanFlop(input([293]));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    seedFastRandom(42);
    const expected = fastRandom();
    seedFastRandom(42);
    omahaStreetPlanFlop(input([293]));
    expect(fastRandom()).toBe(expected);
  });

  it('A Measured Folder Makes The Bet Line Worth More', () => {
    const base = omahaStreetPlanFlop(input([150]))!.lines[1];
    const folder = omahaStreetPlanFlop({
      ...input([150]),
      tendency: { foldToBet: 1.5, aggression: 1, riverCall: 1, valueLeader: false },
    })!.lines[1];
    expect(folder.oppFold).toBeGreaterThan(base.oppFold);
    expect(folder.ev).toBeGreaterThan(base.ev);
  });

  it('Sizes Are The Engine Bet Then Only Smaller Sizes Of The Engine Menu, Never All In', () => {
    for (const spot of FLOP_CLASS) {
      const s = build(spot);
      if (!omahaStreetPlanFlopSpot(s.hero, s.gs)) continue;
      const o = omahaStreetPlanDomain(s.hero, s.gs)!;
      const engine = Math.round(s.gs.pot * 0.8);
      const sizes = omahaFlopPlanSizes(s.hero, o, s.gs, engine);
      expect(sizes[0]).toBe(engine);
      for (const a of sizes.slice(1)) {
        expect(a).toBeLessThan(engine);
        expect(a).toBeLessThan(s.hero.stack);
        expect(a).toBeGreaterThan(0);
      }
    }
  });

  it('Stays Bounded On PLO5: Every Plan Of The Class Under 250 Ms', () => {
    let worst = 0;
    for (const spot of FLOP_CLASS) {
      const s = build(spot);
      if (!omahaStreetPlanFlopSpot(s.hero, s.gs)) continue;
      const o = omahaStreetPlanDomain(s.hero, s.gs)!;
      const t0 = performance.now();
      omahaStreetPlanFlop({
        ...input([1]),
        hole: s.hero.cards,
        board: s.gs.communityCards,
        pot: s.gs.pot,
        heroStack: s.hero.stack,
        oppStack: o.stack,
        bets: omahaFlopPlanSizes(s.hero, o, s.gs, Math.round(s.gs.pot * 0.75)),
      });
      worst = Math.max(worst, performance.now() - t0);
    }
    expect(worst).toBeLessThan(250);
  });
});

describe('Omaha Street Plan Flop Layer: The Verdict', () => {
  const line = (over: Partial<OmahaFlopPlanLine>): OmahaFlopPlanLine => ({
    kind: 'bet',
    amount: 10,
    ev: 0,
    commitShare: 0.2,
    sprAfterCall: 4,
    continueShare: 0.9,
    oppFold: 0.3,
    oppCall: 0.6,
    oppRaise: 0.1,
    vsAggression: 'call',
    equityVsContinuing: 0.5,
    classes: [],
    ...over,
  });
  const plan = (...lines: OmahaFlopPlanLine[]): OmahaFlopPlan => ({
    version: 1,
    street: 'flop',
    lines,
    sampled: 40,
    turnCards: 8,
    riverCards: 8,
  });
  const check = (ev: number) => line({ kind: 'check', amount: 0, ev });

  it('The Bet Stands Only When It Beats The Check By The Margin', () => {
    expect(omahaFlopPlanChoice(plan(check(10), line({ ev: 12.1 })), 2)).toEqual({
      index: 1,
      reason: 'kept',
    });
    expect(omahaFlopPlanChoice(plan(check(10), line({ ev: 11.9 })), 2)).toEqual({
      index: 0,
      reason: 'checked',
    });
  });

  it('A Line That Commits The Stack Is Decided By Its Value Like Any Other Line; The Label Only Names The Check', () => {
    const spr = OMAHA_FLOP_PLAN_COMMIT_SPR;
    // worth more than the check by the margin: the bet stands, committing or not
    const foldsRaise = line({ ev: 50, sprAfterCall: spr, vsAggression: 'fold' });
    const fewTurns = line({ ev: 50, sprAfterCall: spr - 0.5, continueShare: 0.5 });
    expect(omahaFlopPlanUncommitted(foldsRaise)).toBe(true);
    expect(omahaFlopPlanUncommitted(fewTurns)).toBe(true);
    expect(omahaFlopPlanChoice(plan(check(10), foldsRaise), 2)).toEqual({
      index: 1,
      reason: 'kept',
    });
    expect(omahaFlopPlanChoice(plan(check(10), fewTurns), 2)).toEqual({ index: 1, reason: 'kept' });
    // not worth more than the check: the check, named by what the bet line was
    expect(omahaFlopPlanChoice(plan(check(10), { ...foldsRaise, ev: 11 }), 2)).toEqual({
      index: 0,
      reason: 'commit_avoided',
    });
    expect(omahaFlopPlanChoice(plan(check(10), { ...fewTurns, ev: 11 }), 2)).toEqual({
      index: 0,
      reason: 'commit_avoided',
    });
    const deep = line({
      ev: 11,
      sprAfterCall: spr + 0.5,
      vsAggression: 'fold',
      continueShare: 0.2,
    });
    expect(omahaFlopPlanUncommitted(deep)).toBe(false);
    expect(omahaFlopPlanChoice(plan(check(10), deep), 2)).toEqual({ index: 0, reason: 'checked' });
    expect(omahaFlopPlanChoice(plan(check(10), { ...deep, ev: 50 }), 2)).toEqual({
      index: 1,
      reason: 'kept',
    });
  });

  it('A Smaller Size Replaces The Engine Size Only By The Margin, Whatever Either Line Commits', () => {
    const engine = line({ amount: 20, ev: 15 });
    expect(omahaFlopPlanChoice(plan(check(10), engine, line({ amount: 10, ev: 16 })), 2)).toEqual({
      index: 1,
      reason: 'kept',
    });
    expect(omahaFlopPlanChoice(plan(check(10), engine, line({ amount: 10, ev: 17.5 })), 2)).toEqual(
      { index: 2, reason: 'resized' }
    );
    // a committing engine size worth more than the smaller size stays (no stack-share veto)
    const committing = line({ amount: 20, ev: 30, sprAfterCall: 1, vsAggression: 'fold' });
    expect(
      omahaFlopPlanChoice(plan(check(10), committing, line({ amount: 10, ev: 13 })), 2)
    ).toEqual({ index: 1, reason: 'kept' });
    // and a committing smaller size worth more by the margin replaces the engine size
    const smallCommits = line({ amount: 10, ev: 20, sprAfterCall: 1, vsAggression: 'fold' });
    expect(omahaFlopPlanChoice(plan(check(10), engine, smallCommits), 2)).toEqual({
      index: 2,
      reason: 'resized',
    });
  });
});

describe('Omaha Street Plan Flop Layer: The Decision Class', () => {
  it('Unset And False Are Identical; On, A Flop Bet Only Becomes A Check Or A Smaller Bet, Legal And Admitted', () => {
    const out = classContract(
      FLOP_CLASS,
      'omahaStreetPlanFlop',
      (st) => omahaStreetPlanFlopSpot(st.hero, st.gs),
      (off, on) =>
        (off.action === 'bet' || off.action === 'all_in') &&
        (on.action === 'check' ||
          (on.action === 'bet' &&
            (on.amount ?? 0) < (off.action === 'all_in' ? Infinity : (off.amount ?? 0)))),
      [
        'omaha_street_plan_flop_checked',
        'omaha_street_plan_flop_commit_avoided',
        'omaha_street_plan_flop_resized',
      ]
    );
    expect(out.inSpot).toBeGreaterThan(0);
    expect(out.changed).toBeGreaterThan(0);
  });

  it('Out Of Position The Owner Flop Check Stays Final: The Plan Proposes Nothing Where It Checks', () => {
    const owner: HorseDecideOpts = { omahaBareOverpairOopFlopCheck: true };
    for (const spot of FLOP_CLASS)
      for (const seed of SEEDS.slice(0, 3)) {
        const ruled = run(spot, seed, owner);
        if (!ruled.fires.includes('omaha_bare_overpair_oop_flop_checked')) continue;
        const both = run(spot, seed, { ...owner, omahaStreetPlanFlop: true });
        expect(both.d.action).toBe('check');
        expect(both.fires.some((f) => f.startsWith('omaha_street_plan_flop_'))).toBe(false);
      }
  });

  it('Outside The Layer There Is No Flop Spot: Multiway, Facing A Bet, The Turn, Hi-Lo', () => {
    const st = build(FLOP_CLASS[0]);
    expect(omahaStreetPlanFlopSpot(st.hero, { ...st.gs, toCall: 50, currentBet: 50 })).toBe(false);
    expect(omahaStreetPlanFlopSpot(st.hero, { ...st.gs, gameVariant: 'plo8' })).toBe(false);
    expect(omahaStreetPlanFlopSpot(st.hero, { ...st.gs, stage: 'turn' })).toBe(false);
    const turn = build({ ...THREE_WAY_CLASS[0] });
    expect(omahaStreetPlanFlopSpot(turn.hero, turn.gs)).toBe(false);
  });
});

describe('Omaha Street Plan Three-Way Turn', () => {
  it('Each Opponent Answers On His Own, Measured Folders Fold Together More Often, And The Plan Is Deterministic', () => {
    for (const spot of THREE_WAY_CLASS.filter((s) => s.deal < 3)) {
      const st = build(spot);
      if (!omahaStreetPlanThreeWaySpot(st.hero, st.gs)) continue;
      const input = {
        hole: st.hero.cards,
        board: st.gs.communityCards,
        pot: st.gs.pot,
        heroStack: st.hero.stack,
        heroInvested: st.hero.totalInvested ?? 0,
        heroLast: false,
        bets: [Math.round(st.gs.pot * 0.75)],
        opps: [
          { stack: 500, line: 'called_bet' as const },
          { stack: 500, line: 'checked' as const },
        ] as [{ stack: number; line: 'called_bet' }, { stack: number; line: 'checked' }],
      };
      seedFastRandom(3);
      const a = omahaStreetPlanThreeWay(input)!;
      const expected = fastRandom();
      seedFastRandom(3);
      const b = omahaStreetPlanThreeWay(input)!;
      expect(fastRandom()).toBe(expected);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      const bet = a.lines[1];
      expect(bet.bothFold).toBeGreaterThanOrEqual(0);
      expect(bet.bothFold + bet.anyRaise).toBeLessThanOrEqual(1 + 1e-9);
      // a folder on both seats makes the bet worth more
      const folders = omahaStreetPlanThreeWay({
        ...input,
        opps: [
          {
            ...input.opps[0],
            tendency: { foldToBet: 1.5, aggression: 1, riverCall: 1, valueLeader: false },
          },
          {
            ...input.opps[1],
            tendency: { foldToBet: 1.5, aggression: 1, riverCall: 1, valueLeader: false },
          },
        ],
      })!;
      expect(folders.lines[1].bothFold).toBeGreaterThan(bet.bothFold);
    }
  });

  it('Unset And False Are Identical; On, A Three-Way Turn Bet Only Becomes A Check, Legal And Admitted', () => {
    const out = classContract(
      THREE_WAY_CLASS,
      'omahaStreetPlanThreeWay',
      (st) => omahaStreetPlanThreeWaySpot(st.hero, st.gs),
      (off, on) => (off.action === 'bet' || off.action === 'all_in') && on.action === 'check',
      ['omaha_street_plan_three_way_checked']
    );
    expect(out.inSpot).toBeGreaterThan(0);
  });

  it('Heads-Up And Four-Way Turns Are Not Three-Way Spots', () => {
    const heads = build({ name: 'heads-up', fx: STRAIGHT as never, ord: 16, deal: 0 });
    expect(omahaStreetPlanThreeWaySpot(heads.hero, heads.gs)).toBe(false);
    const four = build({ name: 'four', fx: MULTIWAY as never, ord: 16, deal: 0, fold: [1, 2] });
    expect(omahaStreetPlanThreeWaySpot(four.hero, four.gs)).toBe(false);
  });
});

describe('Omaha Preflop Stack Plan', () => {
  const base = {
    dead: [] as Card[],
    toCall: 7.5,
    stack: 46,
    raiserStack: 39,
    pot: 16,
    preflopRaises: 2,
    outOfPosition: true,
    band: null,
  };

  it('Acts Only On A Call That Creates A Stack-To-Pot Ratio Under Three, Never On An All-In Call', () => {
    const hole = cards('KsQdJh9c4d');
    expect(omahaPreflopStackPlan({ ...base, hole, stack: 400, raiserStack: 400 })).toBeNull();
    expect(omahaPreflopStackPlan({ ...base, hole, stack: 7.5 })).toBeNull();
    const v = omahaPreflopStackPlan({ ...base, hole })!;
    expect(v.spr).toBeCloseTo(38.5 / 23.5, 9);
    expect(v.evCall).toBeCloseTo((v.equity - v.charge) * (23.5 + 77) - 46, 9);
    expect(v.fold).toBe(v.evCall < 0);
  });

  it('The Charge Follows Playability And Position: A One-Pair Maker Pays More, Out Of Position Pays More', () => {
    const onePair = omahaPreflopStackPlan({ ...base, hole: cards('KsQdJh4c2d') })!;
    const nuts = omahaPreflopStackPlan({ ...base, hole: cards('AsKs9h8d7c') })!;
    expect(onePair.playability).toBe('one_pair_maker');
    expect(nuts.playability).toBe('nut_maker');
    expect(onePair.charge).toBeGreaterThan(nuts.charge);
    const ip = omahaPreflopStackPlan({ ...base, hole: cards('KsQdJh4c2d'), outOfPosition: false })!;
    expect(ip.charge).toBeLessThan(onePair.charge);
  });

  it('Unset And False Are Identical; On, Only A Call Becomes A Fold, Legal And Admitted', () => {
    const out = classContract(
      PREFLOP_CLASS,
      'omahaPreflopStackPlan',
      (st) => omahaPreflopStackPlanSpot(st.hero, st.gs) !== null,
      (off, on) => off.action === 'call' && on.action === 'fold',
      ['omaha_preflop_stack_plan_folded']
    );
    expect(out.inSpot).toBeGreaterThan(0);
    expect(out.changed).toBeGreaterThan(0);
  });

  it('A Raise The Engine Makes Is Never Touched, And A Multiway Pot Is Outside The Spot', () => {
    const multi = build({ name: 'multi', fx: QUEENS as never, ord: 13, deal: 0 });
    expect(omahaPreflopStackPlanSpot(multi.hero, multi.gs)).toBeNull();
    for (const spot of PREFLOP_CLASS.slice(0, 4))
      for (const seed of SEEDS.slice(0, 2)) {
        const off = run(spot, seed, {});
        const on = run(spot, seed, { omahaPreflopStackPlan: true });
        if (off.d.action === 'raise' || off.d.action === 'all_in')
          expect(bytes(on.d)).toBe(bytes(off.d));
      }
  });
});
