/**
 * GameServerAPI.engine_refusal "Table engine not found" ~1,100x on 14 dead
 * table ids (2026-10-31): a 404 now follows the game to its live table, and a
 * game that is gone ends in the closed-table state after a bounded number of
 * failures. TableService.resolveTournamentLiveTable_rpc_empty (1,680 ERROR
 * rows from polling) is reported once per tournament per session.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  reportError: vi.fn(),
}));
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: m.rpc, from: m.from } }));
vi.mock('../../src/utils/errorReporter', () => ({
  reportError: m.reportError,
  reportWarning: vi.fn(),
  captureClientError: vi.fn(),
}));

import {
  DEAD_TABLE_MAX_FAILURES,
  DEAD_TABLE_REASK_EVERY,
  DEAD_TABLE_VOUCHED_CEILING,
  createDeadTableRecovery,
  type DeadTableDeps,
  type DeadTableRow,
} from '../../src/lib/deadTableRecovery';
import { cashGameSuccessorTable, type CashGameLobby } from '../../src/services/cashGameLobby';
import {
  __resetElectedNothingReportedForTests,
  tableService,
} from '../../src/services/TableService';

const DEAD = 'aaaaaaaa-0000-4000-8000-000000000001';
const LIVE = 'aaaaaaaa-0000-4000-8000-000000000002';
const TOURNEY = 'bbbbbbbb-0000-4000-8000-000000000001';
const GAME = 'cccccccc-0000-4000-8000-000000000001';

function deps(
  over: Partial<{ elected: string | null; row: DeadTableRow | null | undefined }> = {}
) {
  const d = {
    resolveTournamentLiveTable: vi.fn(async () => over.elected ?? null),
    resolveCashGameTable: vi.fn(async () => over.elected ?? null),
    readTableRow: vi.fn(async () => ('row' in over ? over.row : null)),
  } satisfies DeadTableDeps;
  return d;
}

async function run(recovery: ReturnType<typeof createDeadTableRecovery>, beats: number) {
  const verdicts = [];
  for (let i = 0; i < beats; i++) verdicts.push(await recovery.onNotRunning());
  return verdicts;
}

describe('dead table recovery', () => {
  it('a tournament table follows the tournament to its live table on the first 404', async () => {
    const d = deps({ elected: LIVE });
    const r = createDeadTableRecovery(() => ({ tableId: DEAD, tournamentId: TOURNEY }), d);
    expect(await r.onNotRunning()).toEqual({ kind: 'successor', tableId: LIVE });
    expect(d.resolveTournamentLiveTable).toHaveBeenCalledWith(TOURNEY);
    // One verdict per episode: no second navigation.
    expect(await r.onNotRunning()).toEqual({ kind: 'wait' });
  });

  it('a cash table follows its cash game', async () => {
    const d = deps({ elected: LIVE });
    const r = createDeadTableRecovery(() => ({ tableId: DEAD, cashGameId: GAME }), d);
    expect(await r.onNotRunning()).toEqual({ kind: 'successor', tableId: LIVE });
    expect(d.resolveCashGameTable).toHaveBeenCalledWith(GAME);
  });

  it.each([
    ['closed row', { status: 'closed' }],
    ['deleted row', { status: 'running', is_deleted: true }],
    ['missing row', null],
  ])(
    'a game that is gone (%s) ends in the closed state after the bounded failures',
    async (_label, row) => {
      const d = deps({ elected: null, row: row as DeadTableRow | null });
      const r = createDeadTableRecovery(() => ({ tableId: DEAD, tournamentId: TOURNEY }), d);
      const verdicts = await run(r, DEAD_TABLE_MAX_FAILURES + 2);
      expect(verdicts.slice(0, DEAD_TABLE_MAX_FAILURES - 1).every((v) => v.kind === 'wait')).toBe(
        true
      );
      expect(verdicts[DEAD_TABLE_MAX_FAILURES - 1]).toEqual({ kind: 'closed' });
      expect(verdicts.slice(DEAD_TABLE_MAX_FAILURES).every((v) => v.kind === 'wait')).toBe(true);
      expect(d.resolveTournamentLiveTable).toHaveBeenCalledTimes(DEAD_TABLE_MAX_FAILURES);
    }
  );

  it('a table the game election still names is an engine restart: never closed, re-asked once a minute', async () => {
    const d = deps({ elected: DEAD });
    const r = createDeadTableRecovery(() => ({ tableId: DEAD, tournamentId: TOURNEY }), d);
    const verdicts = await run(r, DEAD_TABLE_VOUCHED_CEILING * 2);
    expect(verdicts.every((v) => v.kind === 'wait')).toBe(true);
    expect(d.resolveTournamentLiveTable.mock.calls.length).toBeLessThanOrEqual(
      Math.ceil((DEAD_TABLE_VOUCHED_CEILING * 2) / DEAD_TABLE_REASK_EVERY) + 1
    );
  });

  it('a table vouched for only by a live row is bounded by the ceiling', async () => {
    const d = deps({ elected: null, row: { status: 'running' } });
    const r = createDeadTableRecovery(() => ({ tableId: DEAD }), d);
    const verdicts = await run(r, DEAD_TABLE_VOUCHED_CEILING + DEAD_TABLE_REASK_EVERY);
    const closedAt = verdicts.findIndex((v) => v.kind === 'closed');
    expect(closedAt).toBeGreaterThanOrEqual(DEAD_TABLE_VOUCHED_CEILING - 1);
    expect(closedAt).toBeLessThan(DEAD_TABLE_VOUCHED_CEILING + DEAD_TABLE_REASK_EVERY);
    expect(d.readTableRow.mock.calls.length).toBeLessThanOrEqual(
      Math.ceil(DEAD_TABLE_VOUCHED_CEILING / DEAD_TABLE_REASK_EVERY) + 2
    );
  });

  it('an unreadable row never ejects a seated player before the ceiling', async () => {
    const d = deps({ elected: null, row: undefined });
    const r = createDeadTableRecovery(() => ({ tableId: DEAD }), d);
    const verdicts = await run(r, DEAD_TABLE_MAX_FAILURES * 4);
    expect(verdicts.every((v) => v.kind === 'wait')).toBe(true);
  });

  it('a beat that lands ends the episode and resets the count', async () => {
    const d = deps({ elected: null, row: { status: 'closed' } });
    const r = createDeadTableRecovery(() => ({ tableId: DEAD }), d);
    await run(r, DEAD_TABLE_MAX_FAILURES - 1);
    r.onRunning();
    expect(r.failures()).toBe(0);
    const verdicts = await run(r, DEAD_TABLE_MAX_FAILURES - 1);
    expect(verdicts.every((v) => v.kind === 'wait')).toBe(true);
  });

  it('a resolver that throws is a failure, not a crash', async () => {
    const d = deps({ row: { status: 'closed' } });
    d.resolveTournamentLiveTable.mockRejectedValue(new Error('network'));
    const r = createDeadTableRecovery(() => ({ tableId: DEAD, tournamentId: TOURNEY }), d);
    const verdicts = await run(r, DEAD_TABLE_MAX_FAILURES);
    expect(verdicts.at(-1)).toEqual({ kind: 'closed' });
  });
});

describe('cash game successor', () => {
  const lobby = (over: Partial<CashGameLobby>): CashGameLobby =>
    ({
      game: { enabled: true },
      tables: [],
      me: null,
      front_table_id: null,
      ...over,
    }) as unknown as CashGameLobby;

  it('prefers the caller’s own seat, then the front table, then any live table', () => {
    expect(
      cashGameSuccessorTable(
        lobby({ me: { seated: true, table_id: LIVE } as never, front_table_id: DEAD })
      )
    ).toBe(LIVE);
    expect(cashGameSuccessorTable(lobby({ front_table_id: LIVE }))).toBe(LIVE);
    expect(
      cashGameSuccessorTable(
        lobby({
          tables: [
            { id: DEAD, lifecycle: 'closed' },
            { id: LIVE, lifecycle: 'live' },
          ] as never,
        })
      )
    ).toBe(LIVE);
  });

  it('a switched-off game has no successor for a player not seated in it', () => {
    expect(
      cashGameSuccessorTable(lobby({ game: { enabled: false } as never, front_table_id: LIVE }))
    ).toBeNull();
    expect(cashGameSuccessorTable(null)).toBeNull();
  });
});

describe('resolveTournamentLiveTable_rpc_empty', () => {
  beforeEach(() => {
    __resetElectedNothingReportedForTests();
    m.reportError.mockClear();
    m.rpc.mockResolvedValue({ data: null, error: null });
    const chain = {
      select: () => chain,
      eq: () => chain,
      neq: () => chain,
      order: () => chain,
      limit: async () => ({ data: [], error: null }),
    };
    m.from.mockReturnValue(chain);
  });

  it('is reported once per tournament per session, however often it is polled', async () => {
    for (let i = 0; i < 50; i++) await tableService.resolveTournamentLiveTable(TOURNEY);
    await tableService.resolveTournamentLiveTable('bbbbbbbb-0000-4000-8000-000000000002');
    const empties = m.reportError.mock.calls.filter(
      ([, source]) => source === 'TableService.resolveTournamentLiveTable_rpc_empty'
    );
    expect(empties).toHaveLength(2);
  });
});
