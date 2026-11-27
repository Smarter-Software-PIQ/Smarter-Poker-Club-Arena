/**
 * SHADOW STAGE FOR THE DARK PLO4/PLO5 CASH OPTIONS (2026-11-20, PLO-OWNER lane SHADOW), AND FOR THE HOLD'EM OPTIONS
 * (2026-11-24, PLO-OWNER lead-6: any registered option that declares an entry, whatever its game).
 *
 * WHY. A dark option cannot be graded offline alone: replays find too few decisions with a person in the hand. The
 * option shadow (HorseOptionShadow.ts, Horse Switch lane) already re-decides a committed decision once with one
 * option flipped and journals the counterfactual, never acting on it. For the options listed here (and only for them)
 * this file fits that shadow to a live trial:
 *  - SCOPE: a listed option is re-decided only in a decision of one of its listed GAMES (optionShadowStageGameOf) and
 *    streets. The games: 4 and 5 (PLO4 / PLO5 cash, table and Lightning; the scope the omaha option game scope reads,
 *    omahaOptionGameOf, exactly as before 2026-11-24), and nlh_cash, nlh_lightning, nlh_tournament (no-limit hold'em,
 *    two hole cards, one board, no bomb pot; tournament by HorseLogic.isTournamentMode's reading, Lightning by the
 *    public memory domain's speed). Never PLO6, PLO8, short deck, fixed limit or a game an entry does not list: there
 *    it is left out before the pick, so it spends no budget.
 *  - ACTED-TIME BUDGET: 50 ms instead of the shadow's 15 ms (most priced Omaha postflop decisions take over 15 ms).
 *  - SAMPLING: a hand with no person dealt in takes at most OPTION_SHADOW_STAGE_HORSE_ONLY_PER_MINUTE re-decisions
 *    per worker per clock minute; the rest of the shadow's per-minute budget is left for hands with a person dealt
 *    in. This orders a measurement only: no decision reads it.
 *  - LATENCY BREAKER (automatic self-disable): per option and worker, one re-decision over 150 ms, or three over
 *    50 ms within the last 20, stops that option's re-decisions in this worker until the worker restarts. A
 *    re-decision is charged the time it actually ran (2026-11-23, see optionShadowStageChargedMs): its wall time, or
 *    the worker thread's own CPU time over the same span when that is lower, so a pause of the thread that the
 *    re-decision did not cause (descheduled, waiting) is not charged to the option.
 *  - COMPANIONS: an option that acts only with another option on (the math core's street flag needs omahaMathCore)
 *    is re-decided with the companion true as well when it is flipped to true.
 *  - WHAT A TRIAL SHOWS (2026-11-24): besides option_shadow_<option>_<changed|same>_seen, a staged re-decision in a
 *    hold'em game that changed the action counts its direction, option_shadow_<option>_dir_<from>_to_<to>_seen (or
 *    _dir_size_seen when only the amount moved; + _person_seen with a person dealt in), and its time is noted per
 *    game, latency scope option_shadow_stage_redecide_game_<plo4|plo5|nlh_cash|nlh_lightning|nlh_tournament>, beside
 *    the scope option_shadow_stage_redecide it always had. Since 2026-11-27 a changed PLO re-decision counts the same
 *    direction counters and its street x size cell (optionShadowStagePloDirectionKeys), and every stage skip, slow
 *    re-decision and trip is also counted per option (optionShadowStageOptionSkipKeys), so up to
 *    OPTION_SHADOW_STAGE_MAX_ROWS rows in shadow are read apart.
 *
 * REGISTERING AN OPTION (one line). Add `<option>: holdemStage(['nlh_cash', 'nlh_lightning'], ['flop'])` (or an
 * Omaha entry) to OPTION_SHADOW_STAGE. A registered option whose name says it is priced (/pric/i) and that takes
 * shadow or on_shadow must be listed there or in OPTION_SHADOW_STAGE_UNSTAGED with the reason it cannot be staged:
 * the law aPricedOptionDeclaresAShadowStageEntry.law.test.ts fails otherwise (optionShadowStageRegistrationGaps).
 *
 * TIMING (2026-11-20, VERIFIER V52). Nothing of a staged re-decision runs before the answer is sent: up to the
 * FAST_RESULT the worker does exactly what it does with no row, and reads no seat of the table for the stage. After
 * the answer the pick is handed over; when its job has ended it is dropped at once if any request is waiting,
 * otherwise it is put on the worker's one lane behind an event-loop turn and starts only if the worker is still idle
 * and no job has started since its decision (the Horse memory is what the decision left). The stage's gates (acted
 * time, governor scale, breaker, Horse-only cap, the shared per-minute budget) are taken then. Its receipt cannot
 * ride in its own decision's journal record (already written). It adds NO journal record kind (an engine of an older
 * release rejects an unknown kind, and after a rollback would meet it in a segment): it is held in the worker (at
 * most 8, older ones dropped and counted option_shadow_stage_receipt_dropped_seen) and rides in the NEXT decision
 * record that worker journals, field `stagedOptionShadowReceipts`: [{ decisionKey, requestId, decisionTimeMs,
 * receipt }], each naming the decision it re-decided. A reader joins on decisionKey. Receipts held when a worker
 * stops are lost (a measurement sample, never a decision). What remains: a request that arrives WHILE a
 * re-decision is running waits for it to end (at most one re-decision; the breaker bounds how long and how often).
 *
 * WHAT IT NEVER DOES. It runs after the acted decision is final and changes nothing of it (the law
 * aListedOptionInShadowStageNeverChangesTheActedDecision.test.ts, PLO4 cash, NLH cash, Lightning and tournament). It
 * adds no row, no state and no setting: a listed option is staged by the same `shadow` row as any option. With no
 * listed option in shadow nothing here runs past a name lookup. It reads no hole card value, no opponent identity
 * and no person/Horse fact for any decision.
 */
import { omahaOptionGameOf, type OmahaOptionGame } from './HorseOmahaOptionGameScope.js';
import { v81StreetWager, type V81Action } from './HorseOmahaBigBetCalls.js';

/** A hold'em game of the stage: no-limit hold'em cash table, cash Lightning, or a tournament. */
export type OptionShadowStageHoldemGame = 'nlh_cash' | 'nlh_lightning' | 'nlh_tournament';
/** A game of the stage: 4 = PLO4 cash, 5 = PLO5 cash (table and Lightning), or a hold'em game. */
export type OptionShadowStageGame = OmahaOptionGame | OptionShadowStageHoldemGame;
export const OPTION_SHADOW_STAGE_GAMES: readonly OptionShadowStageGame[] = Object.freeze([
  4,
  5,
  'nlh_cash',
  'nlh_lightning',
  'nlh_tournament',
] as const);

export interface OptionShadowStageEntry {
  /** The games the option is re-decided in (OptionShadowStageGame). */
  readonly games: readonly OptionShadowStageGame[];
  /** The streets it is re-decided on (gameState.stage); absent = every street. */
  readonly streets?: readonly string[];
  /** Options passed true with it when it is flipped to true. */
  readonly companions?: readonly string[];
}
export type OptionShadowStageTable = Readonly<Record<string, OptionShadowStageEntry>>;

const PLO4_PLO5: OptionShadowStageEntry = Object.freeze({ games: Object.freeze([4, 5] as const) });

/** A hold'em entry in one line: its games and, when it acts on some streets only, those streets. */
export function holdemStage(
  games: readonly OptionShadowStageHoldemGame[],
  streets?: readonly string[]
): OptionShadowStageEntry {
  return Object.freeze({
    games: Object.freeze([...games]),
    ...(streets ? { streets: Object.freeze([...streets]) } : {}),
  });
}

/**
 * The staged options. A name the registry does not hold, or that does not take shadow there, is inert (the shadow
 * only ever picks a registered option in shadow or on_shadow). omahaOpponentLifetimeHud is NOT listed: in shadow
 * nothing arms its lifetime record, so a flipped re-decision would read "same" falsely. The math core's street flags
 * were taken out on 2026-11-20 (VERIFIER V59: a re-decision with the core cost 50-125 ms on PLO5 postflop, and a
 * request arriving on the same worker would wait behind it). omahaMathCorePlo5Flop returns on 2026-11-21 (lead-2
 * order, lane CORE-POOLED-3) because that cost is now lower: the core's 2+3 evaluator is table driven and it does no
 * work on a street whose flag is off, so a PLO5 flop decision with the core on costs p50 14.0 / p95 28.8 / max 39.9 ms
 * in all (added p50 11.5 / p95 26.5 ms; CRITERIA-CORE-POOLED-3-LATENCY-AMEND run, load 16), under the breaker's 50 ms
 * slow line. It is staged on PLO5 flop only, with omahaMathCore as its companion (the street flag acts only with it).
 * The other core street flags stay out. Like every listed name it re-decides only once its registry entry takes
 * shadow (a release-default classification, a separate switch-list change).
 */
export const OPTION_SHADOW_STAGE: OptionShadowStageTable = Object.freeze({
  // OPPONENT-HUD-9 2026-11-21: the lifetime-HUD consumer re-decides postflop (its only scope) while the store option is
  // on and has attached the packet; with the store off no packet exists and the re-decision reads "same" (no reads).
  omahaOpponentLifetimeHudDecides: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['flop', 'turn', 'river']),
    companions: Object.freeze(['omahaOpponentLifetimeHud']),
  }),
  // PLO-OWNER lead-4 B4 2026-11-21: priced six-max preflop read on lifetime HUD cells
  omahaPreflopReadIsPricedFromLifetime: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['preflop']),
    companions: Object.freeze(['omahaOpponentLifetimeHud']),
  }),
  omahaBetSizeIsPricedForTheRange: PLO4_PLO5,
  omahaRiverCheckedToBetIsMeasured: PLO4_PLO5,
  omahaRiverFirstToActBetIsPriced: PLO4_PLO5,
  omahaFlopBetIsPricedOnHisResponse: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['flop']),
  }),
  omahaFourBetFoldPricedCall: PLO4_PLO5,
  // PLO lead-6 2026-11-24: preflop facing a 3-bet or more only
  omahaReraisedPotCallIsPriced: PLO4_PLO5,
  omahaReraisedPotReraiseIsPriced: PLO4_PLO5,
  // lead-8 lane preflop 2026-11-27: preflop facing a 3-bet or more only
  omahaReraisedPotFoldReraiseIsPriced: PLO4_PLO5,
  // lead-8 lane limprr 2026-11-27: preflop only (a first-in limp, and the Horse's own limp facing one raise)
  omahaLimpReraiseVsIsoRaiser: PLO4_PLO5,
  // PLO-LEAD-6 2026-11-24: acts only preflop, facing one open out of position
  omahaOopReraiseRangeHoldsVsReraise: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['preflop']),
  }),
  // PLO-LEAD-6 2026-11-24: the same spot, reading the opener's own record
  omahaOopReraiseRangeReadsOpenerRecord: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['preflop']),
  }),
  // PLO lead-7 2026-11-26: the position term of the priced call of a re-raise, preflop only
  omahaReraisedPositionVsEveryoneToAct: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['preflop']),
  }),
  omahaStabDefenceIsPriced: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['turn', 'river']),
  }),
  // PLO-OWNER lead-6 2026-11-24: each acts only on the postflop streets listed (the facing-bet verdicts and the
  // multiway value bet), so none is re-decided preflop or on another street.
  omahaFacingBetRangeIsMeasuredByLine: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['turn', 'river']),
  }),
  omahaFacingBetIndifferenceCalls: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['flop', 'turn', 'river']),
  }),
  omahaFlopRealizationIsPriced: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['flop']),
  }),
  omahaFacingBetMinimumDefencePrior: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['flop', 'turn', 'river']),
  }),
  omahaFacingBetPriorIsPeopleMeasured: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['turn', 'river']),
  }),
  omahaFlopPressureCapIsPriced: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['flop']),
  }),
  omahaFacingBetFieldIsJoint: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['turn', 'river']),
  }),
  omahaMultiwayFieldIsPeopleMeasured: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['turn', 'river']),
  }),
  omahaPeoplePriorCountsHiddenBets: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['flop', 'turn']),
  }),
  omahaMultiwayCallNeedsNutShare: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['flop', 'turn', 'river']),
  }),
  omahaTurnFacingBetPriorIsLineSplit: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['turn']),
  }),
  omahaMultiwayValueBetIsPriced: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['flop', 'turn', 'river']),
  }),
  omahaRiverBetFoldIsHisRecord: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['river']),
  }),
  omahaRiverBetFoldIsPeopleMeasured: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['river']),
  }),
  omahaRiverBetCheckIsHisRecord: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['river']),
  }),
  // PLO-OWNER lead-7 2026-11-26: each acts only on a heads-up river check (nothing to call)
  omahaRiverValueBetInPositionIsPriced: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['river']),
  }),
  omahaRiverBluffIsPricedOnBlockers: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['river']),
  }),
  // PLO-OWNER lead-7 lane plo-bluffs 2026-11-26: each acts only on a heads-up check with nothing to call
  omahaTurnBluffIsPricedOnBlockers: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['turn']),
  }),
  omahaTurnBluffIsPricedOnRangeAdvantage: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['turn']),
  }),
  omahaRiverBluffIsPricedOnRangeAdvantage: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['river']),
  }),
  omahaRiverTripsBoardBoatIsNotNutClass: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['river']),
  }),
  omahaFlopRaiseIsPriced: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['flop']),
  }),
  omahaCbetRaiseIsPriced: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['flop']),
  }),
  omahaBigBetSizeIsPriced: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['flop', 'turn', 'river']),
  }),
  // PLO-OWNER lead-5 2026-11-22: the first acts only on the turn and river facing a wager, the second only on
  // the river (the boat stage it follows is a river stage), so neither is re-decided on another street.
  omahaPricedRaiseNeverMakesNonNutRaise: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['turn', 'river']),
  }),
  omahaLateFlattenedCallIsPriced: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['river']),
  }),
  omahaBigDrawBetIsPricedOnHisResponse: Object.freeze({
    games: Object.freeze([4, 5] as const),
    streets: Object.freeze(['flop', 'turn']),
  }),
  omahaMathCorePlo5Flop: Object.freeze({
    games: Object.freeze([5] as const),
    streets: Object.freeze(['flop']),
    companions: Object.freeze(['omahaMathCore']),
  }),
  // PLO-OWNER lead-6 2026-11-24 (HOLD'EM SHADOW): the hold'em options meant to be trialled, each in the games and
  // streets it acts in (its switch scope). Open branches add theirs here, one line each.
  // NLH cash (table and Lightning), heads-up postflop
  holdemValueAndCallsArePriced: holdemStage(
    ['nlh_cash', 'nlh_lightning'],
    ['flop', 'turn', 'river']
  ),
  // hold'em tournaments: preflop all-in calls and postflop calls facing a jam (every street)
  holdemTournamentAllInCallIsPriced: holdemStage(['nlh_tournament']),
  // hold'em tournaments preflop: a blind facing a non-all-in open (heads-up and three or more dealt) and a non-all-in
  // re-raise after the Horse's own raise or a committing raise (the raise defence wiring acts preflop only)
  holdemTournamentHeadsUpBigBlindDefenceIsPriced: holdemStage(['nlh_tournament'], ['preflop']),
  holdemTournamentBlindDefenceIsPriced: holdemStage(['nlh_tournament'], ['preflop']),
  holdemTournamentCommittedRaiseIsPriced: holdemStage(['nlh_tournament'], ['preflop']),
  // plo-lead7 tourney-postflop 2026-11-26: the tournament bluff after the flop, heads-up in the pot, not facing a wager
  holdemTournamentRiverBluffIsPriced: holdemStage(['nlh_tournament'], ['river']),
  holdemTournamentTurnBluffIsPriced: holdemStage(['nlh_tournament'], ['turn']),
  // NLH cash preflop facing a single open (the V85/V87 defence path reads it at cash tables, Lightning included)
  cashDefenceTrimColdCalls: holdemStage(['nlh_cash', 'nlh_lightning'], ['preflop']),
  // plo-lead7 2026-11-25: the opening side of NLH cash, heads-up, not facing a wager (value: every postflop street;
  // bluff: turn and river)
  holdemOpeningValueBetIsPriced: holdemStage(
    ['nlh_cash', 'nlh_lightning'],
    ['flop', 'turn', 'river']
  ),
  holdemOpeningBluffIsPriced: holdemStage(['nlh_cash', 'nlh_lightning'], ['turn', 'river']),
  // plo-lead7 2026-11-26: the first bet of the turn or river against two or more opponents (NLH cash)
  holdemMultiwayOpeningBluffIsPriced: holdemStage(['nlh_cash', 'nlh_lightning'], ['turn', 'river']),
  holdemMultiwayOpeningValueBetIsPriced: holdemStage(
    ['nlh_cash', 'nlh_lightning'],
    ['turn', 'river']
  ),
  // lead-8 2026-11-27: the NLH cash heads-up river bluff priced on people's river fold (river only)
  holdemRiverBluffIsPricedOnPeople: holdemStage(['nlh_cash', 'nlh_lightning'], ['river']),
});

/**
 * THE PRICED OPTIONS THAT ARE NOT STAGED, AND WHY (2026-11-24). A registered option whose name says it is priced and
 * that takes shadow or on_shadow is either in OPTION_SHADOW_STAGE or here (optionShadowStageRegistrationGaps). These
 * keep the inline option shadow (15 ms acted budget, re-decided before the answer, no breaker), exactly as before.
 */
const PREDATES =
  'listed before the staging rule (2026-11-24): keeps the inline option shadow until its lane adds an entry and measures its re-decision cost';
const PLO6 =
  'a PLO6 option: PLO6 is not a game of the stage (its re-decision cost is not measured)';
const EVERY_GAME =
  'acts in every game: an entry would have to list every game, and its re-decision cost is not measured outside hold-em';
export const OPTION_SHADOW_STAGE_UNSTAGED: Readonly<Record<string, string>> = Object.freeze({
  tokenCallPrice: EVERY_GAME,
  callDeductionPricing: EVERY_GAME,
  omahaPreflopReraiseDefencePricedInPosition: PREDATES,
  omahaReraisedCallVsRaisePriced: PREDATES,
  omahaPreflopJamFacingReraiseIsPriced: PREDATES,
  omahaPairedBoardFoldRespectsPrice: PREDATES,
  omahaStrongHandCheckIsPriced: PREDATES,
  omahaTurnStabDefenceIsPriced: PREDATES,
  omahaRiverBluffCatchIsPriced: PREDATES,
  // the inline-shadow fixture of anOptionInShadowNeverChangesTheActedDecision.test.ts and the staged fixture of
  // aListedOptionInShadowStageNeverChangesTheActedDecision.test.ts (which stages it by its own table)
  omahaTurnRiverRaiseIsPriced: 'the inline shadow test fixture: ' + PREDATES,
  omahaDrawRaiseIsPriced: PREDATES,
  omahaOopTurnBarrelIsPriced: PREDATES,
  omahaPressureIsPriced: PREDATES,
  omahaBigBetCallsArePriced: PREDATES,
  omahaUnderpairMultiwayIsPriced: PREDATES,
  omahaSampledRaiseIsPricedAtEverySize: PREDATES,
  omahaTurnSetSizeIsPriced: PREDATES,
  omahaBlockerBluffIsPriced: PREDATES,
  omahaPricedInLightning: PREDATES,
  plo6ManiacPriceRefusalToRangePlay: PLO6,
  plo6FacingBetIsPricedV2: PLO6,
  holdemRiverFullHouseValueIsPriced: PREDATES,
  huBbDefendsUnreadToPrice: PREDATES,
});

/** A priced option by name: the options the registration law holds to a stage entry or a stated reason. */
export const OPTION_SHADOW_STAGE_PRICED_NAME = /pric/i;

/**
 * The registration gaps: every registered option that takes shadow or on_shadow and is priced by name (or is
 * staged) must be staged or have a stated reason, never both; a staged or reasoned name must not be off-only.
 * Empty when the registration holds.
 */
export function optionShadowStageRegistrationGaps(
  registry: ReadonlyArray<{ readonly name: string; readonly states: readonly string[] }>,
  table: OptionShadowStageTable = OPTION_SHADOW_STAGE,
  unstaged: Readonly<Record<string, string>> = OPTION_SHADOW_STAGE_UNSTAGED
): string[] {
  const gaps: string[] = [];
  const byName = new Map(registry.map((e) => [e.name, e]));
  for (const e of registry) {
    const shadowable = e.states.includes('shadow') || e.states.includes('on_shadow');
    if (!shadowable || !OPTION_SHADOW_STAGE_PRICED_NAME.test(e.name)) continue;
    const staged = Object.hasOwn(table, e.name);
    const reason = Object.hasOwn(unstaged, e.name) ? String(unstaged[e.name] ?? '').trim() : null;
    if (!staged && reason === null)
      gaps.push(
        `${e.name}: a priced option declares a shadow stage entry or states why it cannot be staged`
      );
    if (staged && reason !== null) gaps.push(`${e.name}: both staged and listed as not staged`);
    if (reason === '') gaps.push(`${e.name}: the reason it cannot be staged is empty`);
  }
  for (const name of Object.keys(unstaged)) {
    const e = byName.get(name);
    if (!e) gaps.push(`${name}: listed as not staged but not registered`);
    else if (!e.states.includes('shadow') && !e.states.includes('on_shadow'))
      gaps.push(`${name}: listed as not staged but takes neither shadow nor on_shadow`);
  }
  for (const [name, entry] of Object.entries(table)) {
    if (entry.games.length === 0) gaps.push(`${name}: a stage entry lists no game`);
    for (const g of entry.games)
      if (!OPTION_SHADOW_STAGE_GAMES.includes(g))
        gaps.push(`${name}: unknown stage game ${String(g)}`);
  }
  return gaps;
}

/** The acted decision may have taken this long and a listed option is still re-decided. */
export const OPTION_SHADOW_STAGE_ACTED_BUDGET_MS = 50;
/** A staged re-decision over this is a slow one. */
export const OPTION_SHADOW_STAGE_SLOW_MS = 50;
/** One staged re-decision over this disables the option in this worker at once. */
export const OPTION_SHADOW_STAGE_HARD_MS = 150;
/** This many slow ones within the last OPTION_SHADOW_STAGE_WINDOW disable it. */
export const OPTION_SHADOW_STAGE_SLOW_STRIKES = 3;
export const OPTION_SHADOW_STAGE_WINDOW = 20;
/** Staged re-decisions per worker per clock minute in hands with no person dealt in. */
export const OPTION_SHADOW_STAGE_HORSE_ONLY_PER_MINUTE = 2;

/**
 * THE TIME A STAGED RE-DECISION IS CHARGED (2026-11-23, PLO-OWNER lead-5 PHASE4).
 *
 * WHY. The breaker read wall time only, so a pause of the worker thread during a re-decision was charged to the
 * option. Live, serving 735299cd5fda (2026-11-23 04:33-08:06Z, horse_brain_flush_receipts): omahaMathCorePlo5Flop
 * re-decided 727 times, avg 17.0 ms, and one re-decision of 195.8 ms (07:21:25-07:22:25Z, worker 78ffa527) tripped
 * the one-over-150 ms rule, while that worker's 16 PLO5 and 32 hold'em acted decisions of the same minute took at
 * most 41.4 ms. Five of the 727 took 100-200 ms (0.69%), against 80 of 137,292 acted decisions (0.058%) on the
 * engine's eight workers, and in those five minutes no acted decision of the same worker took over 78 ms. On the Mac
 * (origin/main 608f33c5, Node 22.23.3, 10,000 PLO5 flop core decisions over 624 states) the same path used at most
 * 27.5 ms of thread CPU once warm (p99.9 18.7 ms), and its one 146.1 ms wall reading used 27.5 ms of CPU. On
 * 2026-11-22 19:32Z (ea92b56f) omahaStabDefenceIsPriced, a 1.4-6.4 ms re-decision, tripped the same rule at 392.2 ms.
 *
 * WHAT. A re-decision is charged min(wall, thread CPU): the CPU the worker thread itself spent between the
 * re-decision's start and end (process.threadCpuUsage reads the calling thread only; process.cpuUsage would add every
 * other thread of the process). A re-decision that is slow because it computes is on the CPU for that time, so it is
 * charged its wall time less only the time its thread did not run, and a slow option trips at the same re-decision
 * as before. With no CPU reading (NaN, negative, absent, or a runtime without threadCpuUsage) the charge is the wall
 * time, exactly as before; a wall time that is not a number is charged as such and trips, as before. The charge is
 * never above the wall time, so the breaker trips nowhere it did not trip before. Charged: work on the worker thread
 * inside the re-decision, its own share of garbage collection included. Not charged: time the thread did not run
 * (descheduled, or blocked in a synchronous wait); the staged decide path does no synchronous I/O (the core reads
 * its tables when its modules load).
 */
export function optionShadowStageChargedMs(wallMs: number, threadCpuMs?: number | null): number {
  if (typeof threadCpuMs !== 'number' || !Number.isFinite(threadCpuMs) || threadCpuMs < 0)
    return wallMs;
  return threadCpuMs < wallMs ? threadCpuMs : wallMs;
}

/** True when the wall time alone would have been a slow (or hard) re-decision and the charged time is not. */
export function optionShadowStageWallOnlySlow(
  wallMs: number,
  threadCpuMs?: number | null
): boolean {
  return (
    wallMs > OPTION_SHADOW_STAGE_SLOW_MS &&
    !(optionShadowStageChargedMs(wallMs, threadCpuMs) > OPTION_SHADOW_STAGE_SLOW_MS)
  );
}

export function optionShadowStaged(
  option: string | null | undefined,
  table: OptionShadowStageTable = OPTION_SHADOW_STAGE
): boolean {
  return typeof option === 'string' && Object.hasOwn(table, option);
}

interface StageGameState {
  readonly gameVariant?: unknown;
  readonly gameMode?: unknown;
  readonly tournament?: unknown;
  readonly bigBlind?: unknown;
  readonly bombPot?: unknown;
  readonly boardCount?: unknown;
  readonly communityCards2?: readonly unknown[] | null;
  readonly communityCards3?: readonly unknown[] | null;
  readonly publicMemoryDomain?: { readonly speed?: unknown } | null;
}

/**
 * The hold'em game of a decision: no-limit hold'em (gameVariant nlh), two hole cards, one board, no bomb pot.
 * A tournament by HorseLogic.isTournamentMode's reading (gameMode when set, else a tournament object or a big
 * blind of 10 or more); a cash decision is Lightning when its public memory domain's speed says so. Null otherwise.
 * Reads the hole card COUNT only. Never throws.
 */
export function optionShadowStageHoldemGameOf(
  player: unknown,
  gameState: unknown
): OptionShadowStageHoldemGame | null {
  try {
    const gs = gameState as StageGameState | null;
    if (!gs || String(gs.gameVariant ?? '').toLowerCase() !== 'nlh') return null;
    const cards = (player as { cards?: unknown } | null)?.cards;
    if (!Array.isArray(cards) || cards.length !== 2) return null;
    if ((gs.boardCount ?? 1) !== 1 || gs.communityCards2?.length || gs.communityCards3?.length)
      return null;
    if (gs.bombPot === true) return null;
    const tournament = gs.gameMode
      ? gs.gameMode === 'tournament'
      : gs.tournament != null || Number(gs.bigBlind ?? 0) >= 10;
    if (tournament) return 'nlh_tournament';
    return gs.publicMemoryDomain?.speed === 'lightning' ? 'nlh_lightning' : 'nlh_cash';
  } catch {
    return null;
  }
}

/** The stage game of a decision: PLO4/PLO5 cash exactly as omahaOptionGameOf reads it, else its hold'em game. */
export function optionShadowStageGameOf(
  player: unknown,
  gameState: unknown
): OptionShadowStageGame | null {
  let game: OptionShadowStageGame | null = null;
  try {
    game = omahaOptionGameOf(
      player as Parameters<typeof omahaOptionGameOf>[0],
      gameState as Parameters<typeof omahaOptionGameOf>[1]
    );
  } catch {
    game = null;
  }
  return game ?? optionShadowStageHoldemGameOf(player, gameState);
}

/** The name a stage game is noted under (latency scope option_shadow_stage_redecide_game_<code>). */
export function optionShadowStageGameCode(game: OptionShadowStageGame): string {
  return game === 4 ? 'plo4' : game === 5 ? 'plo5' : game;
}

/** True for a hold'em game of the stage (the per-direction counters are taken there). */
export function optionShadowStageIsHoldem(
  game: OptionShadowStageGame | null | undefined
): game is OptionShadowStageHoldemGame {
  return game === 'nlh_cash' || game === 'nlh_lightning' || game === 'nlh_tournament';
}

const DIRECTION_ACTIONS: Readonly<Record<string, string>> = Object.freeze({
  fold: 'fold',
  check: 'check',
  call: 'call',
  bet: 'bet',
  raise: 'raise',
  all_in: 'allin',
  allin: 'allin',
  'all-in': 'allin',
});

/**
 * What a changed re-decision would have changed: `<from>_to_<to>` over fold, check, call, bet, raise, allin (any
 * other action reads `other`), or `size` when the action is the same and only the amount moved (fold_to_call,
 * call_to_fold, raise_to_call, check_to_bet, bet_to_check, size, ...). Null for a receipt that did not change.
 */
export function optionShadowStageDirection(receipt: {
  readonly changed: boolean;
  readonly actual: { readonly action: string };
  readonly would: { readonly action: string } | null;
}): string | null {
  if (!receipt.changed || !receipt.would) return null;
  const from = DIRECTION_ACTIONS[String(receipt.actual.action).toLowerCase()] ?? 'other';
  const to = DIRECTION_ACTIONS[String(receipt.would.action).toLowerCase()] ?? 'other';
  return from === to ? 'size' : `${from}_to_${to}`;
}

/** The per-direction counters of one changed staged receipt (empty when it did not change). */
export function optionShadowStageDirectionKeys(receipt: {
  readonly option: string;
  readonly changed: boolean;
  readonly personDealt: boolean;
  readonly actual: { readonly action: string };
  readonly would: { readonly action: string } | null;
}): string[] {
  const dir = optionShadowStageDirection(receipt);
  if (dir === null) return [];
  const key = `option_shadow_${receipt.option}_dir_${dir}`;
  return receipt.personDealt ? [`${key}_seen`, `${key}_person_seen`] : [`${key}_seen`];
}

/**
 * PLO DIRECTION BY STREET AND SIZE (2026-11-27, PLO-OWNER lead-8 lane acttool).
 *
 * WHY. A PLO trial read only same/changed: the lead could not tell from the counters whether a changed re-decision
 * was a fold that would call (the over-fold fixes) or a call that would fold, nor on which street and against which
 * size; the per-decision receipts sit in the engine-host journal only. A PLO re-decision now counts the same
 * direction counters as hold'em, option_shadow_<option>_dir_<from>_to_<to>_seen (+ _person_seen), and beside them
 * the cell, option_shadow_<option>_cell_<street>_<size>_<from>_to_<to>_seen (+ _person_seen): <street> preflop, flop,
 * turn, river (other for anything else), <size> the wager the decision faced as a share of the pot just before it,
 * measured as the bet read measures it (v81StreetWager): facing_lt40 (under 0.4 pot), facing_40to70 (0.4 to under
 * 0.7), facing_70plus (0.7 or more), facing_raise (the street already had a bet and a raise), facing_unread (it faced
 * a wager the street's actions do not reproduce), unopened (nothing to call), any (preflop). The bands are the cells
 * the over-fold audit and alarm grade on. Only a CHANGED PLO receipt of the staged path reads this, after the answer:
 * it reads the public action history, the street bets and the pot only (never a card), costs one pass over the
 * street's actions, and never throws.
 */
export type OptionShadowStagePloSize =
  | 'any'
  | 'unopened'
  | 'facing_lt40'
  | 'facing_40to70'
  | 'facing_70plus'
  | 'facing_raise'
  | 'facing_unread';

const PLO_CELL_STREETS: ReadonlySet<string> = new Set(['preflop', 'flop', 'turn', 'river']);

interface StagePloSeat {
  readonly seat?: unknown;
  readonly bet?: unknown;
}

/** The size cell of a PLO decision (see above). Public actions, street bets and the pot only; never throws. */
export function optionShadowStagePloSize(
  player: unknown,
  gameState: unknown
): OptionShadowStagePloSize {
  try {
    const gs = gameState as {
      readonly stage?: unknown;
      readonly pot?: unknown;
      readonly players?: readonly StagePloSeat[];
      readonly actionHistory?: readonly V81Action[];
    } | null;
    const street = String(gs?.stage ?? '').toLowerCase();
    if (street === 'preflop') return 'any';
    const hero = player as StagePloSeat | null;
    const heroBet = Number(hero?.bet ?? 0);
    const bets = new Map<number, number>();
    let maxBet = 0;
    for (const p of gs?.players ?? []) {
      const b = Number(p?.bet ?? 0);
      if (typeof p?.seat === 'number' && Number.isFinite(b)) bets.set(p.seat, b);
      if (Number.isFinite(b) && b > maxBet) maxBet = b;
    }
    if (!(maxBet > (Number.isFinite(heroBet) ? heroBet : 0) + 0.005)) return 'unopened';
    let wagers = 0;
    for (const a of gs?.actionHistory ?? [])
      if (
        String(a?.stage) === street &&
        (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in') &&
        Number(a.amount) > 0
      )
        wagers++;
    if (wagers >= 2) return 'facing_raise';
    const faced = v81StreetWager(gs?.actionHistory, street, bets, Number(gs?.pot ?? 0));
    if (!faced || faced.bettorSeat === hero?.seat) return 'facing_unread';
    const frac = faced.wager / faced.potBefore;
    if (!Number.isFinite(frac) || !(frac > 0)) return 'facing_unread';
    return frac < 0.4 ? 'facing_lt40' : frac < 0.7 ? 'facing_40to70' : 'facing_70plus';
  } catch {
    return 'facing_unread';
  }
}

/**
 * The counters of one changed staged PLO receipt: the direction (as hold'em) and its street x size cell. Empty when
 * it did not change; the size is read only then.
 */
export function optionShadowStagePloDirectionKeys(
  receipt: {
    readonly option: string;
    readonly changed: boolean;
    readonly personDealt: boolean;
    readonly street: string;
    readonly actual: { readonly action: string };
    readonly would: { readonly action: string } | null;
  },
  player: unknown,
  gameState: unknown
): string[] {
  const dir = optionShadowStageDirection(receipt);
  if (dir === null) return [];
  const keys = optionShadowStageDirectionKeys(receipt);
  const s = String(receipt.street ?? '').toLowerCase();
  const street = PLO_CELL_STREETS.has(s) ? s : 'other';
  const cell = `option_shadow_${receipt.option}_cell_${street}_${optionShadowStagePloSize(player, gameState)}_${dir}`;
  keys.push(`${cell}_seen`);
  if (receipt.personDealt) keys.push(`${cell}_person_seen`);
  return keys;
}

/**
 * True for a Lightning decision (styleReceiptFormat's reading: not a tournament, public memory speed lightning).
 * The staged PLO receipt counters are counted again under fmt_l_ there (lead-8 2026-11-27: Lightning is about a third
 * of PLO decisions). Never throws.
 */
export function optionShadowStageIsLightning(gameState: unknown): boolean {
  try {
    const gs = gameState as StageGameState | null;
    if (!gs || gs.gameMode === 'tournament' || gs.tournament) return false;
    return gs.publicMemoryDomain?.speed === 'lightning';
  } catch {
    return false;
  }
}

/**
 * PER-OPTION STAGE COUNTERS (2026-11-27, PLO-OWNER lead-8 lane acttool). The stage's skips, breaker and slow
 * re-decisions were counted under shared names only (option_shadow_skipped_<reason>_seen,
 * option_shadow_stage_self_disabled_seen, latency scope option_shadow_stage_redecide), so a trial could be read only
 * with ONE shadow row globally. Each is now also counted under the option it concerns: a staged pick that is skipped
 * counts option_shadow_<option>_stage_skipped_<reason>_seen (+ _person_seen where the shared one has it; reason
 * backlog, budget, scale, stage_disabled, horse_only, rate), a re-decision charged over the slow line counts
 * option_shadow_<option>_stage_slow_seen, a trip counts option_shadow_<option>_stage_self_disabled_seen, and its time
 * goes to latency scope option_shadow_stage_redecide_opt_<option>. The shared names are unchanged. With these, two or
 * three rows in shadow at once are read apart (OPTION_SHADOW_STAGE_MAX_ROWS); nothing decides on them.
 */
export function optionShadowStageOptionSkipKeys(
  option: string,
  reason: string,
  personDealt: boolean
): string[] {
  const key = `option_shadow_${option}_stage_skipped_${reason}`;
  return personDealt ? [`${key}_seen`, `${key}_person_seen`] : [`${key}_seen`];
}

/**
 * THE NUMBER OF ROWS IN SHADOW AT ONCE (2026-11-27, PLO-OWNER lead-8 lane acttool). The engine never had a limit: a
 * decision re-decides at most ONE of the options in shadow that are in its game and street (optionShadowPick, by
 * decision key), so the cost a decision can carry, the per-minute budget, the Horse-only cap and each option's
 * breaker do not grow with the number of rows. What grows is only how the samples of a decision that two options
 * both cover are split between them. The limit of one row was a rule of the read tools (the stage's skip, breaker and
 * latency counters were shared). With the per-option stage counters above, the switch tool admits up to this many
 * rows in shadow or on_shadow at once (scripts/ops/horse-option-switch-lib.mjs checkShadowConcurrency).
 */
export const OPTION_SHADOW_STAGE_MAX_ROWS = 3;

/**
 * The options in shadow this decision may re-decide: every option that is not listed, unchanged and in order, and a
 * listed option only when the decision is in its games and streets. With no listed option in `options` the same
 * array is returned and the decision is not read.
 */
export function optionShadowStageInScope(
  options: readonly string[],
  player: unknown,
  gameState: unknown,
  table: OptionShadowStageTable = OPTION_SHADOW_STAGE
): readonly string[] {
  if (!options.some((o) => Object.hasOwn(table, o))) return options;
  let game: OptionShadowStageGame | null = null;
  let street = '';
  try {
    game = optionShadowStageGameOf(player, gameState);
    street = String((gameState as { stage?: unknown } | null)?.stage ?? '').toLowerCase();
  } catch {
    game = null;
  }
  return options.filter((o) => {
    if (!Object.hasOwn(table, o)) return true;
    const entry = table[o]!;
    if (game === null || !entry.games.includes(game)) return false;
    return !entry.streets || entry.streets.includes(street);
  });
}

/** The companions a staged re-decision passes true: only when the option is flipped to true, only those not on. */
export function optionShadowStageCompanions(
  option: string,
  flippedTo: boolean,
  acted: Readonly<Record<string, unknown>>,
  table: OptionShadowStageTable = OPTION_SHADOW_STAGE
): Readonly<Record<string, true>> {
  const out: Record<string, true> = {};
  if (!flippedTo || !Object.hasOwn(table, option)) return out;
  for (const c of table[option]!.companions ?? []) if (acted[c] !== true) out[c] = true;
  return out;
}

/** Per worker: the latency breaker of each staged option and the Horse-only per-minute cap. */
export class OptionShadowStageGuard {
  private readonly off = new Set<string>();
  private readonly recent = new Map<string, boolean[]>();
  private window = Number.NaN;
  private horseOnlyUsed = 0;

  /** True once the option's breaker has tripped in this worker; it stays true. */
  disabled(option: string): boolean {
    return this.off.has(option);
  }

  /**
   * Records one staged re-decision: its wall time and, when read, the worker thread's CPU time over the same span.
   * It is charged optionShadowStageChargedMs(ms, threadCpuMs). True exactly when this one trips the breaker.
   */
  note(option: string, ms: number, threadCpuMs?: number | null): boolean {
    if (this.off.has(option)) return false;
    ms = optionShadowStageChargedMs(ms, threadCpuMs);
    const slow = !(ms <= OPTION_SHADOW_STAGE_SLOW_MS);
    const ring = this.recent.get(option) ?? [];
    ring.push(slow);
    if (ring.length > OPTION_SHADOW_STAGE_WINDOW) ring.shift();
    this.recent.set(option, ring);
    const strikes = ring.reduce((n, s) => n + (s ? 1 : 0), 0);
    if (!(ms <= OPTION_SHADOW_STAGE_HARD_MS) || strikes >= OPTION_SHADOW_STAGE_SLOW_STRIKES) {
      this.off.add(option);
      this.recent.delete(option);
      return true;
    }
    return false;
  }

  /** A hand with no person dealt in: true at most OPTION_SHADOW_STAGE_HORSE_ONLY_PER_MINUTE times a clock minute. */
  admitHorseOnly(nowMs: number): boolean {
    if (!Number.isFinite(nowMs)) return false;
    const w = Math.floor(nowMs / 60_000);
    if (w !== this.window) {
      this.window = w;
      this.horseOnlyUsed = 0;
    }
    if (this.horseOnlyUsed >= OPTION_SHADOW_STAGE_HORSE_ONLY_PER_MINUTE) return false;
    this.horseOnlyUsed++;
    return true;
  }
}
