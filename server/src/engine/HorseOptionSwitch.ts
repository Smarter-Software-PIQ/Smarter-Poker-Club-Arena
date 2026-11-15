/**
 * EVERY DECISION UPGRADE HAS A LIVE SWITCH (2026-11-14).
 *
 * The style read live switch (HorseStyleSwitch.ts, migration 20261113201841, delivery in
 * horseDecision/styleSwitchDelivery.ts) could carry seven options. This file generalises that ONE mechanism (the
 * same table, the same 30 s main-thread read, the same STYLE_SWITCH_STATE message, the same worker inbox) so it can
 * carry any decision option REGISTERED here. It adds no second table, poller or message.
 *
 * THE REGISTRY (OPTION_SWITCH_REGISTRY) is DERIVED at module load from HORSE_DATA_LEDGER: every ledger option
 * (kind 'flag') that is an on/off option, minus the refused names below. A ledger option that is a parameter and
 * not an on/off option (a number, a clock, a hand identity), or decision plumbing (telemetry, the mind), is listed
 * in OPTION_SWITCH_NOT_A_SWITCH and is not registered. So a new ledger option registers itself; the database whitelist (migration 20261114072215) is the
 * same list, written by server/scripts/gen-horse-option-switch-sql.ts, and everyUpgradeHasALiveSwitch.law.test.ts
 * fails when the two differ.
 *
 * OWNER ORDER (2026-11-14 22:01 Chicago, OPTION_SWITCH_ON_AUTHORITY): every function, feature and skill has an
 * on/off switch. It replaces the evidence-file rule this switch carried before (HA-10878-1) FOR THE SWITCH ONLY;
 * the source-default law (HorseDefaultOnNeedsEvidence.law.test.ts) is untouched. Registering ENABLES NOTHING.
 *
 * STATES. Every registered option supports `off`, `on` and clear. The engine accepts `on` for any registered
 * option; the database writes an `on` row for a non-style option only when its note cites the authority
 * (`authority: <file and sha256>`), from the set function and from any other writer (table constraint), and the
 * audit row keeps the note, the actor and the time. `shadow` and `canary` exist only for an option that has a
 * shadow arm in the brain (the seven style options, HorseStyleShadow.ts); they keep their own states and controls.
 *
 * HOLDS AND VERDICTS (OPTION_SWITCH_HOLDS). An option under an owner hold (the preflop range hold, a blind steal,
 * All-In-Or-Fold widening) or measured harmful is REGISTERED with a switch, and its hold or verdict is recorded on
 * its entry. No name is refused merely for a hold. The record decides nothing here: no row is added.
 *
 * RELEASE DEFAULT is informational: 'on' or 'off' where the code's reads say so plainly, 'code' where the code
 * decides (a parent option, a variant, a mixed read; see the ledger note) and for any option not classified yet.
 *
 * SEMANTICS. No row = the release default: the option key is NOT passed to the brain at all, so the code default
 * decides exactly as before this file existed. A row `on` passes `<option>: true`; a row `off` passes
 * `<option>: false`. So the switch can turn on what defaults off and turn off what defaults on. An empty switch
 * gives {} and every decision's options are byte-identical to before.
 *
 * FAIL SAFE: THE TWO RULES DIFFER, ON PURPOSE.
 * - The seven style options keep their rule (HorseStyleSwitch.ts, unchanged): unreadable, invalid or stale reads
 *   as OFF.
 * - Every other registered option fails safe to its RELEASE DEFAULT: unreadable, invalid or stale removes every
 *   switched value, so the code default decides. It is NOT "off": an option that is on by default must not be
 *   turned off by a database hiccup, and an option that is off by default must not stay on after one.
 *
 * NOT SWITCHABLE HERE (OPTION_SWITCH_REFUSED, optionSwitchRefusal): the authority-gated held-out cash pack and the
 * held-out PLO tournament cards, the phase packs, the deep-dive discipline (Pillar 2 lives inside it), the V31
 * solver store (R7/R8), leak maps and the two withdrawn rules. They are refused at the registry, the parser, the
 * database and the worker.
 *
 * FLEET-WIDE ONLY. A switched option is the same for every Horse, lane, club and table: the table is keyed by the
 * option name alone and optionSwitchDecisionOpts reads nothing but the switched set.
 */
import { HORSE_DATA_LEDGER } from './HorseDataLedger.js';
import { HORSE_FEATURE_FLAGS } from './HorseFeatureAuthority.js';
import type { HorseDecideOpts } from './HorseLogic.js';
import {
  STYLE_SWITCH_OPTIONS,
  STYLE_SWITCH_POLL_MS,
  STYLE_SWITCH_STALE_MS,
  STYLE_SWITCH_STATES,
  type StyleSwitchOption,
} from './HorseStyleSwitch.js';

/** The lanes of the Horse programme that own decision options. 'Programme': no lane override is recorded. */
export type OptionSwitchOwner =
  | "Hold'em Strategy"
  | 'Heads Up'
  | 'PLO Strategy'
  | 'PLO6'
  | 'Lightning'
  | 'Fixed-Limit'
  | 'Programme';
export type OptionSwitchAnyState = 'off' | 'shadow' | 'canary' | 'on';
/** 'code': decided by code (a parent option, a variant or a mixed read), see the ledger note. */
export type OptionSwitchReleaseDefault = 'off' | 'on' | 'code';

export interface OptionSwitchEntry {
  readonly name: string;
  readonly owner: OptionSwitchOwner;
  /** Where it acts: the activation inventory scope where one is recorded, else the option's ledger tag. */
  readonly scope: string;
  readonly states: readonly OptionSwitchAnyState[];
  /** What the code does when the option is not passed (informational). Registering never changes this. */
  readonly releaseDefault: OptionSwitchReleaseDefault;
  /** True only where the brain has a shadow arm for the option (HorseStyleShadow.ts). */
  readonly shadowArm: boolean;
  readonly description: string;
  /** An owner hold or a measured verdict on the option, recorded and not enforced by this switch. */
  readonly hold?: string;
}

const ON_OFF = Object.freeze(['off', 'on'] as const);
const HOLDEM = "Hold'em Strategy" as const;

/**
 * THE AUTHORITY AN `on` ROW CITES: the owner's order of 2026-11-14 22:01 Chicago, retained by file name and
 * sha256. The database writes `on` for a non-style option only when the note starts with `authority: ` and names
 * its authority; the operator's note is `authority: ` followed by this text.
 */
export const OPTION_SWITCH_ON_AUTHORITY =
  'OWNER-MESSAGE-20261114-2201CT-EVERY-FEATURE-ON-WITH-SWITCH.md sha256 2080c2026d5553e11ac288a74fcef51d20f81b30c0a9da446b5063a9f7196bf1';

/**
 * Ledger options that are never registered: parameters (not on/off options; the law holds this against the types)
 * and DECISION PLUMBING. Plumbing is on/off by type but is not a strategy option: a switch must never turn the
 * receipts (telemetry) or the mind off.
 */
const PARAMETER = 'a parameter, not an on/off option';
const PLUMBING = 'decision plumbing (telemetry / mind), not a strategy option';
export const OPTION_SWITCH_PLUMBING: readonly string[] = Object.freeze([
  'telemetry',
  'observeMind',
  'mind',
] satisfies ReadonlyArray<keyof HorseDecideOpts>);
export const OPTION_SWITCH_NOT_A_SWITCH: Readonly<Record<string, string>> = Object.freeze({
  ...Object.fromEntries(OPTION_SWITCH_PLUMBING.map((name) => [name, PLUMBING])),
  ...Object.fromEntries(
    (
      [
        'decisionTimeMs',
        'turnDeadlineMs',
        'mindObservationHand',
        'mindPlanContext',
        'deepEquity',
        'v67RiverRaiseShadeOverride',
        'v63RiverShadeShapeOverride',
        'tournamentFlatBump',
        'v65TurnShadeCapOverride',
        'v68AirShadeScaleOverride',
        'styleShadow',
        'styleCarryOverWeight',
      ] satisfies ReadonlyArray<keyof HorseDecideOpts>
    ).map((name) => [name, PARAMETER])
  ),
});

/**
 * RELEASE DEFAULTS, read from the code's own reads of each option (server/src/engine, tests aside): ON when every
 * read is `!== false`, `=== false` or `?? true`; OFF when every read is `=== true` or `!== true`. Anything
 * else, and any option not listed, is 'code'. Informational only: no row = the option is not passed.
 */
export const OPTION_SWITCH_RELEASE_DEFAULT_ON: readonly string[] = Object.freeze([
  'streetIQ',
  'handReading',
  'v7',
  'v7Preflop',
  'v7SizeReads',
  'v8',
  'v9Sizing',
  'v9Timing',
  'decisionGravityTiming',
  'v9Mood',
  'v10Cbet',
  'v10Spr',
  'v10Rake',
  'v10ThinValue',
  'v10Iso',
  'v11',
  'v12',
  'v12Ranges',
  'v12River',
  'v13',
  'v15',
  'v16Reads',
  'v16Icm',
  'v16Blockers',
  'v16SizeCond',
  'v16PloPolar',
  'v17Pos',
  'v17CatchBlock',
  'v17ShortDeck',
  'v18Straddle',
  'v18Squeeze',
  'v18SelfImage',
  'v18ExploitSize',
  'v18Families',
  'v20Multiway',
  'v20Mzone',
  'v21River',
  'v21Deep',
  'v23Endgame',
  'v23Plan',
  'v23Reads',
  'v23Variants',
  'v23Spin',
  'v24Bounty',
  'v25PloTourney',
  'v26Prizes',
  'v27GtoCharts',
  'v29GtoFlop',
  'v30GtoTurnRiver',
  'v37Satellite',
  'v38Ev',
  'v40Omaha',
  'holdemPremiumAggression',
  'holdemDominatedFold',
  'ploPairedBoardFold',
  'ploPairedBoardRiverCheck',
  'ploSuitedAcesFourBet',
  'v87HoldemOverhaul',
  'v87RiverBlockBetTrap',
  'v87HollywoodTank',
  'v87FlopStabCheckRaise',
  'v46Charts',
  'v51RiverFlat',
  'v56OmahaPressureRange',
  'v57TournamentAggression',
  'v61RiverOnePairShade',
  'v66BetRaisedOnePair',
  'v67RiverBetRaisedOnePair',
  'v88CommitmentHonored',
  'omahaTournamentFirstIn',
  'tokenCallPrice',
  'plo6ManiacPriceRefusalToRangePlay',
  'v64RiverRaiseNeedsTwoPair',
  'v63LargeRiverBetShade',
  'v74OmahaSemiBluffNeedsDraw',
  'v60CashPressure',
  'v65TurnOnePairShade',
  'v68TurnAirDrawCalls',
  'v69TurnCallGaps',
  'v70GtoOpeningRanges',
  'v71AnteAwarePushFold',
  'v72DefenceByOpener',
  'v73Vs3BetDefence',
  'v75SqueezeDefence',
  'v79TopPairWeakKicker',
  'v81OmahaBigBetCalls',
  'v15RiverNoNearLock',
  'v85CashAction',
  'v84OmahaRiverReraiseCalls',
  'v83AggressionNeedsBluffs',
  'planFingerprint',
  'v80TopPairStrongKicker',
  'v78NoCommittingBluffRaise',
  'v70FacingOpenZone',
  'nashCallVsJam',
  'limpReraiseIsoRead',
  'v77SeatAwareJams',
  'v76RetireFourBetBluffBand',
  'v74NlhOpenSizes',
  'v52RangeAdvantage',
  'v53Pressure',
  'v58Plo6RiverNuts',
  'v59Plo6RiverUnpaired',
  'drawOutlookQuality',
  'committedRaiseDiscipline',
  'callDeductionPricing',
  'flopTurnBluffBaseline',
  'riverBluffBaseline',
  'riverLeadRange',
  'riverBluffHiLo',
  'riverBluffMultiway',
  'riverFastCalldown',
  'probeAwareAggression',
  'riverBluffFixedLimit',
  'riverBluffShortDeck',
  'riverBluffBombPot',
  'riverBluffMultiBoard',
  'v43Tempo',
  'v41Leaks',
  'v86UnblockedPreflop',
  'v86MultiStreetUnblocked',
]);
export const OPTION_SWITCH_RELEASE_DEFAULT_OFF: readonly string[] = Object.freeze([
  'v16Hu',
  'v16Ratio',
  'v17RiverProbe',
  'v23ShortDeck',
  'v32FacingDefense',
  'v33DepthCeiling',
  'v55OmahaRiverTripsFlat',
  'omahaHiLoTournamentFirstIn',
  'plo6TopSetNutRealization',
  'v62RiverBettorPolarity',
  'readPostflopFoldRate',
  'readShrinkResponse',
  'readBreakEvenBluff',
  'omahaNeutralUnknown',
  'omahaTightOpponent',
  'readScopedShrink',
  'huBbDefendsToPrice',
  'huOpenerDefendsToPrice',
  'huLimpDefendsToPrice',
  'committedStackPricedIn',
  'nashPushFoldIcm',
  'facingOpenFullRingZone',
  'vs3BetShortStack',
  'omahaCommitZoneThreeBetPriceRelief',
  'commitUnderPot',
]);
/** Decided by code: a parent option, a variant gate or a mixed read (see each ledger note). */
export const OPTION_SWITCH_RELEASE_DEFAULT_CODE: readonly string[] = Object.freeze([
  'v7Barrels',
  'v7CounterAdapt',
  'v7AdaptiveMC',
  'v8Draws',
  'v8HiLo',
  'v8Nlh',
  'v9',
  'v10',
  'v15Boats',
  'v24PloDefense',
  'v86PloOverhaul',
  'v46ShortDeck',
  'omahaEvFoldModel',
  'facingClosedAllIn',
]);
const releaseDefaultOf = (name: string): OptionSwitchReleaseDefault =>
  OPTION_SWITCH_RELEASE_DEFAULT_ON.includes(name)
    ? 'on'
    : OPTION_SWITCH_RELEASE_DEFAULT_OFF.includes(name)
      ? 'off'
      : 'code';

/** HOLDS AND VERDICTS, recorded per option. The option stays registered; the switch does not enforce the hold. */
const PREFLOP_RANGE_HOLD = 'owner preflop range hold (recorded; the activation manifest decides)';
const HOLDS_BY_NAME: Readonly<Record<string, string>> = Object.freeze({
  v46ShortDeck: PREFLOP_RANGE_HOLD,
  nashPushFoldIcm: PREFLOP_RANGE_HOLD,
  huBbDefendsToPrice: PREFLOP_RANGE_HOLD,
  facingOpenFullRingZone: PREFLOP_RANGE_HOLD,
  committedStackPricedIn: PREFLOP_RANGE_HOLD,
  vs3BetShortStack: PREFLOP_RANGE_HOLD,
  huOpenerDefendsToPrice: PREFLOP_RANGE_HOLD,
  huLimpDefendsToPrice: PREFLOP_RANGE_HOLD,
  commitUnderPot:
    'declared evaluation measured harm (RESULTS-HU-NLH-016, FAIL): stays off at the cutover',
});
const HOLD_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/steal/i, 'owner hold: blind steal (recorded; the activation manifest decides)'],
  [/all[-_]?in[-_]?or[-_]?fold|(^|[^a-z])aof/i, 'owner hold: All-In-Or-Fold widening (recorded)'],
];
/** The hold or verdict recorded for an option, or null. */
export function optionSwitchHold(name: string): string | null {
  if (Object.hasOwn(HOLDS_BY_NAME, name)) return HOLDS_BY_NAME[name]!;
  for (const [pattern, text] of HOLD_PATTERNS) if (pattern.test(name)) return text;
  return null;
}

/** Owner, scope and description where the activation inventory records them; else 'Programme' and the ledger. */
type Override = readonly [owner: OptionSwitchOwner, scope: string, description?: string];
const OVERRIDES: Readonly<Partial<Record<keyof HorseDecideOpts & string, Override>>> = {
  v16Hu: ['Heads Up', 'Heads-up postflop', 'heads-up postflop overlay'],
  v16Ratio: [HOLDEM, 'All (dead by precedence under V38)', 'V16 call/fold ratio rescale'],
  v17RiverProbe: [HOLDEM, 'River probe', 'river probe into a capped field'],
  v23ShortDeck: [HOLDEM, 'Short deck', 'the short-deck half of the V23 variant polish'],
  v32FacingDefense: [HOLDEM, 'NLH solver facing-bet defence', 'solver facing-bet defence'],
  v33DepthCeiling: [HOLDEM, 'NLH solver lookups >300bb', 'solver depth ceiling (300bb)'],
  v55OmahaRiverTripsFlat: [
    'PLO Strategy',
    'Omaha river',
    'river Omaha weak sets/trips keep call pricing without re-shoving',
  ],
  commitUnderPot: [
    'Heads Up',
    'NLH heads-up, flop/turn (cash+tourney)',
    'a priced fold under a committed pot becomes a call',
  ],
  v62RiverBettorPolarity: [HOLDEM, 'NLH river', "a river wager's hand is drawn by bet size"],
  readPostflopFoldRate: [
    HOLDEM,
    'All, legacy exploit fold read',
    'the fold read uses the postflop fold-to-bet rate',
  ],
  readShrinkResponse: [
    HOLDEM,
    'All, river-fold / fold-to-cbet reads',
    'small-sample reads shrink toward the population rate',
  ],
  readBreakEvenBluff: [
    HOLDEM,
    'NLH + PLO4-6 postflop bluff pricing',
    'a bluff is priced against its break-even fold share',
  ],
  readScopedShrink: [
    HOLDEM,
    'All, opponent read bucket',
    'a thin read answers from its own game scope, shrunk',
  ],
  omahaNeutralUnknown: [
    'PLO Strategy',
    'Omaha (all), unknown opponent read',
    'an unknown Omaha opponent gets a neutral read',
  ],
  omahaHiLoTournamentFirstIn: ['Heads Up', 'PLO8 tournament, heads-up, <= 20 bb'],
  huBbDefendsToPrice: ['Heads Up', 'NLH heads-up cash, big blind facing the only open'],
  huOpenerDefendsToPrice: ['Heads Up', 'NLH heads-up cash, opener facing one 3-bet'],
  huLimpDefendsToPrice: ['Heads Up', 'NLH heads-up cash, small-blind limp facing one raise'],
};

const STYLE_DESCRIPTION: Readonly<Record<StyleSwitchOption, readonly [string, string]>> = {
  styleValueBettorNotManiac: [
    'NLH (not bounty), postflop call-down',
    'a value-heavy big bettor is not read as a maniac',
  ],
  styleBigBetHonesty: ['NLH turn/river big bets', 'respect for an honest big bettor'],
  styleRaiseRespect: [
    'NLH HU flop/turn raises',
    'respect for a raise from a player who rarely raises',
  ],
  styleTightReRaiserRespect: [
    'NLH preflop >25bb, not bounty',
    'tighter continuing bars against a tight opener or 3-bettor',
  ],
  styleFoldRatePreRepair: [
    'NLH cash (pre-repair rows)',
    'the legacy over-folder read stands down on a pre-repair row',
  ],
  styleValueExtraction: [
    'NLH heads-up postflop, not bounty',
    'bigger, thinner value against a caller',
  ],
  styleFoldBluff: [
    'NLH heads-up postflop, not bounty',
    "bluff frequency follows this street's fold-to-bet",
  ],
};

/**
 * REFUSED BY NAME: options this switch may never carry, each with the ruling that holds it. They are never
 * registered (the derivation leaves them out, and assertOptionSwitchRegistry throws on one).
 */
export const OPTION_SWITCH_REFUSED: Readonly<Record<string, string>> = Object.freeze({
  ...Object.fromEntries(
    HORSE_FEATURE_FLAGS.map((flag) => [
      flag,
      'authority-gated: HorseFeatureAuthority (held-out cash feature pack, no selection file)',
    ])
  ),
  v53PloTourneyIcm:
    'authority-gated: HorseTournamentFlagAuthority (held-out PLO tournament cards, no selection file)',
  phase8Postflop: 'phase pack: worker-owned phase authority',
  phase8PolicyFamily: 'phase pack: worker-owned phase authority',
  phase8CatastropheGuard: 'phase pack: worker-owned phase authority',
  phase10Plo4: 'phase pack: worker-owned phase authority',
  phase11Omaha: 'phase pack: worker-owned phase authority',
  phase12Remaining: 'phase pack: worker-owned phase authority',
  phase13Joint: 'phase pack: worker-owned phase authority',
  phase14: 'phase pack: worker-owned phase authority',
  phase14Corrective: 'phase pack: worker-owned phase authority',
  v87DeepDiveDiscipline: 'owner hold: Pillar 2 lives inside the deep-dive discipline',
  v87ShouldSuppressOmahaPositionStab: 'owner hold: Pillar 2',
  v31GtoSuitAware: 'owner hold: the V31 solver store (R7/R8) is registration-gated',
  vpipFloorDeepStackOff: 'withdrawn by law: HorseWithdrawnRulesStayOff.law.test.ts (#10705)',
  omahaPreflopCallWithActionBehind:
    'withdrawn by law: HorseWithdrawnRulesStayOff.law.test.ts (#10705)',
});

/** Name patterns of the refusals, for options that do not exist yet. */
const HELD_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/pillar/i, 'owner hold: Pillar 2'],
  [/^phase\d/i, 'phase pack: worker-owned phase authority'],
  [/held[-_]?out|holdout/i, 'owner hold: held-out packs'],
  [/v31|(^|[^a-z0-9])r[78]($|[^a-z0-9])|round[78]/i, 'owner hold: R7/R8 solver rounds'],
  [/leak[-_]?map/i, 'owner hold: leak maps'],
];

/** Why an option may not be carried by this switch, or null when nothing refuses it. */
export function optionSwitchRefusal(name: string): string | null {
  const byName = Object.hasOwn(OPTION_SWITCH_REFUSED, name) ? OPTION_SWITCH_REFUSED[name]! : null;
  if (byName) return byName;
  for (const [pattern, reason] of HELD_PATTERNS) if (pattern.test(name)) return reason;
  return null;
}

const PLAIN_NAME = /^[A-Za-z][A-Za-z0-9]{0,62}$/;
const oneLine = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 160 ? `${flat.slice(0, 157)}...` : flat;
};

/** One registered non-style option, from its ledger row: off and on, no shadow arm. */
function plainEntry(name: string, note: string, tag: string): OptionSwitchEntry {
  const override = (OVERRIDES as Readonly<Record<string, Override | undefined>>)[name];
  const hold = optionSwitchHold(name);
  return Object.freeze({
    name,
    owner: override?.[0] ?? ('Programme' as const),
    scope: override?.[1] ?? tag,
    states: ON_OFF,
    releaseDefault: releaseDefaultOf(name),
    shadowArm: false,
    description: override?.[2] ?? oneLine(note),
    ...(hold ? { hold } : {}),
  });
}

/**
 * THE REGISTRY. The seven style options first (unchanged: all four states, held by StyleSwitchHolder), then every
 * other on/off option of the ledger, in ledger order. Registering makes an option switchable; it does not turn it
 * on.
 */
export const OPTION_SWITCH_REGISTRY: readonly OptionSwitchEntry[] = Object.freeze([
  ...STYLE_SWITCH_OPTIONS.map(
    (name): OptionSwitchEntry =>
      Object.freeze({
        name,
        owner: HOLDEM,
        scope: STYLE_DESCRIPTION[name][0],
        states: STYLE_SWITCH_STATES,
        releaseDefault: 'off' as const,
        shadowArm: true,
        description: STYLE_DESCRIPTION[name][1],
      })
  ),
  ...HORSE_DATA_LEDGER.filter(
    (e, i, all) =>
      e.kind === 'flag' &&
      PLAIN_NAME.test(e.key) &&
      !(STYLE_SWITCH_OPTIONS as readonly string[]).includes(e.key) &&
      !Object.hasOwn(OPTION_SWITCH_NOT_A_SWITCH, e.key) &&
      optionSwitchRefusal(e.key) === null &&
      all.findIndex((x) => x.kind === 'flag' && x.key === e.key) === i
  ).map((e) => plainEntry(e.key, e.note, e.since ?? 'ledger')),
]);

/** Every registered name, in registry order. */
export const OPTION_SWITCH_NAMES: readonly string[] = Object.freeze(
  OPTION_SWITCH_REGISTRY.map((e) => e.name)
);
/** The registered options held by this file's holder: every registered option that is not a style option. */
export const OPTION_SWITCH_PLAIN_REGISTRY: readonly OptionSwitchEntry[] = Object.freeze(
  OPTION_SWITCH_REGISTRY.filter(
    (e) => !(STYLE_SWITCH_OPTIONS as readonly string[]).includes(e.name)
  )
);
export const OPTION_SWITCH_PLAIN_NAMES: readonly string[] = Object.freeze(
  OPTION_SWITCH_PLAIN_REGISTRY.map((e) => e.name)
);
const PLAIN_BY_NAME: ReadonlyMap<string, OptionSwitchEntry> = new Map(
  OPTION_SWITCH_PLAIN_REGISTRY.map((e) => [e.name, e])
);
/** Every registered option that carries a hold or a verdict, with its text. */
export const OPTION_SWITCH_HOLDS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    OPTION_SWITCH_REGISTRY.filter((e) => e.hold !== undefined).map((e) => [e.name, e.hold!])
  )
);

/** The registry is checked where it is declared: a refused option, a duplicate or a pretended shadow arm throws. */
export function assertOptionSwitchRegistry(entries: readonly OptionSwitchEntry[]): void {
  const seen = new Set<string>();
  for (const e of entries) {
    const refusal = optionSwitchRefusal(e.name);
    if (refusal) throw new Error(`option switch: ${e.name} may not be registered (${refusal})`);
    if (Object.hasOwn(OPTION_SWITCH_NOT_A_SWITCH, e.name))
      throw new Error(
        `option switch: ${e.name} is not a switch (${OPTION_SWITCH_NOT_A_SWITCH[e.name]})`
      );
    if (seen.has(e.name)) throw new Error(`option switch: ${e.name} is registered twice`);
    seen.add(e.name);
    if (!PLAIN_NAME.test(e.name))
      throw new Error(`option switch: ${e.name} is not a plain option name`);
    if (!e.states.includes('off') || !e.states.includes('on'))
      throw new Error(`option switch: ${e.name} must support off and on`);
    const style = (STYLE_SWITCH_OPTIONS as readonly string[]).includes(e.name);
    const split = e.states.includes('shadow') || e.states.includes('canary');
    if (split && !e.shadowArm)
      throw new Error(`option switch: ${e.name} has no shadow arm, so no shadow or canary state`);
    if (split !== style)
      throw new Error(`option switch: only the style options carry shadow and canary (${e.name})`);
  }
}
assertOptionSwitchRegistry(OPTION_SWITCH_REGISTRY);

/** The states an option may be set to, or null when the option is not registered. */
export function optionSwitchStatesOf(name: string): readonly OptionSwitchAnyState[] | null {
  return OPTION_SWITCH_REGISTRY.find((e) => e.name === name)?.states ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// The switched values of the non-style options.
// ---------------------------------------------------------------------------------------------------------------

export type OptionSwitchValue = 'off' | 'on';
/**
 * What is switched right now: only the options that have a row, in registry order. An option not named runs at its
 * release default. {} = nothing switched.
 */
export type OptionSwitchStates = Readonly<Record<string, OptionSwitchValue>>;
export const OPTION_SWITCH_NOTHING_SWITCHED: OptionSwitchStates = Object.freeze({});

export function optionSwitchNothingSwitched(
  states: OptionSwitchStates | null | undefined
): boolean {
  return !states || Object.keys(states).length === 0;
}

/**
 * A valid switched set (registered non-style names, each `off` or `on`), in registry order; null when it is not
 * one. A name that is refused, a parameter or unknown makes the whole set invalid: every non-style option then runs
 * at its release default.
 */
export function optionSwitchStatesFrom(value: unknown): OptionSwitchStates | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  for (const [k, s] of Object.entries(v)) {
    const entry = PLAIN_BY_NAME.get(k);
    if (!entry || typeof s !== 'string' || !(entry.states as readonly string[]).includes(s))
      return null;
  }
  const out: Record<string, OptionSwitchValue> = {};
  for (const name of OPTION_SWITCH_PLAIN_NAMES)
    if (Object.hasOwn(v, name)) out[name] = v[name] as OptionSwitchValue;
  return Object.freeze(out);
}

/**
 * The configuration as fn_ca_horse_option_switch_effective answers:
 *   { version: 2, style: { version: 1, options: {...} }, options: { <option>: 'off' | 'on', ... } }
 * `style` belongs to StyleSwitchHolder and is not judged here. `options` may name registered non-style options
 * only, each in a state it supports; anything else is invalid.
 *
 * The version 1 answer of fn_ca_horse_style_switch_effective ({ version: 1, options }) is also accepted: it is what
 * the engine reads from a database that does not have the wider function yet, it carries no non-style option, and
 * so nothing is switched.
 */
export function parseOptionSwitchConfig(
  raw: unknown
): { ok: true; states: OptionSwitchStates } | { ok: false } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false };
  const r = raw as Record<string, unknown>;
  const keys = Object.keys(r).sort().join(',');
  if (keys === 'options,version' && r.version === 1)
    return r.options && typeof r.options === 'object' && !Array.isArray(r.options)
      ? { ok: true, states: OPTION_SWITCH_NOTHING_SWITCHED }
      : { ok: false };
  if (keys !== 'options,style,version' || r.version !== 2) return { ok: false };
  const states = optionSwitchStatesFrom(r.options);
  return states ? { ok: true, states } : { ok: false };
}

/** The style half of a delivered configuration: a version 2 answer carries it under `style`. */
export function styleConfigOf(raw: unknown): unknown {
  return raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    (raw as { version?: unknown }).version === 2
    ? (raw as { style?: unknown }).style
    : raw;
}

export type OptionSwitchReading =
  | { kind: 'absent' }
  | { kind: 'present'; raw: unknown; receivedAtMs: number };
export type OptionSwitchSource = (nowMs: number) => OptionSwitchReading;
export const ABSENT_OPTION_SWITCH_SOURCE: OptionSwitchSource = () => ({ kind: 'absent' });

/** Replay: serves the recorded switched set as received now (it never ages inside a replay). */
export function optionSwitchSourceFromStates(
  states: OptionSwitchStates | null | undefined
): OptionSwitchSource {
  if (optionSwitchNothingSwitched(states)) return ABSENT_OPTION_SWITCH_SOURCE;
  const options = { ...states };
  return (nowMs) => ({
    kind: 'present',
    raw: { version: 2, style: { version: 1, options: {} }, options },
    receivedAtMs: nowMs,
  });
}

const RECEIPT = 'option_switch';

/**
 * The per-process holder of the non-style options. Same cadence and the same strict 120 s staleness as
 * StyleSwitchHolder (one read per STYLE_SWITCH_POLL_MS, a configuration older than STYLE_SWITCH_STALE_MS stops at
 * the next refresh). THE DIFFERENCE: every failure (unreadable, invalid, stale) leaves NOTHING SWITCHED, which is
 * every option at its release default, not every option off. Never throws.
 *
 * Receipts: option_switch_<option>_<on|off|default>_seen when an option's switched value changes (`default`: its
 * row went away or the configuration failed), and option_switch_config_unreadable_seen / _invalid_seen /
 * _stale_seen.
 */
export class OptionSwitchHolder {
  private states: OptionSwitchStates = OPTION_SWITCH_NOTHING_SWITCHED;
  private readAt = Number.NEGATIVE_INFINITY;
  private receivedAt: number | null = null;

  constructor(
    private readonly source: OptionSwitchSource,
    private readonly note: (feature: string) => void,
    private readonly pollMs: number = STYLE_SWITCH_POLL_MS
  ) {}

  refresh(nowMs: number): OptionSwitchStates {
    if (!(nowMs - this.readAt < this.pollMs) || nowMs < this.readAt) {
      this.readAt = nowMs;
      let next: OptionSwitchStates = OPTION_SWITCH_NOTHING_SWITCHED;
      let receivedAt: number | null = null;
      try {
        const reading = this.source(nowMs);
        if (reading?.kind === 'absent') next = OPTION_SWITCH_NOTHING_SWITCHED;
        else if (
          reading?.kind === 'present' &&
          (typeof reading.receivedAtMs !== 'number' || !Number.isFinite(reading.receivedAtMs))
        )
          this.note('option_switch_config_invalid_seen');
        else if (
          reading?.kind === 'present' &&
          !(nowMs - reading.receivedAtMs <= STYLE_SWITCH_STALE_MS)
        )
          this.note('option_switch_config_stale_seen');
        else if (reading?.kind === 'present') {
          const parsed = parseOptionSwitchConfig(reading.raw);
          if (parsed.ok) {
            next = parsed.states;
            receivedAt = reading.receivedAtMs;
          } else this.note('option_switch_config_invalid_seen');
        } else this.note('option_switch_config_invalid_seen');
      } catch {
        this.note('option_switch_config_unreadable_seen');
      }
      this.apply(next, receivedAt);
    }
    if (this.receivedAt !== null && !(nowMs - this.receivedAt <= STYLE_SWITCH_STALE_MS)) {
      this.note('option_switch_config_stale_seen');
      this.apply(OPTION_SWITCH_NOTHING_SWITCHED, null);
    }
    return this.states;
  }

  private apply(next: OptionSwitchStates, receivedAt: number | null): void {
    for (const name of OPTION_SWITCH_PLAIN_NAMES) {
      const was = this.states[name] ?? 'default';
      const now = next[name] ?? 'default';
      if (was !== now) this.note(`${RECEIPT}_${name}_${now}_seen`);
    }
    this.states = next;
    this.receivedAt = optionSwitchNothingSwitched(next) ? null : receivedAt;
  }

  current(): OptionSwitchStates {
    return this.states;
  }
}

/**
 * The decision options a switched set gives EVERY Horse alike (no Horse id is read: only a style canary splits
 * Horses): `<option>: true` for on, `<option>: false` for off, nothing for an option without a row or
 * for a name that is not registered. Nothing switched gives {}.
 */
export function optionSwitchDecisionOpts(
  states: OptionSwitchStates | null | undefined
): Readonly<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  if (states)
    for (const name of OPTION_SWITCH_PLAIN_NAMES)
      if (states[name] === 'on') out[name] = true;
      else if (states[name] === 'off') out[name] = false;
  return out;
}
