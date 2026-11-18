import { describe, expect, it } from 'vitest';
import { fixedLimitFullBetRead } from '../server/src/engine/HorseFixedLimitWagerRead.js';
import type { OpponentExploitRead } from '../server/src/engine/HorseOpponentExploit.js';
import { OPPONENT_EXPLOIT_VERSION } from '../server/src/engine/HorseOpponentExploit.js';

describe('fixedLimitFullBetRead', () => {
  it('applies strictPressureRange when profile is engaged', () => {
    const mockProfile: OpponentExploitRead = {
      version: OPPONENT_EXPLOIT_VERSION,
      envelope: 'envelope',
      scope: 'scope' as any,
      stats: {} as any,
      corroborated: ['vpip']
    };
    
    const read = { fullBet: false };
    const result = fixedLimitFullBetRead(read, 'bet', false, mockProfile);
    
    expect(result.strictPressureRange).toBe(true);
    expect(result.fullBet).toBe(true);
  });
});
