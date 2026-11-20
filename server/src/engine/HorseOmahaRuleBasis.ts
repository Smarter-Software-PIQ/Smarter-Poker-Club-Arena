/**
 * THE OMAHA RULE BASIS: EVERY PLO4/PLO5 CASH DECISION RULE DECLARES HOW IT IS
 * PRICED, OR WHY IT IS EXEMPT (2026-11-20, lane BLANKET-AUDIT of the PLO-OWNER
 * programme).
 *
 * Owner, 2026-11-20 3:28 PM Chicago: "THERE SHOULD NEVER EVER EVER BY ANY
 * BLANKET RULES. MAKE SURE THEY ARE ALL REMOVED IF THEY SOMEHOW GOT ADDED BACK
 * IN." Standing definition (2026-11-17): "EVERY DECISION NEEDS TO BE 100%
 * INDEPENDANT AND DATA AND MATH DERRIVED AND BY RANGES, NEVER BLANKETS".
 *
 * This file extends the register of HorseOmahaRuleSites.ts (the law
 * HorseOmahaNoBlanketRule.law.test.ts reads that one): the register says what
 * class a rule is; this file says what its decision is computed from. The law
 * HorseOmahaRuleBasis.law.test.ts fails the build when
 *  - an Omaha option of the register, or an option a registered rule site
 *    names, has no declaration here;
 *  - a 'priced' declaration does not state its range, equity method,
 *    realization and price;
 *  - a 'blanket' or 'partly' declaration is added: the backlog lists below may
 *    only shrink (a categorical rule cannot be registered for PLO4/PLO5 cash);
 *  - a blanket rule claims omahaNoCategoricalRules removes it but is not in
 *    OMAHA_NO_CATEGORICAL_RULES_OFF;
 *  - a new omaha_* / plo_* receipt is fired from engine source without a
 *    declaration (a new rule site always fires a receipt).
 *
 * Kinds:
 *  - priced: the action is the EV maximum from equity against a stated range,
 *    realization and the price after deduction.
 *  - exempt: an arithmetic invariant, a legality or validator constraint, an
 *    owner game rule (VPIP floor, bomb-pot timers), a scope gate that decides
 *    no action, an input of a priced comparison, or another game.
 *  - blanket: the action or size is decided by a category list or a fixed
 *    threshold. Backlog only: each names what removes it.
 *  - partly: an EV comparison whose gate or inputs are categorical (a class
 *    gate, a class cap, a label multiplier, an unmeasured constant). Backlog.
 *  - review: not verified at the line level when this file was written.
 *    Backlog: each must be moved to priced, exempt or blanket.
 *
 * No decision reads this file.
 */

export interface OmahaPricedBasis {
  kind: 'priced';
  /** whose range, and where it comes from */
  range: string;
  /** how the equity against it is computed */
  equity: string;
  /** what realizes it (measured realization, response frequencies, showdown) */
  realization: string;
  /** the price it is compared with */
  price: string;
}
export type OmahaExemption =
  | 'arithmetic_invariant'
  | 'legality'
  | 'owner_game_rule'
  | 'scope'
  | 'input'
  | 'other_game';
export interface OmahaExemptBasis {
  kind: 'exempt';
  exemption: OmahaExemption;
  why: string;
}
export interface OmahaBlanketBasis {
  kind: 'blanket' | 'partly';
  /** options that, when on, take the decision away from it in PLO4/PLO5 cash */
  neutralisedBy: readonly string[];
  /** what decides by category, and the removal */
  what: string;
}
export interface OmahaReviewBasis {
  kind: 'review';
  why: string;
}
export type OmahaRuleBasis =
  | OmahaPricedBasis
  | OmahaExemptBasis
  | OmahaBlanketBasis
  | OmahaReviewBasis;

const exempt = (exemption: OmahaExemption, why: string): OmahaExemptBasis => ({
  kind: 'exempt',
  exemption,
  why,
});
const blanket = (neutralisedBy: readonly string[], what: string): OmahaBlanketBasis => ({
  kind: 'blanket',
  neutralisedBy,
  what,
});
const partly = (neutralisedBy: readonly string[], what: string): OmahaBlanketBasis => ({
  kind: 'partly',
  neutralisedBy,
  what,
});
const review = (why: string): OmahaReviewBasis => ({ kind: 'review', why });

/** the facing-bet EV verdicts (HorseOmahaFacingBetEv.ts and the options that feed it) */
const FACING_BET_EV: OmahaPricedBasis = {
  kind: 'priced',
  range:
    "the bettor's range of the facing-bet model: his measured street record and value share, continuous in the bet size",
  equity: 'the exact 2+3 equity count against that range (omahaFacingBetEvSpot)',
  realization: 'the measured realization by street and runout of such calls',
  price: 'the call against the pot after the projected rake and jackpot deduction',
};
/** the card-impact model (HorseOmahaCardImpact.ts, HorseOmahaPricedSites.ts) */
const CARD_IMPACT: OmahaPricedBasis = {
  kind: 'priced',
  range: 'his range after the new card (the range the card left, card-impact model)',
  equity: 'sampled equity of the hand against that range',
  realization: 'his measured response to each pot share (fold, call and raise frequencies)',
  price: 'each legal bet size against the check',
};
/** the priced raise (sampled continuing range at every legal size) */
const PRICED_RAISE: OmahaPricedBasis = {
  kind: 'priced',
  range: "the raised player's continuing range at each legal raise size (sampled shares)",
  equity: 'equity against the continuing range on the exact count',
  realization: 'his measured fold share at each size; showdown after the last street',
  price: 'each legal raise size against the call and the fold',
};
/** a bet facing no bet, priced against the target's measured fold */
const BET_EV: OmahaPricedBasis = {
  kind: 'priced',
  range: "the target's range facing the bet (bettor-side sampler bands of his holdings)",
  equity: 'equity when called, sampled against that range',
  realization:
    'his measured fold share at the size (fold model fitted on people, shrunk by his own read)',
  price: 'the bet size against the check',
};
/** the math core (omahaMathCore/) */
const MATH_CORE: OmahaPricedBasis = {
  kind: 'priced',
  range: "each opponent's public range from his public actions",
  equity: 'exact 2+3 equity against those ranges',
  realization: 'measured fold and response frequencies; showdown after the last street',
  price: 'every legal action at its price after the dealt-player rake cap and jackpot drop',
};
/** the priced preflop re-raise defence family */
const PREFLOP_PRICED: OmahaPricedBasis = {
  kind: 'priced',
  range: "the opener's or re-raiser's measured preflop range for the line",
  equity: 'all-in equity of the hand against that range',
  realization: 'position and depth realization measured on cash hands',
  price: 'the call or re-raise against the pot after deduction',
};

/** every option of OMAHA_OPTION_CLASSES (HorseOmahaRuleSites.ts), by its pricing basis */
export const OMAHA_OPTION_BASIS: Readonly<Record<string, OmahaRuleBasis>> = Object.freeze({
  omahaAcesReraiseIsMeasured: review(
    'pricing basis not verified at the line level by BLANKET-AUDIT 2026-11-20'
  ),
  omahaBandFallbackInBandUnit: exempt('input', 'an input of a priced comparison, not a rule site'),
  omahaBareOverpairOopFlopCheck: blanket(
    ['omahaNoCategoricalRules'],
    'the register classes it categorical; removal: switch-off with omahaNoCategoricalRules in PLO4/PLO5 cash, then delete'
  ),
  omahaBeatenMadeHandDefense: blanket(
    ['omahaNoCategoricalRules'],
    'the register classes it categorical; removal: switch-off with omahaNoCategoricalRules in PLO4/PLO5 cash, then delete'
  ),
  omahaBetReadIsModeSplit: exempt('input', 'an input of a priced comparison, not a rule site'),
  omahaBetReadIsPerOpponent: exempt('input', 'an input of a priced comparison, not a rule site'),
  omahaBetSizeByPublicState: review(
    'pricing basis not verified at the line level by BLANKET-AUDIT 2026-11-20'
  ),
  omahaBigBetCallsArePriced: FACING_BET_EV,
  omahaBigBetIsPotShare: blanket(
    [],
    'the register classes it open; no scoped switch removes it: code change to the priced computation'
  ),
  omahaBigDrawAggression: review(
    'pricing basis not verified at the line level by BLANKET-AUDIT 2026-11-20'
  ),
  omahaBlockerBluffIsPriced: CARD_IMPACT,
  omahaBluffCatcherFoldVsValueLeader: blanket(
    ['omahaNoCategoricalRules'],
    'the register classes it categorical; removal: switch-off with omahaNoCategoricalRules in PLO4/PLO5 cash, then delete'
  ),
  omahaBluffCatcherRaiseFold: blanket(
    ['omahaNoCategoricalRules'],
    'the register classes it categorical; removal: switch-off with omahaNoCategoricalRules in PLO4/PLO5 cash, then delete'
  ),
  omahaBluffIsPricedAgainstTheTarget: BET_EV,
  omahaBluffShareFromBetRate: FACING_BET_EV,
  omahaCardImpact: CARD_IMPACT,
  omahaCheckedToBetInLightning: exempt('scope', 'decides where a rule applies, never the action'),
  omahaCheckedToBetIsPriced: BET_EV,
  omahaCheckedToBetResponseIsMeasured: exempt(
    'input',
    'an input of a priced comparison, not a rule site'
  ),
  omahaClassCapsRespectEquity: FACING_BET_EV,
  omahaColdCallOutsideBigBlindIsMeasured: review(
    'pricing basis not verified at the line level by BLANKET-AUDIT 2026-11-20'
  ),
  omahaCommitZoneThreeBetPriceRelief: review(
    'pricing basis not verified at the line level by BLANKET-AUDIT 2026-11-20'
  ),
  omahaCurrentNutsRaise: blanket(
    [],
    'the register classes it open; no scoped switch removes it: code change to the priced computation'
  ),
  omahaDrawRaiseIsPriced: PRICED_RAISE,
  omahaEliteContinuesVsMeasuredWideThreeBettor: blanket(
    [],
    'an elite hand class continues against a wide 3-bettor; removal: priced preflop re-raise defence'
  ),
  omahaEvFoldModel: exempt('input', 'an input of a priced comparison, not a rule site'),
  omahaEvFoldModelHeadsUp: BET_EV,
  omahaEvFoldModelSkipsPlo45: exempt('scope', 'decides where a rule applies, never the action'),
  omahaFacingBetEv: FACING_BET_EV,
  omahaFacingBetEvShownField: FACING_BET_EV,
  omahaFacingBetIsPricedByEquity: FACING_BET_EV,
  omahaFacingBetPaysTheWholeDeduction: exempt(
    'input',
    'an input of a priced comparison, not a rule site'
  ),
  omahaFacingBetRangeIsContinuous: FACING_BET_EV,
  omahaFacingBetValueIsRangeRelative: FACING_BET_EV,
  omahaFacingBetValueShareIsMeasured: exempt(
    'input',
    'an input of a priced comparison, not a rule site'
  ),
  omahaFlopBetIsPriced: CARD_IMPACT,
  omahaFlopBetPricesTheRaise: BET_EV,
  omahaFlopBetUsesMeasuredFoldShare: BET_EV,
  omahaFlopDefenceIsPriced: FACING_BET_EV,
  omahaFlopFacingBetEv: FACING_BET_EV,
  omahaFlopVerdictReadsTheBettor: exempt(
    'input',
    'an input of a priced comparison, not a rule site'
  ),
  omahaFoldModelFittedOnPeople: BET_EV,
  omahaHiLoTournamentFirstIn: exempt(
    'other_game',
    'PLO6, tournaments or hi-lo: outside PLO4/PLO5 cash'
  ),
  omahaMadeHandBetIsPriced: CARD_IMPACT,
  omahaMadeHandDefenseVsValueLeader: blanket(
    ['omahaNoCategoricalRules'],
    'the register classes it categorical; removal: switch-off with omahaNoCategoricalRules in PLO4/PLO5 cash, then delete'
  ),
  omahaManiacReRaiseWidthMeasured: exempt(
    'input',
    'an input of a priced comparison, not a rule site'
  ),
  omahaMathCore: MATH_CORE,
  omahaMathCoreNetsTheWholeDeduction: exempt(
    'input',
    'an input of a priced comparison, not a rule site'
  ),
  omahaMathCorePlo4Flop: exempt('scope', 'decides where a rule applies, never the action'),
  omahaMathCorePlo4River: exempt('scope', 'decides where a rule applies, never the action'),
  omahaMathCorePlo4Turn: exempt('scope', 'decides where a rule applies, never the action'),
  omahaMathCorePlo5Flop: exempt('scope', 'decides where a rule applies, never the action'),
  omahaMathCorePlo5River: exempt('scope', 'decides where a rule applies, never the action'),
  omahaMathCorePlo5Turn: exempt('scope', 'decides where a rule applies, never the action'),
  omahaMathCorePreflop: MATH_CORE,
  omahaMultiwayCheckedToBetIsPriced: BET_EV,
  omahaMultiwayIsPricedInTournaments: exempt(
    'other_game',
    'PLO6, tournaments or hi-lo: outside PLO4/PLO5 cash'
  ),
  omahaMultiwayRiverCallNeedsStrength: review(
    'pricing basis not verified at the line level by BLANKET-AUDIT 2026-11-20'
  ),
  omahaMultiwayWeakHandNoBet: review(
    'pricing basis not verified at the line level by BLANKET-AUDIT 2026-11-20'
  ),
  omahaNeutralUnknown: exempt('input', 'an input of a priced comparison, not a rule site'),
  omahaNoCallColdFourBetWithoutPremium: blanket(
    ['omahaNoCategoricalRules'],
    'no cold 4-bet call without a premium class; removal: priced preflop re-raise defence'
  ),
  omahaNoCategoricalRules: exempt('scope', 'decides where a rule applies, never the action'),
  omahaNoDrawRaiseOutOfPosition: blanket(
    ['omahaNoCategoricalRules'],
    'the register classes it categorical; removal: switch-off with omahaNoCategoricalRules in PLO4/PLO5 cash, then delete'
  ),
  omahaNoMadeClassCap: FACING_BET_EV,
  omahaNoRiverBluffIntoValueLeader: blanket(
    ['omahaNoCategoricalRules'],
    'the register classes it open; removal: switch-off with omahaNoCategoricalRules in PLO4/PLO5 cash, then delete'
  ),
  omahaNutClassValueSize: review(
    'pricing basis not verified at the line level by BLANKET-AUDIT 2026-11-20'
  ),
  omahaOnePairDiscipline: blanket(
    ['omahaNoCategoricalRules'],
    'the register classes it open; removal: switch-off with omahaNoCategoricalRules in PLO4/PLO5 cash, then delete'
  ),
  omahaOopReraisedPotStrongRange: blanket(
    ['omahaNoCategoricalRules'],
    'out-of-position re-raised pot: strong class list only; removal: priced preflop re-raise defence'
  ),
  omahaOopTurnBarrelIsPriced: CARD_IMPACT,
  omahaOopTurnCheckAfterFlopCall: blanket(
    ['omahaNoCategoricalRules'],
    'the register classes it categorical; removal: switch-off with omahaNoCategoricalRules in PLO4/PLO5 cash, then delete'
  ),
  omahaOpenNeedsMeasuredStrength: review(
    'pricing basis not verified at the line level by BLANKET-AUDIT 2026-11-20'
  ),
  omahaOptionGameScope: exempt('scope', 'decides where a rule applies, never the action'),
  omahaOverpairNoOopBarrelVsValueLeader: blanket(
    ['omahaNoCategoricalRules'],
    'the register classes it categorical; removal: switch-off with omahaNoCategoricalRules in PLO4/PLO5 cash, then delete'
  ),
  omahaPackClampDeepDepth: exempt('scope', 'decides where a rule applies, never the action'),
  omahaPackEffectiveDepth: exempt('scope', 'decides where a rule applies, never the action'),
  omahaPairedBoardBetIsPriced: CARD_IMPACT,
  omahaPairedBoardFoldRespectsPrice: FACING_BET_EV,
  omahaPairedBoardRiverIsPriced: FACING_BET_EV,
  omahaPairedRiverNoThinLeadVsValueLeader: blanket(
    ['omahaNoCategoricalRules'],
    'the register classes it categorical; removal: switch-off with omahaNoCategoricalRules in PLO4/PLO5 cash, then delete'
  ),
  omahaPairedTurnNoBarrelWithoutBoatVsValueLeader: blanket(
    ['omahaNoCategoricalRules'],
    'the register classes it categorical; removal: switch-off with omahaNoCategoricalRules in PLO4/PLO5 cash, then delete'
  ),
  omahaPreflopCallWithActionBehind: review(
    'pricing basis not verified at the line level by BLANKET-AUDIT 2026-11-20'
  ),
  omahaPreflopJamFacingReraiseIsPriced: PREFLOP_PRICED,
  omahaPreflopReraiseDefencePriced: PREFLOP_PRICED,
  omahaPreflopReraiseDefencePricedInPosition: review(
    'pricing basis not verified at the line level by BLANKET-AUDIT 2026-11-20'
  ),
  omahaPreflopStackPlan: review(
    'pricing basis not verified at the line level by BLANKET-AUDIT 2026-11-20'
  ),
  omahaPressureIsPriced: PRICED_RAISE,
  omahaPressureNeedsPostflopAggression: blanket(
    ['omahaNoCategoricalRules'],
    'the register classes it categorical; removal: switch-off with omahaNoCategoricalRules in PLO4/PLO5 cash, then delete'
  ),
  omahaPricedInLightning: exempt('scope', 'decides where a rule applies, never the action'),
  omahaPricedMix: review(
    'pricing basis not verified at the line level by BLANKET-AUDIT 2026-11-20'
  ),
  omahaPricedPriorsByOpponentKind: exempt(
    'input',
    'an input of a priced comparison, not a rule site'
  ),
  omahaPublicBetSizeInLightning: exempt('scope', 'decides where a rule applies, never the action'),
  omahaRaiseEvCountsLossesOnce: exempt('input', 'an input of a priced comparison, not a rule site'),
  omahaReadIsByStreetAndTexture: exempt(
    'input',
    'an input of a priced comparison, not a rule site'
  ),
  omahaReraiseRangeEarlyPosition: blanket(
    ['omahaNoCategoricalRules'],
    're-raise range by position; removal: priced preflop re-raise'
  ),
  omahaReraiseRangeIsMeasured: review(
    'pricing basis not verified at the line level by BLANKET-AUDIT 2026-11-20'
  ),
  omahaReraiseRangeOutOfPosition: blanket(
    ['omahaNoCategoricalRules'],
    're-raise range by position; removal: priced preflop re-raise'
  ),
  omahaReraisedCallVsRaisePriced: PREFLOP_PRICED,
  omahaReraisedFoldVsTight: blanket(
    ['omahaNoCategoricalRules'],
    'preflop fold against a tight label; removal: priced preflop re-raise defence'
  ),
  omahaReraisedPositionInLightning: exempt(
    'scope',
    'decides where a rule applies, never the action'
  ),
  omahaReraisedPotDiscipline: blanket(
    ['omahaNoCategoricalRules'],
    'preflop re-raised pot folds by class; removal: priced preflop re-raise defence'
  ),
  omahaReraisedPotFlopContinueNeedsEquityShape: blanket(
    ['omahaNoCategoricalRules'],
    'the register classes it open; removal: switch-off with omahaNoCategoricalRules in PLO4/PLO5 cash, then delete'
  ),
  omahaReraisedPotStackOffFold: blanket(
    ['omahaNoCategoricalRules'],
    'preflop stack-off fold by class; removal: priced preflop re-raise defence'
  ),
  omahaReraisedPotStackOffRealistic: review(
    'pricing basis not verified at the line level by BLANKET-AUDIT 2026-11-20'
  ),
  omahaRiverBluffCatchIsPriced: FACING_BET_EV,
  omahaRiverCurrentNutsCallFloor: exempt(
    'arithmetic_invariant',
    'a call with the exact current nuts is EV >= 0 by arithmetic (chop-safe); lead ruling 2026-11-20 21:33Z'
  ),
  omahaRiverMediumBetStrongHandCalls: FACING_BET_EV,
  omahaRiverNutBlockerBluffReachable: blanket(
    ['omahaNoCategoricalRules'],
    'the register classes it categorical; removal: switch-off with omahaNoCategoricalRules in PLO4/PLO5 cash, then delete'
  ),
  omahaRiverNutRaiseOnly: blanket(
    ['omahaNoCategoricalRules'],
    'the register classes it categorical; removal: switch-off with omahaNoCategoricalRules in PLO4/PLO5 cash, then delete'
  ),
  omahaRundownReraiseRangeIsMeasured: review(
    'pricing basis not verified at the line level by BLANKET-AUDIT 2026-11-20'
  ),
  omahaRundownReraiseRangeTrial: review(
    'pricing basis not verified at the line level by BLANKET-AUDIT 2026-11-20'
  ),
  omahaSampledRaiseIsPricedAtEverySize: exempt(
    'input',
    'an input of a priced comparison, not a rule site'
  ),
  omahaSlowplayMixInLightning: exempt('scope', 'decides where a rule applies, never the action'),
  omahaSmallBetIsPriced: CARD_IMPACT,
  omahaSmallBlindSteal: review(
    'pricing basis not verified at the line level by BLANKET-AUDIT 2026-11-20'
  ),
  omahaStrategyInPlo6: exempt('scope', 'decides where a rule applies, never the action'),
  omahaStrategyInTournaments: exempt('scope', 'decides where a rule applies, never the action'),
  omahaStreetPlan: blanket(
    ['omahaNoCategoricalRules'],
    'street-plan priors (unmeasured) decide the bet or check; removal: omahaMathCore (CORE-POOLED-2 / MATHCORE-2)'
  ),
  omahaStreetPlanFlop: blanket(
    ['omahaNoCategoricalRules'],
    'street-plan priors on the flop; failed its evaluation; removal: delete (off-only)'
  ),
  omahaStreetPlanThreeWay: blanket(
    ['omahaNoCategoricalRules'],
    'three-way street-plan priors; removal: omahaMathCore (CORE-POOLED-2 / MATHCORE-2)'
  ),
  omahaStrongHandSlowplayMix: blanket(
    ['omahaNoCategoricalRules'],
    'a random slowplay of a strong hand by class; removal: omahaMathCore'
  ),
  omahaStrongHandValue: CARD_IMPACT,
  omahaTightOpponent: blanket(
    ['omahaNoCategoricalRules'],
    'a tight label moves the preflop decision; removal: measured read inside a priced decision'
  ),
  omahaTightOpponentSteal: blanket(
    [],
    'steal width by a tight label; removal: priced steal against his measured defence'
  ),
  omahaTournamentFirstIn: exempt(
    'other_game',
    'PLO6, tournaments or hi-lo: outside PLO4/PLO5 cash'
  ),
  omahaTournamentsExcludeCategoricalRules: exempt(
    'scope',
    'decides where a rule applies, never the action'
  ),
  omahaTurnBetNeedsRiverPlan: review(
    'pricing basis not verified at the line level by BLANKET-AUDIT 2026-11-20'
  ),
  omahaTurnCallRealizationByRunout: exempt(
    'input',
    'an input of a priced comparison, not a rule site'
  ),
  omahaTurnRiverRaiseIsPriced: PRICED_RAISE,
  omahaTurnRiverRaiseNeedsNuts: blanket(
    ['omahaNoCategoricalRules'],
    'the register classes it categorical; removal: switch-off with omahaNoCategoricalRules in PLO4/PLO5 cash, then delete'
  ),
  omahaTurnSetPound: blanket(
    ['omahaNoCategoricalRules'],
    'the register classes it categorical; removal: switch-off with omahaNoCategoricalRules in PLO4/PLO5 cash, then delete'
  ),
  omahaTurnSetSizeIsPriced: CARD_IMPACT,
  omahaTurnStabDefenceIsPriced: exempt('input', 'an input of a priced comparison, not a rule site'),
  omahaTurnStabLightningRow: exempt('input', 'an input of a priced comparison, not a rule site'),
  omahaTurnStrongHandRealizationIsMeasured: exempt(
    'input',
    'an input of a priced comparison, not a rule site'
  ),
  omahaUnderpairMultiwayIsPriced: FACING_BET_EV,
  omahaUnderpairNoMultiwayFlopContinue: blanket(
    ['omahaNoCategoricalRules'],
    'the register classes it categorical; removal: switch-off with omahaNoCategoricalRules in PLO4/PLO5 cash, then delete'
  ),
  omahaValueSizeIsUnreadable: blanket(
    [],
    'a nut-class wager drawn uniformly in a fixed 80-95% pot band when no keep share is measured (owner band of 2026-11-19); removal: priced size from the measured keep share at every size; lead to rule on the owner band'
  ),
  omahaVpipFloorByLimp: exempt(
    'owner_game_rule',
    'the owner VPIP floor (a game rule, not strategy)'
  ),
  plo6FacingBetIsPriced: exempt('other_game', 'PLO6, tournaments or hi-lo: outside PLO4/PLO5 cash'),
  plo6ManiacPriceRefusalToRangePlay: exempt(
    'other_game',
    'PLO6, tournaments or hi-lo: outside PLO4/PLO5 cash'
  ),
  plo6NoMultiwayBetWithWeakMadeHand: exempt(
    'other_game',
    'PLO6, tournaments or hi-lo: outside PLO4/PLO5 cash'
  ),
  plo6TopSetNutRealization: exempt(
    'other_game',
    'PLO6, tournaments or hi-lo: outside PLO4/PLO5 cash'
  ),
  ploPairedBoardFold: blanket(
    ['omahaNoCategoricalRules'],
    'the register classes it open; removal: switch-off with omahaNoCategoricalRules in PLO4/PLO5 cash, then delete'
  ),
  ploPairedBoardRiverCheck: blanket(
    ['omahaNoCategoricalRules'],
    'the register classes it categorical; removal: switch-off with omahaNoCategoricalRules in PLO4/PLO5 cash, then delete'
  ),
  ploSuitedAcesFourBet: blanket(
    [],
    'preflop 4-bet with suited aces by hand class; removal: priced preflop re-raise (omahaMathCorePreflop / PREFLOP-RAISE-2)'
  ),
});

/**
 * Options of OMAHA_NO_CATEGORICAL_RULES_OFF and the old-path umbrellas that the register does not hold (their names
 * are not omaha-prefixed; several are shared with other games, so a switch row turns them off in PLO6 too).
 */
export const OMAHA_SHARED_OPTION_BASIS: Readonly<Record<string, OmahaRuleBasis>> = Object.freeze({
  v16SizeCond: blanket(
    ['omahaFlopFacingBetEv'],
    "the 20 big blind mark: a newest-street wager of 20 big blinds or more counts as a big bet and tiers the bettor's range (a chip count; register open site 14)"
  ),
  v74OmahaSemiBluffNeedsDraw: blanket(
    ['omahaNoCategoricalRules'],
    'no semi-bluff raise without a nut flush draw, a flush draw or 8+ straight outs (draw class list)'
  ),
  v81OmahaBigBetCalls: blanket(
    ['omahaNoCategoricalRules', 'omahaBigBetCallsArePriced'],
    'big-bet call folds by size, depth and class cells'
  ),
  v84OmahaRiverReraiseCalls: blanket(
    ['omahaNoCategoricalRules', 'omahaBigBetCallsArePriced'],
    'river re-raise call folds by cell'
  ),
  v9Mood: blanket(['omahaNoCategoricalRules'], 'a random hourly tightness shift (unmeasured)'),
  v40Omaha: partly(
    ['omahaNoMadeClassCap'],
    'V40: a fixed equity ceiling per made-hand class inside the EV verdict, and no third barrel by line; the umbrella also feeds the range sampler, so the removal is omahaNoMadeClassCap plus a priced barrel'
  ),
  v15: partly(
    ['omahaClassCapsRespectEquity'],
    'V15: equity caps and raise gates by nut class (PLO5 shade 0.86) inside the EV verdict'
  ),
  v46Charts: blanket(
    ['omahaMathCorePreflop'],
    'preflop charts: fold and never-3-bet by chart class (v46_class_fold, v46_class_never_3bet)'
  ),
  v86PloOverhaul: blanket(
    ['omahaMathCore'],
    'V86: nut-combo pump by outs thresholds and a persona random draw, elite three-bet by class; its big-bet cells are guarded by omahaNoCategoricalRules, the rest is not'
  ),
});

/**
 * Rule sites of the reference policy that have no option of their own, keyed by the receipt each fires when it
 * decides or shades a PLO4/PLO5 cash decision.
 */
export const OMAHA_REFERENCE_RULE_BASIS: Readonly<Record<string, OmahaRuleBasis>> = Object.freeze({
  v38_river_fold: partly(
    ['omahaMathCore'],
    'riverCallVerdict prices the call, but its equity comes from the V40/V15-capped sampler minus class-keyed shades (shade87Omaha, the style bluff-catch cap)'
  ),
  v38_ev_fold: partly(
    ['omahaMathCore'],
    'evaluateSpot prices the flop/turn call, but realization is set by street, position and a "drawy" class (cat <= 1 and equity >= 0.30 flop / 0.20 turn) and one-pair class shades enter the equity'
  ),
  horse_continuation_budget_fold: partly(
    ['omahaMathCore'],
    'the future barrels are priced from his measured bet rate, but only for one pair or a weak two pair without a draw, heads-up, at constant equity'
  ),
  opponent_exploit_calldown: partly(
    ['omahaMathCore'],
    'the equity a call needs is scaled by an opponent label (respect 2 - callDownMod: maniac 0.8, neutral 1, passive 1.15; hunted -0.25), constants with no cited measurement'
  ),
  omaha_implied_credit_withheld: partly(
    ['omahaMathCore'],
    'a fixed +0.04 equity implied credit only with a physical draw and equity >= 0.25'
  ),
  plo_opponent_presumed_aggressive: partly(
    ['omahaNeutralUnknown', 'omahaMathCore'],
    'every unknown Omaha opponent is presumed a maniac (raise width, call-down) until his record disproves it (owner update 2026-10-27); a label prior, not a measured population prior'
  ),
  maniac_pressure_preflop: partly(
    ['omahaNeutralUnknown', 'omahaMathCorePreflop'],
    'the preflop call bar (maniac_price consumer) moves with the maniac width read, which the presumption supplies for every unknown opponent'
  ),
  v40_omaha_pressure_cap: partly(
    ['omahaNoMadeClassCap'],
    'a fixed equity ceiling per made-hand class'
  ),
  v40_no_third_barrel: blanket(['omahaMathCore'], 'no third barrel by the betting line'),
  v40_small_ball: blanket(['omahaMathCore'], 'a small-ball size by class'),
  v15_eq_capped: partly(['omahaClassCapsRespectEquity'], 'equity capped by nut class'),
  v15_raise_gate: blanket(['omahaMathCore'], 'a raise gated by nut class'),
  v15_boat_dominated: partly(
    ['omahaClassCapsRespectEquity'],
    'a dominated full house capped by class'
  ),
  v46_class_fold: blanket(['omahaMathCorePreflop'], 'a preflop fold by chart class'),
  v46_class_never_3bet: blanket(['omahaMathCorePreflop'], 'never 3-bet by chart class'),
  v74_omaha_semibluff_needs_draw: blanket(
    ['omahaNoCategoricalRules'],
    'no semi-bluff raise without a draw class'
  ),
  v86_plo_combo_draw_pump: blanket(
    ['omahaMathCore'],
    'a pot raise by outs thresholds and a persona random draw'
  ),
  v86_plo_elite_three_bet: blanket(['omahaMathCorePreflop'], 'a 3-bet by hand class'),
  v81_omaha_big_bet_call_fold: blanket(['omahaNoCategoricalRules'], 'a big-bet call fold by cell'),
  v84_omaha_river_reraise_call_fold: blanket(
    ['omahaNoCategoricalRules'],
    'a river re-raise call fold by cell'
  ),
  v86_plo_underboat_fold: blanket(
    ['omahaNoCategoricalRules'],
    'a fold below a full house by class'
  ),
  v86_plo_multiway_dominated_fold: blanket(['omahaNoCategoricalRules'], 'a multiway fold by class'),
  omaha_owner_ruled_check_kept: blanket(
    ['omahaNoCategoricalRules'],
    'omahaOwnerRuledFinal re-applies the categorical checks outermost over any priced wager'
  ),
  omaha_owner_approved_bet_kept: blanket(
    ['omahaNoCategoricalRules'],
    'the bet the categorical checks let through'
  ),
  plo_suited_aces_four_bet: blanket(
    ['omahaMathCorePreflop'],
    'a preflop 4-bet with suited aces by class'
  ),
  omaha_big_bet_by_pot_share: blanket(
    [],
    'omahaBigBetIsPotShare: a turn/river wager tiered by pot share under 70%'
  ),
  omaha_value_size_band_applied: blanket(
    [],
    'omahaValueSizeIsUnreadable: a uniform draw in a fixed 80-95% pot band'
  ),
  omaha_vpip_floor_limp: exempt(
    'owner_game_rule',
    'the owner VPIP floor (a game rule, not strategy)'
  ),
  omaha_vpip_floor_limp_fold: exempt(
    'owner_game_rule',
    'the owner VPIP floor (a game rule, not strategy)'
  ),
});
