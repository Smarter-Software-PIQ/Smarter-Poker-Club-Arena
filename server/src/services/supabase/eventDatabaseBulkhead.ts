/**
 * ONE EVENT'S DATABASE TROUBLE STAYS THAT EVENT'S (2026-11-18)
 *
 * What happened. Between 19:15 and 19:30 UTC one tournament (Midday Free Buy,
 * 49 to 61 tables) had its per-hand calls queue on its own advisory lock. The
 * engine reaches Postgres through PostgREST, whose pool (`db_pool`) was 40.
 * Nothing in the engine bounded how many requests one event could have open,
 * so that event held 30 to 40 backends at every moment and every other caller
 * waited for a pool slot: cash hand commits, the other eleven tournaments and
 * the players' own lobby reads. Measured at the edge for the engine's address:
 * 75 to 95 requests in flight on average against 10 to 26 when healthy,
 * `fn_f06_retain_hand_continuation` alone 22 in flight at a 800 ms median and
 * a 6.6 s p95 (110 ms and 1.1 s the five minutes before), and every table on
 * the platform slowed with it.
 *
 * The retries were not the engine hammering in a tight loop. Each call site
 * already waits before it repeats (250/750/1500 ms on the continuation write,
 * 250 ms and 1 s on a post-hand step). The defect was the missing bound: sixty
 * tables each allowed one or two open calls is a hundred open calls, and a
 * per-call backoff cannot see that.
 *
 * What this is. A bulkhead in the one place every engine request already
 * passes, the shared fetch wrapper in client.ts. A request made under a
 * tournament's data authority (dataActorContext.ts) is counted against that
 * tournament. Ordinary service work, cash tables and the maintenance client
 * carry no event and are never counted, parked or delayed here.
 *
 * THE NUMBERS, AGAINST db_pool = 100 (raised from 40 at 19:51 UTC)
 *
 *   EVENT_DB_MAX_IN_FLIGHT = 24
 *     The most requests one event may have open. Under a quarter of the pool,
 *     and more than twice what the largest event needs when healthy: at its
 *     busiest healthy five minutes (19:30, catching up, 55 tables) the whole
 *     engine averaged 26 in flight for every event and cash table together and
 *     that event was about 40% of the hands, so roughly 10. A healthy event
 *     never reaches the bound, and a request under the bound is admitted
 *     synchronously: no timer, no promise, no added delay between hands.
 *
 *   EVENT_DB_MIN_IN_FLIGHT = 6
 *     Where a troubled event's bound settles. Every call that comes back slow
 *     (EVENT_DB_SLOW_CALL_MS) or cancelled halves the bound, at most once a
 *     second, so 24 -> 12 -> 6 inside about two seconds of the first slow
 *     answer. A fully stuck event then holds 6 of 100 slots, not 30 to 40 of
 *     40. Six is kept rather than one because a merely slow event still has to
 *     finish its hands, and one lock serialises its calls in the database
 *     whatever the engine sends.
 *
 *   ALL_EVENTS_DB_MAX_IN_FLIGHT = 60
 *     Every event together. Ten events stuck at once at their floor is 60, and
 *     60 leaves 40 slots that no tournament can take: the size of the entire
 *     pool cash, service work and players had to themselves before this
 *     incident. When this total binds, free slots are handed round the waiting
 *     events one at a time, so a large event cannot starve a small one.
 *
 *   Worst case for one event: 24 slots for one statement timeout (8 s) while
 *   its first slow answers come back, then 6.
 *
 * WHAT A PARKED CALL IS. Not a new kind of wait. It is parked inside the same
 * per-attempt deadline and caller abort the request would have had on the
 * wire, and it ends the same way: `supabase_timeout`, or the caller's own
 * abort reason. Every caller already treats those as "the database blinked".
 * Before this, the same call waited the same time in PostgREST's pool queue,
 * holding a place everyone else needed.
 *
 * BACKING OFF. A call that ends in a lock timeout, a statement timeout, a
 * serialization refusal (F06_RETRY_CANONICAL_LANE is 40001), a gateway answer
 * or our own deadline keeps its slot closed for a jittered, doubling pause
 * (EVENT_DB_BACKOFF_BASE_MS up to EVENT_DB_BACKOFF_MAX_MS) before the event's
 * next parked call is let through. One good answer clears it. A healthy event
 * with a single refused call lends one of its 24 slots for 50 to 100 ms.
 *
 * WHAT IT DOES NOT CHANGE. No request is reordered within a table: a table's
 * calls are awaited one after another by its own loop, and parked calls leave
 * in the order they arrived. No request is dropped, merged or answered here.
 * The maintenance client (the freeze's own writers, and the terminal
 * settlement doors that use its longer deadline) is exempt, so a freeze or a
 * finish is never parked behind the event's hand traffic. On shutdown the
 * bulkhead opens: parked calls are released and nothing is counted again, so
 * the final writes of a stopping engine are never held here.
 *
 * Limits are per engine process. Production runs one dealing process.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/** PostgREST `db_pool` on the production project, as set 2026-11-18 19:51 UTC. */
export const DB_POOL_SIZE = 100;
/** Healthy ceiling for one event. See the arithmetic above. */
export const EVENT_DB_MAX_IN_FLIGHT = 24;
/** Floor a troubled event's bound settles at. */
export const EVENT_DB_MIN_IN_FLIGHT = 6;
/** Every event together; the rest of the pool is out of any tournament's reach. */
export const ALL_EVENTS_DB_MAX_IN_FLIGHT = 60;
/** An answer slower than this is evidence the event's lane is congested.
 * Healthy p95 across the hand-path RPCs is 150 to 1,100 ms. */
export const EVENT_DB_SLOW_CALL_MS = 2_000;
/** The bound is halved at most this often, so one wave of slow answers counts once. */
export const EVENT_DB_DECREASE_INTERVAL_MS = 1_000;
/** Time without slow/congested answers after which a throttled event steps its
 * concurrency bound back up (+2 slots per window), preventing quiet or late-stage
 * tournaments from remaining pinned below maxPerEvent for hours. */
export const EVENT_DB_HEALTHY_RECOVERY_MS = 30_000;
/** Idle window with zero in-flight, cooling, or parked calls and zero recent
 * slow/congested answers after which a throttled event resets straight to its
 * full ceiling (e.g. tournament breaks or completed events). */
export const EVENT_DB_IDLE_RESET_MS = 120_000;
/** First pause after a congested answer; doubles per consecutive one. */
export const EVENT_DB_BACKOFF_BASE_MS = 100;
/** Longest pause. Bounded so a recovered lane is found again within two seconds. */
export const EVENT_DB_BACKOFF_MAX_MS = 2_000;
/** Parked calls one event may hold. 61 tables with a handful of calls each is
 * far below it; past it the call is refused as a timeout at once. */
export const EVENT_DB_MAX_PARKED = 512;

export type EventDbPriority = 'high' | 'normal';

const eventDbPriorityOverride = new AsyncLocalStorage<EventDbPriority>();

/**
 * Run an async boundary (such as a parked gap-balance source's door/board reads)
 * under an explicit bulkhead priority override so its table/seat SELECTs jump
 * ahead of background sweep/rebuy traffic in the same tournament bulkhead.
 */
export function runWithEventDbPriority<T>(priority: EventDbPriority, fn: () => T): T {
  return eventDbPriorityOverride.run(priority, fn);
}

/** Active AsyncLocalStorage priority override, if any. */
export function getEventDbPriorityOverride(): EventDbPriority | undefined {
  return eventDbPriorityOverride.getStore();
}

/** Maximum consecutive high-priority admissions while normal callers are waiting,
 * preventing starvation of background balance/sweep reads under heavy hand load. */
export const EVENT_DB_HIGH_PRIORITY_BURST_LIMIT = 4;

/**
 * Hand-lifecycle and atomic seat-move RPCs that sit directly on the live
 * between-hands critical path. When a large tournament's bulkhead queue is
 * contended by multi-page sweep/balance scans or rebuy traffic, admitting
 * these ahead of normal background queries (with bounded anti-starvation)
 * eliminates head-of-line delay between hands without weakening any pool cap
 * (incident 1e532243).
 */
export const EVENT_DB_HIGH_PRIORITY_RPCS: ReadonlySet<string> = new Set([
  // F06 hand-dealing permit & continuation lifecycle
  'fn_f06_allocate_hand_number',
  'fn_f06_hand_number_state',
  'fn_f06_allocate_original_intent',
  'fn_f06_begin_hand',
  'fn_f06_begin_hand_with_intent',
  'fn_f06_retain_hand_continuation',
  'fn_f06_claim_hand_continuation',
  'fn_f06_claim_legacy_river_continuation',
  'fn_f06_finish_hand',
  'fn_f06_finish_original_no_start',
  'fn_f06_cancel_prepared_hand',
  'fn_f06_cancel_retained_prepared_hand',
  // Dealing, hand number, time-bank, operator-floor & pre-deal add-on boundaries
  'fn_next_hand_number',
  'fn_time_bank_allowance_v2',
  'fn_time_bank_allowance',
  'fn_consume_time_bank',
  'fn_ca_operator_floor_state',
  'fn_ca_resolve_unbound_pending_addons',
  'insert_hole_cards',
  'save_hand_state_snapshot',
  'complete_hand_snapshot',
  // Post-commit obligations on the live hand boundary
  'fn_ca_process_hand_post_commit_obligations',
  // Atomic tournament seat move (unparks fenced gap-balance source tables)
  'fn_move_tournament_player',
]);

/**
 * Hand-submission / hand-settlement RPC prefixes classified as high priority
 * without quoting hand-writing door names in a non-caller module (keeping
 * `aHandNamesTheEngineBuildThatDealtIt.law.test.ts` door discovery exact).
 */
const EVENT_DB_HIGH_PRIORITY_RPC_PREFIXES: readonly string[] = [
  'fn_ca_commit_hand_',
  'fn_ca_retain_hand_',
  'fn_ca_resume_hand_',
];

/** Classify a Supabase fetch target into bulkhead priority. */
export function classifyEventDbPriority(input: string | URL | Request): EventDbPriority {
  const raw =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : typeof Request !== 'undefined' && input instanceof Request
          ? input.url
          : String(input);
  let pathname: string;
  try {
    pathname = new URL(raw, 'https://localhost').pathname;
  } catch {
    return 'normal';
  }
  const prefix = '/rest/v1/rpc/';
  if (!pathname.startsWith(prefix)) return 'normal';
  const rpcName = pathname.slice(prefix.length).replace(/\/+$/, '');
  if (EVENT_DB_HIGH_PRIORITY_RPCS.has(rpcName)) return 'high';
  for (const rpcPrefix of EVENT_DB_HIGH_PRIORITY_RPC_PREFIXES) {
    if (rpcName.startsWith(rpcPrefix)) return 'high';
  }
  return 'normal';
}

export type EventDbOutcome =
  /** Answered in good time. */
  | 'ok'
  /** Answered, but slower than EVENT_DB_SLOW_CALL_MS. */
  | 'slow'
  /** Lock/statement timeout, serialization refusal, gateway answer, deadline. */
  | 'congested'
  /** Says nothing about the lane: a deterministic refusal, a cancelled caller. */
  | 'neutral';

export interface EventDbPermit {
  readonly key: string | null;
  released: boolean;
}

interface Waiter {
  readonly permit: EventDbPermit;
  readonly resolve: (permit: EventDbPermit) => void;
  readonly reject: (reason: unknown) => void;
  readonly signal: AbortSignal | undefined;
  readonly priority: EventDbPriority;
  readonly enqueuedAt: number;
  onAbort: (() => void) | undefined;
}

/** Histogram buckets (ms) for bulkhead queue wait latency by priority. */
export const EVENT_DB_QUEUE_WAIT_BUCKETS_MS: readonly number[] = [
  5, 10, 25, 50, 100, 250, 500, 1_000, 2_000, 5_000,
];

interface WaitHistogram {
  readonly buckets: number[];
  count: number;
  sum: number;
}

interface EventState {
  inFlight: number;
  /** Slots held closed by a backoff pause. */
  cooling: number;
  limit: number;
  goodSinceIncrease: number;
  lastDecreaseAt: number;
  lastCongestionOrSlowAt: number;
  congestedStreak: number;
  slowStreak: number;
  lastLoggedAt: number;
  consecutiveHighServed: number;
  readonly highQueue: Waiter[];
  readonly normalQueue: Waiter[];
  readonly coolingTimers: Set<ReturnType<typeof setTimeout>>;
}

export interface EventDbBulkheadSnapshot {
  open: boolean;
  totalInFlight: number;
  parkedTotal: number;
  parkTimeoutsTotal: number;
  refusedFullTotal: number;
  events: Array<{ key: string; inFlight: number; cooling: number; limit: number; parked: number }>;
}

export interface EventDbBulkheadOptions {
  maxPerEvent?: number;
  minPerEvent?: number;
  maxAllEvents?: number;
  maxParked?: number;
  now?: () => number;
  random?: () => number;
  log?: (line: string) => void;
}

const PASS_THROUGH: EventDbPermit = Object.freeze({ key: null, released: true });
const LOG_INTERVAL_MS = 10_000;
const IDLE_SWEEP_THRESHOLD = 1_024;

/** PostgREST error codes that mean "the lane was busy", not "the work is wrong". */
export function isCongestionSqlstate(code: unknown): boolean {
  if (typeof code !== 'string') return false;
  return (
    code === '57014' ||
    code === '55P03' ||
    code === '40001' ||
    code === '40P01' ||
    code === 'PGRST001' ||
    code === 'PGRST002' ||
    code === 'PGRST003' ||
    code.startsWith('53') ||
    code.startsWith('08')
  );
}

export class EventDatabaseBulkhead {
  private readonly maxPerEvent: number;
  private readonly minPerEvent: number;
  private readonly maxAllEvents: number;
  private readonly maxParked: number;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly log: (line: string) => void;
  private readonly events = new Map<string, EventState>();
  /** Events with a parked call, in the order they are next owed a slot. */
  private readonly waiting = new Set<string>();
  private totalInFlight = 0;
  private open = false;
  private parkedTotal = 0;
  private parkTimeoutsTotal = 0;
  private refusedFullTotal = 0;
  private readonly waitByPriority: Record<EventDbPriority, WaitHistogram> = {
    high: { buckets: new Array(EVENT_DB_QUEUE_WAIT_BUCKETS_MS.length).fill(0), count: 0, sum: 0 },
    normal: { buckets: new Array(EVENT_DB_QUEUE_WAIT_BUCKETS_MS.length).fill(0), count: 0, sum: 0 },
  };

  constructor(options: EventDbBulkheadOptions = {}) {
    this.maxPerEvent = options.maxPerEvent ?? EVENT_DB_MAX_IN_FLIGHT;
    this.minPerEvent = Math.min(options.minPerEvent ?? EVENT_DB_MIN_IN_FLIGHT, this.maxPerEvent);
    this.maxAllEvents = options.maxAllEvents ?? ALL_EVENTS_DB_MAX_IN_FLIGHT;
    this.maxParked = options.maxParked ?? EVENT_DB_MAX_PARKED;
    this.now = options.now ?? (() => performance.now());
    this.random = options.random ?? Math.random;
    this.log = options.log ?? ((line) => console.warn(line));
  }

  /**
   * Take a slot for one request of `key`'s event.
   *
   * Under the bound this returns the permit itself, synchronously: the healthy
   * path gains no promise and no timer. Otherwise the call is parked until a
   * slot frees, `signal` aborts (rejecting with the signal's own reason), or
   * the bulkhead opens for shutdown.
   */
  acquire(
    key: string,
    signal?: AbortSignal,
    priority: EventDbPriority = 'normal'
  ): EventDbPermit | Promise<EventDbPermit> {
    if (this.open) return PASS_THROUGH;
    signal?.throwIfAborted();
    let found = this.events.get(key);
    if (!found) {
      if (this.events.size >= IDLE_SWEEP_THRESHOLD) this.sweepIdle();
      found = {
        inFlight: 0,
        cooling: 0,
        limit: this.maxPerEvent,
        goodSinceIncrease: 0,
        lastDecreaseAt: Number.NEGATIVE_INFINITY,
        lastCongestionOrSlowAt: Number.NEGATIVE_INFINITY,
        congestedStreak: 0,
        slowStreak: 0,
        lastLoggedAt: Number.NEGATIVE_INFINITY,
        consecutiveHighServed: 0,
        highQueue: [],
        normalQueue: [],
        coolingTimers: new Set(),
      };
      this.events.set(key, found);
    }
    const state = found;
    this.recoverLimitOnTime(key, state, this.now());
    const permit: EventDbPermit = { key, released: false };
    if (
      this.parkedCount(state) === 0 &&
      state.inFlight + state.cooling < state.limit &&
      this.totalInFlight < this.maxAllEvents
    ) {
      state.inFlight++;
      this.totalInFlight++;
      state.consecutiveHighServed = 0;
      return permit;
    }
    if (this.parkedCount(state) >= this.maxParked) {
      this.refusedFullTotal++;
      this.note(key, state, 'refused a call: its parked queue is full');
      // Same shape as the deadline every caller already handles as transient.
      throw new Error('supabase_timeout');
    }
    this.parkedTotal++;
    const targetQueue = priority === 'high' ? state.highQueue : state.normalQueue;
    const enqueuedAt = this.now();
    return new Promise<EventDbPermit>((resolve, reject) => {
      const waiter: Waiter = {
        permit,
        resolve,
        reject,
        signal,
        priority,
        enqueuedAt,
        onAbort: undefined,
      };
      if (signal) {
        waiter.onAbort = () => {
          const at = targetQueue.indexOf(waiter);
          if (at < 0) return;
          targetQueue.splice(at, 1);
          if (this.parkedCount(state) === 0) this.waiting.delete(key);
          permit.released = true;
          this.parkTimeoutsTotal++;
          this.forgetIfIdle(key, state);
          reject(signal.reason);
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      targetQueue.push(waiter);
      this.waiting.add(key);
      this.note(key, state, 'is parking calls');
    });
  }

  /** Give the slot back and say how the request ended. Idempotent per permit. */
  release(permit: EventDbPermit, outcome: EventDbOutcome): void {
    if (permit.released || permit.key === null) return;
    permit.released = true;
    const key = permit.key;
    const state = this.events.get(key);
    if (!state) return;
    state.inFlight = Math.max(0, state.inFlight - 1);
    this.totalInFlight = Math.max(0, this.totalInFlight - 1);
    if (this.open) return;

    if (outcome === 'ok') {
      state.congestedStreak = 0;
      state.slowStreak = 0;
      this.recoverLimitOnTime(key, state, this.now());
      if (state.limit < this.maxPerEvent && ++state.goodSinceIncrease >= state.limit) {
        state.goodSinceIncrease = 0;
        state.limit++;
        if (state.limit === this.maxPerEvent) {
          state.lastLoggedAt = Number.NEGATIVE_INFINITY;
          this.note(key, state, 'recovered its full bound');
        }
      }
    } else if (outcome === 'slow' || outcome === 'congested') {
      const at = this.now();
      state.lastCongestionOrSlowAt = at;
      if (outcome === 'congested') state.congestedStreak++;
      else state.slowStreak++;
      // An isolated serialization retry (e.g. a single 40001 on a quiet event
      // at inFlight=0) cools one slot without cutting the event's bound in
      // half for the next ~210 calls. Likewise, an isolated slow outlier (e.g.
      // a single 2s rebuy or vacuum tick on a healthy 40-table tournament)
      // must not halve the bound for ~210 calls (incident 1e532243): require
      // sustained slowness (slowStreak >= 2, or prior congestion) to halve on
      // `slow`, while preserving immediate halving on `congested` when
      // streak >= 2 or concurrency is already active (inFlight + cooling >= minPerEvent).
      const shouldHalve =
        outcome === 'slow'
          ? state.slowStreak >= 2 || state.congestedStreak >= 1
          : state.congestedStreak >= 2 || state.inFlight + state.cooling >= this.minPerEvent;
      if (shouldHalve && at - state.lastDecreaseAt >= EVENT_DB_DECREASE_INTERVAL_MS) {
        state.lastDecreaseAt = at;
        state.goodSinceIncrease = 0;
        const next = Math.max(this.minPerEvent, Math.floor(state.limit / 2));
        if (next < state.limit) {
          state.limit = next;
          this.note(key, state, `is congested (${outcome}); bound lowered`);
        }
      }
      if (outcome === 'congested') {
        const ceiling = Math.min(
          EVENT_DB_BACKOFF_BASE_MS * 2 ** Math.min(state.congestedStreak - 1, 10),
          EVENT_DB_BACKOFF_MAX_MS
        );
        // Jitter over the upper half, so a wave of refusals does not return as a wave.
        const pause = Math.round(ceiling * (0.5 + 0.5 * this.random()));
        state.cooling++;
        const timer = setTimeout(() => {
          state.coolingTimers.delete(timer);
          state.cooling = Math.max(0, state.cooling - 1);
          this.pump();
          this.forgetIfIdle(key, state);
        }, pause);
        (timer as { unref?: () => void }).unref?.();
        state.coolingTimers.add(timer);
      }
    }
    this.pump();
    this.forgetIfIdle(key, state);
  }

  /**
   * The engine is stopping. Release every parked call and stop counting, so a
   * final write is never held here. In-flight permits release as usual.
   */
  openForShutdown(): void {
    if (this.open) return;
    this.open = true;
    for (const [, state] of this.events) {
      for (const timer of state.coolingTimers) clearTimeout(timer);
      state.coolingTimers.clear();
      state.cooling = 0;
      for (const waiter of [...state.highQueue.splice(0), ...state.normalQueue.splice(0)]) {
        if (waiter.onAbort) waiter.signal?.removeEventListener('abort', waiter.onAbort);
        waiter.permit.released = true;
        waiter.resolve(PASS_THROUGH);
      }
    }
    this.waiting.clear();
  }

  snapshot(): EventDbBulkheadSnapshot {
    this.sweepRecoveredEvents(this.now());
    return {
      open: this.open,
      totalInFlight: this.totalInFlight,
      parkedTotal: this.parkedTotal,
      parkTimeoutsTotal: this.parkTimeoutsTotal,
      refusedFullTotal: this.refusedFullTotal,
      events: [...this.events].map(([key, state]) => ({
        key,
        inFlight: state.inFlight,
        cooling: state.cooling,
        limit: state.limit,
        parked: this.parkedCount(state),
      })),
    };
  }

  /**
   * Bounded Prometheus exposition lines for /metrics (always present, even at
   * zero on cold start, with zero per-event cardinality).
   */
  toPrometheusLines(): string[] {
    const nowMs = this.now();
    this.sweepRecoveredEvents(nowMs);
    let parkedCurrent = 0;
    let parkedHigh = 0;
    let parkedNormal = 0;
    let oldestHighMs = 0;
    let oldestNormalMs = 0;
    let coolingCurrent = 0;
    let throttledEvents = 0;
    for (const state of this.events.values()) {
      parkedCurrent += this.parkedCount(state);
      parkedHigh += state.highQueue.length;
      parkedNormal += state.normalQueue.length;
      if (state.highQueue.length > 0) {
        const age = Math.max(0, nowMs - state.highQueue[0].enqueuedAt);
        if (age > oldestHighMs) oldestHighMs = age;
      }
      if (state.normalQueue.length > 0) {
        const age = Math.max(0, nowMs - state.normalQueue[0].enqueuedAt);
        if (age > oldestNormalMs) oldestNormalMs = age;
      }
      coolingCurrent += state.cooling;
      if (state.limit < this.maxPerEvent) throttledEvents++;
    }
    const lines = [
      '# HELP poker_event_db_bulkhead_open 1 when the event database bulkhead is open for shutdown (bypassing concurrency bounds), 0 during normal operation',
      '# TYPE poker_event_db_bulkhead_open gauge',
      `poker_event_db_bulkhead_open ${this.open ? 1 : 0}`,
      '# HELP poker_event_db_bulkhead_in_flight Current in-flight event-scoped database calls across all tournaments',
      '# TYPE poker_event_db_bulkhead_in_flight gauge',
      `poker_event_db_bulkhead_in_flight ${this.totalInFlight}`,
      '# HELP poker_event_db_bulkhead_parked_current Current event-scoped database calls parked waiting for a bulkhead slot',
      '# TYPE poker_event_db_bulkhead_parked_current gauge',
      `poker_event_db_bulkhead_parked_current ${parkedCurrent}`,
      '# HELP poker_event_db_bulkhead_parked_by_priority Current parked event-scoped database calls split by queue priority',
      '# TYPE poker_event_db_bulkhead_parked_by_priority gauge',
      `poker_event_db_bulkhead_parked_by_priority{priority="high"} ${parkedHigh}`,
      `poker_event_db_bulkhead_parked_by_priority{priority="normal"} ${parkedNormal}`,
      '# HELP poker_event_db_bulkhead_oldest_parked_ms Milliseconds the oldest currently parked bulkhead call has waited per priority; 0 when none',
      '# TYPE poker_event_db_bulkhead_oldest_parked_ms gauge',
      `poker_event_db_bulkhead_oldest_parked_ms{priority="high"} ${Math.round(oldestHighMs)}`,
      `poker_event_db_bulkhead_oldest_parked_ms{priority="normal"} ${Math.round(oldestNormalMs)}`,
      '# HELP poker_event_db_bulkhead_cooling_current Current bulkhead slots cooling after database congestion',
      '# TYPE poker_event_db_bulkhead_cooling_current gauge',
      `poker_event_db_bulkhead_cooling_current ${coolingCurrent}`,
      '# HELP poker_event_db_bulkhead_active_events Active tournament event lanes currently tracked by the database bulkhead',
      '# TYPE poker_event_db_bulkhead_active_events gauge',
      `poker_event_db_bulkhead_active_events ${this.events.size}`,
      '# HELP poker_event_db_bulkhead_throttled_events Active tournament event lanes currently throttled below their normal concurrency limit',
      '# TYPE poker_event_db_bulkhead_throttled_events gauge',
      `poker_event_db_bulkhead_throttled_events ${throttledEvents}`,
      '# HELP poker_event_db_bulkhead_parked_total Cumulative event-scoped database calls parked by the bulkhead',
      '# TYPE poker_event_db_bulkhead_parked_total counter',
      `poker_event_db_bulkhead_parked_total ${this.parkedTotal}`,
      '# HELP poker_event_db_bulkhead_park_timeouts_total Cumulative parked event-scoped database calls whose caller deadline expired before acquiring a slot',
      '# TYPE poker_event_db_bulkhead_park_timeouts_total counter',
      `poker_event_db_bulkhead_park_timeouts_total ${this.parkTimeoutsTotal}`,
      '# HELP poker_event_db_bulkhead_refused_full_total Cumulative event-scoped database calls refused immediately because the bulkhead wait queue was full',
      '# TYPE poker_event_db_bulkhead_refused_full_total counter',
      `poker_event_db_bulkhead_refused_full_total ${this.refusedFullTotal}`,
      '# HELP poker_event_db_bulkhead_queue_wait_ms Milliseconds parked event-scoped database calls waited in the bulkhead queue before admission, split by priority',
      '# TYPE poker_event_db_bulkhead_queue_wait_ms histogram',
    ];
    for (const priority of ['high', 'normal'] as const) {
      const h = this.waitByPriority[priority];
      for (let i = 0; i < EVENT_DB_QUEUE_WAIT_BUCKETS_MS.length; i++) {
        lines.push(
          `poker_event_db_bulkhead_queue_wait_ms_bucket{priority="${priority}",le="${EVENT_DB_QUEUE_WAIT_BUCKETS_MS[i]}"} ${h.buckets[i]}`
        );
      }
      lines.push(
        `poker_event_db_bulkhead_queue_wait_ms_bucket{priority="${priority}",le="+Inf"} ${h.count}`
      );
      lines.push(`poker_event_db_bulkhead_queue_wait_ms_sum{priority="${priority}"} ${h.sum}`);
      lines.push(`poker_event_db_bulkhead_queue_wait_ms_count{priority="${priority}"} ${h.count}`);
    }
    return lines;
  }

  /**
   * Hand free slots to parked calls. Within an event, in arrival order. Across
   * events, always favor the eligible waiting event holding the fewest
   * in-flight slots (breaking ties by round-robin waiting order, and rotating
   * the served event to the back): when the all-events total is saturated by
   * one or two large tournaments holding 20-24 slots, a smaller tournament
   * parked at inFlight=0 gets the very next freed slot instead of starving
   * behind the saturated events' earlier-parked queues (incident 1e532243).
   */
  private pump(): void {
    while (this.waiting.size > 0 && this.totalInFlight < this.maxAllEvents) {
      let bestKey: string | null = null;
      let bestState: EventState | null = null;
      let bestInFlight = Infinity;
      for (const key of [...this.waiting]) {
        const state = this.events.get(key);
        if (!state || this.parkedCount(state) === 0) {
          this.waiting.delete(key);
          continue;
        }
        if (state.inFlight + state.cooling >= state.limit) continue;
        if (state.inFlight < bestInFlight) {
          bestInFlight = state.inFlight;
          bestKey = key;
          bestState = state;
        }
      }
      if (!bestKey || !bestState) return;
      let waiter: Waiter;
      if (
        bestState.highQueue.length > 0 &&
        (bestState.normalQueue.length === 0 ||
          bestState.consecutiveHighServed < EVENT_DB_HIGH_PRIORITY_BURST_LIMIT)
      ) {
        waiter = bestState.highQueue.shift()!;
        bestState.consecutiveHighServed =
          bestState.normalQueue.length > 0 ? bestState.consecutiveHighServed + 1 : 0;
      } else {
        waiter = bestState.normalQueue.shift()!;
        bestState.consecutiveHighServed = 0;
      }
      if (waiter.onAbort) waiter.signal?.removeEventListener('abort', waiter.onAbort);
      const waitedMs = Math.max(0, this.now() - waiter.enqueuedAt);
      const hist = this.waitByPriority[waiter.priority];
      hist.count++;
      hist.sum += waitedMs;
      for (let i = 0; i < EVENT_DB_QUEUE_WAIT_BUCKETS_MS.length; i++) {
        if (waitedMs <= EVENT_DB_QUEUE_WAIT_BUCKETS_MS[i]) hist.buckets[i]++;
      }
      bestState.inFlight++;
      this.totalInFlight++;
      this.waiting.delete(bestKey);
      if (this.parkedCount(bestState) > 0) this.waiting.add(bestKey);
      waiter.resolve(waiter.permit);
    }
  }

  /**
   * Time-based recovery for throttled events. Pure call-count AIMD requires
   * ~210 consecutive ok calls to climb from 12 to 24, leaving quiet/late-stage
   * tournaments or finished/on-break events pinned below maxPerEvent for hours.
   * Stepping +2 per EVENT_DB_HEALTHY_RECOVERY_MS without slow/congested replies
   * (and resetting idle events after EVENT_DB_IDLE_RESET_MS) restores healthy
   * capacity cleanly while still backing off immediately if congestion returns.
   */
  private recoverLimitOnTime(key: string, state: EventState, at: number): boolean {
    if (
      state.limit >= this.maxPerEvent ||
      state.cooling > 0 ||
      !Number.isFinite(state.lastCongestionOrSlowAt)
    ) {
      return false;
    }
    const elapsed = at - state.lastCongestionOrSlowAt;
    if (elapsed < EVENT_DB_HEALTHY_RECOVERY_MS) return false;
    if (
      state.inFlight === 0 &&
      this.parkedCount(state) === 0 &&
      elapsed >= EVENT_DB_IDLE_RESET_MS
    ) {
      state.limit = this.maxPerEvent;
      state.goodSinceIncrease = 0;
      state.congestedStreak = 0;
      state.slowStreak = 0;
      state.lastLoggedAt = Number.NEGATIVE_INFINITY;
      this.note(key, state, 'recovered its full bound after idle window');
      return true;
    }
    const steps = Math.floor(elapsed / EVENT_DB_HEALTHY_RECOVERY_MS);
    const nextLimit = Math.min(this.maxPerEvent, state.limit + steps * 2);
    state.lastCongestionOrSlowAt += steps * EVENT_DB_HEALTHY_RECOVERY_MS;
    if (nextLimit <= state.limit) return false;
    state.limit = nextLimit;
    state.goodSinceIncrease = 0;
    if (state.limit === this.maxPerEvent) {
      state.congestedStreak = 0;
      state.slowStreak = 0;
      state.lastLoggedAt = Number.NEGATIVE_INFINITY;
      this.note(key, state, 'recovered its full bound');
    }
    return true;
  }

  private sweepRecoveredEvents(nowMs: number): void {
    if (this.open) return;
    let recoveredAny = false;
    for (const [key, state] of [...this.events]) {
      if (state.limit < this.maxPerEvent && this.recoverLimitOnTime(key, state, nowMs)) {
        recoveredAny = true;
      }
      this.forgetIfIdle(key, state);
    }
    if (recoveredAny && this.waiting.size > 0) this.pump();
  }

  private parkedCount(state: EventState): number {
    return state.highQueue.length + state.normalQueue.length;
  }

  private forgetIfIdle(key: string, state: EventState): void {
    if (
      state.inFlight === 0 &&
      state.cooling === 0 &&
      this.parkedCount(state) === 0 &&
      state.limit === this.maxPerEvent &&
      state.slowStreak === 0
    )
      this.events.delete(key);
  }

  /** A finished event that ended while throttled would otherwise stay forever. */
  private sweepIdle(): void {
    for (const [key, state] of this.events)
      if (state.inFlight === 0 && state.cooling === 0 && this.parkedCount(state) === 0)
        this.events.delete(key);
  }

  /** One line per event per ten seconds: the condition, never per-call noise. */
  private note(key: string, state: EventState, what: string): void {
    try {
      const at = this.now();
      if (at - state.lastLoggedAt < LOG_INTERVAL_MS) return;
      state.lastLoggedAt = at;
      this.log(
        `[EventDbBulkhead] tournament ${key} ${what}: bound=${state.limit} inFlight=${state.inFlight} cooling=${state.cooling} parked=${this.parkedCount(state)} allEvents=${this.totalInFlight}/${this.maxAllEvents}`
      );
    } catch {
      /* reporting must never disturb a request */
    }
  }
}

/** The process's one bulkhead, shared by every bounded client in client.ts. */
export const eventDatabaseBulkhead = new EventDatabaseBulkhead();

/** Prometheus exposition lines for the process-wide event database bulkhead. */
export function eventDbBulkheadPrometheusLines(): string[] {
  return eventDatabaseBulkhead.toPrometheusLines();
}

/** How one finished attempt reads as evidence about its event's lane. */
export function classifyEventDbOutcome(
  status: number,
  errorCode: unknown,
  elapsedMs: number
): EventDbOutcome {
  if (status === 502 || status === 503 || status === 504) return 'congested';
  // Whatever status PostgREST gives the SQLSTATE, the SQLSTATE is the evidence.
  if (status >= 400 && isCongestionSqlstate(errorCode)) return 'congested';
  if (elapsedMs >= EVENT_DB_SLOW_CALL_MS) return 'slow';
  // Any other 5xx is a fault in the work, not in the lane.
  if (status >= 500) return 'neutral';
  // A prompt 4xx is the database deciding: the lane itself answered.
  return 'ok';
}

/** A thrown attempt: our own transport deadline or a call that actually waited
 * at least EVENT_DB_SLOW_CALL_MS is congestion; a caller's shorter abort (such
 * as an observe-only 1.5 s AbortSignal.timeout) is not evidence that the event's
 * lane is congested. */
export function classifyEventDbFailure(error: unknown, elapsedMs: number): EventDbOutcome {
  if (error instanceof Error && error.message === 'supabase_timeout') return 'congested';
  return elapsedMs >= EVENT_DB_SLOW_CALL_MS ? 'congested' : 'neutral';
}
