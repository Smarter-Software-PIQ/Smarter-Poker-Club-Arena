/**
 * THE NEW TABLE'S PLAYERS ARRIVE BEFORE ITS CARDS (Dan 2026-11-10): "all at
 * once all the players appear and cards are dealt, instead of showing all
 * players as they arrive." The engine sends the arrival window its first
 * clock waits for; the opponents arrive one step apart inside it and the deal
 * starts after it. An engine that sends nothing keeps the old short ripple
 * and deals at once.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  nextSeatArrivals,
  SEAT_ARRIVAL_MAX_DELAY_MS,
  SEAT_ARRIVAL_STEP_MS,
} from '../../src/components/table/seatArrival';
import {
  LIGHTNING_ARRIVAL_FADE_MS,
  LIGHTNING_ARRIVAL_STEP_MS,
  lightningArrivalSpacing,
  lightningArrivalWindowMs,
} from '../../src/lightning/lightningTransitionMotion';

const empty = { scope: 'room', signature: '', known: [], serial: 0, arrivals: {} };
const table = [
  { id: 'hero', isHero: true },
  { id: 'a' },
  { id: 'b' },
  { id: 'c' },
  { id: 'd' },
  { id: 'e' },
];

describe('the new table arrives before its deal', () => {
  it('an engine window spaces every opponent inside it, one step apart', () => {
    const windowMs = 4 * LIGHTNING_ARRIVAL_STEP_MS + LIGHTNING_ARRIVAL_FADE_MS;
    const spacing = lightningArrivalSpacing(lightningArrivalWindowMs(windowMs));
    const ledger = nextSeatArrivals(empty, 'room', table, 7, spacing);
    const delays = Object.values(ledger.arrivals).map((a) => a.delayMs);
    expect(delays).toEqual([0, 120, 240, 360, 480]);
    // The last opponent has finished arriving when the window ends.
    expect(Math.max(...delays) + LIGHTNING_ARRIVAL_FADE_MS).toBeLessThanOrEqual(windowMs);
    // The hero is never an arrival: they are already seated.
    expect(ledger.arrivals[1]).toBeUndefined();
  });

  it('no window from the engine keeps the short ripple (an older engine deals at once)', () => {
    expect(lightningArrivalWindowMs(undefined)).toBe(0);
    expect(lightningArrivalWindowMs('660')).toBe(0);
    expect(lightningArrivalSpacing(0)).toBeNull();
    const ledger = nextSeatArrivals(empty, 'room', table, 7, null);
    expect(Math.max(...Object.values(ledger.arrivals).map((a) => a.delayMs))).toBe(
      Math.min(SEAT_ARRIVAL_MAX_DELAY_MS, 4 * SEAT_ARRIVAL_STEP_MS)
    );
  });

  it('the table page waits the engine window before the deal and spaces arrivals from the snapshot', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/pages/TablePage.tsx'), 'utf8');
    expect(page).toMatch(
      /\(lightningRoomRef\.current \? lightningArrivalWindowMs\(lightningArrivalMs\) : 0\)/
    );
    expect(page).toMatch(
      /pendingLightningArrivalMsRef\.current = lightningArrivalWindowMs\([\s\S]*?lightning_arrival_ms[\s\S]*?\);\s*scheduleDealPresentation\(startedHandNumber\);/
    );
    // Consumed once, so a recovery deal never waits a stale window.
    expect(page).toMatch(
      /const lightningArrivalMs = pendingLightningArrivalMsRef\.current;\s*pendingLightningArrivalMsRef\.current = 0;/
    );
    expect(page).toMatch(/lightningArrivalSpacing\(\s*lightningArrivalWindowMs\(/);
  });
});
