import { describe, expect, it } from 'vitest';
import {
  publicMemoryDomainFromRules,
  publicMemoryDomainIsValid,
  publicMemoryDomainKey,
} from './HorsePublicMemoryDomain.js';
describe('original public rule domain', () => {
  it('requires explicit known original rules and does not infer absent antes', () => {
    expect(publicMemoryDomainFromRules('table', undefined, false)).toBeNull();
    expect(publicMemoryDomainFromRules('table', 0, undefined)).toBeNull();
    for (const ante of [-1, NaN, Infinity, '0'])
      expect(publicMemoryDomainFromRules('table', ante, false)).toBeNull();
    expect(publicMemoryDomainKey(publicMemoryDomainFromRules('table', 0, true))).toBe('table:none');
    expect(publicMemoryDomainKey(publicMemoryDomainFromRules('lightning', 1, false))).toBe(
      'lightning:individual'
    );
    expect(publicMemoryDomainKey(publicMemoryDomainFromRules('table', 1, true))).toBe(
      'table:big_blind'
    );
  });
  it('rejects unknown versions and additional private or mutable context', () => {
    const d = { version: 1, speed: 'table', ante: 'none' };
    for (const value of [
      null,
      [],
      1,
      { ...d, version: 2 },
      { ...d, speed: 'fast' },
      { ...d, holeCards: [] },
    ])
      expect(publicMemoryDomainIsValid(value)).toBe(false);
    expect(publicMemoryDomainKey({ ante: 'none', speed: 'table', version: 1 })).toBe(
      publicMemoryDomainKey(d)
    );
  });
});
