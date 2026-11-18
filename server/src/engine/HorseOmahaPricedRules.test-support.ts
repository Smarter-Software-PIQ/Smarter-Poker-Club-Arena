/**
 * Test support for the Omaha priced rules: one heads-up PLO5 cash spot built
 * from a recorded fixture (the builder of HorseOmahaTurnRiverRaiseNeedsNuts.test.ts,
 * with the Horse facing a bet or first to act).
 */
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import {
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ComplaintFixture,
} from './HorseComplaintReplay.js';
import type { Card, CardRank, CardSuit, HorseDecision } from '../types.js';
import { readFileSync } from 'node:fs';

// Test data, read from disk rather than imported: a non-test module that
// imports JSON must be listed in tsconfig.emit.json (engine-build-resource-proof),
// and this fixture is not a runtime resource.
const FX = JSON.parse(
  readFileSync(
    new URL(
      './horseComplaints/plo5-top-set-check-raises-pot-on-the-four-straight-turn.fixture.json',
      import.meta.url
    ),
    'utf8'
  )
) as ComplaintFixture; // hero seat 6 OOP, opponent seat 1, turn raise node 20
const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
export const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));
export const LIVE = replayProfiles('cash').find((p) => p.live)!;

export interface PricedSpot {
  hole: string;
  board: string;
  /** the pot before the opponent's bet, and the bet (0: nothing to call, the Horse acts on a checked or fresh street) */
  potBefore?: number;
  bet?: number;
  /** hero acts last (dealer moved to the hero) */
  inPosition?: boolean;
  /** earlier streets: the Horse bet the flop and was called (the out-of-position turn spot) */
  heroBetFlop?: boolean;
  /** the Horse bet the turn and was called (the paired-river spot) */
  heroBetTurn?: boolean;
}

/** Heads-up PLO5 cash: hero seat 6, opponent seat 1. */
export function pricedSpot(s: PricedSpot) {
  const f = JSON.parse(JSON.stringify(FX)) as ComplaintFixture;
  f.hole['6'] = cards(s.hole);
  const node = f.actions.find((a) => a.ord === 20)!;
  const pn = node.publicNode!;
  const street = s.board.length === 8 ? 'turn' : s.board.length === 10 ? 'river' : 'flop';
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
  if (bet > 0) {
    pn.minRaiseTo = 2 * bet;
    pn.maxRaiseTo = potBefore + 3 * bet;
    pn.legalActions = ['fold', 'call', 'raise', 'all_in'];
  } else {
    pn.minRaiseTo = 2;
    pn.maxRaiseTo = potBefore;
    pn.legalActions = ['check', 'bet', 'all_in'];
  }
  if (s.inPosition) pn.dealerSeat = 6;
  const before = f.actions.filter((a) => (street === 'flop' ? a.stage === 'preflop' : a.ord < 18));
  const acts: ComplaintAction[] = before.filter((a) => a.stage === 'preflop');
  let ord = acts.length ? acts[acts.length - 1].ord : 0;
  const push = (a: Partial<ComplaintAction>) =>
    acts.push({ isFullRaise: false, dead: false, ...a, ord: ++ord } as ComplaintAction);
  const quiet = (st: string) => {
    if (s.inPosition) {
      push({ seat: 1, stage: st, action: 'check', amount: 0, origin: 'player' });
      push({ seat: 6, stage: st, action: 'check', amount: 0, origin: 'horse_policy' });
    } else {
      push({ seat: 6, stage: st, action: 'check', amount: 0, origin: 'horse_policy' });
      push({ seat: 1, stage: st, action: 'check', amount: 0, origin: 'player' });
    }
  };
  const heroBets = (st: string, amount: number) => {
    if (s.inPosition) push({ seat: 1, stage: st, action: 'check', amount: 0, origin: 'player' });
    push({
      seat: 6,
      stage: st,
      action: 'bet',
      amount,
      origin: 'horse_policy',
      isFullRaise: true,
    });
    push({ seat: 1, stage: st, action: 'call', amount, origin: 'player' });
  };
  if (street !== 'flop') {
    if (s.heroBetFlop) heroBets('flop', Math.round(potBefore / 6));
    else quiet('flop');
  }
  if (street === 'river') {
    if (s.heroBetTurn) heroBets('turn', Math.round(potBefore / 4));
    else quiet('turn');
  }
  if (bet > 0) {
    if (!s.inPosition)
      push({ seat: 6, stage: street, action: 'check', amount: 0, origin: 'horse_policy' });
    push({
      seat: 1,
      stage: street,
      action: 'bet',
      amount: bet,
      origin: 'player',
      isFullRaise: true,
    });
  } else if (s.inPosition) {
    push({ seat: 1, stage: street, action: 'check', amount: 0, origin: 'player' });
  }
  node.ord = ++ord;
  f.actions = [...acts, node];
  // `fresh` rebuilds the state: a decision is asked on a state no earlier decision has seen.
  return Object.assign(stateAt(f, node), { fresh: () => pricedSpot(s) });
}
export type PricedState = ReturnType<typeof pricedSpot>;

export const decideAt = (st: PricedState, opts: HorseDecideOpts, seed: number): HorseDecision => {
  HorseMind.reset();
  const now = st.fresh();
  seedFastRandom(seed);
  return structuredClone(
    HorseLogic.decide(now.hero, now.gs, LIVE.style, LIVE.mods, {
      observeMind: false,
      // the hourly mood reads the wall clock unless the decision carries its time
      decisionTimeMs: 1794938400000,
      ...opts,
    } as never)
  );
};

/** The options switched on in production on 2026-11-16 (archive activation-0106z/ON-LIST.txt), the base of both arms. */
export const LIVE_OPTIONS: HorseDecideOpts = Object.fromEntries(
  [
    'horseActionTimeIsPublicOnly',
    'omahaBareOverpairOopFlopCheck',
    'omahaBigBetIsPotShare',
    'omahaBigDrawAggression',
    'omahaBluffCatcherFoldVsValueLeader',
    'omahaCardImpact',
    'omahaEliteContinuesVsMeasuredWideThreeBettor',
    'omahaFacingBetEv',
    'omahaMadeHandDefenseVsValueLeader',
    'omahaManiacReRaiseWidthMeasured',
    'omahaNoCallColdFourBetWithoutPremium',
    'omahaNoDrawRaiseOutOfPosition',
    'omahaOopReraisedPotStrongRange',
    'omahaOopTurnCheckAfterFlopCall',
    'omahaOverpairNoOopBarrelVsValueLeader',
    'omahaPairedBoardFoldRespectsPrice',
    'omahaPairedRiverNoThinLeadVsValueLeader',
    'omahaPairedTurnNoBarrelWithoutBoatVsValueLeader',
    'omahaPressureNeedsPostflopAggression',
    'omahaReraiseRangeEarlyPosition',
    'omahaReraiseRangeOutOfPosition',
    'omahaReraisedPotFlopContinueNeedsEquityShape',
    'omahaRiverMediumBetStrongHandCalls',
    'omahaRiverNutBlockerBluffReachable',
    'omahaStrategyInTournaments',
    'omahaStreetPlan',
    'omahaStrongHandSlowplayMix',
    'omahaStrongHandValue',
    'omahaTurnBetNeedsRiverPlan',
    'omahaTurnRiverRaiseNeedsNuts',
    'omahaUnderpairNoMultiwayFlopContinue',
    'omahaVpipFloorByLimp',
  ].map((o) => [o, true])
) as HorseDecideOpts;

/** The priced-rule options, one per rule family, and the mixing option. */
export const PRICED_OPTIONS = [
  'omahaTurnRiverRaiseIsPriced',
  'omahaDrawRaiseIsPriced',
  'omahaOopTurnBarrelIsPriced',
  'omahaPairedBoardBetIsPriced',
  'omahaBluffShareFromBetRate',
  'omahaFacingBetRangeIsContinuous',
  'omahaPressureIsPriced',
  'omahaBigBetCallsArePriced',
  'omahaUnderpairMultiwayIsPriced',
  'omahaPricedMix',
] as const;
export const allPriced = (on: boolean): HorseDecideOpts =>
  Object.fromEntries(PRICED_OPTIONS.map((o) => [o, on])) as HorseDecideOpts;

/**
 * A real Horse decision recorded from production hand history (the audit of
 * 2026-11-17, archive plo-handoff-review-01a1cbbd/audit2-01BNteGZ): the
 * public actions before it, the public node, and the Horse's own hole cards
 * only (no other player's cards are in the record).
 */
export interface RecordedDecision {
  n: number;
  variant: string;
  bb: number;
  dealer: number;
  street: 'flop' | 'turn' | 'river';
  /** seats: "<seat>H" a Horse, "<seat>P" a person */
  pl: string;
  /** earlier actions: seat|street|action|amount|origin|fullRaise|dead */
  a: string;
  next: string;
  boards: string[];
  seat: number;
  hole: string;
  pot: number;
  bet: number;
  cur: number;
  min: number | null;
  max: number | null;
  legal: string[];
  seats: number[][];
  /** what the Horse did live */
  did: string;
  /** the audit's judgement of the live decision, when it has one */
  audit: { type: string; kind: string; verdict: string; cause: string } | null;
  /** the action and amount of this source at seed 1, by configuration */
  expect: Record<string, { a: string; amt: number | null }>;
}
const STAGES: Record<string, string> = { p: 'preflop', f: 'flop', t: 'turn', r: 'river' };
const ORIGINS: Record<string, string> = { f: 'forced', h: 'horse_policy', p: 'player' };

/** The decision state of a recorded decision, built by the complaint-replay state builder. */
export function recordedState(r: RecordedDecision) {
  const actions: ComplaintAction[] = `${r.a};${r.next}`.split(';').map((row, i) => {
    const [seat, stage, action, amount, origin, full, dead] = row.split('|');
    return {
      ord: i + 1,
      seat: Number(seat),
      stage: STAGES[stage],
      action,
      amount: Number(amount),
      ...(ORIGINS[origin] ? { origin: ORIGINS[origin] } : {}),
      isFullRaise: full === '1',
      dead: dead === '1',
    } as ComplaintAction;
  });
  const node = actions[actions.length - 1];
  node.publicNode = {
    pot: r.pot,
    ante: 2,
    anteType: 'big_blind',
    mode: 'cash',
    asset: 'chips',
    seats: r.seats,
    boards: r.boards,
    street: r.street,
    toCall: r.bet,
    currentBet: r.cur,
    minRaiseTo: r.min,
    maxRaiseTo: r.max,
    legalActions: r.legal,
    dealerSeat: r.dealer,
    chipUnit: 0.01,
    bigBlind: r.bb,
    smallBlind: r.bb / 2,
    variant: r.variant,
    structure: 'pot_limit',
    actorSeat: r.seat,
    bombPot: false,
    boardCount: 1,
    allInOrFold: false,
    fixedBetSize: null,
    wagersCapped: false,
  } as unknown as ComplaintAction['publicNode'];
  const fx = {
    version: 1,
    slug: `recorded-${r.n}-${r.seat}-${r.street}`,
    title: 'Recorded Decision',
    complaint: 'recorded decision',
    handId: String(r.n),
    fmt: 'cash',
    variant: r.variant,
    players: r.pl
      .split(' ')
      .map((p) => ({ seat: Number(p.slice(0, -1)), isHorse: p.endsWith('H') })),
    hole: { [String(r.seat)]: cards(r.hole) },
    actions,
    forbidden: [{ ord: node.ord, kind: 'fold' }],
    seeds: [],
  } as unknown as ComplaintFixture;
  return stateAt(fx, node);
}

/** One decision of a recorded state at a seed, on a fresh state and an empty opponent memory. */
export const decideRecorded = (
  r: RecordedDecision,
  opts: HorseDecideOpts,
  seed: number
): { decision: HorseDecision; state: ReturnType<typeof recordedState> } => {
  HorseMind.reset();
  const state = recordedState(r);
  seedFastRandom(seed);
  const decision = structuredClone(
    HorseLogic.decide(state.hero, state.gs, LIVE.style, LIVE.mods, {
      observeMind: false,
      decisionTimeMs: 1794938400000,
      ...opts,
    } as never)
  );
  return { decision, state };
};
