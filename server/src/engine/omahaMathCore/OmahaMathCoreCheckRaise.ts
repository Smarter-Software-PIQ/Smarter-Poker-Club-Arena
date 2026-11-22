/**
 * Measured check-raise cell (lane CORE-POOLED-9; lead decision Nov 21 2026; criteria
 * CRITERIA-CORE-POOLED-9-CHECK-RAISE-CELL sha 7c45130b70147a358bcb16db643160b835d49503e77220a0d3bf9fee58f4f91c).
 * The spot: a FLOP raise by a seat whose only earlier flop actions are checks, facing the hero's own wager.
 * Raw counts, every player pooled (identity-free): nFace decisions facing a flop wager after only checks and the
 * share that raised (public actions); nShown check-raises shown at showdown and their non-value share (strength
 * < 0.5: mean over random turn+river completions of the share of random holdings beaten), all sizes and this
 * raise size bucket. OmahaMathCoreRangeTrack shrinks each n/(n+30) to the generic cell. PLO5: core-pooled-4 rawfull
 * fit set; PLO4: Nov 10-17 cash pull. PLO6 and every other game: no table, the generic cell.
 * Table sha256 c99054ae1759ec259d6cea32c0b723fa321d28be16ed2bbdcf0059af1722577e (cr-table.json).
 */
import type { CheckRaiseCell, PostStreet } from './OmahaMathCoreRangeTrack.js';

export const OMAHA_CHECK_RAISE_TABLE = {
  provenance: 'showdown_only',
  sourceSha256: 'c99054ae1759ec259d6cea32c0b723fa321d28be16ed2bbdcf0059af1722577e',
  cells: {
    'plo4|hu|allin': {
      nFace: 81865,
      raise: 0.14045,
      nShownAll: 2564,
      nvAll: 0.06669,
      nShownBand: 242,
      nvBand: 0.09091,
    },
    'plo4|hu|half': {
      nFace: 81865,
      raise: 0.14045,
      nShownAll: 2564,
      nvAll: 0.06669,
      nShownBand: 549,
      nvBand: 0.05464,
    },
    'plo4|hu|pot': {
      nFace: 81865,
      raise: 0.14045,
      nShownAll: 2564,
      nvAll: 0.06669,
      nShownBand: 285,
      nvBand: 0.01404,
    },
    'plo4|hu|small': {
      nFace: 81865,
      raise: 0.14045,
      nShownAll: 2564,
      nvAll: 0.06669,
      nShownBand: 127,
      nvBand: 0.08661,
    },
    'plo4|hu|twothirds': {
      nFace: 81865,
      raise: 0.14045,
      nShownAll: 2564,
      nvAll: 0.06669,
      nShownBand: 1361,
      nvBand: 0.07641,
    },
    'plo4|mw|allin': {
      nFace: 23754,
      raise: 0.03646,
      nShownAll: 400,
      nvAll: 0.065,
      nShownBand: 45,
      nvBand: 0.0,
    },
    'plo4|mw|half': {
      nFace: 23754,
      raise: 0.03646,
      nShownAll: 400,
      nvAll: 0.065,
      nShownBand: 59,
      nvBand: 0.01695,
    },
    'plo4|mw|pot': {
      nFace: 23754,
      raise: 0.03646,
      nShownAll: 400,
      nvAll: 0.065,
      nShownBand: 73,
      nvBand: 0.0137,
    },
    'plo4|mw|small': {
      nFace: 23754,
      raise: 0.03646,
      nShownAll: 400,
      nvAll: 0.065,
      nShownBand: 0,
      nvBand: 0,
    },
    'plo4|mw|twothirds': {
      nFace: 23754,
      raise: 0.03646,
      nShownAll: 400,
      nvAll: 0.065,
      nShownBand: 223,
      nvBand: 0.10762,
    },
    'plo5|hu|allin': {
      nFace: 101892,
      raise: 0.13925,
      nShownAll: 3965,
      nvAll: 0.0744,
      nShownBand: 585,
      nvBand: 0.14359,
    },
    'plo5|hu|half': {
      nFace: 101892,
      raise: 0.13925,
      nShownAll: 3965,
      nvAll: 0.0744,
      nShownBand: 377,
      nvBand: 0.08223,
    },
    'plo5|hu|pot': {
      nFace: 101892,
      raise: 0.13925,
      nShownAll: 3965,
      nvAll: 0.0744,
      nShownBand: 1406,
      nvBand: 0.0505,
    },
    'plo5|hu|small': {
      nFace: 101892,
      raise: 0.13925,
      nShownAll: 3965,
      nvAll: 0.0744,
      nShownBand: 176,
      nvBand: 0.16477,
    },
    'plo5|hu|twothirds': {
      nFace: 101892,
      raise: 0.13925,
      nShownAll: 3965,
      nvAll: 0.0744,
      nShownBand: 1421,
      nvBand: 0.0563,
    },
    'plo5|mw|allin': {
      nFace: 65881,
      raise: 0.0418,
      nShownAll: 314,
      nvAll: 0.05096,
      nShownBand: 62,
      nvBand: 0.0,
    },
    'plo5|mw|half': {
      nFace: 65881,
      raise: 0.0418,
      nShownAll: 314,
      nvAll: 0.05096,
      nShownBand: 19,
      nvBand: 0.10526,
    },
    'plo5|mw|pot': {
      nFace: 65881,
      raise: 0.0418,
      nShownAll: 314,
      nvAll: 0.05096,
      nShownBand: 133,
      nvBand: 0.02256,
    },
    'plo5|mw|small': {
      nFace: 65881,
      raise: 0.0418,
      nShownAll: 314,
      nvAll: 0.05096,
      nShownBand: 2,
      nvBand: 0.0,
    },
    'plo5|mw|twothirds': {
      nFace: 65881,
      raise: 0.0418,
      nShownAll: 314,
      nvAll: 0.05096,
      nShownBand: 98,
      nvBand: 0.11224,
    },
  } as Record<string, CheckRaiseCell>,
} as const;

/** The raise size bucket of a raise (MeasuredRanges sizeBand). */
function bucket(frac: number, allIn: boolean): string {
  if (allIn) return 'allin';
  return frac <= 0.4 ? 'small' : frac <= 0.6 ? 'half' : frac <= 0.8 ? 'twothirds' : 'pot';
}

/** The measured check-raise cell of a PLO4/PLO5 flop raise; undefined when the game, street or cell is absent. */
export function omahaCheckRaiseCell(
  game: string,
  street: PostStreet,
  players: number,
  frac: number,
  allIn: boolean
): CheckRaiseCell | undefined {
  if (street !== 'flop') return undefined;
  return OMAHA_CHECK_RAISE_TABLE.cells[
    `${game}|${players <= 2 ? 'hu' : 'mw'}|${bucket(Math.max(0, frac), allIn)}`
  ];
}
