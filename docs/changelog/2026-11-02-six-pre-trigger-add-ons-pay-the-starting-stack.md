# Six Pre-Trigger Add-Ons Pay The Starting Stack

The add-on rule (Dan, 2026-11-01: the add-on equals the starting stack, never
more, never less) is enforced at the root by trigger
`zz_addon_pays_the_starting_stack` (20261102005209), which installed in the
2026-11-02 daily window. A trigger never revisits rows written before it
existed. Between the 02:40Z backfill (20261102024023) and that install, the
serving engine's old scheduler spawned six Midway events with an add-on of
twice the start. All six are REGISTERING for Nov 5 with zero registrations.

Migration `20261102102934` sets their `addon_chips` to `starting_chips`,
naming exactly the six ids, re-checking zero registrations, and aborting
unless exactly six rows change. Proved first in a self-aborting transaction
(changed 6, remaining unregistered mismatches 0). From the trigger's install
on, every insert and update is corrected at the source.
