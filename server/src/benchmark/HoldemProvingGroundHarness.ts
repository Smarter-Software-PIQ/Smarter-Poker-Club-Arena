/**
 * Offline Paired Duplicate-Deal Hold'em Proving Ground Harness (V87 / V87.1).
 *
 * Executes real `HandController` deals with:
 * - Pre-`start()` `Deck` instance replacement so Arm A and seat-swapped Arm B receive
 *   identical hole-card assignments AND identical community runouts from one valid
 *   52-card permutation (zero duplicate cards, zero runout divergence).
 * - Full `ALL_IN_RUNOUT -> continueRunout()` settlement loop so every pre-river all-in,
 *   short all-in non-reopening pot, and multi-way side pot settles to `HAND_COMPLETE`.
 * - Authoritative `asset: 'diamonds'` whole-unit validation and zero-percent rake config
 *   on Diamond cash cells, and `5% / 3bb` `noFlopNoDrop` chip rake on chip cash cells.
 * - Complete `gs.tournament` structured context (`schemaVersion: 1`, `m`, `payoutPct`,
 *   `spotsPaid`, `bountyFactor`, `bountyByUser`) on tournament, bubble, and PKO cells.
 * - Production `resolveHorseHybridProfile` (`grinder` cash / `tricky` tournament) and
 *   deterministic `holdemPersonaFor` Horse IDs.
 * - Eliminated (`stack <= 0`) and sitting-out (`is_sitting_out: true`) seat handling.
 * - Current-source V87-enabled vs V87-disabled paired net extraction, including a
 *   synthetic conditional-aggression LAG opponent and positional VPIP/PFR/3-bet counts.
 *   These toggles are not historical V86. Individual feature ablations require
 *   separately specified cells; the standard matrix does not include them.
 */
import { horseVariantRulesFor } from '../engine/VariantRules.js';
import { HandController } from '../engine/HandController.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from '../engine/HorseLogic.js';
import { resolveHorseHybridProfile } from '../engine/HorseHybridProfile.js';
import { HorseMind, readScopeOf } from '../engine/HorseMind.js';
import { buildTournamentMState } from '../engine/HorseTournamentPreflop.js';
import { drainFires, enableBrainTelemetry } from '../engine/BrainTelemetry.js';
import { restoreFastRandom, saveFastRandom, seedFastRandom } from '../engine/HorseEval.js';
import { RANKS, SUITS } from '../engine/PokerEngine.js';
import type { ActionType, Card, HandConfig, HandEvent, SeatPlayer } from '../types.js';

export type PositionalBand = 'EP' | 'MP' | 'CO' | 'BTN' | 'SB' | 'BB';

export interface ProvingGroundCellSpec {
  readonly id: string;
  readonly seats: number;
  readonly stackBB: number;
  readonly stackBySeatBB?: readonly number[];
  readonly sittingOutSeats?: readonly number[];
  readonly sb: number;
  readonly bb: number;
  readonly isDiamondCash?: boolean;
  /** Actual posted chips, in the same units as sb and bb. */
  readonly straddleAmount?: number;
  readonly mode: 'cash' | 'tournament';
  readonly tournamentStage?: 'early' | 'middle' | 'bubble' | 'itm';
  readonly bountyFactor?: number;
  readonly anteBB?: number;
  readonly matchup: 'v87_on_vs_off' | 'v87_on_off_vs_lag80' | 'v87_vs_v87_null' | 'ablation_vs_v87';
  readonly candidateOpts?: Partial<HorseDecideOpts>;
  readonly baselineOpts?: Partial<HorseDecideOpts>;
  readonly pairedDeals: number;
  readonly seed: number;
}

export interface PositionalCounters {
  deals: number;
  rfiOpps: number;
  rfiOpens: number;
  limps: number;
  vpip: number;
  pfr: number;
  threeBetOpps: number;
  threeBets: number;
}

export interface SingleArmResult {
  completed: boolean;
  candidateNetBB: number;
  baselineNetBB: number;
  lag80NetBB: number;
  rakeBB: number;
  driftChips: number;
  illegalActions: number;
  candidateDeals: number;
  candidateVpip: number;
  candidatePfr: number;
  candidateThreeBets: number;
  candidateThreeBetOpps: number;
  sawFlopPlayers: number;
  allInRunouts: number;
  sidePotCount: number;
  positional: Record<PositionalBand, PositionalCounters>;
  dealtHoleCardsBySeat: Record<number, string[]>;
  communityCards: string[];
}

export interface CellBenchmarkSummary {
  cellId: string;
  matchup: ProvingGroundCellSpec['matchup'];
  seats: number;
  stackBB: number;
  blinds: string;
  mode: 'cash' | 'tournament';
  pairedDeals: number;
  handsCompleted: number;
  bbPer100: number;
  ci95LowBBPer100: number;
  ci95HighBBPer100: number;
  lagMatchupRates?: {
    v87PostRakeBBPer100: number;
    flagOffPostRakeBBPer100: number;
    pairedFlagOnOverOffBBPer100: number;
  };
  tailRiskP05BB: number;
  tailRiskP01BB: number;
  v87VpipPct: number | null;
  v87PfrPct: number | null;
  v87ThreeBetPct: number | null;
  positionalStats: Record<
    PositionalBand,
    {
      deals: number;
      vpipPct: number | null;
      pfrPct: number | null;
      rfiPct: number | null;
      openLimpPct: number | null;
      threeBetPct: number | null;
    }
  >;
  threeWayFlopSharePct: number;
  fourPlusWayFlopSharePct: number;
  allInRunouts: number;
  sidePots: number;
  rakeCollectedBB: number;
  illegalActions: number;
  maxChipDrift: number;
}

export const LAG80_OPPONENT_ID = '88000000-0000-4000-8000-000000804832';

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REFERENCE_DECK: readonly Card[] = (() => {
  const out: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      out.push({ rank, suit });
    }
  }
  return Object.freeze(out);
})();

export function dealShuffledDeck(rng: () => number): Card[] {
  const copy = REFERENCE_DECK.map((c) => ({ ...c }));
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }
  return copy;
}

export function freshPositionalMap(): Record<PositionalBand, PositionalCounters> {
  const bands: PositionalBand[] = ['EP', 'MP', 'CO', 'BTN', 'SB', 'BB'];
  return Object.fromEntries(
    bands.map((b) => [
      b,
      {
        deals: 0,
        rfiOpps: 0,
        rfiOpens: 0,
        limps: 0,
        vpip: 0,
        pfr: 0,
        threeBetOpps: 0,
        threeBets: 0,
      },
    ])
  ) as Record<PositionalBand, PositionalCounters>;
}

export function seatPositionalBand(
  seat: number,
  dealerSeat: number,
  activeSeatsInClockwiseFromAfterBtn: readonly number[]
): PositionalBand {
  const n = activeSeatsInClockwiseFromAfterBtn.length;
  const idx = activeSeatsInClockwiseFromAfterBtn.indexOf(seat);
  if (idx === -1) return 'MP';
  if (n === 2) {
    return seat === dealerSeat ? 'SB' : 'BB';
  }
  if (idx === 0) return 'SB';
  if (idx === 1) return 'BB';
  if (idx === n - 1) return 'BTN';
  if (idx === n - 2) return 'CO';
  const rem = n - 4; // non-blind, non-CO, non-BTN
  const pos = idx - 2;
  const epCount = Math.max(1, Math.ceil(rem / 2));
  return pos < epCount ? 'EP' : 'MP';
}

export function seedLag80Reads(seats: number, bb: number): void {
  const scope = readScopeOf('nlh', seats);
  const players = Array.from({ length: seats }, (_, i) => ({
    seat: i + 1,
    user_id: i === 0 ? LAG80_OPPONENT_ID : `seed-horse-${i}`,
    username: `S${i + 1}`,
    stack: 200 * bb,
    bet: 0,
    totalInvested: 0,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  }));
  for (let h = 0; h < 60; h++) {
    const preActions: Array<Record<string, unknown>> = [];
    if (h % 20 < 16) {
      preActions.push({
        seat: 1,
        userId: LAG80_OPPONENT_ID,
        stage: 'preflop',
        action: h % 25 < 12 ? 'raise' : 'call',
        amount: h % 25 < 12 ? 3.5 * bb : bb,
        isFullRaise: h % 25 < 12,
        timestamp: h * 10 + 1,
      });
    } else {
      preActions.push({
        seat: 1,
        userId: LAG80_OPPONENT_ID,
        stage: 'preflop',
        action: 'fold',
        amount: 0,
        timestamp: h * 10 + 1,
      });
    }
    if (h % 25 < 8) {
      preActions.unshift({
        seat: 2,
        userId: 'seed-horse-1',
        stage: 'preflop',
        action: 'raise',
        amount: 2.5 * bb,
        isFullRaise: true,
        timestamp: h * 10,
      });
      preActions[1] = {
        seat: 1,
        userId: LAG80_OPPONENT_ID,
        stage: 'preflop',
        action: 'raise',
        amount: 9 * bb,
        isFullRaise: true,
        timestamp: h * 10 + 1,
      };
    }
    const flopActions: Array<Record<string, unknown>> = [];
    if (h < 40) {
      flopActions.push({
        seat: 2,
        userId: 'seed-horse-1',
        stage: 'flop',
        action: 'check',
        amount: 0,
        timestamp: h * 10 + 2,
      });
      flopActions.push({
        seat: 1,
        userId: LAG80_OPPONENT_ID,
        stage: 'flop',
        action: h % 10 < 7 ? 'bet' : 'check',
        amount: h % 10 < 7 ? 4 * bb : 0,
        timestamp: h * 10 + 3,
      });
    }
    const allActions = [...preActions, ...flopActions];
    HorseMind.observe(allActions as never, players as never, undefined, seats, bb);
    HorseMind.observeHandComplete(`lag80-seed-${seats}-${h}`, allActions as never, bb, null, scope);
  }
}

function lag80Decide(
  actor: SeatPlayer,
  auth: {
    legalActions: ActionType[];
    toCall: number;
    minRaiseTo?: number | null;
    maxRaiseTo?: number | null;
    maxBet?: number;
  },
  stage: string,
  bb: number,
  pot: number,
  rng: () => number
): { action: ActionType; amount?: number } {
  const u = rng();
  const canCheck = auth.legalActions.includes('check');
  const canCall = auth.legalActions.includes('call');
  const canBet = auth.legalActions.includes('bet');
  const canRaise = auth.legalActions.includes('raise');
  const canAllIn = auth.legalActions.includes('all_in');

  if (stage === 'preflop') {
    if (auth.toCall <= bb) {
      if (u < 0.48 && canRaise && auth.minRaiseTo != null) {
        const cap = auth.maxRaiseTo ?? actor.stack + actor.bet;
        const target = Math.min(cap, Math.max(auth.minRaiseTo, bb * 3.5));
        return { action: 'raise', amount: target };
      }
      if (u < 0.8) {
        if (canCheck) return { action: 'check' };
        if (canCall) return { action: 'call' };
      }
      return canCheck ? { action: 'check' } : { action: 'fold' };
    }
    if (u < 0.32 && canRaise && auth.minRaiseTo != null && auth.toCall <= bb * 12) {
      const cap = auth.maxRaiseTo ?? actor.stack + actor.bet;
      const target = Math.min(cap, Math.max(auth.minRaiseTo, (actor.bet + auth.toCall) * 3));
      return { action: 'raise', amount: target };
    }
    if (u < 0.68 && auth.toCall <= actor.stack * 0.35) {
      if (canCall) return { action: 'call' };
      if (canAllIn) return { action: 'all_in' };
    }
    return canCheck ? { action: 'check' } : { action: 'fold' };
  }

  if (canCheck) {
    const stabProb = stage === 'flop' ? 0.7 : stage === 'turn' ? 0.42 : 0.28;
    if (u < stabProb && canBet) {
      const maxBet = auth.maxBet ?? actor.stack;
      const rawAmt = Math.min(maxBet, Math.max(bb, Math.round(pot * 0.6 * 100) / 100));
      if (rawAmt >= actor.stack && canAllIn) return { action: 'all_in' };
      return { action: 'bet', amount: rawAmt };
    }
    return { action: 'check' };
  }
  if (u < 0.42 && auth.toCall <= pot * 0.9) {
    if (canCall) return { action: 'call' };
    if (canAllIn && auth.toCall <= actor.stack) return { action: 'all_in' };
  }
  return canCheck ? { action: 'check' } : { action: 'fold' };
}

function buildTournamentContext(
  cell: ProvingGroundCellSpec,
  hero: SeatPlayer,
  dealtPlayers: readonly SeatPlayer[]
): NonNullable<HorseGameStateV2['tournament']> {
  const stage = cell.tournamentStage ?? 'middle';
  const isPko = (cell.bountyFactor ?? 0) > 0;
  const entrants = 54;
  const spotsPaid = 9;
  const playersLeft = stage === 'bubble' ? 10 : stage === 'itm' ? 7 : 24;
  const tableTotals = dealtPlayers.map((p) => p.stack + p.totalInvested);
  const avgTableStack = tableTotals.reduce((a, b) => a + b, 0) / Math.max(1, tableTotals.length);
  const extraStacks: number[] = [];
  for (let i = tableTotals.length; i < playersLeft; i++) {
    const mult = stage === 'bubble' && i % 3 === 0 ? 0.55 : 1.05;
    extraStacks.push(Math.max(cell.bb * 4, Math.round(avgTableStack * mult)));
  }
  const allStacks = [...tableTotals, ...extraStacks];
  const payoutPct = [30, 19, 13.5, 9.5, 7, 5.5, 4.5, 3.8, 3.2];
  const anteChips = cell.anteBB ? Math.round(cell.anteBB * cell.bb) : 0;
  const nextSb = Math.round(cell.sb * 1.25);
  const nextBb = Math.round(cell.bb * 1.25);
  const nextAnte = anteChips > 0 ? nextBb : 0;
  const bountyByUser = Object.fromEntries(dealtPlayers.map((p) => [p.user_id, isPko ? 1000 : 0]));
  const m = buildTournamentMState({
    stackChips: hero.stack,
    smallBlind: cell.sb,
    bigBlind: cell.bb,
    ante: anteChips,
    anteType: anteChips > 0 ? 'big_blind' : 'none',
    playersAtTable: dealtPlayers.length,
    nextSmallBlind: nextSb,
    nextBigBlind: nextBb,
    nextAnte,
    minutesToNextLevel: 4,
  });

  return {
    schemaVersion: 1,
    contextStatus: 'complete',
    contextIssues: [],
    sourceAgeMs: 0,
    tournamentId: `pg-${cell.id}`,
    playersLeft,
    entrants,
    spotsPaid,
    payoutPct,
    stacks: allStacks,
    stackByUser: Object.fromEntries(
      dealtPlayers.map((p) => [p.user_id, p.stack + p.totalInvested])
    ),
    currentSmallBlind: cell.sb,
    currentBigBlind: cell.bb,
    currentAnte: anteChips,
    anteType: anteChips > 0 ? 'big_blind' : 'none',
    playersAtTable: dealtPlayers.length,
    seatsPerTable: cell.seats,
    nextSmallBlind: nextSb,
    nextBigBlind: nextBb,
    nextAnte,
    nextBlindInMin: 4,
    currentLevel: stage === 'bubble' ? 11 : 7,
    levelDurationMin: 8,
    levelElapsedMin: 4,
    prizePoolCents: entrants * 2000,
    bountyPoolCents: isPko ? entrants * 1000 : 0,
    satellite: false,
    satelliteSeats: 0,
    isPko,
    isBounty: isPko,
    isMysteryBounty: false,
    mysteryBountyStage: 'none',
    mysteryMeanCents: 0,
    meanBountyCents: isPko ? 1000 : 0,
    bountyByUser,
    bountyFactor: cell.bountyFactor ?? 0,
    reentryOpen: false,
    rebuyOpen: false,
    addOnPeriodOpen: false,
    reloadsUsed: 0,
    addOnTaken: false,
    rebuyAffordable: false,
    addOnAffordable: false,
    maxReentries: 0,
    maxRebuys: 0,
    m,
  };
}

export function runPairedArmHand(
  cell: ProvingGroundCellSpec,
  deckTemplate: readonly Card[],
  dealerSeat: number,
  swapArm: boolean,
  decisionSeed: number,
  recordTelemetry = false
): SingleArmResult {
  // A fresh public-memory bank per arm prevents policy plans or observations
  // from the first arm, previous deal, or another cell reaching its comparator.
  return HorseMind.runInSandbox(HorseMind.createSandbox(), () => {
    if (cell.matchup === 'v87_on_off_vs_lag80') seedLag80Reads(cell.seats, cell.bb);
    return runIsolatedArmHand(
      cell,
      deckTemplate,
      dealerSeat,
      swapArm,
      decisionSeed,
      recordTelemetry
    );
  });
}

function runIsolatedArmHand(
  cell: ProvingGroundCellSpec,
  deckTemplate: readonly Card[],
  dealerSeat: number,
  swapArm: boolean,
  decisionSeed: number,
  recordTelemetry = false
): SingleArmResult {
  if (
    deckTemplate.length !== 52 ||
    new Set(deckTemplate.map((c) => `${c.rank}:${c.suit}`)).size !== 52 ||
    deckTemplate.some((c) => !RANKS.includes(c.rank) || !SUITS.includes(c.suit))
  ) {
    throw new Error(`Expected 52-card deck template, got ${deckTemplate.length}`);
  }
  const sittingOutSet = new Set(cell.sittingOutSeats ?? []);
  type SeatRole = 'candidate' | 'baseline' | 'lag80';
  const seatAssignments: SeatRole[] = [];
  for (let i = 0; i < cell.seats; i++) {
    if (cell.matchup === 'v87_on_off_vs_lag80') {
      if (i === 0) seatAssignments.push('lag80');
      else seatAssignments.push(swapArm ? 'baseline' : 'candidate');
    } else {
      const evenSeat = i % 2 === 0;
      const isCandidate = swapArm ? !evenSeat : evenSeat;
      seatAssignments.push(isCandidate ? 'candidate' : 'baseline');
    }
  }

  const unitInteger = cell.isDiamondCash === true || cell.mode === 'tournament';
  const players: SeatPlayer[] = [];
  const startStackByUser = new Map<string, number>();
  const roleByUser = new Map<string, SeatRole>();

  for (let idx = 0; idx < cell.seats; idx++) {
    const seat = idx + 1;
    const rawBB = cell.stackBySeatBB?.[idx] ?? cell.stackBB;
    if (rawBB <= 0) {
      // Eliminated player: omitted from table seats, never dealt or prompted.
      continue;
    }
    const stackChips = unitInteger
      ? Math.round(rawBB * cell.bb)
      : Math.round(rawBB * cell.bb * 100) / 100;
    const role = seatAssignments[idx]!;
    // Seat-deterministic Horse UUIDs so Arm A & Arm B apply identical persona hashes per seat!
    const uid =
      role === 'lag80'
        ? LAG80_OPPONENT_ID
        : `00000000-0000-4000-8000-${String(seat * 103 + 1001).padStart(12, '0')}`;
    startStackByUser.set(uid, stackChips);
    roleByUser.set(uid, role);
    players.push({
      seat,
      user_id: uid,
      username: `${role}_${seat}`,
      stack: stackChips,
      bet: 0,
      totalInvested: 0,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: sittingOutSet.has(seat),
    });
  }

  const initialTotalChips = players.reduce((s, p) => s + p.stack, 0);
  const rakeConfig =
    cell.mode === 'cash' && !cell.isDiamondCash
      ? { percent: 5, cap: cell.bb * 3, noFlopNoDrop: true }
      : { percent: 0, cap: 0, noFlopNoDrop: true };

  const activeEligibleSeats = players
    .filter((p) => !p.is_sitting_out && p.stack > 0)
    .map((p) => p.seat)
    .sort((a, b) => a - b);

  const clockwiseFromAfterBtn: number[] = [];
  if (activeEligibleSeats.length >= 2) {
    let cur = dealerSeat;
    for (let k = 0; k < activeEligibleSeats.length; k++) {
      const greater = activeEligibleSeats.filter((s) => s > cur);
      const next = greater.length > 0 ? greater[0]! : activeEligibleSeats[0]!;
      clockwiseFromAfterBtn.push(next);
      cur = next;
    }
  }

  const utgSeat = clockwiseFromAfterBtn.length >= 4 ? clockwiseFromAfterBtn[2] : undefined;

  const anteChips = cell.anteBB
    ? unitInteger
      ? Math.round(cell.anteBB * cell.bb)
      : Math.round(cell.anteBB * cell.bb * 100) / 100
    : 0;

  const config: HandConfig = {
    tableId: `pg-${cell.id}`,
    handNumber: 1,
    gameVariant: 'nlh',
    isTournament: cell.mode === 'tournament',
    ...(cell.isDiamondCash ? { asset: 'diamonds' as const } : {}),
    smallBlind: cell.sb,
    bigBlind: cell.bb,
    ante: anteChips,
    bigBlindAnte: anteChips > 0,
    ...(cell.straddleAmount && utgSeat !== undefined
      ? { straddles: [{ seat: utgSeat, amount: cell.straddleAmount }] }
      : {}),
    rakeConfig,
  };

  const hc = new HandController(config, players, dealerSeat);

  // Override isolated controller deck BEFORE `hc.start()` so hole cards and community
  // runouts come strictly from the single 52-card permutation `deckCopy`!
  const deckCopy = deckTemplate.map((c) => ({ ...c }));
  const deckInstance = hc.getState().deck as unknown as {
    deal(n?: number): Card[];
    dealOne(): Card;
    remaining(): number;
    getRemainingCards(): Card[];
  };
  deckInstance.deal = (n = 1) => {
    if (deckCopy.length < n) {
      throw new Error(
        `Proving Ground deck exhausted (requested ${n}, remaining ${deckCopy.length})`
      );
    }
    return deckCopy.splice(0, n);
  };
  deckInstance.dealOne = () => deckInstance.deal(1)[0]!;
  deckInstance.remaining = () => deckCopy.length;
  deckInstance.getRemainingCards = () => deckCopy.slice();

  let completed = false;
  let runoutPending = false;
  let allInRunouts = 0;
  let rakeCollected = 0;
  let bbjCollected = 0;
  let sidePotCount = 0;
  let sawFlopPlayers = 0;
  let recordedFlop = false;

  hc.onEvent((ev: HandEvent) => {
    if (ev.type === 'COMMUNITY_CARDS' && ev.stage === 'flop' && !recordedFlop) {
      recordedFlop = true;
      sawFlopPlayers = hc
        .getState()
        .players.filter((p) => p.cards.length > 0 && !p.is_folded).length;
    }
    if (ev.type === 'ALL_IN_RUNOUT') {
      runoutPending = true;
      allInRunouts++;
    }
    if (ev.type === 'WINNERS' && Array.isArray(ev.perPotAwards) && ev.perPotAwards.length > 1) {
      sidePotCount = Math.max(sidePotCount, ev.perPotAwards.length - 1);
    }
    if (ev.type === 'HAND_COMPLETE') {
      completed = true;
      rakeCollected = Number(ev.rake ?? 0);
      bbjCollected = Number(ev.bbjFee ?? 0);
    }
  });

  hc.start();

  const dealtSnapshot = hc.getState();
  const dealtHoleCardsBySeat: Record<number, string[]> = {};
  const dealtSeatIds: number[] = [];
  for (const p of dealtSnapshot.players) {
    if (p.cards.length > 0) {
      dealtHoleCardsBySeat[p.seat] = p.cards.map((c) => `${c.rank}${c.suit}`);
      dealtSeatIds.push(p.seat);
    }
  }

  const lagRng = mulberry32((decisionSeed ^ 0x9e3779b9) >>> 0);
  const savedFastRng = saveFastRandom();
  seedFastRandom(decisionSeed);

  const positional = freshPositionalMap();
  const vpipByUser = new Set<string>();
  const pfrByUser = new Set<string>();
  const threeBetByUser = new Set<string>();
  const threeBetOppUsers = new Set<string>();
  const firstPreflopOpportunityRecorded = new Set<string>();

  let illegalActions = 0;

  try {
    for (let step = 0; step < 260 && !completed; step++) {
      if (runoutPending) {
        runoutPending = false;
        hc.continueRunout();
        continue;
      }
      const st = hc.getState();
      if (st.stage === 'showdown') {
        break;
      }
      if (st.stage === 'flop' && !recordedFlop) {
        recordedFlop = true;
        sawFlopPlayers = st.players.filter(
          (p) => dealtSeatIds.includes(p.seat) && !p.is_folded
        ).length;
      }
      const seat = st.currentPlayerSeat;
      if (seat === null || seat <= 0) {
        break;
      }
      const actor = st.players.find((p) => p.seat === seat);
      if (!actor) break;
      if (actor.is_sitting_out) {
        throw new Error(`Sitting-out seat ${seat} was prompted to act`);
      }
      const auth = hc.getAuthoritativeActionState(actor.user_id);
      if (!auth || !auth.canAct) break;

      const role = roleByUser.get(actor.user_id)!;
      const band = seatPositionalBand(seat, dealerSeat, clockwiseFromAfterBtn);

      const preVoluntaryRaises = st.actionHistory.filter(
        (a) =>
          a.stage === 'preflop' &&
          (a.action === 'raise' ||
            a.action === 'bet' ||
            (a.action === 'all_in' && a.isFullRaise === true))
      ).length;
      const preVoluntaryLimps = st.actionHistory.filter(
        (a) => a.stage === 'preflop' && a.action === 'call'
      ).length;
      const isUnopenedFirstIn =
        st.stage === 'preflop' &&
        preVoluntaryRaises === 0 &&
        preVoluntaryLimps === 0 &&
        !firstPreflopOpportunityRecorded.has(actor.user_id);

      if (role === 'candidate' && st.stage === 'preflop') {
        if (!firstPreflopOpportunityRecorded.has(actor.user_id)) {
          firstPreflopOpportunityRecorded.add(actor.user_id);
          if (isUnopenedFirstIn && band !== 'BB') {
            positional[band].rfiOpps++;
          }
        }
        if (preVoluntaryRaises === 1 && !threeBetOppUsers.has(actor.user_id)) {
          threeBetOppUsers.add(actor.user_id);
          positional[band].threeBetOpps++;
        }
      }

      let chosen: { action: ActionType; amount?: number };
      if (role === 'lag80') {
        chosen = lag80Decide(actor, auth, st.stage, cell.bb, st.pot, lagRng);
      } else {
        const hybrid = resolveHorseHybridProfile({ style: 'hybrid' }, actor.user_id, cell.mode);
        const postedStraddle = hc.getPostedStraddleSnapshot();
        const dealtPlayersNow = st.players.filter((p) => dealtSeatIds.includes(p.seat));
        const gs: HorseGameStateV2 = {
          stateSchemaVersion: 1,
          ...hc.getChipRulesSnapshot(),
          blindSeats: hc.getBlindSeatsSnapshot(),
          rakeConfig: hc.getRakeConfigSnapshot(),
          stage: st.stage,
          gameVariant: 'nlh',
          gameMode: cell.mode,
          format: cell.mode === 'tournament' ? 'mtt' : 'cash',
          pot: st.pot,
          contestablePot: hc.getContestablePotForCall(actor.user_id) ?? st.pot,
          currentBet: st.currentBet,
          minRaise: st.minRaise,
          lastRaise: st.lastRaise,
          smallBlind: cell.sb,
          bigBlind: cell.bb,
          ante: anteChips,
          bigBlindAnte: anteChips > 0,
          dealerSeat,
          heroSeat: seat,
          currentPlayerSeat: seat,
          straddleActive: postedStraddle !== null && postedStraddle.amount > 0,
          ...(postedStraddle && postedStraddle.amount > 0
            ? { straddleAmount: postedStraddle.amount, straddleSeat: postedStraddle.seat }
            : {}),
          ...(cell.mode === 'tournament'
            ? { tournament: buildTournamentContext(cell, actor, dealtPlayersNow) }
            : {}),
          communityCards: st.communityCards,
          players: st.players.map((p) => ({
            ...p,
            cards: [],
          })),
          dealtSeatIds,
          actionHistory: st.actionHistory,
          legalActions: auth.legalActions,
          toCall: auth.toCall,
          minRaiseTo: auth.minRaiseTo,
          maxRaiseTo: auth.maxRaiseTo,
          bettingStructure: auth.structure,
          fixedBetSize: auth.fixedBetSize,
          wagersCapped: auth.wagersCapped,
          commitmentCapRemaining: null,
          pots: hc.computeLivePots(),
          variantRules: horseVariantRulesFor('nlh'),
        };

        const baseOpts: HorseDecideOpts =
          cell.matchup === 'v87_vs_v87_null'
            ? { v87HoldemOverhaul: true }
            : cell.matchup === 'ablation_vs_v87'
              ? role === 'candidate'
                ? { v87HoldemOverhaul: true, ...cell.candidateOpts }
                : { v87HoldemOverhaul: true, ...cell.baselineOpts }
              : {
                  v87HoldemOverhaul: role === 'candidate',
                  ...(role === 'candidate' ? cell.candidateOpts : cell.baselineOpts),
                };

        const dec = HorseLogic.decide(actor, gs, hybrid.style, hybrid.mods, {
          ...baseOpts,
          telemetry: recordTelemetry && role === 'candidate',
          decisionTimeMs: 1_762_855_200_000 + step * 100,
        });
        chosen = { action: dec.action, amount: dec.amount };
      }

      // Count only the action the real controller accepted, never a proposal
      // that later fell back to a different action.
      const decisionStage = st.stage;
      const beforeActions = st.actionHistory.length;
      const ok = hc.performAction(seat, chosen.action, chosen.amount);
      if (!ok) {
        illegalActions++;
        throw new Error(
          `Illegal action ${cell.id} seed=${decisionSeed} swap=${swapArm} seat=${seat}: ${JSON.stringify(chosen)}`
        );
      }
      const accepted = hc
        .getState()
        .actionHistory.slice(beforeActions)
        .find((a) => a.seat === seat && a.stage === decisionStage);
      if (!accepted) throw new Error('Accepted action is missing from controller history');

      if (role === 'candidate' && decisionStage === 'preflop') {
        const putsVoluntaryMoney =
          chosen.action === 'raise' ||
          chosen.action === 'bet' ||
          chosen.action === 'all_in' ||
          (chosen.action === 'call' && auth.toCall > 0);
        if (putsVoluntaryMoney) {
          vpipByUser.add(actor.user_id);
        }
        const isRaiseAction =
          chosen.action === 'raise' ||
          chosen.action === 'bet' ||
          (chosen.action === 'all_in' && accepted.isFullRaise === true);
        if (isRaiseAction) {
          pfrByUser.add(actor.user_id);
          if (isUnopenedFirstIn && band !== 'BB') {
            positional[band].rfiOpens++;
          }
          if (preVoluntaryRaises === 1) {
            threeBetByUser.add(actor.user_id);
            positional[band].threeBets++;
          }
        } else if (
          isUnopenedFirstIn &&
          band !== 'BB' &&
          chosen.action === 'call' &&
          auth.toCall > 0
        ) {
          positional[band].limps++;
        }
      }
    }
    if (runoutPending && !completed) {
      runoutPending = false;
      hc.continueRunout();
    }
  } finally {
    restoreFastRandom(savedFastRng);
  }

  const finalState = hc.getState();
  if (!recordedFlop && finalState.communityCards.length >= 3) {
    sawFlopPlayers = finalState.players.filter(
      (p) => dealtSeatIds.includes(p.seat) && !p.is_folded
    ).length;
  }

  const sumStacksAfter = finalState.players.reduce((s, p) => s + p.stack, 0);
  const totalAccounted = sumStacksAfter + rakeCollected + bbjCollected;
  const driftChips = Math.abs(totalAccounted - initialTotalChips);

  let candidateNetBB = 0;
  let baselineNetBB = 0;
  let lag80NetBB = 0;
  let candidateDeals = 0;
  let candidateVpip = 0;
  let candidatePfr = 0;
  let candidateThreeBets = 0;
  let candidateThreeBetOpps = 0;

  for (const p of finalState.players) {
    const startChips = startStackByUser.get(p.user_id) ?? 0;
    const netBB = (p.stack - startChips) / cell.bb;
    const role = roleByUser.get(p.user_id)!;
    const wasDealt = dealtSeatIds.includes(p.seat);
    if (role === 'candidate') {
      candidateNetBB += netBB;
      if (wasDealt) {
        candidateDeals++;
        const band = seatPositionalBand(p.seat, dealerSeat, clockwiseFromAfterBtn);
        positional[band].deals++;
        if (vpipByUser.has(p.user_id)) {
          candidateVpip++;
          positional[band].vpip++;
        }
        if (pfrByUser.has(p.user_id)) {
          candidatePfr++;
          positional[band].pfr++;
        }
        if (threeBetByUser.has(p.user_id)) candidateThreeBets++;
        if (threeBetOppUsers.has(p.user_id)) candidateThreeBetOpps++;
      }
    } else if (role === 'baseline') {
      baselineNetBB += netBB;
    } else {
      lag80NetBB += netBB;
    }
  }

  return {
    completed,
    candidateNetBB,
    baselineNetBB,
    lag80NetBB,
    rakeBB: (rakeCollected + bbjCollected) / cell.bb,
    driftChips,
    illegalActions,
    candidateDeals,
    candidateVpip,
    candidatePfr,
    candidateThreeBets,
    candidateThreeBetOpps,
    sawFlopPlayers,
    allInRunouts,
    sidePotCount,
    positional,
    dealtHoleCardsBySeat,
    communityCards: finalState.communityCards.map((c) => `${c.rank}${c.suit}`),
  };
}

export function runProvingGroundCells(
  cells: readonly ProvingGroundCellSpec[],
  options?: {
    collectTelemetry?: boolean;
    onPair?: (
      cell: ProvingGroundCellSpec,
      deal: number,
      armA: SingleArmResult,
      armB: SingleArmResult
    ) => void;
  }
): {
  totalPairedDeals: number;
  totalCompletedHands: number;
  totalIllegalActions: number;
  maxChipConservationDrift: number;
  chipConservationVerified: boolean;
  overallPairedDeltaBBPer100: number;
  overallCi95LowBBPer100: number;
  overallCi95HighBBPer100: number;
  totalRakeCollectedBB: number;
  cells: CellBenchmarkSummary[];
  aggregatePositionalCash9Max100bb: CellBenchmarkSummary['positionalStats'] | null;
  v87TelemetryFires: Record<string, number>;
} {
  const collectTelemetry = options?.collectTelemetry ?? true;
  if (collectTelemetry) {
    enableBrainTelemetry();
    drainFires();
  }

  let totalPairedDeals = 0;
  let totalCompletedHands = 0;
  let totalIllegalActions = 0;
  let maxChipDrift = 0;
  let totalRakeBB = 0;
  const allPairedDiffs: number[] = [];
  const summaries: CellBenchmarkSummary[] = [];

  for (const cell of cells) {
    const dealRng = mulberry32(cell.seed);
    const pairedDiffsBB: number[] = [];
    let cellCompletedHands = 0;
    let cellIllegal = 0;
    let cellMaxDrift = 0;
    let cellRakeBB = 0;
    let cellAllInRunouts = 0;
    let cellSidePots = 0;
    let v87Deals = 0;
    let v87Vpip = 0;
    let v87Pfr = 0;
    let v87ThreeBet = 0;
    let v87ThreeBetOpps = 0;
    let flopsSeen = 0;
    let threeWayFlops = 0;
    let fourPlusFlops = 0;
    let lagArmAV87NetSum = 0;
    let lagArmAV87Deals = 0;
    let lagArmBV86NetSum = 0;
    let lagArmBV86Deals = 0;
    const posAgg = freshPositionalMap();

    for (let d = 0; d < cell.pairedDeals; d++) {
      const deck = dealShuffledDeck(dealRng);
      const dealerSeat = (d % cell.seats) + 1;
      const decSeed = (cell.seed * 31 + d * 997) >>> 0;

      const armA = runPairedArmHand(cell, deck, dealerSeat, false, decSeed, collectTelemetry);
      const armB = runPairedArmHand(cell, deck, dealerSeat, true, decSeed, collectTelemetry);

      if (!armA.completed || !armB.completed) {
        throw new Error(
          `Incomplete hand in cell ${cell.id} deal ${d} (armA=${armA.completed}, armB=${armB.completed})`
        );
      }

      options?.onPair?.(cell, d, armA, armB);
      totalPairedDeals += 1;
      cellCompletedHands += 2;
      totalCompletedHands += 2;
      cellIllegal += armA.illegalActions + armB.illegalActions;
      totalIllegalActions += armA.illegalActions + armB.illegalActions;
      cellMaxDrift = Math.max(cellMaxDrift, armA.driftChips, armB.driftChips);
      maxChipDrift = Math.max(maxChipDrift, armA.driftChips, armB.driftChips);
      cellRakeBB += armA.rakeBB + armB.rakeBB;
      totalRakeBB += armA.rakeBB + armB.rakeBB;
      cellAllInRunouts += armA.allInRunouts + armB.allInRunouts;
      cellSidePots += armA.sidePotCount + armB.sidePotCount;

      let pairedAdvPerSeatDealBB: number;
      if (cell.matchup === 'v87_on_off_vs_lag80') {
        // Arm A: 5 V87 seats (`candidateNetBB`) vs LAG80; Arm B: 5 V86 seats (`baselineNetBB`) vs identical LAG80 on identical cards!
        const seatsPerArm = Math.max(1, armA.candidateDeals);
        lagArmAV87NetSum += armA.candidateNetBB;
        lagArmAV87Deals += armA.candidateDeals;
        lagArmBV86NetSum += armB.baselineNetBB;
        lagArmBV86Deals += seatsPerArm;
        pairedAdvPerSeatDealBB = (armA.candidateNetBB - armB.baselineNetBB) / seatsPerArm;
      } else {
        const netDiff =
          armA.candidateNetBB - armA.baselineNetBB + (armB.candidateNetBB - armB.baselineNetBB);
        const seatsCounted = armA.candidateDeals + armB.candidateDeals;
        pairedAdvPerSeatDealBB = netDiff / Math.max(1, seatsCounted);
      }
      pairedDiffsBB.push(pairedAdvPerSeatDealBB);
      if (cell.matchup !== 'v87_vs_v87_null' && cell.matchup !== 'ablation_vs_v87') {
        allPairedDiffs.push(pairedAdvPerSeatDealBB);
      }

      for (const arm of [armA, armB]) {
        v87Deals += arm.candidateDeals;
        v87Vpip += arm.candidateVpip;
        v87Pfr += arm.candidatePfr;
        v87ThreeBet += arm.candidateThreeBets;
        v87ThreeBetOpps += arm.candidateThreeBetOpps;
        for (const band of Object.keys(posAgg) as PositionalBand[]) {
          posAgg[band].deals += arm.positional[band].deals;
          posAgg[band].rfiOpps += arm.positional[band].rfiOpps;
          posAgg[band].rfiOpens += arm.positional[band].rfiOpens;
          posAgg[band].limps += arm.positional[band].limps;
          posAgg[band].vpip += arm.positional[band].vpip;
          posAgg[band].pfr += arm.positional[band].pfr;
          posAgg[band].threeBetOpps += arm.positional[band].threeBetOpps;
          posAgg[band].threeBets += arm.positional[band].threeBets;
        }
        if (arm.sawFlopPlayers >= 2) {
          flopsSeen++;
          if (arm.sawFlopPlayers === 3) threeWayFlops++;
          if (arm.sawFlopPlayers >= 4) fourPlusFlops++;
        }
      }
    }

    const n = pairedDiffsBB.length;
    const meanBBPerDeal = pairedDiffsBB.reduce((a, b) => a + b, 0) / n;
    const variance =
      pairedDiffsBB.reduce((acc, x) => acc + (x - meanBBPerDeal) * (x - meanBBPerDeal), 0) /
      Math.max(1, n - 1);
    const seBBPerDeal = Math.sqrt(variance / n);
    const sorted = pairedDiffsBB.slice().sort((a, b) => a - b);
    const p01 = sorted[Math.floor(0.01 * n)] ?? 0;
    const p05 = sorted[Math.floor(0.05 * n)] ?? 0;

    const positionalStats = Object.fromEntries(
      (Object.keys(posAgg) as PositionalBand[]).map((band) => {
        const c = posAgg[band];
        return [
          band,
          {
            deals: c.deals,
            vpipPct: c.deals > 0 ? Number(((c.vpip / c.deals) * 100).toFixed(2)) : null,
            pfrPct: c.deals > 0 ? Number(((c.pfr / c.deals) * 100).toFixed(2)) : null,
            rfiPct: c.rfiOpps > 0 ? Number(((c.rfiOpens / c.rfiOpps) * 100).toFixed(2)) : null,
            openLimpPct: c.rfiOpps > 0 ? Number(((c.limps / c.rfiOpps) * 100).toFixed(2)) : null,
            threeBetPct:
              c.threeBetOpps > 0 ? Number(((c.threeBets / c.threeBetOpps) * 100).toFixed(2)) : null,
          },
        ];
      })
    ) as CellBenchmarkSummary['positionalStats'];

    summaries.push({
      cellId: cell.id,
      matchup: cell.matchup,
      seats: cell.seats,
      stackBB: cell.stackBB,
      blinds: `${cell.sb}/${cell.bb}${cell.straddleAmount ? `/${cell.straddleAmount}` : ''}${cell.isDiamondCash ? ' Diamonds' : ''}`,
      mode: cell.mode,
      pairedDeals: cell.pairedDeals,
      handsCompleted: cellCompletedHands,
      bbPer100: Number((meanBBPerDeal * 100).toFixed(2)),
      ci95LowBBPer100: Number(((meanBBPerDeal - 1.96 * seBBPerDeal) * 100).toFixed(2)),
      ci95HighBBPer100: Number(((meanBBPerDeal + 1.96 * seBBPerDeal) * 100).toFixed(2)),
      ...(cell.matchup === 'v87_on_off_vs_lag80'
        ? {
            lagMatchupRates: {
              v87PostRakeBBPer100: Number(
                ((lagArmAV87NetSum / Math.max(1, lagArmAV87Deals)) * 100).toFixed(2)
              ),
              flagOffPostRakeBBPer100: Number(
                ((lagArmBV86NetSum / Math.max(1, lagArmBV86Deals)) * 100).toFixed(2)
              ),
              pairedFlagOnOverOffBBPer100: Number((meanBBPerDeal * 100).toFixed(2)),
            },
          }
        : {}),
      tailRiskP05BB: Number(p05.toFixed(2)),
      tailRiskP01BB: Number(p01.toFixed(2)),
      v87VpipPct: v87Deals > 0 ? Number(((v87Vpip / v87Deals) * 100).toFixed(2)) : null,
      v87PfrPct: v87Deals > 0 ? Number(((v87Pfr / v87Deals) * 100).toFixed(2)) : null,
      v87ThreeBetPct:
        v87ThreeBetOpps > 0 ? Number(((v87ThreeBet / v87ThreeBetOpps) * 100).toFixed(2)) : null,
      positionalStats,
      threeWayFlopSharePct:
        flopsSeen > 0 ? Number(((threeWayFlops / flopsSeen) * 100).toFixed(2)) : 0,
      fourPlusWayFlopSharePct:
        flopsSeen > 0 ? Number(((fourPlusFlops / flopsSeen) * 100).toFixed(2)) : 0,
      allInRunouts: cellAllInRunouts,
      sidePots: cellSidePots,
      rakeCollectedBB: Number(cellRakeBB.toFixed(2)),
      illegalActions: cellIllegal,
      maxChipDrift: Number(cellMaxDrift.toExponential(3)),
    });
  }

  const telemetryRows = collectTelemetry ? drainFires() : [];
  const v87TelemetryFires: Record<string, number> = {};
  for (const row of telemetryRows) {
    if (
      row.feature.startsWith('v87_') ||
      row.feature.startsWith('icm_') ||
      row.feature.startsWith('v60_')
    ) {
      v87TelemetryFires[row.feature] = (v87TelemetryFires[row.feature] ?? 0) + row.fires;
    }
  }

  const overallN = Math.max(1, allPairedDiffs.length);
  const overallMean = allPairedDiffs.reduce((a, b) => a + b, 0) / overallN;
  const overallVar =
    allPairedDiffs.reduce((acc, x) => acc + (x - overallMean) * (x - overallMean), 0) /
    Math.max(1, overallN - 1);
  const overallSe = Math.sqrt(overallVar / overallN);

  const cash9Max = summaries.find((s) => s.cellId === 'cash_9max_100bb_1_2');

  return {
    totalPairedDeals,
    totalCompletedHands,
    totalIllegalActions,
    maxChipConservationDrift: Number(maxChipDrift.toExponential(3)),
    chipConservationVerified: maxChipDrift < 1e-6,
    overallPairedDeltaBBPer100: Number((overallMean * 100).toFixed(2)),
    overallCi95LowBBPer100: Number(((overallMean - 1.96 * overallSe) * 100).toFixed(2)),
    overallCi95HighBBPer100: Number(((overallMean + 1.96 * overallSe) * 100).toFixed(2)),
    totalRakeCollectedBB: Number(totalRakeBB.toFixed(2)),
    cells: summaries,
    aggregatePositionalCash9Max100bb: cash9Max?.positionalStats ?? null,
    v87TelemetryFires,
  };
}
