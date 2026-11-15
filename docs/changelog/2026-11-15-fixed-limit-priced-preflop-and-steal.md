# Fixed-limit preflop is priced; the steal widens against over-folding blinds (two default-off options)

Fixed-Limit lane W5, 2026-11-15. Diagnosis: agent evidence `fixed-limit-01Gw7aDr/C-ARCHITECTURE.md` (c5), `O-TIGHT-FL-DIAGNOSIS.md` (design 4), `review/R-INDIVIDUAL-REVIEW.md` and `D-FINDINGS-LEDGER.md` Addition 4 (FL-PRE-02). Both DEFAULT OFF; nothing turns them on.

## `HorseDecideOpts.fixedLimitPricedPreflop` (read `=== true`)

Main decides fixed-limit preflop on no-limit percentile bars; price enters only through the fold-rescue guard, which stops at 0.22 while the big blind facing one raise pays 2/9 = 0.2222 (heads-up 0.25). With the option on, fixed limit only (`HorseFixedLimitPreflop.ts`, applied in `decidePreflopV7`):

- First in (no raise, limper or caller) the seat raises the reference share by players behind: flh 13% (7+ behind), 15%, 19%, 24% (hijack), 31% (cutoff), 45% (button), small blind 40% raise and complete to 65%, heads-up button 85%; flo8 13%, 15%, 18%, 22%, 28%, 38%, small blind 30% raise and complete to 60%, heads-up button 70%. The persona's tightness moves a share by at most 5% of itself. A maniac behind keeps its open bar.
- A blind facing exactly one raise (no limper, no caller, raiser not all in): a fold becomes a call when equity against the opener's reference range times the out-of-position realization (flh 0.65, flo8 0.55; calibration to the published defence widths, stated as such) times 0.85 per player behind covers the rake-aware price. 3-bets, 4-bets, caps, cold calls and limped pots keep the old answer; a tournament stack of 20bb or less keeps the old answer; the V46 class fold still folds first.
- The strength order and equity table are generated (`server/scripts/generate-fixed-limit-preflop-tables.ts`, fixed seed, 60,000 flh / 30,000 flo8 trials per cell) into `HorseFixedLimitPreflopTables.ts`.
- FL-PRE-02: under the same option the phase12 pack's round-3 preflop entry rules (open tightened, heads-up open, small blind steal, big blind defended) retain the reference in fixed limit (receipt reason `fixed_limit_priced_retains_<rule>`). Measured on the pack's own quality order (6 dealt, 100bb): the pack's open bar admits 20-24% of flh hands on the button, 12-14% in the cutoff and 5-6% in the hijack (flo8 13%, 12%, 10%), and folds 49-78% of the reference opens; it contradicts every published limit range, so the priced reference takes precedence. The pack's default behaviour is unchanged.

Receipts `fixed_limit_priced_first_in`, `fixed_limit_priced_blind_defence`. Law `AFixedLimitPreflopIsPriced.law.test.ts`.

## `HorseDecideOpts.fixedLimitStealVsTightBlinds` (read `=== true`)

No hold'em or fixed-limit consumer widened a late open against a read over-folder. With the option on, first in from the cutoff, button or small blind (or the heads-up button), when every player still to act has his own over-folder read (`HorseMind.opponentRead`: foldToBet engaged high at the read's 0.9 credibility on at least 15 decayed opportunities, not `presumed`, no preflop statistic engaged wide) and none is all in, the open share widens by up to 15 points, scaled by the weakest read's excess (full at 0.25). Folded players are not players still to act. With the priced option on the widen adds to the reference share (capped 70%, heads-up 95%); with it off the old bar comes down by the strength the same widen spans at the reference share. Receipt `fixed_limit_steal_vs_tight_blinds`. Law `AFixedLimitStealsFromOverFoldingBlinds.law.test.ts`.

## Not done

No evaluation: the league deals no fixed limit (refused matchups `flh_priced_preflop` 103, `flo8_priced_preflop` 128, `flh_steal_vs_tight_blinds` 0, `flo8_steal_vs_tight_blinds` 0 of 300 pairs diverged, none a fixed-limit measurement). The opener's range in the defence is the reference, not the opener's read. No activation route; turning either on is a change under `docs/HORSE-DECISION-CHANGE-EVIDENCE.md`.
