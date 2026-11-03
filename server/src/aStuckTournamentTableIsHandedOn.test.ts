import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameServer } from './GameServer.js';
import { supabase } from './services/supabase.js';

afterEach(() => vi.restoreAllMocks());

/*
 * A TOURNAMENT TABLE WITH NO DEALER IS HANDED ON, NOT LEFT (2026-10-22).
 *
 * 02:48 UTC: Midweek Bounty table 9ca9c3a8 was killed in a database stall and
 * its manager never replaced it; eight players waited over half an hour. And a
 * closed PKO table whose stopped engine stayed registered read as six players
 * at a dead table and paged "Tables Have Stopped Dealing".
 */

const T = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000002';
const EVENT = 'eeeeeeee-0000-4000-8000-000000000001';
const MIN = 60_000;

function eng(running: boolean, opts: { tournament?: boolean; progressMs?: number } = {}) {
  return {
    isRunning: () => running,
    isTournament: () => opts.tournament ?? true,
    msSinceProgress: () => opts.progressMs ?? 1_000,
  };
}

function manager(tableIds: string[], failing: Array<{ tableId: string; msFailing: number }> = []) {
  return {
    getTableIds: () => tableIds,
    getTablesFailingAdmission: () => failing,
    requestSuccessorForStuckTable: vi.fn(() => true),
  };
}

function server(tables: [string, any][], managers: [string, any][]) {
  const s = Object.create(GameServer.prototype) as any;
  s.tableEngines = new Map(tables);
  s.tournamentEngines = new Map(managers);
  s.tournamentOwnedTables = new Set(tables.filter(([, e]) => e.isTournament()).map(([id]) => id));
  s.stuckTournamentTableSince = new Map();
  s.stuckTournamentTableHandoffs = new Map();
  s.stuckTournamentLastHandoffAt = new Map();
  s.unregisterTableEngine = vi.fn((id: string) => {
    s.tableEngines.delete(id);
    return true;
  });
  return s;
}

const run = (s: any, now: number) => s.escalateStuckTournamentTables(now);

describe('a tournament table with no dealer is handed on, not left', () => {
  it('hands the event on once a stopped table has had no dealer for five minutes', () => {
    const m = manager([T, OTHER]);
    const s = server(
      [
        [T, eng(false)],
        [OTHER, eng(true)],
      ],
      [[EVENT, m]]
    );
    run(s, 0);
    run(s, 4 * MIN);
    expect(m.requestSuccessorForStuckTable).not.toHaveBeenCalled();
    run(s, 5 * MIN);
    expect(m.requestSuccessorForStuckTable).toHaveBeenCalledWith(T);
    expect(m.requestSuccessorForStuckTable).toHaveBeenCalledTimes(1);
  });

  it('counts a failing admission from when it began failing', () => {
    const m = manager([OTHER], [{ tableId: T, msFailing: 6 * MIN }]);
    const s = server([[OTHER, eng(true)]], [[EVENT, m]]);
    run(s, 10 * MIN);
    expect(m.requestSuccessorForStuckTable).toHaveBeenCalledWith(T);
  });

  it('leaves a running table alone', () => {
    const m = manager([T]);
    const s = server([[T, eng(true)]], [[EVENT, m]]);
    run(s, 0);
    run(s, 30 * MIN);
    expect(m.requestSuccessorForStuckTable).not.toHaveBeenCalled();
  });

  it('forgets a table that deals again before the threshold', () => {
    const m = manager([T]);
    const e = { ...eng(false), isRunning: vi.fn(() => false) };
    const s = server([[T, e]], [[EVENT, m]]);
    run(s, 0);
    e.isRunning.mockReturnValue(true);
    run(s, 3 * MIN);
    e.isRunning.mockReturnValue(false);
    run(s, 6 * MIN);
    expect(m.requestSuccessorForStuckTable).not.toHaveBeenCalled();
  });

  it('asks again on the next pass while other tables are still mid-hand', () => {
    const m = manager([T]);
    m.requestSuccessorForStuckTable.mockReturnValueOnce(false);
    const s = server([[T, eng(false)]], [[EVENT, m]]);
    run(s, 0);
    run(s, 5 * MIN);
    run(s, 5 * MIN + 5_000);
    expect(m.requestSuccessorForStuckTable).toHaveBeenCalledTimes(2);
  });

  it('spaces hand-offs per event and stops after three per table', () => {
    const m = manager([T]);
    const s = server([[T, eng(false)]], [[EVENT, m]]);
    run(s, 0);
    for (let t = 5 * MIN; t <= 120 * MIN; t += 5_000) run(s, t);
    expect(m.requestSuccessorForStuckTable).toHaveBeenCalledTimes(3);
    const calls = (m.requestSuccessorForStuckTable.mock.calls as unknown[]).length;
    expect(calls).toBe(3);
  });

  it('keeps the hand-off budget across a manager generation that owns the same table', () => {
    const first = manager([T]);
    const s = server([[T, eng(false)]], [[EVENT, first]]);
    run(s, 0);
    run(s, 5 * MIN);
    expect(first.requestSuccessorForStuckTable).toHaveBeenCalledTimes(1);
    s.tournamentEngines = new Map();
    run(s, 5 * MIN + 5_000);
    const second = manager([T]);
    s.tournamentEngines = new Map([[EVENT, second]]);
    for (let t = 6 * MIN; t <= 200 * MIN; t += 5_000) run(s, t);
    expect(second.requestSuccessorForStuckTable).toHaveBeenCalledTimes(2);
  });

  it('drops a stopped tournament engine that no manager owns', () => {
    const m = manager([OTHER]);
    const s = server(
      [
        [T, eng(false)],
        [OTHER, eng(true)],
      ],
      [[EVENT, m]]
    );
    run(s, 0);
    expect(s.unregisterTableEngine).toHaveBeenCalledTimes(1);
    expect(s.unregisterTableEngine.mock.calls[0][0]).toBe(T);
    expect(s.tableEngines.has(T)).toBe(false);
    expect(m.requestSuccessorForStuckTable).not.toHaveBeenCalled();
  });

  it('never drops a cash table or a running engine', () => {
    const cash = 'cccccccc-0000-4000-8000-000000000001';
    const s = server(
      [
        [cash, eng(false, { tournament: false })],
        [T, eng(true)],
      ],
      []
    );
    s.tournamentOwnedTables = new Set();
    run(s, 0);
    expect(s.unregisterTableEngine).not.toHaveBeenCalled();
  });
});

describe('handoff budgets survive fleet pressure until proven retirement', () => {
  it('never resets exhausted budgets when more than 500 live tables fail', () => {
    const managers = Array.from(
      { length: 501 },
      (_, i) =>
        [
          `event-${i}`,
          manager([`table-${i}`], [{ tableId: `table-${i}`, msFailing: 6 * MIN }]),
        ] as [string, any]
    );
    const s = server([], managers);
    for (let i = 0; i < managers.length; i++) s.stuckTournamentTableHandoffs.set(`table-${i}`, 3);
    run(s, 10 * MIN);
    run(s, 11 * MIN);
    expect(s.stuckTournamentTableHandoffs.size).toBe(501);
    for (const [, m] of managers) expect(m.requestSuccessorForStuckTable).not.toHaveBeenCalled();
  });

  function terminalFixture(reply: unknown) {
    const s = server([], []);
    s.stuckTournamentTableHandoffs.set(T, 3);
    s.stuckTournamentTableSince.set(T, 1);
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(async () => reply) };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    vi.spyOn(supabase, 'from').mockReturnValue(query as any);
    return s;
  }

  it('retires an absent table budget only after the existing terminal read proves closure', async () => {
    const s = terminalFixture({ data: { status: 'closed', tournament_id: EVENT }, error: null });
    expect(await s.stopClosedTournamentTableEngine(T)).toBe(true);
    expect(s.stuckTournamentTableHandoffs.has(T)).toBe(false);
    expect(s.stuckTournamentTableSince.has(T)).toBe(false);
  });

  it.each([
    { data: null, error: { message: 'unreadable' } },
    { data: null, error: null },
    { data: { status: 'running', tournament_id: EVENT }, error: null },
  ])('retains the budget when terminal closure is not proven: %j', async (reply) => {
    const s = terminalFixture(reply);
    expect(await s.stopClosedTournamentTableEngine(T)).toBe(false);
    expect(s.stuckTournamentTableHandoffs.get(T)).toBe(3);
  });

  it('retains a budget when exact-instance retirement loses to a successor', async () => {
    const s = terminalFixture({ data: { status: 'closed', tournament_id: EVENT }, error: null });
    const old = { stop: vi.fn(async () => undefined) };
    s.tableEngines.set(T, old);
    s.unregisterTableEngine.mockReturnValue(false);
    expect(await s.stopClosedTournamentTableEngine(T)).toBe(false);
    expect(s.stuckTournamentTableHandoffs.get(T)).toBe(3);
  });

  it('retires the budget after confirmed closure and successful exact-instance retirement', async () => {
    const s = terminalFixture({ data: { status: 'closed', tournament_id: EVENT }, error: null });
    s.tableEngines.set(T, { stop: vi.fn(async () => undefined) });
    expect(await s.stopClosedTournamentTableEngine(T)).toBe(true);
    expect(s.stuckTournamentTableHandoffs.has(T)).toBe(false);
  });
});
