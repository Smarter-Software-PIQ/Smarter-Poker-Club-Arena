/**
 * A LONG MEMORY OF SHOWN RIVER STRENGTH: the engine's half (2026-11-15).
 *
 * The record's arithmetic (the TypeScript twin of public.fn_horse_shown_river_add), its validator, its read, its
 * frame row and the dedupe rule against the in-process 72-hour buckets. The increments are pinned on the same fixed
 * vectors the isolated PostgreSQL proof (scripts/ci/test-horse-exact-public-memory.py) runs through the SQL learner,
 * built here from the engine's own replay (riverFirstBetFractions, sizeBucketOf, STYLE_STRONG_HAND_NAMES) and from the
 * boot rebuild (sizeBucketsFromHistory), so the database and the engine count the same public facts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SHOWN_RIVER_BUCKETS,
  SHOWN_RIVER_DECAY,
  SHOWN_RIVER_HALF_LIFE_SHOWN,
  SHOWN_RIVER_ROW_LENGTH,
  SHOWN_RIVER_WINDOW_MS,
  addShownRiverEvidence,
  mergeLongShownBuckets,
  shownRiverReadFromRow,
  shownRiverReadOf,
  shownRiverRow,
  validShownRiverRecord,
  type ShownRiverIncrement,
  type ShownRiverRecord,
} from './HorseLongShownMemory.js';
import {
  SIZE_BUCKETS,
  STYLE_STRONG_HAND_NAMES,
  riverFirstBetFractions,
  sizeBucketOf,
  sizeBucketsFromHistory,
} from './HorseOpponentStyle.js';
import { copyShownRiver, validOpponentProfile } from './HorseOpponentMemory.js';
import { freshExploitCounters } from './HorseOpponentExploit.js';

type Showdown = Array<{ user_id: string; mucked?: boolean; hand_name?: string }> | null;
interface Vector {
  name: string;
  actions: Array<{ userId?: string; action: string; amount?: number; stage?: string }>;
  showdown: Showdown;
  expected: Record<string, ShownRiverIncrement>;
}
const vectors: Vector[] = JSON.parse(
  readFileSync(
    resolve(process.cwd(), '..', 'scripts/ci/fixtures/horse-shown-river-vectors.json'),
    'utf8'
  )
);

/** One hand's increments from the engine's own replay: the bucket of each player's first river wager, shown when the
 *  showdown list names him, strong when not mucked and two pair or better (the live learner's rule). */
function engineIncrements(v: Vector): Record<string, ShownRiverIncrement> {
  const out: Record<string, ShownRiverIncrement> = {};
  for (const [uid, frac] of riverFirstBetFractions(v.actions as never)) {
    const sd = v.showdown?.find((x) => x?.user_id === uid);
    out[uid] = {
      b: sizeBucketOf(frac),
      shown: sd ? 1 : 0,
      strong:
        sd && sd.mucked !== true && STYLE_STRONG_HAND_NAMES.has((sd.hand_name ?? '').toLowerCase())
          ? 1
          : 0,
    };
  }
  return out;
}

const T0 = Date.UTC(2026, 10, 1);
const record = (
  incs: ReadonlyArray<ShownRiverIncrement>,
  base: ShownRiverRecord | null = null
): ShownRiverRecord => incs.reduce((r, inc, i) => addShownRiverEvidence(r, inc, T0 + i)!, base!);

describe('the durable shown river record, engine half', () => {
  it('its bucket list is the style read size buckets, in order', () => {
    expect([...SHOWN_RIVER_BUCKETS]).toEqual([...SIZE_BUCKETS]);
    expect(SHOWN_RIVER_HALF_LIFE_SHOWN).toBe(40);
    expect(SHOWN_RIVER_WINDOW_MS).toBe(72 * 3600 * 1000);
  });

  it('the pinned vectors: the engine replay gives the increments the SQL learner is proved to give', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(9);
    for (const v of vectors) expect(engineIncrements(v), v.name).toEqual(v.expected);
    // and the boot rebuild of the in-process buckets counts each hand the same way
    for (const v of vectors)
      for (const [uid, inc] of Object.entries(v.expected)) {
        const b = sizeBucketsFromHistory(
          [{ createdAt: T0, actions: v.actions as never, showdown: v.showdown as never }],
          uid
        );
        expect(b, v.name).toEqual({ [inc.b]: { bets: 1, shown: inc.shown, strong: inc.strong } });
      }
  });

  it('a shown bet ages the record by 2^(-1/40); 40 shown bets halve older evidence; an unshown bet adds without ageing', () => {
    const one = addShownRiverEvidence(null, { b: 'large', shown: 1, strong: 1 }, T0)!;
    expect(one).toEqual({ since: T0, buckets: { large: { bets: 1, shown: 1, strong: 1 } } });
    const unshown = addShownRiverEvidence(one, { b: 'large', shown: 0, strong: 0 }, T0 + 1)!;
    expect(unshown).toEqual({ since: T0, buckets: { large: { bets: 2, shown: 1, strong: 1 } } });
    let r: ShownRiverRecord = unshown;
    for (let i = 0; i < 40; i++)
      r = addShownRiverEvidence(r, { b: 'medium', shown: 1, strong: 0 }, T0 + 2 + i)!;
    expect(r.since).toBe(T0);
    expect(r.buckets.large!.shown).toBeCloseTo(0.5, 12);
    expect(r.buckets.large!.bets).toBeCloseTo(1, 12);
    expect(SHOWN_RIVER_DECAY ** 40).toBeCloseTo(0.5, 14);
    // saturation: the shown count of a steady shown bettor tends to 1 / (1 - 2^(-1/40)), about 58
    let s: ShownRiverRecord | null = null;
    for (let i = 0; i < 2000; i++)
      s = addShownRiverEvidence(s, { b: 'large', shown: 1, strong: 1 }, T0);
    expect(s!.buckets.large!.shown).toBeCloseTo(1 / (1 - SHOWN_RIVER_DECAY), 6);
    expect(1 / (1 - SHOWN_RIVER_DECAY)).toBeGreaterThan(58);
    expect(1 / (1 - SHOWN_RIVER_DECAY)).toBeLessThan(59);
    // no increment: the record unchanged (a copy), and null stays null
    expect(addShownRiverEvidence(r, null, T0 + 99)).toEqual(r);
    expect(addShownRiverEvidence(null, undefined, T0)).toBeNull();
  });

  it('the validator takes the database shape only, and a stored copy drops a malformed record without failing the row', () => {
    const good = record([{ b: 'large', shown: 1, strong: 1 }]);
    expect(validShownRiverRecord(good)).toBe(true);
    for (const bad of [
      null,
      [],
      { since: T0 },
      { since: -1, buckets: { large: { bets: 1, shown: 1, strong: 1 } } },
      { since: 1.5, buckets: { large: { bets: 1, shown: 1, strong: 1 } } },
      { since: T0, buckets: {} },
      { since: T0, buckets: { huge: { bets: 1, shown: 1, strong: 1 } } },
      { since: T0, buckets: { large: { bets: 1, shown: 2, strong: 1 } } },
      { since: T0, buckets: { large: { bets: 2, shown: 1, strong: 2 } } },
      { since: T0, buckets: { large: { bets: 1, shown: 1 } } },
      { since: T0, buckets: { large: { bets: 1, shown: 1, strong: Number.NaN } } },
      { since: T0, buckets: { large: { bets: 1, shown: 1, strong: 1 } }, extra: 1 },
    ])
      expect(validShownRiverRecord(bad), JSON.stringify(bad)).toBe(false);
    const row = {
      user_id: '30000000-0000-4000-8000-000000000001',
      variant: 'nlh',
      mode: 'cash',
      size: 'full',
      observed_hands: 1,
      initialized: true,
      counters: freshExploitCounters(),
    };
    expect(validOpponentProfile({ ...row, shown_river: { junk: true } })).toBe(true);
    expect(copyShownRiver({ shown_river: { junk: true } })).toEqual({});
    expect(copyShownRiver({})).toEqual({});
    expect(copyShownRiver({ shown_river: null })).toEqual({ shown_river: null });
    const copy = copyShownRiver({ shown_river: good });
    expect(copy).toEqual({ shown_river: good });
    expect(copy.shown_river).not.toBe(good);
  });

  it('the read at a decision: all four buckets, and older only when the record began more than 72 hours before it', () => {
    const r = record([
      { b: 'large', shown: 1, strong: 1 },
      { b: 'small', shown: 0, strong: 0 },
    ]);
    const at = r.since + SHOWN_RIVER_WINDOW_MS;
    expect(shownRiverReadOf(r, at)!.older).toBe(false);
    expect(shownRiverReadOf(r, at + 1)!.older).toBe(true);
    expect(shownRiverReadOf(r, at)!.buckets).toEqual({
      small: { bets: 1, shown: 0, strong: 0 },
      medium: { bets: 0, shown: 0, strong: 0 },
      large: { bets: 1, shown: 1, strong: 1 },
      overbet: { bets: 0, shown: 0, strong: 0 },
    });
    expect(shownRiverReadOf({ junk: 1 }, at)).toBeNull();
    expect(shownRiverReadOf(undefined, at)).toBeNull();
    // the frame row round-trips exactly
    const read = shownRiverReadOf(r, at + 1)!;
    const row = shownRiverRow(read);
    expect(row).toHaveLength(SHOWN_RIVER_ROW_LENGTH);
    expect(shownRiverReadFromRow(row)).toEqual(read);
    expect(shownRiverReadFromRow([2, ...row.slice(1)])).toBeNull();
    expect(shownRiverReadFromRow(row.slice(1))).toBeNull();
  });

  it('the dedupe rule: per bucket the source with more shown bets, never their sum; ties keep the 72-hour bucket', () => {
    const durable = shownRiverReadOf(
      record([
        ...Array.from({ length: 4 }, () => ({
          b: 'large' as const,
          shown: 1 as const,
          strong: 1 as const,
        })),
        ...Array.from({ length: 4 }, () => ({
          b: 'medium' as const,
          shown: 1 as const,
          strong: 1 as const,
        })),
      ]),
      T0 + 10 * SHOWN_RIVER_WINDOW_MS
    )!;
    const window = {
      large: { bets: 6, shown: 5, strong: 5 },
      medium: { bets: 1, shown: 1, strong: 0 },
      small: { bets: 2, shown: 0, strong: 0 },
    };
    const m = mergeLongShownBuckets(window, durable);
    expect(m.used).toBe(true);
    // large: the window holds more (5 against about 3.7 decayed): the window, not 8.7
    expect(m.buckets!.large).toEqual(window.large);
    // medium: the record holds more: the record's cell, not 1 + 4
    expect(m.buckets!.medium).toEqual(durable.buckets.medium);
    expect(m.buckets!.medium!.shown).toBeLessThan(4);
    // small: no shown either side, the window's bets stay; overbet: absent on both sides stays absent
    expect(m.buckets!.small).toEqual(window.small);
    expect(m.buckets!.overbet).toBeUndefined();
    // nothing the record holds beats the window: the window object itself, unchanged
    const strongWindow = {
      large: { bets: 9, shown: 9, strong: 9 },
      medium: { bets: 9, shown: 9, strong: 0 },
    };
    expect(mergeLongShownBuckets(strongWindow, durable)).toEqual({
      buckets: strongWindow,
      used: false,
    });
    // equal shown: the window
    const tie = mergeLongShownBuckets({ large: { ...durable.buckets.large } }, durable);
    expect(tie.buckets!.large).toEqual(durable.buckets.large);
    // no window at all (a fresh restart): the record's buckets that hold a shown bet
    const fresh = mergeLongShownBuckets(null, durable);
    expect(fresh.used).toBe(true);
    expect(Object.keys(fresh.buckets!).sort()).toEqual(['large', 'medium']);
    // no record: the window as it was
    expect(mergeLongShownBuckets(window, null)).toEqual({ buckets: window, used: false });
  });
});
