/**
 * LAW: NO UNINTENDED DELAY BETWEEN HANDS (Dan 2026-11-18).
 *
 * Dan, verbatim: "i just don't want any 'un intended delays'". Every intended
 * beat keeps its length - the pot push and its riding total, the muck, the
 * Rabbit Hunt rest, the showdown read, the winning-card display, the rebuy
 * pause. Between them there is nothing: the gap from one hand's settlement
 * (hand_history.ended_at) to the next HAND_START (started_at) is
 *
 *     owedBetweenHandsMs(shape) + at most ENGINE_BETWEEN_HANDS_BUDGET_MS
 *
 * This file holds that three ways:
 *   1. the waterfall: owedBetweenHandsMs is exactly the sum of the named beats
 *      for every hand shape, so no beat can grow a hidden term;
 *   2. the measured gap: the real dealHand, driven from the instant the rest
 *      is armed with 150 ms per database round trip, starts the next
 *      tournament hand within the rest plus a small in-process allowance
 *      (80 ms) and NO round trip - the F06 state read, fn_f06_begin_hand and
 *      the seq-0 save of the prepared original all ride under the rest.
 *      Before 2026-11-18 this measured rest + three trips; #11314 made it
 *      rest + one (the save); 2026-11-19 made it rest;
 *   3. the path: every await between the end of the hold and the deal is on a
 *      named list with the reason it is not an unintended delay. A new await
 *      there fails here until it is named, proved to run under the rest, or
 *      removed;
 *   4. not before: a Node timer can wake 1-2 ms before Date.now() reads its
 *      deadline (CI 2026-11-23 read the measured deal as 1499), so with every
 *      sleep modelled waking that early the hold and the rest still end on
 *      their deadlines, and a wall clock stepped back never stretches them.
 *
 * Production grading of the same rule, hand by hand:
 * scripts/sql/hand-gap-unintended-delay.sql.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: () => {
      throw new Error('Unexpected database write');
    },
    rpc: () => {
      throw new Error('Unexpected database RPC');
    },
  },
  maintenanceSupabase: {},
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn(), reportWarning: vi.fn() }));
vi.mock('../services/engineAlerts.js', () => ({
  raiseEngineAlert: vi.fn(async () => true),
  resolveEngineAlert: vi.fn(async () => true),
  firingFingerprints: vi.fn(() => []),
}));
import {
  ENGINE_BETWEEN_HANDS_BUDGET_MS,
  HAND_COMPLETION as H,
  handCompletionHoldMs,
  owedBetweenHandsMs,
} from '../config/handCompletionSpec.js';
import { REBUY_PAUSE_MAX_MS, RIT_REVEAL_MAX_MS } from './handCadenceSpec.js';
import { ServerTableEngineBase } from './ServerTableEngineBase.js';
import { ServerTableEngineDealing } from './ServerTableEngineDealing.js';
import { disposeEngines, fixture } from './f06RestDealFixture.test-support.js';

afterEach(() => disposeEngines());

const DEALING = readFileSync(
  fileURLToPath(new URL('./ServerTableEngineDealing.ts', import.meta.url)),
  'utf8'
);

describe('the owed beats are the whole cadence', () => {
  const push = H.BETS_SWEEP_MS + H.POT_PUSH_MS + H.MUCK_MS;
  const rest = H.NEXT_HAND_REST_MS;
  it.each([
    ['fold win', { wentToShowdown: false }, push + rest],
    [
      'heads-up showdown, chips on the river',
      { wentToShowdown: true, showdownHands: 2 },
      H.SHOWDOWN_READ_BASE_MS + H.WINNING_CARDS_EXTRA_MS + push + rest,
    ],
    [
      'heads-up showdown, nothing on the river',
      { wentToShowdown: true, showdownHands: 2, betsSweepOwed: false },
      H.SHOWDOWN_READ_BASE_MS + H.WINNING_CARDS_EXTRA_MS + push - H.BETS_SWEEP_MS + rest,
    ],
    [
      'all-in run out',
      { wentToShowdown: true, showdownHands: 2, allInShowdown: true, betsSweepOwed: false },
      H.SHOWDOWN_READ_BASE_MS + H.ALL_IN_SHOWDOWN_EXTRA_MS + push - H.BETS_SWEEP_MS + rest,
    ],
    [
      'three-way showdown with a side pot',
      { wentToShowdown: true, showdownHands: 3, potAwardGroups: 2 },
      H.SHOWDOWN_READ_BASE_MS +
        H.SHOWDOWN_READ_PER_EXTRA_HAND_MS +
        H.WINNING_CARDS_EXTRA_MS +
        push +
        H.POT_AWARD_STAGGER_MS +
        rest,
    ],
    [
      'cash bust with the full rebuy pause',
      { wentToShowdown: false, rebuyPauseMs: 5000 },
      push + Math.max(rest, 5000),
    ],
  ] as const)('%s', (_shape, opts, expected) => {
    expect(owedBetweenHandsMs(opts as never)).toBe(expected);
  });

  it('the budget is small and fixed', () => {
    expect(ENGINE_BETWEEN_HANDS_BUDGET_MS).toBeLessThanOrEqual(250);
  });
});

describe('a tournament deal pays nothing after the rest', () => {
  const RTT = 150;
  const REST = H.NEXT_HAND_REST_MS;
  // In-process work of the deal itself on a test runner; production budget is
  // ENGINE_BETWEEN_HANDS_BUDGET_MS.
  const IN_PROCESS_MS = 80;

  it('the state read, fn_f06_begin_hand, seq-0 and seq-1 saves all ride under the rest', async () => {
    const f = fixture({ rpcLatencyMs: RTT });
    const armedAt = Date.now();
    f.engine.armNextHandRest(REST);
    await f.engine.awaitNextHandRestLead();
    await f.dealsTheNextHand();
    const gap = f.startedAt[0] - armedAt;
    expect(f.beginAt[0]).toBeLessThan(armedAt + REST);
    // Both seq-0 (prepared original) and seq-1 (opening HAND_START batch)
    // were asked for, and answered, before the rest ended.
    expect(f.retainedAt.length).toBeGreaterThanOrEqual(2);
    expect(f.retainedAt[0] + RTT).toBeLessThanOrEqual(armedAt + REST);
    expect(f.retainedAt[1] + RTT).toBeLessThanOrEqual(armedAt + REST);
    expect(gap).toBeGreaterThanOrEqual(REST);
    // rest + in-process work, and no round trip after the rest: pre-2026-11-18
    // paid rest + begin + seq-0 + seq-1; 2026-11-19 still paid rest + seq-1
    // (~130 ms median in prod); 2026-11-22 hides seq-1 under SEQ1_RETAIN_LEAD_MS.
    expect(gap).toBeLessThanOrEqual(REST + IN_PROCESS_MS);
    expect(IN_PROCESS_MS).toBeLessThanOrEqual(ENGINE_BETWEEN_HANDS_BUDGET_MS);
  }, 10_000);

  it('with an instant database the deal starts on the rest', async () => {
    const f = fixture();
    const armedAt = Date.now();
    f.engine.armNextHandRest(REST);
    await f.engine.awaitNextHandRestLead();
    await f.dealsTheNextHand();
    expect(f.startedAt[0] - armedAt).toBeGreaterThanOrEqual(REST);
    expect(f.startedAt[0] - armedAt).toBeLessThanOrEqual(REST + IN_PROCESS_MS);
  }, 10_000);

  it('absorbs peak-load 360 ms F06 RPCs (1,080 ms total across begin, seq-0, seq-1) under the rest (1e532243)', async () => {
    // 2026-11-24 live production proof: peak-load dealing p90 = 1,355 ms and
    // seq-1 up to 562 ms overshot the old 1,000 ms / 400 ms leads.
    const f = fixture({ rpcLatencyMs: 360 });
    const armedAt = Date.now();
    f.engine.armNextHandRest(REST);
    await f.engine.awaitNextHandRestLead();
    await f.dealsTheNextHand();
    const gap = f.startedAt[0] - armedAt;
    expect(gap).toBeGreaterThanOrEqual(REST);
    expect(gap).toBeLessThanOrEqual(REST + IN_PROCESS_MS);
  }, 10_000);
});

describe('a timer that wakes early does not shorten a beat', () => {
  // Node counts a timer on libuv's millisecond loop clock, not on Date.now(),
  // so `setTimeout(deadline - Date.now())` can wake while Date.now() still
  // reads the deadline minus 1 or 2: on 2026-11-23 the measured deal above
  // read `expected 1499 to be >= 1500` in CI. Model the worst such timer -
  // every sleep moves the wall clock NODE_TIMER_EARLY_WAKE_MAX_MS less than it
  // asked - and hold both beats to "not before".
  const EARLY = ServerTableEngineBase.NODE_TIMER_EARLY_WAKE_MAX_MS;
  const REST = H.NEXT_HAND_REST_MS;
  afterEach(() => vi.useRealTimers());
  function sleepsWakingEarly(engine: any, early = EARLY): number[] {
    vi.useFakeTimers();
    const asked: number[] = [];
    engine.sleep = async (ms: number) => {
      asked.push(ms);
      await vi.advanceTimersByTimeAsync(Math.max(0, ms - early));
    };
    return asked;
  }

  it('the rest ends on its deadline on the tournament path (seq-1 rides its last slice)', async () => {
    const f = fixture();
    sleepsWakingEarly(f.engine);
    f.engine.armNextHandRest(REST);
    const deadline: number = f.engine.nextHandNotBeforeMs;
    f.engine.seq1RestStopShortMs = ServerTableEngineDealing.SEQ1_RETAIN_LEAD_MS;
    await f.engine.awaitNextHandRest();
    expect(Date.now()).toBeLessThan(deadline);
    await f.engine.awaitNextHandRest();
    expect(Date.now()).toBeGreaterThanOrEqual(deadline);
    expect(Date.now() - deadline).toBeLessThanOrEqual(ENGINE_BETWEEN_HANDS_BUDGET_MS);
  });

  it('the rest ends on its deadline on every other table', async () => {
    const f = fixture();
    sleepsWakingEarly(f.engine);
    f.engine.armNextHandRest(REST);
    const deadline: number = f.engine.nextHandNotBeforeMs;
    await f.engine.awaitNextHandRest();
    expect(Date.now()).toBeGreaterThanOrEqual(deadline);
    expect(Date.now() - deadline).toBeLessThanOrEqual(ENGINE_BETWEEN_HANDS_BUDGET_MS);
  });

  it.each([1, EARLY])(
    'the completion hold ends on its deadline (timer %i ms early)',
    async (early) => {
      const f = fixture();
      sleepsWakingEarly(f.engine, early);
      const endedAt = Date.now();
      f.engine.lastAcceptedHandEndedAtMs = endedAt;
      const hold = handCompletionHoldMs({ wentToShowdown: false });
      await f.engine.awaitHandCompletionDisplay(hold);
      expect(Date.now()).toBeGreaterThanOrEqual(endedAt + hold);
      expect(Date.now() - endedAt - hold).toBeLessThanOrEqual(ENGINE_BETWEEN_HANDS_BUDGET_MS);
    }
  );

  it('a wall clock stepped back mid-rest is not waited out again', async () => {
    const f = fixture();
    vi.useFakeTimers();
    const asked: number[] = [];
    f.engine.sleep = async (ms: number) => {
      asked.push(ms);
      await vi.advanceTimersByTimeAsync(ms);
      // The timer ran its full length on the monotonic clock; the wall clock
      // was then stepped back a minute.
      if (asked.length === 2) vi.setSystemTime(Date.now() - 60_000);
    };
    f.engine.armNextHandRest(REST);
    await f.engine.awaitNextHandRest();
    const lead = ServerTableEngineDealing.BLIND_READ_LEAD_MS;
    expect(asked).toEqual([REST - lead, lead]);
  });
});

describe('every wait between the hold and the deal is named', () => {
  // Comments are prose, not waits: strip them before reading the code.
  const code = (segment: string): string =>
    segment.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const awaitsIn = (segment: string): string[] =>
    [...code(segment).matchAll(/await\s+([A-Za-z0-9_.]+)(?=[(\s])/g)].map((m) => m[1]);

  it('the hold is one sleep: the owed completion display', () => {
    const a = DEALING.indexOf("this.setLoopPhase('post_hand_hold');");
    const b = DEALING.indexOf('this.armNextHandRest(', a);
    expect(a).toBeGreaterThan(-1);
    expect(awaitsIn(DEALING.slice(a, b))).toEqual(['this.awaitHandCompletionDisplay']);
  });

  it('after the rest the loop waits only on a pause owner, then deals', () => {
    const a = DEALING.indexOf(
      'if (this.reservesPermitUnderTheRest()) await this.awaitNextHandRestLead();'
    );
    const b = DEALING.indexOf('await this.dealHand(activePlayers);', a);
    expect(a).toBeGreaterThan(-1);
    expect(awaitsIn(DEALING.slice(a, b))).toEqual([
      'this.awaitNextHandRestLead', // the rest itself (stops short; dealHand ends it)
      'this.awaitNextHandRest', // the rest itself, for every other table
      'this.persistPresenceForRestart', // only when a maintenance pause owns the table
      'this.awaitPauseGate', // only when an owner paused the next hand
      'this.persistPresenceForRestart', // the same two, on the post-rest pause check
      'this.awaitPauseGate',
    ]);
  });

  it('inside the deal, every await is named with its reason and its side of the rest', () => {
    // dealHand, from the reservation's rest hand-off to the controller run:
    // for a tournament every one of these is still UNDER the rest.
    const a = DEALING.indexOf(
      'await this.awaitRestBlindRead();\n        if (!this.handRestStillAllowsTheDeal())'
    );
    const b = DEALING.indexOf('      } finally {\n        handStarted = attempt.started;', a);
    const r = DEALING.indexOf('  protected async runOriginalController(');
    const rest = DEALING.indexOf('await this.awaitNextHandRest();', r);
    const rEnd = DEALING.indexOf('return new Promise<void>((resolve) => {', r);
    expect(a).toBeGreaterThan(-1);
    expect(r).toBeGreaterThan(-1);
    expect(rest).toBeGreaterThan(r);
    expect(rEnd).toBeGreaterThan(rest);
    const restEnd = rest + 'await this.awaitNextHandRest('.length;
    expect(awaitsIn(DEALING.slice(a, b))).toEqual([
      'this.awaitRestBlindRead', // the level read the lead started, under the rest
      'this.sleep', // error backstop only: an unplayable seat count, deals nothing
      'supabase', // a host's manual bomb pot claim: once, on request, cash only
      'this.takePreparedCashHandManifest', // cash: sent under the rest, joined here
      'Promise.all', // time-bank reads for players NEW to the table only
      'this.runOriginalController',
    ]);
    // Before the rest ends: the seq-0 save, then the rest lead (stopping
    // SEQ1_RETAIN_LEAD_MS short so seq-1 rides the rest before HAND_START).
    expect(awaitsIn(DEALING.slice(r, restEnd))).toEqual([
      'this.retainOriginalBatch', // the prepared deck made durable, under the rest
      'this.awaitNextHandRest', // stops SEQ1_RETAIN_LEAD_MS short so seq-1 rides the rest
    ]);
    expect(DEALING).toContain('static readonly F06_RESERVE_LEAD_MS = 1500;');
    expect(DEALING).toContain('static readonly SEQ1_RETAIN_LEAD_MS = 900;');
    expect(DEALING).toContain('finishRestBeforeFirstDispatch');
    // After the rest: no round trip on the path that deals. A saved hand the
    // last look (or a later hold) refuses is released in dealHand's finally,
    // off this path: it deals nothing.
    expect(awaitsIn(DEALING.slice(restEnd, rEnd))).toEqual([
      'this.weeklyHandPause.checkpoint', // in-process cooperative owner
      'this.acquireFinancialControllerStart', // in-process boundary
      'this.weeklyHandPause.checkpoint',
      'this.awaitPauseGate', // only when an owner paused the next hand
    ]);
  });
  it('a tournament bust after the hold performs zero awaits or database reads', () => {
    const start = DEALING.indexOf('} else if (this.tableInfo?.tournament_id) {');
    const end = DEALING.indexOf('if (needsRebuyPause) {', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const branch = code(DEALING.slice(start, end));
    expect(awaitsIn(branch)).toEqual([]);
    expect(branch).not.toContain(".from('tournaments')");
  });

  it('awaitPauseGate marks parked_for_pause itself so breaks never pollute refresh_blinds', () => {
    const BASE = readFileSync(
      fileURLToPath(new URL('./ServerTableEngineBase.ts', import.meta.url)),
      'utf8'
    );
    const start = BASE.indexOf('protected async awaitPauseGate(): Promise<void> {');
    const wait = BASE.indexOf('await new Promise<void>(', start);
    expect(start).toBeGreaterThan(-1);
    expect(wait).toBeGreaterThan(start);
    expect(code(BASE.slice(start, wait))).toContain("this.setLoopPhase('parked_for_pause')");
  });

  it('pre-deal operator floor and seat-move reads overlap prepareNextHand instead of serializing (1e532243)', () => {
    const BASE = readFileSync(
      fileURLToPath(new URL('./ServerTableEngineBase.ts', import.meta.url)),
      'utf8'
    );
    const overlapAt = DEALING.indexOf('this.startPreDealReadOverlap();');
    const prepareAt = DEALING.indexOf('const nextRoster = await this.prepareNextHand();');
    expect(overlapAt).toBeGreaterThan(-1);
    expect(prepareAt).toBeGreaterThan(overlapAt);
    expect(prepareAt - overlapAt).toBeLessThan(120);
    expect(DEALING).toContain("this.setLoopPhase('operator_floor_boundary');");
    expect(DEALING).toContain("this.timeCashPrepareBranch('hourly_cash_boundary'");
    expect(BASE).toContain('const prepared = this.consumePreparedOperatorFloor();');
    expect(BASE).toContain('const prepared = this.preparedPendingSeatMoves;');
  });
});

describe('the production grade reads the same numbers', () => {
  const SQL = readFileSync(
    fileURLToPath(new URL('../../../scripts/sql/hand-gap-unintended-delay.sql', import.meta.url)),
    'utf8'
  );
  it.each([
    ['bets_sweep_ms', H.BETS_SWEEP_MS],
    ['pot_push_ms', H.POT_PUSH_MS],
    ['muck_ms', H.MUCK_MS],
    ['showdown_read_base_ms', H.SHOWDOWN_READ_BASE_MS],
    ['showdown_read_per_extra_hand_ms', H.SHOWDOWN_READ_PER_EXTRA_HAND_MS],
    ['showdown_read_max_ms', H.SHOWDOWN_READ_MAX_MS],
    ['winning_cards_extra_ms', H.WINNING_CARDS_EXTRA_MS],
    ['all_in_showdown_extra_ms', H.ALL_IN_SHOWDOWN_EXTRA_MS],
    ['pot_award_stagger_ms', H.POT_AWARD_STAGGER_MS],
    ['next_hand_rest_ms', H.NEXT_HAND_REST_MS],
    ['engine_between_hands_budget_ms', ENGINE_BETWEEN_HANDS_BUDGET_MS],
    ['rebuy_pause_max_ms', REBUY_PAUSE_MAX_MS],
    ['rit_reveal_max_ms', RIT_REVEAL_MAX_MS],
  ])('%s', (name, value) => {
    expect(SQL).toMatch(new RegExp(`\\b${value} AS ${name}\\b`));
  });
  it('records actual between-hand pause times and bounded shape booleans onto the next hand cadence', () => {
    expect(DEALING).toContain('this.pendingPriorHandCadence = {');
    expect(DEALING).toContain('hold_ms: Math.round(resultDisplayMs)');
    expect(DEALING).toContain('rest_ms: Math.round(restMs)');
    expect(DEALING).toContain('rebuy_pause_ms: rebuyPauseMs');
    expect(DEALING).toContain('rit_reveal_ms: ritRevealMs');
    expect(DEALING).toContain('all_in_showdown: this.currentHandAllInShowdown');
    expect(DEALING).toContain('bets_sweep_owed: priorBetsSweepOwed');
    expect(DEALING).toContain('this.currentHandCadence = this.pendingPriorHandCadence;');
    expect(DEALING).toContain('REBUY_PAUSE_MAX_MS');
    expect(SQL).toContain("h.next_cadence->>'all_in_showdown' = 'true'");
    expect(SQL).toContain("h.next_cadence->>'bets_sweep_owed' = 'true'");
    expect(SQL).toContain(
      "WHERE pl->>'userId' = sd->>'user_id' AND coalesce((pl->>'stack')::numeric, 1) = 0"
    );
    expect(SQL).toContain(
      "count(DISTINCT (coalesce(aw->>'board', '1'), coalesce(aw->>'potIndex', p->>'index', '0'), coalesce(aw->>'low', 'false')))"
    );
  });
  it('excludes Lightning hands by their pooled hand row, not by table name', () => {
    expect(SQL).toContain('lightning_hand lh WHERE lh.hand_history_id = hh.id');
  });
  it('never writes', () => {
    expect(SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT)\b/i);
  });
});
