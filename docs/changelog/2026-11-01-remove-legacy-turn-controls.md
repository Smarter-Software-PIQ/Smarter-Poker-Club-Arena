# Remove The Legacy Turn Control Flash

Removed the old compact stopwatch and countdown strip below the hero seat. It was a separate render branch that could appear before the current action display. The seat clock, HUD bank balance, automatic bank behavior and decision handling retain their existing wiring. The pre-action regression test now forbids the retired strip and checks the retained consumers.

Validation and publication evidence are tracked in CHECKPOINT-clock-flash.md.

Bet Pot also preserves the exact pot-sized wager rather than rounding it up to a small-blind slider step. The reported 7,205 pot at 300/600 now produces 7,205 rather than 7,500. Legal minimum/maximum and indivisible wager units remain enforced; multiplier, fractional-preset and slider behavior stay unchanged.
