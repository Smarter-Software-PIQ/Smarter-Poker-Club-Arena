# 2026-10-31 — the league's losing layers are off, and every inert card measures or says why

Source: the Club Arena daily horse audit for 2026-10-30 (horse*daily_audit,
findings `league_layer_negative_pooled` x2, `league_matchup_inert` x5, and the
analysis note that `v16_ratio_rescale` was on no card so its default rule could
not be evaluated). Every number below was read from production
(`horse_league_results`, `horse_brain_telemetry`, `horse_tuner*\*`,
`horse_self_tune_log`, `profiles`) with read-only SELECTs, or measured locally
on main 18dd7c6ab with `runMatchup`.

## Shipped

### 1. The PLO6 cash half of the V24 price defense is off for every horse

- `plo6_v24_price` pooled **-2.34 +/- 1.12 bb/100** over the 7 runs to
  2026-10-30 (84,000 hands). Over longer windows: -0.20 +/- 0.42 over the 42
  runs before 2026-10-17, +0.27 +/- 1.14 over 2026-10-17..22, and
  **-2.41 +/- 0.98 over the 9 runs since 2026-10-23**. In the same nights
  `plo4_v24_price` went the other way: -0.61 +/- 0.36 before 10-17,
  **+3.43 +/- 0.89 since 10-23**.
- What flipped it: the layer's own arithmetic changed once in the window -
  #8223 (merged 2026-10-26) made its call odds rake-aware, which SHRINKS the
  relief - but the negative run began on the 2026-10-23 row, before that. The
  flip lines up instead with the opponent-read work that changed what PLO
  preflop calls face: #7683 (2026-10-22, read maniacs and call them off by
  equity), #7838 (2026-10-23, durable game-specific reads, premium raises,
  continuation), then the V53 PLO pressure series from 2026-10-25. Each run's
  stderr is ~2.9, so nine nights cannot attribute the flip to one of those;
  they do say that in PLO6 (the most compressed equities) the extra
  big-blind relief now loses while in PLO4 it wins.
- `HorseLogic.v24PloDefenseOn(option, variant, tournament)`: absent the
  option, PLO6 CASH plays without it; PLO4, PLO5 and PLO6 tournaments keep it.
  The league deals cash only, and V24 was built for the PLO PKO Dan watched:
  its tournament half (the survival premium scaled by the stack at risk) is
  unmeasured there, not negative, so it is left on. An explicit
  `v24PloDefense` still decides it everywhere, so the plo6-v24 qualification
  (`Plo6V24Qualification.ts`, cash, candidate `v24PloDefense: true`) still
  measures exactly this contrast.
- Behaviour change pinned in `workerRuntime.test.ts`: the PLO6 cash reference
  state with Qs Qh 4c 4d 8s 9c now folds where it called
  2 with the relief (explicit `v24PloDefense: true` still calls 2).
- The card keeps the name and sign: `plo6_v24_price` arm A is
  `{ v24PloDefense: true }`, arm B is today's brain.
- Engine change: activates at the routine daily 04:00 Chicago release.

### 2. tuner_tightness_down was never a live layer, and now cannot become one while it loses

- The tuner\_\* cards measure a CANDIDATE dial move (arm A carries tightness
  x0.9, arm B is today's brain). Production on 2026-10-31:
  `fn_horse_tuner_admitted_classes()` = `{}`, `horse_tuner_league_nudges`
  has **0 rows** (no league-gated nudge has ever been applied), and the 32,944
  observational `horse_self_tune_log` rows since 2026-09-14 all have
  mods_after = mods_before (`fn_record_horse_tuner_update` refuses any
  profile change as `causal_permission_missing`). There is no applied
  tightness-down nudge to unwind.
- Admission (`fn_horse_tuner_admitted_classes`) now also vetoes any direction
  the audit's 7-day window resolves significantly negative, so a 30-day
  average can never admit a move the last week says loses.
- The audit reports a negative tuner card as `tuner_move_refused_by_league`
  (info) with the count of nudges applied in that class over 30 days, and as
  `tuner_refused_move_applied` (critical) only if one reached a horse.

### 3. Inert cards: retired with a reason, or repointed so they measure

- **UNMEASURABLE_MATCHUPS** (HorseLeague.ts) is real now. The 2026-09-27
  migration and the audit text both refer to it, but the runner never wrote
  refusal rows: `horse_league_results` held exactly one hand-written refused
  row per retiree, all dated 2026-09-27. Every league run now upserts one
  `status = 'refused'` row (hands 0, reason, arms) per entry before the first
  hand, so `league_matchup_refused` reports them nightly and
  `league_refusal_went_silent` can see one go quiet. Entries:
  `v16_ratio_rescale`, `v18_exploit_size`, `v31_gto_suit_aware` (moved from
  commented-out source), and `plo4/plo5/plo6_v55_river_trips_flat`.
- **v16_ratio_rescale** is DEFAULT OFF in production (`opts.v16Ratio ===
true`) and still dead by precedence under V38: re-probed 0 of 2,000 pairs at
  seed 20261031. Its refused row says the default-ON rule cannot be evaluated,
  why, and what would change that - where the audit reads.
- **plo4/plo5_v55_river_trips_flat** (default OFF, not live): 0 of 6,000 pairs
  diverged every night 2026-10-27..30; re-probed 0 of 2,000 each. The flag
  still reaches code (HorseOmahaRiverTripsFlat.test.ts), but since the
  2026-10-26 river changes (paired-board fold #8088/#8104, V56 #8067) the
  league never deals the raise-war spot it changes. Retired, ~9 minutes a
  night freed.
- **v53_pressure** (live: 16,934-23,610 V53 barrel fires a day): hold'em V53
  engages only on a read credibly outside the horse envelope, so the mirror is
  unchanged by construction. Probes: mirror 0 of 300, human-calibrated field
  0 of 3,000, maxed aggression dials 1 of 1,500, heads-up 0 of 2,000. It is now
  dealt against the V53 aggressor workload (`V53_PRESSURE_POPULATION_ID`,
  one hero horse, NLH, 12,000 pairs): 48 and 63 of 2,000 pairs diverged at
  seeds 20261031 and 4242. The league harness gained that second opponent
  field (`LeagueOpponentPopulation`; worker boundary accepts it).
- **v18_self_image / v23_river_reads** (live): they fire inside the league
  sandbox (154 and 58 per 8,640 decides) but only scale bluff volume, which
  flips a decision in ~1.5 and ~0.5-1.3 pairs per 1,000. The 2026-10-30
  zeros were sampling (Poisson zeros at ~9 and ~3-8 expected divergent pairs),
  not dead flags - 53 of 58 (v18) and 53 of 59 (v23) nightly rows since
  2026-08-28 carry a stderr. No deal reaches them
  more often (human field, production personas, dials, heads-up all probed).
  Both cards now deal 24,000 pairs (~4 minutes each at production speed).
- `productionStyles` is available on a mirror card (seats play production
  personas) for future cards; no card uses it yet.

### 4. Pooling reads measurements only

`fn_league_pooled` averaged inert rows (0.00 +/- 0.00, floored to 0.01 and
weighted 10,000) into the pool, which pinned `plo4_v53_pressure` at
0.00 +/- 0.01 where its four measured nights pool +1.13 +/- 0.63. It now reads
`status = 'measured'` rows with a positive stderr. No significance on the
2026-10-30 card changes.

## Migration

`20261031200450_the_league_pools_measurements_only_and_the_audit_reads_defau.sql`,
one transaction, bodies rebuilt from the installed ones (md5(prosrc) checked:
fn_league_pooled 655f6831..., fn_horse_tuner_admitted_classes bfc0af1a...,
fn_audit_league_pooled_findings adb0fed6...). Validated in PGlite against
fixture rows before merge.

## Deliberately not changed

- 284 horses still carry a net tightness DECREASE (mean -0.056) from the
  legacy ungated tuner of 2026-08-25..09-13, against 629 with a net increase.
  Those were leak-driven per-horse moves before the league gate existed, not
  the league's uniform x0.9 move, and the tuner's own write path cannot move
  them (tightness_up is not league-admitted either). Recorded, not unwound.
- PLO5 has no V24 card; it keeps the relief by default. PLO6 tournaments
  keep V24 (unmeasured by the cash-only league, not negative).
- v18/v23 still measure horse-vs-horse only.
