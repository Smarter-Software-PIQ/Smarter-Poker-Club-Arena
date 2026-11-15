/**
 * THE GAME SCOPE OF THE 2026-11-15 OMAHA STRATEGY OPTIONS, ONE FUNCTION (PLO
 * Strategy, the PLO6 lane's interface, accepted 2026-11-15).
 *
 * Owner 2026-11-15 13:16 Chicago: "ALL THE RULES AND THINGS WE ADJUSTED
 * TODAY, ALL NEED TO BE SHARED WITH PLO6 AND IMPLEMENTED FOR TOURNAMENTS AS
 * WELL."
 *
 *  - omahaStrategyGameInScope(set, gs, opts?): every game-scope gate of the
 *    day's options asks this instead of `set.has(variant)`. It is the set's
 *    own answer for every game, and additionally true for 'plo6' when the set
 *    is a PLO4/PLO5 set and opts.omahaStrategyInPlo6 === true. The PLO6 lane
 *    owns and registers that option (HorseDecideOpts field, ledger row,
 *    switch); unset, PLO6 is outside exactly as before. A gate inside a
 *    module that is not handed the options reads the decision's scope, which
 *    HorseLogic.decide sets from its options (withOmahaStrategyGameScope).
 *  - omahaStrategyConstant(key, gs): the hand-size dependent constants of the
 *    day's rules. PLO4/PLO5 (and every other game) read the values below,
 *    which are the modules' own exported constants, unchanged. PLO6 reads
 *    the PLO6 lane's calibration (HorsePlo6StrategyCalibration.ts registers
 *    it with registerOmahaPlo6StrategyCalibration); a key it does not set,
 *    or no calibration at all, reads the same default.
 *  - omahaStrategyHoleCount(gs) / omahaStrategyHoleCountServed(count): the
 *    size of a hand, for every hole-count check of the day's rules.
 *
 * Decisions are synchronous, so the scope is module-level, restored on every
 * exit (as HorseOmahaTournamentScope).
 */

/** The values the day's rules use today (each equals its module's exported constant). */
export const OMAHA_STRATEGY_CONSTANT_DEFAULTS = Object.freeze({
  /** HorseOmahaFacingBetEv OMAHA_FACING_BET_EV_MARGIN */
  facingBetEvMargin: 0.02,
  /** HorseOmahaRiverMediumBetCalls OMAHA_RIVER_MEDIUM_BET_RANGE_FACTOR */
  riverMediumBetRangeFactor: 1.5,
  /** HorsePloPairedBoardFold PAIRED_FOLD_RESPECTED_MAX_PRICE */
  pairedFoldRespectedMaxPrice: 0.25,
  /** HorsePloPairedBoardFold PAIRED_FOLD_RESPECTED_INVESTED_SHARE */
  pairedFoldRespectedInvestedShare: 0.6,
  /** HorseOmahaOopChecks OMAHA_OOP_TURN_MIN_NUT_OUTS */
  oopTurnMinNutOuts: 4,
  /** HorseOmahaOopChecks OMAHA_OOP_TURN_SHOWDOWN_CREDIT */
  oopTurnShowdownCredit: 0.15,
  /** HorseOmahaOopChecks OMAHA_OOP_TURN_TOKEN_PRICE */
  oopTurnTokenPrice: 0.15,
  /** HorseOmahaCardImpact OMAHA_CARD_IMPACT_MARGIN */
  cardImpactMargin: 0.04,
  /** HorseOmahaStreetPlan OMAHA_STREET_PLAN_MARGIN_POT_SHARE */
  streetPlanMarginPotShare: 0.02,
  /** HorseOmahaBigDrawAggression OMAHA_BIG_DRAW_MARGIN */
  bigDrawMargin: 0.02,
  /** HorseOmahaTurnRiverRaiseNeedsNuts OMAHA_RAISE_NEEDS_NUTS_FOLD_PRICE */
  raiseNeedsNutsFoldPrice: 1 / 3,
  /** HorseLogic OMAHA_ELITE_CONTINUE_MAX_POT_ODDS */
  eliteContinueMaxPotOdds: 0.34,
  /** HorseLogic OMAHA_BIG_BET_POT_SHARE */
  bigBetPotShare: 0.7,
  /** HorseOmahaTournamentScope OMAHA_TOURNAMENT_PUSH_FOLD_MAX_BB */
  tournamentPushFoldMaxBB: 14,
  /**
   * HorseOmahaMadeHandDefense OMAHA_TURN_REDRAW_NUT_FULL_HOUSE_ONLY (a switch:
   * 0 or 1). 0: omahaTurnRedrawShare counts every full house or better as an
   * out. 1: only one no bigger full house beats (PLO6 lane, H9).
   */
  turnRedrawNutFullHouseOnly: 0,
  /**
   * HorseOmahaCardImpact OMAHA_CARD_IMPACT_DISTINCT_DRAW_OUTS (a switch: 0 or
   * 1). 0: a sampled hand's draw outs are the fixed form (flush 9 or 5.4,
   * three per straight rank, added). 1: every live completing card once, a
   * non-nut flush card 0.6 (PLO6 lane, H19).
   */
  cardImpactDistinctDrawOuts: 0,
  /**
   * HorseOmahaBigDrawAggression OMAHA_BIG_DRAW_CONTINUE_STRAIGHT_OUTS. 0: no
   * straight draw is in the range that continues against a bet. N > 0: a
   * hand with N or more straight outs continues against a bet (PLO6 lane,
   * H15: 13).
   */
  bigDrawContinueStraightOuts: 0,
});
export type OmahaStrategyConstantKey = keyof typeof OMAHA_STRATEGY_CONSTANT_DEFAULTS;
export type OmahaPlo6StrategyCalibration = Partial<Record<OmahaStrategyConstantKey, number>>;

let plo6Calibration: OmahaPlo6StrategyCalibration = {};

/** Called by HorsePlo6StrategyCalibration.ts (the PLO6 lane) with its values. */
export function registerOmahaPlo6StrategyCalibration(values: OmahaPlo6StrategyCalibration): void {
  const next: OmahaPlo6StrategyCalibration = {};
  for (const [k, v] of Object.entries(values ?? {}))
    if (k in OMAHA_STRATEGY_CONSTANT_DEFAULTS && typeof v === 'number' && Number.isFinite(v))
      next[k as OmahaStrategyConstantKey] = v;
  plo6Calibration = Object.freeze(next);
}

const variantOf = (gs: { gameVariant?: unknown } | null | undefined): string =>
  String(gs?.gameVariant ?? '').toLowerCase();

/**
 * The hole cards each pot-limit Omaha high game deals. A rule of the day
 * that checks the size of a hand reads it here, never as a literal 4 or 5
 * (PLO6 lane 2026-11-15, H20/H26: a literal check silently switches a rule
 * off for six cards once its variant gate admits PLO6).
 */
export const OMAHA_STRATEGY_HOLE_COUNTS: Readonly<Record<string, number>> = Object.freeze({
  plo4: 4,
  plo5: 5,
  plo6: 6,
});

/** The hole cards this game deals; 0 when it is not PLO4, PLO5 or PLO6. */
export function omahaStrategyHoleCount(gs: { gameVariant?: unknown } | null | undefined): number {
  return OMAHA_STRATEGY_HOLE_COUNTS[variantOf(gs)] ?? 0;
}

/**
 * Whether `count` hole cards is a hand the day's computations serve (four,
 * five or six). For a computation that is handed cards and no game: which
 * games reach it is its caller's game-scope gate (omahaStrategyGameInScope),
 * so six cards arrive only with the PLO6 lane's option on.
 */
export function omahaStrategyHoleCountServed(count: number): boolean {
  return Object.values(OMAHA_STRATEGY_HOLE_COUNTS).includes(count);
}

/** The constant for this game: PLO6 from its calibration when set, every other game the default. */
export function omahaStrategyConstant(
  key: OmahaStrategyConstantKey,
  gs: { gameVariant?: unknown } | null | undefined
): number {
  if (variantOf(gs) === 'plo6') {
    const v = plo6Calibration[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return OMAHA_STRATEGY_CONSTANT_DEFAULTS[key];
}

export interface OmahaStrategyGameScope {
  /** opts.omahaStrategyInPlo6 === true for this decision. */
  readonly plo6: boolean;
}
export const OMAHA_STRATEGY_GAME_SCOPE_OFF: OmahaStrategyGameScope = Object.freeze({ plo6: false });
/**
 * The receipt validator's scope. The request carries no options, and the
 * validator's PLO6 refusals are the PLO6 lane's own (plo6RiverCallReceipt,
 * the PLO6 final river discipline receipt): so PLO6 is NOT admitted to the
 * day's PLO4/PLO5 admissions here. When the PLO6 lane switches its option
 * on it owns the matching admission (set this to true, or admit PLO6 in its
 * own receipts).
 */
export const OMAHA_STRATEGY_GAME_SCOPE_ADMISSION: OmahaStrategyGameScope = Object.freeze({
  plo6: false,
});
let current: OmahaStrategyGameScope = OMAHA_STRATEGY_GAME_SCOPE_OFF;

export function withOmahaStrategyGameScope<T>(scope: OmahaStrategyGameScope, fn: () => T): T {
  const previous = current;
  current = scope;
  try {
    return fn();
  } finally {
    current = previous;
  }
}

/** The scope of a decision from its options (the PLO6 lane's option, read `=== true`). */
export function omahaStrategyGameScopeOf(opts: object | null | undefined): OmahaStrategyGameScope {
  return (opts as { omahaStrategyInPlo6?: unknown } | null | undefined)?.omahaStrategyInPlo6 ===
    true
    ? Object.freeze({ plo6: true })
    : OMAHA_STRATEGY_GAME_SCOPE_OFF;
}

export function omahaStrategyGameScopeNow(): OmahaStrategyGameScope {
  return current;
}

/**
 * Whether the game is in a rule's scope: the set's own answer, and PLO6 too
 * when the set is a PLO4/PLO5 set and omahaStrategyInPlo6 is on (from `opts`
 * when given, else from the decision's scope).
 */
export function omahaStrategyGameInScope(
  set: ReadonlySet<string>,
  gs: { gameVariant?: unknown } | null | undefined,
  opts?: object | null
): boolean {
  const v = variantOf(gs);
  if (set.has(v)) return true;
  if (v !== 'plo6' || !(set.has('plo4') || set.has('plo5'))) return false;
  return opts != null ? omahaStrategyGameScopeOf(opts).plo6 : current.plo6;
}

/** The PLO4/PLO5 set of the day's options written inline (gameVariant === 'plo4' || 'plo5'). */
export const OMAHA_STRATEGY_PLO45: ReadonlySet<string> = new Set(['plo4', 'plo5']);
