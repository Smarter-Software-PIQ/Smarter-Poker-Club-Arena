/**
 * STYLE READ LIVE SWITCH, RUNTIME LAWS (2026-11-13).
 *
 * Reviews f072e27f (M1) and 06968005 (M1/M2) found the deep-look bound and the worker wiring pinned by source
 * text only. These laws run REAL HorseDecisionWorkerRuntime decisions (DECIDE_FAST and DECIDE_DEEP through
 * runtime.receive, the real HorseLogic.decide underneath) with a real StyleSwitchHolder over a real worker inbox
 * (createStyleSwitchWorkerInbox), and observe three things a decision cannot fake: the options the brain was
 * handed, the replay state the decision journaled, and the receipts (noteFeature).
 *
 * THE CLOCK. workerRuntime reads the switch with performance.now() (the fast look and the second look) and
 * bounds the retained second-look reads with deps.now(), which in production is also performance.now(). Both are
 * driven here by ONE variable: performance.now is spied (the runtime imports the same object from
 * node:perf_hooks) and the harness's `now` returns the same value, as do the inbox's injected clocks. So every
 * timeline below is one a production worker can live through: nothing is made stale by moving one clock and
 * not another.
 *
 * Harness: workerHarness / requestAt from testing/horseRegression/plan/fixture.ts (the one deepDiveRuntime.test.ts
 * and rangeConsumptionRuntime.test.ts drive their FAST then DEEP looks with).
 */
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic } from '../HorseLogic.js';
import { HorseMind } from '../HorseMind.js';
import { seedFastRandom } from '../HorseEval.js';
import {
  STYLE_SWITCH_POLL_MS,
  STYLE_SWITCH_STALE_MS,
  StyleSwitchHolder,
} from '../HorseStyleSwitch.js';
import { createStyleSwitchWorkerInbox } from './styleSwitchDelivery.js';
import {
  otherTableId,
  requestAt,
  tableId,
  workerHarness,
} from '../../testing/horseRegression/plan/fixture.js';
import type {
  DeepHorseDecisionRequest,
  FastHorseDecisionRequest,
  FastHorseDecisionResult,
  HorseDecisionWorkerResponse,
} from './protocol.js';

const V3 = 'horse-decision-replay-state-v3';
const V4 = 'horse-decision-replay-state-v4';
const WALL_EPOCH = 1_700_000_000_000;
/** The retained second-look reads live this long (workerRuntime SECOND_LOOK_READ_TTL_MS); a later look is refused. */
const SECOND_LOOK_TTL_MS = 60_000;

type Journaled = {
  snapshot: { type: string; requestId: number };
  replayState: { version: string; style?: Record<string, string> };
};

/** One worker: the real runtime, a real inbox and holder (or the runtime's own absent-source holder), one clock. */
function worker(delivered: boolean) {
  let t = 1_000;
  vi.spyOn(performance, 'now').mockImplementation(() => t);
  seedFastRandom(20261113);
  HorseMind.reset();
  const features: string[] = [];
  const note = (feature: string) => void features.push(feature);
  const decideOpts: Array<Record<string, unknown>> = [];
  const inbox = createStyleSwitchWorkerInbox(
    () => t,
    () => WALL_EPOCH + t
  );
  const h = workerHarness({
    now: () => t,
    noteFeature: note,
    decide: (...args) => {
      decideOpts.push({ ...(args[4] as Record<string, unknown>) });
      return HorseLogic.decide(...args);
    },
    // absent: the runtime builds its own holder over ABSENT_STYLE_SWITCH_SOURCE, as before the delivery existed
    ...(delivered ? { styleSwitch: new StyleSwitchHolder(inbox.source, note) } : {}),
  });
  let seq = 0;
  const journal = () => h.captures as unknown as Journaled[];
  return {
    h,
    inbox,
    features,
    decideOpts,
    advance: (ms: number) => {
      t += ms;
    },
    /** A STYLE_SWITCH_STATE message exactly as the main thread posts it, read from the database just now. */
    deliver(config: unknown, status: 'ok' | 'unreadable' = 'ok') {
      return inbox.receive({
        type: 'STYLE_SWITCH_STATE',
        seq: ++seq,
        status,
        readAtEpochMs: WALL_EPOCH + t,
        config,
      });
    },
    /** One real fast decision: what it returned, the options the brain got, what it journaled. */
    async fast(request: FastHorseDecisionRequest) {
      const from = decideOpts.length;
      const result = await h.fast(request);
      const journaled = journal().filter(
        (c) => c.snapshot.type === 'DECIDE_FAST' && c.snapshot.requestId === request.requestId
      );
      expect(journaled).toHaveLength(1);
      expect(decideOpts.length).toBeGreaterThan(from);
      return { result, opts: decideOpts.slice(from), replayState: journaled[0]!.replayState };
    },
    /** The real second look for a retained fast decision. */
    async deep(
      request: FastHorseDecisionRequest,
      fast: FastHorseDecisionResult,
      requestId: number
    ) {
      const from = decideOpts.length;
      const deepRequest: DeepHorseDecisionRequest = {
        ...structuredClone(request),
        type: 'DECIDE_DEEP',
        requestId,
        rngBefore: fast.rngBefore,
        deepEquity: 2,
      };
      h.runtime.receive(deepRequest);
      await h.runtime.drain();
      const result = h.messages.find(
        (m): m is Extract<HorseDecisionWorkerResponse, { type: 'DEEP_RESULT' }> =>
          m.type === 'DEEP_RESULT' && m.requestId === requestId
      );
      // the second look really ran: a refused one (reads expired, ambiguous) would make every claim below vacuous
      if (!result) throw Error('Missing DEEP result: ' + JSON.stringify(h.messages.slice(-2)));
      const journaled = journal().filter(
        (c) => c.snapshot.type === 'DECIDE_DEEP' && c.snapshot.requestId === requestId
      );
      expect(journaled).toHaveLength(1);
      expect(decideOpts.length).toBe(from + 1);
      return { result, opts: decideOpts.slice(from), replayState: journaled[0]!.replayState };
    },
  };
}

const styleKeys = (opts: Record<string, unknown>) =>
  Object.keys(opts).filter((k) => k.startsWith('style'));
const switchReceipts = (features: string[]) => features.filter((f) => f.startsWith('style_switch'));
const ON = { version: 1, options: { styleFoldBluff: 'on' } };

function expectOn(look: {
  opts: Array<Record<string, unknown>>;
  replayState: Journaled['replayState'];
}) {
  for (const opts of look.opts) expect(opts.styleFoldBluff).toBe(true);
  expect(look.replayState.version).toBe(V4);
  expect(look.replayState.style?.styleFoldBluff).toBe('on');
}
function expectOff(look: {
  opts: Array<Record<string, unknown>>;
  replayState: Journaled['replayState'];
}) {
  for (const opts of look.opts) expect(styleKeys(opts)).toEqual([]);
  expect(look.replayState.version).toBe(V3);
  expect(Object.hasOwn(look.replayState, 'style')).toBe(false);
}

const open: Array<ReturnType<typeof worker>> = [];
function opened(delivered = true) {
  const w = worker(delivered);
  open.push(w);
  return w;
}
afterEach(async () => {
  for (const w of open.splice(0)) await w.h.close();
  vi.restoreAllMocks();
});

describe('law 1: the deep second look honours the 120 s bound and a switch-off', () => {
  it('deliveries stop: a second look past STYLE_SWITCH_STALE_MS runs with no style option and journals v3', async () => {
    const w = opened();
    expect(w.deliver(ON)).toBe(true);
    // 100 s later (still inside the 120 s bound) a fast decision runs: the option is on for it
    w.advance(100_000);
    const request = requestAt(1);
    const fast = await w.fast(request);
    expectOn(fast);
    expect(w.features).toContain('style_switch_styleFoldBluff_on_seen');
    // nothing more is delivered and no other fast decision runs. 30 s on, the delivery is 130 s old; the
    // retained reads (60 s) are still good and the holder's own poll (60 s) is not due, so only the second
    // look's own refresh can notice.
    w.advance(30_000);
    expect(130_000).toBeGreaterThan(STYLE_SWITCH_STALE_MS);
    expect(30_000).toBeLessThan(Math.min(SECOND_LOOK_TTL_MS, STYLE_SWITCH_POLL_MS));
    const mark = w.features.length;
    const deep = await w.deep(request, fast.result, 101);
    expectOff(deep);
    expect(w.features.slice(mark)).toEqual(
      expect.arrayContaining([
        'style_switch_config_stale_seen',
        'style_switch_styleFoldBluff_off_seen',
      ])
    );
  });

  it('control: a second look INSIDE the bound still runs with the option, and journals it (v4)', async () => {
    const w = opened();
    w.deliver(ON);
    w.advance(60_000);
    const request = requestAt(1);
    const fast = await w.fast(request);
    expectOn(fast);
    w.advance(30_000); // the delivery is 90 s old
    const deep = await w.deep(request, fast.result, 101);
    expectOn(deep);
    expect(styleKeys(deep.opts[0]!)).toEqual(['styleFoldBluff']);
  });

  it('an explicit off delivered between the fast look and the second look: the second look runs without the option', async () => {
    const w = opened();
    w.deliver(ON);
    // another table's fast decision does the holder's read at t0
    expectOn(await w.fast(requestAt(1, otherTableId, 1000200)));
    // t0 + 40 s: this hand's fast decision, between reads: on
    w.advance(40_000);
    const request = requestAt(2, tableId, 1000100);
    const fast = await w.fast(request);
    expectOn(fast);
    // t0 + 45 s: the main thread delivers the switch-off (a fresh reading, so staleness plays no part)
    w.advance(5_000);
    expect(w.deliver({ version: 1, options: { styleFoldBluff: 'off' } })).toBe(true);
    // t0 + 65 s: the second look, 25 s after its fast look. The holder's 60 s poll is due and nothing but the
    // second look is there to do it.
    w.advance(20_000);
    const mark = w.features.length;
    const deep = await w.deep(request, fast.result, 102);
    expectOff(deep);
    expect(w.features.slice(mark)).toContain('style_switch_styleFoldBluff_off_seen');
    expect(w.features.slice(mark)).not.toContain('style_switch_config_stale_seen');
  });
});

describe('law 2: a real STYLE_SWITCH_STATE message reaches a real fast decision', () => {
  it('nothing delivered: off. An `on` message through the inbox: the next decision is handed the option and journals it', async () => {
    const w = opened();
    expectOff(await w.fast(requestAt(1, tableId, 1000101)));
    expect(switchReceipts(w.features)).toEqual([]);
    expect(w.deliver(ON)).toBe(true);
    w.advance(STYLE_SWITCH_POLL_MS);
    w.deliver(ON); // the main thread re-delivers on every read
    const on = await w.fast(requestAt(2, tableId, 1000102));
    expectOn(on);
    expect(styleKeys(on.opts[0]!)).toEqual(['styleFoldBluff']);
    expect(switchReceipts(w.features)).toEqual(['style_switch_styleFoldBluff_on_seen']);
  });

  const bad: Array<[string, (w: ReturnType<typeof worker>) => boolean, string]> = [
    [
      'an `unreadable` message',
      (w) => w.deliver(null, 'unreadable'),
      'style_switch_config_unreadable_seen',
    ],
    [
      'an invalid envelope (no sequence)',
      (w) =>
        w.inbox.receive({
          type: 'STYLE_SWITCH_STATE',
          status: 'ok',
          readAtEpochMs: WALL_EPOCH,
          config: ON,
        }),
      'style_switch_config_invalid_seen',
    ],
    [
      'a well-formed envelope whose configuration is not the documented shape',
      (w) => w.deliver({ version: 1, options: { styleFoldBluff: 'on', styleNoSuchOption: 'on' } }),
      'style_switch_config_invalid_seen',
    ],
  ];
  it.each(bad)(
    'on, then %s: the next decision after the poll interval is all off',
    async (_name, send, receipt) => {
      const w = opened();
      w.deliver(ON);
      expectOn(await w.fast(requestAt(1, tableId, 1000101)));
      w.advance(1_000);
      expect(send(w)).toBe(true);
      w.advance(STYLE_SWITCH_POLL_MS);
      const mark = w.features.length;
      const next = await w.fast(requestAt(2, tableId, 1000102));
      expectOff(next);
      expect(switchReceipts(w.features.slice(mark))).toEqual([
        receipt,
        'style_switch_styleFoldBluff_off_seen',
      ]);
    }
  );

  it('control: the same timeline with no second message keeps the option on (the off above came from the message, not from time)', async () => {
    const w = opened();
    w.deliver(ON);
    expectOn(await w.fast(requestAt(1, tableId, 1000101)));
    w.advance(1_000 + STYLE_SWITCH_POLL_MS);
    const mark = w.features.length;
    expectOn(await w.fast(requestAt(2, tableId, 1000102)));
    expect(switchReceipts(w.features.slice(mark))).toEqual([]);
  });
});

describe('law 3: an all-off configuration is inert', () => {
  /**
   * The whole decision as sent, less the one value that is random per runtime instance: the authority epoch each
   * HorseDecisionWorkerRuntime draws for itself at construction (two workers never share one, switch or no switch).
   */
  const wholeDecision = (decision: unknown) =>
    JSON.stringify(decision).replace(/"epoch":"[0-9a-f-]{36}"/g, '"epoch":"<per-runtime>"');
  async function fastThenDeep(delivered: boolean) {
    const w = opened(delivered);
    if (delivered) {
      expect(w.deliver({ version: 1, options: {} })).toBe(true);
      // not vacuous: the holder really is served a present reading
      expect(w.inbox.source(0).kind).toBe('present');
    }
    const request = requestAt(1);
    const fast = await w.fast(request);
    w.advance(5_000);
    const deep = await w.deep(request, fast.result, 101);
    return {
      fast: {
        action: fast.result.decision.action,
        amount: fast.result.decision.amount ?? null,
        decision: wholeDecision(fast.result.decision),
        replayState: JSON.stringify(fast.replayState),
        opts: JSON.stringify(fast.opts),
        rngAfter: fast.result.rngAfter,
      },
      deep: {
        action: deep.result.decision.action,
        amount: deep.result.decision.amount ?? null,
        decision: wholeDecision(deep.result.decision),
        replayState: JSON.stringify(deep.replayState),
        opts: JSON.stringify(deep.opts),
      },
      looks: { fast, deep },
      features: w.features,
    };
  }

  it('`{version:1, options:{}}` delivered: fast and deep decisions equal the absent source byte for byte, with no style_switch receipt', async () => {
    const absent = await fastThenDeep(false);
    const empty = await fastThenDeep(true);
    expect(empty.fast).toEqual(absent.fast);
    expect(empty.deep).toEqual(absent.deep);
    for (const run of [absent, empty]) {
      expectOff(run.looks.fast);
      expectOff(run.looks.deep);
      expect(switchReceipts(run.features)).toEqual([]);
      expect(run.features.filter((f) => f.startsWith('style_'))).toEqual([]);
    }
    // the comparison is of real decisions, not of two empty results
    expect(typeof absent.fast.action).toBe('string');
    expect(JSON.parse(absent.fast.replayState).version).toBe(V3);
    expect(JSON.parse(absent.deep.replayState).version).toBe(V3);
  });
});
