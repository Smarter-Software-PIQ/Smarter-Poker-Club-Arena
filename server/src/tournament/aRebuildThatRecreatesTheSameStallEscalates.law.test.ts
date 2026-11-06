/**
 * A REBUILD THAT RECREATES THE SAME STALL ESCALATES INSTEAD (2026-11-05).
 *
 * Satellite 25 (fbb86b2a) was rebuilt at 18:39Z, 18:49Z and 18:54Z, and every
 * rebuild came back to the same wait. Owner requirement: "Two rebuilds that
 * return to the same deadlock should trigger a different diagnostic or
 * recovery path." See repeatedRecoveryLedger.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const alerts = vi.hoisted(() => ({ raise: vi.fn(async () => undefined), report: vi.fn() }));
vi.mock('../services/financialAlerts.js', () => ({ raiseFinancialAlert: alerts.raise }));
vi.mock('../services/errorReporter.js', () => ({
  reportError: alerts.report,
  describeError: (value: unknown) => String(value),
}));

import { GameServer } from '../GameServer.js';
import {
  REPEATED_RECOVERY_WINDOW_MS,
  RepeatedRecoveryLedger,
  stallSignature,
} from './repeatedRecoveryLedger.js';

const EVENT = 'fbb86b2a-889f-4439-a573-efc0c5ca7064';
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000001';
const HELD = 'aed78e3f-850b-4929-bb1d-1503449b41ce';
const PARKED = '307537c5-1985-4afc-9726-d51fbbf086e1';

const satelliteStall = stallSignature([
  { tableId: HELD, stalledAt: 'start_wait_for_players:permit=attempted' },
  { tableId: PARKED, stalledAt: 'parked_for_pause:permit=none' },
]);

afterEach(() => {
  alerts.raise.mockClear();
  alerts.report.mockClear();
});

describe('the ledger', () => {
  it('a signature ignores order and elapsed seconds', () => {
    expect(
      stallSignature([
        { tableId: PARKED, stalledAt: 'parked_for_pause+603s:permit=none' },
        { tableId: HELD, stalledAt: 'start_wait_for_players+12s:permit=attempted' },
      ])
    ).toBe(satelliteStall);
  });

  it('the first rebuild of a stall proceeds; the same stall again is a repeat', () => {
    const ledger = new RepeatedRecoveryLedger();
    expect(ledger.decide(EVENT, satelliteStall, 'zombie', 1_000).kind).toBe('rebuild');
    const again = ledger.decide(EVENT, satelliteStall, 'dark', 2_000);
    expect(again).toEqual({
      kind: 'repeat',
      previousAtMs: 1_000,
      previousBy: 'zombie',
      repeats: 1,
      retryAtMs: 1_000 + 2 * 60_000,
    });
  });

  it('a different stall, another event, progress since, or an expired window rebuilds', () => {
    const ledger = new RepeatedRecoveryLedger();
    ledger.decide(EVENT, satelliteStall, 'zombie', 1_000);
    expect(ledger.decide(OTHER, satelliteStall, 'zombie', 1_500).kind).toBe('rebuild');
    expect(ledger.decide(EVENT, `${HELD}=dealing:permit=attempted`, 'zombie', 2_000).kind).toBe(
      'rebuild'
    );
    ledger.decide(EVENT, satelliteStall, 'zombie', 3_000);
    // A hand completed after that rebuild: it worked, and this is a new stall.
    expect(ledger.decide(EVENT, satelliteStall, 'dark', 4_000, 3_500).kind).toBe('rebuild');
    expect(
      ledger.decide(EVENT, satelliteStall, 'dark', 4_000 + REPEATED_RECOVERY_WINDOW_MS).kind
    ).toBe('rebuild');
  });

  it('an empty signature never counts as a repeat', () => {
    const ledger = new RepeatedRecoveryLedger();
    ledger.decide(EVENT, '', 'zombie', 1_000);
    expect(ledger.decide(EVENT, '', 'zombie', 2_000).kind).toBe('rebuild');
  });
});

describe('GameServer: every rebuild path asks the same ledger', () => {
  const server = () => Object.create(GameServer.prototype) as any;

  it('the second rebuild into the same stall is refused and raises one critical incident', () => {
    const game = server();
    expect(game.mayRebuildTournamentForStall(EVENT, satelliteStall, 'zombie', 1_000)).toBe(true);
    expect(game.mayRebuildTournamentForStall(EVENT, satelliteStall, 'dark', 2_000)).toBe(false);
    expect(game.mayRebuildTournamentForStall(EVENT, satelliteStall, 'zombie', 3_000)).toBe(false);
    expect(alerts.raise).toHaveBeenCalledTimes(1);
    const [severity, kind] = alerts.raise.mock.calls[0] as unknown as [string, string];
    expect(severity).toBe('critical');
    expect(kind).toBe('GameServer.tournament_repeated_recovery_refused');
    // Named once per window, not on every sweep.
    expect(
      (alerts.report.mock.calls as unknown as Array<[unknown, string]>).filter(
        ([, context]) => context === 'GameServer.tournament_repeated_recovery_refused'
      )
    ).toHaveLength(1);
    // Another event is never held back by this one's history.
    expect(game.mayRebuildTournamentForStall(OTHER, satelliteStall, 'zombie', 3_000)).toBe(true);
  });

  it('the signature is read from the tables the manager owns', () => {
    const game = server();
    game.tableEngines = new Map([
      [HELD, { describeStallForRecovery: () => 'start_wait_for_players:permit=attempted' }],
      [PARKED, { describeStallForRecovery: () => 'parked_for_pause:permit=none' }],
    ]);
    expect(game.tournamentStallSignature({ getTableIds: () => [PARKED, HELD] })).toBe(
      satelliteStall
    );
    // A table with no engine proves nothing about sameness: unknown, never a repeat.
    expect(game.tournamentStallSignature({ getTableIds: () => [HELD, 'missing'] })).toBe('');
  });
});
