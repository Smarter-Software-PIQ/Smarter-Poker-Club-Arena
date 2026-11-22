// scripts/ops/holdem-blanket-scoreboard-lib.mjs
// Pure, deterministic core logic for the Hold'em Blanket Rule Removal &
// Priced Replacement Program Scoreboard CLI (read-only).
//
// Security invariants:
//   - Zero production I/O, zero `.env` or secret access.
//   - Every generated SQL statement is strictly validated read-only SELECT/WITH.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_TELEMETRY_DAYS = 3;
export const MAX_TELEMETRY_DAYS = 14;
export const DEFAULT_MAX_REGISTRY_AGE_SEC = 300;

export const NEXT_ACTIONS = Object.freeze([
  'READY_FOR_SHADOW',
  'READY_FOR_OFF_AFTER_GRADE',
  'AWAITING_PRICED_CHILD_GRADE',
  'PRICED_CHILD_LIVE_READY_TO_RETIRE_BLANKET',
  'LIVE_PRICED_COMPLETE',
  'HELD_PREFLOP_OR_OWNER',
  'COUPLED_NEEDS_SPLIT',
]);

export const SHADOW_STATES = Object.freeze(['shadow', 'on_shadow']);

export const HOLDEM_OFFLIST_SETTING_PREFIXES = Object.freeze([
  'horse.blanketRuleOffInHoldem.',
  'horse.blanketRowOffInHoldem.',
  'horse.blanketRowOffInHoldemCash.',
  'horse.holdemBlanketRuleOff.',
  'horse.holdemBlanketRulesOff.',
]);

const MUTATING_SQL_RE =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|COPY|CALL|MERGE|REPLACE)\b/i;

/**
 * Authoritative catalog of the Hold'em Blanket Rule Removal & Priced Replacement Program.
 *
 * Each entry captures:
 *   - option: exact camelCase HorseDecideOpts / switch name
 *   - role: 'blanket_parent' | 'priced_replacement' | 'refused_guard'
 *   - family: domain grouping for reporting
 *   - scope: concise decision scope
 *   - pricedChildren: priced replacement option(s) targeting this blanket parent
 *   - replacesBlankets: for priced replacements, blanket parent(s) replaced
 *   - nestedChild: true when the priced child runs INSIDE the parent's gate
 *     (turning the parent OFF would disable the priced child!)
 *   - preflopOrOwnerHold: true when rule changes preflop ranges or is owner/defect-held
 *   - holdNote: short rationale when held
 *   - hasDevGradeCards: true when Hold'em blanket-off dev league cards exist in HorseLeague.ts
 *   - staticCoupling: optional umbrella/source coupling descriptor (overridden by live
 *     HorseLogic.ts detection when available)
 *   - receipts: telemetry feature names or wildcard prefixes (`prefix_*`)
 */
export const HOLDEM_BLANKET_CATALOG = Object.freeze([
  // ── Priced Replacements (default OFF in source) ────────────────────────────────────────────
  Object.freeze({
    option: 'holdemRiverFullHouseValueIsPriced',
    role: 'priced_replacement',
    family: 'river_value',
    scope:
      'NLH cash/MTT heads-up river full house lead vs check (nested in holdemRiverFullHouseValue)',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze(['holdemRiverFullHouseValue']),
    nestedChild: true,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze([
      'holdem_river_full_house_lead_priced',
      'holdem_river_full_house_check_priced',
      'holdem_river_full_house_lead_unpriced',
    ]),
  }),
  Object.freeze({
    option: 'holdemTournamentAllInCallIsPriced',
    role: 'priced_replacement',
    family: 'tournament_allin',
    scope:
      'NLH tournaments preflop <=25bb / committed & postflop jam call pricing (preflop hold lifted)',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze(['nashCallVsJam']),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze([
      'holdem_tournament_all_in_call_priced_call_seen',
      'holdem_tournament_all_in_call_priced_fold_seen',
      'holdem_tournament_all_in_call_unpriced_seen',
      'holdem_tournament_all_in_call_reference_kept_seen',
      'holdem_tournament_committed_stack_call_seen',
      'holdem_tournament_postflop_all_in_call_priced_seen',
      'holdem_tournament_postflop_call_priced_fold_seen',
    ]),
  }),
  Object.freeze({
    option: 'huBbDefendsUnreadToPrice',
    role: 'priced_replacement',
    family: 'hu_priced',
    scope: 'NLH HU big blind vs unread open 20-50bb priced defend (preflop hold lifted)',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze(['hu_bb_defends_unread_to_price']),
  }),
  Object.freeze({
    option: 'holdemValueAndCallsArePriced',
    role: 'priced_replacement',
    family: 'postflop_priced',
    scope: 'NLH cash (table + Lightning) HU postflop value raises, made bets/checks, and calls',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze(['v87RiverBlockBetTrap', 'v87FlopStabCheckRaise']),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze([
      'holdem_priced_value_raise_deferred',
      'holdem_priced_raise',
      'holdem_priced_call',
      'holdem_priced_fold',
      'holdem_priced_bet',
      'holdem_priced_check',
      'holdem_priced_changed',
      'holdem_priced_unpriced',
      'holdem_priced_unpriced_multiway',
    ]),
  }),
  Object.freeze({
    option: 'horseRiverNoBlockerBet',
    role: 'priced_replacement',
    family: 'river_trap',
    scope: 'NLH (<25% pot) & PLO4/5 (<40% pot) cash river first-bet blocker-bet guard',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze(['v87RiverBlockBetTrap']),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze([
      'river_no_blocker_bet_checked',
      'river_no_blocker_bet_resized_priced',
      'river_no_blocker_bet_resized_nuts',
      'river_no_blocker_bet_failed',
    ]),
  }),
  Object.freeze({
    option: 'holdemHeadsUpPostflopBalance',
    role: 'priced_replacement',
    family: 'hu_priced',
    scope: 'NLH cash HU IP flop/turn SRP postflop balance',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze([
      'hu_postflop_balance_flop_cbet',
      'hu_postflop_balance_check_raise_defend',
      'hu_postflop_balance_later_street',
    ]),
  }),
  Object.freeze({
    option: 'holdemCommittedNoPairIsPriced',
    role: 'priced_replacement',
    family: 'postflop_priced',
    scope: 'NLH cash HU committed no-pair no-draw facing bet (locked off-only: measured harm)',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze([
      'holdem_committed_no_pair_jam_priced',
      'holdem_committed_no_pair_call_priced',
      'holdem_committed_no_pair_fold_priced',
      'holdem_committed_no_pair_unpriced',
    ]),
  }),
  Object.freeze({
    option: 'holdemDangerBoardEquityIsPriced',
    role: 'priced_replacement',
    family: 'postflop_priced',
    scope:
      'NLH cash HU four-flush/four-straight turn/river one-pair equity (locked off-only: measured harm)',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze(['holdem_danger_board_equity_priced']),
  }),

  // ── Blanket Parents With Designated Priced Children ────────────────────────────────────────
  Object.freeze({
    option: 'holdemRiverFullHouseValue',
    role: 'blanket_parent',
    family: 'river_value',
    scope:
      'NLH river full-house lead gate (hosts nested priced child holdemRiverFullHouseValueIsPriced)',
    pricedChildren: Object.freeze(['holdemRiverFullHouseValueIsPriced']),
    replacesBlankets: Object.freeze([]),
    nestedChild: true,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze(['holdem_river_full_house_lead_seen']),
  }),
  Object.freeze({
    option: 'v87RiverBlockBetTrap',
    role: 'blanket_parent',
    family: 'river_trap',
    scope: 'NLH river block-bet trap / blocker bluff / nut trap blanket',
    pricedChildren: Object.freeze(['holdemValueAndCallsArePriced', 'horseRiverNoBlockerBet']),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze([
      'v86_river_block_trap',
      'v87_river_block_blocker_bluff',
      'v87_river_block_lag_check',
      'v87_river_block_nut_trap',
      'v87_river_block_raised_one_pair_fold',
      'v87_river_block_trap_reraise',
      'v87_river_blocker_bluff_raise',
    ]),
  }),
  Object.freeze({
    option: 'v87FlopStabCheckRaise',
    role: 'blanket_parent',
    family: 'flop_turn_defense',
    scope: 'NLH flop stab check-raise / jam blanket',
    pricedChildren: Object.freeze(['holdemValueAndCallsArePriced']),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze(['v87_flop_stab_check_raise', 'v87_flop_stab_jam']),
  }),

  // ── Clean Blanket-Off Candidates With Committed Dev Grade Cards (Wave 4/5) ────────────────
  Object.freeze({
    option: 'v80TopPairStrongKicker',
    role: 'blanket_parent',
    family: 'river_defense',
    scope:
      'NLH ring river top-pair strong-kicker call floor (routes directly to V38 priced logic when OFF)',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: true,
    receipts: Object.freeze(['v80_top_pair_strong_kicker']),
  }),
  Object.freeze({
    option: 'v79TopPairWeakKicker',
    role: 'blanket_parent',
    family: 'river_defense',
    scope:
      'NLH ring river top-pair weak-kicker fold floor (routes directly to V38 priced logic when OFF)',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: true,
    receipts: Object.freeze(['v79_top_pair_weak_kicker']),
  }),
  Object.freeze({
    option: 'v68TurnAirDrawCalls',
    role: 'blanket_parent',
    family: 'turn_defense',
    scope: 'NLH turn air/draw call shade (routes directly to V38 priced logic when OFF)',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: true,
    receipts: Object.freeze(['v68_turn_air_draw_calls']),
  }),

  // ── Decoupled Postflop Hold'em Blanket Rules (PR #11713) ───────────────────────────────────
  Object.freeze({
    option: 'v65TurnOnePairShade',
    role: 'blanket_parent',
    family: 'turn_defense',
    scope:
      'NLH turn one-pair equity shade (decoupled from Pillar 2 v87DeepDiveDiscipline in #11713)',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze(['v65_turn_one_pair_shade']),
  }),
  Object.freeze({
    option: 'v57TournamentAggression',
    role: 'blanket_parent',
    family: 'tournament_postflop',
    scope:
      'NLH tournament-only aggression & turn cell skip (decoupled from v58MadeHandCellSkip in #11713)',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze(['v57_turn_cell_initiative_skip']),
  }),
  Object.freeze({
    option: 'v61RiverOnePairShade',
    role: 'blanket_parent',
    family: 'river_defense',
    scope: 'NLH river one-pair equity shade (decoupled from v67RiverBetRaisedOnePair in #11713)',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze(['v61_river_one_pair_shade']),
  }),

  // ── Other Clean Switchable Postflop Hold'em Blanket Rules ──────────────────────────────────
  Object.freeze({
    option: 'v67RiverBetRaisedOnePair',
    role: 'blanket_parent',
    family: 'river_defense',
    scope: 'NLH river bet-raised one-pair shade & raise stratum (independent of v61 since #11713)',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze(['v67_river_bet_raised_one_pair', 'v67_river_raise_stratum']),
  }),
  Object.freeze({
    option: 'v66BetRaisedOnePair',
    role: 'blanket_parent',
    family: 'flop_turn_defense',
    scope: 'NLH flop/turn bet-raised one-pair shade & raise stratum',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze(['v66_bet_raised_one_pair', 'v66_raise_stratum']),
  }),
  Object.freeze({
    option: 'v63LargeRiverBetShade',
    role: 'blanket_parent',
    family: 'river_defense',
    scope: 'NLH large river bet equity shade',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze(['v63_large_river_bet_shade']),
  }),
  Object.freeze({
    option: 'v64RiverRaiseNeedsTwoPair',
    role: 'blanket_parent',
    family: 'river_defense',
    scope: 'NLH river raise categorical hand-class gate (needs two pair+)',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze(['v64_river_raise_needs_two_pair']),
  }),
  Object.freeze({
    option: 'v51RiverFlat',
    role: 'blanket_parent',
    family: 'river_defense',
    scope: 'NLH river flat-call blanket',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze(['v51_river_flat']),
  }),
  Object.freeze({
    option: 'v52RangeAdvantage',
    role: 'blanket_parent',
    family: 'flop_turn_defense',
    scope: 'Postflop range-advantage aggression overlay',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze(['v52_*']),
  }),
  Object.freeze({
    option: 'v53Pressure',
    role: 'blanket_parent',
    family: 'flop_turn_defense',
    scope: 'Postflop/preflop pressure aggression layer',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze(['v53_*']),
  }),
  Object.freeze({
    option: 'v78NoCommittingBluffRaise',
    role: 'blanket_parent',
    family: 'bluff_baseline',
    scope: 'Categorical guard against committing bluff raises',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze(['v78_no_committing_bluff_raise']),
  }),
  Object.freeze({
    option: 'v83AggressionNeedsBluffs',
    role: 'blanket_parent',
    family: 'bluff_baseline',
    scope: 'Aggression-to-value bluff balance gate',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze(['v83_aggression_shown_as_value']),
  }),
  // Note: v15RiverNoNearLock (HL:29635-29655), v88CommitmentHonored (HL:29018-29052),
  // tokenCallPrice (HL:29261-29291 / HorseTokenCallPrice.ts), and v46Charts
  // (HL:20855, 21871-21887 / HorseHandClasses.ts) are strictly Omaha/non-NLH-only
  // (vi.isOmaha / short-deck; zero NLH reach) and owned by the PLO lane — excluded here.
  Object.freeze({
    option: 'v21River',
    role: 'blanket_parent',
    family: 'river_defense',
    scope:
      'NLH river nut status, dominated caps, scare-runout cap/commit, and river raise-war governor',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze([
      'v21_nut_status',
      'v21_dominated_cap',
      'v21_scare_cap',
      'v21_scare_commit',
      'v21_war_gate',
    ]),
  }),
  Object.freeze({
    option: 'holdemPremiumAggression',
    role: 'blanket_parent',
    family: 'flop_turn_defense',
    scope: 'NLH premium-hand preflop/postflop aggression blanket',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze([
      'holdem_premium_preflop_raise',
      'holdem_premium_postflop_bet',
      'holdem_premium_flat_deep_three_bet',
    ]),
  }),
  Object.freeze({
    option: 'holdemDominatedFold',
    role: 'blanket_parent',
    family: 'flop_turn_defense',
    scope: 'NLH dominated 3-bet / no-4bet-bluff blanket',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze(['holdem_dominated_3bet_fold', 'holdem_no_four_bet_bluff']),
  }),
  Object.freeze({
    option: 'flopTurnBluffBaseline',
    role: 'blanket_parent',
    family: 'bluff_baseline',
    scope: 'Flop/turn baseline bluff selector',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze(['flop_turn_bluff_*']),
  }),
  Object.freeze({
    option: 'riverBluffBaseline',
    role: 'blanket_parent',
    family: 'bluff_baseline',
    scope: 'River baseline bluff selector (HU)',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze(['river_bluff_baseline_*']),
  }),
  Object.freeze({
    option: 'riverLeadRange',
    role: 'blanket_parent',
    family: 'bluff_baseline',
    scope: 'River OOP lead value/bluff selector',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze(['river_lead_*']),
  }),
  Object.freeze({
    option: 'riverBluffMultiway',
    role: 'blanket_parent',
    family: 'bluff_baseline',
    scope: 'Multiway river bluff selector',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze(['river_bluff_multiway_*']),
  }),
  Object.freeze({
    option: 'riverFastCalldown',
    role: 'blanket_parent',
    family: 'river_defense',
    scope: 'River fast call-down station blanket',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze([
      'river_fast_calldown_station',
      'river_fast_calldown_station_multiway',
    ]),
  }),
  Object.freeze({
    option: 'probeAwareAggression',
    role: 'blanket_parent',
    family: 'flop_turn_defense',
    scope: 'Probe-aware aggression blanket',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze(['probe_aware_*']),
  }),
  Object.freeze({
    option: 'committedRaiseDiscipline',
    role: 'blanket_parent',
    family: 'turn_defense',
    scope: 'Committed raise discipline gate',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze(['committed_raise_*']),
  }),
  Object.freeze({
    option: 'v9Mood',
    role: 'blanket_parent',
    family: 'umbrella',
    scope: 'Hourly mood drift overlay (already off in PLO4/5 cash off-list)',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    receipts: Object.freeze(['v9_mood_*']),
  }),

  // ── Coupled Blanket Rules Needing Split Before Single-Rule Grading ─────────────────────────
  Object.freeze({
    option: 'v69TurnCallGaps',
    role: 'blanket_parent',
    family: 'turn_defense',
    scope:
      'NLH turn call gap / hole-draw predicate (dynamically checked vs Pillar 2 shade87NlhTurnCommit)',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    staticCoupling: Object.freeze({
      coupledWith: Object.freeze(['v87DeepDiveDiscipline']),
      reason: 'v69TurnCallGaps gates holdemHoleDrawPresent inside Pillar 2 shade87NlhTurnCommit',
    }),
    receipts: Object.freeze(['v69_turn_call_gaps']),
  }),
  Object.freeze({
    option: 'v73Vs3BetDefence',
    role: 'blanket_parent',
    family: 'preflop_range',
    scope:
      'NLH opener facing 3-bet defence (dynamically checked vs v75SqueezeDefence early-return)',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: true,
    holdNote: 'preflop range rule (also coupled to v75SqueezeDefence until split)',
    hasDevGradeCards: false,
    staticCoupling: Object.freeze({
      coupledWith: Object.freeze(['v75SqueezeDefence']),
      reason: 'v73Vs3BetDefence === false returns before v75SqueezeDefence branch in gtoVs3Bet73',
    }),
    receipts: Object.freeze(['v73_vs3bet_defence']),
  }),
  Object.freeze({
    option: 'v87HoldemOverhaul',
    role: 'blanket_parent',
    family: 'umbrella',
    scope:
      'V87 Holdem umbrella gating multiple preflop/postflop sub-rules (range cbet, low SPR, traps)',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: false,
    hasDevGradeCards: false,
    staticCoupling: Object.freeze({
      coupledWith: Object.freeze([
        'v87RangeCbet',
        'v87LowSprCommit',
        'v87TurnTakeaway',
        'v87IpCheckbackTrap',
      ]),
      reason:
        'umbrella option gating >8 distinct preflop & postflop sub-rules; split before grading',
    }),
    receipts: Object.freeze([
      'v87_range_cbet',
      'v87_low_spr_commit',
      'v87_turn_takeaway',
      'v87_ip_checkback_trap',
      'v87_deep_cash_onepair_pot_control',
      'v87_multiway_wet_air_check',
      'v87_bubble_covered_pot_control',
    ]),
  }),

  // ── Refused / Owner-Held Defect Guards & Pillar 2 ──────────────────────────────────────────
  Object.freeze({
    option: 'v87DeepDiveDiscipline',
    role: 'refused_guard',
    family: 'owner_hold',
    scope: 'Pillar 2 deep-dive discipline (OPTION_SWITCH_REFUSED: owner hold)',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: true,
    holdNote: 'OPTION_SWITCH_REFUSED: owner hold Pillar 2',
    hasDevGradeCards: false,
    receipts: Object.freeze(['v87_deep_dive_discipline']),
  }),
  Object.freeze({
    option: 'v58MadeHandCellSkip',
    role: 'refused_guard',
    family: 'owner_hold',
    scope:
      'NLH made set/straight/flush+ class-mean cell skip (#8144 defect guard, decoupled from v57)',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: true,
    holdNote: 'OPTION_SWITCH_REFUSED: #8144 defect guard',
    hasDevGradeCards: false,
    receipts: Object.freeze(['v58_made_hand_cell_skip']),
  }),

  // ── Preflop Range Rules (Held Under Preflop Range Care / Owner Sign-Off) ───────────────────
  Object.freeze({
    option: 'v60CashPressure',
    role: 'blanket_parent',
    family: 'preflop_range',
    scope: 'NLH cash preflop facing-open & opener-vs-3bet pressure',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: true,
    holdNote: 'changes preflop ranges',
    hasDevGradeCards: false,
    receipts: Object.freeze([
      'v60_cash_pressure_facing_open',
      'v60_cash_pressure_facing_open_superseded',
      'v60_cash_pressure_opener_vs_three_bet',
    ]),
  }),
  Object.freeze({
    option: 'v70GtoOpeningRanges',
    role: 'blanket_parent',
    family: 'preflop_range',
    scope: 'NLH GTO preflop opening ranges',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: true,
    holdNote: 'changes preflop opening ranges',
    hasDevGradeCards: false,
    receipts: Object.freeze(['v70_gto_open']),
  }),
  Object.freeze({
    option: 'v70FacingOpenZone',
    role: 'blanket_parent',
    family: 'preflop_range',
    scope: 'NLH preflop facing-open zone',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: true,
    holdNote: 'changes preflop facing-open ranges',
    hasDevGradeCards: false,
    receipts: Object.freeze(['v70_facing_open_zone_changed_seen']),
  }),
  Object.freeze({
    option: 'v71AnteAwarePushFold',
    role: 'blanket_parent',
    family: 'preflop_range',
    scope: 'NLH tournament ante-aware preflop push/fold',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: true,
    holdNote: 'changes preflop push/fold ranges',
    hasDevGradeCards: false,
    receipts: Object.freeze(['v71_ante_push']),
  }),
  Object.freeze({
    option: 'v72DefenceByOpener',
    role: 'blanket_parent',
    family: 'preflop_range',
    scope: 'NLH 3+ player preflop defence by opener seat',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: true,
    holdNote: 'changes preflop defending ranges (authority doc recorded)',
    hasDevGradeCards: false,
    receipts: Object.freeze(['v72_defend_vs_opener']),
  }),
  Object.freeze({
    option: 'v74NlhOpenSizes',
    role: 'blanket_parent',
    family: 'preflop_range',
    scope: 'NLH preflop open sizing table',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: true,
    holdNote: 'changes preflop open sizes/ranges',
    hasDevGradeCards: false,
    receipts: Object.freeze(['v74_nlh_open_size']),
  }),
  Object.freeze({
    option: 'v75SqueezeDefence',
    role: 'blanket_parent',
    family: 'preflop_range',
    scope: 'NLH preflop squeezed opener defence',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: true,
    holdNote: 'changes preflop squeeze defence ranges',
    hasDevGradeCards: false,
    receipts: Object.freeze(['v75_squeeze_defence']),
  }),
  Object.freeze({
    option: 'v76RetireFourBetBluffBand',
    role: 'blanket_parent',
    family: 'preflop_range',
    scope: 'NLH preflop 4-bet bluff band retirement',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: true,
    holdNote: 'changes preflop 4-bet ranges',
    hasDevGradeCards: false,
    receipts: Object.freeze(['v76_retired_four_bet_bluff']),
  }),
  Object.freeze({
    option: 'v77SeatAwareJams',
    role: 'blanket_parent',
    family: 'preflop_range',
    scope: 'NLH tournament seat-aware preflop jams',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: true,
    holdNote: 'changes preflop jam ranges',
    hasDevGradeCards: false,
    receipts: Object.freeze(['v77_seat_jam']),
  }),
  Object.freeze({
    option: 'v85CashAction',
    role: 'blanket_parent',
    family: 'preflop_range',
    scope: 'NLH cash preflop action & straddle adjustment',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: true,
    holdNote: 'changes preflop cash ranges',
    hasDevGradeCards: false,
    receipts: Object.freeze(['v85_*']),
  }),
  Object.freeze({
    option: 'nashCallVsJam',
    role: 'blanket_parent',
    family: 'preflop_range',
    scope:
      'NLH tournament Nash call-vs-jam chart (superseded in <=25bb spots by holdemTournamentAllInCallIsPriced)',
    pricedChildren: Object.freeze(['holdemTournamentAllInCallIsPriced']),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: true,
    holdNote: 'preflop chart kept for exact chart_bb_defend & fallback outside priced window',
    hasDevGradeCards: false,
    receipts: Object.freeze(['nash_call_vs_jam']),
  }),
  Object.freeze({
    option: 'limpReraiseIsoRead',
    role: 'blanket_parent',
    family: 'preflop_range',
    scope: 'NLH preflop limp-reraise isolation read',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: true,
    holdNote: 'changes preflop limp-reraise ranges',
    hasDevGradeCards: false,
    receipts: Object.freeze(['limp_reraise_iso_read']),
  }),

  // ── Off-Only Held Hold'em Options (Owner Preflop Hold / Measured Harm) ─────────────────────
  Object.freeze({
    option: 'v62RiverBettorPolarity',
    role: 'blanket_parent',
    family: 'river_defense',
    scope: 'NLH river bettor polarity (off-only: measured harm)',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: true,
    holdNote: 'OPTION_SWITCH_OFF_ONLY: measured harm',
    hasDevGradeCards: false,
    receipts: Object.freeze(['v62_*']),
  }),
  Object.freeze({
    option: 'holdemPersonaPreflop',
    role: 'blanket_parent',
    family: 'preflop_range',
    scope: 'NLH deep cash persona preflop range layer (off-only: owner preflop hold)',
    pricedChildren: Object.freeze([]),
    replacesBlankets: Object.freeze([]),
    nestedChild: false,
    preflopOrOwnerHold: true,
    holdNote: 'OPTION_SWITCH_OFF_ONLY: owner preflop range hold',
    hasDevGradeCards: false,
    receipts: Object.freeze(['holdem_persona_preflop_*']),
  }),
]);

// ── Validators & SQL Read-Only Safety ──────────────────────────────────────────────────────────

export function validateTelemetryDays(raw) {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_TELEMETRY_DAYS) {
    throw new Error(
      `Invalid --telemetry-days "${String(raw)}": must be an integer between 1 and ${MAX_TELEMETRY_DAYS}`
    );
  }
  return n;
}

export function assertReadOnlySql(sql) {
  if (typeof sql !== 'string' || !sql.trim()) {
    throw new Error('SQL query must be a non-empty string');
  }
  const trimmed = sql.trim();
  if (!/^(SELECT|WITH)\b/i.test(trimmed)) {
    throw new Error('Refusing non-SELECT SQL in read-only scoreboard');
  }
  // Strip single-quoted literals before checking for semicolons or mutating SQL keywords.
  const withoutStrings = trimmed.replace(/'(?:''|[^'])*'/g, "''");
  if (withoutStrings.includes(';')) {
    throw new Error('Refusing multi-statement SQL in read-only scoreboard');
  }
  if (MUTATING_SQL_RE.test(withoutStrings)) {
    throw new Error('Refusing mutating SQL keyword in read-only scoreboard');
  }
  return trimmed;
}

export function parseCliArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  let json = false;
  let offline = false;
  let onlyActionable = false;
  let help = false;
  let telemetryDays = DEFAULT_TELEMETRY_DAYS;
  let supabaseWorkdir = null;
  const actions = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--offline') {
      offline = true;
    } else if (arg === '--only-actionable') {
      onlyActionable = true;
    } else if (arg === '--telemetry-days') {
      const next = args[++i];
      if (next === undefined) throw new Error('--telemetry-days requires an integer argument');
      telemetryDays = validateTelemetryDays(next);
    } else if (arg.startsWith('--telemetry-days=')) {
      telemetryDays = validateTelemetryDays(arg.slice('--telemetry-days='.length));
    } else if (arg === '--action') {
      const next = args[++i];
      if (!next || !NEXT_ACTIONS.includes(next)) {
        throw new Error(
          `Invalid --action "${String(next ?? '')}": expected one of ${NEXT_ACTIONS.join(', ')}`
        );
      }
      actions.push(next);
    } else if (arg.startsWith('--action=')) {
      const val = arg.slice('--action='.length);
      if (!NEXT_ACTIONS.includes(val)) {
        throw new Error(`Invalid --action "${val}": expected one of ${NEXT_ACTIONS.join(', ')}`);
      }
      actions.push(val);
    } else if (arg === '--supabase-workdir') {
      const next = args[++i];
      if (!next) throw new Error('--supabase-workdir requires a directory path');
      supabaseWorkdir = next;
    } else if (arg.startsWith('--supabase-workdir=')) {
      supabaseWorkdir = arg.slice('--supabase-workdir='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return {
    json,
    offline,
    onlyActionable,
    help,
    telemetryDays,
    supabaseWorkdir,
    actions,
  };
}

export function resolveLinkedSupabaseWorkdir({
  cwd = process.cwd(),
  gitCommonDirRunner,
  pathExists = existsSync,
} = {}) {
  const localRef = path.join(cwd, 'supabase', '.temp', 'project-ref');
  if (pathExists(localRef)) {
    return cwd;
  }
  if (typeof gitCommonDirRunner === 'function') {
    const rawCommon = String(gitCommonDirRunner(cwd) ?? '').trim();
    if (rawCommon) {
      const resolvedCommon = path.isAbsolute(rawCommon) ? rawCommon : path.resolve(cwd, rawCommon);
      const primaryCheckout = path.dirname(resolvedCommon);
      if (pathExists(path.join(primaryCheckout, 'supabase', '.temp', 'project-ref'))) {
        return primaryCheckout;
      }
      return primaryCheckout;
    }
  }
  return cwd;
}

export function parseSupabaseJsonOutput(raw) {
  const text = String(raw ?? '').trim();
  if (!text) {
    throw new Error('Supabase query returned empty output');
  }
  try {
    return JSON.parse(text);
  } catch {
    // Supabase CLI may print "Using workdir ..." before or version notices after JSON.
    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');
    if (firstBracket >= 0 && lastBracket > firstBracket) {
      return JSON.parse(text.slice(firstBracket, lastBracket + 1));
    }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    }
    throw new Error(`Failed to parse Supabase JSON output: ${text.slice(0, 200)}`);
  }
}

// ── Single Batched Read-Only SQL Builder ───────────────────────────────────────────────────────

export function buildScoreboardBatchSql({ telemetryDays = DEFAULT_TELEMETRY_DAYS } = {}) {
  const days = validateTelemetryDays(telemetryDays);
  const offsetDays = days - 1;
  return assertReadOnlySql(`
WITH
  switch_rows AS (
    SELECT option, state, updated_by, updated_at, note
    FROM public.ca_horse_style_switch
    ORDER BY option ASC
  ),
  serving_rows AS (
    SELECT
      release_sha,
      registry,
      registry_digest,
      first_seen_at,
      seen_at,
      EXTRACT(EPOCH FROM (now() - seen_at))::double precision AS age_sec
    FROM public.ca_horse_option_registry_serving
    ORDER BY seen_at DESC
    LIMIT 3
  ),
  runtime_settings AS (
    SELECT
      a.version,
      a.activated_at,
      a.actor,
      v.settings,
      v.note
    FROM public.ca_engine_runtime_settings_active a
    LEFT JOIN public.ca_engine_runtime_settings_versions v ON v.version = a.version
    LIMIT 1
  ),
  evidence_rows AS (
    SELECT
      id,
      option,
      evidence_path,
      evidence_sha256,
      kind,
      reference,
      reviewed_head,
      recorded_by,
      recorded_at
    FROM public.ca_horse_option_switch_evidence
    ORDER BY recorded_at DESC, id DESC
  ),
  telemetry_rows AS (
    SELECT
      feature,
      sum(fires)::bigint AS total_fires,
      count(DISTINCT day)::int AS days_seen,
      max(day)::text AS latest_day
    FROM public.horse_brain_telemetry
    WHERE day >= ((now() AT TIME ZONE 'UTC')::date - ${offsetDays})
      AND fires > 0
      AND (
        feature LIKE 'holdem_%'
        OR feature LIKE 'horse_%'
        OR feature LIKE 'river_%'
        OR feature LIKE 'flop_turn_%'
        OR feature LIKE 'probe_%'
        OR feature LIKE 'committed_%'
        OR feature LIKE 'nash_%'
        OR feature LIKE 'limp_%'
        OR feature LIKE 'hu_%'
        OR feature LIKE 'v9_%'
        OR feature LIKE 'v21_%'
        OR feature LIKE 'v5%'
        OR feature LIKE 'v6%'
        OR feature LIKE 'v7%'
        OR feature LIKE 'v8%'
        OR feature LIKE 'option_shadow_%'
        OR feature LIKE 'option_switch_config_%'
      )
      AND feature NOT LIKE 'fmt_%'
    GROUP BY feature
  )
SELECT jsonb_build_object(
  'switchRows', COALESCE((SELECT jsonb_agg(to_jsonb(switch_rows)) FROM switch_rows), '[]'::jsonb),
  'servingRows', COALESCE((SELECT jsonb_agg(to_jsonb(serving_rows)) FROM serving_rows), '[]'::jsonb),
  'runtimeSettings', (SELECT to_jsonb(runtime_settings) FROM runtime_settings LIMIT 1),
  'evidenceRows', COALESCE((SELECT jsonb_agg(to_jsonb(evidence_rows)) FROM evidence_rows), '[]'::jsonb),
  'telemetryRows', COALESCE((SELECT jsonb_agg(to_jsonb(telemetry_rows)) FROM telemetry_rows), '[]'::jsonb)
) AS snapshot
`);
}

// ── Source & Doc Parsers (Read-Only) ───────────────────────────────────────────────────────────

function stripJsComments(text) {
  return String(text ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

/**
 * Extracts a balanced bracket/brace block starting at the first `openChar` after `anchorRegex`.
 */
function extractBalancedBlock(source, anchorRegex, openChar, closeChar) {
  const m = anchorRegex.exec(source);
  if (!m) return null;
  const start = source.indexOf(openChar, m.index + m[0].length - 1);
  if (start < 0) return null;

  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingle) {
      if (ch === '\\') {
        i++;
      } else if (ch === "'") {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      if (ch === '\\') {
        i++;
      } else if (ch === '"') {
        inDouble = false;
      }
      continue;
    }
    if (inTemplate) {
      if (ch === '\\') {
        i++;
      } else if (ch === '`') {
        inTemplate = false;
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      continue;
    }

    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        return source.slice(start + 1, i);
      }
    }
  }
  return null;
}

function parseStringArrayBlock(source, constName) {
  const body = extractBalancedBlock(
    source,
    new RegExp(`export\\s+const\\s+${constName}[^=]*=\\s*Object\\.freeze\\s*\\(\\s*\\[`),
    '[',
    ']'
  );
  if (!body) return [];
  const cleaned = stripJsComments(body);
  const out = [];
  for (const m of cleaned.matchAll(/['"]([A-Za-z][A-Za-z0-9_]*)['"]/g)) {
    out.push(m[1]);
  }
  return out;
}

function parseObjectKeysWithValues(source, constName) {
  const body = extractBalancedBlock(
    source,
    new RegExp(`export\\s+const\\s+${constName}[^=]*=\\s*Object\\.freeze\\s*\\(\\s*\\{`),
    '{',
    '}'
  );
  if (!body) return {};
  const cleaned = stripJsComments(body);
  const entries = {};

  // Split top-level comma-separated key: value pairs inside the object body.
  let i = 0;
  const len = cleaned.length;
  while (i < len) {
    while (i < len && /[\s,]/.test(cleaned[i])) i++;
    if (i >= len) break;
    // Skip spread expressions like `...Object.fromEntries(...)`
    if (cleaned.startsWith('...', i)) {
      let depth = 0;
      let inStr = null;
      while (i < len) {
        const c = cleaned[i];
        if (inStr) {
          if (c === '\\') i++;
          else if (c === inStr) inStr = null;
        } else if (c === "'" || c === '"' || c === '`') {
          inStr = c;
        } else if (c === '(' || c === '[' || c === '{') {
          depth++;
        } else if (c === ')' || c === ']' || c === '}') {
          depth--;
        } else if (c === ',' && depth === 0) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    const keyMatch = /^([A-Za-z][A-Za-z0-9_]*)\s*:/.exec(cleaned.slice(i));
    if (!keyMatch) {
      i++;
      continue;
    }
    const key = keyMatch[1];
    i += keyMatch[0].length;
    const valStart = i;
    let depth = 0;
    let inStr = null;
    while (i < len) {
      const c = cleaned[i];
      if (inStr) {
        if (c === '\\') i++;
        else if (c === inStr) inStr = null;
      } else if (c === "'" || c === '"' || c === '`') {
        inStr = c;
      } else if (c === '(' || c === '[' || c === '{') {
        depth++;
      } else if (c === ')' || c === ']' || c === '}') {
        depth--;
      } else if (c === ',' && depth === 0) {
        break;
      }
      i++;
    }
    entries[key] = cleaned.slice(valStart, i).trim();
  }
  return entries;
}

function unquoteFirstString(expr) {
  const m = /['"`]([^'"`]+)['"`]/.exec(expr);
  return m ? m[1] : expr.replace(/\s+/g, ' ').trim();
}

export function parseHorseOptionSwitchSource(sourceText) {
  const src = String(sourceText ?? '');
  const releaseDefaultOn = new Set(parseStringArrayBlock(src, 'OPTION_SWITCH_RELEASE_DEFAULT_ON'));
  const releaseDefaultOff = new Set(
    parseStringArrayBlock(src, 'OPTION_SWITCH_RELEASE_DEFAULT_OFF')
  );
  const releaseDefaultCode = new Set(
    parseStringArrayBlock(src, 'OPTION_SWITCH_RELEASE_DEFAULT_CODE')
  );

  const rawOffOnly = parseObjectKeysWithValues(src, 'OPTION_SWITCH_OFF_ONLY');
  const offOnly = {};
  for (const [name, expr] of Object.entries(rawOffOnly)) {
    let status = 'hold';
    if (
      /^harm\s*\(/.test(expr) ||
      /^ploFailed\s*\(/.test(expr) ||
      /status:\s*['"]harm['"]/.test(expr)
    ) {
      status = 'harm';
    } else if (/status:\s*['"]superseded['"]/.test(expr)) {
      status = 'superseded';
    }
    const isPreflopHold = /PREFLOP_HOLD_SOURCE/.test(expr);
    offOnly[name] = {
      status,
      isPreflopHold,
      summary: isPreflopHold ? 'owner preflop range hold' : unquoteFirstString(expr),
    };
  }

  const preflopHoldLifted = new Set(
    Object.keys(parseObjectKeysWithValues(src, 'OPTION_SWITCH_PREFLOP_HOLD_LIFTED'))
  );

  const rawShadowRefused = parseObjectKeysWithValues(src, 'OPTION_SWITCH_SHADOW_REFUSED');
  const shadowRefused = {};
  for (const [name, expr] of Object.entries(rawShadowRefused)) {
    shadowRefused[name] = unquoteFirstString(expr);
  }

  const rawRefused = parseObjectKeysWithValues(src, 'OPTION_SWITCH_REFUSED');
  const refused = {};
  for (const [name, expr] of Object.entries(rawRefused)) {
    refused[name] = unquoteFirstString(expr);
  }

  const heldPatternOffOnlyNames = new Set(
    parseStringArrayBlock(src, 'OPTION_SWITCH_HELD_PATTERN_OFF_ONLY_NAMES')
  );

  return {
    releaseDefaultOn,
    releaseDefaultOff,
    releaseDefaultCode,
    offOnly,
    preflopHoldLifted,
    shadowRefused,
    refused,
    heldPatternOffOnlyNames,
  };
}

const HELD_NAME_PATTERNS = Object.freeze([
  Object.freeze([/pillar/i, 'owner hold: Pillar 2']),
  Object.freeze([/^phase\d/i, 'phase pack: worker-owned phase authority']),
  Object.freeze([/held[-_]?out|holdout/i, 'owner hold: held-out packs']),
  Object.freeze([
    /v31|(^|[^a-z0-9])r[78]($|[^a-z0-9])|round[78]/i,
    'owner hold: R7/R8 solver rounds',
  ]),
  Object.freeze([/leak[-_]?map/i, 'owner hold: leak maps']),
]);

const OFF_ONLY_NAME_PATTERNS = Object.freeze([
  Object.freeze([/steal/i, 'owner hold: blind steal']),
  Object.freeze([/all[-_]?in[-_]?or[-_]?fold|(^|[^a-z])aof/i, 'owner hold: All-In-Or-Fold']),
]);

export function parseHorseDataLedgerFlags(ledgerSource) {
  const src = String(ledgerSource ?? '');
  const flags = new Set();
  for (const m of src.matchAll(/\bflag\s*\(\s*['"]([A-Za-z][A-Za-z0-9_]*)['"]/g)) {
    flags.add(m[1]);
  }
  return flags;
}

export function classifySourceRegistration(
  optionName,
  parsedSwitch,
  { ledgerFlags = null, servingAcceptedStates = null, defaultOnDoc = null } = {}
) {
  let refusedReason = Object.hasOwn(parsedSwitch.refused, optionName)
    ? parsedSwitch.refused[optionName]
    : null;
  if (!refusedReason && !parsedSwitch.heldPatternOffOnlyNames.has(optionName)) {
    for (const [re, reason] of HELD_NAME_PATTERNS) {
      if (re.test(optionName)) {
        refusedReason = reason;
        break;
      }
    }
  }

  let offOnlyEntry = Object.hasOwn(parsedSwitch.offOnly, optionName)
    ? parsedSwitch.offOnly[optionName]
    : null;
  if (!offOnlyEntry && !refusedReason) {
    for (const [re, summary] of OFF_ONLY_NAME_PATTERNS) {
      if (re.test(optionName)) {
        offOnlyEntry = { status: 'hold', isPreflopHold: false, summary };
        break;
      }
    }
  }

  const inLedger = ledgerFlags instanceof Set && ledgerFlags.has(optionName);
  const inServing = Array.isArray(servingAcceptedStates) && servingAcceptedStates.length > 0;

  let releaseDefault = parsedSwitch.releaseDefaultOn.has(optionName)
    ? 'on'
    : parsedSwitch.releaseDefaultOff.has(optionName)
      ? 'off'
      : parsedSwitch.releaseDefaultCode.has(optionName)
        ? 'code'
        : 'unknown';

  if (releaseDefault === 'unknown') {
    if (defaultOnDoc?.exists) {
      releaseDefault = 'on';
    } else if (inLedger || inServing || offOnlyEntry) {
      // Mirrors HorseOptionSwitch.ts `releaseDefaultOf`: registered options outside ON/OFF are 'code'.
      releaseDefault = 'code';
    }
  }

  let registration = 'unregistered';
  if (refusedReason) {
    registration = 'OPTION_SWITCH_REFUSED';
  } else if (offOnlyEntry) {
    registration = 'off_only';
  } else if (releaseDefault !== 'unknown' || inLedger || inServing) {
    registration = 'registered';
  }

  return {
    registration,
    releaseDefault,
    refusedReason,
    offOnly: offOnlyEntry,
    shadowRefusedReason: Object.hasOwn(parsedSwitch.shadowRefused, optionName)
      ? parsedSwitch.shadowRefused[optionName]
      : null,
    preflopHoldLifted: parsedSwitch.preflopHoldLifted.has(optionName),
  };
}

/**
 * Dynamically detects live source couplings in server/src/engine/HorseLogic.ts so
 * the scoreboard automatically updates when decoupling PRs land on main.
 */
export function detectSourceCouplings(horseLogicSource) {
  if (typeof horseLogicSource !== 'string' || !horseLogicSource.trim()) {
    return {};
  }
  const detected = {};

  // Coupling: v69TurnCallGaps inside Pillar 2 shade87NlhTurnCommit
  const shade87Expr = extractStatementAfter(horseLogicSource, /const\s+shade87NlhTurnCommit\s*=/);
  if (shade87Expr !== null) {
    const stillCoupled = shade87Expr.includes('v69TurnCallGaps');
    detected.v69TurnCallGaps = stillCoupled
      ? {
          coupled: true,
          coupledWith: ['v87DeepDiveDiscipline'],
          reason: 'v69TurnCallGaps gates draw predicate inside Pillar 2 shade87NlhTurnCommit',
          verifiedInSource: true,
        }
      : {
          coupled: false,
          coupledWith: [],
          reason: 'decoupled from Pillar 2 shade87NlhTurnCommit in HorseLogic.ts',
          verifiedInSource: true,
        };
  }

  // Coupling: v73Vs3BetDefence early-return before v75SqueezeDefence in gtoVs3Bet73
  const gtoVs3BetBody = extractBalancedBlock(
    horseLogicSource,
    /const\s+gtoVs3Bet73\s*=\s*\(?\s*\(\s*\)\s*=>\s*\{/,
    '{',
    '}'
  );
  if (gtoVs3BetBody !== null) {
    const v73EarlyIdx = gtoVs3BetBody.search(
      /if\s*\(\s*opts\.v73Vs3BetDefence\s*===\s*false\s*\)\s*return\s+undefined\s*;/
    );
    const v75Idx = gtoVs3BetBody.indexOf('v75SqueezeDefence');
    const stillCoupled = v73EarlyIdx >= 0 && v75Idx >= 0 && v73EarlyIdx < v75Idx;
    detected.v73Vs3BetDefence = stillCoupled
      ? {
          coupled: true,
          coupledWith: ['v75SqueezeDefence'],
          reason:
            'opts.v73Vs3BetDefence === false returns early before v75SqueezeDefence in gtoVs3Bet73',
          verifiedInSource: true,
        }
      : {
          coupled: false,
          coupledWith: [],
          reason: 'decoupled from v75SqueezeDefence in HorseLogic.ts',
          verifiedInSource: true,
        };
  }

  return detected;
}

function extractStatementAfter(source, anchorRegex) {
  const m = anchorRegex.exec(source);
  if (!m) return null;
  const start = m.index;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let depth = 0;

  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingle) {
      if (ch === '\\') i++;
      else if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '\\') i++;
      else if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === '\\') i++;
      else if (ch === '`') inTemplate = false;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ';' && depth === 0) {
      return source.slice(start, i + 1);
    }
  }
  return null;
}

export function sha256Hex(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function parseDefaultOnDoc(content, relPath) {
  const text = String(content ?? '');
  const lines = text.split('\n');
  let metCount = 0;
  let notMetCount = 0;
  let naCount = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^Status:\s*MET\b/i.test(trimmed)) metCount++;
    else if (/^Status:\s*NOT MET\b/i.test(trimmed)) notMetCount++;
    else if (/^Status:\s*NOT APPLICABLE\b/i.test(trimmed)) naCount++;
  }
  return {
    exists: true,
    path: relPath,
    sha256: sha256Hex(text),
    metCount,
    notMetCount,
    naCount,
    allMet: metCount > 0 && notMetCount === 0,
  };
}

export function parseAuthorityDoc(content, relPath) {
  const text = String(content ?? '');
  const paragraphs = text
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const statusParagraph = paragraphs.find((p) => !p.startsWith('#')) ?? '';

  let evidenceStatus = 'UNKNOWN';
  if (/Evidence\s+NOT\s+MET/i.test(statusParagraph)) {
    evidenceStatus = 'NOT_MET';
  } else if (/Evidence\s+MET/i.test(statusParagraph)) {
    evidenceStatus = 'MET';
  } else if (/Evidence\s+NOT\s+MET/i.test(text)) {
    evidenceStatus = 'NOT_MET';
  } else if (/Evidence\s+MET/i.test(text)) {
    evidenceStatus = 'MET';
  }

  const replayRows = [];
  for (const line of text.split('\n')) {
    const m = /^-\s*Replay:\s*(.+)$/.exec(line.trim());
    if (m) replayRows.push(m[1].trim());
  }

  return {
    exists: true,
    path: relPath,
    sha256: sha256Hex(text),
    evidenceStatus,
    replayRowCount: replayRows.length,
    replaySummary: replayRows[0] ?? null,
  };
}

// ── Runtime Settings & Telemetry Helpers ───────────────────────────────────────────────────────

export function extractHoldemOffList(settingsObj) {
  if (!settingsObj || typeof settingsObj !== 'object' || Array.isArray(settingsObj)) {
    return { holdemBlanketRulesOffList: [], plo45BlanketRowsOffCount: 0 };
  }
  const offSet = new Set();
  let plo45BlanketRowsOffCount = 0;

  // Support explicit array/string key formats if ever published that way.
  for (const directKey of ['holdemBlanketRulesOffList', 'horse.holdemBlanketRulesOffList']) {
    const val = settingsObj[directKey];
    if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'string' && item.trim()) offSet.add(item.trim());
      }
    } else if (typeof val === 'string' && val.trim()) {
      for (const item of val.split(',')) {
        if (item.trim()) offSet.add(item.trim());
      }
    }
  }

  for (const [key, val] of Object.entries(settingsObj)) {
    if (key.startsWith('horse.blanketRowOffInPlo45Cash.') && Number(val) === 1) {
      plo45BlanketRowsOffCount++;
    }
    for (const prefix of HOLDEM_OFFLIST_SETTING_PREFIXES) {
      if (key.startsWith(prefix) && (Number(val) === 1 || val === true)) {
        const optionName = key.slice(prefix.length).trim();
        if (optionName) offSet.add(optionName);
      }
    }
  }

  return {
    holdemBlanketRulesOffList: [...offSet].sort(),
    plo45BlanketRowsOffCount,
  };
}

export function matchTelemetryForOption(optionName, receipts, telemetryRows, telemetryDays) {
  const rows = Array.isArray(telemetryRows) ? telemetryRows : [];
  const patterns = Array.isArray(receipts) ? receipts : [];
  const exactSet = new Set();
  const prefixes = [];
  for (const p of patterns) {
    if (p.endsWith('*')) prefixes.push(p.slice(0, -1));
    else exactSet.add(p);
  }

  const shadowPrefix = `option_shadow_${optionName}_`;
  let totalFires = 0;
  let shadowFires = 0;
  let maxDaysSeen = 0;
  const matchedFeatures = [];

  for (const row of rows) {
    const feature = String(row?.feature ?? '');
    const fires = Number(row?.total_fires ?? row?.fires ?? 0);
    const daysSeen = Number(row?.days_seen ?? 0);
    if (!feature || !Number.isFinite(fires) || fires <= 0) continue;

    if (feature.startsWith(shadowPrefix)) {
      shadowFires += fires;
      continue;
    }

    const hit = exactSet.has(feature) || prefixes.some((pre) => feature.startsWith(pre));
    if (hit) {
      totalFires += fires;
      if (daysSeen > maxDaysSeen) maxDaysSeen = daysSeen;
      matchedFeatures.push({ feature, totalFires: fires, daysSeen });
    }
  }

  matchedFeatures.sort((a, b) => b.totalFires - a.totalFires || a.feature.localeCompare(b.feature));
  const avgFiresPerDay = Math.round((totalFires / Math.max(1, telemetryDays)) * 10) / 10;

  return {
    totalFires,
    avgFiresPerDay,
    daysSeen: maxDaysSeen,
    shadowFires,
    matchedFeatures,
  };
}

// ── Auto-Discovery of New Hold'em Priced Options ───────────────────────────────────────────────

const AUTO_DISCOVER_HOLDEM_PRICED_RE =
  /^(holdem|nlh|horseRiver|v\d+.*|riverBluff.*|flopTurn.*).*Priced$/i;

export function buildEffectiveCatalog(parsedSwitch, authorityDocsByName = {}) {
  const catalogByOption = new Map();
  for (const entry of HOLDEM_BLANKET_CATALOG) {
    catalogByOption.set(entry.option, {
      ...entry,
      pricedChildren: [...entry.pricedChildren],
      replacesBlankets: [...entry.replacesBlankets],
      receipts: [...entry.receipts],
      autoDiscovered: false,
    });
  }

  // Discover any newly added Hold'em priced options from HorseOptionSwitch.ts or authority docs.
  const candidateNames = new Set([
    ...parsedSwitch.releaseDefaultOff,
    ...parsedSwitch.releaseDefaultOn,
    ...Object.keys(authorityDocsByName),
  ]);

  for (const name of candidateNames) {
    if (catalogByOption.has(name)) continue;
    if (/omaha|plo|fixedLimit|shortDeck|bombPot|hiLo/i.test(name)) continue;
    if (!AUTO_DISCOVER_HOLDEM_PRICED_RE.test(name)) continue;

    const parentCandidate = name.replace(/IsPriced$/, '');
    const replacesBlankets = [];
    if (parentCandidate !== name && catalogByOption.has(parentCandidate)) {
      replacesBlankets.push(parentCandidate);
      const parentEntry = catalogByOption.get(parentCandidate);
      if (!parentEntry.pricedChildren.includes(name)) {
        parentEntry.pricedChildren.push(name);
      }
    }

    const snake = name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
    catalogByOption.set(name, {
      option: name,
      role: 'priced_replacement',
      family: 'auto_discovered_priced',
      scope: 'Auto-discovered Holdem priced option from source/authority docs',
      pricedChildren: [],
      replacesBlankets,
      nestedChild: false,
      preflopOrOwnerHold: false,
      hasDevGradeCards: false,
      receipts: [`${snake}*`],
      autoDiscovered: true,
    });
  }

  return [...catalogByOption.values()];
}

// ── Deterministic Next-Action Classification ───────────────────────────────────────────────────

export function classifyNextAction({
  entry,
  sourceInfo,
  switchState,
  inOffList,
  coupling,
  pricedChildrenStatus,
  servingAcceptedStates,
  telemetry,
}) {
  const effectiveState =
    switchState && switchState !== 'unset'
      ? switchState
      : sourceInfo.releaseDefault === 'on'
        ? 'on'
        : sourceInfo.releaseDefault === 'off'
          ? 'off'
          : 'code';

  const isRetiredBlanket =
    entry.role === 'blanket_parent' && (switchState === 'off' || inOffList === true);

  // 1. Coupled blanket rules must be split before single-rule grading (unless already retired).
  if (coupling?.coupled === true && !isRetiredBlanket) {
    return {
      nextAction: 'COUPLED_NEEDS_SPLIT',
      nextActionReason: coupling.reason || 'coupled in HorseLogic.ts; split before grading',
    };
  }

  // 2. Hard-refused, off-only (owner/preflop hold or measured harm), or preflop-held rules.
  if (sourceInfo.registration === 'OPTION_SWITCH_REFUSED') {
    return {
      nextAction: 'HELD_PREFLOP_OR_OWNER',
      nextActionReason: sourceInfo.refusedReason || 'OPTION_SWITCH_REFUSED',
    };
  }
  if (sourceInfo.registration === 'off_only') {
    return {
      nextAction: 'HELD_PREFLOP_OR_OWNER',
      nextActionReason: `off-only (${sourceInfo.offOnly?.status ?? 'hold'}): ${sourceInfo.offOnly?.summary ?? 'held'}`,
    };
  }
  if (entry.preflopOrOwnerHold && !sourceInfo.preflopHoldLifted) {
    return {
      nextAction: 'HELD_PREFLOP_OR_OWNER',
      nextActionReason: entry.holdNote || 'preflop range or owner-held rule',
    };
  }

  // 3. Priced replacements (default-OFF options replacing blankets).
  if (entry.role === 'priced_replacement') {
    if (switchState === 'on' || (switchState === 'unset' && sourceInfo.releaseDefault === 'on')) {
      return {
        nextAction: 'LIVE_PRICED_COMPLETE',
        nextActionReason: 'priced replacement is LIVE ON in production',
      };
    }
    return {
      nextAction: 'AWAITING_PRICED_CHILD_GRADE',
      nextActionReason:
        switchState === 'shadow' || switchState === 'on_shadow'
          ? `priced replacement currently in ${switchState}; awaiting grade & evidence`
          : 'priced replacement dark in production; awaiting passing grade + replay + evidence',
    };
  }

  // 4. Blanket parents already retired via explicit OFF switch or runtime off-list.
  if (isRetiredBlanket) {
    return {
      nextAction: 'LIVE_PRICED_COMPLETE',
      nextActionReason: inOffList
        ? 'blanket retired via active holdemBlanketRulesOffList'
        : 'blanket switched OFF in ca_horse_style_switch',
    };
  }

  // 5. Blanket parents with designated priced children.
  const children = Array.isArray(pricedChildrenStatus) ? pricedChildrenStatus : [];
  if (children.length > 0) {
    const liveChildren = children.filter((c) => c.isLiveOn);
    if (liveChildren.length > 0) {
      if (entry.nestedChild) {
        return {
          nextAction: 'LIVE_PRICED_COMPLETE',
          nextActionReason: `nested priced child ${liveChildren.map((c) => c.option).join(', ')} is LIVE ON inside parent gate (keep parent ON)`,
        };
      }
      return {
        nextAction: 'PRICED_CHILD_LIVE_READY_TO_RETIRE_BLANKET',
        nextActionReason: `priced child ${liveChildren.map((c) => c.option).join(', ')} is LIVE ON; ready to retire blanket parent`,
      };
    }
    return {
      nextAction: 'AWAITING_PRICED_CHILD_GRADE',
      nextActionReason: `awaiting priced child grade/activation: ${children.map((c) => c.option).join(', ')}`,
    };
  }

  // 6. Clean, decoupled blanket parents with no pending priced child (direct V38 fallback).
  if (switchState === 'shadow' || switchState === 'on_shadow') {
    return {
      nextAction: 'READY_FOR_OFF_AFTER_GRADE',
      nextActionReason: `currently in ${switchState}; complete shadow window + league grade then switch OFF`,
    };
  }
  if ((telemetry?.shadowFires ?? 0) > 0) {
    return {
      nextAction: 'READY_FOR_OFF_AFTER_GRADE',
      nextActionReason: `shadow telemetry observed (${telemetry.shadowFires} fires in window); ready for league grade & OFF`,
    };
  }
  if (entry.hasDevGradeCards) {
    return {
      nextAction: 'READY_FOR_OFF_AFTER_GRADE',
      nextActionReason: 'dev blanket-off league cards committed; run grade harness then switch OFF',
    };
  }

  const shadowSupportedByServing =
    !Array.isArray(servingAcceptedStates) || servingAcceptedStates.includes('shadow');
  if (sourceInfo.shadowRefusedReason || !shadowSupportedByServing) {
    return {
      nextAction: 'READY_FOR_OFF_AFTER_GRADE',
      nextActionReason: sourceInfo.shadowRefusedReason
        ? `shadow refused (${sourceInfo.shadowRefusedReason}); grade offline then switch OFF`
        : 'shadow not in serving accepted states; grade offline then switch OFF',
    };
  }

  if (effectiveState === 'on') {
    return {
      nextAction: 'READY_FOR_SHADOW',
      nextActionReason:
        'clean decoupled blanket rule; eligible for shadow window when global shadow slot is FREE',
    };
  }

  if (effectiveState === 'off') {
    return {
      nextAction: 'LIVE_PRICED_COMPLETE',
      nextActionReason: 'inactive by release default (off)',
    };
  }

  return {
    nextAction: 'HELD_PREFLOP_OR_OWNER',
    nextActionReason: `unregistered or unclassified release default (${effectiveState}); fail-closed hold`,
  };
}

// ── Full Scoreboard Builder ────────────────────────────────────────────────────────────────────

export function buildHoldemBlanketScoreboard({
  horseOptionSwitchSource,
  horseDataLedgerSource = '',
  horseLogicSource = '',
  defaultOnDocs = {},
  authorityDocs = {},
  dbSnapshot = null,
  telemetryDays = DEFAULT_TELEMETRY_DAYS,
  now = new Date(),
} = {}) {
  const generatedAt = (now instanceof Date ? now : new Date(now)).toISOString();
  const parsedSwitch = parseHorseOptionSwitchSource(horseOptionSwitchSource);
  const ledgerFlags = parseHorseDataLedgerFlags(horseDataLedgerSource);
  const dynamicCouplings = detectSourceCouplings(horseLogicSource);
  const catalog = buildEffectiveCatalog(parsedSwitch, authorityDocs);

  const dbOnline = dbSnapshot !== null && dbSnapshot !== undefined;
  const switchRows = Array.isArray(dbSnapshot?.switchRows) ? dbSnapshot.switchRows : [];
  const servingRows = Array.isArray(dbSnapshot?.servingRows) ? dbSnapshot.servingRows : [];
  const runtimeSettingsRow = dbSnapshot?.runtimeSettings ?? null;
  const evidenceRows = Array.isArray(dbSnapshot?.evidenceRows) ? dbSnapshot.evidenceRows : [];
  const telemetryRows = Array.isArray(dbSnapshot?.telemetryRows) ? dbSnapshot.telemetryRows : [];

  const switchByOption = new Map();
  for (const row of switchRows) {
    if (row?.option) switchByOption.set(String(row.option), row);
  }

  const latestServing = servingRows[0] ?? null;
  const servingRegistryMap =
    latestServing?.registry && typeof latestServing.registry === 'object'
      ? latestServing.registry
      : null;

  const { holdemBlanketRulesOffList, plo45BlanketRowsOffCount } = extractHoldemOffList(
    runtimeSettingsRow?.settings
  );
  const offListSet = new Set(holdemBlanketRulesOffList);

  const evidenceByOption = new Map();
  for (const row of evidenceRows) {
    const opt = String(row?.option ?? '');
    if (!opt) continue;
    if (!evidenceByOption.has(opt)) evidenceByOption.set(opt, []);
    evidenceByOption.get(opt).push({
      id: Number(row.id),
      evidencePath: row.evidence_path ?? null,
      evidenceSha256: row.evidence_sha256 ?? null,
      kind: row.kind ?? null,
      reference: row.reference ?? null,
      reviewedHead: row.reviewed_head ?? null,
      recordedBy: row.recorded_by ?? null,
      recordedAt: row.recorded_at ?? null,
    });
  }

  // Global shadow slot status across ALL options (Hold'em + Omaha + others).
  const activeShadowOptions = switchRows
    .filter((r) => SHADOW_STATES.includes(String(r?.state ?? '')))
    .map((r) => ({
      option: String(r.option),
      state: String(r.state),
      updatedAt: r.updated_at ?? null,
      updatedBy: r.updated_by ?? null,
    }));

  const globalShadowSlot = {
    occupied: activeShadowOptions.length > 0,
    status: !dbOnline ? 'UNKNOWN_OFFLINE' : activeShadowOptions.length > 0 ? 'OCCUPIED' : 'FREE',
    activeOptions: activeShadowOptions,
  };

  // Pre-compute live ON status of every option so blanket parents can inspect their priced children.
  const isOptionLiveOn = (optionName) => {
    const swRow = switchByOption.get(optionName);
    if (swRow?.state) return swRow.state === 'on';
    const servingStates =
      servingRegistryMap && Object.hasOwn(servingRegistryMap, optionName)
        ? servingRegistryMap[optionName]
        : null;
    const src = classifySourceRegistration(optionName, parsedSwitch, {
      ledgerFlags,
      servingAcceptedStates: servingStates,
      defaultOnDoc: defaultOnDocs[optionName] ?? null,
    });
    return src.releaseDefault === 'on';
  };

  const rules = catalog.map((entry) => {
    const swRow = switchByOption.get(entry.option) ?? null;
    const switchState = swRow?.state ? String(swRow.state) : 'unset';
    const inOffList = offListSet.has(entry.option);

    const defaultOnDoc = defaultOnDocs[entry.option] ?? null;
    const authorityDoc = authorityDocs[entry.option] ?? null;
    const evList = evidenceByOption.get(entry.option) ?? [];
    const latestEvidence = evList[0] ?? null;

    const servingAcceptedStates =
      servingRegistryMap && Object.hasOwn(servingRegistryMap, entry.option)
        ? servingRegistryMap[entry.option]
        : null;

    const sourceInfo = classifySourceRegistration(entry.option, parsedSwitch, {
      ledgerFlags,
      servingAcceptedStates,
      defaultOnDoc,
    });

    let coupling = { coupled: false, coupledWith: [], reason: null, verifiedInSource: false };
    if (Object.hasOwn(dynamicCouplings, entry.option)) {
      coupling = dynamicCouplings[entry.option];
    } else if (entry.staticCoupling) {
      coupling = {
        coupled: true,
        coupledWith: [...entry.staticCoupling.coupledWith],
        reason: entry.staticCoupling.reason,
        verifiedInSource: false,
      };
    }

    const pricedChildrenStatus = entry.pricedChildren.map((childName) => {
      const childSw = switchByOption.get(childName);
      const childServingStates =
        servingRegistryMap && Object.hasOwn(servingRegistryMap, childName)
          ? servingRegistryMap[childName]
          : null;
      const childSource = classifySourceRegistration(childName, parsedSwitch, {
        ledgerFlags,
        servingAcceptedStates: childServingStates,
        defaultOnDoc: defaultOnDocs[childName] ?? null,
      });
      const childState = childSw?.state ? String(childSw.state) : 'unset';
      return {
        option: childName,
        switchState: childState,
        releaseDefault: childSource.releaseDefault,
        registration: childSource.registration,
        isLiveOn: isOptionLiveOn(childName),
      };
    });

    const telemetry = matchTelemetryForOption(
      entry.option,
      entry.receipts,
      telemetryRows,
      telemetryDays
    );

    const { nextAction, nextActionReason } = classifyNextAction({
      entry,
      sourceInfo,
      switchState,
      inOffList,
      coupling,
      pricedChildrenStatus,
      servingAcceptedStates,
      telemetry,
    });

    const effectiveState =
      inOffList && entry.role === 'blanket_parent'
        ? 'off (off-list)'
        : switchState !== 'unset'
          ? switchState
          : sourceInfo.releaseDefault;

    return {
      option: entry.option,
      role: entry.role,
      family: entry.family,
      scope: entry.scope,
      autoDiscovered: entry.autoDiscovered,
      nestedChild: entry.nestedChild,
      hasDevGradeCards: entry.hasDevGradeCards,
      registration: sourceInfo.registration,
      releaseDefault: sourceInfo.releaseDefault,
      refusedReason: sourceInfo.refusedReason,
      offOnly: sourceInfo.offOnly,
      preflopHoldLifted: sourceInfo.preflopHoldLifted,
      switchState,
      switchUpdatedAt: swRow?.updated_at ?? null,
      switchUpdatedBy: swRow?.updated_by ?? null,
      inOffList,
      effectiveState,
      servingAcceptedStates,
      pricedChildren: pricedChildrenStatus,
      replacesBlankets: entry.replacesBlankets,
      coupling,
      docs: {
        defaultOn: defaultOnDoc,
        authority: authorityDoc,
      },
      evidence: {
        count: evList.length,
        latestId: latestEvidence?.id ?? null,
        latestSha256: latestEvidence?.evidenceSha256 ?? null,
        latestKind: latestEvidence?.kind ?? null,
        latestRecordedAt: latestEvidence?.recordedAt ?? null,
        matchesAuthorityDocSha:
          latestEvidence?.evidenceSha256 && authorityDoc?.sha256
            ? latestEvidence.evidenceSha256 === authorityDoc.sha256
            : null,
      },
      telemetry,
      nextAction,
      nextActionReason,
    };
  });

  // Compute summary counts.
  const byNextAction = Object.fromEntries(NEXT_ACTIONS.map((a) => [a, 0]));
  for (const r of rules) {
    byNextAction[r.nextAction] = (byNextAction[r.nextAction] ?? 0) + 1;
  }

  const blanketRules = rules.filter(
    (r) => r.role === 'blanket_parent' || r.role === 'refused_guard'
  );
  const pricedReplacements = rules.filter((r) => r.role === 'priced_replacement');

  const livePricedReplacementsOn = pricedReplacements.filter(
    (r) => r.nextAction === 'LIVE_PRICED_COMPLETE'
  ).length;
  const darkPricedReplacementsPendingGrade = pricedReplacements.filter(
    (r) => r.nextAction === 'AWAITING_PRICED_CHILD_GRADE'
  ).length;
  const offOnlyHeldPricedReplacements = pricedReplacements.filter(
    (r) => r.nextAction === 'HELD_PREFLOP_OR_OWNER'
  ).length;
  const retiredBlankets = blanketRules.filter(
    (r) => r.nextAction === 'LIVE_PRICED_COMPLETE'
  ).length;
  const remainingCoupledBlankets = rules.filter(
    (r) => r.nextAction === 'COUPLED_NEEDS_SPLIT'
  ).length;

  const servingAgeSec =
    latestServing?.age_sec !== undefined && latestServing?.age_sec !== null
      ? Math.round(Number(latestServing.age_sec) * 10) / 10
      : null;

  const servingRegistry = latestServing
    ? {
        releaseSha: String(latestServing.release_sha ?? ''),
        registryDigest: latestServing.registry_digest ?? null,
        seenAt: latestServing.seen_at ?? null,
        ageSec: servingAgeSec,
        optionCount: servingRegistryMap ? Object.keys(servingRegistryMap).length : 0,
        fresh: servingAgeSec !== null && servingAgeSec <= DEFAULT_MAX_REGISTRY_AGE_SEC,
      }
    : null;

  const runtimeSettings = runtimeSettingsRow
    ? {
        version: Number(runtimeSettingsRow.version),
        activatedAt: runtimeSettingsRow.activated_at ?? null,
        actor: runtimeSettingsRow.actor ?? null,
        note: runtimeSettingsRow.note ?? null,
        holdemBlanketRulesOffList,
        plo45BlanketRowsOffCount,
      }
    : {
        version: null,
        activatedAt: null,
        actor: null,
        note: null,
        holdemBlanketRulesOffList: [],
        plo45BlanketRowsOffCount: 0,
      };

  const warnings = [];
  if (!dbOnline) {
    warnings.push('Running in --offline mode: live Supabase tables were not queried.');
  } else {
    if (!servingRegistry) {
      warnings.push('No rows returned from public.ca_horse_option_registry_serving.');
    } else if (!servingRegistry.fresh) {
      warnings.push(
        `Latest serving registry ${servingRegistry.releaseSha.slice(0, 12)} is stale (${servingRegistry.ageSec}s > ${DEFAULT_MAX_REGISTRY_AGE_SEC}s).`
      );
    }
    if (globalShadowSlot.occupied) {
      warnings.push(
        `Global shadow slot is OCCUPIED by ${globalShadowSlot.activeOptions.map((o) => `${o.option}=${o.state}`).join(', ')}.`
      );
    }
  }

  return {
    generatedAt,
    dbOnline,
    telemetryDays,
    servingRegistry,
    runtimeSettings,
    globalShadowSlot,
    summary: {
      totalTrackedRules: rules.length,
      totalBlanketRules: blanketRules.length,
      totalPricedReplacements: pricedReplacements.length,
      livePricedReplacementsOn,
      darkPricedReplacementsPendingGrade,
      offOnlyHeldPricedReplacements,
      retiredBlankets,
      remainingCoupledBlankets,
      globalShadowSlotStatus: globalShadowSlot.status,
      byNextAction,
    },
    warnings,
    rules,
  };
}

// ── Filtering & Markdown Rendering ─────────────────────────────────────────────────────────────

export function filterScoreboardRules(report, { actions = [], onlyActionable = false } = {}) {
  let list = Array.isArray(report?.rules) ? report.rules : [];
  if (Array.isArray(actions) && actions.length > 0) {
    const allowed = new Set(actions);
    list = list.filter((r) => allowed.has(r.nextAction));
  }
  if (onlyActionable) {
    list = list.filter(
      (r) => r.nextAction !== 'HELD_PREFLOP_OR_OWNER' && r.nextAction !== 'LIVE_PRICED_COMPLETE'
    );
  }
  return list;
}

function escapeMd(val) {
  return String(val ?? '-')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

function formatFires(telemetry) {
  if (!telemetry || telemetry.totalFires === 0) return '0';
  return `${telemetry.avgFiresPerDay.toLocaleString('en-US')}/d (${telemetry.totalFires.toLocaleString('en-US')})`;
}

export function formatScoreboardMarkdown(report, filterOpts = {}) {
  const s = report.summary;
  const lines = [];
  lines.push(`# Hold'em Blanket Rule Removal & Priced Replacement Scoreboard`);
  lines.push('');
  lines.push(`- **Generated (UTC):** ${report.generatedAt}`);
  lines.push(`- **Telemetry Window:** last ${report.telemetryDays} UTC day(s)`);
  if (report.servingRegistry) {
    const sr = report.servingRegistry;
    lines.push(
      `- **Serving Registry:** \`${sr.releaseSha.slice(0, 12)}\` (${sr.optionCount} options, age ${sr.ageSec ?? '?'}s, ${sr.fresh ? 'FRESH' : 'STALE'})`
    );
  } else {
    lines.push(`- **Serving Registry:** ${report.dbOnline ? 'NONE' : 'OFFLINE'}`);
  }
  lines.push(
    `- **Runtime Settings:** v${report.runtimeSettings.version ?? 'n/a'} | \`holdemBlanketRulesOffList\`: ${
      report.runtimeSettings.holdemBlanketRulesOffList.length > 0
        ? report.runtimeSettings.holdemBlanketRulesOffList.join(', ')
        : 'none (0)'
    }`
  );
  lines.push(
    `- **Global Shadow Slot:** **${report.globalShadowSlot.status}**${
      report.globalShadowSlot.activeOptions.length > 0
        ? ` (${report.globalShadowSlot.activeOptions.map((o) => `\`${o.option}\`=${o.state}`).join(', ')})`
        : ''
    }`
  );

  if (report.warnings.length > 0) {
    lines.push('');
    for (const w of report.warnings) {
      lines.push(`> **Note:** ${w}`);
    }
  }

  lines.push('');
  lines.push('## Program Summary');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('| --- | ---: |');
  lines.push(`| Total Blanket Rules Tracked | ${s.totalBlanketRules} |`);
  lines.push(`| Live Priced Replacements ON | ${s.livePricedReplacementsOn} |`);
  lines.push(
    `| Dark Priced Replacements Pending Grade | ${s.darkPricedReplacementsPendingGrade} |`
  );
  lines.push(`| Off-Only / Harm-Locked Priced Replacements | ${s.offOnlyHeldPricedReplacements} |`);
  lines.push(`| Retired / Priced-Complete Blankets | ${s.retiredBlankets} |`);
  lines.push(
    `| Remaining Coupled Blankets (\`COUPLED_NEEDS_SPLIT\`) | ${s.remainingCoupledBlankets} |`
  );
  for (const action of NEXT_ACTIONS) {
    lines.push(`| Next Action: \`${action}\` | ${s.byNextAction[action] ?? 0} |`);
  }

  const visibleRules = filterScoreboardRules(report, filterOpts);
  const pricedRows = visibleRules.filter((r) => r.role === 'priced_replacement');
  const blanketRows = visibleRules.filter((r) => r.role !== 'priced_replacement');

  if (pricedRows.length > 0) {
    lines.push('');
    lines.push('## Priced Replacements');
    lines.push('');
    lines.push(
      '| Option | Registration | Default | Switch | Evidence | Authority Doc | 3d Fires | Next Action | Replaces |'
    );
    lines.push('| --- | --- | --- | --- | --- | --- | ---: | --- | --- |');
    for (const r of pricedRows) {
      const evCell = r.evidence.latestId
        ? `#${r.evidence.latestId} (${r.evidence.latestSha256?.slice(0, 8) ?? '?'}${r.evidence.matchesAuthorityDocSha === false ? ' doc-moved' : ''})`
        : '-';
      const authCell = r.docs.authority ? r.docs.authority.evidenceStatus : 'missing';
      const replacesCell = r.replacesBlankets.length > 0 ? r.replacesBlankets.join(', ') : '-';
      lines.push(
        `| \`${escapeMd(r.option)}\` | ${escapeMd(r.registration)} | ${escapeMd(r.releaseDefault)} | ${escapeMd(r.switchState)} | ${escapeMd(evCell)} | ${escapeMd(authCell)} | ${escapeMd(formatFires(r.telemetry))} | \`${escapeMd(r.nextAction)}\` | ${escapeMd(replacesCell)} |`
      );
    }
  }

  if (blanketRows.length > 0) {
    lines.push('');
    lines.push("## Hold'em Blanket Rules");
    lines.push('');
    lines.push(
      '| Option | Registration | Default | Switch | Off-List | Priced Child(ren) | 3d Fires | Next Action | Reason |'
    );
    lines.push('| --- | --- | --- | --- | --- | --- | ---: | --- | --- |');
    for (const r of blanketRows) {
      const childrenCell =
        r.pricedChildren.length > 0
          ? r.pricedChildren
              .map((c) => `${c.option}(${c.isLiveOn ? 'ON' : c.switchState})`)
              .join(', ')
          : '-';
      lines.push(
        `| \`${escapeMd(r.option)}\` | ${escapeMd(r.registration)} | ${escapeMd(r.releaseDefault)} | ${escapeMd(r.switchState)} | ${r.inOffList ? 'YES' : 'no'} | ${escapeMd(childrenCell)} | ${escapeMd(formatFires(r.telemetry))} | \`${escapeMd(r.nextAction)}\` | ${escapeMd(r.nextActionReason)} |`
      );
    }
  }

  return lines.join('\n');
}
