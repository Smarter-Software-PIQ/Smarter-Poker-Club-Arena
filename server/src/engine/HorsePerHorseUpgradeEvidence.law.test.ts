/**
 * LAW: WHICH HORSE EXERCISED WHICH UPGRADE IS RECORDED BY THE DECISION WORKER,
 * AND RECORDING IT CHANGES NO DECISION (2026-11-14).
 *
 * The brain counters are fleet totals. The worker's FAST execution now runs
 * inside a fire scope and folds what it fired, once, against the request's
 * Horse, variant and lane (workerRuntime.executeFastWithUpgradeEvidence).
 *
 * What this drives, through the real HorseDecisionWorkerRuntime and the real
 * brain on states a real HandController dealt (the fixture of
 * HorseStyleVariantModeMatrix.law.test.ts):
 *   1. two Horses decide in different variants and lanes, and the drained rows
 *      carry each one's id, variant, lane and upgrades, with decisions and
 *      invoked agreeing with the fleet counters the same decision fired;
 *   2. an execution that throws records nothing and leaves nothing behind for
 *      the next Horse;
 *   3. the same seeded request gives the identical FAST_RESULT (decision,
 *      receipts, RNG before and after) and leaves the process RNG identical
 *      whether the scope collects or is replaced by a pass-through;
 *   4. the worker folds at one site only, and DEEP is outside it;
 *   5. the needle rule: every enabled upgrade maps from each of its needles,
 *      and a counter that is no needle maps to nothing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { HandConfig, HorseDecision, SeatPlayer } from '../types.js';
import type { Deck } from './PokerEngine.js';
import type { HorseDecisionWorkerResponse } from './horseDecision/protocol.js';
import type { HorseUpgradeEvidenceRow } from './HorseUpgradeEvidence.js';

type Mode = 'cash' | 'tournament';
type Variant = 'nlh' | 'plo5';

/** One module graph: the runtime, the brain and every piece of module state they share. */
async function world(scope: 'collecting' | 'pass-through') {
  vi.resetModules();
  if (scope === 'pass-through')
    vi.doMock('./BrainTelemetry.js', async (original) => ({
      ...(await original<typeof import('./BrainTelemetry.js')>()),
      withDecisionFireScope: <T>(fn: () => T) => ({ value: fn(), fired: new Set<string>() }),
    }));
  else vi.doUnmock('./BrainTelemetry.js');
  // A runtime draws its authority epochs from randomUUID and seeds each decision's RNG from a key that
  // includes them. Two runtimes are comparable only when they draw the same ids, so both draw from a counter.
  let uuids = 0;
  vi.doMock('node:crypto', async (original) => ({
    ...(await original<typeof import('node:crypto')>()),
    randomUUID: () => `6b000000-0000-4000-8000-${String(++uuids).padStart(12, '0')}`,
  }));
  const telemetry = await import('./BrainTelemetry.js');
  const evidence = await import('./HorseUpgradeEvidence.js');
  const { HandController } = await import('./HandController.js');
  const { seedFastRandom, saveFastRandom } = await import('./HorseEval.js');
  const { resolveHorseHybridProfile } = await import('./HorseHybridProfile.js');
  const { HorseMind } = await import('./HorseMind.js');
  const { buildTournamentMState } = await import('./HorseTournamentPreflop.js');
  const { captureHorseHandJournalContext } = await import('./HorseDecisionHandBinding.js');
  const { applyTableCommitmentCap } = await import('./ServerTableEngineTurns.js');
  const { buildHorseDecisionKey } = await import('./horseDecision/protocol.js');
  const { defaultHorseDecisionWorkerDependencies: defaults, HorseDecisionWorkerRuntime } =
    await import('./horseDecision/workerRuntime.js');
  const { controllerDecisionState, controllerSpotRandom } =
    await import('./remainingVariants/RemainingVariantControllerSpots.test-support.js');

  telemetry.enableBrainTelemetry();
  evidence.enableHorseUpgradeEvidence();
  const messages: HorseDecisionWorkerResponse[] = [];
  let brainThrows = false;
  const worker = new HorseDecisionWorkerRuntime((m) => messages.push(m), {
    ...defaults,
    startServices: async () => defaults.workerReadiness(),
    stopServices: async () => {},
    journalEnabled: () => false,
    journalAcceptedHand: () => {},
    journalLifecycle: () => {},
    noteDecision: () => {},
    now: () => 1_000,
    decide: (...args) => {
      if (brainThrows) {
        // a counter the brain fired before it threw
        telemetry.noteFire('v36_bomb_multiboard');
        throw new Error('brain threw inside the scope');
      }
      return defaults.decide(...args);
    },
  });
  await worker.start();
  let requestId = 1;

  /** A heads-up hand the controller dealt and both seats took passively to the flop. */
  function request(variant: Variant, mode: Mode, cell: number) {
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
    const players: SeatPlayer[] = [137.5, 84].map(
      (depth, idx) =>
        ({
          seat: idx + 1,
          user_id: `7a000000-0000-4000-8000-${String(cell * 10 + idx + 1).padStart(12, '0')}`,
          username: `EvidenceHorse_${cell}_${idx}`,
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
    const rng = controllerSpotRandom((9100 + variant.charCodeAt(0) * 131) ^ 0x5eedface);
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [cards[i], cards[j]] = [cards[j]!, cards[i]!];
    }
    deck.deal = (n = 1) => {
      if (cards.length < n) throw new Error('evidence fixture exhausted the physical deck');
      return cards.splice(0, n);
    };
    deck.dealOne = () => deck.deal(1)[0]!;
    deck.remaining = () => cards.length;
    deck.getRemainingCards = () => cards.slice();

    controller.start();
    for (let step = 0; step < 12; step++) {
      if (controller.getState().stage !== 'preflop') break;
      const pre = controllerDecisionState(controller, variant as never, mode, config);
      if (!pre) break;
      const passive = pre.state.legalActions?.includes('check') ? 'check' : 'call';
      expect(controller.performAction(pre.hero.seat, passive), `${variant} ${mode} preflop`).toBe(
        true
      );
    }
    const spot = controllerDecisionState(controller, variant as never, mode, config);
    if (!spot) throw new Error(`${variant} ${mode}: the controller offered no flop decision`);
    expect(spot.state.stage).toBe('flop');
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
      // A coherent heads-up finish, as in the matrix law: the tournament utility refuses a context whose
      // payouts or field do not reconcile, and a refused context proves nothing about upgrade 07.
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
        tournamentId: `evidence-tourney-${tableId}`,
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

    const { style, mods } = resolveHorseHybridProfile({ style: 'hybrid' }, spot.hero.user_id, mode);
    const built = {
      type: 'DECIDE_FAST' as const,
      requestId: requestId++,
      generation: 1,
      fence: `${config.tableId}:${config.handNumber}:${spot.hero.seat}:${cell}:1`,
      decisionKey: '',
      decisionTimeMs: Date.UTC(2026, 10, 14, 18, 0, 0) + cell * 1000,
      player: spot.hero,
      gameState: spot.state,
      style,
      mods,
      handJournalContext: captureHorseHandJournalContext(spot.state.actionHistory!),
    };
    built.decisionKey = buildHorseDecisionKey(built);
    return built;
  }

  /** One DECIDE_FAST through the runtime: its answers, the fleet counters it fired and the rows it folded. */
  async function decide(
    variant: Variant,
    mode: Mode,
    cell: number,
    options: { throws?: boolean; replay?: string } = {}
  ) {
    HorseMind.reset();
    seedFastRandom(20261114 + cell);
    // `replay` is the exact request another runtime was sent, so both decide the same bytes.
    const sent = options.replay ?? JSON.stringify(request(variant, mode, cell));
    const built = JSON.parse(sent) as ReturnType<typeof request>;
    telemetry.drainFires();
    evidence.drainHorseUpgradeEvidence();
    const before = messages.length;
    brainThrows = options.throws === true;
    worker.receive(built);
    await worker.drain();
    brainThrows = false;
    return {
      horse: built.player.user_id as string,
      sent,
      answers: messages.slice(before),
      counted: Object.fromEntries(telemetry.drainFires().map((r) => [r.feature, r.fires])),
      rows: evidence.drainHorseUpgradeEvidence(),
      rngAfterDecision: saveFastRandom(),
    };
  }
  return { decide, worker, evidence, telemetry, HorseMind };
}

const upgradeRows = (rows: HorseUpgradeEvidenceRow[]) =>
  Object.fromEntries(rows.map((r) => [r.upgradeId, [r.decisions, r.invoked]]));
const fastResult = (answers: HorseDecisionWorkerResponse[]) => {
  expect(answers.filter((m) => m.type === 'ERROR')).toEqual([]);
  const result = answers.find((m) => m.type === 'FAST_RESULT') as
    | (HorseDecisionWorkerResponse & { decision: HorseDecision })
    | undefined;
  if (!result) throw new Error('the worker returned no FAST_RESULT');
  return result;
};

describe('LAW: the decision worker records which Horse exercised which upgrade, and nothing else changes', () => {
  let live: Awaited<ReturnType<typeof world>> | undefined;
  afterAll(async () => {
    await live?.worker.drain();
    vi.doUnmock('./BrainTelemetry.js');
    vi.doUnmock('node:crypto');
  });

  it('two Horses, two variants, two lanes: each row carries its own Horse, variant, lane and upgrades', async () => {
    live = await world('collecting');
    const cash = await live.decide('plo5', 'cash', 1);
    const tourney = await live.decide('nlh', 'tournament', 2);
    expect(fastResult(cash.answers).decision.policyFallback).toBeUndefined();
    expect(fastResult(tourney.answers).decision.policyFallback).toBeUndefined();
    expect(cash.horse).not.toBe(tourney.horse);

    for (const [run, variant, lane] of [
      [cash, 'plo5', 'cash'],
      [tourney, 'nlh', 'tournament'],
    ] as const) {
      const label = `${variant} ${lane}`;
      expect(run.rows.length, label).toBeGreaterThan(0);
      for (const row of run.rows) {
        expect(row, label).toMatchObject({ horseUserId: run.horse, gameVariant: variant, lane });
        expect(row.day, label).toBe(new Date().toISOString().slice(0, 10));
        expect(row.decisions, label).toBe(1);
        expect([0, 1], label).toContain(row.invoked);
      }
      // invoked is exactly the upgrades whose evidence counters this one decision fired for the fleet
      expect(
        run.rows.filter((r) => r.invoked === 1).map((r) => r.upgradeId),
        label
      ).toEqual(live.evidence.upgradeIdsForFires(Object.keys(run.counted)));
    }

    const a = upgradeRows(cash.rows);
    const b = upgradeRows(tourney.rows);
    // the worker's own canonical-state counter and the three per-decision upgrades, in both lanes
    for (const id of [
      'core_action_freedom_and_turn_reliability',
      'upgrade_01_range_posteriors',
      'upgrade_02_card_removal_blockers',
      'upgrade_06_public_timing_pacing',
    ]) {
      expect(a[id], `cash ${id}`).toEqual([1, 1]);
      expect(b[id], `tournament ${id}`).toEqual([1, 1]);
    }
    // lane-specific upgrades stay with their lane
    expect(b.upgrade_07_tournament_cover_and_bounty).toEqual([1, 1]);
    expect(a.upgrade_07_tournament_cover_and_bounty).toBeUndefined();
    expect(a.upgrade_08_side_games_integration).toEqual([1, 0]);
    expect(b.upgrade_08_side_games_integration).toBeUndefined();
    // declared for the variant and lane, not exercised by one flop decision: the baseline alone
    expect(a.upgrade_03_shared_deck_multiboard).toEqual([1, 0]);
    expect(b.upgrade_03_shared_deck_multiboard).toBeUndefined();
  }, 120_000);

  it('the same Horse deciding again adds to its own cells only', async () => {
    const first = await live!.decide('nlh', 'tournament', 2);
    live!.evidence.restoreHorseUpgradeEvidence(first.rows);
    const second = await live!.decide('nlh', 'tournament', 2);
    // decide() drains before it runs, so put the first decision's rows back beside the second's
    live!.evidence.restoreHorseUpgradeEvidence(first.rows);
    live!.evidence.restoreHorseUpgradeEvidence(second.rows);
    const rows = live!.evidence.drainHorseUpgradeEvidence();
    expect(new Set(rows.map((r) => r.horseUserId))).toEqual(new Set([first.horse]));
    expect(upgradeRows(rows).upgrade_07_tournament_cover_and_bounty).toEqual([2, 2]);
    expect(rows).toHaveLength(first.rows.length);
  }, 120_000);

  it('an execution that throws records no decision and leaves nothing for the next Horse', async () => {
    const thrown = await live!.decide('plo5', 'cash', 3, { throws: true });
    expect(thrown.answers.map((m) => m.type)).toEqual(['ERROR']);
    // the fleet counter fired; the Horse is not credited with a decision that was never made
    expect(thrown.counted.v36_bomb_multiboard).toBe(1);
    expect(thrown.rows).toEqual([]);

    const next = await live!.decide('nlh', 'tournament', 4);
    fastResult(next.answers);
    expect(next.horse).not.toBe(thrown.horse);
    expect(new Set(next.rows.map((r) => r.horseUserId))).toEqual(new Set([next.horse]));
    // upgrade 03 is what the thrown decision fired: a scope left open would hand it to this Horse
    expect(upgradeRows(next.rows).upgrade_03_shared_deck_multiboard).toBeUndefined();
    expect(next.counted.v36_bomb_multiboard).toBeUndefined();
  }, 120_000);

  it('the same seeded request decides identically with the scope collecting and with a pass-through', async () => {
    const strip = (answers: HorseDecisionWorkerResponse[]) =>
      JSON.parse(
        JSON.stringify(answers, (key, value) =>
          // wall-clock durations are the only fields two runs of one decision may differ in
          /^(?:compute|latency|analysis|elapsed|policy|simulation)Ms$/.test(key) ? 0 : value
        )
      );
    // Two fresh runtimes given the same requests in the same order (request ids, fences and seeds included).
    const collecting: Array<Awaited<ReturnType<Awaited<ReturnType<typeof world>>['decide']>>> = [];
    const scoped = await world('collecting');
    for (const [variant, mode, cell] of [
      ['plo5', 'cash', 1],
      ['nlh', 'tournament', 2],
    ] as const)
      collecting.push(await scoped.decide(variant, mode, cell));
    await scoped.worker.drain();

    const bare = await world('pass-through');
    try {
      for (const [i, [variant, mode, cell]] of (
        [
          ['plo5', 'cash', 1],
          ['nlh', 'tournament', 2],
        ] as const
      ).entries()) {
        const withScope = collecting[i]!;
        const without = await bare.decide(variant, mode, cell, { replay: withScope.sent });
        const label = `${variant} ${mode}`;
        // the pass-through really is inactive: the same decision folded no invocation at all
        expect(
          without.rows.every((r) => r.invoked === 0),
          label
        ).toBe(true);
        expect(
          withScope.rows.some((r) => r.invoked === 1),
          label
        ).toBe(true);
        // decision, every receipt on it, plan binding, rngBefore and rngAfter: the whole answer
        expect(withScope.sent, label).toBe(without.sent);
        const a = fastResult(withScope.answers);
        const b = fastResult(without.answers);
        expect(a.decision.action, label).toBe(b.decision.action);
        expect(strip(withScope.answers), label).toEqual(strip(without.answers));
        expect((a as { rngAfter?: number }).rngAfter, label).toBe(
          (b as { rngAfter?: number }).rngAfter
        );
        expect(withScope.rngAfterDecision, label).toBe(without.rngAfterDecision);
        // and the fleet counters are the same set with the same counts
        expect(withScope.counted, label).toEqual(without.counted);
      }
    } finally {
      await bare.worker.drain();
    }
  }, 180_000);
});

describe('LAW: the worker folds at one site, and DEEP is outside it', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/engine/horseDecision/workerRuntime.ts'),
    'utf8'
  );
  const count = (needle: string) => source.split(needle).length - 1;

  it('opens one fire scope and folds once, around executeFast only', () => {
    expect(count('withDecisionFireScope(')).toBe(1);
    expect(count('noteHorseUpgradeDecision(')).toBe(1);
    expect(source).toContain('withDecisionFireScope(() => this.executeFast(request))');
    // the dispatcher reaches FAST only through the folding wrapper, and DEEP directly
    expect(count('this.executeFast(request)')).toBe(1);
    expect(source).toContain('() => this.executeFastWithUpgradeEvidence(request)');
    expect(source).toContain("request.type === 'DECIDE_DEEP') outcome = this.executeDeep(request)");
  });
});

describe('LAW: an evidence counter maps to its upgrade by the manifest needle rule', () => {
  it('maps every needle of every enabled upgrade to that upgrade, and nothing else to anything', async () => {
    vi.doUnmock('./BrainTelemetry.js');
    vi.doUnmock('node:crypto');
    vi.resetModules();
    const { HORSE_UPGRADE_LIVE_EVIDENCE, enabledHorseUpgradeIds } =
      await import('./HorseUpgradeActivationManifest.js');
    const { upgradeIdsForFires } = await import('./HorseUpgradeEvidence.js');
    /** The rule as HorseStyleVariantModeMatrix.law.test.ts states it. */
    const ownersByRule = (key: string) =>
      Object.keys(HORSE_UPGRADE_LIVE_EVIDENCE).filter((id) =>
        HORSE_UPGRADE_LIVE_EVIDENCE[id]!.some((needle) =>
          needle.startsWith('`') ? key.startsWith(needle.slice(1)) : key === needle.slice(1, -1)
        )
      );

    const enabled = enabledHorseUpgradeIds();
    expect(enabled.length).toBeGreaterThanOrEqual(14);
    for (const id of enabled) {
      const needles = HORSE_UPGRADE_LIVE_EVIDENCE[id] ?? [];
      expect(needles.length, id).toBeGreaterThan(0);
      for (const needle of needles) {
        expect(needle, id).toMatch(/^(?:'[a-z0-9_]+'|`[a-z0-9_]+)$/);
        const key = needle.startsWith('`')
          ? `${needle.slice(1)}anything_seen`
          : needle.slice(1, -1);
        expect(upgradeIdsForFires([key]), `${id} ${needle}`).toContain(id);
        expect(upgradeIdsForFires([key]), `${id} ${needle}`).toEqual(ownersByRule(key));
        // a quoted needle is the whole name; a templated one is a prefix, not a substring
        if (!needle.startsWith('`')) {
          expect(upgradeIdsForFires([`${key}_x`]), needle).toEqual(ownersByRule(`${key}_x`));
          expect(upgradeIdsForFires([`${key}_x`]), needle).not.toContain(id);
        }
        expect(upgradeIdsForFires([`x_${key}`]), needle).toEqual([]);
      }
    }
    for (const stranger of [
      'decide_postflop',
      'phase15_brain_exception',
      'upgrade99_probe',
      '',
      'upgrade',
    ])
      expect(upgradeIdsForFires([stranger]), stranger).toEqual([]);
    expect(upgradeIdsForFires([])).toEqual([]);
    // several counters of one upgrade are one invocation; the result is in manifest order
    expect(
      upgradeIdsForFires([
        'upgrade11_indifference_call_band',
        'upgrade02_card_removal_scored',
        'upgrade11_indifference_pool',
        'decide_postflop',
      ])
    ).toEqual(['upgrade_02_card_removal_blockers', 'upgrade_11_persona_indifference_mixing']);
  });
});
