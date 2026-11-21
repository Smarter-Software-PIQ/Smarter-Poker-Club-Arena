/**
 * omahaBlanketRowsOffInPlo45Cash (EMERG lane BLANKET-AUDIT 2026-11-21, default OFF; owner 2026-11-20 3:28 PM Chicago:
 * "THERE SHOULD NEVER EVER EVER BY ANY BLANKET RULES"; PLO-OWNER lead ruling 2026-11-21 ~1:55 AM).
 *
 * WHY. Several blanket rules are hidden default-on reads (read `!== false`, no switch row). An OFF row for one of them
 * is global: it changes PLO6 too, and PLO6 must not be touched (owner 2026-11-19 8:27 PM). horse.omahaGameScope cannot
 * help: it only passes an option off in the OTHER of PLO4/PLO5, never confines an off to PLO4/PLO5. The only PLO4/PLO5
 * cash-scoped off was omahaNoCategoricalRules, which takes all of its list at once. This option takes the blanket rows
 * off ONE AT A TIME, in PLO4/PLO5 cash only.
 *
 * HOW IT IS SET. Two parts, both written only by the lead:
 *  - the switch row omahaBlanketRowsOffInPlo45Cash (default OFF, read `=== true`): nothing happens without it;
 *  - the declared list: engine runtime setting `horse.blanketRowOffInPlo45Cash.<option>` = 1 for each member
 *    (runtimeSettings/registry.ts; published with scripts/runtime-settings-publish.ts, live at each table's next hand,
 *    no cutover). It travels in the decision request as `omahaBlanketRowsOffList` (the members whose setting is 1, in
 *    registry order; absent at the compiled defaults, so the request, its key and its journal are byte-identical) and
 *    is journaled and replayed with the request.
 *
 * WHAT IT DOES. HorseLogic.decide and HorseLogic.prepareOriginalReads pass their options through
 * withBlanketRowsOffInPlo45Cash right after the game scope and before omahaNoCategoricalRules or any rule reads them.
 * With the switch on, in a PLO4 or PLO5 cash decision (table or Lightning, one board, no hi-lo, no bomb pot: the scope
 * of omahaNoCategoricalRules), every listed member is passed `false`, which is that rule's off path ("the rule does not
 * run", the same off path omahaNoCategoricalRules uses). Anything else: the same options object.
 *
 * ONLY BLANKET ROWS. A name can be listed only if it is in OMAHA_BLANKET_ROWS_OFF_REGISTRY: the rules of
 * omahaNoCategoricalRules' list (OMAHA_NO_CATEGORICAL_RULES_OFF) that the rule-site register does not class 'priced',
 * then the five named blanket rules of OMAHA_BLANKET_ROWS_OFF_EXTRA that are not on that list
 * (HorseOmahaBlanketRowsOffInPlo45Cash.law.test.ts holds this list equal to that rule). A priced rule therefore cannot
 * be switched off through this option; any other name in the request is ignored.
 *
 * NEVER IN SCOPE: PLO6, PLO8, hold'em, tournaments, bomb pots, hi-lo and multi-board hands, and any decision state that
 * does not carry gameMode 'cash' (the mode is never guessed from the blinds here): the same options object runs
 * whatever is published (byte-identical, decision-level law). No hidden card is read. Nothing here is a threshold or a
 * strategy rule: it only removes blanket rules where they are listed.
 */
import type { SeatPlayer } from '../types.js';
import type { HorseDecideOpts, HorseGameStateV2 } from './HorseLogic.js';
import { omahaNoCategoricalRulesInScope } from './HorseOmahaNoCategoricalRules.js';

export const OMAHA_BLANKET_ROW_OFF_SETTING_PREFIX = 'horse.blanketRowOffInPlo45Cash.';

/**
 * The blanket rows that may be listed: OMAHA_NO_CATEGORICAL_RULES_OFF minus every name the rule-site register classes
 * 'priced', in that list's order, then OMAHA_BLANKET_ROWS_OFF_EXTRA (the law test holds it equal to that rule).
 */
export const OMAHA_BLANKET_ROWS_OFF_REGISTRY: readonly string[] = Object.freeze([
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
  // the rest of omahaNoCategoricalRules' list that is not classed priced: class gates, label reads, the hourly mood
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
  'omahaTurnBetNeedsRiverPlan',
  'v9Mood',
  // OMAHA_BLANKET_ROWS_OFF_EXTRA (below), in its order
  'omahaBigBetIsPotShare',
  'omahaCurrentNutsRaise',
  'ploSuitedAcesFourBet',
  'v86PloOverhaul',
  'v46Charts',
  'omahaPairedBoardFoldRespectsPrice',
]);

/**
 * The registry members that omahaNoCategoricalRules' list does not hold (EMERG lane BLANKET-AUDIT-2 2026-11-21; owner
 * 2026-11-21 2:00-2:05 AM Chicago: every blanket rule in PLO4/PLO5 cash goes off, one at a time). Each is a blanket rule
 * of the owner's checklist that had no PLO4/PLO5-cash-only off: a pot-share size line, a hand-category raise, a
 * hand-class 4-bet and two umbrellas (the V86 Omaha overhaul and the V46 preflop charts) that an OFF row would take
 * away in PLO6, tournaments and, for the umbrellas, every other game. `false` is the off path of each (the law test
 * reads the read form in the source). None is classed 'priced' by the rule-site register.
 * Added 2026-11-21 (EMERG RULES-FIX-1/LEAKS-RULES, AUDIT-B item 5): omahaPairedBoardFoldRespectsPrice (fixed price and
 * stack thresholds, reclassed open; a carve-out of ploPairedBoardFold, list it only with that rule).
 * NOTE (AUDIT-B item 14, PLO-OWNER lead-4 ruling 2026-11-21): v81OmahaBigBetCalls and v84OmahaRiverReraiseCalls are
 * already registry members above via OMAHA_NO_CATEGORICAL_RULES_OFF; v87DeepDiveDiscipline stays OUT of this registry
 * because V87 is under the owner hold (OPTION_SWITCH_REFUSED).
 */
export const OMAHA_BLANKET_ROWS_OFF_EXTRA: readonly string[] = Object.freeze([
  'omahaBigBetIsPotShare',
  'omahaCurrentNutsRaise',
  'ploSuitedAcesFourBet',
  'v86PloOverhaul',
  'v46Charts',
  'omahaPairedBoardFoldRespectsPrice',
]);

const LISTABLE: ReadonlySet<string> = new Set(OMAHA_BLANKET_ROWS_OFF_REGISTRY);

/** Whether `name` may be listed. */
export function omahaBlanketRowListable(name: string): boolean {
  return LISTABLE.has(name);
}

/**
 * The list a published settings version declares: the registry members whose setting is 1, in registry order;
 * undefined when none is (the compiled defaults), so nothing is added to a decision request.
 */
export function omahaBlanketRowsOffListFromSettings(
  values: Readonly<Record<string, number>> | undefined
): readonly string[] | undefined {
  if (!values) return undefined;
  let out: string[] | undefined;
  for (const name of OMAHA_BLANKET_ROWS_OFF_REGISTRY)
    if (values[OMAHA_BLANKET_ROW_OFF_SETTING_PREFIX + name] === 1) (out ??= []).push(name);
  return out ? Object.freeze(out) : undefined;
}

/**
 * The options this decision runs with. The SAME object when the switch is not on, when no list is given, when the
 * decision is not PLO4/PLO5 cash, or when nothing changes (every listed member is already false), so the default and
 * every out-of-scope game are byte-identical and a second pass is the identity. Otherwise a copy in which every listed
 * registry member is false; `note` is told each one (the caller fires the receipt). A name that is not in the registry
 * is ignored. Never throws.
 */
export function withBlanketRowsOffInPlo45Cash(
  opts: HorseDecideOpts,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  note?: (option: string) => void
): HorseDecideOpts {
  try {
    if (opts.omahaBlanketRowsOffInPlo45Cash !== true) return opts;
    const list = opts.omahaBlanketRowsOffList;
    if (!Array.isArray(list) || list.length === 0) return opts;
    // Fail closed (VERIFIER-2 V91 note B): the decision must SAY it is cash. omahaNoCategoricalRulesInScope guesses the
    // mode from the blind size when gameMode is absent; this option never guesses, so a state without gameMode
    // (no live builder makes one: ServerTableEngineTurns and the Lightning hosts always set it) is out of scope.
    if (gs.gameMode !== 'cash') return opts;
    if (!omahaNoCategoricalRulesInScope(player, gs)) return opts;
    const given = opts as Readonly<Record<string, unknown>>;
    let out: Record<string, unknown> | undefined;
    for (const name of OMAHA_BLANKET_ROWS_OFF_REGISTRY) {
      if (!list.includes(name) || given[name] === false) continue;
      (out ??= { ...given })[name] = false;
      if (note) {
        try {
          note(name);
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
