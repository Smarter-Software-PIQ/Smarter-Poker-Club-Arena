/**
 * ═══════════════════════════════════════════════════════════════════════════
 * NO-LIMIT HOLD'EM OPEN SIZES (Dan 2026-10-31, BINDING)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dan, verbatim: "WHY ARE ALL HORSES MIN RAISING WHEN THEY ARE OPENING...
 * OPENING RANGES SHOULD BE RANDOMLY DONE, MIN RAISE TO 2.5-4X OPENING RANGES.
 * NOT ALWAYS THE MINIMUM RAISE POSSIBLE".
 *
 * Measured on production (40 minutes, horse non-all-in raise-first-in opens):
 * cash 1,319 opens, 726 (55%) at 2.05bb or less, median 2.00bb, mean 2.27bb;
 * tournaments 3,841 opens, 1,125 at 2.05bb or less and 1,230 more at
 * 2.05-2.30bb. Reproduced through HorseLogic.decide (every hand class, every
 * seat, five styles): a 0.50/1 cash table opened 87.6% exact min-raises, a
 * 1/2 table 42.2%, a 9-handed ante tournament 38.6%. One owner produced every
 * one of them, the V28 open ladder in decidePreflopV7, through two defects:
 *
 *  1. THE LADDER. It drew 2.2-3.0bb, 2.05-2.40 with an ante and 2.0-2.4 at
 *     25bb, took 0.15 off in late position and multiplied by a persona dial
 *     that runs down to 0.88, so a large share of its draws landed under the
 *     2bb legal minimum and were clamped up to exactly a min-raise.
 *  2. THE CHIP SNAP. `legalize` rounds every wager DOWN to whole chips when
 *     the big blind is a whole number (Dan 2026-08-18, "use whole dollars").
 *     At a 1-chip big blind every draw from 2.00 to 2.99bb floored to 2bb.
 *
 * WHAT REPLACES IT. Each open is drawn uniformly (bent by the persona dial,
 * never past the band) from a band chosen by the spot, following standard
 * no-limit practice:
 *
 *  - FORMAT (Dan 2026-11-01, binding: "THEY ARE LITERALLY MIN RAISING IN A
 *    CASH GAME THAT DOESN'T HAPPEN. THEY ALWAYS RAISE A LITTLE MORE IN CASH
 *    GAMES"): a CASH open is never under NLH_CASH_OPEN_FLOOR_BB (2.5bb), at
 *    any depth, whatever the persona dial or the chip grid; the bands run
 *    2.5-3.5bb (up to 4bb deep). In TOURNAMENTS small opens are standard:
 *    NLH_TOURNAMENT_MIN_RAISE_SHARE (20%) of opens deeper than 25bb are an
 *    exact min-raise and the rest are drawn from smaller bands.
 *  - POSITION: early seats open largest (more players behind, worse position
 *    after the flop), the button smallest; the small blind against the big
 *    blind alone opens largest of all (3-3.5x in cash) because it plays the
 *    hand out of position.
 *  - TABLE: a full ring (8+ dealt) moves the early band up a quarter blind.
 *  - DEPTH: deep cash (150bb+ effective) opens a quarter to half a blind
 *    larger. A tournament stack of 25bb or less opens 2.0-2.3bb and a 25-40bb
 *    tournament stack 2.0-2.5bb (small blind 2.2-2.8), so an open never
 *    commits a short stack; a 25bb-or-less cash stack opens 2.5-2.8bb.
 *  - ANTES: dead money already pays the raise, so every ante band is smaller.
 *  - LIMPERS: one open unit (big blind, or the straddle) per limper.
 *
 * THE DRAW NEVER READS THE CARDS (owner constraint, binding). The size is a
 * function of the spot and the decision's random source only, and the draw
 * always consumes exactly three random values, so a watching player learns
 * nothing about a hand from its open size.
 *
 * THE GRID. The open lands on the same chip grid `legalize` snaps to
 * (chipStepFor), so the snap has nothing left to floor. On a coarse grid (a
 * 1-chip big blind) the draw is rounded stochastically to a neighbouring chip
 * instead of flooring every 2.x draw to 2, never below the band's floor; a
 * short stack's band is a hard ceiling and is never rounded above 2.3bb.
 *
 * Out of scope: pot-limit opens are the pot (Dan 2026-09-03, PLO_MIN_OPEN_BB
 * in HorsePreflop); fixed limit sizes itself; 3-bet / 4-bet sizes are not
 * opens. The legal minimum and the stack are still enforced by `legalize`.
 */

/** Seat classes an unopened no-limit open is sized for. */
export type NlhOpenSeat = 'early' | 'middle' | 'cutoff' | 'button' | 'blind' | 'heads_up';

export type NlhOpenBandBB = readonly [lo: number, hi: number];

/**
 * CASH (Dan 2026-11-01, from a real player's complaint: "THEY ARE LITERALLY
 * MIN RAISING IN A CASH GAME THAT DOESN'T HAPPEN. THEY ALWAYS RAISE A LITTLE
 * MORE IN CASH GAMES"): a cash open is never the bare min-raise. Every cash
 * band starts at NLH_CASH_OPEN_FLOOR_BB; the button and cutoff sit at the low
 * end, early seats and deep stacks at the high end, the small blind 3-3.5x.
 */
export const NLH_CASH_OPEN_FLOOR_BB = 2.5;
/** Cash, 100bb, no ante. */
export const NLH_OPEN_BANDS_CASH: Readonly<Record<NlhOpenSeat, NlhOpenBandBB>> = {
  early: [2.8, 3.5],
  middle: [2.7, 3.3],
  cutoff: [2.5, 3.1],
  button: [2.5, 3.0],
  /** Small blind into the big blind alone (or a blind raising over limps). */
  blind: [3.0, 3.5],
  heads_up: [2.5, 3.0],
};
/** Cash with an ante in play: smaller, still never under the cash floor. */
export const NLH_OPEN_BANDS_CASH_ANTE: Readonly<Record<NlhOpenSeat, NlhOpenBandBB>> = {
  early: [2.6, 3.2],
  middle: [2.5, 3.0],
  cutoff: [2.5, 2.9],
  button: [2.5, 2.8],
  blind: [2.8, 3.3],
  heads_up: [2.5, 2.8],
};
/** Cash, 25bb or less effective: still above the floor, never committing. */
export const NLH_OPEN_BAND_CASH_SHORT: NlhOpenBandBB = [2.5, 2.8];

/**
 * TOURNAMENTS: small opens are standard (dead money, short stacks), and an
 * exact min-raise is a normal part of the mix: NLH_TOURNAMENT_MIN_RAISE_SHARE
 * of tournament opens deeper than NLH_OPEN_SHORT_MAX_BB are an exact
 * min-raise (Dan 2026-11-01), the rest are drawn from the band.
 */
export const NLH_TOURNAMENT_MIN_RAISE_SHARE = 0.2;
/** Tournament, deeper than NLH_OPEN_MID_MAX_BB, no ante (levels before antes). */
export const NLH_OPEN_BANDS_TOURNAMENT: Readonly<Record<NlhOpenSeat, NlhOpenBandBB>> = {
  early: [2.3, 3.0],
  middle: [2.2, 2.8],
  cutoff: [2.2, 2.7],
  button: [2.0, 2.5],
  blind: [2.5, 3.2],
  heads_up: [2.0, 2.5],
};
/** Tournament, deeper than NLH_OPEN_MID_MAX_BB, ante in play. */
export const NLH_OPEN_BANDS_TOURNAMENT_ANTE: Readonly<Record<NlhOpenSeat, NlhOpenBandBB>> = {
  early: [2.2, 2.7],
  middle: [2.1, 2.6],
  cutoff: [2.0, 2.5],
  button: [2.0, 2.4],
  blind: [2.3, 3.0],
  heads_up: [2.0, 2.3],
};
/** Tournament effective stacks above NLH_OPEN_SHORT_MAX_BB up to this open the middle band. */
export const NLH_OPEN_MID_MAX_BB = 40;
/** 25-40bb tournament effective stacks: small, so the open never commits the stack. */
export const NLH_OPEN_BANDS_TOURNAMENT_MID: Readonly<Record<NlhOpenSeat, NlhOpenBandBB>> = {
  early: [2.1, 2.5],
  middle: [2.0, 2.5],
  cutoff: [2.0, 2.4],
  button: [2.0, 2.3],
  blind: [2.2, 2.8],
  heads_up: [2.0, 2.3],
};
/** Tournament effective stacks at or below this many big blinds open the short band. */
export const NLH_OPEN_SHORT_MAX_BB = 25;
/** The tournament short-stack band: a hard ceiling, never rounded above it. */
export const NLH_OPEN_BAND_SHORT: NlhOpenBandBB = [2.0, 2.3];

/** Deep cash: effective stacks above this many big blinds open larger. */
export const NLH_OPEN_DEEP_CASH_MIN_BB = 150;
/** How much larger a deep cash open is: [added to lo, added to hi]. */
export const NLH_OPEN_DEEP_CASH_SHIFT: readonly [number, number] = [0.25, 0.5];
/** Full ring (this many dealt or more): the early band moves up by NLH_OPEN_FULL_RING_EARLY_SHIFT. */
export const NLH_OPEN_FULL_RING_MIN_SEATS = 8;
export const NLH_OPEN_FULL_RING_EARLY_SHIFT = 0.25;
/** No band reaches past Dan's 4x (before limpers). */
export const NLH_OPEN_MAX_BB = 4.0;
/** A min-raise open is exactly two open units; nothing is ever drawn below it. */
export const NLH_MIN_RAISE_OPEN_BB = 2;

/**
 * The chip granularity a wager lands on: whole chips whenever the big blind is
 * itself a whole number (Dan 2026-08-18, "use whole dollars"), cents otherwise.
 * HorseLogic's legalize snap reads this same function, so an open drawn on this
 * grid survives the snap unchanged.
 */
export function chipStepFor(bigBlind: number | undefined): number {
  return typeof bigBlind === 'number' && bigBlind >= 1 && Number.isInteger(bigBlind) ? 1 : 0.01;
}

export interface NlhOpenSpot {
  seat: NlhOpenSeat;
  /** Effective stack in big blinds (hero against the deepest live opponent). */
  depthBB: number;
  tournament: boolean;
  anteInPlay: boolean;
  /** Players dealt in (the table size the ranges use). */
  tableSize: number;
}

export interface NlhOpenBand {
  lo: number;
  hi: number;
  /** A hard ceiling: the grid rounding never goes above `hi`. */
  strict: boolean;
  /** Probability the open is an exact min-raise instead of a band draw. */
  minRaiseShare: number;
}

/** Map HorsePreflop's position buckets onto the open-size seats. */
export function nlhOpenSeat(args: {
  position: 'early' | 'middle' | 'late' | 'sb' | 'bb';
  isButton?: boolean;
  /** A genuinely two-handed table. */
  trueHeadsUp: boolean;
}): NlhOpenSeat {
  if (args.trueHeadsUp && args.position === 'sb') return 'heads_up';
  switch (args.position) {
    case 'early':
      return 'early';
    case 'middle':
      return 'middle';
    case 'late':
      return args.isButton === true ? 'button' : 'cutoff';
    default:
      return 'blind';
  }
}

/** Which band an unopened no-limit open draws from, in open units. Never reads the cards. */
export function nlhOpenBand(spot: NlhOpenSpot): NlhOpenBand {
  const depth = Number.isFinite(spot.depthBB) ? spot.depthBB : Infinity;
  if (!spot.tournament) {
    if (depth <= NLH_OPEN_SHORT_MAX_BB) {
      const [lo, hi] = NLH_OPEN_BAND_CASH_SHORT;
      return { lo, hi, strict: true, minRaiseShare: 0 };
    }
    let [lo, hi] = (spot.anteInPlay ? NLH_OPEN_BANDS_CASH_ANTE : NLH_OPEN_BANDS_CASH)[spot.seat];
    if (spot.seat === 'early' && spot.tableSize >= NLH_OPEN_FULL_RING_MIN_SEATS) {
      lo += NLH_OPEN_FULL_RING_EARLY_SHIFT;
      hi += NLH_OPEN_FULL_RING_EARLY_SHIFT;
    }
    if (depth > NLH_OPEN_DEEP_CASH_MIN_BB) {
      lo += NLH_OPEN_DEEP_CASH_SHIFT[0];
      hi += NLH_OPEN_DEEP_CASH_SHIFT[1];
    }
    hi = Math.min(NLH_OPEN_MAX_BB, hi);
    lo = Math.max(NLH_CASH_OPEN_FLOOR_BB, Math.min(lo, hi));
    return { lo, hi, strict: false, minRaiseShare: 0 };
  }
  if (depth <= NLH_OPEN_SHORT_MAX_BB) {
    const [lo, hi] = NLH_OPEN_BAND_SHORT;
    return { lo, hi, strict: true, minRaiseShare: 0 };
  }
  if (depth <= NLH_OPEN_MID_MAX_BB) {
    const [lo, hi] = NLH_OPEN_BANDS_TOURNAMENT_MID[spot.seat];
    return { lo, hi, strict: true, minRaiseShare: NLH_TOURNAMENT_MIN_RAISE_SHARE };
  }
  let [lo, hi] = (spot.anteInPlay ? NLH_OPEN_BANDS_TOURNAMENT_ANTE : NLH_OPEN_BANDS_TOURNAMENT)[
    spot.seat
  ];
  if (spot.seat === 'early' && spot.tableSize >= NLH_OPEN_FULL_RING_MIN_SEATS) {
    lo += NLH_OPEN_FULL_RING_EARLY_SHIFT;
    hi += NLH_OPEN_FULL_RING_EARLY_SHIFT;
  }
  hi = Math.min(NLH_OPEN_MAX_BB, hi);
  lo = Math.min(lo, hi);
  return { lo, hi, strict: false, minRaiseShare: NLH_TOURNAMENT_MIN_RAISE_SHARE };
}

const EPS = 1e-9;
const onGrid = (n: number, step: number, f: (x: number) => number): number =>
  step === 1 ? f(n) : f(n * 100) / 100;

/**
 * The raise-to amount, in chips and on the chip grid, for an unopened
 * no-limit hold'em open. `rand` must be the decision's own random source; the
 * draw always consumes exactly three values and never sees the cards.
 */
export function nlhOpenRaiseTo(
  args: NlhOpenSpot & {
    /** Chips per open unit: the big blind, or the straddle in a straddled pot. */
    openUnit: number;
    bigBlind: number;
    limpers: number;
    /** Persona dial (about 0.88-1.12): leans the draw within the band, never out of it. */
    sizingMultiplier: number;
    rand: () => number;
  }
): number {
  const unit = args.openUnit > 0 ? args.openUnit : args.bigBlind > 0 ? args.bigBlind : 1;
  const step = chipStepFor(args.bigBlind);
  const limpers = Math.max(0, Math.floor(args.limpers || 0));
  const band = nlhOpenBand(args);
  const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5);
  const pick = clamp01(args.rand());
  const u = clamp01(args.rand());
  const r = clamp01(args.rand());
  const mult =
    Number.isFinite(args.sizingMultiplier) && args.sizingMultiplier > 0 ? args.sizingMultiplier : 1;
  // The dial bends the draw toward the top (mult > 1) or the bottom (< 1) of
  // the band without leaving it: u^(1/lean) stays inside [0, 1].
  const lean = Math.min(1.5, Math.max(0.67, mult));
  const drawnBB = band.lo + (band.hi - band.lo) * Math.pow(u, 1 / lean);
  const chips = (drawnBB + limpers) * unit;
  // Stochastic rounding onto the grid spreads a coarse grid (a 1-chip big
  // blind) across the neighbouring chips instead of flooring every 2.x draw
  // to 2; on the cent grid it is a cent either way.
  const down = onGrid(chips, step, (x) => Math.floor(x + EPS));
  const frac = (chips - down) / step;
  const rounded = frac > EPS && r < frac ? down + step : down;
  // Never below the band floor (so an early seat never min-raises, even on a
  // coarse grid) and never below a min-raise.
  const floorChips = onGrid(
    (Math.max(NLH_MIN_RAISE_OPEN_BB, band.lo) + limpers) * unit,
    step,
    (x) => Math.ceil(x - EPS)
  );
  const ceilChips = band.strict
    ? Math.max(
        floorChips,
        onGrid((band.hi + limpers) * unit, step, (x) => Math.floor(x + EPS))
      )
    : onGrid((band.hi + limpers) * unit, step, (x) => Math.ceil(x - EPS));
  const minRaiseChips = onGrid((NLH_MIN_RAISE_OPEN_BB + limpers) * unit, step, (x) =>
    Math.ceil(x - EPS)
  );
  const out =
    pick < band.minRaiseShare ? minRaiseChips : Math.min(ceilChips, Math.max(floorChips, rounded));
  return step === 1 ? out : Math.round(out * 100) / 100;
}
