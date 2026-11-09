# The Omaha fold model and break-even bluffing leave decision receipts

**In plain English.** Two horse changes merged on 2026-11-08 had no counter that shows them working at live tables:

- The Omaha fold model (#10104), switched on.
- Break-even bluffing (#10108), switched off.

Each now leaves a receipt in the daily brain counters (`horse_brain_telemetry`), the same way other brain layers prove they are live:

- `omaha_ev_fold_model_priced` counts each time the model prices an opponent's fold at a PLO4, PLO5 or PLO6 cash table. After the release it should be well above zero.
- `break_even_bluff_priced` counts each time break-even bluffing prices a bluff. Its flag is off, so it should read zero in production. Any count means the flag was turned on.

Counting never decides. No strategy, threshold or flag changes, and no hand plays differently.

## What changed

- `server/src/engine/HorseMind.ts`: the two `noteFire` calls.
  - One in `omahaEvFoldMulOf`, where the model returns a price.
  - One in the table exploit profile, where a break-even price is attached.
- `server/src/engine/HorseDataLedger.ts`: both receipts are registered next to the limp-reraise read.

## Tests

- `HorseMindOmahaEvFoldModel.test.ts`: one receipt per opponent priced. None with the option off, in Hold'em or in a tournament.
- `HorseMindBreakEvenBluff.test.ts`: one receipt when a read opponent gets a break-even price. None with the flag off or against an unread opponent.
- `HorseDataLedger.test.ts`: every fired key is registered, and every registered key is fired.
- The neutrality law, the focused suites and the server type check pass.

## V31

`HorseMind.ts` is a boundary of the V31 execution fingerprint. The walk stops there, and its behaviour on recorded states is in the replay digest, which counting does not change. The fingerprint digest is identical before and after this change (checked with `scripts/ci/v31-execution-fingerprint.mjs`).
