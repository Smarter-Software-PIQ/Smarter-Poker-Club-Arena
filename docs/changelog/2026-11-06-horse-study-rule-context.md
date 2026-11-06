# Preserve the original game economics in hand studies

The offline hand-study parser now retains the captured asset and fixed-limit bet size in the decision information hash and exact rule context. Missing values stay unknown. This prevents fixed-limit and cash-unit distinctions from disappearing between the original public node and the report.

Tournament studies separately identify two remaining players with one regular paid place. The original stone-bubble stage remains, but this geometry cannot be mistaken for a multi-place payout bubble or treated as proof of an ICM risk premium. Bounties, satellites and the complete payout contract still require their own evidence.

Focused parser and report integration regressions cover persistence, hash changes, missing values and the one-paid-place distinction. This changes offline analysis only; it does not activate or modify Horse strategy.
