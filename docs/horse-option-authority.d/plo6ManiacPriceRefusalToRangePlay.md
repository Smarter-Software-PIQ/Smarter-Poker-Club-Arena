# plo6ManiacPriceRefusalToRangePlay: authority for the live switch

PLO6 lane option (`PLO6-AUDIT-013`, PR `#10768`, 2026-11-14; switched back to opt-in / default OFF on 2026-11-16, `docs/changelog/2026-11-16-plo6-maniac-price-refusal-goes-opt-in.md`), default OFF in source, read once as `opts.plo6ManiacPriceRefusalToRangePlay === true` (server/src/engine/HorseLogic.ts). It is registered in `server/src/engine/HorseOptionSwitch.ts` with allowed states `off`, `shadow`, `on_shadow`, `on` (no live switch row in `public.ca_horse_style_switch`; runs OFF). Status: built, OFF, Evidence NOT MET. Its Reach row was ruled NOT MET by Hand Analysis on 2026-11-15/2026-11-16 (archived eight-row default-on/opt-in record at `docs/horse-default-on.d/plo6ManiacPriceRefusalToRangePlay.md`), no offline league evaluation has passed on this arm, and no replay on real audited decisions has been scored with `--row`. Missing, in order: scorer-written Replay rows on the corrected replay history (#11556) with `newlyWrong <= fixed`; production or audited reach evidence; an explicit activation order recorded before any switch-on row is written.

## What it does

Code: `server/src/engine/HorseLogic.ts` (V38 `maniacPrice38`, single read `opts.plo6ManiacPriceRefusalToRangePlay === true`).

Six-card Omaha high (`plo6`) cash, preflop: when the raiser faced reads as an observed maniac (`observedManiacRaiser`), is not all in, the call is under 40% of the stack, and there have been two raises or more (or the call is at least 25% of the stack), a refusal by the V38 maniac price arithmetic falls through to the range play instead of folding outright. Calls made by the price arithmetic are unchanged. PLO4, PLO5, hi-lo, hold'em, tournaments, calls of 40% or more of the stack, and all-in raisers are unchanged. Off (absent or `false`): a refusal by the arithmetic folds as before `#10768`. Ledger: `server/src/engine/HorseDataLedger.ts` flag `plo6ManiacPriceRefusalToRangePlay`.

## Receipts

`plo6_maniac_price_refusal_range_play_seen` (first-pass hand-off to range play, denominator `observed_maniac_raiser_seen`) and outcome receipts `plo6_maniac_price_refusal_floored_continued`, `plo6_maniac_price_refusal_floored_folded`, `plo6_maniac_price_refusal_unfloored_continued`, `plo6_maniac_price_refusal_unfloored_folded` (`server/src/engine/HorseDataLedger.ts`).

## Tests

- `server/src/engine/HorsePlo6OpponentReadMatrix.test.ts`: matched node cases on recorded hand `58751512` (`fixtures/horse-plo6-floor-deep-stack-off-58751512.json`), PLO5 exclusion, and default-off / explicit-false fold preservation.

## Evidence rows

Full archived eight-row record: `docs/horse-default-on.d/plo6ManiacPriceRefusalToRangePlay.md` (preserved unchanged as the historical default-on/opt-in evidence record). Nothing was re-run for this authority file.

- Mechanism, Input fidelity, Value (simulated single node 58751512), Scope, Visibility, Limits: recorded as MET in `docs/horse-default-on.d/plo6ManiacPriceRefusalToRangePlay.md` (single node and synthetic opponent read; not a league win-rate evaluation).
- Continuation: NOT APPLICABLE (unfavourable response assumed in the single-node study).
- Reach: NOT MET (Hand Analysis rulings 2026-11-15T06:00:45Z, 14:59:59Z, 16:08:40Z, 17:03:57Z; moved to default OFF on 2026-11-16 when no changed accepted decision was measured in the decision journal window).
- Replay on real audited decisions: NOT MET (see Replay).

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (moved to default OFF / opt-in on 2026-11-16 after Reach was ruled NOT MET; no audited-decision replay with --row has been scored, and any replay must use the corrected history of #11556)
