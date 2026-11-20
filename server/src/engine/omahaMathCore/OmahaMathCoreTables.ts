/**
 * omahaMathCore measured tables (lane MATHCORE 2026-11-19). LEAD RULING: live
 * inputs are PUBLIC INFORMATION ONLY. Every table the core loads carries a
 * `provenance` in OMAHA_MATH_CORE_ALLOWED_PROVENANCE (law test); nothing built
 * from hole cards that were never shown is shipped.
 *
 * publicTables.v3.json: lane RANGES' measured-ranges-public-v3 (every cell provenance public_actions or
 * showdown_only; source sha256 3bdd8ce1...), earlier: public-action sections (responses to
 * wagers by street/line/size/players/actor, preflop action frequencies by
 * position and level, fold facing a Horse raise preflop, VPIP/PFR, per-user
 * public facing rows), PLO4/PLO5 cash with a person, Nov 1 to Nov 19 6:49 PM
 * Chicago (source sha256 54ab0460...; hidden-card sections removed, names
 * removed). Each lookup returns its key and n for the receipt; a missing cell
 * is "no measurement" and is said so in the receipt.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  lookupResponse,
  personFoldRate,
  type Band,
  type Line,
  type MeasuredRanges,
} from './MeasuredRanges.js';

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
const publicTables: unknown = omahaMathCoreTable('publicTables.v3.json');

export const OMAHA_MATH_CORE_ALLOWED_PROVENANCE: ReadonlySet<string> = new Set([
  'public_actions',
  'showdown_only',
  // lead ruling 2026-11-19: a Horse's own cards in its own past hands (never an opponent's hidden cards)
  'own_cards_history',
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
    name: 'publicTables.v3.json',
    provenance,
  }));
for (const t of OMAHA_MATH_CORE_TABLES)
  if (!OMAHA_MATH_CORE_ALLOWED_PROVENANCE.has(t.provenance))
    throw new Error('omahaMathCore: a table cell without public provenance cannot load');
export const TABLE = RAW;
export const OMAHA_MATH_CORE_TABLE_VERSION = `${RAW.version}@${String(RAW.sourceSha256).slice(0, 8)}`;
export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type Mode = 'table' | 'lightning';
export type Actor = 'person' | 'horse';
export type PreflopPosition = 'UTG' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';
export type PreflopLevel = 'open' | '3bet' | '4bet' | '5bet+';
const MIN_N = 30;

export interface FoldCell {
  p: number;
  n: number;
  source: string;
}

/** Response of `responder` facing a wager by `bettor` (population cell; person-specific shrunk when he has a row). */
export function responseTo(k: {
  game: 'plo4' | 'plo5';
  mode: Mode;
  street: Exclude<Street, 'preflop'>;
  line: Line;
  band: Band;
  players: 'hu' | 'mw';
  bettor: Actor;
  responder: Actor;
  user: string | null;
}): { fold: number; raise: number; n: number; source: string } | null {
  const game = k.game;
  const pop = lookupResponse(
    TABLE,
    { ...k, game: game as 'plo4', opp: 'horse_present' },
    k.responder,
    MIN_N
  );
  if (!pop) return null;
  if (k.responder === 'person' && k.user) {
    const per = personFoldRate(TABLE, k.user, { ...k, game: game as 'plo4' }, pop.cell.fold);
    if (per.source === 'person_shrunk')
      return {
        fold: per.rate,
        raise: pop.cell.raise,
        n: per.n,
        source: `person shrunk (n=${per.n}, k+20pop/(n+20)) to ${pop.key} (n=${pop.cell.n})`,
      };
  }
  return {
    fold: pop.cell.fold,
    raise: pop.cell.raise,
    n: pop.cell.n,
    source: `${pop.key} (n=${pop.cell.n})`,
  };
}

/** Preflop action frequencies (fold/call/check/raise) of a seat kind at a position and raise level. */
export function preflopFreq(k: {
  game: 'plo4' | 'plo5';
  mode: Mode;
  position: PreflopPosition | 'all';
  lvl: 0 | 1 | 2 | 3;
  actor: Actor;
}): { fold: number; call: number; raise: number; check: number; n: number; source: string } | null {
  const t = TABLE.preflop ?? {};
  for (const g of [k.game, 'pooled'])
    for (const m of [k.mode, 'all']) {
      const key = [g, m, k.position, `lvl${k.lvl}`, k.actor].join('|');
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

/** Fold rate facing a Horse's preflop raise (open / 3-bet / 4-bet+). */
export function preflopFoldToHorse(k: {
  game: 'plo4' | 'plo5';
  mode: Mode;
  position: PreflopPosition | 'all';
  facing: 'facing_open' | 'facing_3bet' | 'facing_4bet+';
  actor: Actor;
}): FoldCell | null {
  const t = TABLE.preflopFacingRaise ?? {};
  for (const p of [k.position, 'all'])
    for (const g of [k.game, 'pooled'])
      for (const m of [k.mode, 'all']) {
        const key = [g, m, p, k.facing, 'vs_horse', k.actor].join('|');
        const c = t[key];
        if (c && c.n >= MIN_N) return { p: c.fold, n: c.n, source: `${key} (n=${c.n})` };
      }
  return null;
}

/** How often this kind of player wagers on this line when he can (public action log; persons shrunk to population). */
export function betRate(k: {
  game: 'plo4' | 'plo5';
  mode: Mode;
  street: Exclude<Street, 'preflop'>;
  line: Line;
  players: 'hu' | 'mw';
  actor: Actor;
  user: string | null;
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
        for (const m of [k.mode, 'all'])
          for (const o of ['horse_present', 'any']) {
            const key = [g, m, k.street, ln, pl, o, k.actor].join('|');
            const c = t[key];
            if (!c || c.n < MIN_N) continue;
            const size = typicalSize(c.betBands);
            if (k.actor === 'person' && k.user) {
              const row = (
                TABLE.persons?.[k.user] as unknown as
                  | { betOpportunities?: Record<string, Record<string, number>> }
                  | undefined
              )?.betOpportunities?.[[k.game, k.street, k.line, k.players].join('|')];
              if (row) {
                const n = Object.values(row).reduce((x, y) => x + y, 0);
                const bets = row.bet ?? 0;
                if (n > 0)
                  return {
                    b: (bets + 20 * c.betRate) / (n + 20),
                    n,
                    size,
                    source: `person shrunk (n=${n}) to ${key} (n=${c.n})`,
                  };
              }
            }
            return { b: c.betRate, n: c.n, size, source: `${key} (n=${c.n})` };
          }
  return null;
}

/** The non-value share of a wager on this line and size, from hands shown at showdown (lead decision: shownNonValue). */
export function wagerNonValue(k: {
  game: 'plo4' | 'plo5';
  mode: Mode;
  street: Exclude<Street, 'preflop'>;
  line: Line;
  band: Band;
  players: 'hu' | 'mw';
  bettor: Actor;
}): { nv: number; n: number; source: string } | null {
  const t =
    (TABLE as unknown as { ranges?: Record<string, { shownNonValue?: number; nShown?: number }> })
      .ranges ?? {};
  for (const pl of [k.players, 'all'])
    for (const ln of k.line === 'all' ? ['all'] : [k.line, 'all'])
      for (const g of [k.game, 'pooled'])
        for (const b of k.band === 'all' ? ['all'] : [k.band, 'all'])
          for (const m of [k.mode, 'all'])
            for (const o of ['horse_present', 'any']) {
              const key = [g, m, k.street, ln, b, pl, o, k.bettor].join('|');
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
