import { afterEach, describe, expect, it, vi } from 'vitest';
import { TournamentManagerEliminations } from './TournamentManagerEliminations.js';
import { TournamentManagerBase } from './TournamentManagerBase.js';
import { tournamentEliminationScheduler } from './TournamentEliminationScheduler.js';
import { requestTournamentTerminalReceipt } from './terminalSettlementRpc.js';

vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));
vi.mock('../services/financialAlerts.js', () => ({ raiseFinancialAlert: vi.fn() }));
vi.mock('./terminalSettlementRpc.js', async (original) => ({
  ...(await original<typeof import('./terminalSettlementRpc.js')>()),
  requestTournamentTerminalReceipt: vi.fn(),
}));

const TOURNAMENT = 'aaaaaaaa-0000-4000-8000-000000000001';
const WINNER = 'aaaaaaaa-0000-4000-8000-000000000002';
const TABLE = 'aaaaaaaa-0000-4000-8000-000000000003';
const receipt = {
  tournamentId: TOURNAMENT,
  winnerId: WINNER,
  winnerAmount: 30,
  tableClosure: { closedTableIds: [TABLE] },
  sourceCloseout: { sourceTableIds: [TABLE] },
  dealShares: [{ userId: WINNER, amount: 30, place: 1 }],
};

const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

afterEach(() => {
  tournamentEliminationScheduler.stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function manager(format: string, failCleanup: boolean) {
  const m = Object.create(TournamentManagerEliminations.prototype) as any;
  const stopClosed = vi.fn().mockResolvedValue(true);
  if (failCleanup) stopClosed.mockResolvedValueOnce(false);
  Object.assign(m, {
    tournamentId: TOURNAMENT,
    tournamentCache: { tournament_type: format },
    running: true,
    tournamentFinished: false,
    urgentRedrivesRequested: 0,
    tableEngines: new Map(),
    gameServer: {
      stopClosedTournamentTableEngine: stopClosed,
      retireCompletedF06CustodyMetadata: vi.fn(),
    },
    retireBlindClockAfterCommittedTerminal: vi.fn(),
    clearFinishRefusalStreak: vi.fn(),
    broadcast: vi.fn().mockResolvedValue(true),
    cleanupBroadcastChannel: vi.fn().mockResolvedValue(undefined),
    processSatelliteAwards: vi.fn().mockResolvedValue(receipt),
    stop: vi.fn(async () => {
      m.running = false;
    }),
  });
  return m;
}

describe('the first committed terminal cleanup failure retains its own causal wake', () => {
  it.each(['MTT', 'SNG', 'SPIN', 'SATELLITE', 'FINAL_TABLE_DEAL'])(
    '%s reaches cleanup after one transient refusal without another hand or money call',
    async (format) => {
      vi.useFakeTimers();
      vi.mocked(requestTournamentTerminalReceipt).mockResolvedValue(receipt as never);
      const m = manager(format, true);
      let admissions = 0;
      const unregister = tournamentEliminationScheduler.register({
        tournamentId: TOURNAMENT,
        isActive: () => m.running,
        run: async () => {
          admissions++;
          if (admissions === 1) {
            if (format === 'FINAL_TABLE_DEAL') {
              // The immutable receipt has just returned from the single payer.
              await m.settleFinalTableDeal(receipt);
            } else {
              await m.finishTournament(WINNER);
              m.rearmIfTheFinishWasRefused();
            }
          } else {
            // This is the first branch of the real sweep, before its latches.
            expect(await m.resumeCommittedTerminalCleanup()).toBe(true);
          }
        },
      });
      try {
        await flush();
        expect(admissions).toBe(1);
        expect(m.running).toBe(true);
        expect(m.tournamentFinished).toBe(true);
        expect(tournamentEliminationScheduler.snapshot().pendingWakes).toBe(1);
        await vi.advanceTimersByTimeAsync(TournamentManagerBase.UNRESOLVED_BUST_RETRY_MS - 1);
        expect(admissions).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        await flush();
        expect(admissions).toBe(2);
        expect(m.running).toBe(false);
        expect(m.gameServer.stopClosedTournamentTableEngine).toHaveBeenCalledTimes(2);
        expect(m.stop).toHaveBeenCalledOnce();
        expect(tournamentEliminationScheduler.snapshot().pendingWakes).toBe(0);
        expect(requestTournamentTerminalReceipt).toHaveBeenCalledTimes(
          ['MTT', 'SNG', 'SPIN'].includes(format) ? 1 : 0
        );
        expect(m.processSatelliteAwards).toHaveBeenCalledTimes(format === 'SATELLITE' ? 1 : 0);
        await vi.advanceTimersByTimeAsync(TournamentManagerBase.UNRESOLVED_BUST_RETRY_MS * 2);
        expect(admissions).toBe(2);
      } finally {
        unregister();
      }
    }
  );

  it('does not schedule a successful or stopped cleanup', async () => {
    vi.useFakeTimers();
    const m = manager('MTT', false);
    const wake = vi.spyOn(m, 'requestUrgentEliminationSweepAfter');
    expect(await m.cleanupCommittedTournament(receipt)).toBe(true);
    expect(wake).not.toHaveBeenCalled();
    m.gameServer.stopClosedTournamentTableEngine.mockResolvedValue(false);
    expect(await m.cleanupCommittedTournament(receipt)).toBe(false);
    expect(wake).not.toHaveBeenCalled();
  });
});
