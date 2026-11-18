# The style boot release start is a fact, not a setting

The style read discounts the fold-to-bet and river-call figures of cash profiles built before the showdown-memory
repair, and lifts that discount as hands played after the repair accumulate. Counting those hands at boot needed the
time the repair went live, and that time came only from an environment value on the engine host
(`HORSE_STYLE_BOOT_RELEASE_START_MS`). Nobody had set it, and the repository does not manage engine environment, so
the count was never rebuilt: after every restart each cash table-speed profile read as pre-repair for good, and the
two adjustments that need those figures could never engage on it.

The time is a known fact: release 533608409f, the first to carry the repair, started 2026-11-13T08:08:00Z. It is now
the default. The environment value still overrides it, and the word `off` keeps the count unbuilt. A clock before
that time (a replay of an earlier day) has nothing to count and fires no rejection receipt.

No Horse decision changes: the count feeds style options only, and every style option is still off. One more receipt
(`style_boot_inputs_hydrated_seen`) fires at each boot.

## The count is kept per speed and ante rule

A player's profile is kept separately for each speed and ante rule (regular table with no ante, with a big blind
ante, Lightning). The boot count pooled all of a player's hands in a game and table size, so hands played at Lightning
could lift the discount on a regular-table profile that never learned from them. The count is now kept per rule and
applied only to a profile of the same rule; a hand with no rule on record counts nothing. The discount can still lift
later than a full count would, and no longer earlier.
