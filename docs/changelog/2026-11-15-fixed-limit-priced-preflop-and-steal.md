# Fixed-limit preflop is priced; the steal widens against over-folding blinds (two default-off options)

Fixed-Limit lane W5, 2026-11-15. Diagnosis: agent evidence `fixed-limit-01Gw7aDr/C-ARCHITECTURE.md` (c5), `O-TIGHT-FL-DIAGNOSIS.md` (design 4), `review/R-INDIVIDUAL-REVIEW.md` and `D-FINDINGS-LEDGER.md` Addition 4 (FL-PRE-02). Both DEFAULT OFF; nothing turns them on.

## `HorseDecideOpts.fixedLimitPricedPreflop` (read `=== true`)

Main decides fixed-limit preflop on no-limit percentile bars; price enters only through the fold-rescue guard, which stops at 0.22 while the big blind facing one raise pays 2/9 = 0.2222 (heads-up 0.25). With the option on, fixed limit only (`HorseFixedLimitPreflop.ts`, applied in `decidePreflopV7`):

- First in (no raise, limper or caller) the seat raises the reference share by players behind: flh 13% (7+ behind), 15%, 19%, 24% (hijack), 31% (cutoff), 45% (button), small blind 40% raise and complete to 65%, heads-up button 85%; flo8 13%, 15%, 18%, 22%, 28%, 38%, small blind 30% raise and complete to 60%, heads-up button 70%. The persona's tightness moves a share by at most 5% of itself. A maniac behind keeps its open bar.
- A blind facing exactly one raise (no limper, no caller, raiser not all in): a fold becomes a call when equity against the opener's reference range times the out-of-position realization (flh 0.65, flo8 0.55; calibration to the published defence widths, stated as such) times 0.85 per player behind covers its raw pot price, call / (pot + call) (rake is inside that calibration and is not deducted a second time; see the fix below). 3-bets, 4-bets, caps, cold calls and limped pots keep the old answer; a tournament stack of 20bb or less keeps the old answer; the V46 class fold still folds first.
- The strength order and equity table are generated (`server/scripts/generate-fixed-limit-preflop-tables.ts`, fixed seed, 60,000 flh / 30,000 flo8 trials per cell) into `HorseFixedLimitPreflopTables.ts`.
- FL-PRE-02: under the same option the phase12 pack's round-3 preflop first-in entry rules (open tightened, heads-up open, small blind steal) retain the reference in fixed limit (receipt reason `fixed_limit_priced_retains_<rule>`). Measured on the pack's own quality order (6 dealt, 100bb): the pack's open bar admits 20-24% of flh hands on the button, 12-14% in the cutoff and 5-6% in the hijack (flo8 13%, 12%, 10%), and folds 49-78% of the reference opens; it contradicts every published limit range, so the priced reference takes precedence. The pack's default behaviour is unchanged.

Receipts `fixed_limit_priced_first_in`, `fixed_limit_priced_blind_defence`. Law `AFixedLimitPreflopIsPriced.law.test.ts`.

## `HorseDecideOpts.fixedLimitStealVsTightBlinds` (read `=== true`)

No hold'em or fixed-limit consumer widened a late open against a read over-folder. With the option on, first in from the cutoff, button or small blind (or the heads-up button), when every player still to act has his own over-folder read (`HorseMind.opponentRead`: foldToBet engaged high at the read's 0.9 credibility on at least 15 decayed opportunities, not `presumed`, no preflop statistic engaged wide) and none is all in, the open share widens by up to 15 points, scaled by the weakest read's excess (full at 0.25). Folded players are not players still to act. With the priced option on the widen adds to the reference share (capped 70%, heads-up 95%); with it off the old bar comes down by the strength the same widen spans at the reference share. Receipt `fixed_limit_steal_vs_tight_blinds`. Law `AFixedLimitStealsFromOverFoldingBlinds.law.test.ts`.

## Not done

No evaluation: the league deals no fixed limit (refused matchups `flh_priced_preflop` 103, `flo8_priced_preflop` 128, `flh_steal_vs_tight_blinds` 0, `flo8_steal_vs_tight_blinds` 0 of 300 pairs diverged, none a fixed-limit measurement). The opener's range in the defence is the reference, not the opener's read. No activation route; turning either on is a change under `docs/HORSE-DECISION-CHANGE-EVIDENCE.md`.

## Fix (2026-11-15, Fixed-Limit lane, from the R2 replay of 1,845 recorded Horse-only hands)

- The defence never fired at a ring big blind, a flo8 heads-up big blind or a small blind: the verdict was fed `preflopCallOdds`, which divides by one minus the projected deduction (the hand's rake plus the fixed per-hand jackpot fee over the pot after the call). Preflop that pot is 4.5 big blinds, so the fraction is about 0.23 at every Midway fixed-limit stake and the price about 0.29 instead of 0.222, while the realization factors were calibrated at the raw price. The law tables carried no rake, so the laws passed. Now the defence reads the raw pot price; the laws add production-shaped rake and jackpot configuration.
- Under the option the pack's `round3_big_blind_defended` rule was held for the reference; that rule fires only on a reference fold, so holding it turned pack calls into folds (66 recorded flh ring trials). It is no longer held; the three first-in rules still are.

## Live switch (2026-11-15, Fixed-Limit lane)

- Both options are registered in the Horse option switch (release default OFF, owner Fixed-Limit), shipped as the follow-up list migration `20261115212312_horse_option_switch_fixed_limit_preflop.sql`. `fixedLimitStealVsTightBlinds` is off-only by the existing steal hold. Registering changes no decision: with no row every Horse decides as before.
- `docs/horse-default-on.d/fixedLimitPricedPreflop.md` records the eight evidence rows for switching `fixedLimitPricedPreflop` on by a row after review. Value is measured for unfloored cash tables only; floored tables and tournaments are not yet evaluated.
- `HorseOptionSwitchMigrationLists.test.ts` (a) now compares the newest list migration to the registry (the same edit as the Fixed-Limit F1 live-switch head), so a first follow-up does not fail it.

## Cash tables only (2026-11-15, Fixed-Limit lane owner)

- Both options now act at cash tables only. HorseLogic gates the priced first in, the blind defence, the pack precedence and the steal on `isTournamentMode`, the cash/tournament test the rest of HorseLogic uses. A fixed-limit tournament table decides exactly as before with either option on, until a separately evaluated tournament option exists. Reason: the paired evaluation's fixed-limit hold'em six-seat tournament cell against a maniac was significantly negative, 0.15 big bets per 100 hands inside the harm line.
- Law (`AFixedLimitPreflopIsPriced.law.test.ts`, "cash tables only"): at flh and flo8 tournament tables every first-in and big-blind decision with the option on equals off and no W5 receipt fires; on the same spots at cash tables the option still acts.
- Cash decisions are unchanged by the gate (same seeds, both heads, every action identical).
