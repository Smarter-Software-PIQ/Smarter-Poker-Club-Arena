/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FLOOR IS FULL — Dan 2026-09-02
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Verbatim: "HORSES CAN FILL ALL SEATS, AND ONLY 'GET UP' WHEN A REAL HUMAN IS
 * ON THE WAITING LIST FOR 75% OF ALL GAMES. THE OTHER 25% OF GAMES SHOULD HAVE
 * ANYWHERE FROM ONE, TO A FULL GAME. IT SHOULD BE SPARATIC, BUT HORSES NEED TO
 * BE OCCUPYING AT LEAST 75% OF ALL SEATS IN THE CASH GAMES, AND THEY SHOULD BE
 * PLAYING 4 TABLES AT ONCE!"
 *
 * This file used to pin the rule this one replaces: the five-way vibe drift
 * (hot / busy / steady / quiet / empty) from 2026-08-23, plus the 15% of cash
 * tables held empty from 2026-08-26. Both were Dan's, both are superseded, and
 * both are gone rather than left to argue with the new rule - a floor where
 * three quarters of tables sit 2-5 seats short by construction cannot reach
 * 75% occupancy no matter how many horses exist.
 *
 * The pins below are the new law's three moving parts: the 75/25 split, the
 * sparse quarter's one-to-full range, and the queue being the only thing that
 * opens a seat.
 */

import { describe, it, expect } from 'vitest';
import {
  cashTableFill,
  occupancyTargetFor,
  wantsTableChange,
  gameLaneFor,
  CASH_FULL_FRACTION,
  FILL_BUCKET_MS,
} from './HorseBehavior.js';

const tables = Array.from({ length: 400 }, (_, i) => `tbl-${i}-${i * 7919}`);
const T0 = 1_700_000_000_000;

describe('the floor is mostly full, never uniformly full (Dan 2026-11-06)', () => {
  it('splits the room 40/40/20 full/short/sporadic, and all three occur', () => {
    const count = (k: string) => tables.filter((id) => cashTableFill(id, T0) === k).length;
    const full = count('full') / tables.length;
    const short = count('short') / tables.length;
    const sporadic = count('sporadic') / tables.length;
    expect(full).toBeGreaterThan(0.32);
    expect(full).toBeLessThan(0.48);
    expect(short).toBeGreaterThan(0.32);
    expect(short).toBeLessThan(0.48);
    expect(sporadic).toBeGreaterThan(0.13);
    expect(sporadic).toBeLessThan(0.27);
    expect(CASH_FULL_FRACTION).toBe(0.4);
  });

  it('still seats at least 75% of the floor (Dan 2026-09-02 floor)', () => {
    for (const max of [9, 6]) {
      let seats = 0;
      for (const id of tables) seats += occupancyTargetFor(id, max, false, T0).seatTarget;
      expect(seats / (tables.length * max)).toBeGreaterThanOrEqual(0.75);
    }
  });

  it('a short table always has an open seat, and a full one a 1-4 horse line', () => {
    for (const id of tables) {
      const t9 = occupancyTargetFor(id, 9, false, T0);
      if (t9.fill === 'short') {
        expect(t9.seatTarget).toBeGreaterThanOrEqual(7);
        expect(t9.seatTarget).toBeLessThanOrEqual(8);
        expect(occupancyTargetFor(id, 6, false, T0).seatTarget).toBe(5);
      }
      if (t9.fill === 'full') {
        expect(t9.waitTarget).toBeGreaterThanOrEqual(1);
        expect(t9.waitTarget).toBeLessThanOrEqual(4);
      } else {
        expect(t9.waitTarget).toBe(0);
      }
    }
  });

  it('holds a table still for hours rather than flickering', () => {
    /* A character that re-rolls every few minutes makes horses stand up and
       sit down for no reason a watching player can see. Same instant, same
       answer; same bucket, same answer. */
    const id = tables[3];
    const start = Math.floor(T0 / FILL_BUCKET_MS) * FILL_BUCKET_MS;
    for (const offset of [0, 1, 60_000, FILL_BUCKET_MS - 1]) {
      expect(cashTableFill(id, start + offset)).toBe(cashTableFill(id, start));
    }
    expect(FILL_BUCKET_MS).toBeGreaterThanOrEqual(60 * 60_000);
  });

  it('re-rolls each bucket independently instead of walking the band', () => {
    /* horseHash is a weak multiply-add: fold a consecutive bucket number in
       and the hash advances by about +1 per bucket, so a table WALKS through
       the band one step at a time and stays on one side of it for a day. That
       bug took a whole variant's room dark for thirty hours when this was the
       held-empty rule. The murmur3 finalizer is what stops it, and this is the
       pin that proves it is still there. */
    const id = tables[11];
    const seen = new Set<string>();
    for (let b = 0; b < 40; b++) seen.add(cashTableFill(id, T0 + b * FILL_BUCKET_MS));
    expect(seen.size).toBe(3);
  });
});

describe('a full table wants every seat, a sparse one wants one to all of them', () => {
  it('asks for every seat on a full table', () => {
    const full = tables.filter((id) => cashTableFill(id, T0) === 'full');
    for (const id of full.slice(0, 40)) {
      expect(occupancyTargetFor(id, 9, false, T0).seatTarget).toBe(9);
      expect(occupancyTargetFor(id, 6, false, T0).seatTarget).toBe(6);
    }
  });

  it('never asks a sparse table for fewer than one, or more than all', () => {
    const sparse = tables.filter((id) => cashTableFill(id, T0) === 'sporadic');
    expect(sparse.length).toBeGreaterThan(0);
    const targets = sparse.map((id) => occupancyTargetFor(id, 9, false, T0).seatTarget);
    for (const t of targets) {
      expect(t).toBeGreaterThanOrEqual(1);
      expect(t).toBeLessThanOrEqual(9);
    }
    // Sporadic means SPORADIC - more than one distinct answer across the set.
    expect(new Set(targets).size).toBeGreaterThan(1);
  });

  it('never leaves a table with nobody at it', () => {
    /* The rule this replaced held 15% of tables at ZERO. Dan's floor for the
       sparse quarter is ONE: a table always has somebody at it. */
    for (const id of tables) {
      expect(occupancyTargetFor(id, 9, false, T0).seatTarget).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps a human company even on a sparse table', () => {
    const sparse = tables.filter((id) => cashTableFill(id, T0) === 'sporadic');
    for (const id of sparse.slice(0, 25)) {
      expect(occupancyTargetFor(id, 9, true, T0).seatTarget).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('a queue is the only thing that opens a seat', () => {
  it('gives up exactly one seat per person waiting', () => {
    const full = tables.filter((id) => cashTableFill(id, T0) === 'full')[0];
    expect(occupancyTargetFor(full, 9, false, T0, 0).seatTarget).toBe(9);
    expect(occupancyTargetFor(full, 9, false, T0, 1).seatTarget).toBe(8);
    expect(occupancyTargetFor(full, 9, false, T0, 3).seatTarget).toBe(6);
  });

  it('never empties the game the person queued for', () => {
    const full = tables.filter((id) => cashTableFill(id, T0) === 'full')[0];
    expect(occupancyTargetFor(full, 9, false, T0, 99).seatTarget).toBe(1);
  });

  it('a human waiting empties the horse line (Dan 2026-11-06)', () => {
    /* Horses queue on a full game again, but never in front of a person: a
       human on the list zeroes waitTarget so the release opens a chair for
       them, not for a horse ahead of them in line. */
    for (const id of tables.slice(0, 50)) {
      expect(occupancyTargetFor(id, 9, false, T0, 1).waitTarget).toBe(0);
      expect(occupancyTargetFor(id, 9, true, T0, 2).waitTarget).toBe(0);
    }
  });
});

describe('the traits that did not change', () => {
  it('still lets a horse fancy a change of game', () => {
    // Table-hopping is not gone - it is gated to the sparse quarter by the
    // rotator. The behaviour itself must still exist, or that gate is moot.
    let moved = 0;
    for (const id of tables) {
      for (let m = 20; m < 200; m += 20) {
        if (wantsTableChange(`horse-${id}`, id, 3, m, T0)) moved++;
      }
    }
    expect(moved).toBeGreaterThan(0);
  });

  it('still keeps a third of the stable out of cash games entirely', () => {
    const lanes = tables.map((id) => gameLaneFor(`horse-${id}`));
    expect(lanes.filter((l) => l === 'events').length).toBeGreaterThan(0);
    expect(lanes.filter((l) => l === 'cash').length).toBeGreaterThan(0);
    expect(lanes.filter((l) => l === 'both').length).toBeGreaterThan(0);
  });
});
