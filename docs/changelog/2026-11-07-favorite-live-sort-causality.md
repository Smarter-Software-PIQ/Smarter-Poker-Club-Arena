# Favorite proof respects live sort changes

The production favorite journey now compares relative order among rows whose rendered sort inputs stayed unchanged. A live equal-price event gained four players before the star was saved, legitimately changing the player-count tiebreak and invalidating the old frozen ID-order reference. The selected event and at least one unchanged peer remain required; promoting the favorite still fails.

Focused regression covers that captured transition, simultaneous erroneous promotion, missing or changed selected rows, and disappearing schedule occurrences. Product sorting, favorite persistence and RPC behavior are unchanged.
