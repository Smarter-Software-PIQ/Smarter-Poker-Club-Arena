/**
 * LAW: WHAT THE REFERENCE NODE DOES TO A ROUTE'S ANSWER IS A REFERENCE RETURN
 * (2026-11-19).
 *
 * A preflop decision carries a receipt that names the source route its
 * reference proposal came from (chart_open_jam, chart_bb_defend,
 * variant_price, or the open intent_engine / legacy_preflop). The engine
 * refuses a receipt whose proposal the named route could not have returned
 * (HorsePhase6Attribution.referenceReturnShape -> reference_shape), and a
 * refused decision folds the seat on the liveness fallback.
 *
 * The reference node (HorseLogic.decide, graph.run('reference')) runs rules
 * AFTER the route has returned, and each of them can change the proposal's
 * action or amount: the VPIP-floor call-down, the limp-only floors, the maniac
 * call-down, the maniac short-stack jam. Every time one of them was added
 * without telling the shape check, production folded Horses that had chosen
 * to play:
 *   - the V53 4-bet (2026-10-26), the V58 jam, the maniac call-down's cent
 *     rounding (2026-11-07, hand cc8a59bb);
 *   - the limp-only floors (2026-11-18/19): vpipFloorLimpOnly folded six
 *     short NLH stacks at floored tables, lightningVpipFloorLimpOnly was
 *     rolled back after 8 refusals in 28 minutes.
 *
 * This law closes the class in two halves.
 *   1. THE LEDGER IS THE SOURCE. Every assignment to the proposal inside the
 *      reference node is read from HorseLogic.ts and must be in the ledger
 *      below, in order. A new rule there fails this test until it is entered
 *      with its proof.
 *   2. EVERY ENTRY IS PROVEN. For each rule and each named route, over a grid
 *      of public states (stakes down to cents, 2 to 100 big blinds, every
 *      first-in seat, a jam into the big blind), whatever the rule turns a
 *      fold into while the route's own gates hold is admitted by
 *      referenceReturnShape; and the routes a rule cannot reach are shown
 *      unreachable, not assumed.
 *
 * Public states built here; no recorded hand and no recorded card.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HorseLogic,
  lightningVpipFloorLimpOnlyInputs,
  vpipFloorCallDown,
  vpipFloorLimpFoldsToARaiseStep,
  vpipFloorLimpOnlyApplies,
  vpipFloorLimpOnlyStep,
  vpipLimpTargetFor,
  type HorseDecideOpts,
  type HorseGameStateV2,
} from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import * as Eval from './HorseEval.js';
import type { OpponentExploitRead } from './HorseOpponentExploit.js';
import { necessaryReferenceRouteGates, referenceReturnShape } from './HorsePhase6Attribution.js';
import type { Card, HorseDecision, SeatPlayer } from '../types.js';

const SOURCE = readFileSync(new URL('./HorseLogic.ts', import.meta.url), 'utf8');

/** The reference node's body, between its opening and its `.decision`. */
function referenceNodeSource(): string {
  const open = "let decision = graph.run('reference', null, () => {";
  const start = SOURCE.indexOf(open);
  expect(start).toBeGreaterThan(0);
  expect(SOURCE.indexOf(open, start + 1)).toBe(-1);
  const end = SOURCE.indexOf('}).decision;', start);
  expect(end).toBeGreaterThan(start);
  return SOURCE.slice(start + open.length, end);
}

/**
 * THE LEDGER: every assignment to the proposal in the reference node, in
 * source order. `kind` says what it can do to a named route's answer.
 */
const LEDGER: ReadonlyArray<{ owner: string; kind: string; proof: string }> = [
  { owner: 'decidePreflopV7Glue', kind: 'source_route', proof: 'the route itself' },
  {
    owner: 'preflopReadReceipt',
    kind: 'receipt_only',
    proof: 'spreads the decision, adds a receipt',
  },
  {
    owner: 'raisedFloorLimp.decision',
    kind: 'post_route',
    proof:
      'vpipFloorLimpFoldsToARaise (default OFF): returns the decision it was given unless the option is on and the Horse faces a raise after its own remembered floor limp; then it returns a FOLD and nothing else, and a fold of a price to call is a reference return on every route (raisedFloorLimpFold below)',
  },
  { owner: 'limpOnly.decision', kind: 'post_route', proof: 'tableLimp (vpipFloorLimpOnly)' },
  {
    owner: 'limpOnly.decision',
    kind: 'post_route',
    proof: 'poolLimp (lightningVpipFloorLimpOnly)',
  },
  {
    owner: 'vpipFloorCallDown',
    kind: 'post_route',
    proof: 'callDownLimpTarget (omahaVpipFloorByLimp)',
  },
  { owner: 'vpipFloorCallDown', kind: 'post_route', proof: 'callDown' },
  { owner: 'decidePostflop', kind: 'postflop', proof: 'no preflop receipt exists postflop' },
  {
    owner: 'classCapFloorKeepsTheCall',
    kind: 'postflop',
    proof:
      'postflop only (omahaClassCapsRespectEquity): a raise the lifted cap produced stays the call',
  },
  {
    owner: 'holdemPricedReference',
    kind: 'postflop',
    proof:
      'holdemValueAndCallsArePriced (default OFF): postflop only, heads-up NLH cash; returns the decision it was given unless the option is on and the spot is priced',
  },
  {
    owner: 'holdemOpeningPriced',
    kind: 'postflop',
    proof:
      'holdemOpeningValueBetIsPriced / holdemOpeningBluffIsPriced (default OFF): postflop only, heads-up NLH cash, not facing a wager; returns the decision it was given unless an option is on and a bet prices above the check (HorseHoldemOpeningIsPriced.law.test.ts)',
  },
  {
    owner: 'holdemMultiwayOpeningPriced',
    kind: 'postflop',
    proof:
      'holdemMultiwayOpeningBluffIsPriced / holdemMultiwayOpeningValueBetIsPriced (default OFF): turn and river only, NLH cash against two or more opponents, nobody has bet the street; returns the decision it was given unless an option is on and a bet prices above the check (HorseHoldemMultiwayOpeningIsPriced.law.test.ts)',
  },
  {
    owner: 'holdemRiverFacingBetOnPeople',
    kind: 'postflop',
    proof:
      "holdemRiverFacingBetPriorIsPeopleMeasured (default OFF): river only, heads-up NLH cash, facing the river's first bet; returns the decision it was given unless the option is on, the decision is a fold and the call clears its error (aHoldemRiverFacingBetPriorIsPeopleMeasured.law.test.ts)",
  },
  {
    owner: 'holdemTournamentBluffPriced',
    kind: 'postflop',
    proof:
      'holdemTournamentRiverBluffIsPriced / holdemTournamentTurnBluffIsPriced (default OFF): postflop only, heads-up NLH tournaments, not facing a wager; returns the decision it was given unless an option is on and a bluff prices above the check (HorseHoldemTournamentLateIsPriced.law.test.ts)',
  },
  { owner: 'maniacCallDown', kind: 'post_route', proof: 'maniacCallDown' },
  { owner: 'maniacShortStackJam', kind: 'post_route', proof: 'acts on a raise only' },
  { owner: 'fixedLimitRiverStrongHandLead', kind: 'postflop', proof: 'river only' },
  {
    owner: 'holdemAllInCallReference',
    kind: 'post_route',
    proof:
      'holdemTournamentAllInCallIsPriced (default OFF): preflop it leaves raises/raising all-ins and exact chart_bb_defend answers untouched, and resets any chart_open_jam or variant_price route to the active preflop reference owner (intent_engine under V7, legacy_preflop otherwise) before returning its priced call or fold; postflop no preflop receipt exists (AHoldemTournamentAllInCallIsPriced.law.test.ts, AHoldemAllInCallReferenceReceiptIsValid.law.test.ts)',
  },
  {
    owner: 'holdemRaiseDefenceReference',
    kind: 'post_route',
    proof:
      'holdemTournamentHeadsUpBigBlindDefenceIsPriced / holdemTournamentBlindDefenceIsPriced / holdemTournamentCommittedRaiseIsPriced (default OFF): preflop only, facing one non-all-in raise in a heads-up pot; it returns a fold, a call of the exact amount or an all-in, and resets any chart_open_jam, chart_bb_defend or variant_price route to the active preflop reference owner (intent_engine under V7, legacy_preflop otherwise) whenever it prices the spot; off it returns the decision it was given (AHoldemTournamentRaiseDefenceIsPriced.law.test.ts checks every priced decision against horseDecisionReceiptRefusal and the route)',
  },
];

describe('the ledger is the source', () => {
  it('every assignment to the proposal in the reference node is entered, in order', () => {
    const node = referenceNodeSource();
    const owners = [...node.matchAll(/(?<![.\w])decision\s*=(?!=)\s*([\s\S]*?);/g)].map((m) => {
      const rhs = m[1].replace(/\s+/g, ' ');
      const known = [...new Set(LEDGER.map((l) => l.owner))].filter((o) => rhs.includes(o));
      // the source route's own expression names both preflop producers
      if (known.includes('decidePreflopV7Glue')) return 'decidePreflopV7Glue';
      return known.length === 1 ? known[0] : `NOT IN THE LEDGER: ${rhs.slice(0, 80)}`;
    });
    expect(owners).toEqual(LEDGER.map((l) => l.owner));
    // nothing edits the proposal in place
    expect(node).not.toMatch(/(?<![.\w])decision\.(action|amount)\s*=(?!=)/);
    // the two limp-only assignments are the two floors, each through the one step
    expect(node.match(/vpipFloorLimpOnlyStep\(/g)?.length).toBe(2);
    expect(node).toContain('vpipFloorLimpOnlyApplies(gs, opts, isTournamentMode(gs))');
    expect(node).toContain('lightningVpipFloorLimpOnlyInputs(gs, opts, isTournamentMode(gs))');
  });

  it('the rules that cannot touch a named route say so in their own first lines', () => {
    // maniacShortStackJam turns a RAISE into the jam. No named route returns a raise except
    // variant_price's V53 4-bet, which needs two raises in the pot, and this rule needs none.
    expect(SOURCE).toMatch(
      /function maniacShortStackJam\([^)]*\): HorseDecision \{\s*if \(decision\.action !== 'raise' \|\| opts\.mind === false \|\| gs\.stage !== 'preflop'\) return decision;/
    );
    expect(SOURCE).toMatch(
      /if \(hist\.some\(\(a\) => a\.stage === 'preflop' && \(a\.action === 'raise' \|\| a\.action === 'all_in'\)\)\)\s*return decision;/
    );
    // fixedLimitRiverStrongHandLead acts on a river check only.
    expect(SOURCE).toMatch(
      /function fixedLimitRiverStrongHandLead\([\s\S]{0,220}?if \(decision\.action !== 'check' \|\| gs\.stage !== 'river'/
    );
    // Both producers of chart_bb_defend stand aside for a maniac's jam, so the maniac
    // call-down (which needs that same read) never follows that route.
    const producers = SOURCE.match(/notePhase6Route\('solver', 'chart_bb_defend'\)/g)?.length;
    expect(producers).toBe(3); // the Nash call against a jam, and the chart's call and fold
    expect(SOURCE.match(/maniacRaiserWidth === null\s*(&&|\))/g)?.length).toBe(2);
  });
});

// ── the public states ──────────────────────────────────────────────────────
const NAMED = ['chart_open_jam', 'chart_bb_defend', 'variant_price'] as const;
type Named = (typeof NAMED)[number];
const FOLD: HorseDecision = { action: 'fold', thinkTime: 0 };
const cents = (x: number) => Math.round(x * 100) / 100;
const HOLDEM: Card[] = [
  { rank: '7', suit: 'clubs' },
  { rank: '2', suit: 'diamonds' },
];
const OMAHA5: Card[] = [
  { rank: '7', suit: 'clubs' },
  { rank: '2', suit: 'diamonds' },
  { rank: '9', suit: 'hearts' },
  { rank: '4', suit: 'spades' },
  { rank: 'J', suit: 'clubs' },
];
const STAKES: ReadonlyArray<[sb: number, bb: number]> = [
  [1, 2],
  [0.5, 1],
  [0.25, 0.5],
  [0.05, 0.1],
  [0.02, 0.05],
];
const DEPTHS = [2, 3.4, 5.85, 6.35, 6.92, 8.92, 12, 15, 40, 100];

type Floor =
  | { kind: 'none' }
  | { kind: 'table'; vpip: number }
  | { kind: 'pool'; own: { hands: number; vpipHands: number; leavingEntered?: boolean } };

/**
 * Six seats, button 4, small blind 5, big blind 6, a big-blind ante.
 * 'firstIn': folded to the hero in seat `hero` (1 to 5). 'jam': everyone folds to the small
 * blind, who is all in for `jamBB` big blinds; the hero is the big blind.
 */
function state(cfg: {
  variant: 'nlh' | 'plo5';
  sb: number;
  bb: number;
  line: 'firstIn' | 'jam';
  hero: number;
  depthBB: number;
  jamBB?: number;
  floor: Floor;
}): { player: SeatPlayer; gameState: HorseGameStateV2 } {
  const { sb, bb } = cfg;
  const deep = cents(200 * bb);
  const players: SeatPlayer[] = [1, 2, 3, 4, 5, 6].map((seat) => ({
    seat,
    user_id: `00000000-0000-4000-8000-00000000000${seat}`,
    username: `seat-${seat}`,
    stack: deep,
    bet: 0,
    totalInvested: 0,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: true,
  }));
  const at = (seat: number) => players[seat - 1];
  at(5).bet = sb;
  at(5).stack = cents(deep - sb);
  at(6).bet = bb;
  at(6).stack = cents(deep - 2 * bb);
  const history: Array<Record<string, unknown>> = [];
  let ts = 1;
  const fold = (seat: number) => {
    at(seat).is_folded = true;
    history.push({
      seat,
      userId: at(seat).user_id,
      stage: 'preflop',
      action: 'fold',
      amount: 0,
      timestamp: ts++,
    });
  };
  let currentBet = bb;
  if (cfg.line === 'firstIn') {
    for (let s = 1; s < cfg.hero; s++) fold(s);
  } else {
    for (let s = 1; s <= 4; s++) fold(s);
    const jam = cents((cfg.jamBB ?? 5) * bb);
    at(5).bet = jam;
    at(5).stack = 0;
    at(5).is_all_in = true;
    currentBet = jam;
    history.push({
      seat: 5,
      userId: at(5).user_id,
      stage: 'preflop',
      action: 'all_in',
      amount: jam,
      isFullRaise: true,
      timestamp: ts++,
    });
  }
  const heroRow = at(cfg.hero);
  heroRow.stack = cents(cfg.depthBB * bb - heroRow.bet);
  const pot = players.reduce((s, p) => s + p.bet, 0) + bb;
  const gs: Record<string, unknown> = {
    stateSchemaVersion: 1,
    asset: 'chips',
    chipUnit: 0.01,
    players,
    dealtSeatIds: [1, 2, 3, 4, 5, 6],
    dealerSeat: 4,
    communityCards: [],
    gameVariant: cfg.variant,
    stage: 'preflop',
    gameMode: 'cash',
    format: 'cash',
    currentBet,
    smallBlind: sb,
    bigBlind: bb,
    ante: bb,
    bigBlindAnte: true,
    pot,
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    minRaiseTo: currentBet + bb,
    maxRaiseTo: heroRow.stack + heroRow.bet,
    bettingStructure: cfg.variant === 'nlh' ? 'no_limit' : 'pot_limit',
    actionHistory: history,
    allInOrFold: false,
    rakeConfig: { percent: 5, cap: 3 * bb, noFlopNoDrop: true },
  };
  if (cfg.floor.kind === 'table') {
    gs.vpipFloor = 40;
    gs.vpipWindowHands = 30;
    gs.ownVpip = { hands: 30, vpip: cfg.floor.vpip };
    gs.publicMemoryDomain = { speed: 'table' };
  } else if (cfg.floor.kind === 'pool') {
    gs.publicMemoryDomain = { speed: 'lightning' };
    gs.lightningVpipFloor = { floor: 40, windowHands: 10, own: { ...cfg.floor.own } };
  }
  const player: SeatPlayer = {
    ...heroRow,
    cards: cfg.variant === 'nlh' ? HOLDEM : OMAHA5,
  };
  return { player, gameState: gs as unknown as HorseGameStateV2 };
}

const TABLE_FLOORS: Floor[] = [0, 20, 45, 49.5, 60].map((vpip) => ({ kind: 'table', vpip }));
const POOL_FLOORS: Floor[] = [
  { kind: 'pool', own: { hands: 9, vpipHands: 0 } },
  { kind: 'pool', own: { hands: 9, vpipHands: 3 } },
  { kind: 'pool', own: { hands: 9, vpipHands: 4 } },
  { kind: 'pool', own: { hands: 9, vpipHands: 4, leavingEntered: true } },
];

/** Every public state of the grid, for one variant. */
function* grid(variant: 'nlh' | 'plo5', floors: Floor[]) {
  for (const [sb, bb] of STAKES)
    for (const depthBB of DEPTHS)
      for (const floor of floors) {
        for (const hero of [1, 2, 3, 4, 5])
          yield state({ variant, sb, bb, line: 'firstIn', hero, depthBB, floor });
        for (const jamBB of [3, 5, 9, 20])
          yield state({ variant, sb, bb, line: 'jam', hero: 6, depthBB, jamBB, floor });
      }
}

type Rule = {
  opts: HorseDecideOpts;
  variant: 'nlh' | 'plo5';
  floors: Floor[];
  /** The rule exactly as the reference node calls it, on a route's fold. */
  apply: (p: SeatPlayer, gs: HorseGameStateV2, opts: HorseDecideOpts) => HorseDecision;
  /** Routes on which the rule must be seen changing a fold (the rest: never). */
  reaches: Named[];
};

const RULES: Record<string, Rule> = {
  tableLimp: {
    opts: { vpipFloorLimpOnly: true },
    variant: 'nlh',
    floors: TABLE_FLOORS,
    apply: (p, gs, opts) =>
      vpipFloorLimpOnlyApplies(gs, opts, false)
        ? vpipFloorLimpOnlyStep(FOLD, p, gs, () => 0, 'every').decision
        : FOLD,
    reaches: ['chart_open_jam'],
  },
  poolLimp: {
    opts: { lightningVpipFloorLimpOnly: true },
    variant: 'nlh',
    floors: POOL_FLOORS,
    apply: (p, gs, opts) => {
      const pool = lightningVpipFloorLimpOnlyInputs(gs, opts, false);
      if (pool === null) return FOLD;
      const forced = pool.shortfallHands > 0;
      if (!forced && !pool.preempt) return FOLD;
      return vpipFloorLimpOnlyStep(
        FOLD,
        p,
        {
          stage: gs.stage,
          currentBet: gs.currentBet,
          bigBlind: gs.bigBlind,
          straddleActive: gs.straddleActive,
          actionHistory: gs.actionHistory,
        },
        () => 0,
        'every',
        forced ? pool.shortfallHands : 1
      ).decision;
    },
    reaches: ['chart_open_jam'],
  },
  callDown: {
    opts: {},
    variant: 'nlh',
    floors: TABLE_FLOORS,
    apply: (p, gs) => vpipFloorCallDown(FOLD, p, gs, () => 0),
    reaches: ['chart_open_jam', 'chart_bb_defend', 'variant_price'],
  },
  // omahaVpipFloorByLimp is Omaha only: of the named routes it can follow variant_price alone.
  callDownLimpTarget: {
    opts: { omahaVpipFloorByLimp: true },
    variant: 'plo5',
    floors: TABLE_FLOORS,
    apply: (p, gs) =>
      vpipFloorCallDown(
        FOLD,
        p,
        gs,
        () => 0,
        vpipLimpTargetFor(Number(gs.vpipFloor), gs.vpipWindowHands)
      ),
    reaches: ['variant_price'],
  },
};

describe('every floor rule of the reference node is admitted on every route it can follow', () => {
  for (const [name, rule] of Object.entries(RULES)) {
    it(`${name}: whatever it makes of a fold is a reference return`, () => {
      const changed: Record<Named, number> = {
        chart_open_jam: 0,
        chart_bb_defend: 0,
        variant_price: 0,
      };
      let states = 0;
      for (const snap of grid(rule.variant, rule.floors)) {
        states++;
        const snapshot = { ...snap, opts: rule.opts };
        const out = rule.apply(snap.player, snap.gameState, rule.opts);
        if (out.action === 'fold') continue;
        for (const route of NAMED) {
          if (!necessaryReferenceRouteGates(route, snapshot)) continue;
          changed[route]++;
          const receipt = {
            route,
            referenceProposal: { action: out.action, amount: out.amount ?? null },
          } as never;
          const admitted = referenceReturnShape(receipt, snapshot);
          if (!admitted)
            throw new Error(
              `${name} on ${route} is refused as reference_shape: ${JSON.stringify({
                action: out.action,
                amount: out.amount,
                currentBet: snap.gameState.currentBet,
                heroBet: snap.player.bet,
                heroStack: snap.player.stack,
                bigBlind: snap.gameState.bigBlind,
              })}`
            );
        }
      }
      expect(states).toBeGreaterThan(1000);
      for (const route of NAMED) {
        if (rule.reaches.includes(route)) expect(changed[route], route).toBeGreaterThan(0);
        else expect(changed[route], route).toBe(0);
      }
    });
  }

  it('the table floor limp is admitted with the request opts silent (the switch delivers the option)', () => {
    // vpipFloorLimpOnly reaches the worker through the switch after the request
    // is built, like the pool option (#11491): request opts that are silent
    // must not turn the table floor's limp into a reference_shape refusal
    // (which the engine answers with the liveness fold).
    let admitted = 0;
    const rule = RULES.tableLimp;
    for (const snap of grid(rule.variant, rule.floors)) {
      const out = rule.apply(snap.player, snap.gameState, rule.opts);
      if (out.action === 'fold') continue;
      const off = { ...snap, opts: {} };
      if (!necessaryReferenceRouteGates('chart_open_jam', off)) continue;
      const receipt = {
        route: 'chart_open_jam',
        referenceProposal: { action: out.action, amount: out.amount ?? null },
      } as never;
      expect(referenceReturnShape(receipt, off)).toBe(true);
      admitted++;
    }
    expect(admitted).toBeGreaterThan(50);
  });

  it('a call that is not the table floor limp stays refused (no floor, or another amount)', () => {
    let refused = 0;
    const rule = RULES.tableLimp;
    for (const snap of grid(rule.variant, rule.floors)) {
      const out = rule.apply(snap.player, snap.gameState, rule.opts);
      if (out.action === 'fold' || typeof out.amount !== 'number') continue;
      const off = { ...snap, opts: {} };
      if (!necessaryReferenceRouteGates('chart_open_jam', off)) continue;
      const callDown = vpipFloorCallDown(FOLD, snap.player, snap.gameState, () => 0);
      if (callDown.action === 'call') continue;
      // the same public state without a table floor: nothing could limp
      const noFloor = {
        ...off,
        gameState: { ...snap.gameState, vpipFloor: 0 } as typeof snap.gameState,
      };
      const receipt = {
        route: 'chart_open_jam',
        referenceProposal: { action: out.action, amount: out.amount },
      } as never;
      expect(referenceReturnShape(receipt, noFloor)).toBe(false);
      // and a call of another amount is not the limp
      const other = {
        route: 'chart_open_jam',
        referenceProposal: { action: 'call', amount: out.amount + snap.gameState.bigBlind },
      } as never;
      expect(referenceReturnShape(other, off)).toBe(false);
      refused++;
    }
    expect(refused).toBeGreaterThan(50);
  });

  it('the pool floor limp is admitted with the request opts silent (the switch delivers the option, #11491)', () => {
    let admitted = 0;
    const rule = RULES.poolLimp;
    for (const snap of grid(rule.variant, rule.floors)) {
      const out = rule.apply(snap.player, snap.gameState, rule.opts);
      if (out.action === 'fold') continue;
      const off = { ...snap, opts: {} };
      if (!necessaryReferenceRouteGates('chart_open_jam', off)) continue;
      const receipt = {
        route: 'chart_open_jam',
        referenceProposal: { action: out.action, amount: out.amount ?? null },
      } as never;
      expect(referenceReturnShape(receipt, off)).toBe(true);
      admitted++;
    }
    expect(admitted).toBeGreaterThan(50);
  });
});

describe('the raised floor limp of the reference node (vpipFloorLimpFoldsToARaise, default OFF)', () => {
  it('raisedFloorLimpFold: it only ever returns a fold, and a fold of a price to call is a reference return on every named route', () => {
    // its only outputs: the decision it was given, or a fold (HorseLogic.vpipFloorLimpFoldsToARaiseStep)
    const given: HorseDecision = { action: 'call', amount: 7, thinkTime: 1 };
    const hist = [
      { stage: 'preflop', seat: 4, action: 'call' },
      { stage: 'preflop', seat: 6, action: 'raise', isFullRaise: true },
    ];
    const me = { seat: 4, bet: 2 };
    const facing = {
      stage: 'preflop',
      currentBet: 9,
      ownVpipFloorLimpThisHand: true,
      actionHistory: hist,
    };
    expect(vpipFloorLimpFoldsToARaiseStep(given, me, facing, {}).decision).toBe(given);
    expect(
      vpipFloorLimpFoldsToARaiseStep(
        given,
        me,
        { ...facing, ownVpipFloorLimpThisHand: false },
        {
          vpipFloorLimpFoldsToARaise: true,
        }
      ).decision
    ).toBe(given);
    for (const action of ['call', 'raise', 'all_in', 'fold'] as const) {
      const out = vpipFloorLimpFoldsToARaiseStep({ ...given, action }, me, facing, {
        vpipFloorLimpFoldsToARaise: true,
      }).decision;
      expect([action, out.action, out.amount]).toEqual([
        action,
        'fold',
        action === 'fold' ? 7 : undefined,
      ]);
    }
    // a fold facing chips to call is admitted on every named route, on every state of the grid
    let states = 0;
    for (const snap of grid('nlh', TABLE_FLOORS)) {
      const toCall = snap.gameState.currentBet - snap.player.bet;
      if (!(toCall > 0)) continue;
      states++;
      for (const route of NAMED) {
        const receipt = { route, referenceProposal: { action: 'fold', amount: null } } as never;
        expect(referenceReturnShape(receipt, { ...snap, opts: {} })).toBe(true);
      }
    }
    expect(states).toBeGreaterThan(100);
  });
});

describe('the maniac call-down of the reference node', () => {
  beforeEach(() => {
    const base = { engaged: null, mean: 0.2, excess: 0, lower: 0, upper: 1 };
    const stats = Object.fromEntries(
      [
        'vpip',
        'pfr',
        'rfi',
        'threeBet',
        'foldTo3Bet',
        'betCheckedTo',
        'foldToBet',
        'riverCall',
      ].map((k) => [k, { ...base, ...(k === 'pfr' ? { engaged: 'high', mean: 1 } : {}) }])
    );
    vi.spyOn(HorseMind, 'opponentRead').mockReturnValue({
      stats,
    } as unknown as OpponentExploitRead);
    vi.spyOn(HorseMind, 'bandFor').mockReturnValue([0, 1]);
    vi.spyOn(Eval, 'equitySampleSizeOfLastCall').mockReturnValue(360);
    vi.spyOn(Eval, 'simulateEquity').mockReturnValue(0.9);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    HorseMind.reset();
  });
  const maniac = (snap: { player: SeatPlayer; gameState: HorseGameStateV2 }) =>
    HorseLogic.__testables.maniacCallDown(
      FOLD,
      snap.player,
      snap.gameState,
      Eval.variantInfo('nlh'),
      {}
    );

  it('cannot follow chart_open_jam: nobody has raised, so there is no maniac to call', () => {
    let seen = 0;
    for (const snap of grid('nlh', [{ kind: 'none' }])) {
      if (!necessaryReferenceRouteGates('chart_open_jam', { ...snap, opts: {} })) continue;
      expect(maniac(snap)).toBe(FOLD);
      seen++;
    }
    expect(seen).toBeGreaterThan(100);
  });

  it('on variant_price its call (to the cent) and its call-off are reference returns', () => {
    const made = { call: 0, all_in: 0 };
    for (const snap of grid('nlh', [{ kind: 'none' }])) {
      const snapshot = { ...snap, opts: {} };
      if (!necessaryReferenceRouteGates('variant_price', snapshot)) continue;
      const out = maniac(snap);
      if (out.action === 'fold') continue;
      made[out.action as 'call' | 'all_in']++;
      const receipt = {
        route: 'variant_price',
        referenceProposal: { action: out.action, amount: out.amount ?? null },
      } as never;
      expect(referenceReturnShape(receipt, snapshot)).toBe(true);
    }
    expect(made.call).toBeGreaterThan(20);
    expect(made.all_in).toBeGreaterThan(20);
  });
});
