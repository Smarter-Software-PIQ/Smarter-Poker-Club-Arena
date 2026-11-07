import { describe, expect, it } from 'vitest';
import {
  isPlatformFrozenError,
  PLATFORM_FROZEN_MESSAGE,
  platformFrozenMessage,
} from '../src/utils/platformFrozen';

// Dan, 2026-11-07: "I JUST TRIED TO JOIN NO LIMIT AND PLO LIGHTNING, AND FAILED
// TO JOIN BOTH". Both joins landed inside an owner-ordered engine cutover
// (frozen 13:16:37 to 13:21:37 Chicago). The refusal was correct; the sentence
// told him the break was scheduled and to come back at the top of the hour.
// A freeze can start at any minute, so the player line names no clock time.
describe('a maintenance refusal names no clock time', () => {
  it('never promises the top of the hour or calls every break scheduled', () => {
    expect(PLATFORM_FROZEN_MESSAGE).not.toMatch(/top of the hour/i);
    expect(PLATFORM_FROZEN_MESSAGE).not.toMatch(/scheduled/i);
    expect(PLATFORM_FROZEN_MESSAGE).not.toMatch(/\b\d{1,2}:\d{2}\b|:\d{2}\b/);
  });

  it('still says it is a short break, nothing is lost, and to retry in minutes', () => {
    expect(PLATFORM_FROZEN_MESSAGE).toContain('Short Maintenance Break');
    expect(PLATFORM_FROZEN_MESSAGE).toContain('Nothing Is Lost');
    expect(PLATFORM_FROZEN_MESSAGE).toContain('Try Again In A Few Minutes');
    expect(PLATFORM_FROZEN_MESSAGE).not.toMatch(/[–—]/);
  });

  it('is the line for the exact refusal the Lightning rejoin door raised', () => {
    // PostgREST shape of fn_lightning_rejoin_seated's RAISE 'PLATFORM_FROZEN'.
    const refusal = { code: 'P0001', message: 'PLATFORM_FROZEN', details: null, hint: null };
    expect(isPlatformFrozenError(refusal)).toBe(true);
    expect(platformFrozenMessage(refusal)).toBe(PLATFORM_FROZEN_MESSAGE);
    expect(platformFrozenMessage({ code: '55006', message: 'x' })).toBe(PLATFORM_FROZEN_MESSAGE);
  });
});
