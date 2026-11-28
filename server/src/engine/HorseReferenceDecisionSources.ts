/**
 * THE REFERENCE DECISION'S OWN SOURCES (2026-10-16) - closing the digest hole.
 *
 * Every variant pack (Phase 10 PLO4, Phase 11 PLO5/6/8, Phase 12 Short Deck /
 * Pineapple / FLH / FLO8) deviates from, and otherwise RETURNS, the reference
 * decision HorseLogic builds; the Phase 13 joint owner prices against it. The
 * phase digests hashed HorseLogic.ts itself but none of the modules HorseLogic
 * decides with: the preflop bars, the solver charts and consults, the EV
 * engine, the tournament preflop atlas and Phase 8 owner, the variant
 * profiles, the persona, ICM. A change to any of them changed every qualified
 * pack's live behaviour while every digest stayed the same (investigation
 * 2026-10-16, "DIGEST HOLE"). This list is hashed into all four phase digests
 * (HorsePhase10Authority, HorsePhase11/12/13PolicyDigest), and
 * HorseReferenceDecisionSources.test.ts checks it against HorseLogic's actual
 * runtime imports and their closure, so a new decision import cannot slip
 * past it again.
 *
 * Not hashed itself: it only names paths, and the paths enter every digest.
 */
export const HORSE_REFERENCE_DECISION_SOURCE_REASONS: Readonly<Record<string, string>> =
  Object.freeze({
    'src/engine/HorseQuickCheckFold.ts':
      'the fixed tournament Horse check/fold cohort and current all-in price used by the reference timing decision',
    'src/engine/HorseNonBottomRiverValue.ts':
      'the checked-to high-only Omaha turn and river boat eligibility for legal value wagers and the river initiative release',
    'src/engine/HorseFlopTurnBluffRange.ts':
      'the baseline flop/turn bluff and semi-bluff range (2026-11-07): eligibility, line, selection, class frequency and size for a flop or turn with no showdown value',
    'src/engine/HorseRiverBluffRange.ts':
      'the baseline heads-up river bluff range (Dan 2026-11-06): eligibility, line, blockers, balanced frequency and size for a river with no showdown value',
    'src/engine/HorseMultiwayRiverBluff.ts':
      'the multiway river bluff (Dan 2026-11-06): two or three opponents, nut blocker and field-capping line required, per-opponent decay and read product, polarized pot-limit-legal size',
    'src/engine/HorseCheckedAggressor.ts':
      'the actual prior aggressor current-street check that releases the reference initiative gate without changing value pricing or legal sizing',
    'src/engine/HorseFeatureAuthority.ts':
      'boundary: exact qualified feature composition and live economic domain derive reference options; missing selection never activates a candidate',
    'src/engine/HorseLimpReraiseRead.ts':
      "the limp-reraise read (2026-11-07): the shrunk limp-reraise rate and the no-limit hold'em isolation bar against a limper seen to limp-reraise",
    'src/engine/HorseFastCalldownRead.ts':
      'the fast call-down read (2026-11-07): recent river call rate from the river recency and exploit fast windows, the station and calling-more flags and the fold-rate input the river bluff layers price with',
    'src/engine/HorseOpponentStyle.ts':
      'the opponent style read (2026-11-13): in-format axes, pre-repair discount and the bounded default-off style consumers (value bettor, big-bet respect and river bluff-catch cap, raise respect, tight opener respect, value extraction, fold bluffing)',
    'src/engine/HorseStyleSwitch.ts':
      'the style read live switch (2026-11-13): the source default (every option off), the configuration parser and its fail-safe, the canary bucket and the per-Horse decision options; a default flipped here would turn options on fleet-wide',
    'src/engine/HorseStyleShadow.ts':
      'the style read shadow arm (2026-11-13): which style options compute without applying, the bounded per-decision engagement record and the style read timing; nothing in it changes a committed action',
    'src/engine/HorseMultiwayRiverRead.ts':
      'bounded exact-context public river checkraise observations with canonical chip conservation for originally multiway hands',
    'src/engine/horseDecision/riverNodeSidecar.ts':
      'exact source and action-bound public node sidecar, preserving the original history on unavailable evidence',
    'src/engine/horseDecision/ownPublicHistoryProvenance.ts':
      'closed individual-history diagnostic validation bound to the original observer context, state and decision timestamp at the worker request boundary',
    'src/engine/HorseNearNutRiverValue.ts':
      'default-off small-pot near-nut value gate with physical blockers and settlement-owned unmatched contribution checks',
    'src/engine/HorseBoardContact.ts':
      'physical private river value consumed by board-conditioned equity and sampled continuation strength',
    'src/services/horseCorrectiveReview/liveKernel.ts':
      'boundary: the Phase 14 worker-local corrective consumer; absent a separately admitted functional capability it preserves action and RNG, and it never stacks on an applied prior candidate',
    'src/engine/HorseRiverNuts.ts':
      'the final river-nuts raise and full-pot near-pot wager invariants after all strategy owners',
    'src/engine/HorseTokenCallPrice.ts':
      'the committed-call bar on a token price (PLO6-AUDIT-010, 2026-11-12): Omaha high cash premiums shrink with a price under 0.15 and a made hand calls under 0.01',
    'src/engine/HorsePlo6TopSetNut.ts':
      'the default-off PLO6 top-set current-nuts test (PLO6-AUDIT P6-4, 2026-11-14) that sets full realization in the V38 flop/turn call menu',
    'src/engine/HorsePlo6MultiwayWeakBet.ts':
      'the default-off PLO6 multiway weak made-hand bet-to-check (PLO6 lane 2026-11-15, plo6NoMultiwayBetWithWeakMadeHand): a flop or turn bet facing nothing against two or more live opponents with a pair below the top card, two pair without the top card, the board pair with such a pair or a pocket pair above the top card of an unpaired board, no nut flush draw, under eight straight outs, under four nut-straight outs and no flush draw with four or more straight outs, not nut class, becomes a check; runs with the owner-ruled own-bet checks in the wager rules',
    'src/engine/HorsePlo6StrategyCalibration.ts':
      'the PLO6 calibration of the Omaha strategy constants (PLO6 lane 2026-11-16, omahaStrategyInPlo6, default off and off-only): HorseLogic.decide registers its six-card values with omahaStrategyConstant only for a decision whose gate is on, and takes them back otherwise',
    'src/engine/HorseOmahaRunoutRealization.ts':
      'the default-off turn call realization read from the per-river counts (PLO Strategy lane 2026-11-17, omahaTurnCallRealizationByRunout): reached only from the Omaha facing-bet EV verdict when the option is on; with it unset or false the verdict is identical key for key (HorseOmahaRunoutRealization.test.ts), so no reference decision depends on it',
    'src/engine/HorseOmahaRiverBluffCatch.ts':
      'the default-off bluff-catch pricing of a heads-up first river bet on the bettor measured range (WooWoo audit RIVER-FACING, 2026-11-18, omahaRiverBluffCatchIsPriced): reached only from the Omaha facing-bet EV verdict when the option is on; with it unset or false the verdict is identical key for key (HorseOmahaRiverBluffCatch.test.ts), so no reference decision depends on it',
    'src/engine/HorseOmahaFacingBetEvShownField.ts':
      'the default-off joint-field pricing of a turn or river call with another player in the hand (WooWoo audit F-04/F-11 C3, 2026-11-18, omahaFacingBetEvShownField): reached only from the Omaha facing-bet EV verdict when the option is on; with it unset or false the verdict is identical key for key (HorseOmahaFacingBetEvShownField.test.ts), so no reference decision depends on it',
    'src/engine/HorseOmahaTurnStabDefence.ts':
      "the default-off prior of a person's turn stab after a checked-through flop inside the facing-bet expected value (lane TURN-STAB, 2026-11-19, omahaTurnStabDefenceIsPriced): reached only from omahaFacingBetEvCount behind opts.omahaTurnStabDefenceIsPriced === true; with it unset or false the spot is the one without it (HorseOmahaTurnStabDefence.test.ts), so no reference decision depends on it",
    'src/engine/HorseRiverNoBlockerBet.ts':
      'the default-off river no-blocker-bet verdict (owner order 2026-11-19 16:47 America/Chicago, lane RIVER-BLOCK, horseRiverNoBlockerBet): reached only from HorseLogic riverNoBlockerBetRule behind opts.horseRiverNoBlockerBet === true; with it unset or false the decision is returned as given (HorseRiverNoBlockerBet.test.ts), so no reference decision depends on it',
    'src/engine/HorseOmahaFacingBetValueRange.ts':
      "the default-off river facing-bet verdict priced on the bettor's measured betting range (lane VALUE-REGION 2026-11-18, omahaFacingBetValueIsRangeRelative): reached only from the Omaha facing-bet EV count (HorseLogic.omahaFacingBetEvCount) when the option is on; with it unset or false the verdict is identical key for key (HorseOmahaFacingBetValueRange.test.ts), so no reference decision depends on it",
    'src/engine/HorseOmahaPairedRiverPriced.ts':
      "the default-off paired-river verdict priced on the bettor's line-conditioned range (lane PAIRED-RIVER 2026-11-18, omahaPairedBoardRiverIsPriced): reached only from the Omaha facing-bet EV count (HorseLogic.omahaFacingBetEvCount) when the option is on; with it unset or false the verdict is identical key for key",
    'src/engine/HorsePlo6FastCount.ts':
      'the exact six-card count used by the Omaha facing-bet EV rule (PLO6 lane 2026-11-16): the barred-pair graph counted as an independence polynomial, equal to the walk it replaces on every tested hand; read only while a six-card hand is counted',
    'src/engine/HorsePlo6PricingPort.ts':
      'the PLO6 arms of the Omaha facing-bet EV and river medium-bet rules (PLO6 lane 2026-11-16, reached only with omahaStrategyInPlo6 on, default off and off-only): six cards on the river only, the measured river fold test stands over the EV call, and the medium-bet call uses the six-card beaten-share bars',
    'src/engine/HorseOmahaPricedMode.ts':
      'the default-off Omaha priced rules (owner 2026-11-17 11:49, no blanket rules): the mode of one decision and the continuous size inputs of the facing-bet range (omahaFacingBetRangeIsContinuous, omahaBluffShareFromBetRate); off outside a PLO4/PLO5 cash decision whose option is on',
    'src/engine/HorseOmahaPricedRules.ts':
      'the default-off Omaha priced rules: the three priced comparisons (raise, call or fold on the exact count; raise or call on sampled shares; bet or check on the card-impact model), the one opponent-read interface and the mixing probability',
    'src/engine/HorseOmahaPricedSites.ts':
      'the default-off Omaha priced sites (sites-013U37): the made-hand defence wager, the turn set pound size and the river nut-blocker bluff admission priced on the card-impact model, and the bare big pair flop bet priced on sampled bands of his holdings (omahaMadeHandBetIsPriced, omahaTurnSetSizeIsPriced, omahaBlockerBluffIsPriced, omahaFlopBetIsPriced); null outside the scope, so the caller rule acts as before',
    'src/engine/HorseOmahaPricedWiring.ts':
      'the default-off Omaha priced rules: the rule sites HorseLogic calls where a categorical PLO4/PLO5 cash rule acts (omahaTurnRiverRaiseIsPriced, omahaDrawRaiseIsPriced, omahaOopTurnBarrelIsPriced, omahaPairedBoardBetIsPriced, omahaPressureIsPriced, omahaBigBetCallsArePriced, omahaUnderpairMultiwayIsPriced, omahaPricedMix); null outside the scope, so the caller rule acts as before',
    'src/engine/HorseOmahaCheckedToBet.ts':
      'the default-off Omaha checked-to bet (WooWoo audit repair programme 2026-11-18, omahaCheckedToBetIsPriced): in PLO4/PLO5 cash on the river (v2: the turn is out), when every opponent has checked and the answer is a check, the check priced beside every bet size on the card-impact model against each checking range and measured continue rate, after the rake, with the standard error of the comparison as the margin; null outside the scope, so the check it was given stands',
    'src/engine/HorseOmahaRiverNutRaise.ts':
      'the final Omaha high river rule (Dan 2026-11-14, hand 59401453): a raise facing a wager stands only with the nuts or an effective-nut hand, every other raise becomes a call, before the call-discipline folds',
    'src/engine/HorseOmahaReraisedPot.ts':
      'the default-off Omaha re-raised-pot discipline (owner ruling 2026-11-14 23:49): facing a 4-bet or more preflop a hand without aces or a premium structure folds, and in such a pot one pair or two pair below top two does not stack off unless priced against a declared strong range; the outermost call-discipline fold',
    'src/engine/HorseOmahaOopReraisedPot.ts':
      'the default-off Omaha out-of-position re-raised-pot calling range (owner 2026-11-15 11:49 and 11:51): a preflop call of a 3-bet or more out of position against the last raiser stands only with suited aces, as a priced commitment, or with a coordinated hand whose equity clears the price plus the realization margin, a call of a 4-bet in position likewise (omahaOopReraisedPotStrongRange); and the flop rule that a caller in a re-raised pot continues only with two pair or better, a pair with a nut-leaning draw or a strong draw (omahaReraisedPotFlopContinueNeedsEquityShape); and the rule that a 3-bet or 4-bet out of position or from early position needs suited aces or a declared premium structure and otherwise calls or folds (omahaReraiseRangeOutOfPosition and omahaReraiseRangeEarlyPosition, switched separately)',
    'src/engine/HorseOmahaPreflopReraiseDefence.ts':
      "the default-off Omaha priced preflop re-raise defence (PLO Strategy lane 2026-11-17, omahaPreflopReraiseDefencePriced): in PLO4/PLO5 cash facing a 3-bet or more preflop, the expected value of the call and of a proposed re-raise against folding, from the exact hand's sampled equity against the re-raiser's measured width (a seed taken from the cards, never the brain's random stream), the measured realization, the price and the rake",
    'src/engine/HorseOmahaPreflopReraiseDefenceRule.ts':
      'the rule that applies the default-off Omaha priced preflop re-raise defence (omahaPreflopReraiseDefencePriced): the spot, the one read interface of the re-raiser (the pooled read, else the population means) and the conversion of the answer it is given into the verdict; receipts omaha_preflop_reraise_defence_fold / _call / _raise / _changed',
    'src/engine/HorseOmahaReadConditional.ts':
      'the default-off Omaha read-conditional defence (owner 2026-11-15 01:03): the measured tight re-raiser read that lets the re-raised-pot preflop fold apply (omahaReraisedFoldVsTight) and the measured postflop value-leader read that lets the turn no-raise and scare-card checks apply (omahaMadeHandDefenseVsValueLeader) and the bluff-catcher folds apply against the player faced (omahaBluffCatcherFoldVsValueLeader), and the measured wide re-raiser read that lets an elite-class hand call instead of folding to his 3-bet (omahaEliteContinuesVsMeasuredWideThreeBettor); a presumed read never counts',
    'src/engine/HorseOmahaRiverMediumBetCalls.ts':
      'the default-off Omaha river medium-bet call (PLO Strategy lane 2026-11-15, omahaRiverMediumBetStrongHandCalls): a PLO4/PLO5 cash river fold of two pair or better facing the opening bet of 40 to 70 percent of the pot, heads-up or closing the action, becomes a call when the hand holds up against the bettor’s possible holdings 1.5 times as often as the price asks; the outermost call-discipline rule, withheld against a measured value leader',
    'src/engine/HorseOmahaOopChecks.ts':
      'the default-off Omaha bet-to-check spots (owner 2026-11-15, hands 59517323 and 59521326; the paired-turn barrel without a full house, omahaPairedTurnNoBarrelWithoutBoatVsValueLeader, among them): the bare overpair out of position on the flop (omahaBareOverpairOopFlopCheck), the unimproved pair on the turn after the flop bet was called and the less-than-full-house lead on a paired river into a caller, the last two only against measured postflop value leaders (omahaOverpairNoOopBarrelVsValueLeader, omahaPairedRiverNoThinLeadVsValueLeader)',
    'src/engine/HorseOmahaUnderpair.ts':
      'the default-off Omaha underpair rules (owner complaint 2026-11-15, hand 59518335): a Horse whose own re-raise is re-raised cold folds a hand without aces or a premium structure unless the call is priced by commitment (omahaNoCallColdFourBetWithoutPremium), and one pair below the top card of the flop with no flush draw or nut open-ended or wrap draw folds to a bet and a call (omahaUnderpairNoMultiwayFlopContinue)',
    'src/engine/HorseOmahaCardImpact.ts':
      'the default-off Omaha card impact (owner 2026-11-15 11:41, omahaCardImpact): what the last turn or river card did to the hand and to the opponent range, and the check-or-bet-size comparison priced against that range, heads-up with nothing to call',
    'src/engine/HorseOmahaStrongHandSlowplayMix.ts':
      'the default-off Omaha strong-hand slowplay mix (owner 2026-11-15 14:13, omahaStrongHandSlowplayMix): in PLO4/PLO5 cash a final raise facing a bet with a nut-class hand becomes a call, and a final flop bet with a set on a very dry flop becomes a check, each at a mixed frequency of the spot (next cards that keep the nuts or hurt the set, the opponent read, position, stacks) drawn from a stream derived from the strategy stream without advancing it; inside the owner-ruled final and the turn and river nut rule',
    'src/engine/HorseOmahaValueSizeBand.ts':
      'the default-off Omaha nut value size (WooWoo audit NUT-SIZE 2026-11-19, owner 2026-11-18 23:00, omahaValueSizeIsUnreadable): in PLO4/PLO5 cash a postflop full-pot bet or raise with a nut-class hand stays the full pot at the measured street share and is otherwise sized in 80-95% of the pot increment, drawn from a stream derived from the strategy stream without advancing it; the last step of the wager_rules node',
    'src/engine/HorseOmahaStrongHandValue.ts':
      "the default-off Omaha strong-hand value decisions (owner 2026-11-15 12:16, omahaStrongHandValue; the earlier playbook's PLO4/PLO5 cash entries): on the river with a full house or better or a nut-class hand, a check priced against every value bet against each opponent left, and a call facing one bettor priced against every value raise on the exact count of the holdings that continue; the last rule of the wager_rules node",
    'src/engine/HorseOmahaFacingBetEv.ts':
      "the default-off Omaha facing-bet expected-value decision (owner 2026-11-15 11:39, omahaFacingBetEv): in PLO4/PLO5 cash on the turn and the river, a fold or a call facing a bet or a raise is replaced by one EV verdict on the exact count of holdings that beat the hand, the bettor's range from his bet size, line and measured tendencies, and the actual price; the outermost call-discipline rule, it never raises",
    'src/engine/HorseOmahaMeasuredBettorRange.ts':
      "the measured bettor range tables of the default-off corrected facing-bet price (PLO-OWNER lead-6 2026-11-24, omahaFacingBetRangeIsMeasuredByLine and omahaFacingBetMinimumDefencePrior): strength histograms by street, line, size and pot type fitted from shown hands, a bettor's own shown record shrunk toward them, the minimum-defence bound on a no-record prior",
    'src/engine/HorseOmahaFacingBetRangeTables.json':
      'the measured PLO4/PLO5 cash bettor and caller strength tables, continue rates, field fold-through, later bet rates and the F6 minimum-defence air floors (scripts/ops/omaha-facing-bet-range-fit.mjs; PLO-OWNER lead-6 2026-11-24)',
    'src/engine/HorseOmahaEquilibriumAnchor.ts':
      'the balanced non-value share for a price (PLO-OWNER lead-7 2026-11-26): the weight behind a thin people cell in omahaFacingBetPriorIsPeopleMeasured',
    'src/engine/HorseOmahaFacingBetPeoplePrior.ts':
      "the default-off people-measured bettor prior (PLO-OWNER lead-7 2026-11-26, omahaFacingBetPriorIsPeopleMeasured): inside omahaFacingBetEv in PLO4/PLO5 cash, heads-up, a turn or river bet or raise priced on people-only measured shares (river: three regions), moved by the bettor's own shown bets",
    'src/engine/HorseOmahaPeoplePriorHidden.ts':
      "the default-off hidden-bet people cells (lead-8 lane OFA 2026-11-27, omahaPeoplePriorCountsHiddenBets): inside omahaFacingBetEv (turn) and the priced flop pressure cap (flop) in PLO4/PLO5 cash, the people-only cell per game and split counts people's hidden bets (folded later, mucked) as non-value; public events only",
    'src/engine/HorseOmahaPeoplePriorHidden.data.ts':
      'the generated hidden-bet split cells read by HorseOmahaPeoplePriorHidden.ts (people-only export, same fit as HorseOmahaFacingBetPeoplePrior.data.ts)',
    'src/engine/HorseOmahaMultiwayPeopleField.ts':
      'the default-off people-measured multiway field (PLO-OWNER lead-7 2026-11-27, omahaMultiwayFieldIsPeopleMeasured): inside omahaFacingBetEv in PLO4/PLO5 cash, a multiway turn or river call priced with callers at the people-measured caller width and players behind at the people multiway continue rate, each anchored to equilibrium',
    'src/engine/HorseOmahaTurnLinePeoplePrior.ts':
      "the default-off line-split turn bettor prior (lead-8 lane OFB 2026-11-27, omahaTurnFacingBetPriorIsLineSplit): inside omahaFacingBetEv in PLO4/PLO5 cash, a turn first wager, heads-up or multiway, priced on the people-only cell of its flop line (checked through / wagered), moved by the bettor's own shown bets",
    'src/engine/HorseOmahaTurnLinePeoplePrior.data.ts':
      'the people-only turn cells by flop line, generated by server/scripts/omaha-turn-line-people-prior-fit.ts; read only by HorseOmahaTurnLinePeoplePrior.ts (omahaTurnFacingBetPriorIsLineSplit, default OFF)',
    'src/engine/HorseOmahaFlopPressureCapPriced.ts':
      "the default-off priced flop pressure cap (PLO-OWNER lead-7 2026-11-26, omahaFlopPressureCapIsPriced): in PLO4/PLO5 cash, heads-up on the flop facing one bet where the V40 class cap prices a weak made hand, the reference call-or-fold check reads the equity against the bettor's value region plus the people-only measured flop non-value share, moved by his own shown flop bets",
    'src/engine/HorseOmahaFacingBetPeoplePrior.data.ts':
      "the people-only PLO4/PLO5 cash facing-bet population, generated by server/scripts/omaha-facing-bet-people-prior-fit.ts (people's bets, people's answers, cards people showed; no Horse play, no HUD population rows)",
    'src/engine/HorseOmahaFacingBetPriced.ts':
      "the default-off corrected turn and river facing-bet price (PLO-OWNER lead-6 2026-11-24, omahaFacingBetRangeIsMeasuredByLine, omahaFacingBetIndifferenceCalls, omahaFacingBetFieldIsJoint, omahaMultiwayCallNeedsNutShare): inside omahaFacingBetEv in PLO4/PLO5 cash, the call against the bettor's measured range priced exactly, the field dealt jointly, indifference calls",
    'src/engine/HorseOmahaPricedJointSample.ts':
      'the joint showdown sample of the default-off corrected facing-bet price and multiway value bet (PLO-OWNER lead-6 2026-11-24): the bettor and the field dealt on the same cards from measured ranges, card-seeded',
    'src/engine/HorseOmahaFlopCallTree.ts':
      "the default-off flop call tree (PLO-OWNER lead-6 2026-11-24, omahaFlopRealizationIsPriced): in PLO4/PLO5 cash a flop fold or call facing a bet is the two-street tree on the bettor's measured range and the joint field, his later bet rates measured; it never raises",
    'src/engine/HorseOmahaFastScore.ts':
      'the integer-card Omaha high score of the flop call tree (PLO-OWNER lead-6 2026-11-24, omahaFlopRealizationIsPriced): the same order as HorseEval.scoreOmahaHiPartial, faster; it decides nothing on its own',
    'src/engine/HorseOmahaMultiwayValueBet.ts':
      "the default-off priced multiway value bet (PLO-OWNER lead-6 2026-11-24, omahaMultiwayValueBetIsPriced): in PLO4/PLO5 cash a final multiway check becomes the best of three bet sizes where it beats the check against the field's measured fold and calling ranges",
    'src/engine/HorseOmahaStabDefence.ts':
      "the default-off stab defence (EMERG lane STAB-DEFENCE 2026-11-20, omahaStabDefenceIsPriced): in PLO4/PLO5 cash on the turn and the river, facing the first wager of the street, the bettor's non-value share is priced from his own lifetime public first-wager frequency against the population's, shrunk by its evidence; no record is the population prior exactly",
    'src/engine/HorseOmahaStrongHandCheck.ts':
      "the default-off strong-hand check (EMERG lane STAB-DEFENCE 2026-11-20, omahaStrongHandCheckIsPriced; held, not graded): in PLO4/PLO5 cash on the turn and the river heads-up, the Horse first to act, a final value bet is priced beside the check on the opponent's public stab and fold records and becomes a check with the probability the comparison gives; it changes only a bet into a check",
    'src/engine/HorseOmahaRiverBetFoldRecord.ts':
      "the default-off river fold record (EMERG lane STAB-DEFENCE-5 2026-11-21, omahaRiverBetFoldIsHisRecord): in PLO4/PLO5 cash on the river heads-up, the answer curve the two river bet rules price a bet with is the population's with its fold share moved by the opponent's own lifetime public river fold record, shrunk by its evidence; no record is the population curve exactly",
    'src/engine/HorseOmahaCbetRaisePriced.ts':
      "the default-off priced c-bet raise (EMERG lane CBET-DEFENCE 2026-11-21, omahaCbetRaiseIsPriced): in PLO4/PLO5 cash on the flop, the raise of the Horse's own continuation bet is ranged on the raiser's measured raise share (lifetime public record shrunk to the population's), and heads-up bluff c-bets carry that raise branch; a decision source the reference replay must be able to reach",
    'src/engine/HorseOmahaFlopRaisePriced.ts':
      "the default-off heads-up flop raise price (PLO-OWNER lead-7 2026-11-26, omahaFlopRaiseIsPriced): in PLO4/PLO5 cash a flop raise facing a wager is priced at its sizes beside the call and the fold on the bettor's measured flop range; it never makes a raise; pure",
    'src/engine/HorseOmahaTripsBoardBoat.ts':
      'the default-off river trips-board full house rule (PLO-OWNER lead-7 2026-11-26, omahaRiverTripsBoardBoatIsNotNutClass): in PLO4/PLO5 cash on the river facing a wager, a raise with a full house on a trips board that quads or a straight flush can beat becomes the call; pure',
    'src/engine/HorseOmahaRiverOpeningRangeTables.json':
      'the measured PLO4/PLO5 cash heads-up river opening ranges (a checker after his river check, the in-position player before the river action), shown hands only, showdown bias corrected (scripts/ops/omaha-river-opening-range-fit.mjs; PLO-OWNER lead-7 2026-11-26)',
    'src/engine/HorseOmahaOpeningBluffRangeTables.json':
      'the measured PLO4/PLO5 cash heads-up turn and river ranges by role, line and board texture, shown hands only, showdown bias corrected by strata of the player own action (scripts/ops/omaha-opening-bluff-range-fit.mjs; PLO-OWNER lead-7 lane plo-bluffs 2026-11-26)',
    'src/engine/HorseOmahaPeopleFold.ts':
      "people's measured fold to a heads-up PLO4/PLO5 cash turn or river opening bet (PLO-OWNER lead-7 2026-11-26): his record -> people's population -> equilibrium; read by the default-off opening bluffs, the river blocker bluff and omahaRiverBetFoldIsPeopleMeasured",
    'src/engine/HorseOmahaPeopleFoldTables.json':
      'the people-only fold table behind HorseOmahaPeopleFold.ts (answers by people only; scripts/ops/omaha-people-fold-fit.mjs)',
    'src/engine/HorseOmahaOpeningBluff.ts':
      'the default-off heads-up turn and river opening bluff (PLO-OWNER lead-7 lane plo-bluffs 2026-11-26, omahaTurnBluffIsPricedOnBlockers, omahaTurnBluffIsPricedOnRangeAdvantage, omahaRiverBluffIsPricedOnRangeAdvantage): a final check with nothing to call becomes the priced bet only with the price and a second leg (blockers, or the range advantage with the hand in the weakest share its range value carries); off, the decision is returned as given',
    'src/engine/HorseOmahaRiverOpeningBet.ts':
      'the default-off heads-up river opening bet (PLO-OWNER lead-7 2026-11-26, omahaRiverValueBetInPositionIsPriced and omahaRiverBluffIsPricedOnBlockers): in PLO4/PLO5 cash on the river heads-up with nothing to call, a final check becomes the priced value bet in position, or the priced bluff that also needs a positive blocker effect, on his measured range with exact card removal and his fold record moved from equilibrium; pure',
    'src/engine/HorseOmahaRiverCheckedToBet.ts':
      'the default-off river checked-to bet (EMERG lane OFFENCE-BUILD 2026-11-20, omahaRiverCheckedToBetIsMeasured): in PLO4/PLO5 cash on the river heads-up after the opponent checked, a final check becomes the bet of highest expected value on the measured response curve when it beats the calibrated showdown value by more than its standard error; no opponent kind; pure',
    'src/engine/HorseOmahaRiverFirstToActBet.ts':
      'the default-off river first-to-act bet (EMERG lane OFFENCE-BUILD 2026-11-20, omahaRiverFirstToActBetIsPriced): in PLO4/PLO5 cash on the river heads-up with nothing to call and the opponent still to act, a final check becomes the bet of highest expected value on the measured response curve when it beats the check by more than its standard error; pure',
    'src/engine/opponentHud/OpponentHudExploit.ts':
      "the default-off lifetime opponent read (PLO-OWNER lane OPPONENT-HUD 2026-11-20, omahaOpponentLifetimeHud): in PLO4/PLO5 cash HorseMind.opponentRead takes each opponent's exploit counters from his lifetime public profile carried by the decision request; pure over the installed packet",
    'src/engine/HorseOmahaHudPreflopPriced.ts':
      'the default-off priced preflop comparison at the maniac-pressure site (lane OPPONENT-HUD 2026-11-21, omahaOpponentLifetimeHud): the raise against the call and the fold on the read-adjusted response of the players left, measured realization reduced by their turn/river stab excess; pure',
    'src/engine/HorseOmahaPreflopHudPriced.ts':
      'the default-off priced six-max preflop read on lifetime HUD cells (PLO-OWNER lead-4 B4 2026-11-21, omahaPreflopReadIsPricedFromLifetime): retires presumedAggressorRead on 3-6 seat PLO4/PLO5 cash preflop and prices widened spots on sh + pf.lr + pf.bvo HUD cells with n/(n+k) shrinkage; pure over the installed packet',
    'src/engine/opponentHud/OpponentHud.ts':
      'the one opponent-profile accessor (hudStat, hudRecall) and the decision packet the worker installs from the request; shrinkage toward the population prior; pure, no database, no clock',
    'src/engine/HorseEquilibriumAnchor.ts':
      'the equilibrium anchor of the opponent reads (lane prior-anchor 2026-11-26): indifference anchors and stated reference frequencies, k >= 20, and the decision-scoped mode set only with omahaOpponentLifetimeHud and omahaOpponentLifetimeHudDecides or omahaPreflopReadIsPricedFromLifetime on (default OFF); the math core prices responders at its anchor fold; pure, no database, no clock',
    'src/engine/opponentHud/OpponentHudProfile.ts':
      'the lifetime public opponent profile: statistic registry, public hand record and recall keys read by the accessor; public fields only',
    'src/engine/HorseOmahaRiverCurrentNutsCallFloor.ts':
      'the default-off river current-nuts call floor (EMERG lane RANGE-MODEL-2 2026-11-20, omahaRiverCurrentNutsCallFloor): in PLO4/PLO5 cash on the river facing a wager, a final fold with the exact current nuts becomes the legal call where a full chop with every live opponent still returns the call; the outermost answer of the wager_rules node; pure',
    'src/engine/HorseOmahaReraisedPotPricedRule.ts':
      'the default-off re-raised-pot price rule (PLO lead-6 2026-11-24, omahaReraisedPotCallIsPriced and omahaReraisedPotReraiseIsPriced): in PLO4/PLO5 cash preflop facing a 3-bet or more, reads the field and the anchored opponent reads and replaces the standing call, fold or re-raise by the priced one; inert with both options off',
    'src/engine/HorseOmahaReraisedPotPriced.ts':
      "the same rule's pure price: joint seeded equity against the whole field, self-play realization by role, position, players and depth, EV(call) and EV(re-raise); no I/O, no random stream",
    'src/engine/HorseOopReraiseRangeHoldsWiring.ts':
      "the default-off out-of-position 3-bet range rule wiring (PLO-LEAD-6 2026-11-24, omahaOopReraiseRangeHoldsVsReraise and holdemOopReraiseRangeHoldsVsReraise): routes an out-of-position decision facing one open, asks the Horse's own answer to the 4-bet on the public frame, applies the priced call or fold in wager_rules; inert with both options off",
    'src/engine/HorsePreflopIndifferenceAnchor.ts':
      'pure preflop indifference anchors (PLO lead-7 2026-11-26): fold = s/(1+s), bluff share = s/(1+2s), the anchored fold / call / re-raise answer to a re-raise; read by the out-of-position 3-bet range rule only under horse.openerAnswersPriorVersion 2; no I/O, no random stream',
    'src/engine/HorseOopReraiseRangeHolds.ts':
      "the same rule's pure price: the opener's answers to a 3-bet (fitted population prior), the 4-bet frame, EV(3-bet) against the admitted call, the seeded planned-fold keep frequency; no I/O, no random stream",
    'src/engine/HorseOmahaFourBetFoldPricedCall.ts':
      "the default-off priced call of a fold facing a 4-bet (EMERG lane PREFLOP-UNCONTESTED 2026-11-20, omahaFourBetFoldPricedCall): in PLO4/PLO5 cash preflop, after hero's own raise, facing a 4-bet or more heads-up, a final fold becomes the legal call where omahaReraisedCallPriced gives EV(call) > 0; the outermost answer of the wager_rules node; pure",
    'src/engine/HorseOmahaFacingBetValueShareMeasured.ts':
      "the default-off measured facing-bet range (HORSE DECISIONS lane 2026-11-19, omahaFacingBetValueShareIsMeasured): the bettor's street record moves the facing-bet verdict's value share beside his kind, and a person's heads-up turn or river bet is priced on his line-conditioned range weighted by the measured density of people's bets, tilted by his record; pure",
    'src/engine/HorseOmahaFacingBetValueShareMeasuredRule.ts':
      "the default-off measured facing-bet range's one memory read (omahaFacingBetValueShareIsMeasured): the bettor's street record from the decision's carried state, asked by HorseLogic's facing-bet count only with the option and the mind on",
    'src/engine/HorseOmahaFlopBettorRead.ts':
      "the default-off read of one flop bettor for the Omaha flop facing-bet verdict (PLO Strategy lane 2026-11-19, omahaFlopVerdictReadsTheBettor): from his street record, his flop bet rate on this texture and line and his turn and river bet rates, each beside his kind's measured rate and shrunk by his sample, to the factor on the verdict's value and non-value shares and the factor on the later-street bet share of its realization model; pure",
    'src/engine/HorseOmahaFoldModelFittedOnPeople.ts':
      'the default-off Omaha fold model fitted on people (WooWoo audit FOLD-MODEL 2026-11-18, omahaFoldModelFittedOnPeople): PLO4/PLO5 cash, flop or turn, heads-up against a person, nothing to call: each v38 EV engine bet size is priced with his fold share from the measured person cells (OMAHA_PERSON_FOLD_CELLS by variant, street, pot type and bet-size bucket, shrunk to OMAHA_EV_FOLD_MODEL where thin) scaled by his durable fold-to-bet read relative to people, in place of mdfFold x foldMul; receipts omaha_fold_model_fitted_on_people_*',
    'src/engine/HorseOmahaFlopFacingBetEv.ts':
      "the default-off Omaha flop facing-bet expected-value verdict (PLO Strategy lane 2026-11-17, omahaFlopFacingBetEv): in PLO4/PLO5 cash on the flop, the spot, the sampled two-card runout counts (a seed taken from the cards, never the brain's random stream), the realization factor read from the runouts and the EV verdict against the bettor's range by pot share, line and measured read",
    'src/engine/HorseOmahaClassCapsRespectEquity.ts':
      'the default-off Omaha class-cap floor (V40CAP lane 2026-11-19, omahaClassCapsRespectEquity): PLO4/PLO5 cash, one board, high only, facing a bet; the scope test, the floor arithmetic (a V15/V40 class cap lowers the equity only down to the measured equity against the bettor public-information range, at least 400 samples) and the call-only hold (a raise the floor would make is held to the call); pure',
    'src/engine/HorseOmahaFlopDefenceTree.ts':
      'the default-off Omaha flop defence (WooWoo audit FLOP-DEFENCE 2026-11-18, omahaFlopDefenceIsPriced): heads-up facing the first flop bet with chips behind, the call of the flop verdict priced as a two-street tree on the verdict sampled runouts (his measured turn and river bet rates and range composition by street, the Horse priced turn and river answers), and the pot raise measured beside it; pure, null when it cannot read the runouts',
    'src/engine/HorseOmahaBluffPricedAgainstTheTarget.ts':
      'the default-off Omaha bluff priced against the target (HORSE DECISIONS lane 2026-11-19, omahaBluffIsPricedAgainstTheTarget): PLO4/PLO5 cash at a table and in Lightning, the outermost answer of wager_rules: a heads-up wager facing no bet kept only when priced above the check with his measured fold at its price (his street or pooled fold-to-bet record shrunk toward his kind) and the Horse sampled showdown share against the strongest part of his holdings (a seed taken from the cards, never the brain random stream); the flop call and the flop / turn raise facing a bet priced on the sampled raise at every legal size with the same measured fold; receipts omaha_bluff_priced_against_target_*',
    'src/engine/HorseOmahaBigDrawBetPriced.ts':
      'the default-off R4 Omaha checked-to flop/turn big-draw bet pricing on lifetime HUD response (PLO-OWNER lane REPLACEMENTS-5 2026-11-21, omahaBigDrawBetIsPricedOnHisResponse): PLO4/PLO5 cash checked-to big-draw bets priced on lifetime HUD fold, raise-back and stab cells with a prove-it-to-bet uncertainty bar and no categorical OOP bar; off returns null',
    'src/engine/HorseHoldemOpeningIsPriced.ts':
      "the default-off priced Hold'em opening side (plo-lead7 2026-11-25, holdemOpeningValueBetIsPriced and holdemOpeningBluffIsPriced): NLH cash heads-up, not facing a wager, a check becomes a value bet or a blocker / range-advantage bluff only when it prices above the check against his record-first fold anchored to equilibrium; off never runs",
    'src/engine/HorseHoldemMultiwayOpeningIsPriced.ts':
      "the default-off priced first bet of the turn or river against two or more opponents (plo-lead7 2026-11-26, holdemMultiwayOpeningBluffIsPriced and holdemMultiwayOpeningValueBetIsPriced): NLH cash, nobody has bet the street, a check becomes a value bet or a blocker / range-advantage bluff only when it prices above the check against the field's joint fold (the minimum defence shared across the field, each opponent's record first, anchored to equilibrium); off never runs",
    'src/engine/HorseHoldemPeopleRiverFold.ts':
      "the default-off people-measured Hold'em river fold (lead-8 2026-11-27, holdemRiverBluffIsPricedOnPeople): his fold to a heads-up NLH cash river first bet read size by size, his own lifetime river record of that size shrunk to people's measured fold for the Horse's line and that size, shrunk to equilibrium; off never runs",
    'src/engine/HorseHoldemPeopleRiverFoldTables.json':
      'the people-only river fold table behind HorseHoldemPeopleRiverFold.ts (answers by people only; scripts/ops/holdem-people-river-fold-fit.mjs)',
    'src/engine/HorseHoldemPeopleTurnFold.ts':
      "the default-off people-measured Hold'em turn fold (lead-9 2026-11-27, holdemTurnBluffIsPricedOnPeople): his fold to a heads-up NLH cash turn first bet read size by size, his own lifetime turn record of that size shrunk to people's measured fold for the Horse's line and that size, shrunk to equilibrium; off never runs it and the reference decision does not consume it",
    'src/engine/HorseHoldemPeopleTurnFoldTables.json':
      'the people-only turn fold table behind HorseHoldemPeopleTurnFold.ts (answers by people only; scripts/ops/holdem-people-turn-fold-fit.mjs)',
    'src/engine/HorseHoldemTournamentLateIsPriced.ts':
      "the default-off priced Hold'em tournament bluff after the flop (plo-lead7 tourney-postflop 2026-11-26, holdemTournamentRiverBluffIsPriced and holdemTournamentTurnBluffIsPriced): NLH tournaments heads-up in the pot, not facing a wager, a check becomes a blocker / range-advantage bluff only when it prices above the check with its losses weighted by the pay-jump bubble factor; a pay jump the context cannot price stands it down; off never runs",
    'src/engine/HorseHoldemValueAndCallsArePriced.ts':
      "the default-off hold'em value and calls priced (HORSE DECISIONS lane 2026-11-19, holdemValueAndCallsArePriced): NLH cash heads-up postflop, the value raise, the made-hand bet or check, the facing-bet call and the river bet priced against the bettor's line range and measured response; off returns the decision unchanged",
    'src/engine/HorseHoldemCommittedPricing.ts':
      "the default-off hold'em committed no-pair EV verdict and four-flush / four-straight danger-board bettor-range equity (Hold'em Strategy lane 2026-11-20, holdemCommittedNoPairIsPriced and holdemDangerBoardEquityIsPriced): reached only behind strict === true gates in NLH cash heads-up facing-bet decisions; off never enters and returns the decision unchanged",
    'src/engine/HorsePlo6ValueShare.ts':
      'the default-off PLO6 value share (HORSE DECISIONS lane 2026-11-19, plo6FacingBetIsPriced): the six-card value region taken at the hand strength of the four-card share, read by the PLO6 facing-bet verdict only when its option is on',
    'src/engine/HorsePlo6FacingBetIsPriced.ts':
      'the default-off PLO6 facing-bet verdict (HORSE DECISIONS lane 2026-11-19, plo6FacingBetIsPriced): PLO6 cash facing a bet, the call, fold or river raise priced on the six-card count; off returns the decision unchanged',
    'src/engine/HorsePlo6FacingBetPricedV2.ts':
      'the default-off six-card native PLO6 facing-bet pricing model V2 (2026-11-21, plo6FacingBetIsPricedV2): fixes V1 valueShare blowup, low-SPR jam bucketing, six-card bluff priors, paired-board guard, and river-only call->fold; off returns the decision unchanged',
    'src/engine/HorsePlo6FlopDefence.ts':
      'the default-off PLO6 flop defence (PLO6 lane 2026-11-20, E6 under plo6FacingBetIsPriced): heads-up first flop bet with chips behind priced on the two-street barrel tree and multiway flop caller/behind shares scaled by six-card pair concentration; reached only when plo6FacingBetIsPriced is on',
    'src/engine/HorsePlo6RiverDefence.ts':
      'the default-off PLO6 river under-bluffing guard, current-nuts call floor and private-nuts raise protection (PLO6 lane 2026-11-20, E7 under plo6FacingBetIsPriced): six-card M1 river beaten-share guard and exact current/private river nuts rules; reached only when plo6FacingBetIsPriced is on',
    'src/engine/HorsePlo6MultiwayTurnField.ts':
      'the default-off PLO6 multiway turn caller field-factor (PLO6 lane 2026-11-20, E8 under plo6FacingBetIsPriced): deterministic six-card joint river-runout evaluator replacing static four-card turn field zeroing on multiway PLO6 cash turns; reached only when plo6FacingBetIsPriced is on',
    'src/engine/HorseOmahaMultiwayPricedInTournaments.ts':
      'the default-off Omaha tournament multiway pricing (HORSE DECISIONS lane 2026-11-19, omahaMultiwayIsPricedInTournaments): a preflop multiway call-off and a multiway own bet priced jointly against the callers; off returns the decision unchanged',
    'src/engine/HorseHoldemTournamentAllInCall.ts':
      "the default-off hold'em tournament all-in call (HORSE DECISIONS lane 2026-11-19, holdemTournamentAllInCallIsPriced): every all-in call decided by equity against the jammer's range at the exact price with the pay-jump factor; off returns the decision unchanged",
    'src/engine/HorseHoldemTournamentRaiseDefence.ts':
      "the default-off hold'em tournament raise defence price (2026-11-24, holdemTournamentHeadsUpBigBlindDefenceIsPriced / holdemTournamentBlindDefenceIsPriced / holdemTournamentCommittedRaiseIsPriced): fold, call or shove facing a non-all-in raise by expected value from a fixed class equity table and measured priors, no random draw; off it is never called",
    'src/engine/HorseHoldemTournamentRaiseDefenceWiring.ts':
      "the wiring of the default-off hold'em tournament raise defence into the reference end and the Phase 7 / Phase 8 refusal; off returns the decision unchanged",
    'src/engine/HorseHoldemPreflopClassEquity.data.ts':
      "the generated 169 x 169 preflop class equity table the default-off hold'em tournament raise defence reads (server/scripts/holdem-preflop-class-equity-gen.ts)",
    'src/engine/HorseHoldemTournamentRaiseDefenceAnchored.ts':
      "the default-off hold'em tournament raise defence v2 (2026-11-24): the solved equilibrium mix of the class, tilted by the opponent's own record, the measured population fold and the pay-jump factor, one seeded draw from the public spot and the Horse's cards; off it is never called",
    'src/engine/HorseHoldemTournamentRaiseDefenceSolved.ts':
      "the reader of the solved raise-defence tables (default-off hold'em tournament raise defence, and the all-in call price's jam range while one of those options is on); off it is never called",
    'src/engine/HorseHoldemTournamentRaiseDefenceSolved.data.ts':
      "the generated chip-EV equilibrium tables of the open / defend / re-raise game (server/scripts/holdem-tournament-raise-defence-solve/solve.py) the default-off hold'em tournament raise defence reads",
    'src/engine/HorseHoldemTournamentRaiseDefencePriors.data.ts':
      "the fitted population priors the default-off hold'em tournament raise defence reads (server/scripts/holdem-tournament-raise-defence-fit.ts)",
    'src/engine/HorseTournamentCrumbsCallFloor.ts':
      'the Omaha tournament crumbs call floor (HORSE DECISIONS lane 2026-11-19, plain bug fix): a preflop fold with the call all in and 2 bb or less behind, at a price no worse than min(0.34, 1/(opponents+1)), becomes the call',
    'src/engine/equity/SeededRandom.ts':
      'the seeded random stream the default-off priced options sample with (HORSE DECISIONS lane 2026-11-19): a deterministic generator seeded from the public spot and the cards, never the shared generator',
    'src/engine/HorseOmahaFlopBetMeasuredFoldShare.ts':
      'the default-off Omaha flop bet measured fold share (WooWoo audit FOLD-SHARE 2026-11-18, omahaFlopBetUsesMeasuredFoldShare): PLO4/PLO5 cash, flop, heads-up against a person, nothing to call: each v38 EV engine bet size is priced with his fold share from the fitted person model (OMAHA_FLOP_BET_PERSON_FOLD_FIT: size, pot type, SPR band, variant, position) shifted by his durable fold-to-bet read shrunk toward the person population, in place of mdfFold x foldMul; receipts omaha_flop_bet_measured_fold_share_*',
    'src/engine/HorseOmahaFlopBetRaiseBranch.ts':
      'the default-off Omaha flop bet raise branch (WooWoo audit FLOPBET-RAISE 2026-11-18, omahaFlopBetPricesTheRaise): PLO4/PLO5 cash, flop, heads-up against a person, nothing to call: each v38 EV engine bet size is priced with his raise as a third branch, his measured raising share (the one owner OMAHA_PRICED_SITES_FLOP_RAISE_SHARE), the Horse equity against the strongest share of his holdings from the flop facing-bet sampler (a seed taken from the cards, never the brain random stream) and the Horse priced call-off or fold (omahaPricedSitesFlopRaiseAnswer); receipts omaha_flop_bet_raise_branch_*',
    'src/engine/HorseOmahaNoCategoricalRules.ts':
      'the default-off scope and option list of omahaNoCategoricalRules (lane UNBLOCK, 2026-11-19): reached only from HorseLogic.decide behind opts.omahaNoCategoricalRules === true in PLO4/PLO5 cash; with it unset or false the options are the ones given (HorseOmahaNoCategoricalRules.law.test.ts), so no reference decision depends on it',
    'src/engine/HorseOmahaBlanketRowsOffInPlo45Cash.ts':
      'the declared blanket rows off in PLO4/PLO5 cash (EMERG lane BLANKET-AUDIT 2026-11-21, omahaBlanketRowsOffInPlo45Cash, default OFF): reached from HorseLogic.decide and prepareOriginalReads only when the switch is on; with a declared list (engine runtime settings horse.blanketRowOffInPlo45Cash.<option>, absent at the compiled defaults) each listed registry member is passed false in a PLO4/PLO5 cash decision; it decides no action itself; pure',
    'src/engine/HorseOmahaOptionGameScope.ts':
      'the game scope of the omaha* options (EMERG lane PLO4-FIX 2026-11-20): reached from HorseLogic.decide and prepareOriginalReads only when opts.omahaOptionGameScope is given (engine runtime settings horse.omahaGameScope.<option>, absent at the compiled defaults); in a PLO4/PLO5 cash decision a listed option scoped to the other game is passed false; with no scope, and in PLO6 and every other game, the options are the ones given (HorseOmahaOptionGameScope.law.test.ts)',
    'src/engine/HorseVpipFloorTenHandWindowGames.ts':
      'the games vpipFloorLimpOnlyTenHandWindow may act in (lead-8 lane tenhand 2026-11-27): the one read site of that switch, reached from HorseLogic.vpipFloorLimpOnlyApplies / vpipFloorLimpOnlyGovernsTenHandTable; with no game list (engine runtime settings horse.vpipFloorTenHandWindowGame.<variant> all 0, the compiled default) it is exactly opts.vpipFloorLimpOnlyTenHandWindow === true as before; with a list the switch reads as off at a table whose variant is not listed (aVpipFloorTenHandWindowIsScopedByGame.law.test.ts)',
    'src/engine/HorseOmahaColdCallMeasured.ts':
      "the default-off Omaha measured cold call (EMERG lane PREFLOP-AUDIT 2026-11-20, omahaColdCallOutsideBigBlindIsMeasured): on a PLO4/PLO5 cash table preflop, the spot (exactly one raise, less than a big blind in, no voluntary action yet), the class of the own hole cards and the measured value table that turn a final cold call into a fold; reads the request only, no opponent memory and never the brain's random stream",
    'src/engine/HorseOmahaLimpReraise.ts':
      "the default-off strong limp and limp re-raise (owner order 2026-11-27 12:48, lead-8 lane limprr, omahaLimpReraiseVsIsoRaiser): reached from HorseLogic.decide's reference preflop branch only when the switch is on; on a PLO4/PLO5 cash table it reads the request, the deciding Horse's own cards and the raiser's public exploit counters (HorseMind.currentExploitCounters) and prices the limp or the pot re-raise on the sibling re-raised-pot equity sampler; it never consumes the brain's random stream (its mix is a deterministic draw on the own cards, seat and dealer)",
    'src/engine/HorseOmahaReraiseMeasured.ts':
      "the default-off Omaha measured re-raises (EMERG lane PREFLOP-2 2026-11-20, omahaAcesReraiseIsMeasured and omahaReraiseRangeIsMeasured): in PLO4/PLO5 cash preflop, the spot (the raises faced, the live opponents, the own stack in big blinds, the seat against the last raiser), the class of the own hole cards and the measured cells that turn a final call (or a fold of aces) into the pot-size re-raise; reads the request only, no opponent memory and never the brain's random stream",
    'src/engine/HorseOmahaRundownReraiseMeasured.ts':
      "the default-off Omaha rundown re-raise range (EMERG lane RUNDOWNS 2026-11-20, omahaRundownReraiseRangeIsMeasured and omahaRundownReraiseRangeTrial): in PLO4/PLO5 cash preflop, the structure of a rundown from the own hole cards, the spot (the raises faced, who called, the seat against the last raiser, the own stack in big blinds) and the cells that turn a final re-raise into the call (measured) or a final call into the pot-size re-raise (trial); reads the request only, no opponent memory and never the brain's random stream; the response validator re-runs the measured cell on the request",
    'src/engine/HorseOmahaOpenMeasured.ts':
      "the default-off Omaha measured open (EMERG lane PREFLOP-AUDIT 2026-11-20, omahaOpenNeedsMeasuredStrength): in PLO4/PLO5 cash preflop, the spot (nobody in the pot, three or more dealt in, not the button), the two-card strength of the own hole cards (omahaMathCore preflopStrength) and the measured cut that turn a final first-in raise into a fold; reads the request only, no opponent memory and never the brain's random stream",
    'src/engine/HorseOmahaFacingBetEquity.ts':
      "the default-off Omaha facing-bet equity price (EMERG lane FACING 2026-11-19, omahaFacingBetIsPricedByEquity): in PLO4/PLO5 cash postflop facing a person's wager, the spot, the card-seeded Monte Carlo showdown share (never the brain's random stream), the street calibration measured against persons' real cards, the measured realization and the fold-to-call verdict; the outermost answer of the wager_rules node",
    'src/engine/omahaMathCore/OmahaMathCore.ts':
      'the default-off math-first PLO4/PLO5 cash core (lane MATHCORE 2026-11-19, omahaMathCore): the expected value of every legal action from the cards, the board, the chips and public ranges and response frequencies; the largest is the decision',
    'src/engine/omahaMathCore/OmahaMathCoreRule.ts':
      'the wiring of the default-off math core (omahaMathCore): its scope, the state read from the request only, legality through the legalizer, the error fallback to the incoming decision',
    'src/engine/omahaMathCore/OmahaMathCoreEquity.ts':
      'the math core pools of concrete holdings (card removal, strength by equity against the pool) and the equity of the hero against weighted ranges, to the river',
    'src/engine/omahaMathCore/OmahaMathCoreEval.ts':
      'the math core exact Omaha high evaluator (two hole plus three board) on integer cards',
    'src/engine/omahaMathCore/OmahaMathCoreTables.ts':
      'the math core public tables (provenance public_actions / showdown_only), every player pooled (lane CORE-POOLED, identity-free): response frequencies to wagers, wager frequencies, shown non-value shares, preflop action frequencies, fold facing a raise',
    'src/engine/omahaMathCore/MeasuredRanges.ts':
      'lane RANGES table lookups (back-off by key) used by the math core on its pooled public sections; no person/Horse field, no per-user row',
    'src/config/tableSeating.ts':
      'the seat count per variant read by the Omaha variant pack that lane EQUITY equityVsRanges scores with (reached from the math core through OmahaVariantSampler)',
    'src/engine/omaha/OmahaVariantSampler.ts':
      'the integer Omaha scoring (omahaSamplerScoring) lane EQUITY equityVsRanges ranks hands with, for the math core',
    'src/engine/omaha/OmahaVariantEquity.ts':
      'imported by the Omaha sampler whose integer scoring the math core equity uses (no decision of its own there)',
    'src/engine/multiway/DealtSeatCensus.ts':
      'imported by the Omaha sampler whose integer scoring the math core equity uses (dealt-seat census)',
    'src/engine/plo4/Plo4PolicyPack.ts':
      'imported through the Omaha variant pack reached from the sampler scoring the math core equity uses',
    'src/engine/omahaMathCore/OmahaMathCoreWire.ts':
      'the math core component wiring (lane COREWIRE 2026-11-19): adapters from the core state to the delivered components (responses, bet rates, tracked ranges, postflop value plan, public action line)',
    'src/engine/omahaMathCore/OmahaMathCorePlaybookTexture.ts':
      'lane PLAYBOOK board-texture fold cells (provenance public_actions) applied to the math core population cell',
    'src/engine/omahaMathCore/playbookTexture.v2-pooled.json':
      'lane PLAYBOOK board-texture fold table (provenance public_actions), every responder pooled (lane CORE-POOLED)',
    'src/engine/omahaMathCore/OmahaMathCorePlaybookBlockers.ts':
      'lane PLAYBOOK blocker-conditioned fold share by exact card removal (the hero cards and the board only)',
    'src/engine/omahaMathCore/OmahaMathCoreRangeTrack.ts':
      'lane RANGEADV range tracking over the public action line (Bayes on measured public node frequencies)',
    'src/engine/omahaMathCore/OmahaMathCoreTrapRate.ts':
      'lane CORE-POOLED-8 measured PLO4/PLO5 trap rates (showdown_only, pooled, shrunk n/(n+30)) used by OmahaMathCoreRangeTrack so a check keeps the measured share of strong holdings; core default off',
    'src/engine/omahaMathCore/OmahaMathCoreCheckRaise.ts':
      'lane CORE-POOLED-9 measured PLO4/PLO5 flop check-raise cell (public actions + showdown_only non-value share, pooled, shrunk n/(n+30) to generic cell) used by OmahaMathCoreRangeTrack; core default off',
    'src/engine/omahaMathCore/OmahaMathCorePreflop.ts':
      'lane PREFLOP-EV preflop strength order, public-frequency bands and size-aware fold / re-raise for the math core',
    'src/engine/omahaMathCore/preflopTables.v2-pooled.json':
      'lane PREFLOP-EV public preflop action frequencies (no hole cards), every player pooled (lane CORE-POOLED)',
    'src/engine/omahaMathCore/preflopRealization.v2-pooled.json':
      'lane PREFLOP-EV preflop realization table: imported, not read by the core until the lead admits its provenance (PREFLOP_REALIZATION_ADMITTED)',
    'src/engine/omahaMathCore/preflopStrength.v1.json':
      'lane PREFLOP-EV two-card additive equity model (computed from random holdings only)',
    'src/engine/omahaMathCore/OmahaMathCoreValue.ts':
      'lane VALUE postflop plan: check node, raised branch, multi-street continuation and the size menu, priced by the math core',
    'src/engine/omahaMathCore/OmahaMathCoreUntrackedCheck.ts':
      'lane CORE-FIX-1 checked range of the untracked fallback: the pooled public bet rate b, and the typed seam for the measured trap rate (null until the trap-rate repair sets it)',
    'src/engine/omahaMathCore/OmahaMathCoreNutsFloor.ts':
      'lane CORE-POOLED-2 current-nuts call floor of the math core: exact enumeration of whether any two unseen cards beat the own hand on this board (own cards and board only); facing a flop/turn wager with a call available, the fold is not a candidate',
    'src/engine/omahaMathCore/OmahaMathCoreBluff.ts':
      'lane XR-BLUFF check-raise and bluff context (blockers by card removal; no per-opponent term)',
    'src/engine/omahaMathCore/MultiwayTerms.ts':
      'lane HVH-MULTI multiway terms: correlated all-fold continuation outcomes and calls with players behind',
    'src/engine/omahaMathCore/OmahaDraws.ts':
      'lane DRAWS exact draw profile and measured later-street term, on the math core one-step fallback path only',
    'src/engine/omahaMathCore/publicTables.v4-pooled.json':
      'the math core public tables (provenance public_actions / showdown_only), every player pooled (lane CORE-POOLED): response frequencies to wagers, wager frequencies, shown non-value shares, preflop action frequencies, fold facing a raise; no person/Horse field, no per-user rows',
    'src/engine/omahaMathCore/OmahaMathCoreAcceptance.ts':
      'COREGUARD: the acceptance law of an omahaMathCore decision (exact legalize, the core run standalone from the decide catch); nothing between the core and the table alters its choice',
    'src/engine/opponentHud/OmahaMathCoreHudRecords.ts':
      'lane CORE-EXTEND-5 seat-only opponent-record adapter over the decision HUD packet (hudCbetRaiseRecord for PLO4 flop continuation bets); read only while a default-off math core street flag is on',
    'src/engine/omahaMathCore/OmahaMathCoreTurnRiver.ts':
      'lane core-repair B3 opponent-lifetime-backed PLO5 turn/river facing-bet pricing (cumulative fw1 tail mass, barrel sharpening, station/nit guard, capped turn continuation, river K_allin=25); default OFF behind omahaMathCorePlo5Turn / omahaMathCorePlo5River',
    'src/engine/opponentHud/OmahaMathCoreTurnRiverHud.ts':
      'lane core-repair B3 seat-only HUD adapter over OpponentHudPacket (hudFirstWagerSizeCounts + hudBarrelRecord) for PLO5 turn/river math core; read only while a default-off math core turn/river flag is on',
    'src/engine/omaha/OmahaRangeEquity.ts':
      'lane EQUITY equityVsRanges: hero equity against weighted ranges per opponent with exact joint draws, run to the river (used by the math core)',
    'src/engine/HorseOmahaBetRead.ts':
      "the default-off per-opponent bet read (EMERG lane CR2 2026-11-20, omahaBetReadIsPerOpponent): each opponent's first bets by street, size bucket and barrel with the share of the shown ones that were value on the board of the bet (showdown reveals only), the leave-one-out persons' cells, and the one rule that turns them into his non-value share (the population prior exactly below 4 shown bets); read only behind opts.omahaBetReadIsPerOpponent === true on a heads-up PLO4/PLO5 cash river or later turn barrel, so no reference decision depends on it",
    'src/engine/HorseOmahaFlopFacingBetEvRule.ts':
      'the rule that applies the default-off Omaha flop facing-bet verdict (omahaFlopFacingBetEv): a flop fold or call in the covered spot becomes the verdict, a raise is left alone, the bare-overpair continuation keeps its own verdict; receipts omaha_flop_facing_bet_ev_call / _fold / _changed',
    'src/engine/HorseOmahaReadByStreet.ts':
      "the default-off Omaha read by street and flop texture (PLO Strategy lane 2026-11-18, omahaReadIsByStreetAndTexture): the per-decision mode, the street cells the priced comparisons read, the value-leader label as a continuous per-street quantity and the bettor's street bet rate, each blended with the pooled figure by the cell's own opportunities",
    'src/engine/HorseOmahaReadByStreetMode.ts':
      'the per-decision mode of the default-off Omaha read by street (omahaReadIsByStreetAndTexture): the street, the flop texture and the two read functions the installer puts in place for one decision; the only part HorseMind imports',
    'src/engine/HorseOmahaReadByStreetRule.ts':
      'the installer of the default-off Omaha read by street (omahaReadIsByStreetAndTexture): for one PLO4/PLO5 cash postflop decision the per-street read mode and the priced street cells, both put back when the decision returns; receipt omaha_read_by_street_carried',
    'src/engine/HorseOmahaSmallBet.ts':
      'the default-off Omaha small-bet pricing (PLO Strategy lane 2026-11-18, omahaSmallBetIsPriced): reached only from HorseLogic omahaOwnBetRules when the option is on; with it unset or false no decision reads it (HorseOmahaSmallBet.test.ts)',
    'src/engine/HorseOmahaSmallBetConstants.ts':
      'the measured response by pot share of the default-off Omaha small-bet pricing (omahaSmallBetIsPriced); read only by HorseOmahaSmallBet.ts',
    'src/engine/HorseOmahaTurnRiverRaiseNeedsNuts.ts':
      'the default-off Omaha turn and river raise rule (owner 2026-11-15 12:52 / 12:53, hand 59534208, omahaTurnRiverRaiseNeedsNuts): in PLO4/PLO5 cash facing a bet or a raise on the turn or the river, a raise stands only with a nut-class hand (on the turn also an in-position combo draw the 12:30 rule permits); every other raise becomes the exact-hand facing-bet EV call or fold, the outermost conversion on that path',
    'src/engine/HorseOmahaStreetPlan.ts':
      'the default-off Omaha street plan (owner 2026-11-15 11:43, omahaStreetPlan), first layer: a heads-up PLO4/PLO5 cash turn bet is priced against the check as a whole line with the opponent responses and every river card planned, and the river after that bet follows the recomputed plan where the paired-board fold would otherwise fold; with its own default-off options the flop layer (omahaStreetPlanFlop: a heads-up flop bet priced as a two-street line with the turn by card class), the turn three-way (omahaStreetPlanThreeWay: two opponents, independent ranges) and the preflop stack-to-pot plan (omahaPreflopStackPlan: a low-ratio call priced as the stack it commits, call to fold only)',
    'src/engine/HorseOmahaRiverTables.ts':
      'the shared turn river tables (2026-11-16, wave two; no decision changes): one exact count per decision of every unseen pair on the turn board and on every river card, the engine evaluator values bit for bit, read by omahaCardImpact, the street plan turn layer, its river verdict and its three-way turn, and the facing-bet EV; cleared at the start and the end of every decision',
    'src/engine/HorseOmahaMultiwayDiscipline.ts':
      'the default-off Omaha multiway and bluff discipline (2026-11-16; omahaMultiwayRiverCallNeedsStrength, omahaNoRiverBluffIntoValueLeader, omahaMultiwayWeakHandNoBet): in PLO4/PLO5 cash a multiway river call or raise without a nut-class hand is the exact-hand facing-bet EV times the chance of beating every other continuing range (independent ranges), never a raise; a river bet below the showdown-value line into a measured value leader who showed strength, and a multiway turn or river bet with one pair or less and no nut-class or combo draw, become checks unless the bet-versus-check EV (exact counts, measured fold rates or the population prior) says bet; owner-ruled',
    'src/engine/horsePublicBetSize.ts':
      'the default-off public-only bet size (PLO Strategy lane 2026-11-16, omahaBetSizeByPublicState): in PLO4/PLO5 cash the size of an own postflop bet or raise is produced from the street, board class, pot, chips, legal bounds, opponents, position, the heads-up opponent measured fold-to-bet read and its own random stream, never from the private hand; the last step of the wager_rules node',
    'src/engine/horsePublicActionTime.ts':
      'the default-off public-only action time (owner 2026-11-15 12:16, horseActionTimeIsPublicOnly): the think time of every game is produced from the street, board, pot, price, stacks, players in, the action and amount shown, the seat tempo and its own random stream, never from the private hand',
    'src/engine/HorseOmahaStrategyGame.ts':
      "the game scope of the 2026-11-15 Omaha strategy options (one gate, omahaStrategyGameInScope: PLO4/PLO5 as before, PLO6 only with the PLO6 lane's omahaStrategyInPlo6) and their hand-size dependent constants (omahaStrategyConstant: PLO4/PLO5 the modules' own values, PLO6 from the PLO6 lane's registered calibration)",
    'src/engine/HorseOmahaTournamentScope.ts':
      'the default-off Omaha tournament scope (owner 2026-11-15 13:16, omahaStrategyInTournaments): where the cash-scoped PLO4/PLO5 rules of 2026-11-15 also run in a tournament hand (high only, one board, not All-In-Or-Fold, not Lightning, deeper than the 14 big blind push/fold line), and the tournament survival premium (icmRisk x sqrt(stack share)) a chip-adding conversion adds to its price',
    'src/engine/HorsePlayStyle.ts':
      "the default-off Horse playing styles (owner 2026-11-15 16:40 / 16:42, horsePlayStyles), shared by every game: which of tight, current and pressure a Horse plays for life (a hash of its id, or the authored persona.playStyle) and the table rule that sends a style to current (tournaments, Lightning, 50 bb or less, unmapped games, a VPIP floor above the tight style's expected VPIP)",
    'src/engine/HorseOmahaPlayStyle.ts':
      'the default-off Omaha mapping of the Horse playing styles (owner 2026-11-15 16:40 / 16:42, horsePlayStyles): the bounded scales (0.75 to 1.25) on the preflop bars, the bluff volume and the aggression, and the existing archetype band the persona gears are read from, for the tight style and for the pressure style in position in PLO4/PLO5 cash',
    'src/engine/HorseOmahaBigDrawAggression.ts':
      'the default-off Omaha big-draw aggression (owner 2026-11-15 11:55): on a PLO4/PLO5 cash flop or turn a check or call with a declared big draw becomes a pot-sized bet or raise only when its expected value (measured fold equity, equity against the continuing range) is above the passive line; the outermost wager rule',
    'src/engine/HorseOmahaMadeHandDefense.ts':
      'the final Omaha made-hand rules (Dan 2026-11-14, hands 59414191 and 59416584): a hand a possible straight or flush beats does not raise a turn wager or bet into the fresh card out of position, and a nut-class wager is the full pot, right after the river nut-raise rule',
    'src/engine/HorseOmahaOnePair.ts':
      'the default-off Omaha one-pair rules (Dan 2026-11-14, hands 59407629, 59430325, 59431232, 59417700, 59426444) on the final answer of the wager rules: no one-pair river value wager, no beaten river call of a 0.66-pot wager, no one-pair flop or turn stack-off',
    'src/engine/HorseTightPlayerExploit.ts':
      "the default-off responses to a credibly tight player (styleTightPlayerExploit, 2026-11-15): the checked-to bluff scale on the turn and river and the tight-limper isolation widening in no-limit hold'em",
    'src/engine/HorseOmahaReraisedRaisePriced.ts':
      'the default-off priced call-or-raise facing a re-raise (omahaReraisedCallVsRaisePriced, 2026-11-18): EV(call) by the calling rule priced call against EV(raise) from the re-raiser own answers to a raise of his re-raise, his calling and re-raising bands on one set of samples and the realization at the stack-to-pot ratio left; raises only above twice the sampling error',
    'src/engine/HorseOmahaReraiseResponse.ts':
      "how a re-raiser answers a raise of his own re-raise (2026-11-18): the two nodes of the opponent's durable record, its validation and wire row, and the posterior the default-off option omahaReraisedCallVsRaisePriced prices a raise with",
    'src/engine/HorseOpenerAnswersThreeBet.ts':
      "how an opener answers a 3-bet of his own open (2026-11-24): the in-position and out-of-position cells of the opponent's durable record, its validation and wire row, and the anchored 4-bet read default-off options scale the planned-fold guard with",
    'src/engine/HorseOmahaFlopShown.ts':
      "what a flop bet showed and what calling it returned (2026-11-19): the class of a shown hand on a flop, the cells of the opponent's durable flop-shown record, its validation and wire row, and the readers HorseMind.omahaFlopShownOf serves; carried into Omaha decisions and read by none",
    'src/engine/HorsePlo45High.ts':
      'the PLO4/PLO5 high-only scope test (2026-11-19) the shared-code fixes of the emergency batch read: the band fallback unit in simulateEquity, the V15 cap priced once, the V21 effective depth and the raise-needs-nuts failure call',
    'src/engine/HorseOmahaBigBetSizeIsPriced.ts':
      'continuous pot-share and lifetime public HUD aggressor strength plus EV-priced limped-pot bet sizing replacing #18 omahaBigBetIsPotShare (default OFF; PLO-OWNER lead-4 2026-11-21)',
    'src/engine/HorseOmahaStreetReadPrice.ts':
      'the price behind a fold-to-raise cell (2026-11-19): per street, the sum of the prices of the raises an opponent faced after betting or raising and how many had one, its validation and wire row, and the mean HorseMind.omahaFoldToRaisePriceOf answers; carried into Omaha decisions and read only as the price of the street fold-to-raise cell with the default-off omahaReadIsByStreetAndTexture and omahaSampledRaiseIsPricedAtEverySize both on',
    'src/engine/HorseOmahaStreetRead.ts':
      "the postflop read by street and flop texture (2026-11-17): the cells of the opponent's durable street record, its validation and wire row, and the per-street label HorseMind.omahaStreetReadOf answers; carried into Omaha decisions and read by none yet",
    'src/engine/HorseLongShownMemory.ts':
      "the default-off durable shown river record (styleLongShownMemory, 2026-11-15): which river size bucket the style read takes from the opponent's record instead of the 72-hour window",
    'src/engine/HorseHeadsUpPostflopBalance.ts':
      'the default-off heads-up hold’em postflop balance (holdemHeadsUpPostflopBalance, HV31 FLOP-5): the in-position flop continuation-bet mix, bounded flop check-raise defence and checked-to turn bet mix; river decisions remain unchanged',
    'src/engine/HorseHoldemPersonaPostflop.ts':
      "the default-off persona postflop scales (holdemPersonaPostflop, 2026-11-15): the persona's check-trap threshold and the archetype's turn-takeaway and range continuation-bet multipliers in no-limit hold'em",
    'src/engine/HorseHoldemPersonaPostflopIsPriced.ts':
      'the default-off priced persona postflop spots (holdemPersonaPostflopIsPriced, Horse Switch lane 2026-11-21): the empirical-prior spot adjustment and EV take rule for the flop range c-bet, turn takeaway, OOP flop check-trap and flop check-raise into a stabber; off is never entered',
    'src/engine/HorseHoldemV66RaisedOnePairIsPriced.ts':
      "the dark default-off priced replacement for V66 (v66BetRaisedOnePairIsPriced, Horse Switch lane 2026-11-21): prices flop/turn bet-then-raised one-pair and bluff-catch hands in single-board 2-card NLH by EV(call) vs EV(fold) = 0 from pot odds, SPR/street/position/scare-texture realization, and combo-level Monte-Carlo equity against the raiser's narrowed line range; off is never entered",
    'src/engine/holdemEmpiricalPriors.ts':
      "measured NLH empirical pool priors and smooth Empirical-Bayes shrinkage helpers (Horse Switch lane 2026-11-21): fold-to-river-bet and fold-to-river-raise priors, true villain incremental raise call price, measured all-callers river bluff share, and flop/turn fold priors; reached only by default-off priced Hold'em options (off is never entered)",
    'src/engine/HorseHoldemTournamentAggressionPriced.ts':
      'the dark default-off EV & ICM priced postflop single-board 2-card NLH tournament replacement for v57TournamentAggression (holdemTournamentAggressionIsPriced, Horse Switch lane 2026-11-22): replaces planBarrel 0.50 coin-flip, v58_low_spr_stack_off blanket shove, V7/V57 turn/river barrel continuation coin-flips + initiativeTurn57 blind skip, and v58_one_card_low_flush_fold unconditional fold with deterministic EV + ICM pricing backed by holdemEmpiricalPriors.ts; preflop, v58MadeHandCellSkip, cash, Lightning, Omaha, Short Deck, Fixed Limit, and multi-board are untouched; off is never entered',
    'src/engine/HorseV78CommittingBluffRaisePriced.ts':
      "the default-off, OPTION_SWITCH_REFUSED priced replacement for the blanket V78 40%-of-stack bluff-raise veto (Hold'em Strategy / HORSE DECISIONS 2026-11-22, v78NoCommittingBluffRaiseIsPriced): deterministic public-info EV pricing over holdemEmpiricalPriors (measured NLH street fold-to-raise priors + Bayes raise-continuing equity conditioning + priceHoldemRaiseEv) and heroBubbleFactor in single-board 2-card NLH; off / unset / false never enters and is byte-identical",
    'src/engine/HorseV67RiverBetRaisedOnePairPriced.ts':
      'the dark default-off priced replacement for v67RiverBetRaisedOnePair on single-board 2-card NLH rivers (v67RiverBetRaisedOnePairIsPriced, Horse Switch lane 2026-11-22): replaces all three V67 blanket sites (river raise stratum, block-bet raised blanket fold, and v67Class/shade67 committed & V38 river overrides) with deterministic EV pricing over raise size, board danger, card-removal blockers, opponent river-raise bluffing profile, pot odds, and ICM risk backed by holdemEmpiricalPriors.ts; off is never entered',
    'src/engine/HorseMultiBoardFreerollPriced.ts':
      'dark default-off priced replacement for unowned V36 multi-board freeroll bet and raise coin flips (HORSE DECISIONS lane 2026-11-22, multiBoardFreerollIsPriced): deterministic zero-RNG EV pricing over legal bet/raise sizes respecting Pot-Limit caps, lockShare-preserving calling-range equity, shrunk fold/stab priors, free-card erosion, and heroBubbleFactor; reached only behind opts.multiBoardFreerollIsPriced === true on multiBoard36 hands (off and single-board hands never enter)',
    'src/engine/HorseMultiBoardNonFreerollPriced.ts':
      'dark default-off priced replacement for unowned V86 multi-board non-freeroll dead-half fold and strong-board bet/raise branches (HORSE DECISIONS lane 2026-11-22, multiBoardNonFreerollIsPriced): deterministic zero-RNG, zero-hash EV pricing over fold/call/raise and open bet/check sizes respecting Pot-Limit caps, continuous non-river dead-board realization penalty (0 on river), shrunk fold/stab priors, free-card erosion, and heroBubbleFactor; reached only behind opts.multiBoardNonFreerollIsPriced === true on multiBoard36 non-freeroll hands (off, single-board, and freeroll hands never enter)',
    'src/engine/HorseMultiBoardBluffTrimPriced.ts':
      'dark default-off priced replacement for unowned V36 multi-board bluff-trim blanket multiplier (HORSE DECISIONS lane 2026-11-22, multiBoardBluffTrimIsPriced): deterministic zero-RNG public-info pricing of multi-board bluffScale multiplier in [0, 1] from shrunk per-opponent fold probability, public board-overlap independence exponent, hero cross-board blockers, street/pot/stack/wetness, and heroBubbleFactor; reached only behind opts.multiBoardBluffTrimIsPriced === true on multiBoard36 hands (off and single-board hands never enter)',
    'src/engine/HorseHoldemV87RiverBlockBetTrapIsPriced.ts':
      "the dark default-off priced replacement for v87RiverBlockBetTrap (v87RiverBlockBetTrapIsPriced, Horse Switch lane 2026-11-22): deterministically compares EV(trap_block_lead) vs EV(normal_value_lead) vs EV(check) on OOP heads-up NLH rivers and EV(trap_reraise) vs EV(call) facing a raise after hero's river block bet using holdemEmpiricalPriors; off is never entered",
    'src/engine/HorseHoldemRiverBluffIsPriced.ts':
      'the dark default-off priced replacement for riverBluffBaseline (holdemRiverBluffIsPriced, Horse Switch lane 2026-11-22): deterministically prices legal candidate river bluff sizes (0.33x, 0.55x, 0.75x, 1.0x, 1.25x pot / stack cap) against EV(check) on unopened / checked-to heads-up single-board 2-card NLH rivers using estimateHoldemRiverFoldToBet and blocker/scare/line conditioning; off is never entered',
    'src/engine/HorseHoldemFlopTurnBluffIsPriced.ts':
      'the dark default-off priced replacement for flopTurnBluffBaseline (holdemFlopTurnBluffIsPriced, Horse Switch lane 2026-11-22): deterministically prices legal candidate flop/turn bluff and semi-bluff bet sizes (0.33x, 0.55x, 0.75x, 1.0x pot / stack cap) against realized EV(check) on unopened / checked-to single-board 2-card NLH flops and turns using empirical NLH flop/turn fold-to-bet curves, multiway discount, selection-bias surplus retention, and draw equity realization; off is never entered',
    'src/engine/HorseHoldemRiverBluffMultiwayIsPriced.ts':
      'the dark default-off priced replacement for riverBluffMultiway (holdemRiverBluffMultiwayIsPriced, Horse Switch lane 2026-11-22): deterministically prices legal candidate multiway NLH river bluff sizes (0.50x, 0.75x, 1.00x, 1.25x pot / stack cap) against EV(check) on unopened / checked-to single-board 2-card NLH multiway rivers (opponents >= 2) using per-opponent empirical river fold-to-bet curves with EB shrinkage, exact multiway compounding pFoldAll = prod_i pFold_i, multiway called-range equity, strict calling-station veto, and ICM-protected risk margins; off is never entered',
    'src/engine/HorseHoldemRiverLeadRangeIsPriced.ts':
      'the dark default-off priced replacement for riverLeadRange (holdemRiverLeadRangeIsPriced, Horse Switch lane 2026-11-22): deterministically prices OOP river lead sizes (0.33x, 0.55x, 0.75x, 1.0x pot, stack-capped) vs EV(check) using measured NLH empirical betWhenCheckedTo, river fold-to-lead, exact call-range equity conditioning, and villain raise risk from holdemEmpiricalPriors; off is never entered',
    'src/engine/HorseSlowplayPriced.ts':
      'the default-off priced monster slowplay replacement for unowned H4 (HORSE DECISIONS lane 2026-11-22, horseSlowplayIsPriced, OPTION_SWITCH_REFUSED): deterministic EV(check) vs EV(bet) comparison on flop/turn monsters using holdemEmpiricalPriors fold/stab shrinkage, continuous free-card equity erosion, and heroBubbleFactor; off/Omaha/FLH never enter',
    'src/engine/HorseShortDeckMultiwayPriced.ts':
      'dark default-off priced replacement for the unowned V17 Short Deck multiway overlay (HORSE DECISIONS lane 2026-11-22, v17ShortDeckIsPriced, OPTION_SWITCH_REFUSED): deterministic zero-RNG shift delta = e - e^rho of the multiway bars from measured 36-card vs 52-card continuation sharpness and each opponent shrunk fold-to-bet record',
    'src/engine/HorsePlayersBehindBluffPriced.ts':
      "dark default-off priced replacement for the unowned V17 players-behind bluff multiplier (HORSE DECISIONS lane 2026-11-22, v17PosIsPriced, OPTION_SWITCH_REFUSED): deterministic zero-RNG field fold-through from measured NLH flop/turn fold rates by seat relation and each opponent's fold-to-bet read, against the bubble-factor break-even",
    'src/engine/HorseHoldemPersonaPreflop.ts':
      "the off-only persona preflop layer (holdemPersonaPreflop, owner preflop range hold): persona 3-bet and squeeze mix, deep cash opening-range offsets and the Nit Hunter loose-opener response in no-limit hold'em",
    'src/engine/HorseHoldemRiverFullHouseValue.ts':
      "the default-off river full-house lead (holdemRiverFullHouseValue, 2026-11-15 audit of 131 river full-house decisions): which boats skip the out-of-position initiative check in no-limit hold'em",
    'src/engine/HorseFixedLimitWagerRead.ts':
      'the default-off fixed-limit structural wager read (SPEC-FL-01..03, 2026-11-14): the river full-bet mark for the range samplers, the hi-lo nut-low river bet and the one-bet value-raise bar',
    'src/engine/HorseOmahaCurrentNuts.ts':
      'the final Omaha flop/turn current-nuts raise (exact public nuts with a redraw or untieable; Dan 2026-11-06), right after the river-nuts raise',
    'src/engine/HorseTournamentShoveDiscipline.ts':
      'the final tournament preflop shove-depth wager rule (no deep open or re-raise shove) after all strategy owners',
    'src/engine/HorseCallDeductions.ts':
      'the projected call award deduction fraction, including capped rake, BBJ fees, side pots and returned unmatched contributions',
    'src/engine/multiway/JointPotDistribution.ts':
      'the settlement contribution and uncalled-return arithmetic used to project a canonical call before pricing deductions',
    'src/domain/diamondCashFeeSnapshot.ts':
      'the hand-frozen Diamond fee schedule used for projected call award deductions',
    'src/domain/diamondCashRakeSchedule.ts':
      'the authoritative whole-Diamond rake arithmetic used for projected call pricing',
    'src/domain/diamondCashJackpotSchedule.ts':
      'the authoritative whole-Diamond jackpot collection used for projected call pricing',
    'src/engine/HorseOmahaTournamentPressure.ts':
      'the default-off Omaha tournament preflop action-risk ICM pricing candidate consumed by reference preflop bars',
    'src/engine/HorsePreflop.ts':
      'every preflop bar of the reference (open, 3-bet, 4-bet, call, isolation, push/fold) and the opponent-exploit preflop read',
    'src/engine/HorseTournamentPreflop.ts':
      'the Phase 6 tournament preflop atlas the bars shift by',
    'src/engine/HorseNlhOpenSize.ts':
      "the no-limit hold'em raise-first-in open size bands and the shared chip grid (Dan 2026-10-31)",
    'src/engine/HorseCashThreeBetSize.ts':
      'the cash NLH card-blind 3-bet and squeeze sizes, position and depth bands, and small-open floors consumed by the reference preflop decision',
    'src/engine/AnteMath.ts': 'the ante orbit cost behind the M-zones',
    'src/engine/OmahaFlushBlocker.ts':
      'physical two-hole three-board nut-flush and straight-flush blockers consumed by the reference decision',
    'src/engine/HorseHoldemPremiumAggression.ts':
      'the NLH premium-aggression and dominated-hand 3-bet fold rules applied to the final decision after every other layer (Dan 2026-10-25)',
    'src/engine/HorsePloPairedBoardFold.ts':
      'the PLO4/PLO5/PLO6 paired-board fold applied to the final decision after every other layer (Dan 2026-10-25)',
    'src/engine/HorseContinuationPlanInvalidation.ts':
      'the Items 21 and 23 multi-street plan contender and stack-exposure fingerprint and its continuation verdict, consulted by the reference barrel plan (activated 2026-11-05)',
    'src/engine/HorseOmahaTournamentFirstIn.ts':
      'the Omaha high tournament short-handed first-in and heads-up big blind reply read on the true Omaha percentile, replacing the preflop engine fold only (Dan 2026-11-12)',
    'src/engine/HorseLightningCheapEntry.ts':
      'the default-off Lightning cheap entry (small-blind completion and over-limp by price, never a raise) the reference preflop decision reads with lightningCheapEntryHoldem or lightningCheapEntryOmaha on; no own-participation input',
    'src/engine/HorseLightningParticipation.ts':
      'the default-off Lightning participation range cells (seat, depth and price) the reference preflop decision reads with lightningParticipationHoldem or lightningParticipationOmaha on; no own-participation input',
    'src/engine/HorseLightningFoldThrough.ts':
      'the default-off Lightning fold-through: the public seats still to act before the Horse and the frame where they fold, which HorseLogic.decide asks a fold on again with lightningEarlyFoldNeedsFoldThrough on',
    'src/engine/HorseOmahaTightOpponent.ts':
      'the pot-limit Omaha high preflop read of a PROVEN tight raiser or folder and the bounded respect and steal bar shifts the reference preflop decision applies with omahaTightOpponent on (owner order 2026-11-13, default off)',
    'src/engine/HorseOmahaBigBetCalls.ts':
      'the V81 PLO4/PLO5 big-bet call fold and the V84 PLO4/PLO5/PLO6 river re-raise call fold in measured losing cells, applied in the final wager rules right after the paired-board fold (Phase 4, 2026-11-02; V84 2026-11-07)',
    'src/engine/HorseShortAllInCallFloor.ts':
      'the tournament short all-in call floor (under 3BB shove, 20BB+ horse calls), the last action rule after every other layer (Dan 2026-10-26)',
    'src/engine/HorseOmahaImpliedDraw.ts':
      'physical Omaha draw eligibility for the implied-equity allowance consumed by reference call pricing',
    'src/engine/HorseHeadsUpCommitment.ts':
      'qualified cash NLH and pot-limit Omaha including PLO8 heads-up matchable physical exposure and bounded canonical commitment intent consumed by reference SPR and retained raise-plan pricing',
    'src/engine/HorseContinuation.ts':
      'premium identities, stack commitments and funded future-street pricing',
    'src/engine/HorseEvEngine.ts': 'the solverless EV engine (bets, calls, river verdict)',
    'src/engine/GtoCharts.ts': 'the open-jam and big-blind-versus-small-blind jam charts',
    'src/engine/GtoPostflop.ts': 'the heads-up NLH postflop solver consult',
    'src/engine/GtoPostflopV31.ts': 'the V31 solver consult',
    'src/engine/GtoV31CellContractV3Serving.ts':
      'the default-OFF cell contract v3 serving switch (FLOP-5 D6): whether a store declaring cell contract v3 is consulted with the v3 context',
    'src/engine/HorseV31CertifiedPolicy.ts':
      'the V31 certified playbook consult (eligibility, lookup, sampling, legalization), moved out of HorseLogic 2026-11-06',
    'src/engine/HorseGtoExecution.ts':
      'the solver execution-match rule and miss helpers the V31 consult decides with',
    'src/engine/GtoPublicHist215BuildReceipt.ts':
      'the immutable all-head Linux execution receipt required before a public215 solver program can answer',
    'src/engine/GtoPublicHist215Features.ts':
      'exact public ROOT range physics and chronological actor-card feature encoding consumed by the V31 model',
    'src/engine/GtoPublicHist215FeatureSchema.ts':
      'the frozen categorical and numeric feature ordering consumed by public215 inference',
    'src/engine/GtoPublicHist215FeatureDescriptor.json':
      'the full immutable public215 feature contract and predecessor graph identity',
    'src/engine/GtoPublicHist215FeatureDescriptorV2.json':
      'the public215 feature contract v2 (R8): the v1 contract with appended public category one-hots',
    'src/engine/GtoPublicHist215Contracts.ts':
      'the public215 feature contract table (v1 215 / v2 246) selected by the dataset feature_contract_version',
    'src/engine/GtoPublicHist215Model.ts':
      'bounded numeric tree inference and whole-variant frequency/value normalization used by public215 decisions',
    'native/public_hist215_wtl.cc':
      'the receiving-platform exact integer ROOT opponent win/tie/loss kernel used by public215 features',
    'scripts/build-public-hist215-native.mjs':
      'the maintained receiving-platform native compilation flags for the public215 decision kernel',
    'src/engine/GtoDecisionContext.ts': 'the solver spot context the consults read',
    'src/engine/GtoFacingDefenseV32.ts': 'the facing-bet defense and realization factors',
    'src/engine/GtoBoardRelativeFeaturesV2.ts': 'the board features the V31 consult keys on',
    'src/engine/GtoBoardRelativeFeaturesV1.ts': 'the board features V2 extends',
    'src/gto/SolverPolicyArtifactLoader.ts':
      'loads the solver chart artifact the charts answer from',
    'src/gto/SolverPolicyContract.ts': 'the solver policy contract the artifact is read through',
    'src/gto/SolverStoreIdentity.ts': 'the solver store identity the charts and consults check',
    'src/engine/HorseTournamentCatastropheGuard.ts':
      'the genuinely qualified Phase 8 catastrophe guard invoked at the tournament continuation graph node; its action predicates alter the baseline consumed by later owners',
    'src/engine/HorseTournamentPostflop.ts':
      'boundary: the Phase 8 tournament continuation owner HorseLogic invokes and legalizes; its continuation models decide only in Phase 8 candidate mode',
    'src/engine/HorseTournamentUtility.ts':
      'boundary: the Phase 7 tournament utility that chooses the final tournament action; its own imports are the settlement and evidence it prices with',
    'src/engine/HorsePhase8Safety.ts': 'whether the live Phase 8 input is admitted at all',
    'src/engine/HorseVariantProfile.ts':
      'the per-variant style overlays and preflop bar shifts every decision starts from',
    'src/engine/HorsePersona.ts': 'the persona solver adherence the consults honour',
    'src/engine/IcmModel.ts': 'the ICM bubble factor the survival premium uses',
    'src/engine/HorseHandClasses.ts': 'the Omaha hand-class bar shifts',
    'src/engine/HorseGtoOpeningRanges.ts':
      "the V70 Hold'em raise-first-in seat orders, open bars and limp floors",
    'src/engine/HorseAnteAwarePushFold.ts':
      "the V71 Hold'em folded-to jam thresholds by players behind, depth and dead ante",
    'src/engine/HorseNashPushFold.data.ts':
      'the V71 chip-EV Nash jam-or-fold table (169 thresholds per seat count and ante level)',
    'src/engine/HorseGtoDefenceRanges.ts':
      "the V72 Hold'em single-open defence by defender and opener seat: continue orders, value bars and bluff mix",
    'src/engine/HorseNashPushFoldV2.ts':
      'the Nash push/fold V2 reader (2026-11-07): the call of a lone open-jam, ten-handed jams and the bubble-factor family, read from the solved table',
    'src/engine/HorseNashPushFoldV2.data.ts':
      'the Nash push/fold V2 table (jam and caller thresholds by players behind, dead ante and bubble factor), generated by server/scripts/nash-push-fold/solve.py --v2',
    'src/engine/HorseHuBbDefence.ts':
      "the default-off heads-up big blind price defence: each Hold'em class's equity against the heads-up open range by width, and the realisation the price is read with",
    'src/engine/HorseHuTightBigBlindSteal.ts':
      'the default-off, off-only heads-up small blind steal against a proven tight big blind (Heads Up D6, huSmallBlindStealsVsTightBigBlind): the tight-folder read from the decayed heads-up counters and the open that replaces a would-be limp or fold',
    'src/engine/HorseFixedLimitPreflop.ts':
      'the default-off fixed-limit priced preflop (W5, 2026-11-15): first-in reference shares by players behind, the blind defence to its price and the steal against read over-folding blinds',
    'src/engine/HorseFixedLimitPreflopTables.ts':
      'the generated strength order and equity table the fixed-limit priced preflop reads (scripts/generate-fixed-limit-preflop-tables.ts, fixed seed)',
    'src/engine/HorseFixedLimitCallPrice.ts':
      'the default-off fixed-limit call price (2026-11-14, Fixed-Limit lane): a fixed-limit call is never a stack commitment; its price is the chips to call plus the expected further wagers of the street while a player left to act can still raise',
    'src/engine/HorseFixedLimitRiverLead.ts':
      'the default-off fixed-limit strong river lead (Fixed-Limit lane W8, 2026-11-15): a first-to-act full house or better that few holdings beat bets one big bet instead of the reference check, with the hi-lo low rule and the aggressive-next-opponent exception',
    'src/engine/HorseHiLoLowHalf.ts':
      'the floor the low half puts under the Omaha pressure cap heads-up on a pot-limit hi-lo river, so a nut low is not folded to one bet (HU-HILO-001, 2026-11-13)',
    'src/engine/HorseFixedLimitStructure.ts':
      'the fixed-limit exclusion from the jam-or-fold gates and the pot-limit tournament commitment zone: a fixed-limit raise is one bet whatever the stack (HU-FL-001, 2026-11-13)',
    'src/engine/HorseGtoVs3BetRanges.ts':
      "the V73 Hold'em opener's answer to one 3-bet: continue orders and widths as a share of the seat's own open",
    'src/engine/pineappleDiscardChoice.ts': 'the Pineapple discard',
    'src/engine/HorseOpponentMemory.ts':
      'durable variant and context keys and validated snapshots used in opponent decisions',
    'src/engine/HorseMindHandIdentity.ts':
      'the original allocated hand coordinate controls which independent public observations a decision may learn',
    'src/engine/HorseDecisionHandBinding.ts':
      'validates original host coordinates and accepted action provenance used by hand-scoped learning',
    'src/engine/HorseObservationWindow.ts':
      'the original public observation time windows that qualify individual read history and cutoff coverage',
    'src/services/horseDecisionJournal/record.ts':
      'the bounded canonical original-request encoding and digest bound into producer-time range consumption evidence',
    'src/engine/horseDecision/protocol.ts':
      'the canonical original-request decision-key projection checked before plan getter evidence can be credited',
    'src/engine/HorseDecisionReadFrame.ts':
      'the bounded original read-frame codec and plan projection used to validate producer-time getter evidence',
    'src/engine/HorsePlanReadReceipt.ts':
      'bounded original plan getter consultations and exact returned values bound to the original request and read frame, without policy replay or causal claims',
    'src/engine/HorseDeepDiveReceipt.ts':
      'bounded producer-time deep-dive rule evaluations and local input changes bound to the original request, read frame and final action; no replay or causal claims',
    'src/engine/HorseRangeConsumptionReceipt.ts':
      'bounded producer-time public range inputs and actual sampler consumption masks bound to the original decision and read frame',
    'src/engine/HorseMind.ts':
      'the individual public opponent, self-image, pair and plan reads consumed by every reference decision',
    'src/engine/HorseRiverPositionRead.ts':
      'the original public-action last-to-act river opportunity, check-back and confidence evidence consumed by conditional river defense',
    'src/engine/HorseRiverCallEvidence.ts':
      'the public river-call category eligibility and confidence boundary used by the reference opponent read',
    'src/engine/HorsePublicMemoryDomain.ts':
      'original public speed and ante domain validation, canonical keys and unknown-domain refusal',
    'src/engine/HorseTournamentContextProvenance.ts':
      'original tournament cache generation, format marker and dealt roster used to admit public reads when payout context is incomplete',
    'src/engine/HorseObserverReadContext.ts':
      'the exact individual, variant, explicit format and dealt-size partition for public observation history',
    'src/engine/horseDecision/ownPublicHistory.ts':
      'the closed individual public-history schema, original availability cutoff, bounded cache and payload acknowledgement',
    'src/engine/horseDecision/ownPublicHistoryBudget.ts':
      'the shared main-isolate byte reservations and heap-headroom admission that determine individual public-history availability',
    'src/engine/horseDecision/observerParticipants.ts':
      'the original validated FAST participant registry and exact same-observer cross-shard completion admission',
    'src/engine/horseDecision/completedHandActions.ts':
      'the canonical public-action projection used by individual historical and live completed-hand learning',
    'src/engine/horseDecision/lane.ts':
      'boundary: actual pool wiring admits original validated observers and propagates public completions only to the same observer; read owners are separately hashed',
    'src/services/HorsePooledPublicBootstrap.ts':
      'boundary: bounded saved-only service bootstrap with closed public profile schema and original resolved availability before worker READY; no turn query or private history',
    'src/services/HorseOwnPublicHistory.ts':
      'boundary: the individual service-only public reader pins its exact native-qualified database definition, context and bounded query; provider transport is not strategy authority',
    'src/engine/horseDecision/savedProfilePresence.ts':
      'the original dealt roster, saved profile validation and decision cutoff governing request-local public counters',
    'src/engine/horseDecision/pooledPublicProfiles.ts':
      'owner-authorized shared public aggregate admission, saved bootstrap, context/version/cutoff and detached read projection consumed by reference decisions',
    'src/engine/horseDecision/observerReads.ts':
      'the individual observation admission, cutoff, completion and read-state ownership used by FAST decisions',
    'src/engine/horseDecision/client.ts':
      'boundary: the original snapshot capture and transport must never import pooled opponent histories; actual individual read owners are separately hashed',
    'src/engine/horseDecision/workerRuntime.ts':
      'boundary: exact worker wiring selects the individual view, freezes DEEP reads and applies plans to the original observer; strategy and read owners are separately hashed',
    'src/engine/HorsePlanHandIdentity.ts':
      'the original observer and hand identity retained through accepted and recovered decision plans',
    'src/engine/HorsePlanEffectReceipt.ts':
      'the accepted-plan reconstruction that refuses unknown observer contexts before restoring individual intent',
    'src/engine/HorseDecisionEffects.ts':
      'the validation and identity of individual accepted intent writes consumed by future decisions',
    'src/engine/HorseWinnerRead.ts':
      'the proven-winner read that tempers the opponent exploit against a player who beats the game',
    'src/engine/HorseOpponentExploit.ts':
      'the opponent-exploit read, its measured envelope and every effect it has on the reference and the packs',
    'src/engine/HorseDeepDiveDiscipline.ts':
      'V87 all-hands deep-dive Omaha preflop selectivity, HU position-stab suppression, PLO6 big-bet fold, Omaha bet-raised sizing, pricedIn trash floor, and NLH turn cold-raise shade',
    'src/engine/BettingStructure.ts':
      'the legal menu and bounds the reference is legalized into (hashed by Phases 11-13; now by Phase 10 too)',
    'src/engine/VariantRules.ts':
      'the card rules the reference reads (hashed by Phases 11-13; now by Phase 10 too)',
    'src/engine/HorseHybridProfile.ts':
      'the unified Hybrid v1 fleet solver adherence and EV-bounded indifference tie-break authority consumed by reference decisions',
    'src/engine/HorsePreflopOrbitState.ts':
      'the preflop orbit raise normalization, hero prior action, straddle/kill option and V38 committed-population guard consumed by reference preflop',
    'src/engine/HorseSideGameOverlay.ts':
      'the Seven-Deuce bounty pot overlay and Kill/Half-Kill blind normalization consumed by reference preflop and postflop EV pricing',
    'src/engine/HorseActionLinePosterior.ts':
      'the public action-line Bayesian range narrowing, polar vs capped read and turn/river raise sizing recognition consumed by reference postflop',
    'src/engine/HorseCardRemovalScorer.ts':
      'the combinatorial nut-blocker fold-equity bonus and missed-draw fold-blocker penalty consumed by reference postflop EV pricing',
  });

export const HORSE_REFERENCE_DECISION_SOURCE_FILES: readonly string[] = Object.freeze(
  Object.keys(HORSE_REFERENCE_DECISION_SOURCE_REASONS)
);

/** Hashed, imports not followed (the reasons above say why). */
export const HORSE_REFERENCE_DECISION_BOUNDARY: readonly string[] = Object.freeze([
  'src/engine/HorseFeatureAuthority.ts',
  'src/services/horseCorrectiveReview/liveKernel.ts',
  'src/engine/HorseTournamentPostflop.ts',
  'src/engine/HorseTournamentUtility.ts',
  'src/engine/horseDecision/workerRuntime.ts',
  'src/engine/horseDecision/client.ts',
  'src/engine/horseDecision/lane.ts',
  'src/services/HorseOwnPublicHistory.ts',
  'src/services/HorsePooledPublicBootstrap.ts',
]);

/**
 * HorseLogic runtime imports, and reference-closure files, that are neither in
 * the list above nor hashed by all four phases, each with the reason it cannot
 * change a reference decision or the digest that already binds it. (A file
 * every phase already hashes needs no entry.)
 */
export const HORSE_REFERENCE_DECISION_EXCLUDED: Readonly<Record<string, string>> = Object.freeze({
  'src/types.ts':
    'shared TypeScript type and interface declarations; contains zero decision constants or policy logic',
  'src/services/errorReporter.ts': 'reports a thrown decision; the safety net, not a decision',
  'src/engine/BrainTelemetry.ts': 'fire counters and latency telemetry; no value a decision reads',
  'src/engine/horseDecisionGravity.ts':
    'shapes think time only (how long to wait), after the action and amount are chosen; never an action or amount',
  'src/engine/HorsePolicyGraph.ts':
    'runs the owners in order and records what each returned; the decision is each step value',
  'src/engine/HorsePhase6Attribution.ts':
    'the Phase 6 preflop attribution receipt, built after the decision from it',
  'src/engine/HorseReviewSignals.ts': 'review signals are observed and explicitly ignored',
  'src/engine/HorsePhaseControllerWithdrawal.ts':
    'reconciles the Phase 10-13 receipts (selection, final action) with the action a later owner already chose; never an action or amount',
  'src/engine/multiway/JointLivePolicy.ts':
    'the Phase 13 owner: bound by the Phase 13 digest; runs after the variant owners and acts only when Phase 13 is selected',
  'src/engine/multiway/JointSampleAcquisition.ts':
    'the Phase 13 joint sample acquisition: bound by the Phase 13 digest; the variant packs refuse multi-board hands',
  'src/engine/multiway/JointActionModel.ts':
    'the Phase 13 response model: bound by the Phase 13 digest',
  'src/engine/omaha/OmahaVariantLivePolicy.ts':
    'the Phase 11 owner: hashed by Phase 11; the registry routes each variant to exactly one owner',
  'src/engine/omaha/OmahaVariantPolicyPack.ts': 'the Phase 11 packs: hashed by Phase 11 (and 13)',
  'src/engine/remainingVariants/RemainingVariantLivePolicy.ts':
    'the Phase 12 owner: hashed by Phases 12 and 13; the registry routes each variant to exactly one owner',
  'src/engine/remainingVariants/RemainingVariantPolicyPack.ts':
    'the Phase 12 packs: hashed by Phases 12 and 13',
});
