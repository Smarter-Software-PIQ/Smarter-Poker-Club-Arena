/**
 * STYLE READ wiring (2026-11-13): every completed-hand sender gives the worker the hand's own format, and the worker
 * prefers it over the exact-context profile rows (M1, F1, L-c).
 */
import { describe, expect, it } from 'vitest';
import {
  buildLightningObservation,
  type LightningObservedHand,
} from '../../lightning/LightningHorseObservation.js';
import { styleMemoryModeOf } from './workerRuntime.js';

const hand = (
  publicMemoryDomain: LightningObservedHand['publicMemoryDomain'],
  hasHuman?: boolean
): LightningObservedHand => ({
  publicMemoryDomain,
  hostTableId: 'lt-1',
  handNumber: 7,
  leaseGeneration: null,
  handHistoryId: 'aaaaaaaa-0000-4000-8000-000000000001',
  variant: 'nlh',
  bigBlind: 2,
  dealtCount: 6,
  actions: [],
  showdown: [],
  ...(hasHuman === undefined ? {} : { hasHuman }),
});

describe('styleMemoryMode wiring', () => {
  it('F1: a Lightning hand with a valid public domain is cash for the style learner, with no durable row', () => {
    const o = buildLightningObservation(
      hand({ version: 1, speed: 'lightning', ante: 'none' }, true),
      undefined
    );
    expect(o.styleMemoryMode).toBe('cash');
    expect(o.styleHasHuman).toBe(true);
    expect(o).not.toHaveProperty('durableOpponentProfiles');
    expect(styleMemoryModeOf(o)).toBe('cash');
  });
  it('a missing or malformed domain sends no format', () => {
    expect(buildLightningObservation(hand(null), undefined)).not.toHaveProperty('styleMemoryMode');
    expect(buildLightningObservation(hand({ version: 2 } as never), undefined)).not.toHaveProperty(
      'styleMemoryMode'
    );
  });
  it("the worker prefers the hand's format over the profile rows, and falls back for an older sender", () => {
    expect(
      styleMemoryModeOf({
        styleMemoryMode: 'cash',
        durableOpponentProfiles: [{ mode: 'tournament' }],
      })
    ).toBe('cash');
    expect(styleMemoryModeOf({ durableOpponentProfiles: [{ mode: 'tournament' }] })).toBe(
      'tournament'
    );
    expect(styleMemoryModeOf({})).toBeUndefined();
  });
});
