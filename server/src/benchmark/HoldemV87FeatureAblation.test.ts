/** Bounded offline feature diagnostics, not duplicate-deal EV or live acceptance.
 * Run with server Vitest; optional HOLD_EM_FEATURE_ABLATION_OUTPUT is a NEW
 * absolute archive filename. No broad v87HoldemOverhaul OFF comparison is used.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

vi.mock('../services/supabase/client.js', () => ({
  supabase: new Proxy(
    {},
    {
      get() {
        throw new Error('Database access in offline ablation');
      },
    }
  ),
  maintenanceSupabase: {},
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));

import type {
  ActionRecord,
  Card,
  CardRank,
  CardSuit,
  HorseDecision,
  SeatPlayer,
} from '../types.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from '../engine/HorseLogic.js';
import { HorseMind, readScopeOf } from '../engine/HorseMind.js';
import {
  createWinnerReadState,
  isProvenWinner,
  resetWinnerReads,
  winnerReadScopeOf,
} from '../engine/HorseWinnerRead.js';
import { restoreFastRandom, saveFastRandom, seedFastRandom } from '../engine/HorseEval.js';
import { drainFires, enableBrainTelemetry } from '../engine/BrainTelemetry.js';
import {
  HorseDecisionWorkerRuntime,
  defaultHorseDecisionWorkerDependencies,
} from '../engine/horseDecision/workerRuntime.js';
import {
  buildHorseDecisionKey,
  type FastHorseDecisionRequest,
  type HorseDecisionWorkerResponse,
} from '../engine/horseDecision/protocol.js';
import { captureHorseHandJournalContext } from '../engine/HorseDecisionHandBinding.js';
import { horseVariantRulesFor } from '../engine/VariantRules.js';
import { equityGovernor } from '../engine/EquityLoadGovernor.js';
import { solverPolicyArtifactStatus } from '../gto/SolverPolicyArtifactLoader.js';
import { qualifiedTestAdmission } from '../engine/HorseQualifiedAuthority.test-support.js';

const CLOCK = 1_700_000_000_000;
const suits: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (text: string): Card[] =>
  text.split(' ').map((s) => ({ rank: s[0] as CardRank, suit: suits[s[1]] }));
const reports: Array<Record<string, unknown>> = [];
const action = (d: HorseDecision) => ({ action: d.action, amount: d.amount ?? null });

function player(seat: number, userId: string, stack: number, hole: Card[] = []): SeatPlayer {
  return {
    seat,
    user_id: userId,
    username: `Seat${seat}`,
    stack,
    cards: hole,
    bet: 0,
    totalInvested: 0,
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  };
}

function direct(hero: SeatPlayer, gs: HorseGameStateV2, seed: number, opts: HorseDecideOpts) {
  // The same spot and seed are reset in EACH arm. No previous-arm plans or
  // winner memory can supply an unintended treatment.
  HorseMind.reset();
  resetWinnerReads();
  drainFires();
  seedFastRandom(seed);
  const decision = HorseLogic.decide(
    structuredClone(hero),
    structuredClone(gs),
    'balanced',
    {},
    {
      mind: false,
      telemetry: true,
      decisionTimeMs: CLOCK,
      v87HoldemOverhaul: true,
      ...opts,
    }
  );
  const result = {
    decision,
    rngAfter: saveFastRandom(),
    fires: Object.fromEntries(drainFires().map((r) => [r.feature, r.fires])),
  };
  expect(gs.legalActions).toContain(decision.action);
  if (decision.amount !== undefined) {
    expect(Number.isFinite(decision.amount)).toBe(true);
    expect(decision.amount).toBeGreaterThanOrEqual(0);
    expect(decision.amount).toBeLessThanOrEqual(hero.stack + hero.bet);
  }
  return result;
}

function riverSpot(index: number, raised: boolean) {
  const hero = player(
    2,
    `77000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    400,
    cards('As Js')
  );
  const villain = player(1, '77000000-0000-4000-8000-00000000bb02', 300);
  const history: ActionRecord[] = [
    {
      seat: 1,
      userId: villain.user_id,
      stage: 'preflop',
      action: 'raise',
      amount: 6,
      isFullRaise: true,
      timestamp: 1,
    },
    { seat: 2, userId: hero.user_id, stage: 'preflop', action: 'call', amount: 6, timestamp: 2 },
    { seat: 2, userId: hero.user_id, stage: 'flop', action: 'check', amount: 0, timestamp: 3 },
    { seat: 1, userId: villain.user_id, stage: 'flop', action: 'check', amount: 0, timestamp: 4 },
    {
      seat: 2,
      userId: hero.user_id,
      stage: 'turn',
      action: 'bet',
      amount: 12,
      isFullRaise: true,
      timestamp: 5,
    },
    { seat: 1, userId: villain.user_id, stage: 'turn', action: 'call', amount: 12, timestamp: 6 },
  ];
  if (raised) {
    hero.bet = 24;
    hero.stack -= 24;
    villain.bet = 96;
    villain.stack -= 96;
    history.push(
      {
        seat: 2,
        userId: hero.user_id,
        stage: 'river',
        action: 'bet',
        amount: 24,
        isFullRaise: true,
        timestamp: 7,
      },
      {
        seat: 1,
        userId: villain.user_id,
        stage: 'river',
        action: 'raise',
        amount: 96,
        isFullRaise: true,
        timestamp: 8,
      }
    );
  }
  const gs: HorseGameStateV2 = {
    stage: 'river',
    gameVariant: 'nlh',
    gameMode: 'cash',
    format: 'cash',
    pot: raised ? 200 : 80,
    currentBet: raised ? 96 : 0,
    minRaise: raised ? 192 : 2,
    smallBlind: 1,
    bigBlind: 2,
    dealerSeat: 1,
    communityCards: cards('Ks Qd 9s 4s 2c'),
    players: [villain, hero],
    dealtSeatIds: [1, 2],
    actionHistory: history,
    legalActions: raised ? ['fold', 'call', 'raise', 'all_in'] : ['check', 'bet', 'all_in'],
  };
  return { hero, gs };
}

const TABLE = 'fa900000-0000-4000-8000-000000000909';
const HERO = 'fa900000-0000-4000-8000-000000000002';
const OPPONENT = 'fa900000-0000-4000-8000-000000000006';
const scope = readScopeOf('nlh', 6);
const winnerScope = winnerReadScopeOf('nlh', 'cash');

function workerRequest(threeWay = false): FastHorseDecisionRequest {
  const players = [1, 2, 3, 4, 5, 6].map((seat) => {
    const p = player(
      seat,
      seat === 2 ? HERO : seat === 6 ? OPPONENT : `fa900000-0000-4000-8000-00000000000${seat}`,
      seat === 2 ? 190 : seat === 6 ? 184 : 200,
      seat === 2 ? cards('8h 8s') : []
    );
    p.bet = seat === 6 ? 6 : 0;
    p.totalInvested = seat === 2 ? 6 : seat === 6 ? 12 : seat === 3 ? 1 : 0;
    p.is_folded = seat !== 2 && seat !== 6 && !(threeWay && seat === 3);
    if (threeWay && seat === 3) p.totalInvested = 6;
    return p;
  });
  const history: ActionRecord[] = [
    {
      seat: 6,
      userId: OPPONENT,
      stage: 'preflop',
      action: 'raise',
      amount: 6,
      isFullRaise: true,
      timestamp: 1,
    },
    { seat: 2, userId: HERO, stage: 'preflop', action: 'call', amount: 6, timestamp: 2 },
    { seat: 2, userId: HERO, stage: 'flop', action: 'check', amount: 0, timestamp: 3 },
    { seat: 6, userId: OPPONENT, stage: 'flop', action: 'bet', amount: 6, timestamp: 4 },
  ];
  if (threeWay) {
    history.splice(2, 0, {
      seat: 3,
      userId: players[2].user_id,
      stage: 'preflop',
      action: 'call',
      amount: 6,
      timestamp: 3,
    });
    history.splice(4, 0, {
      seat: 3,
      userId: players[2].user_id,
      stage: 'flop',
      action: 'check',
      amount: 0,
      timestamp: 5,
    });
    history.forEach((record, index) => {
      record.timestamp = index + 1;
    });
  }
  const gs: HorseGameStateV2 = {
    stateSchemaVersion: 1,
    stage: 'flop',
    gameVariant: 'nlh',
    variantRules: horseVariantRulesFor('nlh'),
    bettingStructure: 'no_limit',
    fixedBetSize: null,
    wagersCapped: false,
    commitmentCapRemaining: null,
    pots: [
      {
        amount: threeWay ? 24 : 19,
        eligiblePlayers: threeWay ? [HERO, OPPONENT, players[2].user_id] : [HERO, OPPONENT],
      },
    ],
    rakeConfig: { percent: 5, cap: 6, noFlopNoDrop: true },
    gameMode: 'cash',
    format: 'cash',
    pot: threeWay ? 24 : 19,
    contestablePot: threeWay ? 24 : 19,
    currentBet: 6,
    minRaise: 6,
    lastRaise: 6,
    smallBlind: 1,
    bigBlind: 2,
    dealerSeat: 1,
    heroSeat: 2,
    currentPlayerSeat: 2,
    communityCards: cards('7c 6d 5s'),
    players: players.map((p) => ({ ...p, cards: [] })),
    dealtSeatIds: [1, 2, 3, 4, 5, 6],
    actionHistory: history,
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    toCall: 6,
    minRaiseTo: 12,
    maxRaiseTo: 190,
  };
  const draft: FastHorseDecisionRequest = {
    type: 'DECIDE_FAST',
    requestId: 101,
    generation: 1,
    fence: `${TABLE}:1:2:50000000-0000-4000-8000-000000000001:1`,
    decisionKey: '',
    decisionTimeMs: 20_000,
    handJournalContext: captureHorseHandJournalContext(history),
    player: players[1],
    gameState: gs,
    style: 'grinder',
    mods: {
      tightness: 0.98,
      aggression: 1.18,
      bluffFreq: 0.91,
      sizingMultiplier: 0.94,
      referenceNlhOpenings: true,
    },
    opts: { v87HoldemOverhaul: true },
  };
  return { ...draft, decisionKey: buildHorseDecisionKey(draft) };
}

const publicProfiles = [
  {
    user_id: OPPONENT,
    variant: 'nlh' as const,
    mode: 'cash' as const,
    size: 'full' as const,
    observed_hands: 200,
    initialized: true,
    counters: {
      hands: 150,
      vpip: 38,
      pfr: 30,
      rfiOpp: 45,
      rfi: 20,
      threeBetOpp: 30,
      threeBet: 4,
      foldTo3BetOpp: 20,
      foldTo3Bet: 10,
      betCheckedToOpp: 60,
      betCheckedTo: 14,
      foldToBetOpp: 40,
      foldToBet: 26,
      riverCallOpp: 12,
      riverCall: 4,
      fHands: 8,
      fPfr: 2,
      fRfiOpp: 4,
      fRfi: 1,
      fThreeBetOpp: 3,
      fThreeBet: 0,
      fBetCheckedToOpp: 8,
      fBetCheckedTo: 2,
      fFoldToBetOpp: 6,
      fFoldToBet: 4,
      fRiverCallOpp: 2,
      fRiverCall: 0,
    },
  },
];

async function workerArm(
  winner: boolean,
  flop: boolean,
  checkRaisePolicy = true,
  lagProfile = false
) {
  const winnerReads = createWinnerReadState();
  if (winner) {
    const row = { w: 450, w2: 450, s: 675, q: 5100 };
    winnerReads.rows.set(`${winnerScope}|${OPPONENT}`, { ...row });
    winnerReads.rows.set(OPPONENT, { ...row });
  }
  const flopStab = new Map(
    flop
      ? [
          [
            `${scope}|${OPPONENT}`,
            {
              flopCheckedToOpps: 26,
              flopBetCheckedTo: 22,
              fFlopCheckedToOpps: 10,
              fFlopBetCheckedTo: 9,
            },
          ],
        ]
      : []
  );
  const messages: HorseDecisionWorkerResponse[] = [];
  const observed: Array<{
    highFlopStab: boolean;
    provenWinner: boolean;
    lagBully: boolean;
    exploit: ReturnType<typeof HorseMind.exploit>;
    fires: Record<string, number>;
    rngAfter: number;
  }> = [];
  const rt = new HorseDecisionWorkerRuntime((m) => messages.push(m), {
    ...defaultHorseDecisionWorkerDependencies,
    startServices: async () => ({
      solverStores: { charts: 0, postflop: 0, postflopV31: 0, postflopV31Dataset: null },
      solverPolicyArtifact: solverPolicyArtifactStatus(),
      governor: equityGovernor.snapshot(),
    }),
    admitFeatureAuthority: () => qualifiedTestAdmission(),
    // Every arm has identical authorized public profiles and availability.
    publicProfileBootstrap: () => ({
      availableAtMs: 5_000,
      profiles: publicProfiles.map((p) => ({
        ...structuredClone(p),
        counters: {
          ...p.counters,
          ...(lagProfile
            ? {
                vpip: 82,
                pfr: 52,
                rfi: 28,
                threeBet: 10,
                fPfr: 5,
                fRfi: 3,
                fThreeBet: 1,
              }
            : {}),
        },
      })),
    }),
    exploitFloorBootstrap: () => ({
      hands: 200,
      rows: 1,
      availableAtMs: 5_000,
      winnerReads,
      flopStab,
    }),
    decide: (...args) => {
      drainFires();
      HorseMind.setDecisionScope(scope, 'nlh', 'cash');
      const loadedReads = {
        highFlopStab: HorseMind.streetBullyRead(OPPONENT).highFlopStab,
        provenWinner: isProvenWinner(OPPONENT, winnerScope),
        lagBully: HorseMind.isLagBully(OPPONENT),
        exploit: HorseMind.exploit(OPPONENT),
      };
      HorseMind.setDecisionScope(null);
      // Trusted in-process worker seam: preserve the SAME request/sampling key
      // while changing only this policy. No live IPC control is being tested.
      const decision = HorseLogic.decide(args[0], args[1], args[2], args[3], {
        ...args[4],
        telemetry: true,
        v87FlopStabCheckRaise: checkRaisePolicy,
      });
      observed.push({
        ...loadedReads,
        fires: Object.fromEntries(drainFires().map((r) => [r.feature, r.fires])),
        rngAfter: saveFastRandom(),
      });
      HorseMind.setDecisionScope(null);
      return decision;
    },
  });
  await rt.start();
  const request = workerRequest(lagProfile);
  expect(request.handJournalContext).toBeDefined();
  rt.receive(request);
  await rt.drain();
  const fast = messages.find((m) => m.type === 'FAST_RESULT');
  expect(fast, JSON.stringify(messages)).toBeDefined();
  if (fast?.type !== 'FAST_RESULT') throw new Error('Missing fast result');
  const deepDraft = {
    ...request,
    type: 'DECIDE_DEEP' as const,
    requestId: 102,
    rngBefore: fast.rngBefore,
    deepEquity: 2,
  };
  rt.receive({ ...deepDraft, decisionKey: buildHorseDecisionKey(deepDraft) });
  await rt.drain();
  const deep = messages.find((m) => m.type === 'DEEP_RESULT');
  if (deep?.type !== 'DEEP_RESULT')
    throw new Error(`Missing deep result: ${JSON.stringify(messages)}`);
  expect(observed).toHaveLength(2);
  for (const decision of [fast.decision, deep.decision]) {
    expect(request.gameState.legalActions).toContain(decision.action);
    if (decision.action === 'raise') expect(decision.amount).toBeGreaterThanOrEqual(12);
    if (decision.amount !== undefined)
      expect(decision.amount).toBeLessThanOrEqual(request.player.stack);
  }
  return {
    winner,
    flop,
    checkRaisePolicy,
    lagProfile,
    requestKey: request.decisionKey,
    rngBefore: fast.rngBefore,
    fast: fast.decision,
    deep: deep.decision,
    observed,
  };
}

let savedRng: ReturnType<typeof saveFastRandom>;
beforeEach(() => {
  savedRng = saveFastRandom();
  HorseMind.reset();
  resetWinnerReads();
  enableBrainTelemetry();
  drainFires();
  vi.stubGlobal('fetch', () => {
    throw new Error('Network access in offline ablation');
  });
});
afterEach(() => {
  restoreFastRandom(savedRng);
  HorseMind.reset();
  resetWinnerReads();
  drainFires();
  vi.unstubAllGlobals();
});
afterAll(() => {
  const output = process.env.HOLD_EM_FEATURE_ABLATION_OUTPUT;
  if (!output) return;
  if (!isAbsolute(output))
    throw new Error('Ablation output must be an absolute new archive filename');
  const paths = [
    'src/benchmark/HoldemV87FeatureAblation.test.ts',
    'src/engine/HorseLogic.ts',
    'src/engine/HorseMind.ts',
    'src/engine/HorseWinnerRead.ts',
    'src/engine/HorseDecisionReadFrame.ts',
    'src/engine/horseDecision/workerRuntime.ts',
    'src/engine/horseDecision/observerReads.ts',
    'src/engine/horseDecision/protocol.ts',
  ];
  writeFileSync(
    output,
    JSON.stringify(
      {
        schemaVersion: 1,
        recordedAt: new Date().toISOString(),
        node: process.version,
        complete: reports.length === 4,
        expectedCells: 4,
        completedCells: reports.length,
        sourceHashes: Object.fromEntries(
          paths.map((p) => [p, createHash('sha256').update(readFileSync(p)).digest('hex')])
        ),
        limitations: [
          'Fixed synthetic diagnostic spots, not settled-hand EV, bb/100, tournament ROI or statistical superiority.',
          'Winner hydration and flop-read removal are independent input ablations with public profiles held fixed.',
          'The flop policy OFF arm preserves reads and the worker sampling key through the trusted decide dependency.',
          'Timing changes are reported as timing only; no timing-to-profit inference.',
          'No database, network, live telemetry flush, worker-process IPC or production activation proof.',
        ],
        inputs: {
          clockMs: CLOCK,
          publicProfiles,
          winnerRequest: workerRequest(),
          flopRequest: workerRequest(true),
        },
        cells: reports,
      },
      null,
      2
    ) + '\n',
    { flag: 'wx' }
  );
});

describe('V87 four-feature same-input offline ablations', () => {
  it('isolates the river nut-trap lead and re-raise policy without switching off V87', () => {
    const pairs: Array<{
      index: number;
      raised: boolean;
      seed: number;
      on: ReturnType<typeof direct>;
      off: ReturnType<typeof direct>;
    }> = [];
    for (const raised of [false, true])
      for (let i = 0; i < 32; i++) {
        const { hero, gs } = riverSpot(i, raised);
        const seed = 0x88000 + (i + 1) * 7919;
        pairs.push({
          index: i,
          raised,
          seed,
          on: direct(hero, gs, seed, { v87RiverBlockBetTrap: true }),
          off: direct(hero, gs, seed, { v87RiverBlockBetTrap: false }),
        });
      }
    const totals = (arm: 'on' | 'off', feature: string) =>
      pairs.reduce((n, p) => n + (p[arm].fires[feature] ?? 0), 0);
    expect(totals('on', 'v87_river_block_nut_trap')).toBeGreaterThan(0);
    expect(totals('on', 'v87_river_block_trap_reraise')).toBeGreaterThan(0);
    expect(totals('off', 'v87_river_block_nut_trap')).toBe(0);
    expect(totals('off', 'v87_river_block_trap_reraise')).toBe(0);
    expect(
      pairs.some(
        (p) => JSON.stringify(action(p.on.decision)) !== JSON.stringify(action(p.off.decision))
      )
    ).toBe(true);
    reports.push({
      feature: 'river_block_bet_nut_trap',
      status: 'passed',
      comparison: 'exact policy OFF',
      pairedSpots: pairs.length,
      pairs,
    });
  });

  it('isolates Hollywood timing with identical actions, amounts and PRNG states', () => {
    const pairs = [];
    for (let i = 0; i < 96; i++) {
      const hero = player(2, `hollywood-horse-${i}`, 240, cards('Qs Js'));
      const villain = player(1, 'hollywood-opponent', 240);
      const gs: HorseGameStateV2 = {
        stage: 'river',
        gameVariant: 'nlh',
        gameMode: 'cash',
        format: 'cash',
        players: [villain, hero],
        communityCards: cards('As Kd 8s 3s 2c'),
        pot: 60,
        currentBet: 0,
        minRaise: 2,
        lastRaise: 2,
        bigBlind: 2,
        smallBlind: 1,
        dealerSeat: 2,
        legalActions: ['check', 'bet', 'all_in'],
        actionHistory: [
          {
            seat: 1,
            userId: villain.user_id,
            stage: 'river',
            action: 'check',
            amount: 0,
            timestamp: 6001,
          },
        ],
      };
      const seed = 88000 + i * 97;
      const on = direct(hero, gs, seed, { v87HollywoodTank: true, turnDeadlineMs: CLOCK + 15_000 });
      const off = direct(hero, gs, seed, {
        v87HollywoodTank: false,
        turnDeadlineMs: CLOCK + 15_000,
      });
      expect(action(on.decision)).toEqual(action(off.decision));
      expect(on.rngAfter).toBe(off.rngAfter);
      expect(on.decision.thinkTime).toBeGreaterThanOrEqual(off.decision.thinkTime);
      expect(on.decision.thinkTime).toBeLessThanOrEqual(13_500);
      pairs.push({ index: i, seed, on, off });
    }
    const changed = pairs.filter(
      (p) => p.on.decision.thinkTime !== p.off.decision.thinkTime
    ).length;
    expect(changed).toBeGreaterThan(0);
    const meanDelayDeltaMs =
      pairs.reduce((n, p) => n + p.on.decision.thinkTime - p.off.decision.thinkTime, 0) /
      pairs.length;
    reports.push({
      feature: 'hollywood_timing',
      status: 'passed',
      comparison: 'exact timing policy OFF',
      pairedSpots: pairs.length,
      timingChangedPairs: changed,
      meanDelayDeltaMs,
      pairs,
    });
  });

  it('isolates winner hydration while keeping public profiles and flop-stab reads unchanged', async () => {
    const on = await workerArm(true, true);
    const off = await workerArm(false, true);
    expect(on.requestKey).toBe(off.requestKey);
    expect(on.rngBefore).toBe(off.rngBefore);
    for (let i = 0; i < 2; i++) {
      expect(on.observed[i].provenWinner).toBe(true);
      expect(off.observed[i].provenWinner).toBe(false);
      expect(on.observed[i].highFlopStab, JSON.stringify(on.observed)).toBe(true);
      expect(off.observed[i].highFlopStab).toBe(true);
      expect(on.observed[i].lagBully).toBe(false);
      expect(off.observed[i].lagBully).toBe(false);
      expect(on.observed[i].exploit.bluffMod).toBeLessThan(off.observed[i].exploit.bluffMod);
      expect(on.observed[i].exploit.valueThinMod).toBeLessThanOrEqual(
        off.observed[i].exploit.valueThinMod
      );
    }
    reports.push({
      feature: 'winner_read_hydration',
      status: 'passed',
      comparison: 'winner read input removed only',
      pairedSpots: 1,
      paths: ['DECIDE_FAST', 'DECIDE_DEEP'],
      on,
      off,
      decisionChanged: JSON.stringify(action(on.fast)) !== JSON.stringify(action(off.fast)),
    });
  });

  it('separates flop check-raise policy OFF from removal of only the flop-stab read', async () => {
    const on = await workerArm(true, true, true, true);
    const policyOff = await workerArm(true, true, false, true);
    const readRemoved = await workerArm(true, false, true, true);
    for (const arm of [policyOff, readRemoved]) {
      expect(arm.requestKey).toBe(on.requestKey);
      expect(arm.rngBefore).toBe(on.rngBefore);
    }
    for (let i = 0; i < 2; i++) {
      expect(on.observed[i].highFlopStab, JSON.stringify(on.observed)).toBe(true);
      expect(policyOff.observed[i].highFlopStab).toBe(true);
      expect(readRemoved.observed[i].highFlopStab).toBe(false);
      for (const arm of [on, policyOff, readRemoved])
        expect(arm.observed[i].provenWinner).toBe(true);
      expect(
        on.observed[i].fires.v87_flop_stab_check_raise ?? 0,
        JSON.stringify({
          on: { fast: action(on.fast), deep: action(on.deep), observed: on.observed },
          policyOff: { fast: action(policyOff.fast), deep: action(policyOff.deep) },
        })
      ).toBe(1);
      expect(policyOff.observed[i].fires.v87_flop_stab_check_raise ?? 0).toBe(0);
      expect(readRemoved.observed[i].fires.v87_flop_stab_check_raise ?? 0).toBe(0);
    }
    expect(on.fast.action).toBe('raise');
    expect(on.deep.action).toBe('raise');
    expect(action(policyOff.fast)).not.toEqual(action(on.fast));
    expect(action(policyOff.deep)).not.toEqual(action(on.deep));
    reports.push({
      feature: 'flop_stab_check_raise',
      status: 'passed',
      comparison: 'exact policy OFF plus separate read removal',
      pairedSpots: 1,
      paths: ['DECIDE_FAST', 'DECIDE_DEEP'],
      on,
      policyOff,
      readRemoved,
    });
  });
});
