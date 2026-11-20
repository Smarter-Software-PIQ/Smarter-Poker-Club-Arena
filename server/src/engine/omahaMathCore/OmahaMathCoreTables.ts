/**
 * omahaMathCore measured tables (lane MATHCORE 2026-11-19). LEAD RULING: live
 * inputs are PUBLIC INFORMATION ONLY. Every table the core loads carries a
 * `provenance` in OMAHA_MATH_CORE_ALLOWED_PROVENANCE (law test); nothing built
 * from hole cards that were never shown is shipped.
 *
 * publicTables.v1.json: lane RANGES' public-action sections (responses to
 * wagers by street/line/size/players/actor, preflop action frequencies by
 * position and level, fold facing a Horse raise preflop, VPIP/PFR, per-user
 * public facing rows), PLO4/PLO5 cash with a person, Nov 1 to Nov 19 6:49 PM
 * Chicago (source sha256 54ab0460...; hidden-card sections removed, names
 * removed). Each lookup returns its key and n for the receipt; a missing cell
 * is "no measurement" and is said so in the receipt.
 */
import publicTables from './publicTables.v1.json' with { type: 'json' };
import {
  lookupResponse,
  personFoldRate,
  type Band,
  type Line,
  type MeasuredRanges,
} from './MeasuredRanges.js';

export const OMAHA_MATH_CORE_ALLOWED_PROVENANCE: ReadonlySet<string> = new Set([
  'public_actions',
  'showdown_only',
]);
const RAW = publicTables as unknown as MeasuredRanges & { provenance: string };
/** Every table the core loads, by name, with its provenance (law: each in the allowed set). */
export const OMAHA_MATH_CORE_TABLES: ReadonlyArray<{ name: string; provenance: string }> = [
  { name: 'publicTables.v1.json', provenance: RAW.provenance },
];
if (!OMAHA_MATH_CORE_ALLOWED_PROVENANCE.has(RAW.provenance))
  throw new Error('omahaMathCore: a table without public provenance cannot load');
export const TABLE = RAW;
export const OMAHA_MATH_CORE_TABLE_VERSION = `${RAW.version}-public@54ab0460`;
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
