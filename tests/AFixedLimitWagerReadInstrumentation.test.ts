import { describe, expect, it } from 'vitest';
import {
  FIXED_LIMIT_PRESSURE_STATS,
  fixedLimitFullBetRead,
  fixedLimitProfileShowsPressure,
} from '../server/src/engine/HorseFixedLimitWagerRead.js';
import {
  OPPONENT_EXPLOIT_VERSION,
  type ExploitStat,
  type OpponentExploitRead,
  type StatRead,
} from '../server/src/engine/HorseOpponentExploit.js';

function makeStat(engaged: 'high' | 'low' | null = null, n = 30, mean = 0.3): StatRead {
  return {
    mean,
    n,
    engaged,
    excess: engaged ? 0.12 : 0,
  };
}

function makeProfile(opts: {
  engaged?: Partial<Record<ExploitStat, 'high' | 'low'>>;
  corroborated?: ExploitStat[];
  presumed?: boolean;
}): OpponentExploitRead {
  const stats = {
    vpip: makeStat(opts.engaged?.vpip ?? null),
    pfr: makeStat(opts.engaged?.pfr ?? null),
    rfi: makeStat(opts.engaged?.rfi ?? null),
    threeBet: makeStat(opts.engaged?.threeBet ?? null),
    foldTo3Bet: makeStat(opts.engaged?.foldTo3Bet ?? null),
    betCheckedTo: makeStat(opts.engaged?.betCheckedTo ?? null),
    foldToBet: makeStat(opts.engaged?.foldToBet ?? null),
    riverCall: makeStat(opts.engaged?.riverCall ?? null),
  };
  return {
    version: OPPONENT_EXPLOIT_VERSION,
    envelope: 'test-envelope',
    scope: 'holdem:short',
    stats,
    ...(opts.corroborated ? { corroborated: opts.corroborated } : {}),
    ...(opts.presumed ? { presumed: true } : {}),
  };
}

describe('fixedLimitFullBetRead pressure gating', () => {
  it('excludes vpip, foldToBet, and riverCall from pressure statistics', () => {
    expect(FIXED_LIMIT_PRESSURE_STATS).not.toContain('vpip');
    expect(FIXED_LIMIT_PRESSURE_STATS).not.toContain('foldToBet');
    expect(FIXED_LIMIT_PRESSURE_STATS).not.toContain('riverCall');
  });

  it('does NOT set strictPressureRange when corroborated only on vpip', () => {
    const vpipOnlyProfile = makeProfile({
      engaged: { vpip: 'high' },
      corroborated: ['vpip'],
    });
    expect(fixedLimitProfileShowsPressure(vpipOnlyProfile)).toBe(false);

    const read = { fullBet: false };
    const result = fixedLimitFullBetRead(read, 'bet', false, vpipOnlyProfile);

    // SPEC-FL-01 preserves structural fullBet: true when fixedLimitRiverFullBetRead is opted in,
    // while refusing to turn a vpip-only profile into strictPressureRange: true.
    expect(result.fullBet).toBe(true);
    expect(result.strictPressureRange).toBeUndefined();
  });

  it('does NOT set strictPressureRange on an uncorroborated presumed prior, over-folder, or passive caller', () => {
    const presumedProfile = makeProfile({
      engaged: { betCheckedTo: 'high', threeBet: 'high' },
      corroborated: ['threeBet'],
      presumed: true,
    });
    const overFolderProfile = makeProfile({
      engaged: { threeBet: 'high', foldToBet: 'high' },
      corroborated: ['threeBet'],
    });
    const passiveCallerProfile = makeProfile({
      engaged: { riverCall: 'high' },
      corroborated: ['riverCall'],
    });

    for (const profile of [presumedProfile, overFolderProfile, passiveCallerProfile, null]) {
      expect(fixedLimitProfileShowsPressure(profile)).toBe(false);
      const result = fixedLimitFullBetRead({ fullBet: false }, 'bet', false, profile);
      expect(result.fullBet).toBe(true);
      expect(result.strictPressureRange).toBeUndefined();
    }
  });

  it('flips a river bet read to fullBet and strictPressureRange when genuine pressure stats engage', () => {
    for (const stat of ['threeBet', 'betCheckedTo'] as const) {
      const profile = makeProfile({
        engaged: { [stat]: 'high' },
        corroborated: [stat],
      });
      expect(fixedLimitProfileShowsPressure(profile)).toBe(true);
      const result = fixedLimitFullBetRead({ fullBet: false }, 'bet', true, profile);
      expect(result.fullBet).toBe(true);
      expect(result.strictPressureRange).toBe(true);
      expect(result.highOnlyBoard).toBe(true);
    }

    const sticky3BetProfile = makeProfile({
      engaged: { foldTo3Bet: 'low' },
      corroborated: ['foldTo3Bet'],
    });
    expect(fixedLimitProfileShowsPressure(sticky3BetProfile)).toBe(true);
    const stickyResult = fixedLimitFullBetRead({ fullBet: false }, 'bet', false, sticky3BetProfile);
    expect(stickyResult.fullBet).toBe(true);
    expect(stickyResult.strictPressureRange).toBe(true);
    expect(stickyResult.highOnlyBoard).toBe(false);
  });

  it('always treats a structural river raise as a full bet and raised read', () => {
    const vpipOnlyProfile = makeProfile({
      engaged: { vpip: 'high' },
      corroborated: ['vpip'],
    });
    const result = fixedLimitFullBetRead({ fullBet: false }, 'raise', true, vpipOnlyProfile);
    expect(result.fullBet).toBe(true);
    expect(result.raised).toBe(true);
    expect(result.highOnlyBoard).toBe(true);
    expect(result.strictPressureRange).toBe(true);
  });
});
