# lightningStyleReadSeparate: authority for the live switch

**State: OFF in source (read `=== true`), switchable, no switch row cited here. Do not switch on from this file.** Evidence NOT MET: mechanism, scope, receipts, law test and off-identity are recorded, and the multi-domain replay on real audited HVH48 Lightning decisions (2026-11-21, scorer `05dac62975c0`) measured 0 changed decisions across 4,136 Lightning nodes (`fixed 0; newlyWrong 0`) with 28.0% empty-map starvation (`176 / 629` Lightning style reads hit `style_lightning_separate_empty_seen`), while 5,641 Classic table control nodes had 0 fires and 0 changes. Keep OFF until Lightning sample volume is dense enough to show a real accuracy gain without starving thin Lightning records.

Written 2026-11-20 from what the repository records (sources named per section); updated 2026-11-21 with the multi-domain HVH48 A+B+D replay measured at `05dac62975c0`.

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
  2. The `style_lightning_separate_*` receipts fire in `styleReadUntimed`, so they count fresh reads (one per opponent per decision when the per-decision style memo `C6` is active).
  - Note: `HorseMind.omahaFacingBetEvReadOf` (used by `omahaFacingBetEv`) now also reads `this.styleSizeShownLightning` when `this.decisionReadOptions.lightningStyleReadSeparate === true` (and `this.styleSizeShown` otherwise).

## Receipts

`style_lightning_separate_read_seen`, `style_lightning_separate_empty_seen`, `style_boot_lightning_failed_seen` (`HorseDataLedger.ts`, source `'HorseMind (lightningStyleReadSeparate)'` / `'HorseExploitHydrator'`); ledger flag `lightningStyleReadSeparate`.

## Tests

- `server/src/lightning/aLightningStyleReadKeepsItsOwnEvidence.law.test.ts` (law test `L-016`, registered in `docs/laws.d/server-src-lightning-aLightningStyleReadKeepsItsOwnEvidence.md`: learner files Lightning hands into both maps and Classic into pooled only; pooled maps are byte-identical with or without speed; option off is byte-identical whatever the Lightning maps hold; option on reads only Lightning evidence and folds 24/24 on the turn check-raise spot; empty receipt fires when Lightning map has no row where pooled has one; Classic and domain-less decisions unchanged).
- `server/src/engine/HorseMindStyleLightningMaps.test.ts` and `server/src/services/HorseExploitHydratorStyle.test.ts`.
- Refused league matchup `nlh_style_lightning_separate` (`server/src/benchmark/HorseLeague.ts` `UNMEASURABLE_MATCHUPS`: the league deals no Lightning domain; 0 of 2,000 pairs diverged six-handed and heads-up on seed 20261115).

## Evidence rows

- Mechanism, scope, visibility (receipts), law and unit tests, off-identity: MET (sections above).
- Paired Lightning evaluation: NOT RUN (in the paired evaluation harness every hand is Lightning, so no Classic hands are mixed into the in-process maps during a single-format cell).
- Replay on real audited decisions (README.md, "Replay bar"): RUN 2026-11-21 (`05dac62975c0`, with `publicMemoryDomain` propagation + isolated `HorseMindSandbox.styleMaps` over the 76,098 retained `has_human` `hand_history` rows `2026-07-22 .. 2026-11-20 05:59:33Z`, containing 6,147 Lightning and 26,574 Classic `public_memory_domain` hands, against `prod-switch-20261121T1500Z.json`):
  - **Pooled HVH48 Lightning (Sets A+B+D, 4,136 Lightning nodes, 0 arm errors):** `changed = 0`, `fixed = 0`, `newlyWrong = 0`, base fidelity `0.8441`; `style_lightning_separate_read_seen = 629` (15.2%), non-empty `453` (72.0%), `style_lightning_separate_empty_seen = 176` (28.0%).
    - Set A (PLO5 Lightning, 700 hands / 3,280 nodes; 161/161 players cross-domain): `read_seen = 159`, non-empty `123` (77.4%), `empty_seen = 36` (22.6%), `changed = 0`.
    - Set D (NLH cash, 107 Lightning hands / 551 Lightning nodes + 287 Classic hands / 2,183 Classic nodes): Lightning `read_seen = 431`, non-empty `301` (69.8%), `empty_seen = 130` (30.2%), `changed = 0`; Classic control `0` fires, `0` changes (byte-identical).
    - Set B (PLO4/PLO5 cash, 159 Lightning hands / 305 Lightning nodes + 1,089 Classic hands / 3,458 Classic nodes): Lightning `read_seen = 39`, non-empty `29` (74.4%), `empty_seen = 10` (25.6%), `changed = 0`; Classic control `0` fires, `0` changes (byte-identical).
  - **Classic table control (5,641 nodes = 2,183 Set D + 3,458 Set B):** `0` fires, `0` changes (byte-identical; scorer refused both table subsets as inert arm as expected).
- Value against people in production (how often a player's Classic and Lightning postflop aggression records differ enough to flip a live Lightning decision): NOT MET (`0 / 4,136` real HVH48 Lightning decisions changed; `28.0%` empty-map rate `176 / 629` where Lightning-only maps lacked a row that pooled maps held).

## What is still owed before this file may say the evidence is met

1. A future multi-domain replay on a denser Lightning `hand_history` window demonstrating positive accuracy gain (`fixed > newlyWrong`, `changed > 0`) without starving thin Lightning samples (`style_lightning_separate_empty_seen` rate materially reduced from the 28.0% measured on 2026-11-21).
2. An explicit owner or lane-lead order to activate recorded verbatim in "The order it rests on", plus a live post-activation check and rollback trigger.

## What the activation row must contain

`option = 'lightningStyleReadSeparate'`, `state = 'on'`, note `authority: lightningStyleReadSeparate docs/horse-option-authority.d/lightningStyleReadSeparate.md sha256 <the sha256 of this file as merged>`, written by `fn_ca_horse_option_switch_set`. Not before the items above are recorded here.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 4136; unjudged 0; set HVH48 A+B+D Lightning pooled (memory as of decision); scorer 05dac62975c0; source placed verdict-only; arm sep vs off; replayed 4136 of 4136
- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 3280; unjudged 0; set HVH48 A PLO5 Lightning (memory as of decision); scorer 05dac62975c0; source placed verdict-only; arm sep vs off; replayed 3280 of 3280
- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 551; unjudged 0; set HVH48 D NLH cash (memory as of decision) [Lightning only]; scorer 05dac62975c0; source placed verdict-only; arm sep vs off; replayed 551 of 551
- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 305; unjudged 0; set HVH48 B PLO4/PLO5 cash (memory as of decision) [Lightning only]; scorer 05dac62975c0; source placed verdict-only; arm sep vs off; replayed 305 of 305

## Rollback

If enabled, set `lightningStyleReadSeparate` to `off` via the `horse-option-switch` CLI (`fn_ca_horse_option_switch_set('lightningStyleReadSeparate', 'off', '<actor>', '<reason>')`) to restore the base brain within ~30s; zero data migration needed.
