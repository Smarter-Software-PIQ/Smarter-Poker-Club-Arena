import { beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
  snapshot: null as any,
  roster: [] as any[],
  payload: '',
  sha256: '',
  refuse: false,
  rpc: vi.fn(),
}));
vi.mock('./client.js', () => ({
  supabase: {
    rpc: (...args: any[]) => {
      const result = fixture.rpc(...args);
      return Object.assign(result, { abortSignal: (_signal: AbortSignal) => result });
    },
    from: (name: string) => {
      const q: any = {
        select: () => q,
        eq: () => q,
        is: () => Promise.resolve({ data: fixture.roster, error: null }),
        maybeSingle: () => Promise.resolve({ data: fixture.snapshot, error: null }),
      };
      if (!['hand_state_snapshots', 'table_seats'].includes(name)) throw Error('Unexpected read');
      return q;
    },
  },
}));
import { claimLegacyRiverContinuation, retainHandContinuation } from './handContinuation.js';
import { HandController } from '../../engine/HandController.js';
import type { HandConfig, SeatPlayer } from '../../types.js';
const ids = {
  tournament_id: 'aaaaaaaa-0000-4000-8000-000000000001',
  table_id: 'cccccccc-0000-4000-8000-000000000001',
  lease_generation: 'bbbbbbbb-0000-4000-8000-000000000001',
  permit_id: 'dddddddd-0000-4000-8000-000000000001',
  custody_id: 'eeeeeeee-0000-4000-8000-000000000001',
  hand_number: '42',
  lifecycle: '1',
};
const writer = 'bbbbbbbb-0000-4000-8000-000000000002';
beforeEach(() => {
  fixture.rpc.mockReset();
  fixture.refuse = false;
  fixture.payload = '';
  const config: HandConfig = {
    tableId: ids.table_id,
    handNumber: 42,
    gameVariant: 'plo5',
    smallBlind: 10,
    bigBlind: 20,
    ante: 0,
    isTournament: true,
    rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
    bbjConfig: { enabled: false, feeBB: 0, minPotBB: 0, minPlayersDealt: 2 },
  };
  const players: SeatPlayer[] = [1, 2].map((seat) => ({
    seat,
    user_id: 'u' + seat,
    username: 'P' + seat,
    stack: 1000,
    bet: 0,
    totalInvested: 0,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  }));
  const c = new HandController(config, players, 1);
  c.start();
  while (c.getState().stage !== 'river') {
    const s = c.getState(),
      p = s.players.find((p) => p.seat === s.currentPlayerSeat)!;
    c.performAction(p.seat, p.bet < s.currentBet ? 'call' : 'check');
  }
  const { deck: _deck, ...state } = c.getState();
  const { isTournament: _t, ...legacyConfig } = config;
  fixture.snapshot = {
    table_id: ids.table_id,
    hand_number: 42,
    state_json: state,
    config_json: legacyConfig,
    created_at: '2026-10-28T23:00:00Z',
    updated_at: '2026-10-28T23:01:00Z',
    stage: 'river',
  };
  fixture.roster = players.map((p) => ({
    id: 's' + p.seat,
    user_id: p.user_id,
    joined_at: '2026-10-28T22:00:00Z',
    stack: 1000,
    seat_number: p.seat,
  }));
  fixture.rpc.mockImplementation(async (name: string, args: any) => {
    if (name === 'fn_f06_hand_number_state')
      return {
        data: {
          ok: true,
          unresolved_permit: { ...ids, generation: ids.lease_generation, state: 'reserved' },
        },
        error: null,
      };
    if (name === 'fn_f06_claim_legacy_river_continuation') {
      fixture.payload = args.p_payload;
      fixture.sha256 = args.p_sha256;
      return { data: { ok: !fixture.refuse, sha256: args.p_sha256 }, error: null };
    }
    if (name === 'fn_f06_claim_hand_continuation')
      return {
        data: {
          ok: true,
          table_id: ids.table_id,
          writer_generation: writer,
          continuation: {
            payload: fixture.payload,
            sha256: fixture.sha256,
            hand_number: '42',
            sequence: '0',
          },
        },
        error: null,
      };
    throw Error('Unexpected RPC ' + name);
  });
});
it('constructs the exact original river, empty unused deck and original financial identity before canonical claim', async () => {
  const result = await claimLegacyRiverContinuation(
    ids.tournament_id,
    writer,
    ids.table_id,
    () => true
  );
  expect(result!.original).toEqual(ids);
  const ctrl = JSON.parse(result!.batch.controller);
  expect(ctrl.state).toEqual(fixture.snapshot.state_json);
  expect(ctrl.deck).toEqual([]);
  expect(ctrl.deckAvailability).toBe('unused_after_river');
  expect(result!.batch.events).toEqual([]);
  expect(result!.seats.map((s) => s.stack_before)).toEqual([1000, 1000]);
  expect(fixture.rpc.mock.calls.map((c) => c[0])).toEqual([
    'fn_f06_hand_number_state',
    'fn_f06_claim_legacy_river_continuation',
    'fn_f06_claim_hand_continuation',
  ]);
});
it('does not claim an earlier street or changed original chair stack', async () => {
  fixture.snapshot.stage = 'turn';
  expect(
    await claimLegacyRiverContinuation(ids.tournament_id, writer, ids.table_id, () => true)
  ).toBeNull();
  expect(fixture.payload).toBe('');
  fixture.snapshot.stage = 'river';
  fixture.roster[0].stack = 999;
  await expect(
    claimLegacyRiverContinuation(ids.tournament_id, writer, ids.table_id, () => true)
  ).rejects.toThrow('Seat Changed');
  expect(fixture.payload).toBe('');
});
it('does not convert a refused legacy admission into canonical ownership', async () => {
  fixture.refuse = true;
  await expect(
    claimLegacyRiverContinuation(ids.tournament_id, writer, ids.table_id, () => true)
  ).rejects.toThrow('Claim Is Unproven');
  expect(fixture.rpc).toHaveBeenCalledTimes(2);
});
it('refuses an unknown or mismatched original write acknowledgement without a retry', async () => {
  const transport = vi.fn(async () => ({
    data: {
      ok: true,
      table_id: ids.table_id,
      hand_number: '42',
      sequence: '999',
      writer_generation: writer,
    },
    error: null,
  }));
  await expect(
    retainHandContinuation(
      ids,
      writer,
      [],
      { version: 1, sequence: 1, controller: 'private', events: [], engine: {} },
      () => true,
      transport
    )
  ).rejects.toThrow('Write Is Unproven');
  expect(transport).toHaveBeenCalledOnce();
});

const privateBatch = {
  version: 1 as const,
  sequence: 1,
  controller: 'PRIVATE_CONTROLLER',
  events: [],
  engine: {},
};
it.each([
  ['ok', 'receipt_not_ok'],
  ['table_id', 'receipt_table_id'],
  ['hand_number', 'receipt_hand_number'],
  ['sequence', 'receipt_sequence'],
  ['sha256', 'receipt_sha256'],
  ['writer_generation', 'receipt_writer_generation'],
])('names only the mismatched %s receipt field without retrying', async (field, reason) => {
  const transport = vi.fn(async (_name: string, args: Record<string, unknown>) => ({
    data: {
      ok: true,
      table_id: ids.table_id,
      hand_number: '42',
      sequence: '1',
      sha256: args.p_sha256,
      writer_generation: writer,
      [field]: 'PRIVATE_RECEIPT',
    },
    error: null,
  }));
  const failure = await retainHandContinuation(
    ids,
    writer,
    [],
    privateBatch,
    () => true,
    transport
  ).catch((error: Error) => error);
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toBe(`Hand Continuation Write Is Unproven [${reason}]`);
  expect(JSON.stringify(failure)).not.toContain('PRIVATE');
  expect(transport).toHaveBeenCalledOnce();
});
it.each(['55P03', '40001', '57014', 'PRIVATE_CONTROLLER', '55P03\nsecret', 55, null])(
  'retains only a well-shaped SQLSTATE from a returned transport error (%s)',
  async (code) => {
    const transport = vi.fn(async () => ({
      data: null,
      error: {
        code,
        message: 'PRIVATE_MESSAGE',
        details: 'PRIVATE_CARDS',
        hint: 'PRIVATE_PAYLOAD',
      },
    }));
    const failure = await retainHandContinuation(
      ids,
      writer,
      [],
      privateBatch,
      () => true,
      transport
    ).catch((error: Error) => error);
    const sqlstate = typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : 'unknown';
    expect((failure as Error).message).toBe(
      `Hand Continuation Write Is Unproven [transport_error sqlstate=${sqlstate}]`
    );
    expect(failure).not.toHaveProperty('code');
    expect(failure).not.toHaveProperty('cause');
    expect(transport).toHaveBeenCalledOnce();
  }
);
it('distinguishes lost ownership and missing receipt, preserving successful identity and raw rejection behavior', async () => {
  const transport = vi.fn(async (_name: string, args: Record<string, unknown>) => ({
    data: {
      ok: true,
      table_id: ids.table_id,
      hand_number: '42',
      sequence: '1',
      sha256: args.p_sha256,
      writer_generation: writer,
    },
    error: null,
  }));
  await expect(
    retainHandContinuation(ids, writer, [], privateBatch, () => true, transport)
  ).resolves.toBeUndefined();
  expect(transport).toHaveBeenCalledOnce();
  transport.mockClear();
  await expect(
    retainHandContinuation(ids, writer, [], privateBatch, () => false, transport)
  ).rejects.toThrow('Owner Changed');
  expect(transport).not.toHaveBeenCalled();
  let current = true;
  const lost = vi.fn(async () => {
    current = false;
    return { data: null, error: null };
  });
  await expect(
    retainHandContinuation(ids, writer, [], privateBatch, () => current, lost)
  ).rejects.toThrow('[owner_changed]');
  const absent = vi.fn(async () => ({ data: null, error: null }));
  await expect(
    retainHandContinuation(ids, writer, [], privateBatch, () => true, absent)
  ).rejects.toThrow('[receipt_missing]');
  const original = new Error('transport rejection');
  const rejected = vi.fn(async () => {
    throw original;
  });
  await expect(
    retainHandContinuation(ids, writer, [], privateBatch, () => true, rejected)
  ).rejects.toBe(original);
  expect(lost).toHaveBeenCalledOnce();
  expect(absent).toHaveBeenCalledOnce();
  expect(rejected).toHaveBeenCalledOnce();
});
