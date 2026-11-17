/**
 * THE POSTFLOP READ, KEPT BY STREET AND BY FLOP TEXTURE (PLO Strategy lane 2026-11-17).
 *
 * The exact opponent profile keeps ONE pooled postflop bet rate (betCheckedTo: flop, turn and river
 * together, every texture, aggressor or not; HorseOpponentExploit.exploitHandIncrements). A player who
 * bets most flops and then slows down has a moderate pooled rate, is labelled a value leader
 * (HorseOmahaReadConditional) and carries that label on every street and texture. The audit of 721 live
 * hands (archive plo-handoff-review-01a1cbbd/audit2-01BNteGZ) measured the two halves apart: on paired
 * boards his bets were trips or better 60 / 77 / 72 percent of the time by street, on unpaired flops more
 * than half were a draw or one pair.
 *
 * This module is the read that keeps them apart. It is pure: one completed hand's public actions and its
 * flop in, per-player increments out; a decayed row plus a prior in, a rate with its own opportunity count
 * out. Public actions only (the same learnable-action rule as the pooled counters); no hole card is read.
 * A cell without enough opportunities answers null, and the caller keeps today's pooled read.
 *
 * NOT WIRED: nothing in the decision path imports this file yet. The durable column, the database learner
 * and the worker read frame that would carry these counters are not built (see the wiring note in the
 * archive, readsplit-01BNteGZ/WIRING-SPEC-20261117.md). It changes no decision.
 */
import type { Card } from '../types.js';
import { learnablePublicAction, type ExploitHandAction } from './HorseOpponentExploit.js';

export type PostflopStreet = 'flop' | 'turn' | 'river';
export type FlopTexture = 'paired' | 'rainbow' | 'twoTone' | 'monotone';
export const POSTFLOP_STREETS: readonly PostflopStreet[] = ['flop', 'turn', 'river'];
export const FLOP_TEXTURES: readonly FlopTexture[] = ['paired', 'rainbow', 'twoTone', 'monotone'];

/** The flop's texture class from its three cards; null when the flop is not three known cards. */
export function flopTextureOf(board: readonly Card[] | null | undefined): FlopTexture | null {
  if (!Array.isArray(board) || board.length < 3) return null;
  const flop = board.slice(0, 3);
  if (flop.some((c) => !c || typeof c.rank !== 'string' || typeof c.suit !== 'string')) return null;
  if (new Set(flop.map((c) => c.rank)).size < 3) return 'paired';
  const suits = new Set(flop.map((c) => c.suit)).size;
  return suits === 1 ? 'monotone' : suits === 2 ? 'twoTone' : 'rainbow';
}

/** One success / opportunity pair. */
export interface StreetReadCell {
  hit: number;
  opp: number;
}
export type StreetReadStat = 'bet' | 'foldToBet' | 'foldToRaise';
/**
 * bet[street]: acted with no bet yet on that street, and bet (the pooled betCheckedTo, by street).
 * foldToBet[street]: faced another player's bet or raise on that street, and folded.
 * foldToRaise[street]: had bet or raised on that street, was raised, and folded.
 * cbet[texture]: was the last preflop raiser, acted on the flop with no bet yet, and bet.
 * flopBet[texture]: acted on the flop with no bet yet, and bet (aggressor or not).
 */
export interface StreetReadCounters {
  bet: Record<PostflopStreet, StreetReadCell>;
  foldToBet: Record<PostflopStreet, StreetReadCell>;
  foldToRaise: Record<PostflopStreet, StreetReadCell>;
  cbet: Record<FlopTexture, StreetReadCell>;
  flopBet: Record<FlopTexture, StreetReadCell>;
}
const cell = (): StreetReadCell => ({ hit: 0, opp: 0 });
const byStreet = (): Record<PostflopStreet, StreetReadCell> => ({
  flop: cell(),
  turn: cell(),
  river: cell(),
});
const byTexture = (): Record<FlopTexture, StreetReadCell> => ({
  paired: cell(),
  rainbow: cell(),
  twoTone: cell(),
  monotone: cell(),
});
export function emptyStreetRead(): StreetReadCounters {
  return {
    bet: byStreet(),
    foldToBet: byStreet(),
    foldToRaise: byStreet(),
    cbet: byTexture(),
    flopBet: byTexture(),
  };
}
/** Every cell of a row, in one fixed order (serialisation and iteration). */
export function streetReadCells(r: StreetReadCounters): StreetReadCell[] {
  return [
    ...POSTFLOP_STREETS.map((s) => r.bet[s]),
    ...POSTFLOP_STREETS.map((s) => r.foldToBet[s]),
    ...POSTFLOP_STREETS.map((s) => r.foldToRaise[s]),
    ...FLOP_TEXTURES.map((t) => r.cbet[t]),
    ...FLOP_TEXTURES.map((t) => r.flopBet[t]),
  ];
}

const aggressive = (a: ExploitHandAction): boolean =>
  a.action === 'bet' || a.action === 'raise' || (a.action === 'all_in' && a.isFullRaise === true);

/**
 * One completed hand -> each acting player's increments. Same admission as the pooled counters: voluntary,
 * attributed, not forced. At most one opportunity per player per cell per hand, so a hand with several
 * raises on one street does not count a player's tendency twice.
 */
export function streetReadHandIncrements(
  actions: readonly ExploitHandAction[],
  board: readonly Card[] | null | undefined
): Map<string, StreetReadCounters> {
  const out = new Map<string, StreetReadCounters>();
  const row = (id: string): StreetReadCounters => {
    let r = out.get(id);
    if (!r) out.set(id, (r = emptyStreetRead()));
    return r;
  };
  const texture = flopTextureOf(board);
  const seen = new Set<string>();
  const once = (key: string): boolean => (seen.has(key) ? false : (seen.add(key), true));
  let lastPreflopRaiser: string | null = null;
  let street: PostflopStreet | null = null;
  let bettor: string | null = null;
  /** players who bet or raised on the current street and have not been raised since */
  let wagered = new Set<string>();
  for (const a of actions) {
    if (!a || typeof a.userId !== 'string' || !a.userId) continue;
    if (!learnablePublicAction(a)) continue;
    const id = a.userId;
    const aggr = aggressive(a);
    if (a.stage === 'preflop') {
      if (aggr) lastPreflopRaiser = id;
      continue;
    }
    if (a.stage !== 'flop' && a.stage !== 'turn' && a.stage !== 'river') continue;
    if (a.stage !== street) {
      street = a.stage;
      bettor = null;
      wagered = new Set();
    }
    const r = row(id);
    if (bettor === null) {
      if (a.action !== 'fold' && once(`bet:${street}:${id}`)) {
        r.bet[street].opp++;
        if (aggr) r.bet[street].hit++;
        if (street === 'flop' && texture) {
          r.flopBet[texture].opp++;
          if (aggr) r.flopBet[texture].hit++;
          if (lastPreflopRaiser === id) {
            r.cbet[texture].opp++;
            if (aggr) r.cbet[texture].hit++;
          }
        }
      }
    } else if (bettor !== id) {
      if (wagered.has(id)) {
        if (once(`ftr:${street}:${id}`)) {
          r.foldToRaise[street].opp++;
          if (a.action === 'fold') r.foldToRaise[street].hit++;
        }
      } else if (once(`ftb:${street}:${id}`)) {
        r.foldToBet[street].opp++;
        if (a.action === 'fold') r.foldToBet[street].hit++;
      }
    }
    if (aggr) {
      bettor = id;
      wagered.add(id);
    }
  }
  return out;
}

/** A cell ages only on a hand that gave it an opportunity (the pooled counters' opportunity-scoped rule). */
export const STREET_READ_HALF_LIFE_OPPORTUNITIES = 30;
export const STREET_READ_DECAY = Math.pow(0.5, 1 / STREET_READ_HALF_LIFE_OPPORTUNITIES);
export function streetReadDecayAndAdd(row: StreetReadCounters, inc: StreetReadCounters): void {
  const a = streetReadCells(row);
  const b = streetReadCells(inc);
  for (let i = 0; i < a.length; i++) {
    if (!(b[i].opp > 0)) continue;
    a[i].hit = a[i].hit * STREET_READ_DECAY + b[i].hit;
    a[i].opp = a[i].opp * STREET_READ_DECAY + b[i].opp;
  }
}

/** A stored row is usable only when every cell is finite, non-negative and hit <= opp. */
export function validStreetRead(r: unknown): r is StreetReadCounters {
  if (!r || typeof r !== 'object') return false;
  const x = r as StreetReadCounters;
  try {
    return (
      POSTFLOP_STREETS.every((s) => x.bet?.[s] && x.foldToBet?.[s] && x.foldToRaise?.[s]) &&
      FLOP_TEXTURES.every((t) => x.cbet?.[t] && x.flopBet?.[t]) &&
      streetReadCells(x).every(
        (c) =>
          Number.isFinite(c.hit) && Number.isFinite(c.opp) && c.hit >= 0 && c.hit <= c.opp + 1e-9
      )
    );
  } catch {
    return false;
  }
}

/** Decayed opportunities a cell needs before it answers; below it the caller keeps the pooled read. */
export const STREET_READ_MIN_OPPORTUNITIES = 8;
/** Pseudo-opportunities at the prior rate. */
export const STREET_READ_PRIOR_MASS = 6;
export interface StreetReadRate {
  /** posterior mean: (hit + mass * prior) / (opp + mass) */
  rate: number;
  opportunities: number;
}
/** The rate of one cell against a prior, or null when the cell has too few opportunities or is unusable. */
export function streetReadRate(
  c: StreetReadCell | null | undefined,
  prior: number
): StreetReadRate | null {
  if (!c || !Number.isFinite(c.hit) || !Number.isFinite(c.opp)) return null;
  if (!(prior >= 0 && prior <= 1)) return null;
  if (c.opp < STREET_READ_MIN_OPPORTUNITIES || c.hit < 0 || c.hit > c.opp + 1e-9) return null;
  return {
    rate: (c.hit + STREET_READ_PRIOR_MASS * prior) / (c.opp + STREET_READ_PRIOR_MASS),
    opportunities: c.opp,
  };
}

/** The reference rates a label compares against: the Horse mean of this game and table size. */
export interface StreetReadMeans {
  bet: number;
  foldToBet: number;
}
export interface StreetLabel {
  /** bets no more often than the mean on this street / texture and folds to bets at least as often */
  valueLeader: boolean;
  /** his bet rate here over the mean, the factor the facing-bet rule moves its bluff prior by */
  betRatio: number;
  opportunities: number;
}
/**
 * The label for ONE street (and, on the flop, one texture). Null when the bet cell for that street and
 * texture has too few opportunities: unknown stays unknown, and the caller's pooled label stands.
 * On the flop the texture cell is used; a flop whose texture is unknown uses the flop street cell.
 */
export function streetLabel(
  row: StreetReadCounters | null | undefined,
  street: PostflopStreet,
  texture: FlopTexture | null,
  means: StreetReadMeans
): StreetLabel | null {
  if (!row || !validStreetRead(row)) return null;
  if (!(means.bet > 0 && means.bet < 1 && means.foldToBet >= 0 && means.foldToBet <= 1))
    return null;
  const betCell = street === 'flop' && texture ? row.flopBet[texture] : row.bet[street];
  const bet = streetReadRate(betCell, means.bet);
  if (!bet) return null;
  const fold = streetReadRate(row.foldToBet[street], means.foldToBet);
  return {
    valueLeader: bet.rate <= means.bet && (fold === null || fold.rate >= means.foldToBet),
    betRatio: bet.rate / means.bet,
    opportunities: bet.opportunities,
  };
}
