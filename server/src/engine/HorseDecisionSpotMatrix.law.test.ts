/**
 * LAW: THE HORSE DECIDES LEGALLY, WITH ITS APPROVED UPGRADES, IN EVERY KIND OF
 * POSTFLOP SPOT THE TABLE CAN PUT IT IN (2026-11-14).
 *
 * What was unproven. HorseStyleVariantModeMatrix.law.test.ts runs the
 * production decision path for nine variants and both modes, but in one spot
 * only: the flop, heads-up, first to act, where the menu is check or bet. A
 * call, a raise, a fold, an all-in, the turn, the river, three or more
 * players, a short stack, a capped fixed-limit street and the pot-limit
 * ceiling were never put in front of the worker by a real controller.
 *
 * What this drives. For every variant (nlh, plo4, plo5, plo6, plo8, flo8, flh,
 * short_deck, pineapple) and both modes, each spot in SPOTS below, twice, on
 * two different decks:
 *   1. a real HandController deals the hand; every seat calls or checks to the
 *      decision street, and the seats ahead of the Horse then act through
 *      `performAction` from their own menus (bet, call, raise, all-in), so the
 *      state is the engine's own;
 *   2. a stored Hybrid row is resolved by resolveHorseHybridProfile;
 *   3. the request goes through HorseDecisionWorkerRuntime DECIDE_FAST;
 *   4. the answer must be a FAST_RESULT with a valid receipt, no ERROR, no
 *      policy fallback and no `phase15_*fallback*` counter; its action must be
 *      on the controller's menu, its amount inside the controller's min and
 *      max and in whole chips in a tournament (whole cents in cash), and
 *      `controller.performAction` must accept it; the per-decision counters
 *      the manifest declares for that variant and mode (01, 02, 06; 07 in
 *      tournaments, on a tournament context that reconciles for the table
 *      size) must each fire exactly once.
 *
 * Which action the Horse picks is never asserted: decisions are sampled (the
 * worker seeds its randomness from the decision key). The key covers the
 * action history's timestamps, which the controller takes from the wall
 * clock; the copy handed to the brain is restamped at fixed times, so every
 * run of this file makes the same 512 decisions. Instead, every action
 * the controller offers in every spot is executed on a twin of the same hand
 * (same deck, same script), at the minimum and at the maximum for a sized
 * wager, and one chip unit outside each bound must be refused. Across the
 * matrix each of fold, check, call, bet, raise and all-in must have been
 * offered and accepted that way in every betting structure.
 *
 * The betting structure's own bounds are recomputed here and compared with
 * the controller's menu: no-limit (nlh, short_deck, pineapple) may wager the
 * whole stack; pot-limit (plo4, plo5, plo6, plo8) may raise to the current bet
 * plus the pot after calling, and bet the pot; fixed limit (flh, flo8) has one
 * size, the big blind on the flop and twice that on the turn and river, and
 * no wager after a bet and three raises.
 *
 * Covered: all nine variants x both modes x fourteen spots (fifteen in fixed
 * limit) x two decks = 512 decisions. Table sizes 2, 3, 6 and the full ring
 * (nine seats; seven in plo6, the deck's ceiling).
 *
 * Not covered, stated: preflop decisions; antes, straddles, bomb pots and
 * multi-board hands; kill pots; spots where the Horse itself acted earlier on
 * the same street (it is always making its first decision of the street, so
 * a re-raise back to the Horse and the reopening rule are not exercised,
 * except on the capped fixed-limit street); side pots with three or more
 * all-in stacks; stored legacy styles (the style matrix law owns those); the
 * upgrades whose counters depend on what the table offers (03, 04, 05, 08,
 * 09, 10, 11, 12). The minimum raise is checked as a floor (current bet plus
 * one big blind), not recomputed from the last raise.
 *
 * What the controller's menu means in three of these spots, recorded because
 * the law depends on it (HandController.getAvailableActions):
 *   - facing an all-in that covers the Horse, the menu is fold, call and
 *     all_in, and all_in there is the call;
 *   - on a capped fixed-limit street the menu is fold, call and all_in, and
 *     all_in executes as the call, leaving the rest of the stack behind;
 *   - heads-up against a shorter stack that is all-in, the menu still offers
 *     raise and all_in to the deep stack, although nobody is left to answer.
 *
 * One known gap is pinned, not hidden (last describe block): in pot-limit and
 * fixed-limit tournaments the short-stack shove through the all-in button is
 * not priced by upgrade 07; the tournament utility refuses it as
 * `baseline_not_modeled`. Reported 2026-11-14 to the tournament strategy lane.
 * Upgrade 07 is required, exactly once, on every other tournament decision.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { bettingStructureFor } from './BettingStructure.js';
import { HandController } from './HandController.js';
import type { Deck } from './PokerEngine.js';
import { seedFastRandom } from './HorseEval.js';
import {
  HORSE_HYBRID_PROFILES,
  horseHybridDecisionMatches,
  resolveHorseHybridProfile,
  type HorseHybridMode,
} from './HorseHybridProfile.js';
import { HorseMind } from './HorseMind.js';
import { buildTournamentMState } from './HorseTournamentPreflop.js';
import {
  computeHorseUpgradeActivationManifest,
  type HorseUpgradeCapabilityEntry,
} from './HorseUpgradeActivationManifest.js';
import { captureHorseHandJournalContext } from './HorseDecisionHandBinding.js';
import { applyTableCommitmentCap } from './ServerTableEngineTurns.js';
import { maxSeatsFor } from './VariantRules.js';
import {
  buildHorseDecisionKey,
  type HorseDecisionWorkerResponse,
} from './horseDecision/protocol.js';
import { horseDecisionReceiptIsValid } from './horseDecision/responseValidation.js';
import {
  defaultHorseDecisionWorkerDependencies as defaults,
  HorseDecisionWorkerRuntime,
} from './horseDecision/workerRuntime.js';
import {
  controllerDecisionState,
  controllerSpotRandom,
  type ControllerSpot,
} from './remainingVariants/RemainingVariantControllerSpots.test-support.js';
import {
  HORSE_ASSIGNED_STYLE,
  type ActionType,
  type HandConfig,
  type HorseDecision,
  type SeatPlayer,
} from '../types.js';

const VARIANTS = [
  'nlh',
  'plo4',
  'plo5',
  'plo6',
  'plo8',
  'flo8',
  'flh',
  'short_deck',
  'pineapple',
] as const;
type Variant = (typeof VARIANTS)[number];
const MODES = ['cash', 'tournament'] as const satisfies readonly HorseHybridMode[];
type Structure = 'no_limit' | 'pot_limit' | 'fixed_limit';
const STRUCTURE_OF: Record<Variant, Structure> = {
  nlh: 'no_limit',
  short_deck: 'no_limit',
  pineapple: 'no_limit',
  plo4: 'pot_limit',
  plo5: 'pot_limit',
  plo6: 'pot_limit',
  plo8: 'pot_limit',
  flh: 'fixed_limit',
  flo8: 'fixed_limit',
};
const STRUCTURES = ['no_limit', 'pot_limit', 'fixed_limit'] as const;
const MENU_ACTIONS = ['fold', 'check', 'call', 'bet', 'raise', 'all_in'] as const;
type Street = 'flop' | 'turn' | 'river';
const BOARD_CARDS: Record<Street, number> = { flop: 3, turn: 4, river: 5 };
/** Decks per spot. */
const REPS = 2;

/** A scripted action a seat ahead of the Horse takes through the controller. */
type Step = 'check' | 'call' | 'bet' | 'pot_bet' | 'raise' | 'all_in';
/**
 * What the Horse must be looking at when the script ends:
 *   first          nothing to call: check or bet;
 *   facing         a bet or raise with a full raise available: fold, call, raise;
 *   short          a bet, and a stack above the call but below the minimum
 *                  raise: the all-in button is the only raise;
 *   facing_all_in  an all-in that covers the Horse: no sized wager at all;
 *   capped         fixed limit after a bet and three raises: no wager at all.
 */
type Kind = 'first' | 'facing' | 'short' | 'facing_all_in' | 'capped';
interface SpotSpec {
  id: string;
  kind: Kind;
  /** Players dealt; 'ring' is nine, or the most the variant's deck can seat. */
  seats: 2 | 3 | 6 | 'ring';
  street: Street;
  /** Actions on the decision street, in turn order, before the Horse is on the clock. */
  pre: readonly Step[];
  /** Starting stacks in big blinds, seat 1 first, when the spot needs them. */
  stacks?: (structure: Structure) => number[];
  only?: Structure;
}

const SPOTS: readonly SpotSpec[] = [
  { id: 'hu_flop_facing_bet', kind: 'facing', seats: 2, street: 'flop', pre: ['bet'] },
  { id: 'hu_turn_first', kind: 'first', seats: 2, street: 'turn', pre: [] },
  { id: 'hu_turn_facing_bet', kind: 'facing', seats: 2, street: 'turn', pre: ['bet'] },
  { id: 'hu_river_first', kind: 'first', seats: 2, street: 'river', pre: [] },
  { id: 'hu_river_facing_bet', kind: 'facing', seats: 2, street: 'river', pre: ['bet'] },
  {
    id: 'three_flop_facing_bet_and_call',
    kind: 'facing',
    seats: 3,
    street: 'flop',
    pre: ['bet', 'call'],
  },
  {
    id: 'three_turn_facing_bet_and_raise',
    kind: 'facing',
    seats: 3,
    street: 'turn',
    pre: ['bet', 'raise'],
  },
  {
    id: 'three_river_facing_check_and_bet',
    kind: 'facing',
    seats: 3,
    street: 'river',
    pre: ['check', 'bet'],
  },
  { id: 'six_flop_first', kind: 'first', seats: 6, street: 'flop', pre: [] },
  { id: 'six_river_facing_bet', kind: 'facing', seats: 6, street: 'river', pre: ['bet'] },
  {
    id: 'ring_turn_facing_check_bet_and_call',
    kind: 'facing',
    seats: 'ring',
    street: 'turn',
    pre: ['check', 'bet', 'call'],
  },
  {
    // Heads-up the button (seat 1) posts the small blind and acts last after
    // the flop. Limped, the pot is two big blinds; the big blind bets the pot
    // (one fixed bet in fixed limit) and the Horse has more than the call and
    // less than the minimum raise behind.
    id: 'hu_flop_short_stack_all_in_is_the_only_raise',
    kind: 'short',
    seats: 2,
    street: 'flop',
    pre: ['pot_bet'],
    stacks: (structure) => (structure === 'fixed_limit' ? [2.5, 120] : [4, 120]),
  },
  {
    // Both seats have one pot-sized (or one fixed) bet behind; the big blind
    // shoves and covers the Horse exactly.
    id: 'hu_flop_facing_all_in_that_covers',
    kind: 'facing_all_in',
    seats: 2,
    street: 'flop',
    pre: ['all_in'],
    stacks: (structure) => (structure === 'fixed_limit' ? [2, 2] : [3, 3]),
  },
  {
    // The short big blind shoves into a deep Horse.
    id: 'hu_flop_deep_facing_short_all_in',
    kind: 'facing',
    seats: 2,
    street: 'flop',
    pre: ['all_in'],
    stacks: (structure) => (structure === 'fixed_limit' ? [120, 2] : [120, 3]),
  },
  {
    id: 'hu_turn_fixed_limit_capped',
    kind: 'capped',
    seats: 2,
    street: 'turn',
    pre: ['bet', 'raise', 'raise', 'raise'],
    only: 'fixed_limit',
  },
];
const spotsFor = (variant: Variant) =>
  SPOTS.filter((spec) => !spec.only || spec.only === STRUCTURE_OF[variant]);

/** The counter each per-decision upgrade emits on a postflop brain evaluation. */
const PER_DECISION_COUNTER = {
  upgrade_01_range_posteriors: 'upgrade01_action_line_posterior',
  upgrade_02_card_removal_blockers: 'upgrade02_card_removal_scored',
  upgrade_06_public_timing_pacing: 'upgrade06_public_timing_hint',
} as const;
type PerDecisionUpgrade = keyof typeof PER_DECISION_COUNTER;
const PER_DECISION_UPGRADES = Object.keys(PER_DECISION_COUNTER) as PerDecisionUpgrade[];
const UPGRADE_07 = 'upgrade_07_tournament_cover_and_bounty';

const MANIFEST = computeHorseUpgradeActivationManifest();
function upgrade(id: string): HorseUpgradeCapabilityEntry {
  const entry = MANIFEST.upgrades.find((u) => u.id === id);
  if (!entry) throw new Error(`manifest has no upgrade ${id}`);
  return entry;
}
const applies = (id: string, variant: Variant, mode: HorseHybridMode) => {
  const entry = upgrade(id);
  return entry.enabled && entry.variants.includes(variant) && entry.modes.includes(mode);
};

const ringSeats = (variant: Variant) => Math.min(9, maxSeatsFor(variant));
const seatsOf = (spec: SpotSpec, variant: Variant) =>
  spec.seats === 'ring' ? ringSeats(variant) : spec.seats;

/** One deck per variant, mode, spot and repetition. */
function deckSeed(variant: Variant, mode: HorseHybridMode, spec: SpotSpec, rep: number): number {
  let h = 0x811c9dc5;
  for (const ch of `${variant}|${mode}|${spec.id}|${rep}`)
    h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return h >>> 0 || 1;
}

const DEEP_BB = [137.5, 84, 110, 96, 150, 72, 125, 101, 90];

interface Built {
  spot: ControllerSpot;
  controller: HandController;
  config: HandConfig;
  seed: number;
  structure: Structure;
  /** What the scripted seats did on the decision street, for reproductions. */
  script: string[];
}

/**
 * Deals the hand and plays it to the Horse's decision. Deterministic in its
 * arguments, so a second call is a twin of the same spot.
 */
function build(
  variant: Variant,
  mode: HorseHybridMode,
  spec: SpotSpec,
  rep: number,
  cell: number
): Built {
  const structure = bettingStructureFor(variant) as Structure;
  const seats = seatsOf(spec, variant);
  const seed = deckSeed(variant, mode, spec, rep);
  const smallBlind = mode === 'tournament' ? 10 : 1;
  const bigBlind = mode === 'tournament' ? 20 : 2;
  const tableId = `79000000-0000-4000-8000-${String(cell + 1).padStart(12, '0')}`;
  const config = {
    tableId,
    handNumber: 12,
    gameVariant: variant,
    smallBlind,
    bigBlind,
    isTournament: mode === 'tournament',
    chipUnit: mode === 'tournament' ? 1 : 0.01,
    rakeConfig: { percent: mode === 'cash' ? 5 : 0, cap: bigBlind * 3, noFlopNoDrop: true },
  } as HandConfig;
  const players: SeatPlayer[] = (spec.stacks?.(structure) ?? DEEP_BB.slice(0, seats)).map(
    (depth, idx) =>
      ({
        seat: idx + 1,
        user_id: `7a000000-0000-4000-8000-${String(cell * 10 + idx + 1).padStart(12, '0')}`,
        username: `SpotHorse_${cell}_${idx}`,
        stack: depth * bigBlind,
        bet: 0,
        totalInvested: 0,
        cards: [],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
        is_horse: true,
      }) as SeatPlayer
  );
  const controller = new HandController(config, players, 1);

  const deck = controller.getState().deck as unknown as Deck;
  const cards = deck.getRemainingCards().sort((a, b) => {
    const left = `${a.suit}:${a.rank}`;
    const right = `${b.suit}:${b.rank}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const rng = controllerSpotRandom(seed);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  deck.deal = (n = 1) => {
    if (cards.length < n) throw new Error('spot fixture exhausted the physical deck');
    return cards.splice(0, n);
  };
  deck.dealOne = () => deck.deal(1)[0];
  deck.remaining = () => cards.length;
  deck.getRemainingCards = () => cards.slice();

  const label = `${variant} ${mode} ${spec.id} rep=${rep} seed=${seed}`;
  const snap = (n: number) => (mode === 'tournament' ? Math.round(n) : Math.round(n * 100) / 100);
  const act = (seat: number, action: ActionType, amount?: number) => {
    if (!controller.performAction(seat, action, amount))
      throw new Error(`${label}: fixture ${action} ${amount ?? ''} by seat ${seat} was refused`);
  };

  controller.start();
  // Every seat sees the decision street: calls and checks only.
  for (let step = 0; step < 80; step++) {
    const live = controller.getState();
    if (live.stage === 'pineapple_discard') {
      for (const p of live.players.filter((x) => !x.is_folded && x.cards.length === 3))
        if (!controller.performDiscard(p.seat, 0)) throw new Error(`${label}: discard refused`);
      controller.flushPineappleSettle();
      continue;
    }
    if (live.stage === spec.street) break;
    const at = controllerDecisionState(controller, variant as never, mode, config);
    if (!at) throw new Error(`${label}: no actor at ${live.stage} before ${spec.street}`);
    act(at.hero.seat, at.state.legalActions?.includes('check') ? 'check' : 'call');
  }

  // The scripted seats act on the decision street, from the controller's menu.
  const script: string[] = [];
  for (const step of spec.pre) {
    const at = controllerDecisionState(controller, variant as never, mode, config);
    if (!at || at.state.stage !== spec.street)
      throw new Error(`${label}: the hand left ${spec.street} before scripted ${step}`);
    const menu = controller.getAuthoritativeActionState(at.hero.user_id)!;
    const seat = at.hero.seat;
    if (step === 'check' || step === 'call' || step === 'all_in') {
      if (!menu.legalActions.includes(step))
        throw new Error(`${label}: scripted ${step} is not on seat ${seat}'s menu`);
      act(seat, step);
      script.push(`seat${seat} ${step}`);
      continue;
    }
    const verb: ActionType = step === 'raise' ? 'raise' : 'bet';
    if (!menu.legalActions.includes(verb) || menu.minRaiseTo === null || menu.maxRaiseTo === null)
      throw new Error(`${label}: scripted ${verb} is not on seat ${seat}'s menu`);
    const min = menu.minRaiseTo;
    const max = menu.maxRaiseTo;
    const pot = controller.getState().pot;
    let to: number;
    if (step === 'pot_bet') to = Math.min(max, Math.max(min, pot));
    else if (step === 'bet') to = min + rng() * (Math.min(max, Math.max(min, pot)) - min);
    else to = min + rng() * (Math.min(max, min * 1.5) - min);
    to = Math.min(max, Math.max(min, snap(to)));
    act(seat, verb, to);
    script.push(`seat${seat} ${verb} to ${to}`);
  }

  const spot = controllerDecisionState(controller, variant as never, mode, config);
  if (!spot) throw new Error(`${label}: the controller offered no decision (${script.join(', ')})`);

  // The controller stamps each action with the wall clock, and the decision
  // key (which seeds the worker's sampling) covers those stamps. The copy the
  // brain is handed gets fixed ones, 1.7 seconds apart, so a run is the same
  // run every time and a failure names a decision that can be replayed.
  const firstStamp = Date.UTC(2026, 10, 14, 17, 0, 0) + cell * 60_000;
  spot.state.actionHistory?.forEach((record, index) => {
    record.timestamp = firstStamp + index * 1700;
  });

  const blinds = controller.getBlindSnapshot?.() ?? {
    smallBlind,
    bigBlind,
    ante: 0,
    bigBlindAnte: false,
  };
  spot.state.smallBlind = blinds.smallBlind;
  spot.state.bigBlind = blinds.bigBlind;
  spot.state.ante = blinds.ante;
  spot.state.bigBlindAnte = blinds.bigBlindAnte;
  spot.state.allInOrFold = false;
  spot.state.bbjConfig = spot.state.bbjConfig ?? null;

  if (mode === 'tournament') {
    // A coherent final table of exactly the players dealt: that many left,
    // all paid, one payout each summing to 100, and a field whose stacks are
    // the starting stacks of this hand (folded seats included). The
    // tournament utility refuses a context that does not reconcile.
    const live = controller.getState();
    const n = live.players.length;
    const stackByUser = Object.fromEntries(
      live.players.map((p) => [p.user_id, p.stack + p.totalInvested])
    );
    const stacks = Object.values(stackByUser);
    const weights = Array.from({ length: n }, (_, i) => n - i);
    const weightSum = weights.reduce((a, b) => a + b, 0);
    const payoutPct = weights.map((w) => Math.floor((100 * w) / weightSum));
    payoutPct[0] += 100 - payoutPct.reduce((a, b) => a + b, 0);
    spot.state.tournament = {
      schemaVersion: 1,
      contextStatus: 'complete',
      contextIssues: [],
      sourceAgeMs: 0,
      tournamentId: `spot-tourney-${tableId}`,
      tournamentType: 'MTT',
      tournamentStatus: 'RUNNING',
      gameVariant: variant,
      entrants: 18,
      playersLeft: n,
      spotsPaid: n,
      avgStackChips: stacks.reduce((a, b) => a + b, 0) / n,
      medianStackChips: [...stacks].sort((a, b) => a - b)[Math.floor(n / 2)],
      seatsPerTable: Math.max(6, n),
      playersAtTable: n,
      currentLevel: 4,
      nearBubble: false,
      inMoney: true,
      registrationOpen: false,
      lateRegistrationOpen: false,
      registrationRequiresAuthorization: false,
      isPko: false,
      isBounty: false,
      isMysteryBounty: false,
      mysteryBountyStage: 'none',
      reentryAllowed: false,
      rebuyAllowed: false,
      addOnAvailable: false,
      onBreak: false,
      handForHand: false,
      handForHandExpected: false,
      mysteryTopLive: false,
      finalTable: true,
      satellite: false,
      satelliteSeats: 0,
      maxReentries: 0,
      maxRebuys: 0,
      addOnCost: null,
      addOnChips: null,
      addOnLevels: null,
      levelDurationMin: 10,
      levelElapsedMin: 5,
      nextBlindMult: 1.5,
      bountyFactor: 0,
      mysteryChestsLeft: 0,
      mysteryMeanCents: 0,
      mysteryTopCents: 0,
      meanBountyCents: 0,
      bountyByUser: {},
      payoutPct,
      stacks,
      stackByUser,
      currentSmallBlind: smallBlind,
      currentBigBlind: bigBlind,
      currentAnte: 0,
      anteType: 'none',
      nextSmallBlind: bigBlind,
      nextBigBlind: bigBlind * 2,
      nextAnte: 0,
      nextBlindInMin: 5,
      prizePoolCents: 250000,
      bountyPoolCents: 0,
      reentryOpen: false,
      rebuyOpen: false,
      addOnPeriodOpen: false,
      reloadsUsed: 0,
      addOnTaken: false,
      rebuyAffordable: false,
      addOnAffordable: false,
      m: buildTournamentMState({
        stackChips: spot.hero.stack,
        smallBlind,
        bigBlind,
        ante: 0,
        anteType: 'none',
        playersAtTable: n,
        nextSmallBlind: bigBlind,
        nextBigBlind: bigBlind * 2,
        nextAnte: 0,
        minutesToNextLevel: 5,
        opponentStacks: live.players
          .filter((p) => p.user_id !== spot.hero.user_id)
          .map((p) => ({ userId: p.user_id, stackChips: p.stack })),
      }),
    } as never;
  }

  spot.state.commitmentCapRemaining = applyTableCommitmentCap(
    controller.getAuthoritativeActionState(spot.hero.user_id)!,
    spot.hero,
    mode === 'tournament',
    0,
    bigBlind
  ).commitmentCapRemaining;

  return { spot, controller, config, seed, structure, script };
}

let worker: HorseDecisionWorkerRuntime;
const messages: HorseDecisionWorkerResponse[] = [];
let requestId = 1;

beforeAll(async () => {
  enableBrainTelemetry();
  worker = new HorseDecisionWorkerRuntime((m) => messages.push(m), {
    ...defaults,
    startServices: async () => defaults.workerReadiness(),
    stopServices: async () => {},
    journalEnabled: () => false,
    journalAcceptedHand: () => {},
    journalLifecycle: () => {},
    noteDecision: () => {},
    // noteFeature stays at its production binding (noteFire).
  });
  await worker.start();
});

afterAll(async () => {
  await worker.drain();
  HorseMind.reset();
  drainFires();
});

/** What the whole matrix reached, per betting structure. */
interface Reached {
  decisions: number;
  /** Actions the controller put on a Horse's menu. */
  offered: Set<string>;
  /** Offered actions the controller then accepted (the Horse's own, or on a twin). */
  accepted: Set<string>;
  /** Actions the worker returned. Reported, never required. */
  chosen: Set<string>;
  /** Table sizes and streets decided at. */
  seats: Set<number>;
  streets: Set<string>;
}
const REACHED = new Map<Structure, Reached>(
  STRUCTURES.map((s) => [
    s,
    {
      decisions: 0,
      offered: new Set(),
      accepted: new Set(),
      chosen: new Set(),
      seats: new Set(),
      streets: new Set(),
    },
  ])
);
const DECKS_SEEN = new Set<number>();
const BOARDS_SEEN = new Set<string>();
const CELLS_RUN = new Set<string>();
/**
 * What upgrade 07 did on every tournament decision of the short-stack spot
 * (the all-in button as the only raise); pinned in the last describe block.
 */
interface ShortSpotPricing {
  /** `variant rep=N seed=N`: the reproduction. */
  id: string;
  structure: Structure;
  action: string;
  /** phase7_tournament_utility fired once and the decision carries its ledger. */
  priced: boolean;
  /** Every `phase7_unavailable_*` counter the decision fired. */
  refusalCounters: string[];
  /** phase7_utility_unavailable, the refusal's umbrella counter. */
  unavailable: number | undefined;
  /** The decision's own receipt of the refusal. */
  receiptRefusal: string | undefined;
}
const SHORT_SPOT_PRICING: ShortSpotPricing[] = [];

const near = (a: number, b: number) => Math.abs(a - b) < 0.006;

/**
 * One spot: build it, decide it through the worker, check everything the law
 * owes, and return what was wrong (empty when nothing was). Every entry
 * carries the full reproduction.
 */
async function runSpot(
  variant: Variant,
  mode: HorseHybridMode,
  spec: SpotSpec,
  rep: number,
  cell: number
): Promise<string[]> {
  const problems: string[] = [];
  HorseMind.reset();
  seedFastRandom(20261114 + cell);
  const built = build(variant, mode, spec, rep, cell);
  const { spot, controller, config, seed, structure } = built;
  const state = spot.state;
  const hero = spot.hero;
  const menu = [...(state.legalActions ?? [])] as ActionType[];
  const toCall = state.toCall ?? 0;
  const bb = config.bigBlind;
  const unit = mode === 'tournament' ? 1 : 0.01;
  const where =
    `${variant} ${mode} ${spec.id} rep=${rep} seed=${seed} street=${state.stage} ` +
    `dealt=${state.players.length} heroSeat=${hero.seat} heroStack=${hero.stack} ` +
    `heroBet=${hero.bet} pot=${state.pot} currentBet=${state.currentBet} toCall=${toCall} ` +
    `minRaiseTo=${state.minRaiseTo} maxRaiseTo=${state.maxRaiseTo} menu=[${menu}] ` +
    `script=[${built.script.join('; ')}]`;
  const owe = (ok: boolean, what: string) => {
    if (!ok) problems.push(`${what} :: ${where}`);
  };

  // ── The spot is the one the matrix names ────────────────────────────────
  const live = controller.getState();
  owe(state.stage === spec.street, 'fixture: wrong street');
  owe(state.communityCards.length === BOARD_CARDS[spec.street], 'fixture: wrong board size');
  owe(live.players.length === seatsOf(spec, variant), 'fixture: wrong table size');
  owe(
    (state.dealtSeatIds ?? []).length === seatsOf(spec, variant),
    'fixture: not every seat was dealt in'
  );
  owe(
    live.players.every((p) => !p.is_folded),
    'fixture: a seat folded before the decision'
  );
  owe(state.bettingStructure === structure, `menu structure is ${state.bettingStructure}`);
  owe(structure === STRUCTURE_OF[variant], `production structure is ${structure}`);
  const sized = menu.includes('bet') ? 'bet' : menu.includes('raise') ? 'raise' : null;
  const others = live.players.filter((p) => p.seat !== hero.seat);
  if (spec.kind === 'first') {
    owe(
      toCall === 0 && menu.includes('check') && menu.includes('bet'),
      'fixture: not first to act'
    );
  } else if (spec.kind === 'facing') {
    owe(
      toCall > 0 && ['fold', 'call', 'raise'].every((a) => menu.includes(a as ActionType)),
      'fixture: not facing a bet with a raise available'
    );
  } else if (spec.kind === 'short') {
    owe(
      toCall > 0 &&
        hero.stack > toCall &&
        sized === null &&
        ['fold', 'call', 'all_in'].every((a) => menu.includes(a as ActionType)),
      'fixture: all-in is not the only raise'
    );
  } else if (spec.kind === 'facing_all_in') {
    owe(
      toCall > 0 &&
        hero.stack <= toCall + 0.005 &&
        sized === null &&
        menu.includes('fold') &&
        menu.includes('call') &&
        menu.every((a) => a === 'fold' || a === 'call' || a === 'all_in') &&
        others.some((p) => p.is_all_in),
      'fixture: not facing a covering all-in'
    );
  } else {
    owe(
      toCall > 0 &&
        state.wagersCapped === true &&
        sized === null &&
        menu.includes('fold') &&
        menu.includes('call'),
      'fixture: the street is not capped'
    );
  }
  if (spec.id === 'hu_flop_deep_facing_short_all_in')
    owe(
      others.every((p) => p.is_all_in),
      'fixture: the bettor is not all-in'
    );

  // ── The controller's bounds are the betting structure's ─────────────────
  if (sized) {
    const min = state.minRaiseTo!;
    const max = state.maxRaiseTo!;
    const stackBound = sized === 'raise' ? hero.bet + hero.stack : hero.stack;
    owe(min <= max, 'menu: min above max');
    if (structure === 'no_limit') {
      owe(near(max, stackBound), `no-limit: max is not the stack (${stackBound})`);
    } else if (structure === 'pot_limit') {
      // The pot after the Horse calls, on top of the bet it is raising.
      const potCeiling = sized === 'raise' ? state.currentBet + state.pot + toCall : state.pot;
      const ceiling = Math.min(stackBound, potCeiling);
      owe(
        near(max, mode === 'tournament' ? Math.floor(ceiling + 1e-6) : ceiling),
        `pot-limit: max is not the pot (${ceiling})`
      );
      if (spec.kind !== 'short' && !spec.stacks)
        owe(max < stackBound, 'pot-limit: the pot did not bind a deep stack');
    } else {
      const streetBet = state.stage === 'flop' ? bb : 2 * bb;
      const only = Math.min(stackBound, state.currentBet + streetBet);
      owe(state.fixedBetSize === streetBet, `fixed limit: street bet is not ${streetBet}`);
      owe(min === only && max === only, `fixed limit: the one size is not ${only}`);
    }
    if (structure !== 'fixed_limit') {
      if (sized === 'bet') owe(min === Math.min(bb, stackBound), 'menu: minimum bet');
      else owe(min >= Math.min(stackBound, state.currentBet + bb) - 0.005, 'menu: minimum raise');
    }
  } else {
    owe(state.minRaiseTo === null && state.maxRaiseTo === null, 'menu: bounds without a wager');
  }
  if (mode === 'tournament')
    owe(
      [toCall, state.minRaiseTo ?? 0, state.maxRaiseTo ?? 0].every(Number.isInteger),
      'menu: fractional chips in a tournament'
    );

  // ── The production resolver, then the production worker ─────────────────
  const stored = { style: HORSE_ASSIGNED_STYLE };
  const { style, mods } = resolveHorseHybridProfile(stored, hero.user_id, mode);
  owe(style === HORSE_HYBRID_PROFILES[mode].style, `resolver returned style ${style}`);
  owe(horseHybridDecisionMatches(mode, style, mods), 'resolver returned foreign dials');
  const request = {
    type: 'DECIDE_FAST' as const,
    requestId: requestId++,
    generation: 1,
    fence: `${config.tableId}:${config.handNumber}:${hero.seat}:${cell}:1`,
    decisionKey: '',
    decisionTimeMs: Date.UTC(2026, 10, 14, 18, 0, 0) + cell * 60_000,
    player: hero,
    gameState: state,
    style,
    mods,
    handJournalContext: captureHorseHandJournalContext(state.actionHistory!),
  };
  request.decisionKey = buildHorseDecisionKey(request);

  drainFires();
  const before = messages.length;
  worker.receive(request);
  await worker.drain();
  const counted: Record<string, number> = Object.fromEntries(
    drainFires().map((r) => [r.feature, r.fires])
  );
  const answers = messages.slice(before);
  const errors = answers.filter((m) => m.type === 'ERROR');
  owe(errors.length === 0, `worker ERROR ${JSON.stringify(errors).slice(0, 400)}`);
  const results = answers.filter((m) => m.type === 'FAST_RESULT') as Array<
    HorseDecisionWorkerResponse & { decision: HorseDecision }
  >;
  owe(results.length === 1, `${results.length} FAST_RESULT messages`);
  if (results.length === 0) return problems;
  const decision = results[0].decision;
  const got = `returned action=${decision.action} amount=${decision.amount}`;

  const reached = REACHED.get(structure)!;
  reached.decisions++;
  reached.seats.add(live.players.length);
  reached.streets.add(state.stage);
  reached.chosen.add(decision.action);
  for (const action of menu) reached.offered.add(action);
  DECKS_SEEN.add(seed);
  BOARDS_SEEN.add(state.communityCards.map((c) => `${c.rank}${c.suit[0]}`).join(''));

  // ── The brain answered: no fallback, a whole receipt ────────────────────
  owe(decision.policyFallback === undefined, `policy fallback ${decision.policyFallback}`);
  const fallbacks = Object.keys(counted).filter(
    (key) =>
      /^phase15_.*fallback/.test(key) ||
      key === 'phase15_brain_exception' ||
      key === 'phase15_policy_unregistered'
  );
  owe(fallbacks.length === 0, `fallback counters ${fallbacks}`);
  owe(horseDecisionReceiptIsValid(decision, variant), `invalid receipt, ${got}`);
  owe(
    counted.phase5_canonical_state === 1,
    `phase5_canonical_state=${counted.phase5_canonical_state}`
  );
  owe(counted.decide_postflop === 1, `decide_postflop=${counted.decide_postflop}`);

  // ── The per-decision upgrades the manifest declares, exactly once ───────
  for (const id of PER_DECISION_UPGRADES) {
    if (!applies(id, variant, mode)) continue;
    const key = PER_DECISION_COUNTER[id];
    owe(counted[key] === 1, `${id}: ${key}=${counted[key]}, ${got}`);
  }
  if (applies(UPGRADE_07, variant, mode)) {
    const refusals = Object.keys(counted).filter((key) => key.startsWith('phase7_unavailable_'));
    const priced = refusals.length === 0 && counted.phase7_tournament_utility === 1;
    const text = `${UPGRADE_07}: phase7_tournament_utility=${counted.phase7_tournament_utility} refusals=[${refusals}], ${got}`;
    // The known gap, and only it, is pinned by its own test below: the
    // all-in button pressed as the only raise in pot limit or fixed limit,
    // refused for exactly this reason. Any other refusal fails here.
    const knownGap =
      spec.kind === 'short' &&
      structure !== 'no_limit' &&
      decision.action === 'all_in' &&
      refusals.length === 1 &&
      refusals[0] === 'phase7_unavailable_baseline_not_modeled';
    if (spec.kind === 'short')
      SHORT_SPOT_PRICING.push({
        id: `${variant} rep=${rep} seed=${seed}`,
        structure,
        action: decision.action,
        priced: priced && decision.tournamentUtility !== undefined,
        refusalCounters: refusals,
        unavailable: counted.phase7_utility_unavailable,
        receiptRefusal: decision.tournamentUtilityRefusal,
      });
    if (!knownGap) owe(priced, text);
  } else {
    owe(counted.phase7_tournament_utility === undefined, 'tournament utility in a cash game');
  }

  // ── Legal on the controller's menu, inside its bounds, and accepted ─────
  owe(menu.includes(decision.action), `off the menu, ${got}`);
  const wager =
    decision.action === 'call' || decision.amount === undefined
      ? undefined
      : Number(decision.amount);
  if (decision.action === 'bet' || decision.action === 'raise') {
    owe(typeof decision.amount === 'number', `sized wager without an amount, ${got}`);
    owe(
      wager !== undefined && wager >= state.minRaiseTo! && wager <= state.maxRaiseTo!,
      `outside the controller's bounds, ${got}`
    );
  }
  if (decision.action === 'call' && decision.amount !== undefined)
    owe(near(Number(decision.amount), Math.min(toCall, hero.stack)), `wrong call amount, ${got}`);
  if (decision.amount !== undefined) {
    const amount = Number(decision.amount);
    owe(
      mode === 'tournament'
        ? Number.isInteger(amount)
        : Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6,
      `not a whole chip unit, ${got}`
    );
  }
  const historyBefore = live.actionHistory.length;
  const accepted = controller.performAction(hero.seat, decision.action, wager);
  owe(accepted, `the controller refused it, ${got}`);
  if (accepted) {
    reached.accepted.add(decision.action);
    const after = controller.getState();
    const record = after.actionHistory[historyBefore];
    owe(record?.seat === hero.seat, 'the accepted action was not recorded for the Horse');
    if (decision.action === 'bet' || decision.action === 'raise') {
      const me = after.players.find((p) => p.seat === hero.seat)!;
      if (others.every((p) => p.is_all_in || p.is_folded)) {
        // Nobody is left to answer: the controller records the raise and
        // returns the uncalled part at once, so it costs exactly the call.
        owe(
          near(hero.stack - me.stack, toCall),
          `a raise over an all-in cost more than the call, ${got}`
        );
      } else {
        owe(
          after.stage === state.stage && near(me.bet, wager!),
          `the table did not wager it, ${got}`
        );
      }
    }
  }

  // ── Every offered action is legal: executed on a twin of the same hand ──
  for (const action of menu) {
    const attempts: Array<[amount: number | undefined, legal: boolean]> =
      action === 'bet' || action === 'raise'
        ? [
            [state.minRaiseTo!, true],
            [state.maxRaiseTo!, true],
            [state.maxRaiseTo! + unit, false],
            [state.minRaiseTo! - unit, false],
          ]
        : [[undefined, true]];
    for (const [amount, legal] of attempts) {
      const twin = build(variant, mode, spec, rep, cell);
      const seat = twin.spot.hero.seat;
      const stackBefore = twin.spot.hero.stack;
      const ok = twin.controller.performAction(seat, action, amount);
      owe(ok === legal, `twin: ${action} ${amount ?? ''} accepted=${ok}, expected ${legal}`);
      if (!ok || !legal) continue;
      reached.accepted.add(action);
      if (action !== 'all_in') continue;
      // What the all-in button did, per spot kind.
      const me = twin.controller.getState().players.find((p) => p.seat === seat)!;
      if (spec.kind === 'short')
        owe(me.is_all_in && me.stack === 0, 'twin: the short all-in did not commit the stack');
      if (spec.kind === 'capped')
        owe(
          near(stackBefore - me.stack, toCall),
          'twin: all-in on a capped street put in more than the call'
        );
      if (structure === 'fixed_limit' && sized)
        owe(
          stackBefore - me.stack <= state.maxRaiseTo! - hero.bet + 0.005,
          'twin: all-in in fixed limit put in more than the one size'
        );
    }
  }
  return problems;
}

describe('the matrix is the declared one', () => {
  it('covers all nine variants, both modes and the three betting structures production assigns', () => {
    expect(VARIANTS).toHaveLength(9);
    for (const variant of VARIANTS)
      expect(bettingStructureFor(variant), variant).toBe(STRUCTURE_OF[variant]);
    expect(new Set(Object.values(STRUCTURE_OF))).toEqual(new Set(STRUCTURES));
  });

  it('the per-decision upgrades this law requires are switched on for the cells it runs', () => {
    for (const id of ['upgrade_01_range_posteriors', 'upgrade_06_public_timing_pacing'] as const) {
      expect(upgrade(id).enabled, id).toBe(true);
      for (const variant of VARIANTS)
        for (const mode of MODES) expect(applies(id, variant, mode), `${id} ${variant}`).toBe(true);
    }
    // Upgrade 02 is declared for seven variants; FLH and FLO8 owe no counter.
    expect(upgrade('upgrade_02_card_removal_blockers').enabled).toBe(true);
    for (const variant of VARIANTS)
      for (const mode of MODES)
        expect(applies('upgrade_02_card_removal_blockers', variant, mode), variant).toBe(
          STRUCTURE_OF[variant] !== 'fixed_limit'
        );
    // Upgrade 07 is the tournament utility: every variant, tournaments only.
    expect(upgrade(UPGRADE_07).enabled).toBe(true);
    for (const variant of VARIANTS) {
      expect(applies(UPGRADE_07, variant, 'tournament'), variant).toBe(true);
      expect(applies(UPGRADE_07, variant, 'cash'), variant).toBe(false);
    }
  });

  it('the spots name every required kind, street and table size', () => {
    expect(new Set(SPOTS.map((s) => s.kind))).toEqual(
      new Set(['first', 'facing', 'short', 'facing_all_in', 'capped'])
    );
    expect(new Set(SPOTS.map((s) => s.street))).toEqual(new Set(['flop', 'turn', 'river']));
    expect(new Set(SPOTS.map((s) => s.seats))).toEqual(new Set([2, 3, 6, 'ring']));
    for (const street of ['flop', 'turn', 'river'] as const) {
      // First to act and facing a bet, on every street.
      expect(
        SPOTS.some((s) => s.street === street && s.kind === 'first'),
        street
      ).toBe(true);
      expect(
        SPOTS.some((s) => s.street === street && s.kind === 'facing'),
        street
      ).toBe(true);
    }
    expect(spotsFor('nlh')).toHaveLength(14);
    expect(spotsFor('plo4')).toHaveLength(14);
    expect(spotsFor('flh')).toHaveLength(15);
    for (const variant of VARIANTS) {
      expect(ringSeats(variant), variant).toBeGreaterThanOrEqual(6);
      expect(ringSeats(variant), variant).toBe(variant === 'plo6' ? 7 : 9);
    }
  });
});

describe('variant x mode x spot: the production resolver, the production worker, the controller', () => {
  let cell = 0;
  for (const variant of VARIANTS) {
    for (const mode of MODES) {
      const specs = spotsFor(variant);
      const base = cell;
      cell += specs.length * REPS;
      it(`${variant} ${mode}: ${specs.length} spots on ${REPS} decks each decide legally, inside the controller's bounds, with every declared per-decision upgrade`, async () => {
        const problems: string[] = [];
        for (const [index, spec] of specs.entries())
          for (let rep = 0; rep < REPS; rep++)
            problems.push(...(await runSpot(variant, mode, spec, rep, base + index * REPS + rep)));
        CELLS_RUN.add(`${variant} ${mode}`);
        expect(problems).toEqual([]);
      }, 60_000);
    }
  }
});

describe('across the matrix', () => {
  it('every cell ran, on its own deck', () => {
    expect(CELLS_RUN.size).toBe(VARIANTS.length * MODES.length);
    const decisions = [...REACHED.values()].reduce((sum, r) => sum + r.decisions, 0);
    // 3 no-limit and 4 pot-limit variants at 14 spots, 2 fixed-limit at 15.
    expect(decisions).toBe((3 * 14 + 4 * 14 + 2 * 15) * MODES.length * REPS);
    expect(decisions).toBe(512);
    expect(DECKS_SEEN.size).toBe(decisions);
    // Different decks really are different boards (a few may collide by chance).
    expect(BOARDS_SEEN.size).toBeGreaterThan(decisions * 0.95);
  });

  it.each(STRUCTURES)(
    '%s: fold, check, call, bet, raise and all-in were each offered to a Horse and accepted by the controller',
    (structure) => {
      const reached = REACHED.get(structure)!;
      expect([...reached.offered].sort(), 'offered').toEqual([...MENU_ACTIONS].sort());
      expect([...reached.accepted].sort(), 'accepted').toEqual([...MENU_ACTIONS].sort());
      // What the worker returned is on some menu; which ones is not a law.
      for (const action of reached.chosen) expect(MENU_ACTIONS).toContain(action);
      expect([...reached.streets].sort()).toEqual(['flop', 'river', 'turn']);
      expect([...reached.seats].sort((a, b) => a - b)).toEqual(
        structure === 'pot_limit' ? [2, 3, 6, 7, 9] : [2, 3, 6, 9]
      );
    }
  );
});

/**
 * KNOWN GAP, pinned (found by this law and reported to the tournament
 * strategy lane, which owns HorseTournamentUtility, on 2026-11-14).
 *
 * In a pot-limit or fixed-limit tournament, a Horse facing a bet with more
 * than the call and less than the minimum raise behind holds the menu fold,
 * call, all_in with no minRaiseTo or maxRaiseTo (HandController withholds the
 * sized raise and keeps the button). The controller executes that all_in as a
 * wager: the whole stack goes in above the bet. When the brain's reference
 * decision is that all_in, HorseTournamentUtility.buildTournamentActionCandidates
 * builds no jam candidate, because for these two structures it requires a
 * numeric maxRaiseTo (`ceilingTo !== null`); the baseline is then missing from
 * the candidates and the utility refuses with `baseline_not_modeled`. The
 * shove is played, legally, but it is not priced by the tournament utility:
 * upgrade 07 does not fire on the decision that puts the tournament life at
 * stake. No-limit builds the jam without the ceiling and is priced.
 *
 * This pins today's behaviour by name, the way the style matrix law pins the
 * Pineapple tournament refusal. It is green while the gap exists, for this
 * reason and no other, and it goes red the moment the shove is priced: whoever
 * fixes the pricing must then replace this block with the plain rule (every
 * tournament decision of this spot is priced) and drop the carve-out in
 * runSpot. A refusal for any other reason already fails in the cells above.
 *
 * The decisions are the same on every run (fixed decks and timestamps), so the
 * six shoves are listed by their reproduction: variant, deck repetition and
 * deck seed of the spot `hu_flop_short_stack_all_in_is_the_only_raise`,
 * tournament, heads-up flop, Horse in seat 1, big blind 20.
 */
const KNOWN_GAP_REASON = 'baseline_not_modeled';
const KNOWN_GAP_COUNTER = `phase7_unavailable_${KNOWN_GAP_REASON}`;
const KNOWN_GAP_SHOVES = [
  'plo4 rep=0 seed=1663882339',
  'plo6 rep=0 seed=1264265673',
  'plo8 rep=1 seed=2568337932',
  'flo8 rep=1 seed=2269140658',
  'flh rep=0 seed=530853016',
  'flh rep=1 seed=547630635',
];
describe('KNOWN GAP upgrade 07 (reported 2026-11-14 to the tournament strategy lane): the all-in button as the only raise', () => {
  const ofStructure = (noLimit: boolean) =>
    SHORT_SPOT_PRICING.filter((d) => (d.structure === 'no_limit') === noLimit);

  it('pinned: a pot-limit or fixed-limit tournament shove through the all-in button is NOT priced, refused as baseline_not_modeled and nothing else', () => {
    expect(CELLS_RUN.size).toBe(VARIANTS.length * MODES.length);
    // Two decks for each of the nine variants, tournaments only.
    expect(SHORT_SPOT_PRICING).toHaveLength(VARIANTS.length * REPS);
    const shoves = ofStructure(false).filter((d) => d.action === 'all_in');
    expect(shoves.map((d) => d.id)).toEqual(KNOWN_GAP_SHOVES);
    for (const shove of shoves) {
      expect(shove.priced, shove.id).toBe(false);
      expect(shove.refusalCounters, shove.id).toEqual([KNOWN_GAP_COUNTER]);
      expect(shove.unavailable, shove.id).toBe(1);
      expect(shove.receiptRefusal, shove.id).toBe(KNOWN_GAP_REASON);
    }
  });

  it('the same spot IS priced when the Horse folds or calls in pot limit and fixed limit', () => {
    const passive = ofStructure(false).filter((d) => d.action !== 'all_in');
    expect(passive.map((d) => `${d.id} ${d.action}`)).toEqual([
      'plo4 rep=1 seed=1647104720 call',
      'plo5 rep=0 seed=3189586728 call',
      'plo5 rep=1 seed=3206364347 fold',
      'plo6 rep=1 seed=1247488054 fold',
      'plo8 rep=0 seed=2585115551 call',
      'flo8 rep=0 seed=2285918277 call',
    ]);
    for (const decision of passive) {
      expect(decision.priced, decision.id).toBe(true);
      expect(decision.refusalCounters, decision.id).toEqual([]);
      expect(decision.unavailable, decision.id).toBeUndefined();
      expect(decision.receiptRefusal, decision.id).toBeUndefined();
    }
  });

  it('the same spot IS priced in no-limit tournaments, the shove included', () => {
    const noLimit = ofStructure(true);
    expect(noLimit.map((d) => `${d.id} ${d.action}`)).toEqual([
      'nlh rep=0 seed=2456099296 fold',
      'nlh rep=1 seed=2472876915 all_in',
      'short_deck rep=0 seed=350535654 all_in',
      'short_deck rep=1 seed=367313273 fold',
      'pineapple rep=0 seed=566050004 fold',
      'pineapple rep=1 seed=582827623 fold',
    ]);
    for (const decision of noLimit) {
      expect(decision.priced, decision.id).toBe(true);
      expect(decision.refusalCounters, decision.id).toEqual([]);
      expect(decision.unavailable, decision.id).toBeUndefined();
      expect(decision.receiptRefusal, decision.id).toBeUndefined();
    }
  });
});
