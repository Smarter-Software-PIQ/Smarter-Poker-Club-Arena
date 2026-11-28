/**
 * A PRICED OR DEFAULT-OFF OPTION PROVES ITS DECISION COST (2026-11-26, PLO-OWNER lead-7, lane HARDENING).
 *
 * WHY. On 2026-11-26 omahaOopReraiseRangeHoldsVsReraise went into live shadow and re-decided in 33-94 ms where it
 * applied; the shadow stage's breaker (HorseOptionShadowStage: three re-decisions over 50 ms in 20, or one over
 * 150 ms) switched it off. Nobody had measured what it costs per decision: nothing asked. It was fixed (#12034) and
 * a second option is being fixed, but the root cause is that a priced option could be registered, staged and
 * switched with no proof of its speed. This file is the gate (modelled on the shadow-stage registration rule,
 * HorseOptionShadowStage.optionShadowStageRegistrationGaps, #11922).
 *
 * THE RULE. Every registered option that can change a live decision and is priced by name (/pric/i) or off by
 * release default (OPTION_SWITCH_REGISTRY: not off-only; an off-only option can never be switched on) does ONE of:
 *  - names its relative-cost law in OPTION_COST_LAWS: a *.law.test.ts under server/src that names the option and
 *    measures it with src/testing/relativeCost.ts (the option on against the same decisions off, or the new code
 *    against the code it replaces). Absolute millisecond limits are forbidden by
 *    theServerSuiteAssertsNoTightWallClockBound; the pattern is anOopReraiseRangePriceIsFast.law.test.ts.
 *  - carries a reasoned exemption in OPTION_COST_EXEMPT: why it cannot add cost worth a law ("a pure threshold on a
 *    number the decision already computed: no sampling, no equity, no loop"). One sentence, at least
 *    OPTION_COST_EXEMPT_MIN_REASON characters, never a bare word.
 *  - or was registered before this gate (grandfathered, OPTION_COST_GRANDFATHERED): a frozen set that can only
 *    shrink. It holds the first 12 hex of sha256(name) of each such option (some names may not be listed in
 *    plain text by owner rule), so a new name can never join it. Their measured cost is the generated table
 *    docs/ops/horse-option-cost.md (scripts/ops/horse-option-cost.mjs, one harness for every registered option);
 *    giving one a law or an exemption takes it out of the set's use, and its hash may then be removed.
 * Never two of them. The law aPricedOptionProvesItsDecisionCost.law.test.ts fails the build otherwise
 * (optionCostProofGaps).
 *
 * WHAT A COST LAW MUST SHOW (WORKER-RULES SPEED). Measured offline on the compiled build where the option applies
 * (at least 500 applicable spots incl. deep stacks): p95 <= 10 ms, max <= 25 ms, nothing over 50 ms. The law test
 * holds the ratio that keeps it there; the measurement goes in the PR and in the law's header.
 *
 * Pure data and pure checks: nothing here is read by a decision.
 */
import { createHash } from 'node:crypto';

/** Option -> its relative-cost law, a path under server/src (e.g. engine/anXIsFast.law.test.ts). */
export const OPTION_COST_LAWS: Readonly<Record<string, string>> = Object.freeze({
  // #12034 (2026-11-26): the id samplers behind its three equities, and the applicable decision on against off
  omahaOopReraiseRangeHoldsVsReraise: 'engine/anOopReraiseRangePriceIsFast.law.test.ts',
  // the opener's own record read inside that rule (and its Hold'em twin): the parent with the read against the parent
  omahaOopReraiseRangeReadsOpenerRecord: 'engine/anOpenerRecordReadIsFast.law.test.ts',
  holdemOopReraiseRangeReadsOpenerRecord: 'engine/anOpenerRecordReadIsFast.law.test.ts',
  // the PLO flop call tree (rank-pair score tables, 2026-11-26)
  omahaFlopRealizationIsPriced: 'engine/anOmahaFlopCallTreeIsFast.law.test.ts',
  // the corrected PLO facing-bet price: heads-up (F1, F2, F6) and with a field (M1, M2)
  omahaFacingBetRangeIsMeasuredByLine: 'engine/anOmahaFacingBetPriceIsFast.law.test.ts',
  omahaFacingBetIndifferenceCalls: 'engine/anOmahaFacingBetPriceIsFast.law.test.ts',
  omahaFacingBetMinimumDefencePrior: 'engine/anOmahaFacingBetPriceIsFast.law.test.ts',
  omahaFacingBetFieldIsJoint: 'engine/anOmahaFacingBetPriceIsFast.law.test.ts',
  omahaMultiwayCallNeedsNutShare: 'engine/anOmahaFacingBetPriceIsFast.law.test.ts',
  // the people-measured bettor prior inside the facing-bet price (#12116, 2026-11-26): its cell lookup and, with
  // telemetry on, the second verdict that names omaha_people_prior_changed; on against off where it prices
  omahaFacingBetPriorIsPeopleMeasured: 'engine/anOmahaPeoplePriorIsFast.law.test.ts',
  // the people-measured multiway field inside the facing-bet price (2026-11-27): two cell lookups, one more top-share
  // count and, with telemetry on, the second verdict that names omaha_mw_people_field_changed
  omahaMultiwayFieldIsPeopleMeasured: 'engine/anOmahaMultiwayPeopleFieldIsFast.law.test.ts',
  // the priced flop pressure cap: one sampled flop count where the V40 cap prices a weak made hand (2026-11-26)
  omahaFlopPressureCapIsPriced: 'engine/anOmahaFlopPressureCapPriceIsFast.law.test.ts',
  // the priced multiway value bet (M3): its joint sample keeps the hand's pool by card ids (2026-11-26)
  omahaMultiwayValueBetIsPriced: 'engine/anOmahaMultiwayValueBetIsFast.law.test.ts',
  // the PLO re-raised pot price (id samplers, #12081)
  omahaReraisedPotCallIsPriced: 'engine/anOmahaReraisedPotPriceIsFast.law.test.ts',
  omahaReraisedPotReraiseIsPriced: 'engine/anOmahaReraisedPotPriceIsFast.law.test.ts',
  omahaReraisedPotFoldReraiseIsPriced: 'engine/anOmahaReraisedPotFoldReraiseIsPriced.law.test.ts',
  omahaReraisedPositionVsEveryoneToAct: 'engine/HorseOmahaReraisedPositionVsEveryone.law.test.ts',
  omahaFlopRaiseIsPriced: 'engine/anOmahaFlopRaiseIsPricedIsFast.law.test.ts',
  // the PLO river opening bet (value in position, bluff on blockers) and the trips-board full house
  omahaRiverValueBetInPositionIsPriced: 'engine/anOmahaRiverOpeningBetIsFast.law.test.ts',
  omahaRiverBluffIsPricedOnBlockers: 'engine/anOmahaRiverOpeningBetIsFast.law.test.ts',
  omahaRiverBluffIsPricedOnRangeAdvantage: 'engine/anOmahaRiverOpeningBetIsFast.law.test.ts',
  omahaTurnBluffIsPricedOnBlockers: 'engine/anOmahaTurnBluffPriceIsFast.law.test.ts',
  omahaTurnBluffIsPricedOnRangeAdvantage: 'engine/anOmahaTurnBluffPriceIsFast.law.test.ts',
  // his check read inside the two river bet rules (river-station, 2026-11-26): on against the river rules alone
  omahaRiverBetCheckIsHisRecord: 'engine/HorseOmahaRiverBetCheckRecord.law.test.ts',
  omahaRiverTripsBoardBoatIsNotNutClass: 'engine/anOmahaTripsBoardBoatIsFast.law.test.ts',
  // Hold'em: the opening side (cash, heads-up) and the tournament bluff
  holdemOpeningValueBetIsPriced: 'engine/aHoldemOpeningPriceIsFast.law.test.ts',
  holdemOpeningBluffIsPriced: 'engine/aHoldemOpeningPriceIsFast.law.test.ts',
  holdemRiverBluffIsPricedOnPeople: 'engine/aHoldemRiverBluffIsPricedOnPeople.law.test.ts',
  holdemRiverFacingBetPriorIsPeopleMeasured:
    'engine/aHoldemRiverFacingBetPriorIsPeopleMeasured.law.test.ts',
  holdemTournamentRiverBluffIsPriced: 'engine/aHoldemTournamentBluffPriceIsFast.law.test.ts',
  holdemTournamentTurnBluffIsPriced: 'engine/aHoldemTournamentBluffPriceIsFast.law.test.ts',
  holdemMultiwayOpeningBluffIsPriced: 'engine/aHoldemMultiwayOpeningPriceIsFast.law.test.ts',
  holdemMultiwayOpeningValueBetIsPriced: 'engine/aHoldemMultiwayOpeningPriceIsFast.law.test.ts',
});

/** Option -> why it cannot add a decision cost worth a law. */
export const OPTION_COST_EXEMPT: Readonly<Record<string, string>> = Object.freeze({
  omahaRiverBetFoldIsPeopleMeasured:
    'replaces each point of the river response curve the price already builds with a lookup in the generated people fold table (omahaPeopleRiverCurve): one multiply per bet size, no sampling, no equity, no new loop',
});

/** An exemption reason is at least this long: a sentence, not a word. */
export const OPTION_COST_EXEMPT_MIN_REASON = 24;

/** The options this gate applies to: priced by name, or off by release default; never an off-only option. */
export const OPTION_COST_PRICED_NAME = /pric/i;

/**
 * The options registered before this gate (2026-11-26), by the first 12 hex of sha256(name). Frozen: a name whose
 * hash is not here needs a law or an exemption. Remove a hash when its option gets either (or leaves the registry).
 */
export const OPTION_COST_GRANDFATHERED: ReadonlySet<string> = new Set([
  '00bfd3bca437',
  '07f32864f5ff',
  '0bbef92f8ca9',
  '0c983d466938',
  '177eee89e796',
  '1909d77a005a',
  '1a578e010d7a',
  '23b54b25600b',
  '289b1e03f0dc',
  '291b91de0270',
  '29853f1896c5',
  '2c295a0dccf4',
  '309e40af5736',
  '31c6158cc9d0',
  '3ab1cbaa817f',
  '3ab5c5897836',
  '3b03d28c74a5',
  '3effb10aa9ad',
  '42bd1616d997',
  '46235daba306',
  '4769353c3a40',
  '479a27eab244',
  '4910eb519cc8',
  '52fdf9ca06e1',
  '532289722723',
  '5e31f88f5091',
  '5f0e61272d9b',
  '61739f7b215b',
  '61d8f6261177',
  '67c49ed32c54',
  '685ced2a7df7',
  '69738e44272e',
  '6a436f8a15da',
  '6be0f3f4a264',
  '738bbfd335e8',
  '73baa2bbe21f',
  '7593d7513ec7',
  '765044328738',
  '770055ebad06',
  '7908623b8dcd',
  '7987f750aa29',
  '7c951dd75266',
  '813733d2f91b',
  '83797ca46e74',
  '866fb1a0fd48',
  '89f6f2b175ba',
  '8c129b7f4734',
  '8dfb7a5e282c',
  '90017e42bbfe',
  '94bc527d93f4',
  '9ab4cefc3e5c',
  '9b4d8dc6242c',
  '9dcc61b2d058',
  '9e7a58072cc1',
  'a5c56d672b4e',
  'a78ca45b30ea',
  'ac719ce9b926',
  'ac7eb0a9b026',
  'af9a688610b5',
  'b0ecdb5b9f47',
  'b3ff22458df3',
  'b3ff2f95a69b',
  'b41be549cc06',
  'b421a928e2a5',
  'b64ae13570f1',
  'b6b0419a708e',
  'bb9deb7f57dd',
  'bc5e349c3b75',
  'c0eb7531adbf',
  'c2ae87b1f5b1',
  'c2fb6866e456',
  'c5456d78e353',
  'c87ad2969d66',
  'cb3b511a7d0a',
  'cb3ff987d1f1',
  'cbbc94d8f514',
  'cdf86dcfd2f2',
  'd57e2e682026',
  'd990b364ab62',
  'dd887cc68313',
  'e05f959a78a9',
  'e08037b98cb7',
  'e319ef74039b',
  'ed47827eec00',
  'ee49655fbab1',
  'efe15ac7cae0',
  'f00c069caa84',
  'f231c1597205',
  'f28af1cba30f',
  'f3398b592f59',
  'f793bc015ee0',
  'f82455a62609',
  'fb7c97ed4a12',
  'fcd4efb32a83',
]);

/** The grandfather key of an option name. */
export function optionCostKey(name: string): string {
  return createHash('sha256').update(name).digest('hex').slice(0, 12);
}

export interface OptionCostRegistryEntry {
  readonly name: string;
  readonly releaseDefault: string;
  readonly offOnly?: unknown;
}

/** True for an option the gate holds to a cost proof. */
export function optionCostGated(e: OptionCostRegistryEntry): boolean {
  return !e.offOnly && (e.releaseDefault === 'off' || OPTION_COST_PRICED_NAME.test(e.name));
}

/** What a cost law file must contain: the option's name and the relative-cost measurement. */
export function optionCostLawText(name: string, text: string | null): string | null {
  if (text === null) return 'its cost law file does not exist';
  if (!new RegExp(`\\b${name}\\b`).test(text)) return 'its cost law does not name the option';
  if (!/measureRelativeCost\s*\(/.test(text) || !/testing\/relativeCost(\.js)?['"]/.test(text))
    return 'its cost law does not measure with src/testing/relativeCost.ts (measureRelativeCost)';
  return null;
}

/**
 * The gaps: every gated option has exactly one proof (a law that exists, names it and measures relative cost; a
 * reasoned exemption; or a grandfather key), and every law or exemption names a registered gated option. `readLaw`
 * returns a law file's text, or null when it does not exist. Empty when the gate holds.
 */
export function optionCostProofGaps(
  registry: readonly OptionCostRegistryEntry[],
  readLaw: (path: string) => string | null,
  laws: Readonly<Record<string, string>> = OPTION_COST_LAWS,
  exempt: Readonly<Record<string, string>> = OPTION_COST_EXEMPT,
  grandfathered: ReadonlySet<string> = OPTION_COST_GRANDFATHERED
): string[] {
  const gaps: string[] = [];
  const byName = new Map(registry.map((e) => [e.name, e]));
  for (const e of registry) {
    if (!optionCostGated(e)) continue;
    const law = Object.hasOwn(laws, e.name);
    const ex = Object.hasOwn(exempt, e.name);
    const old = grandfathered.has(optionCostKey(e.name));
    if (!law && !ex && !old)
      gaps.push(
        `${e.name}: a priced or default-off option names its relative-cost law (OPTION_COST_LAWS) or a reasoned exemption (OPTION_COST_EXEMPT)`
      );
    if (law && ex) gaps.push(`${e.name}: both a cost law and an exemption`);
    if (law) {
      const why = optionCostLawText(e.name, readLaw(laws[e.name]!));
      if (why) gaps.push(`${e.name}: ${why} (${laws[e.name]})`);
    }
    if (ex && String(exempt[e.name] ?? '').trim().length < OPTION_COST_EXEMPT_MIN_REASON)
      gaps.push(
        `${e.name}: the exemption reason is not a reason (under ${OPTION_COST_EXEMPT_MIN_REASON} characters)`
      );
  }
  for (const [kind, table] of [
    ['cost law', laws],
    ['exemption', exempt],
  ] as const)
    for (const name of Object.keys(table)) {
      const e = byName.get(name);
      if (!e)
        gaps.push(
          `${name}: has ${kind === 'exemption' ? 'an' : 'a'} ${kind} but is not registered`
        );
      else if (!optionCostGated(e))
        gaps.push(
          `${name}: has ${kind === 'exemption' ? 'an' : 'a'} ${kind} but is neither priced nor default-off (or is off-only)`
        );
    }
  const live = new Set(registry.filter(optionCostGated).map((e) => optionCostKey(e.name)));
  for (const key of grandfathered)
    if (!live.has(key))
      gaps.push(
        `grandfather key ${key}: matches no registered priced or default-off option (remove it)`
      );
  return gaps;
}
