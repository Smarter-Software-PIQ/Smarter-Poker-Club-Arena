/**
 * LAW: EVERY HORSE STYLE, IN EVERY VARIANT AND BOTH MODES, REACHES THE
 * APPROVED UPGRADES THROUGH THE PRODUCTION DECISION PATH (2026-11-13).
 *
 * What was unproven. The per-decision upgrade counters (01 range posteriors,
 * 02 card removal, 06 public timing) were asserted for one cell only: the
 * brain called directly with 'grinder', hold'em, cash
 * (HorseUpgradeEvidenceCounters.test.ts). The worker + HandController matrix
 * (HorseActionSpaceFreedom.law.test.ts) covers a Hybrid row in eight primary
 * cells and the five remaining variants in cash only, and asserts no upgrade
 * counter. Nothing ran a stored legacy style, or a remaining variant in a
 * tournament, through the worker and checked what the decision used.
 *
 * What this drives. For each stored style x variant x mode:
 *   1. a real HandController deals the hand and is walked passively to the
 *      flop, so the state is the engine's own (menu, pots, rules, history);
 *   2. the stored `horse_profile.style` is resolved by
 *      resolveHorseHybridProfile, the call ServerTableEngineTurns and
 *      LightningHorse make;
 *   3. the request goes through HorseDecisionWorkerRuntime DECIDE_FAST, the
 *      only production caller of HorseLogic.decide, with the production
 *      telemetry wiring (noteFeature = noteFire);
 *   4. the answer must be a FAST_RESULT with a valid receipt, no brain
 *      fallback, an action on the controller's menu that the controller then
 *      accepts, and every per-decision counter the manifest declares for that
 *      variant and mode: 01, 02 and 06 everywhere they are declared, 07 (the
 *      tournament utility) in tournaments only, and 12 (the remaining-variant
 *      pack) where the pack owns the game.
 *
 * The one combination the engine does not support is asserted by its own
 * reason, not skipped: the Phase 12 pack refuses Pineapple tournaments as
 * `pineapple_tournament_unapproved` (RemainingVariantLivePolicy), although the
 * manifest lists upgrade 12 for Pineapple in both modes. The reference brain
 * still decides there, legally, with 01, 02, 06 and 07.
 *
 * The second block passes each of the six style names to the brain as its
 * style argument. Production never does that for anything but the two mode
 * profiles; it is here to prove no style branch in the brain skips a
 * per-decision upgrade, and that the Hybrid evidence counter stays silent for
 * a decision that did not run the mode's profile.
 *
 * Not asserted here, on purpose: upgrades whose counters depend on what the
 * table offers (03 bomb pots, 04 reservoir build, 05 prewarm, 08 side games,
 * 09 pre-action purge, 10 fast window, 11 indifference pool, 12's PLO8 low
 * read). Their producers have their own tests; a single flop decision is not
 * owed one. They are only checked for mode leakage (a cash-only counter in a
 * tournament decision, and the reverse).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
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
  HORSE_UPGRADE_LIVE_EVIDENCE,
  type HorseUpgradeCapabilityEntry,
} from './HorseUpgradeActivationManifest.js';
import { captureHorseHandJournalContext } from './HorseDecisionHandBinding.js';
import { applyTableCommitmentCap } from './ServerTableEngineTurns.js';
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
  RETIRED_HORSE_STYLES,
  type HandConfig,
  type HorseDecision,
  type HorseStyle,
  type SeatPlayer,
} from '../types.js';

/** Keyed by the type, so a seventh style cannot be added without a row here. */
const STYLE_ROWS: Record<HorseStyle, true> = {
  hybrid: true,
  tag: true,
  lag: true,
  balanced: true,
  tricky: true,
  grinder: true,
};
const STYLES = Object.keys(STYLE_ROWS) as HorseStyle[];
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

/** The counter each per-decision upgrade emits on a postflop brain evaluation. */
const PER_DECISION_COUNTER = {
  upgrade_01_range_posteriors: 'upgrade01_action_line_posterior',
  upgrade_02_card_removal_blockers: 'upgrade02_card_removal_scored',
  upgrade_06_public_timing_pacing: 'upgrade06_public_timing_hint',
} as const;
type PerDecisionUpgrade = keyof typeof PER_DECISION_COUNTER;
const PER_DECISION_UPGRADES = Object.keys(PER_DECISION_COUNTER) as PerDecisionUpgrade[];

/** The upgrade 12 variants the Phase 12 remaining-variant pack decides. */
const PHASE12_PACK_VARIANTS: ReadonlySet<Variant> = new Set(['flo8', 'short_deck', 'pineapple']);

const HYBRID_EVIDENCE: Record<HorseHybridMode, string> = {
  cash: 'hybrid_v1_cash_grinder_decided',
  tournament: 'hybrid_v1_tournament_tricky_decided',
};

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

/**
 * A counter belongs to an upgrade when it equals a quoted needle or starts
 * with a templated one (HORSE_UPGRADE_LIVE_EVIDENCE's own two forms).
 */
function countersOf(id: string, counted: Record<string, number>): string[] {
  const needles = HORSE_UPGRADE_LIVE_EVIDENCE[id] ?? [];
  return Object.keys(counted).filter((key) =>
    needles.some((needle) =>
      needle.startsWith('`') ? key.startsWith(needle.slice(1)) : key === needle.slice(1, -1)
    )
  );
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
    // noteFeature is left at its production binding (noteFire), so the
    // worker's own evidence lands in the same counters the brain's does.
  });
  await worker.start();
});

afterAll(async () => {
  await worker.drain();
  HorseMind.reset();
  drainFires();
});

interface FlopSpot {
  spot: ControllerSpot;
  controller: HandController;
  config: HandConfig;
}

/** A heads-up hand the controller dealt and both seats took passively to the flop. */
function dealToFlop(variant: Variant, mode: HorseHybridMode, cell: number): FlopSpot {
  const smallBlind = mode === 'tournament' ? 10 : 1;
  const bigBlind = mode === 'tournament' ? 20 : 2;
  const tableId = `77000000-0000-4000-8000-${String(cell + 1).padStart(12, '0')}`;
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
  const players: SeatPlayer[] = [137.5, 84].map(
    (depth, idx) =>
      ({
        seat: idx + 1,
        user_id: `78000000-0000-4000-8000-${String(cell * 10 + idx + 1).padStart(12, '0')}`,
        username: `MatrixHorse_${cell}_${idx}`,
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

  // The same seeded physical deck the action-space law deals from.
  const deck = controller.getState().deck as unknown as Deck;
  const cards = deck.getRemainingCards().sort((a, b) => {
    const left = `${a.suit}:${a.rank}`;
    const right = `${b.suit}:${b.rank}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const rng = controllerSpotRandom((9100 + variant.charCodeAt(0) * 131) ^ 0x5eedface);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  deck.deal = (n = 1) => {
    if (cards.length < n) throw new Error('matrix fixture exhausted the physical deck');
    return cards.splice(0, n);
  };
  deck.dealOne = () => deck.deal(1)[0];
  deck.remaining = () => cards.length;
  deck.getRemainingCards = () => cards.slice();

  controller.start();
  for (let step = 0; step < 12; step++) {
    const live = controller.getState();
    if (live.stage === 'pineapple_discard') {
      for (const p of live.players.filter((x) => !x.is_folded && x.cards.length === 3))
        expect(controller.performDiscard(p.seat, 0), `${variant} ${mode} discard`).toBe(true);
      controller.flushPineappleSettle();
      continue;
    }
    if (live.stage !== 'preflop') break;
    const pre = controllerDecisionState(controller, variant as never, mode, config);
    if (!pre) break;
    const passive = pre.state.legalActions?.includes('check') ? 'check' : 'call';
    expect(controller.performAction(pre.hero.seat, passive), `${variant} ${mode} preflop`).toBe(
      true
    );
  }

  const spot = controllerDecisionState(controller, variant as never, mode, config);
  if (!spot) throw new Error(`${variant} ${mode}: the controller offered no flop decision`);
  expect(spot.state.stage, `${variant} ${mode}`).toBe('flop');
  expect(spot.state.communityCards.length, `${variant} ${mode}`).toBe(3);

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
    // A coherent heads-up finish: two players left, both paid, two payouts,
    // and a field that is exactly this table. The tournament utility refuses
    // a context whose payouts or field do not reconcile (invalid_input,
    // field_reconciliation), and a refused context proves nothing about it.
    const live = controller.getState();
    const stackByUser = Object.fromEntries(
      live.players.map((p) => [p.user_id, p.stack + p.totalInvested])
    );
    const stacks = Object.values(stackByUser);
    spot.state.tournament = {
      schemaVersion: 1,
      contextStatus: 'complete',
      contextIssues: [],
      sourceAgeMs: 0,
      tournamentId: `matrix-tourney-${tableId}`,
      tournamentType: 'MTT',
      tournamentStatus: 'RUNNING',
      gameVariant: variant,
      entrants: 18,
      playersLeft: live.players.length,
      spotsPaid: live.players.length,
      avgStackChips: stacks.reduce((a, b) => a + b, 0) / stacks.length,
      medianStackChips: [...stacks].sort((a, b) => a - b)[Math.floor(stacks.length / 2)],
      seatsPerTable: 6,
      playersAtTable: live.players.length,
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
      payoutPct: [65, 35],
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
        playersAtTable: live.players.length,
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

  return { spot, controller, config };
}

interface CellResult {
  decision: HorseDecision;
  counted: Record<string, number>;
  flop: FlopSpot;
  style: HorseStyle;
  mods: HorseProfile['mods'];
}
type HorseProfile = ReturnType<typeof resolveHorseHybridProfile>;

/**
 * One DECIDE_FAST through the real worker runtime, with its counters. The
 * profile is resolved for the seat the controller put on the clock, as the
 * live table resolves it for the player whose turn it is.
 */
async function decideThroughWorker(
  variant: Variant,
  mode: HorseHybridMode,
  cell: number,
  profileFor: (horseId: string) => HorseProfile
): Promise<CellResult> {
  HorseMind.reset();
  seedFastRandom(20261113 + cell);
  const flop = dealToFlop(variant, mode, cell);
  const { spot, config } = flop;
  const { style, mods } = profileFor(spot.hero.user_id);
  const request = {
    type: 'DECIDE_FAST' as const,
    requestId: requestId++,
    generation: 1,
    fence: `${config.tableId}:${config.handNumber}:${spot.hero.seat}:${cell}:1`,
    decisionKey: '',
    decisionTimeMs: Date.UTC(2026, 10, 13, 18, 0, 0) + cell * 1000,
    player: spot.hero,
    gameState: spot.state,
    style,
    mods,
    handJournalContext: captureHorseHandJournalContext(spot.state.actionHistory!),
  };
  request.decisionKey = buildHorseDecisionKey(request);

  drainFires();
  const before = messages.length;
  worker.receive(request);
  await worker.drain();
  const counted = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
  const answers = messages.slice(before);
  const label = `${style} ${variant} ${mode}`;
  // A refusal at the worker's validation boundary is an ERROR message; it
  // must fail here with its own text, never read as "no decision".
  expect(
    answers.filter((m) => m.type === 'ERROR'),
    label
  ).toEqual([]);
  const result = answers.find((m) => m.type === 'FAST_RESULT') as
    | (HorseDecisionWorkerResponse & { decision: HorseDecision })
    | undefined;
  if (!result) throw new Error(`${label}: the worker returned no FAST_RESULT`);
  return { decision: result.decision, counted, flop, style, mods };
}

/** Everything a cell owes regardless of which style reached the brain. */
function expectProductionDecision(
  label: string,
  variant: Variant,
  mode: HorseHybridMode,
  { decision, counted, flop }: CellResult
) {
  const { spot, controller } = flop;

  // No fallback and no abandon: the brain answered, and the receipt is whole.
  expect(decision.policyFallback, label).toBeUndefined();
  expect(counted.phase15_brain_exception, label).toBeUndefined();
  expect(counted.phase15_policy_unregistered, label).toBeUndefined();
  expect(horseDecisionReceiptIsValid(decision, variant), label).toBe(true);

  // Core entry: the canonical-state worker path ran exactly this one decision
  // and it entered the postflop brain.
  expect(applies('core_action_freedom_and_turn_reliability', variant, mode), label).toBe(true);
  expect(counted.phase5_canonical_state, label).toBe(1);
  expect(counted.decide_postflop, label).toBe(1);

  // Legal on the controller's own menu, and accepted by the controller.
  const menu = spot.state.legalActions ?? [];
  expect(menu, label).toContain(decision.action);
  const wager =
    decision.action === 'call' || decision.amount === undefined
      ? undefined
      : Number(decision.amount);
  if (decision.action === 'bet' || decision.action === 'raise') {
    expect(wager, label).toBeGreaterThanOrEqual(spot.state.minRaiseTo!);
    expect(wager, label).toBeLessThanOrEqual(spot.state.maxRaiseTo!);
  }
  if (mode === 'tournament' && wager !== undefined)
    expect(Number.isInteger(wager), label).toBe(true);
  expect(
    controller.performAction(spot.hero.seat, decision.action, wager),
    `${label} ${JSON.stringify({ action: decision.action, amount: decision.amount, menu })}`
  ).toBe(true);

  // The per-decision upgrades the manifest declares for this variant and mode.
  for (const id of PER_DECISION_UPGRADES) {
    if (applies(id, variant, mode))
      expect(counted[PER_DECISION_COUNTER[id]], `${label} ${id}`).toBe(1);
  }

  // Upgrade 07: a tournament decision with a complete, reconciled context is
  // priced by the tournament utility, every time. No refusal is tolerated:
  // these are single-board spots, where no wall-clock budget applies
  // (independent review of c6e14f0d, finding 2).
  if (applies('upgrade_07_tournament_cover_and_bounty', variant, mode)) {
    const refusals = Object.keys(counted).filter((key) => key.startsWith('phase7_unavailable_'));
    expect(refusals, `${label} upgrade 07`).toEqual([]);
    expect(counted.phase7_tournament_utility, `${label} upgrade 07`).toBe(1);
  }

  // Upgrade 12, where the remaining-variant pack owns the game. (PLO8's
  // share of it is the low-outlook read, which a given flop may not offer.)
  if (PHASE12_PACK_VARIANTS.has(variant)) {
    expect(applies('upgrade_12_specialty_variants', variant, mode), label).toBe(true);
    expect(counted.phase12_seen, `${label} upgrade 12`).toBe(1);
    const receipt = decision.remainingVariantPolicy;
    expect(receipt, `${label} upgrade 12`).toBeDefined();
    if (variant === 'pineapple' && mode === 'tournament') {
      // Unsupported by the engine, for its documented reason.
      expect(receipt?.reason, label).toBe('pineapple_tournament_unapproved');
      expect(receipt?.fired, label).toBe(false);
      expect(counted.phase12_fired, label).toBeUndefined();
      expect(counted.phase12_reason_pineapple_tournament_unapproved, label).toBe(1);
    } else {
      expect(receipt?.fired, `${label} upgrade 12 ${receipt?.reason}`).toBe(true);
      expect(counted.phase12_fired, `${label} upgrade 12`).toBe(1);
    }
  }

  // Mode fences: an upgrade the manifest declares for one mode only is never
  // owed, and never counted, in the other.
  for (const entry of MANIFEST.upgrades) {
    if (!entry.enabled || entry.modes.includes(mode)) continue;
    expect(countersOf(entry.id, counted), `${label} ${entry.id} is ${entry.modes} only`).toEqual(
      []
    );
  }
}

describe('the matrix is the declared one', () => {
  it('covers every style of the type: the assigned style and each retired one', () => {
    expect([...STYLES].sort()).toEqual([HORSE_ASSIGNED_STYLE, ...RETIRED_HORSE_STYLES].sort());
    expect(STYLES).toHaveLength(6);
  });

  it('covers every variant and mode the manifest declares for the core and upgrades 01 and 06', () => {
    for (const id of [
      'core_action_freedom_and_turn_reliability',
      'upgrade_01_range_posteriors',
      'upgrade_06_public_timing_pacing',
    ]) {
      expect([...upgrade(id).variants].sort(), id).toEqual([...VARIANTS].sort());
      expect([...upgrade(id).modes].sort(), id).toEqual([...MODES].sort());
    }
  });

  it('upgrade 02 is declared for seven variants: the manifest leaves FLH and FLO8 out, so the counter is not owed there', () => {
    const declared = upgrade('upgrade_02_card_removal_blockers');
    expect([...declared.variants].sort()).toEqual(
      VARIANTS.filter((v) => v !== 'flh' && v !== 'flo8').sort()
    );
    expect([...declared.modes].sort()).toEqual([...MODES].sort());
    for (const mode of MODES) {
      expect(applies('upgrade_02_card_removal_blockers', 'flh', mode)).toBe(false);
      expect(applies('upgrade_02_card_removal_blockers', 'flo8', mode)).toBe(false);
    }
  });

  it('upgrade 12 is declared for PLO8, FLO8, Short Deck and Pineapple in both modes', () => {
    const declared = upgrade('upgrade_12_specialty_variants');
    expect([...declared.variants].sort()).toEqual(['flo8', 'pineapple', 'plo8', 'short_deck']);
    expect([...declared.modes].sort()).toEqual([...MODES].sort());
  });

  it('the single-mode upgrades are the ones the mode fences below rely on', () => {
    const singleMode = MANIFEST.upgrades
      .filter((u) => u.enabled && u.modes.length === 1)
      .map((u) => `${u.id}:${u.modes[0]}`)
      .sort();
    expect(singleMode).toEqual([
      'upgrade_03_shared_deck_multiboard:cash',
      'upgrade_07_tournament_cover_and_bounty:tournament',
      'upgrade_08_side_games_integration:cash',
    ]);
    // Each has evidence needles, or its fence would compare against nothing.
    for (const entry of singleMode)
      expect(HORSE_UPGRADE_LIVE_EVIDENCE[entry.split(':')[0]]?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('stored style x variant x mode: the production resolver, then the production worker', () => {
  let cell = 0;
  for (const variant of VARIANTS) {
    for (const mode of MODES) {
      const cellBase = cell;
      cell += STYLES.length;
      it(`${variant} ${mode}: all six stored styles decide legally and count every declared per-decision upgrade`, async () => {
        for (const [offset, stored] of STYLES.entries()) {
          const label = `stored=${stored} ${variant} ${mode}`;
          const profile = { style: stored };

          // The call ServerTableEngineTurns and LightningHorse make.
          const result = await decideThroughWorker(variant, mode, cellBase + offset, (horseId) =>
            resolveHorseHybridProfile(profile, horseId, mode)
          );
          const resolved = { style: result.style, mods: result.mods };
          const expectedStyle = mode === 'cash' ? 'grinder' : 'tricky';
          expect(resolved.style, label).toBe(expectedStyle);
          expect(resolved.style, label).toBe(HORSE_HYBRID_PROFILES[mode].style);
          expect(resolved.mods, label).toMatchObject(HORSE_HYBRID_PROFILES[mode].mods);
          expect(horseHybridDecisionMatches(mode, resolved.style, resolved.mods), label).toBe(true);
          // The stored row is read, never rewritten.
          expect(profile, label).toEqual({ style: stored });

          expectProductionDecision(label, variant, mode, result);

          // Worker evidence: this decision ran the mode's Hybrid profile, and
          // only that mode's.
          const other = mode === 'cash' ? 'tournament' : 'cash';
          expect(result.counted[HYBRID_EVIDENCE[mode]], label).toBe(1);
          expect(result.counted[HYBRID_EVIDENCE[other]], label).toBeUndefined();
          // What the worker was handed is what a Hybrid row hands it: for
          // the same horse, the stored style changes nothing in the request.
          expect(resolved, label).toEqual(
            resolveHorseHybridProfile(
              { style: HORSE_ASSIGNED_STYLE },
              result.flop.spot.hero.user_id,
              mode
            )
          );
        }
      }, 60_000);
    }
  }
});

describe('brain style x variant x mode: no style branch skips a per-decision upgrade', () => {
  let cell = 1000;
  for (const variant of VARIANTS) {
    for (const mode of MODES) {
      const cellBase = cell;
      cell += STYLES.length;
      it(`${variant} ${mode}: each of the six style names, passed to the brain as its style, counts the same upgrades`, async () => {
        // The mode's production dials, so only the style argument varies.
        for (const [offset, style] of STYLES.entries()) {
          const label = `brain=${style} ${variant} ${mode}`;
          const result = await decideThroughWorker(variant, mode, cellBase + offset, (horseId) => ({
            style,
            mods: resolveHorseHybridProfile({ style }, horseId, mode).mods,
          }));
          expectProductionDecision(label, variant, mode, result);

          // The Hybrid evidence counter is honest: it counts only a decision
          // that ran the mode's own profile style.
          const isModeProfile = style === HORSE_HYBRID_PROFILES[mode].style;
          expect(result.counted[HYBRID_EVIDENCE[mode]], label).toBe(isModeProfile ? 1 : undefined);
          expect(
            result.counted[HYBRID_EVIDENCE[mode === 'cash' ? 'tournament' : 'cash']],
            label
          ).toBeUndefined();
        }
      }, 60_000);
    }
  }
});

describe('the upgrades this law requires per decision are switched on', () => {
  // The counter assertions above are conditional on the manifest. If one of
  // these were declared disabled they would go silent, so the declaration
  // itself is pinned (independent review of c6e14f0d, note 6).
  it.each([
    'core_action_freedom_and_turn_reliability',
    'upgrade_01_range_posteriors',
    'upgrade_02_card_removal_blockers',
    'upgrade_06_public_timing_pacing',
    'upgrade_07_tournament_cover_and_bounty',
    'upgrade_12_specialty_variants',
  ])('%s is enabled in the activation manifest', (id) => {
    expect(upgrade(id).enabled).toBe(true);
  });
});
