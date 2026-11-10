/**
 * THE MOVE TO THE NEXT LIGHTNING TABLE IS ONE MOTION (Dan 2026-11-09).
 *
 * Dan, verbatim: "when you are playing lightning games, the transition to the
 * new table needs to smoother, it feels rough and glitchy."
 *
 * Four faults, read from the code that drew them:
 *
 *   1. A hand played to its end had no exit. Only a fold marked the felt as
 *      leaving; a finished table sat at full strength and was swapped for the
 *      next one in a single frame.
 *   2. The exit fade took the whole hold, so a next hand landing inside the
 *      hold cut it off: half-faded opponents snapped back to full strength
 *      wearing new faces.
 *   3. The pot was not in the fade and vanished in one frame at the end of it.
 *   4. The new table did not arrive as a table. A player met before who was
 *      dealt the same chair cut in at full strength while the seats around
 *      them faded in one by one, the last of them 400 ms after the first.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  nextSeatArrivals,
  SEAT_ARRIVAL_MAX_DELAY_MS,
  SEAT_ARRIVAL_STEP_MS,
} from '../../src/components/table/seatArrival';
import {
  LIGHTNING_EXIT_HOLD_BASE_MS,
  lightningFeltLeaving,
} from '../../src/lightning/lightningTransitionMotion';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const PAGE = read('src/pages/TablePage.tsx');
const CSS = read('src/components/table/LightningFoldBar.css');

const player = (id: string, isHero = false) => ({ id, isHero });
const EMPTY = { scope: '', signature: '', known: [], serial: 0, arrivals: {} };

describe('1. every table has an exit, not only a folded one', () => {
  it('the felt is leaving during the fold hold and once its hand is over', () => {
    const base = { lightningRoom: true, observer: false, exitHoldMs: 0, handIsOver: false };
    expect(lightningFeltLeaving(base)).toBe(false);
    expect(lightningFeltLeaving({ ...base, exitHoldMs: 500 })).toBe(true);
    expect(lightningFeltLeaving({ ...base, handIsOver: true })).toBe(true);
  });
  it('never at a Classic table, and an observer only ever follows the hold', () => {
    expect(
      lightningFeltLeaving({
        lightningRoom: false,
        observer: false,
        exitHoldMs: 500,
        handIsOver: true,
      })
    ).toBe(false);
    expect(
      lightningFeltLeaving({ lightningRoom: true, observer: true, exitHoldMs: 0, handIsOver: true })
    ).toBe(false);
  });
  it('the page feeds it the hand-bound completion latch, which a new hand ends', () => {
    expect(PAGE).toMatch(
      /lightningFeltLeaving\(\{\s*lightningRoom: !!lightningRoom,\s*observer: lightningObserver,\s*exitHoldMs: lightningExitMs,\s*handIsOver: tableHandIsOver,/
    );
    // The latch names one hand number: it stops applying when the next deals.
    expect(PAGE).toMatch(
      /const tableHandIsOver =\s*finishedHand !== null && \(tableState\.handNumber \?\? 0\) === finishedHand\.handNumber;/
    );
  });
});

describe('2 and 3. the table clears early, pot included, and stays clear', () => {
  const rule = CSS.slice(
    CSS.indexOf(".table-page[data-lightning-exit='true'] .seat:not(.seat--hero),"),
    CSS.indexOf('@keyframes lightningFeltExit')
  );
  it('opponents, board and pot share one fade; the hero’s own seat is left to its muck', () => {
    expect(rule).toContain(".table-page[data-lightning-exit='true'] .seat:not(.seat--hero),");
    expect(rule).toContain(".table-page[data-lightning-exit='true'] .community-cards,");
    expect(rule).toContain(".table-page[data-lightning-exit='true'] .pot-area {");
  });
  it('the fade ends well inside the hold and holds its last frame', () => {
    const m = rule.match(
      /lightningFeltExit calc\(([\d.]+)s \* var\(--animation-speed, 1\)\) ease-out forwards;/
    );
    expect(m).not.toBeNull();
    const fadeMs = Number(m![1]) * 1000;
    // Animation Speed scales both, so the ratio holds at every speed.
    expect(fadeMs).toBeLessThanOrEqual(LIGHTNING_EXIT_HOLD_BASE_MS * 0.6);
    expect(fadeMs).toBeGreaterThanOrEqual(150);
  });
  it('the pot area the rule names is the one the felt renders', () => {
    expect(PAGE).toContain('<div className="pot-area">');
  });
});

describe('4. the new table arrives as one table', () => {
  const roster = [player('hero', true), player('a'), player('b'), player('c')];
  it('a player met before in the same chair arrives with a new table', () => {
    const first = nextSeatArrivals(EMPTY, 'room', roster, 101);
    expect(Object.keys(first.arrivals)).toEqual(['2', '3', '4']);
    const idle = nextSeatArrivals(first, 'room', [], 101);
    const next = nextSeatArrivals(
      idle,
      'room',
      [player('hero', true), player('a'), player('x'), player('c')],
      102
    );
    expect(Object.keys(next.arrivals)).toEqual(['2', '3', '4']);
    // Fresh arrivals, not the ones the last table already played.
    for (const seat of [2, 3, 4])
      expect(next.arrivals[seat].key).not.toBe(first.arrivals[seat].key);
    expect(next.arrivals[1]).toBeUndefined(); // the hero never fades
  });
  it('a table swapped with no idle frame between arrives whole too', () => {
    const first = nextSeatArrivals(EMPTY, 'room', roster, 101);
    const next = nextSeatArrivals(
      first,
      'room',
      [player('hero', true), player('a'), player('b'), player('z')],
      102
    );
    for (const seat of [2, 3, 4])
      expect(next.arrivals[seat].key).not.toBe(first.arrivals[seat].key);
  });
  it('an epoch that moves ahead of its roster never replays the leaving table', () => {
    const first = nextSeatArrivals(EMPTY, 'room', roster, 101);
    // The hand number changed; the roster on the felt is still the old one.
    expect(nextSeatArrivals(first, 'room', roster, 102)).toBe(first);
    // ...and the roster that follows is still the new table.
    const next = nextSeatArrivals(
      first,
      'room',
      [player('hero', true), player('a'), player('b'), player('z')],
      102
    );
    for (const seat of [2, 3, 4])
      expect(next.arrivals[seat].key).not.toBe(first.arrivals[seat].key);
  });
  it('inside one hand, and at a table that passes no epoch, the old rule stands', () => {
    const first = nextSeatArrivals(EMPTY, 'room', roster, 101);
    const sameHand = nextSeatArrivals(
      first,
      'room',
      [player('hero', true), player('a'), player('b'), player('z')],
      101
    );
    // Chairs 2 and 3 keep the arrival they already played; only 4 is new.
    expect(sameHand.arrivals[2]).toBe(first.arrivals[2]);
    expect(sameHand.arrivals[3]).toBe(first.arrivals[3]);
    expect(sameHand.arrivals[4].key).not.toBe(first.arrivals[4].key);
    const classic = nextSeatArrivals(EMPTY, 'room', roster);
    const classicNext = nextSeatArrivals(classic, 'room', [
      player('hero', true),
      player('a'),
      player('b'),
      player('z'),
    ]);
    expect(classicNext.arrivals[2]).toBe(classic.arrivals[2]);
    expect(classicNext.arrivals[3]).toBe(classic.arrivals[3]);
    expect(classicNext.arrivals[4].playerId).toBe('z');
  });
  it('the ripple is short: the last chair starts 160 ms after the first', () => {
    expect(SEAT_ARRIVAL_STEP_MS).toBe(40);
    expect(SEAT_ARRIVAL_MAX_DELAY_MS).toBe(160);
    const nine = nextSeatArrivals(
      EMPTY,
      'room',
      [player('hero', true), ...'abcdefgh'.split('').map((id) => player(id))],
      1
    );
    const delays = Object.values(nine.arrivals).map((a) => a.delayMs);
    expect(delays).toEqual([0, 40, 80, 120, 160, 160, 160, 160]);
  });
  it('only a Lightning room passes its hand number as the epoch', () => {
    expect(PAGE).toMatch(
      /useSeatArrivals\(\s*tableId \?\? '',\s*lightningRoom \? tableState\.players : \[\],\s*lightningRoom \? \(tableState\.handNumber \?\? null\) : null,\s*\/\*[^*]*\*\/\s*lightningRoom\s*\?\s*lightningArrivalSpacing\(/
    );
  });
});
