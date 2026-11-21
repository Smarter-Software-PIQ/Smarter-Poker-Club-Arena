/**
 * omahaNoCategoricalRules (lane UNBLOCK 2026-11-19, default OFF; owner 8:37 PM Chicago: "Every decision
 * needs to be made independently on each and every hand. No law or rule should ever prevent the correct
 * decision from happening.").
 *
 * With the option on, in a PLO4 or PLO5 cash decision (table or Lightning; one board, no hi-lo, no bomb
 * pot), every rule of the old decision path that forces or forbids an action by a hand class, a label,
 * a position, a street or a fixed threshold is switched off for that decision, the hidden default-on
 * ones (read `!== false`, no switch row) included, so that nothing categorical can decide a PLO4/PLO5
 * cash action: not before the math core (omahaMathCore) answers and not when the core falls back on an
 * error. The rules switched off are the options in OMAHA_NO_CATEGORICAL_RULES_OFF (each one's off path
 * is "the rule does not run") and the big-bet call cells of omahaBigBetCallFoldCells (V81 / V84 / V86 /
 * V87), which have no option of their own that does not also switch off unrelated work.
 *
 * Owner 2026-11-19 8:27 PM: PLO6 is a separate game ("DON'T TOUCH PLO6"). Six-card decisions, PLO8,
 * hold'em, tournaments and every other game are never in scope: byte-identical with the option on.
 * Off: byte-identical everywhere. No decision reads a hidden card; nothing here is a threshold.
 */
import type { SeatPlayer } from '../types.js';
import type { HorseDecideOpts, HorseGameStateV2 } from './HorseLogic.js';

/**
 * The categorical options switched off in scope: HorseOmahaRuleSites classes the first two groups
 * 'categorical' or 'open'; the third group is the rest of the lane's list (preflop class gates,
 * slowplay and priced-mix random draws, the street-plan priors, the label reads, the hourly mood).
 */
export const OMAHA_NO_CATEGORICAL_RULES_OFF = Object.freeze([
  // HorseOmahaRuleSites: categorical
  'omahaBareOverpairOopFlopCheck',
  'omahaBeatenMadeHandDefense',
  'omahaBluffCatcherFoldVsValueLeader',
  'omahaBluffCatcherRaiseFold',
  'omahaMadeHandDefenseVsValueLeader',
  'omahaNoDrawRaiseOutOfPosition',
  'omahaOopTurnCheckAfterFlopCall',
  'omahaOverpairNoOopBarrelVsValueLeader',
  'omahaPairedRiverNoThinLeadVsValueLeader',
  'omahaPairedTurnNoBarrelWithoutBoatVsValueLeader',
  'omahaPressureNeedsPostflopAggression',
  'omahaRiverNutBlockerBluffReachable',
  'omahaRiverNutRaiseOnly',
  'omahaTurnRiverRaiseNeedsNuts',
  'omahaTurnSetPound',
  'omahaUnderpairNoMultiwayFlopContinue',
  'ploPairedBoardRiverCheck',
  // HorseOmahaRuleSites: open (categorical, not yet replaced)
  'omahaNoRiverBluffIntoValueLeader',
  'omahaOnePairDiscipline',
  'omahaReraisedPotFlopContinueNeedsEquityShape',
  'ploPairedBoardFold',
  // lane UNBLOCK list (owner 8:37 PM): class gates, label reads, priors and random draws
  'v74OmahaSemiBluffNeedsDraw',
  'v81OmahaBigBetCalls',
  'v84OmahaRiverReraiseCalls',
  'omahaNoCallColdFourBetWithoutPremium',
  'omahaOopReraisedPotStrongRange',
  'omahaReraiseRangeEarlyPosition',
  'omahaReraiseRangeOutOfPosition',
  'omahaReraisedPotDiscipline',
  'omahaReraisedPotStackOffFold',
  'omahaReraisedFoldVsTight',
  'omahaTightOpponent',
  'omahaMultiwayWeakHandNoBet',
  'omahaMultiwayRiverCallNeedsStrength',
  'omahaStrongHandSlowplayMix',
  'omahaSlowplayMixInLightning',
  'omahaPricedMix',
  // omahaStreetPlan and omahaStreetPlanThreeWay are NOT here (lead ruling 2026-11-20, lane BLANKET-AUDIT): they
  // price the turn check and each bet as whole lines over every exact river card (HorseOmahaStreetPlan.ts); only
  // their fallback range (a fixed keep share of a fixed sample) is categorical, declared 'partly' in
  // HorseOmahaRuleBasis.ts. Exact replay on the serving build 26c2e74930dd (424 decisions where it fired): off
  // turned 366 turn checks into bets. A first all-chip grade of that (-1,588 +/- 330) was asymmetric and is
  // superseded: the symmetric grade of the same row-off is +1,118 +/- 112 (Horse-only, 2026-11-21) and the row is
  // off by the lead's decision. They stay out of this list because they are priced in form, not because off loses.
  'omahaStreetPlanFlop',
  'omahaTurnBetNeedsRiverPlan',
  'v9Mood',
] as const satisfies readonly (keyof HorseDecideOpts)[]);

const IN_SCOPE_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);

/** A PLO4 or PLO5 cash decision on one board, no hi-lo, no bomb pot (HorseLogic.isTournamentMode's reading). */
export function omahaNoCategoricalRulesInScope(player: SeatPlayer, gs: HorseGameStateV2): boolean {
  try {
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    if (!IN_SCOPE_VARIANTS.has(variant)) return false;
    const tournament = gs.gameMode
      ? gs.gameMode === 'tournament'
      : gs.tournament != null || (gs.bigBlind ?? 0) >= 10;
    if (tournament) return false;
    if (gs.variantRules?.splitLow8OrBetter === true) return false;
    if ((gs.boardCount ?? 1) !== 1 || gs.communityCards2?.length || gs.communityCards3?.length)
      return false;
    if (gs.bombPot === true) return false;
    const hole = player.cards ?? [];
    return hole.length === (variant === 'plo4' ? 4 : 5);
  } catch {
    return false;
  }
}

/** The option is on and this decision is in its scope. */
export function omahaNoCategoricalRulesHolds(
  opts: HorseDecideOpts,
  player: SeatPlayer,
  gs: HorseGameStateV2
): boolean {
  return opts.omahaNoCategoricalRules === true && omahaNoCategoricalRulesInScope(player, gs);
}

/**
 * The options this decision runs with: unchanged when the option is off or the decision is out of
 * scope (the same object, so off is byte-identical); otherwise a copy with every categorical option off.
 */
export function withoutOmahaCategoricalRules(
  opts: HorseDecideOpts,
  player: SeatPlayer,
  gs: HorseGameStateV2
): HorseDecideOpts {
  if (!omahaNoCategoricalRulesHolds(opts, player, gs)) return opts;
  const out: Record<string, unknown> = { ...opts };
  for (const name of OMAHA_NO_CATEGORICAL_RULES_OFF) out[name] = false;
  return out as HorseDecideOpts;
}
