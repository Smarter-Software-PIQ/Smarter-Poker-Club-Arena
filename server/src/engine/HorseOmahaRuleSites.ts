/**
 * THE OMAHA RULE SITES: WHICH PLO4/PLO5 CASH RULES DECIDE BY A CATEGORY, AND
 * WHAT PRICES EACH (2026-11-17, PLO Strategy lane).
 *
 * Owner, 2026-11-17 11:49 Chicago: "a blanket rule shouldn't be allowed to
 * effect a decision, they must all be done by math, gto, players hand or
 * preceived range of hands as well as the opponents range of hand, equity, EV
 * etc."
 *
 * This file is the register the law test reads
 * (HorseOmahaNoBlanketRule.law.test.ts). It holds two things:
 *
 *  1. OMAHA_CATEGORICAL_RULE_SITES: every rule site the audit of 2026-11-17
 *     (archive plo-handoff-review-01a1cbbd/rules-audit-01BNteGZ) found
 *     deciding a PLO4/PLO5 cash action by a bet size, a chip count, a stack
 *     share, a hand category, a betting line or an opponent label, with the
 *     receipts that rule fires when it decides and the priced option that
 *     replaces it. The law plays a corpus with every priced option on and
 *     fails when one of those receipts fires: a categorical rule decided.
 *
 *  2. OMAHA_OPTION_CLASSES: every Omaha decision option in the ledger, by what
 *     it is. The law fails when a ledger option is not classified here, so a
 *     new Omaha rule cannot be added without saying whether it prices its
 *     decision. A rule classed 'categorical' must name its priced option; one
 *     classed 'open' is a categorical rule that is NOT yet replaced, listed
 *     so that the list can only shrink on purpose.
 *
 * No decision reads this file.
 */

export type OmahaRuleDecidesBy = 'size' | 'chips' | 'stack_share' | 'category' | 'line' | 'label';

export interface OmahaCategoricalRuleSite {
  /** the audit's row or conflict number */
  audit: string;
  rule: string;
  /** the option(s) that switch the categorical rule on */
  legacyOptions: readonly string[];
  /** where it acts */
  where: string;
  decidesBy: readonly OmahaRuleDecidesBy[];
  /** the priced option that replaces it in PLO4/PLO5 cash */
  pricedBy: string;
  /** receipts (exact keys or prefixes ending in *) the categorical rule fires when it decides */
  legacyReceipts: readonly string[];
  /** legacy receipts that the caller still fires when the PRICED answer is the same one: allowed only
   *  beside one of these priced receipts in the same decision */
  sharedWith?: readonly string[];
  /** the text in HorseLogic.ts (or `file`) that hands the site to the priced rule */
  guard: string;
  file?: string;
}

export const OMAHA_CATEGORICAL_RULE_SITES: readonly OmahaCategoricalRuleSite[] = Object.freeze([
  {
    audit: '7',
    rule: 'turn and river raise needs the nuts',
    legacyOptions: ['omahaTurnRiverRaiseNeedsNuts'],
    where: 'omahaTurnRiverRaiseNeedsNutsRule (outermost on the turn and river facing a wager)',
    decidesBy: ['category'],
    pricedBy: 'omahaTurnRiverRaiseIsPriced',
    legacyReceipts: ['omaha_turn_river_raise_needs_nuts_*'],
    guard: 'omahaPricedTurnRiverRaiseRule(',
  },
  {
    audit: '8',
    rule: 'river raise only with the nuts',
    legacyOptions: ['omahaRiverNutRaiseOnly'],
    where: 'omahaRiverNutRaiseOnly (wager_rules and outside the graph)',
    decidesBy: ['category'],
    pricedBy: 'omahaTurnRiverRaiseIsPriced',
    legacyReceipts: [
      'omaha_river_non_nut_raise_flatted',
      'omaha_river_non_nut_raise_fold_restored',
    ],
    guard: '!omahaPricedOwnsTurnRiverRaise(player, gs, opts)',
  },
  {
    audit: '9',
    rule: 'no draw raise out of position, combo draws only in position',
    legacyOptions: ['omahaNoDrawRaiseOutOfPosition', 'omahaBigDrawAggression'],
    where:
      'omahaNoDrawRaiseFinal, the three draw-raise sites of decidePostflop, omahaBigDrawVerdict',
    decidesBy: ['category', 'line'],
    pricedBy: 'omahaDrawRaiseIsPriced',
    legacyReceipts: [
      'omaha_no_draw_raise_final_call',
      'omaha_no_draw_raise_ft_semibluff',
      'omaha_no_draw_raise_v53_semibluff',
      'omaha_no_draw_raise_v86_pump',
    ],
    guard: 'omahaPricedDrawRaiseRule(',
  },
  {
    audit: '10',
    rule: 'out-of-position turn check after the flop bet was called',
    legacyOptions: ['omahaOopTurnCheckAfterFlopCall'],
    where: 'omahaOopCheckRules (the turn bet becomes a check)',
    decidesBy: ['line', 'category'],
    pricedBy: 'omahaOopTurnBarrelIsPriced',
    legacyReceipts: ['omaha_oop_turn_check_after_flop_call'],
    guard: 'omahaPricedOopTurnBarrelRule(',
  },
  {
    audit: '11',
    rule: 'paired board below a full house against a value leader: no bet',
    legacyOptions: [
      'omahaPairedRiverNoThinLeadVsValueLeader',
      'omahaOverpairNoOopBarrelVsValueLeader',
      'omahaPairedTurnNoBarrelWithoutBoatVsValueLeader',
    ],
    where: 'omahaOopCheckRules, omahaCardImpactRule (press veto)',
    decidesBy: ['label', 'category', 'line'],
    pricedBy: 'omahaPairedBoardBetIsPriced',
    legacyReceipts: [
      'omaha_overpair_oop_turn_barrel_checked',
      'omaha_paired_turn_barrel_checked',
      'omaha_paired_river_thin_lead_checked',
      'omaha_paired_board_no_boat_oop_bet_checked',
      'omaha_card_impact_paired_board_press_withheld',
    ],
    guard: 'omahaPricedPairedBoardBetRule(',
  },
  {
    audit: '12',
    rule: 'paired-board river check after the turn bet was called',
    legacyOptions: ['ploPairedBoardRiverCheck'],
    where: 'pairedBoardRiverCheck; the river nut-blocker bluff bar in decidePostflop',
    decidesBy: ['line', 'category'],
    pricedBy: 'omahaPairedBoardBetIsPriced',
    legacyReceipts: ['plo_paired_board_river_check'],
    guard: 'omahaPricedBlockerBluffAdmits(player, gs, opts)',
  },
  {
    audit: 'C6',
    rule: 'pressure raise and wide call-down withheld from a bettor not labelled a postflop aggressor',
    legacyOptions: ['omahaPressureNeedsPostflopAggression'],
    where: 'omahaPostflopPressureWithheld (decidePostflop V53 pressure; the maniac call-down)',
    decidesBy: ['label'],
    pricedBy: 'omahaPressureIsPriced',
    legacyReceipts: ['omaha_pressure_withheld_value_leader'],
    sharedWith: [
      'omaha_priced_pressure_raise_withheld',
      'omaha_priced_pressure_call_down_withheld',
    ],
    guard: 'omahaPricedPressureWithheld(',
  },
  {
    audit: '3, 4, 5, 6',
    rule: 'V81, V84, bluff-catcher and V86 big-bet call cells',
    legacyOptions: [
      'v81OmahaBigBetCalls',
      'v84OmahaRiverReraiseCalls',
      'v86PloOverhaul',
      'omahaBluffCatcherFoldVsValueLeader',
      'omahaBluffCatcherRaiseFold',
    ],
    where: 'omahaBigBetCallFoldCells',
    decidesBy: ['size', 'chips', 'category', 'label'],
    pricedBy: 'omahaBigBetCallsArePriced',
    legacyReceipts: [
      'v81_*',
      'v84_*',
      'v86_plo_underboat_fold',
      'v86_plo_multiway_dominated_fold',
      'omaha_bluff_catcher_*',
    ],
    guard: 'omahaPricedBigBetCallRule(',
  },
  {
    audit: '13',
    rule: 'underpair folds the flop facing a bet and a call',
    legacyOptions: ['omahaUnderpairNoMultiwayFlopContinue'],
    where: 'omahaUnderpairFlopFold',
    decidesBy: ['category'],
    pricedBy: 'omahaUnderpairMultiwayIsPriced',
    legacyReceipts: ['omaha_underpair_no_multiway_flop_continue'],
    sharedWith: ['omaha_priced_underpair_multiway_folded'],
    guard: 'omahaPricedUnderpairFolds(player, gs, opts)',
  },
  {
    audit: '15, 17, 18, 19',
    rule: 'size steps of the facing-bet range, size-triggered range overrides and realization caps',
    legacyOptions: ['omahaFacingBetEv'],
    where: 'omahaFacingBetEvSpot, omahaFacingBetEvVerdict',
    decidesBy: ['size', 'line'],
    pricedBy: 'omahaFacingBetRangeIsContinuous',
    legacyReceipts: [],
    guard: 'omahaPricedModeNow().rangeContinuous',
    file: 'HorseOmahaFacingBetEv.ts',
  },
  {
    audit: '16',
    rule: 'value-leader bluff cap 0.65 (and the maniac floor) in the facing-bet EV',
    legacyOptions: ['omahaFacingBetEv'],
    where: 'omahaEvBluffShare',
    decidesBy: ['label'],
    pricedBy: 'omahaBluffShareFromBetRate',
    legacyReceipts: [],
    guard: 'omahaPricedModeNow().bluffShareFromBetRate',
    file: 'HorseOmahaFacingBetEv.ts',
  },
  {
    audit: 'S1 (sites-013U37)',
    rule: 'bare big pair out of position on the flop with the lead: the bet becomes a check by hand class',
    legacyOptions: ['omahaBareOverpairOopFlopCheck'],
    where: 'omahaOopCheckRules (flop branch)',
    decidesBy: ['category', 'line'],
    pricedBy: 'omahaFlopBetIsPriced',
    legacyReceipts: ['omaha_bare_overpair_oop_flop_checked'],
    sharedWith: ['omaha_priced_site_flop_bet_unpriced_kept'],
    guard: 'omahaPricedSitesFlopBet(decision, player, gs, opts, flopSpot)',
  },
  {
    audit: 'S3 (sites-013U37)',
    rule: 'made-hand defence, bet half: no bet into the fresh turn card out of position, no thin river value bet',
    legacyOptions: ['omahaMadeHandDefenseVsValueLeader', 'omahaBeatenMadeHandDefense'],
    where: 'omahaMadeHandDefenseRules (omahaBeatenNoBet), omahaWagerIsChecked',
    decidesBy: ['label', 'category'],
    pricedBy: 'omahaMadeHandBetIsPriced',
    legacyReceipts: ['omaha_beaten_fresh_card_check', 'omaha_beaten_river_no_value_bet'],
    guard: 'omahaPricedSitesMadeHandBet(flat.decision, player, gs, opts)',
  },
  {
    audit: 'S5 (sites-013U37)',
    rule: 'turn set pound: the monster size by hand class',
    legacyOptions: ['omahaTurnSetPound'],
    where: 'decidePostflop value sizing (turnSetPound)',
    decidesBy: ['category', 'size'],
    pricedBy: 'omahaTurnSetSizeIsPriced',
    legacyReceipts: ['omaha_turn_set_pound'],
    guard: 'omahaPricedSitesTurnSetSize(poundBet, player, gs, opts)',
  },
  {
    audit: 'S6 (sites-013U37)',
    rule: 'river nut-blocker bluff: an equity line (0.28) and the paired-board bar',
    legacyOptions: ['omahaRiverNutBlockerBluffReachable'],
    where: 'decidePostflop V86 river nut-blocker bluff',
    decidesBy: ['category'],
    pricedBy: 'omahaBlockerBluffIsPriced',
    legacyReceipts: ['v86_river_nut_blocker_bluff'],
    sharedWith: ['omaha_priced_site_blocker_bluff_admitted'],
    guard: 'omahaPricedSitesBlockerBluffAdmits(player, gs, opts, bet86Rb)',
  },
]);

/**
 * A part of a categorical rule whose priced replacement did not pass and that
 * therefore still decides with the priced options on. Each is named with its
 * receipts and the evidence that kept it; the law test pins the list.
 */
export interface OmahaOpenRuleSite {
  /** the audit's row or conflict number */
  audit: string;
  rule: string;
  legacyOptions: readonly string[];
  where: string;
  decidesBy: readonly OmahaRuleDecidesBy[];
  legacyReceipts: readonly string[];
  /** why the priced replacement does not decide yet, and who holds the fix */
  why: string;
}

export const OMAHA_OPEN_RULE_SITES: readonly OmahaOpenRuleSite[] = Object.freeze([
  {
    audit: '10',
    rule: 'out-of-position turn after the flop bet was called, facing a bet: call with nut outs at the price, fold with none',
    legacyOptions: ['omahaOopTurnCheckAfterFlopCall'],
    where: 'omahaOopTurnFacingBetRule, omahaFacingBetEvOf (stands aside for it)',
    decidesBy: ['category', 'line'],
    legacyReceipts: [
      'omaha_oop_turn_check_fold_no_outs',
      'omaha_oop_turn_check_call_nut_draw',
      'omaha_oop_turn_check_raise_flatted',
    ],
    why:
      'its priced replacement is the facing-bet EV verdict, which in the counterfactual replay of the audited ' +
      'PLO5 hands (2026-11-17) folded strong draws and a set class to turn bets at prices their equity beats ' +
      '(4 of 4 judged changes wrong, about -102 bb on the audit judge); the verdict defect is the field ' +
      'factor and turn realization (WooWoo audit RC-02b, held by the PLO Strategy pickup 01BNteGY). The bet ' +
      'half of the rule is priced by omahaOopTurnBarrelIsPriced.',
  },
  {
    audit: 'S1b (sites-013U37)',
    rule: 'bare big pair out of position on the flop, facing the bet after the check (the continuation): call, fold or flat by hand shape at the price',
    legacyOptions: ['omahaBareOverpairOopFlopCheck'],
    where: 'omahaBareOverpairFlopFacingBetRule (omahaOopCheckRules and omahaOwnerRuledFinal)',
    decidesBy: ['category', 'line'],
    legacyReceipts: [
      'omaha_bare_overpair_oop_flop_check_called',
      'omaha_bare_overpair_oop_flop_check_folded',
      'omaha_bare_overpair_oop_flop_check_raise_flatted',
      'omaha_bare_overpair_oop_flop_check_failsafe_flatted',
    ],
    why:
      'a flop call or fold facing a bet belongs to the flop facing-bet expected-value verdict (omahaFlopFacingBetEv, ' +
      'HorseOmahaFlopFacingBetEv.ts, held by the flopev2 build of this lane); the sites build prices only the bet half ' +
      '(omahaFlopBetIsPriced) and does not decide a flop call.',
  },
  {
    audit: 'S6b (sites-013U37, review R3 B1)',
    rule: 'river nut-blocker bluff: whether the bluff is offered at all - the chips-behind bar, the capped-line and station label gates and the persona frequency draw (targetRb86)',
    legacyOptions: ['omahaRiverNutBlockerBluffReachable'],
    where: 'decidePostflop V86 river nut-blocker bluff (before omahaPricedSitesBlockerBluffAdmits)',
    decidesBy: ['label', 'line'],
    legacyReceipts: ['omaha_priced_site_blocker_bluff_gate_withheld'],
    why:
      'omahaBlockerBluffIsPriced prices the exact bet the bluff places beside the check (S6), but the gates that decide ' +
      'whether the bluff is offered are a label read (station, capped line), a stack bar and a frequency draw; pricing ' +
      'them needs a river bluff frequency from his measured fold-to-bet read (owner of the river bluff baseline: PLO ' +
      'Strategy lane, not built). With the option on they still withhold bluffs; each is receipted.',
  },
  {
    audit: '14 (verifier D9, 2026-11-19)',
    rule: "the flop 20 big blind mark: a newest-street wager of 20 big blinds or more counts as a big bet in the range read (OppPostflopRead.bigBet), which tiers the bettor's range and conditions the reference brain's sampling, and so moves its flop fold or call",
    legacyOptions: ['v16SizeCond'],
    where:
      'HorseMind range read (newestStreetBigBet, the "existing 20bb street-total threshold"); read by HorseEval omahaAggressorTier and the V16 size-conditioned sampler in HorseLogic',
    decidesBy: ['size', 'chips'],
    legacyReceipts: ['range_read_big_bet_counted', 'v16_sizecond_bigbet'],
    why:
      'owner: PLO Strategy lane 013U37. On the flop the mark is the reference fold or call input; its priced replacement is the ' +
      'flop facing-bet expected-value verdict (omahaFlopFacingBetEv, default OFF; when on it takes the flop fold or call away ' +
      'from the mark and from ploPairedBoardFold). On the turn and river omahaBigBetIsPotShare reads the pot share instead, ' +
      'which is itself a size line (classed open). The mark has no option of its own: v16SizeCond off strips it with the rest ' +
      'of the V16 sampler.',
  },
]);

export type OmahaOptionClass =
  /** compares priced lines (expected value, equity against a range, or a mixed frequency over them) */
  | 'priced'
  /** decides by a category: replaced, in PLO4/PLO5 cash, by the named priced option */
  | 'categorical'
  /** decides by a category and is NOT yet replaced: the reason says who holds it */
  | 'open'
  /** not a PLO4/PLO5 cash postflop decision rule: preflop, another game or format, a scope gate, a read */
  | 'outside';

export interface OmahaOptionRuling {
  cls: OmahaOptionClass;
  /** categorical: the priced option; open and outside: why */
  note: string;
}
const priced = (note: string): OmahaOptionRuling => ({ cls: 'priced', note });
const categorical = (pricedBy: string): OmahaOptionRuling => ({
  cls: 'categorical',
  note: pricedBy,
});
const open = (note: string): OmahaOptionRuling => ({ cls: 'open', note });
const outside = (note: string): OmahaOptionRuling => ({ cls: 'outside', note });
const PREFLOP =
  'preflop (the priced preflop re-raise defence is a separate build, plo-preflop-01BNteGZ)';

export const OMAHA_OPTION_CLASSES: Readonly<Record<string, OmahaOptionRuling>> = Object.freeze({
  // the priced rules of 2026-11-17
  omahaTurnRiverRaiseIsPriced: priced('fold, call and each raise size on the exact count'),
  omahaPricedRaiseNeverMakesNonNutRaise: priced(
    'a limit on omahaTurnRiverRaiseIsPriced by the owner rulings of 2026-11-15 (12:52 / 12:53: a non-nut hand facing a turn or river bet folds or at best calls; 12:30: a draw raises only in position with a combo draw): the rule returns a raise only for a nut-class hand or the in-position turn combo draw raising, every other raise becomes the priced call or fold it already computed, and a call is never turned into a raise; the nut rule reads the Lightning pools too; switches neither rule on (default OFF; PLO-OWNER lead-5 2026-11-22)'
  ),
  omahaLateFlattenedCallIsPriced: priced(
    'a river raise that call_large_river_boat_wager flattened to a call after the facing-bet EV stage stood aside for the raise is priced by that same exact-hand verdict and folded where the call does not stand; no other call is read (default OFF; PLO-OWNER lead-5 2026-11-22)'
  ),
  omahaDrawRaiseIsPriced: priced('raise beside the call on sampled shares'),
  omahaOopTurnBarrelIsPriced: priced('bet beside the check on the card-impact model'),
  omahaPairedBoardBetIsPriced: priced('bet beside the check on the card-impact model'),
  omahaBluffShareFromBetRate: priced('continuous bluff share from the measured bet rate'),
  omahaFacingBetRangeIsContinuous: priced('continuous size inputs of the facing-bet range'),
  omahaPressureIsPriced: priced('the pressure play by its price'),
  omahaBigBetCallsArePriced: priced('the exact count in place of the big-bet cells'),
  omahaUnderpairMultiwayIsPriced: priced('the multiway flop call on sampled shares'),
  omahaPricedPriorsByOpponentKind: priced(
    "the priors and reference rates every priced comparison reads, by the opponent's measured kind; unpriceable spots keep the decision given, never the categorical rule (an input, not a rule site)"
  ),
  omahaOpponentLifetimeHud: priced(
    'the per-opponent lifetime public HUD provider every priced comparison may read; it decides nothing by itself (an input, not a rule site)'
  ),
  omahaOpponentLifetimeHudDecides: priced(
    'the opponent read takes his counters from the lifetime HUD postflop, the one shrunk n/(n+k) mechanism every priced comparison reads (an input, not a rule site)'
  ),
  omahaPreflopReadIsPricedFromLifetime: priced(
    'retires presumedAggressorRead on 3-6 seat PLO4/PLO5 cash preflop and prices widened maniac-pressure spots on six-max (sh) HUD cells (pf.*, pf.lr, pf.bvo) with n/(n+k) shrinkage'
  ),
  omahaBigBetSizeIsPriced: priced(
    'continuous pot-share + lifetime public HUD aggressor strength and EV-priced limped-pot bet sizing in place of #18 omahaBigBetIsPotShare (default OFF; PLO-OWNER lead-4 2026-11-21)'
  ),
  omahaRaiseEvCountsLossesOnce: priced(
    "the re-raisers' losses counted once in the priced raise value; off-only (an input, not a rule site)"
  ),
  omahaBluffIsPricedAgainstTheTarget: priced(
    'every PLO4/PLO5 cash wager facing no bet heads-up priced beside the check against his measured fold at its price, and the flop call and the flop / turn raise facing a bet priced against a raise to each legal size with the same measured fold (table and Lightning); default OFF'
  ),
  omahaSampledRaiseIsPricedAtEverySize: priced(
    'the sampled raise at every legal size, its fold share and continuing range at the price each raise lays, the raise made at the priced size (an input, not a rule site)'
  ),
  omahaPricedMix: priced('mixing between two close priced actions'),
  omahaPricedInLightning: priced(
    'the priced scope opened to the Lightning pools for the priced options that are on (a scope, not a rule site)'
  ),
  // the priced sites of 2026-11-18 (HorseOmahaPricedSites.ts)
  omahaMadeHandBetIsPriced: priced('the defence wager beside the check on the card-impact model'),
  omahaTurnSetSizeIsPriced: priced(
    'every public-state size and the check on the card-impact model'
  ),
  omahaBlockerBluffIsPriced: priced('the river bluff beside the check on the card-impact model'),
  omahaFlopBetPricesTheRaise: priced(
    'every v38 flop bet size, heads-up against a person facing no bet, is priced with his raise as a third branch (his measured raising share, the Horse equity against it, the Horse priced call-off or fold); default OFF'
  ),
  omahaFlopBetUsesMeasuredFoldShare: priced(
    'every v38 flop bet size, heads-up against a person facing no bet, is priced with his measured fold share (the fitted person model by size, pot type, SPR band, variant and position, shifted by his own shrunk fold read); default OFF'
  ),
  omahaFlopBetIsPriced: priced('the flop bet beside the check on sampled bands of his holdings'),
  omahaFlopBetIsPricedOnHisResponse: priced(
    'R2: the bare big pair flop bet with the lead (HU and multiway, OOP and IP) priced beside the check using lifetime HUD fold, raise-vs-bet and OOP stab rate/size with prove-it-to-bet uncertainty bar, plus lifetime HUD raiser/stabber range scaling in omahaFlopFacingBetEv (default OFF)'
  ),
  omahaCheckedToBetIsPriced: priced(
    'the check priced beside every bet when every opponent has checked the river, the showdown share fitted (default OFF)'
  ),
  omahaCheckedToBetResponseIsMeasured: priced(
    "inside omahaCheckedToBetIsPriced, heads-up on the river: the share of the checker's range that continues against each bet size is the measured answer of his kind moved by his own evidence, in place of the pot odds scaled by his all-street rate; an input, not a rule site (default OFF; EMERG lane OPEN-ITEMS-3 2026-11-20)"
  ),
  omahaCheckedToBetInLightning: priced(
    'a scope option: the game of omahaCheckedToBetIsPriced includes the Lightning pools without omahaPricedInLightning; switches the rule on nowhere by itself (default OFF; EMERG lane OPEN-ITEMS-3 2026-11-20)'
  ),
  omahaFoldModelFittedOnPeople: priced(
    'every v38 flop or turn bet size, heads-up against a person facing no bet, is priced with his fold share from the fold model fitted on people (measured cells by variant, street, pot type and bet-size bucket, shrunk to OMAHA_EV_FOLD_MODEL where thin, scaled by his own read); default OFF'
  ),
  // priced before 2026-11-17 (the audit: "each compares priced lines")
  omahaFacingBetEv: priced('expected value of the call on the exact count'),
  omahaStreetPlan: priced('the bet and the check priced as whole lines'),
  omahaCardImpact: priced('a check and every bet size against the range the card left'),
  omahaBigDrawAggression: priced(
    'the wager beside the passive line (its bars: omahaDrawRaiseIsPriced)'
  ),
  omahaBigDrawBetIsPricedOnHisResponse: priced(
    'R4: PLO4/PLO5 cash flop/turn checked-to big-draw bets priced on lifetime HUD fold, raise-back and stab cells with a prove-it-to-bet bar (default OFF)'
  ),
  omahaStrongHandValue: priced('value bet, induce check and value raise by expected value'),
  omahaStrongHandSlowplayMix: priced('a mixed frequency over a priced raise and call'),
  omahaSlowplayMixInLightning: priced(
    'the game of omahaStrongHandSlowplayMix opened to the Lightning pools when that option is on (a scope, not a rule site)'
  ),
  omahaTurnBetNeedsRiverPlan: open(
    'reclassed open 2026-11-21 (EMERG lane BLANKET-AUDIT-3; it was classed priced as "a look-ahead on every river card"): the look-ahead prices nothing. A turn bet that leaves under half the resulting pot behind becomes a check when the categorical river fold rules fold to the all-in on more than a fixed share of the river cards (HorseOmahaOopChecks.ts omahaTurnBetLacksRiverPlan, OMAHA_TURN_PLAN_FOLD_SHARE): a stack share and a fixed percentage decide, no expected value is compared'
  ),
  omahaRiverMediumBetStrongHandCalls: priced('stands aside for the expected-value verdict'),
  omahaPairedBoardFoldRespectsPrice: open(
    'reclassed open 2026-11-21 (EMERG lane RULES-FIX-1, AUDIT-B item 5; it was classed priced as "stands aside for the expected-value verdict on the turn and river"): where no facing-bet verdict answers, fixed thresholds decide (a price of 0.25 or better with a straight or flush, or 60% of a stack in), not a priced comparison. It is a carve-out of ploPairedBoardFold: listed off alone it removes the carve-out (the paired-board fold stands), so list it only with ploPairedBoardFold'
  ),
  // verifier D10 (2026-11-19): a size line, not a priced comparison
  omahaBigBetIsPotShare: open(
    'a pot-share size line: a turn or river wager under 70% of the pot it went into is tiered by its pot share instead of the 20 big blind mark, and the option also gates the limped-pot minimum bet (a bet under 2 BB into 4 BB or more becomes max(2 BB, 40% of the pot)); neither is priced. With omahaSmallBetIsPriced on, the minimum bet replaces a bet that option placed only through its priced size comparison. Owner: PLO Strategy lane 013U37'
  ),
  omahaFacingBetIsPricedByEquity: priced(
    "a final fold facing a person's wager becomes the call when the recomputed equity, calibrated by street against persons' real cards, times the measured realization beats the price (default OFF; EMERG lane FACING 2026-11-19)"
  ),
  omahaTurnStrongHandRealizationIsMeasured: priced(
    'inside omahaFacingBetIsPricedByEquity: a Lightning heads-up turn fold of a strong made hand is priced with the realization measured for those calls on public information (default OFF; EMERG lane OPEN-ITEMS 2026-11-19)'
  ),
  omahaBetReadIsPerOpponent: priced(
    "heads-up on the river and a later turn barrel, the facing-bet verdicts price the bettor's non-value share from his own measured first-bet composition of that street, size and barrel (shown hands against the other persons' shown hands, and his bet frequency), one rule for every opponent, the population prior below the minimum sample (default OFF; EMERG lane CR2 2026-11-20)"
  ),
  omahaBetReadIsModeSplit: priced(
    "with omahaBetReadIsPerOpponent on, heads-up on the turn and the river the bettor is read in the decision's mode (table or Lightning), by his previous-street line and for his raise, the frequency signal through a calibrated population slope, and a turn call where the read acts priced with the measured realization (default OFF; EMERG lane MODE-READ 2026-11-20)"
  ),
  omahaFlopFacingBetEv: priced(
    "the flop fold or call facing a bet is one expected-value verdict (default OFF; when on, the flop paired-board fold and the reference brain's 20 big blind mark no longer decide that fold or call)"
  ),
  omahaNoMadeClassCap: priced(
    'in PLO4/PLO5 cash the V40 pressure cap (a fixed equity ceiling per made-hand class) does not run and the decision uses the equity that entered it (default OFF; removes a categorical cap, adds no rule)'
  ),
  omahaClassCapsRespectEquity: priced(
    'facing a bet in PLO4/PLO5 cash, the V40 pressure cap and the V15 flush/straight cap lower the equity only down to the measured equity against the bettor range for this line and size, never below it; a raise the floor would make is held to the call (default OFF)'
  ),
  omahaFlopDefenceIsPriced: priced(
    'the heads-up flop fold or call facing his first bet is the flop expected-value verdict with the call priced as a two-street tree (his measured barrel and river bet rates, the Horse priced turn and river answers); alone it answers only that spot (default OFF)'
  ),
  omahaTurnStabDefenceIsPriced: priced(
    "the non-value prior of a person's turn stab after a checked-through flop, measured for that line, inside the facing-bet EV (default OFF; an input, not a rule site)"
  ),
  omahaTurnStabLightningRow: priced(
    "the Lightning-measured non-value prior of a person's turn stab after a checked-through flop, inside the facing-bet EV, with omahaTurnStabDefenceIsPriced and omahaPricedInLightning on (default OFF; an input, not a rule site)"
  ),
  omahaTurnCallRealizationByRunout: priced(
    'the realization of a turn call read river by river from the exact count against his value region and other holdings (default OFF)'
  ),
  omahaRiverBluffCatchIsPriced: priced(
    'a heads-up first river bet priced as a bluff-catch on the bettor measured range composition, reweighted by the Horse blockers and his measured tendency, close calls mixed on a public-state draw (default OFF)'
  ),
  omahaFacingBetEvShownField: priced(
    'a turn or river call with another player in the hand priced on the joint field (players behind continue on a measured rate, their calls in the pot), the measured turn realization and a close-call mix on a public-state draw (default OFF)'
  ),
  omahaMultiwayCheckedToBetIsPriced: priced(
    'the multiway check with nothing to call priced against the candidate bets on the measured multiway response and the measured cost of the check (default OFF)'
  ),
  omahaFacingBetValueIsRangeRelative: priced(
    "the river facing-bet verdict, heads-up against a person's first bet, priced on his measured betting range on this board instead of a share of all holdings (default OFF)"
  ),
  omahaPairedBoardRiverIsPriced: priced(
    "a nut-class straight or flush on a paired river, heads-up against the first bet, priced on the bettor's line-conditioned range inside the facing-bet verdict (default OFF)"
  ),
  omahaSmallBetIsPriced: priced(
    'the small bets beside the owner check or bet on the card-impact model with the measured response by pot share (default OFF)'
  ),
  omahaNutClassValueSize: priced('a size among priced sizes'),
  omahaValueSizeIsUnreadable: priced(
    'how much of the full pot a nut-class wager is: the measured keep share at the full pot, else a uniform draw in the owner 80-95% pot band (default OFF)'
  ),
  // wave two (2026-11-16, PR #11211; all default OFF)
  omahaMultiwayWeakHandNoBet: priced(
    'a multiway bet with a weak hand becomes a check only when the bet-versus-check expected value over every live range says so'
  ),
  omahaStreetPlanThreeWay: priced(
    'the three-way bet and check priced as whole lines against each opponent range'
  ),
  omahaStreetPlanFlop: priced(
    'the flop bet and check priced as whole lines; off-only (failed its evaluation)'
  ),
  omahaMultiwayRiverCallNeedsStrength: priced(
    'the multiway river call on its exact-hand expected value; off-only (failed its evaluation)'
  ),
  omahaFacingBetRangeIsMeasuredByLine: priced(
    "inside omahaFacingBetEv on the turn and river, the bettor's range is his measured strength histogram by street, line, size and pot type (fitted from shown hands), his own shown record shrunk toward it, priced exactly against the hand; no per-street narrowing and no fixed bluff share (default OFF; PLO-OWNER lead-6 2026-11-24)"
  ),
  omahaFacingBetIndifferenceCalls: priced(
    "the facing-bet verdicts call at EV >= the estimate's own error (0 for an exact count, the sampling error for a sample) instead of EV > 2% of the final pot (default OFF; PLO-OWNER lead-6 2026-11-24)"
  ),
  omahaFlopRealizationIsPriced: priced(
    "the flop call facing a bet or a raise is the two-street tree on the bettor's measured flop range and the field dealt on the same runouts, his later bet rates measured; no realization factor or fitted multiplier (default OFF; PLO-OWNER lead-6 2026-11-24)"
  ),
  omahaFacingBetMinimumDefencePrior: priced(
    "a bettor with no shown record of the cell is priced with a weak share no lower than the cell's minimum-defence share (whole-range fold at most s / (1 + s) + 5 points); a record is never bounded (default OFF; PLO-OWNER lead-6 2026-11-24)"
  ),
  omahaFacingBetPriorIsPeopleMeasured: priced(
    'a heads-up turn or river bettor (a bet or a raise) is priced on the PEOPLE-ONLY measured non-value share for the street and size (river: three measured regions, core / middle / weakest half), the balanced share weighting only a thin cell, moved by his own shown bets; Horse play never enters (default OFF; PLO-OWNER lead-7 2026-11-26)'
  ),
  omahaFacingBetFieldIsJoint: priced(
    'a multiway turn or river call is priced with the bettor, the callers, the earlier all-ins and the players behind (at their measured continue rate) dealt on the same cards from measured ranges (default OFF; PLO-OWNER lead-6 2026-11-24)'
  ),
  omahaMultiwayCallNeedsNutShare: priced(
    'inside the joint field price, the field holds flush draws at the measured share of callers and a better same-category hand of the field is priced into the call (an input to the price, never a rule; default OFF; PLO-OWNER lead-6 2026-11-24)'
  ),
  omahaMultiwayValueBetIsPriced: priced(
    "a final multiway check with nothing to call becomes the best of three bet sizes where its EV against the field's measured fold and calling ranges beats the check's by 2% of the pot (default OFF; PLO-OWNER lead-6 2026-11-24)"
  ),
  omahaStabDefenceIsPriced: priced(
    "facing the first wager of a turn or river street, the bettor's non-value share is priced from his own lifetime public first-wager frequency against the population's, shrunk n / (n + k) with the measured k; no record is the population prior exactly (default OFF)"
  ),
  omahaStrongHandCheckIsPriced: priced(
    "a heads-up first-to-act turn or river value bet is priced beside the check (the bet on the measured answer curve moved by his own public fold record, the check on his stab frequency and measured stab size) and taken as a check with the probability the comparison's standard error gives; held, not graded (default OFF)"
  ),
  omahaRiverBetFoldIsHisRecord: priced(
    "the answer curve the two river bet rules price a heads-up river bet with is the population's with its fold share multiplied by the opponent's own lifetime public fold record at a river's first wager over the population's, shrunk n / (n + k) with the measured k; no record is the population curve exactly (default OFF)"
  ),
  omahaRiverBetCheckIsHisRecord: priced(
    "the range the two river bet rules price a heads-up river bet against reads his checks through his own lifetime public unopened turn/river bet share shrunk to PEOPLE's by n / (n + k): a player who never bets unopened has checks that do not cap his range; no record is the model exactly (default OFF; PLO-OWNER lead-7 2026-11-26)"
  ),
  omahaRiverCallRangeIsHisRecord: priced(
    "the range the two river bet rules price a heads-up river bet against reads his flop and turn calls through his own lifetime public first-wager fold share over PEOPLE's, shrunk n / (n + k): a player who never folds keeps almost all of his range after a call; no record is the model exactly (default OFF; PLO-OWNER lead-7 2026-11-26)"
  ),
  omahaRiverBetFoldIsPeopleMeasured: priced(
    "the answer curve the two river bet rules price a heads-up river bet with is re-measured on PEOPLE's answers for the Horse's line and the size (shrunk to equilibrium by the measured k); Horse answers never enter (default OFF; PLO-OWNER lead-7 2026-11-26)"
  ),
  omahaCbetRaiseIsPriced: priced(
    "facing a raise of its own flop continuation bet, the Horse prices the call against the top W x rho of holdings, rho the raiser's lifetime public raise share facing a first flop c-bet shrunk to the population's by K; heads-up bluff and semi-bluff c-bets carry that raise branch"
  ),
  omahaFlopRaiseIsPriced: priced(
    "a heads-up flop raise facing a wager is priced at its sizes beside the call and the fold on the bettor's measured flop range (his fold share the equilibrium minimum defence); the best replaces it only by more than the equity estimate's error; it never makes a raise out of a call or a fold (default OFF; PLO-OWNER lead-7 2026-11-26)"
  ),
  omahaRiverTripsBoardBoatIsNotNutClass: priced(
    'a river raise with a full house on a trips board that quads or a straight flush can beat (exact count, the Horse cards removed) becomes the call; it may call, never raise (default OFF; PLO-OWNER lead-7 2026-11-26)'
  ),
  omahaRiverValueBetInPositionIsPriced: priced(
    "a heads-up river check after the opponent checked becomes the best-priced bet only where it is a value bet against the hands that continue (his measured checking range, exact card removal, his fold rate from equilibrium moved by his own record) and beats the check by more than his fold rate's error (default OFF; PLO-OWNER lead-7 2026-11-26)"
  ),
  omahaRiverBluffIsPricedOnBlockers: priced(
    "a heads-up river check with nothing to call and no value bet becomes the best-priced bluff only where it beats the check on his card-removed fold rate by more than that rate's error AND the Horse's cards raise his fold share (default OFF; PLO-OWNER lead-7 2026-11-26)"
  ),
  omahaRiverBluffIsPricedOnRangeAdvantage: priced(
    "a heads-up river check with nothing to call and no value bet becomes the best-priced bluff only where it beats the check on his card-removed fold rate by more than that rate's error AND the Horse's measured range beats his on this texture with the hand in the weakest share of the Horse's range that its value carries at the size (default OFF; PLO-OWNER lead-7 2026-11-26)"
  ),
  omahaTurnBluffIsPricedOnBlockers: priced(
    "a heads-up turn check with nothing to call becomes the best-priced bet only where it beats the full-realization value of the check (his fold share from equilibrium moved by his own turn record, the Horse's sampled share with a card to come, the turn realization, his raise-back) by more than its error AND the Horse's cards raise his fold share (default OFF; PLO-OWNER lead-7 2026-11-26)"
  ),
  omahaTurnBluffIsPricedOnRangeAdvantage: priced(
    "a heads-up turn check with nothing to call becomes the best-priced bet only where it beats the full-realization value of the check by more than its error AND the Horse's measured range beats his on this texture with the hand in the weakest share of the Horse's range that its value carries at the size (default OFF; PLO-OWNER lead-7 2026-11-26)"
  ),
  omahaRiverCheckedToBetIsMeasured: priced(
    'a river check heads-up after the opponent checked becomes a bet only where the bet, priced on the measured response curve of river bets after a check and the card-impact range (no opponent kind), beats the calibrated showdown value of the check by more than its standard error (default OFF)'
  ),
  omahaRiverFirstToActBetIsPriced: priced(
    'a river check by the first actor heads-up becomes a bet only where the bet, priced on the measured response curve and the card-impact range, beats the check by more than its standard error; it changes only a check (default OFF)'
  ),
  omahaRiverCurrentNutsCallFloor: priced(
    'a river fold with the exact current nuts becomes the call only where its expected value is proven non-negative (a full chop with every live opponent still returns the call); it changes only a fold (default OFF)'
  ),
  omahaReraisedPotCallIsPriced: priced(
    'preflop facing a 3-bet or more: the standing call or fold is replaced by the priced one (EV(call) against 0, beyond a deadband of 1% of the pot after the call), equity against the whole field with the players behind as probable continuers, self-play realization by position against that field, players and depth; it never invents a re-raise (default OFF; PLO lead-6 2026-11-24)'
  ),
  omahaReraisedPotReraiseIsPriced: priced(
    'preflop facing a 3-bet or more: a standing re-raise stands only where EV(re-raise) is at or above max(EV(call), 0) less the deadband, else it becomes the priced call or the fold; its size is never changed (default OFF; PLO lead-6 2026-11-24)'
  ),
  omahaOopReraiseRangeHoldsVsReraise: priced(
    "an out-of-position preflop 3-bet facing one open stands only when EV(3-bet), priced on the opener's measured answer to a 3-bet (fitted population answer when unread) and the Horse's own answer to the 4-bet at the real depth, is at least the priced call the existing calling rule admits (or 0), and that answer is not a fold except a blocker kept at the seeded frequency that holds the range's fold-to-4-bet share under horse.reraiseFoldShareCap; it only removes 3-bets, as the call or the fold (default OFF; PLO-LEAD-6)"
  ),
  omahaOopReraiseRangeReadsOpenerRecord: priced(
    "with omahaOopReraiseRangeHoldsVsReraise on, the out-of-position 3-bet rule reads this opener's own record of answering a 3-bet in position (horse_exact_profiles.opener_response; his 4-bet share anchored to a 0.10 baseline, population weight 0, own record mass 6): his call : 4-bet split is his own and the planned-fold guard and the price bind with weight w = min(1, his 4-bet rate / 0.10), a rejected 3-bet standing at the seeded frequency 1 - w; no record, w = 1; it only removes 3-bets (default OFF; PLO-LEAD-6)"
  ),
  omahaFourBetFoldPricedCall: priced(
    "a preflop fold after hero's own raise, facing a 4-bet or more heads-up, becomes the call only where the engine's priced call of a re-raise (omahaReraisedCallPriced) is positive; it changes only a fold (default OFF)"
  ),
  omahaFacingBetValueShareIsMeasured: priced(
    "the facing-bet verdicts' bettor range from his measured street record and, for a person's heads-up turn or river bet, his line-conditioned range weighted by the measured density of people's bets; the priced verdicts decide where they price (default OFF)"
  ),
  omahaFlopVerdictReadsTheBettor: priced(
    "the flop facing-bet verdict's bettor range and realization read from that bettor's own street record beside his kind, moved continuously by his sample (an input of the omahaFlopFacingBetEv verdict, not a rule site; default OFF)"
  ),
  omahaReadIsByStreetAndTexture: priced(
    "the opponent read every priced comparison and the value-leader label take, from the decision's street and flop texture, blended continuously with the pooled read (an input, not a rule site)"
  ),
  // categorical, replaced
  omahaTurnRiverRaiseNeedsNuts: categorical('omahaTurnRiverRaiseIsPriced'),
  omahaRiverNutRaiseOnly: categorical('omahaTurnRiverRaiseIsPriced'),
  omahaNoDrawRaiseOutOfPosition: categorical('omahaDrawRaiseIsPriced'),
  omahaOopTurnCheckAfterFlopCall: categorical('omahaOopTurnBarrelIsPriced'),
  omahaPairedRiverNoThinLeadVsValueLeader: categorical('omahaPairedBoardBetIsPriced'),
  omahaOverpairNoOopBarrelVsValueLeader: categorical('omahaPairedBoardBetIsPriced'),
  omahaPairedTurnNoBarrelWithoutBoatVsValueLeader: categorical('omahaPairedBoardBetIsPriced'),
  ploPairedBoardRiverCheck: categorical('omahaPairedBoardBetIsPriced'),
  omahaPressureNeedsPostflopAggression: categorical('omahaPressureIsPriced'),
  omahaBluffCatcherFoldVsValueLeader: categorical('omahaBigBetCallsArePriced'),
  omahaBluffCatcherRaiseFold: categorical('omahaBigBetCallsArePriced'),
  omahaUnderpairNoMultiwayFlopContinue: categorical('omahaUnderpairMultiwayIsPriced'),
  // categorical, not yet replaced
  ploPairedBoardFold: open(
    'the flop: stack share and category (audit 1). It still decides whenever omahaFlopFacingBetEv is off (that option is default OFF and has no rule site in this register yet); on the turn and river the expected-value verdict already does'
  ),
  // the bet half priced by omahaFlopBetIsPriced; the continuation facing the flop bet is an open site (flop facing-bet verdict)
  omahaBareOverpairOopFlopCheck: categorical('omahaFlopBetIsPriced'),
  // the bet half priced by omahaMadeHandBetIsPriced; the raise half by omahaTurnRiverRaiseIsPriced outermost
  omahaMadeHandDefenseVsValueLeader: categorical('omahaMadeHandBetIsPriced'),
  omahaBeatenMadeHandDefense: categorical('omahaMadeHandBetIsPriced'),
  omahaOnePairDiscipline: open('one-pair cells by hand class; off-only in the live switch'),
  omahaRiverNutBlockerBluffReachable: categorical('omahaBlockerBluffIsPriced'),
  omahaReraisedPotFlopContinueNeedsEquityShape: open(
    'the flop continue in a re-raised pot by hand shape; the flop belongs to the flop facing-bet EV build (plo-flopev-01BNteGZ)'
  ),
  omahaTurnSetPound: categorical('omahaTurnSetSizeIsPriced'),
  omahaCurrentNutsRaise: open(
    'the flop or turn call with the exact current nuts and a redraw (or an untieable nut hand) becomes the pot raise by hand category (owner ruling 2026-11-06, hand 55690261); registered 2026-11-20 (EMERG ledger L43), no priced replacement on the flop yet: on the turn omahaTurnRiverRaiseIsPriced judges the raise it makes'
  ),
  omahaNoRiverBluffIntoValueLeader: open(
    'the river bluff is withheld by an opponent label (measured value leader); off-only in the live switch until it is rewritten as a priced bluff from the fold-to-bet read'
  ),
  // outside PLO4/PLO5 cash postflop decisions
  ploSuitedAcesFourBet: outside(PREFLOP),
  // EMERG lane PACK 2026-11-19: the depth the pack gates admit at, not a decision rule
  omahaPackEffectiveDepth: outside(
    'the depth at which the PLO4/PLO5 strategy pack admits a decision (omaha/OmahaPackDepth.ts); it decides no action'
  ),
  omahaPackClampDeepDepth: outside(
    'the depth at which the PLO4/PLO5 strategy pack admits a decision (omaha/OmahaPackDepth.ts); it decides no action'
  ),
  omahaSmallBlindSteal: outside(PREFLOP),
  omahaReraisedPotDiscipline: outside(PREFLOP),
  omahaReraisedPotStackOffFold: outside(PREFLOP),
  omahaReraisedPotStackOffRealistic: outside(PREFLOP),
  omahaReraisedCallVsRaisePriced: outside(PREFLOP),
  omahaPreflopJamFacingReraiseIsPriced: outside(PREFLOP),
  omahaReraisedFoldVsTight: outside(PREFLOP),
  omahaReraisedPositionInLightning: outside(PREFLOP),
  omahaReraisedPositionVsEveryoneToAct: outside(PREFLOP),
  omahaEliteContinuesVsMeasuredWideThreeBettor: outside(PREFLOP),
  omahaOopReraisedPotStrongRange: outside(
    PREFLOP +
      '; its out-of-position 4-bet call fold (audit 20) stays with its re-raised-pot call cell (one owner per cell, inbox 2026-11-18 00:06Z)'
  ),
  omahaPreflopReraiseDefencePriced: outside(
    'preflop: fold, call and the proposed re-raise by expected value against the measured range (off-only under the preflop hold)'
  ),
  omahaPreflopReraiseDefencePricedInPosition: outside(
    "preflop: only a fold becomes the priced call of omahaPreflopReraiseDefencePriced, for an opener heads-up in position against one person's 3-bet"
  ),
  omahaReraiseRangeOutOfPosition: outside(PREFLOP),
  omahaReraiseRangeEarlyPosition: outside(PREFLOP),
  omahaNoCallColdFourBetWithoutPremium: outside(PREFLOP),
  omahaVpipFloorByLimp: outside(PREFLOP),
  omahaColdCallOutsideBigBlindIsMeasured: outside(PREFLOP),
  omahaOpenNeedsMeasuredStrength: outside(PREFLOP),
  omahaAcesReraiseIsMeasured: outside(PREFLOP),
  omahaReraiseRangeIsMeasured: outside(PREFLOP),
  omahaRundownReraiseRangeIsMeasured: outside(PREFLOP),
  omahaRundownReraiseRangeTrial: outside(PREFLOP),
  omahaManiacReRaiseWidthMeasured: outside('a read (re-raise width), not a rule'),
  omahaPreflopStackPlan: outside(PREFLOP + '; off-only under the preflop range hold'),
  omahaBetSizeByPublicState: outside(
    'a size chooser from public state only: it never decides a bet against a check, a call or a fold (aBetSizeIsPublicInformationOnly.law)'
  ),
  omahaPublicBetSizeInLightning: outside(
    'the game of omahaBetSizeByPublicState opened to the Lightning pools when that option is on (a scope of a size chooser: it never decides a bet against a check, a call or a fold)'
  ),
  omahaPreflopCallWithActionBehind: outside(PREFLOP),
  omahaCommitZoneThreeBetPriceRelief: outside(PREFLOP),
  omahaNeutralUnknown: outside('a read prior'),
  omahaTightOpponent: outside('a read response, preflop'),
  omahaTightOpponentSteal: outside(PREFLOP),
  omahaEvFoldModel: outside('a model switch'),
  omahaEvFoldModelHeadsUp: priced(
    'the EV bet engine fold multiplier of one opponent heads-up: the measured heads-up fold share over MDF scaled by his shrunk fold to a bet on the street (default OFF)'
  ),
  omahaEvFoldModelSkipsPlo45: outside('a model scope switch (PLO4 / PLO5 cash only)'),
  omahaStrategyInTournaments: outside('a scope gate (tournaments)'),
  omahaOptionGameScope: outside(
    'a scope parameter (the game an omaha* option may be on in, from the runtime settings horse.omahaGameScope.<option>): it decides no action, it passes an option scoped to the other game as off'
  ),
  omahaBlanketRowsOffInPlo45Cash: outside(
    'a scope gate (PLO4/PLO5 cash): with it on, each blanket row on the declared list (registry members only: categorical, open or unclassed rules of the no-categorical list, never a priced one) stands aside; it decides no action'
  ),
  omahaBlanketRowsOffList: outside(
    'the declared list of omahaBlanketRowsOffInPlo45Cash (runtime settings horse.blanketRowOffInPlo45Cash.<option>): it decides no action'
  ),
  omahaNoCategoricalRules: outside(
    'a scope gate (PLO4/PLO5 cash): with it on every categorical and open rule here, and the big-bet call cells, stand aside'
  ),
  omahaBandFallbackInBandUnit: outside(
    'an equity sampler unit (the PLO4/PLO5 band fallback measures in the band percentile; default OFF): it decides no action'
  ),
  omahaMathCore: priced(
    'the math-first PLO4/PLO5 cash core (default OFF): the expected-value maximum over every legal action from exact 2+3 equity against public ranges, measured fold and response frequencies and the price; the outermost owner of wager_rules'
  ),
  omahaMathCorePreflop: outside(PREFLOP),
  omahaMathCoreNetsTheWholeDeduction: outside(
    'INERT (lane CORE-FIX-1): formerly a pricing term of omahaMathCore; the core nets the whole deduction by default and this option changes no decision (law: OmahaMathCoreCoreFix1.law.test.ts); it is no rule site of its own'
  ),
  omahaFacingBetPaysTheWholeDeduction: priced(
    "the facing-bet call verdicts deduct the whole projected deduction of the pot after the call (capped rake plus the jackpot drop, the controller's own arithmetic) instead of the marginal rake rate (default OFF; EMERG lane RAKE 2026-11-20)"
  ),
  omahaMathCorePlo4Flop: outside(
    'a scope gate of omahaMathCore (PLO4 cash flop admission; off = no core work on that street)'
  ),
  omahaMathCorePlo4Turn: outside(
    'a scope gate of omahaMathCore (PLO4 cash turn admission; off = no core work on that street)'
  ),
  omahaMathCorePlo4River: outside(
    'a scope gate of omahaMathCore (PLO4 cash river admission; off = no core work on that street)'
  ),
  omahaMathCorePlo5Flop: outside(
    'a scope gate of omahaMathCore (PLO5 cash flop admission; off = no core work on that street)'
  ),
  omahaMathCorePlo5Turn: outside(
    'a scope gate of omahaMathCore (PLO5 cash turn admission; off = no core work on that street)'
  ),
  omahaMathCorePlo5River: outside(
    'a scope gate of omahaMathCore (PLO5 cash river admission; off = no core work on that street)'
  ),
  omahaTournamentsExcludeCategoricalRules: outside(
    'a scope gate (tournaments): with it on the categorical rules here stay cash-only'
  ),
  omahaStrategyInPlo6: outside('a scope gate (PLO6)'),
  omahaTournamentFirstIn: outside('tournaments'),
  omahaHiLoTournamentFirstIn: outside('hi-lo tournaments'),
  plo6ManiacPriceRefusalToRangePlay: outside('PLO6'),
  plo6TopSetNutRealization: outside('PLO6'),
  plo6NoMultiwayBetWithWeakMadeHand: outside('PLO6'),
  plo6FacingBetIsPriced: outside('PLO6 (priced facing a bet; owner-held off, audit-fix batch 1)'),
  plo6FacingBetIsPricedV2: outside(
    'PLO6 (six-card native facing-bet pricing model V2; default off)'
  ),
  omahaMultiwayIsPricedInTournaments: outside(
    'tournaments, a format outside PLO4/PLO5 cash (prices multiway calls; audit-fix batch 1)'
  ),
});
