# omahaBigBetSizeIsPriced: Authority For The Live Switch

Built 2026-11-21 by PLO-OWNER lead-4 lane LEAKS-RULES (freeing `#18` `omahaBigBetIsPotShare`, which remained held in BLANKET-AUDIT-5 D5 because turning it off alone falls back to the 20 BB chip mark). Default OFF (read `=== true`), PLO4/PLO5 cash only, identity-free, public lifetime HUD via `hudStat` (`n / (n + k)` shrinkage). This file does not authorize switching the option on.

## What It Does

1. **Continuous priced aggressor range strength (`applyOmahaBigBetSizeRange`):** In PLO4/PLO5 cash (high-only, single board, turn and river), replaces both the 20 BB chip cliff and the discrete 0.70 pot-share tier step with a continuous `pricedBetStrength` (`pStrong` in `[0.50, 0.94]`) from pot share `frac / (frac + 0.55)`, street/raise count, and the bettor's lifetime public HUD showdown big-bet strength (`sd.strongBig.{t|r}`, `sd.strong.{t|r}`) and bet frequency (`{t|r}.betCk`), while setting `tierByPotShare = true`.
2. **Priced limped-pot bet sizing (`omahaPricedLimpedPotSize`):** In PLO4/PLO5 cash, replaces `#18`'s blanket `max(2 BB, 40% pot)` limped-pot minimum bet floor with an EV comparison (`EV(target) > EV(amt) + 0.02 * pot`) using exact/sampled equity, each live opponent's lifetime public HUD fold-to-bet and raise-vs-bet rates interpolated smoothly by pot share, realization, and rake drag.

Scope: PLO4/PLO5 cash only (table and Lightning). PLO6, PLO8, hold'em, tournaments, multi-board, bomb pots, all-in-or-fold, and fixed-limit are byte-identical. Zero person-vs-Horse check; zero unshown cards.

Receipts: `omaha_priced_big_bet_size_range_applied`, `omaha_priced_big_bet_size_resized`, `omaha_priced_big_bet_size_kept`.

## What Was Measured

- Evidence: NOT MET (built 2026-11-21; unit and law tests pass; no bench or production replay run yet)
- Replay: NOT RUN (as of 2026-11-21 no replay of this option on real audited decisions is recorded)
