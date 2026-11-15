/**
 * A LONG MEMORY OF SHOWN RIVER STRENGTH (2026-11-15, Hold'em Strategy lane).
 *
 * The style read takes a player's shown river strength from his river first bets by size bucket (bets made, called
 * and shown down, shown strong). In the engine that evidence lives in process memory and is rebuilt at boot from 72
 * hours of hand history, so a player who bets the river for value a few times a week is unknown again after every
 * restart: on 2026-11-14 one such cash player had one shown river bet inside 72 hours against thirteen in fourteen
 * days (tight-human-audit RIVER-MEMORY-HORIZON-20261114). The read needs 3 shown before it speaks.
 *
 * The durable half is the database's accepted-hand learner (migration 20261115144258): beside the exact opponent
 * profile's counters it keeps `horse_exact_profiles.shown_river`, the same per-bucket tallies built from the same
 * public facts the engine uses (riverFirstBetFractions on the accepted action log; shown when the hand's public
 * showdown names the player; strong only when he did not muck and the shown hand is two pair or better), aged by a
 * half-life counted in SHOWN river bets (SHOWN_RIVER_HALF_LIFE_SHOWN): when a hand adds a shown first river bet, the
 * whole record ages by 2^(-1/40) before the bet is added; a bet nobody called adds without ageing. So the shown count
 * saturates near 58 and the evidence of 40 shown bets ago weighs half. `since` is the accept time of the first river
 * first bet the record learned. Forward only: nothing is back-filled or replayed.
 *
 * This module is the engine's read of that record: its validator, the per-decision read the pooled public row carries
 * into a decision (HorseMindSandbox.pooledShownRiver), and the merge with the in-process 72-hour buckets. It imports
 * nothing at run time (types only), so the opponent-memory module can validate a row without a module cycle.
 *
 * THE DEDUPE RULE. The durable record learns every accepted hand, including every hand the 72-hour window holds that
 * was accepted after the migration; the in-process buckets hold the hands of the last 72 hours (and since boot). The
 * two overlap, so they are never added. Per size bucket the read takes ONE source: the durable cell when it holds
 * more shown bets than the in-process cell, the in-process cell otherwise (ties keep today's read). With the option
 * off, or with no durable record on file, the read is exactly what it was.
 */
import type { SizeBucket, SizeBucketTallies } from './HorseOpponentStyle.js';

/** The size buckets, in wire order (HorseOpponentStyle.SIZE_BUCKETS; a test pins the two equal). */
export const SHOWN_RIVER_BUCKETS = Object.freeze(['small', 'medium', 'large', 'overbet'] as const);
/** The half-life of the durable record, counted in shown river first bets (the 2026-11-14 audit design). */
export const SHOWN_RIVER_HALF_LIFE_SHOWN = 40;
/** The age factor a shown river first bet applies to everything the record held before it. */
export const SHOWN_RIVER_DECAY = Math.pow(0.5, 1 / SHOWN_RIVER_HALF_LIFE_SHOWN);
/** The horizon of the in-process boot rebuild (HorseExploitHydrator EXPLOIT_HYDRATION_WINDOW_HOURS). Evidence whose
 *  record began before a decision's time minus this is "older than the window" for the receipt. */
export const SHOWN_RIVER_WINDOW_MS = 72 * 3600 * 1000;

export interface ShownRiverCell {
  bets: number;
  shown: number;
  strong: number;
}
/** horse_exact_profiles.shown_river: the decayed tallies per bucket and the accept time (epoch ms) of the first
 *  river first bet it learned. A bucket the player never bet into is absent. */
export interface ShownRiverRecord {
  since: number;
  buckets: Partial<Record<SizeBucket, ShownRiverCell>>;
}
/** One hand's evidence for one player: the bucket of his first river wager, whether it was shown and strong. */
export interface ShownRiverIncrement {
  b: SizeBucket;
  shown: 0 | 1;
  strong: 0 | 1;
}
/** What one pooled row carries into a decision: every bucket (zeros where none) and whether the record began more
 *  than SHOWN_RIVER_WINDOW_MS before the decision's own time (the receipt's question). */
export interface ShownRiverRead {
  older: boolean;
  buckets: Record<SizeBucket, ShownRiverCell>;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const CELL_KEYS = ['bets', 'shown', 'strong'] as const;

/** A cell is three finite non-negative tallies, strong never above shown and shown never above bets. */
export function validShownRiverCell(v: unknown): v is ShownRiverCell {
  if (!plain(v) || Object.keys(v).length !== 3) return false;
  if (!CELL_KEYS.every((k) => finite(v[k]))) return false;
  const c = v as unknown as ShownRiverCell;
  return c.strong <= c.shown + 1e-9 && c.shown <= c.bets + 1e-9;
}

/** The record's exact shape: { since, buckets }, since a safe non-negative integer, at least one bucket. */
export function validShownRiverRecord(v: unknown): v is ShownRiverRecord {
  if (!plain(v) || Object.keys(v).length !== 2) return false;
  if (!Number.isSafeInteger(v.since) || (v.since as number) < 0) return false;
  const b = v.buckets;
  if (!plain(b)) return false;
  const keys = Object.keys(b);
  return (
    keys.length > 0 &&
    keys.every(
      (k) => (SHOWN_RIVER_BUCKETS as readonly string[]).includes(k) && validShownRiverCell(b[k])
    )
  );
}

/**
 * The TypeScript twin of public.fn_horse_shown_river_add(base, delta, at): one hand's increment added to a record.
 * A shown bet first ages every cell by SHOWN_RIVER_DECAY; an unshown bet adds without ageing; no increment returns
 * the base unchanged (null stays null). The same IEEE operations in the same order as the SQL, so both agree.
 */
export function addShownRiverEvidence(
  base: ShownRiverRecord | null | undefined,
  inc: ShownRiverIncrement | null | undefined,
  atMs: number
): ShownRiverRecord | null {
  if (!inc) return base ? { since: base.since, buckets: { ...base.buckets } } : null;
  const f = inc.shown > 0 ? SHOWN_RIVER_DECAY : 1;
  const buckets: Partial<Record<SizeBucket, ShownRiverCell>> = {};
  for (const k of SHOWN_RIVER_BUCKETS) {
    const old = base?.buckets[k];
    if (!old && inc.b !== k) continue;
    const add = inc.b === k;
    buckets[k] = {
      bets: (old ? old.bets * f : 0) + (add ? 1 : 0),
      shown: (old ? old.shown * f : 0) + (add ? inc.shown : 0),
      strong: (old ? old.strong * f : 0) + (add ? inc.strong : 0),
    };
  }
  return { since: base ? base.since : atMs, buckets };
}

/** The read one valid record gives a decision made at decisionTimeMs, or null (absent, invalid or empty record). */
export function shownRiverReadOf(record: unknown, decisionTimeMs: number): ShownRiverRead | null {
  if (!validShownRiverRecord(record) || !Number.isFinite(decisionTimeMs)) return null;
  const buckets = {} as Record<SizeBucket, ShownRiverCell>;
  for (const k of SHOWN_RIVER_BUCKETS) {
    const c = record.buckets[k];
    buckets[k] = c
      ? { bets: c.bets, shown: c.shown, strong: c.strong }
      : { bets: 0, shown: 0, strong: 0 };
  }
  return { older: record.since < decisionTimeMs - SHOWN_RIVER_WINDOW_MS, buckets };
}

/** A read as it travels in a decision read frame: [older (0 or 1), then bets, shown, strong per bucket in order]. */
export const SHOWN_RIVER_ROW_LENGTH = 1 + SHOWN_RIVER_BUCKETS.length * CELL_KEYS.length;
export function shownRiverRow(read: ShownRiverRead): number[] {
  return [
    read.older ? 1 : 0,
    ...SHOWN_RIVER_BUCKETS.flatMap((k) => CELL_KEYS.map((f) => read.buckets[k][f])),
  ];
}
export function shownRiverReadFromRow(row: readonly number[]): ShownRiverRead | null {
  if (
    !Array.isArray(row) ||
    row.length !== SHOWN_RIVER_ROW_LENGTH ||
    !row.every(finite) ||
    (row[0] !== 0 && row[0] !== 1)
  )
    return null;
  const buckets = {} as Record<SizeBucket, ShownRiverCell>;
  let i = 1;
  for (const k of SHOWN_RIVER_BUCKETS) {
    const cell = { bets: row[i]!, shown: row[i + 1]!, strong: row[i + 2]! };
    if (!validShownRiverCell(cell)) return null;
    buckets[k] = cell;
    i += 3;
  }
  return { older: row[0] === 1, buckets };
}
/** A read is well formed: exactly older and the four buckets, each a valid cell. */
export function validShownRiverRead(v: unknown): v is ShownRiverRead {
  if (!plain(v) || Object.keys(v).length !== 2 || typeof v.older !== 'boolean') return false;
  const b = v.buckets;
  return (
    plain(b) &&
    Object.keys(b).length === SHOWN_RIVER_BUCKETS.length &&
    SHOWN_RIVER_BUCKETS.every((k) => validShownRiverCell(b[k]))
  );
}

/**
 * The size buckets a style read takes when the long memory is on: per bucket, the durable cell when it holds more
 * shown bets than the in-process cell, else the in-process cell (absent stays absent). Never a sum (see the dedupe
 * rule above). `used` says whether any bucket came from the durable record.
 */
export function mergeLongShownBuckets(
  window: SizeBucketTallies | null | undefined,
  durable: ShownRiverRead | null | undefined
): { buckets: SizeBucketTallies | null; used: boolean } {
  if (!durable) return { buckets: window ?? null, used: false };
  const out: SizeBucketTallies = {};
  let used = false;
  for (const k of SHOWN_RIVER_BUCKETS) {
    const w = window?.[k];
    const d = durable.buckets[k];
    if (d.shown > (w ? Math.max(0, w.shown) : 0)) {
      out[k] = { bets: d.bets, shown: d.shown, strong: d.strong };
      used = true;
    } else if (w) out[k] = { ...w };
  }
  if (!used) return { buckets: window ?? null, used: false };
  return { buckets: out, used };
}
