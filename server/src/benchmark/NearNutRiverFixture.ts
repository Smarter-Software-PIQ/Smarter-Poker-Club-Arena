/**
 * NEAR-NUT RIVER FIXTURE (development only, 2026-11-08).
 *
 * `smallPotNearNutRiverValue` (HorseNearNutRiverValue.ts) is a default-off
 * feature-authority candidate whose domain is narrow: PLO4/5/6 heads-up cash,
 * single board, the hero facing a small opening river bet with a full house
 * on a board paired exactly once, at most one bigger boat live and no quads.
 * The duplicate-deal league never supplies published economics, and the
 * physical development harness reached the domain once in 2,876 pairs, so
 * the skill could not be measured.
 *
 * This module deals that spot deterministically and drives the ORIGINAL
 * decision worker with it, so the gate is measured where it actually runs:
 *
 * - The hand is played on a real HandController with the cash HandConfig
 *   built the way ServerTableEngineDealing builds one (getFullRakeConfig, the
 *   cashPolicy, player-count caps, the BBJ config the engine attaches, the
 *   chips asset). Only the deck is stacked and the public line is scripted.
 * - The river snapshot is assembled field for field like the live snapshot in
 *   ServerTableEngineTurns.scheduleHorseAction (the commitment-cap and AoF
 *   menu composition, getChipRulesSnapshot, getRakeConfigSnapshot,
 *   computeLivePots, the contestable pot, the public-seat firewall and the
 *   hybrid cash profile). The production snapshot carries no `opts`.
 * - The decision runs through HorseDecisionWorkerRuntime with the default
 *   production dependencies (every phase admission, the feature release
 *   authority, HorseLogic.decide). Only service start-up, journals and the
 *   observation clock are replaced, exactly as FeatureAblationWorker does.
 *
 * Three arms: `production` (no opts, default dependencies), `off` and `on`
 * (the offline caller-flag worker the development harness uses, with the
 * flag absent or true). The skill stays off everywhere else: this module
 * changes no default, selection or evidence file.
 *
 * No hidden card is read by any decision: the opponent's holding exists only
 * on the controller, and the snapshot strips every seat but the hero's.
 */
import { getFullRakeConfig, getPlayerCountCaps } from '../config/RakeConfig.js';
import { publishedCashPricing } from '../config/leagueCashPricing.js';
import { HandController } from '../engine/HandController.js';
import type { HorseGameStateV2 } from '../engine/HorseLogic.js';
import { HorseMind } from '../engine/HorseMind.js';
import { drainFires, enableBrainTelemetry } from '../engine/BrainTelemetry.js';
import { omahaBoatsAbove, omahaMadeClass } from '../engine/HorseEval.js';
import { smallPotNearNutRiverValue } from '../engine/HorseNearNutRiverValue.js';
import { resolveHorseHybridProfile } from '../engine/HorseHybridProfile.js';
import { publicMemoryDomainFromRules } from '../engine/HorsePublicMemoryDomain.js';
import { horseVariantRulesFor } from '../engine/VariantRules.js';
import { captureHorseHandJournalContext } from '../engine/HorseDecisionHandBinding.js';
import {
  applyAllInOrFoldActionState,
  applyTableCommitmentCap,
} from '../engine/ServerTableEngineTurns.js';
import {
  HorseDecisionWorkerRuntime,
  defaultHorseDecisionWorkerDependencies,
  type HorseDecisionWorkerDependencies,
} from '../engine/horseDecision/workerRuntime.js';
import {
  buildHorseDecisionKey,
  type FastHorseDecisionRequest,
  type FastHorseDecisionResult,
  type HorseDecisionWorkerResponse,
  type LiveHorseDecisionSnapshot,
} from '../engine/horseDecision/protocol.js';
import { HORSE_POLICY_ORDER } from '../engine/HorsePolicyGraph.js';
import { acceptedIncrementalComponents } from './FeatureAblationWorker.js';
import { FEATURE_ABLATION_POLICY_DAY_MS } from './Plo4PolicyLeague.js';
import { referenceDeck } from './OmahaReference.js';
import type { ActionRecord, ActionType, Card, HandConfig, SeatPlayer } from '../types.js';

export const NEAR_NUT_FIXTURE_VERSION = 'near-nut-river-fixture-v1';
export const NEAR_NUT_FIXTURE_VARIANTS = Object.freeze(['plo4', 'plo5', 'plo6'] as const);
export type NearNutFixtureVariant = (typeof NEAR_NUT_FIXTURE_VARIANTS)[number];
/** Development seed family 287 (SeparateRiverQualificationPlans), a fresh
 * fixture-only base. Never a declared development or reserved heldout seed. */
export const NEAR_NUT_FIXTURE_SEED = 28_707_001;
const TABLE_ID = '00000000-0000-4000-8000-000000000287';
const LEASE = '00000000-0000-4000-8000-000000000001';
const SB = 1;
const BB = 2;
const STACK_BB = 100;
const TABLE_SEATS = 6;
/** Opening river bet as a fraction of the pot before it. The domain is <= 0.5. */
export const NEAR_NUT_RIVER_BET_FRACTIONS = Object.freeze([0.25, 0.33, 0.45, 0.5]);

const HOLE: Record<NearNutFixtureVariant, number> = { plo4: 4, plo5: 5, plo6: 6 };
const ids = [
  '00000000-0000-4000-8000-000000002871',
  '00000000-0000-4000-8000-000000002872',
] as const;

function rngOf(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}
const key = (c: Card) => `${c.rank}${c.suit}`;
const cents = (n: number) => Math.round(n * 100) / 100;

/** The public line before the river decision; every size is legal by the menu. */
export interface NearNutFixtureLine {
  heroIsButton: boolean;
  preflop: 'limp' | 'raise_to_4' | 'raise_to_6';
  flop: 'check' | 'third_pot';
  riverBetFraction: number;
  opponentIsHorse: boolean;
}

export interface NearNutRiverState {
  variant: NearNutFixtureVariant;
  index: number;
  line: NearNutFixtureLine;
  heroCards: Card[];
  board: Card[];
  boatsAbove: number;
  controller: HandController;
  config: HandConfig;
  /** The live snapshot the engine would hand the worker (no opts). */
  snapshot: LiveHorseDecisionSnapshot;
  /** Whether the skill's own predicate holds on the snapshot (fixture validity). */
  inDomain: boolean;
}

/** Deterministic: a paired board (rank shape 1,1,1,2) and a hero holding whose
 * best Omaha hand is a full house with exactly one bigger boat and no quads
 * live (near-nut, not the nuts). Rejection sampled from one seeded stream. */
function dealCards(variant: NearNutFixtureVariant, index: number) {
  const rng = rngOf((NEAR_NUT_FIXTURE_SEED ^ Math.imul(index + 1, 2654435761)) >>> 0);
  const holeCount = HOLE[variant];
  for (let attempt = 0; attempt < 10_000; attempt++) {
    const deck = referenceDeck();
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const board = deck.slice(0, 5);
    const counts = new Map<string, number>();
    for (const c of board) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
    if ([...counts.values()].sort().join(',') !== '1,1,1,2') continue;
    const pair = [...counts].find(([, n]) => n === 2)![0];
    const singles = board.filter((c) => c.rank !== pair).map((c) => c.rank);
    const rest = deck.slice(5);
    // A boat needs a hole card of the board pair and one of a singleton rank.
    const pick = (pred: (c: Card) => boolean) => {
      const i = rest.findIndex(pred);
      return i < 0 ? null : rest.splice(i, 1)[0];
    };
    const p = pick((c) => c.rank === pair);
    const target = singles[Math.floor(rng() * singles.length)];
    const s = pick((c) => c.rank === target);
    if (!p || !s) continue;
    const hero = [p, s, ...rest.splice(0, holeCount - 2)];
    if (omahaMadeClass(hero, board).category !== 7) continue;
    const above = omahaBoatsAbove(hero, board);
    if (above.quads !== 0 || above.boats !== 1) continue;
    const villain = rest.splice(0, holeCount);
    return { hero, villain, board, rest, boatsAbove: above.boats, rng };
  }
  throw Error(`Near-nut fixture ${variant}#${index} found no near-nut deal`);
}

function lineFor(index: number, rng: () => number): NearNutFixtureLine {
  return {
    heroIsButton: index % 2 === 1,
    preflop: (['limp', 'raise_to_4', 'raise_to_6'] as const)[Math.floor(rng() * 3)],
    flop: rng() < 0.5 ? 'check' : 'third_pot',
    riverBetFraction: NEAR_NUT_RIVER_BET_FRACTIONS[Math.floor(rng() * 4)],
    opponentIsHorse: index % 4 < 2,
  };
}

/** The cash HandConfig, field for field as ServerTableEngineDealing builds it
 * for a 1/2 chips table with no straddle, bomb pot, ante or override. */
export function nearNutCashHandConfig(variant: NearNutFixtureVariant, index: number): HandConfig {
  const full = getFullRakeConfig(SB, BB, variant, undefined);
  return {
    asset: 'chips',
    tableId: TABLE_ID,
    handNumber: 2_870_000 + index,
    isTournament: false,
    gameVariant: variant,
    smallBlind: SB,
    bigBlind: BB,
    ante: 0,
    bigBlindAnte: false,
    allInOrFold: false,
    rakeConfig: {
      cashPolicy: { version: 1, scope: 'standard' },
      percent: full.rakePercent,
      cap: full.rakeCap,
      noFlopNoDrop: true,
      playerCountCaps: getPlayerCountCaps(full.rakeCap, TABLE_SEATS),
    },
    diamondRakeSchedule: null,
    bbjConfig: {
      enabled: full.bbjEnabled && 100 > 0,
      feeBB: full.bbjFeeBB,
      minPotBB: full.rules.minPotBB,
      minPlayersDealt: full.rules.minPlayersDealt,
    },
  };
}

/** Play the scripted public line on a real controller and build the live river snapshot. */
export function nearNutRiverState(
  variant: NearNutFixtureVariant,
  index: number
): NearNutRiverState {
  const cards = dealCards(variant, index);
  const line = lineFor(index, cards.rng);
  const config = nearNutCashHandConfig(variant, index);
  // HU: the button posts the small blind and acts first preflop, last after.
  const heroSeat = line.heroIsButton ? 1 : 2;
  const villainSeat = heroSeat === 1 ? 2 : 1;
  const players: SeatPlayer[] = [1, 2].map((seat) => ({
    seat,
    user_id: ids[seat - 1],
    username: `Seat ${seat}`,
    stack: STACK_BB * BB,
    bet: 0,
    totalInvested: 0,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: seat === heroSeat ? true : line.opponentIsHorse,
  }));
  const holes = new Map([
    [heroSeat, cards.hero],
    [villainSeat, cards.villain],
  ]);
  // Hole cards in seat order, then flop, turn and river: the controller's draw order.
  const stacked = [...holes.get(1)!, ...holes.get(2)!, ...cards.board, ...cards.rest];
  const controller = new HandController(config, players, 1);
  const deck = controller.getState().deck as unknown as {
    deal(n?: number): Card[];
    dealOne(): Card;
    remaining(): number;
    getRemainingCards(): Card[];
  };
  deck.deal = (n = 1) => {
    if (stacked.length < n) throw Error('Near-nut fixture deck exhausted');
    return stacked.splice(0, n);
  };
  deck.dealOne = () => deck.deal(1)[0];
  deck.remaining = () => stacked.length;
  deck.getRemainingCards = () => stacked.slice();
  // Action timestamps come from Date.now; pin them so the decision key, and
  // so the worker's request-keyed sampling seed, is identical on every run.
  const clockBase = FEATURE_ABLATION_POLICY_DAY_MS + index * 60_000;
  let tick = 0;
  const wall = Date.now;
  Date.now = () => clockBase + ++tick * 1000;
  try {
    controller.start();
    const act = (seat: number, action: ActionType, to?: number) => {
      const s = controller.getState();
      if (s.currentPlayerSeat !== seat) throw Error(`Fixture line out of turn at ${s.stage}`);
      const menu = controller.getAuthoritativeActionState(ids[seat - 1])!;
      let amount = to;
      if (amount !== undefined && menu.minRaiseTo !== null && menu.maxRaiseTo !== null)
        amount = cents(Math.min(menu.maxRaiseTo, Math.max(menu.minRaiseTo, amount)));
      const origin = seat === heroSeat || line.opponentIsHorse ? 'horse_policy' : 'player';
      if (!controller.performAction(seat, action, amount, origin))
        throw Error(`Fixture line refused ${action} ${amount ?? ''} at ${s.stage}`);
    };
    const button = 1;
    const bigBlind = 2;
    if (line.preflop === 'limp') {
      act(button, 'call');
      act(bigBlind, 'check');
    } else {
      act(button, 'raise', line.preflop === 'raise_to_4' ? 4 : 6);
      act(bigBlind, 'call');
    }
    // Flop: out of position first. A third-pot bet by the button is called.
    act(bigBlind, 'check');
    if (line.flop === 'third_pot') {
      act(button, 'bet', cents(Math.max(BB, controller.getState().pot / 3)));
      act(bigBlind, 'call');
    } else act(button, 'check');
    act(bigBlind, 'check');
    act(button, 'check');
    // River: the villain opens. Out of position the hero checks to it first.
    const pot = controller.getState().pot;
    const bet = cents(Math.max(BB, pot * line.riverBetFraction));
    if (!line.heroIsButton) act(heroSeat, 'check');
    act(villainSeat, 'bet', bet);
  } finally {
    Date.now = wall;
  }
  const snapshot = liveRiverSnapshot(controller, config, heroSeat, line, clockBase + 900_000);
  return {
    variant,
    index,
    line,
    heroCards: cards.hero,
    board: cards.board,
    boatsAbove: cards.boatsAbove,
    controller,
    config,
    snapshot,
    inDomain: smallPotNearNutRiverValue(snapshot.player, snapshot.gameState),
  };
}

/** ServerTableEngineTurns.scheduleHorseAction's snapshot for this cash seat
 * (no cap, no AoF, no nit floor, no straddle, no time bank). */
function liveRiverSnapshot(
  controller: HandController,
  config: HandConfig,
  seat: number,
  line: NearNutFixtureLine,
  decisionTimeMs: number
): LiveHorseDecisionSnapshot {
  const state = controller.getState({ includeActionOrigins: true });
  const authoritative = state.players.find((p) => p.seat === seat)!;
  const controllerActions = controller.getAuthoritativeActionState(authoritative.user_id)!;
  if (!controllerActions.canAct) throw Error('Near-nut fixture hero cannot act');
  const bounded = applyAllInOrFoldActionState(
    applyTableCommitmentCap(controllerActions, authoritative, false, 0, BB),
    false,
    state.stage
  );
  const contestablePot = controller.getContestablePotForCall(authoritative.user_id);
  const { style, mods } = resolveHorseHybridProfile(undefined, authoritative.user_id, 'cash');
  const player: SeatPlayer = {
    ...authoritative,
    cards: [...authoritative.cards],
    knownDeadCards: [],
    is_sitting_out: authoritative.is_sitting_out === true,
  };
  const publicPlayers: SeatPlayer[] = state.players.map((candidate) => {
    const { knownDeadCards: _private, ...publicCandidate } = candidate;
    return { ...publicCandidate, cards: [], is_sitting_out: candidate.is_sitting_out === true };
  });
  const gameState: HorseGameStateV2 = {
    stateSchemaVersion: 1,
    humanUserIds: line.opponentIsHorse
      ? []
      : state.players.filter((p) => p.seat !== seat).map((p) => p.user_id),
    dealtSeatIds: state.players
      .filter((p) => p.cards.length > 0)
      .map((p) => p.seat)
      .sort((a, b) => a - b),
    blindSeats: controller.getBlindSeatsSnapshot?.() ?? null,
    ...controller.getChipRulesSnapshot(),
    heroSeat: bounded.heroSeat,
    currentPlayerSeat: bounded.currentPlayerSeat,
    legalActions: [...bounded.legalActions],
    toCall: bounded.toCall,
    minRaiseTo: bounded.minRaiseTo,
    maxRaiseTo: bounded.maxRaiseTo,
    bettingStructure: bounded.structure,
    fixedBetSize: bounded.fixedBetSize,
    fixedLimitSmallBet: controller.getFixedLimitSmallBet?.() ?? null,
    wagersCapped: bounded.wagersCapped,
    commitmentCapRemaining: bounded.commitmentCapRemaining,
    pots: controller
      .computeLivePots()
      .map((pot) => ({ ...pot, eligiblePlayers: [...pot.eligiblePlayers] })),
    contestablePot: contestablePot!,
    rakeConfig: controller.getRakeConfigSnapshot(),
    variantRules: horseVariantRulesFor(config.gameVariant),
    players: publicPlayers,
    communityCards: [...state.communityCards],
    communityCards2: [...(state.communityCards2 ?? [])],
    communityCards3: [...(state.communityCards3 ?? [])],
    bombPot: false,
    boardCount: controller.getActiveBoardCount(),
    pot: state.pot,
    currentBet: state.currentBet,
    minRaise: state.minRaise,
    stage: state.stage,
    gameVariant: config.gameVariant,
    smallBlind: SB,
    bigBlind: BB,
    dealerSeat: state.dealerSeat,
    lastRaise: state.lastRaise,
    actionHistory: state.actionHistory.map((a) => ({ ...a })),
    gameMode: 'cash',
    ante: 0,
    publicMemoryDomain: publicMemoryDomainFromRules('table', 0, false),
    bigBlindAnte: false,
    allInOrFold: false,
    vpipFloor: 0,
    ownVpip: undefined,
    straddleActive: false,
    format: 'cash',
  };
  const generation = state.actionHistory.length;
  const snapshot: LiveHorseDecisionSnapshot = {
    handJournalContext: captureHorseHandJournalContext(state.actionHistory),
    generation,
    fence: [TABLE_ID, config.handNumber, seat, LEASE, generation].join(':'),
    decisionKey: '',
    decisionTimeMs,
    player,
    gameState,
    style,
    mods,
  };
  snapshot.decisionKey = buildHorseDecisionKey(snapshot);
  return snapshot;
}

export type NearNutArm = 'production' | 'off' | 'on';

/** One original worker per decision. Production dependencies throughout;
 * `offlineFeatureFlags` (the development harness's caller-flag seam) only on
 * the off/on arms. `overrides` lets a test substitute an admission. */
export async function decideNearNutRiver(
  state: NearNutRiverState,
  arm: NearNutArm,
  overrides: Partial<HorseDecisionWorkerDependencies> = {},
  /** Paired arms: replace the worker's first (request-keyed) RNG restore with
   * this seed, the one the production request drew, so a flag in `opts` does
   * not move the sampling stream. The canonical restore after it is kept. */
  pairedSeed?: number
): Promise<{
  request: FastHorseDecisionRequest;
  result: FastHorseDecisionResult;
  fires: Record<string, number>;
  /** The state the worker's first RNG restore asked for (its natural seed). */
  naturalSeed: number;
}> {
  enableBrainTelemetry();
  HorseMind.reset();
  drainFires();
  const messages: HorseDecisionWorkerResponse[] = [];
  const request: FastHorseDecisionRequest = {
    ...structuredClone(state.snapshot),
    type: 'DECIDE_FAST',
    requestId: 1,
    ...(arm === 'on' ? { opts: { smallPotNearNutRiverValue: true } } : {}),
  };
  request.decisionKey = buildHorseDecisionKey(request);
  const readiness = defaultHorseDecisionWorkerDependencies.workerReadiness();
  const restore = overrides.restoreRng ?? defaultHorseDecisionWorkerDependencies.restoreRng;
  let restores = 0;
  let naturalSeed = -1;
  const wall = Date.now;
  let runtime: HorseDecisionWorkerRuntime;
  try {
    // HorseObserverReads binds Date.now at construction (FeatureAblationWorker).
    Date.now = () => request.decisionTimeMs;
    runtime = new HorseDecisionWorkerRuntime((m) => messages.push(m), {
      ...defaultHorseDecisionWorkerDependencies,
      ...(arm === 'production' ? {} : { offlineFeatureFlags: true }),
      startServices: async () => readiness,
      stopServices: async () => {},
      journalEnabled: () => false,
      journalDecision: () => {},
      journalExecution: undefined,
      journalAcceptedHand: undefined,
      journalDiscard: undefined,
      journalDiscardExecution: undefined,
      journalLifecycle: undefined,
      journalPlanReceipt: undefined,
      ...overrides,
      restoreRng(seed) {
        if (restores++ === 0) {
          naturalSeed = seed;
          restore(pairedSeed ?? seed);
        } else restore(seed);
      },
    });
  } finally {
    Date.now = wall;
  }
  try {
    runtime.receive(request);
    await runtime.drain();
  } finally {
    runtime.receive({ type: 'SHUTDOWN' });
    await runtime.drain();
  }
  const fires = Object.fromEntries(drainFires().map((f) => [f.feature, f.fires]));
  const error = messages.find((m) => m.type === 'ERROR');
  if (error?.type === 'ERROR') throw Error(`Near-nut fixture worker refused: ${error.message}`);
  const result = messages.find((m) => m.type === 'FAST_RESULT');
  if (result?.type !== 'FAST_RESULT') throw Error('Near-nut fixture worker returned no decision');
  return { request, result, fires, naturalSeed };
}

export interface NearNutDecisionSummary {
  action: string;
  amount: number | null;
  /** Every small_pot_near_nut_value_* receipt this decision fired. */
  receipts: string[];
  /** The gate returned true (the reference raise was in its domain). */
  gateReached: boolean;
  /** The skill's own raise replaced the reference's random call. */
  skillRaised: boolean;
  /** The qualification evaluation counter, from the controller-accepted action. */
  accepted: boolean;
  /** First policy node after `reference` that changed the reference action. */
  changedBy: string | null;
  referenceAction: string;
  /** The worker's natural request-keyed RNG seed for this arm. */
  naturalSeed: number;
  rngBefore: number;
  /** The Phase 10 (PLO4) or Phase 11 (PLO5/PLO6) pack receipt on this decision. */
  variantPolicy: { mode: string; reason: string; applied: boolean } | null;
}

/** Decide, submit the action to the hand's own controller, and count the
 * development harness's accepted counter exactly as FeatureAblationWorker does. */
export async function runNearNutRiver(
  variant: NearNutFixtureVariant,
  index: number,
  arm: NearNutArm,
  pairedSeed?: number
): Promise<NearNutDecisionSummary> {
  const state = nearNutRiverState(variant, index);
  const { request, result, fires, naturalSeed } = await decideNearNutRiver(
    state,
    arm,
    {},
    pairedSeed
  );
  const decision = result.decision;
  const records: Readonly<ActionRecord>[] = [];
  if (
    !state.controller.performAction(
      request.player.seat,
      decision.action as ActionType,
      decision.amount,
      'horse_policy',
      (r) => records.push(r)
    ) &&
    records.length === 0
  )
    throw Error(`Near-nut fixture controller refused ${decision.action} ${decision.amount}`);
  const accepted = acceptedIncrementalComponents(
    request,
    decision,
    fires,
    { action: decision.action, amount: decision.amount ?? null } as never,
    records
  ).includes('small_pot_near_nut_value_raise_accepted');
  const t = decision.policyGraph?.transitions ?? [];
  if (t.length !== HORSE_POLICY_ORDER.length) throw Error('Near-nut fixture missing policy graph');
  const ref = t[0].after;
  const changed = t.find(
    (x, i) => i > 0 && (x.after.action !== ref.action || x.after.amount !== ref.amount)
  );
  const receipts = Object.keys(fires)
    .filter((k) => k.startsWith('small_pot_near_nut_value_'))
    .sort();
  return {
    action: decision.action,
    amount: decision.amount ?? null,
    receipts,
    gateReached: receipts.some((r) =>
      [
        'small_pot_near_nut_value_raise',
        'small_pot_near_nut_value_considered',
        'small_pot_near_nut_value_applied',
        'small_pot_near_nut_value_superseded',
      ].includes(r)
    ),
    skillRaised: (fires.small_pot_near_nut_value_raise ?? 0) > 0,
    accepted,
    changedBy: changed?.node ?? null,
    referenceAction: ref.action,
    naturalSeed,
    rngBefore: result.rngBefore,
    variantPolicy: (() => {
      const r = decision.plo4Policy ?? decision.omahaVariantPolicy;
      return r ? { mode: r.mode, reason: r.reason, applied: r.applied } : null;
    })(),
  };
}

export interface NearNutReachRow {
  variant: NearNutFixtureVariant;
  states: number;
  inDomain: number;
  /** ON arm: the gate returned true (any in-domain receipt). */
  gateReached: number;
  /** ON arm: the skill itself replaced the reference call with its raise. */
  skillRaised: number;
  /** ON arm: the PLO6 flat exception kept an in-domain raise. */
  flatException: number;
  /** ON arm: small_pot_near_nut_value_raise_accepted (controller-accepted). */
  accepted: number;
  /** ON arm decisions whose reference raise a later policy node replaced, by node. */
  supersededBy: Record<string, number>;
  /** Paired ON vs OFF decisions that differ. */
  changed: number;
  /** OFF equals production (action, amount, natural seed) on every state. */
  offEqualsProduction: number;
  /** Near-nut receipts fired by the production and OFF arms (must be 0). */
  productionReceipts: number;
  /** ON arm variant-pack receipts, `mode:reason` -> count. */
  variantPolicy: Record<string, number>;
}

/** Measure one variant over states [0, n): production, OFF, and ON paired on
 * the production arm's RNG seed. Deterministic. */
export async function measureNearNutReach(
  variant: NearNutFixtureVariant,
  n: number
): Promise<{ row: NearNutReachRow; on: NearNutDecisionSummary[] }> {
  const row: NearNutReachRow = {
    variant,
    states: n,
    inDomain: 0,
    gateReached: 0,
    skillRaised: 0,
    flatException: 0,
    accepted: 0,
    supersededBy: {},
    changed: 0,
    offEqualsProduction: 0,
    productionReceipts: 0,
    variantPolicy: {},
  };
  const on: NearNutDecisionSummary[] = [];
  for (let i = 0; i < n; i++) {
    row.inDomain += Number(nearNutRiverState(variant, i).inDomain);
    const prod = await runNearNutRiver(variant, i, 'production');
    const off = await runNearNutRiver(variant, i, 'off');
    const yes = await runNearNutRiver(variant, i, 'on', prod.naturalSeed);
    on.push(yes);
    row.productionReceipts += prod.receipts.length + off.receipts.length;
    row.offEqualsProduction += Number(
      off.action === prod.action &&
        off.amount === prod.amount &&
        off.naturalSeed === prod.naturalSeed &&
        off.rngBefore === prod.rngBefore
    );
    row.gateReached += Number(yes.gateReached);
    row.skillRaised += Number(yes.skillRaised);
    row.flatException += Number(yes.receipts.includes('small_pot_near_nut_value_flat_exception'));
    row.accepted += Number(yes.accepted);
    if (yes.gateReached && yes.referenceAction === 'raise' && yes.changedBy)
      row.supersededBy[yes.changedBy] = (row.supersededBy[yes.changedBy] ?? 0) + 1;
    row.changed += Number(yes.action !== off.action || yes.amount !== off.amount);
    const vp = yes.variantPolicy ? `${yes.variantPolicy.mode}:${yes.variantPolicy.reason}` : 'none';
    row.variantPolicy[vp] = (row.variantPolicy[vp] ?? 0) + 1;
  }
  return { row, on };
}

/** The published 1/2 pricing a declared live feature domain must equal
 * (HorseFeatureLiveDomain.featureLiveDomainRefusals). */
export function nearNutDeclaredPricing(variant: NearNutFixtureVariant) {
  return publishedCashPricing({ tournament: false, variant, seats: 2, tableSeats: TABLE_SEATS });
}
