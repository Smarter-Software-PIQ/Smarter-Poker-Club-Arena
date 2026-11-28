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

const RERAISED_POT_PRICED: OmahaPricedBasis = {
  kind: 'priced',
  range:
    "the re-raiser's top share from his own decayed re-raise record against the anchored prior (self-play baseline, reduced population weight); every caller and every player still to act from the self-play measured multiples, the players behind as probable continuers (self-play answer rates)",
  equity:
    'seeded joint sampled equity of the exact hand against one holding per player in the field (omahaReraisedEquityAgainst), each subset of continuing players priced on the same samples',
  realization:
    'measured in league self-play by role, position against the whole flop field, players at the flop, stack-to-pot ratio and equity (HorseOmahaReraisedPotPriced.RERAISED_POT_REALIZATION)',
  price:
    "EV(call) against 0 and, for a proposed re-raise, EV(re-raise) from the re-raiser's own fold-to-re-raise record against the anchored prior, after the table's rake",
};

/** every option of OMAHA_OPTION_CLASSES (HorseOmahaRuleSites.ts), by its pricing basis */
export const OMAHA_OPTION_BASIS: Readonly<Record<string, OmahaRuleBasis>> = Object.freeze({
  omahaFourBetFoldPricedCall: PREFLOP_PRICED,
  omahaReraisedPotCallIsPriced: RERAISED_POT_PRICED,
  omahaReraisedPotReraiseIsPriced: RERAISED_POT_PRICED,
  omahaReraisedPotFoldReraiseIsPriced: RERAISED_POT_PRICED,
  omahaLimpReraiseVsIsoRaiser: RERAISED_POT_PRICED,
  omahaOopReraiseRangeHoldsVsReraise: {
    kind: 'priced',
    range:
      "the opener's band (HorseMind.bandFor of his line) split by his answer to a 3-bet: his measured fold to a 3-bet shrunk to the prior horse.openerAnswersPriorVersion selects (1: the fitted table OPENER_ANSWERS_PRIOR, game x depth; 2: the indifference answer to the 3-bet faced, HorsePreflopIndifferenceAnchor), 4-bet range on top, calling range below it",
    equity:
      'seeded sampled equity of the exact hand against each band (omahaReraisedEquity over omahaPreflopPercentile)',
    realization:
      "measured out-of-position realization by depth after the call and the call equity (omahaPreflopDefenceRealization); the 4-bet branch takes the Horse's own answer to the 4-bet, asked on the 4-bet frame",
    price: 'EV(3-bet) against EV(call) admitted by the calling rule and against 0, after deduction',
  },
  omahaOopReraiseRangeReadsOpenerRecord: {
    kind: 'priced',
    range:
      "the opener's band split by his answer to a 3-bet, the 4-bet share his own record in position (HorseOpenerAnswersThreeBet: his decayed 4-bets against a 0.10 baseline worth 6 answers)",
    equity:
      'seeded sampled equity of the exact hand against each band (omahaReraisedEquity over omahaPreflopPercentile), as omahaOopReraiseRangeHoldsVsReraise',
    realization:
      "as omahaOopReraiseRangeHoldsVsReraise (omahaPreflopDefenceRealization; the Horse's own answer to the 4-bet)",
    price:
      'EV(3-bet) against the admitted call and 0, binding with weight w = min(1, his 4-bet rate / 0.10); a rejected 3-bet stands at the seeded frequency 1 - w',
  },
  omahaOpponentLifetimeHudDecides: exempt(
    'input',
    'OPPONENT-HUD-9 consumer flag: reads lifetime public HUD counters shrunk n/(n+k) into HorseMind.opponentRead; decides nothing by itself'
  ),
  omahaPreflopReadIsPricedFromLifetime: {
    kind: 'priced',
    range:
      'six-max preflop opponent range from lifetime public HUD cells (pf.*, pf.lr, pf.bvo) shrunk n/(n+k) via hudStat, retiring presumedAggressorRead',
    equity: 'preflop equity against that measured range',
    realization: 'measured six-max preflop position and depth realization',
    price: 'the preflop call, raise, or fold against the pot after deduction',
  },
  omahaBigDrawBetIsPricedOnHisResponse: {
    kind: 'priced',
    range:
      'each live opponent range on flop and turn checked-to spots using lifetime public HUD fold, raise-vs-bet, and stab rates shrunk n/(n+k) via hudStat',
    equity: 'exact/sampled Omaha equity of the big draw against continuing and stabbing ranges',
    realization:
      'lifetime public HUD fold-to-bet (fb.bg), raise-vs-bet (rBet), and stab rates with street realization',
    price:
      'the checked-to big-draw bet beside the check with evBet - evCheck > sampleSe + readSpread and evBet > 0',
  },
  omahaBigBetSizeIsPriced: {
    kind: 'priced',
    range:
      'continuous pot-share aggressor strength frac/(frac+0.55) moved by lifetime public HUD showdown big-bet strength and bet rate shrunk n/(n+k) via hudStat; live opponents calling/raising ranges for limped-pot sizing',
    equity:
      'exact/sampled Omaha equity against the priced range (omahaFacingBetEv / omahaPricedLimpedPotSize)',
    realization:
      'lifetime public HUD fold-to-bet and raise-vs-bet interpolated smoothly by pot share, street realization, and showdown',
    price:
      'the call against the pot after deduction and candidate limped-pot bet size against current size with 0.02*pot certainty margin',
  },
  omahaCbetRaiseIsPriced: {
    kind: 'priced',
    range:
      "the flop c-bet raiser's measured raising share (top W x rho of holdings on the flop, rho shrunk n/(n+K) to the population raise share)",
    equity: 'exact flop equity against that raising range with card removal (omahaFlopFacingBetEv)',
    realization:
      'measured flop-raise realization and heads-up c-bet raise-branch response frequencies',
    price: 'the call or flop c-bet against the pot after projected rake and jackpot deduction',
  },
  omahaFlopBetIsPricedOnHisResponse: {
    kind: 'priced',
    range:
      'each live opponent range on the flop (card-impact range for bets, lifetime HUD scaled raiser/stabber range when facing a flop raise or stab)',
    equity:
      'exact/sampled flop equity against continuing and raising/stabbing ranges with card removal',
    realization:
      'lifetime public HUD fold, raise-vs-bet, and OOP stab rate/size shrunk n/(n+k) via hudStat',
    price: 'the flop bet beside the check with prove-it-to-bet uncertainty bar and flop call price',
  },
  omahaRiverBetFoldIsHisRecord: {
    kind: 'priced',
    range: 'the river checker/caller range (card-impact range, no opponent kind)',
    equity: 'equity of the hand against that range on the river',
    realization:
      "the river answer curve with fold share moved by the opponent's lifetime public river fold record shrunk n/(n+k)",
    price: 'the river bet against the check by more than its standard error',
  },
  omahaRiverBetFoldIsPeopleMeasured: {
    kind: 'priced',
    range: 'the river checker/caller range (card-impact range, no opponent kind)',
    equity: 'equity of the hand against that range on the river',
    realization:
      "the river answer curve re-measured on people's answers for the Horse's line and size",
    price: 'the river bet against the check by more than its standard error',
  },
  omahaRiverBetCheckIsHisRecord: {
    kind: 'priced',
    range:
      "the river checker/caller range with his checks capping it by his own lifetime unopened turn/river bet share shrunk to people's",
    equity: 'equity of the hand against that range on the river',
    realization: 'the river answer curve of the two river bet rules, unchanged',
    price: 'the river bet against the check by more than its standard error',
  },
  omahaFacingBetRangeIsMeasuredByLine: {
    kind: 'priced',
    range:
      "the bettor's measured strength histogram by street, line, size and pot type, his own shown record shrunk toward it",
    equity:
      'the exact 2+3 count of the hand against each strength bin (river top shares; turn every river card)',
    realization: "today's facing-bet verdict's turn realization; the river is final",
    price: 'the call against the pot after the projected rake and jackpot deduction',
  },
  omahaFacingBetIndifferenceCalls: FACING_BET_EV,
  omahaFlopRealizationIsPriced: {
    kind: 'priced',
    range:
      "the bettor's measured flop strength histogram by line, size and pot type; the field's measured calling range",
    equity:
      'the joint showdown share on two-card runouts against the bettor and the field on the same cards',
    realization:
      'the two-street tree: his measured turn and river bet rates and sizes, every later fold priced',
    price: 'the flop call against the pot after the projected rake and jackpot deduction',
  },
  omahaFacingBetMinimumDefencePrior: FACING_BET_EV,
  omahaFacingBetPriorIsPeopleMeasured: FACING_BET_EV,
  omahaMultiwayFieldIsPeopleMeasured: FACING_BET_EV,
  omahaPeoplePriorCountsHiddenBets: FACING_BET_EV,
  omahaHiddenBetsArePricedAsGiveUps: FACING_BET_EV,
  omahaFlopPressureCapIsPriced: FACING_BET_EV,
  omahaTurnFacingBetPriorIsLineSplit: FACING_BET_EV,
  omahaFacingBetFieldIsJoint: {
    kind: 'priced',
    range:
      "the bettor's measured range for a bet into several players; each caller's and continuing player's measured calling range",
    equity:
      'the joint showdown share with every player dealt on the same cards, over every river card on the turn',
    realization:
      "today's facing-bet verdict's turn realization; players behind at their measured continue rate",
    price:
      'the call against the pot including the calls of the players behind who continue, after the projected rake',
  },
  omahaMultiwayCallNeedsNutShare: FACING_BET_EV,
  omahaMultiwayValueBetIsPriced: {
    kind: 'priced',
    range: "the field's measured calling range for a multiway first wager of each size",
    equity: 'the joint showdown share against the callers on the same cards',
    realization: 'the measured share of multiway first wagers of each size every player folded to',
    price: 'each of three bet sizes against the check',
  },
  omahaStabDefenceIsPriced: {
    kind: 'priced',
    range:
      "the first-wager bettor's non-value share moved by his lifetime public first-wager frequency against the population shrunk n/(n+k)",
    equity: 'exact 2+3 turn/river equity against that range (omahaFacingBetEv)',
    realization: 'measured turn/river realization by street and runout of facing-bet calls',
    price: 'the call against the pot after projected rake and jackpot deduction',
  },
  omahaStrongHandCheckIsPriced: {
    kind: 'priced',
    range:
      'the opponent calling and stabbing ranges on turn/river heads-up (card-impact range, no opponent kind)',
    equity: 'equity against his continuing range when betting and his stabbing range when checking',
    realization:
      'measured bet answer curve moved by his lifetime public fold record and check stab frequency/size shrunk n/(n+k)',
    price: 'the value bet beside the check, mixed by comparison standard error (held dark)',
  },
  omahaFlopRaiseIsPriced: {
    kind: 'priced',
    range: "the bettor's measured flop range by line and size (his shown record shrunk toward it)",
    equity: 'two-card-runout equity of the hand against each strength bin of holdings',
    realization:
      'his fold share the equilibrium minimum defence of the pot he is offered; the street realization factor',
    price: 'each raise size against the call and the fold, by more than the equity estimate error',
  },
  omahaRiverTripsBoardBoatIsNotNutClass: {
    kind: 'priced',
    range:
      'every holding of the unseen cards (exact count, the Horse cards and dead cards removed)',
    equity: 'whether any holding beats the full house (quads or a straight flush on a trips board)',
    realization:
      'the measured result of nut-class full house river raises on trips boards (-62 bb a raise, Nov 12-26)',
    price: 'the raise becomes the call; the call itself stays with the facing-bet verdicts',
  },
  omahaRiverValueBetInPositionIsPriced: {
    kind: 'priced',
    range: 'the measured strength histogram of a heads-up river checker, exact card removal',
    equity:
      'exact share of the hand against the hands that continue (the strongest share of his range)',
    realization:
      'his fold share: equilibrium B / (P + B) moved by his own lifetime public river fold record',
    price:
      'each engine bet size against the showdown value of the check, by more than his fold rate error',
  },
  omahaRiverBluffIsPricedOnBlockers: {
    kind: 'priced',
    range:
      'the measured heads-up river range (after his check, or in position before acting), exact card removal',
    equity: 'exact share of the hand against the hands that continue',
    realization:
      'his fold share with the Horse cards removed: equilibrium B / (P + B) moved by his own lifetime public river fold record',
    price:
      'the bluff against the check by more than his fold rate error, and only where the Horse cards raise his fold share',
  },
  omahaMultiwayRiverBluffIsPricedOnBlockers: {
    kind: 'priced',
    range:
      'the measured people-only river range of each opponent (after his check, or before he acts), exact card removal',
    equity:
      'exact share of the hand against each range for the check; the bet is scored as lost whenever anybody continues',
    realization:
      "each opponent's card-removed fold share: the multiway equilibrium (B / (P + B)) ^ (1 / N) moved by people's multiway population and his own lifetime public river fold record; the folds multiplied",
    price:
      'the bluff against the check by more than the error of the fold rates, and only where the Horse cards raise the share of the field that folds',
  },
  omahaFourWayPlusRiverBluffIsPricedOnBlockers: {
    kind: 'priced',
    range:
      'the measured people-only river range of each opponent (after his check, or before he acts), exact card removal',
    equity:
      'exact share of the hand against each range for the check; the bet is scored as lost whenever anybody continues',
    realization:
      "each opponent's card-removed fold share: the multiway equilibrium (B / (P + B)) ^ (1 / N) moved by people's multiway population and his own lifetime public river fold record; the folds multiplied",
    price:
      'the bluff against the check by more than the error of the fold rates, and only where the Horse cards raise the share of the field that folds',
  },
  omahaRiverBluffIsPricedOnRangeAdvantage: {
    kind: 'priced',
    range:
      'the measured heads-up river range (the price), and the measured ranges of both players by role, line and texture (the range advantage), exact card removal',
    equity: 'exact share of the hand against the hands that continue',
    realization:
      'his fold share with the Horse cards removed: equilibrium B / (P + B) moved by his own lifetime public river fold record',
    price:
      'the bluff against the check by more than his fold rate error, and only where the Horse range beats his and the hand is in the weakest share that the value in the Horse range carries at the size',
  },
  omahaTurnBluffIsPricedOnBlockers: {
    kind: 'priced',
    range:
      'the measured heads-up turn range by role, line and texture (after his check, or in position before acting), exact card removal',
    equity:
      'the sampled share of the hand with a card to come against the strongest share of his hands that continues against the size, and against any hand for the check',
    realization:
      'his fold share with the Horse cards removed (equilibrium B / (P + B) moved by his own lifetime public turn fold record by size cell), the turn realization for the position, his raise-back share',
    price:
      'the bet against the full-realization value of the check by more than the fold rate and sampler errors, and only where the Horse cards raise his fold share',
  },
  omahaTurnBluffIsPricedOnRangeAdvantage: {
    kind: 'priced',
    range:
      'the measured heads-up turn ranges of both players by role, line and texture, exact card removal',
    equity:
      'the sampled share of the hand with a card to come against the strongest share of his hands that continues against the size, and against any hand for the check',
    realization:
      'his fold share with the Horse cards removed (equilibrium B / (P + B) moved by his own lifetime public turn fold record by size cell), the turn realization for the position, his raise-back share',
    price:
      'the bet against the full-realization value of the check by more than the fold rate and sampler errors, and only where the Horse range beats his and the hand is in the weakest share that the value in the Horse range carries at the size',
  },
  omahaRiverCheckedToBetIsMeasured: {
    kind: 'priced',
    range: 'the checker range after his river check (card-impact range, no opponent kind)',
    equity: 'equity of the hand against that range on the river',
    realization:
      'the measured response curve of river bets after a check (fold, call, raise by size), showdown when called',
    price:
      'the bet against the calibrated showdown value of the check, by more than its standard error',
  },
  omahaRiverFirstToActBetIsPriced: {
    kind: 'priced',
    range: "the second actor's river range (card-impact range, no opponent kind)",
    equity: 'equity of the hand against that range on the river',
    realization:
      'the measured response curve of first-to-act river bets (fold, call, raise by size), showdown when called',
    price: 'the bet against the check, by more than its standard error',
  },
  omahaAcesReraiseIsMeasured: partly(
    [],
    'aces facing a 3-bet at 250 bb or less: the re-raise: a measured class-by-spot cell used directly as the action (fit and held-out real chips by structure class, spot and depth band), not an EV against a stated range at this decision'
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
  omahaBlanketRowsOffInPlo45Cash: exempt(
    'scope',
    'passes the listed blanket rows off in PLO4/PLO5 cash only; it decides where a rule applies, never the action'
  ),
  omahaBlanketRowsOffList: exempt(
    'scope',
    'the list omahaBlanketRowsOffInPlo45Cash reads (runtime settings, registry members only); decides where a rule applies, never the action'
  ),
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
  omahaColdCallOutsideBigBlindIsMeasured: partly(
    [],
    'a cold call outside the big blind by measured class cell: a measured class-by-spot cell used directly as the action (fit and held-out real chips by structure class, spot and depth band), not an EV against a stated range at this decision'
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
  omahaOpenNeedsMeasuredStrength: partly(
    [],
    'a first-in raise below the strongest 20% of the two-card strength order becomes a fold: a measured class-by-spot cell used directly as the action (fit and held-out real chips by structure class, spot and depth band), not an EV against a stated range at this decision'
  ),
  omahaOptionGameScope: exempt('scope', 'decides where a rule applies, never the action'),
  omahaOverpairNoOopBarrelVsValueLeader: blanket(
    ['omahaNoCategoricalRules'],
    'the register classes it categorical; removal: switch-off with omahaNoCategoricalRules in PLO4/PLO5 cash, then delete'
  ),
  omahaPackClampDeepDepth: exempt('scope', 'decides where a rule applies, never the action'),
  omahaPackEffectiveDepth: exempt('scope', 'decides where a rule applies, never the action'),
  omahaPairedBoardBetIsPriced: CARD_IMPACT,
  omahaPairedBoardFoldRespectsPrice: blanket(
    ['omahaFacingBetEv'],
    'where no facing-bet verdict answers, fixed thresholds decide (a price of 0.25 or better with a straight or flush, or 60% of a stack in); a carve-out of ploPairedBoardFold, listed off only with it (RULES-FIX-1, AUDIT-B item 5)'
  ),
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
  omahaOpponentLifetimeHud: exempt(
    'input',
    'the per-opponent lifetime public HUD provider every priced comparison may read; it decides nothing by itself (an input, not a rule site)'
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
  omahaReraiseRangeIsMeasured: partly(
    [],
    'kings facing a 3-bet after the 3-bettor: the pot 4-bet: a measured class-by-spot cell used directly as the action (fit and held-out real chips by structure class, spot and depth band), not an EV against a stated range at this decision'
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
  omahaReraisedPositionVsEveryoneToAct: exempt(
    'input',
    'the position term of the priced call of a re-raise (who acts after hero on later streets); an input of a priced comparison, not a rule site'
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
  omahaRundownReraiseRangeIsMeasured: partly(
    [],
    'a high rundown squeezing from a blind above 250 bb: the call: a measured class-by-spot cell used directly as the action (fit and held-out real chips by structure class, spot and depth band), not an EV against a stated range at this decision'
  ),
  omahaRundownReraiseRangeTrial: partly(
    [],
    'trial rundown re-raise cells by structure and position: a measured class-by-spot cell used directly as the action (fit and held-out real chips by structure class, spot and depth band), not an EV against a stated range at this decision'
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
  omahaStreetPlan: partly(
    ['omahaMathCore'],
    'the heads-up turn check and each bet priced as whole lines over every exact river card (HorseOmahaStreetPlan.ts); its fallback range (a fixed keep share of a fixed sample, by turn strength) and the population priors where unmeasured are categorical: MATHCORE-2 replaces the fallback with the measured range. Kept out of OMAHA_NO_CATEGORICAL_RULES_OFF (priced in form; replay: off = 366 turn check->bet; the first all-chip grade -1,588 +/- 330 was asymmetric and is superseded by the symmetric +1,118 +/- 112 Horse-only, 2026-11-21)'
  ),
  omahaStreetPlanFlop: partly(
    ['omahaNoCategoricalRules'],
    'the flop bet priced as a two-street line with the turn by card class (failed its evaluation; off-only): delete'
  ),
  omahaStreetPlanThreeWay: partly(
    ['omahaMathCore'],
    'the three-way turn line priced against two independent ranges, with the same categorical fallback keep share and population priors; kept out of OMAHA_NO_CATEGORICAL_RULES_OFF with omahaStreetPlan'
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
  omahaTurnBetNeedsRiverPlan: blanket(
    ['omahaNoCategoricalRules'],
    'a turn bet becomes a check when on more than 35% of the river cards the categorical fold rules (paired-board fold, V81/V86 tiers) would fold to an all-in for what is left'
  ),
  omahaTurnCallRealizationByRunout: exempt(
    'input',
    'an input of a priced comparison, not a rule site'
  ),
  omahaTurnRiverRaiseIsPriced: PRICED_RAISE,
  omahaPricedRaiseNeverMakesNonNutRaise: exempt(
    'owner_game_rule',
    'owner rulings 2026-11-15 12:52 / 12:53 (a non-nut hand facing a turn or river bet folds or at best calls, never raises) and 12:30 (a draw raises only in position with a combo draw), enforced inside omahaTurnRiverRaiseIsPriced: it only withholds a raise; the call or fold returned is the priced one (PRICED_RAISE verdict.callStands), and the nut rule reads the same spot in Lightning'
  ),
  omahaLateFlattenedCallIsPriced: FACING_BET_EV,
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
  omahaValueSizeIsUnreadable: partly(
    [],
    "a nut-class wager keeps the measured full-pot share, else is drawn uniformly in a fixed 80-95% pot band: built on the owner's order (2026-11-18 23:00) to remove a sizing tell that STYLE-STUDY measured as real; stays on (lead ruling 2026-11-20); OFFENCE-BUILD replaces the band with priced sizing"
  ),
  omahaVpipFloorByLimp: exempt(
    'owner_game_rule',
    'the owner VPIP floor (a game rule, not strategy)'
  ),
  plo6FacingBetIsPriced: exempt('other_game', 'PLO6, tournaments or hi-lo: outside PLO4/PLO5 cash'),
  plo6FacingBetIsPricedV2: {
    kind: 'priced',
    range:
      'native six-card bettor value quantiles and six-card non-value bluff priors narrowed by line, all-in jam sizing, multiway field, paired boards, and 3-bet/4-bet depth (PLO6 cash only; outside PLO4/PLO5 cash)',
    equity:
      'exact six-card counts on turn and river (seeded six-card sample on flop and multiway river) against that six-card range (HorsePlo6FacingBetPricedV2.ts)',
    realization:
      'measured street and flop-defence-tree realization with six-card multiway joint callers and showdown on the river',
    price:
      'two-way EV(call) and river EV(raise) against the pot after projected rake and jackpot deduction',
  },
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
  omaha_oop_reraise_range_holds_kept: exempt(
    'input',
    'receipt that omahaOopReraiseRangeHoldsVsReraise priced an out-of-position 3-bet and it stands (EV at or above the alternative, the Horse continues against the 4-bet); decides nothing itself'
  ),
  omaha_oop_reraise_range_holds_blocker_kept: exempt(
    'input',
    'receipt that a blocker 3-bet whose 4-bet answer is a fold was kept by the seeded keep frequency the cap asks for; decides nothing itself'
  ),
  omaha_oop_reraise_range_holds_called: exempt(
    'input',
    "receipt that the priced out-of-position 3-bet became the call the existing calling rule admits; the decision is the option's priced verdict"
  ),
  omaha_oop_reraise_range_holds_folded: exempt(
    'input',
    "receipt that the priced out-of-position 3-bet became the fold; the decision is the option's priced verdict"
  ),
  omaha_oop_reraise_range_holds_unpriced: exempt(
    'legality',
    'fail-safe counter: the 3-bet could not be priced (no equity sample, or the stage was not reached) and stands as the brain made it'
  ),
  omaha_blanket_rows_off_in_plo45_cash_applied: exempt(
    'scope',
    'counts a PLO4/PLO5 cash decision made with a listed blanket row passed off; it marks the scope, it decides nothing'
  ),
  omaha_math_core_fallback_core_error: exempt(
    'legality',
    'CORE-FIX-1 (#11684) fail-safe counter when omahaMathCore throws and falls back to the rules decision; decides nothing'
  ),
  omaha_math_core_fallback_equity_collision: exempt(
    'legality',
    'CORE-FIX-1 (#11684) fail-safe counter when narrow range sampling collides and falls back to the unconditioned pool; decides nothing'
  ),
  omaha_math_core_fallback_tracker_failure: exempt(
    'legality',
    'CORE-FIX-1 (#11684) fail-safe counter when range tracking throws and falls back to untracked public ranges; decides nothing'
  ),
  omaha_math_core_fallback_value_search_error: exempt(
    'legality',
    'CORE-FIX-1 (#11684) fail-safe counter when wired value search throws and falls back to the one-step loop; decides nothing'
  ),
  omaha_cbet_raise_priced_branch: BET_EV,
  omaha_cbet_raise_priced_range: FACING_BET_EV,
  omaha_priced_big_bet_size_range_applied: FACING_BET_EV,
  omaha_priced_raise_non_nut_raise_not_made: exempt(
    'owner_game_rule',
    'receipt that omahaPricedRaiseNeverMakesNonNutRaise withheld a raise the priced comparison chose for a hand that is not nut class (owner rulings 2026-11-15 12:52 / 12:53 and 12:30); the priced call or fold stands'
  ),
  omaha_priced_raise_non_nut_unpriced_called: exempt(
    'owner_game_rule',
    'receipt that a non-nut raise that could not be priced became the call under omahaPricedRaiseNeverMakesNonNutRaise (owner ruling 2026-11-15 12:52 / 12:53); no chips are added and nothing is folded on a failure to price'
  ),
  omaha_late_flattened_call_priced_kept: FACING_BET_EV,
  omaha_late_flattened_call_priced_folded: FACING_BET_EV,
  omaha_priced_big_bet_size_resized: CARD_IMPACT,
  omaha_priced_big_bet_size_kept: CARD_IMPACT,
  omaha_big_draw_bet_on_his_response_bet: CARD_IMPACT,
  omaha_big_draw_bet_on_his_response_withheld: CARD_IMPACT,
  omaha_big_draw_bet_on_his_response_final_check_unpriced: exempt(
    'scope',
    'R4 unpriced pass-through receipt when a checked-to big-draw spot cannot be priced; keeps check'
  ),
  omaha_flop_bet_on_his_response_checked: CARD_IMPACT,
  omaha_flop_bet_on_his_response_kept: CARD_IMPACT,
  omaha_flop_bet_on_his_response_unpriced_kept: exempt(
    'scope',
    'R2 unpriced pass-through receipt when the flop bet spot cannot be priced; keeps existing decision'
  ),
  omaha_flop_facing_raise_hud_range_scaled: FACING_BET_EV,
  omaha_flop_facing_stab_hud_range_scaled: FACING_BET_EV,
  omaha_river_bet_fold_his_record_read: CARD_IMPACT,
  omaha_stab_defence_priced: FACING_BET_EV,
  omaha_priced_facing_bet_range_call: FACING_BET_EV,
  omaha_priced_facing_bet_range_fold: FACING_BET_EV,
  omaha_priced_facing_bet_joint_call: FACING_BET_EV,
  omaha_priced_facing_bet_joint_fold: FACING_BET_EV,
  omaha_priced_facing_bet_margin_call: FACING_BET_EV,
  omaha_priced_facing_bet_margin_fold: FACING_BET_EV,
  omaha_priced_facing_bet_record_read: FACING_BET_EV,
  omaha_priced_facing_bet_min_defence_bounded: FACING_BET_EV,
  omaha_priced_facing_bet_changed: FACING_BET_EV,
  omaha_people_prior_priced: FACING_BET_EV,
  omaha_people_prior_record_read: FACING_BET_EV,
  omaha_people_prior_changed: FACING_BET_EV,
  omaha_mw_people_field_priced: FACING_BET_EV,
  omaha_turn_line_prior_priced: FACING_BET_EV,
  omaha_turn_line_prior_checked_flop: FACING_BET_EV,
  omaha_turn_line_prior_multiway: FACING_BET_EV,
  omaha_turn_line_prior_record_read: FACING_BET_EV,
  omaha_turn_line_prior_changed: FACING_BET_EV,
  omaha_mw_people_field_changed: FACING_BET_EV,
  omaha_hidden_bets_prior_read: FACING_BET_EV,
  omaha_hidden_give_up_priced: FACING_BET_EV,
  omaha_hidden_give_up_priced_call: FACING_BET_EV,
  omaha_flop_pressure_cap_priced: FACING_BET_EV,
  omaha_flop_pressure_cap_priced_call: FACING_BET_EV,
  omaha_flop_pressure_cap_priced_fold: FACING_BET_EV,
  omaha_flop_call_tree_call: FACING_BET_EV,
  omaha_flop_call_tree_fold: FACING_BET_EV,
  omaha_flop_call_tree_changed: FACING_BET_EV,
  omaha_flop_call_tree_record_read: FACING_BET_EV,
  omaha_flop_call_tree_min_defence_bounded: FACING_BET_EV,
  omaha_multiway_value_bet_priced_bet: FACING_BET_EV,
  omaha_multiway_value_bet_check_kept: FACING_BET_EV,
  omaha_strong_hand_check_priced: CARD_IMPACT,
  omaha_four_bet_fold_priced_call: PREFLOP_PRICED,
  omaha_reraised_pot_priced_call_kept: RERAISED_POT_PRICED,
  omaha_reraised_pot_priced_call_folded: RERAISED_POT_PRICED,
  omaha_reraised_pot_priced_call_reraised: RERAISED_POT_PRICED,
  omaha_reraised_pot_priced_fold_reraised: RERAISED_POT_PRICED,
  omaha_reraised_pot_priced_fold_reraise_kept: RERAISED_POT_PRICED,
  omaha_limp_reraise_limped: RERAISED_POT_PRICED,
  omaha_limp_reraise_open_kept: RERAISED_POT_PRICED,
  omaha_limp_reraise_reraised: RERAISED_POT_PRICED,
  omaha_limp_reraise_reraise_kept: RERAISED_POT_PRICED,
  omaha_reraised_pot_priced_fold_called: RERAISED_POT_PRICED,
  omaha_reraised_pot_priced_fold_kept: RERAISED_POT_PRICED,
  omaha_reraised_pot_priced_reraise_kept: RERAISED_POT_PRICED,
  omaha_reraised_pot_priced_reraise_called: RERAISED_POT_PRICED,
  omaha_reraised_pot_priced_reraise_folded: RERAISED_POT_PRICED,
  omaha_reraised_pot_priced_failed: exempt(
    'input',
    'receipt that the re-raised-pot price threw; the standing decision is returned unchanged'
  ),
  omaha_flop_raise_priced_resized: {
    kind: 'priced',
    range: "the bettor's measured flop range by line and size (his shown record shrunk toward it)",
    equity: 'two-card-runout equity of the hand against each strength bin of holdings',
    realization:
      'his fold share the equilibrium minimum defence of the pot he is offered; the street realization factor',
    price: 'each raise size against the call and the fold, by more than the equity estimate error',
  },
  omaha_flop_raise_priced_called: {
    kind: 'priced',
    range: "the bettor's measured flop range by line and size (his shown record shrunk toward it)",
    equity: 'two-card-runout equity of the hand against each strength bin of holdings',
    realization:
      'his fold share the equilibrium minimum defence of the pot he is offered; the street realization factor',
    price: 'each raise size against the call and the fold, by more than the equity estimate error',
  },
  omaha_flop_raise_priced_folded: {
    kind: 'priced',
    range: "the bettor's measured flop range by line and size (his shown record shrunk toward it)",
    equity: 'two-card-runout equity of the hand against each strength bin of holdings',
    realization:
      'his fold share the equilibrium minimum defence of the pot he is offered; the street realization factor',
    price: 'each raise size against the call and the fold, by more than the equity estimate error',
  },
  omaha_river_trips_board_boat_called: {
    kind: 'priced',
    range:
      'every holding of the unseen cards (exact count, the Horse cards and dead cards removed)',
    equity: 'whether any holding beats the full house (quads or a straight flush on a trips board)',
    realization:
      'the measured result of nut-class full house river raises on trips boards (-62 bb a raise, Nov 12-26)',
    price: 'the raise becomes the call; the call itself stays with the facing-bet verdicts',
  },
  omaha_river_value_bet_priced: {
    kind: 'priced',
    range: 'the measured strength histogram of a heads-up river checker, exact card removal',
    equity: 'exact share of the hand against the hands that continue',
    realization: 'his fold share: equilibrium moved by his own lifetime public river fold record',
    price:
      'the value bet against the showdown value of the check, by more than his fold rate error',
  },
  omaha_river_bluff_priced: {
    kind: 'priced',
    range: 'the measured heads-up river range, exact card removal',
    equity: 'exact share of the hand against the hands that continue',
    realization:
      'his card-removed fold share: equilibrium moved by his own lifetime public river fold record',
    price:
      'the bluff against the check by more than his fold rate error, with a positive blocker effect',
  },
  omaha_multiway_river_bluff_priced_on_blockers: {
    kind: 'priced',
    range: 'the measured people-only river range of each opponent, exact card removal',
    equity: 'exact share of the hand against each range; a continued bet is scored as lost',
    realization:
      "each opponent's card-removed fold share: multiway equilibrium moved by people's multiway population and his own record",
    price:
      'the bluff against the check by more than the fold rates error, with a positive blocker effect on the field',
  },
  omaha_four_way_plus_river_bluff_priced_on_blockers: {
    kind: 'priced',
    range: 'the measured people-only river range of each opponent, exact card removal',
    equity: 'exact share of the hand against each range; a continued bet is scored as lost',
    realization:
      "each opponent's card-removed fold share: multiway equilibrium moved by people's multiway population and his own record",
    price:
      'the bluff against the check by more than the fold rates error, with a positive blocker effect on the field',
  },
  omaha_river_bluff_priced_on_range: {
    kind: 'priced',
    range: 'the measured heads-up river ranges of both players, exact card removal',
    equity: 'exact share of the hand against the hands that continue',
    realization:
      'his card-removed fold share: equilibrium moved by his own lifetime public river fold record',
    price:
      'the bluff against the check by more than his fold rate error, with the range advantage and inside the bluffs the range value carries',
  },
  omaha_turn_bluff_priced_on_blockers: {
    kind: 'priced',
    range: 'the measured heads-up turn range by role, line and texture, exact card removal',
    equity: 'the sampled share of the hand with a card to come against the hands that continue',
    realization:
      'his card-removed fold share (equilibrium moved by his own turn fold record), the turn realization, his raise-back share',
    price:
      'the bet against the check by more than the fold rate and sampler errors, with a positive blocker effect',
  },
  omaha_turn_bluff_priced_on_range: {
    kind: 'priced',
    range: 'the measured heads-up turn ranges of both players by role, line and texture',
    equity: 'the sampled share of the hand with a card to come against the hands that continue',
    realization:
      'his card-removed fold share (equilibrium moved by his own turn fold record), the turn realization, his raise-back share',
    price:
      'the bet against the check by more than the fold rate and sampler errors, with the range advantage and inside the bluffs the range value carries',
  },
  omaha_river_checked_to_bet_measured: {
    kind: 'priced',
    range: 'the checker range after his river check (card-impact range, no opponent kind)',
    equity: 'equity of the hand against that range on the river',
    realization: 'the measured response curve of river bets after a check, showdown when called',
    price: 'the bet against the calibrated showdown value of the check',
  },
  omaha_river_first_to_act_bet_priced: {
    kind: 'priced',
    range: "the second actor's river range (card-impact range, no opponent kind)",
    equity: 'equity of the hand against that range on the river',
    realization: 'the measured response curve of first-to-act river bets, showdown when called',
    price: 'the bet against the check',
  },
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
