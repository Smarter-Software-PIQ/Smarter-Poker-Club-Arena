/**
 * Behavioral regression proof for the `cash / cash_bust` hand-gap tail
 * (live serving 26b45e8d: 3.61% over budget, max_p50 +136 ms, max_p95 +1,037 ms).
 *
 * Proves the four live root causes stay permanently closed:
 *   1. A busted seat already released during settlement (`busted_stop_loss` /
 *      `busted_unfunded`) never triggers a phantom 5-second `rebuy_pause`
 *      even after `horseRebuys.delete(userId)` clears its rebuy counter.
 *   2. `waitForRebuyDecisions` snap-continues immediately when a busted seat
 *      has already left the table (`left_at IS NOT NULL`, absent from a clean
 *      `table_seats` query), while still failing OPEN on a DB error.
 *   3. `waitForRebuyDecisions` never overshoots its `totalMs` deadline when a
 *      slow database poll runs past the deadline.
 *   4. New-player time-bank reads (`fetchTimeBankExtras` +
 *      `readAutoTimeBankPreferences`) ride under an active between-hand rest via
 *      `prepareTimeBankReads` instead of adding a post-rest round trip inside
 *      `dealHand`, and do no speculative DB work when no rest is active.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const { atomicCashout, readAutoTimeBankPreferences } = vi.hoisted(() => ({
  atomicCashout: vi.fn(async () => ({ cashed_out: true })),
  readAutoTimeBankPreferences: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, true]))),
}));

vi.mock('../services/supabase/seats.js', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return {
    ...actual,
    atomicCashout,
  };
});
vi.mock('../services/supabase/timeBankPreferences.js', () => ({
  readAutoTimeBankPreferences,
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn(), reportWarning: vi.fn() }));

import { supabase } from '../services/supabase/client.js';
import { ServerTableEngine } from './ServerTableEngine.js';

const TABLE = '20000000-0000-4000-8000-00000000c0b1';
const engines: any[] = [];

function fromStub(
  rowsByTable: Record<
    string,
    { data: unknown; error: unknown } | (() => Promise<{ data: unknown; error: unknown }>)
  >
) {
  return (table: string) => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      is: () => chain,
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
        const spec = rowsByTable[table] ?? { data: [], error: null };
        const p = typeof spec === 'function' ? spec() : Promise.resolve(spec);
        return p.then(resolve, reject);
      },
    };
    return chain;
  };
}

function makeCashEngine() {
  const engine = new ServerTableEngine(TABLE) as any;
  engines.push(engine);
  engine.running = true;
  engine.isCurrentEngine = () => true;
  engine.tableInfo = {
    id: TABLE,
    club_id: 'club-1',
    game_variant: 'nlh',
    game_type: 'cash',
    tournament_id: null,
    small_blind: 1,
    big_blind: 2,
    min_buy_in: 40,
    max_buy_in: 200,
    max_players: 6,
  };
  engine.isTournamentTable = () => false;
  engine.hub = { emitEvent: vi.fn() };
  engine.broadcastCurrentState = vi.fn();
  return engine;
}

beforeEach(() => {
  atomicCashout.mockReset().mockResolvedValue({ cashed_out: true });
  readAutoTimeBankPreferences
    .mockReset()
    .mockImplementation(async (ids: string[]) => new Map(ids.map((id) => [id, true])));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const engine of engines.splice(0)) {
    engine.running = false;
    (ServerTableEngine as any).releaseCurrentEngine(engine.tableId, engine);
    engine.preciseTimer?.dispose?.();
    engine.engineTelemetry?.dispose?.();
  }
});

describe('cash_bust hand-gap hardening', () => {
  it('never pauses for a busted seat already released during settlement (even after horseRebuys.delete)', async () => {
    const engine = makeCashEngine();
    const horse = {
      user_id: '2958f800-0cca-43a8-8486-08e524434199',
      username: 'superkid',
      seat_number: 3,
      stack: 0,
      is_horse: true,
      occupancy_id: 'occ-superkid-1',
    };
    engine.seatedPlayers = [horse];
    engine.horseRebuys.set(horse.user_id, 2);

    // Settlement step 5 releases the horse on stop-loss and clears horseRebuys.
    const released = await engine.releaseBustedSeat(horse, 'busted_stop_loss');
    expect(released).toBe(true);
    engine.horseRebuys.delete(horse.user_id);

    // Post-hold rebuy eligibility check must recognize the seat is already gone.
    await expect(engine.anyBustedPlayerCanAffordARebuy([horse])).resolves.toBe(false);
  });

  it('waitForRebuyDecisions snap-continues immediately when a busted seat already left (left_at IS NOT NULL)', async () => {
    vi.useFakeTimers();
    const engine = makeCashEngine();
    vi.spyOn(supabase, 'from').mockImplementation(
      fromStub({
        table_seats: { data: [], error: null },
        table_pending_addons: { data: [], error: null },
      }) as never
    );

    let settled = false;
    const wait = engine.waitForRebuyDecisions(['departed-player'], 5_000).then(() => {
      settled = true;
    });
    // First microtask poll observes the empty chair and returns without waiting on any timer.
    await vi.advanceTimersByTimeAsync(0);
    await wait;
    expect(settled).toBe(true);
  });

  it('waitForRebuyDecisions still fails open on a database read error', async () => {
    vi.useFakeTimers();
    const engine = makeCashEngine();
    vi.spyOn(supabase, 'from').mockImplementation(
      fromStub({
        table_seats: { data: null, error: { message: 'connection reset' } },
        table_pending_addons: { data: null, error: { message: 'connection reset' } },
      }) as never
    );

    let settled = false;
    const wait = engine.waitForRebuyDecisions(['hero'], 5_000).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await wait;
    expect(settled).toBe(true);
  });

  it('waitForRebuyDecisions never overshoots its deadline when a DB poll hangs past totalMs', async () => {
    vi.useFakeTimers();
    const engine = makeCashEngine();
    vi.spyOn(supabase, 'from').mockImplementation(
      fromStub({
        table_seats: () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve({ data: [{ user_id: 'hero', stack: 0 }], error: null }),
              10_000
            )
          ),
        table_pending_addons: { data: [], error: null },
      }) as never
    );

    let settled = false;
    const wait = engine.waitForRebuyDecisions(['hero'], 5_000).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(settled).toBe(false);
    // Exits on the exact 5,000 ms deadline even while the 10,000 ms DB poll is still pending.
    await vi.advanceTimersByTimeAsync(1);
    await wait;
    expect(settled).toBe(true);
  });

  it('prepares new-player time-bank reads under an active rest and skips when no rest is armed', async () => {
    vi.useFakeTimers();
    const engine = makeCashEngine();
    const seats = [
      {
        seat_number: 1,
        user_id: 'player-new-1',
        username: 'NewArrival',
        stack: 100,
        is_horse: true,
        occupancy_id: 'occ-new-1',
      },
    ];
    const fetchExtras = vi.fn(async (ids: string[]) => {
      await new Promise((r) => setTimeout(r, 150));
      return new Map(ids.map((id) => [id, { extraSeconds: 30, unlimited: false }]));
    });
    engine.fetchTimeBankExtras = fetchExtras;

    // With no active rest armed, no speculative DB read is issued.
    engine.prepareTimeBankReads(seats);
    expect(fetchExtras).not.toHaveBeenCalled();
    expect(readAutoTimeBankPreferences).not.toHaveBeenCalled();

    // Arm the between-hand rest and start preparation under it.
    engine.armNextHandRest(1_500);
    engine.prepareTimeBankReads(seats);
    expect(fetchExtras).toHaveBeenCalledTimes(1);
    expect(readAutoTimeBankPreferences).toHaveBeenCalledTimes(1);

    // Rest elapses while the reads settle in parallel.
    await vi.advanceTimersByTimeAsync(1_500);

    // Consuming inside dealHand takes the already-settled promise with zero additional RTT.
    const extrasPromise = engine.takePreparedTimeBankExtras(['player-new-1']);
    const prefsPromise = engine.takePreparedAutoTimeBankPreferences(['player-new-1']);
    expect(extrasPromise).not.toBeNull();
    expect(prefsPromise).not.toBeNull();

    let resolved = false;
    let extras!: Map<string, unknown>;
    let prefs!: Map<string, boolean>;
    const joined = Promise.all([extrasPromise!, prefsPromise!]).then(([e, p]) => {
      extras = e;
      prefs = p;
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    await joined;

    expect(resolved).toBe(true);
    expect(fetchExtras).toHaveBeenCalledTimes(1);
    expect(readAutoTimeBankPreferences).toHaveBeenCalledTimes(1);
    expect(extras.get('player-new-1')).toEqual({ extraSeconds: 30, unlimited: false });
    expect(prefs.get('player-new-1')).toBe(true);

    // Wiring proof: prepareTimeBankReads is called before announce_seat_moves and awaitNextHandRest.
    const dealingSrc = readFileSync(
      new URL('./ServerTableEngineDealing.ts', import.meta.url),
      'utf8'
    );
    const prepIdx = dealingSrc.indexOf('this.prepareTimeBankReads(activePlayers);');
    const noticeIdx = dealingSrc.indexOf("'announce_seat_moves',");
    const restIdx = dealingSrc.indexOf('await this.awaitNextHandRest();');
    expect(prepIdx).toBeGreaterThan(-1);
    expect(prepIdx).toBeLessThan(noticeIdx);
    expect(noticeIdx).toBeLessThan(restIdx);
  });

  it('excludes already-released seats from offerCashBustWindows and waitForRebuyDecisions', async () => {
    const engine = makeCashEngine();
    const human = {
      user_id: 'human-released-1',
      username: 'ReleasedHuman',
      seat_number: 2,
      stack: 0,
      is_horse: false,
      occupancy_id: 'occ-human-rel-1',
    };
    engine.seatedPlayers = [human];
    engine.hub = { emitEvent: vi.fn(), sendToUser: vi.fn() };
    engine.armBustRebuyExpiry = vi.fn();

    expect(await engine.releaseBustedSeat(human, 'busted_no_rebuy')).toBe(true);
    expect(await engine.offerCashBustWindows([human])).toBeUndefined();
    expect(engine.hub.sendToUser).not.toHaveBeenCalled();
    expect(engine.armBustRebuyExpiry).not.toHaveBeenCalled();

    const dealingSrc = readFileSync(
      new URL('./ServerTableEngineDealing.ts', import.meta.url),
      'utf8'
    );
    const callIdx = dealingSrc.indexOf('await this.waitForRebuyDecisions(');
    const callEnd = dealingSrc.indexOf('REBUY_PAUSE_MAX_MS', callIdx);
    expect(callIdx).toBeGreaterThan(-1);
    expect(callEnd).toBeGreaterThan(callIdx);
    const callSnippet = dealingSrc.slice(callIdx, callEnd);
    expect(callSnippet).toContain('!this.wasBustedSeatReleasedThisHand(p)');
  });

  it('deduplicates in-flight preparedTimeBankReads across a second dealing pass and clears them on pause/stop/restart', async () => {
    vi.useFakeTimers();
    const engine = makeCashEngine();
    const seats = [
      {
        seat_number: 1,
        user_id: 'player-dedup-1',
        username: 'DedupSeat',
        stack: 100,
        is_horse: true,
        occupancy_id: 'occ-dedup-1',
      },
    ];
    const fetchExtras = vi.fn(async (ids: string[]) => {
      await new Promise((r) => setTimeout(r, 150));
      return new Map(ids.map((id) => [id, { extraSeconds: 30, unlimited: false }]));
    });
    engine.fetchTimeBankExtras = fetchExtras;
    engine.armNextHandRest(1_500);

    // First pass starts both reads; second pass (e.g. after seatBoundaryChangedUnderRest)
    // reuses matching in-flight promises without firing duplicate DB queries.
    engine.prepareTimeBankReads(seats);
    engine.prepareTimeBankReads(seats);
    expect(fetchExtras).toHaveBeenCalledTimes(1);
    expect(readAutoTimeBankPreferences).toHaveBeenCalledTimes(1);

    // discardPreparedHandForPause clears prepared reads when paused.
    engine.maintenancePaused = true;
    expect(engine.discardPreparedHandForPause()).toBe(true);
    expect(engine.takePreparedTimeBankExtras(['player-dedup-1'])).toBeNull();
    expect(engine.takePreparedAutoTimeBankPreferences(['player-dedup-1'])).toBeNull();

    // Re-arm and verify stop() clears prepared reads.
    engine.maintenancePaused = false;
    engine.armNextHandRest(1_500);
    engine.prepareTimeBankReads(seats);
    expect(fetchExtras).toHaveBeenCalledTimes(2);
    await engine.stop();
    expect(engine.takePreparedTimeBankExtras(['player-dedup-1'])).toBeNull();
    expect(engine.takePreparedAutoTimeBankPreferences(['player-dedup-1'])).toBeNull();

    // Re-arm on a fresh engine and verify killForRestart() clears prepared reads.
    const engine2 = makeCashEngine();
    engine2.fetchTimeBankExtras = fetchExtras;
    engine2.armNextHandRest(1_500);
    engine2.prepareTimeBankReads(seats);
    expect(fetchExtras).toHaveBeenCalledTimes(3);
    engine2.killForRestart('audit_test_restart', false);
    expect(engine2.takePreparedTimeBankExtras(['player-dedup-1'])).toBeNull();
    expect(engine2.takePreparedAutoTimeBankPreferences(['player-dedup-1'])).toBeNull();
  });
});
