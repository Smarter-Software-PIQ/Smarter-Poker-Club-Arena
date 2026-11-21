# lightningStyleReadSeparate: authority for the live switch

**State: OFF in source (read `=== true`), switchable, no switch row cited here. Do not switch on from this file.** Evidence NOT MET: mechanism, scope, receipts, law test and off-identity are recorded; no paired Lightning evaluation has been run for this option, the replay on real audited decisions was not run, and no live read exists.

Written 2026-11-20 from what the repository records (sources named per section). Nothing was run for this file and no number in it was measured on 2026-11-20.

## What it does

Source: `docs/changelog/2026-11-15-a-lightning-style-read-can-keep-its-own-evidence.md`, `server/src/engine/HorseMind.ts` (`observeHandComplete`, `styleReadUntimed`, `importSizeBuckets`, `importStyleAggression`, `importStyleHorseReference`), `server/src/services/HorseExploitHydrator.ts` (`hydrateStyleBootInputs`), `server/src/engine/HorseLogic.ts` (`prepareOriginalReads`), `server/src/engine/HorseDataLedger.ts` (flag `lightningStyleReadSeparate`).

The Lightning host sends its completed hands with `publicMemoryDomain: { version: 1, speed: 'lightning', ante: 'big_blind' }` and `styleMemoryMode: 'cash'`. Before L-016 (2026-11-15), the style learner's three in-process maps (`styleAggression`, `styleSizeShown`, `styleHorseReference`) were keyed by `variant|mode|size` without `speed`, so a Lightning style read pooled Lightning and Classic (table-speed) cash evidence even though the durable profile counters, pre-repair discount and post-release count `m` are partitioned by domain.

With L-016 in place:

- **Live learner and boot hydrator (always active, additive):** `HorseMind.observeHandComplete` receives `styleSpeedOf(request)` from the worker, and `HorseExploitHydrator` checks `row.public_memory_domain.speed === 'lightning'` at boot. A Lightning hand is filed into the pooled maps exactly as before AND into three Lightning-only maps (`styleAggressionLightning`, `styleSizeShownLightning`, `styleHorseReferenceLightning`, each capped at `STYLE_LIGHTNING_MAX_ROWS`). The pooled maps are byte-identical whether or not the speed is supplied.
- **Read time (gated by `opts.lightningStyleReadSeparate === true`, default OFF):** `HorseLogic.prepareOriginalReads` passes `lightningStyleReadSeparate: true` in the decision read options only when `opts.lightningStyleReadSeparate === true` and `gs.publicMemoryDomain?.speed === 'lightning'`. `HorseMind.styleReadUntimed` then reads `sizeShownMap`, `aggressionMap` and `horseReferenceMap` from the three Lightning-only maps instead of the pooled maps.

Classic, tournament and domain-less decisions are unchanged whether the option is on or off. On a Lightning decision, the option changes an action only when at least one style consumer option (`styleRaiseRespect`, `styleBigBetHonesty`, `styleValueBettorNotManiac`, etc.) is also active.

Default OFF in source: only explicit `true` switches it on; off or unset, every decision and RNG state is byte-identical whatever the Lightning-only maps hold. It is a registered option of the Horse option switch (`server/src/engine/HorseOptionSwitch.ts`: owner `'Lightning'`, scope `'Lightning style read (NLH/PLO4/PLO5)'`; not in `OPTION_SWITCH_OFF_ONLY`).

## The order it rests on

- `HorseMind.ts` H1 (2026-11-13) and `docs/changelog/2026-11-14-the-style-boot-release-start-is-a-fact-not-a-setting.md`: opponent style evidence is kept per format, variant, speed and ante domain.

No owner order to activate `lightningStyleReadSeparate` is recorded in the repository. It was built in the Lightning lane (`L-016`, 2026-11-15) after Probe Q3 (`PROBES.md`).

## What it answers and known limits

Source: `docs/changelog/2026-11-15-a-lightning-style-read-can-keep-its-own-evidence.md` and `server/src/lightning/aLightningStyleReadKeepsItsOwnEvidence.law.test.ts`.

- **Probe Q3 (2026-11-14):** In a 72-hour window of the newest 12,000 `has_human` cash hands, 304 player IDs were seen in Lightning, 357 in Classic table hands, and 220 in both. On constructed evidence (a player passive in Lightning with 1 turn raise in 34 opportunities, but aggressive at Classic tables with 12 turn raises in 40), a Lightning 4x turn check-raise that folded 24 of 24 seeds under `styleRaiseRespect` on the Lightning record alone was called 24 of 24 seeds once the Classic hands pooled in; with `lightningStyleReadSeparate: true`, the Lightning decision reads the Lightning-only map and folds 24 of 24 seeds again.
- **Known limits (recorded in changelog 2026-11-16):**
  1. The durable shown-river record (`horse_exact_profiles.shown_river`) has no speed key; if `lightningStyleReadSeparate` and `styleLongShownMemory` are both on, the long shown-river merge can bring a Classic showdown into the Lightning read.
  2. `HorseMind.omahaFacingBetEvReadOf` (used by `omahaFacingBetEv`) reads `this.styleSizeShown` directly even when `lightningStyleReadSeparate` is on.
  3. The `style_lightning_separate_*` receipts fire in `styleReadUntimed`, so they count fresh reads (one per opponent per decision when the per-decision style memo `C6` is active).

## Receipts

`style_lightning_separate_read_seen`, `style_lightning_separate_empty_seen`, `style_boot_lightning_failed_seen` (`HorseDataLedger.ts`, source `'HorseMind (lightningStyleReadSeparate)'` / `'HorseExploitHydrator'`); ledger flag `lightningStyleReadSeparate`.

## Tests

- `server/src/lightning/aLightningStyleReadKeepsItsOwnEvidence.law.test.ts` (law test `L-016`, registered in `docs/laws.d/server-src-lightning-aLightningStyleReadKeepsItsOwnEvidence.md`: learner files Lightning hands into both maps and Classic into pooled only; pooled maps are byte-identical with or without speed; option off is byte-identical whatever the Lightning maps hold; option on reads only Lightning evidence and folds 24/24 on the turn check-raise spot; empty receipt fires when Lightning map has no row where pooled has one; Classic and domain-less decisions unchanged).
- `server/src/engine/HorseMindStyleLightningMaps.test.ts` and `server/src/services/HorseExploitHydratorStyle.test.ts`.
- Refused league matchup `nlh_style_lightning_separate` (`server/src/benchmark/HorseLeague.ts` `UNMEASURABLE_MATCHUPS`: the league deals no Lightning domain; 0 of 2,000 pairs diverged six-handed and heads-up on seed 20261115).

## Evidence rows

- Mechanism, scope, visibility (receipts), law and unit tests, off-identity: MET (sections above).
- Paired Lightning evaluation: NOT RUN (in the paired evaluation harness every hand is Lightning, so no Classic hands are mixed into the in-process maps during a single-format cell).
- Replay on real audited decisions (README.md, "Replay bar"): NOT RUN.
- Value against people in production (how often a player's Classic and Lightning postflop aggression records differ enough to flip a live Lightning decision): NOT MEASURED.

## What is still owed before this file may say the evidence is met

1. A declared PASS-BAR and a replay on real audited Lightning decisions (with hydrated multi-domain history so pooled and Lightning-only style maps differ where real players played both speeds), off against on, scored by `server/scripts/audited-decision-replay.ts --row` with `newlyWrong <= fixed`.
2. Production measurement of `style_lightning_separate_empty_seen` vs `style_lightning_separate_read_seen` (or an offline replay over the 72-hour `hand_history` boot window) showing that separating the maps improves decision accuracy without starving thin Lightning samples.
3. An explicit owner or lane-lead order to activate recorded verbatim in "The order it rests on", plus a live post-activation check and rollback trigger.

## What the activation row must contain

`option = 'lightningStyleReadSeparate'`, `state = 'on'`, note `authority: lightningStyleReadSeparate docs/horse-option-authority.d/lightningStyleReadSeparate.md sha256 <the sha256 of this file as merged>`, written by `fn_ca_horse_option_switch_set`. Not before the items above are recorded here.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-20 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it)
