# A Lightning style read can keep its own evidence (L-016, default off)

Lightning lane, 2026-11-15. Defect L-016 (probe 2026-11-14): the style read pooled Lightning and Classic (table-speed) cash evidence. The Lightning host sends its hands with `publicMemoryDomain {speed:'lightning'}` and `styleMemoryMode 'cash'`; the worker gave the style learner only the mode, and the three style maps in `HorseMind` (`styleAggression`, `styleSizeShown`, `styleHorseReference`) are keyed variant|mode|size and are not swapped by the decision sandbox. The exploit counters, profile counters, pre-repair discount and post-release count the same read uses ARE per domain. Constructed evidence: a Lightning 4x turn check-raise folded 24/24 (styleRaiseRespect) on the Lightning record alone is called 24/24 once the same player's Classic turn raises are learned into the shared map.

## Change (decide option `lightningStyleReadSeparate`, read `=== true`, DEFAULT OFF)

- Learner: `HorseMind.observeHandComplete` takes the hand's speed (new last argument). The worker passes `styleSpeedOf(request)` (the accepted hand's `publicMemoryDomain.speed`, valid domains only). A Lightning hand is filed into the pooled maps exactly as before AND into three Lightning-only maps (`styleAggressionLightning`, `styleSizeShownLightning`, `styleHorseReferenceLightning`, same keys, own cap `STYLE_LIGHTNING_MAX_ROWS`). The pooled maps' contents and eviction order do not change.
- Boot: the exploit hydrator's style rebuild also fills the Lightning-only maps from `hand_history` rows whose `public_memory_domain.speed` is `lightning` (the column is already selected). Rows with no valid domain are pooled only. New failure receipt `style_boot_lightning_failed_seen`.
- Read: `HorseLogic.prepareOriginalReads` adds `lightningStyleReadSeparate` to the decision read options only when the option is true AND `gs.publicMemoryDomain.speed === 'lightning'`. The style read then takes aggression, size buckets and the Horse reference from the Lightning-only maps. Everything else (counters, provenance, carry-over) is unchanged. Receipts `style_lightning_separate_read_seen` and `style_lightning_separate_empty_seen` (no Lightning row where the pooled map held one).

Option off: no read option is added and every decision is byte-identical (law test compares action, amount and RNG state with the Lightning maps empty, filled and contrary). Classic, tournament and domain-less decisions are untouched with it on. It changes a decision only through a style consumer option.

Ledger: flag `lightningStyleReadSeparate`, three receipts, `publicMemoryDomain` state row updated; activation.sql rows; refused league matchup `nlh_style_lightning_separate` (0 of 2,000 pairs diverged six-handed and heads-up, seed 20261115: the league deals no Lightning domain). Law `server/src/lightning/aLightningStyleReadKeepsItsOwnEvidence.law.test.ts`; learner test `HorseMindStyleLightningMaps.test.ts`; boot cases in `HorseExploitHydratorStyle.test.ts`.

## Not done

At the time of this change: no migration and no live switch row (the option is not in `STYLE_SWITCH_OPTIONS`). Since 2026-11-16 it is a registered plain option of the Horse option switch (its follow-up list migration names it); with no row, or an `off` row, it is off. No evaluation in a Lightning harness. Turning it on is a change under `docs/HORSE-DECISION-CHANGE-EVIDENCE.md`.

## Known limits

Independent review of 2026-11-16. All four need an option on; with the options off nothing here applies.

- The durable shown-river record has no speed key. With `lightningStyleReadSeparate` and `styleLongShownMemory` both on, the long shown river merge can bring a Classic showdown into the Lightning read.
- `HorseMind.omahaFacingBetEvReadOf` (option `omahaFacingBetEv`) still reads the pooled size map on a Lightning decision, also with `lightningStyleReadSeparate` on.
- The fold-through frame keeps the original turn owner (`currentPlayerSeat`), so it is close to, but not exactly, the question of the real turn (a rule that reads "it is my turn" stays out on the frame as on the early look). The frame ask also draws its own strength jitter, so a hand within jitter of a bar can still fold early.
- The `style_lightning_separate_*` receipts fire where the read is computed, so they do not fire again when a decision takes the read from its per-decision memo: with the option on they count fresh reads.
