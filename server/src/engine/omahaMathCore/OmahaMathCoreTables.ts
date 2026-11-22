/**
 * omahaMathCore measured tables. LEAD RULING: live inputs are PUBLIC INFORMATION ONLY. Every table the core
 * loads carries a `provenance` in OMAHA_MATH_CORE_ALLOWED_PROVENANCE (law test); nothing built from hole cards
 * that were never shown is shipped.
 *
 * publicTables.v4-pooled.json (lane CORE-POOLED, Nov 20 2026; owner 9:52 AM: "THE SAME CORRECTIONS... AGAINST
 * ALL PLAYERS, REGARDLESS IF THEY ARE HUMAN OR HORSES"): lane RANGES' public extracts (action log and hands
 * shown at showdown) of every PLO4/PLO5 cash hand with a person, Nov 1 to Nov 19 6:49 PM Chicago, re-measured
 * with EVERY player pooled: no person/Horse field, no table-composition field, no per-user rows. Responses to
 * wagers by street/line/size/players, wager frequencies, shown non-value shares, preflop action frequencies
 * by position and level, fold facing a raise preflop. Each lookup returns its key and n for the receipt; a
 * missing cell is "no measurement" and is said so in the receipt. The same lookup answers for every player:
 * no lookup here accepts or derives a person/Horse label or a user id (OmahaMathCoreIdentityFree.law.test.ts).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookupResponse, type Band, type Line, type MeasuredRanges } from './MeasuredRanges.js';

// The table is read from the source tree at load, not imported: the engine image is compiled by
// tsconfig.emit.json (noResolve, explicit files) under a 1 GB heap, where importing these tables is either not
// emitted (the file is missing from dist and the import fails at boot) or exhausts the compiler's heap. The
// image holds src/ beside dist/ (Dockerfile COPY src/; the hashed policy sources are read the same way), so
// the server root is three levels above this module in both trees. Where the module's own URL is not a file
// URL (the root test suite runs under happy-dom), the table is found from the working directory: the server
// root, or the repository root above it.
function omahaMathCoreTable(name: string): unknown {
  const at = `src/engine/omahaMathCore/${name}`;
  const here = String(import.meta.url);
  const candidates = [
    ...(here.startsWith('file:') ? [fileURLToPath(new URL(`../../../${at}`, here).href)] : []),
    join(process.cwd(), at),
    join(process.cwd(), 'server', at),
  ];
  const found = candidates.find((path) => existsSync(path));
  if (!found)
    throw new Error(
      `omahaMathCore: table ${name} is not beside the engine (${candidates.join(', ')})`
    );
  return JSON.parse(readFileSync(found, 'utf8'));
}
export const OMAHA_MATH_CORE_PUBLIC_TABLE_FILE = 'publicTables.v4-pooled.json';
const publicTables: unknown = omahaMathCoreTable(OMAHA_MATH_CORE_PUBLIC_TABLE_FILE);

export const OMAHA_MATH_CORE_ALLOWED_PROVENANCE: ReadonlySet<string> = new Set([
  'public_actions',
  'showdown_only',
  // lead ruling 2026-11-19: a Horse's own cards in its own past hands (never an opponent's hidden cards)
  'own_cards_history',
  // lead-2 rules (Nov 20-21; work order of lane CORE-POOLED-4): an anonymous population parameter fitted offline on
  // every player's recorded cards, never keyed by player, no player above 20% of a cell, never read live (the PLO5
  // flop realization cells; HorseOmahaBetRead uses the same class)
  'population_all_cards_capped',
]);
const RAW = publicTables as unknown as MeasuredRanges & { version: string; sourceSha256: string };

/** Every cell's provenance (each section's cells carry one): the set the core loads. */
function provenanceOf(t: Record<string, unknown>): string[] {
  const seen = new Set<string>();
  for (const [section, value] of Object.entries(t)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    for (const cell of Object.values(value as Record<string, unknown>))
      if (cell && typeof cell === 'object' && 'provenance' in (cell as object))
        seen.add(`${String((cell as { provenance: unknown }).provenance)}`);
    void section;
  }
  return [...seen].sort();
}
/** Every table the core loads, by name, with the provenance of its cells (law: each in the allowed set). */
export const OMAHA_MATH_CORE_TABLES: ReadonlyArray<{ name: string; provenance: string }> =
  provenanceOf(RAW as unknown as Record<string, unknown>).map((provenance) => ({
    name: OMAHA_MATH_CORE_PUBLIC_TABLE_FILE,
    provenance,
  }));
for (const t of OMAHA_MATH_CORE_TABLES)
  if (!OMAHA_MATH_CORE_ALLOWED_PROVENANCE.has(t.provenance))
    throw new Error('omahaMathCore: a table cell without public provenance cannot load');
export const TABLE = RAW;
export const OMAHA_MATH_CORE_TABLE_VERSION = `${RAW.version}@${String(RAW.sourceSha256).slice(0, 8)}`;
export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type Mode = 'table' | 'lightning';
export type PreflopPosition = 'UTG' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';
export type PreflopLevel = 'open' | '3bet' | '4bet' | '5bet+';
const MIN_N = 30;

export interface FoldCell {
  p: number;
  n: number;
  source: string;
}

/** The pooled response (every responder) facing a wager on this spot. */
export function responseTo(k: {
  game: 'plo4' | 'plo5';
  mode: Mode;
  street: Exclude<Street, 'preflop'>;
  line: Line;
  band: Band;
  players: 'hu' | 'mw';
}): { fold: number; raise: number; n: number; source: string } | null {
  const pop = lookupResponse(TABLE, k, MIN_N);
  if (!pop) return null;
  return {
    fold: pop.cell.fold,
    raise: pop.cell.raise,
    n: pop.cell.n,
    source: `${pop.key} (n=${pop.cell.n})`,
  };
}

/** Preflop action frequencies (fold/call/check/raise) at a position and raise level, every player pooled. */
export function preflopFreq(k: {
  game: 'plo4' | 'plo5';
  mode: Mode;
  position: PreflopPosition | 'all';
  lvl: 0 | 1 | 2 | 3;
}): { fold: number; call: number; raise: number; check: number; n: number; source: string } | null {
  const t = TABLE.preflop ?? {};
  for (const g of [k.game, 'pooled'])
    for (const m of [k.mode, 'all']) {
      const key = [g, m, k.position, `lvl${k.lvl}`].join('|');
      const c = t[key] as Record<string, number> | undefined;
      if (c && (c.n ?? 0) >= MIN_N)
        return {
          fold: c.fold ?? 0,
          call: c.call ?? 0,
          raise: c.raise ?? 0,
          check: c.check ?? 0,
          n: c.n,
          source: `${key} (n=${c.n})`,
        };
    }
  return null;
}

/** Fold rate facing a preflop raise (open / 3-bet / 4-bet+), every player pooled. */
export function preflopFoldToRaise(k: {
  game: 'plo4' | 'plo5';
  mode: Mode;
  position: PreflopPosition | 'all';
  facing: 'facing_open' | 'facing_3bet' | 'facing_4bet+';
}): FoldCell | null {
  const t = TABLE.preflopFacingRaise ?? {};
  for (const p of [k.position, 'all'])
    for (const g of [k.game, 'pooled'])
      for (const m of [k.mode, 'all']) {
        const key = [g, m, p, k.facing].join('|');
        const c = t[key];
        if (c && c.n >= MIN_N) return { p: c.fold, n: c.n, source: `${key} (n=${c.n})` };
      }
  return null;
}

/** How often a player wagers on this line when he can (public action log; every player pooled). */
export function betRate(k: {
  game: 'plo4' | 'plo5';
  mode: Mode;
  street: Exclude<Street, 'preflop'>;
  line: Line;
  players: 'hu' | 'mw';
}): { b: number; n: number; source: string; size: number } | null {
  const t =
    (
      TABLE as unknown as {
        betFrequency?: Record<
          string,
          { betRate: number; n: number; betBands?: Record<string, number> }
        >;
      }
    ).betFrequency ?? {};
  for (const pl of [k.players, 'all'])
    for (const ln of k.line === 'all' ? ['all'] : [k.line, 'all'])
      for (const g of [k.game, 'pooled'])
        for (const m of [k.mode, 'all']) {
          const key = [g, m, k.street, ln, pl].join('|');
          const c = t[key];
          if (!c || c.n < MIN_N) continue;
          return {
            b: c.betRate,
            n: c.n,
            size: typicalSize(c.betBands),
            source: `${key} (n=${c.n})`,
          };
        }
  return null;
}

/** Wager sizes of a line (the measured size bands, every player pooled). */
export function betBands(k: {
  game: 'plo4' | 'plo5';
  mode: Mode;
  street: Exclude<Street, 'preflop'>;
  players: 'hu' | 'mw';
}): { bands: Record<string, number>; key: string } | null {
  const t =
    (
      TABLE as unknown as {
        betFrequency?: Record<string, { n: number; betBands?: Record<string, number> }>;
      }
    ).betFrequency ?? {};
  for (const pl of [k.players, 'all'])
    for (const g of [k.game, 'pooled'])
      for (const m of [k.mode, 'all']) {
        const key = [g, m, k.street, 'all', pl].join('|');
        const c = t[key];
        if (c && c.n >= MIN_N && c.betBands) return { bands: c.betBands, key };
      }
  return null;
}

/** The non-value share of a wager on this line and size, from hands shown at showdown (every bettor pooled). */
export function wagerNonValue(k: {
  game: 'plo4' | 'plo5';
  mode: Mode;
  street: Exclude<Street, 'preflop'>;
  line: Line;
  band: Band;
  players: 'hu' | 'mw';
}): { nv: number; n: number; source: string } | null {
  const t =
    (TABLE as unknown as { ranges?: Record<string, { shownNonValue?: number; nShown?: number }> })
      .ranges ?? {};
  for (const pl of [k.players, 'all'])
    for (const ln of k.line === 'all' ? ['all'] : [k.line, 'all'])
      for (const g of [k.game, 'pooled'])
        for (const b of k.band === 'all' ? ['all'] : [k.band, 'all'])
          for (const m of [k.mode, 'all']) {
            const key = [g, m, k.street, ln, b, pl].join('|');
            const c = t[key];
            if (c && typeof c.shownNonValue === 'number' && (c.nShown ?? 0) >= 20)
              return {
                nv: c.shownNonValue,
                n: c.nShown ?? 0,
                source: `${key} shown (n=${c.nShown})`,
              };
          }
  return null;
}

/** The median wager size (share of the pot) of a line's measured size bands. */
function typicalSize(bands: Record<string, number> | undefined): number {
  const mid: Record<string, number> = { small: 0.33, half: 0.5, twothirds: 0.7, pot: 1, allin: 1 };
  const order = ['small', 'half', 'twothirds', 'pot', 'allin'];
  const total = bands ? order.reduce((x, k) => x + (bands[k] ?? 0), 0) : 0;
  if (!bands || !(total > 0)) return 0.66;
  let acc = 0;
  for (const k of order) {
    acc += bands[k] ?? 0;
    if (acc >= total / 2) return mid[k];
  }
  return 0.66;
}
