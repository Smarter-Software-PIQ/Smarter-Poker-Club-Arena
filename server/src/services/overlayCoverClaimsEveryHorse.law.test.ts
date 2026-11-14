import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  OVERLAY_CALL_TTL_MS,
  callHorsesFromCash,
  overlayCallAnswered,
  overlayCalled,
  overlayCashCallList,
  resetOverlayCalls,
} from './horseOverlayCover.js';
import { HORSE_MAX_CASH_TABLES } from './HorseGameLoad.js';
import { OVERLAY_RESCUE_WINDOW_MS } from './horseOverlayRescue.js';

const read = (file: string) => readFileSync(join(__dirname, file), 'utf8');

describe('overlay cover has first claim on every horse (owner 2026-11-13)', () => {
  beforeEach(() => resetOverlayCalls());

  it('a call stands for a few minutes, then lapses, and is cleared once answered', () => {
    const now = 1_000_000;
    expect(callHorsesFromCash(['a', 'b', ''], now)).toBe(2);
    expect(overlayCalled('a', now)).toBe(true);
    expect(overlayCalled('c', now)).toBe(false);
    overlayCallAnswered('a');
    expect(overlayCalled('a', now)).toBe(false);
    expect(overlayCalled('b', now + OVERLAY_CALL_TTL_MS - 1)).toBe(true);
    expect(overlayCalled('b', now + OVERLAY_CALL_TTL_MS)).toBe(false);
  });

  it('calls twice the seats still missing, in order, and nobody when nothing is missing', () => {
    expect(overlayCashCallList(['a', 'b', 'c', 'd', 'e'], 2)).toEqual(['a', 'b', 'c', 'd']);
    expect(overlayCashCallList(['a', 'b'], 0)).toEqual([]);
    expect(overlayCashCallList(['a'], 5)).toEqual(['a']);
  });

  it('the rescue window is twenty minutes and a horse plays two cash tables', () => {
    expect(OVERLAY_RESCUE_WINDOW_MS).toBe(20 * 60_000);
    expect(HORSE_MAX_CASH_TABLES).toBe(2);
  });

  it('the registration pool waives the rest day and the activity window for overlay cover', () => {
    const src = read('TournamentRecurringService.ts');
    const filter = src.slice(
      src.indexOf('const eligible = poolAll.filter'),
      src.indexOf('const freerollRecoveryPriority')
    );
    const waiver = filter.indexOf('if (overlayCover) return true;');
    expect(waiver).toBeGreaterThan(0);
    // The waiver sits before both schedule gates, and after the club gate.
    expect(waiver).toBeLessThan(filter.indexOf('isRestDayFor('));
    expect(waiver).toBeLessThan(filter.indexOf('isActiveNow('));
    expect(waiver).toBeGreaterThan(filter.indexOf('clubDropped++'));
  });

  it('the guard asks for everything still missing in the window, with no per-cycle ceiling', () => {
    const src = read('HorseOverlayGuard.ts');
    const late = src.slice(src.indexOf('export async function lateRegisterHorsesOnce'));
    expect(late).toContain('const closing = overlayCover && horseOverlayRescueDue(t, nowMs);');
    expect(late).toContain('if (closing) want = Math.max(want, missing);');
    expect(late.slice(0, late.indexOf('/** One full cycle:'))).not.toContain('MAX_TOPUP_PER_CYCLE');
    expect(late).toContain('overlayCover: true');
  });

  it('the rotator sends a called or over-ceiling horse through the ordinary leave door', () => {
    const src = read('HorseSessionRotator.ts');
    expect(src).toContain('cashHeld > HORSE_MAX_CASH_TABLES');
    expect(src).toContain('overlayCalled(uid, dutyNowMs)');
    expect(src).toContain('overlayCallAnswered(uid)');
  });
});
