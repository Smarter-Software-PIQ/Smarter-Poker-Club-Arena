import { emptyManagerWakeInbox } from './__fixtures__/emptyManagerWakeInbox.js';
/**
 * A BUST REACHES ITS BOUNTY IN FEWER TRIPS (2026-11-05)
 *
 * Dan, watching the Afternoon Free Buy PKO: "PKO bounties must be properly
 * credited ... the second the hand is over." Production read a bust 5 s from
 * the accepted hand to its bounty obligation, and the elimination sweep's
 * mean wall time was 2.0 s over 47,015 sweeps (engine /metrics). Every link of
 * that path is an awaited PostgREST round trip, so the fixed transport below
 * answers each request exactly TRIP_MS after it is sent and fake time elapsed
 * IS the number of sequential trips.
 *
 * The law: a PKO knockout that the door accepts is broadcast to the table
 * after at most SIX sequential trips inside eliminatePlayer (it was nine):
 *   1. replay guard + pricing row, together
 *   2. the persisted knockout evidence (stubbed to one trip here)
 *   3. the atomic knockout door
 *   4. the door's exact obligation, read to prove the claim
 *   5. the payer + the display names, together (the payer reuses the proved
 *      obligation instead of reading it a second time)
 *   6. the settled marker the payer must leave
 * Money is moved exactly once, by the same payer, with the same arguments.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), reportError: vi.fn() }));
vi.mock('../services/supabase/client.js', () => ({
  supabase: { from: fixture.from, rpc: fixture.rpc },
  maintenanceSupabase: { from: fixture.from, rpc: fixture.rpc },
}));
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

const { tableStateHub } = await import('../transport/TableStateHub.js');
const { TournamentManagerEliminations } = await import('./TournamentManagerEliminations.js');

const TRIP_MS = 100;
const SIX_TRIPS = 6;
const tournamentId = '00000000-0000-4000-8000-000000000001';
const bustedId = '00000000-0000-4000-8000-000000000003';
const knockerId = '00000000-0000-4000-8000-000000000004';
const tableId = '00000000-0000-4000-8000-0000000000aa';
const handId = '00000000-0000-4000-8000-0000000000bb';
const obligationId = '00000000-0000-4000-8000-0000000000cc';

interface Request {
  table: string;
  columns: string | null;
  filters: Array<[string, string, unknown]>;
  args?: unknown;
  sentAt: number;
}

function transport(answer: (r: Request) => { data?: unknown; error?: unknown; count?: number }) {
  const sent: Request[] = [];
  const reply = (request: Request) => {
    request.sentAt = Date.now();
    sent.push(request);
    const response = { data: null, error: null, count: null, ...answer(request) };
    return new Promise((resolve) => setTimeout(() => resolve(response), TRIP_MS));
  };
  fixture.from.mockImplementation((table: string) => {
    if (table === 'tournament_manager_wakes') return emptyManagerWakeInbox();
    const request: Request = { table, columns: null, filters: [], sentAt: -1 };
    const filter = (c: string, op: string, v: unknown) => {
      request.filters.push([c, op, v]);
      return query;
    };
    const query: any = {
      select: (columns: string) => {
        request.columns = columns;
        return query;
      },
      eq: (c: string, v: unknown) => filter(c, 'eq', v),
      neq: (c: string, v: unknown) => filter(c, 'neq', v),
      in: (c: string, v: unknown) => filter(c, 'in', v),
      order: () => query,
      limit: () => query,
      maybeSingle: () => query,
      then: (resolve: any, reject: any) => reply(request).then(resolve, reject),
    };
    return query;
  });
  fixture.rpc.mockImplementation((fn: string, args: unknown) =>
    reply({ table: `rpc:${fn}`, columns: null, filters: [], args, sentAt: -1 })
  );
  return sent;
}

const doorObligation = {
  id: obligationId,
  table_id: tableId,
  hand_id: handId,
  hand_number: 41,
  mode: 'pko',
  state: 'pending',
  knocker_user_id: knockerId,
  claimants: [{ user_id: knockerId, weight: 1 }],
  position: 7,
  prize: 0,
  bubble_refund: 0,
};

function pkoKnockout() {
  return transport((r) => {
    if (r.table === 'tournament_players' && r.columns === 'status')
      return { data: { status: 'playing' } };
    if (r.table === 'tournaments')
      return {
        data: {
          format_contract: 'mtt-v1',
          is_pko: true,
          is_bounty: false,
          is_mystery_bounty: false,
          payout_structure: null,
          prize_pool: 0,
          buy_in_amount: 0,
          variant: 'freezeout',
          tournament_type: 'MTT',
        },
      };
    if (r.table === 'evidence') return { data: { ok: true } };
    if (r.table === 'rpc:fn_claim_tournament_bounty_elimination')
      return { data: { ok: true, claimed: true, mode: 'pko' } };
    if (r.table === 'tournament_bounty_obligations' && r.columns?.startsWith('id,table_id'))
      return { data: doorObligation };
    if (r.table === 'tournament_bounty_obligations' && r.columns === 'id')
      return { data: { id: obligationId } };
    if (r.table === 'rpc:fn_collect_bounty_obligation')
      return {
        data: {
          ok: true,
          mode: 'pko',
          head: 4.32,
          paid_cash: 2.16,
          added_to_head: 2.16,
          shares: [{ user_id: knockerId, cash: 2.16, to_head: 2.16 }],
          marker_verified: true,
          obligation_id: obligationId,
        },
      };
    if (r.table === 'tournament_bounty_obligations' && r.columns === 'id,state,mode,head_amount')
      return { data: { id: obligationId, state: 'settled', mode: 'pko', head_amount: 4.32 } };
    if (r.table === 'tournament_players' && r.columns === 'user_id, username')
      return {
        data: [
          { user_id: bustedId, username: 'sledge' },
          { user_id: knockerId, username: 'Danimal' },
        ],
      };
    if (r.table === 'tournament_players') return { data: { username: 'sledge' } };
    throw new Error(`Unexpected request: ${r.table} ${r.columns}`);
  });
}

function manager() {
  const broadcasts: Array<{ type: string; payload: any; at: number }> = [];
  const m = Object.create(TournamentManagerEliminations.prototype) as any;
  Object.assign(m, {
    tournamentId,
    running: true,
    tournamentCache: { is_pko: true, is_rebuy: false, is_reentry: false },
    prizePoolFinalized: true,
    finalFieldSizeCache: 236,
    mysteryBountyStage: null,
    bountyEvidenceDeferred: new Set(),
    eliminationMutationAllowed: () => true,
    requestUrgentEliminationSweepAfter: vi.fn(),
    requestEliminationSweep: vi.fn(),
    placeLadderUnitCents: () => 1,
    // The persisted evidence is its own module's law; here it costs one trip.
    loadPersistedBountyEvidence: vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, TRIP_MS));
      fixture.from('evidence');
      return {
        tableId,
        handId,
        handNumber: 41,
        eliminatedSeat: 1,
        eliminatedName: 'sledge',
        seatJoinedAt: '2026-11-06T00:00:00.000Z',
        attribution: {
          basis: 'pot_award',
          knockerUserId: knockerId,
          claimants: [{ userId: knockerId, weight: 1 }],
        },
      };
    }),
    broadcast: vi.fn(async (type: string, payload: any) => {
      broadcasts.push({ type, payload, at: Date.now() });
      return true;
    }),
  });
  return { m, broadcasts };
}

describe('a bust reaches its bounty in fewer trips', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it(`broadcasts an accepted PKO knockout after at most ${SIX_TRIPS} sequential trips`, async () => {
    pkoKnockout();
    const { m, broadcasts } = manager();
    const startedAt = Date.now();
    const run = m.eliminatePlayer(bustedId, 7);
    await vi.runAllTimersAsync();
    expect(await run).toBe(true);
    const knockout = broadcasts.find((b) => b.type === 'bounty_collected');
    expect(knockout).toBeDefined();
    expect(knockout!.at - startedAt).toBeLessThanOrEqual(SIX_TRIPS * TRIP_MS);
    expect(knockout!.payload).toMatchObject({
      knockerUserId: knockerId,
      knockerName: 'Danimal',
      eliminatedName: 'sledge',
      amount: 2.16,
      addedToHead: 2.16,
      tableId,
    });
    const packets: any[] = [];
    const subscriber = {
      id: 'reconnected',
      readyState: 1,
      send: (raw: string) => packets.push(JSON.parse(raw)),
    };
    try {
      tableStateHub.subscribe(tableId, subscriber);
      tableStateHub.subscribe(tableId, subscriber);
      expect(packets.filter((p) => p.payload?.type === 'seat_knockout')).toMatchObject([
        {
          tableId,
          payload: {
            obligationId,
            handId,
            eliminatedSeat: 1,
            eliminatedUserId: bustedId,
            knockerUserId: knockerId,
          },
        },
      ]);
      expect(knockout!.payload.obligationId).toBe(obligationId);
    } finally {
      tableStateHub.unsubscribe(tableId, subscriber);
    }
    expect(fixture.reportError).not.toHaveBeenCalled();
  });

  it('moves the money once, through the same payer, keyed on the proved obligation', async () => {
    const sent = pkoKnockout();
    const { m } = manager();
    const run = m.eliminatePlayer(bustedId, 7);
    await vi.runAllTimersAsync();
    await run;
    const payers = sent.filter((r) => r.table.startsWith('rpc:fn_collect_bounty'));
    expect(payers).toHaveLength(1);
    expect(payers[0]).toMatchObject({
      table: 'rpc:fn_collect_bounty_obligation',
      args: { p_obligation_id: obligationId },
    });
    // The proved obligation is not read a second time before paying.
    expect(
      sent.filter((r) => r.table === 'tournament_bounty_obligations' && r.columns === 'id')
    ).toHaveLength(0);
  });

  it('sends the replay guard and the pricing row in one trip, and the names with the payer', async () => {
    const sent = pkoKnockout();
    const { m } = manager();
    const run = m.eliminatePlayer(bustedId, 7);
    await vi.runAllTimersAsync();
    await run;
    const guard = sent.find((r) => r.table === 'tournament_players' && r.columns === 'status');
    const row = sent.find((r) => r.table === 'tournaments');
    expect(guard!.sentAt).toBe(row!.sentAt);
    const payer = sent.find((r) => r.table === 'rpc:fn_collect_bounty_obligation');
    const names = sent.filter(
      (r) => r.table === 'tournament_players' && r.columns === 'user_id, username'
    );
    expect(names).toHaveLength(1);
    expect(names[0].sentAt).toBe(payer!.sentAt);
  });

  it('still stops at the replay guard without paying when the player is already out', async () => {
    const sent = transport((r) => {
      if (r.table === 'tournament_players' && r.columns === 'status')
        return { data: { status: 'eliminated' } };
      if (r.table === 'tournaments') return { data: { is_pko: true } };
      throw new Error(`Unexpected request: ${r.table}`);
    });
    const { m, broadcasts } = manager();
    const run = m.eliminatePlayer(bustedId, 7);
    await vi.runAllTimersAsync();
    expect(await run).toBe(false);
    expect(sent.some((r) => r.table.startsWith('rpc:'))).toBe(false);
    expect(broadcasts).toHaveLength(0);
  });

  it('falls back to a names read when the prefetch failed, and still broadcasts', async () => {
    let namesAsked = 0;
    const sent = pkoKnockout();
    const answer = fixture.from.getMockImplementation()!;
    fixture.from.mockImplementation((table: string) => {
      const q = answer(table);
      if (table !== 'tournament_players') return q;
      const select = q.select;
      q.select = (columns: string) => {
        if (columns === 'user_id, username' && namesAsked++ === 0) {
          const failing: any = {
            eq: () => failing,
            in: () => failing,
            then: (_resolve: any, reject: any) =>
              new Promise((_, r) => setTimeout(() => r(new Error('names down')), TRIP_MS)).then(
                undefined,
                reject
              ),
          };
          return failing;
        }
        return select(columns);
      };
      return q;
    });
    const { m, broadcasts } = manager();
    const run = m.eliminatePlayer(bustedId, 7);
    await vi.runAllTimersAsync();
    expect(await run).toBe(true);
    expect(namesAsked).toBe(2);
    expect(broadcasts.find((b) => b.type === 'bounty_collected')?.payload.knockerName).toBe(
      'Danimal'
    );
    expect(sent.filter((r) => r.table.startsWith('rpc:fn_collect_bounty'))).toHaveLength(1);
  });
});
