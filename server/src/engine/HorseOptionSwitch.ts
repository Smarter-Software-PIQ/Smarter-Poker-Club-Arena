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
 * OWNER RULING (2026-11-14 23:10 Chicago): "Preserve approved OFF states. No automatic blanket switch-on after
 * sealing." So the switch ENFORCES the approved OFF states; it does not merely record them.
 *
 * STATES. Every registered option supports `off` and clear. An option in OPTION_SWITCH_OFF_ONLY (an owner hold, a
 * measured harm or failed evaluation, a superseded option) supports `off` ONLY: the registry does not offer `on`,
 * the parser treats an `on` row for it as an invalid configuration (every non-style option then runs at its
 * release default), optionSwitchDecisionOpts never passes true for it, and the database refuses the row from any
 * writer. Lifting a hold is a reviewed source change to that map, never a note. Every other registered non-style
 * option supports `on`: the engine accepts it, and the database writes it only when the note is the option's OWN
 * citation (`authority: <option> <file> sha256 <64 hex>`, optionSwitchOnNote), at the set function and at the
 * table; the audit row keeps the note, the actor and the time. `canary` exists only for an option that has a
 * shadow arm in the brain (the seven style options, HorseStyleShadow.ts); they keep their own controls.
 *
 * SHADOW FOR A NON-STYLE OPTION (2026-11-18, Horse Switch lane; OPTION_SWITCH_SHADOW_NAMES). A registered on/off
 * option whose release default is plainly 'on' or 'off' (not 'code'), that is not off-only and whose read is per
 * decision (not OPTION_SWITCH_SHADOW_REFUSED) also supports `shadow`. Shadow passes NOTHING to the brain (exactly
 * like no row: the release default decides the acted decision), and the decision worker re-decides the committed
 * decision ONCE with the option flipped, from the same RNG position, at a per-minute budget, recording a
 * counterfactual receipt it never acts on (workerRuntime.optionShadowReceipt, the style action-receipt mechanism).
 * The database accepts `shadow` for exactly these names (registry:shadow-options markers); the style options keep
 * their own four states.
 *
 * ON_SHADOW FOR A NON-STYLE OPTION (2026-11-19, Horse Switch lane; OPTION_SWITCH_ON_SHADOW_NAMES). `shadow` passes
 * nothing, so for an option that is OFF in source and ON in production only by an `on` row (DEFAULT-ON-AUDIT F1) a
 * shadow row would switch the rule OFF on live tables. `on_shadow` measures such a rule without changing it: the
 * ACTED decision receives `<option>: true` exactly like `on` (optionSwitchDecisionOpts), and the worker re-decides
 * once with `<option>: false` (optionSwitchShadowFlip), counted option_shadow_<option>_<changed|same>_seen exactly like
 * shadow. It keeps every rule of `on` at the database (own citation, recorded evidence, off-only refused, the serving
 * registry guard). Both values are explicit, so the release default is not needed and a 'code' option takes it; an
 * off-only option, a style option and an option whose read is not per decision (OPTION_SWITCH_SHADOW_REFUSED) do not
 * (optionSwitchOnShadowRefusal). Every shadow option takes it too. The database accepts `on_shadow` for exactly
 * these names (registry:on-shadow-options markers).
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
  type StyleSwitchState,
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
export type OptionSwitchAnyState = 'off' | 'shadow' | 'on_shadow' | 'canary' | 'on';
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
  /**
   * True where a non-style option supports `shadow` by a worker re-decision with the option flipped
   * (OPTION_SWITCH_SHADOW_NAMES). Never with a shadow arm, never for an off-only option or a 'code' release default.
   */
  readonly shadowRedecide?: boolean;
  /**
   * True where a non-style option supports `on_shadow`: acted with true (as `on`), re-decided once with false
   * (OPTION_SWITCH_ON_SHADOW_NAMES). Never with a shadow arm, never for an off-only option; set wherever shadowRedecide is.
   */
  readonly onShadowRedecide?: boolean;
  readonly description: string;
  /** Set when the option is off-only (OPTION_SWITCH_OFF_ONLY): its status, reason and source. Enforced. */
  readonly offOnly?: OptionSwitchOffOnly;
}

export type OptionSwitchOffOnlyStatus = 'hold' | 'harm' | 'superseded';
export interface OptionSwitchOffOnly {
  readonly status: OptionSwitchOffOnlyStatus;
  readonly reason: string;
  readonly source: string;
}

const ON_OFF = Object.freeze(['off', 'on'] as const);
const OFF_SHADOW_ON_SHADOW_ON = Object.freeze(['off', 'shadow', 'on_shadow', 'on'] as const);
const OFF_ON_SHADOW_ON = Object.freeze(['off', 'on_shadow', 'on'] as const);
const OFF_ONLY = Object.freeze(['off'] as const);
const HOLDEM = "Hold'em Strategy" as const;

/**
 * THE AUTHORITY AN `on` ROW CITES. The owner's order of 2026-11-14 22:01 Chicago (every option has an on/off
 * switch) is retained by file name and sha256. It is the authority for the SWITCH existing; it is not a blanket
 * authority to switch an option on (owner, 23:10). An `on` row for a non-style option carries the option's OWN
 * citation: `authority: <option> <file> sha256 <64 lowercase hex>`. The database refuses any other note.
 */
export const OPTION_SWITCH_ON_AUTHORITY_FILE =
  'OWNER-MESSAGE-20261114-2201CT-EVERY-FEATURE-ON-WITH-SWITCH.md';
export const OPTION_SWITCH_ON_AUTHORITY_SHA256 =
  '2080c2026d5553e11ac288a74fcef51d20f81b30c0a9da446b5063a9f7196bf1';
export const OPTION_SWITCH_ON_AUTHORITY = `${OPTION_SWITCH_ON_AUTHORITY_FILE} sha256 ${OPTION_SWITCH_ON_AUTHORITY_SHA256}`;

/** The note an `on` row for `option` must carry: the option's own name, the authority file and its sha256. */
export function optionSwitchOnNote(option: string, file: string, sha256: string): string {
  if (!/^[A-Za-z][A-Za-z0-9]{0,62}$/.test(option))
    throw new Error(`option switch: ${option} is not a plain option name`);
  if (!/^[0-9a-f]{64}$/.test(sha256))
    throw new Error('option switch: the authority sha256 is 64 lowercase hex characters');
  if (!file.trim() || /\s/.test(file.trim()))
    throw new Error('option switch: the authority file is one name without spaces');
  return `authority: ${option} ${file.trim()} sha256 ${sha256}`;
}
/** What the database accepts as the note of an `on` row for `option` (the same rule as the SQL). */
export function optionSwitchOnNoteCites(option: string, note: unknown): boolean {
  return (
    typeof note === 'string' &&
    note.startsWith(`authority: ${option} `) &&
    /sha256 [0-9a-f]{64}/.test(note)
  );
}

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
        'horsePlayStyleForce',
        'omahaOptionGameScope',
        'omahaBlanketRowsOffList',
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
  'v86UnblockedPreflop',
  'v86MultiStreetUnblocked',
  'omahaRiverNutRaiseOnly',
  'omahaTurnSetPound',
  'omahaCurrentNutsRaise',
  // a process switch, not a decision option: the decision worker applies it before every job (HorseMind)
  'fixedLimitBetsAreNeverProbes',
  // 2026-11-19 (Horse Switch lane, DEFAULT-ON-AUDIT): were 'code'; every read site is on when unset, so a shadow
  // re-decision passes false. v9 / v10: every read is `(opts.<child> ?? opts.<master>) !== false` (a registered child
  // row masks the master at its own site); v86PloOverhaul: `!== false` / `=== false`, and HorsePreflop's
  // ctx.v86PloOverhaul is set true exactly when `opts.v86PloOverhaul !== false` (HorseLogic decidePreflopV7Glue);
  // omahaEvFoldModel: `(opts.omahaEvFoldModel ?? true) !== false`, carried to HorseMind.decisionReadOptions from that
  // expression; facingClosedAllIn: `=== false` turns the computed closed-all-in read off, unset leaves it on. Held by
  // the law "an option listed release default ON is on when unset at every read site".
  'v9',
  'v10',
  'v86PloOverhaul',
  'omahaEvFoldModel',
  'facingClosedAllIn',
]);
export const OPTION_SWITCH_RELEASE_DEFAULT_OFF: readonly string[] = Object.freeze([
  'omahaNoCategoricalRules',
  'omahaTournamentsExcludeCategoricalRules',
  'holdemRiverFullHouseValueIsPriced',
  'holdemValueAndCallsArePriced',
  'holdemCommittedNoPairIsPriced',
  'holdemDangerBoardEquityIsPriced',
  'cashDefenceTrimColdCalls',
  // 2026-11-21: a process switch like fixedLimitBetsAreNeverProbes, read `=== true` (HorseMind.apply...Option)
  'styleShiftReleaseIsNoiseAware',
  'omahaTurnRiverRaiseIsPriced',
  'omahaDrawRaiseIsPriced',
  'omahaOopTurnBarrelIsPriced',
  'omahaPairedBoardBetIsPriced',
  'omahaBluffShareFromBetRate',
  'omahaFacingBetRangeIsContinuous',
  'omahaPressureIsPriced',
  'omahaBigBetCallsArePriced',
  'omahaUnderpairMultiwayIsPriced',
  'omahaPricedMix',
  'omahaPricedPriorsByOpponentKind',
  'omahaRaiseEvCountsLossesOnce',
  'omahaSampledRaiseIsPricedAtEverySize',
  'omahaBluffIsPricedAgainstTheTarget',
  'omahaFacingBetValueShareIsMeasured',
  // 2026-11-20 EMERG lane RANGE-MODEL-2: the river current-nuts call floor (ships dark)
  'omahaRiverCurrentNutsCallFloor',
  // 2026-11-20 EMERG lane PREFLOP-UNCONTESTED: the priced call of a fold facing a 4-bet (ships dark)
  'omahaFourBetFoldPricedCall',
  // 2026-11-20 EMERG lane OFFENCE-BUILD: the river first-to-act heads-up bet priced on the measured response (ships dark)
  'omahaRiverFirstToActBetIsPriced',
  // 2026-11-21 EMERG lane CBET-DEFENCE: the raise of the Horse's own flop c-bet ranged on the measured raise share (ships dark)
  'omahaCbetRaiseIsPriced',
  // 2026-11-20 EMERG lane OFFENCE-BUILD: the river checked-to heads-up bet on the measured response, no kind (ships dark)
  'omahaRiverCheckedToBetIsMeasured',
  // 2026-11-21 EMERG lane BLANKET-AUDIT: the declared blanket rows off in PLO4/PLO5 cash only (ships dark)
  'omahaBlanketRowsOffInPlo45Cash',
  // 2026-11-20 PLO-OWNER lane OPPONENT-HUD: the lifetime opponent profile read from hand one (ships dark)
  'omahaOpponentLifetimeHud',
  // 2026-11-21 PLO-OWNER lane OPPONENT-HUD-9: the decision reads that profile only with this on too (ships dark)
  'omahaOpponentLifetimeHudDecides',
  // 2026-11-21 PLO-OWNER lead-4 B4: priced six-max preflop read on lifetime HUD cells (ships dark)
  'omahaPreflopReadIsPricedFromLifetime',
  // 2026-11-21 PLO-OWNER lane REPLACEMENTS-5: R2 flop bet-or-check + flop facing raise/stab HUD response (ships dark)
  'omahaFlopBetIsPricedOnHisResponse',
  // 2026-11-20 EMERG lane STAB-DEFENCE: the first wager of a turn or river priced on the bettor's lifetime public
  // first-wager frequency (ships dark; silent without lifetime counts)
  'omahaStabDefenceIsPriced',
  // 2026-11-20 EMERG lane STAB-DEFENCE: the heads-up first-to-act value bet priced beside the check (HELD, ships dark)
  'omahaStrongHandCheckIsPriced',
  // 2026-11-21 EMERG lane STAB-DEFENCE-5: the two river bet rules price the opponent's own lifetime public river
  // fold record (ships dark; silent without lifetime counts and without one of the two river rules on)
  'omahaRiverBetFoldIsHisRecord',
  // 2026-11-21 PLO-OWNER lead-4 lane LEAKS-RULES: priced big-bet size + continuous pot-share/HUD range replacing #18 (ships dark)
  'omahaBigBetSizeIsPriced',
  // 2026-11-21 PLO-OWNER lane REPLACEMENTS-5: R4 checked-to flop/turn big-draw bets priced on lifetime HUD (ships dark)
  'omahaBigDrawBetIsPricedOnHisResponse',
  // 2026-11-19 HORSE DECISIONS lane builder F-FIX (auditor F): Omaha tournament multiway call-offs and bets priced
  'omahaMultiwayIsPricedInTournaments',
  'omahaMadeHandBetIsPriced',
  'omahaTurnSetSizeIsPriced',
  'omahaBlockerBluffIsPriced',
  'omahaFlopBetIsPriced',
  'omahaFlopDefenceIsPriced',
  'omahaFlopBetPricesTheRaise',
  'omahaFlopBetUsesMeasuredFoldShare',
  'omahaFacingBetEvShownField',
  'omahaRiverBluffCatchIsPriced',
  'omahaCheckedToBetIsPriced',
  'omahaCheckedToBetResponseIsMeasured',
  'omahaCheckedToBetInLightning',
  'omahaReraisedCallVsRaisePriced',
  'omahaPreflopJamFacingReraiseIsPriced',
  'omahaFoldModelFittedOnPeople',
  'omahaPricedInLightning',
  'omahaSlowplayMixInLightning',
  'omahaPublicBetSizeInLightning',
  'omahaTurnStabDefenceIsPriced',
  'omahaTurnStabLightningRow',
  'omahaTightOpponentSteal',
  'lightningParticipationHoldem',
  'lightningParticipationOmaha',
  'lightningCheapEntryHoldem',
  'lightningCheapEntryOmaha',
  'v16Hu',
  'v16Ratio',
  'v17RiverProbe',
  'v23ShortDeck',
  'v32FacingDefense',
  'v33DepthCeiling',
  'v55OmahaRiverTripsFlat',
  'omahaHiLoTournamentFirstIn',
  'plo6TopSetNutRealization',
  'plo6ManiacPriceRefusalToRangePlay',
  'plo6FacingBetIsPriced',
  'plo6FacingBetIsPricedV2',
  'v62RiverBettorPolarity',
  'readPostflopFoldRate',
  'readShrinkResponse',
  'readBreakEvenBluff',
  'omahaNeutralUnknown',
  'omahaEvFoldModelSkipsPlo45',
  'omahaNoMadeClassCap',
  'omahaTightOpponent',
  'readScopedShrink',
  'huBbDefendsToPrice',
  // 2026-11-20: read once, as `opts.huBbDefendsUnreadToPrice === true` (HorseLogic huBbUnreadPrice; pinned by
  // HorseHeadsUpBigBlindDefendsUnreadToPrice.law.test.ts), so off in source. It had reported 'code' while off-only.
  'huBbDefendsUnreadToPrice',
  'huOpenerDefendsToPrice',
  'huLimpDefendsToPrice',
  'committedStackPricedIn',
  'holdemTournamentAllInCallIsPriced',
  'nashPushFoldIcm',
  'facingOpenFullRingZone',
  'vs3BetShortStack',
  'omahaCommitZoneThreeBetPriceRelief',
  'commitUnderPot',
  'omahaBeatenMadeHandDefense',
  'omahaBluffCatcherRaiseFold',
  'omahaReraisedPotDiscipline',
  // read `=== true` since #10989 (Hand Analysis ruling 2026-11-15T13:39:23Z); failed its declared evaluation
  // (OPTION_SWITCH_OFF_ONLY). It was listed ON here from before that flip.
  'omahaNutClassValueSize',
  // 2026-11-17 wave two: read `=== true`, off in source; both failed their declared evaluation (OPTION_SWITCH_OFF_ONLY)
  'omahaStreetPlanFlop',
  'omahaMultiwayRiverCallNeedsStrength',
  'omahaReraisedPotStackOffFold',
  'omahaReraisedPotStackOffRealistic',
  'omahaOnePairDiscipline',
  'fixedLimitRiverFullBetRead',
  'fixedLimitRiverStrongHandLeads',
  'fixedLimitHiLoNutLowRiverBet',
  'fixedLimitRiverOneBetValueRaise',
  'fixedLimitCallIsNotACommitment',
  'fixedLimitReadIgnoresProbes',
  'fixedLimitHiLoLowHalfFloor',
  'fixedLimitOmahaNoPresumption',
  'gtoV31CellContractV3Serving',
  'omahaStrategyInPlo6',
  'fixedLimitPricedPreflop',
  'fixedLimitStealVsTightBlinds',
  // 2026-11-18: the short-deck chart is read only `=== true` once the unset-under-V86 path is gone (HorseLogic V46)
  'v46ShortDeck',
  // 2026-11-18 no-limit hold'em: read only `=== true` / `!== true` (HorseLogic, HorseMind, observerReads), so off in
  // source; they had reported 'code' (swarm NLH-CASH IMPROVEMENTS I2). A production row, not the source, turns one on.
  'styleLongShownMemory',
  'holdemProfileCompletenessCap',
  'holdemPersonaReRaiseMix',
  'holdemPersonaPostflop',
  'holdemManiacSampleGate',
  'holdemManiacShortHandedReach',
  'holdemGearShiftReach',
  'holdemCallDownExcludesCurrentHand',
  'holdemCallDownNeedsStyleEvidence',
  'holdemRiverFullHouseValue',
  'styleTightPlayerExploit',
  'styleTightMultiSignal',
  'styleTightMethodLine',
  'horseActionTimeIsPublicOnly',
  'horsePlayStyles',
  // 2026-11-18: read `=== true`, off in source (HorseLogic); measured harm on real hands (OPTION_SWITCH_OFF_ONLY)
  'omahaReraisedPotFlopContinueNeedsEquityShape',
  // 2026-11-21 (lane CORE-POOLED-6): was 'code'. Every read of the math core's PLO5 flop flag is `=== true`
  // (OmahaMathCoreRule.ts omahaMathCoreStreetAdmitted, HorseLogic.ts recover door, OmahaMathCoreSwitchState.ts,
  // responseValidation.ts admission), so unset is off at every read site. Listed so the registry takes the
  // `shadow` state for it (OPTION_SHADOW_STAGE entry, companion omahaMathCore); alone it changes no decision.
  'omahaMathCorePlo5Flop',
]);
/** Decided by code: a parent option, a variant gate or a mixed read (see each ledger note). */
export const OPTION_SWITCH_RELEASE_DEFAULT_CODE: readonly string[] = Object.freeze([
  'v7Barrels',
  'v7CounterAdapt',
  'v7AdaptiveMC',
  'v8Draws',
  'v8HiLo',
  'v8Nlh',
  'v15Boats',
  'v24PloDefense',
]);
const releaseDefaultOf = (name: string): OptionSwitchReleaseDefault =>
  OPTION_SWITCH_RELEASE_DEFAULT_ON.includes(name)
    ? 'on'
    : OPTION_SWITCH_RELEASE_DEFAULT_OFF.includes(name)
      ? 'off'
      : 'code';

/**
 * OFF-ONLY OPTIONS (owner, 2026-11-14 23:10 Chicago: "Preserve approved OFF states. No automatic blanket switch-on
 * after sealing."). ONE source of truth: an option named here, or matching OFF_ONLY_PATTERNS, is registered with
 * `off` only. The database lists the same names (registry:off-only-options markers, written by the generator).
 * Lifting an entry is a reviewed source change to this map.
 */
const hold = (source: string, reason: string): OptionSwitchOffOnly =>
  Object.freeze({ status: 'hold' as const, reason, source });
const harm = (reason: string): OptionSwitchOffOnly =>
  Object.freeze({
    status: 'harm' as const,
    reason,
    source: 'declared evaluation measured harm (activation manifest, section 4)',
  });
/** A PLO option that FAILED its declared evaluation (PLO Strategy's inbox record, results file named). */
const ploFailed = (reason: string, record: string): OptionSwitchOffOnly =>
  Object.freeze({
    status: 'harm' as const,
    reason: `failed its declared evaluation: ${reason}`,
    source: `PLO Strategy evaluation result, inbox ${record}`,
  });
const PREFLOP_HOLD_SOURCE = 'owner preflop range hold';
const PREFLOP_HOLD_REASON = 'changes a preflop range: held until the owner lifts it by name';
const OMAHA_TIGHT_SOURCE =
  'owner ruling 2026-11-14 21:30 Chicago (Omaha tight responses stay OFF until promotion evidence passes)';
/**
 * The R7/R8 hold refuses every V31 name by pattern (OPTION_SWITCH_REFUSED, HELD_PATTERNS). One name is carried, OFF
 * ONLY, under that same hold: the cell contract v3 serving switch (FLOP-5 D6). It replaced an environment variable so
 * that the switch sits in the registry and the replay state (Hand Analysis N1, 2026-11-15); being off-only it can only
 * force the release default, OFF, and the database refuses `on` for it from any writer.
 */
const V31_CELL_CONTRACT_V3_SOURCE =
  'owner hold: the V31 solver store (R7/R8) is registration-gated (carried off-only, FLOP-5 D6)';
export const OPTION_SWITCH_HELD_PATTERN_OFF_ONLY_NAMES: readonly string[] = Object.freeze([
  'gtoV31CellContractV3Serving',
]);
const OWNING_LANE_SOURCE =
  'owning lane keeps it OFF (PLO6 05:04:38Z / Lightning 05:04:25Z inbox rows)';
export const OPTION_SWITCH_OFF_ONLY: Readonly<Record<string, OptionSwitchOffOnly>> = Object.freeze({
  // owner preflop range hold
  v46ShortDeck: hold(
    PREFLOP_HOLD_SOURCE,
    `${PREFLOP_HOLD_REASON}; also measured harm (-0.51 +/- 0.15, manifest section 4)`
  ),
  nashPushFoldIcm: hold(PREFLOP_HOLD_SOURCE, PREFLOP_HOLD_REASON),
  // 2026-11-15 Hold'em Strategy: the persona preflop layer widens or narrows opening ranges at deep cash tables.
  holdemPersonaPreflop: hold(PREFLOP_HOLD_SOURCE, PREFLOP_HOLD_REASON),
  huBbDefendsToPrice: hold(PREFLOP_HOLD_SOURCE, PREFLOP_HOLD_REASON),
  facingOpenFullRingZone: hold(
    PREFLOP_HOLD_SOURCE,
    `${PREFLOP_HOLD_REASON}; also not significant in its evaluation, stays off (manifest section 4)`
  ),
  committedStackPricedIn: hold(PREFLOP_HOLD_SOURCE, PREFLOP_HOLD_REASON),
  // holdemTournamentAllInCallIsPriced is NOT held. Dan's exact message of 2026-11-19 18:42 America/Chicago:
  // "nope, you need to investigate every single hand played against humans in the past 48 hours and trace back and investigate every single horse decision on every single street before you claim everything is operating perfectly because i've seen a shit ton of mistakes that need correcting!"
  // On that order the HORSE DECISIONS lead (session_01TLQer7JfrrxcELJZV5XHPD) lifted the owner preflop range hold
  // for this option (audit E, done under that order, found the fixed All-In-Or-Fold strength bar it replaces a
  // blanket rule). It is switchable, default OFF, and goes on only through its evidence (league card + replay).
  vs3BetShortStack: hold(
    PREFLOP_HOLD_SOURCE,
    `${PREFLOP_HOLD_REASON}; also one seed below -2 SE (manifest section 4)`
  ),
  huOpenerDefendsToPrice: hold(PREFLOP_HOLD_SOURCE, PREFLOP_HOLD_REASON),
  huLimpDefendsToPrice: hold(PREFLOP_HOLD_SOURCE, PREFLOP_HOLD_REASON),
  // huBbDefendsUnreadToPrice is NOT held (lifted BY NAME, 2026-11-20; OPTION_SWITCH_PREFLOP_HOLD_LIFTED below).
  // Dan's exact message of 2026-11-20 15:01 America/Chicago to the Antigravity Coordinator chat, about the Heads Up,
  // Hold'em, PLO6, Lightning, Limit, Human vs Horse and Hand Analysis lanes:
  // "YOU OWN THIS CODE BASE AND ARE TO MAKE ANY AND ALL DECISIONS, CHANGES, UPGRADES, ENHANCEMENTS ETC. AND COORDIANTE WITH THE ENGINE CUT OVER, HORSE DECISIONS AND ON OFF SWITCH CHATS AS NEEDED."
  // On that order the ANTIGRAVITY COORDINATOR (session_01UxDLnHu4P9fWx3X7Mp5FjM) lifted the owner preflop range hold
  // for this option alone. It is switchable, default OFF, and goes on only through its evidence (league card +
  // replay; docs/horse-option-authority.d/huBbDefendsUnreadToPrice.md, "Evidence NOT MET" on the day of the lift).
  // huBbDefendsToPrice (not supported by its declared evaluation, HU-NLH-001c), huOpenerDefendsToPrice,
  // huLimpDefendsToPrice and every other PREFLOP_HOLD_SOURCE entry stay off-only.
  lightningCheapEntryHoldem: hold(PREFLOP_HOLD_SOURCE, PREFLOP_HOLD_REASON),
  lightningCheapEntryOmaha: hold(PREFLOP_HOLD_SOURCE, PREFLOP_HOLD_REASON),
  // 2026-11-16 PLO Strategy wave two: the preflop stack-to-pot plan turns a heads-up preflop call into a fold
  // (it narrows a preflop calling range), so it is under the owner preflop range hold until lifted by name.
  omahaPreflopStackPlan: hold(PREFLOP_HOLD_SOURCE, PREFLOP_HOLD_REASON),
  // 2026-11-17 PLO Strategy wave two, screened against the owner's no-blanket-rules order: the river bluff check is
  // asked only against an opponent the engine LABELS a measured value leader, so the label decides which bluffs are
  // priced. Carried off-only until it is rewritten as a priced comparison for every opponent (his measured fold to a
  // river bet and the Horse's blockers) and that form passes its own evaluation.
  omahaNoRiverBluffIntoValueLeader: hold(
    'owner order 2026-11-17 11:49 America/Chicago (no blanket rules: every decision by math, ranges, equity and EV)',
    'its check is gated by an opponent label (measured value leader): held until rewritten as a priced comparison'
  ),
  // 2026-11-18 horse-switch swarm (PLO6-HILO VERDICT-READY items 1 and 16): it decides by hand class, player count
  // and street with no price ("a check has no price to weigh"); 0 fires in 7 days. Off-only until it is priced.
  plo6NoMultiwayBetWithWeakMadeHand: hold(
    'owner order 2026-11-17 11:49 America/Chicago (no blanket rules: every decision by math, ranges, equity and EV)',
    'categorical, no price: it skips a multiway bet by hand class alone; held until rewritten as a priced comparison'
  ),
  // 2026-11-17 PLO Strategy wave two: the two options whose verdicts were rewritten under the owner's
  // no-blanket-rules order were then evaluated on a bar written before the runs, and both lost.
  omahaStreetPlanFlop: ploFailed(
    'Horse-only mirror PLO4 -2.05 bb/100 (SE 0.89, z -2.31) lost beyond two standard errors; PLO5 -1.36 (SE 0.86); field cells inconclusive',
    '2026-11-17T18:48:14Z (wave2b-01BNteGZ/eval/RESULTS.md, PROTOCOL.md)'
  ),
  omahaMultiwayRiverCallNeedsStrength: ploFailed(
    'Horse-only mirror PLO5 -0.27 bb/100 (SE 0.11, 46 divergent pairs) lost beyond two standard errors; nearly inert elsewhere (18 folds in 192,000 hands)',
    '2026-11-17T18:48:14Z (wave2b-01BNteGZ/eval/RESULTS.md, PROTOCOL.md)'
  ),
  // 2026-11-17 PLO Strategy: the priced preflop re-raise defence changes which hands continue against a 3-bet
  // or more (a preflop calling and re-raising range), so it is under the owner preflop range hold.
  omahaPreflopReraiseDefencePriced: hold(PREFLOP_HOLD_SOURCE, PREFLOP_HOLD_REASON),
  // 2026-11-18 horse-switch swarm (LIMIT-HU-OTHER VERDICT-READY item 2): it changes fixed-limit first-in and
  // big-blind-defence ranges, which is the owner preflop range hold's definition.
  fixedLimitPricedPreflop: hold(PREFLOP_HOLD_SOURCE, PREFLOP_HOLD_REASON),
  // owner 21:30: the Omaha tight responses
  omahaTightOpponent: hold(
    OMAHA_TIGHT_SOURCE,
    'Omaha tight response: promotion evidence rows unmet'
  ),
  // 2026-11-15 PLO Strategy: the read-conditional 4-bet fold against a measured tight re-raiser is an
  // Omaha tight response, so it is under the same owner hold (Hand Analysis wiring note N1).
  omahaReraisedFoldVsTight: hold(
    OMAHA_TIGHT_SOURCE,
    'Omaha tight response: promotion evidence rows unmet'
  ),
  omahaTightOpponentSteal: hold(
    OMAHA_TIGHT_SOURCE,
    'Omaha tight steal: promotion evidence rows unmet'
  ),
  // measured harm or failed evaluation
  commitUnderPot: harm('RESULTS-HU-NLH-016, FAIL: 3 of 14 cells below -2 SE'),
  v16Hu: harm('-0.26 +/- 0.10'),
  v17RiverProbe: harm('-0.11 +/- 0.04'),
  v23ShortDeck: harm('-0.36 +/- 0.14'),
  v32FacingDefense: harm('-0.31 +/- 0.15'),
  v33DepthCeiling: harm('-2.97 +/- 1.09'),
  v62RiverBettorPolarity: harm('-3.67 +/- 1.02'),
  readPostflopFoldRate: harm('its read alone lost the mirror'),
  omahaNeutralUnknown: Object.freeze({
    status: 'harm' as const,
    reason:
      'failed evaluation; the activation manifest (draft 3) lists it unevaluated or evidence incomplete: OFF',
    source:
      'programme coordinator, 2026-11-14 (failed evaluation); activation manifest revision 3 execution list',
  }),
  fixedLimitRiverFullBetRead: Object.freeze({
    status: 'harm' as const,
    reason: 'failed evaluation: off-only from the moment the option lands in the ledger',
    source: 'programme coordinator, 2026-11-14 (failed evaluation)',
  }),
  // PLO Strategy's declared evaluations, 2026-11-15: FAILED; each reads === true (default OFF) on main since #10963
  omahaReraisedPotDiscipline: ploFailed(
    'LAG-value seat PLO5 -11.95 bb/100 (SE 5.14, z -2.32) broke the harm bar',
    '2026-11-15T09:47:06Z (reraised-pot-20261115/RESULTS-2.md, PROTOCOL-2 E1)'
  ),
  omahaOnePairDiscipline: ploFailed(
    'Horse-only mirror PLO4 -0.77 bb/100 (SE 0.34, z -2.30) broke bar 2 of its frozen rule; off as declared',
    '2026-11-15T09:51:53Z (one-pair-20261115/RESULTS.md); off head 2026-11-15T10:05:36Z'
  ),
  omahaBeatenMadeHandDefense: ploFailed(
    'Horses vs LAG-value seat PLO4 -23.73 bb/100 (SE 8.21, z -2.89), PLO5 -16.17 (SE 6.69, z -2.42)',
    '2026-11-15T10:02:10Z (eval3-20261115/RESULTS-omahaBeatenMadeHandDefense.md)'
  ),
  omahaBluffCatcherRaiseFold: ploFailed(
    'bluff-raising field PLO4 -1.39 bb/100 (SE 0.58, z -2.38), Horse-only PLO4 -0.78 (z -2.34), PLO5 -0.88 (z -2.01)',
    '2026-11-15T11:40:49Z (eval3-20261115/RESULTS-omahaBluffCatcherRaiseFold.md)'
  ),
  // 2026-11-18 (sub-agent offonly-013U37): the one-name registry delta promised at ea3e9c95 once the nut-class
  // OFF head merged (#10989), never made until now. Its re-run engaged the rule and FAILED the Horse-only bar while
  // gaining against the development human field (+2.29 bb/100, SE 0.44); Hand Analysis ruled the bar governs.
  omahaNutClassValueSize: ploFailed(
    'Horse-only PLO4 -1.19 bb/100 (SE 0.41, z -2.91), PLO5 -1.31 (SE 0.59, z -2.22) broke the harm bar; development human field pooled +2.29 (SE 0.44)',
    '2026-11-15T12:26:53Z (eval3-20261115/RESULTS-nutsize-2.md, PROTOCOL-nutsize-2.md); Hand Analysis ruling 2026-11-15T13:39:23Z'
  ),
  // PLO Strategy's priced rules, 2026-11-17 (owner 11:49 "no blanket rules"): FAILED its declared evaluation
  omahaPairedBoardBetIsPriced: ploFailed(
    'human-like field PLO5 -2.18 bb/100 (SE 1.02, z -2.14); pooled field -1.56 (SE 0.73), Horse-only -0.47 (SE 0.68)',
    '2026-11-17 priced-rules finish post (priced-01BNteGZ/eval2/VERDICTS.txt, PASS-BAR-v2.md)'
  ),
  // 2026-11-18 lead ruling (priced2 review R2 B2): the re-raise loss correction lost its provisional league,
  // so it is off-only; omahaTurnRiverRaiseIsPriced (its #11212 WIN stands for the code on main) stays switchable.
  // 2026-11-18 PLO Strategy sites (sites-013U37/REPLAY-20261118.md): two priced sites failed their replay bar on
  // the audited real decisions, so they are off-only until a corrected form passes.
  omahaFlopBetIsPriced: ploFailed(
    'replay on audited real decisions FAIL: pooled 1 fixed, 3 newly wrong; audit2 no read 21 changed, judge -65.9 bb (mean -4.71, SE 1.33, n 14)',
    '2026-11-18 sites replay (sites-013U37/REPLAY-20261118.md, PASS-BAR.md s1)'
  ),
  omahaMadeHandBetIsPriced: ploFailed(
    'replay on audited real decisions FAIL: pooled 3 fixed, 5 newly wrong (judge +159 bb, n 14)',
    '2026-11-18 sites replay (sites-013U37/REPLAY-20261118.md, PASS-BAR.md s1)'
  ),
  omahaRaiseEvCountsLossesOnce: ploFailed(
    'PROVISIONAL (raw rows lost with SSD1): Horse-only PLO4 -1.84 bb/100 (SE 0.88, z -2.09), PLO5 -0.83 (SE 0.78), field pooled +0.25 +/- 1.64, with the opponent-kind priors and this correction on together (priced2 config 0, fad0d304ffd)',
    '2026-11-18 priced2 league (priced2-013U37/PASS-BAR.md configuration 0, eval/RUN1-LOST-SSD1.md)'
  ),
  // 2026-11-18 WooWoo 48-hour audit (lead ruling): measured harm on real hands, switched OFF live at
  // 2026-11-18T01:42:08Z (switch audit row 69). Off-only until a priced replacement passes its declared evaluation.
  omahaReraisedPotFlopContinueNeedsEquityShape: Object.freeze({
    status: 'harm' as const,
    reason:
      'measured harm on real hands: its rule omaha_reraised_flop_continue_folded took re-raised-pot heads-up flop folds from 9 of 30 to 37 of 69; switching it off removes 15 of 15 of its folds (13 audited wrong or questionable) and breaks 0 audited-correct calls or raises',
    source:
      'WooWoo 48-hour audit, 2026-11-18 (repairs/FLOP-DEFENCE/ATTRIBUTION.md; SWITCH-AUDIT.md anomaly 5); switched off live 2026-11-18T01:42:08Z',
  }),
  omahaPricedMix: ploFailed(
    'Horse-only PLO5 -1.95 bb/100 (SE 0.94, z -2.07), with all nine families on in both arms (before the bluff double-count fix)',
    '2026-11-17 priced-rules finish post (priced-01BNteGZ/eval2/VERDICTS.txt, PASS-BAR-v2.md)'
  ),
  // 2026-11-20 Antigravity Coordinator: the 270-cell Lightning selection stage (2,970,000 paired hands, seeds
  // 31470001-31470005) graded against its frozen protocol. It acts only at hold'em tables (the Omaha option owns the
  // Omaha variants), so its NLH figures are its own. Guard G6 failed in NLH: any failed guard rejects the candidate.
  lightningParticipationHoldem: Object.freeze({
    status: 'harm' as const,
    reason:
      'failed its declared evaluation: guard G6 broke in NLH, nit field -0.75 bb/100 (SE 0.36, z -2.07) and tight_value field -1.01 bb/100 (SE 0.40, z -2.55); primary NLH -0.24 (SE 0.32, z -0.75), no variant +2 SE',
    source:
      'Lightning selection stage, 09-EVALUATION-PROTOCOL-v2.md section 6, graded 2026-11-20 (docs/changelog/2026-11-20-lightning-full-matrix-graded.md; LightningEvalSummary-20261118.json sha256 28fb1550)',
  }),
  // 2026-11-20 Antigravity Coordinator: the scripted fixed-limit field (PR #11565, docs/horse-league-fixed-limit.md),
  // measured after the league memory fix (HorseMind.observe now gets the betting structure, as production does).
  // Against the scripted maniac it loses on both seeds; against the tight-value control it is flat. No cell anywhere
  // is positive, so the measured-harm off-only entry stands until a new evaluation says otherwise.
  fixedLimitCallIsNotACommitment: Object.freeze({
    status: 'harm' as const,
    reason:
      'measured harm in the league: scripted flh maniac field -24.68 bb/100 (SE 5.45, z -4.53; seeds 20261120 -28.02 +/- 7.30 and 20261121 -21.35 +/- 8.10, 12,000 pairs each); tight-value harm control 0.00 (SE 0.02); no positive cell',
    source:
      'league card flh_call_is_not_a_commitment_vs_maniac and _vs_tight_value, PR #11565 (docs/horse-league-fixed-limit.md; docs/changelog/2026-11-20-league-scripted-fixed-limit-field.md)',
  }),
  // 2026-11-21 Antigravity Coordinator: the scripted no-limit field (PR #11634, docs/changelog/2026-11-21-holdem-scripted-
  // no-limit-field.md). Against its value-only harm control it loses on both seeds; against the pot barreler it is not
  // resolved. No cell anywhere is significantly positive, so it is off-only as measured harm.
  holdemCommittedNoPairIsPriced: Object.freeze({
    status: 'harm' as const,
    reason:
      'measured harm in the league: value-only harm control -0.21 bb/100 (SE 0.07, z -3.02; seeds -0.20 +/- 0.10, z -2.02 and -0.22 +/- 0.10, z -2.26, both significant); pot barreler not resolved (-0.21 +/- 0.70); no significant positive cell',
    source:
      'league card nlh_committed_no_pair_is_priced_vs_value_barreler and _vs_pot_barreler, PR #11634 (docs/horse-option-authority.d/holdemCommittedNoPairIsPriced.md; docs/changelog/2026-11-21-holdem-scripted-no-limit-field.md)',
  }),
  // 2026-11-21 Antigravity Coordinator: same field. Against a danger-board bettor that bets value and no-pair half-pot
  // on four-flush/four-straight boards it loses heavily on both seeds; its gain against the value-only control is the
  // field most favourable to it. Same shape as fixedLimitCallIsNotACommitment (harm in one field, nothing in the other).
  // The known cause is its n = 50 call-biased showdown sample of the bettor's range.
  holdemDangerBoardEquityIsPriced: Object.freeze({
    status: 'harm' as const,
    reason:
      'measured harm in the league: danger-board bettor (value and no-pair half-pot bets on four-flush/four-straight boards) -7.90 bb/100 (SE 0.81, z -9.74; seeds -7.31 +/- 1.11, z -6.61 and -8.49 +/- 1.19, z -7.16); its value-only control gain +2.33 (z +7.61) is the field most favourable to it; cause: n = 50 call-biased bettor-range showdown sample',
    source:
      'league card nlh_danger_board_equity_is_priced_vs_danger_bettor and _vs_danger_value, PR #11634 (docs/horse-option-authority.d/holdemDangerBoardEquityIsPriced.md; docs/changelog/2026-11-21-holdem-scripted-no-limit-field.md)',
  }),
  // 2026-11-21 Antigravity Coordinator: declared eval-40aba893fbc9 on the human-calibrated PLO6 field (F6 400/400
  // sessions, 200,000 pairs / 400,000 hands) failed with measured harm (-15.510 +/- 2.655 bb/100, z = -5.84);
  // Horse mirror M6 was not significant (+1.483 +/- 1.319, z = +1.12), and HVH48 true-card river fold->call bled
  // -334.4 bb vs OFF. Locked off-only as measured harm.
  plo6FacingBetIsPriced: Object.freeze({
    status: 'harm' as const,
    reason:
      'Declared eval-40aba893fbc9 (2026-11-21) VALID FAIL: F6 human-calibrated PLO6 field 400/400 sessions (200,000 pairs / 400,000 hands) -15.510 +/- 2.655 bb/100 (z = -5.84 < -2.0, 256/400 sessions negative); M6 Horse mirror 100/100 +1.483 +/- 1.319 (z = +1.12); 0 illegal/truncated/corrected/fallbacks; HVH48 true-card river fold->call -334.4 bb vs OFF',
    source:
      'DECLARATION-PLO6-FACING-BET-IS-PRICED.md (sha256 95ca359f), eval-40aba893fbc9/RESULT.json, docs/horse-option-authority.d/plo6FacingBetIsPriced.md',
  }),
  v24PloDefense: Object.freeze({
    status: 'harm' as const,
    reason: 'off-only stops an explicit true; it changes nothing by default',
    source:
      'release default ON with a PLO6-cash measured-harm carve-out (-2.34 +/- 1.12); an explicit true is unverified against the carve-out',
  }),
  // kept OFF by the owning lane
  plo6TopSetNutRealization: hold(OWNING_LANE_SOURCE, 'the owning lane keeps it OFF'),
  omahaCommitZoneThreeBetPriceRelief: hold(OWNING_LANE_SOURCE, 'the owning lane keeps it OFF'),
  lightningParticipationOmaha: hold(OWNING_LANE_SOURCE, 'the owning lane keeps it OFF'),
  // owner R7/R8 hold (FLOP-5 D6): the one V31 option the switch carries, and only `off`
  gtoV31CellContractV3Serving: hold(
    V31_CELL_CONTRACT_V3_SOURCE,
    'V31 cell contract v3 serving: held until the owner lifts it by name; it also needs a sealed, promoted and bound v3 dataset'
  ),
  // 2026-11-16 PLO6 lane: the gate that lets the PLO4/PLO5 strategy options act in PLO6. The six-card port is
  // unfinished (docs/horse-option-authority.d/omahaStrategyInPlo6.md lists the gaps), so the gate cannot be opened.
  omahaStrategyInPlo6: hold(
    'PLO6 lane (the owning lane): docs/horse-option-authority.d/omahaStrategyInPlo6.md',
    'PLO6 lane keeps it OFF until the six-card port is complete and reviewed (PLO6 checkpoint 2026-11-16)'
  ),
  // 2026-11-21 PLO-OWNER lead-4 (owner rule 8: no rule keyed on person vs Horse; AUDIT-B item 22 + exhaustive
  // origin/main audit, guarded by anOmahaRuleNeverKeysOnPersonVsHorse.law.test.ts): legacy dark Omaha options
  // that branch on `omahaOpponentKindOf` or opponent `.is_horse` stay locked OFF-ONLY until de-keyed or removed.
  // Two of them (`omahaBluffIsPricedAgainstTheTarget`, `omahaFacingBetValueShareIsMeasured`) plus
  // `omahaMultiwayIsPricedInTournaments` also carry the twice-failed PLO4/PLO5 OFF-ONLY ruling (2026-11-21T19:45:40Z).
  omahaBluffShareFromBetRate: hold(
    'owner rule 8 (no rule keyed on person vs Horse); PLO-OWNER lead-4 2026-11-21 (AUDIT-B item 22)',
    'keys on person vs Horse via omahaOpponentKindOf (HorseOmahaFacingBetEv.ts:225-234): locked OFF-ONLY'
  ),
  omahaPricedPriorsByOpponentKind: hold(
    'owner rule 8 (no rule keyed on person vs Horse); PLO-OWNER lead-4 2026-11-21 (AUDIT-B item 22)',
    'keys on person vs Horse via omahaOpponentKindOf (HorseOmahaPricedWiring.ts:181, HorseOmahaFacingBetEv.ts:1377): locked OFF-ONLY'
  ),
  omahaFlopBetUsesMeasuredFoldShare: hold(
    'owner rule 8 (no rule keyed on person vs Horse); PLO-OWNER lead-4 2026-11-21 (AUDIT-B item 22)',
    'person-only via omahaOpponentKindOf (HorseOmahaFlopBetMeasuredFoldShare.ts:172): locked OFF-ONLY'
  ),
  omahaFlopBetPricesTheRaise: hold(
    'owner rule 8 (no rule keyed on person vs Horse); PLO-OWNER lead-4 2026-11-21 (AUDIT-B item 22)',
    'person-only via omahaOpponentKindOf (HorseOmahaFlopBetRaiseBranch.ts:107): locked OFF-ONLY'
  ),
  omahaFoldModelFittedOnPeople: hold(
    'owner rule 8 (no rule keyed on person vs Horse); PLO-OWNER lead-4 2026-11-21 (AUDIT-B item 22)',
    'person-only via omahaOpponentKindOf (HorseOmahaFoldModelFittedOnPeople.ts:251): locked OFF-ONLY'
  ),
  omahaFlopDefenceIsPriced: hold(
    'owner rule 8 (no rule keyed on person vs Horse); PLO-OWNER lead-4 2026-11-21 (AUDIT-B item 22)',
    'keys on person vs Horse via omahaOpponentKindOf (HorseOmahaFlopFacingBetEvRule.ts:185, HorseOmahaFlopDefenceTree.ts:185): locked OFF-ONLY'
  ),
  omahaFlopVerdictReadsTheBettor: hold(
    'owner rule 8 (no rule keyed on person vs Horse); PLO-OWNER lead-4 2026-11-21 (AUDIT-B item 22)',
    'keys on person vs Horse via omahaOpponentKindOf (HorseOmahaFlopFacingBetEvRule.ts:149): locked OFF-ONLY'
  ),
  omahaCheckedToBetIsPriced: hold(
    'owner rule 8 (no rule keyed on person vs Horse); PLO-OWNER lead-4 2026-11-21 (AUDIT-B item 22)',
    'keys on person vs Horse via omahaOpponentKindOf (HorseOmahaCheckedToBet.ts:520): locked OFF-ONLY'
  ),
  omahaBluffIsPricedAgainstTheTarget: Object.freeze({
    status: 'harm' as const,
    reason:
      'twice-failed PLO4/PLO5 option AND keys on person vs Horse via omahaOpponentKindOf (HorseOmahaBluffPricedAgainstTheTarget.ts:388,448): locked OFF-ONLY',
    source:
      'PLO-OWNER lead-4 ruling 2026-11-21T19:45:40Z (twice-failed PLO4/PLO5 OFF-ONLY) + owner rule 8 (AUDIT-B item 22)',
  }),
  omahaFacingBetValueShareIsMeasured: Object.freeze({
    status: 'harm' as const,
    reason:
      'twice-failed PLO4/PLO5 option AND keys on person vs Horse via omahaOpponentKindOf (HorseLogic.ts:13188,13377): locked OFF-ONLY',
    source:
      'PLO-OWNER lead-4 ruling 2026-11-21T19:45:40Z (twice-failed PLO4/PLO5 OFF-ONLY) + owner rule 8',
  }),
  omahaPairedBoardRiverIsPriced: hold(
    'owner rule 8 (no rule keyed on person vs Horse); PLO-OWNER lead-4 2026-11-21',
    'person-only via omahaOpponentKindOf (HorseLogic.ts:13350): locked OFF-ONLY'
  ),
  omahaFacingBetValueIsRangeRelative: hold(
    'owner rule 8 (no rule keyed on person vs Horse); PLO-OWNER lead-4 2026-11-21',
    'person-only via omahaOpponentKindOf (HorseLogic.ts:13400): locked OFF-ONLY'
  ),
  omahaFacingBetIsPricedByEquity: hold(
    'owner rule 8 (no rule keyed on person vs Horse); PLO-OWNER lead-4 2026-11-21',
    'person-only via bettor.is_horse !== false (HorseOmahaFacingBetEquity.ts:262): locked OFF-ONLY'
  ),
  omahaMultiwayCheckedToBetIsPriced: hold(
    'owner rule 8 (no rule keyed on person vs Horse); PLO-OWNER lead-4 2026-11-21',
    'keys on person vs Horse via p.is_horse === true (HorseOmahaMultiwayDiscipline.ts:913,1048,1076,1080): locked OFF-ONLY'
  ),
  omahaSmallBetIsPriced: hold(
    'owner rule 8 (no rule keyed on person vs Horse); PLO-OWNER lead-4 2026-11-21',
    'keys on person vs Horse via scope.opponent.is_horse === true (HorseOmahaSmallBet.ts:197,271): locked OFF-ONLY'
  ),
  omahaMultiwayIsPricedInTournaments: Object.freeze({
    status: 'harm' as const,
    reason: 'twice-failed PLO4/PLO5 option: locked OFF-ONLY',
    source: 'PLO-OWNER lead-4 ruling 2026-11-21T19:45:40Z (twice-failed PLO4/PLO5 OFF-ONLY)',
  }),
  // superseded
  v55OmahaRiverTripsFlat: Object.freeze({
    status: 'superseded' as const,
    reason: 'superseded by the made-hand defense repair',
    source: 'PLO Strategy: made-hand defense repair',
  }),
});
/** A named lift of the owner preflop range hold: which option, and the owner text that lifts it. */
export interface OptionSwitchPreflopHoldLift {
  readonly source: string;
  readonly file: string;
  /** Full sha256 of the owner-text file when it was read; the file is append-only, so its digest moves later. */
  readonly sha256: string;
  readonly readAt: string;
}
/**
 * LIFTS OF THE OWNER PREFLOP RANGE HOLD (PREFLOP_HOLD_SOURCE), BY NAME. An option that changes a preflop range is
 * held off-only (OPTION_SWITCH_OFF_ONLY) until the owner lifts the hold for it by name; a lift is recorded HERE, in
 * source, never in a note. A name in this map is registered on/off (it must not be in OPTION_SWITCH_OFF_ONLY), and
 * the lift covers that name alone: every other PREFLOP_HOLD_SOURCE entry stays off-only.
 * horsePlayStyles (the three Horse playing styles, default OFF): its tight and pressure styles move preflop entry
 * and 3-bet/4-bet bars. Lifted by the owner's 2026-11-15 16:42 Chicago text, ruled sufficient for this option alone
 * by Hand Analysis (inbox 2026-11-16T03:06:28Z, B1).
 * omahaPreflopReraiseDefencePricedInPosition (THREEBET-2, default OFF): the in-position heads-up scope of the priced
 * preflop re-raise defence (it changes the continuing range of an opener against one 3-bet). Lifted for this name alone
 * under the owner's delegation of activation decisions to the WooWoo audit programme lane, 2026-11-18: "YOU OWN THE
 * CODEBASE, YOU DECIDE WHAT TURNS ON AND IF ITS READY" (relayed by the integrator, session 013U37bYh22, in the
 * THREEBET-2 brief), and the owner text it repeats, recorded verbatim at 2026-11-18T00:01:03Z in the programme
 * checkpoint ("you own this code base ... turn activation on and off as you see fit"). The lift makes the switch
 * accept `on` and `off`; it turns nothing on. omahaPreflopReraiseDefencePriced itself and every other
 * PREFLOP_HOLD_SOURCE entry stay off-only.
 * huBbDefendsUnreadToPrice (Heads Up HU-NLH-001d, default OFF): the heads-up big blind facing the only open from an
 * unread opener calls to its price at 20-50bb (it widens a big-blind calling range). Lifted for this name alone by the
 * Antigravity Coordinator (session_01UxDLnHu4P9fWx3X7Mp5FjM) under the owner's delegation of 2026-11-20 15:01
 * America/Chicago, quoted in the entry. The lift makes the switch accept `on` and `off`; it turns nothing on.
 * huBbDefendsToPrice, huOpenerDefendsToPrice, huLimpDefendsToPrice and every other PREFLOP_HOLD_SOURCE entry stay
 * off-only.
 */
export const OPTION_SWITCH_PREFLOP_HOLD_LIFTED: Readonly<
  Record<string, OptionSwitchPreflopHoldLift>
> = Object.freeze({
  horsePlayStyles: Object.freeze({
    source:
      'owner 2026-11-15 16:42 Chicago, "I WANT YOU TO TAKE CONTROL OF THIS AND MAKE ALL 3 PERSONA\'S AND RANDOMLY ASSIGN EACH HORSE A PLAYING TYPE ... PUT TOGETHER A PLAN AND EXECUTE ON THIS IDEA"',
    file: 'OWNER-TEXT-20261115-1000-PLO-CHAT-VERBATIM.md',
    sha256: '7921dea5df9daf5992faacb5a585f2fa67e2ae1c878936f040a3e7b0eea58b39',
    readAt: '2026-11-16T03:22:11Z (15,830 bytes; append-only, the digest moves as the file grows)',
  }),
  omahaPreflopReraiseDefencePricedInPosition: Object.freeze({
    source:
      'owner 2026-11-18, delegation of activation decisions to the WooWoo audit programme lane: "YOU OWN THE CODEBASE, YOU DECIDE WHAT TURNS ON AND IF ITS READY" (relayed by the integrator, session 013U37bYh22); the owner text it repeats, verbatim at 2026-11-18T00:01:03Z: "you own this code base ... turn activation on and off as you see fit." Lift for omahaPreflopReraiseDefencePricedInPosition by name, alone',
    file: 'woowoo-48h-audit-01BNteGYgf/CHECKPOINT.md',
    sha256: '63f041c4ca82354bcc6bec5edd93d7e121a56d6f8518aa99507d1d9de53b1be6',
    readAt: '2026-11-19T01:14:21Z (135,509 bytes; append-only, the digest moves as the file grows)',
  }),
  huBbDefendsUnreadToPrice: Object.freeze({
    source:
      'owner 2026-11-20 15:01 Chicago, to the Antigravity Coordinator chat: "YOU OWN THIS CODE BASE AND ARE TO MAKE ANY AND ALL DECISIONS, CHANGES, UPGRADES, ENHANCEMENTS ETC. AND COORDIANTE WITH THE ENGINE CUT OVER, HORSE DECISIONS AND ON OFF SWITCH CHATS AS NEEDED." Lift for huBbDefendsUnreadToPrice by name, alone (coordinator decision under that delegation, session_01UxDLnHu4P9fWx3X7Mp5FjM)',
    file: 'antigravity-coordinator-01UxDLnH/OWNER-TEXT-20261120-ANTIGRAVITY-COORDINATOR-VERBATIM.md',
    sha256: '90351f60b2dbcd6f7ce541d137fe4139c988893abf074e49de6031e5e2d9013e',
    readAt: '2026-11-20T21:15:22Z (1,595 bytes)',
  }),
});
/** The names whose off-only entry is the owner preflop range hold (used by the lift law test). */
export const OPTION_SWITCH_PREFLOP_HELD_NAMES: readonly string[] = Object.freeze(
  Object.keys(OPTION_SWITCH_OFF_ONLY).filter(
    (name) => OPTION_SWITCH_OFF_ONLY[name]!.source === PREFLOP_HOLD_SOURCE
  )
);
/**
 * Off-only names that are not ledger options YET: covered by exact name so they are off-only the moment they land.
 * The law allows an OPTION_SWITCH_OFF_ONLY name outside the ledger only when it is listed here.
 */
export const OPTION_SWITCH_OFF_ONLY_PENDING: readonly string[] = Object.freeze([]);
/** Future options held by name pattern: a blind steal, All-In-Or-Fold widening. */
const OFF_ONLY_PATTERNS: ReadonlyArray<readonly [RegExp, OptionSwitchOffOnly]> = [
  [
    /steal/i,
    hold(
      'owner hold: blind steal; owner ruling 2026-11-14 21:30 Chicago (tight steal responses stay OFF)',
      'a steal option: held until the owner lifts it by name'
    ),
  ],
  [
    /all[-_]?in[-_]?or[-_]?fold|(^|[^a-z])aof/i,
    hold('owner hold: All-In-Or-Fold widening', 'held until the owner lifts it by name'),
  ],
];
/** The enforced off-only status of an option (by name, then by pattern), or null when it may be switched on. */
export function optionSwitchOffOnly(name: string): OptionSwitchOffOnly | null {
  if (Object.hasOwn(OPTION_SWITCH_OFF_ONLY, name)) return OPTION_SWITCH_OFF_ONLY[name]!;
  for (const [pattern, entry] of OFF_ONLY_PATTERNS) if (pattern.test(name)) return entry;
  return null;
}

/**
 * Registered on/off options that never take `shadow`, by reason: their read is not per decision, so a re-decision
 * with the option flipped in the decision options would not flip what they read and the receipt would lie.
 */
export const OPTION_SWITCH_SHADOW_REFUSED: Readonly<Record<string, string>> = Object.freeze({
  fixedLimitBetsAreNeverProbes:
    'a process switch: HorseMind.applyFixedLimitBetsAreNeverProbesOption applies it before every job, not per decision',
  styleShiftReleaseIsNoiseAware:
    'a process switch: HorseMind.applyStyleShiftReleaseIsNoiseAwareOption applies it before every job, and the opponent memory it changes is learned outside a decision',
  gtoV31CellContractV3Serving:
    'the V31 loader follows the switched value process-wide (noteGtoV31CellContractV3ServingSwitch), not per decision',
  styleLongShownMemory:
    'the observer reads carry its evidence into the decision state only when it is on (workerRuntime.readViewOpts)',
  holdemProfileCompletenessCap:
    'the observer reads carry its evidence into the decision state only when it is on (workerRuntime.readViewOpts)',
  omahaOpponentLifetimeHud:
    'its lifetime record is loaded and attached only while the switch is on (OpponentHudStore arms on the switch; off = zero work), so a shadow re-decision would read no record and journal "same" falsely (lane SHADOW, 2026-11-21)',
});

/** Why `name` cannot take `shadow`, or null when it can (the registry entry decides, this is the rule). */
export function optionSwitchShadowRefusal(name: string): string | null {
  if (Object.hasOwn(OPTION_SWITCH_SHADOW_REFUSED, name)) return OPTION_SWITCH_SHADOW_REFUSED[name]!;
  const off = optionSwitchOffOnly(name);
  if (off) return `off-only (${off.status}: ${off.source})`;
  if (releaseDefaultOf(name) === 'code')
    return "its release default is decided by code ('code'), so the flipped value is not known: classify it first";
  return null;
}

/**
 * Why `name` cannot take `on_shadow`, or null when it can. The rule of shadow without its release-default reason: the
 * acted value (true) and the re-decided value (false) are both explicit, so a 'code' option takes it.
 */
export function optionSwitchOnShadowRefusal(name: string): string | null {
  if (Object.hasOwn(OPTION_SWITCH_SHADOW_REFUSED, name)) return OPTION_SWITCH_SHADOW_REFUSED[name]!;
  const off = optionSwitchOffOnly(name);
  if (off) return `off-only (${off.status}: ${off.source})`;
  return null;
}

/** Owner, scope and description where the activation inventory records them; else 'Programme' and the ledger. */
type Override = readonly [owner: OptionSwitchOwner, scope: string, description?: string];
const OVERRIDES: Readonly<Partial<Record<keyof HorseDecideOpts & string, Override>>> = {
  fixedLimitPricedPreflop: [
    'Fixed-Limit',
    'Fixed limit (flh, flo8) preflop, cash tables only (tournament inert by code)',
    'fixed-limit preflop priced at fixed-limit odds: first-in, facing a raise, big-blind defence (W5 P)',
  ],
  fixedLimitStealVsTightBlinds: [
    'Fixed-Limit',
    'Fixed limit (flh, flo8) cash preflop first-in, every player behind an own-evidence over-folder',
    'fixed-limit first-in steal from over-folding blinds (W5 S; off-only by the steal hold)',
  ],
  v16Hu: ['Heads Up', 'Heads-up postflop', 'heads-up postflop overlay'],
  v16Ratio: [HOLDEM, 'All (dead by precedence under V38)', 'V16 call/fold ratio rescale'],
  holdemTournamentAllInCallIsPriced: [
    HOLDEM,
    "Hold'em tournaments: preflop all-in calls (<= 25bb or committed), postflop calls facing a jam",
    'every hold-em tournament all-in call priced by equity vs ranges, dead money and ICM (audit E)',
  ],
  holdemValueAndCallsArePriced: [
    HOLDEM,
    'NLH cash (table and Lightning), heads-up postflop',
    "heads-up postflop value raises, made-hand bets/checks and calls priced against the bettor's line range (audit D)",
  ],
  holdemCommittedNoPairIsPriced: [
    HOLDEM,
    'NLH cash, heads-up, committed branch, no pair and no hole draw facing a wager',
    'committed no-pair no-draw hand facing a bet chooses fold, call or jam by EV and measured fold share',
  ],
  holdemDangerBoardEquityIsPriced: [
    HOLDEM,
    'NLH cash, heads-up, turn/river four-flush or four-straight board, one pair facing a wager',
    'one pair facing a bet on a four-flush or four-straight turn/river prices equity against measured bettor showdowns',
  ],
  cashDefenceTrimColdCalls: [
    HOLDEM,
    'NLH cash preflop facing a single open (non-BTN IP cold-calls and multiway caller spots)',
    'trims V85+V87 non-BTN IP cold-call and multiway double-stacking flatting bloat while keeping 3-bets and tournaments unchanged',
  ],
  v17RiverProbe: [HOLDEM, 'River probe', 'river probe into a capped field'],
  v23ShortDeck: [HOLDEM, 'Short deck', 'the short-deck half of the V23 variant polish'],
  v32FacingDefense: [HOLDEM, 'NLH solver facing-bet defence', 'solver facing-bet defence'],
  v33DepthCeiling: [HOLDEM, 'NLH solver lookups >300bb', 'solver depth ceiling (300bb)'],
  v55OmahaRiverTripsFlat: [
    'PLO Strategy',
    'Omaha river',
    'river Omaha weak sets/trips keep call pricing without re-shoving',
  ],
  fixedLimitRiverStrongHandLeads: [
    'Fixed-Limit',
    'Fixed limit (flh, flo8) river, first to act, nothing to call',
    'a first-to-act fixed-limit river full house or better that few holdings beat leads one big bet (W8)',
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
  fixedLimitReadIgnoresProbes: [
    'Fixed-Limit',
    'Fixed limit (flh, flo8), opponent aggression reads, with the F1 switch on',
    'a fixed-limit read is never discounted by the player no-limit/pot-limit probe share (F1b)',
  ],
  omahaNeutralUnknown: [
    'PLO Strategy',
    'Omaha (all), unknown opponent read',
    'an unknown Omaha opponent gets a neutral read',
  ],
  omahaNoMadeClassCap: [
    'PLO Strategy',
    'PLO4 / PLO5 cash, facing a wager with a weak made class (PLO6 untouched)',
    'the V40 made-hand class cap on equity does not run',
  ],
  omahaEvFoldModelSkipsPlo45: [
    'PLO Strategy',
    'PLO4 / PLO5 cash, EV bet engine fold price (PLO6 untouched)',
    'PLO4 / PLO5 price opponent folds with the exploit bluff multiplier, as before #10104',
  ],
  omahaHiLoTournamentFirstIn: ['Heads Up', 'PLO8 tournament, heads-up, <= 20 bb'],
  huBbDefendsToPrice: ['Heads Up', 'NLH heads-up cash, big blind facing the only open'],
  huOpenerDefendsToPrice: ['Heads Up', 'NLH heads-up cash, opener facing one 3-bet'],
  huLimpDefendsToPrice: ['Heads Up', 'NLH heads-up cash, small-blind limp facing one raise'],
  huBbDefendsUnreadToPrice: [
    'Heads Up',
    'NLH heads-up, big blind facing the only open, opener unread',
  ],
  huSmallBlindStealsVsTightBigBlind: [
    'Heads Up',
    'NLH heads-up, small blind first in vs a tight big blind',
  ],
  lightningStyleReadSeparate: ['Lightning', 'Lightning style read (NLH/PLO4/PLO5)'],
  lightningEarlyFoldNeedsFoldThrough: ['Lightning', 'Lightning early folds before the river'],
  lightningCheapEntryHoldem: ['Lightning', 'Lightning NLH small blind complete / over-limp'],
  lightningCheapEntryOmaha: ['Lightning', 'Lightning PLO4/PLO5 small blind complete / over-limp'],
  fixedLimitBetsAreNeverProbes: [
    'Fixed-Limit',
    'Fixed limit (flh, flo8), opponent probe tallies, every Horse process',
    'a fixed-limit checked-to bet is never counted as a probe (process switch, applied per job)',
  ],
  styleShiftReleaseIsNoiseAware: [
    HOLDEM,
    'Every variant, opponent exploit learning (live memory and the durable profile) and the gear-shift gate, every Horse process',
    'the style-shift release fires only beyond sampling noise and ages only the statistic that moved (process switch)',
  ],
  plo6FacingBetIsPricedV2: [
    'PLO6',
    'PLO6 cash facing a bet (table and Lightning)',
    'six-card native facing-bet pricing model fixing V1 valueShare blowup, low-SPR jams, six-card bluff priors, paired-board guard, and river call->fold',
  ],
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
  v41Leaks: 'owner hold: leak maps',
  v31GtoSuitAware: 'owner hold: the V31 solver store (R7/R8) is registration-gated',
  vpipFloorDeepStackOff: 'withdrawn by law: HorseWithdrawnRulesStayOff.law.test.ts (#10705)',
  omahaPreflopCallWithActionBehind:
    'withdrawn by law: HorseWithdrawnRulesStayOff.law.test.ts (#10705)',
  v58MadeHandCellSkip:
    'defect guard (Dan 2026-10-26, #8144: made set/straight/flush+ skips class-mean solver cell); decoupled from v57TournamentAggression, not registered in SQL switch',
  v78NoCommittingBluffRaiseIsPriced:
    "dark priced replacement for blanket v78NoCommittingBluffRaise (Hold'em Strategy / HORSE DECISIONS 2026-11-22, zero SQL migrations; held unregistered until promotion evidence meets bar)",
  multiBoardFreerollIsPriced:
    'dark zero-migration priced replacement for unowned V36 multi-board freeroll bet/raise coin flips (HORSE DECISIONS lane, 2026-11-22): default OFF, held out of SQL switch until live/replay people evidence and switch-list registration',
  multiBoardNonFreerollIsPriced:
    'dark zero-migration priced replacement for unowned V86 multi-board non-freeroll dead-half fold and strong-board open/raise branches (HORSE DECISIONS lane, 2026-11-22): default OFF, held out of SQL switch until live/replay people evidence and switch-list registration',
  multiBoardBluffTrimIsPriced:
    'dark zero-migration priced replacement for unowned V36 multi-board bluff-trim blanket multiplier (HORSE DECISIONS lane, 2026-11-22): default OFF, held out of SQL switch until live/replay people evidence and switch-list registration',
  horseSlowplayIsPriced:
    "dark zero-migration priced replacement for unowned H4 monster slowplay mix (Hold'em Strategy, 2026-11-22): default OFF, held out of SQL switch until activation evidence and switch-list registration",
  horseRunItTwiceIsPriced:
    'dark zero-migration priced replacement for Run-It-Twice fixed thresholds (HORSE DECISIONS lane, UNOWNED-RULES 2026-11-20; ledger-registered 2026-11-22): default OFF, held out of SQL switch until switch-list registration and authority rename',
  v17ShortDeckIsPriced:
    'dark zero-migration priced replacement for the unowned V17 Short Deck multiway overlay (HORSE DECISIONS lane, 2026-11-22): default OFF, held out of SQL switch until people evidence and switch-list registration',
  v17PosIsPriced:
    'dark zero-migration priced replacement for the unowned V17 players-behind bluff multiplier, single-board NLH flop and turn (HORSE DECISIONS lane, 2026-11-22): default OFF, held out of SQL switch until real-human evidence (people n >= 20) and switch-list registration',
  nashCallVsTightJammerRespect:
    'prototype hold: default-OFF prototype without a switch-list migration during the 4 PM hold; register in a follow-up migration PR',
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
  for (const [pattern, reason] of HELD_PATTERNS)
    if (pattern.test(name) && !OPTION_SWITCH_HELD_PATTERN_OFF_ONLY_NAMES.includes(name))
      return reason;
  return null;
}

const PLAIN_NAME = /^[A-Za-z][A-Za-z0-9]{0,62}$/;
const oneLine = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 160 ? `${flat.slice(0, 157)}...` : flat;
};

/**
 * One registered non-style option, from its ledger row: off (and on unless it is off-only), no shadow arm; shadow
 * by re-decision where optionSwitchShadowRefusal allows it, on_shadow where optionSwitchOnShadowRefusal allows it.
 */
function plainEntry(name: string, note: string, tag: string): OptionSwitchEntry {
  const override = (OVERRIDES as Readonly<Record<string, Override | undefined>>)[name];
  const offOnly = optionSwitchOffOnly(name);
  const shadow = optionSwitchShadowRefusal(name) === null;
  const onShadow = optionSwitchOnShadowRefusal(name) === null;
  return Object.freeze({
    name,
    owner: override?.[0] ?? ('Programme' as const),
    scope: override?.[1] ?? tag,
    states: offOnly
      ? OFF_ONLY
      : shadow
        ? OFF_SHADOW_ON_SHADOW_ON
        : onShadow
          ? OFF_ON_SHADOW_ON
          : ON_OFF,
    releaseDefault: releaseDefaultOf(name),
    shadowArm: false,
    ...(shadow ? { shadowRedecide: true } : {}),
    ...(onShadow ? { onShadowRedecide: true } : {}),
    description: override?.[2] ?? oneLine(note),
    ...(offOnly ? { offOnly } : {}),
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
/** The registered off-only options, in registry order: the names the database answers ARRAY['off'] for. */
export const OPTION_SWITCH_OFF_ONLY_NAMES: readonly string[] = Object.freeze(
  OPTION_SWITCH_PLAIN_REGISTRY.filter((e) => e.offOnly !== undefined).map((e) => e.name)
);
/** The registered non-style options that take `shadow` (a worker re-decision with the option flipped). */
export const OPTION_SWITCH_SHADOW_NAMES: readonly string[] = Object.freeze(
  OPTION_SWITCH_PLAIN_REGISTRY.filter((e) => e.shadowRedecide === true).map((e) => e.name)
);
/**
 * The registered non-style options that take `on_shadow` (acted with true, re-decided once with false). Every shadow
 * option is one of them.
 */
export const OPTION_SWITCH_ON_SHADOW_NAMES: readonly string[] = Object.freeze(
  OPTION_SWITCH_PLAIN_REGISTRY.filter((e) => e.onShadowRedecide === true).map((e) => e.name)
);
/** The registered non-style options that may be switched on (with their own citation). */
export const OPTION_SWITCH_ON_OFF_NAMES: readonly string[] = Object.freeze(
  OPTION_SWITCH_PLAIN_REGISTRY.filter((e) => e.offOnly === undefined).map((e) => e.name)
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
    const style = (STYLE_SWITCH_OPTIONS as readonly string[]).includes(e.name);
    const offOnly = style ? null : optionSwitchOffOnly(e.name);
    if (!e.states.includes('off')) throw new Error(`option switch: ${e.name} must support off`);
    if (offOnly && e.states.includes('on'))
      throw new Error(
        `option switch: ${e.name} is off-only (${offOnly.status}: ${offOnly.source}), so no on state`
      );
    if (!offOnly && !e.states.includes('on'))
      throw new Error(`option switch: ${e.name} must support off and on`);
    if (e.states.includes('canary') && !e.shadowArm)
      throw new Error(`option switch: ${e.name} has no shadow arm, so no canary state`);
    if (e.states.includes('canary') !== style || e.shadowArm !== style)
      throw new Error(
        `option switch: only the style options carry a shadow arm and canary (${e.name})`
      );
    if (!style && e.states.includes('shadow') !== (e.shadowRedecide === true))
      throw new Error(
        `option switch: ${e.name} takes shadow exactly when it is re-decided in shadow`
      );
    if (!style && e.shadowRedecide === true) {
      const refusal = optionSwitchShadowRefusal(e.name);
      if (refusal) throw new Error(`option switch: ${e.name} cannot take shadow (${refusal})`);
    }
    if (style && e.shadowRedecide === true)
      throw new Error(`option switch: ${e.name} is a style option: its shadow is its own arm`);
    // on_shadow (2026-11-19): exactly where it is re-decided, never for a style option, never without on, and the
    // order is off, shadow, on_shadow, on (the states list the database answers)
    if (style && (e.onShadowRedecide === true || e.states.includes('on_shadow')))
      throw new Error(`option switch: ${e.name} is a style option: it has no on_shadow`);
    if (!style && e.states.includes('on_shadow') !== (e.onShadowRedecide === true))
      throw new Error(
        `option switch: ${e.name} takes on_shadow exactly when it is re-decided in on_shadow`
      );
    if (!style && e.onShadowRedecide === true) {
      const refusal = optionSwitchOnShadowRefusal(e.name);
      if (refusal) throw new Error(`option switch: ${e.name} cannot take on_shadow (${refusal})`);
      if (!e.states.includes('on'))
        throw new Error(`option switch: ${e.name} takes on_shadow only with on`);
    }
    if (!style && e.shadowRedecide === true && e.onShadowRedecide !== true)
      throw new Error(`option switch: ${e.name} takes shadow, so it takes on_shadow too`);
    if (!style) {
      const order = ['off', 'shadow', 'on_shadow', 'on'];
      const at = e.states.map((x) => order.indexOf(x));
      if (at.some((i, k) => i < 0 || (k > 0 && i <= at[k - 1]!)))
        throw new Error(
          `option switch: ${e.name} lists its states out of order (off, shadow, on_shadow, on)`
        );
    }
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

export type OptionSwitchValue = 'off' | 'on' | 'shadow' | 'on_shadow';
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
 * A name this build does not know at all: not a registered option (style or not), not a parameter or plumbing
 * name (OPTION_SWITCH_NOT_A_SWITCH) and not a name this switch refuses (an authority-gated option, an owner hold). It is the row of another build: an option a
 * newer release registers, written while this release is serving, or one a later release removed.
 */
export function optionSwitchNameIsUnknown(name: string): boolean {
  return (
    !PLAIN_BY_NAME.has(name) &&
    !(STYLE_SWITCH_OPTIONS as readonly string[]).includes(name) &&
    !Object.hasOwn(OPTION_SWITCH_NOT_A_SWITCH, name) &&
    optionSwitchRefusal(name) === null
  );
}

/** The unknown names of a delivered non-style set, in the order delivered; [] when there is none or no set. */
export function optionSwitchUnknownNames(value: unknown): readonly string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>).filter(optionSwitchNameIsUnknown);
}

/**
 * A valid switched set (registered non-style names, each in a state it supports), in registry order; null when it
 * is not one. A name that is refused or a parameter, a style name, or a state the option does not support (`on`
 * for an off-only option) makes the whole set invalid: every non-style option then runs at its release default.
 *
 * AN UNKNOWN NAME IS SKIPPED ALONE (2026-11-20, lead order). A row for a name this build does not know at all
 * (optionSwitchNameIsUnknown) used to void the whole set, so one row written for another build silently returned
 * every switched option to its release default. That row is now left out and every other row stands; the holder
 * still raises option_switch_config_invalid_seen while such a row is delivered.
 */
export function optionSwitchStatesFrom(value: unknown): OptionSwitchStates | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  for (const [k, s] of Object.entries(v)) {
    if (optionSwitchNameIsUnknown(k)) continue;
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
 *   { version: 2, style: { version: 1, options: {...} }, options: { <option>: 'off' | 'on' | 'shadow' | 'on_shadow', ... } }
 * `style` belongs to StyleSwitchHolder and is not judged here. `options` may name registered non-style options
 * only, each in a state it supports; anything else is invalid, except a name this build does not know at all,
 * whose row alone is skipped (optionSwitchStatesFrom; optionSwitchConfigUnknownNames lists them).
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

/** One declared entry a replay arm cannot apply on this build, and why. */
export interface OptionSwitchArmDrop {
  option: string;
  state: string;
  reason: string;
}

/** A declared arm split option by option: what the brain will actually run with on this build. */
export interface OptionSwitchArm {
  /** The plain (non-style) options: a set optionSwitchStatesFrom accepts, in registry order. */
  states: OptionSwitchStates;
  /** The style options, for the style switch (HorseStyleSwitch); never part of `states`. */
  style: Readonly<Partial<Record<StyleSwitchOption, StyleSwitchState>>>;
  /** Every declared entry left out, in the order declared, with the reason. Empty when the arm is exactly as declared. */
  dropped: readonly OptionSwitchArmDrop[];
}

/**
 * REPLAY ARMS ARE SPLIT OPTION BY OPTION (2026-11-20). A declared or journaled option set mixes the style options
 * (their own switch), the plain options, and possibly entries this build cannot apply (an option made off-only
 * since the journal was written, a name this build does not register). Handed whole to the option switch, any one
 * of those voids the set and the arm silently runs at the release defaults. This keeps every entry that applies,
 * routes style names to `style`, and lists each entry it leaves out with the reason, so a driver can report it and
 * refuse to score an arm whose declared difference was dropped (optionSwitchArmStrict).
 */
export function optionSwitchArmFrom(
  declared: Readonly<Record<string, unknown>> | null | undefined
): OptionSwitchArm {
  const plain: Record<string, string> = {};
  const style: Partial<Record<StyleSwitchOption, StyleSwitchState>> = {};
  const dropped: OptionSwitchArmDrop[] = [];
  for (const [option, raw] of Object.entries(declared ?? {})) {
    const state = typeof raw === 'string' ? raw : String(JSON.stringify(raw));
    if ((STYLE_SWITCH_OPTIONS as readonly string[]).includes(option)) {
      if (typeof raw === 'string' && (STYLE_SWITCH_STATES as readonly string[]).includes(raw))
        style[option as StyleSwitchOption] = raw as StyleSwitchState;
      else
        dropped.push({
          option,
          state,
          reason: `a style option supports ${STYLE_SWITCH_STATES.join(' / ')}`,
        });
      continue;
    }
    const entry = PLAIN_BY_NAME.get(option);
    if (!entry) {
      dropped.push({
        option,
        state,
        reason: optionSwitchRefusal(option) ?? 'not a registered option of this build',
      });
      continue;
    }
    if (typeof raw === 'string' && (entry.states as readonly string[]).includes(raw)) {
      plain[option] = raw;
      continue;
    }
    const offOnly = optionSwitchOffOnly(option);
    dropped.push({
      option,
      state,
      reason:
        raw === 'on' && offOnly
          ? `off-only: ${offOnly.status}`
          : `unsupported state: the option supports ${entry.states.join(' / ')}`,
    });
  }
  const states = optionSwitchStatesFrom(plain);
  if (states === null)
    throw new Error(
      'optionSwitchArmFrom: a filtered set was refused (registry and filter disagree)'
    );
  return { states, style: Object.freeze(style), dropped: Object.freeze(dropped) };
}

/** optionSwitchArmFrom, but an arm that cannot be applied exactly as declared throws (an inert arm is never scored). */
export function optionSwitchArmStrict(
  declared: Readonly<Record<string, unknown>> | null | undefined
): OptionSwitchArm {
  const arm = optionSwitchArmFrom(declared);
  if (arm.dropped.length > 0)
    throw new Error(
      `replay arm not applied as declared: ${arm.dropped.map((d) => `${d.option}=${d.state} (${d.reason})`).join('; ')}`
    );
  return arm;
}

/** The unknown non-style names a version 2 answer delivers (their rows are skipped alone); [] otherwise. */
export function optionSwitchConfigUnknownNames(raw: unknown): readonly string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const r = raw as Record<string, unknown>;
  return r.version === 2 ? optionSwitchUnknownNames(r.options) : [];
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

/**
 * Replay: serves the recorded switched set as received now (it never ages inside a replay).
 *
 * A REFUSED SET IS AN ERROR HERE, NEVER SILENT DEFAULTS (2026-11-20). The live holder treats a set that
 * optionSwitchStatesFrom refuses whole (a style name among the plain options, or a state an option does not support,
 * e.g. `on` for an off-only option) as invalid, raises its alarm and runs every non-style option at its release
 * default. Inside a replay nothing watches that alarm: on 2026-11-19 an arm built from a journal's full option set
 * was refused whole, every option fell to its default and the on and off arms came out identical (coordination
 * inbox 2026-11-19T21:38:29Z). A set this build refuses whole therefore throws, naming every entry it cannot apply;
 * build arm sets with optionSwitchArmFrom, which splits a declared set option by option.
 */
export function optionSwitchSourceFromStates(
  states: OptionSwitchStates | null | undefined
): OptionSwitchSource {
  if (optionSwitchNothingSwitched(states)) return ABSENT_OPTION_SWITCH_SOURCE;
  if (optionSwitchStatesFrom(states) === null) {
    const why = optionSwitchArmFrom(states as Record<string, unknown>)
      .dropped.map((d) => `${d.option}=${d.state} (${d.reason})`)
      .join('; ');
    throw new Error(
      `replay option source: this build refuses the whole set, so every option would run at its release default: ${why || 'invalid set'}. Build the arm with optionSwitchArmFrom.`
    );
  }
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
 * Receipts: option_switch_<option>_<on|off|shadow|on_shadow|default>_seen when an option's switched value changes (`default`: its
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
            // A row for a name this build does not know is skipped alone; the alarm still fires at
            // every read that delivers one, so the row is seen and removed.
            if (optionSwitchConfigUnknownNames(reading.raw).length > 0)
              this.note('option_switch_config_invalid_seen');
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
 * Horses): `<option>: true` for on (never for an off-only option), `<option>: false` for off, nothing for an option without a row or
 * for a name that is not registered. Nothing switched gives {}. `on_shadow` gives true exactly like on (2026-11-19);
 * shadow gives nothing.
 */
export function optionSwitchDecisionOpts(
  states: OptionSwitchStates | null | undefined
): Readonly<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  if (states)
    for (const name of OPTION_SWITCH_PLAIN_NAMES)
      if (states[name] === 'on' && PLAIN_BY_NAME.get(name)?.offOnly === undefined) out[name] = true;
      else if (states[name] === 'off') out[name] = false;
      else if (
        states[name] === 'on_shadow' &&
        PLAIN_BY_NAME.get(name)?.offOnly === undefined &&
        PLAIN_BY_NAME.get(name)?.onShadowRedecide === true
      )
        out[name] = true;
  return out;
}

/**
 * The options in shadow or on_shadow, in registry order (only options that take that state; anything else is
 * ignored). Both are re-decided the same way; only the acted value and the flip differ (optionSwitchShadowFlip).
 */
export function optionSwitchShadowOptions(
  states: OptionSwitchStates | null | undefined
): readonly string[] {
  if (!states) return [];
  const out: string[] = [];
  for (const name of OPTION_SWITCH_ON_SHADOW_NAMES) {
    const entry = PLAIN_BY_NAME.get(name)!;
    if (
      (states[name] === 'shadow' && entry.shadowRedecide === true) ||
      (states[name] === 'on_shadow' && entry.onShadowRedecide === true)
    )
      out.push(name);
  }
  return out;
}

/**
 * The value the shadow re-decision passes for `option`: the opposite of what the acted decision ran with. The acted
 * value is the boolean the decision options carried (a feature flag or the caller), else the release default.
 * Null for an option that does not take shadow.
 *
 * `on_shadow` (2026-11-19, pass the option's switched state): the acted decision ran with true (as `on`), so the
 * re-decision passes false. Null for an option that does not take on_shadow.
 */
export function optionSwitchShadowFlip(
  option: string,
  acted: Readonly<Record<string, unknown>>,
  state?: OptionSwitchValue
): boolean | null {
  const entry = PLAIN_BY_NAME.get(option);
  if (state === 'on_shadow') return entry?.onShadowRedecide === true ? false : null;
  if (entry?.shadowRedecide !== true) return null;
  const v = acted[option];
  const live = typeof v === 'boolean' ? v : entry.releaseDefault === 'on';
  return !live;
}
