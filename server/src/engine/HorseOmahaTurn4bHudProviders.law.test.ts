/**
 * LAW: PRODUCTION WORKER WIRES ALL THREE TURN 4B OMAHA LIFETIME-HUD PROVIDERS (PLO-OWNER lead-4, 2026-11-22).
 *
 * Regression guard for AUDIT-24H-RULES-HUD P0-1: HorseDecisionWorkerRuntime must wire both
 * HorseMind.setOmahaLifetimeStreetRecordProvider (omahaStabDefenceIsPriced, omahaRiverBetFoldIsHisRecord)
 * and setOmahaCbetRaiseRecordProvider (omahaCbetRaiseIsPriced) onto the worker's installed decision HUD
 * packet so those Turn 4B consumers read live lifetime HUD counts in production instead of silently
 * running as no-ops on null providers.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { HorseDecision } from '../types.js';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import {
  OMAHA_CBET_RAISE_SHARE_POP,
  omahaCbetRaiseShare,
  setOmahaCbetRaiseRecordProvider,
} from './HorseOmahaCbetRaisePriced.js';
import { equityGovernor } from './EquityLoadGovernor.js';
import { restoreFastRandom, saveFastRandom } from './HorseEval.js';
import { liveHorsePhase8Safety } from './HorsePhase8Safety.js';
import { prepareTournamentFutureHandFacts } from './HorseTournamentFutureHand.js';
import { solverPolicyArtifactStatus } from '../gto/SolverPolicyArtifactLoader.js';
import {
  buildHudPacket,
  clearDecisionHud,
  type OpponentHudPacket,
} from './opponentHud/OpponentHud.js';
import { emptyHudProfile } from './opponentHud/OpponentHudProfile.js';
import {
  buildHorseDecisionKey,
  type FastHorseDecisionRequest,
  type HorseDecisionWorkerResponse,
} from './horseDecision/protocol.js';
import {
  HorseDecisionWorkerRuntime,
  type HorseDecisionWorkerDependencies,
} from './horseDecision/workerRuntime.js';
import { currentReplaySolverStores } from './horseDecision/replay/references.js';
import { qualifiedReplayAdmissions } from './horseDecision/replay/qualifiedAuthority.js';
import {
  PHASE6C_FIXTURE_IDS as IDS,
  phase6cFixtureBody,
  phase6cFixtureRecord,
} from './horseDecision/replay/fixtures/index.js';

const DECISION_TIME_MS = Date.UTC(2099, 0, 1, 0, 0, 30);
const OPP_ID = '50000000-0000-4000-8000-0000000000e1';

const readiness = () => {
  const { identity, charts, postflop, postflopV31, postflopV31Dataset } =
    currentReplaySolverStores();
  return {
    solverStores: { charts, postflop, postflopV31, postflopV31Dataset },
    solverStoreIdentity: identity,
    solverPolicyArtifact: solverPolicyArtifactStatus(),
    governor: equityGovernor.snapshot(),
  };
};

function makePlo5Packet(street: 'flop' | 'turn' | 'river'): OpponentHudPacket {
  const p = emptyHudProfile(OPP_ID, 'plo5');
  p.hands = 400;
  p.recAt = DECISION_TIME_MS;
  p.life['t.stab.hu'] = [80, 52];
  p.life['t.lead.hu'] = [40, 18];
  p.life['r.stab.hu'] = [60, 30];
  p.life['r.lead.hu'] = [30, 12];
  p.life['r.stabsz.hu'] = [30, 12]; // sizeSum = 2 * 12 = 24
  p.life['r.fb.sm.hu'] = [60, 42];
  p.life['r.fb.bg.hu'] = [50, 35];
  p.xc = {
    'f.cbr.hu.half.opps': 80,
    'f.cbr.hu.half.raise': 48,
    'f.cbr.hu.half.shortAllIn': 4,
    'f.cbr.hu.half.call': 18,
    'f.cbr.hu.half.fold': 10,
  };
  return buildHudPacket('plo5', [p], {}, DECISION_TIME_MS, street);
}

async function runOneDecision(
  opponentHud: OpponentHudPacket | undefined,
  inspect: () => void
): Promise<void> {
  const snapshot = phase6cFixtureBody<{ snapshot: FastHorseDecisionRequest }>(
    phase6cFixtureRecord(IDS.cashNlhRiver)
  ).snapshot;
  const base = {
    ...snapshot,
    requestId: 1,
    decisionTimeMs: DECISION_TIME_MS,
    ...(opponentHud ? { opponentHud } : { opponentHud: undefined }),
  } as unknown as FastHorseDecisionRequest;
  const request: FastHorseDecisionRequest = { ...base, decisionKey: buildHorseDecisionKey(base) };
  const messages: HorseDecisionWorkerResponse[] = [];
  const deps: HorseDecisionWorkerDependencies = {
    ...qualifiedReplayAdmissions,
    journalEnabled: () => false,
    async startServices() {
      prepareTournamentFutureHandFacts();
      return readiness();
    },
    async stopServices() {},
    decide: (() => {
      inspect();
      return { action: 'check', thinkTime: 0 } as HorseDecision;
    }) as never,
    decideDiscard: HorseLogic.decideDiscard.bind(HorseLogic),
    captureDecisionEffects: (fn) => HorseMind.captureDecisionEffects(fn),
    applyDecisionEffects: () => {},
    saveRng: saveFastRandom,
    restoreRng: restoreFastRandom,
    governorScale: () => equityGovernor.current(),
    atGovernorScale: (fn) => equityGovernor.withDecisionScale(fn),
    workerReadiness: readiness,
    phase8SafetyDisabledReason: () => liveHorsePhase8Safety.disabledReason,
    observeCompletedHand: () => {},
    noteDecision: () => {},
    noteFeature: () => {},
    now: () => 1_000,
  };
  const runtime = new HorseDecisionWorkerRuntime((m) => messages.push(m), deps);
  await runtime.start();
  runtime.receive(request);
  await runtime.drain();
  expect(messages.some((m) => m.type === 'FAST_RESULT')).toBe(true);
}

afterEach(() => {
  clearDecisionHud();
  HorseMind.setOmahaLifetimeStreetRecordProvider(null);
  setOmahaCbetRaiseRecordProvider(null);
  HorseMind.reset();
});

describe('HorseDecisionWorkerRuntime wires all three Turn 4B Omaha lifetime-HUD providers', () => {
  it('re-wires providers even after explicit null reset and serves live turn/river/flop HUD counts', async () => {
    HorseMind.setOmahaLifetimeStreetRecordProvider(null);
    setOmahaCbetRaiseRecordProvider(null);

    let turnStab: ReturnType<typeof HorseMind.omahaStabDefenceRecordOf> = null;
    await runOneDecision(makePlo5Packet('turn'), () => {
      expect(HorseMind.omahaLifetimeStreetRecordProviderIsSet()).toBe(true);
      turnStab = HorseMind.omahaStabDefenceRecordOf(OPP_ID, 'plo5', 'turn', 1);
    });
    expect(turnStab).toEqual({ bets: 70, opps: 120 });

    let riverRecords: ReturnType<typeof HorseMind.omahaStrongHandCheckRecordsOf> | null = null;
    await runOneDecision(makePlo5Packet('river'), () => {
      riverRecords = HorseMind.omahaStrongHandCheckRecordsOf(OPP_ID, 'plo5', 'river', 1);
    });
    expect(riverRecords).not.toBeNull();
    expect(riverRecords!.foldSmall).toEqual({ folds: 42, opps: 60 });
    expect(riverRecords!.foldBig).toEqual({ folds: 35, opps: 50 });
    expect(riverRecords!.stabSize).toEqual({ stabs: 30, sizeSum: 24 });

    let cbetShare: ReturnType<typeof omahaCbetRaiseShare> | null = null;
    await runOneDecision(makePlo5Packet('flop'), () => {
      cbetShare = omahaCbetRaiseShare(OPP_ID, 'plo5', 'hu', 'half');
    });
    expect(cbetShare).not.toBeNull();
    expect(cbetShare!.opps).toBe(80);
    expect(cbetShare!.raises).toBe(52);
    expect(cbetShare!.rho).toBeGreaterThan(OMAHA_CBET_RAISE_SHARE_POP.hu.half);
  });

  it('returns null / exact population prior when no opponentHud packet or wrong game family is installed', async () => {
    let stabNoPacket: ReturnType<typeof HorseMind.omahaStabDefenceRecordOf> = { bets: 1, opps: 1 };
    let riverNoPacket: ReturnType<typeof HorseMind.omahaStrongHandCheckRecordsOf> | null = null;
    let cbetNoPacket: ReturnType<typeof omahaCbetRaiseShare> | null = null;
    await runOneDecision(undefined, () => {
      stabNoPacket = HorseMind.omahaStabDefenceRecordOf(OPP_ID, 'plo5', 'turn', 1);
      riverNoPacket = HorseMind.omahaStrongHandCheckRecordsOf(OPP_ID, 'plo5', 'river', 1);
      cbetNoPacket = omahaCbetRaiseShare(OPP_ID, 'plo5', 'hu', 'half');
    });
    expect(stabNoPacket).toBeNull();
    expect(riverNoPacket).toEqual({ foldSmall: null, foldBig: null, stabSize: null });
    expect(cbetNoPacket!.opps).toBe(0);
    expect(cbetNoPacket!.rho).toBe(OMAHA_CBET_RAISE_SHARE_POP.hu.half);

    // Wrong family (plo5 packet queried as plo4) fails closed to null / population prior
    let stabWrongFamily: ReturnType<typeof HorseMind.omahaStabDefenceRecordOf> = {
      bets: 1,
      opps: 1,
    };
    let cbetWrongFamily: ReturnType<typeof omahaCbetRaiseShare> | null = null;
    await runOneDecision(makePlo5Packet('flop'), () => {
      stabWrongFamily = HorseMind.omahaStabDefenceRecordOf(OPP_ID, 'plo4', 'turn', 1);
      cbetWrongFamily = omahaCbetRaiseShare(OPP_ID, 'plo4', 'hu', 'half');
    });
    expect(stabWrongFamily).toBeNull();
    expect(cbetWrongFamily!.opps).toBe(0);
    expect(cbetWrongFamily!.rho).toBe(OMAHA_CBET_RAISE_SHARE_POP.hu.half);
  });
});
