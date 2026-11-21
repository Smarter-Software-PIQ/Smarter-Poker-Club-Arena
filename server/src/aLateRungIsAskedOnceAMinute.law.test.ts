/**
 * A LATE RUNG IS ASKED AT LEAST ONCE A MINUTE (2026-11-19).
 *
 * Production Alerts incident `spin-ladder-rung-overshoot`. An all-horse Spin
 * whose rung window has closed asks the pool for one horse; when the pool is
 * busy it comes back short and backs off. The backoff used to run to ten
 * minutes, so the board that had waited longest asked least often and fresher
 * boards won every horse the pool freed. Board 2db5ea97 (window 08:13:48Z on
 * 2026-11-19) was seated one pass after its eighth ask, 1951 s after the window, while
 * other Spins were seated within seconds of asking. Six
 * SpinFleetProducingNothing criticals in seven days had this shape.
 *
 * This pins three things:
 *   1. the backoff never exceeds one minute, and still starts at 12 s and
 *      doubles (the 2026-09-02 load reason for backing off at all);
 *   2. the fast lane uses that function, not an inline formula with a
 *      ten-minute cap;
 *   3. the fast lane reads the boards oldest window first, so a freed horse
 *      is asked for by the board whose rung closed earliest;
 * and keeps the stuck alarm at about twelve minutes of shortness.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SEAT_FIRST_LADDER_BACKOFF_BASE_MS,
  SEAT_FIRST_LADDER_BACKOFF_MAX_MS,
  SPIN_LADDER,
  seatFirstLadderBackoffMs,
} from './config/seatFirstLadder.js';

const SRC = readFileSync(resolve(__dirname, 'GameServer.ts'), 'utf8');

function method(name: string): string {
  const start = SRC.indexOf(name);
  expect(start).toBeGreaterThan(0);
  const next = SRC.indexOf('\n  private ', start + name.length);
  return SRC.slice(start, next > 0 ? next : undefined);
}

/** The instants (ms after the window) at which a board that keeps missing asks. */
function askTimes(backoff: (misses: number) => number, untilMs: number): number[] {
  const out = [0];
  let misses = 1;
  while (out[out.length - 1] < untilMs) {
    out.push(out[out.length - 1] + backoff(misses));
    misses += 1;
  }
  return out;
}

describe('a late rung is asked at least once a minute', () => {
  it('starts at 12 s, doubles, and never waits more than a minute', () => {
    expect(SEAT_FIRST_LADDER_BACKOFF_BASE_MS).toBe(12_000);
    expect(SEAT_FIRST_LADDER_BACKOFF_MAX_MS).toBe(60_000);
    expect(seatFirstLadderBackoffMs(0)).toBe(12_000);
    expect(seatFirstLadderBackoffMs(1)).toBe(24_000);
    expect(seatFirstLadderBackoffMs(2)).toBe(48_000);
    for (let m = 3; m <= 1000; m++) expect(seatFirstLadderBackoffMs(m)).toBe(60_000);
    for (const bad of [-1, NaN, Infinity, -Infinity])
      expect(seatFirstLadderBackoffMs(bad)).toBe(12_000);
  });

  it('replays 2db5ea97: the ten-minute cap seated it 1951 s late; a horse freed at any instant is now asked for within a minute', () => {
    const old = (misses: number) => Math.min(12_000 * 2 ** Math.min(misses, 6), 10 * 60_000);
    const oldAsks = askTimes(old, 1_944_000);
    // The observed seat (08:46:19Z, 1951 s after the 08:13:48Z window) fell on
    // the old ladder's eighth ask (1944 s), one fast-lane pass later.
    expect(oldAsks.slice(0, 8)).toEqual([
      0, 24_000, 72_000, 168_000, 360_000, 744_000, 1_344_000, 1_944_000,
    ]);
    const newAsks = askTimes(seatFirstLadderBackoffMs, 1_944_000);
    const gaps = newAsks.slice(1).map((t, i) => t - newAsks[i]);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(60_000);
    // A rung's lateness from the ask alone is now a small fraction of every
    // rung's randomised span.
    for (const rung of SPIN_LADDER)
      expect(SEAT_FIRST_LADDER_BACKOFF_MAX_MS * 20).toBeLessThanOrEqual(rung.maxMs - rung.minMs);
  });

  it('the fast lane uses the bounded backoff, not the ten-minute formula', () => {
    const fill = method('private async fillPartialSeatFirstGame(');
    expect(fill).toContain('const interval = seatFirstLadderBackoffMs(misses);');
    expect(fill).not.toMatch(/10\s*\*\s*60_000/);
    expect(fill).not.toMatch(/2\s*\*\*\s*Math\.min\(misses/);
  });

  it('the fast lane reads the boards oldest window first', () => {
    const walk = method('private async discoverSeatFirstStarts(');
    const read = walk.slice(0, walk.indexOf('if (registeringErr)'));
    expect(read).toContain(".in('variant', ['spin', 'sng'])");
    expect(read).toContain(".order('start_time', { ascending: true, nullsFirst: false })");
  });

  it('the stuck alarm still waits about twelve minutes of shortness', () => {
    const m = SRC.match(/export const SEAT_FIRST_STUCK_AFTER_MISSES = (\d+);/);
    expect(m).not.toBeNull();
    const n = Number(m![1]);
    let span = 0;
    for (let i = 0; i < n - 1; i++) span += seatFirstLadderBackoffMs(i + 1);
    expect(span).toBeGreaterThanOrEqual(10 * 60_000);
    expect(span).toBeLessThanOrEqual(15 * 60_000);
  });
});
