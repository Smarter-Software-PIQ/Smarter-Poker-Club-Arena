/**
 * AN OPTION RECEIPT RIDES THE WORKER'S REPLY, AND A REPLY WITHOUT ONE IS BYTE FOR BYTE WHAT IT WAS (2026-11-25).
 *
 * Per-hand option receipts (HorseHandOptionReceipts). Through the real worker runtime, on a real controller spot:
 *  - a FAST decision a listed option changed answers with `optionReceipts`: the option's name and the kind of
 *    action before and after, and nothing else (the amount the rule receipt carried is not there);
 *  - a decision no rule changed, and one only another lane's rule changed, answer with no such key, and the two
 *    replies are the same bytes: the reply of every decision the feature does not touch is unchanged;
 *  - with the receipts taken off, the reply of a receipted decision is the same bytes as an unreceipted one:
 *    the receipt adds a field and changes nothing else;
 *  - a receipt whose action is not one of the six action words (a card string put there on purpose) never
 *    leaves the worker;
 *  - the second look answers with its own receipts on DEEP_RESULT, and with no key when it has none.
 * No production account, card or service is used.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { HandController } from '../HandController.js';
import { HorseLogic } from '../HorseLogic.js';
import { HorseMind } from '../HorseMind.js';
import { seedFastRandom } from '../HorseEval.js';
import {
  disarmBrainTelemetryForTest,
  drainFires,
  enableBrainTelemetry,
  noteDecisionRuleReceipt,
} from '../BrainTelemetry.js';
import {
  defaultHorseDecisionWorkerDependencies as defaults,
  HorseDecisionWorkerRuntime,
} from './workerRuntime.js';
import { buildHorseDecisionKey } from './protocol.js';
import type {
  DeepHorseDecisionResult,
  FastHorseDecisionRequest,
  FastHorseDecisionResult,
  HorseDecisionWorkerResponse,
} from './protocol.js';
import type { HandConfig, SeatPlayer } from '../../types.js';
import { controllerDecisionState } from '../remainingVariants/RemainingVariantControllerSpots.test-support.js';
import { captureHorseHandJournalContext } from '../HorseDecisionHandBinding.js';
import { applyTableCommitmentCap } from '../ServerTableEngineTurns.js';

const TABLE = '10000000-0000-4000-8000-00000000c0a1';
const HAND = 77001;
const HERO = '20000000-0000-4000-8000-00000000c0a4';
const VILLAIN = '20000000-0000-4000-8000-00000000c0a1';

afterEach(() => {
  vi.restoreAllMocks();
  drainFires();
  disarmBrainTelemetryForTest();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

type Recorder = () => void;

function workerWith(messages: HorseDecisionWorkerResponse[], record: { fn: Recorder }) {
  return new HorseDecisionWorkerRuntime((m) => messages.push(m), {
    ...defaults,
    startServices: async () => defaults.workerReadiness(),
    stopServices: async () => {},
    // The real brain decides; the recorder then stands in for a rule that changed the decision (it records a
    // rule receipt in the open decision scope exactly as a rule does, and touches nothing else).
    decide: ((...args: Parameters<typeof HorseLogic.decide>) => {
      const decision = HorseLogic.decide(...args);
      record.fn();
      return decision;
    }) as typeof HorseLogic.decide,
    now: () => 1_764_000_000_000,
    journalEnabled: () => false,
    journalDecision: () => {},
    journalAcceptedHand: () => {},
    journalLifecycle: () => {},
    sourceRelease: () => null,
    admitPhase8Authority: undefined,
    admitPhase10Authority: undefined,
    admitPhase11Authority: undefined,
    admitPhase12Authority: undefined,
    admitPhase13Authority: undefined,
    noteFeature: () => {},
    noteDecision: () => {},
  });
}

/** Heads-up NLH cash, preflop: the Horse on the button is first to act. */
function fastRequest(requestId: number): FastHorseDecisionRequest {
  const config = {
    tableId: TABLE,
    handNumber: HAND,
    gameVariant: 'nlh',
    smallBlind: 1,
    bigBlind: 2,
    isTournament: false,
    rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
  } as HandConfig;
  const players = [HERO, VILLAIN].map((user_id, i) => ({
    seat: i + 1,
    user_id,
    username: `Seat ${i + 1}`,
    stack: 400,
    bet: 0,
    totalInvested: 0,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  })) as SeatPlayer[];
  const controller = new HandController(config, players, 1);
  controller.start();
  const spot = controllerDecisionState(controller, 'nlh' as never, 'cash', config)!;
  expect(spot.hero.user_id).toBe(HERO);
  spot.state.commitmentCapRemaining = applyTableCommitmentCap(
    controller.getAuthoritativeActionState(HERO)!,
    spot.hero,
    false,
    0,
    2
  ).commitmentCapRemaining;
  const request = {
    type: 'DECIDE_FAST' as const,
    requestId,
    generation: 1,
    fence: `${TABLE}:${HAND}:${spot.hero.seat}:9:${requestId}`,
    decisionKey: '',
    decisionTimeMs: Date.UTC(2026, 10, 25, 18, 0, 0),
    player: spot.hero,
    gameState: spot.state,
    style: 'balanced' as const,
    mods: {},
    handJournalContext: captureHorseHandJournalContext(spot.state.actionHistory!),
  };
  request.decisionKey = buildHorseDecisionKey(request);
  return request as FastHorseDecisionRequest;
}

async function fastReply(
  request: FastHorseDecisionRequest,
  recorder: Recorder
): Promise<FastHorseDecisionResult> {
  HorseMind.reset();
  enableBrainTelemetry();
  seedFastRandom(20261125);
  const messages: HorseDecisionWorkerResponse[] = [];
  const worker = workerWith(messages, { fn: recorder });
  await worker.start();
  worker.receive(structuredClone(request));
  await worker.drain();
  const result = messages.find((m): m is FastHorseDecisionResult => m.type === 'FAST_RESULT');
  expect(result, JSON.stringify(messages.at(-1))).toBeDefined();
  return result!;
}

/**
 * The reply's bytes, with the two things that are not the reply's content held still: each test worker is its own
 * process identity (a random authority epoch), and a decision carries its own stopwatch readings.
 */
const bytes = (reply: unknown): string =>
  JSON.stringify(reply)
    .replace(/"epoch":"[0-9a-f-]{36}"/g, '"epoch":"<worker>"')
    .replace(/"(latencyMs|elapsedMs)":[0-9.e+-]+/g, '"$1":"<stopwatch>"');

const LISTED: Recorder = () =>
  noteDecisionRuleReceipt(
    'cashDefenceTrimColdCalls',
    { action: 'call', amount: 4 },
    { action: 'fold', amount: null }
  );
const OTHER_LANE: Recorder = () =>
  noteDecisionRuleReceipt('omaha_turn_set_pound', null, { action: 'bet', amount: 12 });
const NOTHING: Recorder = () => {};

it('a listed option that changed the decision is in the reply as its name and two action kinds only', async () => {
  const request = fastRequest(301);
  const plain = await fastReply(request, NOTHING);
  const other = await fastReply(request, OTHER_LANE);
  const listed = await fastReply(request, LISTED);

  // No receipt of a listed option: no key, and the bytes of the reply are what they are without the feature.
  expect(Object.keys(plain)).not.toContain('optionReceipts');
  expect(Object.keys(other)).not.toContain('optionReceipts');
  expect(bytes(other)).toBe(bytes(plain));

  expect(listed.optionReceipts).toEqual([
    { option: 'cashDefenceTrimColdCalls', before: 'call', after: 'fold' },
  ]);
  expect(Object.keys(listed.optionReceipts![0]).sort()).toEqual(['after', 'before', 'option']);
  // The receipt is one added field: without it, the same bytes.
  const { optionReceipts: _receipts, ...rest } = listed;
  expect(bytes(rest)).toBe(bytes(plain));
  expect(listed.decision.action).toBe(plain.decision.action);
  expect(listed.decision.amount).toBe(plain.decision.amount);
});

it('a receipt whose action is not an action word never leaves the worker', async () => {
  const request = fastRequest(302);
  const cardsAsAction = await fastReply(request, () => {
    noteDecisionRuleReceipt(
      'holdemTournamentAllInCallIsPriced',
      { action: 'AsKd' },
      { action: 'call' }
    );
    noteDecisionRuleReceipt(
      'holdemTournamentAllInCallIsPriced',
      { action: 'fold' },
      { action: '0.62' }
    );
  });
  expect(Object.keys(cardsAsAction)).not.toContain('optionReceipts');
  const mixed = await fastReply(request, () => {
    noteDecisionRuleReceipt('cashDefenceTrimColdCalls', { action: 'Qh7h' }, { action: 'fold' });
    noteDecisionRuleReceipt(
      'holdemTournamentAllInCallIsPriced',
      { action: 'fold' },
      {
        action: 'all_in',
        amount: 398,
      }
    );
  });
  expect(mixed.optionReceipts).toEqual([
    { option: 'holdemTournamentAllInCallIsPriced', before: 'fold', after: 'all_in' },
  ]);
  expect(JSON.stringify(mixed.optionReceipts)).not.toMatch(/[2-9TJQKA][shdc]\b|amount|\d/);
});

it('the second look answers with its own receipts, and with no key when it has none', async () => {
  const request = fastRequest(303);
  const deepOf = async (recorder: Recorder): Promise<DeepHorseDecisionResult> => {
    HorseMind.reset();
    enableBrainTelemetry();
    seedFastRandom(20261125);
    const messages: HorseDecisionWorkerResponse[] = [];
    const record = { fn: NOTHING };
    const worker = workerWith(messages, record);
    await worker.start();
    worker.receive(structuredClone(request));
    await worker.drain();
    const fast = messages.find((m): m is FastHorseDecisionResult => m.type === 'FAST_RESULT')!;
    expect(fast, JSON.stringify(messages.at(-1))).toBeDefined();
    expect(Object.keys(fast)).not.toContain('optionReceipts');
    record.fn = recorder;
    const draft = {
      ...structuredClone(request),
      type: 'DECIDE_DEEP' as const,
      requestId: request.requestId + 1,
      rngBefore: fast.rngBefore,
      deepEquity: 2,
    };
    worker.receive({ ...draft, decisionKey: buildHorseDecisionKey(draft) } as never);
    await worker.drain();
    const deep = messages.find((m): m is DeepHorseDecisionResult => m.type === 'DEEP_RESULT');
    expect(deep, JSON.stringify(messages.at(-1))).toBeDefined();
    return deep!;
  };
  const plain = await deepOf(NOTHING);
  expect(Object.keys(plain)).not.toContain('optionReceipts');
  const listed = await deepOf(LISTED);
  expect(listed.optionReceipts).toEqual([
    { option: 'cashDefenceTrimColdCalls', before: 'call', after: 'fold' },
  ]);
  const { optionReceipts: _receipts, ...rest } = listed;
  expect(bytes(rest)).toBe(bytes(plain));
});
