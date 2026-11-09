/**
 * THE CASH PARTICIPANT MANIFEST RIDES THE REST (Dan 2026-11-05: "AS SOON AS
 * ONE CASH GAME HAND FINISHES AT A TABLE, THE NEXT HAND NEEDS TO START WITHIN
 * 2 SECONDS").
 *
 * Production 2026-11-09 00:56-01:04 UTC, 174 cash transitions on 25 tables:
 * fn_cash_capture_hand_manifest committed a median 151 ms after the 1,800 ms
 * rest ended and the hand started a median 132 ms after that. The round trip
 * was sent only after the rest. It is now sent under the rest, and the deal
 * uses its answer only for the identical roster, stacks, number and lease.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    rpc,
    from: () => {
      throw new Error('Unexpected database write');
    },
  },
  maintenanceSupabase: {},
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));
import { ServerTableEngine } from './ServerTableEngine.js';

const engines: any[] = [];
const table = '20000000-0000-4000-8000-000000000009';
const generation = '70000000-0000-4000-8000-000000000009';
const manifest = '60000000-0000-4000-8000-000000000009';
const SRC = readFileSync(new URL('./ServerTableEngineDealing.ts', import.meta.url), 'utf8');

beforeEach(() => rpc.mockReset());
afterEach(() => {
  for (const engine of engines.splice(0)) {
    engine.running = false;
    (ServerTableEngine as any).releaseCurrentEngine(engine.tableId, engine);
    engine.preciseTimer.dispose();
    engine.engineTelemetry.dispose();
  }
});

function fixture() {
  const engine = new ServerTableEngine(table) as any;
  engines.push(engine);
  expect(engine.claimProcessOwnership()).toBe(true);
  engine.running = true;
  engine.tableInfo = {
    id: table,
    club_id: 'club',
    game_variant: 'nlh',
    game_type: 'cash',
    tournament_id: null,
    max_players: 6,
    small_blind: 1,
    big_blind: 2,
    ante: 0,
    ante_enabled: false,
  };
  const seats = [1, 2, 3].map((seat) => ({
    seat_number: seat,
    user_id: `30000000-0000-4000-8000-00000000000${seat}`,
    username: `Player ${seat}`,
    stack: 100,
    is_horse: seat > 1,
    seat_id: `40000000-0000-4000-8000-00000000000${seat}`,
    occupancy_id: `50000000-0000-4000-8000-00000000000${seat}`,
    seat_joined_at: '2026-09-17T22:00:00.123456+00:00',
  }));
  engine.seatedPlayers = seats;
  engine.preparedHandNumberValue = { n: 1000020, at: Date.now(), epoch: engine.f06AllocationEpoch };
  engine.allocateGlobalHandNumber = vi.fn().mockResolvedValue(1000021);
  engine.getEngineLeaseAuthority = () => ({ verified: true, generation, scope: 'cash' });
  engine.hasCurrentEngineLeaseAuthority = vi.fn(() => true);
  engine.bombPotSchedPersistedJson = 'null';
  engine.eventShadowEnabled = false;
  engine.hub = { emitEvent: vi.fn() };
  engine.refreshRakeConfig = async () => {};
  const prepared = new Error('controller prepared; stop before hand start');
  engine.fetchTimeBankExtras = vi.fn(async () => {
    throw prepared;
  });
  return { engine, seats, prepared };
}

describe('the cash participant manifest is captured under the rest', () => {
  it('is sent from the dealing loop before the seat-move notice and the rest end', () => {
    const prepare = SRC.indexOf('this.prepareCashHandManifest(activePlayers);');
    const notice = SRC.indexOf("'announce_seat_moves',");
    const rest = SRC.indexOf('await this.awaitNextHandRest();');
    expect(prepare).toBeGreaterThan(-1);
    expect(prepare).toBeLessThan(notice);
    expect(notice).toBeLessThan(rest);
    // The deal consumes it; there is no second unconditional capture.
    expect(SRC.match(/await this\.takePreparedCashHandManifest\(/g)).toHaveLength(1);
  });

  it('a prepared manifest that has answered costs the deal no round trip', async () => {
    const { engine, seats, prepared } = fixture();
    let answer!: (v: unknown) => void;
    rpc.mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)) // still in flight under the rest
    );
    engine.prepareCashHandManifest(seats);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_hand_number: 1000020,
      p_lease_generation: generation,
    });
    answer({ data: { version: 1, manifest_id: manifest }, error: null });
    await expect(engine.dealHand(seats)).rejects.toBe(prepared);
    expect(rpc).toHaveBeenCalledTimes(1);
    for (const seat of seats)
      expect(engine.currentHandSeatGenerations.get(seat.user_id)).toMatchObject({
        funding_manifest_id: manifest,
        occupancy_id: seat.occupancy_id,
        funding_stack_before: 100,
      });
  });

  it('a roster that changed after the request deals on a fresh number with its own manifest', async () => {
    const { engine, seats, prepared } = fixture();
    rpc.mockResolvedValue({ data: { version: 1, manifest_id: manifest }, error: null });
    engine.prepareCashHandManifest(seats);
    const changed = seats.map((s, i) => (i === 0 ? { ...s, stack: 150 } : s));
    engine.seatedPlayers = changed;
    await expect(engine.dealHand(changed)).rejects.toBe(prepared);
    // The number whose request no longer matches is never dealt.
    expect(rpc.mock.calls.map(([, r]) => r.p_hand_number)).toEqual([1000020, 1000021]);
    expect(rpc.mock.calls[1][1].p_participants[0].stack_before).toBe(150);
    expect(engine.allocateGlobalHandNumber).toHaveBeenCalledTimes(1);
  });

  it('a prepared request that failed is asked again inline, exactly as before', async () => {
    const { engine, seats, prepared } = fixture();
    rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'response lost' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'response lost' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'response lost' } })
      .mockResolvedValue({ data: { version: 1, manifest_id: manifest }, error: null });
    engine.prepareCashHandManifest(seats);
    await expect(engine.dealHand(seats)).rejects.toBe(prepared);
    expect(new Set(rpc.mock.calls.map(([, r]) => r.p_hand_number))).toEqual(new Set([1000020]));
    expect(engine.currentHandSeatGenerations.get(seats[0].user_id)).toMatchObject({
      funding_manifest_id: manifest,
    });
  });

  it('a tournament table prepares nothing', () => {
    const { engine, seats } = fixture();
    engine.tableInfo.tournament_id = '80000000-0000-4000-8000-000000000009';
    engine.prepareCashHandManifest(seats);
    expect(rpc).not.toHaveBeenCalled();
  });
});
