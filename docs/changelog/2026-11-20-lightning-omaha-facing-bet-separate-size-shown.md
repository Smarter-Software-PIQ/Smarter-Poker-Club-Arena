# `omahaFacingBetEvReadOf` respects `lightningStyleReadSeparate` (2026-11-20)

Lightning Games lane (`4a7d7dc0-9eb2-4c2a-9318-afaee2c31bf1`). Closes known limit #2 of `L-016` (`docs/changelog/2026-11-15-a-lightning-style-read-can-keep-its-own-evidence.md:24`).

- In `server/src/engine/HorseMind.ts` (`HorseMind.omahaFacingBetEvReadOf`), the river `sizeShown` bucket lookup previously read `this.styleSizeShown` unconditionally, even on a Lightning decision with `lightningStyleReadSeparate: true`. It now selects `this.styleSizeShownLightning` when `this.decisionReadOptions.lightningStyleReadSeparate === true` and `this.styleSizeShown` otherwise, matching `HorseMind.styleReadUntimed`.
- With `lightningStyleReadSeparate` off or unset (its release default), or outside a Lightning decision (where `prepareOriginalReads` never sets `decisionReadOptions.lightningStyleReadSeparate`), `this.styleSizeShown` is read exactly as before.
- Pinned in `server/src/lightning/aLightningStyleReadKeepsItsOwnEvidence.law.test.ts` and updated in `docs/horse-option-authority.d/lightningStyleReadSeparate.md`.
