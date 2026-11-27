/**
 * THE GAME SCOPE OF AN OMAHA OPTION (EMERG lane PLO4-FIX 2026-11-20, compiled default: no scope, every option acts
 * in PLO4 and PLO5 alike, exactly as before).
 *
 * WHY. An option switch row is global: an omaha* option that is on is on in PLO4 and in PLO5 together. Lane
 * PLO4-AUDIT graded every option on PLO4's own hands and several split by game (priced call-widening options grade
 * positive or neutral in PLO5 and negative in PLO4, and others the other way). A second option per game would double
 * the list. This is ONE mechanism instead: any listed option can be given a game, PLO4 or PLO5, and then it can be on
 * only in that game.
 *
 * HOW IT IS SET. Engine runtime setting `horse.omahaGameScope.<option>` (runtimeSettings/registry.ts; published with
 * scripts/runtime-settings-publish.ts, live at each table's next hand, no cutover): 0 = both games (the compiled
 * default), 4 = PLO4 only, 5 = PLO5 only. The option switch rows and the way a build validates them are untouched:
 * the scope travels in the decision request as the option `omahaOptionGameScope` (only the options whose setting is
 * not 0; absent at the defaults, so the request, its key and its journal are byte-identical), and is journaled and
 * replayed with the request.
 *
 * WHAT IT DOES. ONE read site: HorseLogic.decide and HorseLogic.prepareOriginalReads pass their options through
 * withOmahaOptionGameScope before anything reads them. In a PLO4 or PLO5 cash decision (table or Lightning, one
 * board, no hi-lo, no bomb pot: the scope of omahaNoCategoricalRules) every listed option whose game is not this
 * decision's game is passed `false`, which is that option's off path whatever its release default. So an option
 * scoped to PLO5 decides a PLO4 hand exactly as if it were off, and the other way round. An option without a scope,
 * and every option in its own game, is passed as given.
 *
 * NEVER IN SCOPE: PLO6 (owner 2026-11-19 8:27 PM: "DON'T TOUCH PLO6"), PLO8, hold'em, tournaments, bomb pots and
 * multi-board hands. For them the same options object runs whatever is published (byte-identical).
 *
 * NOT LISTED (cannot be scoped): the omahaMathCore family (it has its own per-game street flags and engine-side
 * doors keyed on the delivered switch row), the PLO6 options, and the tournament-only options.
 *
 * No hidden card is read. Nothing here is a threshold or a strategy rule: it only narrows where an option is on.
 */
import type { SeatPlayer } from '../types.js';
import type { HorseDecideOpts, HorseGameStateV2 } from './HorseLogic.js';
import { omahaNoCategoricalRulesInScope } from './HorseOmahaNoCategoricalRules.js';

/** The game an option is confined to: 4 = PLO4 only, 5 = PLO5 only. (No entry = both.) */
export type OmahaOptionGame = 4 | 5;
export type OmahaOptionGameScope = Readonly<Record<string, OmahaOptionGame>>;

export const OMAHA_OPTION_GAME_SCOPE_SETTING_PREFIX = 'horse.omahaGameScope.';

/**
 * Every option that can be given a game: the registered omaha* switch options except the math core family, the PLO6
 * options and the tournament-only options (HorseOmahaOptionGameScope.law.test.ts holds this list equal to that rule).
 */
export const OMAHA_OPTION_GAME_SCOPE_OPTIONS: readonly string[] = Object.freeze([
  'omahaBetSizeByPublicState',
  'omahaSmallBlindSteal',
  'omahaRiverNutRaiseOnly',
  'omahaTurnSetPound',
  'omahaBeatenMadeHandDefense',
  'omahaBluffCatcherRaiseFold',
  'omahaReraisedPotDiscipline',
  'omahaReraisedPotStackOffFold',
  'omahaReraisedPotStackOffRealistic',
  'omahaReraisedFoldVsTight',
  'omahaEliteContinuesVsMeasuredWideThreeBettor',
  'omahaOopReraisedPotStrongRange',
  'omahaPreflopReraiseDefencePriced',
  'omahaPreflopReraiseDefencePricedInPosition',
  'omahaReraiseRangeOutOfPosition',
  'omahaReraisedCallVsRaisePriced',
  'omahaPreflopJamFacingReraiseIsPriced',
  'omahaReraiseRangeEarlyPosition',
  'omahaReraisedPotFlopContinueNeedsEquityShape',
  'omahaMadeHandDefenseVsValueLeader',
  'omahaBluffCatcherFoldVsValueLeader',
  'omahaRiverMediumBetStrongHandCalls',
  'omahaBigBetIsPotShare',
  'omahaPairedRiverNoThinLeadVsValueLeader',
  'omahaOverpairNoOopBarrelVsValueLeader',
  'omahaPairedTurnNoBarrelWithoutBoatVsValueLeader',
  'omahaPairedBoardFoldRespectsPrice',
  'omahaFlopDefenceIsPriced',
  'omahaFacingBetIsPricedByEquity',
  'omahaBandFallbackInBandUnit',
  'omahaTurnStrongHandRealizationIsMeasured',
  'omahaBetReadIsPerOpponent',
  'omahaFacingBetPaysTheWholeDeduction',
  'omahaBetReadIsModeSplit',
  'omahaColdCallOutsideBigBlindIsMeasured',
  'omahaOpenNeedsMeasuredStrength',
  'omahaAcesReraiseIsMeasured',
  'omahaReraiseRangeIsMeasured',
  'omahaRundownReraiseRangeIsMeasured',
  'omahaRundownReraiseRangeTrial',
  'omahaClassCapsRespectEquity',
  'omahaNoMadeClassCap',
  // main 2026-11-20 (#11511, Horse Decisions batch 1): both PLO4/PLO5 cash, default OFF
  'omahaBluffIsPricedAgainstTheTarget',
  'omahaFacingBetValueShareIsMeasured',
  // EMERG lane RANGE-MODEL-2 2026-11-20: PLO4/PLO5 cash, default OFF
  'omahaRiverCurrentNutsCallFloor',
  // EMERG lane PREFLOP-UNCONTESTED 2026-11-20: PLO4/PLO5 cash, default OFF
  'omahaFourBetFoldPricedCall',
  // PLO lead-6 2026-11-24: PLO4/PLO5 cash, default OFF
  'omahaReraisedPotCallIsPriced',
  'omahaReraisedPotReraiseIsPriced',
  // EMERG lane CBET-DEFENCE 2026-11-21: PLO4/PLO5 cash, default OFF
  'omahaCbetRaiseIsPriced',
  // EMERG lane OFFENCE-BUILD 2026-11-20: PLO4/PLO5 cash, default OFF
  'omahaRiverFirstToActBetIsPriced',
  'omahaRiverCheckedToBetIsMeasured',
  // EMERG lane BLANKET-AUDIT 2026-11-21: PLO4/PLO5 cash, default OFF
  'omahaBlanketRowsOffInPlo45Cash',
  // PLO-OWNER lane OPPONENT-HUD 2026-11-20: PLO4/PLO5 cash, default OFF
  'omahaOpponentLifetimeHud',
  // PLO-OWNER lane OPPONENT-HUD-9 2026-11-21: the lifetime-HUD consumer, PLO4/PLO5 cash, default OFF
  'omahaOpponentLifetimeHudDecides',
  // PLO-OWNER lead-4 B4 2026-11-21: priced six-max preflop read on lifetime HUD cells, PLO4/PLO5 cash, default OFF
  'omahaPreflopReadIsPricedFromLifetime',
  // PLO-OWNER lane REPLACEMENTS-5 2026-11-21: R2 PLO4/PLO5 cash, default OFF
  'omahaFlopBetIsPricedOnHisResponse',
  // EMERG lane STAB-DEFENCE 2026-11-20: PLO4/PLO5 cash, default OFF
  'omahaStabDefenceIsPriced',
  // PLO-OWNER lead-6 2026-11-24: PLO4/PLO5 cash, default OFF
  'omahaFacingBetRangeIsMeasuredByLine',
  'omahaFacingBetIndifferenceCalls',
  'omahaFlopRealizationIsPriced',
  'omahaFacingBetMinimumDefencePrior',
  // PLO-OWNER lead-7 2026-11-26: PLO4/PLO5 cash, default OFF
  'omahaFacingBetPriorIsPeopleMeasured',
  'omahaMultiwayFieldIsPeopleMeasured',
  'omahaFacingBetFieldIsJoint',
  'omahaMultiwayCallNeedsNutShare',
  'omahaMultiwayValueBetIsPriced',
  'omahaStrongHandCheckIsPriced',
  // EMERG lane STAB-DEFENCE-5 2026-11-21: PLO4/PLO5 cash, default OFF
  'omahaRiverBetFoldIsHisRecord',
  // PLO-OWNER lead-7 2026-11-26: PLO4/PLO5 cash, default OFF
  'omahaRiverValueBetInPositionIsPriced',
  'omahaRiverBluffIsPricedOnBlockers',
  'omahaRiverTripsBoardBoatIsNotNutClass',
  'omahaFlopRaiseIsPriced',
  // PLO-OWNER lead-4 lane LEAKS-RULES 2026-11-21: PLO4/PLO5 cash, default OFF (replaces #18 omahaBigBetIsPotShare)
  'omahaBigBetSizeIsPriced',
  // PLO-OWNER lead-5 2026-11-22: PLO4/PLO5 cash, default OFF
  'omahaPricedRaiseNeverMakesNonNutRaise',
  'omahaLateFlattenedCallIsPriced',
  'omahaFlopFacingBetEv',
  'omahaFlopVerdictReadsTheBettor',
  'omahaReadIsByStreetAndTexture',
  'omahaTurnBetNeedsRiverPlan',
  'omahaPressureNeedsPostflopAggression',
  'omahaOopTurnCheckAfterFlopCall',
  'omahaBareOverpairOopFlopCheck',
  'omahaNoCallColdFourBetWithoutPremium',
  'omahaUnderpairNoMultiwayFlopContinue',
  'omahaMultiwayRiverCallNeedsStrength',
  'omahaNoRiverBluffIntoValueLeader',
  'omahaMultiwayWeakHandNoBet',
  'omahaVpipFloorByLimp',
  'omahaReraisedPositionInLightning',
  // PLO lead-7 2026-11-26: PLO4/PLO5 cash, default OFF
  'omahaReraisedPositionVsEveryoneToAct',
  'omahaManiacReRaiseWidthMeasured',
  'omahaCardImpact',
  'omahaFacingBetEv',
  'omahaTurnStabDefenceIsPriced',
  'omahaTurnStabLightningRow',
  'omahaTurnCallRealizationByRunout',
  'omahaFacingBetEvShownField',
  'omahaRiverBluffCatchIsPriced',
  'omahaFacingBetValueIsRangeRelative',
  'omahaPairedBoardRiverIsPriced',
  'omahaTurnRiverRaiseNeedsNuts',
  'omahaStreetPlan',
  'omahaStreetPlanFlop',
  'omahaStreetPlanThreeWay',
  'omahaPreflopStackPlan',
  'omahaBigDrawAggression',
  'omahaNoDrawRaiseOutOfPosition',
  'omahaNoCategoricalRules',
  'omahaStrongHandSlowplayMix',
  'omahaTurnRiverRaiseIsPriced',
  'omahaDrawRaiseIsPriced',
  'omahaOopTurnBarrelIsPriced',
  'omahaPairedBoardBetIsPriced',
  'omahaPackEffectiveDepth',
  'omahaPackClampDeepDepth',
  'omahaBluffShareFromBetRate',
  'omahaFacingBetRangeIsContinuous',
  'omahaPressureIsPriced',
  'omahaBigBetCallsArePriced',
  'omahaUnderpairMultiwayIsPriced',
  'omahaPricedPriorsByOpponentKind',
  'omahaRaiseEvCountsLossesOnce',
  'omahaSampledRaiseIsPricedAtEverySize',
  'omahaMadeHandBetIsPriced',
  'omahaTurnSetSizeIsPriced',
  'omahaBlockerBluffIsPriced',
  'omahaFlopBetPricesTheRaise',
  'omahaFlopBetUsesMeasuredFoldShare',
  'omahaFoldModelFittedOnPeople',
  'omahaFlopBetIsPriced',
  'omahaPricedMix',
  'omahaPricedInLightning',
  'omahaSlowplayMixInLightning',
  'omahaPublicBetSizeInLightning',
  'omahaSmallBetIsPriced',
  'omahaCheckedToBetIsPriced',
  'omahaCheckedToBetInLightning',
  'omahaCheckedToBetResponseIsMeasured',
  'omahaMultiwayCheckedToBetIsPriced',
  'omahaStrongHandValue',
  'omahaCurrentNutsRaise',
  'omahaNutClassValueSize',
  'omahaValueSizeIsUnreadable',
  'omahaRiverNutBlockerBluffReachable',
  'omahaOnePairDiscipline',
  'omahaEvFoldModel',
  'omahaEvFoldModelHeadsUp',
  'omahaEvFoldModelSkipsPlo45',
  'omahaNeutralUnknown',
  'omahaTightOpponent',
  'omahaTightOpponentSteal',
  'omahaCommitZoneThreeBetPriceRelief',
  // 2026-11-21 PLO-OWNER lane REPLACEMENTS-5: R4 checked-to big-draw bets priced on lifetime HUD
  'omahaBigDrawBetIsPricedOnHisResponse',
  // PLO-LEAD-6 2026-11-24: PLO4/PLO5 cash, default OFF
  'omahaOopReraiseRangeHoldsVsReraise',
  // PLO-LEAD-6 2026-11-24: PLO4/PLO5 cash, default OFF (reads the opener's own record)
  'omahaOopReraiseRangeReadsOpenerRecord',
]);

const SCOPABLE: ReadonlySet<string> = new Set(OMAHA_OPTION_GAME_SCOPE_OPTIONS);

/** Whether `name` can be given a game. */
export function omahaOptionGameScopable(name: string): boolean {
  return SCOPABLE.has(name);
}

/** The game of a decision the scope reads: 4 or 5 for PLO4/PLO5 cash, null for everything else (PLO6 included). */
export function omahaOptionGameOf(
  player: SeatPlayer,
  gs: HorseGameStateV2
): OmahaOptionGame | null {
  try {
    if (!omahaNoCategoricalRulesInScope(player, gs)) return null;
    return String(gs.gameVariant ?? '').toLowerCase() === 'plo4' ? 4 : 5;
  } catch {
    return null;
  }
}

/**
 * The scope a published settings version sets: the listed options whose setting is 4 or 5, in list order; undefined
 * when none is (the compiled defaults), so nothing is added to a decision request.
 */
export function omahaOptionGameScopeFromSettings(
  values: Readonly<Record<string, number>> | undefined
): OmahaOptionGameScope | undefined {
  if (!values) return undefined;
  let out: Record<string, OmahaOptionGame> | undefined;
  for (const name of OMAHA_OPTION_GAME_SCOPE_OPTIONS) {
    const v = values[OMAHA_OPTION_GAME_SCOPE_SETTING_PREFIX + name];
    if (v === 4 || v === 5) (out ??= {})[name] = v;
  }
  return out ? Object.freeze(out) : undefined;
}

/**
 * The options this decision runs with. The SAME object when no scope is given, when the decision is not PLO4/PLO5
 * cash, or when nothing changes (every option scoped to the other game is already false), so the default and every
 * out-of-scope game are byte-identical and a second pass is the identity. Otherwise a copy in which every listed
 * option scoped to the other game is false; `note` is told each one and the decision's game (the caller fires the
 * receipt omaha_option_game_scope_<option>_off_in_plo<4|5>_seen). A name that is not listed, or a game that is not 4
 * or 5, is ignored. Never throws.
 */
export function withOmahaOptionGameScope(
  opts: HorseDecideOpts,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  note?: (option: string, decisionGame: OmahaOptionGame) => void
): HorseDecideOpts {
  try {
    const scope = opts.omahaOptionGameScope;
    if (!scope || typeof scope !== 'object') return opts;
    const game = omahaOptionGameOf(player, gs);
    if (game === null) return opts;
    const given = opts as Readonly<Record<string, unknown>>;
    let out: Record<string, unknown> | undefined;
    for (const name of OMAHA_OPTION_GAME_SCOPE_OPTIONS) {
      const only = (scope as Readonly<Record<string, unknown>>)[name];
      if ((only !== 4 && only !== 5) || only === game || given[name] === false) continue;
      (out ??= { ...given })[name] = false;
      if (note) {
        try {
          note(name, game);
        } catch {
          /* a receipt never affects the decision */
        }
      }
    }
    return out ? (out as HorseDecideOpts) : opts;
  } catch {
    return opts;
  }
}
