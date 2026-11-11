import { describe, expect, it } from 'vitest';
import {
  offersResultReplay,
  type TournamentResult,
} from '../../src/services/pendingSessionSummary';

describe('session report primary action', () => {
  const finish: TournamentResult = {
    finishPlace: 1,
    entrants: 9,
    prize: 90,
    bountyWinnings: 0,
    knockouts: 0,
    rebuys: 0,
    addOns: 0,
  };
  it('offers replay for Sit & Go and heads-up Sit & Go finishes', () => {
    for (const entrants of [9, 2]) {
      expect(offersResultReplay({ ...finish, entrants, formatKind: 'sng' })).toBe(true);
    }
  });
  it('returns spins, MTTs, satellites including nonqualifiers, and legacy unknown formats to the lobby', () => {
    for (const result of [
      finish,
      { ...finish, formatKind: 'mtt' as const },
      { ...finish, formatKind: 'spin' as const },
      { ...finish, formatKind: 'sng' as const, isSpin: true },
      { ...finish, formatKind: 'sng' as const, isSatellite: true },
    ])
      expect(offersResultReplay(result)).toBe(false);
  });
});
