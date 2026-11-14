/**
 * A PKO BUST WAITS ONLY ON ITS MONEY (2026-11-14, incident b6d94533)
 *
 * The Midnight Free Buy PKO (496 entries) busted 20-34 players a minute after
 * rebuys closed at 01:30 CST while the engine recorded about 13.5 a minute;
 * 110 busts waited a median 440 s, held their chairs and blocked the break.
 * Busts are recorded one at a time in hand order (the PKO watermark), so the
 * event's ceiling is the serial chain per bust.
 *
 * This MEASURES end-to-end throughput through the real staged sweep
 * (runEliminationSweep), the real eliminatePlayer, the real bounty payer and
 * the real TournamentEliminationScheduler with four slots and the real 5 s
 * budget, with several events busting at once. Two latency models:
 *
 *  - FLAT: every request answers TRIP_MS (200 ms) after it is sent, plus the
 *    money RPCs' mean database time. This isolates the engine's own round
 *    trips: the previous code saturates near 20 a minute; with the next
 *    bust's evidence prefetched, its guard sent with this bust's marker read
 *    and the broadcasts moved behind the money, the same harness records
 *    well over 40, keeps a 40-a-minute event with no growing backlog, and
 *    keeps four 34-a-minute events on four slots.
 *  - EMPIRICAL: every request samples the server-side origin times measured
 *    in Supabase's edge logs for the engine's own requests during the
 *    incident (reads p50 117 ms / p95 1.3 s; the knockout door p50 798 ms;
 *    the payer p50 864 ms). Here the engine change still roughly doubles the
 *    previous code's rate, but the door and the payer, which must run in
 *    series for every bust, remain the ceiling: their server-side time, not
 *    the engine's trips, is what keeps a 34-a-minute PKO from being recorded
 *    as fast as it busts. That is the next dependency, in the database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyManagerWakeInbox } from './__fixtures__/emptyManagerWakeInbox.js';

const fixture = vi.hoisted(() => ({
  frozen: false,
  from: vi.fn(),
  rpc: vi.fn(),
  reportError: vi.fn(),
}));
vi.mock('../services/supabase/client.js', () => ({
  supabase: { from: fixture.from, rpc: fixture.rpc },
  maintenanceSupabase: { from: fixture.from, rpc: fixture.rpc },
}));
vi.mock('../maintenance/freezeState.js', () => ({ isMaintenanceFrozen: () => fixture.frozen }));
vi.mock('../services/errorReporter.js', () => ({
  reportError: fixture.reportError,
  reportWarning: vi.fn(),
}));
vi.stubGlobal(
  'fetch',
  vi.fn(() => {
    throw new Error('Network disabled in fixture');
  })
);

const { TournamentManagerEliminations } = await import('./TournamentManagerEliminations.js');
const { TournamentSweepWorkCursor } = await import('./TournamentSweepWorkCursor.js');
const { TournamentEliminationScheduler } = await import('./TournamentEliminationScheduler.js');
const { TournamentManagerBase } = await import('./TournamentManagerBase.js');

/** Measured on production: ~170-200 ms per PostgREST trip; the upper end. */
let TRIP_MS = 200;
/**
 * Production tails: the incident's busts were 2.4-4.0 s apart most of the time
 * and 4-22 s apart about one time in three (event loop, PostgREST, GC). A
 * seeded generator stalls a fraction of trips by STALL_MS; the fraction is
 * calibrated so the PREVIOUS code reproduces the 13.5 a minute measured on
 * engine-01, and the current code is then measured under the same tails.
 */
let STALL_P = 0;
const STALL_MS = 5_000;
/**
 * MEASURED server-side origin times (Supabase edge logs, engine requests,
 * 01:30-01:58 CST November 14), as quantiles 10/25/50/75/90/95/98/99/99.9:
 * ordinary reads (48,148), the knockout door (356) and the payer (355).
 * When `EMPIRICAL` is set every trip samples these, plus a fixed network
 * round trip, instead of the flat TRIP_MS.
 */
const QUANTILES = [0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.98, 0.99, 0.999];
const ORIGIN_MS = {
  read: [87, 96, 117, 311, 861, 1346, 1816, 2064, 2838],
  door: [713, 749, 798, 896, 1202, 1496, 1922, 2741, 3434],
  payer: [760, 805, 864, 984, 1333, 1536, 2196, 2495, 3774],
};
let EMPIRICAL = false;
let RTT_MS = 0;
const sampleOrigin = (kind: keyof typeof ORIGIN_MS): number => {
  const q = ORIGIN_MS[kind];
  const u = rng();
  if (u <= QUANTILES[0]) return q[0] * (u / QUANTILES[0]);
  for (let i = 1; i < QUANTILES.length; i++) {
    if (u <= QUANTILES[i]) {
      const f = (u - QUANTILES[i - 1]) / (QUANTILES[i] - QUANTILES[i - 1]);
      return q[i - 1] + f * (q[i] - q[i - 1]);
    }
  }
  return q[q.length - 1];
};
const tripLatency = (kind: keyof typeof ORIGIN_MS): number =>
  EMPIRICAL ? RTT_MS + sampleOrigin(kind) : TRIP_MS + (rng() < STALL_P ? STALL_MS : 0);
let seed = 1;
const rng = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
/** pg_stat_statements means for the two money RPCs, on top of the trip. */
const DOOR_DB_MS = 127;
const PAYER_DB_MS = 200;
const SLOTS = 4;
const MINUTES = 10;

type Mode = 'current' | 'previous';

interface Bust {
  userId: string;
  at: number;
  hand: number;
  place?: number;
  recordedAt?: number;
}
interface Event {
  id: string;
  busts: Bust[];
  byUser: Map<string, Bust>;
  survivors: number;
  manager?: any;
}

const report = (label: string, json: string) => process.stdout.write(`${label} ${json}\n`);
const pad = (n: number) => String(n).padStart(12, '0');
const uuid = (event: number, n: number) => `00000000-0000-4000-8${event}00-${pad(n)}`;

function makeEvent(index: number, perMinute: number, survivors = 200): Event {
  const busts: Bust[] = [];
  if (perMinute > 0) {
    const gap = 60_000 / perMinute;
    for (let n = 0; n * gap < MINUTES * 60_000; n++) {
      // Two busts in one hand every fifth bust: simultaneous eliminations.
      const hand = 1000 + n - Math.floor(n / 5);
      busts.push({ userId: uuid(index, n + 1), at: Math.round(n * gap), hand });
    }
  }
  return {
    id: `00000000-0000-4000-8000-0000000000${String(index).padStart(2, '0')}`,
    busts,
    byUser: new Map(busts.map((b) => [b.userId, b])),
    survivors,
  };
}

interface Request {
  table: string;
  columns: string | null;
  head: boolean;
  filters: Array<[string, string, unknown]>;
}
const filterValue = (r: Request, column: string, op = 'eq'): unknown =>
  r.filters.find(([c, o]) => c === column && o === op)?.[2];

function transport(events: Event[], t0: number) {
  const byId = new Map(events.map((e) => [e.id, e]));
  const now = () => Date.now() - t0;
  const pending = (e: Event) => e.busts.filter((b) => b.at <= now() && b.place === undefined);
  const answer = (r: Request): { data?: unknown; count?: number | null; error?: unknown } => {
    if (r.table.startsWith('rpc:')) {
      const args = (r.filters[0]?.[2] ?? {}) as Record<string, any>;
      const e = byId.get(String(args.p_tournament_id ?? ''))!;
      if (r.table === 'rpc:fn_claim_tournament_bounty_elimination') {
        const b = e.byUser.get(String(args.p_eliminated_user_id))!;
        if (b.place !== undefined) return { data: { ok: true, already: true, mode: 'pko' } };
        b.place = Number(args.p_position);
        b.recordedAt = now();
        return { data: { ok: true, claimed: true, mode: 'pko' } };
      }
      if (r.table === 'rpc:fn_collect_bounty_obligation') {
        const userId = String(args.p_obligation_id).slice(4);
        const knocker = `k-${userId}`;
        return {
          data: {
            ok: true,
            mode: 'pko',
            head: 4,
            paid_cash: 2,
            added_to_head: 2,
            shares: [{ user_id: knocker, cash: 2, to_head: 2 }],
            marker_verified: true,
            obligation_id: args.p_obligation_id,
          },
        };
      }
      if (r.table === 'rpc:fn_open_tournament_rebuy_decisions')
        return {
          data: (args.p_user_ids as string[]).map((user_id) => ({ user_id, decision_open: false })),
        };
      throw new Error(`Unexpected rpc ${r.table}`);
    }
    const e = byId.get(String(filterValue(r, 'tournament_id') ?? filterValue(r, 'id') ?? ''));
    if (!e) throw new Error(`Unrouted request ${r.table} ${r.columns}`);
    const userId = filterValue(r, 'user_id') ?? filterValue(r, 'eliminated_user_id');
    if (r.table === 'tournaments')
      return {
        data: {
          format_contract: 'mtt-v1',
          is_pko: true,
          is_bounty: true,
          is_mystery_bounty: false,
          payout_structure: null,
          prize_pool: 0,
          buy_in_amount: 1,
          variant: 'freezeout',
          tournament_type: 'MTT',
        },
      };
    if (r.table === 'tournament_players') {
      const open = pending(e);
      if (r.columns === 'id, user_id, chips')
        return { data: open.map((b) => ({ id: b.userId, user_id: b.userId, chips: 0 })) };
      if (r.columns === 'id, position')
        return {
          data: e.busts
            .filter((b) => b.place !== undefined)
            .map((b) => ({ id: b.userId, position: b.place })),
        };
      if (r.head) return { count: e.survivors + open.length };
      if (r.columns === 'status') {
        const b = e.byUser.get(String(userId))!;
        return { data: { status: b.place === undefined ? 'playing' : 'eliminated' } };
      }
      if (r.columns === 'user_id, username')
        return { data: [{ user_id: String(userId ?? ''), username: 'p' }] };
      if (r.columns === 'username, position, prize') {
        const b = e.byUser.get(String(userId))!;
        return { data: { username: 'p', position: b.place, prize: 0 } };
      }
    }
    if (r.table === 'tournament_knockout_candidates') {
      const ids = (filterValue(r, 'eliminated_user_id', 'in') as string[]) ?? [];
      const rows = ids
        .map((id) => e.byUser.get(id))
        .filter((b): b is Bust => !!b)
        .map((b) => ({
          id: `c-${b.userId}`,
          eliminated_user_id: b.userId,
          hand_number: b.hand,
          stack_before: 1500,
          state: 'pending',
        }));
      return { data: rows, count: rows.length };
    }
    if (r.table === 'tournament_bounty_obligations') {
      const b = e.byUser.get(String(userId))!;
      const row = {
        id: `ob-${b.userId}`,
        table_id: 'table-1',
        hand_id: `hand-${b.hand}`,
        hand_number: b.hand,
        mode: 'pko',
        state: r.columns === 'id,state,mode,head_amount' ? 'settled' : 'pending',
        head_amount: 4,
        knocker_user_id: `k-${b.userId}`,
        claimants: [{ user_id: `k-${b.userId}`, weight: 1 }],
        position: b.place,
        prize: 0,
        bubble_refund: 0,
      };
      return { data: row };
    }
    if (r.table === 'wallet_transactions' || r.table === 'tournament_participant_funding_receipts')
      return { count: 0 };
    throw new Error(`Unexpected request ${r.table} ${r.columns}`);
  };
  const reply = (r: Request, extraMs = 0, kind: keyof typeof ORIGIN_MS = 'read') => {
    let response: unknown;
    try {
      response = { data: null, count: null, error: null, ...answer(r) };
    } catch (error) {
      return Promise.reject(error);
    }
    const ms =
      kind === 'read' ? tripLatency('read') : EMPIRICAL ? tripLatency(kind) : tripLatency('read') + extraMs;
    return new Promise((resolve) => setTimeout(() => resolve(response), ms));
  };
  fixture.from.mockImplementation((table: string) => {
    if (table === 'tournament_manager_wakes') return emptyManagerWakeInbox();
    const request: Request = { table, columns: null, head: false, filters: [] };
    const filter = (column: string, op: string, value: unknown) => {
      request.filters.push([column, op, value]);
      return query;
    };
    const query: any = {
      select: (columns: string, options?: { head?: boolean }) => {
        request.columns = columns;
        request.head = options?.head === true;
        return query;
      },
      eq: (c: string, v: unknown) => filter(c, 'eq', v),
      neq: (c: string, v: unknown) => filter(c, 'neq', v),
      lte: (c: string, v: unknown) => filter(c, 'lte', v),
      in: (c: string, v: unknown) => filter(c, 'in', v),
      is: (c: string, v: unknown) => filter(c, 'is', v),
      not: (c: string, op: string, v: unknown) => filter(c, `not.${op}`, v),
      gt: () => query,
      gte: () => query,
      order: () => query,
      limit: () => query,
      maybeSingle: () => query,
      then: (resolve: any, reject: any) => reply(request).then(resolve, reject),
    };
    return query;
  });
  fixture.rpc.mockImplementation((fn: string, args: unknown) => {
    const extra =
      fn === 'fn_claim_tournament_bounty_elimination'
        ? DOOR_DB_MS
        : fn === 'fn_collect_bounty_obligation'
          ? PAYER_DB_MS
          : 0;
    const kind =
      fn === 'fn_claim_tournament_bounty_elimination'
        ? 'door'
        : fn === 'fn_collect_bounty_obligation'
          ? 'payer'
          : 'read';
    return reply(
      { table: `rpc:${fn}`, columns: null, head: false, filters: [['args', 'eq', args]] },
      extra,
      kind
    );
  });
}

const trip = (n = 1) =>
  new Promise<void>((resolve) =>
    setTimeout(resolve, Array.from({ length: n }, () => tripLatency('read')).reduce((a, b) => a + b, 0))
  );

function manager(event: Event, scheduler: any, mode: Mode) {
  const m = Object.create(TournamentManagerEliminations.prototype) as any;
  Object.assign(m, {
    pendingManagerWakes: new Map(),
    pendingManagerWakeGenerations: new Map(),
    running: true,
    isProcessingEliminations: false,
    tournamentId: event.id,
    tournamentCache: {
      variant: 'freezeout',
      tournament_type: 'MTT',
      is_rebuy: false,
      is_reentry: false,
      is_pko: true,
      is_bounty: true,
      prize_pool_finalized: true,
    },
    prizePoolFinalized: true,
    finalFieldSizeCache: 496,
    tournamentEntryRepricePending: false,
    eliminationSweepCursor: new TournamentSweepWorkCursor(),
    bustRefusalStreak: new Map(),
    bountyEvidenceDeferred: new Set(),
    tableEngines: new Map(),
    mysteryBountyStage: null,
    placeLadderUnitCents: () => 1,
    eliminationWorkBudgetExpired: (TournamentManagerBase.prototype as any)
      .eliminationWorkBudgetExpired,
    resumeCommittedTerminalCleanup: vi.fn(async () => false),
    refreshChipCapInputs: vi.fn(() => trip()),
    recoverPendingBountyObligations: vi.fn(async () => {
      await trip();
      return true;
    }),
    checkDynamicTableExpansion: vi.fn(async () => {
      await trip();
      return true;
    }),
    maybeActivateMysteryBounty: vi.fn(async () => undefined),
    checkFinalTableDeal: vi.fn(async () => {
      await trip();
      return true;
    }),
    checkTableBalance: vi.fn(() => trip()),
    finishTournament: vi.fn(),
    requestSeatHeads: vi.fn(),
    requestEliminationSweep: vi.fn(() => scheduler.wake(event.id)),
    requestUrgentEliminationSweepAfter: vi.fn((ms: number) =>
      scheduler.wakeUrgentAfter(event.id, ms)
    ),
    // The persisted evidence read: two trips (its own law), four before.
    loadPersistedBountyEvidence: vi.fn(async (userId: string) => {
      await trip(mode === 'current' ? 2 : 4);
      const b = event.byUser.get(userId)!;
      return {
        ready: true,
        tableId: 'table-1',
        handId: `hand-${b.hand}`,
        handNumber: b.hand,
        seatJoinedAt: '2026-11-14T07:00:00.000Z',
        eliminatedSeat: 1,
        eliminatedName: 'p',
        attribution: {
          basis: 'pot_award',
          knockerUserId: `k-${userId}`,
          claimants: [{ userId: `k-${userId}`, weight: 1 }],
        },
      };
    }),
    // A Realtime REST broadcast is one more trip.
    broadcast: vi.fn(async () => {
      await trip();
      return true;
    }),
  });
  if (mode === 'previous') {
    // The previous code: no prefetch and every broadcast in front of the next door.
    m.prefetchBustEvidence = () => undefined;
    m.openBustPresentation = () => undefined;
  }
  m.eliminationSweepCursor.advanceTo(1);
  event.manager = m;
  return m;
}

async function simulate(
  rates: number[],
  mode: Mode,
  tripMs = 200,
  stallP = 0,
  empiricalRttMs: number | null = null
) {
  TRIP_MS = tripMs;
  STALL_P = stallP;
  EMPIRICAL = empiricalRttMs !== null;
  RTT_MS = empiricalRttMs ?? 0;
  seed = 1;
  const scheduler = new TournamentEliminationScheduler({
    maxConcurrent: SLOTS,
    sweepWarnMs: 0,
    startTimers: false,
  });
  const events = rates.map((rate, i) => makeEvent(i + 1, rate));
  const t0 = Date.now();
  transport(events, t0);
  try {
    for (const event of events) {
      const m = manager(event, scheduler, mode);
      scheduler.register({ tournamentId: event.id, run: (signal: AbortSignal) => m.runEliminationSweep(signal) });
      // A committed bust wakes its manager, as the hand commit does.
      for (const bust of event.busts) setTimeout(() => scheduler.wake(event.id), bust.at);
    }
    await vi.advanceTimersByTimeAsync(MINUTES * 60_000);
  } finally {
    // Stop every manager and let in-flight work end before the next run
    // installs its own transport (its user ids are the same).
    for (const event of events) if (event.manager) event.manager.running = false;
    scheduler.stop();
  }
  const results = events.map((event) => {
    const arrived = event.busts.length;
    const recorded = event.busts.filter((b) => b.place !== undefined);
    const waits = recorded.map((b) => b.recordedAt! - b.at).sort((a, b) => a - b);
    // Steady-state rate: busts recorded after the first minute, per minute.
    const steady = recorded.filter((b) => b.recordedAt! >= 60_000).length / (MINUTES - 1);
    // Busts that had arrived but were not yet recorded, at a given moment.
    const backlogAt = (ms: number) =>
      event.busts.filter((b) => b.at <= ms && (b.recordedAt === undefined || b.recordedAt > ms))
        .length;
    const maxWaitS = waits.length ? waits[waits.length - 1] / 1000 : null;
    return {
      arrivedPerMin: arrived / MINUTES,
      recordedPerMin: recorded.length / MINUTES,
      steadyRecordedPerMin: steady,
      backlogAtEnd: arrived - recorded.length,
      backlogAt5Min: backlogAt(5 * 60_000),
      backlogAt10Min: backlogAt(10 * 60_000 - 1),
      maxWaitS,
      medianWaitS: waits.length ? waits[Math.floor(waits.length / 2)] / 1000 : null,
      places: recorded.map((b) => b.place!),
      handOrderKept: recorded
        .slice()
        .sort((a, b) => a.recordedAt! - b.recordedAt!)
        .every((b, i, all) => i === 0 || all[i - 1].hand <= b.hand),
    };
  });
  await vi.advanceTimersByTimeAsync(120_000);
  return results;
}

describe('a PKO bust waits only on its money', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixture.frozen = false;
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('the previous code cannot keep up with the 34 a minute b6d94533 produced', async () => {
    const [hot] = await simulate([34, 10, 10, 10, 0, 0], 'previous');
    const [ceiling] = await simulate([90, 10, 10, 10, 0, 0], 'previous');
    report('[previous ceiling]', JSON.stringify({ ...ceiling, places: undefined }));
    report('[previous] hot event', JSON.stringify({ ...hot, places: undefined }));
    expect(hot.recordedPerMin).toBeLessThan(34);
    expect(hot.backlogAtEnd).toBeGreaterThan(20);
  }, 120_000);

  it.each([200, 170])(
    'flat %i ms trips: a saturated PKO records 40 a minute or more beside busy peers',
    async (tripMs) => {
      // Arrivals well above any ceiling: what is recorded IS the ceiling.
      const [hot, ...peers] = await simulate([90, 10, 10, 10, 0, 0], 'current', tripMs);
      report(`[ceiling ${tripMs}ms] hot`, JSON.stringify({ ...hot, places: undefined }));
      expect(hot.steadyRecordedPerMin).toBeGreaterThanOrEqual(40);
      expect(hot.handOrderKept).toBe(true);
      expect(new Set(hot.places).size).toBe(hot.places.length);
      for (const peer of peers.slice(0, 3)) {
        // A saturated event never starves the others of their slots.
        expect(peer.backlogAtEnd).toBeLessThanOrEqual(3);
        expect(peer.handOrderKept).toBe(true);
      }
      expect(fixture.reportError).not.toHaveBeenCalled();
    },
    120_000
  );

  it('under the measured server latency the engine path is at least 1.6x the previous code', async () => {
    const [prev] = await simulate([90, 10, 10, 10, 0, 0], 'previous', 200, 0, 20);
    const [cur, ...peers] = await simulate([90, 10, 10, 10, 0, 0], 'current', 200, 0, 20);
    report('[empirical previous]', JSON.stringify({ ...prev, places: undefined }));
    report('[empirical current]', JSON.stringify({ ...cur, places: undefined }));
    expect(cur.steadyRecordedPerMin).toBeGreaterThanOrEqual(1.6 * prev.steadyRecordedPerMin);
    expect(cur.handOrderKept).toBe(true);
    expect(new Set(cur.places).size).toBe(cur.places.length);
    for (const peer of peers.slice(0, 3)) expect(peer.handOrderKept).toBe(true);
    // At this latency preparation outruns the 5 s budget and says so, by
    // design (TheBatchTheSweepPreparedIsTheBatchItRecords); nothing else.
    const codes = new Set(fixture.reportError.mock.calls.map((call) => String(call[1])));
    codes.delete('Tournament.bust_batch_recorded_past_budget');
    expect([...codes]).toEqual([]);
  }, 240_000);

  it('keeps up with a 40-a-minute PKO beside busy peers: no backlog builds', async () => {
    const [hot, ...peers] = await simulate([40, 10, 10, 10, 0, 0], 'current');
    report('[current 40/min] hot', JSON.stringify({ ...hot, places: undefined }));
    // Kept up: the backlog does not grow between minute 5 and minute 10, and
    // nobody waits anywhere near the incident's median 440 s.
    expect(hot.backlogAt10Min).toBeLessThanOrEqual(hot.backlogAt5Min + 3);
    expect(hot.backlogAt10Min).toBeLessThanOrEqual(15);
    expect(hot.maxWaitS!).toBeLessThan(45);
    expect(hot.handOrderKept).toBe(true);
    for (const peer of peers.slice(0, 3)) expect(peer.backlogAtEnd).toBeLessThanOrEqual(3);
    expect(fixture.reportError).not.toHaveBeenCalled();
  }, 120_000);

  it('four PKOs busting at 34 a minute on four slots all keep up', async () => {
    const results = await simulate([34, 34, 34, 34, 0, 0], 'current');
    for (const [i, r] of results.slice(0, 4).entries()) {
      report(`[current x4] event ${i + 1}`, JSON.stringify({ ...r, places: undefined }));
      expect(r.backlogAt10Min).toBeLessThanOrEqual(r.backlogAt5Min + 3);
      expect(r.maxWaitS!).toBeLessThan(45);
      expect(r.handOrderKept).toBe(true);
    }
    expect(fixture.reportError).not.toHaveBeenCalled();
  }, 120_000);
});
