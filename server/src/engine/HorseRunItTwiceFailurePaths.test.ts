/**
 * Horses run it twice only sometimes (#10794): what a Horse does when the
 * equity read goes wrong. Review of #10794 checked these with a scratch test;
 * this commits them.
 *
 * Every path ends the same way: each Horse answers at most once, a Horse that
 * has no honest number runs once (chooser picks 1, responder declines), the
 * last answer lands well inside the offer's ten-second deadline, nothing
 * escapes as an unhandled rejection, and a failure is reported.
 *
 * These drive the production scheduleHorseRITResponses, horseRitRuns,
 * horseRitVerdict and requestHorseRitEquity on a minimal engine stand-in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));

import { reportError } from '../services/errorReporter.js';
import { ServerTableEngine } from './ServerTableEngine.js';
import { horseRunItTwiceRuns } from './HorseRunItTwice.js';

const TABLE_ID = '11111111-2222-4333-8444-555555555555';
const proto = ServerTableEngine.prototype as any;
const OFFER = { allInPlayers: [], board: [], pot: 200 };
/** The engine's offer deadline (RunItTwiceEngine default) in ms. */
const OFFER_DEADLINE_MS = 10_000;
/** Latest Horse answer: responder delay 1.6 s plus the 1.5 s equity wait. */
const LATEST_ANSWER_MS = 1_600 + 1_500;

/** A hand number and two Horse ids that both run it more than once at a 0.5 equity read. */
function willingPair(): { handCount: number; chooser: string; responder: string } {
  const at = (id: string, handNumber: number) =>
    horseRunItTwiceRuns({ horseId: id, handNumber, potBB: 100, equity: 0.5, maxRuns: 2 });
  for (let handCount = 1; handCount <= 200; handCount++) {
    const willing = Array.from({ length: 400 }, (_, n) => `horse-${n}-seat`).filter(
      (id) => at(id, handCount) === 2
    );
    if (willing.length >= 2) return { handCount, chooser: willing[0], responder: willing[1] };
  }
  throw new Error('no willing pair');
}

type Call = { pid: string; answer?: string; runs?: number; at: number; args: number };

function standIn(opts: {
  handCount: number;
  chooser: string;
  responder: string;
  requestHorseRitEquity: () => unknown;
  respondToRIT?: (pid: string, answer?: string, runs?: number) => void;
}) {
  const calls: Call[] = [];
  const start = Date.now();
  const engine: any = {
    tableId: TABLE_ID,
    running: true,
    handCount: opts.handCount,
    tableInfo: { big_blind: 2 },
    seatedPlayers: [opts.chooser, opts.responder].map((user_id) => ({ user_id, is_horse: true })),
    isOwnClientControlling: () => false,
    setHandTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    pending: true,
    runItTwiceEngine: {
      hasPendingOffer: () => engine.pending,
      getState: () => ({ maxRuns: 2, pot: 200 }),
    },
    horseRitOfferEquity: new Map(),
    requestHorseRitEquity: opts.requestHorseRitEquity,
    horseRitRuns: proto.horseRitRuns,
    horseRitVerdict: proto.horseRitVerdict,
    respondToRIT(...args: [string, string?, number?]) {
      const [pid, answer, runs] = args;
      calls.push({ pid, answer, runs, at: Date.now() - start, args: args.length });
      opts.respondToRIT?.(pid, answer, runs);
    },
  };
  const schedule = () =>
    proto.scheduleHorseRITResponses.call(
      engine,
      opts.chooser,
      [opts.chooser, opts.responder],
      OFFER
    );
  return { engine, calls, schedule };
}

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(reportError).mockClear();
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
});

afterEach(async () => {
  vi.useRealTimers();
  // Let any stray rejection surface before the listener goes.
  await new Promise((resolve) => setImmediate(resolve));
  process.off('unhandledRejection', onUnhandled);
  expect(unhandled).toEqual([]);
});

const reportedContexts = () => vi.mocked(reportError).mock.calls.map((c) => c[1]);

/** Each Horse answered exactly once, and both answers are "run once". */
function expectRanOnceExactlyOnce(calls: Call[], chooser: string, responder: string) {
  expect(calls).toHaveLength(2);
  expect(calls.filter((c) => c.pid === chooser)).toEqual([
    expect.objectContaining({ answer: undefined, runs: 1 }),
  ]);
  expect(calls.filter((c) => c.pid === responder)).toEqual([
    expect.objectContaining({ answer: 'decline' }),
  ]);
  for (const c of calls) expect(c.at).toBeLessThanOrEqual(LATEST_ANSWER_MS);
}

describe('a Horse whose equity read fails runs once, answers once, and the failure is reported', () => {
  it('the read rejects', async () => {
    const { chooser, responder, handCount } = willingPair();
    const t = standIn({
      handCount,
      chooser,
      responder,
      requestHorseRitEquity: () => Promise.reject(new Error('pool down')),
    });
    t.schedule();
    await vi.advanceTimersByTimeAsync(OFFER_DEADLINE_MS);
    expectRanOnceExactlyOnce(t.calls, chooser, responder);
    expect(reportedContexts()).toEqual([`ServerTableEngine.${TABLE_ID}.horse_rit_equity_failed`]);
  });

  it('the read throws synchronously', async () => {
    const { chooser, responder, handCount } = willingPair();
    const t = standIn({
      handCount,
      chooser,
      responder,
      requestHorseRitEquity: () => {
        throw new Error('bad request');
      },
    });
    t.schedule();
    await vi.advanceTimersByTimeAsync(OFFER_DEADLINE_MS);
    expectRanOnceExactlyOnce(t.calls, chooser, responder);
    expect(reportedContexts()).toEqual([`ServerTableEngine.${TABLE_ID}.horse_rit_equity_failed`]);
  });

  it('the read never resolves: the 1.5 s wait answers once, inside the deadline', async () => {
    const { chooser, responder, handCount } = willingPair();
    const t = standIn({
      handCount,
      chooser,
      responder,
      requestHorseRitEquity: () => new Promise(() => undefined),
    });
    t.schedule();
    await vi.advanceTimersByTimeAsync(LATEST_ANSWER_MS);
    expectRanOnceExactlyOnce(t.calls, chooser, responder);
    await vi.advanceTimersByTimeAsync(OFFER_DEADLINE_MS);
    expect(t.calls).toHaveLength(2);
    expect(Math.max(...t.calls.map((c) => c.at))).toBeLessThan(OFFER_DEADLINE_MS);
  });

  it('the read resolves after the wait ran out: no second answer', async () => {
    const { chooser, responder, handCount } = willingPair();
    let resolve!: (v: Record<string, number>) => void;
    const t = standIn({
      handCount,
      chooser,
      responder,
      requestHorseRitEquity: () => new Promise((r) => (resolve = r)),
    });
    t.schedule();
    await vi.advanceTimersByTimeAsync(LATEST_ANSWER_MS);
    resolve({ [chooser]: 0.5, [responder]: 0.5 });
    await vi.advanceTimersByTimeAsync(OFFER_DEADLINE_MS);
    // Both answered "once" when the wait ran out; the late equity changes nothing.
    expectRanOnceExactlyOnce(t.calls, chooser, responder);
  });

  it('the read resolves during the wait: one answer each, on the equity', async () => {
    const { chooser, responder, handCount } = willingPair();
    let resolve!: (v: Record<string, number>) => void;
    const t = standIn({
      handCount,
      chooser,
      responder,
      requestHorseRitEquity: () => new Promise((r) => (resolve = r)),
    });
    t.schedule();
    await vi.advanceTimersByTimeAsync(1_700);
    expect(t.calls).toEqual([]);
    resolve({ [chooser]: 0.5, [responder]: 0.5 });
    await vi.advanceTimersByTimeAsync(OFFER_DEADLINE_MS);
    expect(t.calls).toHaveLength(2);
    expect(t.calls.find((c) => c.pid === chooser)).toMatchObject({ runs: 2 });
    expect(t.calls.find((c) => c.pid === responder)).toMatchObject({ answer: 'accept' });
    expect(reportedContexts()).toEqual([]);
  });

  it.each([
    ['null', () => null],
    ['no entry for either Horse', () => ({ someoneElse: 0.5 })],
    ['NaN', (c: string, r: string) => ({ [c]: Number.NaN, [r]: Number.NaN })],
  ])('the read returns unknown (%s): run once', async (_label, value) => {
    const { chooser, responder, handCount } = willingPair();
    const t = standIn({
      handCount,
      chooser,
      responder,
      requestHorseRitEquity: async () => value(chooser, responder),
    });
    t.schedule();
    await vi.advanceTimersByTimeAsync(OFFER_DEADLINE_MS);
    expectRanOnceExactlyOnce(t.calls, chooser, responder);
    expect(reportedContexts()).toEqual([]);
  });
});

describe('an equity that arrives after the moment has passed sends nothing', () => {
  it.each([
    ['the hand ended', (e: any) => (e.handCount += 1)],
    ['the offer is no longer pending', (e: any) => (e.pending = false)],
    ['the engine stopped', (e: any) => (e.running = false)],
  ])('%s while the read was out: no answer at all', async (_label, change) => {
    const { chooser, responder, handCount } = willingPair();
    let resolve!: (v: Record<string, number>) => void;
    const t = standIn({
      handCount,
      chooser,
      responder,
      requestHorseRitEquity: () => new Promise((r) => (resolve = r)),
    });
    t.schedule();
    // Both delayed answers have fired and are waiting on the read.
    await vi.advanceTimersByTimeAsync(1_700);
    change(t.engine);
    resolve({ [chooser]: 0.5, [responder]: 0.5 });
    await vi.advanceTimersByTimeAsync(OFFER_DEADLINE_MS);
    expect(t.calls).toEqual([]);
  });
});

describe('an answer that throws is reported and does not stop the other Horse', () => {
  it('respondToRIT throws for the chooser on the equity path', async () => {
    const { chooser, responder, handCount } = willingPair();
    let resolve!: (v: Record<string, number>) => void;
    const t = standIn({
      handCount,
      chooser,
      responder,
      requestHorseRitEquity: () => new Promise((r) => (resolve = r)),
      respondToRIT: (pid) => {
        if (pid === chooser) throw new Error('engine refused');
      },
    });
    t.schedule();
    await vi.advanceTimersByTimeAsync(1_700);
    resolve({ [chooser]: 0.5, [responder]: 0.5 });
    await vi.advanceTimersByTimeAsync(OFFER_DEADLINE_MS);
    expect(t.calls.map((c) => c.pid).sort()).toEqual([chooser, responder].sort());
    expect(reportedContexts()).toEqual([`ServerTableEngine.${TABLE_ID}.horse_rit_response`]);
  });
});

describe('a responder answers for itself only (review note N7)', () => {
  it('an accepting responder sends no board count: it accepts whatever the chooser picks', async () => {
    const { chooser, responder, handCount } = willingPair();
    const t = standIn({
      handCount,
      chooser,
      responder,
      requestHorseRitEquity: async () => ({ [chooser]: 0.5, [responder]: 0.5 }),
    });
    t.schedule();
    await vi.advanceTimersByTimeAsync(OFFER_DEADLINE_MS);
    const answer = t.calls.find((c) => c.pid === responder)!;
    expect(answer).toMatchObject({ answer: 'accept', runs: undefined, args: 2 });
  });
});

describe('requestHorseRitEquity itself', () => {
  const offer = {
    allInPlayers: [{ user_id: 'a' }, { user_id: 'b' }],
    board: [],
    pot: 200,
  };
  const call = (allInEquityRequest: () => unknown) =>
    proto.requestHorseRitEquity.call(
      { tableId: TABLE_ID, handCount: 7, allInEquityRequest, liveExtraBoards: () => undefined },
      offer
    );
  const request = (priceBoards: () => Array<Promise<number[]>>) => () => ({
    hands: [[], []],
    allBoards: [[]],
    priceBoards,
  });

  it('a worker rejection resolves null and is reported', async () => {
    await expect(call(request(() => [Promise.reject(new Error('timeout'))]))).resolves.toBeNull();
    expect(reportedContexts()).toEqual([`ServerTableEngine.${TABLE_ID}.horse_rit_equity_failed`]);
  });

  it('a throwing request builder resolves null and is reported', async () => {
    await expect(
      call(() => {
        throw new Error('no controller');
      })
    ).resolves.toBeNull();
    expect(reportedContexts()).toEqual([`ServerTableEngine.${TABLE_ID}.horse_rit_equity_failed`]);
  });

  it('no honest request, or an out-of-range result, is unknown without an error', async () => {
    await expect(call(() => null)).resolves.toBeNull();
    await expect(call(request(() => [Promise.resolve([1.2, -0.2])]))).resolves.toBeNull();
    await expect(call(request(() => [Promise.resolve([0.5])]))).resolves.toBeNull();
    expect(reportedContexts()).toEqual([]);
  });

  it('a good result is each player share by id', async () => {
    await expect(call(request(() => [Promise.resolve([0.3, 0.7])]))).resolves.toEqual({
      a: 0.3,
      b: 0.7,
    });
  });
});
