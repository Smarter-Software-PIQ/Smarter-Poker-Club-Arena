import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  exitCancelledTournament,
  isUnrankedTournamentCancellation,
} from '../../src/services/tournamentCancellationExit';

const db = vi.hoisted(() => ({ read: vi.fn(), result: vi.fn(), filters: [] as unknown[][] }));
vi.mock('../../src/services/tournamentResult', () => ({ fetchTournamentResult: db.result }));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      db.filters.push(['from', table]);
      const query: any = {
        select: () => query,
        eq: (...args: unknown[]) => {
          db.filters.push(['eq', ...args]);
          return query;
        },
        is: (...args: unknown[]) => {
          db.filters.push(['is', ...args]);
          return query;
        },
        limit: () => db.read(),
      };
      return query;
    },
  },
}));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
beforeEach(() => {
  db.read.mockReset();
  db.result.mockReset().mockResolvedValue({
    tournamentStatus: 'CANCELLED',
    entryStatus: 'eliminated',
    finishPlace: null,
  });
  db.filters = [];
});
const input = () => ({
  tournamentStatus: 'CANCELLED',
  tableId: 'cancelled-table',
  tournamentId: 'cancelled-event',
  userId: 'hero',
  isCurrent: () => true,
  onExit: vi.fn(),
  onResult: vi.fn(),
});

describe('committed tournament cancellation exit', () => {
  it('closes only the released participant table without requiring a rank or payout', async () => {
    db.read.mockResolvedValue({ data: [], error: null });
    const request = input();
    expect(await exitCancelledTournament(request)).toBe(true);
    expect(request.onExit).toHaveBeenCalledOnce();
    expect(db.filters).toEqual([
      ['from', 'table_seats'],
      ['eq', 'table_id', 'cancelled-table'],
      ['eq', 'user_id', 'hero'],
      ['is', 'left_at', null],
    ]);
  });
  it.each([undefined, null, 'RUNNING', 'COMPLETED', 'REGISTERING'])(
    'does not treat %s as cancellation or query seats',
    async (status) => {
      const request = { ...input(), tournamentStatus: status };
      expect(await exitCancelledTournament(request)).toBe(false);
      expect(db.read).not.toHaveBeenCalled();
      expect(request.onExit).not.toHaveBeenCalled();
    }
  );
  it.each([
    { data: [{ id: 'live-seat' }], error: null },
    { data: null, error: new Error('unreadable') },
    { data: null, error: null },
  ])('retains live or unknown participant seats', async (response) => {
    db.read.mockResolvedValue(response);
    const request = input();
    expect(await exitCancelledTournament(request)).toBe(false);
    expect(request.onExit).not.toHaveBeenCalled();
  });
  it('closes a guest observer direct URL from committed cancellation without an entrant row', async () => {
    const request = { ...input(), userId: 'guest' };
    expect(await exitCancelledTournament(request)).toBe(true);
    expect(request.onExit).toHaveBeenCalledOnce();
    expect(db.read).not.toHaveBeenCalled();
  });
  it('closes a signed-in observer after a successful empty own-seat read', async () => {
    db.result.mockResolvedValue({
      tournamentStatus: 'CANCELLED',
      entryStatus: null,
      finishPlace: null,
    });
    db.read.mockResolvedValue({ data: [], error: null });
    expect(await exitCancelledTournament(input())).toBe(true);
  });
  it('ignores a late read after unmount, account change or another terminal exit', async () => {
    let current = true;
    db.read.mockImplementation(async () => {
      current = false;
      return { data: [], error: null };
    });
    const request = { ...input(), isCurrent: () => current };
    expect(await exitCancelledTournament(request)).toBe(false);
    expect(request.onExit).not.toHaveBeenCalled();
  });
  it.each([
    { entryStatus: 'eliminated', finishPlace: 3, prize: 50 },
    {
      entryStatus: 'winner',
      finishPlace: null,
      prize: 0,
      satelliteQualification: { targetId: 'target', deliveryKind: 'ticket', amount: 100 },
    },
  ])(
    'routes a released earned result through the report owner instead of cancelling its timer',
    async (earned) => {
      const result = { tournamentStatus: 'CANCELLED', ...earned };
      db.result.mockResolvedValue(result);
      db.read.mockResolvedValue({ data: [], error: null });
      const request = input();
      expect(await exitCancelledTournament(request)).toBe(true);
      expect(request.onResult).toHaveBeenCalledWith(result);
      expect(request.onExit).not.toHaveBeenCalled();
    }
  );
  it.each([
    undefined,
    { finishPlace: null },
    { tournamentStatus: 'RUNNING', entryStatus: 'eliminated', finishPlace: 3 },
    { tournamentStatus: 'CANCELLED', entryStatus: 'playing', finishPlace: null },
    { tournamentStatus: 'CANCELLED', entryStatus: 'registered', finishPlace: null },
  ])(
    'does not discard a pending result when the cancellation result is unknown or still playing',
    async (result) => {
      db.result.mockResolvedValue(result);
      const request = input();
      expect(await exitCancelledTournament(request)).toBe(false);
      expect(request.onExit).not.toHaveBeenCalled();
      expect(request.onResult).not.toHaveBeenCalled();
    }
  );
  it('does not discard an earned finish or qualification when the event is cancelled', () => {
    expect(
      isUnrankedTournamentCancellation({ tournamentStatus: 'CANCELLED', finishPlace: null })
    ).toBe(true);
    expect(
      isUnrankedTournamentCancellation({ tournamentStatus: 'CANCELLED', finishPlace: 3 })
    ).toBe(false);
    expect(
      isUnrankedTournamentCancellation({
        tournamentStatus: 'CANCELLED',
        finishPlace: null,
        satelliteQualification: { qualified: true },
      })
    ).toBe(false);
    expect(isUnrankedTournamentCancellation(undefined)).toBe(false);
  });
});

// Keep the tested read-only exit connected to the actual cold-load, channel and
// existing engine retirement transport. No new observer/repair polling path.
it('wires durable cancellation into TablePage recovery and scoped exit signals', () => {
  const page = readFileSync('src/pages/TablePage.tsx', 'utf8');
  expect(page).toContain(
    "if (terminal.status === 'CANCELLED') {\n              await exitFromDurableCancellation(terminal.status);"
  );
  expect(page).toContain(
    "if (payload.new?.status === 'CANCELLED') {\n                  void verifyDurableCompletion();"
  );
  expect(page).toContain('verifyDurableTournamentExitRef.current = verifyDurableCompletion;');
  expect(page).toContain('verifyDurableTournamentExitRef.current = null;');
  expect(page).toMatch(
    /case 'ENGINE_RESTARTING':[\s\S]*?verifyDurableTournamentExitRef.current\?\.\(\)/
  );
  const exit = page.slice(
    page.indexOf('async function exitFromDurableCancellation'),
    page.indexOf('async function verifyDurableCompletion')
  );
  expect(exit).toContain('await exitCancelledTournament({');
  expect(exit).toContain('durableCancellationResult = result;');
  expect(exit).toContain('goToLobbyWithResult(Number(result.finishPlace) || 0, result.prize, 0);');
  expect(exit).toContain("masterBus.emit('SESSION_ENDED', { tableId: durableTableId, userId });");
  expect(exit).toContain(
    "masterBus.emit('TABLE_LEFT', { tableId: durableTableId, seat: seatAtExit });"
  );
  expect(exit).toContain("action: 'CLOSE_TABLE_TAB'");
  expect(exit).toContain('if (!embeddedTableId)');
  expect(exit).toContain('clearTimeout(tournamentExitTimerRef.current)');
  expect(exit).not.toMatch(/cashOut|refund|publishSessionSummary|clearPlayingAt/);
  expect(page).toMatch(
    /const full = durableCancellationResult \?\? enriched;\s*if \(!isMounted \|\| cancellationExitStarted\) return;\s*if \(isUnrankedTournamentCancellation\(full\)\)/
  );
});
