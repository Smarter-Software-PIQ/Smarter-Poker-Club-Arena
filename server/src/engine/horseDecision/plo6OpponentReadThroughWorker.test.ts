/**
 * PLO6 opponent recognition through the decision worker.
 *
 * HorsePlo6OpponentReadMatrix.test.ts varies an installed record and calls
 * HorseLogic.decide. This file takes the other route a live read travels:
 * real HandController hands of three-handed PLO6 cash are completed, each is
 * sent to a HorseDecisionWorkerRuntime as OBSERVE_COMPLETED_HAND, and the
 * Horse's next decision is requested as DECIDE_FAST. Nothing is installed by
 * hand, and the Horse is a participant the way it is live: it is asked for
 * its own decision in every hand before that hand is observed. The opponent
 * on the button either pots every hand or limps every hand; the Horse in the
 * small blind then faces that opponent's raise.
 *
 * Pinned: the worker answers with a legal action and no brain fallback; the
 * journalled read frame carries the opponent's counted hands; and the read
 * the decision used is "observed raiser" for the potter and "presumption
 * disproved" for the limper, whose one raise does not change that.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { HandController } from '../HandController.js';
import { HorseMind, readScopeOf } from '../HorseMind.js';
import { maniacRaiseWidth, MANIAC_MIN_RAISE_WIDTH } from '../HorseOpponentExploit.js';
import {
  defaultHorseDecisionWorkerDependencies as defaults,
  HorseDecisionWorkerRuntime,
} from './workerRuntime.js';
import type { HorseDecisionWorkerResponse } from './protocol.js';
import { buildHorseDecisionKey } from './protocol.js';
import type { HandConfig, SeatPlayer } from '../../types.js';
import { controllerDecisionState } from '../remainingVariants/RemainingVariantControllerSpots.test-support.js';
import { captureHorseHandJournalContext } from '../HorseDecisionHandBinding.js';
import {
  decodeHorseDecisionReads,
  type HorseDecisionReadFrame,
} from '../HorseDecisionReadFrame.js';
import { applyTableCommitmentCap } from '../ServerTableEngineTurns.js';
import type { HorsePlanContext } from '../HorsePlanHandIdentity.js';

const table = '10000000-0000-4000-8000-0000000000a6';
const opponent = '20000000-0000-4000-8000-0000000000a1';
const hero = '20000000-0000-4000-8000-0000000000a2';
const third = '20000000-0000-4000-8000-0000000000a3';
const SCOPE = readScopeOf('plo6', 3);
const HANDS = 40;

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

type Capture = { readFrame: HorseDecisionReadFrame | null; planContext: HorsePlanContext };

function newHand(handNumber: number) {
  const config: HandConfig = {
    tableId: table,
    handNumber,
    gameVariant: 'plo6',
    smallBlind: 1,
    bigBlind: 2,
    isTournament: false,
    rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
  };
  const players = [opponent, hero, third].map((user_id, i) => ({
    seat: i + 1,
    user_id,
    username: `Actor ${i + 1}`,
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
  return { controller, config };
}

type Line = 'pot' | 'limp';

function workerWith(messages: HorseDecisionWorkerResponse[], captures: Capture[]) {
  return new HorseDecisionWorkerRuntime((m) => messages.push(m), {
    ...defaults,
    startServices: async () => defaults.workerReadiness(),
    stopServices: async () => {},
    journalEnabled: () => true,
    journalDecision: (_request, captured) => {
      captures.push(captured as Capture);
    },
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

/** Ask the worker for the small blind's decision at the controller's current node. */
async function decide(
  worker: HorseDecisionWorkerRuntime,
  messages: HorseDecisionWorkerResponse[],
  controller: HandController,
  config: HandConfig,
  requestId: number
) {
  const spot = controllerDecisionState(controller, 'plo6' as never, 'cash', config)!;
  expect(spot.hero.user_id).toBe(hero);
  spot.state.commitmentCapRemaining = applyTableCommitmentCap(
    controller.getAuthoritativeActionState(hero)!,
    spot.hero,
    false,
    0,
    2
  ).commitmentCapRemaining;
  const request = {
    type: 'DECIDE_FAST' as const,
    requestId,
    generation: config.handNumber,
    fence: `${table}:${config.handNumber}:2:9:${config.handNumber}`,
    decisionKey: '',
    decisionTimeMs: Date.now() + 10000 + requestId,
    player: spot.hero,
    gameState: spot.state,
    style: 'balanced' as const,
    mods: {},
    handJournalContext: captureHorseHandJournalContext(spot.state.actionHistory!),
  };
  request.decisionKey = buildHorseDecisionKey(request);
  messages.length = 0;
  worker.receive(request);
  await worker.drain();
  const result = messages.find((m) => m.type === 'FAST_RESULT');
  expect(result?.type, JSON.stringify(messages.at(-1))).toBe('FAST_RESULT');
  if (!result || result.type !== 'FAST_RESULT') throw Error('FAST did not return a decision');
  return { decision: result.decision, spot };
}

async function decisionAfter(history: Line[]) {
  HorseMind.reset();
  const messages: HorseDecisionWorkerResponse[] = [];
  const captures: Capture[] = [];
  const worker = workerWith(messages, captures);
  await worker.start();
  for (let h = 0; h < history.length; h++) {
    const handNumber = 2000100 + h;
    const { controller, config } = newHand(handNumber);
    // The opponent acts, the Horse is asked (as it is live), then folds.
    if (history[h] === 'pot') expect(controller.performAction(1, 'raise', 7)).toBe(true);
    else expect(controller.performAction(1, 'call')).toBe(true);
    await decide(worker, messages, controller, config, 1000 + h);
    expect(controller.performAction(2, 'fold')).toBe(true);
    if (history[h] === 'pot') {
      expect(controller.performAction(3, 'fold')).toBe(true);
    } else {
      expect(controller.performAction(3, 'check')).toBe(true);
      for (const stage of ['flop', 'turn', 'river']) {
        expect(controller.getState().stage).toBe(stage);
        expect(controller.performAction(3, 'check')).toBe(true);
        expect(controller.performAction(1, 'check')).toBe(true);
      }
    }
    const completed = {
      type: 'OBSERVE_COMPLETED_HAND' as const,
      requestId: h + 1,
      generation: handNumber,
      fence: `${table}:${handNumber}:9:observe`,
      handKey: `${table}:${handNumber}`,
      committedHandId: `30000000-0000-4000-8000-${String(h + 601).padStart(12, '0')}`,
      actions: controller.getState().actionHistory,
      bigBlind: 2,
      showdown: null,
      scope: SCOPE,
    };
    messages.length = 0;
    worker.receive(completed);
    await worker.drain();
    expect(messages.at(-1)).toMatchObject({ type: 'ACK', operation: 'OBSERVE_COMPLETED_HAND' });
  }
  // The decision: the opponent pots, and the Horse in the small blind is next.
  const { controller, config } = newHand(2000900);
  expect(controller.performAction(1, 'raise', 7)).toBe(true);
  captures.length = 0;
  const reads: { presumed: boolean; width: number | null }[] = [];
  const original = HorseMind.opponentRead.bind(HorseMind);
  vi.spyOn(HorseMind, 'opponentRead').mockImplementation((userId: string) => {
    const read = original(userId);
    if (userId === opponent)
      reads.push({ presumed: read?.presumed === true, width: maniacRaiseWidth(read) });
    return read;
  });
  const { decision, spot } = await decide(worker, messages, controller, config, 9000);
  const result = { decision };
  expect(result.decision.policyFallback).not.toBe('brain_exception');
  expect(spot.state.legalActions).toContain(result.decision.action);
  expect(captures).toHaveLength(1);
  const frame = captures[0]!;
  expect(frame.readFrame).not.toBeNull();
  const view = decodeHorseDecisionReads(
    frame.readFrame!,
    spot.state.players,
    JSON.parse(frame.readFrame!.json).handKey,
    frame.planContext
  );
  return { decision: result.decision, reads, counted: view.scoped.get(`${SCOPE}|${opponent}`) };
}

it('a player who pots every hand is read as an observed raiser, not a presumed one', async () => {
  const r = await decisionAfter(Array.from({ length: HANDS }, () => 'pot' as const));
  expect(r.counted).toMatchObject({ hands: HANDS + 1, vpip: HANDS + 1, pfr: HANDS + 1 });
  expect(r.reads.length).toBeGreaterThan(0);
  expect(r.reads.every((x) => !x.presumed)).toBe(true);
  expect(r.reads.every((x) => (x.width ?? 0) >= MANIAC_MIN_RAISE_WIDTH)).toBe(true);
});

it('a player who limps every hand disproves the presumption, and one raise does not undo it', async () => {
  const r = await decisionAfter(Array.from({ length: HANDS }, () => 'limp' as const));
  expect(r.counted).toMatchObject({ hands: HANDS + 1, vpip: HANDS + 1, pfr: 1 });
  expect(r.reads.length).toBeGreaterThan(0);
  expect(r.reads.every((x) => !x.presumed && x.width === null)).toBe(true);
});

it('with no history the same raise comes from a presumed aggressive opponent', async () => {
  const r = await decisionAfter([]);
  expect(r.reads.length).toBeGreaterThan(0);
  expect(r.reads.every((x) => x.presumed && x.width !== null)).toBe(true);
});
