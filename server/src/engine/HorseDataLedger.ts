/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HORSE DATA LEDGER (Phase 1 of the real-time build plan, Dan 2026-09-04)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dan: "Horses need to make real time decisions on 500 different data points
 * in real time, and need to be able to know how to access this data, what
 * data they are supposed to be consuming, how to consume it, how to process
 * it and why to process it in nano seconds."
 *
 * This file is the contract. Every input the brain can touch is a row here
 * with four properties: SOURCE (where it comes from), CADENCE (when it is
 * refreshed into memory), CONSUMER (the function that reads it) and RECEIPT
 * (the telemetry that proves the read happened). A datum with a source and no
 * consumer is dead data; a consumer with no receipt is a layer nobody can
 * prove is running. HorseDataLedger.test.ts checks source coverage; source presence alone
 * does not prove execution. Behavioral tests and accepted-action receipts
 * must separately prove use, and fn_audit_data_receipts turns the receipts
 * into daily findings by reading horse_brain_telemetry.
 *
 * "Compile, do not query": the engine reads memory (the game state it is
 * handed, HorseMind, the profile snapshot). Everything nightly is a compiler
 * that writes memory-shaped rows. No row here has cadence 'query' and none
 * ever will; a database read inside server/src/engine is a ledger violation.
 *
 * Pure data. No imports from the engine, so the sync service and the tests
 * can load it without the supabase client.
 */

export type LedgerKind =
  /** a HorseDecideOpts control read by decide() / decidePreflopV7; this also
   *  includes non-boolean offline evaluation selectors and evidence hooks */
  | 'flag'
  /** a StyleParams number the style + profile + persona resolve into */
  | 'param'
  /** a profiles.horse_profile key resolved by resolveHorseStyle */
  | 'profile'
  /** a HorseMind per-player counter */
  | 'mind'
  /** a HorseGameStateV2 field the engine hands the brain each decision */
  | 'state'
  /** a database table with a reader and a cadence (or a legacy one nobody reads) */
  | 'table'
  /** a telemetry key; `*` suffix = a family sharing a prefix */
  | 'receipt'
  /** a leak tag the review system emits, with the code that READS it
   *  (2026-09-05). A tag with consumer 'measurement' is recorded/reported but
   *  has no decision or candidate-adjustment reader. The daily audit keeps
   *  reporting high-volume measurement gaps; a helper definition is not use. */
  | 'tag';

export type LedgerCadence =
  | 'per_action'
  | 'per_hand'
  | 'per_sit'
  | 'minute'
  | 'boot'
  | 'nightly'
  | 'legacy_unused';

export interface LedgerEntry {
  key: string;
  kind: LedgerKind;
  source: string;
  cadence: LedgerCadence;
  consumer: string;
  note: string;
  /** receipt entries: the fires this key is expected to be a fraction of */
  ratioOf?: string;
  /** receipt entries: fires(key) / fires(ratioOf) must be at least this on a
   *  normal fleet day (ratioOf fires >= 1000), else the audit raises
   *  data_unread (critical at zero fires, warn below the floor). A floored
   *  key on its first partial day, or one deployed after the audited day,
   *  is reported as info instead. Omitted = the receipt audit raises
   *  NOTHING for this key, a zero included (fn_audit_data_receipts judges
   *  only rows with a min_ratio); the read depends on table mix or is not
   *  yet measured (its note, or the comment above the entry, says which).
   *  Such a key is still judged against its own history by the drift
   *  audit. Write a floor only from a measured live day. */
  minRatio?: number;
  /** table entries with a nightly cadence: the day column and how many days
   *  old the newest row may be before the audit raises data_stale */
  dayColumn?: string;
  freshnessDays?: number;
  /** the layer or date this datum first shipped */
  since: string;
}

const flag = (
  key: string,
  note: string,
  since: string,
  consumer = 'HorseLogic.decide'
): LedgerEntry => ({
  key,
  kind: 'flag',
  source: 'HorseDecideOpts (live worker snapshot; league ablation b-sides)',
  cadence: 'per_action',
  consumer,
  note,
  since,
});

const evaluationControl = (key: string, note: string): LedgerEntry => ({
  key,
  kind: 'flag',
  source:
    'Offline GtoV31CandidateEvaluation and HorseLeague only; excluded from live worker requests',
  cadence: 'per_action',
  consumer: 'HorseLogic.decide certified V31 candidate path',
  note,
  since: 'Phase4',
});

const receipt = (
  key: string,
  consumer: string,
  note: string,
  since: string,
  ratioOf?: string,
  minRatio?: number
): LedgerEntry => ({
  key,
  kind: 'receipt',
  source: 'horse_brain_telemetry (BrainTelemetry.noteFire, flushed per day)',
  cadence: 'per_action',
  consumer,
  note,
  since,
  ...(ratioOf ? { ratioOf } : {}),
  ...(minRatio != null ? { minRatio } : {}),
});

/**
 * A RETIRED RECEIPT (2026-10-16). A telemetry key the brain no longer fires
 * because its code was renamed or removed. Registered so the daily audit
 * (fn_audit_layer_drift) reads its silence as the retirement it is, instead
 * of a layer that "was executing and is not any more": on 2026-10-15 about 110
 * of those warns were renamed or retired reason codes. Cadence legacy_unused,
 * no ratio, so fn_audit_data_receipts never judges it either. `retiredBy`
 * names the change that retired it; `source` means the key is gone from
 * server/src now (HorseDataLedger.test.ts proves it), anything else names a
 * change that has not landed on main yet and is proven when it does.
 */
export type RetiredBy = 'source' | 'policy_bundle_2026_10_16';
const retiredReceipt = (
  key: string,
  retiredBy: RetiredBy,
  note: string,
  since: string
): LedgerEntry => ({
  key,
  kind: 'receipt',
  source: 'horse_brain_telemetry (retired: no longer fired)',
  cadence: 'legacy_unused',
  consumer: `retired:${retiredBy}`,
  note,
  since,
});

/** Phase 12 pack reasons renamed when the round-3 pack replaced them (round3_*). */
export const RETIRED_PHASE12_REASONS = [
  'variant_protected_check',
  'variant_price_call',
  'variant_price_fold',
  'variant_value_bet',
  'variant_value_raise',
  'variant_draw_pressure',
  'preflop_defense',
  'preflop_entry_declined',
  'preflop_entry',
  'preflop_complete',
  'preflop_reraise',
  'preflop_call_off',
  'preflop_reshove',
  'split_price_call',
  'split_price_fold',
  'low_only_protected_check',
] as const;
const PHASE12_TELEMETRY_PREFIXES = [
  'phase12_',
  'phase12_short_deck_',
  'phase12_pineapple_',
  'phase12_flh_',
  'phase12_flo8_',
] as const;
const PHASE13_TELEMETRY_PREFIXES = [
  'phase13_',
  'phase13_nlh_',
  'phase13_plo4_',
  'phase13_plo5_',
  'phase13_plo6_',
  'phase13_plo8_',
  'phase13_short_deck_',
  'phase13_pineapple_',
  'phase13_flh_',
  'phase13_flo8_',
] as const;

export const RETIRED_RECEIPTS: LedgerEntry[] = [
  ...['horse_mind_mirror_learned', 'horse_mind_mirror_nothing_to_learn'].map((key) =>
    retiredReceipt(
      key,
      'source',
      'the pooled cross-shard mirror learner stopped on 2026-10-26 when live decisions moved to independent observer memory (2026-10-25-horse-observer-independent-memory); workerRuntime never invokes learnMirroredHand for live hands, so horse_mind_mirror_shed/_unavailable remain the only live mirror receipts',
      'V50'
    )
  ),
  retiredReceipt(
    'horse_opponent_memory_snapshot_applied',
    'source',
    'the pooled durable-profile snapshot import was removed on 2026-10-26 with independent observer memory; accepted public profiles now enter through the bounded worker cache (2026-10-26-horses-share-accepted-public-opponent-notes) and report under horse_opponent_memory_read_*',
    'V50'
  ),
  ...['horse_winner_read_hand', 'horse_winner_read_refused'].map((key) =>
    retiredReceipt(
      key,
      'source',
      'the floor-wide winner telemetry was replaced by individual original-participant completion receipts under horse_observer_*; the winner policy remains active inside each private observer sandbox',
      'V53'
    )
  ),
  ...PHASE12_TELEMETRY_PREFIXES.flatMap((prefix) =>
    RETIRED_PHASE12_REASONS.map((reason) =>
      retiredReceipt(
        `${prefix}reason_${reason}`,
        'source',
        `the pre-round-3 Phase 12 reason ${reason}; the round-3 pack names its outcomes round3_* (RemainingVariantLivePolicy) and never emits this one`,
        'Phase12'
      )
    )
  ),
  ...['phase10_', 'phase11_', 'phase11_plo5_', 'phase11_plo6_', 'phase11_plo8_'].map((prefix) =>
    retiredReceipt(
      `${prefix}reason_heads_up_big_blind_three_bet`,
      'source',
      'the heads-up big-blind three-bet reason of the earlier PLO packs; the round-3 packs name heads-up play heads_up_button_open / heads_up_position_stab',
      'Phase10'
    )
  ),
  retiredReceipt(
    'v44_declined_governor',
    'source',
    'the V44 second look no longer declines on the equity governor: the worker always decides at scale 1 and the second look is budgeted from the turn clock (2026-10-16)',
    'V44'
  ),
  // Retired by the 2026-10-16 policy bundle (a separate branch, hashed policy
  // files): the packs lose their wall-clock work budget and Phase 13 its
  // joint work budget. Registered here so the day they go silent is not ~20
  // warns; the ledger test proves them absent once the bundle is on main.
  ...PHASE13_TELEMETRY_PREFIXES.map((prefix) =>
    retiredReceipt(
      `${prefix}reason_work_budget`,
      'policy_bundle_2026_10_16',
      'the Phase 13 joint policy wall-clock work budget (JOINT_SAMPLE_WORK_BUDGET_MS), retired by the 2026-10-16 policy bundle',
      'Phase13'
    )
  ),
  ...[
    'phase10_',
    'phase11_',
    'phase11_plo5_',
    'phase11_plo6_',
    'phase11_plo8_',
    ...PHASE12_TELEMETRY_PREFIXES,
  ].map((prefix) =>
    retiredReceipt(
      `${prefix}reason_work_budget`,
      'policy_bundle_2026_10_16',
      'the policy pack wall-clock work budget (liveBudgetMs), retired by the 2026-10-16 policy bundle: an unavailable pack decision is now a sampler failure or missing evidence',
      'Phase10'
    )
  ),
];

const mind = (key: string, note: string, consumer: string): LedgerEntry => ({
  key,
  kind: 'mind',
  source: 'HorseMind.OpponentStats (in-process; persisted to horse_mind_stats)',
  cadence: 'per_action',
  consumer,
  note,
  since: 'V3',
});

const state = (key: string, note: string, consumer = 'HorseLogic.decide'): LedgerEntry => ({
  key,
  kind: 'state',
  source: 'HorseGameStateV2 built by ServerTableEngineTurns.scheduleHorseAction',
  cadence: 'per_action',
  consumer,
  note,
  since: 'V2',
});

const table = (
  key: string,
  cadence: LedgerCadence,
  consumer: string,
  note: string,
  since: string,
  fresh?: { dayColumn: string; freshnessDays: number }
): LedgerEntry => ({
  key,
  kind: 'table',
  source: `public.${key}`,
  cadence,
  consumer,
  note,
  since,
  ...(fresh ?? {}),
});

/**
 * TAG CONSUMERS (2026-09-05). Dan: "there is absolutely no point to keep
 * upgrading and enhancing the logic of the horses if nothing reads the tags."
 * Every tag HorseHandReview.detectLeaks can emit is a row here with the code
 * that reads it, with measurement and diagnostic proposal boundaries explicit. EveryTagHasAConsumer.law.test.ts reads the detector source
 * and fails on a tag with no row; the daily audit (fn_audit_tag_consumers)
 * reads this table and raises tag_unread on a tag with rows this week whose
 * consumer is 'measurement'. A measurement row must say why it is one.
 *
 * `_won` twins are the win side of the same detector (see the note over
 * `flag` in HorseHandReview); they are registered once, as the loss tag,
 * and the law test knows the twin rule.
 */
const tag = (key: string, consumer: string, note: string, since: string): LedgerEntry => ({
  key,
  kind: 'tag',
  source:
    'horse_hand_reviews.leak_tags (HorseHandReview.detectLeaks at settlement); horse_review_rollup.leak_counts nightly',
  cadence: 'nightly',
  consumer,
  note:
    note +
    (consumer === 'measurement'
      ? '; measurement: nightly counts/study diagnostics only; no candidate-adjustment reader; no policy authority'
      : '; diagnostic proposal: runSelfTune reads rollups and calls diagnoseAndNudge; observational adapter retains the profile; no policy authority'),
  since,
});

/**
 * V49 (2026-09-05): a tag the SQL side emits, not the hand detector. The
 * frequency leaks are computed per horse per window from horse_daily_play by
 * fn_horse_frequency_leaks - no hand is read at all, because the leaks they
 * find (over-folding, never 3-betting, limping, passive postflop) never cost
 * 20bb in one pot and so cannot reach a hand tag. Registered here for the
 * same reason as every other tag: a name with no reader is the thing this
 * ledger exists to make impossible.
 */
const sqlTag = (key: string, consumer: string, note: string, since: string): LedgerEntry => ({
  key,
  kind: 'tag',
  source: 'fn_horse_frequency_leaks (SQL, per horse per 7-day window over horse_daily_play)',
  cadence: 'nightly',
  consumer,
  note,
  since,
});

export const TAG_CONSUMERS: LedgerEntry[] = [
  // Omaha stack-off diagnostics; proposals do not authorize policy adjustments.
  tag(
    'nonnut_flush_stackoff',
    'HorseSelfTuner.diagnoseAndNudge',
    'Omaha: cat-6 with two better flushes live; hold em: any better flush live',
    'V13'
  ),
  tag(
    'second_nut_flush_stackoff',
    'HorseSelfTuner.diagnoseAndNudge',
    'Omaha cat-6 with one better flush live',
    'V13'
  ),
  tag(
    'dominated_straight_stackoff',
    'HorseSelfTuner.diagnoseAndNudge',
    'Omaha non-nut straight at showdown',
    'V13'
  ),
  tag(
    'plo_underboat_stackoff',
    'HorseSelfTuner.diagnoseAndNudge',
    'Omaha bottom full house beaten by two or more distinct higher full-house combinations, 100bb+',
    'V86'
  ),
  tag(
    'plo_multiboard_dead_half_call',
    'HorseSelfTuner.diagnoseAndNudge',
    'Omaha double-board showdown with one pair or worse on a board after calling down passively, 40bb+',
    'V86'
  ),
  tag(
    'plo_passive_rundown_oop',
    'HorseSelfTuner.diagnoseAndNudge',
    'Omaha double-suited rundown or connected broadway cold-called preflop with zero postflop raises, 20bb+',
    'V86'
  ),
  tag('coldcall_stackoff', 'measurement', 'cold-called a raise, lost 40bb+', 'V23'),
  tag(
    'plo_naked_trips_stackoff',
    'measurement',
    'trips on a paired board, no redraw, 100bb+',
    'V38'
  ),
  tag('plo_toppair_no_redraw_stackoff', 'measurement', 'top pair no redraw, 100bb+', 'V38'),
  // Hold em stack-off diagnostics (NLH_STACKOFF_TAGS).
  tag(
    'top_pair_weak_kicker_stackoff',
    'measurement',
    'top pair, kicker nine or worse, 40bb+',
    'V24'
  ),
  tag('weak_kicker_trips_stackoff', 'measurement', 'board trips, dominated kicker, 40bb+', 'V24'),
  tag(
    'one_pair_river_stackoff',
    'measurement',
    'one pair of hero own (overpair or a good-kicker hit) committed on the river on an unpaired, not three-suited board, 40bb+',
    'V24'
  ),
  tag(
    'one_pair_turn_stackoff',
    'measurement',
    'single-board showdown one-pair shape with turn commitment, mirrored on wins; not turn decision EV or strategy authority',
    'V24'
  ),
  tag(
    'board_paired_two_pair_stackoff',
    'measurement',
    'two pair where one pair is the board own, so board cards counterfeit or outkick it, 40bb+',
    'V24'
  ),
  tag(
    'plo_paired_board_nut_stackoff',
    'measurement',
    'Omaha nut flush or nut straight lost at showdown on a paired board, where every raise is a full house',
    'V15'
  ),
  tag(
    'straight_into_flush_stackoff',
    'measurement',
    'straight on a three-flush board - since 2026-09-13 also flagged in Omaha, where it is recorded and reviewed but deliberately NOT in PLO_STACKOFF_TAGS',
    'V21'
  ),
  tag('nonnut_straight_stackoff', 'measurement', 'non-nut straight at showdown', 'V21'),
  tag('underfull_stackoff', 'measurement', 'bottom boat', 'V21'),
  // River escalation diagnostics (RIVER_WAR_TAGS).
  tag('river_raise_war', 'measurement', 'two or more aggressive river actions, lost', 'V21'),
  tag('river_raise_paidoff', 'measurement', 'bet the river, called a raise, lost', 'V23'),
  // Limped-pot diagnostics (LIMP_BLOAT_TAGS).
  tag('limped_pot_bloat', 'measurement', 'entered for one blind, lost 40bb+', 'V23'),
  // Preflop audit proposals, including the historical tournament premium.
  tag(
    'preflop_stackoff',
    'HorseSelfTuner.diagnoseAndNudge',
    '40bb+ in with no postflop action',
    'V13'
  ),
  // fold family -> tuner bluff dial
  tag('big_bet_fold', 'HorseSelfTuner.diagnoseAndNudge', 'invested 20bb+ then folded', 'V13'),
  // measurement-only, with the reason
  tag(
    'big_fold_river',
    'measurement',
    'a river fold after a big investment: whether the fold was right is unknowable without the folded-to hand, so it steers nothing (the V23 split exists to keep it out of big_bet_fold)',
    'V23'
  ),
  tag(
    'big_fold_early',
    'measurement',
    'the early-street twin of big_fold_river; same reason',
    'V23'
  ),
  tag(
    'bet_fold_line',
    'measurement',
    'bet then folded the same street; a sizing/line study, no consumer yet',
    'V23'
  ),
  tag(
    'river_aggr_lost',
    'measurement',
    'ordinary value bets that ran into the top of the range; outcome totals compared with river_aggr_won by fn_audit_river_aggression_ev; those totals do not establish counterfactual EV',
    'V13'
  ),
  tag(
    'river_aggr_won',
    'measurement',
    'the win side of river aggression (fn_audit_river_aggression_ev)',
    'V33'
  ),
  tag(
    'plo_underfull_stackoff',
    'measurement',
    'Omaha bottom boat, 100bb+; historical V40 study category; no validated causal adjustment reader',
    'V40'
  ),
  tag(
    'plo_set_stackoff',
    'measurement',
    'split from plo_naked_trips on an unpaired board; recorded for investigation; no validated causal adjustment reader',
    'V40'
  ),
  tag(
    'set_on_wet_board_stackoff',
    'measurement',
    'Omaha set or trips with no redraw committed 100bb+ on the turn or river on a board showing three to a flush or a straight (at the commit street or on the river); added from the 2026-11-06 biggest-losses review (3370600); no validated causal adjustment reader',
    'V40'
  ),
  tag(
    'nlh_deep_onepair_stackoff',
    'HorseSelfTuner.diagnoseAndNudge',
    'Hold em 120bb+ postflop stack-off holding bare one pair or worse (cat <= 2)',
    'V87'
  ),
  tag(
    'nlh_passive_oop_coldcall_bleed',
    'HorseSelfTuner.diagnoseAndNudge',
    'Hold em OOP cold-call of a preflop raise followed by an uncontested flop check-fold (net <= -2.5bb)',
    'V87'
  ),
  tag(
    'nlh_ep_limp_passivity',
    'HorseSelfTuner.diagnoseAndNudge',
    'Hold em open-limp with a weak non-trap hand (outside QQ+ and 54s-T9s) or EP open-limp folding to a <= 5bb iso-raise',
    'V87'
  ),
  tag(
    'nlh_bubble_covered_calloff',
    'HorseSelfTuner.diagnoseAndNudge',
    'Hold em tournament near-bubble or final-table pay-jump covered call-off with bare one-pair postflop or non-premium preflop',
    'V87'
  ),

  // ── V49 FREQUENCY LEAKS. Emitted by SQL over horse_daily_play, read by the
  // nightly audit (fn_audit_frequency_leaks) and by the panel card. The same
  // bands HorseSelfTuner.BENCH tunes the dials against, so the audit and the
  // tuner cannot disagree about what a leak is.
  sqlTag(
    'freq_too_loose',
    'fn_audit_frequency_leaks',
    'VPIP over 32% across 1,000+ cash hands',
    'V49'
  ),
  sqlTag('freq_too_tight', 'fn_audit_frequency_leaks', 'VPIP under 19%', 'V49'),
  sqlTag(
    'freq_limp',
    'fn_audit_frequency_leaks',
    'under 55% of voluntary entries were raises - the rest are limps and cold calls',
    'V49'
  ),
  sqlTag(
    'freq_over_fold_3bet',
    'fn_audit_frequency_leaks',
    'folds over 62% of the time to a 3-bet',
    'V49'
  ),
  sqlTag('freq_sticky_vs_3bet', 'fn_audit_frequency_leaks', 'folds under 35% to a 3-bet', 'V49'),
  sqlTag(
    'freq_surrender_flops',
    'fn_audit_frequency_leaks',
    'wins under 40% of the flops it sees',
    'V49'
  ),
  sqlTag(
    'freq_passive_postflop',
    'fn_audit_frequency_leaks',
    'postflop aggression factor under 1.2',
    'V49'
  ),
  sqlTag(
    'freq_spewy_postflop',
    'fn_audit_frequency_leaks',
    'postflop aggression factor over 3.5',
    'V49'
  ),
];

export const HORSE_DATA_LEDGER: LedgerEntry[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // HORSE DECISION CONTROLS. Boolean switches use off as the league b-side;
  // the two Phase 4 evaluation controls are offline-only and fail closed at
  // the live worker boundary.
  // ─────────────────────────────────────────────────────────────────────────
  flag(
    'decisionTimeMs',
    'turn-request epoch captured before worker FIFO wait; pins the hourly mood boundary',
    'V50',
    'HorseLogic.moodOf'
  ),
  flag(
    'turnDeadlineMs',
    'optional turn-clock deadline (epoch ms or remaining budget ms) clamping V86 Hollywood tanks inside deadlineRemainingMs - 1500',
    'V86',
    'HorseLogic.computeThinkTime'
  ),
  flag('telemetry', 'live decisions only; arms noteFire for this decision', 'V15'),
  flag(
    'observeMind',
    'fast authoritative decisions capture opponent-memory effects; speculative deep replays read without observing twice',
    'V50'
  ),
  {
    ...flag(
      'mindObservationHand',
      'worker-owned table/allocated-hand coordinate separates basic observation deduplication across tables; null refuses ingestion, omission preserves direct/offline legacy compatibility; not an accepted-hand UUID or learning authority',
      'Phase15',
      'HorseLogic.decide -> HorseMind.observe'
    ),
    source:
      'HorseDecisionWorkerRuntime.executeFast -> horseMindHandFromDecision(original request); caller options cannot supply it',
  },
  {
    ...flag(
      'mindPlanContext',
      'worker-owned hand namespace binds future-street plan reads/effects and FAST/DEEP replay; explicit unavailable hand prevents a live legacy-key fallback, omission preserves direct/offline compatibility; not controller acceptance authority',
      'Phase15',
      'HorseLogic.decidePostflop -> horsePlanHandKey -> HorseMind plan reads/effects'
    ),
    source:
      'HorseDecisionWorkerRuntime.executeFast/executeDeep -> horsePlanContextFromDecision(original request); caller options cannot supply it',
  },
  flag('mind', 'the whole opponent-intelligence layer (reads + writes)', 'V3'),
  flag('streetIQ', 'position/initiative/scare/texture reads', 'V4'),
  flag('handReading', 'street-by-street range narrowing from the full history', 'V5'),
  flag('v7', 'V7 master: barrels, size reads, counter-adaptation, adaptive MC, preflop', 'V7'),
  flag(
    'v7Preflop',
    'the V7 preflop engine (decidePreflopV7)',
    'V7',
    'HorsePreflop.decidePreflopV7'
  ),
  flag('v7Barrels', 'multi-street barrel plans', 'V7'),
  flag(
    'barrelContinuationOutlook',
    'default-off planned turn barrel records its private river outlook without re-rolling intent; requires incremental qualification',
    'Continuation outlook'
  ),
  flag('v7SizeReads', 'bet-size-aware range narrowing', 'V7'),
  flag('v7CounterAdapt', 'recency blending against adapting opponents', 'V7'),
  flag('v7AdaptiveMC', 'Monte Carlo early exit when far from every threshold', 'V7'),
  flag('v8', 'V8 master: variant overlays, Omaha draws, hi-lo, NLH extras', 'V8'),
  flag('v8Draws', 'Omaha draw quality gating semi-bluffs', 'V8'),
  flag('v8HiLo', 'plo8 scoop/quarter decomposition', 'V8'),
  flag('v8Nlh', 'NLH-only bluff branches (scare-card check-raise, river blocker raise)', 'V8'),
  flag('v9', 'V9 master: sizing families, timing, mood', 'V9'),
  flag('v9Sizing', 'human size families for bets', 'V9'),
  flag('v9Timing', 'think-time distribution', 'V9'),
  flag(
    'decisionGravityTiming',
    'decision-size think time (horseDecisionGravity): longer on all-ins, big bets, big pots and the river, quicker on a preflop fold or small-pot check; default on, false ablates (2026-11-07)',
    'V9'
  ),
  flag(
    'horseActionTimeIsPublicOnly',
    "Owner order 2026-11-15 (timing tell): every Horse think time, every variant and format, comes from horsePublicActionTimeMs: street, board, pot, price, stacks, players, the action shown, the seat tempo persona and a random stream of its own; the private difficulty hint, the hold'em made-hand Hollywood trigger and the strategy random stream no longer reach it. Default OFF (opt-in): only an explicit true switches it on",
    'V94'
  ),
  flag(
    'omahaBetSizeByPublicState',
    "PLO Strategy lane 2026-11-16 (owner 2026-11-15: \"HE GETS THEM TO FOLD WHEN HE WANTS A FOLD, AND GETS A CALL WHEN HE WANTS A CALL\"; bet size measured as a tell, sizing-20261116/MEASURE.md): in PLO4/PLO5 cash, pot limit, high only, one board, not Lightning, the size of the Horse's own postflop bet or raise comes from horsePublicBetSize on public information only (street, board class, pot, the seat's chips, legal bounds, opponents, position, the heads-up opponent's measured fold-to-bet read) and a random stream of its own, as the last step of the wager_rules node, so every hand the engine bets in one public spot draws from one size distribution. Bet or check, raise or call stay the engine's; a check, call, fold or all-in is never touched; a size that commits 60% or more of the chips becomes the largest legal wager for every betting hand (every chip is the all-in); with omahaNutClassValueSize on, a nut-class wager keeps that option's size. Every constant is a builder's choice, none measured. Default OFF (opt-in): only an explicit true switches it on",
    'V94'
  ),
  flag('v9Mood', 'hourly mood gear-shift per horse', 'V9'),
  flag('v10', 'V10 master: c-bet read, SPR, rake, thin value, limp iso', 'V10'),
  flag('v10Cbet', 'range-advantage c-bet read', 'V10'),
  flag('v10Spr', 'SPR-aware raise bars', 'V10'),
  flag('v10Rake', 'rake drag on marginal pots (rakeDrag)', 'V10'),
  flag('v10ThinValue', 'capped-range thin value', 'V10'),
  flag('v10Iso', 'limp isolation', 'V10', 'HorsePreflop.decidePreflopV7'),
  flag('v11', 'V11: board domination discipline, initiative gate, no donk leads', 'V11'),
  flag('v12', 'V12 master: board-conditioned ranges, river polish', 'V12'),
  flag('v12Ranges', 'board-contact conditioning of sampled opponent hands', 'V12'),
  flag('v12River', 'OOP block bets, nut overbets, blocker catches', 'V12'),
  flag('v13', 'V13 position read (actsLastPostflop) and preflop chart depth', 'V13'),
  flag('v15', 'Omaha nut discipline: which flush/straight, caps, small ball', 'V15'),
  flag(
    'v15Boats',
    'Omaha boat dominance: a full house a bigger boat beats calls a raise (default ON in PLO5 cash since 2026-11-06, league plo5_v15_boats)',
    'V15'
  ),
  flag('v16Reads', 'deep reads: fold-to-c-bet, fold-to-3-bet, big-bet tells', 'V16'),
  flag('v16Icm', 'real ICM (Malmuth-Harville) in tournaments', 'V16'),
  flag(
    'v16Hu',
    'heads-up postflop overlay; DEFAULT OFF since 2026-10-05 (hu_v16_overlay -0.26 +/- 0.10 over 31 nights)',
    'V16'
  ),
  flag('v16Blockers', 'river unblocker bluffs', 'V16'),
  flag('v16SizeCond', 'big-bet-conditioned sampling', 'V16'),
  flag('v16PloPolar', 'PLO polarity read', 'V16'),
  flag(
    'v16Ratio',
    'DEFAULT OFF and DEAD BY PRECEDENCE since V38 (2026-09-03): both gates it rescales sit below the V38 call/fold return; league matchup retired 2026-09-05 after 0.00 +/- 0.00 over 12,000 hands',
    'V16'
  ),
  flag('v17Pos', 'players-behind bluff pressure', 'V17'),
  flag(
    'v17RiverProbe',
    'river probe into a capped field; DEFAULT OFF since 2026-10-16 (v17_river_probe -0.11 +/- 0.04 pooled over 8 nights)',
    'V17'
  ),
  flag('v17CatchBlock', 'call-side blocker on missed-flush rivers', 'V17'),
  flag('v17ShortDeck', 'short deck multiway tightening', 'V17'),
  flag('v18Straddle', 'straddle read as unopened', 'V18', 'HorsePreflop.decidePreflopV7'),
  flag('v18Squeeze', 'squeeze response', 'V18', 'HorsePreflop.decidePreflopV7'),
  flag('v18SelfImage', 'own image feeds bluff volume', 'V18'),
  flag('v18ExploitSize', 'station/nit-scaled river raise size', 'V18'),
  flag('v18Families', 'per-horse sizing-family personality', 'V18'),
  flag('v20Multiway', 'multiway pressure read and caps', 'V20'),
  flag('v20Mzone', 'tournament M-zone layer', 'V20'),
  flag('v21River', 'NLH nut status, dominated caps, raise-war governor', 'V21'),
  flag(
    'v21Deep',
    'deep-stack preflop discipline past 120bb',
    'V21',
    'HorsePreflop.decidePreflopV7'
  ),
  flag('v23Endgame', 'tournament endgame adjust (bounties, prizes)', 'V23'),
  flag('v23Plan', 'raise-response plans decided at bet time', 'V23'),
  flag('v23Reads', 'river reads', 'V23'),
  flag('v23Variants', 'plo8 low-only draw discipline (plo8_v23_lowdraw)', 'V23'),
  flag(
    'v23ShortDeck',
    'the short-deck half of the V23 variant polish; DEFAULT OFF since 2026-10-16 (shortdeck_v23 -0.36 +/- 0.14 over 44 runs)',
    'V23'
  ),
  flag('v23Spin', 'spin format overlay', 'V23'),
  flag('v24Bounty', 'PKO bounty pull', 'V24'),
  flag(
    'v24PloDefense',
    'PLO price defense against pot-sized preflop raises; PLO6 CASH DEFAULT OFF since 2026-10-31 (plo6_v24_price -2.34 +/- 1.12 over the 7 runs to 2026-10-30); PLO4/PLO5 and PLO6 tournaments on',
    'V24',
    'HorsePreflop.decidePreflopV7'
  ),
  flag('v25PloTourney', 'PLO tournament commitment law', 'V25', 'HorsePreflop.decidePreflopV7'),
  flag('v26Prizes', 'prize landscape scale (mystery chests)', 'V26'),
  flag('v27GtoCharts', 'NLH preflop solver charts', 'V27', 'HorsePreflop.decidePreflopV7'),
  flag('v29GtoFlop', 'NLH flop solver cells', 'V29'),
  flag('v30GtoTurnRiver', 'NLH turn/river solver cells', 'V30'),
  flag('v31GtoSuitAware', 'suit-aware solver lookups', 'V31'),
  evaluationControl(
    'gtoV31DatasetChecksum',
    'selects one exact sealed candidate checksum without changing the active live store'
  ),
  evaluationControl(
    'onGtoV31Decision',
    'captures decision-level source receipts for paired replay and league reconciliation'
  ),
  evaluationControl(
    'onV31ReplayState',
    'records each certified decision with its inputs and RNG position for the replay digest'
  ),
  evaluationControl(
    'onV31Demand',
    'records the cell every certified-playbook consult asks for (R8 density pre-flight)'
  ),
  flag(
    'v32FacingDefense',
    'solver facing-bet defense; DEFAULT OFF since 2026-10-16 (v32_facing_defense -0.31 +/- 0.15 over 41 runs)',
    'V32'
  ),
  flag('v33DepthCeiling', 'solver depth ceiling (300bb)', 'V33'),
  flag(
    'gtoV31CellContractV3Serving',
    'V31 cell contract v3 serving (FLOP-5 D6): true reads the v3 cell readers and keys the certified consult by the v3 cell (line class, donk, 200 bb) when the loaded store declares cell contract v3; unset or false is the v2 path exactly. Off-only under the owner R7/R8 hold (V31 serving is registration-gated); a v3 store also needs a sealed, promoted and bound v3 dataset',
    'V31 cell contract v3',
    'HorseV31CertifiedPolicy.decideV31Certified, GtoPostflopV31Loader'
  ),
  flag('v37Satellite', 'satellite survival play', 'V37'),
  flag('v38Ev', 'the EV engine arbiter for solverless games and the MDF river', 'V38'),
  flag(
    'v40Omaha',
    'Omaha is not hold em: tiered sampler, pressure cap, small ball, tag loop',
    'V40'
  ),
  flag(
    'holdemPremiumAggression',
    'NLH premiums (QQ+, AK) never passive: raise preflop, keep betting postflop; dominated offsuit hands fold to a big 3-bet (Dan 2026-10-25); false only to ablate an older layer',
    'Hold em premium aggression'
  ),
  flag(
    'holdemDominatedFold',
    'internal: false skips the NLH dominated-hand 3-bet fold at the commit-time recheck, which has no opponent reads to honour the maniac law with',
    'Hold em premium aggression'
  ),
  flag(
    'ploPairedBoardFold',
    'PLO4/PLO5/PLO6 no full house on a paired flop, turn or river folds to a committing bet (Dan 2026-10-25); false only to ablate an older layer',
    'PLO paired-board fold'
  ),
  flag(
    'ploPairedBoardRiverCheck',
    'PLO4/PLO5/PLO6 no full house checks the river of a board paired on the turn after its own turn bet was called (Dan 2026-11-06); false only to ablate or as a complaint-law control',
    'PLO paired-board river check'
  ),
  flag(
    'ploSuitedAcesFourBet',
    'High-only PLO suited aces 4-bet one 3-bet and continue when re-raised (Dan 2026-11-06); false only to ablate or as a complaint-law control',
    'PLO suited aces 4-bet'
  ),
  flag(
    'v86PloOverhaul',
    'V86 PLO4/5/6/8 preflop 3-bet/4-bet/squeeze rundowns & suited Ax, postflop combo-draw pump & SPR discipline, Bully-Breaker LAG counter, Bomb Pot/Multi-Board dead-half guard, Short Deck/Pineapple defense, and Hollywood timing mix (default ON, false ablates)',
    'V86'
  ),
  flag(
    'v87HoldemOverhaul',
    'Hold em cash 25-30% VPIP, EP limp-reraise traps and suited-connector limp mix, SPR postflop gameplan, anti-LAG bully-breaker, river block-bet balance, Hollywood tank mix, and tournament bubble/PKO discipline; false only to ablate',
    'V87'
  ),
  flag(
    'v87RiverBlockBetTrap',
    'V87 river nut-trap lead and re-raise policy; default enabled, false only for isolated offline ablation',
    'V87'
  ),
  flag(
    'v87HollywoodTank',
    'V87 deterministic Hollywood timing eligibility; default enabled, false only for isolated offline ablation',
    'V87'
  ),
  flag(
    'v87FlopStabCheckRaise',
    'V87 flop-stab check-raise policy with public reads retained; default enabled, false only for isolated offline ablation',
    'V87'
  ),
  flag(
    'deepEquity',
    'V44 second look: every Monte Carlo read at this multiple of its sample; set only by the engine replay inside the think time',
    'V44'
  ),
  flag(
    'v46Charts',
    'the Omaha / short-deck hand-class chart: AAxx double-suited 3-bets, a rundown flats, AAA-x folds',
    'V46'
  ),
  flag(
    'v46ShortDeck',
    'the short-deck half of the V46 chart; DEFAULT OFF since 2026-10-05 (shortdeck_v46_classes -0.51 +/- 0.15 over 960k hands)',
    'V46'
  ),
  flag(
    'v51RiverFlat',
    'a committed river one-pair hand calls instead of jamming (league v51_river_flat)',
    'V51'
  ),
  flag(
    'smallPotNearNutRiverValue',
    'default-off PLO4/5/6 single-board small-pot near-nut river value candidate, qualification pending; only removes random call after existing value and safety gates',
    'Small-pot near-nut value'
  ),
  flag(
    'v55OmahaRiverTripsFlat',
    'river Omaha weak sets/trips retain call pricing without re-shoving; default off pending deep-cash league qualification',
    'V55'
  ),
  flag(
    'v56OmahaPressureRange',
    'river vulnerable set/trips versus tier-three pressure on one Omaha-high cash board; qualified fixed400bb cash card, explicit off arm retained',
    'V56'
  ),
  flag(
    'v57TournamentAggression',
    'Dan 2026-10-25 NLH tournament aggression: wider opens, 3-bets and big blind defence against the opener width, a shade wider 3-bet defence to 60bb, and more planned turn barrels; explicit off arm retained for the historical neutrality corpus',
    'V57'
  ),
  flag(
    'v61RiverOnePairShade',
    'Hold em one-pair (or board-paired two pair) river calls are shaded 6-12 equity points against the price unless the bettor reads as an over-bluffer; measured 14-day review stack-offs won 14-22% at prices demanding 20-40%; explicit off arm retained',
    'V61'
  ),
  flag(
    'v66BetRaisedOnePair',
    '2026-10-31 Hold em flop/turn bet-then-raised one pair (or air with no real draw): hero own wager this street no longer counts toward commitment, the call carries a raise shade of up to 0.10 equity scaled by the raise size, and the class calls or folds at that price without jamming; measured 7-day review calls won 33-36% at an average raise of 0.86 pot; explicit off arm retained',
    'V66'
  ),
  flag(
    'v67RiverBetRaisedOnePair',
    '2026-10-31 Hold em river bet-then-raised one pair (or board-paired two pair): the raiser is sampled from a river raise stratum (10% bluff, otherwise 75/22/3 two pair+/top pair/weaker), the call carries the V63 shade plus 0.10 (cap 0.25) even under a V62 polar read, and the class calls or folds at that price without the 0.42 floor or a jam; measured 7-day review calls/jams won 11.9% cash (n=226) and 19.2% MTT (n=125) at an average raise of 0.72 pot; explicit off arm retained',
    'V67'
  ),
  flag(
    'v88CommitmentHonored',
    '2026-11-11 cash Omaha high, single board, heads-up, not over hero own raised wager, no non-nut straight or flush and no board-dominated hand: a made hand that called a wager on the previous street and now needs its whole stack at 0.345 of the pot or better does not fold when the new card neither completes a draw it does not beat nor pairs the board under trips and its uncapped range equity clears the price; hand 58656644 called a flop check-raise leaving 936 behind 1,212 and folded a blank turn at 0.32 capped equity against a 0.3235 bar; explicit off arm retained',
    'V88'
  ),
  flag(
    'omahaSmallBlindSteal',
    '2026-11-14 (V90 item 4, HorseOmahaTournamentFirstIn): PLO4/PLO5 tournaments, four to eight dealt, the small blind folded to at 20 BB or less raises the pot with its top 40 percent of Omaha hands instead of the engine fold; never on the bubble, hand-for-hand or in a satellite; needs omahaTournamentFirstIn. Default OFF (opt-in, read === true) in source since the 2026-11-15 PLO strategy head: unset, the full-table share is zero and the small blind plays as on main before the rule. Unmeasured; receipt omaha_full_table_sb_steal',
    'V90'
  ),
  flag(
    'omahaTournamentFirstIn',
    '2026-11-13 Omaha high tournaments (engine-declared), at the final table (trusted players left no more than the players dealt; unknown stands aside), heads-up at 20 BB or less or a three-handed table paying one place at 30 BB or less (2026-11-14), not All-In-Or-Fold, not a locked satellite seat: the small blind against the big blind alone plays every hand as the pot-limit maximum raise, and the heads-up big blind (or the three-handed winner-take-all big blind closing the action) calls its top 75 percent against one raise at a price of a half or better, replacing only the engine fold; at a three-handed final table with pay jumps where every player left is paid (2026-11-14), only the small blind against the big blind alone, on its top 60 percent at 20 BB or less; percentile among Omaha hands, narrowed by the tournament risk premium. Four to eight dealt (2026-11-15, item 4), PLO4 and PLO5 only, the small blind folded to with the big blind alone pot-raises its top 40 percent (flat) at 20 BB or less instead of the engine fold, never on the money bubble (near-bubble line or flag), hand-for-hand, in a satellite or with the field or payout unknown; the big blind is untouched.',
    'V90'
  ),
  flag(
    'omahaHiLoTournamentFirstIn',
    '2026-11-14 default OFF (HU-HILO-002): pot-limit Omaha hi-lo tournaments (engine-declared), exactly two dealt in at the final table, 20 BB or less, not All-In-Or-Fold, not a locked satellite seat, not fixed limit: the small blind first in plays every hand as the pot-limit maximum raise and the big blind calls its top 75 percent against one raise at a price of a half or better, replacing only the engine fold, by the hand percentile among Omaha hi-lo hands, narrowed by the tournament risk premium; the Omaha high rule (omahaTournamentFirstIn) with the hi-lo percentile and no three-handed branch; only explicit true or a league arm switches it on',
    'V90'
  ),
  flag(
    'tokenCallPrice',
    '2026-11-12 cash Omaha high committed-call bar: below a price of 0.15 the additive premiums (margin, commitment bar, scare margin, shades) shrink in proportion to the price, and under 0.01 a made hand calls; unchanged at 0.15 or more (PLO6-AUDIT-010, production hand 58750626)',
    'V89'
  ),
  flag(
    'omahaRiverNutRaiseOnly',
    'Dan 2026-11-14 (hand 59401453): PLO4/PLO5/PLO6 high on one board, a river raise facing a wager stands only with the nuts or an effective-nut hand, every other raise becomes a call; and the PLO4/PLO5 river call of a 0.9-pot+ wager with a set or trips on a straight- or flush-possible board folds (V81 cell trips_set_drawy). Default on; explicit false is the complaint law control',
    'V94'
  ),
  flag(
    'omahaTurnSetPound',
    'Dan 2026-11-14 (hand 59401453): an Omaha high set on a turn board where a straight is possible and no flush is possible bets the geometric monster size instead of the V40 half-pot small ball and is not checked back for a fresh straight card. Default on; explicit false is the complaint law control',
    'V94'
  ),
  flag(
    'omahaBeatenMadeHandDefense',
    'Dan 2026-11-14 (hands 59414191, 59416584): PLO4/PLO5/PLO6 high on one board, a two pair, set, non-nut straight or non-nut flush that a possible straight or flush beats never raises a turn wager (it calls), checks the turn or river card that made it possible when a player still acts behind, and does not bet the river into a player who bet or raised a street on which it was already possible (HorseOmahaMadeHandDefense.ts). Default OFF (opt-in): its declared evaluation failed (LAG-value PLO4 -23.73, PLO5 -16.17 bb/100)',
    'V94'
  ),
  flag(
    'omahaBluffCatcherRaiseFold',
    'Dan 2026-11-14: the PLO4/PLO5 big-bet call discipline also folds a bluff catcher (two pair, set or trips on a straight- or flush-possible board, non-nut straight, non-nut flush) that is raised 0.9 pot or more on the turn or river, or faces a 0.9-pot+ turn bet from a player who also bet or raised the flop, unless the turn redraw pays the price; a measured postflop over-bluffer keeps the call. Default OFF (opt-in): only an explicit true switches it on',
    'V94'
  ),
  flag(
    'omahaReraisedPotDiscipline',
    'Owner ruling 2026-11-14 23:49 (re-raised pots): PLO4/PLO5 cash, facing a 4-bet or more preflop a hand without a pair of aces or a premium structure folds unless the committed call pays the price against aces; the postflop half is the separate opt-in omahaReraisedPotStackOffFold (HorseOmahaReraisedPot.ts). Default OFF (opt-in): its declared evaluation failed (PROTOCOL-2 E1, LAG-value PLO5 -11.95 bb/100, z -2.32)',
    'V94'
  ),
  flag(
    'omahaReraisedPotStackOffFold',
    'Owner ruling 2026-11-14 23:49 (re-raised pots), postflop half: in a PLO4/PLO5 cash pot raised three or more times preflop, one pair or two pair below top two does not put its stack in unless its equity against aces or top two or better pays the price (HorseOmahaReraisedPot.ts). Default OFF (opt-in): a development probe found the calls it folds positive against Horse holdings; it goes on only after its declared evaluation passes',
    'V94'
  ),
  flag(
    'omahaReraisedPotStackOffRealistic',
    '2026-11-15 correction of omahaReraisedPotStackOffFold: in a PLO4/PLO5 cash pot raised three or more times preflop, one pair or two pair below top two does not put its stack in unless its equity against a realistic range (aces or kings, top pair or better, nut flush draw or 8+ straight outs) pays the price; a measured postflop over-bluffer keeps the call (HorseOmahaReraisedPot.ts). Default OFF (opt-in). League card plo4/plo5 _omaha_reraised_pot_stack_off_realistic',
    'V94'
  ),
  flag(
    'omahaReraisedFoldVsTight',
    'Owner 2026-11-15 01:03 (a maniac and a tight player are played differently): the PLO4/PLO5 cash preflop fold of omahaReraisedPotDiscipline (facing a 4-bet or more, no aces or premium structure, not priced against aces) applies only when the last preflop raiser is a measured tight re-raiser: his own re-raise rate credibly (0.9) at or below the Horse mean on 12+ decayed opportunities, not a maniac; a presumed read never counts (HorseOmahaReadConditional.ts). Against a wide re-raiser, a maniac or an unknown player the Horse plays as today. Default OFF (opt-in); league cards plo4/plo5 _omaha_reraised_fold_vs_tight',
    'V94'
  ),
  flag(
    'omahaEliteContinuesVsMeasuredWideThreeBettor',
    'PLO Strategy lane 2026-11-15 (decisions census): a PLO4/PLO5 cash Horse that opened and faces exactly one re-raise, heads-up against the price, from a player MEASURED to re-raise wide (15+ decayed hands, 12+ decayed re-raise opportunities, re-raise rate credibly above the Horse mean with a shrunk mean of 0.15 or more; a presumed read never counts) does not fold an elite-class hand (double-suited rundown or connected broadway, double-suited kings, nut-suited ace bridge, aces; only the hands the class read marks as shallow 4-bet hands) to the maniac-price arithmetic when the call is under 40% of the stack at raw pot odds of 0.34 or less: the fold becomes a call. Never creates a raise. Hi-Lo, PLO6, bomb pots, multi-board and tournaments are outside. Default off (opt-in) until its declared evaluation passes.',
    'V94'
  ),
  flag(
    'omahaOopReraisedPotStrongRange',
    'Owner 2026-11-15 11:49, 11:51 and 11:55 (calling 3-bets and 4-bets out of position needs a much stronger range and must not happen just because the opponent is aggressive; the range is rundowns, straight makers and double-suited hands, not big cards with a dangler or high cards with low cards): a PLO4/PLO5 cash preflop call facing a 3-bet or more from a raiser the Horse acts before on every later street, or facing a 4-bet or more in either position, stands only with suited aces, as a commitment (equity above the price and, facing a 3-bet, a stack-to-pot ratio after the call under 1; facing a 4-bet or more, the call itself all in), or with a coordinated hand (at most one pair, every card in one connected rank group, one-rank gaps limited; bare aces excused) whose equity against the range the mind reads for the raiser is at least the price plus the realization margin (0.10 out of position, 0.05 in position, 0.03 more facing a 4-bet with exactly one ace or king). Otherwise the call folds; raises and a call of a 3-bet in position are unchanged. Default off (opt-in) until its declared evaluation passes.',
    'V94'
  ),
  flag(
    'omahaReraiseRangeOutOfPosition',
    'Owner 2026-11-15 12:18 (the 3-bet and 4-bet ranges out of position must be capped): a PLO4/PLO5 cash preflop raise that would be the 3-bet or the 4-bet stands, when the Horse will be out of position against the player it re-raises or against a caller in the pot who acts again, only with suited aces, any aces when the re-raise commits (stack-to-pot ratio once it is called at or under 1), or the declared premium structures (kings double-suited, double-suited rundowns seven-high or better). Every other hand calls instead; the call of a 3-bet is judged by the calling rule of omahaOopReraisedPotStrongRange, the call of a single raise stands for a coordinated hand, aces, or equity clearing the price plus the realization margin, and otherwise folds. Blind against blind keeps the ranges of today. Applied outermost, after the VPIP floor and the maniac-pressure paths. Switched separately from omahaReraiseRangeEarlyPosition. Default off (opt-in) until its declared evaluation passes.',
    'V94'
  ),
  flag(
    'omahaReraiseRangeEarlyPosition',
    'Owner 2026-11-15 12:18 (the 3-bet and 4-bet ranges under the gun must be capped): the rule of omahaReraiseRangeOutOfPosition for the early-position spots, the Horse under the gun or under the gun plus one at a table of six or more dealt in with a live player still to act: the 3-bet or 4-bet stands only with suited aces, any aces when the re-raise commits, or the declared premium structures; every other hand calls or folds by the calling rule. Switched separately. Default off (opt-in) until its declared evaluation passes.',
    'V94'
  ),
  flag(
    'omahaReraisedPotFlopContinueNeedsEquityShape',
    'Owner 2026-11-15 11:55 (the caller of a 3-bet or 4-bet continues on the flop only with a pair plus a straight or flush draw, or better): PLO4/PLO5 cash, on the flop of a pot raised twice or more preflop that the Horse called, a call or raise facing a wager stands only with two pair or better of its own, one pair with a nut-leaning draw (nut flush draw, or 8+ straight outs with 4+ to the nut straight), a strong draw (8+ outs to a nut-class hand, or a flush draw with 8+ straight outs), or when the call costs under 10% of the resulting pot. Otherwise it folds. Default off (opt-in) until its declared evaluation passes.',
    'V94'
  ),
  flag(
    'omahaMadeHandDefenseVsValueLeader',
    'Owner 2026-11-15 01:03: the PLO4/PLO5/PLO6 turn no-raise and scare-card checks of omahaBeatenMadeHandDefense apply only when every live opponent is a measured postflop value leader: bet when checked to not credibly above the Horse mean, not a postflop maniac, fold to a bet at least and river call at most the Horse mean, on 8+ decayed postflop opportunities; preflop width is not part of it; a presumed read never counts (HorseOmahaReadConditional.ts). Against an over-bluffer, a station or an unknown player the Horse plays as today. Default OFF (opt-in); league cards plo4/plo5 _omaha_made_hand_defense_vs_value_leader',
    'V94'
  ),
  flag(
    'omahaBluffCatcherFoldVsValueLeader',
    'Owner 2026-11-15 (PLO Strategy: Horses call big river bets and raises with bluff catchers against a player who always has it): the PLO4/PLO5 bluff-catcher folds of omahaBluffCatcherRaiseFold (a 0.9-pot+ turn or river raise, or a 0.9-pot+ turn bet from the flop bettor, with every exception of that rule) apply only when the player whose bet or raise is faced is a measured postflop value leader: bet when checked to not credibly above the Horse mean, not a postflop maniac, fold to a bet at least and river call at most the Horse mean, on 8+ decayed postflop opportunities; a presumed read never counts (HorseOmahaReadConditional.ts). Against an over-bluffer, a station or an unknown player the Horse plays as today. Default OFF (opt-in), unmeasured; league cards plo4/plo5 _omaha_bluff_catcher_fold_vs_value_leader',
    'V94'
  ),
  flag(
    'omahaRiverMediumBetStrongHandCalls',
    'PLO Strategy lane 2026-11-15 (one PLO5 cash player: Horses folded two pair or better 11 times in 15 to his river bets of 40 to 70 percent of the pot, five of them the best hand): in PLO4/PLO5 cash, high only, one board, on the river, facing the opening bet (no raise) of 40 to 70 percent of the pot, heads-up or closing the action, a fold of two pair or better (two pair on a paired board is the one-pair class) becomes a call when the hand holds up against the exact share of the holdings the bettor could have at least 1.5 times as often as the price of the call asks; it reopens the equity folds and the paired-board fold in that spot only; withheld against a measured postflop value leader and for a guarded fold (HorseOmahaRiverMediumBetCalls.ts). Default OFF (opt-in); league cards plo4/plo5 _omaha_river_medium_bet_strong_hand_calls',
    'V94'
  ),
  flag(
    'omahaBigBetIsPotShare',
    'PLO Strategy lane 2026-11-15 (root cause of the river folds of strong made hands to half-pot bets): in PLO4/PLO5 cash, high only, the Omaha aggressor tier (HorseEval.omahaAggressorTier) does not count the range read 20 big blind big-bet mark for a turn or river wager under 70 percent of the pot it went into; that wager is tiered by its pot share, its streets and whether it was a raise. The mark itself (OppPostflopRead.bigBet) and its other consumers, a wager of 70 percent or more, the flop and every other game are unchanged; V56 follows the tier. Default OFF (opt-in); league cards plo4/plo5 _omaha_big_bet_is_pot_share',
    'V94'
  ),
  flag(
    'omahaPairedRiverNoThinLeadVsValueLeader',
    'Owner 2026-11-15 (hand 59517323): PLO4/PLO5 cash, one board, high only, river, nothing to call: on a paired final board a Horse with less than a full house does not bet into opponents of whom one called its flop or turn bet, when every live opponent is a measured postflop value leader (HorseOmahaReadConditional; a presumed read never counts); the bet becomes a check (HorseOmahaOopChecks.ts). A decision facing a bet is unchanged. Default OFF (read === true) until its declared evaluation passes; the unconditional form (ploPairedRiverCheckAfterCalled) failed against a field that calls rivers whatever the board',
    'V94'
  ),
  flag(
    'omahaOverpairNoOopBarrelVsValueLeader',
    'Owner 2026-11-15 11:04 (hand 59517323): PLO4/PLO5 cash, heads-up, turn, out of position, the flop bet called, the made hand still one pair (a draw picked up, the nut flush draw included, does not count), a straight possible on the board: the turn bet becomes a check, only against a measured postflop value leader (HorseOmahaOopChecks.ts). Two pair or better still bets. Default OFF (read === true) until its declared evaluation passes',
    'V94'
  ),
  flag(
    'omahaPairedTurnNoBarrelWithoutBoatVsValueLeader',
    'Lane owner 2026-11-15 (hand 59521326): PLO4/PLO5 cash, heads-up, turn, out of position, the flop bet or raise called, the turn card pairs the board, less than a full house (a straight, a flush or weaker): the turn bet becomes a check, only against a measured postflop value leader (HorseOmahaOopChecks.ts). A full house or better still bets. Default OFF (read === true) until its declared evaluation passes',
    'V94'
  ),
  flag(
    'omahaPairedBoardFoldRespectsPrice',
    'Lane owner 2026-11-15 (hand 59521326): PLO4/PLO5 cash, the 2026-10-25 paired-board fold does not override the reference decision when the call price (the call over the pot after it) is at most 0.25 and the Horse holds a straight or a flush, or the call is for the rest of an effective stack of which it has already put in at least 60% this hand; the reference decision stands and may still fold (HorsePloPairedBoardFold.ploPairedBoardFoldRespectsPrice). Default OFF (read === true) until its declared evaluation passes',
    'PLO paired-board fold'
  ),
  flag(
    'omahaFlopFacingBetEv',
    "PLO Strategy lane 2026-11-17 (owner 2026-11-16: a decision rests on the hand, the equity, the opponent's range and the price, never on the size of the bet alone, and no blanket rule may block a correct decision): in PLO4/PLO5 cash, high only, one board, on the FLOP facing a bet or a raise, a fold or a call (the whole-stack call included) is replaced by one expected-value verdict (HorseOmahaFlopFacingBetEv.ts): the hand's showdown result on two-card runouts sampled with a seed taken from the cards (every unseen card the turn card once, three river cards each, eight opponent holdings per runout; never the brain's random stream), against the bettor's value region (the strongest share of holdings on the flop, set by the bet's share of the pot, a raise and a lead into the preflop aggressor) and his other holdings at a non-value share moved by his measured read, times a realization factor read from the hand's own runouts (equity on runouts where the hand can call the turn and the river is realized, bluff-catcher equity only on streets he checks), against the price and the one margin of omahaFacingBetEv. The flop had no such rule: the stack-share paired-board fold and the 20 big blind big-bet mark decided it; with the option on they no longer decide a spot the verdict covers. A raise is left alone; the bare-overpair continuation keeps its own verdict; tournaments, PLO6, hi-lo, bomb pots and capped wagers are outside it. Independent of omahaFacingBetEv. Constants stated, not measured. Default OFF (opt-in, read === true) until its declared evaluation passes; league cards plo4/plo5 _omaha_flop_facing_bet_ev",
    'V94'
  ),
  flag(
    'omahaTurnBetNeedsRiverPlan',
    'Lane owner 2026-11-15 (hand 59521326): PLO4/PLO5 cash heads-up, a turn bet that would leave less than half of the resulting pot behind becomes a check when on more than 35% of the river cards the Horse own river fold rules (HorseOmahaOopChecks.omahaRiverShoveFoldVerdict: the paired-board fold with its price exception when that option is on, then the big-bet tier V81 and V86) would fold to an all-in for what is left; exact enumeration; the reference decision equity fold is not asked. Default OFF (read === true) until its declared evaluation passes',
    'V94'
  ),
  flag(
    'omahaPressureNeedsPostflopAggression',
    'Lane owner 2026-11-15 (hand 59526261): PLO4/PLO5 cash, postflop: the V53 pressure play facing a bet (value-raise bar lowered 0.10, raise frequency 0.90, wider semi-bluff raise) and the maniac call-down priced on preflop raising width apply only when the bettor own postflop betting is measured high (isPostflopManiac or the read-conditional postflopAggressor); a preflop-wide or presumed-aggressive bettor who is a measured value leader or unmeasured after the flop gets none. With it a facing-bet value raise on the turn or river with a hand a possible straight or flush already beats (omahaBeatenByBoard), not nut class, becomes a call without needing a fresh scare card. Default OFF (read === true) until its declared evaluation passes',
    'V94'
  ),
  flag(
    'omahaOopTurnCheckAfterFlopCall',
    'Owner 2026-11-15 12:09 (hands 59517323, 59521326, 59526261; check-call when drawing to the nuts, check-fold when the hand cannot improve): PLO4/PLO5 cash, heads-up, one board, high only, turn, out of position, no opponent read. The flop bet or raise called and no nut-class hand: a turn bet becomes a check. Having checked and facing the turn bet (also after calling a flop raise): never a raise; a call with four or more nut outs when the price is within their share plus 0.15; a fold with no nut out and one pair or a hand the board already beats at a price of 0.15 or more; otherwise today call or fold (HorseOmahaOopChecks.ts). Runs before omahaOverpairNoOopBarrelVsValueLeader and omahaPairedTurnNoBarrelWithoutBoatVsValueLeader. Default OFF (read === true) until its declared evaluation passes',
    'V94'
  ),
  flag(
    'omahaBareOverpairOopFlopCheck',
    'Owner 2026-11-15 11:05 (hand 59517323), widened 14:19 and 14:23 (all big pairs with the betting lead): PLO4/PLO5 cash, flop, the Horse was the last preflop aggressor and is out of position (an opponent still acts behind) with a bare big pair, a pocket pair that is an overpair to the flop or pocket queens or better with at most one overcard on it, exactly one pair made, no flush draw and under eight straight outs, on any flop texture: a bet becomes a check, heads-up and multiway, with no opponent read and no stack-to-pot exception. The continuation, heads-up only: having checked and facing the flop bet, never a raise; a call when the expected value of the call (the exact cards against the bettor range by his bet size, moved by his measured read, at the price, with a stated 0.75 out-of-position realisation discount that is not measured) clears 2 percent of the final pot, else a fold; multiway and the whole-stack call keep the decision (HorseOmahaOopChecks.ts). Default OFF (read === true) until its declared evaluation passes',
    'V94'
  ),
  flag(
    'omahaNoCallColdFourBetWithoutPremium',
    "Owner complaint 2026-11-15 (hand 59518335, PLO5 cash): a Horse whose own preflop re-raise is re-raised cold (the re-raiser had put no voluntary money in before; not the opener or a caller) folds a PLO4/PLO5 cash hand without a pair of aces or a premium structure (omahaReraisedPremium), unless the call is all in or leaves no more behind than the call itself and its equity against aces pays the direct price. A measured maniac re-raiser keeps today's play. HorseOmahaUnderpair.ts. Default off (opt-in) until its declared evaluation passes.",
    'V94'
  ),
  flag(
    'omahaUnderpairNoMultiwayFlopContinue',
    'Owner complaint 2026-11-15 (hand 59518335, PLO5 cash): on an unpaired PLO4/PLO5 cash flop, facing a bet and a call from two live opponents, exactly one pair below the top card of the board with no flush draw and fewer than eight nut-straight outs folds instead of continuing, unless the call costs less than a tenth of the resulting pot. Heads-up flops are untouched. HorseOmahaUnderpair.ts. Default off (opt-in) until its declared evaluation passes.',
    'V94'
  ),
  flag(
    'omahaMultiwayRiverCallNeedsStrength',
    '2026-11-16 (full sweep 2026-11-15 family R: 19 multiway river calls without the nuts, -1,987 bb): PLO4/PLO5 cash, one board, high only, the river, facing a bet with at least one other opponent live beside the bettor (a caller in front, an earlier all-in or a player still to act), a hand that is not nut class: a call or a raise becomes the multiway exact-hand verdict, the HorseOmahaFacingBetEv EV against the bettor (measured read, else the population prior) times the chance of beating every other continuing range (caller 0.35, behind 0.25, all-in 0.5 of all holdings, a caller or player behind moved by his measured river-call rate against 0.39; ranges independent): a call when EV clears the facing-bet margin (2% of the final pot), else a fold; never a raise; a fold stays a fold (HorseOmahaMultiwayDiscipline.ts). In the owner-ruled chain (omahaOwnerRuledFinal). Default OFF (read === true) until its declared evaluation passes',
    'V94'
  ),
  flag(
    'omahaNoRiverBluffIntoValueLeader',
    '2026-11-16 (pricingfix 2026-11-15: in-position river bets into a measured value leader, states 65, 487, 591): PLO4/PLO5 cash, the river, nothing to call, a bet with a hand below the showdown-value line (wins or ties against under 0.5 of all holdings, exact count; stated, not measured), not nut class, no nut blocker (the v86 nut-blocker bluff keeps its spots), with a live opponent who is a measured postflop value leader (omahaReadConditionalOf) and bet, raised or called an earlier postflop street: the bet becomes a check unless the fold-equity EV comparison (his measured river-call rate, else the population prior 0.60; a shown range of 0.5 of holdings times the line factors, stated) says the bet beats the check by 2% of the pot. In and out of position, heads-up and multiway (HorseOmahaMultiwayDiscipline.ts). Owner-ruled check (omahaOopCheckRules, kept outermost by omahaOwnerRuledFinal). Default OFF (read === true) until its declared evaluation passes',
    'V94'
  ),
  flag(
    'omahaMultiwayWeakHandNoBet',
    '2026-11-16 (full sweep 2026-11-15 families D2 and B1b): PLO4/PLO5 cash, the turn and the river, nothing to call, two or more live opponents, a bet with one pair or less (omahaOnePairOrLess), not nut class, on the turn no nut-class draw (four or more nut-class outs, omahaNutClassOuts) and no combo draw (omahaComboDrawForRaise): the bet becomes a check unless the EV comparison against every live opponent range (exact counts; measured fold rate, else the priors 0.60 river and 0.31 turn; ranges independent) says the bet beats the check by 2% of the pot (HorseOmahaMultiwayDiscipline.ts). Owner-ruled check (omahaOopCheckRules, kept outermost by omahaOwnerRuledFinal). The PLO4/PLO5 counterpart of plo6NoMultiwayBetWithWeakMadeHand; PLO6 untouched. Default OFF (read === true) until its declared evaluation passes',
    'V94'
  ),
  flag(
    'omahaVpipFloorByLimp',
    "Owner 2026-11-15 11:35 (hand 59518335, PLO5 cash, a 50% VPIP floor table; a limp and a fold is VPIP, the Horses are not to put in a lot of chips and raise just to meet the floor): the table's VPIP floor multiplies the style tightness and with it every preflop bar, so hands that fold on an unfloored table open-raised, 3-bet and shoved. With this on (PLO4/PLO5 cash, the floor unmet) the decision is also taken without the floor: a raise only the floor makes becomes the limp (or the small blind's completion) unopened, and facing a raise the unfloored call, a call at the call-down's cheap price, or the fold; having limped, the hand folds to a raise unless it clears the ordinary calling bar. A raise the unfloored brain makes is unchanged. The Horse aims three hands of the judged window above the stated floor (60% on a 50% table judged over thirty hands) instead of the standard-error target (70.6%), and under that aim the cheap call or limp is certain. Default off (opt-in) until its declared evaluation passes.",
    'V94'
  ),
  flag(
    'omahaManiacReRaiseWidthMeasured',
    'Full sweep 2026-11-15 (4,573 human PLO4/PLO5 cash hands): against the biggest winner the Horses 4-bet without aces 21 times (-1,441 bb) and called his re-raises; the decisions replay as v53_pressure_four_bet and the maniac price call, priced against a range the read sets at his whole raising width (0.69) for his 3-bet and 0.58 for his 5-bet. With this on (PLO4/PLO5 cash) a measured maniac whose re-raises rest on 12 or more decayed opportunities is read on a re-raising line at his own re-raise rate (never wider than today); the price arithmetic and its margins are unchanged. HorseMind.bandFor. Default off (opt-in) until its declared evaluation passes.',
    'V94'
  ),
  flag(
    'omahaCardImpact',
    'Owner 2026-11-15 11:41: PLO4/PLO5 cash, one board, high only, heads-up, turn and river, nothing to call: the Horse measures what the last card did to its own hand (holdings that beat it before and after, the nuts, nut outs, the freeroll) and to the opponent range his line and measured tendencies describe (the share improved past the Horse, left behind, or missed), prices a check and every bet size against that range and takes the best when it beats the chosen action by more than 4% of the pot (HorseOmahaCardImpact.ts). No veto in either direction; a bluff candidate stays with the bluff paths; a nut-class bet is never made smaller; a decision facing a bet is unchanged. Default OFF (read === true) until its declared evaluation passes',
    'V94'
  ),
  flag(
    'omahaFacingBetEv',
    "Owner 2026-11-15 11:39 (the fold-or-call decision facing a bet must depend on the hand, the player and the pot size to value): in PLO4/PLO5 cash, high only, one board, on the turn and the river, when the Horse faces a bet or a raise and today's brain answers fold or call, one expected-value decision replaces that answer: the exact count of the opponent holdings that beat, tie and lose to the Horse's actual hand (its own cards removed; every river card on the turn), weighted by a value region sized by the bet's share of the pot and the bettor's line and a bluff share moved by his measured tendencies and his shown-down results at that size when stored; the call is made when EV(call) on the actual pot and call exceeds 2 percent of the final pot, with every other player in the hand to beat as well. It replaces, in that spot, the paired-board fold, the big-bet and bluff-catcher cells, the committed-call bar and the river and turn call verdicts; it never raises and never changes a raise (HorseOmahaFacingBetEv.ts). Default OFF (opt-in); league cards plo4/plo5 _omaha_facing_bet_ev",
    'V94'
  ),
  flag(
    'omahaTurnRiverRaiseNeedsNuts',
    'Owner 2026-11-15 12:52 / 12:53 (hand 59534208: top two pair, no redraw, raised a pot bet on the PLO5 turn into the nut straight; "NEVER A RAISE"), with 12:09 (no check-raise without the nuts), 11:39 (hand, player, price and pot dependent) and 12:30 (draws). PLO4/PLO5 cash, high only, one board, no bomb pot, not Lightning: on the turn and the river, facing a bet or a raise, any final raise, re-raise, check-raise or all-in raise stands only when the hand is nut class now (omahaNutClassNow); on the turn an in-position combo-draw raise the 12:30 rule permits stands too. Every other raise becomes a call or a fold: the exact-hand facing-bet EV verdict against the bettor read (population prior unmeasured), else the OOP turn facing-bet verdict, else fold at a price of a third of the pot after the call or more. The outermost conversion on the facing-bet path (HorseOmahaTurnRiverRaiseNeedsNuts.ts). Default OFF (read === true); league cards plo4/plo5 _omaha_turn_river_raise_needs_nuts',
    'V94'
  ),
  flag(
    'omahaStreetPlan',
    'Owner 2026-11-15 11:43 (Horses must plan the next street and protect the stack): PLO4/PLO5 cash, heads-up, one board, high only. A turn bet facing no wager is priced against the check as a whole line: the opponent fold / call / raise shares (range by his line, measured tendencies, a population prior otherwise), every unseen river card exactly and the Horse own planned river action on each; the bet becomes a check when the check line is worth more by 2% of the pot. On the river, facing a bet after that turn bet was called, the plan is recomputed from the public history and the paired-board fold stands aside where the plan calls. No engine random number (HorseOmahaStreetPlan.ts). First layer: the flop and the preflop stack-to-pot check are not built. Default OFF (read === true) until its declared evaluation passes; league cards plo4/plo5 _omaha_street_plan',
    'V94'
  ),
  flag(
    'omahaStreetPlanFlop',
    'Owner 2026-11-15 11:43 (Horses always think about future streets, plan ahead, protect and grow the stack; no blanket rules): PLO4/PLO5 cash, heads-up, one board, high only. A flop bet facing no wager is priced against the check, and against the smaller sizes of the engine menu, as two-street lines: the opponent fold / call / raise (his preflop line, measured tendencies, a population prior otherwise), the turn card by texture class (eight representative cards weighted by their exact share, each good / neutral / bad by the equity change), the planned turn action per class by the turn layer line model and eight sampled rivers under each. A line that commits the stack (stack-to-pot after the call at or under 1.5) with a hand that folds to the expected raise or continues on under 65% of turn cards is not made; otherwise the bet stands only when it beats the check line by 2% of the pot, and a smaller size replaces the engine size only when it beats it by the same margin. Only a bet becomes a check or a smaller bet. The owner flop checks stay final. No engine random number (HorseOmahaStreetPlan.ts). Default OFF (read === true); constants unmeasured, evaluation NOT RUN; league cards plo4/plo5 _omaha_street_plan_flop',
    'V94'
  ),
  flag(
    'omahaStreetPlanThreeWay',
    'Owner 2026-11-15 11:43: the turn street plan for exactly two live opponents (PLO4/PLO5 cash, one board, high only). Each opponent has his own independent range and measured tendency; a turn bet facing no wager wins at once only when both fold, otherwise it must beat every caller at showdown on every river card (no river betting modelled three-way). The bet becomes a check when the check line is worth more by 2% of the pot. No engine random number (HorseOmahaStreetPlan.ts). Default OFF (read === true); constants unmeasured, evaluation NOT RUN; league cards plo4/plo5 _omaha_street_plan_three_way',
    'V94'
  ),
  flag(
    'omahaPreflopStackPlan',
    'Owner 2026-11-15 11:43 (protect the stack; hand, player, price and pot dependent): PLO4/PLO5, preflop, a call of a raise heads-up against the raiser that creates a stack-to-pot ratio under 3 is priced as the stack it commits: (equity against the raiser band - charge) x final pot - chips put in, against 0 for the fold; the charge is the engine realisation margin by position scaled by the ratio (halved for a nut-making hand: coordinated or a suited ace) plus 0.06 for a hand that makes mostly one pair. A negative value folds the call; only a call becomes a fold, never a wider range. Runs before the day 3-bet / 4-bet options, which keep precedence (HorseOmahaStreetPlan.ts). Default OFF (read === true); constants unmeasured, evaluation NOT RUN; league cards plo4/plo5 _omaha_preflop_stack_plan',
    'V94'
  ),
  flag(
    'omahaBigDrawAggression',
    'Owner 2026-11-15 11:55 (play the combo draws and nut draws hard and fast; too many conservative plays with huge-equity draws): on a PLO4/PLO5 cash flop or turn a check or a call with a declared big draw (nut flush draw with a wrap, a straight draw or a pair; a 13+ out wrap with nine nut outs; a pair or a flush draw with nine nut straight outs; never a paired board, a made hand, a bare or non-nut draw) becomes a pot-sized bet or raise, or the stack when a later street puts it in anyway, only when its expected value is the higher one: fold equity from each opponent measured fold to a bet (population prior without a read), equity against the range that continues; passive against three or more opponents and against two without the nut end (HorseOmahaBigDrawAggression.ts). Default OFF (opt-in); league cards plo4/plo5 _omaha_big_draw_aggression',
    'V94'
  ),
  flag(
    'omahaNoDrawRaiseOutOfPosition',
    'Owner 2026-11-15 12:30 ("RAISING WITH DRAWS SHOULD NEVER HAPPEN OUT OF POSITION. ONLY IN POSITION WHEN ITS COMBO DRAWS, NOT NAKED NUT FLUSH DRAWS."): on a PLO4/PLO5 cash flop or turn the existing raises with a draw (below two pair, with a flush draw or 8+ straight outs: the baseline semi-bluff raise, the pressure semi-bluff raise, the combo draw pump, and any other raise reaching the final answer) are not made out of position, nor in position with a bare flush draw; the three sites fall through to the call-or-fold verdict, any other raise becomes a call; two pair or better is untouched (HorseOmahaBigDrawAggression.omahaDrawRaiseBar). Default OFF (opt-in); league cards plo4/plo5 _omaha_no_draw_raise_out_of_position',
    'V94'
  ),
  flag(
    'omahaStrategyInTournaments',
    'Owner 2026-11-15 13:16 Chicago ("ALL THE RULES AND THINGS WE ADJUSTED TODAY, ALL NEED TO BE SHARED WITH PLO6 AND IMPLEMENTED FOR TOURNAMENTS AS WELL"): the PLO4/PLO5 options of 2026-11-15 scoped to cash also run in a PLO4/PLO5 tournament hand (high only, one board, not All-In-Or-Fold, not Lightning, the Horse deeper than the 14 big blind Omaha push/fold line; HorseOmahaTournamentScope.ts). Each option still needs its own switch. Fold and check conversions apply as in cash; a conversion that adds chips adds the engine tournament survival premium (icmRisk x sqrt(stack share)) to the price it uses. The street plan river follow, omahaStrongHandValue and omahaVpipFloorByLimp stay cash-only; the blind-steal family and omahaReraisedFoldVsTight are not widened. Default OFF (read === true).',
    'V94'
  ),
  flag(
    'omahaStrongHandSlowplayMix',
    'Owner 2026-11-15 14:13 ("ITS OK FOR HORSES TO JUST CALL WITH THE NUTS, OR JUST CALL WITH TOP FULL HOUSE. THEY SHOULDN\'T ALWAYS RAISE 100% OF THE TIME, AND THEY SHOULD CHECK SOMETIMES WITH A SET ON SUPER DRY BOARDS"): PLO4/PLO5 cash, pot limit, high only, one board (HorseOmahaStrongHandSlowplayMix.ts). Facing a bet on the flop, the turn or the river with a nut-class hand and one or two opponents, the final raise becomes a call at a mixed frequency: higher when few next cards take the nuts away, against a measured aggressive bettor, in position and with stacks behind; lower against a measured station, on the river (priced on the share of his range that calls a raise and loses) and nearly zero when the hand is vulnerable. Nothing to call on a very dry flop (three suits, three ranks, every two at least five apart) with a set and one or two opponents, the final bet becomes a check at a mixed frequency: higher when few turn cards hurt and an opponent is measured to bet when checked to, lower against a passive player or station or with the pot large beside the stacks, in position only when few turn cards hurt. It only turns a raise into a call and a bet into a check, never a fold, never an owner-ruled check; one draw per decision from a stream derived from the strategy stream without advancing it; it stands aside when omahaNutClassValueSize is on. Every constant is a builder\'s choice, none measured. Default OFF (opt-in): only an explicit true switches it on',
    'V94'
  ),
  flag(
    'omahaTurnRiverRaiseIsPriced',
    'Owner 2026-11-17 11:49 ("there should not be any blanket rules ... they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."). PLO4/PLO5 cash, high only, one board, no bomb pot, not Lightning; default off (read === true). On the turn and the river facing a wager the final answer is a priced comparison of the fold, the call and a raise to each legal size on the exact hand (HorseOmahaPricedRules.omahaPricedRaise: the exact count of the opponent holdings with the Horse own cards removed; his bluffs fold to the raise first, the strongest part of his value region continues, sized by the price the raise lays him, his measured fold to a bet beside the population and, where the street read has it, his measured fold to a raise). A raise is made when it is worth more than the best other action by the margin, with any hand; a raise that is not becomes the priced call or fold. With it on, omahaTurnRiverRaiseNeedsNuts and omahaRiverNutRaiseOnly do not decide in this scope. A nut-class hand keeps the raise or call it was given.',
    'V94'
  ),
  flag(
    'omahaDrawRaiseIsPriced',
    'Owner 2026-11-17 11:49 ("there should not be any blanket rules ... they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."). PLO4/PLO5 cash, high only, one board, no bomb pot, not Lightning; default off (read === true). A flop or turn raise facing a wager with a draw the 12:30 bar names is priced beside the call on the seeded sample shares of HorseOmahaBigDrawAggression and each opponent measured fold rate (HorseOmahaPricedRules.omahaPricedSampledRaise), realized less out of position; it stands when worth more than the call by the margin, else it is the call. The big-draw wager is priced out of position and without the combo-draw class too. With it on, omahaNoDrawRaiseOutOfPosition does not decide in this scope.',
    'V94'
  ),
  flag(
    'omahaOopTurnBarrelIsPriced',
    'Owner 2026-11-17 11:49 ("there should not be any blanket rules ... they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."). PLO4/PLO5 cash, high only, one board, no bomb pot, not Lightning; default off (read === true). The turn bet out of position after the flop bet was called is priced beside the check against every opponent (HorseOmahaPricedRules.omahaPricedBet, the card-impact response model with the priced read) and stands when worth at least the check; the turn bet then faced is the facing-bet EV verdict own. With it on, omahaOopTurnCheckAfterFlopCall does not decide in this scope.',
    'V94'
  ),
  flag(
    'omahaPairedBoardBetIsPriced',
    'Owner 2026-11-17 11:49 ("there should not be any blanket rules ... they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."). PLO4/PLO5 cash, high only, one board, no bomb pot, not Lightning; default off (read === true). A bet on a paired turn or river below a full house is priced beside the check against every opponent whatever his label, and the river nut-blocker bluff is admitted on a paired board when a bet is priced above the check. With it on, omahaPairedRiverNoThinLeadVsValueLeader, omahaOverpairNoOopBarrelVsValueLeader, omahaPairedTurnNoBarrelWithoutBoatVsValueLeader, the card-impact press veto, the paired-board river check and the blocker bluff paired-board bar do not decide in this scope.',
    'V94'
  ),
  flag(
    'omahaBluffShareFromBetRate',
    'Owner 2026-11-17 11:49 ("there should not be any blanket rules ... they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."). PLO4/PLO5 cash, high only, one board, no bomb pot, not Lightning; default off (read === true). In the facing-bet expected value the bettor bluff share is the population prior moved continuously by his posterior-mean bet rate beside the population (HorseOmahaPricedMode.omahaPricedBluffFactor), with no sample threshold; the value-leader cap of 0.65 and the maniac floor of 1.3 do not act.',
    'V94'
  ),
  flag(
    'omahaFacingBetRangeIsContinuous',
    'Owner 2026-11-17 11:49 ("there should not be any blanket rules ... they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."). PLO4/PLO5 cash, high only, one board, no bomb pot, not Lightning; default off (read === true). The facing-bet range model reads the bet share of the pot as a continuous input (HorseOmahaPricedMode): the value-share and bluff-prior size tables are interpolated between the centres of their rows, the line overrides of #11135 and #11183 (paired-river lead into the turn aggressor, river bet into two or more players on a paired board, earlier-raised multi-street barrel, a wager capped by the stack) are weighted moves, and the two turn realization caps and the small-bet margin cap are continuous in the size. No size line switches a cell on.',
    'V94'
  ),
  flag(
    'omahaPressureIsPriced',
    'Owner 2026-11-17 11:49 ("there should not be any blanket rules ... they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."). PLO4/PLO5 cash, high only, one board, no bomb pot, not Lightning; default off (read === true). The pressure raise and the wide call-down that omahaPressureNeedsPostflopAggression withholds by the bettor label are withheld or made by their price against him: the raise when it is priced above the call (flop and turn on sampled shares and his measured fold rate, turn and river on the exact count), the call-down when the call is priced above the fold.',
    'V94'
  ),
  flag(
    'omahaBigBetCallsArePriced',
    'Owner 2026-11-17 11:49 ("there should not be any blanket rules ... they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."). PLO4/PLO5 cash, high only, one board, no bomb pot, not Lightning; default off (read === true). A turn or river call or raise that the V81, V84, bluff-catcher and V86 cells judge by the bet share of the pot, the stack in big blinds and the hand class is judged by the exact count instead (a capped-wager or all-in-or-fold table is priced on its chips): the call stands when its expected value exceeds the margin and is folded when it does not; a raise is priced beside the call and the fold. With it on those cells do not decide in this scope.',
    'V94'
  ),
  flag(
    'omahaUnderpairMultiwayIsPriced',
    'Owner 2026-11-17 11:49 ("there should not be any blanket rules ... they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."). PLO4/PLO5 cash, high only, one board, no bomb pot, not Lightning; default off (read === true). The flop call with an underpair or bottom pair facing a bet and a call that omahaUnderpairNoMultiwayFlopContinue folds by hand class is priced on the sampled share against the bettor and against the caller, realized less out of position: the fold stands only when the call is priced below it.',
    'V94'
  ),
  flag(
    'omahaPricedMix',
    'Owner 2026-11-17 11:49 ("there should not be any blanket rules ... they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."). PLO4/PLO5 cash, high only, one board, no bomb pot, not Lightning; default off (read === true). Frequency mixing inside a priced rule that is on: when the two best actions of the comparison are closer than its own uncertainty (the standard error of the sampled share, plus the spread of the opponent read by its opportunity count) the lower one is taken with probability 0.5 x (1 - gap / uncertainty). The draw is the decision derived stream (read, never advanced) hashed with public state only: the street, the board, the pot, the wager, the seat and the public action count; the Horse hole cards are not read.',
    'V94'
  ),
  flag(
    'horsePlayStyles',
    "Owner 2026-11-15 16:40 and 16:42 (three winning Horse styles for PLO and Hold'em, one tight, one exactly as they are now, one other, each Horse assigned one at random after it has been created; tight Horses do not play 50% VPIP games tight): every Horse has one playing style for life, tight, current or pressure, a third of the fleet each by a hash of its id with its own salt (HorsePlayStyle.horsePlayStyleFor; an authored persona.playStyle wins; no storage, no production write). Omaha mapping (HorseOmahaPlayStyle, PLO4/PLO5 cash, high only, three seats or more): tight (tight-aggressive) multiplies the preflop entry bars (first in, limp, cold call, call of a re-raise) by 1.15 and the bluff volume by 0.80, leaves the value 3-bet and 4-bet bars and every size as they are, and reads the TAG Crusher gears (its own if it is a Nit Hunter) with the higher of its own and that band's elite re-raise mix; pressure, on the cutoff and button before the flop and when last to act after it, multiplies the preflop open and limp bars by 0.75, the value re-raise bars by 0.75, the bluff volume by 1.20 (1.25 after the flop), the aggression by 1.10 (1.20 after the flop) and the continuation-bet frequency by 1.25, takes the top of the EV engine's aggression tie-break range (+0.12 BB) and reads the LAG Shark gears, and (2026-11-16) biases the EV engine's own in-position inputs: each opponent's fold-equity prior x1.25 on the bet candidates (the check priced as today), the indifference band x2 (0.24 BB) for a candidate more aggressive than the best, and before the flop keeps the call bars at today's width (cold call, call of a re-raise, call-off) while the raise bars (first-in open, isolation, value 3-bet) take a credit of 0.04 (the bound) and the value re-raise tightness x0.75 (the bound), so its added entries are re-raises, and out of position is the current style exactly; current changes nothing. Every scale lies in 0.75 to 1.25 and acts before the owner-ruled chain, which stays final for every style. Every style plays current in tournaments, in Lightning, at 50 bb effective or less and in games with no mapping (Hold'em until its lane maps it, hi-lo, PLO6, bomb pots, All-In-Or-Fold, heads-up); tight also plays current at a table whose VPIP floor is above its expected VPIP. horsePlayStyleForce is the league and test lever that names a seat's style; it is not a switchable option. Default OFF, opt-in.",
    'V94'
  ),
  flag(
    'horsePlayStyleForce',
    "league and test lever of horsePlayStyles (owner 2026-11-15 16:40 / 16:42): the playing style ('tight', 'current' or 'pressure') this decision's Horse plays instead of the one its id deals, so a league card can seat a named style (league seat ids are league-N); read only when horsePlayStyles is on, and the table rule still applies; a parameter, not an on/off option, so the live switch refuses it; inert unless set",
    'V94'
  ),
  flag(
    'omahaStrongHandValue',
    "Owner 2026-11-15 12:16 (the earlier all-hands playbook's PLO4/PLO5 cash entries): on the river, one board, high only, with a full house or better or a nut-class hand, three decisions are expected-value comparisons (HorseOmahaStrongHandValue.ts). Nothing to call and today's answer a check: the check and every bet size are priced against each opponent left with HorseOmahaCardImpact's pricing (combined across opponents, the field defending the minimum-defence share together); the value bet of highest expected value is made when it is worth at least the check; with a player still to act the check is kept only when it is worth more than every value bet (the induce) or when no size is a value bet. Facing one bettor with nobody else in the hand and today's answer a call, with a nut-class hand only (owner rulings 2026-11-14 hand 59401453 and 2026-11-15 12:52 hand 59534208: no raise without the nuts): EV(raise to each legal size) on the exact count of the holdings that continue against the raise, beside HorseOmahaFacingBetEv's EV(call); the raise is made at the size of highest EV when it is worth more than the call by 4 percent of the pot; a full house a bigger one beats keeps today's call or fold. In its spots it decides over the half-pot checked-to full-house bet; a hand below a full house that is not nut class is never touched. Default OFF (opt-in); league cards plo4/plo5 _omaha_strong_hand_value",
    'V94'
  ),
  flag(
    'omahaNutClassValueSize',
    'Dan 2026-11-14: a PLO4/PLO5 high bet or raise with the nuts or an effective-nut hand for the street is the full pot (the pot-limit maximum, the stack when smaller) on the flop, turn and river. Default OFF (opt-in): its declared evaluation failed on the Horse-only cells (PLO4 -1.19, PLO5 -1.31 bb/100; human field +2.29)',
    'V94'
  ),
  flag(
    'omahaRiverNutBlockerBluffReachable',
    'PLO Strategy 2026-11-15: the Omaha nut-blocker river bluff (receipt v86_river_nut_blocker_bluff) is on but has never fired in production, because its made-hand gate is no pair at all (cat <= 1) and the baseline river bluff answers every no-pair heads-up river first. On, the gate is one pair or less, the bottom-pair band its own comment names (one pair, 0.25 to 0.28 equity, nut blocker, heads-up, unpaired board, capped opponent, never a station). Opt-in, default off, read === true; its declared evaluation has not been run.',
    'V94'
  ),
  flag(
    'omahaOnePairDiscipline',
    'Dan 2026-11-14 (hands 59407629, 59430325, 59431232, 59417700, 59426444): PLO4/PLO5 high on one board, no bomb pot: one pair or less never bets or raises the river for value (a river bluff the reference brain declared keeps its wager); a river call of a 0.66-pot+ wager with two pair or less on a straight- or flush-possible board folds unless the bettor is a measured postflop over-bluffer; on the flop and turn one pair with fewer than four nut-class outs does not raise (call when the call is small, fold when it costs more than half the effective stack) and does not call a wager costing more than half the effective stack (HorseOmahaOnePair.ts). Default OFF (opt-in): its declared evaluation failed (Horse-only PLO4 -0.77 bb/100, z -2.30)',
    'V94'
  ),
  flag(
    'holdemHeadsUpPostflopBalance',
    "HV31 FLOP-5 D1 (2026-11-15): no-limit hold'em cash, heads-up single-raised pot, hero in position, effective stack 20 bb or more: the flop c-bet after a check is one 0.75-pot size at a frequency by hand tier; a flop fold to a check-raise after the c-bet with a middle pair or better or a flush or open-ended straight draw becomes a call; a turn checked to hero bets one 0.70-pot size at a frequency by tier; the river is not covered (its full-pot part was removed 2026-11-16 after the solver score: 11 of 41 river games of the FLOP-5 D1 bank got worse by more than 5 points of the pot) (HorseHeadsUpPostflopBalance.ts; solver evidence FLOP-3 B9/B6, FLOP-4 C1, FLOP-5 D1). Default OFF (opt-in): only an explicit true switches it on. League card nlh_hu_postflop_balance",
    'V94'
  ),
  flag(
    'plo6ManiacPriceRefusalToRangePlay',
    '2026-11-14 PLO6 cash preflop: when the raiser faced is an observed maniac and not all in and the call is under 40% of the stack, a refusal by the price arithmetic is decided by the range play, the play made against every other opponent, instead of an outright fold (PLO6-AUDIT-013, production hand 58751512; evidence docs/horse-default-on.d/plo6ManiacPriceRefusalToRangePlay.md). Default OFF (opt-in) since 2026-11-16: its reach row was not met by the deadline Hand Analysis set',
    'V92'
  ),
  flag(
    'plo6TopSetNutRealization',
    'opt-in arm, default off (2026-11-14): PLO6 cash, one board, no bomb pot, flop or turn: in the solverless call menu a top set that is the current nuts (board unpaired, no three of a suit, no three ranks in any five-rank window) is priced at full realization instead of the 0.75 out-of-position non-draw discount (PLO6-AUDIT P6-4: five reconstructed top-set folds at a one-third price multiway). Five cases in two days, Horse-only, reconstructed replay, so production never sets it',
    'V93'
  ),
  flag(
    'plo6NoMultiwayBetWithWeakMadeHand',
    'opt-in, default off (PLO6 lane 2026-11-15, SWEEP-PLO6 family D2): PLO6 high, one board, no bomb pot, not all-in-or-fold, cash and tournaments, flop or turn, nothing to call, two or more live opponents: a bet with a weak made hand (one pair below the top card of the board, two pair without the top card, the board pair with such a pair, or an overpair: a pocket pair above the top card of an unpaired board) that holds no nut flush draw, under eight straight outs, under four nut-straight outs and no flush draw with four or more straight outs and is not nut class becomes a check (HorsePlo6MultiwayWeakBet.ts). No opponent read. Development evidence: 90 such bets in 85 hands, hand net -2,715.1 bb (of them the overpair 28 bets, -1,008.2 bb), in 912 human-seated PLO6 cash hands over five days, mostly one opponent; unevaluated (docs/horse-option-authority.d/plo6NoMultiwayBetWithWeakMadeHand.md). Default OFF (read === true) until its declared evaluation passes',
    'V94'
  ),
  flag(
    'omahaStrategyInPlo6',
    'opt-in, default off (PLO6 lane 2026-11-16; owner 2026-11-15 13:16, the PLO strategy work shared with PLO6): the game gate of the 2026-11-15 Omaha strategy options. On, each PLO4/PLO5 strategy option that is itself on also acts in PLO6 (omahaStrategyGameInScope, HorseOmahaStrategyGame.ts), with the six-card constants of HorsePlo6StrategyCalibration.ts registered for that decision only (turnRedrawNutFullHouseOnly 1, cardImpactDistinctDrawOuts 1, bigDrawContinueStraightOuts 13). It switches no option on. Unset or false, PLO6 is outside every one of those scopes and reads no six-card constant, as before. Default OFF (read === true) and OFF-ONLY in the live switch: the six-card port is not complete (no six-card coordination row, the re-raised premium too wide, literal four/five hole-count checks, PLO6 adaptations not hooked, four skipped options not excluded, no receipt admission; docs/horse-option-authority.d/omahaStrategyInPlo6.md)',
    'V94'
  ),
  flag(
    'fixedLimitRiverFullBetRead',
    "opt-in arm, default off (2026-11-14): fixed limit, river, facing a wager: the wagerer is read as having made a full bet (a raise as a raise) instead of a small no-limit bet, in the range samplers only (HorseFixedLimitWagerRead.ts; SPEC-FL-01). Hold'em contact sampler at its ceiling; Omaha high and hi-lo on a no-low board step the aggressor tier and draw the made-hand stratum exactly; hi-lo heads-up keeps the low half under the weak-high cap. Fixtures and a mechanism only, so production never sets it",
    'V94'
  ),
  flag(
    'fixedLimitHiLoNutLowRiverBet',
    'opt-in arm, default off (2026-11-14): fixed-limit hi-lo cash, heads-up, river unbet or checked to hero: the nut low with no high (the river-bluff freeroll) bets every time instead of 55 percent, except into a station with the bare nut low (SPEC-FL-02). Fixtures and a mechanism only, so production never sets it',
    'V94'
  ),
  flag(
    'fixedLimitRiverOneBetValueRaise',
    "opt-in arm, default off (2026-11-14): fixed-limit hold'em, river, facing exactly one wager on an uncapped street: the value raise uses the one-bet break-even (0.60 plus the multiway and domination terms), no stack-to-pot adjustment and no raise-frequency draw (SPEC-FL-03). Fixtures and a mechanism only, so production never sets it",
    'V94'
  ),
  flag(
    'omahaPreflopCallWithActionBehind',
    'opt-in arm, default off (2026-11-13): Omaha preflop, a call costing 40% of the stack that leaves chips behind while an opponent still owes a decision is sent to the range play, not the final all-in arithmetic (PLO6-AUDIT-005, production hand 58751512). The pricing gap is real but the value check does not support the rule as built: the folded hands hold 40% to 55% equity at a price near 38%, the rule was merged without a value check and nothing measured since supplies one, so production never sets it',
    'V90'
  ),
  flag(
    'vpipFloorDeepStackOff',
    'opt-in arm, default off (2026-11-12): Omaha preflop, over 120bb, facing a re-raise at a stack-off node with a call available for 30% of the stack or less and no observed wide re-raiser: the jam bar is read without the VPIP floor multiplier. The mechanism is demonstrated (PLO6-AUDIT-004, production hand 58751512: the 50% floor cut a 390bb seat jam bar from 0.93 to 0.40) but the expected-value check does not show the call beating the shove outside an aces-heavy four-bet range, so production never sets it',
    'V91'
  ),
  flag(
    'v67RiverRaiseShadeOverride',
    'league calibration arm (2026-10-31): overrides the V67 extra river raise shade for a league card; inert unless set; production never sets it',
    'V67-league'
  ),
  flag(
    'v64RiverRaiseNeedsTwoPair',
    '2026-10-31 Hold em river raise discipline: facing a river wager on one board, one pair, high card and board-paired two pair never value-raise or bluff-raise (a measured over-folder read keeps the blocker bluff-raise); they fall through to the V38 call verdict with the V61 shade. Live review: one-pair raises won 34% (-4,184bb cash), air raises 7% (-1,696bb cash), two pair+ raises about +16,000bb; explicit off arm retained',
    'V64'
  ),
  flag(
    'v63LargeRiverBetShade',
    '2026-10-31 the V61 one-pair river shade steepens past a half-pot wager and caps at 20 points from a pot-sized wager (0.7-pot: 12, V61 8); measured over the latest 19,933 NLH review hands large-wager one-pair calls won 13.3% (119/897) against a 41%+ price and medium 20.7% against 29-41%; league cards positive at 100-200bb, noise at 25-40bb; explicit off arm retained',
    'V63'
  ),
  flag(
    'v63RiverShadeShapeOverride',
    'league calibration arm (2026-10-31): overrides the V63 shade shape (slope, cap, knee) for a league card; inert unless set; production never sets it',
    'V63-league'
  ),
  flag(
    'v74OmahaSemiBluffNeedsDraw',
    '2026-10-31 an Omaha semi-bluff raise needs a flush draw, eight or more straight outs or (hi-lo) a nut low draw; omahaDrawMod had returned 0.7 for no draw at all, so top pair with nothing to come re-raised bets under V53 pressure (reviews 2944297, 2838834; plo_toppair_no_redraw_stackoff -62.13 bb per hand over 234 hands); default on, explicit off arm retained for the league',
    'V74'
  ),
  flag(
    'v62RiverBettorPolarity',
    "2026-10-30 Hold'em river bettor polarity: a river wager's sampled hand is drawn from a bluff / two pair+ / top pair / weaker pair stratum by bet size; OPT-IN since 18:50 UTC after the mirror league resolved it negative against horses (-3.67 +/- 1.02 bb/100 at 200bb) while V61 alone resolved +1.30 +/- 0.41; re-enable only after a recalibrated stratum resolves positive",
    'V62'
  ),
  flag(
    'tournamentFlatBump',
    'league calibration arm (2026-10-30): tournament call bar facing a single open raised by 0 < x <= 0.2; inert unless set; +0.06 measured -1.11 +/- 0.51 bb/100 at 100bb and +0.41 +/- 0.31 at 40bb in the MTT mirror',
    'V62-league'
  ),
  flag(
    'v60CashPressure',
    'Dan 2026-10-24 NLH cash pressure: blinds and late position value 3-bet a single open from their measured hand shares, re-steal volume matches the tournament layer, and the opener defends a 3-bet from the top 10% in position and top 8% out of it up to 100bb; explicit off arm retained for the neutrality corpus',
    'V60'
  ),
  flag(
    'v65TurnOnePairShade',
    '2026-10-31 Hold em one-pair (or board-paired two pair) TURN calls of a wager hero did not initiate are shaded by the price, zero at a quarter-pot wager and 12 points from a pot-sized one, off the equity handed to the call test; draws, the raised-after-own-bet branch and a measured over-bluffer read are untouched; measured 7-day review hands: cash n=1,727 won 33% (about -308,000bb/week), tournament n=1,542 won 37% (about -185,000bb/week); explicit off arm retained',
    'V65'
  ),
  flag(
    'v65TurnShadeCapOverride',
    'League-only cap override for the V65 turn shade (0.12 shipped; 0.08 fallback cut); production never sets it',
    'V65-league'
  ),
  flag(
    'v68TurnAirDrawCalls',
    '2026-10-31 Hold em high-card TURN calls of a wager hero did not initiate: the implied-odds bonus is withheld facing 0.7 pot or more when the effective stack behind after the call is under 1.5x the pot after it, and high card with no real draw that V65 left unshaded (a gutshot or board-only shape) carries the V65 price shade unless the bettor reads as a measured over-bluffer; real draws keep their equity; measured 7-day review hands: cash n=494 won 29.6% (about -62,000bb/week), tournament n=383 won 36.8% (about -25,000bb/week); explicit off arm retained',
    'V68'
  ),
  flag(
    'v68AirShadeScaleOverride',
    'League-only scale on the V68 air shade (1 shipped; 0.5 half-strength fallback); production never sets it',
    'V68-league'
  ),
  flag(
    'v69TurnCallGaps',
    '2026-10-31 Hold em single-board TURN call gaps left by V65/V68: one-pair calls lose the implied-odds bonus facing 0.7 pot or more with under 1.5x the pot behind after the call, the V65 draw exemption counts only a draw a hole card is part of, and the opt-in V32 draw pass-through falls through to the normal line when there is no room to be paid; explicit off arm retained',
    'V69'
  ),
  flag(
    'v70GtoOpeningRanges',
    "2026-10-31 Hold'em raise-first-in (unopened, unlimped, two or more dealt in): the hand is read on its seat's own GTO reference order by dealt-in players behind (SB 1 .. 9-handed UTG 8) mapped onto the preflop score scale by combo share, against per-seat target widths (cash LJ 16, HJ 20.5, CO 26.5, BTN 43, SB 41 raise plus a limp band to 58; full-ring UTG 11/UTG+1 12.5/UTG+2 14; big blind ante LJ 23, HJ 26, CO 34, BTN 51, SB 48, UTG 17.5 before the ICM premium; three-handed BTN 47/54 and SB 44/50, heads-up SB 72/76 raise plus a limp band to 90/94); at four or more dealt the push/fold and orange/red M-zone jam-or-fold structure (<= 22bb) is untouched, while two- and three-handed jam-or-fold applies only at <= 15bb (the table-size-scaled M had put every heads-up and spin stack under 22bb into it); the SB opens ~3x without an ante deeper than 25bb; an ante-free tournament under 50bb keeps the old depth tighten; style tightness, ICM premium, bubble and maniac bars unchanged; explicit off arm retained",
    'V70'
  ),
  flag(
    'v71AnteAwarePushFold',
    "2026-10-31 Hold'em folded-to jam at <= 15bb in a tournament (or an ante cash table) with dead ante in the pot: the jam-or-fold answer reads the chip-EV Nash table (HorseNashPushFold.data.ts, first caller only, exact hero/caller card removal) by dealt-in players behind (1 = SB vs BB .. 8 = nine-handed UTG) and dead ante (0/1/2bb solutions, interpolated), at the effective depth (hero capped by the deepest live stack behind), whether or not memory_charts_gold hydrated; the charts were the no-ante game for five positions (Tournament cells equal to Cash) and the offline fallback jammed on the strength ladder; 9-handed 15bb with a big-blind ante jams UTG 8.6 / LJ 16.3 / HJ 22.8 / CO 28.8 / BTN 35.7 / SB 63.8; a pot without dead ante (charts and fallback), the 16-22bb orange-zone shove and BB defence are unchanged; explicit off arm retained",
    'V71'
  ),
  flag(
    'v72DefenceByOpener',
    "2026-10-31 Hold'em facing one open with nobody in (three or more dealt in, open up to 6bb): the call / 3-bet base is set per defender (big blind, small blind, in-position seat) and opener seat by dealt-in players behind (V70 index SB 1 .. 9-handed UTG 8) instead of five position buckets; continue range read on a reference order blended between late- and early-open charts and mapped onto the preflop score scale, value 3-bets on the legacy ladder, bluff 3-bets from a reference chart scaled to half the solver's bluff width (V72_BLUFF_TRIM, measured against the human-calibrated field); widths by opener seat (cash big blind vs BTN 60 / CO 49 / HJ 42 / LJ 36 / 9-handed UTG 29, 3-bets 13 / 10.5 / 8.5 / 7 / 5.5; big blind ante vs BTN 72 .. UTG 44) scaled gently by the open size against 2.5x (2.2x with an ante); style, ICM premium, depth, exploit reads, V53 and V57/V60 flat and re-steal volume move it as before, the V60 and non-steal V57 per-bucket 3-bet bars are superseded (V57's tournament re-steal bar against a late or small-blind open stays a floor); explicit off arm retained",
    'V72'
  ),
  flag(
    'v73Vs3BetDefence',
    "2026-11-01 Hold'em opener facing one 3-bet with nobody else in (hero made the only open, exactly one re-raise, nobody calling, three or more dealt in, 25bb+ effective against the 3-bettor, 3-bet 1.8x-7x the open, not all-in): the call-or-4-bet width is a share of the opener seat's own V70 open width (style tightness applied to the open, not to the share), the share derived from the price - the minimum defence frequency P/(P+R) of this 3-bet's new chips R into the pot P (open, blinds, ante) - times a per-seat equity multiplier for range strength and realisation (in position BTN 1.50 / CO 1.62 / HJ 1.75 / LJ 1.88 .. UTG 2.01; out of position SB 1.32 / CO 1.44 / HJ 1.52 / LJ 1.61 .. UTG 1.72), off the reference geometry by the MDF ratio with elasticity 0.5 (ratio held 0.7-1.4), widened up to 15% at 25bb and narrowed up to 5% by the V21 deep scale past 120bb; hands read on a continue order blended between a late-opener and an early-opener reference chart of pairs, suited hands and AKo/AQo (every other offsuit unpaired hand folds to a big 3-bet by the 2026-10-25 owner rule); no bet size changes; the ICM premium applies, the general price relief does not; value 4-bets, the 4-bet bluff, rule 4, the 5-bet branch, the deep 5-bet rule and the dominated-offsuit fold unchanged; measured on production (3 hours to 2026-11-01 03:00 UTC, 25bb+) the button folded 85-87%, the cutoff 75-76%, under the gun 43-60%; explicit off arm retained",
    'V73'
  ),
  flag(
    'v75SqueezeDefence',
    "2026-11-01 Hold'em opener whose called open was squeezed (hero made the only open, one or more callers of the open, exactly one re-raise, nobody calling the re-raise, same variant / depth / sizing bounds as V73): the V73 call-or-4-bet width answers the node with two squeeze-specific inputs - every caller's chips are dead money inside the pot the MDF prices (a wider width through the same P/(P+R) arithmetic, nothing duplicated), and each live caller still to act behind hero multiplies the continue share by the 0.8 realisation factor (capped at two callers): the caller's live range overlaps the middle of hero's continue region and can re-raise after hero's call, so MDF's call-closes-the-action premise does not hold; hands on the same per-seat continue order, no bet size changes; the V18 anti-squeeze exploit read, value 4-bets, rule 4, the 5-bet branch and the dominated-offsuit fold unchanged; the pure one-3-bet node keeps the v73_vs3bet_defence receipt, the squeeze node fires v75_squeeze_defence; explicit off arm routes the squeeze node to the pre-V75 fixed bar",
    'V75'
  ),
  flag(
    'v79TopPairWeakKicker',
    "2026-11-02 (Burls via Dan: horses \"stack off with top pair, no weak kickers\") hold'em top pair whose other hole card is a 9 or lower not pairing the board is capped at 0.25 equity (below every admitted price, so a fold) ONLY in cells where the decision EV of the horses' own calls (net + chips already in, bb; chops at their fractional return; later streets included; hand_history + ca_hand_facts 2026-10-28..11-03, CIs clustered by hand) is below zero: wager >= 0.9 pot (-28.30bb [-30.61, -25.98], n 2,005) and 0.6-0.9 pot on an ace-high board outside tournaments heads-up (-7.30bb [-9.69, -4.90], n 774); never multiway in the 0.6-0.9 cell (n 48 straddles), at a heads-up table (n 13 straddles), in a bounty/PKO/mystery-bounty event (chip EV omits the bounty), at 60bb effective or less, on a J-high-or-lower board, under 0.6 pot, on K/Q-high boards at 0.6-0.9 pot (straddles) or in tournaments at 0.6-0.9 pot (straddles); a measured over-bluffer keeps today; limits: only the horses' calls are observed, ICM not modelled, the price ignores players to act behind; a T+ kicker loses as much in the same cells (out of scope); explicit off arm keeps today",
    'V79'
  ),
  flag(
    'v81OmahaBigBetCalls',
    "2026-11-02 (Phase 4, Omaha leak program) PLO4/PLO5 turn/river CALLS of a wager the horse did not start fold only in measured cells (HorseOmahaBigBetCalls.v81Cell; hand classified at the decision with omahaNutStatus; the wager measured exactly as the evidence was by v81StreetWager: chips the last bettor added over the pot just before it, >= 0.9): river straight on a flush board, non-nut straight, paired-board straight, 3rd-nut-or-worse flush, nut or 2nd-nut flush on a paired board, 2nd-nut flush (PLO5 only), two pair; turn paired-board straight and cash 3rd-nut-or-worse flush. Decision EV of the horses' own calls (net + chips already in, bb; chops fractional; later streets included; old engine eed06fe5, 47,806 calls over two days, CIs clustered by hand) below zero on BOTH days in every admitted cell, and no variant or format slice with n >= 10 above zero on either day (e.g. river non-nut straight -48.9 and -36.8bb, river two pair -44.2 and -40.6bb); outputs in docs/horse-measure/2026-11-02/v81-omaha-call-cells.txt; not admitted: turn flush-board or non-nut straights, turn two pair, 0.5-0.9 pot, sets, full houses, nut straights, unpaired nut flushes, one pair; excluded: heads-up tables, bounty events, 20bb or less, chips already in this street, hi-lo, multi-board, bomb pots, a bettor measured as a postflop over-bluffer, unreconcilable street history; complements the live paired-board fold (committing calls); runs in wager_rules after the paired-board fold; limits: only the horses' calls are observed, ICM not modelled, the price ignores players to act behind; explicit off arm keeps today",
    'V81'
  ),
  flag(
    'v15RiverNoNearLock',
    "2026-11-07 (completed 2026-11-06 audit, hand 3374459) the V15 raise gate's near-lock escape (eq15 - dominationPenalty >= 0.85) no longer applies on the river to ONE measured cell: the Omaha SECOND-nut flush (exactly one live higher flush rank) on an unpaired board, facing a river wager of 0.8 pot or more, outside tournaments, high-only and single-board, calls instead of raising; the equity read there is the Monte Carlo against the bettor's estimated range (0.91-1.00 for the K-high flush with the As live; it raised 43 of 60 seeds before); that cell's own river raises measured negative (raise vs fold, 2026-11-05 -107.2 [-211.4, -2.9] n 12, 11-06 -65.9 n 9), while its tournament raises (+16.2 n 16, +18.0 n 9), third-nut-or-worse flushes (+12.8 n 18, +7.4 n 12), smaller wagers, paired-board flushes, straights, hi-lo and multi-board keep the near-lock reading exactly as before; flop and turn unchanged; the gate only turns a raise into a call (an all-in when the call exceeds the stack), never a fold, though later measured call rules (V81) apply to that call as to any call; receipt v15_raise_gate; docs/horse-measure/2026-11-07/v15-river-raise-scope.md; explicit off arm restores the river near-lock escape",
    'V15'
  ),
  flag(
    'v85CashAction',
    '2026-11-09 (owner direction after a real player reported, for the fourth time, that the cash horses play far too tight: "FOR A 9 HANDED GAME, THESE NUMBERS NEED TO BE INCREASED TO 25-30% VPIP, AND INCREASE THE 3 BETTING ... WHILE MAINTAINING GTO DISCIPLINE ... REAL CASH GAME OPENS ARE 2.5-4.5 BB OR LARGER IF THERE ARE LIMPERS", then "FULLY ADJUSTED FOR 6 HANDED GAMES AND SHORT HANDED PLAY AS WELL") no-limit hold\'em cash at every table size: per-seat raise-first-in widths V85_CASH_OPEN_TARGET (SB 50 / BTN 52 / CO 35 / HJ 27 / LJ 22.5 / 20.5 / 18.5 / nine-handed UTG 17, three-handed 50 / 55, heads-up 80) on the unchanged per-seat reference order; the facing-open base without the per-player collapse (V85_DEFEND_TARGET, V85_DEFEND_TARGET_IP, 0.4 points of continue per player behind instead of 2, an 18% floor) re-based on a 3bb open, the same base answering an open that was called (squeeze, overcall, the multiway big blind) and the heads-up big blind; more linear 3-bets (V85_VALUE_SHIFT) with the bluff trim at 0.6; cash opens 2.5-4.5bb (NLH_OPEN_BANDS_CASH_ACTION); all of it tapered by effective stack (none at 50bb or less, full from 85bb); production before (2026-11-10 UTC, engine 391f7bc0): nine-handed 15.9% VPIP / 11.8% PFR / 4.0% 3-bet, seats behind an open folded 94.0%; offline all-horse probe at 250bb (HoldemCashActionProbe, 8,000 hands a table): nine-handed 15.5 -> 24.8% VPIP, 3-bet 3.6 -> 6.6%, six-handed 22.8 -> 32.0% and 5.5 -> 8.7%; widths are past the solver bands by owner direction and are conditional ranges, never a VPIP quota; tournaments, ante-free short stacks, pot limit, fixed limit, short deck and pineapple unchanged; explicit off arm keeps the prior ranges and sizes',
    'V85'
  ),
  flag(
    'styleValueBettorNotManiac',
    "2026-11-13 STYLE READ #2 (HorseOpponentStyle, STYLE-READ-CONTRACT.md): a value bettor is not a maniac. The legacy postflop aggression factor above 2.5 (callDownMod 1.2, which switches off the one-pair fold layers V61/62/65/66/67/68/79) keeps neutral respect against a player whose betting-range evidence is value-weighted at 15+ decayed hands in this format (shown strength of big river bets engaged from 3 shown, discounted for showdown selection bias, or credibly tight with aggression not credibly high), unless the fast or recent window releases the read (stand-down from a release fraction of 0.5); hold'em family only, cash and tournament alike; 'raises more than Horses' alone is not a maniac; default off, explicit true only; the PLO lane owns the Omaha consumers",
    '2026-11-13',
    'HorseMind.legacyExploit via HorseLogic.decide'
  ),
  flag(
    'styleBigBetHonesty',
    '2026-11-13 STYLE READ #3: a large river bet (0.66 pot or more) from a player whose betting-range evidence is value-weighted earns extra call-down respect, capped at the existing +0.15 together with the V16 tell; a large turn bet and any river raise read the frequency evidence only at half weight (shown strength was measured on big river bets and is not generalised); never a small bet, never the flop; halved when hero holds a blocker; scaled down proportionally and stood down by the fast window; stands down in bounty events; only ever adds respect (never widens a call); the tournament utility arbiter keeps the last word; default off, explicit true only',
    '2026-11-13'
  ),
  flag(
    'styleRaiseRespect',
    '2026-11-13 STYLE READ #4: a flop or turn raise from a player whose postflop bet-and-raise share is credibly below the Horse mean (the raise-frequency proxy) shades a one-pair-or-worse call by up to 0.06 equity, scaled by the DECISION-TIME stack-to-pot ratio (effective stack behind before the decision over the pot including his bet): nothing at SPR 2 or below (one pair is a correct stack-off), full from SPR 6; heads-up, no side pots, no bounty event, no maniac read; released proportionally by the fast window; only ever adds a shade (never widens a call); default off, explicit true only. #4b (2026-11-14), same switch: in cash, heads-up, on the turn and river only, two pair or worse that bet and was raised by a credibly passive player (aggression axis passive at confidence 0.5 or more with its postflop bet-and-raise share credibly low, at least 8 of his raise opportunities on the street against a Horse reference and 20 on turn and river together) blends an estimate against a value-raise stratum into its equity, by a weight that is 1 at or below the Horse raise rate and 0 at twice it, times a raise-size weight (full from 3x the bet, half at 2x); the blend decides only when it is under the price laid; on the turn, when the call leaves the raiser a quarter of the pot or less, the price is the whole commitment and a continuing hand puts the rest in (overriding the call-once plan); never the flop, never tournaments, never an unknown, neutral or aggressive read; receipts style_value_raise_respect_seen and style_commitment_priced_seen',
    '2026-11-13'
  ),
  flag(
    'lightningStyleReadSeparate',
    "2026-11-15 default OFF (L-016): on a Lightning decision (public memory domain speed lightning) the style read takes postflop street aggression, river size buckets and the Horse population reference from Lightning-only maps, which the learner fills from Lightning hands IN ADDITION to the pooled maps (same keys, own caps; the pooled maps and their eviction are unchanged) and the boot rebuild fills from Lightning-domain hand_history rows; without it a Lightning style read pools Lightning and Classic (table-speed) cash evidence while the exploit and profile counters it reads beside them are per domain. Classic and tournament decisions are untouched; it changes a decision only through a style consumer option. Constructed evidence (aLightningStyleReadKeepsItsOwnEvidence.law.test.ts): a Lightning 4x turn check-raise folded 24/24 on the Lightning record alone is called 24/24 once the same player's Classic raises pool in; with this on it folds 24/24. Receipts style_lightning_separate_read_seen and style_lightning_separate_empty_seen. Refused league matchup (no Lightning domain in the league)",
    '2026-11-15'
  ),
  flag(
    'styleTightReRaiserRespect',
    "2026-11-13 STYLE READ #6: against a credibly tight opener the exploit read's narrow facing-an-open branch becomes reachable (bounded 3-bet bar move up to 0.1, call bar +0.04) and against a credibly tight 3-bettor (3-bets per opportunity credibly low) the 4-bet bar rises 0.03 and the call bar 0.06; hold'em only; stands down at 25bb effective and below (push/fold depths: the existing tables decide), in bounty events and when the read is released; a preflop range change, default off, explicit true only, and not to be enabled while a range-change hold stands",
    '2026-11-13'
  ),
  flag(
    'styleShadow',
    '2026-11-13 STYLE READ SHADOW (HorseStyleShadow, HorseStyleSwitch): the style options in shadow for this decision. Each listed option computes its adjustment and applies nothing; one that would have changed its input records that it engaged, and the decision worker re-decides once with only that option on (same RNG position, effects captured and discarded) to receipt a changed action (style_shadow.*). Set only by the live switch; absent = none; an option explicitly true is on whatever this lists',
    '2026-11-13'
  ),
  flag(
    'styleFoldRatePreRepair',
    "2026-11-13 STYLE READ pre-repair: the legacy over-folder branch (postflop fold rate above 0.62) stands down while the decision's exact profile is a pre-repair cash table-speed row whose fold-to-bet has fewer than 60 post-release opportunities; hold'em only; default off, explicit true only",
    '2026-11-13'
  ),
  flag(
    'styleValueExtraction',
    "2026-11-13 STYLE READ A4 value extraction: against a credible caller (fold-to-bet credibly low or river call credibly high) whose shown big bets are not value-weighted, value sizing up to +25%, value bar up to 0.03 thinner, slow-play cut up to 50% only when he rarely bets; released by a rising fast-window fold rate; hold'em heads-up, not bounty; default off, explicit true only",
    '2026-11-13'
  ),
  flag(
    'styleFoldBluff',
    "2026-11-13 STYLE READ postflop-fold bluffing: bluff frequency follows this street's fold-to-bet (river: river call), up to +25% against a folder and down to -30% against a caller, increase withheld against possible fold-faking trappers, pre-repair rows excluded; hold'em heads-up, not bounty; default off, explicit true only",
    '2026-11-13'
  ),
  flag(
    'styleStealTightBlinds',
    "2026-11-15 STEAL FROM TIGHT BLINDS (HorseTightPlayerExploit.tightBlindsSteal; OFF-ONLY in the live switch under the owner's blind-steal hold): no-limit hold'em, first in from the cutoff, button or small blind with every player left to act credibly tight and not aggressive by the style read (never presumed): the open bar comes down by half of the fold-equity surplus over the open's break-even, at most 0.06. Declared assumptions: a blind folds with probability 1 - min(1, 2 x his VPIP posterior mean); the open priced is 2.5 big blinds. Never at push/fold depths, in All-In-Or-Fold, bomb pots, bounty events or Omaha; loose, maniac, value-heavy, attacking and unknown reads stand it down. Read only as === true: default OFF.",
    '2026-11-15'
  ),
  flag(
    'styleTightPlayerExploit',
    "2026-11-15 RESPONSES TO TIGHT PLAYERS (owner order 08:05 Chicago; HorseTightPlayerExploit): against a CREDIBLY tight player's folding, measured from the existing style read and never presumed (supported read, tight participation, not released; excluded: shown big bets strong, bet-when-checked-to high, fold-to-bet low, river call high, bluff-weighted): (a) heads-up on the turn or river, checked to by a credibly tight-passive player, the pure-bluff frequency (equity under 0.3) rises by up to x1.35 net of styleFoldBluff, sized by the existing sizing; (b) preflop no-limit hold'em, every limper credibly tight and not aggressive, the isolation bar from middle or late position comes down by up to 0.04, not at push/fold depths (25 bb) and never beside a limp-reraise read. Hold'em, not Omaha, not bounty events. Default OFF (read === true); evidence file docs/horse-default-on.d/styleTightPlayerExploit.md.",
    '2026-11-15'
  ),
  flag(
    'styleLongShownMemory',
    "2026-11-15 STYLE READ long shown river memory (HorseLongShownMemory): the style read's river size buckets (river first bets by size, shown, shown strong) may take a bucket from the opponent's durable shown river record (horse_exact_profiles.shown_river, migration 20261115144258, written by the accepted-hand learner, a half-life of 40 shown river bets, forward only with no back-fill) when that bucket holds more shown bets than the in-process 72-hour bucket, never their sum; the record reaches the decision on its pooled public row (accepted before the decision's own time) and read frame v16; cash and tournament, table sizes, variants and public domains apart; Horses and humans alike; receipts style_long_shown_memory_seen and style_long_shown_memory_older_seen; default off, explicit true only",
    '2026-11-15',
    'HorseMind.styleRead via HorseLogic.decide and horseDecision/observerReads'
  ),
  flag(
    'holdemProfileCompletenessCap',
    "2026-11-15 THE PROFILE COMPLETENESS CAP: a pooled opponent row whose stored profile is not complete (legacy back-fill pending, or no public memory domain on file; HorseOpponentStyle.profileQualification) caps the style read's confidence at incompleteProfileCap (0.4) for the decision instead of counting at full weight. The exact row governs over a sibling donor row. The rows are named in the decision's own detached state by horseDecision/observerReads and travel in read frame v17, so FAST, DEEP and exact replay agree. Until now the cap never applied on the live path (every pooled read reported complete). Read only as === true: default OFF.",
    '2026-11-15',
    'HorseMind.styleProvenanceOf via horseDecision/observerReads'
  ),
  flag(
    'styleCarryOverWeight',
    "2026-11-13 STYLE READ cross-format transfer: weight (0 to 1) of the same player's other-format counters in the style read; default 0 = format-specific evidence only; one player being tighter in tournaments does not establish that everyone is, so a non-zero weight needs validation first",
    '2026-11-13'
  ),
  receipt(
    'legacy_fold_rate_branch_seen',
    'HorseMind.legacyExploit',
    'the legacy fold-rate branch (postflop fold rate above 0.62) was taken; observability only, no behaviour change; occurrence counter; named *_seen',
    '2026-11-13'
  ),
  receipt(
    'legacy_aggression_factor_branch_seen',
    'HorseMind.legacyExploit',
    'the legacy aggression-factor branch (postflop AF above 2.5) was entered, before the V83 and style guards decide; observability only, no behaviour change; occurrence counter; named *_seen',
    '2026-11-13'
  ),
  receipt(
    'style_pre_repair_fold_rate_discounted_seen',
    'HorseMind.legacyExploit (STYLE READ pre-repair)',
    'the legacy over-folder branch stood down because the exact profile is pre-repair and its fold-to-bet is excluded; occurrence counter; named *_seen',
    '2026-11-13'
  ),
  receipt(
    'style_value_extraction_seen',
    'HorseLogic (STYLE READ A4)',
    'value sizing, value bar or slow-play frequency moved by the value-extraction read; occurrence counter; named *_seen',
    '2026-11-13'
  ),
  receipt(
    'style_value_bettor_not_maniac_changed_action_seen',
    'workerRuntime (R1 style action-change receipt, styleValueBettorNotManiac)',
    'the FAST decision applied styleValueBettorNotManiac and, decided again from the same RNG position with that one option off (one applied option per decision, picked by the decision key), its final action or amount differed; journal field HorseDecision.styleActionReceipt; occurrence counter; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'style_big_bet_honesty_changed_action_seen',
    'workerRuntime (R1 style action-change receipt, styleBigBetHonesty)',
    'the FAST decision applied styleBigBetHonesty and, decided again from the same RNG position with that one option off (one applied option per decision, picked by the decision key), its final action or amount differed; journal field HorseDecision.styleActionReceipt; occurrence counter; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'style_raise_respect_changed_action_seen',
    'workerRuntime (R1 style action-change receipt, styleRaiseRespect)',
    'the FAST decision applied styleRaiseRespect and, decided again from the same RNG position with that one option off (one applied option per decision, picked by the decision key), its final action or amount differed; journal field HorseDecision.styleActionReceipt; occurrence counter; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'style_tight_reraiser_respect_changed_action_seen',
    'workerRuntime (R1 style action-change receipt, styleTightReRaiserRespect)',
    'the FAST decision applied styleTightReRaiserRespect and, decided again from the same RNG position with that one option off (one applied option per decision, picked by the decision key), its final action or amount differed; journal field HorseDecision.styleActionReceipt; occurrence counter; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'style_fold_rate_pre_repair_changed_action_seen',
    'workerRuntime (R1 style action-change receipt, styleFoldRatePreRepair)',
    'the FAST decision applied styleFoldRatePreRepair and, decided again from the same RNG position with that one option off (one applied option per decision, picked by the decision key), its final action or amount differed; journal field HorseDecision.styleActionReceipt; occurrence counter; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'style_value_extraction_changed_action_seen',
    'workerRuntime (R1 style action-change receipt, styleValueExtraction)',
    'the FAST decision applied styleValueExtraction and, decided again from the same RNG position with that one option off (one applied option per decision, picked by the decision key), its final action or amount differed; journal field HorseDecision.styleActionReceipt; occurrence counter; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'style_fold_bluff_changed_action_seen',
    'workerRuntime (R1 style action-change receipt, styleFoldBluff)',
    'the FAST decision applied styleFoldBluff and, decided again from the same RNG position with that one option off (one applied option per decision, picked by the decision key), its final action or amount differed; journal field HorseDecision.styleActionReceipt; occurrence counter; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'style_tight_player_exploit_changed_action_seen',
    'workerRuntime (R1 style action-change receipt, styleTightPlayerExploit)',
    'the FAST decision applied styleTightPlayerExploit and, decided again from the same RNG position with that one option off (one applied option per decision, picked by the decision key), its final action or amount differed; journal field HorseDecision.styleActionReceipt; occurrence counter; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'style_action_receipt_skipped_backlog_seen',
    'workerRuntime (R1 style action-change receipt, Hand Analysis B1)',
    'a FAST decision that applied an ON style option did not take the receipt re-decision because another decision was queued behind it; the same skip rule as the style shadow. The decision itself is unchanged.',
    '2026-11-15'
  ),
  receipt(
    'style_action_receipt_skipped_budget_seen',
    'workerRuntime (R1 style action-change receipt, Hand Analysis B1)',
    'a FAST decision that applied an ON style option did not take the receipt re-decision because it had already spent the shadow re-decision budget; the same skip rule as the style shadow. The decision itself is unchanged.',
    '2026-11-15'
  ),
  receipt(
    'style_action_receipt_skipped_scale_seen',
    'workerRuntime (R1 style action-change receipt, Hand Analysis B1)',
    'a FAST decision that applied an ON style option did not take the receipt re-decision because the governor scale moved after the committed decision; the same skip rule as the style shadow. The decision itself is unchanged.',
    '2026-11-15'
  ),
  receipt(
    'style_tight_player_checked_to_bluff_seen',
    'HorseLogic (styleTightPlayerExploit, postflop)',
    'heads-up on the turn or river, checked to by a credibly tight-passive player, the pure-bluff frequency was raised (net of styleFoldBluff); occurrence counter; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'style_steal_tight_blinds_seen',
    'HorseLogic (styleStealTightBlinds, preflop)',
    'first in from late position or the small blind with every player left to act credibly tight and not aggressive: the open bar move was handed to the preflop engine; occurrence counter.',
    '2026-11-15'
  ),
  receipt(
    'style_steal_tight_blinds_changed_action_seen',
    'workerRuntime (R1 style action-change receipt, styleStealTightBlinds)',
    'the FAST decision applied styleStealTightBlinds and, decided again from the same RNG position with that one option off (one applied option per decision, picked by the decision key), its final action or amount differed.',
    '2026-11-15'
  ),
  receipt(
    'style_tight_limper_isolation_seen',
    'HorseLogic (styleTightPlayerExploit, preflop)',
    'every limper credibly tight and not aggressive: the isolation bar move was handed to the preflop engine; occurrence counter; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'style_fold_bluff_seen',
    'HorseLogic (STYLE READ postflop-fold bluffing)',
    "the bluff multiplier moved by this street's fold-to-bet read; occurrence counter; named *_seen",
    '2026-11-13'
  ),
  receipt(
    'style_bluff_catch_cap_seen',
    'HorseLogic (STYLE READ #3 river bluff-catch equity cap)',
    "a one-pair river bluff-catcher's equity was capped at the bluff share the bettor's called river bets left (90% one-sided); occurrence counter; named *_seen",
    '2026-11-13'
  ),
  receipt(
    'style_boot_inputs_hydrated_seen',
    'HorseExploitHydrator (STYLE READ boot inputs)',
    'unless HORSE_STYLE_BOOT_RELEASE_START_MS is `off`, the boot replay rebuilt the post-release counts of the pre-repair discount from the hand history it read (the size buckets, in-format aggression and Horse reference rebuild on every boot without a receipt); occurrence counter; named *_seen',
    '2026-11-13'
  ),
  receipt(
    'style_boot_post_release_failed_seen',
    'HorseExploitHydrator (STYLE READ boot inputs)',
    'every post-release count batch of the boot rebuild failed, so the pre-repair discount stays on (a partial failure fires style_boot_post_release_partial_failed_seen instead); the hydrated receipt is withheld; occurrence counter; named *_seen',
    '2026-11-13'
  ),
  receipt(
    'style_boot_post_release_partial_failed_seen',
    'HorseExploitHydrator (STYLE READ boot inputs)',
    'some, not all, post-release count batches of the boot rebuild failed; fires once per failed batch, so its count is the failed count; no batch is imported, so the pre-repair discount stays on for every player; the hydrated receipt is withheld; occurrence counter; named *_seen',
    '2026-11-13'
  ),
  receipt(
    'style_boot_size_buckets_failed_seen',
    'HorseExploitHydrator (STYLE READ boot inputs)',
    'the boot rebuild of the river size buckets threw; the aggression and Horse reference rebuilds still ran; occurrence counter; named *_seen',
    '2026-11-13'
  ),
  receipt(
    'style_boot_aggression_failed_seen',
    'HorseExploitHydrator (STYLE READ boot inputs)',
    'the boot rebuild of in-format aggression threw; the size bucket and Horse reference rebuilds still ran; occurrence counter; named *_seen',
    '2026-11-13'
  ),
  receipt(
    'style_boot_horse_reference_failed_seen',
    'HorseExploitHydrator (STYLE READ boot inputs)',
    'the boot rebuild of the Horse population reference threw; the size bucket and aggression rebuilds still ran; occurrence counter; named *_seen',
    '2026-11-13'
  ),
  receipt(
    'style_boot_lightning_failed_seen',
    'HorseExploitHydrator (STYLE READ boot inputs, L-016)',
    'the boot rebuild of the Lightning-only style maps (size buckets, aggression, Horse reference from Lightning-domain rows) threw; the pooled rebuilds had already run; occurrence counter; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'style_boot_size_from_players_seen',
    'HorseExploitHydrator (STYLE READ boot inputs)',
    'unless HORSE_STYLE_BOOT_RELEASE_START_MS is `off`, at least one boot row had no stored dealt-in count (horse_exploit_dealt_count), so its table size came from the players list instead of the count the live scope uses; once per boot; occurrence counter; named *_seen',
    '2026-11-13'
  ),
  receipt(
    'style_switch_*',
    'HorseStyleSwitch (STYLE READ live switch)',
    'style_switch_<option>_<state>_seen: an option of the style read changed runtime state (off, shadow, canary, on) at a configuration read, the option and the new state in the name; style_switch_config_invalid_seen / style_switch_config_unreadable_seen / style_switch_config_stale_seen: the configuration was not the documented shape, could not be read, or was delivered more than two poll intervals ago, and every option failed safe to off; occurrence counters; named *_seen',
    '2026-11-13'
  ),
  receipt(
    'option_switch_*',
    'HorseOptionSwitch (every decision upgrade has a live switch)',
    'option_switch_<option>_<on|off|default>_seen: a registered non-style decision option changed its switched value at a configuration read in this worker (on: passed true; off: passed false; default: its row went away or the configuration failed, so the code default decides), the option and the new value in the name; option_switch_config_invalid_seen / option_switch_config_unreadable_seen / option_switch_config_stale_seen: the configuration was not the documented shape, could not be read, or was delivered more than two poll intervals ago, and every non-style option went back to its RELEASE DEFAULT (not to off; the seven style options keep their own rule, style_switch_*: off); occurrence counters; named *_seen',
    '2026-11-14'
  ),
  receipt(
    'style_shadow*',
    'horseDecision workerRuntime (STYLE READ shadow)',
    'style_shadow.<opt>.<c|t>.<variant>.<p|f|t|r>.<actual>.<wouldBe>.<s|c>_seen: an AGGREGATE counter over a fixed key set of at most 68,600 keys (no hand, seat or amount), one fire per changed decision of a style option in shadow (the one re-decision with that option on differs from the committed one in action or amount; a size-only change has <actual> = <wouldBe> and is counted apart from the 30-decision evaluation gate); per-decision detail is reconstructed from the decision journal (replay state carries the switch state) joined to ca_hand_facts; style_shadow_unchanged_seen: the re-decision kept the action; style_shadow_rotated_out_seen: another engaged option of the same decision was not re-decided (one re-decision per decision, rotated by decision key); style_shadow_skipped_backlog_seen / _skipped_budget_seen / _skipped_scale_seen: no re-decision because work was queued, the committed decision exceeded the 15 ms budget, or the governor scale moved; style_shadow_scale_mismatch_seen: the re-decision ran at another scale and was discarded; style_shadow_redecide_over_budget_seen: a re-decision took more than 15 ms; style_shadow_redecide_failed_seen / _unencodable_seen: a re-decision or its receipt threw (nothing committed changes); occurrence counters; named *_seen',
    '2026-11-13'
  ),
  receipt(
    'style_engaged_*',
    'horseDecision workerRuntime (STYLE READ engagement receipts)',
    'style_engaged_<opt>_<c|t|l>_seen: an option that is ON applied its adjustment in one live fast decision (the same non-neutral condition its shadow arm records under), by format (c Classic cash, t tournament, l Lightning: publicMemoryDomain.speed lightning); one fire per engaged ON option per decision, a per-decision engagement count only: no re-decision runs and the committed decision is unchanged; 21 keys (opt vb bb rr tr fr ve fb x 3 formats); occurrence counter; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'style_read_timed_seen',
    'horseDecision workerRuntime (STYLE READ latency)',
    'a live fast decision ran with at least one style option not off, and the style read time inside it was recorded (horse_decision_latency scope style_read); the denominator of style_read_over_budget_seen; occurrence counter; named *_seen',
    '2026-11-13'
  ),
  receipt(
    'style_read_over_budget_seen',
    'horseDecision workerRuntime (STYLE READ latency)',
    'the style read added more than the pre-registered 0.25 ms to one live decision; over style_read_timed_seen it must stay at or below 1 percent (the p99 budget); occurrence counter; named *_seen',
    '2026-11-13'
  ),
  receipt(
    'style_boot_release_start_rejected_seen',
    'HorseExploitHydrator (STYLE READ boot inputs)',
    'the configured release start was not epoch milliseconds between 2026-01-01 and now, so the style boot inputs stayed off; occurrence counter; named *_seen',
    '2026-11-13'
  ),
  receipt(
    'style_bluff_catch_cap_bounty_priced_seen',
    'HorseLogic (STYLE READ #3 bluff-catch cap in bounty events)',
    'in a bounty event the bluff-catch cap was raised by the knockout credit the call earns (V23/V37 pricing, approximated as cap + credit on the capped equity; it never widens a call beyond OFF); occurrence counter; named *_seen',
    '2026-11-13'
  ),
  receipt(
    'style_value_bettor_not_maniac_seen',
    'HorseMind.legacyExploit and readExploit, HorseLogic maniacCallDown (STYLE READ #2)',
    "a value-weighted bettor (style read) was not treated as a maniac: a postflop aggression factor above 2.5 kept neutral respect, the newer exploit read's call-down widening was removed (2026-11-15), or the postflop maniac call-down stood aside on his bet (2026-11-15); fired only where that effect applied; occurrence counter (counts reads, not decisions); named *_seen",
    '2026-11-13'
  ),
  receipt(
    'style_tight_respect_fold_kept_from_floor_seen',
    'HorseLogic.vpipFloorCallDown (STYLE READ #6, later layers keep the style read)',
    "a preflop fold the tight opener / re-raiser respect produced (its respect-free twin was not a fold) was kept from the VPIP-floor cheap call-down because the horse's own windowed VPIP was not within one hand of its floor; named *_seen",
    '2026-11-15'
  ),
  receipt(
    'style_fold_bluff_held_by_big_bet_honesty_seen',
    'HorseLogic.decide V64 river bluff-raise gate (STYLE READ items 3 and #3)',
    'a river bluff-raise was rolled against a bet the big-bet honesty read calls credibly value, and the fold-bluff multiplier alone would have opened the gate; the gate stayed closed; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'style_big_bet_honesty_seen',
    'HorseLogic.decide V12 respect block (STYLE READ #3)',
    'a large river bet, a large turn bet or a river raise from a value-weighted bettor added respect (at most 0.15 including the V16 tell); named *_seen',
    '2026-11-13'
  ),
  receipt(
    'style_raise_respect_seen',
    'HorseLogic.decide V66 raise shade (STYLE READ #4)',
    'a flop or turn raise from a credibly low-raise-frequency player added a decision-time-SPR-scaled shade to a one-pair-or-worse call; named *_seen',
    '2026-11-13'
  ),
  receipt(
    'style_value_raise_respect_seen',
    'HorseLogic.decide value-raise blend (STYLE READ #4b)',
    "cash hold'em, heads-up, turn or river: two pair or worse that bet and was raised by a credibly passive player had its equity blended with a value-raise stratum estimate, and the blend took it from covering the bare call price to under it (the call became a fold); fired only then; named *_seen",
    '2026-11-14'
  ),
  receipt(
    'style_commitment_priced_seen',
    'HorseLogic.decide value-raise commitment price (STYLE READ #4b)',
    "cash hold'em, heads-up, turn, a call that leaves the raiser a quarter of the pot or less: the whole-commitment price changed the decision - the blended equity covered the bare call but not the whole commitment (fold), or a hand that continued put the rest in where the plain rules would have flat-called (jam); named *_seen",
    '2026-11-14'
  ),
  receipt(
    'lightning_participation_eligible',
    'HorseLightningParticipation via HorseLogic / HorsePreflop (lightningParticipationHoldem, lightningParticipationOmaha; default off)',
    'a preflop decision with a Lightning participation option on and the hand inside its predicate (Lightning cash NLH / PLO4 / PLO5, four to six dealt, big-blind ante): the opportunity count; zero in Lightning with the option on is an unwired option',
    '2026-11-15'
  ),
  receipt(
    'lightning_participation_changed',
    'HorseLightningParticipation via HorseLogic / HorsePreflop (lightningParticipationHoldem, lightningParticipationOmaha; default off)',
    'a Lightning participation range cell changed the action against the base answer (first-in raise, or a big-blind call by price); the decision carries the cell reason code on its preflop authority trail',
    '2026-11-15'
  ),
  receipt(
    'lightning_participation_refused_not_lightning_seen',
    'HorseLightningParticipation via HorseLogic / HorsePreflop (lightningParticipationHoldem, lightningParticipationOmaha; default off)',
    'option on, hand not in a Lightning public memory domain (Classic tables): the option stayed out; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'lightning_participation_refused_format_seen',
    'HorseLightningParticipation via HorseLogic / HorsePreflop (lightningParticipationHoldem, lightningParticipationOmaha; default off)',
    'option on, Lightning domain but not cash preflop or an all-in-or-fold table: the option stayed out; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'lightning_participation_refused_variant_seen',
    'HorseLightningParticipation via HorseLogic / HorsePreflop (lightningParticipationHoldem, lightningParticipationOmaha; default off)',
    "option on, a variant that is not no-limit hold'em, PLO4 or PLO5: the option stayed out; named *_seen",
    '2026-11-15'
  ),
  receipt(
    'lightning_participation_refused_dealt_count_seen',
    'HorseLightningParticipation via HorseLogic / HorsePreflop (lightningParticipationHoldem, lightningParticipationOmaha; default off)',
    'option on, fewer than four or more than six dealt: the option stayed out; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'lightning_participation_refused_not_bb_ante_seen',
    'HorseLightningParticipation via HorseLogic / HorsePreflop (lightningParticipationHoldem, lightningParticipationOmaha; default off)',
    'option on, no big-blind ante: the option stayed out; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'lightning_participation_refused_opponent_read_seen',
    'HorseLightningParticipation via HorseLogic / HorsePreflop (lightningParticipationHoldem, lightningParticipationOmaha; default off)',
    'a Lightning participation cell stood aside for an opponent read (an observed maniac, a confirmed aggressive player in position behind, a tight-opener respect or wide-opener pressure read); the base answer stood; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'lightning_fold_through_kept',
    'HorseLogic.decide via HorseLightningFoldThrough (lightningEarlyFoldNeedsFoldThrough; default off)',
    'a Lightning fold asked while live seats before the Horse still had to act (an early look) also folded on the fold-through frame (those seats folded), so the early fold stood and lands right away',
    '2026-11-15'
  ),
  receipt(
    'lightning_fold_through_released',
    'HorseLogic.decide via HorseLightningFoldThrough (lightningEarlyFoldNeedsFoldThrough; default off)',
    'a Lightning fold asked while live seats before the Horse still had to act (an early look) did NOT fold on the fold-through frame, so the frame answer was returned and the host left the Horse to decide afresh on its own turn',
    '2026-11-15'
  ),
  receipt(
    'lightning_cheap_entry_eligible_seen',
    'HorseLightningCheapEntry via HorseLogic / HorsePreflop (lightningCheapEntryHoldem, lightningCheapEntryOmaha; default off)',
    'a preflop decision with a Lightning cheap entry option on and the hand inside the shared Lightning predicate (Lightning cash NLH / PLO4 / PLO5, four to six dealt, big-blind ante): the opportunity count; zero in Lightning with the option on is an unwired option; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'lightning_cheap_entry_asked_seen',
    'HorseLightningCheapEntry via HorseLogic / HorsePreflop (lightningCheapEntryHoldem, lightningCheapEntryOmaha; default off)',
    'the unopened branch folded in a cheap-entry spot (the small blind folded to, or the small blind or the button behind one or more limpers with no raise, the call one big blind or less) and the option was asked; counts the spots it can reach; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'lightning_cheap_entry_changed_seen',
    'HorseLightningCheapEntry via HorseLogic / HorsePreflop (lightningCheapEntryHoldem, lightningCheapEntryOmaha; default off)',
    'a Lightning cheap entry turned the base fold into a call (small-blind completion or over-limp, never a raise); the decision carries lightning_cheap_entry_sb_complete or lightning_cheap_entry_over_limp on its preflop authority trail; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'lightning_cheap_entry_refused_not_lightning_seen',
    'HorseLightningCheapEntry via HorseLogic / HorsePreflop (lightningCheapEntryHoldem, lightningCheapEntryOmaha; default off)',
    'option on, hand not in a Lightning public memory domain (Classic tables): the option stayed out; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'lightning_cheap_entry_refused_format_seen',
    'HorseLightningCheapEntry via HorseLogic / HorsePreflop (lightningCheapEntryHoldem, lightningCheapEntryOmaha; default off)',
    'option on, Lightning domain but not cash preflop or an all-in-or-fold table: the option stayed out; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'lightning_cheap_entry_refused_variant_seen',
    'HorseLightningCheapEntry via HorseLogic / HorsePreflop (lightningCheapEntryHoldem, lightningCheapEntryOmaha; default off)',
    "option on, a variant that is not no-limit hold'em, PLO4 or PLO5: the option stayed out; named *_seen",
    '2026-11-15'
  ),
  receipt(
    'lightning_cheap_entry_refused_dealt_count_seen',
    'HorseLightningCheapEntry via HorseLogic / HorsePreflop (lightningCheapEntryHoldem, lightningCheapEntryOmaha; default off)',
    'option on, fewer than four or more than six dealt: the option stayed out; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'lightning_cheap_entry_refused_not_bb_ante_seen',
    'HorseLightningCheapEntry via HorseLogic / HorsePreflop (lightningCheapEntryHoldem, lightningCheapEntryOmaha; default off)',
    'option on, no big-blind ante: the option stayed out; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'lightning_cheap_entry_refused_opponent_read_seen',
    'HorseLightningCheapEntry via HorseLogic / HorsePreflop (lightningCheapEntryHoldem, lightningCheapEntryOmaha; default off)',
    'a cheap-entry spot with an observed maniac live at the table (its own record, never the presumption): the base fold stood; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'style_tight_opener_respect_seen',
    'HorsePreflop via HorseLogic (STYLE READ #6)',
    'facing one open from a credibly tight opener the 3-bet bar moved up and the call bar rose, bounded; named *_seen',
    '2026-11-13'
  ),
  receipt(
    'style_tight_reraiser_respect_seen',
    'HorsePreflop via HorseLogic (STYLE READ #6)',
    'facing a 3-bet or more from a credibly tight re-raiser the 4-bet and call bars rose, bounded; named *_seen',
    '2026-11-13'
  ),
  flag(
    'styleTightMultiSignal',
    "2026-11-15 TIGHT BEYOND VPIP (opponent classifier C2): the style read's participation axis, when the VPIP-only and call-share routes leave it neutral, is tight if VPIP is credibly (90%) below the Horse VPIP mean of the cell and raise share (PFR / VPIP) is credibly above the Horse share plus 0.02 or fold to 3-bet credibly above the Horse mean plus 0.04 (8 or more decayed opportunities each), with VPIP and call share not high and raise share not credibly low (a caller-heavy player never qualifies); never overrides a loose read; consumers unchanged (#6a / #6b still need PFR credibly low; #2's tight route and the labels see the side); hold'em style read; default OFF, read === true only; evidence docs/horse-default-on.d/styleTightMultiSignal.md",
    '2026-11-15'
  ),
  receipt(
    'style_tight_multi_signal_seen',
    'HorseMind.styleRead (styleTightMultiSignal)',
    'a style read was made tight by the multi-signal route (VPIP credibly below the Horse mean, corroborated by raise share or fold to 3-bet); receipt.tightMultiSignal carries the posterior probabilities; counts reads; named *_seen',
    '2026-11-15'
  ),
  flag(
    'styleTightMethodLine',
    "2026-11-16 TIGHT AT THE OBSERVATION LINE (opponent classifier): the style read's participation axis, when every earlier route leaves it neutral, is tight for a no-limit hold'em player whose read window (the 120-hand long window when it holds more hands than the decayed counters) holds 50 or more hands with VPIP at or below the human-vs-Horse observation method's line (0.18 at a full table, 0.30 short-handed; heads-up has no line), VPIP credibly (90%) below the Horse VPIP mean of the cell, PFR at or below the Horse PFR mean, and VPIP and call share not high; no raise-share corroboration is needed, so a tight player who mostly calls qualifies; never overrides a loose read; consumers unchanged; default OFF, read === true only; evidence docs/horse-default-on.d/styleTightMethodLine.md",
    '2026-11-16'
  ),
  receipt(
    'style_tight_method_line_seen',
    'HorseMind.styleRead (styleTightMethodLine)',
    'a style read was made tight by the observation-line route (50 or more hands, VPIP at or below the method line and credibly below the Horse mean, PFR not above the Horse mean); receipt.tightMethodLine carries the line, hands, rates and posterior; counts reads; named *_seen',
    '2026-11-16'
  ),
  flag(
    'holdemManiacSampleGate',
    "2026-11-15 A REGULAR IS NOT A MANIAC (opponent classifier C3): no-limit hold'em reads from HorseMind.opponentRead carry the maniac sample gate (HorseOpponentExploit.withManiacSampleGate) and maniacRaiseWidth then needs at least 15 decayed hands; its opener route needs PFR credibly (90%) above the size's regular line (Horse PFR P99 of the cell plus 0.10: full 0.2985, short 0.4566, heads-up 0.5326), first-in raising alone no longer qualifies; its re-raise route needs at least 8 decayed 3-bet opportunities; every maniac response keyed on maniacRaiseWidth sees the gated read; Omaha and fixed-limit untouched; default OFF, read === true only; evidence docs/horse-default-on.d/holdemManiacSampleGate.md",
    '2026-11-15'
  ),
  receipt(
    'maniac_sample_gate_withheld_seen',
    'HorseMind.opponentRead (holdemManiacSampleGate)',
    'the ungated read had a preflop maniac width and the gated read has none (thin sample, PFR not credibly beyond the regular line, or too few 3-bet opportunities); counts reads; named *_seen',
    '2026-11-15'
  ),
  flag(
    'holdemManiacShortHandedReach',
    "2026-11-15 SHORT-HANDED MANIAC REACH: at short-handed and heads-up no-limit hold'em tables the regular PFR line is so high that only extreme raisers have a preflop maniac width. With the option on, an opponent there whose bet-when-checked-to is credibly beyond every Horse at the postflop-maniac rate and who does not fold to bets (the existing sticky leg: fold-to-bet at most 0.36), on at least 15 decayed hands, takes the maniac width max(0.35, PFR mean) (HorseOpponentExploit.withManiacShortHandedReach, attached in HorseMind.opponentRead). Full ring, Omaha and presumed reads unchanged. Read only as === true: default OFF.",
    '2026-11-15'
  ),
  receipt(
    'holdem_maniac_short_handed_reach_seen',
    'HorseMind.opponentRead (holdemManiacShortHandedReach)',
    "a short-handed or heads-up no-limit hold'em read with no preflop maniac width took one from its postflop evidence (bet-when-checked-to engaged high at 0.55 or more, fold-to-bet at most 0.36, 15+ decayed hands)",
    '2026-11-15'
  ),
  flag(
    'holdemGearShiftReach',
    "2026-11-15 A GEAR SHIFT IS REACHABLE (opponent classifier C5, audit I): no-limit hold'em reads from HorseMind.opponentRead judge a confirmed regime break (styleShiftReleased, long read not engaged, 8+ fast opportunities) on the 8-hand window at the ordinary credibility (EXPLOIT_CREDIBILITY 0.90) instead of 0.95 in the gear-shift branch, and also try it where the long mean has crossed the envelope edge but the fast window missed the 0.97 fast-engage line; aggressive statistics only (pfr, rfi, threeBet, betCheckedTo), high side only; the calm direction (the fast-window OFF switch) is untouched; Omaha and fixed-limit untouched; default OFF, read === true only; evidence docs/horse-default-on.d/holdemGearShiftReach.md",
    '2026-11-15'
  ),
  receipt(
    'holdem_gear_shift_reach_seen',
    'HorseOpponentExploit.opponentExploitRead (holdemGearShiftReach)',
    'a statistic the long window and the stricter fast lines left unengaged was engaged high from the fast window at the ordinary credibility after a confirmed regime break; counts read computations; named *_seen',
    '2026-11-15'
  ),
  flag(
    'holdemCallDownExcludesCurrentHand',
    "2026-11-15 IN-HAND WAGERS ARE NOT HISTORY (opponent classifier C7 F1, HU-MEM-013 V6): in a hold'em decision the legacy aggression ratio behind the lifetime call-down multiplier (HorseMind.legacyExploit, ratio above 2.5 on 12+ actions sets 1.2) subtracts the opponent's own wagers in the hand being decided (HorseMind.currentHandWagers of the decision's action history, carried in the decision read options), never below zero, so the bets the Horse faces are not evidence that the same bettor bluffs; Omaha and every other read unchanged; default OFF, read === true only; evidence docs/horse-default-on.d/holdemCallDownExcludesCurrentHand.md",
    '2026-11-15'
  ),
  receipt(
    'holdem_call_down_excludes_current_hand_seen',
    'HorseMind.legacyExploit (holdemCallDownExcludesCurrentHand)',
    'the read with the current hand would have entered the maniac branch and the read without it does not; counts reads; named *_seen',
    '2026-11-15'
  ),
  flag(
    'holdemCallDownNeedsStyleEvidence',
    "2026-11-15 ONE READ ANSWERS THE CALL-DOWN (opponent classifier C7 F2, HU-MEM-013 V6): in a hold'em decision whose scope bucket is under SCOPE_MIN_HANDS (the pooled tallies answer the lifetime read) and whose style read has no supported individual read, the legacy maniac call-down multiplier (1.2) stays neutral, so a multiplier the style layer cannot see never widens a call; reduced-to-two tables are the case found; default OFF, read === true only; evidence docs/horse-default-on.d/holdemCallDownNeedsStyleEvidence.md",
    '2026-11-15'
  ),
  receipt(
    'holdem_call_down_needs_style_evidence_seen',
    'HorseMind.legacyExploit (holdemCallDownNeedsStyleEvidence)',
    'the legacy maniac multiplier was held neutral because the pooled tallies answered and the style read had no supported individual read; counts reads; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'holdem_profile_completeness_cap_seen',
    'HorseMind.styleProvenanceOf (profile completeness cap)',
    'behind holdemProfileCompletenessCap, a style read stood on a pooled row whose stored profile is not complete and took the incomplete-profile confidence cap; counts reads; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'style_long_shown_memory_seen',
    'HorseMind.styleRead (STYLE READ, long shown river memory)',
    "behind styleLongShownMemory, a style read took at least one river size bucket from the opponent's durable shown river record (horse_exact_profiles.shown_river, carried by the decision's pooled public row) because it held more shown bets than the in-process 72-hour bucket; counts reads; named *_seen",
    '2026-11-15'
  ),
  receipt(
    'style_long_shown_memory_older_seen',
    'HorseMind.styleRead (STYLE READ, long shown river memory)',
    "as style_long_shown_memory_seen, and the record began more than 72 hours before the decision's own time: the read used shown river evidence the 72-hour boot rebuild cannot hold; counts reads; named *_seen",
    '2026-11-15'
  ),
  receipt(
    'style_long_participation_seen',
    'HorseMind.styleRead (STYLE READ, long participation window)',
    'a style read took VPIP, PFR or the call share from the 120-hand long participation window (ExploitCounters lHands / lVpip / lPfr, horse_exact_profiles.long_counters) because it held more evidence than the 30-hand window and both leaned low or even; receipt.longWindow names which; counts reads; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'style_lightning_separate_read_seen',
    'HorseMind.styleRead (STYLE READ, L-016; lightningStyleReadSeparate, default off)',
    'a style read on a Lightning decision with lightningStyleReadSeparate on took postflop aggression, river size buckets and the Horse reference from the Lightning-only maps; counts reads (expected 0 until switched on; then never 0 in Lightning while a style consumer option is on); named *_seen',
    '2026-11-15'
  ),
  receipt(
    'style_lightning_separate_empty_seen',
    'HorseMind.styleRead (STYLE READ, L-016; lightningStyleReadSeparate, default off)',
    'a Lightning-separate style read found no Lightning row for the player (aggression or size buckets) or for the Horse reference where the pooled map held one: the read saw less evidence than the pooled read would have; counts reads; named *_seen',
    '2026-11-15'
  ),
  receipt(
    'style_read_released_seen',
    'HorseMind.styleRead (STYLE READ)',
    'a style read was taken for a player whose fast or recent window released it to stand-down (release fraction 0.5 or more); counts reads; named *_seen',
    '2026-11-13'
  ),
  receipt(
    'style_label_*',
    'HorseMind.styleRead (STYLE READ)',
    'a style read was taken and labelled (maniac, loose-aggressive, loose-passive, tight-aggressive, tight-passive, value-heavy-passive, balanced, unknown): style_label_<label>_seen; a telemetry-only label per read, never an input to a decision; counts reads, so it is only taken when a style option is on',
    '2026-11-13'
  ),
  flag(
    'v87DeepDiveDiscipline',
    '2026-11-10 all-database human-vs-Horse deep dive building on V86 (49,310 physical hands, 41,151 included hands, 349,970 Horse decisions across the 8 Cash & MTT NLH/PLO4/PLO5/PLO6 domains): (1) Omaha preflop multiway and 5/6-card selectivity (presumed-opener flatBar/bbFlatBar cleared in 5/6-card and multiway non-HiLo Omaha while preserving threeBetBar and observed reads; hole-count/seat/caller-capped V24 priceRelief and floors; multiway/deep-stack cold-call tightening; 5/6-card V46 trips rescue for AA-ds/broadway-ds 4-card cores and non-elite self-blocked 4-suit / non-Ace-suited tightening); (2) HU Omaha position-stab suppression explicitly excluded after failing paired seat-swap qualification (turn -8.96 +/- 3.34 bb/100, river -15.03 +/- 3.79 bb/100); (3) PLO6 >=0.90-pot non-HU turn/river call-fold cells, drawless flop V40 pair/air cap-lift withholding, and V66/V67-style non-HiLo Omaha bet-raised commitment exclusion + raise shade for vulnerable non-nut hands without nutty redraws; (4) V13 pricedIn trash floor vs raises in tournaments and non-HiLo Omaha (Cash NLH, <=2bb all-in calls, and <=0.065 min-clicks untouched) plus single-board NLH turn cold-raise / multiway big-bet bluff-catch shade; PLO8/Hi-Lo untouched; explicit off arm keeps prior behavior',
    'V87'
  ),
  flag(
    'v84OmahaRiverReraiseCalls',
    "2026-11-07 (hand 3359656: PLO6 tournament, Kd-high flush with no Ad on 9d 7d 2d 4s 6s bet 2,858 into 4,090, raised to 12,664, called 9,806, lost 587bb) PLO4/PLO5/PLO6 river CALLS of a raise of 0.9 pot or more after the horse's OWN river bet or raise (the spot V81 leaves out with chips already in this street) fold only in the measured cell (HorseOmahaBigBetCalls.v84Cell, same classification and wager measure as V81): an unpaired-board second-nut flush. Decision EV of the horses' own calls (net + chips already in, bb; hand_history + ca_hand_facts, every PLO hand, CIs clustered by hand) day A 2026-11-05/06 -100.8 [-159.5, -42.0] n 12, day B 2026-11-06/07 -93.0 [-130.3, -55.6] n 15, all 27 calls lost, no variant or format slice positive on either day; admission is V81's rule plus a floor of 10 hands per day; not admitted: paired-board second-nut flush (n 2 and 4), two pair, flush-board / non-nut / paired-board straights (each straddles one day), nut straights and full houses (win); excluded as V81: heads-up tables, bounty events, 20bb or less, hi-lo, multi-board, bomb pots, a bettor measured as a postflop over-bluffer, unreconcilable street history; outputs in docs/horse-measure/2026-11-07/v84-river-reraise-cells.txt; limits: only the horses' calls are observed, ICM not modelled; denominator re-measured before activation (omaha-river-reraise-opportunities.sql): the horses met the spot with an unpaired second-nut flush 49 times and called all 49 (no fold, no re-raise), 22 fell to the V81 exclusions, the 27 eligible calls matched hand for hand, no chop, no run-it-twice, no all-in-or-fold table, every showdown a nut flush or straight flush; prices 0.028 to 0.333 (median 0.333), 0 wins in 27 bounds the win rate at 0.105, so V84 folds only a call priced at V84_MIN_CALL_PRICE 0.13 or more (23 calls: day A -106.5 [-169.6, -43.3] n 11, day B -101.8 [-145.2, -58.3] n 12, all lost) and all-in-or-fold tables keep today (docs/horse-measure/2026-11-07/v84-river-reraise-denominator.txt); explicit off arm keeps today",
    'V84'
  ),
  flag(
    'v83AggressionNeedsBluffs',
    "2026-11-06 (R7 certification diagnosis) the legacy exploit read's postflop aggression factor above 2.5 sets callDownMod 1.2 (call lighter; every one-pair fold and shade layer gated on callDownMod <= 1 switches off) only when the bettor's big river bets have not shown down mostly as value: 20+ big-bet showdowns (>= 20bb, called) with 75%+ shown strong keep neutral respect (HorseMind.aggressionShownAsValue, receipt v83_aggression_shown_as_value); horse-vs-horse play sits at AF ~2.43 with ~85% of big bets strong, so the ratio-only line flipped on small shifts in how often a player is checked to (R7 league/cash 10x: -5.54 +/- 0.84 bb/100 with the ratio-only read, -0.62 +/- 0.31 with this gate); the credible opponent read (callDownRespectShift), the passive branch (AF < 0.7) and bluffMod / valueThinMod are unchanged; explicit off arm keeps the ratio-only read",
    'V83'
  ),
  flag(
    'readPostflopFoldRate',
    '2026-11-07 (read calibration, HorseReadCalibration walk-forward over 41,013 accepted hands with humans seated) the legacy exploit fold rate that sets bluffMod and valueThinMod reads the decision context postflop fold-to-bet posterior (exploit counters, the shared-memory profile when loaded; neutral below 8 decayed opportunities) instead of lifetime folds over every street; the all-street rate predicted 38.1% against 45.4% actual postflop folds for humans (Brier 0.259 vs 0.240 for the postflop read on the same 12,264 spots) and read horses as folders (68% vs 52.5%); default off, the league measures it',
    'Read calibration'
  ),
  flag(
    'readShrinkResponse',
    '2026-11-07 (read calibration) riverFoldRate and foldToCbetOf shrink toward the card family population rate with 16 pseudo-observations above their unchanged 8 / 10 opportunity gates; raw rates predicted worse than the population rate below ~40 opportunities (out of sample Brier: river fold 0.2193 -> 0.2159, fold to c-bet 0.2237 -> 0.2216); default off, the league measures it',
    'Read calibration'
  ),
  flag(
    'readBreakEvenBluff',
    '2026-11-08 (read calibration follow-up) the exploit bluff multiplier is re-derived from break-even: the decision context postflop fold-to-bet read, shrunk toward the game population mean with 16 pseudo-observations, is placed on the measured fold-by-bet-size curve (18,560 NLH and 23,652 PLO first-bet responses, every seat pooled) and the multiplier is proportional to the fold share above s / (1 + s), scaled so the population keeps the ladder tuned volume (x1.45) at a 0.67-pot bet, clamped 0.3 .. 1.5; the c-bet, probe, semi-bluff and pure-bluff bets price their own size; nlh and plo4-6 only; replaces readPostflopFoldRate, whose read alone against the old 0.62 / 0.35 lines lost the mirror; 2026-11-08 it answers only for an opponent whose postflop fold-to-bet or river-call read is engaged (the opponent-exploit gate), so an unread opponent keeps the flag-off price, and a semi-bluff break-even is s (1 - 2e) / (1 + s - e (1 + 2s)), the fold share at which betting matches checking; default off, the league measures it',
    'Read calibration'
  ),
  flag(
    'omahaEvFoldModel',
    '2026-11-08 (Omaha threshold calibration) at PLO4 / PLO5 / PLO6 cash tables the EV bet engine prices each opponent fold as MDF s / (1 + s) times the game measured fold share over MDF (flop and turn first-bet responses, every seat pooled, cash: PLO4 1.289, PLO5 1.458, PLO6 1.409) scaled by the opponent postflop fold-to-bet read shrunk toward the game population (16 pseudo-observations), instead of the all-street exploit bluff multiplier, which read 85% of human Omaha postflop spots as stations (x0.55) on preflop calls; walk-forward out of sample the engine predicted 37.8% folds against 52.0% actual (Brier 0.2471, model 0.2218); tournament decisions keep the exploit multiplier (tournament players fold about MDF, ratio 1.04-1.09, and the cash ratio lost the PLO4 tournament mirror); the scalar bluffMod other consumers classify by is unchanged; default ON (league: PLO4 mirror +3.74 +/- 1.63 and +4.29 +/- 1.48 bb/100 on two seeds, PLO6 human-calibrated field +19.77 +/- 8.10 on one, no card significantly negative, no exploiter earns more); explicit off arm keeps the exploit bluff multiplier',
    'Omaha threshold calibration'
  ),
  flag(
    'omahaNeutralUnknown',
    '2026-11-13 owner directive: an unknown Omaha opponent receives a neutral, explicitly uncertain read; the shared aggressive raise presumption (presumedAggressorRead) is skipped and only the opponent own measured read applies. Default off until its league comparison is accepted.',
    'Omaha neutral unknown'
  ),
  flag(
    'omahaTightOpponent',
    '2026-11-13 owner order (tight adjustment mandatory): in pot-limit Omaha high cash and ordinary tournament preflop (no hi-lo, bomb pot, multi-board, All-In-Or-Fold or push/fold depth), against a PROVEN tight opponent (15+ decayed hands, the aggressive presumption disproved, a raiser pfr, or rfi on 15+ first-in opportunities, credibly at most half the Horse mean and VPIP not above the mean; a folder VPIP credibly at most 0.6 of the Horse mean; 90% one-sided on the statRead posterior; no wide read; recent raising not back above the raiser bar): a proven tight raiser faced is respected (3-bet bar toward the top 30% of his raises, at most +0.10; call bar +0.04; no bluff 3-bet or squeeze; facing his re-raise 4-bet bar +0.03 and call bar +0.06), and first in from late position or the small blind with every player left to act a proven tight folder the open bar comes down by half the fold-equity surplus over a pot-sized open break-even, at most 0.10 (HorseOmahaTightOpponent). Default OFF. Its declared league evaluation passed on 2026-11-14 (Omaha development tight field, pooled PLO4+PLO5 six-handed +11.48 +/- 0.47 bb/100, Omaha development control +0.05 +/- 0.05, no cell below zero; development fields only); default-on additionally needs docs/HORSE-DECISION-CHANGE-EVIDENCE.md rows 2-5 (input fidelity, per-node value under three ranges, recorded continuation frequencies, production reach), which need recorded production hands.',
    'Omaha tight opponent'
  ),
  flag(
    'tournamentUtilityStackScaledMargin',
    "2026-11-15 STACK-SCALED UTILITY MARGIN (hand 59441335; Hold'em Strategy): the tournament utility (HorseTournamentUtility evaluateCandidate) measured each candidate's equity-uncertainty margin as the equity standard error times the WHOLE payout pool, which is wider than a short stack's whole tournament equity, so the payout check always deferred to the reference action for a short stack. With explicit true the margin is the equity standard error times the candidate's own utility sensitivity to the Horse's showdown share (the regression slope of utility on share over the calibrated samples, bounded by the utility span), and never wider than the whole-pool margin it replaces. Folds keep a zero margin. Read only as === true: default OFF; unset is byte-identical.",
    '2026-11-15'
  ),
  flag(
    'icmBustPaysPlace',
    '2026-11-15 PAID BUST (Hand Analysis B3; hand 59441335): IcmModel bubbleFactor and pairwiseBubbleFactor value a bust at the place the player finishes (paid in the money) instead of 0, for the decision only (withIcmBustPaysPlace in HorseLogic.decide). Before, in the money a whole-stack risk was charged every payout including the one a bust collects anyway, and a final-table short stack read the factor cap of 5. Affects the V16 ICM premium, the covered-opponent fold pressure in HorseTournamentUtility and the payout-aware push/fold tables. Read only as === true: default OFF.',
    '2026-11-15'
  ),
  flag(
    'holdemRiverFullHouseValue',
    "2026-11-15 HOLD'EM RIVER FULL HOUSE VALUE (HorseHoldemRiverFullHouseValue; owner order 11:20 Chicago, the shared audit of Hold'em hands against people): in no-limit hold'em on the river, out of position without the betting lead, a full house or better that uses a hole card (not an under-full, not a trips-board boat, not the board playing) leads 70% of the time through the existing monster sizing instead of checking to the prior aggressor at the V11 initiative gate; the rest keeps the check. Replay of the 131 flagged decisions on main: 48 still checked at that gate, 19 of them qualifying hands. Read === true, default OFF.",
    '2026-11-15'
  ),
  flag(
    'omahaTightOpponentSteal',
    '2026-11-14 owner ruling 17:42 Chicago (Omaha tight requirement stays; a defensible response must be built and evaluated): Omaha high variants in OMAHA_TIGHT_STEAL_VARIANTS (six-card only), the STEAL half of omahaTightOpponent alone (first in from late position or the small blind, every player left to act a PROVEN tight folder: the open bar comes down by half the fold-equity surplus over a pot-sized open break-even, at most 0.10); the respect half is excluded because, measured alone on six-card, it is undecided with a negative cash point estimate. Default OFF (read === true). Evaluation: plo6-audit-01TLQer9Hdf/phase1-play/tight-plo6-league (development persona fields; production reach against people was 0 of 12 six-card records on 2026-11-14). Default-on needs docs/horse-default-on.d/omahaTightOpponentSteal.md with the eight rows.',
    'Omaha tight steal'
  ),
  flag(
    'readScopedShrink',
    '2026-11-08 (read calibration follow-up) below 40 scoped hands a read no longer falls back to the pooled bucket (every game mixed: about 8% of read spots, river-fold Brier 0.262 against 0.217 scoped); the scoped bucket answers with each rate shrunk toward the same scope population (every tracked player summed, no labels) with 16 pseudo-observations and its own opportunity counts, so sample gates still measure this game; default off, measured by the calibration replay (a league table deals one game, so the flag is inert there by construction)',
    'Read calibration'
  ),
  flag(
    'planFingerprint',
    '2026-11-05 (Decision Readiness Items 21 and 23, activation of the dormant #9351 helpers) a planned multi-street barrel records, through the accepted-wager effect sink, the next-street state it expects (every live contender hero included; effective stack and pot once the wager is matched once; public information only) and the next street compares the state that actually arrived against it (HorseContinuationPlanInvalidation.evaluateMultiStreetBarrelContinuation): a contender the plan never expected, a stack-to-pot exposure more than 65 percent from the planned one, or a scare card under pressure withdraws the plan before it fires and the decision runs the ordinary ladder; the card class is recorded as the causality tag while V39 keeps its measured authority over good, blank and scare cards; explicit off arm keeps the unconditional plan',
    'Items21And23'
  ),
  flag(
    'v80TopPairStrongKicker',
    "2026-11-02 (Phase 2 of the Burls/Dan top-pair program) the V79 0.25 equity cap is extended to hold'em top pair with a T-or-better kicker not pairing the board, in V79 cell A ONLY (turn/river wager >= 0.9 pot, board top Q+, > 60bb effective, not a heads-up table, not a bounty/PKO/mystery-bounty event), where the decision EV of the horses' own calls (net + chips already in, bb; chops at their fractional return; later streets included; hand_history + ca_hand_facts, old engine eed06fe5, CIs clustered by hand) was below zero on two independent days: T-Q kicker -46.02bb [-54.03, -38.01] n 557 pooled (each day and each of T, J, Q below zero alone), K-A kicker -29.82bb [-45.42, -14.22] n 178 pooled (day 2 below zero alone, day 1 straddled); turn calls followed by more river chips -53.12bb and last-commitment turn calls -24.45bb, both below zero; cell B (0.6-0.9 pot) with a T+ kicker is NOT admitted (turn calls straddle, one day only); a measured over-bluffer keeps today; limits: only the horses' calls are observed, ICM not modelled, the price ignores players to act behind; explicit off arm keeps today",
    'V80'
  ),
  flag(
    'v78NoCommittingBluffRaise',
    '2026-11-02 (Dan: "I GET RANDOMLY RAISED ON THE TURN AND THEN THE HORSE JUST CALLS OFF AN ENTIRE STACK WITH A10"; hand 6a30e154: A-T, 8-6-9-3, check-raised a 15 bet to 67 with 84 effective, then called the jam) a hold\'em postflop semi-bluff or check-raise bluff raise (the generic semi-bluff branch, which needs no real draw, and the V8 scare-card check-raise) that legalized is NOT all-in yet puts 40% or more of hero\'s remaining stack in is not made: a stack that small cannot fold to the re-shove, so the never-raise-to-fold rule turns it into a forced call-off; the hand falls through to the priced call / fold verdict and its barrel plan is withdrawn; all-in sizings, smaller raises and every value raise (two pair+, the value branch) untouched; every random roll consumed in its original order; explicit off arm keeps today',
    'V78'
  ),
  flag(
    'v70FacingOpenZone',
    "2026-11-05 two- and three-handed no-limit hold'em facing action (an open, a limp-raise, any wager) plays jam-or-fold only inside the short-handed V70 zone (<= 15bb, 12bb without the M layer) instead of the table-size-scaled M zone (red M <= 22bb), which had left every 20bb spin and heads-up stack jam-or-fold facing a raise (3-handed 20bb league, mind on, 100,000 hands: big blind vs a button min-raise off folded 18,490, jammed 2,847, called 112; on folded 5,122, called 12,764, jammed 3,032, 3-bet 1,093), so almost no button-vs-big-blind single-raised pot reached a flop; measured on minus off +6.34 +/- 0.59 bb/100 spin 20bb, +6.35 +/- 0.56 spin 18bb, +5.02 +/- 0.80 heads-up 20bb, inert at spin 25bb (+0.08 +/- 0.11); the open (V70), the <= 15bb zone, four or more dealt, short deck, fixed limit and Omaha unchanged; league measurement in docs/changelog/2026-11-05-v31-spin-facing-open-and-satellite-scenario.md; explicit off arm keeps the jam-or-fold answer",
    'V82'
  ),
  flag(
    'huBbDefendsToPrice',
    "2026-11-07 default OFF: heads-up no-limit hold'em cash, the big blind facing the only open (no limp, no caller, open <= 6bb, 20-150bb effective) continues every hand whose all-in equity against the opener's measured range (opponent read RFI/PFR width when engaged, else the V70 heads-up open target 72% cash / 76% ante; equity table HorseHuBbDefence.HU_BB_EQUITY, Monte Carlo, scripts/generate-hu-bb-defence-equity.ts), times a 0.8 out-of-position realisation, covers the rake-aware pot odds; measured before (real HorseLogic.decide, live cash Hybrid persona, 80bb, 4,000 samples per class): the SB opens 71.3% and the BB folds 57.4% to it (T6s, 96s, Q9o, K5o fold) because two-handed tables never reach the V72 per-seat defence and the V11 heads-up bar (t(0.30) less 0.06, V34 floor 0.30) reads neither the price nor the opener's width; widen-only (a fold becomes a call), 3-bets, six-max, tournaments, Omaha, short deck, pot and fixed limit unchanged; league hu_bb_defends_to_price; docs/changelog/2026-11-07-horse-hu-bb-defends-to-its-price.md",
    'HuBbPrice'
  ),
  flag(
    'huBbDefendsUnreadToPrice',
    "2026-11-15 default OFF (HU-NLH-001d): heads-up no-limit hold'em, exactly two dealt in, the big blind facing the only open (no limp, no caller, opener not all in, open above 1.05bb and at most 6bb), 20-50bb effective, the opener with NO engaged RFI/PFR read (HorseOpponentExploit.openerRangeWidth null; mind off counts as no read), calls a hand the heads-up bars fold when the class's all-in equity against the V70 heads-up reference open width (72% cash, 76% with an ante; HorseHuBbDefence.HU_BB_EQUITY) times a 0.7 realisation covers the rake-aware pot odds; cash, and a tournament only when its trusted context says exactly two players are left in the event and it is not a satellite (payout linear in chips; missing or untrusted context stands aside); why: huBbDefendsToPrice was not supported by its declared evaluation HU-NLH-001c (H50 +0.53 +/- 0.46 bb/100) because the 58.7% fold at 15-50bb is a no-read defect (live adapts to a read min-raiser, fold 2.2%; reads off the old flag read +16 to +19 bb/100 against a min-raiser at 25-40bb) and the mirror priced the added bottom-of-range calls at about 0.7 realisation, not 0.8; widen-only and call-only (no raise, no size change, no call removed), an engaged read, more than 50bb, three or more dealt, larger-field tournaments, satellites, Omaha, short deck, pot and fixed limit, straddles, bomb pots and all-in-or-fold unchanged; evaluation DECLARATION-HU-NLH-001d (heads-up audit round 2); league human_hu_bb_defends_unread_vs_minraise_40bb; docs/changelog/2026-11-15-heads-up-big-blind-defends-unread-to-price.md",
    'HuDefence'
  ),
  flag(
    'huOpenerDefendsToPrice',
    "2026-11-14 default OFF (HU-NLH-010): heads-up no-limit hold'em cash, exactly two dealt in, the small blind that made the only open and faces exactly one 3-bet of 1.8x-7x that is not all in, 20-150bb effective, calls a hand its bars fold when the class's all-in equity against the 3-bettor's range (equity table HorseHuBbDefence.HU_BB_EQUITY read as a linear range: the opponent read's re-raise share when engaged and 20% or wider, else the 20% reference, the narrowest column; a read narrower than 20% has no column and the fold stays), times a 0.85 in-position realisation, covers the rake-aware pot odds, under the same stack cap as the existing call; measured before (heads-up audit, real HorseLogic.decide, mind off): the opener folded 81.0-92.2% of its opens to a 3-bet across 17-150bb and four sizings against a break-even of 62.5-66.7% (22-66, A2s-A9s, AJo, ATo, T9s, 98s folded in 20 of 20 seeds), 90.2% of 6,107 in play at 40bb, because two-handed tables never reach the V73 per-seat read (three or more dealt) and the general bar continues about the top tenth of all hands; widen-only and call-only (a fold becomes a call; no 4-bet, jam or sizing changes), three or more dealt, tournaments, Omaha, short deck, pot and fixed limit, straddles, bomb pots and all-in-or-fold unchanged; not proposed for activation (the owner's preflop range hold governs); league human_hu_opener_defends_vs_wide_40bb (2026-11-15; the every-hand 3-bettor card was inert and is retired); docs/changelog/2026-11-14-heads-up-opener-and-limper-defend-to-price.md",
    'HuDefence'
  ),
  flag(
    'huLimpDefendsToPrice',
    "2026-11-14 default OFF (HU-NLH-011): heads-up no-limit hold'em cash, exactly two dealt in, the small blind that limped and faces exactly one raise to 6bb or less that is not all in, 20-150bb effective, calls the limp its bars fold when the class's all-in equity against the raiser's range (HorseHuBbDefence.HU_BB_EQUITY read as a linear range at the 20% reference, the narrowest column, never widened by a read because no read measures a raise over a limp; an engaged raise read narrower than 20% has no column and the fold stays), times a 0.8 realisation, covers the rake-aware pot odds; measured before (heads-up audit, real HorseLogic.decide): the limp is 14-15% of cash deals to 50bb and folded 100% to a raise to 3bb, 4bb, 6bb or all in at every depth 17-150bb, 98.8% of 2,672 in play at 40bb, a min-raise laying 3:1 included, because the limp band sits below every call bar of the single-raise branch; the price decides, so the call thins as the raise grows (law sweep over all 169 classes at 40bb: 109 call a min-raise, 38 a raise to 2.5bb, 21 to 3bb, 3 to 4bb, none above 6bb) and most limps still fold to the 3.5-4.5bb raise the horses themselves make; widen-only and call-only (the limp itself, limp-raises and every existing call unchanged), three or more dealt, tournaments, Omaha, short deck, pot and fixed limit, straddles, bomb pots and all-in-or-fold unchanged; not proposed for activation (the owner's preflop range hold governs); league human_hu_limp_defends_vs_minraise_40bb; docs/changelog/2026-11-14-heads-up-opener-and-limper-defend-to-price.md",
    'HuDefence'
  ),
  flag(
    'huSmallBlindStealsVsTightBigBlind',
    "2026-11-15 default OFF (D6 of the heads-up serving policy, Hand Analysis grade 2026-11-15): heads-up no-limit hold'em, exactly two dealt in, the small blind first in with no limper and no prior action, 20-150bb effective, opens every hand when the big blind is a proven tight folder (HorseHuTightBigBlindSteal.huTightFolderRead over the same decayed holdem:hu counters opponentRead reads: at least 15 decayed hands, VPIP credibly at or below 0.6 of the heads-up population mean on the Omaha tight read's posterior, no preflop statistic engaged high, no maniac width, the fast window not raising again) and his estimated fold share 1 - 2 x VPIP (posterior mean VPIP; heads-up he is taken to be the big blind in half the hands; walks and limped pots not separated; an estimate, not a bound) clears the largest heads-up open's break-even on folds alone (cash 3.5bb, tournament 2.5bb ceiling); measured before (heads-up audit replay on a7965514 and again on main 47c055ce, real HorseLogic.decide): against a big blind folding about 91% the small blind's first-in decisions changed in 0 of 507 (raise 78.6%, limp 5.4%, fold 16.0% at 100bb), because the first-in block only asks whether a maniac is behind; cash, and a tournament only when its trusted context says exactly two players are left and it is not a satellite; widen-only (a would-be limp or fold becomes an open; no size or jam change, nothing facing action), three or more dealt, Omaha, short deck, pot and fixed limit, straddles, bomb pots and all-in-or-fold unchanged; read thresholds and calibration unchanged; league human_hu_sb_steals_vs_nit_40bb; docs/changelog/2026-11-15-heads-up-small-blind-steals-vs-a-tight-big-blind.md",
    'HuDefence'
  ),
  flag(
    'committedStackPricedIn',
    "2026-11-13 default OFF (study HVH2D-NLH-M-COMMIT and HVH2D-NLH-007a): no-limit hold'em tournament, Phase 6 multiway all-in branch (two opponents all in, or one all in plus a caller or a raise), the priced-in guard in decidePreflopV7 no longer stands aside for that branch when the price is 0.05 or better, when 2bb or less remain behind and either the hand clears 0.26 or the price is 0.12 or better with two opponents or fewer in the hand and no pay jump live (three ways the worst two cards hold about 0.12 against two tight ranges; with three or more opponents the 0.26 floor applies above the 0.05 token price), or when the hero has half or more of the stack it started the hand with in the pot and the hand clears 0.26 (v87PricedInMinStrength's tournament floor); a committed hand at 0.5 or better whose call is all in is priced in up to 0.18; with a pay jump live (hand for hand, near or one off the bubble in any field size, in the money, a satellite, or an unknown payout context) the rule makes no call that can bust the Horse: the 2bb clauses and the 0.18 all-in bar stand aside, and the half-stack clause acts only when the call leaves more than 2bb behind, so those spots decide as with the flag off above the 0.05 token price; two-card no-limit hold'em only: Omaha, short deck, fixed limit and pineapple decide as with the flag off; measured before (six development-packet spots rebuilt from stored hand facts with the live M state, HorseLogic.decide at a89093a1, 12 context variants x 12 seeds): 33, 77, A8s (31 chips into 6,062), A7o, QJs and J8o folded 144 of 144 each, the reference proposal itself, because line 'multiway_all_in return out' switched the guard off; with the flag on 33, 77, A8s, A7o and QJs continue and J8o (junk, arbiter prefers the fold) still folds; a fresh multiway decision, the deep-stack control, cash and every other node are unchanged and the tournament utility arbiter still runs after it; no league evidence for the rule as it stands (one seed of card mtt6_committed_stack_priced_in_4bb, +6.58 +/- 0.74 bb/100, predates the 0.26 floor and the price rule on the 2bb case); enabling it is a separate owner decision",
    'CommitPrice'
  ),
  flag(
    'holdemPersonaReRaiseMix',
    "2026-11-14 default OFF (D3 option C, owner ruling 2026-11-13: persona-specific 3-bets and squeezes, rollout gated; shallow four-bet reshoves are NOT persona-specific: that part of the plan line was not delivered, by the owner's decision R3-B of 2026-11-13, and every reshove is exactly what it is without the option): two-card no-limit hold'em only, cash and tournament, a Horse with an id; the 3-bet bluff (facing one open) and the squeeze bluff (the V7 squeeze site, and on hold'em cash the chart 3-bet-bluff block when there are callers) still consume their random draw at the same place and discard it, and fire when the Horse's zero-draw unit (hash of Horse id, hand identity, exact hole cards, a salt per behaviour) is below min(1, p * scale), scale = the Hold'em persona's nlh3BetMix / 0.42143 (the id-hash model mean; 0.52 to 1.52); value 3-bets, value squeezes, every four-bet reshove, Omaha, short deck, pot limit, fixed limit, hi-lo, pineapple and All-In-Or-Fold do not read it; the unit is deterministic per hand: Horse id, the hand (table id and hand number from opts.mindPlanContext.hand), exact hole cards and the behaviour's salt, with no seat, stack or pot; the live worker derives the hand from the decision snapshot's fence for the fast decision and the deep second look alike, a retry carries the same table and hand, and exact replay feeds the journaled snapshot through the same worker runtime, so it derives the same value (opts.mindObservationHand is not used: the deep look is not given it); the league card and the probe supply a hand; a caller that supplies none gets a named FALLBACK keyed on mutable public state (seat, dealer, stack, pot), which is not per hand and is counted by holdem_persona_hand_identity_fallback_seen; against a raiser the opponent-style read classifies as tight the scale is held at min(1, scale), so the persona never raises a bluff against a tight player: HorseLogic asks the read itself (HorseMind.styleReadUncounted, then the same tightOpenerRespect / tightReRaiserRespect classifiers the option styleTightReRaiserRespect uses) whatever that option's state (off, shadow, on) and at every depth, applying nothing of the style option and firing none of its receipts; the cap DEPENDS ON THE READ BEING AVAILABLE: with opponent memory off, no profile, a presumed read or too little data to be actionable the opener is unknown, not tight, and the scale is not held; the 3-bet and squeeze bluffs lose frequency where min(1, p * scale) binds AND wherever p is above 1 / 1.519 (about 0.66), where a Horse above the average cannot go past 1 while one below still goes down; All-In-Or-Fold hold'em receives the context field but no site reads it; a preflop range change, not to be enabled while the range hold stands; no league evidence yet; enabling it is a separate owner decision; docs/changelog/2026-11-14-holdem-persona-reaches-re-raise-bluffs.md",
    'PersonaReRaise'
  ),
  flag(
    'holdemPersonaPostflop',
    "2026-11-15 default OFF (persona promises P17 and P21, postflop half; HorseHoldemPersonaPostflop): in two-card no-limit hold'em the V87 out-of-position flop check-trap and the flop check-raise into a stabber read the persona's trapFrequency in place of the fleet 0.42 (trapFrequency over its model mean 0.311, at most 0.72), the turn takeaway is scaled by archetype (Nit Hunter 1.30, LAG 1.00, TAG 0.9375, Tricky 0.90) and the heads-up in-position dry-flop range continuation bet by archetype (LAG 1.12, TAG 1.00, Tricky 0.94, Nit Hunter 0.88); each scale has a share-weighted fleet mean of 1 and the two bluffing scales never exceed 1 against an opponent the style read classifies as tight. No new draw: each site keeps its own per-spot unit. Not All-In-Or-Fold. Read only as === true.",
    'PersonaPostflop'
  ),
  flag(
    'holdemPersonaPreflop',
    "2026-11-15 default OFF (plan lines 85 and 152; owner order 2026-11-15 08:05 Chicago to build the missing persona promises; range-width part needs the owner's decision under the preflop range hold, packet PACKET-PERSONA-PREFLOP-20261115.md): one option for the Hold'em persona's preflop layer (HorseHoldemPersonaPreflop), two-card no-limit hold'em only. (1) It turns on the persona re-raise mix (everything holdemPersonaReRaiseMix does: 3-bet and squeeze bluffs on the Horse's zero-draw per-hand unit, scaled by nlh3BetMix / 0.42143, held at min(1, scale) against a raiser the style read classifies as tight; four-bet reshoves are not persona-specific, owner decision R3-B). (2) On V87, V85 cash action tables deeper than 50bb, not All-In-Or-Fold, the seat's opening share (gtoOpen70, the iso bar over 1-2 limpers included) and the defender's continue share facing one open (gtoDefend72, before the V87 multiway widening) move by the archetype's fixed points: LAG Shark +4 / +1.5, Tricky Trap 0 / 0, TAG Crusher -1 / -2, Nit Hunter -3 / -3, times the V85 depth weight (0 at 50bb or less, full from 85bb); the continue share never goes below the value 3-bet share or above 88 percent; the value bar, the bluff probability, nlhOpeningTightness and referenceNlhOpenings (the Hybrid protection of calibrated opening widths) are not read or written; on a table with a VPIP floor a negative shift is withheld (counted by holdem_persona_floor_held_seen). (3) The Nit Hunter's described behaviour, preflop half: facing a raiser the existing exploit read holds credibly wide (one raise) or a limper it holds credibly loose (never a presumed read; needs opponent memory), a Nit Hunter's shift becomes +2 open (isolation) / 0 continue instead of -3 / -3 (the existing exploit layer's own wider value 3-bets and isolation against such players are unchanged and apply to every Horse); the postflop half ('stabs capped checked ranges') is not built. Tournaments, Omaha, short deck, pot limit, fixed limit, hi-lo and All-In-Or-Fold get no range shift; tournaments still get the re-raise mix. No draw is added, removed or moved; nothing reads a realised frequency. Measured, Horses against Horses, synthetic ids, preflop only: see docs/changelog/2026-11-15-holdem-persona-preflop.md; enabling it is a separate owner decision",
    'PersonaPreflop'
  ),
  flag(
    'nashCallVsJam',
    "2026-11-07 default ON (league nash_call_vs_jam, mirror, two seeds x 20,000 pairs: MTT six-max 10bb +4.72 +/- 0.64 / +3.41 +/- 0.63, 15bb +2.40 +/- 0.68 / +2.17 +/- 0.68, nine-max 12bb +1.82 +/- 0.42 / +2.23 +/- 0.44, heads-up 12bb +4.86 +/- 1.17 / +3.89 +/- 1.16, cash six-max 12bb +0.80 +/- 0.38 / +0.78 +/- 0.39, 20bb cards neutral or inert, none below; the human-calibrated field never open-jams so its cards are inert): no-limit hold'em, hero folded to a lone open-jam (the first and only raise, all in, nobody has called) at <= 20bb effective calls or folds from the chip-EV Nash jam-or-fold table's CALLER side (HorseNashPushFoldV2.data.ts, server/scripts/nash-push-fold/solve.py --v2: first caller only, exact card removal) by the jammer's dealt-in players behind (1..9), hero's caller kind (unposted seat, small blind, big blind), effective depth and dead ante, cash and tournament; measured before (HorseLogic.decide, live Hybrid personas, production memory_charts_gold hydrated, 24 samples per class): a big blind facing a button jam called 5.2% at 10bb and 9.8% at 20bb in cash and 6.3% at 10bb and 20bb in a big-blind-ante tournament, against Nash 23.1% / 11.5% and 38.2% / 19.6%, and only the big blind against a small-blind jam had a chart (sb_push, the no-ante game, which keeps that spot when there is no dead ante); a maniac's jam keeps the maniac pricing; explicit off arm retained; deeper jams, called jams, Omaha, short deck, pot and fixed limit unchanged; league nash_call_vs_jam; docs/changelog/2026-11-07-nash-push-fold-v2.md",
    'NashV2'
  ),
  flag(
    'aofClosingSeatNashCall',
    "2026-11-15 default OFF (HVH2D-NLH-005, draft #10653, owner hold): All-In-Or-Fold no-limit hold'em table, cash or tournament (the flag is set on All-In-Or-Fold tournament tables too), hero facing a lone all-in (one raise, the raiser all in, no caller, no limper, hero has not acted, no straddle) answers from the nashCallVsJam caller table (nashV2CallProbability) only when the effective stack is 12 big blinds or less (NASH_AOF_CLOSING_CALL_MAX_BB) and hero closes the action (everyLiveOpponentIsAllIn: every other player still in the hand is all in; a sitting-out seat is not a player behind); the call is returned as all_in; otherwise, and with the option off, the fixed All-In-Or-Fold strength bar decides as before; measured before (development data, HVH2D-NLH-005 equity rows, closing seat at 12 big blinds or less): 17 of 41 folds against Horse all-ins gave up a profitable call against the table's range, 11 against half width, 0 against a top 10 percent range; 3 folds against human all-ins, none profitable; fixed-input replay: six real closing-seat requests from the production journal (Q9s small blind with the big blind sitting out, five big blinds at 4.4 to 12 big blinds) fold on main and with the option off and go all in with it on, on 12 seeds and from the recorded generator state; seats with a player behind, depth above 12 big blinds and every table that is not All-In-Or-Fold unchanged; tournament utility arbiter still runs after it; no league card (refused matchup aof_closing_seat_nash_call: the league deals no All-In-Or-Fold table); docs/changelog/2026-11-12-an-all-in-or-fold-closing-seat-calls-from-the-nash-table.md",
    'AofClosingSeat'
  ),
  flag(
    'nashPushFoldIcm',
    "default OFF (owner preflop range hold; the option switch registers it off-only). 2026-11-15 (hand 59441335: a 2.1bb in-the-money final-table cutoff open-jammed 85o from the chip-EV table): with explicit true, a no-limit hold'em tournament short stack in the money, hand for hand or near the bubble, with stacks, payouts and its identity in the trusted context, not in a satellite, PKO or mystery bounty and with a payout weight above zero, prices the V71 folded-to jam and the nashCallVsJam call at its own bubble factor (a bust valued at the place it finishes, IcmModel bubbleFactor since 2026-11-15; the call priced on the chips contested) moved toward 1 by prize / (prize + bounty) (HorseLogic payJumpBubbleFactor; receipt pay_jump_push_fold_seen), and every other spot reads the V2 table at a bubble factor of 1; nashPushFoldIcm on implies the paid-bust valuation of icmBustPaysPlace for the decision (HorseLogic.decide, Hand Analysis D1), so the short stack never reads the cap of 5 from a zero-valued bust; unset or false is chip EV, as before; league card mtt6_ft_pay_jump_push_fold_12bb; prepared evidence for lifting the hold docs/horse-default-on.d/nashPushFoldIcm.md; docs/changelog/2026-11-15-short-stack-shoves-price-the-payouts.md. 2026-11-07 shipped as an opt-in: in a tournament the V71 folded-to jam and the nashCallVsJam call read hero's best response at hero's own bubble factor (IcmModel bubbleFactor from the live stacks and payouts, the V16 real-ICM inputs; 1 when the context cannot supply them) against the chip-EV equilibrium of everybody else (HorseNashPushFoldV2, bubble factors 1/1.5/2/3 interpolated), and a ten-handed seat reads nine behind exactly instead of the eight-behind table; with a bubble factor of 1 and at most eight behind it is the V71 answer exactly; docs/changelog/2026-11-07-nash-push-fold-v2.md",
    'NashV2'
  ),
  flag(
    'facingOpenFullRingZone',
    "2026-11-07 default OFF: four or more dealt, no-limit hold'em FACING action (never the open) reads the <= 15bb jam-or-fold zone V82 gave two- and three-handed tables (stack <= 12bb, or the M layer and <= 15bb) instead of the table-scaled M zone (red M < 6 up to 22bb); measured before (HorseLogic.decide, tournament Hybrid persona, 1bb big-blind ante, 24 samples per class): at 20bb the big blind folded 88.6% to a button 2.5bb open six-handed (M 4.8) and four-handed (M 3.2) against 27.4% nine-handed (M 7.2), and 90.9% to an under-the-gun open six-handed; on, 28.1% and 46.6%; the open (the orange-zone shove, an owner decision), <= 15bb, short deck, fixed limit and Omaha unchanged; league facing_open_full_ring: mirror four-handed 20bb +1.38 +/- 0.79 / +2.82 +/- 0.80, six-handed 20bb +0.56 +/- 0.60 / +0.07 +/- 0.60, human-calibrated six-handed 20bb -3.13 +/- 2.00 / -1.54 +/- 2.24 bb/100, not significant on both seeds, so it stays off; docs/changelog/2026-11-07-horse-preflop-defence-leaks.md",
    'PfLeaks'
  ),
  flag(
    'vs3BetShortStack',
    '2026-11-07 default OFF: the V73 opener-facing-one-3-bet read reaches 12bb effective (V73_SHORT_MIN_EFFECTIVE_BB) instead of 25bb, and a hand the read continues whose call the stack cap refuses (the call is the stack) jams instead of folding; measured before (HorseLogic.decide, live personas, 24 samples per class): a 20bb button facing a big-blind 3-bet to 11bb folded 97-98% of its 45% open in cash and in tournaments; on, it jams about half its open; league vs3bet_short_stack: see docs/changelog/2026-11-07-horse-preflop-defence-leaks.md (one human-calibrated seed below -2 stderr, so it stays off)',
    'PfLeaks'
  ),
  flag(
    'omahaCommitZoneThreeBetPriceRelief',
    '2026-11-14 default OFF: six-card Omaha high in the V25 PLO commitment zone facing a re-raise takes the facing-3-bet price relief max(0, 0.5 - odds) * 1.6 instead of (0.4 - odds) * 1.2; development human field, chips only, paired 200 x 200 PLO6 MTT 40bb: +6.83 +/- 3.78 (seed 20261120) and +7.62 +/- 3.77 (seed 20261130) bb/100; PLO5 and PLO6 100bb cash byte-identical; payout (ICM) not measured, so it stays off; PLO6 tournament-folds study FINDING.md follow-ups A, D, E',
    'PfLeaks'
  ),
  flag(
    'fixedLimitCallIsNotACommitment',
    "2026-11-14 default OFF: a fixed-limit call is never priced in the committed branch (no stack-to-pot or invested-share term, so no V20 multiway commit bar or stack-off shade); it is priced on its incremental cost plus the remaining action of the street (HorseFixedLimitCallPrice.ts: the chips to call now plus the expected further wagers if a player left to act raises before the cap, at a per-player raise rate MEASURED on recorded Horse-only fixed-limit hands (2026-11-15: 95% upper bounds per street, flh 1.4/3.3/4.2%, flo8 0.8/1.9/2.7% flop/turn/river; was an assumed 0.12); a closing call is the bare raked price), as a shade on the equity the V38 river and flop/turn verdicts are handed; scope since 2026-11-16: fixed-limit hold'em cash only (HorseLogic fixedLimitCallIsNotACommitmentInScope), so at flo8 and at every tournament table it changes nothing (flo8 showed no value: AB-EVALUATION-2 3.7 and 3.15); diagnostic harness before (L-ADAPTATION-DIAGNOSIS section 3): flo8 six seats, every river fold took the committed branch, required 3.4 x the price; refused by the league (it deals no fixed limit), see UNMEASURABLE_MATCHUPS",
    'FixedLimitAdaptation'
  ),
  flag(
    'fixedLimitReadIgnoresProbes',
    '2026-11-16 default OFF (Fixed-Limit lane W4, "F1b", its own option since 2026-11-16): at a fixed-limit decision, with the F1 process switch on (fixedLimitBetsAreNeverProbes), an opponent pooled no-limit/pot-limit probe share does not discount his fixed-limit aggression reads (HorseMind.fixedLimitReadIgnoresProbes: probeAdjusted, omahaTightReadOf, style read, streetBullyRead fallback); no-limit and pot-limit reads unchanged; measured (AB-EVALUATION-2.md 3.1, 3.10): no harm at six seats, gains against a seeded maniac (flh +17.29 +/- 6.71, flo8 +29.23 +/- 19.67) but value NOT DEMONSTRATED over three seeded ranges (tight-value and gear-changer cells inert or slightly negative), so it stays off',
    'FixedLimitAdaptation'
  ),
  flag(
    'fixedLimitHiLoLowHalfFloor',
    '2026-11-14 default OFF: on a fixed-limit hi-lo river the V40 weak-high pressure cap never goes below half of the sampled low share (HorseHiLoLowHalf.ts), heads-up and multiway; the share already carries ties, so a quartered low keeps its quarter; measured before (L-ADAPTATION-DIAGNOSIS section 3): flo8 six seats, pair+low and high+low river hands with a low half of 0.46 and 0.59 were capped to 0.10 and 0.13 at a price of 0.05 and folded 66 of 83; refused by the league (it deals no fixed limit), see UNMEASURABLE_MATCHUPS',
    'FixedLimitAdaptation'
  ),
  flag(
    'fixedLimitPricedPreflop',
    "2026-11-15 default OFF (Fixed-Limit lane W5): fixed-limit cash tables only (inert at every tournament table, !isTournamentMode gate), first in the seat raises the stated reference share by players behind (HorseFixedLimitPreflop.ts; the small blind folded to also completes a band, the heads-up button raises flh 85% / flo8 70%), and a blind's fold facing exactly one raise (no limper, no caller) becomes a call when its realized equity against the opener's reference range covers its pot price (call / (pot + call); rake is inside the realization calibration, not deducted again: 2026-11-15 fix); 3-bet/cap ranges unchanged; the phase12 round-3 FIRST-IN entry rules retain this reference in fixed limit (the big blind defended rule is not held: it could only fold a call)",
    'FixedLimitAdaptation'
  ),
  flag(
    'fixedLimitStealVsTightBlinds',
    '2026-11-15 default OFF (Fixed-Limit lane W5): fixed-limit cash tables only (inert at every tournament table, the same !isTournamentMode gate as fixedLimitPricedPreflop), first in from the cutoff, button or small blind (or the heads-up button), when every player still to act has an own adequate over-folder read (foldToBet engaged high on at least 15 decayed opportunities, not presumed, nothing preflop engaged wide) the open share widens by up to 15 points (HorseFixedLimitPreflop.fixedLimitStealWiden)',
    'FixedLimitAdaptation'
  ),
  flag(
    'fixedLimitRiverStrongHandLeads',
    "2026-11-15 default OFF (Fixed-Limit lane W8): fixed limit only, river, nothing to call, the Horse first to act (no opponent has acted on the river) and the reference checks: a full house or better that at most 12 percent of the opponents' holdings beat (card-exact over the unseen cards with the engine's scorers; hold'em also refuses a board that plays and an under-full boat) bets one big bet instead (HorseFixedLimitRiverLead.ts); hi-lo with a low possible and no Horse low leads only into two or more opponents who can act; an aggressive read on the next opponent to act keeps the check; not facing a wager, not checked to, never all in, never a tournament stack under 20 big blinds; measured before (AD-STRONG-RIVER-CHECKS): first-to-act full+ checks 31-58 percent, flo8 heads-up rivers then check through 42-50 percent; refused by the league (it deals no fixed limit), see UNMEASURABLE_MATCHUPS",
    'FixedLimitAdaptation'
  ),
  flag(
    'fixedLimitOmahaNoPresumption',
    '2026-11-14 default OFF: on a fixed-limit Omaha decision (flo8) HorseMind.opponentRead does not apply the shared aggressive raise presumption (presumedAggressorRead, a pot-limit policy that prices a pot-sized raise); the opponent own measured read stands; pot-limit Omaha unchanged; measured before (O-TIGHT-FL-DIAGNOSIS): a 21-27 percent flo8 raiser (tight-value script) stayed presumed at 1,000 hands and the Horse opened 159 of 400 first-in buttons against him versus 202 with memory off; refused by the league (it deals no fixed limit), see UNMEASURABLE_MATCHUPS',
    'FixedLimitAdaptation'
  ),
  flag(
    'fixedLimitBetsAreNeverProbes',
    '2026-11-15 source default ON since 652726c8 (FIXED_LIMIT_BETS_ARE_NEVER_PROBES_DEFAULT): the live switch of the process switch HorseMind.setFixedLimitBetsAreNeverProbes, not a decision option; the decision worker applies the registry state before every job, so the in-decision observation, the observer reads and the completed-hand learner of the thread count with one value: off counts a fixed-limit checked-to bet as a probe again (main before 2026-11-14), on or no row, unreadable or stale is the source default; no-limit and pot-limit counting identical in every state; evidence docs/horse-default-on.d/fixedLimitBetsAreNeverProbes.md',
    'FixedLimitAdaptation',
    'HorseMind.observe via HorseMind.applyFixedLimitBetsAreNeverProbesOption (decision worker, every job)'
  ),
  flag(
    'lightningParticipationHoldem',
    "2026-11-15 default OFF: Lightning cash no-limit hold'em only (public memory domain speed lightning, four to six dealt, big-blind ante, not all-in-or-fold): where the facing-one-open branch folds the big blind, nobody else in, the (defender, opener seat) continue width gains up to 10 share points for the price the ante lays (90 points per unit of price under 0.31, none at 50bb or less, all from 85bb) and a hand inside it calls; hold'em opens are untouched (they already scale with the ante); no own-participation input, no floor, not applied where a tight-opener respect read moved the bars; development evidence only (HorseLightningParticipation.ts, paired Lightning harness, seeds 20261114-20261118), so it stays off",
    'Lightning participation'
  ),
  flag(
    'lightningParticipationOmaha',
    '2026-11-15 default OFF: Lightning cash PLO4 / PLO5 only (same predicate): first-in raise cells by players still to act (PLO4 20 / 24 / 34 / 42 button / 34 small blind percent of hands, PLO5 20 / 24 / 34 / 40 / 32, +1 point per seat missing from six, x0.9 at 50bb), raise or fold with no new limp, superseding only the raise width PRESUMED of an unread Omaha opponent (an observed maniac or a confirmed aggressive player in position behind keeps the base answer); and where the facing-one-raise branch folds the big blind, a continue range by price (40 / 44 / 50 / 56 percent against an early / middle / late / small-blind raiser at a pot-sized price of 0.33, 120 points per unit of price, -6 per caller capped at 36 multiway, x0.85 at 50bb); 3-bet, 4-bet, stack-off bars, sizing and postflop untouched; no own-participation input; development evidence only, so it stays off',
    'Lightning participation'
  ),
  flag(
    'lightningEarlyFoldNeedsFoldThrough',
    "2026-11-15 default OFF: Lightning cash only (public memory domain speed lightning), preflop, flop and turn: a fold to a priced decision asked while live seats before the Horse still have to act (the Lightning host's early look, which a fold makes final) stands only if the same policy also folds on the fold-through frame (those seats folded; built from public state only, never learned by the opponent model); otherwise the frame answer is returned and the host drops the early fold so the Horse decides afresh on its own turn; no effect at the Horse's own turn, on the river or outside Lightning; measured by the beyond-big-blind probe (development seeds, all-Horse tables), so it stays off; live switch registration via the option switch follow-up migration",
    'Lightning early fold'
  ),
  flag(
    'lightningCheapEntryHoldem',
    "2026-11-15 default OFF, release default OFF (off-only under preflop hold; materially engages alongside lightningEarlyFoldNeedsFoldThrough because without it the small blind early-folds at the deal): Lightning cash no-limit hold'em only (the Lightning participation predicate: public memory domain speed lightning, four to six dealt, big-blind ante, cash preflop, not all-in-or-fold); owner principle 5 (2026-11-15: a VPIP floor is met by the cheapest entry, never by raising): where the unopened branch folds, the small blind folded to completes and the small blind or the button behind one or more limpers (no raise, a call of one big blind or less) over-limps when (1 - r) x R x equity(k random hands) x (pot + call + added behind) x (1 - rake and jackpot fee share) covers the call (R 0.70 out of position, x0.94 at 200bb, 0.80 on the button; r per player behind 0.30 / 0.31 / 0.37 for NLH / PLO4 / PLO5, the measured share of small-blind completions the Horses' own big blind raises in Lightning; equity from the generated 40-bin table on the brain's own preflop order, k the players who can see the flop); never a raise, no other seat, no raised pot, raise ranges, 3-bets, sizing and postflop untouched; an observed maniac keeps the fold; uses unflooredTightness so no own-participation input or floor ever enters; at the Lightning price (engine rake and jackpot fee) the folded-to small blind takes the top 82.5% of hold'em hands at 50-100bb (62.5% at 200bb) and the button over-limp is not cleared; development evidence only (HorseLightningCheapEntry.ts), so it stays off",
    'Lightning cheap entry'
  ),
  flag(
    'lightningCheapEntryOmaha',
    '2026-11-15 default OFF, release default OFF: Lightning cash PLO4 / PLO5 only, the same predicate and the same rule as lightningCheapEntryHoldem with the variant equity table and raise risk (complete or over-limp only where the unopened branch folds; never a raise; composes after the participation first-in raise cells); the folded-to small blind takes every PLO4 hand and the top 77.5% of PLO5 hands at 50-100bb; no own-participation input; development evidence only, so it stays off',
    'Lightning cheap entry'
  ),
  flag(
    'facingClosedAllIn',
    "2026-11-08 default ON: no-limit hold'em (not fixed limit, not short deck) at an effective stack of 40bb or less (CLOSED_ALL_IN_MAX_EFFECTIVE_BB; deeper, the cap keeps a style from stacking off light), hero facing a 3-bet or 4-bet that was made all in with every other player still in the hand all in, folded or sitting out (the call closes the betting and risks exactly the price): the 3-bet node's 35%-of-stack cap and the 4-bet node's 30% cap no longer veto a call the price-aware strength bar makes (the companion 4-bet-node change, the no-limit hold'em call/jam bars no longer multiplying a style tightness above 1, is unconditional source and not under this flag); measured before on 391f7bc0 (2026-11-07 21:20 to 2026-11-08 20:30 UTC, hand_history publicNode): tournament NLH heads-up openers facing a 12-25bb all-in 3-bet folded 205 of 212, six-handed 165 of 173, and replayed through HorseLogic.decide QQ (22bb jam, 43% to call), JJ, TT, AKo, AQo, 99, 88 all folded at the cap, and in cash the Grinder hybrid folded KK at 121bb, QQ, AKo to a sized 4-bet because 0.95 x 1.0976 and 0.88 x 1.0976 both hit BAR_CAP 0.965; opponent identity is never read; Omaha unchanged; explicit off arm restores both caps; docs/changelog/2026-11-08-horse-opener-facing-an-all-in-3-bet.md",
    'F3B'
  ),
  flag(
    'limpReraiseIsoRead',
    "2026-11-07 default ON (exploiter league hx_limp_reraise, paired A/B on the same deals, 4 seeds x 8,000 pairs, horses' gain on minus off: six-max 40bb +12.3 +/- 3.0, 80bb +12.3 +/- 4.8 bb/100; mirror NLH 6/9-max 40/80bb cash and big-blind-ante tournament and the human-calibrated six-max field, two seeds x 20,000 pairs each: every card inert, no horse or human-field player limp-reraises enough to engage it): HorseMind counts, per player, the times a preflop limp met a raise behind it and the action came back, and the re-raises (OpponentStats.lrOpps / lrRaises, pooled, memory only, carried in read frames v12); the rate is shrunk toward a 5% population rate with 10 pseudo-observations, and against a limper whose shrunk rate is above 12% the no-limit hold'em isolation bar rises toward 0.58 strength (about the hands a horse continues against a 4x re-raise; the button over an under-the-gun limp at 40bb isolates 12% instead of 38%), fully at 30%, and the V10 isolation widen is withdrawn against him; nothing changes against a player never seen to limp-raise; explicit off arm retained; HorseLimpReraiseRead.ts; docs/changelog/2026-11-07-limp-reraise-read.md",
    'PfLeaks'
  ),
  flag(
    'commitUnderPot',
    "2026-11-07 default OFF: in a heads-up no-limit hold'em pot on the flop or turn, a horse facing a bet whose remaining stack is smaller than the pot (the bet included) calls instead of folding (all in when the call is its stack) when the chips it puts in against the pot they win need no more than a quarter (HU-NLH-016, 2026-11-13: before that it called any covering shove, 38bb into 4bb included), after every other layer (HorseLogic commitUnderPotCall); the committed branch (stack-to-pot under 1.2) already prices those calls at the pot odds; measured with the rule as it was before HU-NLH-016: exploiter league hx_limp_reraise +6.8 +/- 2.4 (40bb) / +10.4 +/- 4.2 (80bb) bb/100, but the mirror and the human-calibrated field lose with it on every card measured (six-max cash 40bb -2.59 +/- 0.50 / -2.05 +/- 0.52, nine-max cash 40bb -1.68 +/- 0.34 / -1.74 +/- 0.34, six-max tournament 40bb -2.94 +/- 0.58 / -3.25 +/- 0.60, human six-max tournament 40bb -6.17 +/- 1.10 / -4.39 +/- 1.17), so it stays off; the priced rule (HU-NLH-016) failed its declared heads-up evaluation too, 3 of 14 cells below -2 standard errors (every-button min-raiser 25bb -3.06 +/- 1.07, calibrated field 25bb -0.18 +/- 0.06 and 40bb -0.29 +/- 0.11; horse mirror -0.10 +/- 0.14), so it is not a promotion candidate; docs/changelog/2026-11-07-limp-reraise-read.md, docs/changelog/2026-11-13-commit-under-pot-only-removes-a-priced-fold.md",
    'PfLeaks'
  ),
  flag(
    'v77SeatAwareJams',
    "2026-11-02 (Burls via Dan: \"JAMMING ALL IN TOO MUCH, THEY AREN'T CONSIDERING THE UTG OR EARLY POSITION OPENERS\") the no-limit hold'em push/fold jam over exactly one open is tightened by the OPENER'S V70 per-seat open width (dealt-census indexed, ante-aware, HorseGtoVs3BetRanges.openWidth): the bar rises by 0.3 per unit of width the opener's seat does not open against the 40% late reference, capped at +0.10 (an under-the-gun ~12% width lands the 12-15bb bar at ~0.80, the same early bar the Phase 6 reshove node uses at 20bb); measured before (24 h to 2026-11-02 00:21 UTC, 439,087 facing-one-open spots): tournament jam rate 6.82% over an early open vs 8.11% over a late one at <=15bb, 3.53% vs 7.14% at 15-25bb; tighten-only (a 40%+ button or blind width keeps today's bar exactly); first-in jams (V71/V27), the facing-3-bet bar, the HorseTournamentShoveDiscipline caps and Omaha untouched; explicit off arm keeps the seat-blind bar",
    'V77'
  ),
  flag(
    'v76RetireFourBetBluffBand',
    '2026-11-01 (Dan 2026-10-31 rule 4: "HORSES KEEP MAKING THESE WEIRD 4 BETS ANYTIME I 3 BET, THEN FOLD 100% OF THE TIME TO A FIVE BET ... STOP 4 BETTING POTS IF THEY ARE FOLDING") the V7 4-bet-bluff band is retired at the source: the hold\'em brain never generates a sized 4-bet meant to fold; the band\'s hands (blocker-heavy, just under the value bar) take the call-or-fold read directly - the V73/V75 priced width where it applies - instead of being 4-bet and converted to a call by the final layer (rule 4a, receipt holdem_no_four_bet_bluff), which stays in force as the fail-safe for every other path; value 4-bets, sizes, the 5-bet branch and Omaha unchanged; explicit off arm restores the band for the historical corpora only',
    'V76'
  ),
  flag(
    'v74NlhOpenSizes',
    '2026-11-01 (Dan 2026-10-31: "MIN RAISE TO 2.5-4X OPENING RANGES. NOT ALWAYS THE MINIMUM RAISE POSSIBLE"; 2026-11-01: "THEY ARE LITERALLY MIN RAISING IN A CASH GAME THAT DOESN\'T HAPPEN") no-limit hold\'em raise-first-in opens draw from a band chosen by seat, table, format, depth and antes (HorseNlhOpenSize): cash never under 2.5bb (100bb early 2.8-3.5 / middle 2.7-3.3 / cutoff 2.5-3.1 / button 2.5-3.0 / small blind 3.0-3.5, a full-ring early seat +0.25, deep cash +0.25/+0.5 up to 4x, 25bb or less 2.5-2.8, smaller with an ante); tournaments deeper than 25bb open an exact min-raise 20% of the time and otherwise early 2.3-3.0 / button 2.0-2.5 / small blind 2.5-3.2 (smaller with an ante, 25-40bb at most 2.5, small blind 2.8), 25bb or less 2.0-2.3; one unit per limper; three random draws, never the cards; on the chip grid with stochastic rounding so a 1-chip big blind no longer floors every open to 2bb; measured before (40 minutes of production) cash 55% of opens at 2.05bb or less, median 2.00; pot limit, fixed limit and 3-bet sizes unchanged; explicit off arm retained',
    'V74'
  ),
  flag(
    'v52RangeAdvantage',
    'heads-up postflop public-range advantage drives the range c-bet, V38 initiative and PLO small sizes (league v52_range_advantage)',
    'V52'
  ),
  flag(
    'comboDrawPressure',
    'candidate-only legal heads-up cash flop/turn combo-draw pressure, priced against calling with the continuing-range/rake model; default off pending independent incremental qualification',
    'Combo draw pressure'
  ),
  flag(
    'multiwayRiverBluffCheckRaise',
    'separately unqualified default-off extension using exact original-dealt cash context and fully conserved public check/bet/raise/response snapshots; no guessed fold priors',
    'Multiway river check-raise'
  ),
  flag(
    'riverBluffCheckRaise',
    'candidate-only zero-showdown-equity priced 3x river check-raise using own-observer same-line fold responses; default off pending qualification',
    'River check-raise'
  ),
  flag(
    'riverPositionDefense',
    'candidate-only priced HU cash river defense against a credible wide entrant whose own public conditional last-to-act betting rate is excessive; default off pending independent qualification',
    'River position defense'
  ),
  flag(
    'v53PloTourneyIcm',
    'default-off candidate: PLO4/5/6 standard tournament preflop action-risk ICM shifts, requires independently qualified whole-tournament comparison',
    'V53'
  ),
  flag(
    'v53Pressure',
    'read-gated pressure on a credibly aggressive human: wider in-position 3-bets, flop/turn value and semi-bluff raises of a wide bettor, river bluffs into a credible over-folder (league v53_pressure)',
    'V53'
  ),
  flag(
    'v58Plo6RiverNuts',
    'PLO6 paired-board river nut discipline: facing a bet, fold a hand a random six-card hand beats 15% of the time unless the price is tiny, and call instead of raising one beaten 5% of the time (league plo6_v58_river_nuts)',
    'V58'
  ),
  flag(
    'v59Plo6RiverUnpaired',
    'PLO6 unpaired-board river discipline: facing a bet, fold a hand a random six-card hand beats 30% of the time unless the price is tiny, and call instead of raising one beaten 15% of the time (league plo6_v59_river_unpaired)',
    'V59'
  ),
  flag(
    'drawOutlookQuality',
    'NLH continuation planning excludes shared board improvements and dirty straight outs; false retains the historical outlook for paired offline comparisons',
    'Draw outlook quality'
  ),
  flag(
    'committedRaiseDiscipline',
    'the existing NLH raised-hand call-only rule also guards the earlier committed-stack branch; false isolates the historical branch for paired offline comparisons',
    'Committed raise discipline'
  ),
  flag(
    'callDeductionPricing',
    'canonical cash calls price actual capped rake and BBJ on matched awards after uncalled returns; false retains the historical marginal-rate approximation for offline comparisons',
    'Net call deductions'
  ),
  flag(
    'v54RiverBluff',
    'targeted heads-up river big bet / shove bluff with air, blockers, a value story, a capped non-station opponent; DEFAULT OFF until league v54_river_bluff and plo4/plo5/plo6_v54_river_bluff resolve positive',
    'V54'
  ),
  flag(
    'flopTurnBluffBaseline',
    'baseline flop and turn bluff and semi-bluff range (HorseFlopTurnBluffRange): qualified draws, backdoors, overcards and blockers bet, and draws raise, at the solved frequency for their class on a line that tells a story; reads reshape it and never switch it off; default on, false ablates (2026-11-07)',
    'Flop/turn bluff baseline'
  ),
  flag(
    'riverBluffBaseline',
    'baseline heads-up river bluff range (HorseRiverBluffRange): air and missed draws on a coherent line bluff at the balanced rate for the bet size, blockers first, reads reshaping it and never zero without one; default on, false ablates (Dan 2026-11-06)',
    'River bluff baseline'
  ),
  flag(
    'riverLeadRange',
    'out-of-position river leads (HorseRiverBluffRange): first to act on the river into the turn bettor, bluff-lead rivers that complete the caller draws (blockers first), rarely blanks, never into a credible station, and let value hands through the V11 gate on those rivers; Omaha paired boards never lead; default on, false ablates (2026-11-07)',
    'River lead range'
  ),
  flag(
    'riverBluffHiLo',
    'hi-lo river bluffs with a low possible (HorseRiverBluffRange): the nut low with no high bets the freeroll, air bluffs the whole pot only when the public low chance is at most 0.5 and otherwise checks (no half-pot giveaway); default on, false restores the old domain gate (2026-11-07)',
    'River bluff hi-lo'
  ),
  flag(
    'riverBluffMultiway',
    'multiway river bluffs (HorseMultiwayRiverBluff): two or three opponents, air with a nut blocker on a line that caps the whole field, frequency falling steeply per opponent and multiplying every opponent read (a station near zero), polarized pot-limit-legal size; default on, false ablates (Dan 2026-11-06)',
    'River bluff multiway'
  ),
  flag(
    'riverFastCalldown',
    'the fast call-down read (HorseFastCalldownRead): the river bluff layers (heads-up baseline, its leads, multiway) treat a player whose recent river calling has credibly risen as a station and price with his recent river fold rate; null without recent river evidence; default on, false ablates (2026-11-07)',
    'River fast call-down'
  ),
  flag(
    'probeAwareAggression',
    "probe bets are not aggression (HorseOpponentExploit probeBetIndexes, ExploiterLeague): the share of an opponent's checked-to postflop bets that were probes (a big blind or a fifth of the pot or less) is taken back out of betCheckedTo, so a min-bettor is not read as a maniac whose real bets get called down; default on, false ablates (2026-11-08)",
    'Probe-aware aggression'
  ),
  flag(
    'riverBluffFixedLimit',
    'fixed-limit path of the baseline river bluff range: the one fixed bet, so a low but real balanced share s/(1+s); default on, false restores the #9803 exclusion (2026-11-07)',
    'River bluff baseline'
  ),
  flag(
    'riverBluffShortDeck',
    "short-deck path of the baseline river bluff range: draws and blockers in the engine's 36-card ranking (A-6-7-8-9 a straight, a flush over a full house); default on, false restores the #9803 exclusion (2026-11-07)",
    'River bluff baseline'
  ),
  flag(
    'riverBluffBombPot',
    'bomb-pot path of the baseline river bluff range: postflop stories only, no preflop range assumed; default on, false restores the #9803 exclusion (2026-11-07)',
    'River bluff baseline'
  ),
  flag(
    'riverBluffMultiBoard',
    'multi-board path of the baseline river bluff range: air on every board, blockers and draws read per board, share divided by the board count (V36 rule 2); default on, false restores the #9803 exclusion (2026-11-07)',
    'River bluff baseline'
  ),
  flag(
    'phase7Utility',
    'final action-specific tournament utility across payout, bounty and recovery components; defaults on and runs after every global strategy layer',
    'Phase7'
  ),
  flag(
    'phase8PolicyFamily',
    'internal Phase 8 family: isolated benchmark selection or worker-derived genuine protected guard authority; omitted from public live options and overwritten at the worker boundary',
    'Phase8'
  ),
  flag(
    'phase8Postflop',
    'tournament postflop counterfactual; shadow by default; live candidate mode only under protected-release qualified authority (worker-owned, never caller-supplied)',
    'Phase8'
  ),
  flag(
    'phase10Plo4',
    'bounded PLO4 policy for every street; shadow by default; candidate mode is offline promotion only',
    'Phase10'
  ),
  flag(
    'phase10EvidenceMode',
    'offline fixed-work PLO4 evidence clock; rejected by the live decision worker',
    'Phase10'
  ),
  flag(
    'phase11Omaha',
    'separate PLO5/PLO6/PLO8 policy; shadow by default; candidate selection is offline only',
    'Phase11'
  ),
  flag(
    'phase11EvidenceMode',
    'offline fixed-work variant evidence clock; rejected by the live decision worker',
    'Phase11'
  ),
  flag(
    'phase12Remaining',
    "separate Short Deck/Pineapple/FLH/FLO8 policies; shadow by default; live candidate only from the worker's own P12.3 pack authority (cash), never from a caller",
    'Phase12'
  ),
  flag(
    'phase12EvidenceMode',
    'offline fixed-work remaining-variant clock; rejected by the live decision worker',
    'Phase12'
  ),
  flag(
    'phase14',
    'caller may disable the worker-owned corrective functional policy; never requests candidate authority',
    'Phase14',
    'horseDecision/workerRuntime.phase14Admission'
  ),
  flag(
    'phase14Corrective',
    'branded worker-local original-state corrective capability; refused from IPC and unavailable without qualified catalog and current S4 composition',
    'Phase14',
    'HorseLogic corrective_policy node'
  ),
  flag(
    'phase13Joint',
    "joint multiway and bomb policy; shadow by default; live candidate only from the worker's own P13.3 authority for the decision's variant (cash), never from a caller",
    'Phase13'
  ),
  flag(
    'phase13EvidenceMode',
    'offline fixed-work joint evaluation; rejected by the live worker',
    'Phase13'
  ),
  flag(
    'v43Tempo',
    'tempo reads: a river big bet priced by how fast it was made against what this player shows down at that tempo',
    'V43'
  ),
  flag(
    'v41Leaks',
    'diagnostic telemetry for ignored historical review fields; never authorizes policy or sampling changes',
    'V41'
  ),
  flag(
    'v86UnblockedPreflop',
    '2026-11-10 unblocked preflop matrix across NLH and PLO4/5/6 cash and tournaments: dynamic preflop orbit raise normalization, incomplete short-stack shove handling, straddle/kill blind unopened routing, PLO5/6 suit/core Pigeonhole and sub-core trips rules, V38 uncapped-behind population guard, Seven-Deuce and Kill Pot overlays, asymmetric cover/satellite ICM, PKO chip equivalence, and Phase 7 non-terminal preflop utility; default ON, explicit false preserves historical replay corpora',
    'V86'
  ),
  flag(
    'v86MultiStreetUnblocked',
    '2026-11-10 explicit Flop->Turn->River continuation planning (ExplicitContinuationPlanV2), exact geometric street sizing solver, instant dynamic node re-evaluation, combinatorial card-removal fold-equity scoring, public action-line Bayesian range posterior, correlated multi-board scoop/quarter pricing, and public-complexity tank weighting; default ON, explicit false preserves historical replay corpora',
    'V86'
  ),

  // ─────────────────────────────────────────────────────────────────────────
  // STYLE PARAMS. base style x profile dials x variant overlay x persona.
  // ─────────────────────────────────────────────────────────────────────────
  ...(
    [
      ['tightness', 'preflop width multiplier (profile dial x variant tightnessMul)'],
      ['aggression', 'bet/raise volume multiplier (profile dial x mood)'],
      ['bluffFreq', 'bluff volume multiplier (profile dial x variant bluffMul x mood)'],
      ['sizingMultiplier', 'bet size multiplier (profile dial)'],
      ['slowplayFreq', 'monster trap frequency (variant slowplayMul; balanced capped 0.14)'],
      ['checkRaiseFreq', 'OOP check-raise lean (variant checkRaiseMul)'],
      ['thinkRange', 'think-time band for V9 timing'],
      ['callRespect', 'variant call respect offset (HorseVariantProfile)'],
      ['familyBias', 'V18 sizing family hashed from the horse id'],
    ] as const
  ).map(
    ([key, note]): LedgerEntry => ({
      key,
      kind: 'param',
      source: 'STYLE_PARAMS[style] resolved with HorseProfileMods in HorseLogic.decide',
      cadence: 'per_action',
      consumer: 'HorseLogic.decide / HorsePreflop.decidePreflopV7',
      note,
      since: key === 'familyBias' ? 'V18' : 'V2',
    })
  ),

  // ─────────────────────────────────────────────────────────────────────────
  // PROFILE KEYS. profiles.horse_profile (jsonb). Read at sit-down today
  // (Phase 5 adds the 5-minute hot reload). Written by onboarding and by
  // HorseSelfTuner nightly.
  // ─────────────────────────────────────────────────────────────────────────
  ...(
    [
      [
        'style',
        'style name (tag/lag/balanced/tricky/grinder + legacy aliases); hashed fallback',
        'V2',
      ],
      ['aggression', 'dial, clamped [0.6, 1.5] at the read boundary', 'V8'],
      ['tightness', 'dial, clamped [0.6, 1.5]', 'V8'],
      ['bluffFreq', 'dial, clamped [0.6, 1.5] (bluff_freq accepted)', 'V8'],
      ['sizingMultiplier', 'dial, clamped [0.6, 1.5] (sizing_multiplier accepted)', 'V8'],
      ['leaks', 'V40: this horse leak-tag counts over the tuner window (review verdicts)', 'V40'],
      ['leaksHands', 'V40: reviewed hands the counts were taken over (the denominator)', 'V40'],
      ['leaksOmaha', 'V41: the Omaha-family share of the counts', 'V41'],
      ['leaksHandsOmaha', 'V41: reviewed Omaha hands (the denominator)', 'V41'],
      ['leaksHoldem', 'V41: the hold em-family share of the counts', 'V41'],
      ['leaksHandsHoldem', 'V41: reviewed hold em hands (the denominator)', 'V41'],
      [
        'leaksTournament',
        'V41: the tournament-format share, from fn_horse_tournament_leaks',
        'V41',
      ],
      ['leaksHandsTournament', 'V41: reviewed tournament hands (the denominator)', 'V41'],
      [
        'persona',
        'V48: the AUTHORED persona (straddleRate -> the straddle round, gtoAdherence -> the GTO consult), bounded at the read boundary. The self-tuner never writes it - see ThePersonaSurvivesTheTuner.law.test.ts',
        'V48',
      ],
    ] as const
  ).map(
    ([key, note, since]): LedgerEntry => ({
      key,
      kind: 'profile',
      source: 'profiles.horse_profile (jsonb) via resolveHorseStyle',
      cadence: 'per_sit',
      consumer:
        key === 'persona'
          ? 'HorsePersona.resolvePersona (ServerTableEngineDealing straddle round); HorseLogic.followsSolver (the GTO consult)'
          : key.startsWith('leaks')
            ? 'HorseLogic.leakLoad (diagnostic only); HorseLogic.decide (ignored-evidence receipt)'
            : 'HorseLogic.decide',
      note,
      since,
    })
  ),

  // ─────────────────────────────────────────────────────────────────────────
  // HORSEMIND COUNTERS. One OpponentStats per observed player, shared by the
  // whole fleet (Dan 2026-09-04: shared memory stays shared).
  // ─────────────────────────────────────────────────────────────────────────
  mind('hands', 'distinct hands observed', 'HorseMind.bandFor / tableExploit (confidence)'),
  mind('vpip', 'voluntarily put money in preflop', 'HorseMind.bandFor (limp/call reads)'),
  mind('pfr', 'first voluntary preflop action was a raise', 'HorseMind.bandFor (open/3-bet reads)'),
  mind('threeBet', 're-raised preflop', 'HorseMind.tableExploit'),
  mind('aggr', 'aggressive actions, all streets', 'HorseMind.tableExploit (bluffMod/callDownMod)'),
  mind('passive', 'calls, all streets', 'HorseMind.tableExploit'),
  mind('folds', 'folds observed', 'HorseMind.tableExploit (fold-to-aggression)'),
  mind('facedAggr', 'times they faced aggression', 'HorseMind.tableExploit'),
  mind('cbetOpps', 'called preflop then faced a c-bet', 'HorseMind.foldToCbetOf (V16)'),
  mind('cbetFolds', '... and folded to it', 'HorseMind.foldToCbetOf (V16)'),
  mind('f3bOpps', 'their open got 3-bet', 'HorseMind.foldTo3BetOf (V16)'),
  mind('f3bFolds', '... and they folded', 'HorseMind.foldTo3BetOf (V16)'),
  mind('bigBetSD', 'big bets that reached showdown', 'HorseMind.bigBetValueTendency (V16)'),
  mind(
    'snapBetSD',
    'V43: river big bets made within 1.5s that reached showdown',
    'HorseMind.snapBetValueTendency (V43)'
  ),
  mind(
    'snapBetSDStrong',
    'V43: ... shown as two pair or better',
    'HorseMind.snapBetValueTendency (V43)'
  ),
  mind(
    'tankBetSD',
    'V43: river big bets made after 8s or more that reached showdown',
    'HorseMind.tankBetValueTendency (V43)'
  ),
  mind(
    'tankBetSDStrong',
    'V43: ... shown as two pair or better',
    'HorseMind.tankBetValueTendency (V43)'
  ),
  mind('bigBetSDStrong', '... that showed real strength', 'HorseMind.bigBetValueTendency (V16)'),
  mind(
    'riverCallSD',
    'shown hands whose last river action was a call (2026-10-25)',
    'HorseMind.riverCallLightTendency -> HorseLogic river bluff/thin-value read'
  ),
  mind(
    'riverCallSDWeak',
    '... shown as one pair or worse (a light river call)',
    'HorseMind.riverCallLightTendency -> HorseLogic river bluff/thin-value read'
  ),
  mind(
    'riverLastToActOpps',
    'own public observer-window last-to-act river opportunities, reconstructed from original accepted history; no pooled persistence claim',
    'HorseMind.riverLastToActRead / candidate riverPositionDefense'
  ),
  mind(
    'riverLastToActBets',
    'bets among those same last-to-act river opportunities, not a bluff count',
    'HorseMind.riverLastToActRead / candidate riverPositionDefense'
  ),
  mind(
    'riverTripleCheckRaiseOpps',
    'completed responses to exact 3x heads-up river check-raises in own public history',
    'HorseMind.riverTripleCheckRaiseRead / candidate riverBluffCheckRaise'
  ),
  mind(
    'riverTripleCheckRaiseFolds',
    'folds among the same exact 3x river check-raise responses',
    'HorseMind.riverTripleCheckRaiseRead / candidate riverBluffCheckRaise'
  ),
  mind(
    'riverHu',
    'at most 64 exact variant/asset/stakes/ante/original-census contexts with independent bet/check opportunity denominators and completed public raise responses, explicit overflow, no pooled persistence',
    'HorseMind.multiwayRiverRead / separate multiwayRiverBluffCheckRaise candidate'
  ),
  mind('riverBetOpps', 'river bet opportunities', 'HorseMind.tableExploit (river reads)'),
  mind('riverBetFolds', 'river bets folded to', 'HorseMind.tableExploit (river reads)'),
  mind('rHands', 'recency window: hands', 'HorseMind counter-adaptation blend (V7)'),
  mind('rFolds', 'recency window: folds', 'HorseMind counter-adaptation blend (V7)'),
  mind('rFacedAggr', 'recency window: faced aggression', 'HorseMind counter-adaptation blend (V7)'),
  mind('rAggr', 'recency window: aggressive actions', 'HorseMind counter-adaptation blend (V7)'),
  mind('rPassive', 'recency window: calls', 'HorseMind counter-adaptation blend (V7)'),
  mind('checks', 'checks observed', 'HorseMind.tableExploit (passivity)'),
  mind('postAggr', 'postflop aggressive actions', 'HorseMind.tableExploit (AF)'),
  mind('postPassive', 'postflop passive actions', 'HorseMind.tableExploit (AF)'),
  mind('rChecks', 'recency window: checks', 'HorseMind counter-adaptation blend (V7)'),

  // ─────────────────────────────────────────────────────────────────────────
  // GAME STATE. What the engine hands the brain every decision.
  // ─────────────────────────────────────────────────────────────────────────
  state(
    'players',
    'every public seat: stack, bet, folded/all-in/sitting-out, totalInvested; private cards are always empty here and hero cards travel separately'
  ),
  state('stateSchemaVersion', 'canonical live decision schema; production requires version 1'),
  state(
    'humanUserIds',
    'PLO presumption: the seats a person plays, from the engine roster; server-side only'
  ),
  state('heroSeat', 'seat whose private cards and action are being decided'),
  state('currentPlayerSeat', 'authoritative HandController turn owner'),
  state('legalActions', 'authoritative action menu including reopen and structure rules'),
  state('toCall', 'authoritative amount owed by hero'),
  state('minRaiseTo', 'minimum absolute legal wager or raise-to'),
  state('maxRaiseTo', 'maximum absolute legal wager after structure and table caps'),
  state('bettingStructure', 'no-limit, pot-limit or fixed-limit rule selected by the live hand'),
  state('fixedBetSize', 'fixed-limit street bet; null in other structures'),
  state(
    'fixedLimitSmallBet',
    "the hand's effective fixed-limit small bet (raised on a kill hand); null in other structures"
  ),
  state('wagersCapped', 'fixed-limit wager cap reached on this street'),
  state(
    'commitmentCapRemaining',
    'table per-hand commitment ceiling remaining; null when disabled'
  ),
  state('pots', 'live side-pot layers and exact eligible player ids'),
  state('rakeConfig', 'exact active per-hand rake percent and player-count cap schedule'),
  state('bbjConfig', 'active hand jackpot fee configuration; null explicitly disables deductions'),
  state(
    'chipUnit',
    'controller settlement unit: whole tournament or Diamond chips, cent-unit cash chips'
  ),
  state('asset', 'controller chip or Diamond asset, governing fee and precision rules'),
  state('dealtSeatIds', 'public original dealt-seat census; folded deals still occupy the deck'),
  state('variantRules', 'explicit hole-card, board-use, deck and hi-lo rules'),
  state('communityCards', 'board 1'),
  state('communityCards2', 'board 2 (bomb pots)'),
  state('communityCards3', 'board 3 (bomb pots)'),
  state('pot', 'pot including the bet faced'),
  state(
    'contestablePot',
    "pot hero can actually win after the effective call, excluding hero's uncommitted call"
  ),
  state('currentBet', 'the street bet to match'),
  state('minRaise', 'legal raise increment'),
  state('lastRaise', 'last raise size (legalize)'),
  state('stage', 'street'),
  state('gameVariant', 'nlh / plo4 / plo5 / plo6 / plo8 / short_deck / pineapple / fixed limit'),
  state('smallBlind', 'actual hand small blind for exact qualified feature economics'),
  state('bigBlind', 'stake'),
  state('dealerSeat', 'button (position reads)'),
  state(
    'blindSeats',
    'seats HandController posted the blinds from; small blind null when dead (tournament dead button). PLO4 pack positions',
    'Plo4LivePolicy.plo4CanonicalPosition'
  ),
  state(
    'actionHistory',
    'this hand, every action with stage and amount (range reads, barrels, plans)'
  ),
  state('killPot', 'canonical KillHandState when a Full or Half Kill pot is active on this deal'),
  state('isKillPot', 'optional flat boolean indicating an active Kill or Half-Kill pot'),
  state('killMultiplier', 'optional flat Kill blind multiplier when active (e.g. 2 or 1.5)'),
  state('killPosterSeat', 'optional flat seat number of the player who posted the Kill blind'),
  state('killBlind', 'optional flat chip amount of the posted Kill blind'),
  state('sevenDeuceEnabled', 'whether the Seven-Deuce (7-2) cash bounty side game is active'),
  state('sevenDeuceBounty', 'Seven-Deuce bounty configuration object or per-player chip amount'),
  state('sevenDeuceBountyBB', 'Seven-Deuce bounty per opponent denominated in big blinds'),
  state('sevenDeuceBountyPerPlayer', 'Seven-Deuce bounty per opponent denominated in chips'),
  state('gameMode', 'cash / tournament'),
  state('format', 'cash / mtt / sng / spin / hu_sng'),
  state('ante', 'ante per hand'),
  state('bigBlindAnte', 'BB-ante structure'),
  state(
    'publicMemoryDomain',
    'public rules of the hand being played (speed table / lightning, ante kind); the Lightning participation predicate (for the participation and the cheap entry options) the Lightning-separate style read (L-016) and the Lightning fold-through (L-019) read speed and nothing else reads it at decision time',
    'HorseLightningParticipation.lightningParticipationCtx and HorseLightningCheapEntry.lightningCheapEntryCtx (called by HorseLogic.decide; options lightningParticipationHoldem / lightningParticipationOmaha / lightningCheapEntryHoldem / lightningCheapEntryOmaha, default off); HorseLogic.prepareOriginalReads -> HorseMind.styleRead (option lightningStyleReadSeparate, default off); HorseLightningFoldThrough.lightningFoldThroughSeats (called by HorseLogic.decide; option lightningEarlyFoldNeedsFoldThrough, default off)'
  ),
  state('allInOrFold', 'all-in-or-fold table'),
  state('straddleActive', 'a straddle is posted (V18)'),
  state(
    'straddleAmount',
    'exact last live straddle amount posted on this hand when straddleActive is true (V87.1)',
    'HorseLogic.decidePreflopV7Glue -> HorsePreflop.decidePreflop'
  ),
  state('straddleSeat', 'seat number of the active posted straddle when present'),
  state('bombPot', 'this hand is a bomb pot (V36)'),
  state('boardCount', 'boards dealt (V36)'),
  state(
    'vpipFloor',
    'the table VPIP floor, enforced with its judged window and grace policy',
    // Two consumers, and the second one is the point (2026-09-06): the floor
    // does not only widen the brain, it travels to settlement and keys the
    // horse_daily_play row apart, so no band ever judges required-loose play.
    'HorseLogic.vpipFloorMul; ServerTableEngineSettlement -> HorseHandReview (horse_daily_play.floored)'
  ),
  state(
    'vpipWindowHands',
    'actual judged sample window; NLH variance margin uses this policy input',
    'HorseLogic.vpipFloorMul / vpipFloorCallDown'
  ),
  state(
    'ownVpip',
    'this seat: hands and judged VPIP this sitting, from fn_nit_status - the eviction query',
    'HorseLogic.vpipFloorMul'
  ),
  state(
    'tournament',
    'Phase 6 context: tournament facts and actual dealt-hand blinds/census/M; immutable successful cache provenance is bound by the worker and v2 attribution through the accepted execution witness/journal. Provenance is observational and excluded from policy sampling; legacy v1 evidence remains unqualified for this new source join.',
    'HorseDecisionWorkerRuntime.assertPhase6TournamentSnapshot; HorseLogic.icmRisk / decidePreflopV7 / endgameAdjust / satelliteRead / evaluateTournamentUtility'
  ),

  // ─────────────────────────────────────────────────────────────────────────
  // TABLES. What the services compile and where it goes.
  // ─────────────────────────────────────────────────────────────────────────
  table(
    'horse_observation_discovery_epochs',
    'minute',
    'HorseObservationDiscovery via fn_discover_horse_observation_requests; fn_prune_horse_observation_discovery',
    'private bounded source-window discovery progress and retained gaps; roster discovery does not establish observation-time coverage, journal completion or model activation',
    'Phase14'
  ),
  table(
    'horse_observation_discovery_segments',
    'minute',
    'fn_discover_horse_observation_requests; fn_prune_horse_observation_discovery',
    'private source snapshots, atomic-hand and actor digests, frozen novel actors and bounded admission cursor; pending membership survives source removal and restart',
    'Phase14'
  ),
  table(
    'horse_observation_discovery_members',
    'minute',
    'fn_discover_horse_observation_requests through canonical fn_admit_horse_observation_capture; fn_prune_horse_observation_discovery',
    'private deduplicated actor-to-original-window request references; admission and membership commit together without financial or policy writes',
    'Phase14'
  ),
  table(
    'horse_observation_capture_work',
    'minute',
    'HorseObservationCapture via fn_claim_horse_observation_capture; HorseLearningQueueHealth via fn_horse_learning_work_health',
    'private durable actor/window acquisition requests; bounded sequential cursor recovery in one queue slot and retained gaps; not source coverage or model activation',
    'Phase14'
  ),
  table(
    'horse_observation_capture_receipts',
    'minute',
    'HorseObservationCapture via fn_finish_horse_observation_capture_witness and legacy fn_finish_horse_observation_capture; HorseCaptureEvidence via fn_horse_observation_capture_evidence; fn_prune_horse_observation_captures',
    'private immutable accepted-slice acknowledgments; exact source-read witnesses commit with journal admission and cursor advance; bounded revision-fenced evidence recovery compares independent journal receipts; legacy missing witnesses and unfinished gaps stay explicit without establishing source coverage',
    'Phase14'
  ),
  table(
    'horse_exploit_profiles',
    'per_hand',
    'HorseOpponentMemory via fn_horse_exploit_profiles_read; worker prerequisite read and monotonic import',
    'private public-action counters, retained across sessions by exact variant, cash/tournament and dealt size; accepted hand trigger owns persistence',
    'V50',
    { dayColumn: 'updated_at', freshnessDays: 1 }
  ),
  table(
    'horse_mind_stats',
    'boot',
    'HorseMindPersistence (load at boot, save on a timer)',
    'the shared PlayerStats memory, persisted',
    'V13',
    { dayColumn: 'updated_at', freshnessDays: 1 }
  ),
  table(
    'horse_mind_stats_scoped',
    'boot',
    'HorseMindPersistence (hydrateHorseMindScopedFromDb at boot, flushHorseMindScoped on the timer); HorseMind.readStats prefers it at 40 hands',
    // NO DAILY FRESHNESS SINCE 2026-10-26. Live decisions moved to independent
    // observer memory (2026-10-25-horse-observer-independent-memory) and the
    // herd's persistent per-context reads to horse_exploit_profiles, which
    // keeps the one-day freshness check above. Nothing feeds the process-wide
    // scoped overlay any more, so its last write is 2026-10-26 01:01 UTC and a
    // daily freshness expectation read that retirement as a critical outage
    // every night (data_stale, audit 2026-10-30).
    'V45: the same counters per (player, card family x table size); superseded on 2026-10-26 by horse_exploit_profiles for live per-context reads',
    'V45'
  ),
  table(
    'horse_mind_pairs',
    'boot',
    'HorseMindPersistence (load at boot, save on a timer)',
    'pairwise targeting/hunting reads',
    'V13',
    { dayColumn: 'updated_at', freshnessDays: 1 }
  ),
  table(
    'horse_hand_reviews',
    'per_hand',
    'HorseHandReview (write at settlement); fn_run_horse_daily_audit; HorseSelfTuner via horse_review_rollup',
    'every 20bb+ pot a horse played, tagged',
    'V13',
    { dayColumn: 'played_at', freshnessDays: 1 }
  ),
  table(
    'horse_review_rollup',
    'nightly',
    'HorseSelfTuner (unapplied review proposals); HorseTunerObservationalAudit (preserved profile)',
    'per horse/day/variant tag counts',
    'V18',
    { dayColumn: 'day', freshnessDays: 2 }
  ),
  table(
    'horse_tournament_daily',
    'nightly',
    'fn_audit_tournament_results (the daily audit); ca_horse_tournament_card (the panel); compiled by fn_horse_tournament_daily_compile from fn_run_horse_daily_audit',
    'per horse/day/type/variant tournament results: entries, invested, won, ITM, finish percentile',
    '2026-09-05',
    { dayColumn: 'day', freshnessDays: 2 }
  ),
  table(
    'horse_daily_nets',
    'nightly',
    'HorseSelfTuner (real bb/100 and, since 2026-09-05, rake_bb and, since 2026-09-06, bbj_bb -> the DROP-adjusted regression rule and fleetQuartile); fn_run_horse_daily_audit; fn_audit_fleet_drop_identity (the closed-system assertion)',
    'exact settlement nets + weighted-contributed rake AND bad-beat-jackpot drop per horse per day. net_bb + rake_bb + bbj_bb is the result before the house took anything, and on 2026-09-06 it came to zero over 31,186 seat-hands - the fleet plays itself, so it must',
    'V16',
    { dayColumn: 'day', freshnessDays: 1 }
  ),
  table(
    'horse_daily_play',
    'nightly',
    'HorseSelfTuner (loadPlayRows: every horse studied from its own rows, floored = false only; HorseHandReview compiles them at settlement with HorsePlayStats); fn_horse_frequency_leaks; fn_audit_frequency_leaks (which reports the floored share so the exclusion stays visible)',
    'per horse/day/format/floored VPIP, PFR, 3-bet, fold-to-3-bet, saw flop, WWSF, postflop aggression. `floored` splits play at a VPIP-floored table, where the horse was REQUIRED to be loose, away from play the winning-player bands may judge (2026-09-06)',
    '2026-09-05',
    { dayColumn: 'day', freshnessDays: 1 }
  ),
  table(
    'horse_self_tune_log',
    'nightly',
    'fn_complete_horse_tuner_study via HorseTunerStudyCompletion; HorseDailyAudit; the panel',
    'what the tuner did to each horse and why; an individual row is only partial nightly progress',
    'V8',
    { dayColumn: 'run_date', freshnessDays: 2 }
  ),
  table(
    'horse_brain_telemetry',
    'nightly',
    'fn_audit_layer_silence_and_coverage, fn_audit_layer_drift, fn_audit_data_receipts (BrainTelemetryFlush writes through fn_horse_brain_flush_receipt)',
    'per-day fire counts per layer (BrainTelemetryFlush)',
    'V15',
    { dayColumn: 'day', freshnessDays: 1 }
  ),
  table(
    'horse_commitment_audit_days',
    'nightly',
    'fn_horse_commitment_audit_step',
    'durable eligibility-sweep counters and cursor; repeated recent-day passes are not complete source watermarks or completed GTO reviews',
    'Phase14'
  ),
  table(
    'horse_commitment_reviews',
    'nightly',
    'fn_horse_commitment_audit_step',
    'strictly over10BB cumulative commitment including refunds, or unknown eligibility; private diagnostics with unmatched replay/reference and no policy authority',
    'Phase14'
  ),
  table(
    'horse_commitment_audit_gaps',
    'nightly',
    'fn_horse_commitment_audit_step',
    'retained source/identity/fact gaps and conflicts observed during the independent daily eligibility sweep; no financial-source mutation',
    'Phase14'
  ),
  table(
    'horse_brain_flush_receipts',
    'nightly',
    'fn_horse_brain_flush_receipt via BrainTelemetryFlush and HorseBrainTelemetryPublisher',
    'private atomic batch deduplication with source identity; accepted batches only, not a complete decision ledger',
    'Phase15'
  ),
  table(
    'horse_journaled_model_sweep',
    'nightly',
    'fn_claim_horse_journaled_model_statistics and fn_finish_horse_journaled_model_statistics via HorseJournaledOpponentModels',
    'private leased cursor for bounded raw and retained sufficient-statistics diagnostic reconstruction; not a source watermark',
    'Phase14'
  ),
  table(
    'horse_journaled_opponent_models',
    'nightly',
    'fn_finish_horse_journaled_model_statistics via HorseJournaledOpponentModels',
    'private latest scoped frequency and holdout reports; no causal EV, source completeness or activation authority',
    'Phase14'
  ),
  table(
    'horse_decision_latency',
    'nightly',
    'the panel; fn_horse_brain_flush_receipt (BrainTelemetryFlush atomically writes counters and latency with source receipts)',
    'per-day decision latency histograms',
    'V28',
    { dayColumn: 'day', freshnessDays: 1 }
  ),
  table(
    'horse_solver_agreement',
    'nightly',
    'fn_audit_solver_agreement (the daily audit); written by HorseLeague after the matchups via fn_horse_solver_agreement_add',
    'reference-specific absolute scores: V47 hold em push/fold chart agreement and Phase 4 certified V31 postflop execution agreement; neither is exploitability',
    'V47',
    { dayColumn: 'run_date', freshnessDays: 2 }
  ),
  table(
    'horse_solver_agreement_decisions',
    'nightly',
    'fn_audit_solver_agreement; ca_horse_solver_agreement_decisions',
    'reconciled per-decision evidence behind the nightly chart-agreement summary, including the final action, reference mix, regret availability, and source seal',
    'Phase4',
    { dayColumn: 'run_date', freshnessDays: 2 }
  ),
  table(
    'horse_solver_agreement_v31_decisions',
    'nightly',
    'fn_audit_solver_agreement; ca_horse_solver_agreement_decisions; ca_horse_solver_agreement_v31_decisions',
    'database-bound per-decision evidence for the promoted V31 runtime corpus: exact state, sampled and final action, execution match, reference mix, recomputed regret, and complete dataset/cell source seal. NO FRESHNESS WINDOW (2026-09-28): rows exist only while a gto_v31_datasets row is active, and none has ever been (0 rows, ever, on 2026-09-28). A two-day window filed data_stale critical every night for a pipeline that was never started; certified_v31_missing is the reader for that fact. Restore { dayColumn: run_date, freshnessDays: 2 } in the commit that commissions V31.',
    'Phase4'
  ),
  table(
    'gto_v31_runtime_cells',
    'boot',
    'GtoPostflopV31Loader via fn_gto_v31_active_cells',
    'the only certified postflop policy cells the live action path may load',
    'Phase4'
  ),
  table(
    'gto_v31_datasets',
    'nightly',
    'fn_audit_gto_v31_certified',
    'candidate and active corpus release seals, held-out metrics, replay gate, and league gate',
    'Phase4'
  ),
  table(
    'gto_v31_cell_source_receipts',
    'nightly',
    'fn_gto_v31_mark_candidate',
    'immutable lineage from each compact cell to its independently attributed source nodes',
    'Phase4'
  ),
  table(
    'solver_worker_liveness',
    'minute',
    'fn_audit_solver_pipeline_liveness',
    'latest monotonic M1 and M2 progress, provenance, rate, ETA, invalid rows, and artifact receipt',
    'Phase4'
  ),
  table(
    'solver_compact_liveness',
    'minute',
    'fn_audit_solver_pipeline_liveness',
    'latest certified compact-build state and source lag',
    'Phase4'
  ),
  table(
    'horse_league_results',
    'nightly',
    'fn_run_horse_daily_audit (league_layer_negative); the panel',
    'the ablation card',
    'V12',
    { dayColumn: 'run_date', freshnessDays: 2 }
  ),
  table(
    'horse_daily_audit',
    'nightly',
    'the panel; the daily analysis prompt',
    'findings + agent analysis per day',
    'V13',
    { dayColumn: 'day', freshnessDays: 2 }
  ),
  table(
    'horse_tuner_write_receipts',
    'nightly',
    'fn_horse_tuner_recorded_horses via HorseTunerStudyCompletion',
    'immutable per-horse daily writes let an interrupted study resume without retuning accepted horses',
    'Phase14'
  ),
  table(
    'horse_tuner_study_rosters',
    'nightly',
    'fn_prepare_horse_tuner_study via HorseTunerStudyCompletion',
    'durable original eligible membership prevents a resumed study from silently dropping unfinished horses',
    'Phase14'
  ),
  table(
    'horse_tuner_study_completions',
    'nightly',
    'HorseLeague / HorseSelfTuner',
    'one execution receipt after every member of the captured eligible cohort has an atomic audit receipt; not causal validation',
    'Phase14'
  ),
  table(
    'horse_job_runs',
    'nightly',
    'HorseLeague / HorseSelfTuner / HorseDailyAudit claims; fn_audit_nightly_job_health',
    'single-runner claims per job per day',
    'V23'
  ),
  table(
    'horse_data_ledger',
    'boot',
    'fn_audit_data_receipts; ca_horse_data_ledger (the panel)',
    'this ledger, upserted by HorseDataLedgerSync at boot',
    'P1',
    { dayColumn: 'updated_at', freshnessDays: 3 }
  ),
  table(
    'ca_horse_fleet_state',
    'minute',
    'HorseFleetManager via fn_ca_fleet_state_upsert; fn_ca_fleet_overview / fn_ca_fleet_pnl (the panel)',
    'per-horse seat/table/session state',
    'fleet'
  ),
  table(
    'ca_horse_fleet_register',
    'nightly',
    'SQL only: fn_ca_fleet_register_sync, fn_ca_fleet_isolation_report, fn_ca_fleet_overview',
    'the roster as the database sees it',
    'fleet'
  ),
  table(
    'ca_horse_fleet_policy',
    'minute',
    'HorseFleetPolicy via fn_ca_fleet_policy_effective',
    'floor policy row',
    'fleet'
  ),
  table(
    'ca_horse_fleet_heartbeat',
    'minute',
    'SQL only: fn_ca_fleet_overview (the panel reads the leader heartbeat)',
    'leader/standby heartbeat',
    'fleet'
  ),
  // Legacy: exist in the schema, zero rows, zero writes, no reader in
  // server/src. Registered so the test fails the day something starts
  // reading one without moving it above (a datum with a reader is not
  // legacy) and so the panel can show them as what they are.
  ...[
    'horse_analytics',
    'horse_error_log',
    'horse_hand_history',
    'horse_memory',
    'horse_opponent_journals',
    'horse_opponent_reads',
    'horse_personality',
    'horse_relationships',
    'horse_session_analytics',
    'horse_session_stats',
    'horse_source_assignments',
    'horse_sports_source_assignments',
    'horse_table_presence',
    'horse_threat_intel',
    'horse_topic_cooldowns',
    'horses',
  ].map((t) =>
    table(
      t,
      'legacy_unused',
      'none',
      'zero rows, zero writes, no reader in server/src as of 2026-09-04',
      'legacy'
    )
  ),

  // ─────────────────────────────────────────────────────────────────────────
  // RECEIPTS. Telemetry keys, with the ratio the daily audit expects on a
  // normal fleet day. Ratios are set from 2026-09-03 production fires
  // (decide 3.67M; decide_omaha 1.90M; decide_nlh 1.50M) with a wide margin,
  // so a healthy day never trips them and a dead layer always does.
  // ─────────────────────────────────────────────────────────────────────────
  receipt('decide', 'HorseLogic.decide', 'every live decision', 'V15'),
  receipt(
    'horse_feature_authority_withdrawn_before_acceptance',
    'ServerTableEngineTurns qualified feature acceptance gate',
    'Rejects a prepared feature decision whose exact qualification authority was withdrawn before controller acceptance',
    'Feature authority'
  ),
  receipt(
    'horse_feature_authority_admitted_in_domain',
    'workerRuntime feature domain verdict',
    'A selected feature authority applied to a decision inside its admitted (measured) domain',
    'Feature authority'
  ),
  receipt(
    'horse_feature_authority_outside_admitted_domain',
    'workerRuntime feature domain verdict',
    'A selected feature authority refused a decision outside its admitted (measured) domain; the reference decision runs unchanged',
    'Feature authority'
  ),
  receipt(
    'horse_feature_authority_refused_*',
    'workerRuntime feature domain verdict',
    'A selected feature authority refused a decision because it was not usable or the caller disabled part of the qualified package',
    'Feature authority'
  ),
  receipt(
    'horse_observer_history_*',
    'HorseOwnPublicHistory original observer load',
    'Unavailable original history and source/deadline/provider failures remain distinct from an empty learned read',
    'Individual public history'
  ),
  receipt(
    'horse_river_nodes_unavailable',
    'HorseOwnPublicHistory public node sidecar loader',
    'Original public history retained unchanged when source, binding, bounds or structural evidence is unavailable',
    'Multiway river reads'
  ),
  receipt(
    'horse_decision_refused_isolated',
    'LiveHorseDecisionWorkerClient.refuseDecision',
    'a worker decision whose receipt or effects the client refused; isolated to its own seat (check or fold), never engine-fatal',
    '2026-10-22'
  ),
  /*
   * A HORSE TURN THE CLOCK RESOLVED (2026-11-05). Dan's order: an active
   * decision process on every hand and every street. When the engine acts for
   * a horse seat (its clock or bank ran out, the watchdog forced it, a
   * recovered clock expired) the hand record says origin 'forced', the same
   * word a blind post carries, and two such turns on 2026-11-05 were found
   * only in the engine log. Each one now fires these, so a day with a single
   * forced horse turn is visible in activation.sql. Expected 0.
   */
  receipt(
    'horse_turn_resolved_without_decision',
    'ServerTableEngineTurns.forceResolveSeat / runTableWatchdog',
    'the engine forced a check or fold at a horse seat instead of the brain acting; expected 0',
    '2026-11-05'
  ),
  receipt(
    'horse_turn_resolved_without_decision_*',
    'ServerTableEngineTurns.noteHorseTurnResolvedWithoutDecision',
    'the reason (timer_expired, timebank_expired, manual_timebank_expired, published_timebank_expired, recovered_timebank_expired, reconnect_protection_expired, watchdog_forced, disconnect_auto_action, unspecified) and whether a brain decision was in flight (brain_pending) or none was pending (no_brain_request)',
    '2026-11-05'
  ),
  receipt(
    'stale_turn_clock_expiry_ignored',
    'ServerTableEngineTurns.startTurnTimer expiry callbacks',
    'a clock or bank countdown expired after its turn had ended (same seat, next street) and was ignored instead of spending a bank or forcing an action on the new turn',
    '2026-11-05'
  ),
  receipt(
    'time_bank_activation_retired_turn_ended',
    'ServerTableEngineTurns.resumeContinuationTimeBankActivation',
    'a deferred automatic bank activation reached publication after the turn that spent it had ended; retired (use it or lose it) instead of being armed on the next turn',
    '2026-11-05'
  ),
  receipt('decide_tournament', 'HorseLogic.decide', 'every live tournament decision', 'Phase6'),
  receipt(
    'decide_postflop',
    'HorseLogic.decide',
    'every live decision that enters the postflop brain: the opportunity count for the postflop upgrade counters',
    '2026-11-13'
  ),
  receipt(
    'decide_tournament_preflop',
    'HorseLogic.decide',
    'every live tournament preflop decision',
    'Phase6',
    'decide_tournament',
    0.05
  ),
  receipt(
    'decide_omaha',
    'HorseLogic.decide',
    'Omaha-family decisions (plo4/5/6/8, flo8)',
    'V15',
    'decide',
    0.1
  ),
  receipt(
    'decide_nlh',
    'HorseLogic.decide',
    'hold em-family decisions (nlh, pineapple, fixed limit)',
    'V15',
    'decide',
    0.1
  ),
  receipt(
    'decide_short_deck',
    'HorseLogic.decide',
    'short deck decisions; needs short-deck tables',
    'V15'
  ),
  receipt(
    'preflop_v7',
    'HorsePreflop.decidePreflopV7',
    'V7 preflop engine took the decision',
    'V7',
    'decide',
    0.4
  ),
  receipt(
    'plo_pot_preflop_size',
    'HorsePreflop',
    'PLO pot-sized preflop raise',
    'V24',
    'decide_omaha',
    0.001
  ),
  receipt(
    'banded_mc_omaha',
    'HorseEval.simulateEquity via HorseMind.bandsForOpponents',
    'range-conditioned MC ran (Omaha)',
    'V3',
    'decide_omaha',
    0.2
  ),
  receipt(
    'banded_mc_nlh',
    'HorseEval.simulateEquity via HorseMind.bandsForOpponents',
    'range-conditioned MC ran (NLH)',
    'V3',
    'decide_nlh',
    0.2
  ),
  receipt(
    'icm_*',
    'HorseLogic.icmRisk',
    'icm_real / icm_spin_cev / icm_warming / icm_legacy; tournament volume only',
    'V16'
  ),
  receipt(
    'gto_*',
    'HorseLogic (solver lookups)',
    'gto_miss_* / gto_skip_too_deep / gto_served_beyond_depth_ceiling / gto_depth_fallback; NLH solver misses by reason',
    'V27'
  ),
  receipt(
    'vpip_floor',
    'HorseLogic (VPIP floor)',
    'a floored table steered this decision (Dan 2026-09-04)',
    'VPIP',
    'decide'
  ),
  receipt(
    'vpip_floor_prior',
    'HorseLogic (VPIP floor)',
    'steering on the prior - under three hands, no judged sample yet',
    'VPIP',
    'vpip_floor'
  ),
  receipt(
    'vpip_floor_closing',
    'HorseLogic (VPIP floor)',
    'closing the loop on the judged VPIP and still widening',
    'VPIP',
    'vpip_floor'
  ),
  receipt(
    'vpip_floor_satisfied',
    'HorseLogic (VPIP floor)',
    'over the floor; the horse own style is back in charge',
    'VPIP',
    'vpip_floor'
  ),
  receipt(
    'vpip_floor_clamped',
    'HorseLogic (VPIP floor)',
    'pinned at the 0.35 widening limit - the floor cannot be reached by widening, so the table churns',
    'VPIP',
    'vpip_floor'
  ),
  receipt(
    'vpip_floor_call_down',
    'HorseLogic (VPIP floor)',
    'under its target, called a small preflop price instead of folding (2026-10-17)',
    'VPIP',
    'vpip_floor'
  ),
  receipt(
    'v15_nut_status',
    'HorseLogic (V15)',
    'Omaha cat 5/6 nut read',
    'V15',
    'decide_omaha',
    0.02
  ),
  receipt(
    'v15_eq_capped',
    'HorseLogic (V15)',
    'dominated flush/straight equity capped',
    'V15',
    'decide_omaha',
    0.0005
  ),
  receipt(
    'v15_raise_gate',
    'HorseLogic (V15)',
    'dominated hand refused to raise',
    'V15',
    'decide_omaha',
    0.0003
  ),
  // No floor: v15Boats is default ON in PLO5 cash only (2026-11-06), a
  // dominated boat facing a raise is rare, and other variants stay off.
  receipt(
    'v15_boat_dominated',
    'HorseLogic (V15 boats)',
    'Omaha full house read as dominated by a bigger boat or quads',
    'V15'
  ),
  receipt(
    'v15_boat_gate',
    'HorseLogic (V15 boats)',
    'dominated boat raised after betting called instead of re-raising',
    'V15'
  ),
  // No floor: v16Hu is default OFF since 2026-10-05, so silence is expected
  // until a league matchup resolves positive and the default changes.
  receipt('v16_hu_overlay', 'HorseLogic (V16)', 'heads-up overlay; opt-in (v16Hu)', 'V16'),
  // 2026-11-07 (daily audit 2026-11-06, finding 1): the V16/V23 deep reads
  // are OBSERVER-GATED since #8075 (2026-10-25). Each horse reads only what it
  // observed itself, per variant / format / dealt-size scope; the owner's
  // herd notes (#8235) feed the exploit read, not these counters. The old
  // floors were set on the pooled mind and read the new design as dead.
  // Measured per decide over 2026-11-01..11-07 (post-change steady state):
  //   v16_reads_f3b   0.026-0.147%, median 0.083%  (18-22% pooled, 10-18..10-25)
  //   v16_reads_cbet  0.011-0.050%, median 0.030%  (1.3-1.5% pooled)
  //   v23_river_read  0.033-0.242%, median 0.116%  (3.6-4.4% pooled)
  // Each floor now sits under the week's minimum, so a zero or a real
  // collapse still trips it. HorseObserverDeepReads.test.ts pins the wiring.
  receipt(
    'v16_reads_f3b',
    'HorseLogic (V16)',
    "fold-to-3-bet read consulted (observer-gated: the horse's own 8+ opportunities)",
    'V16',
    'decide',
    0.0002
  ),
  receipt(
    'v16_reads_cbet',
    'HorseLogic (V16)',
    "fold-to-c-bet read consulted (observer-gated: the horse's own 10+ opportunities)",
    'V16',
    'decide',
    0.00005
  ),
  receipt(
    'v16_reads_tell',
    'HorseLogic (V16)',
    // No floor (2026-11-07). Was 0.004 per cash decision (6.5-11.5 per
    // 1,000 on the pooled mind, 2026-09-24..10-05). Observer-gated since
    // #8075: five big river bets by one player that reached showdown, seen
    // by ONE horse in one scope. Public history is card-free and cannot
    // rebuild it, and the herd notes carry no showdown counter. 23,562 fires
    // on 2026-10-25, 1,206 on 10-26, 0 every day 2026-11-01..11-07.
    // fn_audit_layer_silence reports it as layer_observer_gated (note).
    'big-bet showdown tell consulted; observer-gated (own 5+ big-bet showdowns), no floor',
    'V16'
  ),
  receipt(
    'v16_sizecond_bigbet',
    'HorseLogic (V16)',
    'big-bet-conditioned sampling',
    'V16',
    'decide',
    0.005
  ),
  receipt(
    'v16_unblocker',
    'HorseLogic (V16)',
    'river unblocker bluff boost',
    'V16',
    'decide',
    0.002
  ),
  receipt('v17_pos_behind', 'HorseLogic (V17)', 'players-behind pressure', 'V17', 'decide', 0.1),
  // No floor: v17RiverProbe is default OFF since 2026-10-16, so silence is
  // expected until a league matchup resolves positive and the default changes.
  receipt(
    'v17_river_probe',
    'HorseLogic (V17)',
    'river probe into a capped field; opt-in (v17RiverProbe)',
    'V17'
  ),
  receipt('v17_catch_block', 'HorseLogic (V17)', 'call-side blocker', 'V17', 'decide', 0.0005),
  // 2026-10-16 opponent exploit (HorseOpponentExploit). No floor: these fire
  // only against an opponent whose decayed read is credibly outside the
  // horse-population envelope, which horse-versus-horse play almost never is.
  // 2026-10-22 maniac pressure (HorseOpponentExploit.maniacRaiseWidth). No
  // floor: these fire only against an opponent read as a maniac, which no
  // horse-like read ever is.
  receipt(
    'maniac_pressure_preflop',
    'HorseLogic (maniac pressure)',
    "a maniac raised or is still to act: its shoves and re-raises priced by equity, opens capped to what continues, no bluff raises (Dan: 'NOT RAISE A HAND WITH THE INTENTION OF FOLDING')",
    'OPPX'
  ),
  // PLO6-AUDIT-015 (2026-11-13). In Omaha maniac_pressure_preflop fires for
  // an unknown opponent too, because the presumption supplies a width. This
  // receipt counts only the raiser faced whose own record reads as a maniac.
  // No floor: it needs a real maniac at the table. Named _seen for the same
  // reason: a day with none is ordinary, and the daily drift audit must not
  // read that day as a layer going silent.
  receipt(
    'observed_maniac_raiser_seen',
    'HorseLogic (maniac pressure, observedManiacRaiser)',
    'the raiser the Horse faces reads as a maniac on its own public record, not on the Omaha presumption',
    'OPPX'
  ),
  // PLO6-AUDIT-013 (2026-11-14). An occurrence counter: it needs an observed
  // maniac re-raising a PLO6 cash Horse and the arithmetic refusing the price.
  receipt(
    'plo6_maniac_price_refusal_range_play_seen',
    'HorseLogic V38 arithmetic (plo6ManiacPriceRefusalToRangePlay, PLO6-AUDIT-013)',
    'a PLO6 cash price refused against an observed maniac raiser was handed to the range play instead of being folded',
    'V92'
  ),
  // HA-10768-1 (2026-11-15): the outcome of each hand-off above, by table
  // floor and by the FINAL action. With the option off every one was a fold,
  // so *_continued counts decisions the option changed; *_folded counts
  // hand-offs that changed nothing (the range play folds too, as it does on
  // unfloored tables at the recorded node). Occurrence counters, no floor.
  receipt(
    'plo6_maniac_price_refusal_floored_continued',
    'HorseLogic final decision (plo6ManiacPriceRefusalToRangePlay, HA-10768-1)',
    'on a table with a VPIP floor, a refused maniac price handed to the range play ended as a call, raise or all-in instead of the fold it was before the option',
    'V92'
  ),
  receipt(
    'plo6_maniac_price_refusal_floored_folded',
    'HorseLogic final decision (plo6ManiacPriceRefusalToRangePlay, HA-10768-1)',
    'on a table with a VPIP floor, a refused maniac price handed to the range play still ended as a fold',
    'V92'
  ),
  receipt(
    'plo6_maniac_price_refusal_unfloored_continued',
    'HorseLogic final decision (plo6ManiacPriceRefusalToRangePlay, HA-10768-1)',
    'on a table without a VPIP floor, a refused maniac price handed to the range play ended as a call, raise or all-in instead of the fold it was before the option',
    'V92'
  ),
  receipt(
    'plo6_maniac_price_refusal_unfloored_folded',
    'HorseLogic final decision (plo6ManiacPriceRefusalToRangePlay, HA-10768-1)',
    'on a table without a VPIP floor, a refused maniac price handed to the range play still ended as a fold',
    'V92'
  ),
  // PLO6-AUDIT P6-4 (2026-11-14). An occurrence counter for an opt-in arm
  // production never sets: silence is its ordinary state.
  receipt(
    'plo6_top_set_nut_realization_seen',
    'HorseLogic V38 flop/turn call menu (plo6TopSetNutRealization, PLO6-AUDIT P6-4)',
    'a PLO6 cash top set that is the current nuts was priced at full realization in the flop/turn call menu',
    'V93'
  ),
  // PLO6 lane 2026-11-15 (plo6NoMultiwayBetWithWeakMadeHand). An occurrence
  // counter for a default-off option production does not set: silence is its
  // ordinary state. One receipt: the rule reads no opponent, so it has no
  // withheld state.
  receipt(
    'plo6_multiway_weak_made_hand_bet_checked',
    'HorseLogic wager_rules (HorsePlo6MultiwayWeakBet, plo6NoMultiwayBetWithWeakMadeHand)',
    'PLO6 flop or turn bet facing nothing against two or more live opponents with a weak made hand (one pair below the top card, two pair without the top card, the board pair with such a pair, or a pocket pair above the top card of an unpaired board), no nut flush draw, under eight straight outs, under four nut-straight outs, no flush draw with four or more straight outs, not nut class: turned into a check',
    'V94'
  ),
  // Fixed-Limit lane SPEC-FL-01..03 (2026-11-14). Occurrence counters for
  // opt-in arms production never sets: silence is their ordinary state.
  receipt(
    'fixed_limit_river_full_bet_read_seen',
    'HorseLogic decidePostflop range reads (fixedLimitRiverFullBetRead, SPEC-FL-01)',
    'a fixed-limit river wagerer was read as having made a full bet (or a raise) for the range samplers',
    'V94'
  ),
  receipt(
    'hilo_nut_low_freeroll_bet',
    'HorseLogic baseline river bluff range (fixedLimitHiLoNutLowRiverBet, SPEC-FL-02)',
    'a fixed-limit hi-lo nut low with no high was sent to bet the heads-up river every time',
    'V94'
  ),
  receipt(
    'fixed_limit_river_one_bet_value_raise',
    'HorseLogic value raise (fixedLimitRiverOneBetValueRaise, SPEC-FL-03)',
    "a fixed-limit hold'em river value raise over one bet was taken at the one-bet break-even without the frequency draw",
    'V94'
  ),
  receipt(
    'river_bluff_checkraise_evaluated',
    'HorseLogic.riverBluffCheckRaise',
    'priced candidate, not qualification or accepted action',
    'River check-raise'
  ),
  receipt(
    'river_bluff_checkraise_selected',
    'HorseLogic.riverBluffCheckRaise',
    'positive lower-bound bluff proposal; authoritative acceptance remains separate',
    'River check-raise'
  ),
  receipt(
    'river_position_defense_evaluated',
    'HorseLogic.maniacCallDown',
    'conditional public river rate admitted the existing range/price recovery; evaluation, not a bluff verdict or accepted-use proof',
    'River position defense'
  ),
  receipt(
    'river_position_defense_call',
    'HorseLogic.maniacCallDown',
    'the original fold became a priced call under the conditional river candidate; proposal only until authoritative action acceptance',
    'River position defense'
  ),
  receipt(
    'maniac_call_down_checked',
    'HorseLogic (maniac pressure)',
    "a fold facing a maniac's bet was re-checked against equity versus its preflop range",
    'OPPX'
  ),
  receipt(
    'postflop_maniac_call_down_checked',
    'HorseLogic (maniac pressure)',
    'a fold facing the bet of a player who limps and then pots every street was re-checked against equity (2026-10-22)',
    'OPPX'
  ),
  receipt(
    'maniac_short_stack_jam',
    'HorseLogic (maniac pressure)',
    'a short tournament stack opening into a maniac moved all in instead of raising to fold to the shove (2026-10-22)',
    'OPPX'
  ),
  receipt(
    'v58_short_stack_maniac_no_flat',
    'HorseLogic (maniac pressure)',
    'a push/fold tournament stack facing a wide raiser was priced for the jam, never the flat (Dan 2026-10-25, bubble hand 48403158)',
    'OPPX'
  ),
  receipt(
    'v58_short_stack_maniac_jam',
    'HorseLogic (maniac pressure)',
    'a push/fold tournament stack facing a wide raiser moved all in because its equity pays for the jam (2026-10-25)',
    'OPPX'
  ),
  receipt(
    'v58_short_stack_no_flat',
    'HorseLogic (maniac pressure)',
    'the preflop all-in price answered a push/fold tournament stack with the jam or the fold, never the flat (2026-10-25)',
    'OPPX'
  ),
  receipt(
    'v58_low_spr_stack_off',
    'HorseLogic (tournament aggression)',
    'a tournament holdem hand with at most one pot behind and the equity to want it all in moved all in instead of checking (2026-10-25)',
    'OPPX'
  ),
  receipt(
    'v58_one_card_low_flush_fold',
    'HorseLogic (tournament aggression)',
    'a one-card low flush on a four-flush board folded instead of calling off a tournament stack (2026-10-25)',
    'OPPX'
  ),
  receipt(
    'v58_made_hand_cell_skip',
    'HorseLogic (tournament aggression)',
    'a set, straight, flush or better was bet by the value ladder instead of following a hand-class-mean solver cell that cannot see it (2026-10-26)',
    'OPPX'
  ),
  receipt(
    'v57_turn_cell_initiative_skip',
    'HorseLogic (tournament aggression)',
    'a tournament flop bettor played the turn from its barrel plan, not the check-heavy turn cell keyed without initiative (2026-10-25)',
    'OPPX'
  ),
  receipt(
    'maniac_call_down',
    'HorseLogic (maniac pressure)',
    "a fold facing a maniac's bet became the call its equity pays for (Dan: 'CALL OFF LIGHTER')",
    'OPPX'
  ),
  receipt(
    'opponent_exploit_preflop',
    'HorseLogic (opponent exploit)',
    "a raiser or limper read outside the horse envelope moved a preflop bar (Dan: 'raising and potting at a 100% VPIP')",
    'OPPX'
  ),
  receipt(
    'opponent_exploit_postflop',
    'HorseLogic (opponent exploit)',
    'traps against a read aggressor or bigger value sizes into a read station',
    'OPPX'
  ),
  receipt(
    'opponent_exploit_calldown',
    'HorseLogic (opponent exploit)',
    "the current bettor's own read priced the call instead of the table average",
    'OPPX'
  ),
  receipt(
    'v58_plo6_river_fold',
    'HorseLogic (V58 PLO6 river nuts)',
    "a PLO6 river bet on a paired board was folded because a random hand beats the hand 15% of the time or more (Dan: 'IF ITS NOT THE NUTS, ITS PROBABLY NOT GOOD')",
    'V58'
  ),
  receipt(
    'v58_plo6_river_raise_to_call',
    'HorseLogic (V58 PLO6 river nuts)',
    'a PLO6 river raise on a paired board became a call because a better hand was possible',
    'V58'
  ),
  receipt(
    'v59_plo6_river_unpaired_fold',
    'HorseLogic (V59 PLO6 river, unpaired board)',
    'a PLO6 river bet on a board with no pair was folded because a random hand beats the hand 30% of the time or more',
    'V59'
  ),
  receipt(
    'v59_plo6_river_unpaired_raise_to_call',
    'HorseLogic (V59 PLO6 river, unpaired board)',
    'a PLO6 river raise on a board with no pair became a call because a random hand beats it 15% of the time or more',
    'V59'
  ),
  receipt(
    'v83_aggression_shown_as_value',
    'HorseMind.legacyExploit (V83)',
    'a postflop aggression factor above 2.5 kept neutral respect because 75%+ of the bettor s 20+ big river bets showed down strong (callDownMod stays 1)',
    'V83'
  ),
  receipt(
    'opponent_exploit_corroborated',
    'HorseMind (opponent exploit)',
    "a statistic past every horse at this table size engaged because the same player's other table size engaged it (2026-10-25)",
    'OPPX'
  ),
  receipt(
    'plan_fingerprint_recorded',
    'HorseLogic.recordPlanFingerprint (Items 21 and 23)',
    'a planned flop or turn barrel recorded the next-street contender and exposure fingerprint it expects (effect sink; lands on acceptance)',
    'Items21And23',
    'decide',
    0.0005
  ),
  receipt(
    'plan_fingerprint_*',
    'HorseLogic (Items 21 and 23)',
    'the next street met the planned fingerprint: improved_on_good_card / continued_on_blank / checked_scare_card keep the plan with V39 in charge of the card; aborted_multiway_contender_shift / aborted_stack_exposure_shift / aborted_scare_under_pressure withdraw it; absent means the plan carried no fingerprint (recorded before this layer, or by a sandbox without it)',
    'Items21And23'
  ),
  receipt(
    'opponent_memory_donor_fresh',
    'HorseMind.blendDurableRead (Item 12)',
    "a thin exact opponent row borrowed the sibling table-size bucket at full donor weight (tapered by the exact sample) because the donor was refreshed on this player's current hand clock",
    'Item12'
  ),
  receipt(
    'opponent_memory_donor_stale',
    'HorseMind.blendDurableRead (Item 12)',
    'a thin exact opponent row borrowed the sibling bucket at a weight decayed by the hands this player has played since that bucket was last refreshed (120-hand half-life)',
    'Item12'
  ),
  receipt(
    'opponent_memory_donor_expired',
    'HorseMind.blendDurableRead (Item 12)',
    'a thin exact opponent row had a sibling bucket available but its decayed weight was below the floor, so the read used the exact row alone',
    'Item12'
  ),
  receipt(
    'opponent_memory_donor_staleness_unknown',
    'HorseMind.blendDurableRead (Item 12)',
    "a thin exact opponent row had a pooled sibling bucket whose staleness on this player's hand clock could not be told, so it was not borrowed (could not tell is never fresh)",
    'Item12'
  ),
  receipt(
    'plo_opponent_presumed_aggressive',
    'HorseMind (PLO presumption)',
    'an Omaha opponent received the shared aggressive raise prior before their own public hands proved otherwise (owner update 2026-10-27)',
    'OPPX'
  ),
  receipt(
    'plo_opponent_neutral_unknown',
    'HorseMind (omahaNeutralUnknown)',
    'an Omaha opponent with no engaged raise read was read as neutral instead of presumed aggressive (default off)',
    'Omaha neutral unknown'
  ),
  receipt(
    'plo_tight_raiser_respected',
    'HorseLogic (omahaTightOpponent)',
    'facing an open or re-raise from a proven tight Omaha raiser, the respect bars changed the preflop intent',
    'Omaha tight opponent'
  ),
  receipt(
    'plo_tight_blinds_steal',
    'HorseLogic (omahaTightOpponent, omahaTightOpponentSteal)',
    'first in from late position or the small blind with every player left to act a proven tight Omaha folder, the wider steal changed the preflop intent',
    'Omaha tight opponent'
  ),
  receipt(
    'hu_tight_big_blind_steal',
    'HorseLogic (huSmallBlindStealsVsTightBigBlind)',
    "default-off huSmallBlindStealsVsTightBigBlind: the heads-up no-limit hold'em small blind first in faced a proven tight folder in the big blind whose estimated fold share clears the largest open's break-even on folds alone: the spot qualified and every hand was considered for the open (counted when the spot qualifies, including hands that would have opened anyway and hands a later layer still does not open)",
    'HuDefence'
  ),
  receipt(
    'plo_tight_opponent_considered',
    'HorseLogic (omahaTightOpponent)',
    'a proven tight Omaha raiser or set of folders was read and the adjustment applied, but the preflop intent was the same without it',
    'Omaha tight opponent'
  ),
  receipt(
    'plo_opponent_presumption_disproved',
    'HorseMind (PLO presumption)',
    "an opponent's own public hands disproved the shared Omaha raise presumption, identically for people and horses",
    'OPPX'
  ),
  retiredReceipt(
    'plo_human_presumed_aggressive',
    'source',
    "a person at an Omaha table read as an aggressive raiser before their own hands proved it (Dan: 'TAG THEM ALL FROM THE START')",
    'OPPX'
  ),
  retiredReceipt(
    'plo_human_presumption_disproved',
    'source',
    "a person's own hands showed raising no higher than the average horse, so the PLO presumption came off",
    'OPPX'
  ),
  receipt(
    'v17_short_deck',
    'HorseLogic (V17)',
    'short deck tightening; needs short-deck tables',
    'V17',
    'decide_short_deck',
    0.2
  ),
  receipt(
    'v18_straddle',
    'HorsePreflop (V18)',
    'straddle read as unopened; needs straddle tables',
    'V18'
  ),
  receipt(
    'v18_self_image',
    'HorseLogic (V18)',
    'own image fed bluff volume',
    'V18',
    'decide',
    0.05
  ),
  receipt(
    'v18_exploit_size',
    'HorseLogic (V18)',
    'station/nit river raise sizing',
    'V18',
    'decide',
    0.00005
  ),
  receipt(
    'v19_overbet_polarity',
    'HorseLogic (V19)',
    // 2026-11-07: floor 0.0005 -> 0.00005. The layer fires when a horse faces
    // a river overbet (> 1.2x pot), and since Hybrid v1 (#9488, live
    // 2026-11-05/06: one Grinder/Tricky profile, sizing x0.94) the fleet
    // stopped making them: cash NLH river wagers over 1.2x pot were 1,699 of
    // 11,126 on 2026-11-04, 629 of 4,927 on 11-05, 150 of 3,849 on 11-06.
    // Per decide 0.094-0.105% on 11-02..11-04, 0.0135% on 11-06, 0.0141% 11-07.
    'overbet respect shift (fires only facing a > 1.2x-pot river overbet)',
    'V19',
    'decide',
    0.00005
  ),
  receipt(
    'v19_river_bigbet_cap',
    'HorseLogic (V15/V19)',
    'big river bet into a dominated Omaha hand',
    'V19',
    'decide_omaha',
    0.0005
  ),
  receipt(
    'v20_mzone_wired',
    'HorseLogic (V20)',
    'tournament M-zone consulted; tournament volume',
    'V20'
  ),
  receipt(
    'v20_pressure_read',
    'HorseLogic (V20)',
    'multiway pressure counted',
    'V20',
    'decide',
    0.005
  ),
  receipt(
    'v20_pressure_cap',
    'HorseLogic (V20)',
    'NLH pressure cap applied',
    'V20',
    'decide_nlh',
    0.0005
  ),
  receipt(
    'v20_weak2p_demote',
    'HorseLogic (V20)',
    'weak two pair on a paired board demoted',
    'V20',
    'decide_nlh',
    0.002
  ),
  receipt(
    'v20_commit_bar',
    'HorseLogic (V20)',
    'commit bar raised multiway',
    'V20',
    'decide',
    0.0005
  ),
  receipt('v21_nut_status', 'HorseLogic (V21)', 'NLH nut status read', 'V21', 'decide_nlh', 0.01),
  receipt(
    'v21_dominated_cap',
    'HorseLogic (V21)',
    'board-dominated NLH hand capped',
    'V21',
    'decide_nlh',
    0.0002
  ),
  receipt('v21_scare_cap', 'HorseLogic (V21)', 'scare-runout cap', 'V21', 'decide_nlh', 0.00005),
  receipt(
    'v21_scare_commit',
    'HorseLogic (V21)',
    'scare premium in the committed branch',
    'V21',
    'decide',
    0.0002
  ),
  receipt('v21_war_gate', 'HorseLogic (V21)', 'river raise-war governor', 'V21', 'decide', 0.0002),
  receipt(
    'v23_river_read',
    'HorseLogic (V23)',
    // Observer-gated since #8075; see the V16 deep-read note above.
    "river read consulted (observer-gated: the horse's own river-fold sample)",
    'V23',
    'decide',
    0.0002
  ),
  receipt(
    'river_call_light_read',
    'HorseLogic (river call read)',
    'heads-up river vs a light river caller: fewer bluffs, thinner value',
    '2026-10-25'
  ),
  receipt(
    'lightning_phase15_plan_accepted_exact',
    'LightningHandHost (Phase 15 plan acceptance)',
    'a Lightning horse wager was accepted exactly as its issued plan and its effects committed',
    '2026-10-28'
  ),
  receipt(
    'lightning_phase15_plan_retired_inexact',
    'LightningHandHost (Phase 15 plan acceptance)',
    'a Lightning horse plan was retired because the accepted wager differed from the issued plan',
    '2026-10-28'
  ),
  // LAYER RECEIPTS (2026-11-05): every live decision layer carries a receipt.
  receipt(
    'river_nuts_wager',
    'HorseLogic wager_rules (river nuts #7780, #7788)',
    'the exact river nuts raised, bet or sized up to the full target (fires when the rule changed the decision)',
    '2026-11-05'
  ),
  receipt(
    'near_pot_wager_full_pot',
    'HorseLogic wager_rules (#7780)',
    'a 90 to 100 percent pot bet or raise was rounded up to the full pot',
    '2026-11-05'
  ),
  receipt(
    'river_nuts_wager_already_full',
    'HorseLogic wager_rules (river nuts #7780, #7788)',
    'valid no-change: the exact river nuts were already bet or raised to the full target',
    '2026-11-05'
  ),
  receipt(
    'river_nuts_wager_superseded',
    'HorseLogic wager_rules (river nuts #7780, #7788)',
    'precedence: the PLO6 river nut discipline replaced the nut wager the rule had set',
    '2026-11-05'
  ),
  receipt(
    'omaha_implied_credit_draw',
    'HorseLogic call pricing (#7876)',
    'Omaha flop or turn call paid the implied allowance to a physical flush, straight or low draw',
    '2026-11-05'
  ),
  receipt(
    'omaha_implied_credit_withheld',
    'HorseLogic call pricing (#7876)',
    'Omaha flop or turn call denied the implied allowance because there was no physical draw',
    '2026-11-05'
  ),
  receipt(
    'omaha_board_blocked_nut_draw',
    'HorseLogic drawInfo40 via HorseEval (#8220)',
    'the nut flush draw was read past an ace the board holds (a lower suited rank is the live nut draw)',
    '2026-11-05'
  ),
  receipt(
    'plo8_low_outlook_read',
    'HorseLogic recordBarrelOutlook via HorseEval (#9351)',
    'the PLO8 low-draw and counterfeit outlook classified at least one next card',
    '2026-11-05'
  ),
  receipt(
    'plo8_low_outlook_considered',
    'HorseLogic recordBarrelOutlook via HorseEval (#9351)',
    'the PLO8 low-draw and counterfeit outlook graded the read and classified no card',
    '2026-11-05'
  ),
  // Upgrade evidence (2026-11-12): one counter on each enabled upgrade's own
  // path, so "enabled" is provable from the serving release
  // (HORSE_UPGRADE_LIVE_EVIDENCE, HorseUpgradeLiveEvidence.law.test.ts).
  // Evidence only; each depends on table mix and none is a health ratio.
  // Per-decision upgrade counters name their denominator (decide_postflop,
  // every live decision that enters the postflop brain, from 2026-11-13;
  // before that it was every decision, preflop included) and carry NO floor yet. A floor was set here on 2026-11-12
  // before any of these counters had served, and the receipt audit reads a
  // floor as fact: zero fires against 1,000 decisions is reported critical
  // whether or not an eligible postflop decision occurred, and an audit that
  // runs between an off-schedule boot and the first telemetry flush would say
  // the same of a healthy layer. An unmeasured rate is not a rule. PROVISIONAL
  // proposal, to be validated against the first complete live UTC day and
  // only then written as minRatio: 0.0005 of decide for each of the three
  // (postflop decisions were about 26 percent of decide on 2026-11-11). Until
  // then silence after two live days is still reported by the drift audit,
  // which judges a counter against its own history.
  receipt(
    'upgrade01_action_line_posterior',
    'HorseLogic postflop (computeActionLinePosterior)',
    'a telemetry-on postflop decision computed the public action-line posterior',
    '2026-11-12',
    'decide_postflop'
  ),
  receipt(
    'upgrade02_card_removal_scored',
    'HorseLogic postflop (scoreCardRemoval)',
    'a telemetry-on postflop decision scored its blockers',
    '2026-11-12',
    'decide_postflop'
  ),
  receipt(
    'phase14_kernel_refused_*',
    'horseDecision workerRuntime (FAST)',
    'an admitted Phase 14 domain decision outside the kernel family, by the first refusing check (two dealt seats, river, opponent all in, ante geometry, baseline); named *_seen (occurrence, not a layer)',
    '2026-11-13'
  ),
  receipt(
    'phase14_kernel_eligible_deep_seen',
    'horseDecision workerRuntime (DEEP)',
    'a DEEP second look that reached the admitted corrective kernel; kept apart from the FAST count; named *_seen (occurrence, not a layer)',
    '2026-11-13'
  ),
  receipt(
    'phase14_kernel_eligible_seen',
    'horseDecision workerRuntime (FAST)',
    'a FAST decision reached the admitted corrective kernel: usable authority, candidate mode and a snapshot inside the kernel declared family (cash: two dealt seats, river, opponent all in); named *_seen (occurrence, not a layer)',
    '2026-11-12'
  ),
  receipt(
    'upgrade05_*',
    'horseDecision client prewarmStreet',
    'a street prewarm was asked for and not posted (worker busy, held or not ready); named *_seen (occurrence, not a layer)',
    '2026-11-12'
  ),
  receipt(
    'upgrade04_*',
    'HorseEval buildOmahaReservoir',
    'an Omaha preflop reservoir was built; once per process and reservoir, so a handful per release; named *_seen (occurrence, not a layer)',
    '2026-11-12'
  ),
  receipt(
    'upgrade06_public_timing_hint',
    'HorseLogic think-time hint',
    'the think-time difficulty hint came from public complexity',
    '2026-11-12',
    'decide_postflop'
  ),
  receipt(
    'upgrade08_*',
    'ServerTableEngineRunout; ServerTableEngineTurns; LightningHorse; HorseLogic',
    "a run-it-twice answer was decided, on the Horse's public all-in equity, as its delayed send fired (2026-11-13; counts answers actually sent, so raw rit counts step down from the 2026-11-14 deploy), an insurance offer went to a Horse leader (offered) or its answer was sent, kill-pot or seven-deuce context reached a decision request, or the brain read it in that decision (kill_pot_orbit, kill_pot_unopened, seven_deuce_overlay, seven_deuce_bounty); named *_seen (occurrence, not a layer); silent where no table offers the side game",
    '2026-11-12'
  ),
  receipt(
    'upgrade09_*',
    'ServerTableEngineTurns; LightningHandHost',
    'a stale pre-action on a Horse seat was cleared at its live turn; named *_seen (occurrence, not a layer); rare by design',
    '2026-11-12'
  ),
  receipt(
    'upgrade10_*',
    'HorseOpponentExploit',
    'the fast recency window switched a read on, or a gear shift engaged; counts read computations, not decisions',
    '2026-11-12'
  ),
  receipt(
    'upgrade11_*',
    'HorseEvEngine evaluateSpot and riverCallVerdict',
    'the persona indifference band was asked about a real choice, and whether the pick differed from the best',
    '2026-11-12'
  ),
  // Per-Horse upgrade evidence (2026-11-14): the health of the per-Horse record itself. All eight are
  // occurrence counters with no floor; zero is the normal state, and any positive value on a day
  // means horse_upgrade_evidence_daily undercounts that day for the process that fired it.
  receipt(
    'per_horse_evidence_cell_dropped_seen',
    'HorseUpgradeEvidence add',
    'the per-Horse upgrade aggregate was at its 8,192-cell cap and an increment that would open another cell was dropped',
    '2026-11-14'
  ),
  receipt(
    'per_horse_evidence_identity_refused_seen',
    'HorseUpgradeEvidence noteHorseUpgradeDecision and noteHorseUpgradeEvent',
    'a decision or host event carried a user id that is not a uuid and was not recorded (the writer stores a uuid)',
    '2026-11-14'
  ),
  receipt(
    'per_horse_evidence_arming_failed_seen',
    'HorseUpgradeEvidenceFlush startHorseUpgradeEvidenceFlush',
    'arming the per-Horse aggregate threw at service start (the activation manifest could not be read); evidence stays off for that process and its boot continues',
    '2026-11-14'
  ),
  receipt(
    'per_horse_evidence_fold_failed_seen',
    'workerRuntime executeFastWithUpgradeEvidence',
    'recording one answered FAST decision per Horse threw; the decision and its lifecycle were not touched and that decision is missing from the per-Horse record',
    '2026-11-14'
  ),
  receipt(
    'per_horse_evidence_batch_rejected_seen',
    'HorseUpgradeEvidenceFlush publisher',
    'fn_horse_upgrade_evidence_flush refused a batch for a property of its bytes and the publisher dropped it instead of resending it',
    '2026-11-14'
  ),
  receipt(
    'per_horse_evidence_batch_abandoned_seen',
    'HorseUpgradeEvidenceFlush publisher',
    'a per-Horse evidence batch stayed unconfirmed for HORSE_UPGRADE_EVIDENCE_MAX_ATTEMPTS flushes (an hour at one every 300 seconds) and was dropped',
    '2026-11-14'
  ),
  receipt(
    'per_horse_evidence_function_missing_seen',
    'HorseUpgradeEvidenceFlush publisher',
    'the database answered that fn_horse_upgrade_evidence_flush does not exist; the rows went back into the capped aggregate for the next tick',
    '2026-11-14'
  ),
  receipt(
    'per_horse_evidence_write_unconfirmed_seen',
    'HorseUpgradeEvidenceFlush publisher',
    'a per-Horse evidence write was not acknowledged (transport error, timeout or malformed acknowledgement); the same bytes are resent next tick',
    '2026-11-14'
  ),
  receipt(
    'closed_table_hand_memory_released',
    'ServerTableEngineBase (#9351)',
    'a terminally closed table released its per-hand memory',
    '2026-11-05'
  ),
  receipt(
    'exploit_hydrator_boot_replayed',
    'HorseExploitHydrator at worker boot (#7734)',
    'the exploit counters were rebuilt from recent human hands before the worker was READY',
    '2026-11-05'
  ),
  receipt(
    'exploit_hydrator_boot_replayed_empty',
    'HorseExploitHydrator (#7734)',
    'valid no-change: the worker boot replay found no human-dealt hand in the window',
    '2026-11-05'
  ),
  receipt(
    'exploit_hydrator_boot_replay_read_stopped',
    'HorseExploitHydrator (#7734)',
    'the boot replay stopped reading on a query or page error and replayed only what it had read',
    '2026-11-05'
  ),
  receipt(
    'wager_bound_opponent_read',
    'HorseLogic opponent read (#8847)',
    'the opponent and tempo reads were bound to the wager that set this street price',
    '2026-11-05'
  ),
  receipt(
    'wager_bound_opponent_read_past_short_all_in',
    'HorseLogic opponent read (#8847)',
    'the bound read skipped a later short all-in caller an unbound read would have targeted',
    '2026-11-05'
  ),
  receipt(
    'wager_bound_pressure_read',
    'HorseLogic V40 pressure read (#8847)',
    'the V40 barrel-count pressure read targeted the real bettor of this street (facing a wager, every variant)',
    '2026-11-05'
  ),
  receipt(
    'lightning_horse_fast_fold',
    'LightningHandHost (#7958, #7993)',
    'an already-folding horse pressed Lightning Fold at a person look-and-press time',
    '2026-11-05'
  ),
  receipt(
    'lightning_horse_fast_fold_considered',
    'LightningHandHost (#7958, #7993)',
    'an early look was priced and the horse was not already folding',
    '2026-11-05'
  ),
  receipt(
    'river_call_showdown_learned',
    'HorseMind.observeCompletedHand (#8160, #8214)',
    'a shown river call taught the caller read (riverCallSD)',
    '2026-11-05'
  ),
  receipt(
    'river_call_light_read_considered',
    'HorseLogic river read (#8160, #8214)',
    'the river caller showdown read was consulted and had no qualified sample',
    '2026-11-05'
  ),
  receipt(
    'river_last_to_act_counted',
    'HorseMind.observeCompletedHand (#8386)',
    'a last-to-act river opportunity was counted for one opponent',
    '2026-11-05'
  ),
  receipt(
    'range_read_big_bet_counted',
    'HorseMind.bandFor (#8563)',
    'the public range read counted a priced big wager on the newest street',
    '2026-11-05'
  ),
  receipt(
    'range_read_capped_all_in_not_big_bet',
    'HorseMind.bandFor (#8563)',
    'the public range read refused to count a capped all-in call as a big bet',
    '2026-11-05'
  ),
  receipt(
    'hu_cash_matched_commitment',
    'HorseLogic postflop (#8464)',
    'heads-up cash SPR and commitment read the exposure the opponent can match',
    '2026-11-05'
  ),
  receipt(
    'hu_cash_matched_commitment_covered',
    'HorseLogic SPR (#8464)',
    'valid no-change: heads-up cash, the opponent covers so the matched exposure equals the stack',
    '2026-11-05'
  ),
  receipt(
    'hu_cash_matched_commitment_wager',
    'HorseLogic postflop (#8464)',
    'the committed branch returned the matched-commitment wager instead of the whole stack',
    '2026-11-05'
  ),
  receipt(
    'lightning_original_hand_bound',
    'LightningHorse snapshot (#8065)',
    'a Lightning decision carried its original hand and lease coordinate',
    '2026-11-05'
  ),
  receipt(
    'lightning_original_hand_unbound',
    'LightningHorse snapshot (#8065)',
    'a Lightning decision arrived without its original hand and lease coordinate',
    '2026-11-05'
  ),
  receipt(
    'horse_history_cache_entry_bound_evicted',
    'horseDecision/ownPublicHistory (#9387 family)',
    'the bounded own-history cache evicted its oldest entry at the entry bound',
    '2026-11-05'
  ),
  receipt(
    'horse_history_retention_refused',
    'horseDecision/ownPublicHistory (#9387 family)',
    'the retention budget refused a history load',
    '2026-11-05'
  ),
  receipt(
    'horse_observer_history_domain_complete',
    'services/HorseOwnPublicHistory version-2 (speed/ante) own-history load',
    "every hand the installed reader returned carried this context's original speed/ante domain, so the partitioned window kept them all (#9693)",
    '2026-11-07'
  ),
  receipt(
    'horse_observer_history_domain_partitioned',
    'services/HorseOwnPublicHistory version-2 (speed/ante) own-history load',
    'at least one returned hand carried no domain or another domain and was excluded from the partitioned window, which is then capped (#9693); legacy hands before 2026-11-06 fall here',
    '2026-11-07'
  ),
  receipt(
    'horse_exact_memory_read_ok',
    'services/HorseExactOpponentMemory completed-hand exact public-memory read',
    'a saved exact speed/ante domain profile batch was read and validated for a completed hand (the legacy horse_opponent_memory_read_ok reader is not on this path once the hand carries its domain)',
    '2026-11-07'
  ),
  receipt(
    'horse_exact_memory_read_ms_*',
    'services/HorseExactOpponentMemory completed-hand exact public-memory read',
    'latency bucket of each validated exact read, the same edges as horse_opponent_memory_read_ms_*',
    '2026-11-07'
  ),
  receipt(
    'horse_exact_memory_read_failed',
    'services/HorseExactOpponentMemory completed-hand exact public-memory read',
    'the exact read failed in transport or the query; classified by the legacy reader rules',
    '2026-11-07'
  ),
  receipt(
    'horse_exact_memory_read_timeout',
    'services/HorseExactOpponentMemory completed-hand exact public-memory read',
    'the exact read was aborted, timed out or canceled by the database (57014)',
    '2026-11-07'
  ),
  receipt(
    'horse_exact_memory_read_busy',
    'services/HorseExactOpponentMemory completed-hand exact public-memory read',
    'the shared read admission refused the exact read as busy',
    '2026-11-07'
  ),
  receipt(
    'horse_exact_memory_read_invalid',
    'services/HorseExactOpponentMemory completed-hand exact public-memory read',
    'the database answered but the rows failed receipt validation (wrong domain, actor, context or shape); no legacy fallback',
    '2026-11-07'
  ),
  receipt(
    'v60_cash_pressure_facing_open',
    'HorsePreflop via HorseLogic (V60 #8694)',
    'NLH cash facing one open: the V60 value 3-bet bar and re-steal volume were applied',
    '2026-11-05'
  ),
  receipt(
    'v60_cash_pressure_facing_open_superseded',
    'HorsePreflop via HorseLogic (V60 #8694)',
    'precedence: facing one open, the V74 base or an earlier lower bar kept the 3-bet width',
    '2026-11-05'
  ),
  receipt(
    'bluff_raise_refused_no_fold_equity_seen',
    'HorsePreflop via HorseLogic (HVH2D-TRN-001 row 8)',
    'a squeeze bluff or 3-bet bluff passed every earlier condition and its draw, and was refused only because nobody could fold (the price was the whole stack, or every opponent was all in); named *_seen (occurrence, not a layer); rare by design',
    '2026-11-12'
  ),
  receipt(
    'hand_memory_domain_recorded_seen',
    'ServerTableEngineSettlement.postHandTasks (HVH2D-EXE-002)',
    'a settled hand built its row with a public memory domain; one per settled table hand; named *_seen (occurrence, not a layer); counts what settlement built, not what was stored',
    '2026-11-12'
  ),
  receipt(
    'hand_memory_domain_absent_seen',
    'ServerTableEngineSettlement.postHandTasks (HVH2D-EXE-002)',
    'a settled hand built its row without a public memory domain (the blind snapshot was missing or invalid), so the opponent-memory learner will skip it; named *_seen (occurrence, not a layer); expected near zero',
    '2026-11-12'
  ),
  receipt(
    'v60_cash_pressure_opener_vs_three_bet',
    'HorsePreflop via HorseLogic (V60 #8694)',
    'NLH cash opener facing a 3-bet up to 100bb: the V60 continue and 4-bet bars were applied',
    '2026-11-05'
  ),
  receipt(
    'v23_plan_callonce',
    'HorseLogic (V23)',
    'raise plan: call once honored',
    'V23',
    'decide',
    0.001
  ),
  receipt('v23_plan_fold', 'HorseLogic (V23)', 'raise plan: fold honored', 'V23', 'decide', 0.0001),
  receipt('v23_bounty_call', 'HorseLogic (V23)', 'bounty priced into a call; PKO volume', 'V23'),
  receipt('v23_spin', 'HorseLogic (V23)', 'spin overlay; spin volume', 'V23'),
  receipt('v24_bounty_pull', 'HorsePreflop (V24)', 'PKO bounty pull; PKO volume', 'V24'),
  receipt(
    'v26_prize_read',
    'HorseLogic (V26)',
    'mystery prize landscape; chest tournaments only',
    'V26'
  ),
  receipt(
    'v70_gto_open',
    'HorsePreflop (V70)',
    "Hold'em raise-first-in read on the seat's GTO reference order (unopened, unlimped, two or more dealt in)",
    'V70',
    'decide_nlh',
    0.01
  ),
  receipt(
    'v71_ante_push',
    'HorseLogic (V71)',
    "Hold'em folded-to jam at <= 15bb answered by the ante-aware Nash push/fold table (tournaments and ante cash; also counted in v27_gto_open_jam)",
    'V71',
    'decide_nlh'
  ),
  receipt(
    'v72_defend_vs_opener',
    'HorsePreflop (V72)',
    "Hold'em facing one open with nobody in, defended on the (defender, opener seat) reference base",
    'V72',
    'decide_nlh',
    0.005
  ),
  receipt(
    'v73_vs3bet_defence',
    'HorsePreflop (V73)',
    "Hold'em opener facing one 3-bet with nobody else in, continued on a share of its own seat's open width",
    'V73',
    'decide_nlh',
    0.002
  ),
  receipt(
    'v74_nlh_open_size',
    'HorsePreflop (V74)',
    "No-limit hold'em raise-first-in open drawn from the V74 seat/table/format/depth band (cash never under 2.5bb)",
    'V74',
    'decide_nlh',
    0.005
  ),
  receipt(
    'cash_nlh_three_bet_size',
    'HorsePreflop cash sizing',
    'Cash NLH 3-bet or squeeze sized by public position, depth and callers within a card-blind band',
    'HybridV1',
    'decide_nlh',
    0.002
  ),
  receipt(
    'v76_retired_four_bet_bluff',
    'HorsePreflop (V76)',
    "Hold'em facing one 3-bet: the V7 4-bet-bluff band rolled and was retired; the hand took the call / fold read instead",
    'V76',
    'decide_nlh'
  ),
  receipt(
    'omaha_river_non_nut_raise_flatted',
    'HorseLogic wager_rules (HorseOmahaRiverNutRaise)',
    'PLO4/PLO5/PLO6 high river raise or all-in over a wager without the nuts or an effective-nut hand: became a call (the call-discipline folds then judge it)',
    'V94'
  ),
  receipt(
    'omaha_river_non_nut_raise_fold_restored',
    'HorseLogic wager_rules (HorseOmahaRiverNutRaise)',
    'a later policy owner raised a river hand the reference had folded, without the nuts: the fold came back',
    'V94'
  ),
  receipt(
    'v81_river_set_big_bet_fold',
    'HorseLogic (V81, river set cell)',
    'PLO4/PLO5 river call of a 0.9-pot+ wager with a set or trips on a straight- or flush-possible board: folded (counted inside v81_omaha_big_bet_call_fold as well)',
    'V94'
  ),
  receipt(
    'omaha_one_pair_river_value_bet_checked',
    'HorseLogic wager_rules (HorseOmahaOnePair)',
    'a PLO4/PLO5 river bet with one pair or less that the reference brain did not declare a bluff: became a check',
    'V94'
  ),
  receipt(
    'omaha_one_pair_river_value_raise_flatted',
    'HorseLogic wager_rules (HorseOmahaOnePair)',
    'a PLO4/PLO5 river raise over a wager with one pair or less that the reference brain did not declare a bluff: became a call',
    'V94'
  ),
  receipt(
    'omaha_one_pair_river_beaten_call_folded',
    'HorseLogic wager_rules (HorseOmahaOnePair)',
    'a PLO4/PLO5 river call of a 0.66-pot+ wager with two pair or less on a straight- or flush-possible board, the bettor not a measured postflop over-bluffer: folded',
    'V94'
  ),
  receipt(
    'omaha_one_pair_raise_flatted',
    'HorseLogic wager_rules (HorseOmahaOnePair)',
    'a PLO4/PLO5 flop or turn raise with one pair and fewer than four nut-class outs, the call costing no more than half the effective stack: became a call',
    'V94'
  ),
  receipt(
    'omaha_one_pair_raise_folded',
    'HorseLogic wager_rules (HorseOmahaOnePair)',
    'a PLO4/PLO5 flop or turn raise with one pair and fewer than four nut-class outs, the call costing more than half the effective stack: became a fold',
    'V94'
  ),
  receipt(
    'hu_postflop_balance_flop_cbet',
    'HorseLogic wager_rules (HorseHeadsUpPostflopBalance)',
    'holdemHeadsUpPostflopBalance on: a heads-up in-position NLH cash flop c-bet decision after a check (single-raised pot) was replaced by the one 0.75-pot size or a check at the tier frequency',
    'V94'
  ),
  receipt(
    'hu_postflop_balance_check_raise_defend',
    'HorseLogic wager_rules (HorseHeadsUpPostflopBalance)',
    'holdemHeadsUpPostflopBalance on: a heads-up NLH cash flop fold to a check-raise after the horse c-bet, with a middle pair or better or a flush or open-ended straight draw, became a call',
    'V94'
  ),
  receipt(
    'hu_postflop_balance_later_street',
    'HorseLogic wager_rules (HorseHeadsUpPostflopBalance)',
    'holdemHeadsUpPostflopBalance on: a heads-up in-position NLH cash turn decision after a check (single-raised pot) was replaced by the one 0.70-pot size or a check at the tier frequency (the river is not covered)',
    'V94'
  ),
  receipt(
    'omaha_one_pair_stack_off_folded',
    'HorseLogic wager_rules (HorseOmahaOnePair)',
    'a PLO4/PLO5 flop or turn call costing more than half the effective stack with one pair and fewer than four nut-class outs: folded',
    'V94'
  ),
  receipt(
    'omaha_turn_beaten_raise_flatted',
    'HorseLogic wager_rules (HorseOmahaMadeHandDefense)',
    'PLO4/PLO5/PLO6 high turn raise or all-in over a wager with a made hand a possible straight or flush beats: became a call',
    'V94'
  ),
  receipt(
    'omaha_turn_beaten_raise_fold_restored',
    'HorseLogic wager_rules (HorseOmahaMadeHandDefense)',
    'a later policy owner raised a turn hand the reference had folded, with a made hand a possible straight or flush beats: the fold came back',
    'V94'
  ),
  receipt(
    'omaha_beaten_fresh_card_check',
    'HorseLogic wager_rules (HorseOmahaMadeHandDefense)',
    'a turn or river bet with a made hand the street card made beatable by a straight or flush, with a player still to act behind: became a check',
    'V94'
  ),
  receipt(
    'omaha_beaten_river_no_value_bet',
    'HorseLogic wager_rules (HorseOmahaMadeHandDefense)',
    'a river bet with a made hand a possible straight or flush beats, into a player who bet or raised a street on which it was already possible: became a check',
    'V94'
  ),
  receipt(
    'omaha_nut_class_pot_wager',
    'HorseLogic wager_rules (HorseOmahaMadeHandDefense)',
    'a PLO4/PLO5 bet or raise with the nuts or an effective-nut hand was sized up to the full pot (or the stack)',
    'V94'
  ),
  receipt(
    'omaha_reraised_pot_preflop_fold',
    'HorseLogic call discipline (HorseOmahaReraisedPot)',
    'PLO4/PLO5 cash continue facing a 4-bet or more preflop with a hand without aces or a premium structure, not paying the committed price against aces: folded',
    'V94'
  ),
  receipt(
    'omaha_reraised_pot_postflop_fold',
    'HorseLogic call discipline (HorseOmahaReraisedPot)',
    'PLO4/PLO5 cash stack-off with one pair or two pair below top two in a pot raised three or more times preflop, equity against aces or top two or better under the price: folded',
    'V94'
  ),
  receipt(
    'omaha_reraised_pot_realistic_fold',
    'HorseLogic call discipline (HorseOmahaReraisedPot)',
    'PLO4/PLO5 cash stack-off with one pair or two pair below top two in a pot raised three or more times preflop, equity against the realistic range under the price, bettor not a measured over-bluffer: folded',
    'V94'
  ),
  receipt(
    'omaha_reraised_pot_priced_in',
    'HorseLogic call discipline (HorseOmahaReraisedPot)',
    'a re-raised-pot continue the rule examined kept, because its equity against the declared range paid the price',
    'V94'
  ),
  receipt(
    'omaha_reraised_fold_vs_tight',
    'HorseLogic call discipline (HorseOmahaReadConditional, omahaReraisedFoldVsTight)',
    'PLO4/PLO5 cash continue facing a 4-bet or more preflop from a measured tight re-raiser, with a hand without aces or a premium structure, not paying the committed price against aces: folded',
    'V94'
  ),
  receipt(
    'omaha_reraised_fold_vs_tight_priced_in',
    'HorseLogic call discipline (HorseOmahaReadConditional, omahaReraisedFoldVsTight)',
    'a continue facing a measured tight re-raiser that the preflop cell examined and kept, because its equity against aces paid the committed price',
    'V94'
  ),
  receipt(
    'omaha_reraised_fold_vs_tight_withheld',
    'HorseLogic call discipline (HorseOmahaReadConditional, omahaReraisedFoldVsTight)',
    "a continue facing a 4-bet or more whose last raiser is not a measured tight re-raiser (wide, maniac, unknown or presumed): the cell was not asked, today's play",
    'V94'
  ),
  receipt(
    'omaha_no_call_cold_four_bet_without_premium',
    'HorseLogic call discipline (HorseOmahaUnderpair, omahaNoCallColdFourBetWithoutPremium)',
    'PLO4/PLO5 cash continue by a Horse whose own preflop re-raise was re-raised cold, with a hand without aces or a premium structure, the call not all in and leaving more behind than the call (or not paying the price against aces): folded',
    'V94'
  ),
  receipt(
    'omaha_no_call_cold_four_bet_without_premium_priced_in',
    'HorseLogic call discipline (HorseOmahaUnderpair, omahaNoCallColdFourBetWithoutPremium)',
    "a continue facing a cold re-raise of the Horse's own re-raise that the cell examined and kept: the call is all in or leaves no more behind than the call, and its equity against aces pays the direct price",
    'V94'
  ),
  receipt(
    'omaha_underpair_no_multiway_flop_continue',
    'HorseLogic call discipline (HorseOmahaUnderpair, omahaUnderpairNoMultiwayFlopContinue)',
    'PLO4/PLO5 cash flop continue facing a bet and a call from two live opponents with one pair below the top card of the board, no flush draw and fewer than eight nut-straight outs, at a tenth of the resulting pot or more: folded',
    'V94'
  ),
  receipt(
    'omaha_underpair_no_multiway_flop_continue_priced_in',
    'HorseLogic call discipline (HorseOmahaUnderpair, omahaUnderpairNoMultiwayFlopContinue)',
    'the same multiway underpair flop continue kept, because the call costs less than a tenth of the resulting pot',
    'V94'
  ),
  receipt(
    'omaha_vpip_floor_limp',
    'HorseLogic reference preflop (omahaVpipFloorByLimp)',
    'PLO4/PLO5 cash, unopened or limped pot, the VPIP floor unmet: an open-raise the unfloored brain does not make became the limp (or the small blind completion)',
    'V94'
  ),
  receipt(
    'omaha_vpip_floor_limp_fold',
    'HorseLogic reference preflop (omahaVpipFloorByLimp)',
    'PLO4/PLO5 cash, the Horse limped and faces a raise, the VPIP floor unmet: the hand does not clear the ordinary (unfloored) continue, so it folds and the floor call-down does not buy the call back',
    'V94'
  ),
  receipt(
    'omaha_vpip_floor_three_bet_bar_kept',
    'HorseLogic reference preflop (omahaVpipFloorByLimp)',
    'PLO4/PLO5 cash, facing a raise, the VPIP floor unmet: a re-raise or shove the unfloored brain does not make was withheld (its call, a call at the call-down price, or the fold instead)',
    'V94'
  ),
  receipt(
    'omaha_maniac_reraise_width_measured',
    'HorseMind.bandFor (omahaManiacReRaiseWidthMeasured)',
    'PLO4/PLO5 cash: the range of a measured maniac on a re-raising line (3-bet, 4-bet or more) was read at his own counted re-raise rate, narrower than his whole raising width',
    'V94'
  ),
  receipt(
    'omaha_elite_continues_vs_measured_wide_three_bettor',
    'HorseLogic V38 preflop price (HorseOmahaReadConditional, omahaEliteContinuesVsMeasuredWideThreeBettor)',
    'PLO4/PLO5 cash, the Horse opened and a measured wide re-raiser 3-bet it: an elite-class hand the maniac-price arithmetic refused called instead of folding (call under 40% of the stack, raw pot odds 0.34 or less)',
    'V94'
  ),
  receipt(
    'omaha_elite_continues_vs_measured_wide_three_bettor_withheld',
    'HorseLogic V38 preflop price (HorseOmahaReadConditional, omahaEliteContinuesVsMeasuredWideThreeBettor)',
    "an elite-class hand the maniac-price arithmetic refused facing one re-raise of the Horse's open, where the re-raiser is not a measured wide re-raiser or the price is above the bound: today's fold kept",
    'V94'
  ),
  receipt(
    'omaha_reraise_by_position_kept',
    'HorseLogic call discipline (HorseOmahaOopReraisedPot, omahaReraiseRangeOutOfPosition / omahaReraiseRangeEarlyPosition)',
    'a PLO4/PLO5 cash 3-bet or 4-bet out of position or from early position that the re-raise cell examined and kept: suited aces or a declared premium structure',
    'V94'
  ),
  receipt(
    'omaha_reraise_by_position_aces_committed',
    'HorseLogic call discipline (HorseOmahaOopReraisedPot, omahaReraiseRangeOutOfPosition / omahaReraiseRangeEarlyPosition)',
    'a 3-bet or 4-bet out of position or from early position with a pair of aces outside the suited class, kept because the stack-to-pot ratio once the re-raise is called is at or under 1',
    'V94'
  ),
  receipt(
    'omaha_reraise_by_position_called',
    'HorseLogic call discipline (HorseOmahaOopReraisedPot, omahaReraiseRangeOutOfPosition / omahaReraiseRangeEarlyPosition)',
    'a 3-bet or 4-bet out of position or from early position with a hand outside the capped re-raise range: called instead, the call passing the calling rule',
    'V94'
  ),
  receipt(
    'omaha_reraise_by_position_folded',
    'HorseLogic call discipline (HorseOmahaOopReraisedPot, omahaReraiseRangeOutOfPosition / omahaReraiseRangeEarlyPosition)',
    'a 3-bet or 4-bet out of position or from early position with a hand outside the capped re-raise range whose call the calling rule folds: folded',
    'V94'
  ),
  receipt(
    'omaha_reraised_flop_continue_folded',
    'HorseLogic call discipline (HorseOmahaOopReraisedPot, omahaReraisedPotFlopContinueNeedsEquityShape)',
    'PLO4/PLO5 cash flop continue (call or raise) facing a wager in a pot raised twice or more preflop that the Horse called, without two pair or better, a pair with a nut-leaning draw or a strong draw, at a price of 10% of the resulting pot or more: folded',
    'V94'
  ),
  receipt(
    'omaha_reraised_flop_continue_kept',
    'HorseLogic call discipline (HorseOmahaOopReraisedPot, omahaReraisedPotFlopContinueNeedsEquityShape)',
    'a flop continue in a re-raised pot the Horse called that the flop cell examined and kept: two pair or better, a pair with a nut-leaning draw, a strong draw, or a cheap call',
    'V94'
  ),
  receipt(
    'omaha_oop_reraised_call_folded',
    'HorseLogic call discipline (HorseOmahaOopReraisedPot, omahaOopReraisedPotStrongRange)',
    'PLO4/PLO5 cash preflop call of a 3-bet or more out of position against the last raiser, or of a 4-bet or more in either position, with a hand that is not coordinated or whose equity against his range is short of the price plus the realization margin (short of the price alone when the call commits the stack): folded',
    'V94'
  ),
  receipt(
    'omaha_oop_reraised_call_kept',
    'HorseLogic call discipline (HorseOmahaOopReraisedPot, omahaOopReraisedPotStrongRange)',
    'a preflop call of a 3-bet or more out of position, or of a 4-bet or more, that the cell examined and kept: suited aces, a commitment priced in, or a coordinated hand clearing the price plus the realization margin',
    'V94'
  ),
  receipt(
    'omaha_value_leader_defense_applied',
    'HorseLogic wager_rules (HorseOmahaReadConditional, omahaMadeHandDefenseVsValueLeader)',
    'a turn raise or a turn/river bet the made-hand defence would change, every live opponent a measured postflop value leader: the defence applied (the cell receipt names the change)',
    'V94'
  ),
  receipt(
    'omaha_value_leader_defense_withheld',
    'HorseLogic wager_rules (HorseOmahaReadConditional, omahaMadeHandDefenseVsValueLeader)',
    "a turn raise or a turn/river bet the made-hand defence would change, some live opponent not a measured value leader (over-bluffer, station, unknown or presumed): today's play kept",
    'V94'
  ),
  receipt(
    'omaha_bluff_catcher_fold_vs_value_leader',
    'HorseLogic (V81, bluff-catcher cells; HorseOmahaReadConditional, omahaBluffCatcherFoldVsValueLeader)',
    'PLO4/PLO5 call of a 0.9-pot+ turn or river raise (or a turn bet from the flop bettor) with a bluff catcher, the player faced a measured postflop value leader: folded (omaha_bluff_catcher_raise_fold and v81_omaha_big_bet_call_fold count the fold as well)',
    'V94'
  ),
  receipt(
    'omaha_bluff_catcher_fold_vs_value_leader_withheld',
    'HorseLogic (V81, bluff-catcher cells; HorseOmahaReadConditional, omahaBluffCatcherFoldVsValueLeader)',
    "a bluff-catcher call the cells would fold, the player faced not a measured value leader (over-bluffer, station, unknown or presumed): today's play kept",
    'V94'
  ),
  receipt(
    'omaha_river_medium_bet_strong_hand_call',
    'HorseLogic wager_rules (HorseOmahaRiverMediumBetCalls, omahaRiverMediumBetStrongHandCalls)',
    'PLO4/PLO5 cash river fold of two pair or better facing the opening bet of 40 to 70 percent of the pot, heads-up or closing the action, the price-based requirement met and the bettor not a measured value leader: called (the whole-stack call is the all-in)',
    'V94'
  ),
  receipt(
    'omaha_river_medium_bet_strong_hand_call_withheld',
    'HorseLogic wager_rules (HorseOmahaRiverMediumBetCalls, omahaRiverMediumBetStrongHandCalls)',
    'a river fold the rule would have called, the bettor a measured postflop value leader (HorseOmahaReadConditional): the fold kept',
    'V94'
  ),
  receipt(
    'omaha_river_medium_bet_strong_hand_call_unpriced',
    'HorseLogic wager_rules (HorseOmahaRiverMediumBetCalls, omahaRiverMediumBetStrongHandCalls)',
    'a river fold of two pair or better in the spot whose hand does not hold up against the bettor’s possible holdings 1.5 times as often as the price asks: the fold kept',
    'V94'
  ),
  receipt(
    'omaha_big_bet_by_pot_share',
    'HorseLogic decidePostflop range reads (omahaBigBetIsPotShare; HorseEval.omahaAggressorTier)',
    'a PLO4/PLO5 cash turn or river decision in which some opponent wager of 20 big blinds or more but under 70 percent of the pot was tiered lower than the legacy tier (the 20 big blind mark not counted)',
    'V94'
  ),
  receipt(
    'omaha_paired_river_thin_lead_checked',
    'HorseLogic wager_rules (HorseOmahaOopChecks, omahaPairedRiverNoThinLeadVsValueLeader)',
    'PLO4/PLO5 cash river bet with less than a full house on a paired final board, into opponents of whom one called the Horse flop or turn bet and who are all measured postflop value leaders: turned into a check',
    'V94'
  ),
  receipt(
    'omaha_paired_river_thin_lead_withheld',
    'HorseLogic wager_rules (HorseOmahaOopChecks, omahaPairedRiverNoThinLeadVsValueLeader)',
    "the same river bet where some live opponent is not a measured value leader (unknown, presumed, over-bluffer or station): today's play kept",
    'V94'
  ),
  receipt(
    'omaha_paired_board_no_boat_oop_bet_checked',
    'HorseLogic wager_rules (HorseOmahaOopChecks, omahaPairedTurnNoBarrelWithoutBoatVsValueLeader on the turn, omahaPairedRiverNoThinLeadVsValueLeader on the river)',
    'PLO4/PLO5 cash turn or river bet with less than a full house on a paired board, out of position, in a line the two narrower spots do not cover, into opponents who are all measured postflop value leaders: turned into a check',
    'V94'
  ),
  receipt(
    'omaha_paired_board_no_boat_ip_bet_checked_by_price',
    'HorseLogic wager_rules (HorseOmahaOopChecks, omahaPairedTurnNoBarrelWithoutBoatVsValueLeader on the turn, omahaPairedRiverNoThinLeadVsValueLeader on the river)',
    'the same bet in position, heads-up against a measured postflop value leader, turned into a check because the priced comparison of the check, the bet and every other size (the card-impact model) says the check is worth more; a bet the comparison keeps is left',
    'V94'
  ),
  receipt(
    'omaha_overpair_oop_turn_barrel_checked',
    'HorseLogic wager_rules (HorseOmahaOopChecks, omahaOverpairNoOopBarrelVsValueLeader)',
    'PLO4/PLO5 cash heads-up turn bet out of position with one pair, after the flop bet was called, on a board where a straight is possible, against a measured postflop value leader: turned into a check',
    'V94'
  ),
  receipt(
    'omaha_overpair_oop_turn_barrel_withheld',
    'HorseLogic wager_rules (HorseOmahaOopChecks, omahaOverpairNoOopBarrelVsValueLeader)',
    "the same turn bet where the opponent is not a measured value leader: today's play kept",
    'V94'
  ),
  receipt(
    'omaha_paired_turn_barrel_checked',
    'HorseLogic wager_rules (HorseOmahaOopChecks, omahaPairedTurnNoBarrelWithoutBoatVsValueLeader)',
    'PLO4/PLO5 cash heads-up turn bet out of position with less than a full house, on the turn card that paired the board, after the flop bet or raise was called, against a measured postflop value leader: turned into a check',
    'V94'
  ),
  receipt(
    'omaha_paired_turn_barrel_withheld',
    'HorseLogic wager_rules (HorseOmahaOopChecks, omahaPairedTurnNoBarrelWithoutBoatVsValueLeader)',
    "the same turn bet where the opponent is not a measured value leader: today's play kept",
    'V94'
  ),
  receipt(
    'omaha_paired_board_fold_price_respected',
    'HorseLogic.decide (HorsePloPairedBoardFold, omahaPairedBoardFoldRespectsPrice)',
    'PLO4/PLO5 cash paired-board fold that stood aside: the call price was 0.25 or better and the Horse held a straight or flush, or the call was for the rest of a stack at least 60% in; the reference decision stood. Fired when the final decision of HorseLogic.decide is not a fold',
    'PLO paired-board fold'
  ),
  receipt(
    'omaha_paired_board_fold_price_respected_vetoed',
    'HorseLogic.decide, settled at the final decision (HorsePloPairedBoardFold, omahaPairedBoardFoldRespectsPrice)',
    'the paired-board fold stood aside for the price and the final decision of HorseLogic.decide was a fold all the same (a later rule folded it: the owner-ruled turn fold with no out, or another fold rule); fired in place of the proposing receipt, which fires only when the final decision is not a fold',
    'PLO paired-board fold'
  ),
  receipt(
    'omaha_flop_facing_bet_ev_call',
    'HorseLogic wager_rules (HorseOmahaFlopFacingBetEvRule, omahaFlopFacingBetEv)',
    'a PLO4/PLO5 cash flop fold-or-call decision facing a bet or a raise in which the flop expected-value verdict was a call (fired every time the verdict answers, changed or not)',
    'V94'
  ),
  receipt(
    'omaha_flop_facing_bet_ev_fold',
    'HorseLogic wager_rules (HorseOmahaFlopFacingBetEvRule, omahaFlopFacingBetEv)',
    'the same decision in which the flop expected-value verdict was a fold',
    'V94'
  ),
  receipt(
    'omaha_flop_facing_bet_ev_changed',
    'HorseLogic wager_rules (HorseOmahaFlopFacingBetEvRule, omahaFlopFacingBetEv)',
    'the flop expected-value verdict differed from the answer it was given (a fold became a call or a call became a fold); the rule it replaced is the legacy receipt fired in the same decision (plo_paired_board_fold and the others)',
    'V94'
  ),
  receipt(
    'omaha_turn_bet_without_river_plan_checked',
    'HorseLogic wager_rules (HorseOmahaOopChecks, omahaTurnBetNeedsRiverPlan)',
    'PLO4/PLO5 cash heads-up turn bet that would leave less than half the resulting pot behind, with a hand the Horse own river fold rules fold on more than 35% of rivers to an all-in for the rest: turned into a check',
    'V94'
  ),
  receipt(
    'omaha_pressure_withheld_value_leader',
    'HorseLogic postflop facing a bet and maniacCallDown (omahaPressureNeedsPostflopAggression)',
    'PLO4/PLO5 cash postflop pressure play (V53 value-raise bar, raise frequency, semi-bluff raise) or preflop-width maniac call-down withheld: the bettor postflop betting is not measured high (a measured value leader, or only his preflop read or the presumption speaks)',
    'V94'
  ),
  receipt(
    'omaha_value_raise_beaten_by_board_flatted',
    'HorseLogic postflop facing a bet, value-raise branch (omahaPressureNeedsPostflopAggression)',
    'PLO4/PLO5 cash turn or river value raise facing a bet with a hand a possible straight or flush on the board already beats, not nut class: called instead, with no fresh scare card needed',
    'V94'
  ),
  receipt(
    'omaha_oop_turn_check_after_flop_call',
    'HorseLogic wager_rules (HorseOmahaOopChecks, omahaOopTurnCheckAfterFlopCall)',
    'PLO4/PLO5 cash heads-up turn bet out of position without a nut-class hand, after the flop bet or raise was called: turned into a check',
    'V94'
  ),
  receipt(
    'omaha_oop_turn_check_call_nut_draw',
    'HorseLogic wager_rules (HorseOmahaOopChecks, omahaOopTurnCheckAfterFlopCall)',
    'out of position on the turn, having checked and facing a bet, with four or more nut outs at a price within their share plus 0.15: a raise or a fold turned into a call',
    'V94'
  ),
  receipt(
    'omaha_oop_turn_check_fold_no_outs',
    'HorseLogic wager_rules (HorseOmahaOopChecks, omahaOopTurnCheckAfterFlopCall)',
    'out of position on the turn, having checked and facing a bet at a price of 0.15 or more, with no nut out and one pair or a hand the board already beats: folded',
    'V94'
  ),
  receipt(
    'omaha_oop_turn_check_raise_flatted',
    'HorseLogic wager_rules (HorseOmahaOopChecks, omahaOopTurnCheckAfterFlopCall)',
    'out of position on the turn, having checked and facing a bet, without a nut-class hand and outside the nut-draw and no-outs verdicts: a raise turned into a call',
    'V94'
  ),
  receipt(
    'omaha_oop_turn_check_raise_flatted_vetoed',
    'HorseLogic.decide, settled at the final decision (HorseOmahaOopChecks, omahaOopTurnCheckAfterFlopCall)',
    'the owner-ruled turn verdict turned a raise into a call and the final decision of HorseLogic.decide was not that verdict (a later rule replaced it); fired in place of the proposing receipt, which fires only when its verdict is the final action: the facing-bet expected value or a fold rule folded it',
    'V94'
  ),
  receipt(
    'omaha_oop_turn_check_call_nut_draw_vetoed',
    'HorseLogic.decide, settled at the final decision (HorseOmahaOopChecks, omahaOopTurnCheckAfterFlopCall)',
    'the owner-ruled turn verdict called the nut draw at its price and the final decision of HorseLogic.decide was not that verdict (a later rule replaced it); fired in place of the proposing receipt, which fires only when its verdict is the final action',
    'V94'
  ),
  receipt(
    'omaha_oop_turn_check_fold_no_outs_vetoed',
    'HorseLogic.decide, settled at the final decision (HorseOmahaOopChecks, omahaOopTurnCheckAfterFlopCall)',
    'the owner-ruled turn verdict folded a hand with no out and the final decision of HorseLogic.decide was not that verdict (a later rule replaced it); fired in place of the proposing receipt, which fires only when its verdict is the final action',
    'V94'
  ),
  receipt(
    'omaha_multiway_river_call_folded',
    'HorseLogic wager_rules, owner-ruled chain (HorseOmahaMultiwayDiscipline, omahaMultiwayRiverCallNeedsStrength)',
    'PLO4/PLO5 cash river facing a bet with another opponent live beside the bettor, not nut class: the multiway exact-hand EV of the call did not clear the facing-bet margin, so the call was folded (a raise is not touched)',
    'V94'
  ),
  receipt(
    'omaha_multiway_river_call_folded_vetoed',
    'HorseLogic.decide, settled at the final decision (HorseOmahaMultiwayDiscipline, omahaMultiwayRiverCallNeedsStrength)',
    'the multiway river verdict folded a call and the final decision of HorseLogic.decide was not that verdict (a later rule replaced it); fired in place of the proposing receipt, which fires only when its verdict is the final action',
    'V94'
  ),
  receipt(
    'omaha_no_river_bluff_into_value_leader_checked',
    'HorseLogic wager_rules, owner-ruled check (HorseOmahaMultiwayDiscipline, omahaNoRiverBluffIntoValueLeader)',
    'PLO4/PLO5 cash river bet facing no wager with a hand below the showdown-value line and no nut blocker, a measured postflop value leader live who showed strength this hand: the fold-equity EV did not favour the bet, so it was checked',
    'V94'
  ),
  receipt(
    'omaha_no_river_bluff_into_value_leader_checked_vetoed',
    'HorseLogic.decide, settled at the final decision (HorseOmahaMultiwayDiscipline, omahaNoRiverBluffIntoValueLeader)',
    'the river bluff into a measured value leader was checked and the final decision of HorseLogic.decide was not that verdict (a later rule replaced it); fired in place of the proposing receipt, which fires only when its verdict is the final action',
    'V94'
  ),
  receipt(
    'omaha_multiway_weak_hand_bet_checked',
    'HorseLogic wager_rules, owner-ruled check (HorseOmahaMultiwayDiscipline, omahaMultiwayWeakHandNoBet)',
    'PLO4/PLO5 cash turn or river bet facing no wager with two or more live opponents, one pair or less, no nut-class or combo draw: the EV against the opponent ranges did not favour the bet, so it was checked',
    'V94'
  ),
  receipt(
    'omaha_multiway_weak_hand_bet_checked_vetoed',
    'HorseLogic.decide, settled at the final decision (HorseOmahaMultiwayDiscipline, omahaMultiwayWeakHandNoBet)',
    'the multiway weak-hand bet was checked and the final decision of HorseLogic.decide was not that verdict (a later rule replaced it); fired in place of the proposing receipt, which fires only when its verdict is the final action',
    'V94'
  ),
  receipt(
    'omaha_bare_overpair_oop_flop_checked',
    'HorseLogic wager_rules (HorseOmahaOopChecks, omahaBareOverpairOopFlopCheck)',
    'PLO4/PLO5 cash flop bet out of position by the last preflop aggressor with a bare big pair (a pocket overpair, or pocket queens or better with at most one overcard on the flop; one pair made, no flush draw, under eight straight outs): turned into a check',
    'V94'
  ),
  receipt(
    'omaha_bare_overpair_oop_flop_check_called',
    'HorseLogic wager_rules (HorseOmahaOopChecks, omahaBareOverpairOopFlopCheck, the continuation)',
    'heads-up on the flop, the last preflop aggressor having checked the bare big pair out of position and facing a bet: the expected value of the call (exact cards against the bettor range, his measured read, the price, a 0.75 out-of-position realisation discount) clears 2 percent of the final pot: a fold turned into a call',
    'V94'
  ),
  receipt(
    'omaha_bare_overpair_oop_flop_check_folded',
    'HorseLogic wager_rules (HorseOmahaOopChecks, omahaBareOverpairOopFlopCheck, the continuation)',
    'heads-up on the flop, the last preflop aggressor having checked the bare big pair out of position and facing a bet: the expected value of the call does not clear its margin: a call or a raise turned into a fold',
    'V94'
  ),
  receipt(
    'omaha_bare_overpair_oop_flop_check_raise_flatted',
    'HorseLogic wager_rules (HorseOmahaOopChecks, omahaBareOverpairOopFlopCheck, the continuation)',
    'heads-up on the flop, the last preflop aggressor having checked the bare big pair out of position and facing a bet, the call clearing its margin: a raise turned into a call (never a check-raise)',
    'V94'
  ),
  receipt(
    'omaha_bare_overpair_oop_flop_check_failsafe_flatted',
    'HorseLogic wager_rules (HorseOmahaOopChecks, omahaBareOverpairOopFlopCheck, the continuation)',
    'one live opponent on the flop, the last preflop aggressor having checked the bare big pair out of position and facing a bet, and the continuation verdict could not be computed (null or a throw): a raise turned into the call of the exact chips owed; a fold or a call given stands (the fail-safe: never a raise without a verdict)',
    'V94'
  ),
  receipt(
    'omaha_card_impact_defence_check',
    'HorseLogic wager_rules (HorseOmahaCardImpact, omahaCardImpact)',
    'PLO4/PLO5 cash heads-up turn or river bet turned into a check: against the opponent range as the last card left it, the check is worth more than the bet and every other size by over 4% of the pot',
    'V94'
  ),
  receipt(
    'omaha_card_impact_press_bet',
    'HorseLogic wager_rules (HorseOmahaCardImpact, omahaCardImpact)',
    'PLO4/PLO5 cash heads-up turn or river check turned into a bet, or a bet made larger: that size is worth more than the chosen action by over 4% of the pot against the opponent range as the last card left it',
    'V94'
  ),
  receipt(
    'omaha_card_impact_freeroll_pot',
    'HorseLogic wager_rules (HorseOmahaCardImpact, omahaCardImpact)',
    'PLO4/PLO5 cash heads-up turn: the Horse holds the nuts, other holdings tie it and four or more river cards lift it over them; the full pot is the best size and replaces the chosen action',
    'V94'
  ),
  receipt(
    'omaha_card_impact_paired_board_press_withheld',
    'HorseLogic wager_rules (HorseOmahaCardImpact, omahaCardImpact)',
    'the card-impact comparison wanted a bet where the brain checked, or a larger bet, on a paired turn or river board with less than a full house against a measured postflop value leader: not made, the decision given stands',
    'V94'
  ),
  receipt(
    'omaha_card_impact_changed',
    'HorseLogic wager_rules (HorseOmahaCardImpact, omahaCardImpact)',
    'any decision the card-impact comparison replaced: a check, a larger bet, the freeroll pot or a smaller bet (the smaller bet has no receipt of its own)',
    'V94'
  ),
  receipt(
    'omaha_card_impact_defence_check_vetoed',
    'HorseLogic.decide, settled at the final decision (HorseOmahaCardImpact, omahaCardImpact)',
    'the card-impact comparison turned a bet into a check and the final decision of HorseLogic.decide was not that verdict (a later rule replaced it); fired in place of the proposing receipt, which fires only when its verdict is the final action',
    'V94'
  ),
  receipt(
    'omaha_card_impact_press_bet_vetoed',
    'HorseLogic.decide, settled at the final decision (HorseOmahaCardImpact, omahaCardImpact)',
    'the card-impact comparison proposed a bet where the brain checked, or a larger bet, and the final decision of HorseLogic.decide was not that verdict (a later rule replaced it); fired in place of the proposing receipt, which fires only when its verdict is the final action: an owner-ruled check, the made-hand defence or the street plan kept the check or the smaller bet',
    'V94'
  ),
  receipt(
    'omaha_card_impact_freeroll_pot_vetoed',
    'HorseLogic.decide, settled at the final decision (HorseOmahaCardImpact, omahaCardImpact)',
    'the card-impact comparison proposed the full pot on a freeroll and the final decision of HorseLogic.decide was not that verdict (a later rule replaced it); fired in place of the proposing receipt, which fires only when its verdict is the final action',
    'V94'
  ),
  receipt(
    'omaha_card_impact_resized_vetoed',
    'HorseLogic.decide, settled at the final decision (HorseOmahaCardImpact, omahaCardImpact)',
    'the card-impact comparison proposed a smaller bet and the final decision of HorseLogic.decide was not that verdict (a later rule replaced it); fired in place of the proposing receipt, which fires only when its verdict is the final action',
    'V94'
  ),
  receipt(
    'omaha_turn_river_raise_needs_nuts_called',
    'HorseLogic wager_rules and HorseLogic.decide outside the graph (HorseOmahaTurnRiverRaiseNeedsNuts, omahaTurnRiverRaiseNeedsNuts)',
    'PLO4/PLO5 cash turn or river, facing a bet or a raise, the final answer a raise with a hand that is not nut class (and not the in-position turn combo draw): the raise became the exact legal call (the whole-stack call is the all-in)',
    'V94'
  ),
  receipt(
    'omaha_turn_river_raise_needs_nuts_folded',
    'HorseLogic wager_rules and HorseLogic.decide outside the graph (HorseOmahaTurnRiverRaiseNeedsNuts, omahaTurnRiverRaiseNeedsNuts)',
    'the same decision, the raise became a fold',
    'V94'
  ),
  receipt(
    'omaha_turn_river_raise_needs_nuts_kept_nuts',
    'HorseLogic wager_rules and HorseLogic.decide outside the graph (HorseOmahaTurnRiverRaiseNeedsNuts, omahaTurnRiverRaiseNeedsNuts)',
    'the same spot, the final answer a raise with a nut-class hand: the raise stands',
    'V94'
  ),
  receipt(
    'omaha_turn_river_raise_needs_nuts_by_ev',
    'HorseLogic wager_rules and HorseLogic.decide outside the graph (HorseOmahaTurnRiverRaiseNeedsNuts, omahaTurnRiverRaiseNeedsNuts)',
    'a raise the rule replaced was decided by the exact-hand facing-bet EV verdict',
    'V94'
  ),
  receipt(
    'omaha_turn_river_raise_needs_nuts_by_oop_turn_verdict',
    'HorseLogic wager_rules and HorseLogic.decide outside the graph (HorseOmahaTurnRiverRaiseNeedsNuts, omahaTurnRiverRaiseNeedsNuts)',
    'a raise the rule replaced was decided by the out-of-position turn facing-bet verdict (the EV verdict had no answer)',
    'V94'
  ),
  receipt(
    'omaha_turn_river_raise_needs_nuts_by_price',
    'HorseLogic wager_rules and HorseLogic.decide outside the graph (HorseOmahaTurnRiverRaiseNeedsNuts, omahaTurnRiverRaiseNeedsNuts)',
    'a raise the rule replaced was decided by the fallback price: fold at a third of the pot after the call or more, call under it',
    'V94'
  ),
  receipt(
    'omaha_facing_bet_ev_call',
    'HorseLogic wager_rules (HorseOmahaFacingBetEv, omahaFacingBetEv)',
    "PLO4/PLO5 cash turn or river, facing a bet or a raise, today's answer a fold or a call: the expected value of the call, on the exact holdings count, the bettor's range and the actual price, exceeds the margin: call (the whole-stack call is the all-in)",
    'V94'
  ),
  receipt(
    'omaha_facing_bet_ev_fold',
    'HorseLogic wager_rules (HorseOmahaFacingBetEv, omahaFacingBetEv)',
    'the same decision, the expected value of the call at or under the margin: fold',
    'V94'
  ),
  receipt(
    'omaha_facing_bet_ev_call_blocked_by_plo6_river_fold',
    'HorseLogic wager_rules (HorseOmahaFacingBetEv, omahaFacingBetEv; PLO6 only, omahaStrategyInPlo6 on)',
    'the same decision in a six-card game on the river: the expected value of the call exceeds the margin, but the live river fold rule (V58 paired / V59 unpaired, its own seeded beaten share and price) folds this hand, so the answer is the fold; fired in place of the call and the fold receipt',
    'V94'
  ),
  receipt(
    'omaha_owner_ruled_check_kept',
    'HorseLogic wager_rules (omahaOwnBetRules and omahaOwnerRuledFinal, precedence 2026-11-15)',
    'a pricing rule (omahaCardImpact, omahaStrongHandValue), the big-draw wager (omahaBigDrawAggression) or the checked-to pricing bet proposed a bet in a spot an owner-ruled check rule (omahaOopCheckRules), the made-hand defence (omahaBeatenMadeHandDefense, omahaMadeHandDefenseVsValueLeader) or the street plan checks, or a rule that ran after omahaOwnBetRules proposed a wager in the spot the PLO6 multiway weak made-hand rule checks (plo6NoMultiwayBetWithWeakMadeHand, HorsePlo6MultiwayWeakBet.ts, with that option on): the bet was not made',
    'V94'
  ),
  receipt(
    'omaha_owner_approved_bet_kept',
    'HorseLogic wager_rules (omahaOwnBetRules, precedence 2026-11-15)',
    'omahaCardImpact proposed another size for a bet the owner rules had let through, and an owner-ruled check rule, the made-hand defence or the street plan refuses that size: the bet stands at the size it had',
    'V94'
  ),
  receipt(
    'omaha_nut_class_wager_kept',
    'HorseLogic wager_rules (omahaOwnBetRules, precedence 2026-11-15)',
    'a pricing rule (omahaStreetPlan or omahaCardImpact) would have checked or made smaller a nut-class wager: the wager was kept',
    'V94'
  ),
  receipt(
    'omaha_strategy_rule_failed',
    'HorseLogic wager_rules (omahaFacingBetEv, omahaCardImpact, omahaStreetPlan, omahaOwnBetRules, omahaOopTurnFacingBetRule)',
    'one of the 2026-11-15 Omaha strategy rules threw inside its own boundary: the decision it was given stands (for the facing-bet expected value, the rules that yield to it act as with it off)',
    'V94'
  ),
  receipt(
    'omaha_facing_bet_ev_changed',
    'HorseLogic wager_rules (HorseOmahaFacingBetEv, omahaFacingBetEv)',
    "the expected-value verdict differs from the answer today's rules gave (a fold became a call or a call became a fold); the legacy rule is the legacy receipt fired in the same decision",
    'V94'
  ),
  receipt(
    'omaha_street_plan_line_changed',
    'HorseLogic wager_rules (HorseOmahaStreetPlan, omahaStreetPlan)',
    'PLO4/PLO5 cash heads-up turn bet facing no wager whose whole line (opponent responses and every river card planned) was worth less than the check line by more than 2% of the pot: turned into a check',
    'V94'
  ),
  receipt(
    'omaha_street_plan_commit_avoided',
    'HorseLogic wager_rules (HorseOmahaStreetPlan, omahaStreetPlan)',
    'the same turn bet turned into a check where the bet would have put half or more of the hand starting stack in with a plan that continues on under 65% of river cards',
    'V94'
  ),
  receipt(
    'omaha_street_plan_commit_avoided_vetoed',
    'HorseLogic.decide, settled at the final decision (HorseOmahaStreetPlan, omahaStreetPlan)',
    'the street plan turned a committing turn bet into a check and the final decision of HorseLogic.decide was not that verdict (a later rule replaced it); fired in place of the proposing receipt, which fires only when its verdict is the final action: the final action is a wager (a nut-class bet a pricing rule may not check, or a size the plan itself prices above the check)',
    'V94'
  ),
  receipt(
    'omaha_street_plan_line_changed_vetoed',
    'HorseLogic.decide, settled at the final decision (HorseOmahaStreetPlan, omahaStreetPlan)',
    'the street plan turned a turn bet into a check and the final decision of HorseLogic.decide was not that verdict (a later rule replaced it); fired in place of the proposing receipt, which fires only when its verdict is the final action: the final action is a wager',
    'V94'
  ),
  receipt(
    'omaha_street_plan_followed',
    'HorseLogic.decide (HorseOmahaStreetPlan, omahaStreetPlan; inside the paired-board fold)',
    'PLO4/PLO5 cash heads-up river call after the Horse turn bet was called: the turn plan, recomputed from the public history, calls this river card for this bet or less, so the paired-board fold stood aside and the reference decision stood',
    'V94'
  ),
  receipt(
    'omaha_street_plan_flop_checked',
    'HorseLogic wager_rules (HorseOmahaStreetPlan, omahaStreetPlanFlop)',
    'PLO4/PLO5 cash heads-up flop bet facing no wager whose two-street line (opponent responses, the turn by card class with the planned turn action, sampled rivers) did not beat the check line by 2% of the pot: turned into a check',
    'V94'
  ),
  receipt(
    'omaha_street_plan_flop_commit_avoided',
    'HorseLogic wager_rules (HorseOmahaStreetPlan, omahaStreetPlanFlop)',
    'the same flop bet turned into a check where the bet line commits the stack (stack-to-pot after the call at or under 1.5) with a hand that folds to the expected raise or continues on under 65% of turn cards, and no smaller size of the engine menu was worth making',
    'V94'
  ),
  receipt(
    'omaha_street_plan_flop_resized',
    'HorseLogic wager_rules (HorseOmahaStreetPlan, omahaStreetPlanFlop)',
    'the same flop bet made at a smaller size of the engine menu whose line beat the engine size by 2% of the pot (or the engine size commits without a plan)',
    'V94'
  ),
  receipt(
    'omaha_street_plan_flop_checked_vetoed',
    'HorseLogic.decide, settled at the final decision (HorseOmahaStreetPlan, omahaStreetPlanFlop)',
    'the flop plan turned a flop bet into a check and the final decision of HorseLogic.decide was not that verdict (a later rule replaced it); fired in place of the proposing receipt, which fires only when its verdict is the final action',
    'V94'
  ),
  receipt(
    'omaha_street_plan_flop_commit_avoided_vetoed',
    'HorseLogic.decide, settled at the final decision (HorseOmahaStreetPlan, omahaStreetPlanFlop)',
    'the flop plan turned a committing flop bet into a check and the final decision of HorseLogic.decide was not that verdict (a later rule replaced it); fired in place of the proposing receipt, which fires only when its verdict is the final action',
    'V94'
  ),
  receipt(
    'omaha_street_plan_flop_resized_vetoed',
    'HorseLogic.decide, settled at the final decision (HorseOmahaStreetPlan, omahaStreetPlanFlop)',
    'the flop plan made a flop bet smaller and the final decision of HorseLogic.decide was not that verdict (a later rule replaced it); fired in place of the proposing receipt, which fires only when its verdict is the final action',
    'V94'
  ),
  receipt(
    'omaha_street_plan_three_way_checked',
    'HorseLogic wager_rules (HorseOmahaStreetPlan, omahaStreetPlanThreeWay)',
    'PLO4/PLO5 cash turn bet facing no wager with exactly two live opponents whose three-way line (both must fold, or the Horse must beat every caller on every river card) was worth less than the check line by more than 2% of the pot: turned into a check',
    'V94'
  ),
  receipt(
    'omaha_street_plan_three_way_checked_vetoed',
    'HorseLogic.decide, settled at the final decision (HorseOmahaStreetPlan, omahaStreetPlanThreeWay)',
    'the three-way turn plan turned a turn bet into a check and the final decision of HorseLogic.decide was not that verdict (a later rule replaced it); fired in place of the proposing receipt, which fires only when its verdict is the final action',
    'V94'
  ),
  receipt(
    'omaha_preflop_stack_plan_folded',
    'HorseLogic wager_rules (HorseOmahaStreetPlan, omahaPreflopStackPlan; first inside omahaOopReraisedPotStrongRange)',
    'PLO4/PLO5 preflop call of a raise heads-up against the raiser that creates a stack-to-pot ratio under 3 and whose committed-stack value (equity against his band less the playability charge) is negative: turned into a fold',
    'V94'
  ),
  receipt(
    'omaha_preflop_stack_plan_folded_vetoed',
    'HorseLogic.decide, settled at the final decision (HorseOmahaStreetPlan, omahaPreflopStackPlan)',
    'the preflop stack plan turned a call into a fold and the final decision of HorseLogic.decide was not that verdict (a later rule replaced it); fired in place of the proposing receipt, which fires only when its verdict is the final action',
    'V94'
  ),
  receipt(
    'omaha_big_draw_aggression_raise',
    'HorseLogic wager_rules (HorseOmahaBigDrawAggression, omahaBigDrawAggression)',
    'PLO4/PLO5 cash flop or turn call with a declared big draw whose pot-sized raise (or stack) was priced above the call: raised',
    'V94'
  ),
  receipt(
    'omaha_big_draw_aggression_bet',
    'HorseLogic wager_rules (HorseOmahaBigDrawAggression, omahaBigDrawAggression)',
    'PLO4/PLO5 cash flop or turn check with a declared big draw whose pot-sized bet (or stack) was priced above the check: bet',
    'V94'
  ),
  receipt(
    'omaha_big_draw_aggression_bet_vetoed',
    'HorseLogic.decide, settled at the final decision (HorseOmahaBigDrawAggression, omahaBigDrawAggression)',
    'the big-draw rule priced a bet above the check and the final decision of HorseLogic.decide was not that verdict (a later rule replaced it); fired in place of the proposing receipt, which fires only when its verdict is the final action: an owner-ruled check, the made-hand defence or the street plan kept the check',
    'V94'
  ),
  receipt(
    'omaha_big_draw_aggression_raise_vetoed',
    'HorseLogic.decide, settled at the final decision (HorseOmahaBigDrawAggression, omahaBigDrawAggression)',
    'the big-draw rule priced a raise above the call and the final decision of HorseLogic.decide was not that verdict (a later rule replaced it); fired in place of the proposing receipt, which fires only when its verdict is the final action',
    'V94'
  ),
  receipt(
    'omaha_big_draw_aggression_withheld',
    'HorseLogic wager_rules (HorseOmahaBigDrawAggression, omahaBigDrawAggression)',
    'a check or call with a declared big draw the rule examined and kept: the passive line was worth more (low fold equity without the equity), three or more opponents, two opponents without the nut end, a raise of its own bet, or no legal wager',
    'V94'
  ),
  receipt(
    'omaha_big_draw_aggression_final_check_unpriced',
    'HorseLogic wager_rules (HorseOmahaBigDrawAggression.omahaBigDrawVerdict finalCheckVetoes, omahaBigDrawAggression)',
    'a check with a declared big draw after an owner-ruled, discipline or street-plan check in the same decision, where the one bet the rule could make would be replaced by that check in the final decision (omahaOwnerRuledFinal): the bet was not priced (no equity count) and the check stands, the decision the veto would have given',
    'V94'
  ),
  receipt(
    'omaha_no_draw_raise_ft_semibluff',
    'HorseLogic (HorseOmahaBigDrawAggression.omahaDrawRaiseBar, omahaNoDrawRaiseOutOfPosition)',
    'PLO4/PLO5 cash flop or turn, the baseline flop/turn semi-bluff raise with a draw out of position, or in position with a bare flush draw: not made, the hand went on to the call-or-fold verdict',
    'V94'
  ),
  receipt(
    'omaha_no_draw_raise_v53_semibluff',
    'HorseLogic (HorseOmahaBigDrawAggression.omahaDrawRaiseBar, omahaNoDrawRaiseOutOfPosition)',
    'PLO4/PLO5 cash flop or turn, the pressure semi-bluff raise with a draw out of position, or in position with a bare flush draw: not made, the hand went on to the call-or-fold verdict',
    'V94'
  ),
  receipt(
    'omaha_no_draw_raise_v86_pump',
    'HorseLogic (HorseOmahaBigDrawAggression.omahaDrawRaiseBar, omahaNoDrawRaiseOutOfPosition)',
    'PLO4/PLO5 cash flop or turn, the combo draw pump raise with a draw out of position, or in position with a bare flush draw: not made, the hand went on to the call-or-fold verdict',
    'V94'
  ),
  receipt(
    'omaha_no_draw_raise_final_call',
    'HorseLogic (HorseOmahaBigDrawAggression.omahaDrawRaiseBar, omahaNoDrawRaiseOutOfPosition)',
    'PLO4/PLO5 cash flop or turn, a raise from any other owner that reached the final answer with a draw out of position, or in position with a bare flush draw: not made, it became a call',
    'V94'
  ),
  receipt(
    'horse_play_style_tight',
    'HorseLogic decideInternal (HorsePlayStyle.horsePlayStyleReceipt, horsePlayStyles)',
    'per-style tracking (2026-11-16): a decision with horsePlayStyles on by a Horse whose playing style is tight, at a table where the tight style applies (PLO4/PLO5 cash, deeper than 50 bb, no VPIP floor above its expected VPIP): the preflop entry bars and the bluff volume carried the tight scales. Read per style with the Horse id joined to horsePlayStyleFor (server/scripts/horse-play-style-for.ts)',
    'V94'
  ),
  receipt(
    'horse_play_style_current',
    'HorseLogic decideInternal (HorsePlayStyle.horsePlayStyleReceipt, horsePlayStyles)',
    "per-style tracking (2026-11-16): a decision with horsePlayStyles on by a Horse whose playing style is current (today's play, nothing scaled); counted in every game, the control arm of the per-style reads",
    'V94'
  ),
  receipt(
    'horse_play_style_pressure',
    'HorseLogic decideInternal (HorsePlayStyle.horsePlayStyleReceipt, horsePlayStyles)',
    "per-style tracking (2026-11-16): a decision with horsePlayStyles on by a Horse whose playing style is pressure, at a table where the style applies (PLO4/PLO5 cash, deeper than 50 bb): in position the preflop entry bars (tightness scale and entry-bar credit), the bluff volume, the aggression, the c-bet frequency and the EV engine's fold-equity prior and aggressive tie-break band carried the pressure biases; out of position nothing changed",
    'V94'
  ),
  receipt(
    'horse_play_style_fallback_current_floor_seen',
    'HorseLogic decideInternal (HorsePlayStyle.horsePlayStyleReceipt, horsePlayStyles)',
    'per-style tracking (2026-11-16): a decision with horsePlayStyles on by a tight or pressure Horse that played the current style because of the table: a VPIP floor above the tight style expected VPIP (tight only); named *_seen (occurrence, its quiet days are normal)',
    'V94'
  ),
  receipt(
    'horse_play_style_fallback_current_tournament_seen',
    'HorseLogic decideInternal (HorsePlayStyle.horsePlayStyleReceipt, horsePlayStyles)',
    'per-style tracking (2026-11-16): a decision with horsePlayStyles on by a tight or pressure Horse that played the current style because of the table: a tournament hand; named *_seen (occurrence, its quiet days are normal)',
    'V94'
  ),
  receipt(
    'horse_play_style_fallback_current_lightning_seen',
    'HorseLogic decideInternal (HorsePlayStyle.horsePlayStyleReceipt, horsePlayStyles)',
    'per-style tracking (2026-11-16): a decision with horsePlayStyles on by a tight or pressure Horse that played the current style because of the table: a Lightning table; named *_seen (occurrence, its quiet days are normal)',
    'V94'
  ),
  receipt(
    'horse_play_style_fallback_current_short_stack_seen',
    'HorseLogic decideInternal (HorsePlayStyle.horsePlayStyleReceipt, horsePlayStyles)',
    'per-style tracking (2026-11-16): a decision with horsePlayStyles on by a tight or pressure Horse that played the current style because of the table: 50 bb effective or less; named *_seen (occurrence, its quiet days are normal)',
    'V94'
  ),
  receipt(
    'horse_play_style_fallback_current_unmapped_seen',
    'HorseLogic decideInternal (HorsePlayStyle.horsePlayStyleReceipt, horsePlayStyles)',
    "per-style tracking (2026-11-16): a decision with horsePlayStyles on by a tight or pressure Horse that played the current style because of the table: a game with no mapping (Hold'em until its lane maps it, hi-lo, PLO6, bomb pots, All-In-Or-Fold, heads-up); named *_seen (occurrence, its quiet days are normal)",
    'V94'
  ),
  receipt(
    'omaha_strong_hand_value_bet',
    'HorseLogic wager_rules (HorseOmahaStrongHandValue, omahaStrongHandValue)',
    'PLO4/PLO5 cash river, nothing to call, a full house or better or a nut-class hand, the answer a check: the value bet of highest expected value (the hands that call and lose outweigh those that call or raise and win) is worth at least the check and replaces it',
    'V94'
  ),
  receipt(
    'omaha_strong_hand_value_raise',
    'HorseLogic wager_rules (HorseOmahaStrongHandValue, omahaStrongHandValue)',
    'PLO4/PLO5 cash river, one bettor and nobody else in the hand, a nut-class hand (never a full house a bigger one beats), the answer a call: a raise the continuing holdings it beats outnumber those that beat it (exact count) is worth more than the call by 4 percent of the pot and replaces it',
    'V94'
  ),
  receipt(
    'omaha_strong_hand_induce_check',
    'HorseLogic wager_rules (HorseOmahaStrongHandValue, omahaStrongHandValue)',
    'PLO4/PLO5 cash river, nothing to call, a strong hand, a player still to act: the check is worth more than every value bet and is kept (valid no-change)',
    'V94'
  ),
  receipt(
    'omaha_strong_hand_slowplay_call',
    'HorseLogic wager_rules (HorseOmahaStrongHandSlowplayMix, omahaStrongHandSlowplayMix)',
    'PLO4/PLO5 cash flop, turn or river, facing a bet with a nut-class hand and one or two opponents, the final answer a raise: the mixed draw fell under the frequency of the spot and the raise became the exact call',
    'V94'
  ),
  receipt(
    'omaha_strong_hand_slowplay_check',
    'HorseLogic wager_rules (HorseOmahaStrongHandSlowplayMix, omahaStrongHandSlowplayMix)',
    'PLO4/PLO5 cash flop, nothing to call, a set on a very dry flop, one or two opponents, the final answer a bet: the mixed draw fell under the frequency of the spot and the bet became a check',
    'V94'
  ),
  // PLO Strategy 2026-11-17 (the priced rules, default-off options production does not set: silence is
  // their ordinary state).
  receipt(
    'omaha_priced_raise_kept',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaTurnRiverRaiseIsPriced)',
    'PLO4/PLO5 cash turn or river facing a wager: the raise another owner chose is priced above the call and the fold by the margin (or the hand is nut class) and stands',
    'V94'
  ),
  receipt(
    'omaha_priced_raise_called',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaTurnRiverRaiseIsPriced)',
    'the same decision: the raise is not priced above the call, the call is worth more than the fold: the raise became the exact legal call',
    'V94'
  ),
  receipt(
    'omaha_priced_raise_folded',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaTurnRiverRaiseIsPriced)',
    'the same decision: neither the raise nor the call is priced above the fold: the raise became a fold',
    'V94'
  ),
  receipt(
    'omaha_priced_raise_made_value',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaTurnRiverRaiseIsPriced)',
    'PLO4/PLO5 cash turn or river facing a wager, the answer given a call or a fold (or a raise of another size): a raise the continuing holdings mostly lose to is priced above every other action by the margin and is made',
    'V94'
  ),
  receipt(
    'omaha_priced_raise_made_bluff',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaTurnRiverRaiseIsPriced)',
    'the same, a raise that earns by the folds it is priced to get (the continuing holdings mostly beat the hand): made',
    'V94'
  ),
  receipt(
    'omaha_priced_raise_unpriced_kept',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaTurnRiverRaiseIsPriced)',
    'a raise in the option scope whose hand could not be counted: the decision given is kept (no categorical rule decides)',
    'V94'
  ),
  receipt(
    'omaha_priced_draw_raise_kept',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaDrawRaiseIsPriced)',
    'PLO4/PLO5 cash flop or turn, a raise with a draw the bar names: priced above the call by the margin and kept',
    'V94'
  ),
  receipt(
    'omaha_priced_draw_raise_called',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaDrawRaiseIsPriced)',
    'the same decision: not priced above the call: the raise became the call',
    'V94'
  ),
  receipt(
    'omaha_priced_draw_raise_unpriced_kept',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaDrawRaiseIsPriced)',
    'the same decision, no sample could be drawn: the decision given is kept',
    'V94'
  ),
  receipt(
    'omaha_priced_draw_raise_site_admitted',
    'HorseOmahaPricedWiring (HorseLogic decidePostflop raise sites; omahaDrawRaiseIsPriced)',
    'PLO4/PLO5 cash flop or turn, one of the three draw-raise sites of the brain, a draw the bar names: the pot raise is priced above the call, so the site makes its raise',
    'V94'
  ),
  receipt(
    'omaha_priced_draw_raise_site_withheld',
    'HorseOmahaPricedWiring (HorseLogic decidePostflop raise sites; omahaDrawRaiseIsPriced)',
    'the same site: the pot raise is not priced above the call, so the site falls through to its own call or fold',
    'V94'
  ),
  receipt(
    'omaha_priced_oop_turn_barrel_kept',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaOopTurnBarrelIsPriced)',
    'PLO4/PLO5 cash turn, out of position, the flop bet was called, not nut class: the bet is priced at least the check and stands',
    'V94'
  ),
  receipt(
    'omaha_priced_oop_turn_barrel_checked',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaOopTurnBarrelIsPriced)',
    'the same decision: the check is priced above the bet: the bet became a check',
    'V94'
  ),
  receipt(
    'omaha_priced_oop_turn_barrel_unpriced_kept',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaOopTurnBarrelIsPriced)',
    'the same decision, outside the card-impact model: the decision given is kept',
    'V94'
  ),
  receipt(
    'omaha_priced_paired_board_bet_kept',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaPairedBoardBetIsPriced)',
    'PLO4/PLO5 cash paired turn or river below a full house (or the river of a board paired on the turn after the Horse turn bet was called): the bet is priced at least the check and stands',
    'V94'
  ),
  receipt(
    'omaha_priced_paired_board_bet_checked',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaPairedBoardBetIsPriced)',
    'the same decision: the check is priced above the bet: the bet became a check',
    'V94'
  ),
  receipt(
    'omaha_priced_paired_board_bet_unpriced_kept',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaPairedBoardBetIsPriced)',
    'the same decision, outside the card-impact model: the decision given is kept',
    'V94'
  ),
  receipt(
    'omaha_priced_paired_board_blocker_bluff_admitted',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaPairedBoardBetIsPriced)',
    'the river nut-blocker bluff on a paired board: a bet is priced above the check against the opponent range and measured fold rate, so the bluff branch is reachable',
    'V94'
  ),
  receipt(
    'omaha_priced_pressure_raise_admitted',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaPressureIsPriced)',
    'the pressure raise against this bettor is priced above the call: the play is not withheld',
    'V94'
  ),
  receipt(
    'omaha_priced_pressure_raise_withheld',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaPressureIsPriced)',
    'the pressure raise against this bettor is not priced above the call: withheld',
    'V94'
  ),
  receipt(
    'omaha_priced_pressure_call_down_admitted',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaPressureIsPriced)',
    'the wide call-down against this bettor: the call is priced above the fold: not withheld',
    'V94'
  ),
  receipt(
    'omaha_priced_pressure_call_down_withheld',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaPressureIsPriced)',
    'the wide call-down against this bettor: the call is not priced above the fold: withheld',
    'V94'
  ),
  receipt(
    'omaha_priced_big_bet_call_kept',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaBigBetCallsArePriced)',
    'PLO4/PLO5 cash turn or river call in the big-bet cells scope: the exact count prices the call above the margin and it stands',
    'V94'
  ),
  receipt(
    'omaha_priced_big_bet_call_folded',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaBigBetCallsArePriced)',
    'the same decision: the exact count prices the call below the margin: the call became a fold',
    'V94'
  ),
  receipt(
    'omaha_priced_big_bet_call_unpriced_kept',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaBigBetCallsArePriced)',
    'the same decision, the hand could not be counted: the decision given is kept',
    'V94'
  ),
  receipt(
    'omaha_priced_big_bet_raise_kept',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaBigBetCallsArePriced)',
    'a turn or river raise in the big-bet cells scope: priced above the call and the fold (or nut class) and kept',
    'V94'
  ),
  receipt(
    'omaha_priced_big_bet_raise_called',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaBigBetCallsArePriced)',
    'the same decision: the raise is not priced above the call, the call above the fold: the raise became the call',
    'V94'
  ),
  receipt(
    'omaha_priced_big_bet_raise_folded',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaBigBetCallsArePriced)',
    'the same decision: neither is priced above the fold: the raise became a fold',
    'V94'
  ),
  receipt(
    'omaha_priced_underpair_multiway_called',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaUnderpairMultiwayIsPriced)',
    'PLO4/PLO5 cash flop, an underpair or bottom pair facing a bet and a call: the call is priced above the fold on the sampled shares and stands',
    'V94'
  ),
  receipt(
    'omaha_priced_underpair_multiway_folded',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaUnderpairMultiwayIsPriced)',
    'the same decision: the call is priced below the fold: the fold stands',
    'V94'
  ),
  receipt(
    'omaha_priced_mix_lower_action_taken',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaPricedMix)',
    'inside a priced rule, the two best actions were closer than the comparison uncertainty and the public-state draw fell under the mixing probability: the lower-valued action was taken',
    'V94'
  ),
  receipt(
    'omaha_priced_facing_inputs_changed_to_call',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaFacingBetRangeIsContinuous and omahaBluffShareFromBetRate)',
    'the facing-bet expected-value verdict under the continuous range inputs and the bet-rate bluff share is a call where the stepped tables and the label cap give a fold',
    'V94'
  ),
  receipt(
    'omaha_priced_facing_inputs_changed_to_fold',
    'HorseOmahaPricedWiring (HorseLogic wager_rules and HorseLogic.decide outside the graph; omahaFacingBetRangeIsContinuous and omahaBluffShareFromBetRate)',
    'the same verdict is a fold where the stepped tables and the label cap give a call',
    'V94'
  ),
  receipt(
    'omaha_public_bet_size_applied',
    'HorseLogic wager_rules (horsePublicBetSize, omahaBetSizeByPublicState)',
    'PLO4/PLO5 cash postflop, the final answer an own bet or raise: its size was replaced by the public-state size (horsePublicBetSizeTo), legalized, the action kept',
    'V94'
  ),
  receipt(
    'omaha_public_bet_size_unchanged',
    'HorseLogic wager_rules (horsePublicBetSize, omahaBetSizeByPublicState)',
    'PLO4/PLO5 cash postflop, an own bet or raise whose size already equals the public-state size after legalizing (valid no-change)',
    'V94'
  ),
  receipt(
    'omaha_public_bet_size_committed',
    'HorseLogic wager_rules (horsePublicBetSize, omahaBetSizeByPublicState)',
    "PLO4/PLO5 cash postflop, the public-state size would put 60% or more of the seat's chips in: the bet or raise became the largest legal wager, every chip, an all-in",
    'V94'
  ),
  receipt(
    'omaha_public_bet_size_nut_class_kept',
    'HorseLogic wager_rules (horsePublicBetSize, omahaBetSizeByPublicState)',
    "PLO4/PLO5 cash postflop, omahaNutClassValueSize on and a nut-class hand: that owner option's wager size stands (valid no-change)",
    'V94'
  ),
  receipt(
    'omaha_public_bet_size_illegal_kept',
    'HorseLogic wager_rules (horsePublicBetSize, omahaBetSizeByPublicState)',
    "PLO4/PLO5 cash postflop, the public-state size did not legalize to the same action: the engine's own decision stands (valid no-change)",
    'V94'
  ),
  receipt(
    'omaha_bluff_catcher_raise_fold',
    'HorseLogic (V81, bluff-catcher cells)',
    'PLO4/PLO5 call of a 0.9-pot+ turn or river raise (or a turn bet from the flop bettor) with a bluff catcher: folded (counted inside v81_omaha_big_bet_call_fold as well)',
    'V94'
  ),
  receipt(
    'omaha_turn_set_pound',
    'HorseLogic checked-to value tiers',
    'an Omaha high set on a straight-possible turn with no flush possible bet the geometric size instead of the half-pot small ball',
    'V94'
  ),
  receipt(
    'v81_omaha_big_bet_call_fold',
    'HorseLogic (V81)',
    'PLO4/PLO5 turn/river call of a 0.9-pot+ wager in a measured losing cell: folded',
    'V81',
    'decide_omaha'
  ),
  receipt(
    'v84_omaha_river_reraise_call_fold',
    'HorseLogic (V84)',
    "PLO4/PLO5/PLO6 river call of a 0.9-pot+ raise after the horse's own river bet or raise, in a measured losing cell: folded",
    'V84',
    'decide_omaha'
  ),
  receipt(
    'v87_deep_dive_discipline',
    'HorseLogic (V87)',
    'All-hands deep-dive discipline fired: 5/6-card hand-class calibration, HU Omaha river position-stab suppression, PLO6 >=0.9-pot big-bet fold, Omaha bet-raised commitment/shade, or NLH turn cold-raise/multiway shade',
    'V87',
    'decide'
  ),
  receipt(
    'v80_top_pair_strong_kicker',
    'HorseLogic (V80)',
    "Hold'em top pair with a T-or-better kicker facing a 0.9-pot+ turn/river wager deep (V79 cell A): equity capped",
    'V80',
    'decide_nlh'
  ),
  receipt(
    'v79_top_pair_weak_kicker',
    'HorseLogic (V79)',
    "Hold'em top pair with a 9-or-lower kicker facing a 0.6-pot+ or stack-committing turn/river wager: equity shaded",
    'V79',
    'decide_nlh'
  ),
  receipt(
    'v78_no_committing_bluff_raise',
    'HorseLogic (V78)',
    "Hold'em semi-bluff / check-raise bluff withheld: legalized it committed 40%+ of the stack without being all-in",
    'V78',
    'decide_nlh'
  ),
  receipt(
    'v77_seat_jam',
    'HorseLogic (V77)',
    "Hold'em facing exactly one open: the opener's V70 seat width was read for the push/fold jam tighten",
    'V77',
    'decide_nlh'
  ),
  receipt(
    'v75_squeeze_defence',
    'HorsePreflop (V75)',
    "Hold'em opener whose called open was squeezed, continued on the V73 width priced by the callers' dead money and narrowed per live caller behind",
    'V75',
    'decide_nlh'
  ),
  receipt(
    'v27_gto_open_jam',
    'HorsePreflop (V27)',
    'solver open/jam chart hit',
    'V27',
    'decide_nlh',
    0.01
  ),
  receipt(
    'v27_gto_bb_defend',
    'HorsePreflop (V27)',
    'solver BB defend chart hit',
    'V27',
    'decide_nlh',
    0.005
  ),
  receipt('v29_*', 'GtoPostflop (V29)', 'flop solver cells and misses', 'V29', 'decide_nlh', 0.002),
  receipt(
    'v30_*',
    'GtoPostflop (V30)',
    'turn/river solver cells and misses',
    'V30',
    'decide_nlh',
    0.002
  ),
  receipt(
    'v31_*',
    'GtoPostflopV31 (V31)',
    'suit-aware solver hits and misses by depth/street',
    'V31',
    'decide_nlh',
    0.002
  ),
  // No floor: v32FacingDefense is default OFF since 2026-10-16, so silence is
  // expected until a league matchup resolves positive and the default changes.
  receipt(
    'v32_*',
    'GtoFacingDefenseV32 (V32)',
    'facing-bet defense verdicts and misses; opt-in (v32FacingDefense)',
    'V32'
  ),
  // No floor: the V34 draw pass-through lives inside the V32 facing-bet block
  // (HorseLogic gates it on opts.v32FacingDefense === true), and V32 is default
  // OFF since 2026-10-16, so this receipt reads zero by design. A floor here
  // raised a false critical data_unread every night (2026-10-18 audit).
  receipt(
    'v34_defend_draw_passthrough',
    'HorseLogic (V34)',
    'solver draw call honored; opt-in with v32FacingDefense',
    'V34'
  ),
  receipt('v36_*', 'HorseLogic (V36)', 'bomb pot layers; bomb-pot volume', 'V36'),
  receipt(
    'v37_*',
    'HorseLogic (V37)',
    'satellite / bubble / bounty layers; tournament volume',
    'V37'
  ),
  receipt(
    'v38_ev_check',
    'HorseEvEngine via HorseLogic (V38)',
    'EV engine chose check',
    'V38',
    'decide_omaha',
    0.02
  ),
  receipt(
    'v38_ev_call',
    'HorseEvEngine via HorseLogic (V38)',
    'EV engine chose call',
    'V38',
    'decide_omaha',
    0.02
  ),
  receipt(
    'v38_ev_fold',
    'HorseEvEngine via HorseLogic (V38)',
    'EV engine chose fold',
    'V38',
    'decide_omaha',
    0.01
  ),
  receipt(
    'v38_ev_bet',
    'HorseEvEngine via HorseLogic (V38)',
    'EV engine chose bet',
    'V38',
    'decide_omaha',
    0.003
  ),
  receipt(
    'v38_river_call',
    'HorseEvEngine via HorseLogic (V38)',
    'MDF river call',
    'V38',
    'decide',
    0.002
  ),
  receipt(
    'v61_river_one_pair_shade',
    'HorseLogic (V61)',
    'Hold em one-pair river call shaded against the price',
    'V61',
    'decide',
    0.001
  ),
  receipt(
    'v66_bet_raised_one_pair',
    'HorseLogic (V66)',
    'Hold em flop/turn one-pair call of a raise over hero own bet priced with the raise shade or released from commitment',
    'V66',
    'decide',
    0.001
  ),
  receipt(
    'v66_raise_stratum',
    'HorseLogic (V66) via HorseEval',
    'Hold em flop/turn raiser over hero own wager sampled from the raise stratum',
    'V66',
    'decide',
    0.001
  ),
  receipt(
    'omaha_tournament_first_in',
    'HorsePreflop (V90)',
    'Omaha high tournament final table: a small blind against the big blind alone, or heads-up big blind, fold was replaced from the hand true Omaha percentile (no rate floor until a live day is measured)',
    'V90'
  ),
  receipt(
    'omaha_hilo_tournament_first_in',
    'HorsePreflop (omahaHiLoTournamentFirstIn)',
    'default-off omahaHiLoTournamentFirstIn: pot-limit Omaha hi-lo heads-up tournament final table, a small blind first-in or big blind facing one raise fold was replaced from the hand hi-lo percentile',
    'V90'
  ),
  receipt(
    'omaha_full_table_sb_steal',
    'HorsePreflop (V90, item 4)',
    'PLO4/PLO5 tournament, four to eight dealt, not the bubble, hand-for-hand or a satellite: the small blind folded to (big blind alone, 20 BB or less) replaced the engine fold with the pot-limit raise on its top 40 percent of Omaha hands (no rate floor until a live day is measured)',
    'V90'
  ),
  receipt(
    'v88_commitment_honored',
    'HorseLogic (V88)',
    'Cash Omaha made hand calls its stack on a blank after calling a wager that left less than a pot behind',
    'V88',
    'decide',
    0.001
  ),
  receipt(
    'v67_river_bet_raised_one_pair',
    'HorseLogic (V67)',
    'Hold em river one-pair call of a raise over hero own river bet priced with the V63 shade plus the raise shade',
    'V67',
    'decide',
    0.001
  ),
  receipt(
    'v67_river_raise_stratum',
    'HorseLogic (V67) via HorseEval',
    'Hold em river raiser over hero own wager sampled from the river raise stratum',
    'V67',
    'decide',
    0.001
  ),
  receipt(
    'v64_river_raise_needs_two_pair',
    'HorseLogic (V64)',
    'Hold em bluff-catch class redirected from a river raise to the call verdict',
    'V64',
    'decide',
    0.0001
  ),
  receipt(
    'v63_large_river_bet_shade',
    'HorseLogic (V63)',
    'Hold em one-pair river call shaded more than the V61 shape would have (steeper past a half-pot wager, cap 0.20)',
    'V63',
    'decide',
    0.0005
  ),
  receipt(
    'v38_river_fold',
    'HorseEvEngine via HorseLogic (V38)',
    'MDF river fold',
    'V38',
    'decide',
    0.002
  ),
  receipt(
    'v65_turn_one_pair_shade',
    'HorseLogic (V65)',
    'Hold em one-pair turn call of a wager hero did not initiate, shaded against the price',
    'V65',
    'decide',
    0.001
  ),
  receipt(
    'v68_turn_air_draw_calls',
    'HorseLogic (V68)',
    'Hold em high-card turn call of a wager hero did not initiate, implied odds withheld or air shaded against the price',
    'V68',
    'decide',
    0.001
  ),
  receipt(
    'v69_turn_call_gaps',
    'HorseLogic (V69)',
    'Hold em turn call re-priced: one-pair implied odds withheld, board-only draw no longer exempting the V65 shade, or V32 draw pass-through withheld with no room to be paid',
    'V69',
    'decide',
    0.001
  ),
  receipt(
    'v38_preflop_allin_price',
    'HorseLogic.decidePreflop',
    'preflop all-in priced against the complete committed population with actor-aligned range bands',
    'V38',
    'decide',
    0.002
  ),
  receipt(
    'v38_preflop_price_unavailable',
    'HorseLogic.decidePreflop',
    'the committed-population price read failed or exceeded physical card capacity; range fallback retained without inventing an opponent or neutral equity',
    'V38'
  ),
  receipt(
    'v39_outlook_*',
    'HorseLogic (V39)',
    'next-card outlook recorded / good / blank / scare',
    'V39',
    'decide',
    0.005
  ),
  receipt(
    'v40_made_*',
    'HorseLogic (V40)',
    'Omaha made-hand class read for cat 1-4',
    'V40',
    'decide_omaha',
    0.05
  ),
  receipt(
    'holdem_dominated_3bet_fold',
    'HorseLogic.decide (HorseHoldemPremiumAggression)',
    'NLH offsuit dominated hand calling or raising a big 3-bet turned into a fold',
    'Hold em premium aggression'
  ),
  receipt(
    'holdem_premium_preflop_raise',
    'HorseLogic.decide (HorseHoldemPremiumAggression)',
    'NLH QQ+/AK limp, check or flat preflop turned into a standard raise',
    'Hold em premium aggression'
  ),
  receipt(
    'holdem_premium_postflop_bet',
    'HorseLogic.decide (HorseHoldemPremiumAggression)',
    'NLH overpair QQ+ or AK top pair check postflop turned into a value bet',
    'Hold em premium aggression'
  ),
  receipt(
    'holdem_no_four_bet_bluff',
    'HorseLogic.decide (HorseHoldemPremiumAggression)',
    'NLH sized re-raise over a 3-bet with a hand below QQ+/AK turned into a call (no 4-bet made to fold)',
    'Hold em premium aggression'
  ),
  receipt(
    'holdem_premium_flat_deep_three_bet',
    'HorseLogic.decide (HorseHoldemPremiumAggression)',
    'NLH QQ/AK 4-bet too deep to call the 5-bet jam it invites turned into a flat call of the 3-bet',
    'Hold em premium aggression'
  ),
  receipt(
    'holdem_four_bettor_continues',
    'HorseLogic.decide (HorseHoldemPremiumAggression)',
    'NLH fold after the horse own 4-bet was re-raised turned into a call (AA/KK jam)',
    'Hold em premium aggression'
  ),
  receipt(
    'short_all_in_call_floor',
    'HorseLogic.decide (HorseShortAllInCallFloor)',
    'Tournament fold facing an all in under 3 big blinds with 20+ big blinds behind turned into a call',
    'Short all-in call floor'
  ),
  receipt(
    'short_all_in_call_floor_commit',
    'ServerTableEngineTurns.scheduleHorseAction (HorseShortAllInCallFloor)',
    'The same floor at the commit door, after an authority withdrawal or a liveness fallback produced the fold',
    'Short all-in call floor'
  ),
  receipt(
    'plo_paired_board_fold',
    'HorseLogic.decide (HorsePloPairedBoardFold)',
    'PLO4/PLO5/PLO6 call, raise or jam without a full house on a paired flop, turn or river turned into a fold',
    'PLO paired-board fold'
  ),
  receipt(
    'plo_paired_board_river_check',
    'HorseLogic.decide (HorsePloPairedBoardFold)',
    'PLO4/PLO5/PLO6 river bet or raise without a full house on a board paired on the turn, after the horse own turn bet was called, turned into a check',
    'PLO paired-board river check'
  ),
  receipt(
    'plo_suited_aces_four_bet',
    'HorsePreflop.decidePreflopV7',
    'High-only PLO suited aces facing one 3-bet 4-bet the pot instead of flatting',
    'PLO suited aces 4-bet'
  ),
  receipt(
    'plo_suited_aces_four_bettor_continues',
    'HorsePreflop.decidePreflopV7',
    'High-only PLO suited aces re-raised after their own raise continued at the price instead of folding',
    'PLO suited aces 4-bet'
  ),
  receipt(
    'v40_omaha_pressure_cap',
    'HorseLogic (V40)',
    'Omaha pair/two-pair/trips capped under pressure',
    'V40',
    'decide_omaha',
    0.0005
  ),
  receipt(
    'v40_small_ball',
    'HorseLogic (V40)',
    'weak-class Omaha value bet sized down',
    'V40',
    'decide_omaha',
    0.0002
  ),
  receipt(
    'v40_no_third_barrel',
    'HorseLogic (V40)',
    'weak-class hand declined the third barrel',
    'V40',
    'decide_omaha',
    0.0001
  ),

  receipt(
    'phase14_review_signal_ignored',
    'HorseLogic.decide',
    'historical review fields were present and excluded from decision adjustments; diagnostic only',
    'Phase14'
  ),
  receipt(
    'phase14_accepted_roster_refused',
    'HorseDecisionWorkerRuntime.executeObservation',
    'a completed-hand observation carried an accepted actor roster transport that did not validate or bind to that hand; the hand was observed and journaled without it (explicit unknown); not a settlement fault',
    'Phase14'
  ),
  receipt(
    'phase5_canonical_state',
    'HorseDecisionWorkerRuntime.executeFast',
    'a schema-v1 state passed the worker privacy, legality, side-pot, rake and variant-rule boundary',
    'Phase5',
    'decide',
    0.99
  ),
  receipt(
    'hybrid_v1_cash_grinder_decided',
    'HorseDecisionWorkerRuntime.executeFast',
    'a non-fallback cash decision ran the exact Hybrid v1 Grinder inputs; execution count, not proof of profitability or accepted action',
    'HybridV1'
  ),
  receipt(
    'hybrid_v1_tournament_tricky_decided',
    'HorseDecisionWorkerRuntime.executeFast',
    'a non-fallback tournament decision ran the exact Hybrid v1 Tricky inputs; execution count, not proof of profitability or accepted action',
    'HybridV1'
  ),
  receipt(
    'phase6_tournament_context',
    'HorseLogic (Phase6)',
    'a live tournament decision received the schema-v1 tournament context',
    'Phase6',
    'decide_tournament',
    0.99
  ),
  receipt(
    'phase6_tournament_context_*',
    'HorseLogic (Phase6)',
    'complete and explicit-incomplete outcomes partition every Phase 6 context read',
    'Phase6',
    'phase6_tournament_context',
    0.99
  ),
  receipt(
    'phase6_tournament_context_complete',
    'HorseLogic (Phase6)',
    'the schema-v1 tournament context passed the complete-context contract',
    'Phase6',
    'phase6_tournament_context'
  ),
  receipt(
    'phase6_m_engine',
    'HorseLogic (Phase6)',
    'real, effective, projected, velocity and covering-opponent M were present',
    'Phase6',
    'phase6_tournament_context',
    0.99
  ),
  receipt(
    'phase6_tournament_preflop',
    'HorseLogic (Phase6)',
    'a live tournament preflop decision resolved an atlas coordinate',
    'Phase6',
    'decide_tournament_preflop',
    0.99
  ),
  receipt(
    'phase6_route_*',
    'HorseLogic (Phase6)',
    'solver, atlas, and solverless-variant routes partition actual tournament preflop returns',
    'Phase6',
    'phase6_tournament_preflop',
    0.99
  ),
  receipt(
    'phase6_branch_*',
    'HorseLogic (Phase6)',
    'the branch attached to the actual tournament preflop return',
    'Phase6',
    'phase6_tournament_preflop',
    0.99
  ),
  receipt(
    'phase6_route_atlas',
    'HorseLogic (Phase6)',
    'an actual tournament preflop return used the Phase 6 atlas path',
    'Phase6'
  ),
  receipt(
    'phase6_atlas_*',
    'HorseLogic (Phase6)',
    'baseline and labeled-fallback outcomes partition actual atlas returns',
    'Phase6',
    'phase6_route_atlas',
    0.99
  ),
  receipt(
    'phase7_tournament_utility',
    'HorseLogic -> HorseTournamentUtility',
    'a complete-context tournament decision compared its legal action families by resulting stack-vector utility and attached the component ledger',
    'Phase7',
    'phase6_tournament_context_complete',
    0.99
  ),
  receipt(
    'phase10_seen',
    'HorseLogic -> evaluatePlo4LivePolicy',
    'natural PLO4 decisions entering the versioned policy',
    'Phase10'
  ),
  receipt(
    'phase10_eligible',
    'evaluatePlo4LivePolicy',
    'complete supported single-board PLO4 nodes',
    'Phase10'
  ),
  receipt(
    'phase10_fired',
    'evaluatePlo4LivePolicy',
    'completed bounded PLO4 policy evaluation',
    'Phase10'
  ),
  receipt(
    'phase10_shadow_changed',
    'evaluatePlo4LivePolicy',
    'proposal differs from baseline; not a live action claim',
    'Phase10'
  ),
  receipt(
    'phase10_applied',
    'HorseLogic',
    'approved policy proposal accepted before final utility and enforcement',
    'Phase10'
  ),
  receipt(
    'phase10_baseline_retained',
    'HorseLogic',
    'shadow or unavailable policy retained the existing action',
    'Phase10'
  ),
  receipt(
    'phase10_reason_*',
    'evaluatePlo4LivePolicy',
    'exact selection or unavailable reason',
    'Phase10',
    'phase10_seen',
    0.99
  ),
  receipt(
    'phase10_range_*',
    'evaluatePlo4LivePolicy -> HorseLogic (P10.1 input binding)',
    'range status of every bound PLO4 proposal (not_consumed_preflop, unavailable, rejected_malformed, rejected_population, consumed_unattributed, consumed); counts only, never calibration or solver evidence',
    'Phase10',
    'phase10_eligible',
    0.99
  ),
  receipt(
    'phase10_street_*',
    'evaluatePlo4LivePolicy',
    'street coverage for completed policy evaluations',
    'Phase10',
    'phase10_fired',
    0.99
  ),
  receipt(
    'phase10_unavailable_utility_*',
    'HorseLogic -> HorseTournamentUtility',
    'exact reason the existing tournament utility owner refused evaluation',
    'Phase10'
  ),
  receipt(
    'phase10_utility_*',
    'HorseLogic -> HorseTournamentUtility',
    'cash or existing tournament utility ownership',
    'Phase10',
    'phase10_seen',
    0.99
  ),
  receipt(
    'phase10_execution_*',
    'ServerTableEngineTurns',
    'authoritative action or retired decision accounting',
    'Phase10'
  ),
  receipt(
    'phase10_selection_*',
    'HorseLogic -> ServerTableEngineTurns (P10.3)',
    'none, shadow change (never applied), authority-backed cash selection, controller acceptance or withdrawal before acceptance; never a tournament objective selection',
    'Phase10'
  ),
  receipt(
    'phase10_authority_*',
    'HorsePhase10Authority (HorseQualifiedAuthority) -> workerRuntime / client / ServerTableEngineTurns (P10.3)',
    'protected-release PLO4 authority admission, local withdrawal and acceptance-time verdicts',
    'Phase10'
  ),
  receipt(
    'phase10_shadow_receipt_binding_dropped',
    'horseDecision/client (P10 audit F8)',
    'a shadow-only PLO4 receipt whose input binding failed the strict validator was dropped with its ownership record; the decision kept its actual action and the worker stayed up (an applied receipt still fails closed)',
    'Phase10'
  ),
  receipt(
    'phase11_seen',
    'HorseLogic -> evaluateOmahaVariantPolicy',
    'natural PLO5/PLO6/PLO8 decisions entering the versioned policy',
    'Phase11'
  ),
  receipt(
    'phase11_eligible',
    'evaluateOmahaVariantPolicy',
    'complete supported single-board PLO5/PLO6/PLO8 nodes',
    'Phase11'
  ),
  receipt(
    'phase11_fired',
    'evaluateOmahaVariantPolicy',
    'completed bounded PLO5/PLO6/PLO8 policy evaluation',
    'Phase11'
  ),
  receipt(
    'phase11_shadow_changed',
    'evaluateOmahaVariantPolicy',
    'proposal differs from baseline; not a live action claim',
    'Phase11'
  ),
  receipt(
    'phase11_applied',
    'HorseLogic',
    'approved policy proposal accepted before final utility and enforcement',
    'Phase11'
  ),
  receipt(
    'phase11_baseline_retained',
    'HorseLogic',
    'shadow or unavailable policy retained the existing action',
    'Phase11'
  ),
  receipt(
    'phase11_reason_*',
    'evaluateOmahaVariantPolicy',
    'exact selection or unavailable reason',
    'Phase11',
    'phase11_seen',
    0.99
  ),
  receipt(
    'phase11_range_*',
    'evaluateOmahaVariantPolicy -> HorseLogic (P11.1 input binding)',
    'range status of every bound PLO5/PLO6/PLO8 proposal (not_consumed_preflop, unavailable, rejected_malformed, rejected_population, consumed_unattributed, consumed); counts only, never calibration or solver evidence',
    'Phase11',
    'phase11_eligible',
    0.99
  ),
  receipt(
    'phase11_shadow_receipt_binding_dropped',
    'horseDecision/client (P11.1, the P10 audit F8 rule)',
    'a shadow-only PLO5/PLO6/PLO8 receipt whose input binding failed the strict validator was dropped with its ownership record; the decision kept its actual action and the worker stayed up (an applied receipt still fails closed)',
    'Phase11'
  ),
  receipt(
    'phase11_street_*',
    'evaluateOmahaVariantPolicy',
    'street coverage for completed policy evaluations',
    'Phase11',
    'phase11_fired',
    0.99
  ),
  receipt(
    'phase11_unavailable_utility_*',
    'HorseLogic -> HorseTournamentUtility',
    'exact reason the existing tournament utility owner refused evaluation',
    'Phase11'
  ),
  receipt(
    'phase11_utility_*',
    'HorseLogic -> HorseTournamentUtility',
    'cash or existing tournament utility ownership',
    'Phase11',
    'phase11_seen',
    0.99
  ),
  receipt(
    'phase11_execution_*',
    'ServerTableEngineTurns',
    'authoritative action or retired decision accounting',
    'Phase11'
  ),
  receipt(
    'phase11_selection_*',
    'HorseLogic -> ServerTableEngineTurns (P11.3)',
    'none, shadow change (never applied), authority-backed cash selection of the deciding pack, controller acceptance or withdrawal before acceptance; never a tournament objective selection',
    'Phase11'
  ),
  receipt(
    'phase11_authority_*',
    'HorsePhase11Authority (HorseQualifiedAuthority, one gate per pack) -> workerRuntime / client / ServerTableEngineTurns (P11.3)',
    'protected-release PLO5/PLO6/PLO8 authority admission per pack, local withdrawal and acceptance-time verdicts',
    'Phase11'
  ),
  receipt(
    'phase11_variant_*',
    'HorseLogic',
    'partition entering decisions by exact variant',
    'Phase11',
    'phase11_seen',
    0.99
  ),
  ...(['plo5', 'plo6', 'plo8'] as const).map((variant) =>
    receipt(
      `phase11_${variant}_*`,
      'HorseLogic; ServerTableEngineTurns',
      'per-variant eligibility, completion, reason and final execution; depends on table mix',
      'Phase11'
    )
  ),
  receipt(
    'phase12_seen',
    'HorseLogic -> evaluateRemainingVariantPolicy',
    'natural Short Deck/Pineapple/FLH/FLO8 decisions entering the versioned policy',
    'Phase12'
  ),
  receipt(
    'phase12_eligible',
    'evaluateRemainingVariantPolicy',
    'complete supported single-board Short Deck/Pineapple/FLH/FLO8 nodes',
    'Phase12'
  ),
  receipt(
    'phase12_fired',
    'evaluateRemainingVariantPolicy',
    'completed bounded Short Deck/Pineapple/FLH/FLO8 policy evaluation',
    'Phase12'
  ),
  receipt(
    'phase12_shadow_changed',
    'evaluateRemainingVariantPolicy',
    'proposal differs from baseline; not a live action claim',
    'Phase12'
  ),
  receipt(
    'phase12_applied',
    'HorseLogic',
    'approved policy proposal accepted before final utility and enforcement',
    'Phase12'
  ),
  receipt(
    'phase12_baseline_retained',
    'HorseLogic',
    'shadow or unavailable policy retained the existing action',
    'Phase12'
  ),
  receipt(
    'phase12_reason_*',
    'evaluateRemainingVariantPolicy',
    'exact selection or unavailable reason',
    'Phase12',
    'phase12_seen',
    0.99
  ),
  receipt(
    'phase12_range_*',
    'evaluateRemainingVariantPolicy -> HorseLogic (P12.1 input binding)',
    'range status of every bound Short Deck/Pineapple/FLH/FLO8 proposal (not_consumed_preflop, unavailable, rejected_malformed, rejected_population, consumed_unattributed, consumed); counts only, never calibration or solver evidence',
    'Phase12',
    'phase12_eligible',
    0.99
  ),
  receipt(
    'phase12_selection_*',
    'HorseLogic -> ServerTableEngineTurns (P12.3)',
    'none, shadow change (never applied), authority-backed cash selection of the deciding pack, controller acceptance or withdrawal before acceptance; never a tournament objective selection',
    'Phase12'
  ),
  receipt(
    'phase12_authority_*',
    'HorsePhase12Authority (HorseQualifiedAuthority, one gate per pack) -> workerRuntime / client / ServerTableEngineTurns (P12.3)',
    'protected-release Short Deck/Pineapple/FLH/FLO8 authority admission per pack, local withdrawal and acceptance-time verdicts',
    'Phase12'
  ),
  receipt(
    'phase12_shadow_receipt_binding_dropped',
    'horseDecision/client (P12.1, the P10 audit F8 rule)',
    'a shadow-only Short Deck/Pineapple/FLH/FLO8 receipt whose binding (P12.1 inputs or the P12-B net-action economics) failed the strict validator was dropped with its ownership record; the decision kept its actual action and the worker stayed up (an applied receipt still fails closed)',
    'Phase12'
  ),
  receipt(
    'phase12_street_*',
    'evaluateRemainingVariantPolicy',
    'street coverage for completed policy evaluations',
    'Phase12',
    'phase12_fired',
    0.99
  ),
  receipt(
    'phase12_unavailable_utility_*',
    'HorseLogic -> HorseTournamentUtility',
    'exact reason the existing tournament utility owner refused evaluation',
    'Phase12'
  ),
  receipt(
    'phase12_utility_*',
    'HorseLogic -> HorseTournamentUtility',
    'cash or existing tournament utility ownership',
    'Phase12',
    'phase12_seen',
    0.99
  ),
  receipt(
    'phase12_execution_*',
    'ServerTableEngineTurns',
    'authoritative action or retired decision accounting',
    'Phase12'
  ),
  receipt(
    'phase12_variant_*',
    'HorseLogic',
    'partition entering decisions by exact variant',
    'Phase12',
    'phase12_seen',
    0.99
  ),
  ...(['short_deck', 'pineapple', 'flh', 'flo8'] as const).map((variant) =>
    receipt(
      `phase12_${variant}_*`,
      'HorseLogic; ServerTableEngineTurns',
      'per-variant eligibility, completion, reason and final execution; depends on table mix',
      'Phase12'
    )
  ),
  receipt(
    'phase13_seen',
    'HorseLogic -> evaluateJointLivePolicy',
    'natural multiway and bomb-pot decisions entering the versioned policy',
    'Phase13'
  ),
  receipt(
    'phase13_eligible',
    'evaluateJointLivePolicy',
    'complete supported multiway and bomb-pot nodes',
    'Phase13'
  ),
  receipt(
    'phase13_fired',
    'evaluateJointLivePolicy',
    'completed bounded multiway and bomb-pot policy evaluation',
    'Phase13'
  ),
  receipt(
    'phase13_shadow_changed',
    'evaluateJointLivePolicy',
    'proposal differs from baseline; not a live action claim',
    'Phase13'
  ),
  receipt(
    'phase13_applied',
    'HorseLogic',
    'approved policy proposal accepted before final utility and enforcement',
    'Phase13'
  ),
  receipt(
    'phase13_baseline_retained',
    'HorseLogic',
    'shadow or unavailable policy retained the existing action',
    'Phase13'
  ),
  receipt(
    'phase13_reason_*',
    'evaluateJointLivePolicy',
    'exact selection or unavailable reason',
    'Phase13',
    'phase13_seen',
    0.99
  ),
  receipt(
    'phase13_street_*',
    'evaluateJointLivePolicy',
    'street coverage for completed policy evaluations',
    'Phase13',
    'phase13_fired',
    0.99
  ),
  receipt(
    'phase13_utility_*',
    'HorseLogic -> HorseTournamentUtility',
    'cash or existing tournament utility ownership',
    'Phase13',
    'phase13_seen',
    0.99
  ),
  receipt(
    'phase13_execution_*',
    'ServerTableEngineTurns',
    'authoritative action or retired decision accounting',
    'Phase13'
  ),
  receipt(
    'phase13_unavailable_utility_*',
    'HorseLogic -> HorseTournamentUtility',
    'explicit utility refusal, budget, context or legalization failure',
    'Phase13'
  ),
  receipt(
    'phase13_variant_*',
    'HorseLogic',
    'partition entering decisions by exact variant',
    'Phase13',
    'phase13_seen',
    0.99
  ),
  ...(
    ['nlh', 'plo4', 'plo5', 'plo6', 'plo8', 'short_deck', 'pineapple', 'flh', 'flo8'] as const
  ).map((variant) =>
    receipt(
      `phase13_${variant}_*`,
      'HorseLogic; ServerTableEngineTurns',
      'per-variant eligibility, completion, reason and final execution; depends on table mix',
      'Phase13'
    )
  ),
  receipt(
    'phase13_board_*',
    'HorseLogic',
    'actual controller board-count coverage',
    'Phase13',
    'phase13_seen',
    0.99
  ),
  receipt(
    'phase13_range_*',
    'evaluateJointLivePolicy -> HorseLogic (P13.1 input binding)',
    'range status of every bound multiway or bomb-pot proposal (consumed, unavailable); counts only, never calibration or solver evidence',
    'Phase13',
    'phase13_eligible',
    0.99
  ),
  receipt(
    'phase13_response_*',
    'evaluateJointActions -> evaluateJointLivePolicy -> HorseLogic (P13-A, P13.1)',
    'response model that priced each fired proposal (one_response_then_showdown, bounded_raise_tree) and every named response-tree refusal (joint_response_branch_unavailable, joint_response_street_unavailable, joint_response_street_not_modeled, joint_response_illegal_simulated_action, joint_response_branch_mass); counts only, never calibration',
    'Phase13'
  ),
  receipt(
    'phase13_selection_refused_*',
    'HorseLogic (P13.1)',
    'an applied Phase 13 candidate refused before it could act: illegal_candidate (the legalizer would rewrite it) or earlier_phase_applied (a Phase 10/11/12 candidate already owned the action)',
    'Phase13'
  ),
  receipt(
    'phase13_selection_*',
    'HorseLogic -> ServerTableEngineTurns (P13.3)',
    "none, shadow change (never applied), authority-backed cash selection of the decision's variant, controller acceptance or withdrawal before acceptance; never a tournament objective selection, never on top of an applied Phase 10/11/12 candidate (the named refusals are phase13_selection_refused_*)",
    'Phase13'
  ),
  receipt(
    'phase14_original_reads_unavailable',
    'horseDecision/workerRuntime.executeFast',
    'an admitted corrective path could not capture its original private read frame; baseline retained',
    'Phase14'
  ),
  receipt(
    'phase14_authority_*',
    'HorsePhase14Authority -> worker/client/physical and Lightning acceptance',
    'per-domain protected authority/composition admission, withdrawal and acceptance/effect verdicts',
    'Phase14'
  ),
  receipt(
    'phase14_selection_*',
    'HorsePhase14Acceptance',
    'selection withdrawn before acceptance or exact controller-accepted correction; never submission proof',
    'Phase14'
  ),
  receipt(
    'phase14_execution_*',
    'HorsePhase14Acceptance after settleHorseExecutionWitness',
    'actual controller witness outcome for an original-state correction',
    'Phase14'
  ),
  receipt(
    'phase13_authority_*',
    'HorsePhase13Authority (HorseQualifiedAuthority, one gate per joint variant) -> workerRuntime / client / ServerTableEngineTurns (P13.3)',
    'protected-release joint authority admission per variant, local withdrawal and acceptance-time verdicts',
    'Phase13'
  ),
  receipt(
    'phase13_shadow_receipt_binding_dropped',
    'horseDecision/client (P13.1, the P10 audit F8 rule)',
    'a shadow-only Phase 13 receipt whose P13.1 binding failed the strict validator was dropped; the decision kept its actual action and the worker stayed up (an applied receipt still fails closed)',
    'Phase13'
  ),
  receipt(
    'phase8_family_catastrophe_guard_v1',
    'HorseLogic -> HorseTournamentCatastropheGuard',
    'an actual bounded guard assessment at the tournament continuation node, distinct from legacy continuation work',
    'Phase8'
  ),
  receipt(
    'phase8_work_kind_phase7_candidate_guard',
    'HorseLogic -> HorseTournamentCatastropheGuard',
    'a Phase 7 candidate guard assessment; no rollout, future-hand or continuation work is claimed',
    'Phase8'
  ),
  receipt(
    'phase8_seen',
    'HorseLogic -> HorseTournamentPostflop or HorseTournamentCatastropheGuard',
    'natural tournament postflop decisions entering the selected Phase 8 family; guard assessments carry an exact family and work-kind counter',
    'Phase8'
  ),
  receipt(
    'phase8_eligible',
    'HorseTournamentPostflop or HorseTournamentCatastropheGuard',
    'canonical NLH single-board decisions with action-specific utility admitted by the selected family',
    'Phase8'
  ),
  receipt(
    'phase8_fired',
    'HorseTournamentPostflop or HorseTournamentCatastropheGuard',
    'selected-family continuation evaluations or bounded guard assessments; the guard family claims no future-hand work',
    'Phase8'
  ),
  receipt(
    'phase8_completed',
    'HorseLogic -> HorseTournamentPostflop or HorseTournamentCatastropheGuard',
    'completed selected-family work: useful continuation or bounded guard assessment, never controller acceptance',
    'Phase8',
    'phase8_eligible'
  ),
  receipt(
    'phase8_shadow_changed',
    'HorseTournamentPostflop',
    'counterfactual differs from accepted baseline; not proof of changed play',
    'Phase8'
  ),
  receipt(
    'phase8_applied',
    'HorseTournamentPostflop',
    'promoted candidate accepted before authoritative enforcement',
    'Phase8'
  ),
  receipt(
    'phase8_baseline_retained',
    'HorseTournamentPostflop',
    'shadow or unavailable candidate preserves baseline',
    'Phase8'
  ),
  receipt(
    'phase8_reason_*',
    'HorseTournamentPostflop',
    'one explicit selection or fallback reason per observed decision',
    'Phase8',
    'phase8_seen',
    0.99
  ),
  receipt(
    'phase8_objective_*',
    'HorseTournamentPostflop',
    'objective partitions evaluated candidate attempts before final gates',
    'Phase8',
    'phase8_fired',
    0.99
  ),
  receipt(
    'phase8_feature_*',
    'HorseTournamentPostflop',
    'specific geometry and objective evidence, not independent overwrites',
    'Phase8'
  ),
  receipt(
    'phase8_format_*',
    'HorseLogic',
    'format partitions every observed tournament postflop gate',
    'Phase8',
    'phase8_seen',
    0.99
  ),
  receipt(
    'phase8_execution_*',
    'ServerTableEngineTurns',
    'authoritative action acceptance, coercion, fallback or retired request',
    'Phase8'
  ),
  receipt(
    'phase8_selection_*',
    'HorseLogic -> ServerTableEngineTurns',
    'none, shadow change (never applied), authority-backed selection, controller acceptance or withdrawal before acceptance',
    'Phase8'
  ),
  receipt(
    'phase8_authority_*',
    'HorseQualifiedAuthority -> workerRuntime / client / ServerTableEngineTurns',
    'protected-release authority admission, local withdrawal and acceptance-time verdicts',
    'Phase8'
  ),
  receipt(
    'phase7_objective_*',
    'HorseTournamentUtility.objectiveOf',
    'dedicated MTT, satellite, PKO, mystery, SNG and Spin objectives partition Phase 7 decisions',
    'Phase7',
    'phase7_tournament_utility',
    0.99
  ),
  receipt(
    'phase7_icm_*',
    'IcmModel.createIcmEquityEstimator',
    'exact final-table MH or direct bounded Plackett-Luce Monte Carlo method used by the selected utility ledger',
    'Phase7',
    'phase7_tournament_utility',
    0.99
  ),
  receipt(
    'phase7_utility_override',
    'HorseTournamentUtility.evaluateTournamentUtility',
    'action-specific utility overrode the legacy heuristic or solver proposal',
    'Phase7'
  ),
  receipt(
    'phase7_short_shove_*',
    'HorseLogic (Phase 7 owner, shortAllInWagers)',
    'phase7_short_shove_priced_<variant>_seen: a pot-limit or fixed-limit tournament reference all_in on the short menu (the all-in button, no sized wager, chips beyond the call) was priced by the tournament utility, the game variant in the name; phase7_short_shove_replaced_<variant>_seen: the utility then selected another action (fold or call) and that action was committed by the Phase 7 owner, or by the Phase 7 owner on the Phase 13 candidate path; replaced over priced is the replacement rate per variant; occurrence counters; named *_seen',
    '2026-11-14'
  ),
  receipt(
    'phase7_utility_skip_incomplete',
    'HorseLogic',
    'Phase 7 failed closed because the Phase 6 context was explicitly incomplete',
    'Phase7'
  ),
  receipt(
    'phase7_utility_unavailable',
    'HorseLogic',
    'a nominally complete betting decision could not produce a Phase 7 ledger; any live fire requires investigation',
    'Phase7'
  ),
  /*
   * WHY A TOURNAMENT DECISION HAD NO COMPLETE CONTEXT (2026-10-16). About
   * 10.5% of tournament decisions read phase6_tournament_context_incomplete
   * (163-167k a day) and nothing said which issue closed it. The engine names
   * every issue of an incomplete context once per decision
   * (ServerTableEngineTurns.noteTournamentContextIssues), from the list
   * TournamentBrainContext and the table projection build.
   */
  receipt(
    'phase6_context_issue_*',
    'ServerTableEngineTurns.noteTournamentContextIssues',
    'one per issue of a live tournament decision whose Phase 6 context was not complete: the TournamentBrainContext issue (tournament_context_warming, payout_or_ticket_structure_missing, level_timing_*, ...) or the table projection issue (blind_level_cache_lag, dealer_seat_missing, ...), and the context status (status_warming, status_stale, status_incomplete)',
    'Phase6'
  ),
  receipt(
    'phase7_unavailable_*',
    'HorseLogic -> HorseTournamentUtility',
    'the bounded fail-closed reason partitions every Phase 7 utility-unavailable receipt for production diagnosis',
    'Phase7',
    'phase7_utility_unavailable',
    0.99
  ),
  receipt(
    'phase7_utility_committed',
    'ServerTableEngineTurns.scheduleHorseAction',
    'the exact action selected by the Phase 7 ledger was accepted by the authoritative hand controller',
    'Phase7',
    'phase7_tournament_utility'
  ),
  receipt(
    'phase7_utility_coerced',
    'ServerTableEngineTurns.scheduleHorseAction',
    'a final legality belt changed the Phase 7-selected action before acceptance; every fire requires investigation',
    'Phase7'
  ),
  receipt(
    'phase7_utility_fallback',
    'ServerTableEngineTurns.scheduleHorseAction',
    'the Phase 7-selected action was rejected and the controller accepted the check/fold fallback; every fire requires investigation',
    'Phase7'
  ),
  receipt(
    'phase7_utility_not_executed',
    'ServerTableEngineTurns.scheduleHorseAction',
    'a Phase 7 evaluation did not reach an accepted action under its authority fence',
    'Phase7'
  ),
  receipt(
    'phase7_side_pot',
    'HorseTournamentUtility',
    'at least one evaluated action produced multiple canonical pot layers',
    'Phase7'
  ),
  receipt(
    'phase7_players_behind',
    'HorseLogic.phase7PlayersBehind',
    'the utility receipt included live actionable players behind hero',
    'Phase7'
  ),
  receipt(
    'phase7_bounty_utility',
    'HorseTournamentUtility',
    'PKO or bounty ownership and denial entered action utility',
    'Phase7'
  ),
  receipt(
    'second_look_*',
    'BrainTelemetry.noteSecondLookFires (HorseDecisionWorkerRuntime.executeDeep)',
    'second_look_<key>_seen (the suffix is not doubled for a key already ending in _seen): a DEEP second look evaluation fired the receipt <key>. The second look decides with telemetry on inside a capture, so <key> itself is not counted there (the FAST look is its one count per decision) and each key counts at most once per second look. It does not say the second look action was executed: the decision journal records that. A zero on <key> and on its second_look_ counter means no live evaluation, first or second, fired it. second_look_receipt_fold_failed_seen: counting the collected keys threw after the second look was made (the decision is unaffected). Occurrence counters; named *_seen',
    '2026-11-16'
  ),
  receipt(
    'v44_second_look',
    'HorseDecisionWorkerRuntime.executeDeep',
    'a second look completed at increased equity depth with the original HorseMind reads; declined, missing-read, cancelled and failed work is not a completed evaluation',
    'V44',
    'decide',
    0.001
  ),
  receipt(
    'phase15_hand_binding_*',
    'HorseCommittedDecisionTracker',
    'private memory-only decision-to-accepted-hand reconciliation; bound names the exact committed UUID and unfiltered action ordinal, while gaps/conflicts stay unavailable; not durable capture, source completeness or GTO correctness',
    'Phase15'
  ),
  receipt(
    'phase15_journal_*',
    'HorseDecisionJournalPublisher',
    'private host-local journal capture, queue admission, exact disk acknowledgement or explicit gap; enqueued is not durable, recorded is not complete coverage, full replay or a GTO verdict',
    'Phase15'
  ),
  // 2026-09-26: a named archive quota pauses capture instead of ending it.
  // These three keep paused-at-quota apart from failed (capture_unavailable).
  receipt(
    'phase15_journal_capture_paused_capacity',
    'HorseDecisionJournalPublisher.record',
    'a capture offered while the journal is paused at a named archive quota (archive_bytes, archive_segments, archive_catalog_capacity, archive_storage_capacity); the record is still queued within the same bound, and the same call also counts enqueued or queue_capacity; paused is not failed, and capture_unavailable still counts a journal that stopped for good',
    'Phase15'
  ),
  receipt(
    'phase15_journal_capacity_paused',
    'HorseDecisionJournalPublisher.pause',
    'the writer refused an append at a named archive quota and capture paused with its queue kept; the writer is probed read-only once a minute; not a failure, not a deletion and not a retry',
    'Phase15'
  ),
  receipt(
    'phase15_journal_capacity_resumed',
    'HorseDecisionJournalPublisher.capacityAnswer',
    'a capacity probe found room and capture resumed; the kept queue is replayed with the same event identities and digests, so a record already held is replayed, never written twice',
    'Phase15'
  ),
  receipt(
    'phase15_discard_capture_unavailable',
    'LiveHorseDecisionWorkerClient.observeDiscardExecution',
    'private accepted-discard evidence could not be queued or acknowledged; an explicit capture gap, not evidence that the controller discard failed',
    'Phase15'
  ),
  receipt(
    'phase15_telemetry_batch_rejected',
    'BrainTelemetryFlush.flush',
    'the telemetry writer refused a batch for a property of its bytes (bounds, shape, duplicate or collision); the publisher dropped it instead of resending it forever, and the counters in it are an evidence gap',
    '2026-11-13'
  ),
  receipt(
    'phase15_telemetry_batch_abandoned',
    'BrainTelemetryFlush.flush',
    'a telemetry batch stayed unconfirmed for HORSE_TELEMETRY_MAX_ATTEMPTS flushes (an hour) and was dropped so newer counters can publish; an evidence gap',
    '2026-11-13'
  ),
  receipt(
    'phase15_telemetry_batch_expired',
    'BrainTelemetryFlush.flush',
    'a retained pending telemetry batch exceeded the 32-day receipt window and was explicitly refused without aggregation; this is an evidence gap',
    'Phase15'
  ),
  receipt(
    'phase15_brain_exception',
    'HorseLogic.decide',
    'a policy exception produced an explicit check/fold liveness fallback; the private error is not part of the action receipt',
    'Phase15'
  ),
  receipt(
    'phase15_second_look_reads_unavailable',
    'HorseDecisionWorkerRuntime.executeFast and executeDeep',
    'private original-read capture was refused, or a second-look frame was missing, invalid, expired, evicted, ambiguous, consumed or identity-mismatched; preserve the valid fast action and refuse a missing-read second look recoverably',
    'Phase15'
  ),
  receipt(
    'phase15_reference_plans_retired',
    'HorseDecisionWorkerRuntime.executeFast',
    'reference-layer future-street plans were discarded because their exact wager did not survive the final policy selection',
    'Phase15'
  ),
  receipt(
    'phase15_plan_issue_*',
    'HorseDecisionWorkerRuntime.executeFast',
    'finite original-batch issuance outcomes: issued, no_effects, capacity_unavailable or reissue_unavailable; the total bound stays 128 and pending ownership is not evicted; issuance is not accepted-wager or application proof',
    'Phase15'
  ),
  receipt(
    'phase15_plan_accepted_*',
    'ServerTableEngineTurns.scheduleHorseAction',
    'the original FAST wager was accepted with no_effects, capacity_unavailable or reissue_unavailable; no effects is distinct from an unavailable nonempty batch, and none of these outcomes claims successful plan application',
    'Phase15'
  ),
  receipt(
    'phase15_plan_refused_*',
    'HorseDecisionWorkerRuntime.executeEffectCommit/executeEffectRetirement',
    'finite refusal reasons: issue_absent, issue_ambiguous, issue_failed, issue_retired, no_effects, binding_mismatch or effects_mismatch; refusal applies no new effects and does not authorize retrying an accepted wager',
    'Phase15'
  ),
  receipt(
    'phase15_plan_retirement_*',
    'HorseDecisionWorkerRuntime.executeEffectRetirement / LiveHorseDecisionWorkerClient.retireDecisionEffects',
    'exact local retirement reports retired, already_retired, already_applied_volatile, issue_absent or issue_failed; client unconfirmed is a transport gap that may retain pending capacity, not proof of retirement or rollback of an applied batch',
    'Phase15'
  ),
  receipt(
    'phase15_plan_terminal_*',
    'HorseDecisionWorkerRuntime.issuePlanBatch',
    'expired or evicted terminal records are reclaimed within the existing bounded map; pending issued records are excluded; reclamation limits duplicate-ACK retention and does not establish durable recovery',
    'Phase15'
  ),
  receipt(
    'phase15_plan_applied_volatile',
    'HorseDecisionWorkerRuntime.executeEffectCommit',
    'the exact detached issued effects applied once in this worker before its ACK; not durable accepted-effect storage, restart recovery or historical replay',
    'Phase15'
  ),
  receipt(
    'phase15_plan_already_applied_volatile',
    'HorseDecisionWorkerRuntime.executeEffectCommit',
    'an exact same-process duplicate was acknowledged from a retained applied record without applying effects again; not fresh-process replay or a new application',
    'Phase15'
  ),
  receipt(
    'phase15_plan_apply_failed',
    'HorseDecisionWorkerRuntime.executeEffectCommit',
    'application threw and may have left partial volatile writes; the batch remains failed without a success ACK or automatic retry, and its materialized state is not certified complete',
    'Phase15'
  ),
  receipt(
    'phase15_plan_commit_posted',
    'LiveHorseDecisionWorkerClient.commitDecisionEffects',
    'Phase 15.1: an owned nonempty batch was posted for application with its exact controller-accepted wager; accepted intent in transit, not application and not durability',
    'Phase15'
  ),
  receipt(
    'phase15_plan_receipt_*',
    'HorseDecisionWorkerRuntime.recordPlanReceipt / HorseDecisionJournalPublisher',
    'Phase 15.1 durable accepted-effect receipt: applied or failed is the first terminal transition captured with its exact batch digest and accepted wager; unavailable means no journal sink or a refused receipt; durable counts only the private writer exact fsynced ACK of a receipt record, never enqueue',
    'Phase15'
  ),
  receipt(
    'phase15_plan_recovery_*',
    'HorseDecisionWorkerRuntime.recoverPlanReceipts',
    'Phase 15.1 fresh-process reconstruction outcome per receipt: replaced by keyed replacement into the same live hand, street and lease, or refused as invalid, conflict, failed_not_replayed, hand_not_live, table_mismatch, hand_superseded, lease_superseded, street_superseded, generation_expired or policy_withdrawn; owned_conflict is a batch this epoch already owns',
    'Phase15'
  ),
  receipt(
    'phase15_graph_*',
    'HorsePolicyGraph.run/finish',
    'live outer graph started, completed or failed; no claim of full internal distribution coverage or authoritative table execution',
    'Phase15'
  ),
  receipt(
    'phase15_node_*',
    'HorsePolicyGraph.run',
    'eight finite outer nodes count entry, completion, failure and produced/changed/retained actions; component duration is published through the existing bounded latency flush; invocation is not candidate eligibility',
    'Phase15'
  ),
  receipt(
    'phase15_policy_*',
    'HorseLogic.decide',
    'finite registered variant outcomes: reference, disabled, computed, outside_domain or unavailable; unregistered input refuses before policy execution',
    'Phase15'
  ),
  receipt(
    'phase15_reference_agreement_*',
    'fn_run_horse_reference_agreement (HorseReferenceAgreementReport, daily)',
    'one per validated live FAST decision: <variant>_<cash|tournament>_<exact|action|differ|unrecorded>, the final policy action against the action the graph reference node produced (HorsePolicyLedgerObserver); agreement with the reference is not strength and not GTO',
    'Phase15'
  ),
  receipt(
    'phase15_reference_divergence_*',
    'fn_run_horse_reference_agreement (HorseReferenceAgreementReport, daily)',
    'for a live FAST decision that left the reference action or amount, <variant>_<node>: the first policy graph node whose transition changed it',
    'Phase15'
  ),
  receipt(
    'phase15_deep_brain_exception_retired',
    'ServerTableEngineTurns.scheduleHorseAction',
    'a failed deep evaluation was retired while the original fast decision and its execution authority were retained',
    'Phase15'
  ),
  receipt(
    'phase15_execution_*',
    'HorseExecutionWitness.countFinal',
    'one terminal memory-witness outcome per returned decision, bound to the controller accepted record; not a durable decision ledger',
    'Phase15'
  ),
  ...(['fast', 'deep', 'worker_fallback'] as const).map((lane) =>
    receipt(
      `phase15_${lane}_execution_*`,
      'HorseExecutionWitness.countFinal',
      `terminal execution-witness outcomes from the ${lane} lane, and for not_executed the retirement reason (retired_<reason>); failed or discarded computation is distinct from accepted policy intent`,
      'Phase15'
    )
  ),
  receipt(
    'v44_second_look_flipped',
    'ServerTableEngineTurns.scheduleHorseAction',
    'the deeper read overturned the fast answer',
    'V44'
  ),
  /*
   * WHY THE SECOND LOOK DID NOT HAPPEN (2026-09-06).
   *
   * On 2026-09-05 this ledger's own data_unread rule reported
   * `v44_second_look fired 0 times against 2,121,841 decides (0.000%, expects
   * >= 0.100%)`. It caught the dead layer, and then nobody could say WHICH of
   * the five gates in secondLookPlan was closing - the plan returned a bare
   * null. The five reasons want opposite fixes (governor = capacity;
   * no_think_time = the tempo model; small_pot / action_shape = this ledger's
   * 0.1% expectation being wrong), so guessing between them is how a layer
   * stays dark for a week.
   *
   * The planning gates are checked in order and exactly one receipt fires
   * per declined plan. An eligible plan can still be cancelled, fail or lose
   * its original read view, so those declines plus completed second looks do
   * not partition all decisions. No expectation is declared on any of
   * them - a decline is an observation, not a promise.
   */
  receipt(
    'v44_declined_not_facing_bet',
    'ServerTableEngineTurns.secondLookPlan',
    'no second look: the horse was not facing a bet, so there was no close call to re-read',
    'V44'
  ),
  receipt(
    'v44_declined_small_pot',
    'ServerTableEngineTurns.secondLookPlan',
    'no second look: the pot was under 20bb and not worth the deeper sample',
    'V44'
  ),
  receipt(
    'v44_declined_action_shape',
    'ServerTableEngineTurns.secondLookPlan',
    'no second look: the fast answer was a bet or raise, which the equity sample does not decide',
    'V44'
  ),
  receipt(
    'v44_declined_no_think_time',
    'ServerTableEngineTurns.secondLookPlan',
    'no second look: under 1500ms of the turn clock left (less the engine margin) when the fast answer arrived. Budgeted from the turn clock since 2026-10-16; a high count here is the worker queue eating the clock, which is capacity. (The governor gate, v44_declined_governor, was retired the same day: the worker always decides at scale 1)',
    'V44'
  ),
  /*
   * THE ACTION WAITS FOR THE DEEPER READ (2026-10-16). 96% of the deep looks
   * started on 2026-10-16 never acted because the think timer fired before
   * the answer came back. The action now waits for it inside the turn clock.
   * `awaited` counts actions that outlived their chosen think time to wait;
   * `hold_expired` counts the ones whose deep answer still did not arrive by
   * the clock budget, so the fast answer acted.
   */
  receipt(
    'v44_second_look_awaited',
    'ServerTableEngineTurns.scheduleHorseAction',
    'the chosen think time ended with the second look still out, so the action waited for it inside the turn clock',
    'V44'
  ),
  receipt(
    'v44_second_look_hold_expired',
    'ServerTableEngineTurns.scheduleHorseAction',
    'the second look did not land inside the turn-clock budget; the fast answer acted. A count here is worker capacity',
    'V44'
  ),
  /*
   * ONE FLOOR, ONE READ (2026-10-16). Every completed hand reaches every
   * decision-worker shard; the shards that do not own its table learn it
   * (horseDecision/mindMirror.ts). learned / duplicate / nothing_to_learn /
   * refused from the worker; shed (the client's bound) and unavailable (the
   * job failed or expired) from the client.
   */
  receipt(
    'horse_continuation_*',
    'HorseLogic premium 3-bet, terminal flop and call-side barrel budget',
    'real-card value raise, funded short-stack flop wager or next-street call budget; no holdings or player identifiers',
    'V50'
  ),
  receipt(
    'horse_observer_*',
    'HorseDecisionWorkerRuntime',
    'individual public-read admission, original-participant completion learning, unscoped-profile refusal and explicit missing-context/cutoff/capacity gaps; counters alone never prove independent fleet coverage or strategy qualification',
    'V45'
  ),
  receipt(
    'horse_opponent_memory_*',
    'HorseDecisionWorkerRuntime durable profile import',
    'authoritative public-action snapshot applied or refused; no player identifiers or cards leave the worker',
    'V50'
  ),
  {
    ...receipt(
      'horse_pooled_public_bootstrap_*',
      'HorseDecisionWorkerRuntime startup public-profile hydration',
      'boot-only observation: loaded means a finite saved public-profile batch was read, unavailable means the read failed or exceeded its bounds, and refused means cache admission rejected the batch; none proves decision consumption, independent history, complete fleet coverage or activation',
      'V50'
    ),
    cadence: 'boot',
  },
  receipt(
    'horse_mind_mirror_*',
    'LiveHorseDecisionWorkerPool.observeCompletedHand',
    'a bounded cross-shard completion delivery was shed or unavailable; a delivered mirror learns only for the original individual participants registered on that worker and never authorizes pooled reads',
    'V50'
  ),
  receipt(
    'v48_gto_deviation',
    'HorseLogic (V48) via HorsePersona.followsSolver',
    'a horse declined the solver consult on this spot; needs a persona with gtoAdherence under 1',
    'V48'
  ),
  receipt(
    'v48_straddle_enrolled',
    'ServerTableEngineDealing (V48) via HorsePersona.wantsStraddle',
    'a horse posted a VOLUNTARY straddle; straddle-enabled tables only',
    'V48'
  ),
  // No floor: the spot (committed, river, one pair, clearing the call bar)
  // is rare by construction; silence on a quiet day is not a dead layer.
  receipt(
    'small_pot_near_nut_value_flat_exception',
    'HorseLogic PLO6 final paired-board flat branch',
    'private original value-branch legal raise retained without intervening action changes below the unchanged fold threshold; accepted execution remains separate',
    'Small-pot near-nut value'
  ),
  receipt(
    'small_pot_near_nut_value_applied',
    'HorseLogic decideInternal after wager_rules',
    'the near-nut candidate chose a value raise, or its PLO6 flat exception kept an in-domain raise, and that exact raise reached the final action',
    'Small-pot near-nut value'
  ),
  receipt(
    'small_pot_near_nut_value_considered',
    'HorseLogic decideInternal after wager_rules',
    'in domain, the original value gate already raised and the candidate changed nothing',
    'Small-pot near-nut value'
  ),
  receipt(
    'small_pot_near_nut_value_superseded',
    'HorseLogic decideInternal after wager_rules',
    'the near-nut candidate chose a value raise and a later owner replaced it',
    'Small-pot near-nut value'
  ),
  receipt(
    'committed_stack_priced_in_seen',
    'HorsePreflop via HorseLogic (committedStackPricedIn)',
    'default-off committedStackPricedIn: a tournament multiway all-in fold of a committed or token-priced stack became a call because the priced-in guard was no longer switched off for that branch; an occurrence counter with no floor, named *_seen (the study spots are rare, but the 2bb-behind case is common at short tournament stacks: the 4bb league card diverged in 2,405 of 6,000 pairs)',
    'CommitPrice'
  ),
  receipt(
    'holdem_persona_postflop_trap_seen',
    'HorseLogic V87 flop check-trap (holdemPersonaPostflop)',
    "default-off holdemPersonaPostflop: the out-of-position flop check-trap into a stabber was taken with the persona's trap threshold in force.",
    'PersonaPostflop'
  ),
  receipt(
    'holdem_persona_postflop_stab_seen',
    'HorseLogic V87 turn takeaway (holdemPersonaPostflop)',
    "default-off holdemPersonaPostflop: the turn takeaway (a stab at a capped checked range) was taken with the archetype's stab scale in force.",
    'PersonaPostflop'
  ),
  receipt(
    'holdem_persona_postflop_cbet_seen',
    'HorseLogic V87 dry-board range c-bet (holdemPersonaPostflop)',
    "default-off holdemPersonaPostflop: the dry-board range c-bet branch was entered with the persona's c-bet scale in force; an occurrence counter with no floor, named *_seen (a scale below 1 that kept the branch out is not counted)",
    'PersonaPostflop'
  ),
  receipt(
    'holdem_persona_postflop_check_raise_seen',
    'HorseLogic V87 flop check-raise into a stabber (holdemPersonaPostflop)',
    "default-off holdemPersonaPostflop: the flop check-raise into a high-frequency stabber was made with the persona's trap threshold in force; an occurrence counter with no floor, named *_seen",
    'PersonaPostflop'
  ),
  receipt(
    'tournament_utility_stack_scaled_margin_seen',
    'HorseLogic -> HorseTournamentUtility (tournamentUtilityStackScaledMargin)',
    'default-off tournamentUtilityStackScaledMargin: a tournament decision was selected by the utility comparison with the stack-scaled equity margin in force; an occurrence counter with no floor, named *_seen (how often the margin changed the selection shows in phase7_utility_override)',
    'Phase7'
  ),
  receipt(
    'holdem_persona_3bet_bluff_eligible_seen',
    'HorsePreflop via HorseLogic (holdemPersonaReRaiseMix)',
    "default-off holdemPersonaReRaiseMix: a no-limit hold'em 3-bet bluff decision (facing one open, no caller) reached its mix comparison with the persona present; an occurrence counter with no floor, named *_seen",
    'PersonaReRaise'
  ),
  receipt(
    'holdem_persona_3bet_bluff_changed_seen',
    'HorsePreflop via HorseLogic (holdemPersonaReRaiseMix)',
    'default-off holdemPersonaReRaiseMix: the persona-scaled 3-bet bluff comparison gave a different answer from the unscaled draw it replaced (either direction; the fold-equity test still follows); named *_seen',
    'PersonaReRaise'
  ),
  receipt(
    'holdem_persona_squeeze_bluff_eligible_seen',
    'HorsePreflop via HorseLogic (holdemPersonaReRaiseMix)',
    "default-off holdemPersonaReRaiseMix: a no-limit hold'em squeeze bluff decision (a raise and one or more callers; the V7 squeeze site or the cash chart block) reached its mix comparison with the persona present; named *_seen",
    'PersonaReRaise'
  ),
  receipt(
    'holdem_persona_squeeze_bluff_changed_seen',
    'HorsePreflop via HorseLogic (holdemPersonaReRaiseMix)',
    'default-off holdemPersonaReRaiseMix: the persona-scaled squeeze bluff comparison gave a different answer from the unscaled draw it replaced (either direction); named *_seen',
    'PersonaReRaise'
  ),
  receipt(
    'holdem_persona_3bet_bluff_capped_seen',
    'HorsePreflop via HorseLogic (holdemPersonaReRaiseMix)',
    'default-off holdemPersonaReRaiseMix: a 3-bet bluff comparison whose probability times the Horse scale passed 1 and was held at 1; this counts the capped Horse only, not the frequency a below-average Horse loses at the same high probability (the probe measures that); named *_seen',
    'PersonaReRaise'
  ),
  receipt(
    'holdem_persona_squeeze_bluff_capped_seen',
    'HorsePreflop via HorseLogic (holdemPersonaReRaiseMix)',
    'default-off holdemPersonaReRaiseMix: a squeeze bluff comparison whose probability times the Horse scale passed 1 and was held at 1; named *_seen',
    'PersonaReRaise'
  ),
  receipt(
    'holdem_persona_scale_held_by_style_seen',
    'HorsePreflop via HorseLogic (holdemPersonaReRaiseMix)',
    'default-off holdemPersonaReRaiseMix: a Horse with a scale above 1 met a persona comparison against a raiser the opponent-style read classifies as tight, and its scale was held at 1 (the persona may lower a bluff there, never raise it), whatever the state of the style options; needs the read to be available; named *_seen',
    'PersonaReRaise'
  ),
  receipt(
    'holdem_persona_hand_identity_fallback_seen',
    'HorseLogic (holdemPersonaReRaiseMix)',
    'default-off holdemPersonaReRaiseMix: the persona field was built for a decision whose caller supplied no hand (no opts.mindPlanContext.hand: table id and allocated hand number), so its units came from the public-state fallback, which is not deterministic per hand; expected to be zero on the live worker path and in the league card and the probe; named *_seen',
    'PersonaReRaise'
  ),
  receipt(
    'holdem_persona_open_shift_seen',
    'HorseLogic (holdemPersonaPreflop)',
    "default-off holdemPersonaPreflop: a no-limit hold'em cash open (or isolation over limpers) decision deeper than 50bb had its seat's opening share moved by the Hold'em archetype's points; an occurrence counter with no floor, named *_seen",
    'PersonaPreflop'
  ),
  receipt(
    'holdem_persona_continue_shift_seen',
    'HorseLogic (holdemPersonaPreflop)',
    "default-off holdemPersonaPreflop: a no-limit hold'em cash decision facing one open deeper than 50bb had its continue share moved by the Hold'em archetype's points; named *_seen",
    'PersonaPreflop'
  ),
  receipt(
    'holdem_persona_floor_held_seen',
    'HorseLogic (holdemPersonaPreflop)',
    'default-off holdemPersonaPreflop: the table has a VPIP floor and the archetype shift was negative, so the narrowing was withheld (the persona never pushes a Horse toward the floor); named *_seen',
    'PersonaPreflop'
  ),
  receipt(
    'holdem_persona_nit_punish_seen',
    'HorseLogic (holdemPersonaPreflop)',
    'default-off holdemPersonaPreflop: a Nit Hunter faced a raiser read credibly wide or a limper read credibly loose, and its range shift became +2 open / 0 continue; named *_seen',
    'PersonaPreflop'
  ),
  receipt(
    'hu_bb_defends_to_price',
    'HorsePreflop via HorseLogic (huBbDefendsToPrice)',
    'default-off huBbDefendsToPrice: heads-up big blind facing the only open called a hand the V11 heads-up bars folded, because its realised equity against the opener range covered the price',
    'HuBbPrice'
  ),
  receipt(
    'hu_bb_defends_unread_to_price',
    'HorsePreflop via HorseLogic (huBbDefendsUnreadToPrice)',
    'default-off huBbDefendsUnreadToPrice: the heads-up big blind facing the only open from an unread opener called a hand its bars folded, because its equity against the reference open width at a 0.7 realisation covered the price; counted only when the call is still the final decision',
    'HuDefence'
  ),
  receipt(
    'hu_opener_defends_to_price',
    'HorsePreflop via HorseLogic (huOpenerDefendsToPrice)',
    'default-off huOpenerDefendsToPrice: the heads-up opener facing one 3-bet called a hand its bars folded, because its realised equity against the 3-bettor range covered the price',
    'HuDefence'
  ),
  receipt(
    'hu_limp_defends_to_price',
    'HorsePreflop via HorseLogic (huLimpDefendsToPrice)',
    'default-off huLimpDefendsToPrice: the heads-up small blind that limped and faced one raise called a hand its bars folded, because its realised equity against the raiser range covered the price',
    'HuDefence'
  ),
  receipt(
    'aof_closing_seat_nash_call_seen',
    'HorseLogic (aofClosingSeatNashCall)',
    'default-off aofClosingSeatNashCall: an All-In-Or-Fold closing seat facing a lone all-in at 12 big blinds or less was answered by the Nash caller table; occurrence counter, named *_seen',
    'AofClosingSeat'
  ),
  receipt(
    'nash_call_vs_jam',
    'HorseLogic (nashCallVsJam)',
    "nashCallVsJam: a no-limit hold'em seat facing a lone open-jam at <= 20bb called or folded from the Nash push/fold V2 caller table",
    'NashV2'
  ),
  receipt(
    'pay_jump_push_fold_seen',
    'HorseLogic (payJumpBubbleFactor)',
    "nashPushFoldIcm on (default OFF): a no-limit hold'em tournament short stack with a pay jump live (in the money, hand for hand or near the bubble; not a satellite, PKO or mystery bounty; payout weight above zero) priced its folded-to jam or its call against a lone jam at its own bubble factor (moved toward 1 by prize / (prize + bounty)) instead of chip EV; hand 59441335; docs/changelog/2026-11-15-short-stack-shoves-price-the-payouts.md",
    'NashV2'
  ),
  receipt(
    'barrel_continuation_outlook_applied',
    'HorseLogic V7 river barrel continuation',
    'default-off barrelContinuationOutlook: the carried turn outlook changed the river continuation choice on the same draw and it reached the final action',
    'Barrel continuation outlook'
  ),
  receipt(
    'barrel_continuation_outlook_considered',
    'HorseLogic V7 river barrel continuation',
    'default-off barrelContinuationOutlook: the carried turn outlook was read and the same choice stood',
    'Barrel continuation outlook'
  ),
  receipt(
    'barrel_continuation_outlook_superseded',
    'HorseLogic decideInternal reference node',
    'default-off barrelContinuationOutlook: an earlier river owner decided before the V7 continuation, or a later owner replaced the choice the outlook changed',
    'Barrel continuation outlook'
  ),
  receipt(
    'small_pot_near_nut_value_raise',
    'HorseLogic existing value raise band after original safety gates',
    'default-off structural candidate selected a raise instead of random call; selection only, controller acceptance and economic qualification remain separate',
    'Small-pot near-nut value'
  ),
  receipt(
    'v55_omaha_river_trips_flat',
    'HorseLogic committed and ordinary raise branches',
    'opt-in river Omaha weak set/trips flatted after clearing the unchanged call bar',
    'V55'
  ),
  receipt(
    'v74_omaha_semibluff_needs_draw',
    'HorseLogic (V74) semi-bluff raise gate',
    'an Omaha hand with no flush draw, under eight straight outs and no nut low draw was refused the semi-bluff raise',
    'V74'
  ),
  // No floor (2026-11-07): v62RiverBettorPolarity is OPT-IN since
  // 2026-10-30 (#8781; mirror league -3.67 +/- 1.02 bb/100 at 200bb) and no
  // live caller sets it, so zero fires is the default working, as with
  // v16_hu_overlay. A floor here reported it as data_unread every day.
  receipt(
    'v62_river_bettor_polarity',
    "HorseLogic to HorseEval river-polar Hold'em sampler",
    "a river bettor's sampled hand was kept by the V62 size-class likelihood that a human bets it; opt-in (v62RiverBettorPolarity), no floor",
    'V62'
  ),
  receipt(
    'v56_omaha_pressure_range',
    'HorseLogic to HorseEval pressure-conditioned Omaha reservoir',
    'a tier-three public river aggressor range used the direct value stratum for a vulnerable set/trips on one Omaha-high cash board',
    'V56'
  ),
  receipt(
    'v51_river_flat',
    'HorseLogic committed branch (V51)',
    'a committed river one-pair hand flatted where it used to jam',
    'V51'
  ),
  // No floor: every V53 receipt is read-gated on a credibly aggressive or
  // over-folding human, so a horse-only hour is silent by design.
  receipt(
    'v53_*',
    'HorseLogic / HorseOpponentExploit pressure on an aggressive human (V53)',
    "a wider 3-bet of a wide opener, a value or semi-bluff raise of a wide bettor, a river bluff into a credible over-folder (scare card or not), or a hold'em solver spot handed to the exploit layer",
    'V53'
  ),
  // No floor: v54RiverBluff is default OFF (2026-10-24), so silence is
  // expected until explicit qualified adoption. Once activated, v54_river_bluff
  // counts the bluffs fired and the skip family says why every other
  // heads-up river spot with air did not bluff.
  receipt(
    'v54_river_bluff',
    'HorseLogic not-facing-a-bet river (V54)',
    'a heads-up river big bet or shove bluff fired with air, blockers and a value story; opt-in (v54RiverBluff)',
    'V54'
  ),
  receipt(
    'v54_river_bluff_skip_*',
    'HorseLogic not-facing-a-bet river (V54)',
    'why a V54 river bluff did not fire: domain, tournament_context, multiway, multiboard, all_in, showdown_value, station, no_story, uncapped, no_blocker, short_stack, icm, illegal, frequency; opt-in (v54RiverBluff)',
    'V54'
  ),
  // No floor: fires on every qualified flop or turn candidate.
  receipt(
    'ft_bluff_baseline_*',
    'HorseLogic not-facing-a-bet flop/turn (HorseFlopTurnBluffRange)',
    'the baseline flop/turn bluff decided a qualified candidate: <line>_<selection> (a bet: cbet, barrel, delayed, probe or stab with strongDraw, pairDraw, weakDraw, backdoor, overcards or blocker), check (it checked at the class frequency) or illegal; skip_multiway, skip_cannot_respond and skip_no_story say why a flop or turn was left to the layers below',
    'Flop/turn bluff baseline'
  ),
  receipt(
    'ft_semibluff_raise_*',
    'HorseLogic facing-a-bet flop/turn (HorseFlopTurnBluffRange)',
    'the baseline semi-bluff raise decided a qualified draw facing a bet: strongDraw, pairDraw or weakDraw (a raise), call_or_fold (the draw did not raise and the call/fold layers priced it); skip_<reason> says why a draw was left to the layers below',
    'Flop/turn bluff baseline'
  ),
  // No floor: fires on every heads-up river with air and a story.
  receipt(
    'river_bluff_baseline_*',
    'HorseLogic not-facing-a-bet river (HorseRiverBluffRange)',
    'the baseline river bluff decided a qualified candidate: junk, missedDraw, blocker, blockerAndDraw or freeroll (a bet of that selection; freeroll is the hi-lo nut low with no high), check (the candidate checked at the balanced frequency) or illegal (the size could not be legalized); bet_<type> and check_<type> (fixedLimit, shortDeck, bombPot, multiBoard) mark the same decision in a game type #9803 excluded; skip_multiway, skip_cannot_respond and skip_no_story say why a river with no bet to face was left to the layers below; skip_low_giveaway is a hi-lo air hand checked because the opponent likely holds a low',
    'River bluff baseline'
  ),
  // No floor: fires only on multiway rivers with a blocker and a story.
  receipt(
    'river_bluff_multiway_*',
    'HorseLogic not-facing-a-bet river (HorseMultiwayRiverBluff)',
    'the multiway river bluff decided a qualified candidate: evaluated (eligible: air, nut blocker, story), selected_3way / selected_4way (a bluff bet), check (checked at the multiway frequency) or illegal (the size could not be legalized); skip_too_many, skip_cannot_respond, skip_no_blocker and skip_no_story say why a multiway river with no bet to face was left to the layers below',
    'River bluff multiway'
  ),
  receipt(
    'river_lead_*',
    'HorseLogic not-facing-a-bet river (HorseRiverBluffRange, V11 gate)',
    'out-of-position river leads into the turn bettor: bluff_leadDraw / bluff_leadBlank (a bluff lead on a draw-completing or blank river), skip_station (a candidate checked because the bettor is a credible station), value_pass (the V11 gate let a value hand lead a draw-completing river)',
    'River lead range'
  ),
  // No floor: fires only against a limper HorseMind has seen limp-reraise.
  receipt(
    'limp_reraise_iso_read',
    'HorseLogic.decide (limpReraiseIsoRead)',
    "an unopened no-limit hold'em pot with a limper whose shrunk limp-reraise rate engages the read: the isolation bar rose toward the hands that stand a re-raise and the V10 isolation widen was withdrawn",
    'Limp-reraise read'
  ),
  // No floor: fires only at PLO4 / PLO5 / PLO6 cash tables (omahaEvFoldModel, default on).
  receipt(
    'omaha_ev_fold_model_priced',
    'HorseMind.omahaEvFoldMulOf (omahaEvFoldModel)',
    'the Omaha EV fold model priced one opponent fold for the EV bet engine at a PLO4, PLO5 or PLO6 cash table (one count per opponent priced)',
    'Omaha threshold calibration'
  ),
  // Zero in production by design: readBreakEvenBluff is default off, so a fire means the flag was turned on.
  receipt(
    'break_even_bluff_priced',
    'HorseMind table exploit profile (readBreakEvenBluff)',
    'break-even bluffing priced a bluff against a responder whose postflop read is engaged',
    'Read calibration'
  ),
  // No floor: default-off flag.
  receipt(
    'commit_under_pot',
    'HorseLogic.commitUnderPotCall (commitUnderPot)',
    "a heads-up no-limit hold'em flop or turn fold with less than a pot behind became a call",
    'Commit under the pot'
  ),
  // No floor: fixed-limit tables only (process switch, source default on since 2026-11-15).
  receipt(
    'fixed_limit_bet_not_a_probe_seen',
    'HorseMind.observe (FIXED-LIMIT BETS ARE NEVER PROBES, process switch HorseMind.setFixedLimitBetsAreNeverProbes, source default FIXED_LIMIT_BETS_ARE_NEVER_PROBES_DEFAULT = true since 2026-11-15)',
    'a checked-to postflop bet in a fixed-limit hand was counted without a probe tally (neither ctBets nor ctProbes), so it stays whole in betCheckedTo',
    'FixedLimitAdaptation'
  ),
  // No floor: fixed-limit decisions against a player with a no-limit/pot-limit probe history, with the opt-in option on.
  receipt(
    'fixed_limit_read_probe_discount_withheld',
    'HorseMind.probeAdjusted (A FIXED-LIMIT READ IS NEVER PROBE-DISCOUNTED, F1b: opt-in decide option fixedLimitReadIgnoresProbes, default OFF, with the process switch HorseMind.setFixedLimitBetsAreNeverProbes on)',
    "a fixed-limit decision's opponent read was left whole although the player's pooled no-limit/pot-limit probe share would have discounted his betCheckedTo",
    'FixedLimitAdaptation'
  ),
  // No floor: fixed-limit calls with a player left to act, with the opt-in option on.
  receipt(
    'fixed_limit_call_priced_remaining_action_seen',
    "HorseLogic facing-a-bet call price (fixedLimitCallIsNotACommitment, HorseFixedLimitCallPrice.ts; fixed-limit hold'em cash only)",
    'a fixed-limit call with a live player left to act on an uncapped street was priced above the bare call by the expected further wagers of the street',
    'FixedLimitAdaptation'
  ),
  // No floor: fixed-limit rivers only, with the opt-in option on.
  receipt(
    'fixed_limit_river_strong_hand_lead',
    'HorseLogic reference layer (fixedLimitRiverStrongHandLeads, HorseFixedLimitRiverLead.ts)',
    'a fixed-limit first-to-act river check with a full house or better that few holdings beat became a one-big-bet lead',
    'FixedLimitAdaptation'
  ),
  // No floor: fixed-limit calls only, with the opt-in option on.
  receipt(
    'fixed_limit_call_not_a_commitment_seen',
    "HorseLogic facing-a-bet commitment test (fixedLimitCallIsNotACommitment; fixed-limit hold'em cash only)",
    'a fixed-limit call the stack-to-pot or invested test would have priced as a commitment was priced as the one bet it is',
    'FixedLimitAdaptation'
  ),
  // No floor: fixed-limit hi-lo rivers only, with the opt-in option on.
  receipt(
    'fixed_limit_hilo_low_half_kept_seen',
    'HorseLogic V40 Omaha pressure cap (fixedLimitHiLoLowHalfFloor)',
    'the V40 weak-high cap on a fixed-limit hi-lo river would have clipped the hand below half of its low share and was held at that half',
    'FixedLimitAdaptation'
  ),
  // No floor: fixed-limit preflop only, with the opt-in options on.
  receipt(
    'fixed_limit_priced_first_in',
    'HorsePreflop decidePreflopV7 (fixedLimitPricedPreflop, HorseFixedLimitPreflop.ts)',
    'a fixed-limit first-in decision was taken on the seat reference share (raise, small blind complete, or fold)',
    'FixedLimitAdaptation'
  ),
  receipt(
    'fixed_limit_priced_blind_defence',
    'HorsePreflop decidePreflopV7 (fixedLimitPricedPreflop, HorseFixedLimitPreflop.ts)',
    "a fixed-limit blind's fold facing one raise became a call because its realized equity against the opener's reference range covered the price",
    'FixedLimitAdaptation'
  ),
  receipt(
    'fixed_limit_steal_vs_tight_blinds',
    'HorsePreflop first-in open (fixedLimitStealVsTightBlinds, HorseFixedLimitPreflop.ts)',
    'a fixed-limit first-in open was widened because every player still to act is a read over-folder',
    'FixedLimitAdaptation'
  ),
  // No floor: fixed-limit Omaha decisions only, with the opt-in option on.
  receipt(
    'fixed_limit_omaha_presumption_withheld',
    'HorseMind.opponentRead (fixedLimitOmahaNoPresumption)',
    'a fixed-limit Omaha opponent read was returned without the shared aggressive raise presumption',
    'FixedLimitAdaptation'
  ),
  // No floor: fixed-limit showdowns only, and only with the process switch on.
  receipt(
    'fixed_limit_river_bet_showdown_counted',
    'HorseMind.observeHandComplete (FIXED-LIMIT RIVER BETS ARE SHOWDOWN VALUE EVIDENCE, process switch HorseMind.setFixedLimitRiverBetsAreValueEvidence, source default FIXED_LIMIT_RIVER_BETS_ARE_VALUE_EVIDENCE_DEFAULT = false)',
    'a fixed-limit river bet or raise under 20 big blinds that reached showdown was counted in the V83 big-bet showdown tally (bigBetSD)',
    'FixedLimitAdaptation'
  ),
  // No floor: fires only against an opponent whose checked-to bets include probes.
  receipt(
    'opponent_read_probe_bets_discounted',
    'HorseMind.opponentRead (probeAwareAggression)',
    "an opponent read took the share of that player's checked-to bets that were probes back out of betCheckedTo",
    'Probe-aware aggression'
  ),
  // No floor: fires only when a river opponent is read as calling down.
  receipt(
    'river_fast_calldown_station',
    'HorseLogic not-facing-a-bet river, heads-up baseline site (HorseFastCalldownRead)',
    'the fast call-down read made the heads-up river opponent a station for this decision: his recent river call rate is credibly above the edge',
    'River fast call-down'
  ),
  receipt(
    'river_fast_calldown_station_multiway',
    'HorseLogic not-facing-a-bet river, multiway site (HorseFastCalldownRead)',
    'the fast call-down read made one multiway river opponent a station for this decision',
    'River fast call-down'
  ),
  receipt(
    'river_bluff_hilo_*',
    'HorseLogic not-facing-a-bet river (HorseRiverBluffRange)',
    'a hi-lo river bet with a low possible: freeroll (the nut low with no high) or scoop (air bluffing the whole pot into an unlikely low)',
    'River bluff hi-lo'
  ),
  receipt(
    'combo_draw_pressure_evaluated',
    'HorseLogic facing flop/turn EV menu',
    'a physically strong draw against a public wide-bettor read evaluated permitted pressure raises as well as its call; proposal, not accepted-use proof',
    'Combo draw pressure'
  ),
  receipt(
    'combo_draw_pressure_raise',
    'HorseLogic facing flop/turn EV menu',
    'the chosen legal raise has positive modeled EV above calling at the same executed size; returned proposal, not accepted-use proof',
    'Combo draw pressure'
  ),
  receipt(
    'v46_class_read',
    'HorseHandClasses.handClassRead via HorseLogic (V46)',
    'the hand SHAPE priced a preflop decision; Omaha volume only (the short-deck chart is off by default since 2026-10-05)',
    'V46'
  ),
  receipt(
    'v46_class_never_3bet',
    'HorsePreflop (V46)',
    'a rundown / broadway / dangler flatted where the bars said 3-bet',
    'V46'
  ),
  receipt(
    'v46_class_fold',
    'HorsePreflop (V46)',
    'trips or trash folded: the percentile rated a hand the game rates at zero',
    'V46'
  ),
  receipt(
    'v43_tempo_read',
    'HorseLogic (V43)',
    'a river big bet was priced by its tempo; needs a player with five snap or tank showdowns',
    'V43'
  ),
  receipt(
    'wager_rules_commit_correction',
    'ServerTableEngineTurns (final wager rules at commit)',
    'the fresh commit-time menu turned a passive river-nuts action into a legal raise, or a 90-100% pot wager into full pot',
    'RiverNuts'
  ),
  receipt(
    'v86_*',
    'HorseLogic / HorsePreflop / HorseOmahaBigBetCalls (V86)',
    'V86 PLO4/5/6/8 preflop 3-bet/4-bet/squeeze rundowns & suited Ax, postflop combo-draw pump & SPR discipline, Bully-Breaker LAG counter, multi-board/PLO8 freeroll, and underboat/PLO6 river folds',
    'V86'
  ),
  // No floor: V87 Hold'em overhaul postflop receipts depend on NLH table mix, stack-to-pot geometry, bubble state and observed bully reads.
  receipt(
    'v87_bubble_cover_pressure',
    'HorseLogic not-facing-a-bet turn/river (v87HoldemOverhaul)',
    'a tournament cover stack applied extra turn or river barrel pressure into covered 15-45bb stacks near the bubble or in the money',
    'V87'
  ),
  receipt(
    'v87_bubble_covered_pot_control',
    'HorseLogic not-facing-a-bet turn/river (v87HoldemOverhaul)',
    'a covered 15-45bb medium stack near the bubble or in the money checked back bare one pair on a wet turn or river for pot control',
    'V87'
  ),
  receipt(
    'v87_combo_draw_jam',
    'HorseLogic facing-a-bet flop (v87HoldemOverhaul)',
    'a 12+ clean-out NLH flop combo draw jammed when a standard raise would commit the stack',
    'V87'
  ),
  receipt(
    'v87_combo_draw_raise',
    'HorseLogic facing-a-bet flop (v87HoldemOverhaul)',
    'a 12+ clean-out NLH flop combo draw raised for deterministic semi-bluff pressure outside the baseline HU range owner',
    'V87'
  ),
  receipt(
    'v87_deep_cash_onepair_pot_control',
    'HorseLogic facing-a-bet river (v87HoldemOverhaul)',
    'a 150bb+ deep cash NLH bare one-pair hand folded to multi-street big river barrels without a verified maniac read',
    'V87'
  ),
  receipt(
    'v87_double_board_dead_half_fold',
    'HorseLogic facing-a-bet turn/river (v87HoldemOverhaul)',
    'an NLH double-board hand with one pair or worse on one board and no locked or nutted other board folded to 60%+ pot pressure',
    'V87'
  ),
  receipt(
    'v87_flop_stab_check_raise',
    'HorseLogic facing-a-bet flop (v87HoldemOverhaul)',
    'an OOP strong top-pair or better NLH hand check-raised a measured high-frequency flop stabber',
    'V87'
  ),
  receipt(
    'v87_flop_stab_jam',
    'HorseLogic facing-a-bet flop (v87HoldemOverhaul)',
    'an OOP strong top-pair or better NLH hand check-shoved against a measured high-frequency flop stabber at committing depth',
    'V87'
  ),
  receipt(
    'v87_ip_checkback_trap',
    'HorseLogic not-facing-a-bet flop (v87HoldemOverhaul)',
    'an IP heads-up dry-flop NLH strong made hand mixed a check-back trap',
    'V87'
  ),
  receipt(
    'v87_ip_flop_float',
    'HorseLogic facing-a-bet flop (v87HoldemOverhaul)',
    'an IP NLH gutshot or overcards-plus-backdoor hand floated a small flop stab from a high-stab or turn-give-up opponent',
    'V87'
  ),
  receipt(
    'v87_low_spr_commit',
    'HorseLogic not-facing-a-bet flop/turn (v87HoldemOverhaul)',
    'a low-SPR NLH top-pair, overpair, two-pair-plus or 12+ out flop combo draw bet or jammed to commit',
    'V87'
  ),
  receipt(
    'v87_multiway_wet_air_check',
    'HorseLogic not-facing-a-bet flop (v87HoldemOverhaul)',
    'an NLH preflop aggressor checked multiway on a wet flop with air and fewer than 8 clean outs',
    'V87'
  ),
  receipt(
    'v87_oop_stab_trap',
    'HorseLogic not-facing-a-bet flop (v87HoldemOverhaul)',
    'an OOP strong top-pair-plus or 12+ out combo draw checked into a high-frequency flop stabber to induce a stab',
    'V87'
  ),
  receipt(
    'v87_range_cbet',
    'HorseLogic not-facing-a-bet flop (v87HoldemOverhaul)',
    'a heads-up IP dry-flop NLH preflop aggressor fired a small range continuation bet against a non-station',
    'V87'
  ),
  receipt(
    'v87_river_block_blocker_bluff',
    'HorseLogic not-facing-a-bet river (v87HoldemOverhaul)',
    'an OOP heads-up NLH air hand with nut blockers mixed a small river block-bet bluff against a non-station',
    'V87'
  ),
  receipt(
    'v87_river_block_lag_check',
    'HorseLogic not-facing-a-bet river (v87HoldemOverhaul)',
    'an OOP heads-up fragile one-pair NLH hand checked the river instead of block-betting into an identified LAG bully',
    'V87'
  ),
  receipt(
    'v87_river_block_nut_trap',
    'HorseLogic not-facing-a-bet river (v87HoldemOverhaul)',
    'an OOP heads-up nutted NLH hand (set or better) mixed a small river block bet to induce a raise',
    'V87'
  ),
  receipt(
    'v87_river_block_raised_one_pair_fold',
    'HorseLogic facing-a-bet river (v87HoldemOverhaul)',
    'an NLH bare one-pair hand whose small river block bet was raised folded instead of paying off',
    'V87'
  ),
  receipt(
    'v87_river_block_trap_reraise',
    'HorseLogic facing-a-bet river (v87HoldemOverhaul)',
    'an NLH nutted hand whose small river block bet was raised 3-bet or jammed for value',
    'V87'
  ),
  receipt(
    'v87_river_blocker_bluff_raise',
    'HorseLogic facing-a-bet river (v87HoldemOverhaul)',
    'a heads-up NLH air hand with strong nut blockers bluff-raised a river bettor with an observed non-station fold read',
    'V87'
  ),
  receipt(
    'token_call_price_scaled',
    'HorseLogic committed-call bar (tokenCallPrice, PLO6-AUDIT-010)',
    'a cash Omaha high call priced under 0.15 of the pot had its stack-off premiums scaled to the price',
    'V89'
  ),
  receipt(
    'token_call_price_river_covered',
    'HorseLogic committed-call bar (tokenCallPrice, PLO6-AUDIT-010)',
    'a river call priced under 0.01 of the pot was made because the counted share of hands beaten covered the price',
    'V89'
  ),
  receipt(
    'omaha_preflop_action_behind',
    'HorseLogic preflop all-in arithmetic (omahaPreflopCallWithActionBehind, PLO6-AUDIT-005)',
    'an Omaha preflop call of 40% of the stack with chips and action behind was sent to the range play, not priced as a final all-in',
    'V90'
  ),
  receipt(
    'holdem_river_full_house_lead_seen',
    'HorseLogic not-facing-a-bet river (holdemRiverFullHouseValue)',
    "a qualifying no-limit hold'em river full house led into the prior aggressor instead of checking at the V11 initiative gate",
    '2026-11-15'
  ),
  receipt(
    'v87_turn_takeaway',
    'HorseLogic not-facing-a-bet turn (v87HoldemOverhaul)',
    'an IP heads-up NLH caller bet the turn after a flop stabber checked and gave up initiative',
    'V87'
  ),

  // TAGS. Every leak tag the review system emits, with its reader.
  ...RETIRED_RECEIPTS,
  ...TAG_CONSUMERS,
];

/** Receipt families: `prefix_*` entries cover every telemetry key sharing the prefix. */
export function ledgerReceiptFor(feature: string): LedgerEntry | undefined {
  const exact = HORSE_DATA_LEDGER.find((e) => e.kind === 'receipt' && e.key === feature);
  if (exact) return exact;
  return HORSE_DATA_LEDGER.find(
    (e) => e.kind === 'receipt' && e.key.endsWith('*') && feature.startsWith(e.key.slice(0, -1))
  );
}

export function ledgerByKind(kind: LedgerKind): LedgerEntry[] {
  return HORSE_DATA_LEDGER.filter((e) => e.kind === kind);
}

/** The row shape horse_data_ledger stores (HorseDataLedgerSync upserts it). */
export interface LedgerRow {
  key: string;
  kind: LedgerKind;
  source: string;
  cadence: LedgerCadence;
  consumer: string;
  note: string;
  ratio_of: string | null;
  min_ratio: number | null;
  day_column: string | null;
  freshness_days: number | null;
  since: string;
}

export function ledgerRows(): LedgerRow[] {
  return HORSE_DATA_LEDGER.map((e) => ({
    key: `${e.kind}:${e.key}`,
    kind: e.kind,
    source: e.source,
    cadence: e.cadence,
    consumer: e.consumer,
    note: e.note,
    ratio_of: e.ratioOf ?? null,
    min_ratio: e.minRatio ?? null,
    day_column: e.dayColumn ?? null,
    freshness_days: e.freshnessDays ?? null,
    since: e.since,
  }));
}

export interface HorseDecisionOptionSnapshot {
  v87HoldemOverhaul?: boolean;
}

export function snapshotOptionFlags(
  opts?: { v87HoldemOverhaul?: boolean } | null
): HorseDecisionOptionSnapshot {
  return {
    v87HoldemOverhaul: opts?.v87HoldemOverhaul !== false,
  };
}
