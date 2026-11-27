/**
 * A PLO RULE FIRING IS JOURNALED WITH THE HAND IT CHANGED (2026-11-15).
 *
 * The decision journal record already carries the hand's fence
 * (table:hand:seat:lease:turn), the build and the seated humans. Through the
 * real worker runtime, a FAST decision's record now also carries
 * `ruleReceipts`: each receipted rule that changed THAT decision, with the
 * action it was given and the action it left (BrainTelemetry.noteDecisionRuleReceipt).
 *
 * The hand is the shape of hand 59401453 played heads-up on a real
 * HandController (PLO5 cash, a synthetic table): the Horse in position holds
 * top set on A-6-T, the 8 brings the straight, and each street is checked to
 * it. Pinned:
 *  - the set pound's receipt rides on the record of the turn decision it
 *    sized: same request, same fence (this table, this hand), and its `after`
 *    is the bet the worker answered and the reference node of the signed graph;
 *  - the decisions before and after it on the same worker do not carry it;
 *  - a decision no receipted rule changed has no `ruleReceipts` key at all,
 *    so its record is what it was before this change.
 * No production account, card or service is used.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { HandController } from '../HandController.js';
import { restoreFastRandom, saveFastRandom, seedFastRandom } from '../HorseEval.js';
import { HorseMind } from '../HorseMind.js';
import { Deck, RANKS, SUITS } from '../PokerEngine.js';
import { enableBrainTelemetry, type DecisionRuleReceipt } from '../BrainTelemetry.js';
import {
  defaultHorseDecisionWorkerDependencies as defaults,
  HorseDecisionWorkerRuntime,
} from './workerRuntime.js';
import { buildHorseDecisionKey } from './protocol.js';
import type { FastHorseDecisionRequest, HorseDecisionWorkerResponse } from './protocol.js';
import type {
  Card,
  CardRank,
  CardSuit,
  HandConfig,
  HorseDecision,
  SeatPlayer,
} from '../../types.js';
import { controllerDecisionState } from '../remainingVariants/RemainingVariantControllerSpots.test-support.js';
import { captureHorseHandJournalContext } from '../HorseDecisionHandBinding.js';
import { applyTableCommitmentCap } from '../ServerTableEngineTurns.js';
import { horseJournalJson } from '../../services/horseDecisionJournal/record.js';

const TABLE = '10000000-0000-4000-8000-0000000059a1';
const HAND = 59401453;
const HERO = '20000000-0000-4000-8000-0000000059a4';
const VILLAIN = '20000000-0000-4000-8000-0000000059a1';
const S: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (text: string): Card[] =>
  (text.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: S[x[1]] }));

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

interface Journaled {
  request: FastHorseDecisionRequest;
  payload: Record<string, unknown>;
}

function workerWith(messages: HorseDecisionWorkerResponse[], journal: Journaled[]) {
  return new HorseDecisionWorkerRuntime((m) => messages.push(m), {
    ...defaults,
    startServices: async () => defaults.workerReadiness(),
    stopServices: async () => {},
    journalEnabled: () => true,
    journalDecision: (request, payload) => {
      journal.push({
        request: request as FastHorseDecisionRequest,
        payload: payload as Record<string, unknown>,
      });
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

/** Heads-up PLO5: the Horse (seat 1, the button) holds top set; the board runs A-6-T, 8, Q. */
function riggedHand() {
  const config: HandConfig = {
    tableId: TABLE,
    handNumber: HAND,
    gameVariant: 'plo5',
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
  const hole: Record<number, Card[]> = { 1: cards('AsAh7d2h2s'), 2: cards('KdJc9s5h4d') };
  const board = cards('Ad6cTc8hQs');
  const used = new Set([...hole[1], ...hole[2], ...board].map((c) => c.rank + c.suit));
  const rest = SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit }))).filter(
    (c) => !used.has(c.rank + c.suit)
  );
  // Only the private physical order is fixed; dealing stays the production path.
  const internal = (controller as unknown as { state: { players: SeatPlayer[]; deck: unknown } })
    .state;
  for (const p of internal.players) p.cards = hole[p.seat].map((c) => ({ ...c }));
  internal.deck = new Deck([...board, ...rest]);
  return { controller, config };
}

async function decideAt(
  worker: HorseDecisionWorkerRuntime,
  messages: HorseDecisionWorkerResponse[],
  controller: HandController,
  config: HandConfig,
  requestId: number
): Promise<{ request: FastHorseDecisionRequest; decision: HorseDecision }> {
  const spot = controllerDecisionState(controller, 'plo5' as never, 'cash', config)!;
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
    // Fixed: the decision hour is a strategy input (mood), so the test does not move with the clock.
    decisionTimeMs: Date.UTC(2026, 10, 14, 18, 0, 0) + requestId,
    player: spot.hero,
    gameState: spot.state,
    style: 'balanced' as const,
    mods: {},
    handJournalContext: captureHorseHandJournalContext(spot.state.actionHistory!),
  };
  request.decisionKey = buildHorseDecisionKey(request);
  messages.length = 0;
  worker.receive(request as FastHorseDecisionRequest);
  await worker.drain();
  const result = messages.find((m) => m.type === 'FAST_RESULT') as
    | { type: 'FAST_RESULT'; fence: string; decision: HorseDecision }
    | undefined;
  expect(result?.type, JSON.stringify(messages.at(-1))).toBe('FAST_RESULT');
  expect(result!.fence).toBe(request.fence);
  return { request: request as FastHorseDecisionRequest, decision: result!.decision };
}

const receiptsOf = (j: Journaled) => j.payload.ruleReceipts as DecisionRuleReceipt[] | undefined;

it('journals the set pound on the record of the turn decision it sized, and on no other', async () => {
  // Deterministic RNG so Monte Carlo equity on the A-6-T-8 PLO5 turn never
  // drifts below the set-pound threshold (prequalification flakes 44858061669 &
  // 45745715882; sibling HorseOmahaRuleReceiptsNameTheirDecision pins seeds too).
  const savedFastRandom = saveFastRandom();
  seedFastRandom(1);
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  try {
    enableBrainTelemetry();
    const messages: HorseDecisionWorkerResponse[] = [];
    const journal: Journaled[] = [];
    const worker = workerWith(messages, journal);
    await worker.start();
    const { controller, config } = riggedHand();

    // Preflop: the Horse on the button completes; the big blind checks.
    const preflop = await decideAt(worker, messages, controller, config, 201);
    expect(controller.performAction(1, 'call')).toBe(true);
    expect(controller.performAction(2, 'check')).toBe(true);
    // Flop A-6-T: checked to the Horse, which checks back.
    expect(controller.performAction(2, 'check')).toBe(true);
    const flop = await decideAt(worker, messages, controller, config, 202);
    expect(controller.performAction(1, 'check')).toBe(true);
    // Turn 8: checked to the Horse again.
    expect(controller.performAction(2, 'check')).toBe(true);
    const turn = await decideAt(worker, messages, controller, config, 203);

    expect(journal.map((j) => j.request.requestId)).toEqual([201, 202, 203]);
    const [preflopRecord, flopRecord, turnRecord] = journal;

    // The turn record carries the set pound, under this table and hand.
    expect((turnRecord.payload.snapshot as FastHorseDecisionRequest).fence).toBe(
      turn.request.fence
    );
    expect(turn.request.fence.startsWith(`${TABLE}:${HAND}:1:`)).toBe(true);
    expect(turn.request.gameState.stage).toBe('turn');
    const receipts = receiptsOf(turnRecord)!;
    expect(receipts, JSON.stringify(turn.decision)).toBeDefined();
    const pound = receipts.find((r) => r.receipt === 'omaha_turn_set_pound')!;
    expect(pound, JSON.stringify(receipts)).toBeDefined();
    expect(pound.before).toBeNull();
    expect(pound.after.action).toBe('bet');
    // The reference node produced the pound's bet, and the receipts end at the decision the worker answered.
    const reference = turn.decision.policyGraph!.transitions.find((t) => t.node === 'reference')!;
    expect(reference.after).toEqual(pound.after);
    expect(receipts.at(-1)!.after).toEqual({
      action: turn.decision.action,
      amount: turn.decision.amount ?? null,
    });
    expect(turnRecord.payload.decision).toEqual(turn.decision);
    // The journaled bytes carry them (the writer serializes the payload with horseJournalJson).
    expect(
      (JSON.parse(horseJournalJson(turnRecord.payload)) as { ruleReceipts: unknown }).ruleReceipts
    ).toEqual(receipts);

    // Preflop no receipted rule acts: the record has no such key, in memory or in bytes.
    expect(preflop.request.gameState.stage).toBe('preflop');
    expect(Object.keys(preflopRecord.payload)).not.toContain('ruleReceipts');
    expect(horseJournalJson(preflopRecord.payload)).not.toContain('ruleReceipts');
    // The flop's own record holds only what changed the flop decision, never the turn's pound.
    expect(flop.request.gameState.stage).toBe('flop');
    expect((receiptsOf(flopRecord) ?? []).map((r) => r.receipt)).not.toContain(
      'omaha_turn_set_pound'
    );
    for (const r of receiptsOf(flopRecord) ?? [])
      expect(r.after).toEqual({
        action: flop.decision.action,
        amount: flop.decision.amount ?? null,
      });
  } finally {
    restoreFastRandom(savedFastRandom);
  }
});
