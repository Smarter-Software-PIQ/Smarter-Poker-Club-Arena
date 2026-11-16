/**
 * PERSONA RE-RAISE MIX: the hand identity, end to end, with the option ON,
 * through the production HorseDecisionWorkerRuntime and the exact-replay
 * harness (the pattern of exactReplay.test.ts on the natural cash hold'em
 * preflop request of the Phase 6C journal sample: the button facing one
 * open, a 3-bet bluff spot).
 *
 *  (a) the fast look and the deep second look of one turn read one unit;
 *  (b) a retry of the turn (a new request id, a new lease and turn token in
 *      the fence, a fresh worker) reads the same unit;
 *  (c) the fast decision, journaled as the worker journals it, replays
 *      exactly (stream before, decision, stream after, effects, plan
 *      binding) and reads the same unit, the option travelling in the
 *      journaled request options;
 *  (d) the next hand at the table reads another unit.
 *
 * The unit is observed with the engine's offline measurement tap. A deep
 * second look is not replayable from the journal by design (it reads the
 * fast decision's retained read view, which the journal does not carry as
 * its own input), so (c) is the fast decision only; (a) runs the deep look
 * live, on the runtime that made the fast one.
 *
 * How the option reaches the worker here: in request.opts. Nothing in
 * production sets it today. request.opts is part of the journaled snapshot
 * and of the decision key, which is why this replay carries it; a live
 * switch (the pattern of the style switch) would instead have to be
 * journaled in the replay state and restored by the replay bindings.
 */
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { HorseLogic } from '../../HorseLogic.js';
import { HorseMind } from '../../HorseMind.js';
import { equityGovernor } from '../../EquityLoadGovernor.js';
import { restoreFastRandom, saveFastRandom } from '../../HorseEval.js';
import { enableBrainTelemetry } from '../../BrainTelemetry.js';
import { liveHorsePhase8Safety } from '../../HorsePhase8Safety.js';
import { prepareTournamentFutureHandFacts } from '../../HorseTournamentFutureHand.js';
import { holdemPersonaReRaiseScale } from '../../HorsePersona.js';
import {
  setHoldemPersonaReRaiseTap,
  type HoldemPersonaReRaiseTapEvent,
} from '../../HorsePreflop.js';
import { solverPolicyArtifactStatus } from '../../../gto/SolverPolicyArtifactLoader.js';
import {
  journalHash,
  makeHorseJournalRecord,
} from '../../../services/horseDecisionJournal/record.js';
import type { Card } from '../../../types.js';
import {
  buildHorseDecisionKey,
  type DeepHorseDecisionRequest,
  type DeepHorseDecisionResult,
  type FastHorseDecisionRequest,
  type FastHorseDecisionResult,
  type HorseDecisionWorkerResponse,
} from '../protocol.js';
import {
  HorseDecisionWorkerRuntime,
  type HorseDecisionWorkerDependencies,
} from '../workerRuntime.js';
import { currentReplaySolverStores } from './references.js';
import { qualifiedReplayAdmissions } from './qualifiedAuthority.js';
import { exactReplayHorseDecisionRecord } from './exactReplay.js';
import {
  PHASE6C_FIXTURE_IDS as IDS,
  phase6cFixtureBody,
  phase6cFixtureRecord,
} from './fixtures/index.js';

const SOURCE = '5'.repeat(40);

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

/** A production worker runtime with the journal captured in memory. */
function worker() {
  const payloads: unknown[] = [];
  const messages: HorseDecisionWorkerResponse[] = [];
  const deps: HorseDecisionWorkerDependencies = {
    ...qualifiedReplayAdmissions,
    journalEnabled: () => true,
    journalDecision: (_snapshot, payload) => {
      payloads.push(payload);
    },
    async startServices() {
      prepareTournamentFutureHandFacts();
      return readiness();
    },
    async stopServices() {},
    decide: (player, gameState, style, mods, opts) =>
      HorseLogic.decide(player, gameState, style, mods, opts),
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
    now: () => performance.now(),
  };
  enableBrainTelemetry();
  const runtime = new HorseDecisionWorkerRuntime((m) => messages.push(m), deps);
  return { runtime, messages, payloads };
}

const BASE = phase6cFixtureBody<{ snapshot: FastHorseDecisionRequest }>(
  phase6cFixtureRecord(IDS.cashNlhPreflop)
).snapshot;
const [TABLE, HAND, SEAT, LEASE, TOKEN] = BASE.fence.split(':');

/** The fixture's turn with the persona option on, optionally another hand,
 *  lease, turn token, request id or holding. */
function turn(
  cards: Card[],
  change: { hand?: number; lease?: string; token?: number; requestId?: number } = {}
): FastHorseDecisionRequest {
  const token = change.token ?? Number(TOKEN);
  const nextHand = change.hand !== undefined && change.hand !== Number(HAND);
  const { handJournalContext: journalContext, ...rest } = BASE;
  const player = { ...BASE.player, cards };
  const request: FastHorseDecisionRequest = {
    ...rest,
    // The private accepted-history prefix belongs to the fixture's own hand.
    ...(nextHand || journalContext === undefined ? {} : { handJournalContext: journalContext }),
    fence: [TABLE, change.hand ?? HAND, SEAT, change.lease ?? LEASE, token].join(':'),
    generation: token,
    requestId: change.requestId ?? BASE.requestId,
    // The hero's cards travel on `player` only: the state carries no seat's cards.
    player,
    opts: { ...(BASE.opts ?? {}), holdemPersonaReRaiseMix: true },
  };
  return { ...request, decisionKey: buildHorseDecisionKey(request) };
}

const tapped: HoldemPersonaReRaiseTapEvent[] = [];
afterEach(() => setHoldemPersonaReRaiseTap(null));
const listen = () => {
  tapped.length = 0;
  setHoldemPersonaReRaiseTap((e) => tapped.push(e));
};

async function fast(request: FastHorseDecisionRequest, on = worker()) {
  listen();
  await on.runtime.start();
  on.runtime.receive(request);
  await on.runtime.drain();
  const result = on.messages.find(
    (m): m is FastHorseDecisionResult =>
      m.type === 'FAST_RESULT' && m.requestId === request.requestId
  );
  if (!result)
    throw new Error(
      `no fast result: ${JSON.stringify(on.messages.filter((m) => m.type !== 'READY')).slice(0, 900)}`
    );
  return { result, events: tapped.map((e) => ({ ...e })), on };
}

const card = (rank: string, suit: string) => ({ rank, suit }) as Card;
/** Button holdings to try for one that reaches the 3-bet bluff comparison. */
const HOLDINGS: Card[][] = [
  [card('9', 'diamonds'), card('8', 'spades')],
  [card('A', 'hearts'), card('5', 'hearts')],
  [card('A', 'clubs'), card('4', 'clubs')],
  [card('K', 'spades'), card('9', 'spades')],
  [card('7', 'hearts'), card('6', 'hearts')],
  [card('T', 'clubs'), card('9', 'clubs')],
  [card('K', 'diamonds'), card('T', 'clubs')],
  [card('A', 'spades'), card('9', 'diamonds')],
  [card('Q', 'hearts'), card('T', 'hearts')],
  [card('K', 'clubs'), card('5', 'clubs')],
  [card('J', 'spades'), card('9', 'spades')],
  [card('8', 'diamonds'), card('7', 'diamonds')],
  [card('A', 'diamonds'), card('8', 'clubs')],
  [card('K', 'hearts'), card('J', 'spades')],
  [card('Q', 'spades'), card('9', 'spades')],
  [card('A', 'hearts'), card('2', 'hearts')],
];

describe('persona re-raise mix: one unit per hand through the live worker and exact replay', () => {
  it(
    'fast and deep, a retry, an exact replay and the next hand',
    { timeout: 120_000 },
    async () => {
      expect(BASE.gameState.stage).toBe('preflop');
      expect(BASE.gameState.gameVariant).toBe('nlh');
      expect(Number(HAND)).toBeGreaterThanOrEqual(1_000_000);
      // A Horse whose scale is not 1, so the persona is doing something.
      const scale = holdemPersonaReRaiseScale(BASE.player.user_id);
      expect(Math.abs(scale - 1)).toBeGreaterThan(0.01);

      // The original turn: the first holding that reaches the persona comparison.
      // The worker seeds each request's random stream from its fence and
      // generation, so a retry draws other numbers than the original turn, and
      // a hand near the edge of the bluff band can reach the persona comparison
      // on one and not on the other. The unit can only be observed where the
      // comparison is reached, so the holding is one that reaches it on both.
      const retryOf = (holding: Card[]) =>
        turn(holding, {
          lease: randomUUID(),
          token: Number(TOKEN) + 3,
          requestId: BASE.requestId + 9,
        });
      let original: Awaited<ReturnType<typeof fast>> | undefined;
      let retry: Awaited<ReturnType<typeof fast>> | undefined;
      let cards: Card[] | undefined;
      for (const holding of HOLDINGS) {
        const run = await fast(turn(holding));
        if (run.events.length !== 1) continue;
        const again = await fast(retryOf(holding));
        if (again.events.length !== 1) continue;
        original = run;
        retry = again;
        cards = holding;
        break;
      }
      if (!original || !retry || !cards)
        throw new Error('no holding reached the persona comparison on the turn and its retry');
      const request = turn(cards);
      const event = original.events[0];
      expect(event.kind).toBe('three_bet');
      expect(event.scale).toBe(scale);
      expect(event.unit).toBeGreaterThanOrEqual(0);
      expect(event.unit).toBeLessThan(1);
      expect(original.on.payloads.length).toBe(1);

      // (a) THE DEEP SECOND LOOK of the same turn, on the same worker, from the
      // fast decision's stream position (client.decideDeep: the same snapshot,
      // retyped, with a new request id).
      listen();
      const deepRequest: DeepHorseDecisionRequest = {
        ...request,
        type: 'DECIDE_DEEP',
        requestId: request.requestId + 1,
        rngBefore: original.result.rngBefore,
        deepEquity: 2,
      };
      original.on.runtime.receive(deepRequest);
      await original.on.runtime.drain();
      const deep = original.on.messages.find(
        (m): m is DeepHorseDecisionResult => m.type === 'DEEP_RESULT'
      );
      if (!deep)
        throw new Error(`no deep result: ${JSON.stringify(original.on.messages).slice(0, 600)}`);
      expect(tapped.length).toBe(1);
      expect(tapped[0].unit).toBe(event.unit);
      expect(tapped[0].p).toBe(event.p);
      expect(tapped[0].fires).toBe(event.fires);

      // (b) A RETRY of the turn. The table re-schedules the same seat of the
      // same hand (ServerTableEngineTurns.scheduleHorseAction after a lost
      // lease): a new lease and turn token in the fence, a new request id; and
      // here a fresh worker, as after a respawn.
      expect(retry.result.rngBefore).not.toBe(original.result.rngBefore);
      expect(retry.events.length).toBe(1);
      expect(retry.events[0].unit).toBe(event.unit);
      expect(retry.events[0].fires).toBe(event.fires);

      // (c) EXACT REPLAY of the journaled fast decision. The option is in the
      // journaled snapshot; the replay compares the stream before, the governor
      // scale, the decision (action and amount), the stream after, the effects
      // and the plan binding, and names the first that differs.
      const record = makeHorseJournalRecord(
        {
          producerId: randomUUID(),
          sequence: 1,
          atMs: Math.trunc(request.decisionTimeMs),
          sourceRelease: SOURCE,
          kind: 'decision',
          handKey: journalHash(`hand:${request.decisionKey}`),
          turnKey: journalHash(
            JSON.stringify([
              request.generation,
              request.fence,
              request.requestId,
              request.decisionKey,
              request.decisionTimeMs,
            ])
          ),
        },
        original.on.payloads[0]
      );
      const journaled = JSON.parse(record.body) as {
        snapshot: { opts?: Record<string, unknown> };
      };
      expect(journaled.snapshot.opts?.holdemPersonaReRaiseMix).toBe(true);
      listen();
      const verdict = await exactReplayHorseDecisionRecord(record, { runningSource: SOURCE });
      expect(verdict.outcome, verdict.firstDifference ?? '').toBe('replayed_exact');
      expect(verdict.original?.action).toBe(original.result.decision.action);
      expect(verdict.original?.amount ?? null).toBe(original.result.decision.amount ?? null);
      expect(verdict.original?.rngAfter).toBe(original.result.rngAfter);
      expect(tapped.length).toBeGreaterThanOrEqual(1);
      for (const e of tapped) {
        expect(e.unit).toBe(event.unit);
        expect(e.fires).toBe(event.fires);
      }

      // (d) THE NEXT HAND at the same table, the same seat, cards and state
      // (the first following hand number on which the comparison is reached).
      let next: Awaited<ReturnType<typeof fast>> | undefined;
      let nextHand = Number(HAND);
      for (let k = 1; k <= 12 && !next; k++) {
        const run = await fast(turn(cards, { hand: Number(HAND) + k }));
        if (run.events.length === 1) {
          next = run;
          nextHand = Number(HAND) + k;
        }
      }
      if (!next) throw new Error('no following hand reached the persona comparison');
      expect(next.events[0].unit).not.toBe(event.unit);
      // The same following hand again, on a fresh worker: its own unit, again.
      const again = await fast(turn(cards, { hand: nextHand }));
      expect(again.events.length).toBe(1);
      expect(again.events[0].unit).toBe(next.events[0].unit);

      if (process.env.PERSONA_RERAISE_PRINT === '1')
        console.log('e2e', {
          cards,
          scale,
          p: event.p,
          unit: event.unit,
          fires: event.fires,
          action: original.result.decision.action,
          deepAction: deep.decision.action,
          replay: verdict.outcome,
          nextUnit: next.events[0].unit,
        });
    }
  );
});
