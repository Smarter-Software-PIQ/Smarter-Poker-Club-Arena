/**
 * Test Support For The Omaha Strong Hand Slowplay Mix: a six-seat PLO4/PLO5
 * cash hand built from nothing but a spot description (hero seat 6, 1/2
 * blinds, big-blind ante), replayed through HorseComplaintReplay.stateAt so
 * the decision state is the live one (schema version, legal actions, raise
 * bounds, action history, dealt census).
 *
 * Position is the dealer seat: 'ip' puts the button on the hero (every live
 * opponent acts first), 'oop' puts it on seat 5 (the hero acts first), 'mid'
 * puts it on seat 1 (seats 2-5 act before the hero, seat 1 after).
 */
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import {
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ComplaintFixture,
} from './HorseComplaintReplay.js';
import type { OmahaReadConditional } from './HorseOmahaReadConditional.js';
import type { HorseDecision } from '../types.js';

export const SLOWPLAY_HERO = 6;
const SEATS = [1, 2, 3, 4, 5, 6];
const BB = 2;
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface SlowplaySpot {
  variant?: 'plo4' | 'plo5';
  /** the hero's hole cards, "AcAdKc7s" */
  hole: string;
  /** the board, "Kh7d2c"; its length is the street */
  board: string;
  /** live opponent seats (1-5) */
  opponents: number[];
  position: 'ip' | 'oop' | 'mid';
  /** the seat that bet this street, and the bet as a share of the pot before it; absent: nothing to call */
  bettor?: number;
  betFrac?: number;
  /** every stack at the start of the hand, in big blinds (default 100) */
  stackBb?: number;
  /** the preflop raise, in chips (default 8): scales the pot */
  open?: number;
  /** earlier streets: the hero bet two thirds of the pot and was called, or all checked (default) */
  line?: 'checks' | 'hero_bets';
  mode?: 'cash' | 'tournament';
}

const STREETS = ['flop', 'turn', 'river'] as const;

export function slowplayState(s: SlowplaySpot) {
  const variant = s.variant ?? 'plo5';
  const dealer = s.position === 'ip' ? 6 : s.position === 'oop' ? 5 : 1;
  const after = (seat: number) => (((seat - dealer - 1) % 6) + 6) % 6;
  const order = [...SEATS].sort((a, b) => after(a) - after(b));
  const live = new Set([SLOWPLAY_HERO, ...s.opponents]);
  const stack0 = (s.stackBb ?? 100) * BB;
  const total = new Map<number, number>(SEATS.map((x) => [x, 0]));
  const dead = new Map<number, number>(SEATS.map((x) => [x, 0]));
  const bet = new Map<number, number>(SEATS.map((x) => [x, 0]));
  const folded = new Set<number>();
  const actions: ComplaintAction[] = [];
  let ord = 0;
  const push = (
    seat: number,
    stage: string,
    action: string,
    amount: number,
    full = false,
    isDead = false
  ) => {
    actions.push({
      ord: ++ord,
      seat,
      stage,
      action,
      amount: r2(amount),
      origin: seat === SLOWPLAY_HERO ? 'horse_policy' : seat === 1 ? 'player' : 'horse_policy',
      isFullRaise: full,
      dead: isDead,
    });
  };
  const put = (seat: number, to: number) => {
    const add = r2(to - (bet.get(seat) ?? 0));
    bet.set(seat, to);
    total.set(seat, r2((total.get(seat) ?? 0) + add));
    return add;
  };
  const pot = () => r2(SEATS.reduce((a, x) => a + (total.get(x) ?? 0) + (dead.get(x) ?? 0), 0));
  // Preflop: blinds, the big-blind ante, the hero opens, the live opponents call.
  const sb = order[0];
  const bbSeat = order[1];
  const open = s.open ?? 8;
  push(sb, 'preflop', 'sb', put(sb, 1));
  push(bbSeat, 'preflop', 'bb', put(bbSeat, 2));
  dead.set(bbSeat, 2);
  push(bbSeat, 'preflop', 'ante', 2, false, true);
  const pre = [...order.slice(2), sb, bbSeat];
  let opened = false;
  for (const seat of pre) {
    if (seat === SLOWPLAY_HERO) {
      push(seat, 'preflop', 'raise', put(seat, open), true);
      opened = true;
    } else if (!live.has(seat)) {
      push(seat, 'preflop', 'fold', 0);
      folded.add(seat);
    } else if (opened) push(seat, 'preflop', 'call', put(seat, open));
    else if (seat !== bbSeat) push(seat, 'preflop', 'call', put(seat, 2));
  }
  // Limpers before the open, and the blinds, complete to the open.
  for (const seat of pre)
    if (live.has(seat) && seat !== SLOWPLAY_HERO && (bet.get(seat) ?? 0) < open)
      push(seat, 'preflop', 'call', put(seat, open));
  const street = STREETS[s.board.length / 2 - 3];
  if (!street) throw new Error(`board ${s.board} is not a flop, turn or river`);
  const liveOrder = order.filter((x) => live.has(x));
  for (const earlier of STREETS.slice(0, STREETS.indexOf(street))) {
    for (const x of SEATS) bet.set(x, 0);
    if (s.line === 'hero_bets') {
      const b = Math.max(BB, Math.round(pot() * 0.66));
      for (const seat of liveOrder) {
        if (seat === SLOWPLAY_HERO) {
          push(seat, earlier, 'bet', put(seat, b), true);
          break;
        }
        push(seat, earlier, 'check', 0);
      }
      const at = liveOrder.indexOf(SLOWPLAY_HERO);
      for (const seat of [...liveOrder.slice(at + 1), ...liveOrder.slice(0, at)])
        push(seat, earlier, 'call', put(seat, b));
    } else for (const seat of liveOrder) push(seat, earlier, 'check', 0);
  }
  for (const x of SEATS) bet.set(x, 0);
  const potBefore = pot();
  let toCall = 0;
  if (s.bettor !== undefined) {
    if (!live.has(s.bettor) || s.bettor === SLOWPLAY_HERO) throw new Error('bettor is not live');
    const amount = Math.max(BB, Math.round(potBefore * (s.betFrac ?? 1)));
    const at = liveOrder.indexOf(s.bettor);
    const hero = liveOrder.indexOf(SLOWPLAY_HERO);
    for (const seat of liveOrder.slice(0, at)) push(seat, street, 'check', 0);
    push(s.bettor, street, 'bet', put(s.bettor, amount), true);
    // After the bettor, up to the hero: the seats between call.
    const between =
      hero > at
        ? liveOrder.slice(at + 1, hero)
        : [...liveOrder.slice(at + 1), ...liveOrder.slice(0, hero)];
    for (const seat of between) push(seat, street, 'call', put(seat, amount));
    toCall = amount;
  } else
    for (const seat of liveOrder) {
      if (seat === SLOWPLAY_HERO) break;
      push(seat, street, 'check', 0);
    }
  const heroStack = r2(stack0 - (total.get(SLOWPLAY_HERO) ?? 0));
  const potNow = pot();
  const potRaiseTo = toCall + potNow + toCall;
  const node: ComplaintAction = {
    ord: ++ord,
    seat: SLOWPLAY_HERO,
    stage: street,
    action: toCall > 0 ? 'call' : 'check',
    amount: toCall,
    origin: 'horse_policy',
    isFullRaise: false,
    dead: false,
    publicNode: {
      pot: potNow,
      ante: 2,
      anteType: 'big_blind',
      mode: s.mode ?? 'cash',
      seats: SEATS.map((x) => [
        x,
        r2(stack0 - (total.get(x) ?? 0) - (dead.get(x) ?? 0)),
        bet.get(x) ?? 0,
        r2((total.get(x) ?? 0) + (dead.get(x) ?? 0)),
        dead.get(x) ?? 0,
        0,
        folded.has(x) ? 1 : 0,
      ]),
      boards: [s.board],
      street,
      toCall,
      currentBet: toCall,
      minRaiseTo: toCall > 0 ? Math.min(2 * toCall, heroStack) : Math.min(BB, heroStack),
      maxRaiseTo: Math.min(toCall > 0 ? potRaiseTo : potNow, heroStack),
      legalActions:
        toCall > 0 ? ['fold', 'call', 'raise', 'all_in'] : ['fold', 'check', 'bet', 'all_in'],
      dealerSeat: dealer,
      chipUnit: 0.01,
      bigBlind: BB,
      smallBlind: 1,
      variant,
      structure: 'pot_limit',
      actorSeat: SLOWPLAY_HERO,
      bombPot: false,
      tournamentStage: null,
    } as never,
  };
  const fixture = {
    version: 1,
    slug: 'slowplay-mix-spot',
    title: 'Slowplay Mix Spot',
    complaint: '',
    handId: 'slowplay-mix-spot',
    fmt: 'cash',
    variant,
    players: SEATS.map((seat) => ({ seat, isHorse: seat !== 1 })),
    hole: { [String(SLOWPLAY_HERO)]: [] as never[] },
    actions: [...actions, node],
    forbidden: [],
    seeds: [],
    control: null,
  } as unknown as ComplaintFixture;
  const SUIT: Record<string, string> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
  (fixture.hole as Record<string, unknown>)[String(SLOWPLAY_HERO)] = (
    s.hole.match(/../g) ?? []
  ).map((c) => ({ rank: c[0], suit: SUIT[c[1]] }));
  return { ...stateAt(fixture, node), potBefore };
}
export type SlowplayState = ReturnType<typeof slowplayState>;

const LIVE = replayProfiles('cash').find((p) => p.live)!;

export function slowplayDecide(
  st: SlowplayState,
  opts: HorseDecideOpts,
  seed: number
): HorseDecision {
  seedFastRandom(seed);
  return structuredClone(HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, opts));
}

const stat = (mean: number, engaged: 'high' | 'low' | null = null) => ({
  mean,
  n: 40,
  engaged,
  excess: engaged ? 0.5 : 0,
});

/** Measured reads of one opponent (HorseMind.omahaReadConditionalOf), by name. */
export const SLOWPLAY_READS: Record<string, OmahaReadConditional | null> = {
  unknown: null,
  aggressor: {
    hands: 60,
    measured: true,
    tightReRaiser: false,
    wideReRaiser: false,
    valueLeader: false,
    postflopAggressor: true,
    threeBet: stat(0.05),
    betCheckedTo: stat(0.75, 'high'),
    foldToBet: stat(0.45),
    riverCall: stat(0.3),
  } as OmahaReadConditional,
  station: {
    hands: 60,
    measured: true,
    tightReRaiser: false,
    wideReRaiser: false,
    valueLeader: false,
    postflopAggressor: false,
    threeBet: stat(0.03),
    betCheckedTo: stat(0.25),
    foldToBet: stat(0.15, 'low'),
    riverCall: stat(0.65, 'high'),
  } as OmahaReadConditional,
  passive: {
    hands: 60,
    measured: true,
    tightReRaiser: false,
    wideReRaiser: false,
    valueLeader: true,
    postflopAggressor: false,
    threeBet: stat(0.03),
    betCheckedTo: stat(0.2, 'low'),
    foldToBet: stat(0.55),
    riverCall: stat(0.25),
  } as OmahaReadConditional,
};

/** The planned release set of 2026-11-15 (every PLO strategy option of the day's catalogue but the held small-blind steal). */
export const SLOWPLAY_RELEASE_SET: HorseDecideOpts = {
  horseActionTimeIsPublicOnly: true,
  omahaBareOverpairOopFlopCheck: true,
  omahaBigBetIsPotShare: true,
  omahaBigDrawAggression: true,
  omahaBluffCatcherFoldVsValueLeader: true,
  omahaCardImpact: true,
  omahaEliteContinuesVsMeasuredWideThreeBettor: true,
  omahaFacingBetEv: true,
  omahaMadeHandDefenseVsValueLeader: true,
  omahaManiacReRaiseWidthMeasured: true,
  omahaNoCallColdFourBetWithoutPremium: true,
  omahaNoDrawRaiseOutOfPosition: true,
  omahaOopReraisedPotStrongRange: true,
  omahaOopTurnCheckAfterFlopCall: true,
  omahaOverpairNoOopBarrelVsValueLeader: true,
  omahaPairedBoardFoldRespectsPrice: true,
  omahaPairedRiverNoThinLeadVsValueLeader: true,
  omahaPairedTurnNoBarrelWithoutBoatVsValueLeader: true,
  omahaPressureNeedsPostflopAggression: true,
  omahaReraiseRangeEarlyPosition: true,
  omahaReraiseRangeOutOfPosition: true,
  omahaReraisedFoldVsTight: true,
  omahaReraisedPotFlopContinueNeedsEquityShape: true,
  omahaRiverMediumBetStrongHandCalls: true,
  omahaRiverNutBlockerBluffReachable: true,
  omahaStreetPlan: true,
  omahaStrongHandValue: true,
  omahaTurnBetNeedsRiverPlan: true,
  omahaTurnRiverRaiseNeedsNuts: true,
  omahaUnderpairNoMultiwayFlopContinue: true,
  omahaVpipFloorByLimp: true,
};
