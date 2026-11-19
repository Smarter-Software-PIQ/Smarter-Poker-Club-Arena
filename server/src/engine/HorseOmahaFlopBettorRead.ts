/**
 * THE FLOP VERDICT READS THE BETTOR (PLO Strategy lane 2026-11-19; option
 * omahaFlopVerdictReadsTheBettor, default OFF, read `=== true`; it acts only
 * where omahaFlopFacingBetEv decides).
 *
 * Owner, 2026-11-16: every decision is priced from the hand and its equity
 * against the opponent's perceived range for that action, line and board, his
 * measured tendencies, the price, the stack depth and the position; no
 * blanket rule; how far the Horse moves from the population toward one
 * player's measured tendency grows smoothly with the sample.
 *
 * What was missing. The flop facing-bet verdict (HorseOmahaFlopFacingBetEv)
 * prices every bettor's flop bet as the same range: a value region and a
 * non-value share set by the bet's share of the pot and the line. Its one
 * player input is the pooled postflop read (all streets and textures in one
 * counter). So it called too much against a player whose flop bets are
 * narrow and folded too much against one whose flop bets are wide (archive
 * plo-handoff-review-01a1cbbd/flopev3-013U37/FINDINGS.md, RC2 and RC3).
 *
 * What this module is: a pure function from one bettor's durable street
 * record (HorseOmahaStreetRead; HorseMind.omahaStreetReadOf: public actions
 * and board cards only) to two factors the verdict applies.
 *
 *  RANGE   How often he bets THIS flop texture on THIS line (as the last
 *          preflop raiser: his continuation-bet cell; otherwise his flop-bet
 *          cell), beside players of his kind. MEASURED on production hands
 *          with every bettor's cards known: the more often a player bets a
 *          flop, the weaker the hands he bets it with. The mean strength
 *          percentile of the hand behind a first flop bet (0 = the strongest
 *          holding on that flop) moves by `slope` per unit of the natural
 *          log of his rate over his kind's rate. In the verdict's range the
 *          mean percentile is (value share + non-value share) / 2, so both
 *          shares take one factor
 *            1 + 2 x slope x ln(ratio) / (value share + non-value share):
 *          a player who bets this flop less often than his kind has a
 *          narrower value region AND fewer other holdings behind his bet; a
 *          player who bets it more often has both wider. A raise has no
 *          cell (the record does not count flop raises): its range is not
 *          moved.
 *  LATER   How often he bets the turn and the river beside his kind. The
 *          verdict's realization model gives a non-value holding a share of
 *          later streets it checks (OMAHA_FLOP_RUNOUT_CHECKDOWN); the share
 *          it BETS is multiplied by his measured turn and river bet rate
 *          over his kind's (the geometric mean of the two streets). Against
 *          a player who keeps betting, the equity that sits on runouts where
 *          the hand cannot call again is realized less; against one who
 *          gives up, more. This is the model's own mechanism with his rate
 *          in place of the population's: the size of the effect on realized
 *          chips is NOT separately measured.
 *
 * SAMPLE SIZE. Each rate is the posterior mean of his cell against his
 * kind's rate with K pseudo-opportunities: (hits + K x prior) / (opp + K).
 * With no opportunity the ratio is exactly 1 and both factors are exactly 1;
 * it moves continuously with every opportunity; no threshold anywhere. K is
 * measured per kind and cell from the spread of true rates between players
 * (so that a cell is believed in proportion to what it can know). The cells
 * are decayed (half-life 30 opportunities), so a cell never holds more than
 * about 44 opportunities and no rate ever moves more than about half way to
 * his own figure.
 *
 * TWO KINDS, TWO PRIORS. A person is read against persons and a Horse
 * against Horses, each with its own rates, K and slopes (never a person
 * figure for a Horse: that was the loss of the priced families at Horse-only
 * tables, archive priced-01BNteGZ/ALLON-DIAGNOSIS-20261118.md). A bettor
 * whose kind the decision does not know is not read.
 *
 * Measured constants, their sources, sample sizes and what is NOT measured:
 * docs/horse-option-authority.d/omahaFlopVerdictReadsTheBettor.md. Nothing
 * here is keyed to an account: every player with a record is read the same
 * way.
 *
 * Pure: no telemetry, no opponent memory, no random draw.
 */
import {
  validStreetRead,
  type FlopTexture,
  type StreetReadCell,
  type StreetReadCounters,
} from './HorseOmahaStreetRead.js';
import type { OmahaOpponentKind } from './HorseOmahaPricedMode.js';

/** The flop cell a first bet is read from: the last preflop raiser's continuation bet, or any other first bet. */
export type OmahaFlopBettorLine = 'cbet' | 'flopBet';

export interface OmahaFlopBettorKindPrior {
  /** the kind's bet rate with no bet yet on the flop, by texture: as the last preflop raiser, and in any role */
  readonly cbet: Readonly<Record<FlopTexture, number>>;
  readonly flopBet: Readonly<Record<FlopTexture, number>>;
  /** the kind's bet rate with no bet yet on the turn and on the river */
  readonly turnBet: number;
  readonly riverBet: number;
  /** pseudo-opportunities at the kind's rate, per cell family */
  readonly strength: Readonly<Record<OmahaFlopBettorLine | 'turnBet' | 'riverBet', number>>;
  /** the move of the mean strength percentile of his bet per unit of ln(his rate / the kind's rate) */
  readonly slope: Readonly<Record<OmahaFlopBettorLine, number>>;
}

/**
 * PERSONS. Rates: the street-read reducer (streetReadHandIncrements) run over
 * 16,952 PLO4/PLO5 cash hands with a flop and a person seated, 2026-10-15 to
 * 2026-11-18 (46 persons), each person's opportunities capped at 300 per
 * cell so that no one player sets the prior (one player holds 46 percent of
 * the uncapped opportunities). Strength: K = mean x (1 - mean) / (variance of
 * true rates between players) - 1 on the same hands. Slope: 2,286
 * continuation bets by 39 persons +0.272 (SE 0.068, bootstrap over bettors)
 * and +0.254 (SE 0.084) without the highest-volume person; 1,504 other first
 * bets by 34 persons +0.155 (SE 0.060) and +0.158 (SE 0.051) without him;
 * each shrunk toward no relation by its own error (b^3 / (b^2 + SE^2)) and
 * the smaller of the two taken.
 */
const PERSON: OmahaFlopBettorKindPrior = Object.freeze({
  cbet: Object.freeze({ paired: 0.444, rainbow: 0.586, twoTone: 0.573, monotone: 0.304 }),
  flopBet: Object.freeze({ paired: 0.25, rainbow: 0.349, twoTone: 0.339, monotone: 0.203 }),
  turnBet: 0.378,
  riverBet: 0.331,
  strength: Object.freeze({ cbet: 25, flopBet: 41, turnBet: 44, riverBet: 40 }),
  slope: Object.freeze({ cbet: 0.23, flopBet: 0.135 }),
});
/**
 * HORSES. Rates: the sum of the Horses' own production street records
 * (the street record column of their exact profiles, PLO4/PLO5 cash, full and short
 * tables, 1,104 rows, read 2026-11-19T18:19Z): the cells a decision reads
 * are these decayed cells, so the reference is the same statistic at the
 * same age. THEY AGE WITH THE BRAIN: the same reducer over the Horses' hands
 * of 2026-10-15 to 2026-11-18 gives continuation bets 0.57 to 0.64, flop
 * bets 0.27 to 0.30, turn 0.385 and river 0.318; a release that changes how
 * often Horses bet moves every Horse beside this prior at once (authority
 * file, "Known limits"). Strength: between-Horse spread on those hands.
 * Slope: 5,500 continuation bets by 653 Horses +0.169 (SE 0.155) and 2,088
 * other first bets by 503 Horses +0.116 (SE 0.053), shrunk as above. A
 * Horse's flop range moves less with its rate than a person's.
 */
const HORSE: OmahaFlopBettorKindPrior = Object.freeze({
  cbet: Object.freeze({ paired: 0.688, rainbow: 0.692, twoTone: 0.728, monotone: 0.76 }),
  flopBet: Object.freeze({ paired: 0.408, rainbow: 0.411, twoTone: 0.431, monotone: 0.448 }),
  turnBet: 0.47,
  riverBet: 0.626,
  strength: Object.freeze({ cbet: 61, flopBet: 53, turnBet: 68, riverBet: 73 }),
  slope: Object.freeze({ cbet: 0.09, flopBet: 0.1 }),
});
export const OMAHA_FLOP_BETTOR_PRIOR: Readonly<
  Record<OmahaOpponentKind, OmahaFlopBettorKindPrior>
> = Object.freeze({ person: PERSON, horse: HORSE });

/** Bounds of the range factor and of the later-street factor: guards, not reached by a cell of 44 opportunities. */
export const OMAHA_FLOP_BETTOR_RANGE_FACTOR_MIN = 0.6;
export const OMAHA_FLOP_BETTOR_RANGE_FACTOR_MAX = 1.4;
export const OMAHA_FLOP_BETTOR_LATER_FACTOR_MIN = 0.5;
export const OMAHA_FLOP_BETTOR_LATER_FACTOR_MAX = 1.5;

export interface OmahaFlopBettorRate {
  /** his posterior rate over his kind's rate: exactly 1 with no opportunity */
  ratio: number;
  /** opp / (opp + K): how far the rate has moved from the kind's toward his own */
  weight: number;
  /** the decayed opportunities of the cell */
  opportunities: number;
}

/**
 * One cell against the kind's rate: the posterior mean with `strength`
 * pseudo-opportunities, over the prior. A cell that is missing or not
 * well-formed reads as no opportunity (ratio 1, weight 0).
 */
export function omahaFlopBettorRate(
  cell: StreetReadCell | null | undefined,
  prior: number,
  strength: number
): OmahaFlopBettorRate {
  const none = { ratio: 1, weight: 0, opportunities: 0 };
  if (!cell || !(prior > 0 && prior < 1) || !(strength > 0)) return none;
  const opp = cell.opp;
  const hit = cell.hit;
  if (!Number.isFinite(opp) || !Number.isFinite(hit) || !(opp > 0) || hit < 0 || hit > opp + 1e-9)
    return none;
  const rate = (Math.min(hit, opp) + strength * prior) / (opp + strength);
  return { ratio: rate / prior, weight: opp / (opp + strength), opportunities: opp };
}

export interface OmahaFlopBettorRead {
  kind: OmahaOpponentKind;
  texture: FlopTexture | null;
  /** the flop cell read, or null for a raise or a flop with no texture (the range is then not moved) */
  line: OmahaFlopBettorLine | null;
  /** his bet rate on this texture and line beside his kind */
  bet: OmahaFlopBettorRate;
  /** the factor on the verdict's value share and non-value share (1: the population's range) */
  rangeFactor: number;
  /** his turn and river bet rates beside his kind, and their geometric mean */
  turn: OmahaFlopBettorRate;
  river: OmahaFlopBettorRate;
  /** the factor on the share of later streets a non-value holding bets (1: the population's) */
  laterBetFactor: number;
}

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/**
 * The range factor for a rate ratio: the measured move of the mean strength
 * percentile, 2 x slope x ln(ratio), as a share of the verdict's value share
 * plus non-value share. Exactly 1 at ratio 1.
 */
export function omahaFlopBettorRangeFactor(ratio: number, slope: number, shares: number): number {
  if (!(ratio > 0) || !Number.isFinite(ratio) || !Number.isFinite(slope) || !(shares > 0)) return 1;
  if (ratio === 1) return 1;
  return clamp(
    1 + (2 * slope * Math.log(ratio)) / shares,
    OMAHA_FLOP_BETTOR_RANGE_FACTOR_MIN,
    OMAHA_FLOP_BETTOR_RANGE_FACTOR_MAX
  );
}

/**
 * The bettor's read for one flop decision, or null when there is nothing to
 * read: no record for him, a record that is not well-formed, or a kind the
 * decision does not know. With a record that holds no opportunity in the
 * cells asked, both factors are exactly 1.
 *
 * @param counters  his street record as the decision carries it (the counters HorseMind.omahaStreetReadOf answers)
 * @param kind      who plays the seat (HorseOmahaPricedMode.omahaOpponentKindOf)
 * @param texture   the flop's texture (HorseOmahaStreetRead.flopTextureOf)
 * @param line      the flop cell of this bet; null for a raise
 * @param shares    the verdict's value share plus non-value share for this bet and line
 */
export function omahaFlopBettorRead(
  counters: StreetReadCounters | null | undefined,
  kind: OmahaOpponentKind | null | undefined,
  texture: FlopTexture | null,
  line: OmahaFlopBettorLine | null,
  shares: number
): OmahaFlopBettorRead | null {
  if (kind !== 'person' && kind !== 'horse') return null;
  if (!counters || !validStreetRead(counters)) return null;
  const P = OMAHA_FLOP_BETTOR_PRIOR[kind];
  const cellLine = texture ? line : null;
  const bet =
    cellLine && texture
      ? omahaFlopBettorRate(counters[cellLine][texture], P[cellLine][texture], P.strength[cellLine])
      : { ratio: 1, weight: 0, opportunities: 0 };
  const turn = omahaFlopBettorRate(counters.bet.turn, P.turnBet, P.strength.turnBet);
  const river = omahaFlopBettorRate(counters.bet.river, P.riverBet, P.strength.riverBet);
  const later = turn.ratio === 1 && river.ratio === 1 ? 1 : Math.sqrt(turn.ratio * river.ratio);
  return {
    kind,
    texture,
    line: cellLine,
    bet,
    rangeFactor: cellLine ? omahaFlopBettorRangeFactor(bet.ratio, P.slope[cellLine], shares) : 1,
    turn,
    river,
    laterBetFactor:
      later === 1
        ? 1
        : clamp(later, OMAHA_FLOP_BETTOR_LATER_FACTOR_MIN, OMAHA_FLOP_BETTOR_LATER_FACTOR_MAX),
  };
}

/**
 * The bettor made the last preflop raise (the level raised over the forced
 * posts): his first flop bet is a continuation bet. The same reading of the
 * preflop actions as the verdict's own spot (omahaFlopFacingBetEvSpot).
 */
export function omahaFlopBettorIsPreflopAggressor(
  actionHistory:
    | ReadonlyArray<{ stage?: unknown; seat: number; action: string; amount?: number }>
    | null
    | undefined,
  bettorSeat: number
): boolean {
  let level = 0;
  let aggressor: number | null = null;
  const totals = new Map<number, number>();
  for (const a of actionHistory ?? []) {
    if (String(a.stage) !== 'preflop') continue;
    const prev = totals.get(a.seat) ?? 0;
    const amt = Number.isFinite(a.amount) ? Math.max(0, a.amount as number) : 0;
    if (a.action === 'fold') continue;
    if (a.action === 'call') totals.set(a.seat, prev + amt);
    else if (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in') {
      const now = Math.max(prev, amt);
      totals.set(a.seat, now);
      if (now > level + 0.005) {
        level = now;
        aggressor = a.seat;
      }
    } else if (amt > level) level = amt; // a forced post sets the level; it is not a raise
  }
  return aggressor !== null && aggressor === bettorSeat;
}
