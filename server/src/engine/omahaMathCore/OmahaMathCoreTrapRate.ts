/**
 * Measured PLO4/PLO5 trap rates (lane CORE-POOLED-8; lead ruling 9:52 AM Nov 21 2026; criteria
 * CRITERIA-CORE-POOLED-8-PLO5-TRAP-RATE sha 1a322479dff0315d9d62d36019b5060c0424c7e3b72c5f3b48a83b410fbf738d;
 * CRITERIA-CORE-POOLED-8-PLO4-TRAP-RATE sha 1d4f376fe7df8623f6b50afbf6be9c1708a135c28d464c578e8df2d82cdb1085, lead ruling 11:24 AM).
 * tau = the share of STRONG holdings (made-hand rank in the top b of random holdings, b = the cell's measured wager share)
 * that CHECK when checked to, from PUBLIC SHOWDOWNS only (PLO5: core-pooled-4 rawfull fit set; PLO4: Nov 10-17 cash), shrunk n/(n+30) to the
 * street and the street to all. Cells: street | first to act on the street or later | hu/mw. Identity-free: every player pooled.
 * Used by OmahaMathCoreRangeTrack likelihood(): a check keeps tau of the value region instead of stripping it.
 * PLO6 and every other game: no table, the old update. Table sha256 PLO5 7783b844df8cb9e8148221f6c9236fd79bbbbf01d97f77a9a5cc57f635b58c18, PLO4 2606af4f11fcaba975b0e45291278902eb3b33e42c939adbdb6ad4fb4f43d5e5.
 */
import type { PostStreet } from './OmahaMathCoreRangeTrack.js';

export const OMAHA_TRAP_RATE_TABLE = {
  provenance: 'showdown_only',
  sourceSha256: {
    plo5: '7783b844df8cb9e8148221f6c9236fd79bbbbf01d97f77a9a5cc57f635b58c18',
    plo4: '2606af4f11fcaba975b0e45291278902eb3b33e42c939adbdb6ad4fb4f43d5e5',
  },
  cells: {
    'plo4|flop|first|hu': { tau: 0.6257, n: 18526 },
    'plo4|flop|first|mw': { tau: 0.8118, n: 2062 },
    'plo4|flop|later|hu': { tau: 0.1919, n: 18951 },
    'plo4|flop|later|mw': { tau: 0.5179, n: 9973 },
    'plo4|river|first|hu': { tau: 0.7374, n: 14359 },
    'plo4|river|first|mw': { tau: 0.6793, n: 508 },
    'plo4|river|later|hu': { tau: 0.7157, n: 12390 },
    'plo4|river|later|mw': { tau: 0.4217, n: 979 },
    'plo4|turn|first|hu': { tau: 0.5786, n: 20809 },
    'plo4|turn|first|mw': { tau: 0.5201, n: 4071 },
    'plo4|turn|later|hu': { tau: 0.3437, n: 18812 },
    'plo4|turn|later|mw': { tau: 0.4609, n: 4637 },
    'plo5|flop|first|hu': { tau: 0.6388, n: 23161 },
    'plo5|flop|first|mw': { tau: 0.7643, n: 5519 },
    'plo5|flop|later|hu': { tau: 0.2419, n: 29468 },
    'plo5|flop|later|mw': { tau: 0.5533, n: 18922 },
    'plo5|river|first|hu': { tau: 0.66, n: 20492 },
    'plo5|river|first|mw': { tau: 0.6292, n: 2609 },
    'plo5|river|later|hu': { tau: 0.594, n: 17095 },
    'plo5|river|later|mw': { tau: 0.4702, n: 3850 },
    'plo5|turn|first|hu': { tau: 0.5905, n: 28051 },
    'plo5|turn|first|mw': { tau: 0.5494, n: 7059 },
    'plo5|turn|later|hu': { tau: 0.3433, n: 29622 },
    'plo5|turn|later|mw': { tau: 0.5481, n: 10736 },
  } as Record<string, { tau: number; n: number }>,
} as const;

/** The measured trap rate of a PLO4/PLO5 checked-to node; undefined when the game or cell is absent. */
export function omahaTrapRate(
  game: string,
  street: PostStreet,
  first: boolean,
  players: number
): number | undefined {
  const c =
    OMAHA_TRAP_RATE_TABLE.cells[
      `${game}|${street}|${first ? 'first' : 'later'}|${players <= 2 ? 'hu' : 'mw'}`
    ];
  return c ? c.tau : undefined;
}
