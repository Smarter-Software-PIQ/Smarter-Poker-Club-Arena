/**
 * A FEEDER NEVER OUTLIVES ITS TARGET (2026-11-09).
 *
 * The waiting ladder gave a heads-up satellite feeder the 3-to-4-hour regular
 * Heads-Up rung, because a feeder is two seats and `ladderForSeats` reads
 * seats. Two consequences, and the second is the one that matters:
 *
 *  - a feeder is NOT one of the eleven Spins or six Sit and Gos the ladder
 *    paces; `seatFirstBoardRoom` excludes every row with a satellite target
 *    from that count, so the ladder was pacing a board by a quota it is not
 *    part of;
 *  - a feeder sold a seat in ONE event. Waiting hours lets its target start
 *    first, and `fn_ca_expire_empty_fixed_sng_satellite` cannot clean that up
 *    because the ladder seats a horse immediately and the reaper only takes
 *    an EMPTY feeder (`not_empty_registering`).
 *
 * The four cases below are the target's four states.
 */
import { describe, it, expect } from 'vitest';
import {
  FEEDER_OPENING_MIN_MS,
  FEEDER_OPENING_MAX_MS,
  SNG_LADDER,
  feederWaitMs,
  ladderForSeats,
} from './seatFirstLadder.js';

/** The lead the platform already requires for this format, passed by the service. */
const LEAD_MS = 30 * 60 * 1000;
const NOW = Date.parse('2026-11-09T15:00:00.000Z');
const mid = (span: number) => Math.floor(span / 2);
const lowest = () => 0;
const highest = (span: number) => span;

describe('a feeder never outlives its target', () => {
  it('APPROACHING: a target hours away gets the short window, never the heads-up rung', () => {
    const targetStart = NOW + 4 * 60 * 60 * 1000;
    const wait = feederWaitMs(NOW, targetStart, LEAD_MS, mid);
    expect(wait).not.toBeNull();
    expect(wait!).toBeGreaterThanOrEqual(FEEDER_OPENING_MIN_MS);
    expect(wait!).toBeLessThanOrEqual(FEEDER_OPENING_MAX_MS);
    // The regression, pinned: the heads-up rung is hours and must not apply.
    expect(ladderForSeats(2)).toEqual(SNG_LADDER);
    expect(SNG_LADDER[0].minMs).toBeGreaterThan(FEEDER_OPENING_MAX_MS);
    expect(wait!).toBeLessThan(SNG_LADDER[0].minMs);
  });

  it('APPROACHING but tight: the wait is cut to the room left, not to the band', () => {
    // 4 minutes of room after the required lead; the band alone would be longer.
    const targetStart = NOW + LEAD_MS + 4 * 60 * 1000;
    const wait = feederWaitMs(NOW, targetStart, LEAD_MS, highest);
    expect(wait).toBe(4 * 60 * 1000);
    expect(wait!).toBeLessThan(FEEDER_OPENING_MAX_MS);
  });

  it('STARTED: a target already under way yields null, so nothing opens and nothing waits', () => {
    expect(feederWaitMs(NOW, NOW - 1, LEAD_MS, mid)).toBeNull();
    expect(feederWaitMs(NOW, NOW, LEAD_MS, mid)).toBeNull();
    // Inside the required lead is also too late: the feeder still has to play.
    expect(feederWaitMs(NOW, NOW + LEAD_MS - 1, LEAD_MS, mid)).toBeNull();
    expect(feederWaitMs(NOW, NOW + LEAD_MS, LEAD_MS, mid)).toBeNull();
  });

  it('CLOSED or unknown: a target with no readable clock is refused, because not knowing is not permission', () => {
    expect(feederWaitMs(NOW, Number.NaN, LEAD_MS, mid)).toBeNull();
    expect(feederWaitMs(NOW, Number.POSITIVE_INFINITY, LEAD_MS, mid)).toBeNull();
    expect(feederWaitMs(Number.NaN, NOW + 10 * 60 * 60 * 1000, LEAD_MS, mid)).toBeNull();
    expect(feederWaitMs(NOW, NOW + 10 * 60 * 60 * 1000, Number.NaN, mid)).toBeNull();
    expect(feederWaitMs(NOW, NOW + 10 * 60 * 60 * 1000, -1, mid)).toBeNull();
  });

  it('RESCHEDULED: the bound follows the target, later and earlier', () => {
    const tight = NOW + LEAD_MS + 60 * 1000;
    expect(feederWaitMs(NOW, tight, LEAD_MS, highest)).toBe(60 * 1000);

    // Pushed back by two hours: the band applies again, unbound by the target.
    const pushedBack = tight + 2 * 60 * 60 * 1000;
    const after = feederWaitMs(NOW, pushedBack, LEAD_MS, highest);
    expect(after).toBe(FEEDER_OPENING_MAX_MS);

    // Pulled forward inside the lead: the feeder stops waiting altogether.
    expect(feederWaitMs(NOW, NOW + 60 * 1000, LEAD_MS, highest)).toBeNull();
  });

  it('the whole band is reachable, so feeders do not mature in lockstep', () => {
    const targetStart = NOW + 8 * 60 * 60 * 1000;
    expect(feederWaitMs(NOW, targetStart, LEAD_MS, lowest)).toBe(FEEDER_OPENING_MIN_MS);
    expect(feederWaitMs(NOW, targetStart, LEAD_MS, highest)).toBe(FEEDER_OPENING_MAX_MS);
  });

  it('an undeliverable feeder is a null WAIT, which the caller must not read as "keep waiting"', () => {
    /* feederWaitMs answers only the question it is asked: how long may this
       feeder still wait. null means "not at all". What to DO about a feeder
       that already holds a paid entrant is the caller's decision, and
       GameServer.seatFirstNextWaitMs deals it now (0) so the existing
       satellite settlement authorities resolve custody, rather than leaving
       its window in the past to be re-asked every twelve seconds for ever.
       fn_ca_expire_empty_fixed_sng_satellite cannot resolve that one: it takes
       an EMPTY feeder, and the opening horse means a feeder is never empty
       after creation. This pins the contract the caller relies on. */
    expect(feederWaitMs(NOW, NOW - 60 * 1000, LEAD_MS, mid)).toBeNull();
    expect(feederWaitMs(NOW, NOW + LEAD_MS, LEAD_MS, mid)).toBeNull();
    // and it is never a zero-length wait by accident, which would be
    // indistinguishable from "deal now" at the call site
    const wait = feederWaitMs(NOW, NOW + LEAD_MS + 1000, LEAD_MS, mid);
    expect(wait).toBe(1000);
    expect(wait).toBeGreaterThan(0);
  });

  it('never returns a wait that reaches the target, at any draw', () => {
    const targetStart = NOW + LEAD_MS + 7 * 60 * 1000;
    for (const rand of [lowest, mid, highest]) {
      const wait = feederWaitMs(NOW, targetStart, LEAD_MS, rand);
      expect(wait).not.toBeNull();
      expect(NOW + wait! + LEAD_MS).toBeLessThanOrEqual(targetStart);
    }
  });
});
