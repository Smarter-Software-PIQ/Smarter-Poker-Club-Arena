# Each Horse Switch Row Controls Only Its Own Rule; Two New Default-Off Options

Owner rulings this follows: no blanket rules (2026-11-17 11:49 Chicago: every decision by math, ranges, equity and EV); any new behaviour is a default-off option, byte-identical when off; a live option may change only if production with today's switch rows stays identical.

Fixed (production rows unchanged):

- `omahaOopReraisedPotStrongRange` off now turns its call cell off. The re-raise range rules judged a 4-bet they turn into a call with that rule forced on, so its row did nothing there. With all three rows on (production) the decision is the same as before.
- `omahaPricedPriorsByOpponentKind` (off in production) no longer hands a spot no priced family can price back to the categorical rule it replaces ("fall closed": for example the nut-raise rule deciding PLO4/PLO5 cash turn and river raises). Switched on it now changes only the priors; its earlier league results measured the fall-closed version and no longer stand for it.
- `v58Plo6RiverNuts` off no longer also switches off the V86 PLO6 river big-bet folds. Neither option has a row in production.

New, default off, unevaluated (authority files in `docs/horse-option-authority.d/`; league cards declared, not run; switch registry lists re-asserted by `20261119144324_horse_option_switch_shadow_options.sql`):

- `omahaTournamentsExcludeCategoricalRules`: with the tournament extension on, the PLO4/PLO5 rules classed categorical stay cash-only in tournaments; priced rules and the survival premium keep the extension.
- `holdemRiverFullHouseValueIsPriced`: the qualifying hold'em river full house leads into the prior aggressor when the lead is worth more than the check against his measured river call share and checked-to bet share, instead of a fixed 70%.
