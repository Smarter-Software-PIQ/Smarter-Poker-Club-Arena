/**
 * A STALL NO REBUILD CURED IS RETRIED, NEVER LEFT STANDING STILL (2026-11-06).
 *
 * The repeated-recovery ledger (#9569) refused a rebuild that would return
 * to the stall its previous rebuild left, for a whole hour: an event a
 * rebuild could not cure stood frozen for up to sixty minutes with nothing
 * left trying. Owner rule: a tournament must never freeze. A repeat is now
 * held only for an exponential backoff from the last rebuild of that stall
 * (2, 4, then 8 minutes, capped), and then rebuilt again.
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
  REPEATED_RECOVERY_MAX_BACKOFF_MS,
  REPEATED_RECOVERY_WINDOW_MS,
  RepeatedRecoveryLedger,
  repeatedRecoveryBackoffMs,
  stallSignature,
} from './repeatedRecoveryLedger.js';

const MINUTE = 60_000;
const EVENT = 'fbb86b2a-889f-4439-a573-efc0c5ca7064';
const STALL = stallSignature([
  {
    tableId: 'aed78e3f-850b-4929-bb1d-1503449b41ce',
    stalledAt: 'start_wait_for_players:permit=attempted',
  },
]);

afterEach(() => {
  alerts.raise.mockClear();
  alerts.report.mockClear();
});

describe('the backoff', () => {
  it('is 2, 4, then 8 minutes, and never longer', () => {
    expect([0, 1, 2, 3, 10, 1_000].map(repeatedRecoveryBackoffMs)).toEqual([
      2 * MINUTE,
      4 * MINUTE,
      8 * MINUTE,
      8 * MINUTE,
      8 * MINUTE,
      8 * MINUTE,
    ]);
    expect(REPEATED_RECOVERY_MAX_BACKOFF_MS).toBeLessThan(REPEATED_RECOVERY_WINDOW_MS);
  });
});

describe('a stall that every rebuild recreates', () => {
  it('is rebuilt again at 2, 6, 14, 22 ... minutes: held between, never for the hour', () => {
    const ledger = new RepeatedRecoveryLedger();
    const rebuiltAt: number[] = [];
    // Asked every 30 seconds for three hours, as the zombie sweep would.
    for (let t = 0; t <= 180 * MINUTE; t += 30_000) {
      const decision = ledger.decide(EVENT, STALL, 'zombie', t);
      if (decision.kind === 'rebuild') rebuiltAt.push(t / MINUTE);
      else expect(decision.retryAtMs - t).toBeLessThanOrEqual(REPEATED_RECOVERY_MAX_BACKOFF_MS);
    }
    expect(rebuiltAt.slice(0, 6)).toEqual([0, 2, 6, 14, 22, 30]);
    // Never more than the cap between two rebuilds, for as long as it lasts.
    for (let i = 1; i < rebuiltAt.length; i++)
      expect(rebuiltAt[i] - rebuiltAt[i - 1]).toBeLessThanOrEqual(8);
  });

  it('a completed hand clears the backoff: the next stall is a new one', () => {
    const ledger = new RepeatedRecoveryLedger();
    ledger.decide(EVENT, STALL, 'zombie', 0);
    expect(ledger.decide(EVENT, STALL, 'zombie', 2 * MINUTE).kind).toBe('rebuild');
    expect(ledger.decide(EVENT, STALL, 'zombie', 3 * MINUTE).kind).toBe('repeat');
    // A hand completed at 3.5 minutes: the stall at 4 minutes is a new one.
    expect(ledger.decide(EVENT, STALL, 'zombie', 4 * MINUTE, 3.5 * MINUTE)).toEqual({
      kind: 'rebuild',
    });
    expect(ledger.decide(EVENT, STALL, 'zombie', 5 * MINUTE).kind).toBe('repeat');
    expect(ledger.decide(EVENT, STALL, 'zombie', 6 * MINUTE).kind).toBe('rebuild');
  });
});

describe('GameServer', () => {
  const server = () => Object.create(GameServer.prototype) as any;

  it('holds the repeat for its backoff, then rebuilds and names the retry', () => {
    const game = server();
    expect(game.mayRebuildTournamentForStall(EVENT, STALL, 'zombie', 0)).toBe(true);
    expect(game.mayRebuildTournamentForStall(EVENT, STALL, 'dark', MINUTE)).toBe(false);
    expect(game.mayRebuildTournamentForStall(EVENT, STALL, 'zombie', 2 * MINUTE)).toBe(true);
    expect(
      (alerts.report.mock.calls as unknown as Array<[unknown, string]>).filter(
        ([, context]) => context === 'GameServer.tournament_repeated_recovery_retried'
      )
    ).toHaveLength(1);
    expect(game.mayRebuildTournamentForStall(EVENT, STALL, 'zombie', 5 * MINUTE)).toBe(false);
    expect(game.mayRebuildTournamentForStall(EVENT, STALL, 'zombie', 6 * MINUTE)).toBe(true);
    // The incident is still paged once per window, not once per hold.
    expect(alerts.raise).toHaveBeenCalledTimes(1);
  });

  it('the page cadence map is pruned with the ledger', () => {
    const game = server();
    game.mayRebuildTournamentForStall(EVENT, STALL, 'zombie', 0);
    game.mayRebuildTournamentForStall(EVENT, STALL, 'zombie', MINUTE);
    expect(game.repeatedTournamentRecoveryAlertedAt.size).toBe(1);
    game.mayRebuildTournamentForStall(
      'aaaaaaaa-0000-4000-8000-000000000001',
      STALL,
      'zombie',
      2 * REPEATED_RECOVERY_WINDOW_MS
    );
    expect(game.repeatedTournamentRecoveryAlertedAt.has(EVENT)).toBe(false);
    expect(game.repeatedTournamentRecoveries.size).toBe(1);
  });
});
