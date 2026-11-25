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
 *      `readAutoTimeBankPreferences`) ride under the between-hand rest via
 *      `prepareTimeBankReads` instead of adding a post-rest round trip inside
 *      `dealHand`.
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
    const engine = makeCashEngine();
    vi.spyOn(supabase, 'from').mockImplementation(
      fromStub({
        table_seats: { data: [], error: null },
        table_pending_addons: { data: [], error: null },
      }) as never
    );

    const t0 = Date.now();
    await engine.waitForRebuyDecisions(['departed-player'], 2500);
    const elapsed = Date.now() - t0;

    expect(elapsed).toBeLessThan(400);
  });

  it('waitForRebuyDecisions still fails open on a database read error', async () => {
    const engine = makeCashEngine();
    vi.spyOn(supabase, 'from').mockImplementation(
      fromStub({
        table_seats: { data: null, error: { message: 'connection reset' } },
        table_pending_addons: { data: null, error: { message: 'connection reset' } },
      }) as never
    );

    const t0 = Date.now();
    await engine.waitForRebuyDecisions(['hero'], 300);
    const elapsed = Date.now() - t0;

    expect(elapsed).toBeGreaterThanOrEqual(250);
  });

  it('waitForRebuyDecisions never overshoots its deadline when a DB poll hangs past totalMs', async () => {
    const engine = makeCashEngine();
    vi.spyOn(supabase, 'from').mockImplementation(
      fromStub({
        table_seats: () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ data: [{ user_id: 'hero', stack: 0 }], error: null }), 900)
          ),
        table_pending_addons: { data: [], error: null },
      }) as never
    );

    const t0 = Date.now();
    await engine.waitForRebuyDecisions(['hero'], 250);
    const elapsed = Date.now() - t0;

    // Must stop near the 250 ms deadline, never waiting for the 900 ms poll.
    expect(elapsed).toBeGreaterThanOrEqual(200);
    expect(elapsed).toBeLessThan(450);
  });

  it('prepares new-player time-bank reads under the rest so dealHand pays zero post-rest RTT', async () => {
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
      await new Promise((r) => setTimeout(r, 80));
      return new Map(ids.map((id) => [id, { extraSeconds: 30, unlimited: false }]));
    });
    engine.fetchTimeBankExtras = fetchExtras;

    // Start preparation under the rest.
    engine.prepareTimeBankReads(seats);
    expect(fetchExtras).toHaveBeenCalledTimes(1);
    expect(readAutoTimeBankPreferences).toHaveBeenCalledTimes(1);

    // Simulate the rest elapsing while the reads complete in parallel.
    await new Promise((r) => setTimeout(r, 120));

    // Consuming inside dealHand takes the settled result immediately with no second read.
    const t0 = Date.now();
    const [extras, prefs] = await Promise.all([
      engine.takePreparedTimeBankExtras(['player-new-1']),
      engine.takePreparedAutoTimeBankPreferences(['player-new-1']),
    ]);
    const takeMs = Date.now() - t0;

    expect(takeMs).toBeLessThan(30);
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
});
