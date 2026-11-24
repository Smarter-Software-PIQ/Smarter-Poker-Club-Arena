/**
 * THE MEASURED BETTOR RANGE (PLO4 / PLO5 cash; PLO-OWNER lead-6 2026-11-24, design
 * plo-overfold/PLO-OVERFOLD-ROOT-CAUSE.md section 4, F1 and F6). Pure: tables, lookups and arithmetic; no
 * telemetry, no opponent memory of its own (the caller passes his record), no random draw.
 *
 * WHAT IS MEASURED (scripts/ops/omaha-facing-bet-range-fit.mjs, from shown-down hand_history hands only, every
 * player pooled, nobody keyed): the strength of the hand a player held when he made the first wager of a street,
 * by game, street, line, size bucket and whether he bet into one player or several; the same for a raise of that
 * wager and for a call of it. STRENGTH is the share of holdings of his own size that beat his hand on that street's
 * board (0 = the nuts): the scale of the engine's exact counts (omahaEvHandCounts.top), so a histogram bin [a, b)
 * is "the strongest b of holdings less the strongest a". Flop and turn cells carry the showdown-bias correction of
 * the fit (a bettor who later folds is never shown; that share is added as weak hands).
 *
 * LINE. 'agg': on the flop he was the last preflop raiser; on the turn and the river he wagered on the street before.
 * 'non': every other first wager (a lead, a probe, a delayed bet, a stab). 'raise': a raise of the street's first
 * wager. The line is a table key: no multiplier per street (the 0.8 / 0.9 narrowing of omahaFacingBetEv is not used).
 *
 * HIS RECORD. His own shown first bets of this street and size (HorseOmahaBetRead's per-opponent cells: shown, and
 * how many of those were value, beating 80% of holdings), read against the population's shown value share in the
 * same cell (both shown-selected, so the selection cancels): sHim = (n0 x sPop + (shown - value)) / (n0 + shown),
 * the cell's weak share moved by sHim / sPop. Below OMAHA_MEASURED_RECORD_MIN_SHOWN shown bets he has no record.
 *
 * NO RECORD. The pooled table, moved by the caller's existing public read factor (HorseMind.omahaFacingBetEvReadOf
 * through omahaEvBluffShare: a measured read only; with no measured read the factor is 1), then, with
 * omahaFacingBetMinimumDefencePrior on, given at least the cell's minimum-defence share of AIR (F6,
 * OMAHA_MEASURED_MIN_DEFENCE: the mass of his weakest bin, holdings beaten by more than 55% of holdings, the
 * presumed-aggressive bettor's bluffs; the smallest air share under which the Horse's whole range, over the committed
 * state set, folds no more than s / (1 + s) + 0.05 to a bet of size s, calibrated by
 * scripts/ops/omaha-facing-bet-range-fit.mjs calibrate). Bets of 0.7 pot or more get no bound: there the measured
 * weakest calls already lose (PLO-OVERFOLD-ROOT-CAUSE.md 2d), so defending them to s / (1 + s) would pay off. A
 * record may justify folding more; the bound is never applied to a record. Identity never enters: the same
 * arithmetic for every opponent.
 */
import tables from './HorseOmahaFacingBetRangeTables.json' with { type: 'json' };

export type OmahaMeasuredStreet = 'flop' | 'turn' | 'river';
export type OmahaMeasuredLine = 'agg' | 'non' | 'raise';
export type OmahaMeasuredInto = 'hu' | 'mw';
export type OmahaMeasuredBucket = 'under40' | 'mid' | 'big' | 'over';

interface HistCell {
  hist: number[];
  shown: number;
  bets?: number;
  laterFold?: number;
  valueShown?: number;
}
interface RateCell {
  n: number;
  rate: number;
}
interface Tables {
  version: string;
  binEdges: number[];
  weakEdge: number;
  bettor: Record<string, HistCell>;
  caller: Record<string, HistCell>;
  continueRate: Record<string, RateCell>;
  fieldAllFold: Record<string, RateCell>;
  fire: Record<string, RateCell>;
  fireSize: Record<string, { n: number; mean: number }>;
  flushDrawByBin: Record<string, RateCell>;
  minDefence?: Record<string, number>;
}
const T = tables as unknown as Tables;

export const OMAHA_MEASURED_RANGE_VERSION: string = T.version;
export const OMAHA_MEASURED_BIN_EDGES: readonly number[] = Object.freeze([...T.binEdges]);
export const OMAHA_MEASURED_BINS = OMAHA_MEASURED_BIN_EDGES.length - 1;
/** Bins at or above this strength are his non-value (weak) holdings. */
export const OMAHA_MEASURED_WEAK_EDGE: number = T.weakEdge;
/** Pseudo-observations of the population's shown weak share behind his record (OMAHA_EV_SIZE_READ_PRIOR). */
export const OMAHA_MEASURED_RECORD_PRIOR = 8;
/** Shown bets in his cell before his record is read (OMAHA_BET_READ_MIN_SHOWN). */
export const OMAHA_MEASURED_RECORD_MIN_SHOWN = 4;
/** The weak share is kept inside these bounds whatever moves it. */
export const OMAHA_MEASURED_WEAK_MIN = 0.01;
export const OMAHA_MEASURED_WEAK_MAX = 0.85;
/** F6: the minimum air share of a no-record prior per game, street and size bucket (the calibration; absent = none). */
export const OMAHA_MEASURED_MIN_DEFENCE: Readonly<Record<string, number>> = Object.freeze({
  ...(T.minDefence ?? {}),
});
/** The bounds in use: the table's; omahaMeasuredMinDefenceFitSeam changes them for the offline calibration only. */
const minDefenceInUse = new Map<string, number>(Object.entries(OMAHA_MEASURED_MIN_DEFENCE));
/** OFFLINE FIT SEAM (no production caller): the calibration sets one cell's bound (null removes it). */
export function omahaMeasuredMinDefenceFitSeam(key: string, value: number | null): void {
  if (value === null) minDefenceInUse.delete(key);
  else minDefenceInUse.set(key, value);
}

export function omahaMeasuredBucketOf(potFrac: number): OmahaMeasuredBucket {
  return potFrac < 0.4 ? 'under40' : potFrac < 0.7 ? 'mid' : potFrac <= 1.1 ? 'big' : 'over';
}

const isWeakBin = (b: number): boolean =>
  OMAHA_MEASURED_BIN_EDGES[b] >= OMAHA_MEASURED_WEAK_EDGE - 1e-12;

function normalised(h: readonly number[] | undefined): number[] | null {
  if (!Array.isArray(h) || h.length !== OMAHA_MEASURED_BINS) return null;
  const s = h.reduce((a, b) => a + (Number.isFinite(b) && b > 0 ? b : 0), 0);
  return s > 0 ? h.map((x) => (Number.isFinite(x) && x > 0 ? x / s : 0)) : null;
}

/** The bettor's measured strength histogram for this first wager or raise, or null outside the tables. */
export function omahaMeasuredBettorHist(
  variant: string,
  street: OmahaMeasuredStreet,
  line: OmahaMeasuredLine,
  potFrac: number,
  into: OmahaMeasuredInto
): number[] | null {
  const v = String(variant).toLowerCase();
  const key =
    line === 'raise'
      ? `${v}|${street}|raise|any|${into}`
      : `${v}|${street}|${line}|${omahaMeasuredBucketOf(potFrac)}|${into}`;
  return normalised(T.bettor[key]?.hist);
}

/** A caller's measured strength histogram for a call of a first wager of this size. */
export function omahaMeasuredCallerHist(
  variant: string,
  street: OmahaMeasuredStreet,
  potFrac: number,
  into: OmahaMeasuredInto
): number[] | null {
  const v = String(variant).toLowerCase();
  return normalised(T.caller[`${v}|${street}|${omahaMeasuredBucketOf(potFrac)}|${into}`]?.hist);
}

/** The histogram's weak share (mass at or above OMAHA_MEASURED_WEAK_EDGE). */
export function omahaMeasuredWeakShare(hist: readonly number[]): number {
  let w = 0;
  for (let b = 0; b < hist.length; b++) if (isWeakBin(b)) w += hist[b];
  return w;
}

/** The histogram with its weak share set to `weak`: each side keeps its own shape. */
export function omahaMeasuredWithWeakShare(hist: readonly number[], weak: number): number[] {
  const w0 = omahaMeasuredWeakShare(hist);
  const w = Math.max(OMAHA_MEASURED_WEAK_MIN, Math.min(OMAHA_MEASURED_WEAK_MAX, weak));
  if (!(w0 > 0) || !(w0 < 1)) return [...hist];
  return hist.map((x, b) => (isWeakBin(b) ? (x * w) / w0 : (x * (1 - w)) / (1 - w0)));
}

/** The population's shown weak share in this street and size cell (every line and pot type pooled), or null. */
export function omahaMeasuredPopulationShownWeak(
  variant: string,
  street: OmahaMeasuredStreet,
  potFrac: number
): number | null {
  const v = String(variant).toLowerCase();
  const bucket = omahaMeasuredBucketOf(potFrac);
  let shown = 0;
  let value = 0;
  for (const line of ['agg', 'non'])
    for (const into of ['hu', 'mw']) {
      const c = T.bettor[`${v}|${street}|${line}|${bucket}|${into}`];
      if (!c) continue;
      shown += c.shown ?? 0;
      value += c.valueShown ?? 0;
    }
  return shown >= 12 ? Math.max(0.02, Math.min(0.98, (shown - value) / shown)) : null;
}

/** His own shown record of this street and size (HorseOmahaBetRead): shown bets and how many were value. */
export interface OmahaMeasuredRecord {
  shown: number;
  value: number;
}

export interface OmahaMeasuredRange {
  hist: number[];
  /** the weak share priced */
  weak: number;
  /** the table's own weak share */
  tableWeak: number;
  source: 'record' | 'prior';
  /** F6 raised the no-record prior to the cell's minimum-defence share */
  bounded: boolean;
}

/** The histogram with at least `air` in its weakest bin; every other bin keeps its share of the rest. */
export function omahaMeasuredWithAirFloor(hist: readonly number[], air: number): number[] {
  const last = hist.length - 1;
  const a = Math.max(0, Math.min(0.95, air));
  if (!(hist[last] < a)) return [...hist];
  const rest = 1 - hist[last];
  return hist.map((x, b) => (b === last ? a : rest > 0 ? (x * (1 - a)) / rest : (1 - a) / last));
}

/** The F6 bound (minimum air share) of this cell, or null when none is calibrated. */
export function omahaMeasuredMinDefenceWeak(
  variant: string,
  street: OmahaMeasuredStreet,
  potFrac: number,
  isRaise: boolean
): number | null {
  if (isRaise) return null;
  const v = minDefenceInUse.get(
    `${String(variant).toLowerCase()}|${street}|${omahaMeasuredBucketOf(potFrac)}`
  );
  return v !== undefined && Number.isFinite(v) ? v : null;
}

/**
 * The range priced against this bettor: his record where he has one, else the table moved by the existing public
 * read factor and, with `minDefence`, bounded below by F6. Null outside the tables.
 */
export function omahaMeasuredBettorRange(
  variant: string,
  street: OmahaMeasuredStreet,
  line: OmahaMeasuredLine,
  potFrac: number,
  into: OmahaMeasuredInto,
  input: { record: OmahaMeasuredRecord | null; readFactor: number; minDefence: boolean }
): OmahaMeasuredRange | null {
  const hist = omahaMeasuredBettorHist(variant, street, line, potFrac, into);
  if (!hist) return null;
  const tableWeak = omahaMeasuredWeakShare(hist);
  const rec = input.record;
  if (rec && line !== 'raise' && rec.shown >= OMAHA_MEASURED_RECORD_MIN_SHOWN - 1e-9) {
    const sPop = omahaMeasuredPopulationShownWeak(variant, street, potFrac);
    if (sPop !== null) {
      const weakShown = Math.max(0, rec.shown - Math.min(rec.shown, Math.max(0, rec.value)));
      const sHim =
        (OMAHA_MEASURED_RECORD_PRIOR * sPop + weakShown) /
        (OMAHA_MEASURED_RECORD_PRIOR + rec.shown);
      const weak = Math.max(
        OMAHA_MEASURED_WEAK_MIN,
        Math.min(OMAHA_MEASURED_WEAK_MAX, (tableWeak * sHim) / sPop)
      );
      return {
        hist: omahaMeasuredWithWeakShare(hist, weak),
        weak,
        tableWeak,
        source: 'record',
        bounded: false,
      };
    }
  }
  const factor = Number.isFinite(input.readFactor) && input.readFactor > 0 ? input.readFactor : 1;
  const weak = Math.max(
    OMAHA_MEASURED_WEAK_MIN,
    Math.min(OMAHA_MEASURED_WEAK_MAX, tableWeak * factor)
  );
  let priced = weak === tableWeak ? hist : omahaMeasuredWithWeakShare(hist, weak);
  let bounded = false;
  if (input.minDefence) {
    const air = omahaMeasuredMinDefenceWeak(variant, street, potFrac, line === 'raise');
    if (air !== null && priced[priced.length - 1] < air) {
      priced = omahaMeasuredWithAirFloor(priced, air);
      bounded = true;
    }
  }
  return {
    hist: priced,
    weak: omahaMeasuredWeakShare(priced),
    tableWeak,
    source: 'prior',
    bounded,
  };
}

/** His line on this street from the public action history (see the module comment). */
export function omahaMeasuredLineOf(
  history:
    | ReadonlyArray<{ stage?: unknown; seat?: number; action?: string; amount?: number }>
    | null
    | undefined,
  street: OmahaMeasuredStreet,
  seat: number,
  isRaise: boolean
): OmahaMeasuredLine {
  if (isRaise) return 'raise';
  const prev = street === 'river' ? 'turn' : street === 'turn' ? 'flop' : 'preflop';
  if (prev === 'preflop') {
    let level = 0;
    let aggressor: number | null = null;
    const totals = new Map<number, number>();
    for (const a of history ?? []) {
      if (String(a?.stage) !== 'preflop' || a.seat === undefined) continue;
      const before = totals.get(a.seat) ?? 0;
      const amt = Number.isFinite(a.amount) ? Math.max(0, a.amount as number) : 0;
      if (a.action === 'fold') continue;
      if (a.action === 'call') totals.set(a.seat, before + amt);
      else if (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in') {
        const now = Math.max(before, amt);
        totals.set(a.seat, now);
        if (now > level + 0.005) {
          level = now;
          aggressor = a.seat;
        }
      } else if (amt > level) level = amt;
    }
    return aggressor !== null && aggressor === seat ? 'agg' : 'non';
  }
  for (const a of history ?? [])
    if (
      String(a?.stage) === prev &&
      a.seat === seat &&
      (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in') &&
      Number(a.amount) > 0
    )
      return 'agg';
  return 'non';
}

/** A player facing a first wager of this size continues (calls or raises) at this measured rate. */
export function omahaMeasuredContinueRate(
  variant: string,
  street: OmahaMeasuredStreet,
  potFrac: number,
  into: OmahaMeasuredInto
): number | null {
  const c =
    T.continueRate[
      `${String(variant).toLowerCase()}|${street}|${omahaMeasuredBucketOf(potFrac)}|${into}`
    ];
  return c && c.n >= 30 && Number.isFinite(c.rate) ? c.rate : null;
}

/** Every player a multiway first wager of this size went into folds, measured (opponents '2' or '3+'). */
export function omahaMeasuredFieldAllFold(
  variant: string,
  street: OmahaMeasuredStreet,
  potFrac: number,
  opponents: number
): number | null {
  const c =
    T.fieldAllFold[
      `${String(variant).toLowerCase()}|${street}|${omahaMeasuredBucketOf(potFrac)}|${opponents >= 3 ? '3+' : '2'}`
    ];
  return c && c.n >= 30 && Number.isFinite(c.rate) ? c.rate : null;
}

/** After his called heads-up wager of the street before, how often he wagers first on this street, and how big. */
export function omahaMeasuredFire(
  variant: string,
  street: 'turn' | 'river'
): { rate: number; size: number } | null {
  const v = String(variant).toLowerCase();
  const c = T.fire[`${v}|${street}`];
  const s = T.fireSize[`${v}|${street}`];
  if (!c || c.n < 30 || !s || s.n < 30) return null;
  return { rate: c.rate, size: s.mean };
}

/** The share of callers in a strength bin holding a flush draw (two board cards of a suit, no flush made). */
export function omahaMeasuredFlushDrawShare(
  variant: string,
  street: 'flop' | 'turn',
  bin: number
): number | null {
  const c = T.flushDrawByBin[`${String(variant).toLowerCase()}|${street}|${bin}`];
  return c && c.n >= 20 && Number.isFinite(c.rate) ? c.rate : null;
}

/** The bin of a strength. */
export function omahaMeasuredBinOf(strength: number): number {
  for (let b = 0; b < OMAHA_MEASURED_BINS; b++)
    if (strength < OMAHA_MEASURED_BIN_EDGES[b + 1]) return b;
  return OMAHA_MEASURED_BINS - 1;
}

/**
 * The weak share of his first wagers of a street on one line, every size pooled by how often each size is bet
 * (the table's own bet counts), or null. The flop tree reads his turn barrel and river bet composition from it.
 */
export function omahaMeasuredLineWeak(
  variant: string,
  street: OmahaMeasuredStreet,
  line: 'agg' | 'non',
  into: OmahaMeasuredInto
): number | null {
  const v = String(variant).toLowerCase();
  let w = 0;
  let n = 0;
  for (const bucket of ['under40', 'mid', 'big', 'over']) {
    const c = T.bettor[`${v}|${street}|${line}|${bucket}|${into}`];
    const h = normalised(c?.hist);
    const bets = c?.bets ?? 0;
    if (!h || !(bets > 0)) continue;
    w += bets * omahaMeasuredWeakShare(h);
    n += bets;
  }
  return n > 0 ? w / n : null;
}
