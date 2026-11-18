# The style read live switch reaches every worker

The seven opponent-style options (how a Horse tells a tight or value-heavy player
from a maniac and adjusts) were merged with a runtime state each: off, shadow,
canary or on. Nothing could set that state: every worker read a source that
always answered "absent", and no database table existed. After the next release
the options would still have been stuck at off.

This change adds the missing leg. A migration creates `ca_horse_style_switch`
(one row per option), its audit table, a service-role read
`fn_ca_horse_style_switch_effective` and a service-role write
`fn_ca_horse_style_switch_set` that records every change. The engine's main
thread reads the configuration every 30 seconds and hands it to every decision
worker as a `STYLE_SWITCH_STATE` message; each worker's switch holder validates
it.

Every failure reads as off: nothing delivered, a failed read twice in a row, a
malformed message, an unknown option or state, or a worker that has heard nothing
for 120 seconds. The migration adds no rows, so installing it and releasing this
engine change no Horse decision. Switching an option off takes at most about 90
seconds and needs no release.
