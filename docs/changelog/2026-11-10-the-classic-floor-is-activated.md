# A Classic rejoin continues the VPIP sitting, and the approved floors go live

Dan approved the nine per-variant floors and the ten-hand grace on 2026-11-10,
explicitly as **product settings, not claims about optimal strategy**: nlh 20,
plo4 30, plo5 50, plo6 50, plo8 30, flo8 25, flh 15, short_deck 20,
pineapple 25, with ten additional dealt hands of grace after the first warning.
Scope stays Classic cash games at 0.50/1.00 and above, humans and horses alike.
Action and Madness are unchanged.

plo8, short_deck and pineapple had **no player reach thirty dealt hands** in the
measured window, so their floors are judgment and are recorded as such in
`ca_classic_vpip_floors.note`. Every value is one `UPDATE` away with no deploy.

## The hole this closes

`fn_nit_sitting_since` read the **open** roster row. A player one hand from the
boot could stand up, sit straight back down, and return with an empty sample and
no warning. That is an escape hatch, and the fix is not a penalty of my
invention: the platform already decides when a return is the same session.

- `cash_player_session.rejoin_window_ms` carries that window, and
  `cash_player_session_window_floor` floors it at 7,200,000 ms.
- The Classic snapshot's `rejoin_window_min` is 120 minutes.
- `fn_cash_session_close` writes a `cash_rejoin_constraints` row valid for
  exactly that long, so a returning player cannot reset their stack basis
  either.
- It is the same two hours as the eviction bar Dan set on 2026-09-05, so a
  player who is actually booted cannot return inside it at all.

The VPIP sitting now uses that same window. A return inside it continues the
sample, the open warning and the hands left in its grace. An absence longer than
it is a genuinely new sitting and starts clean. One existing rule, two uses.

Grace cannot be waited out either: it is counted in **dealt hands** after the
warning (`fn_nit_hands_since`), so a player who sits out spends none and returns
with exactly what they left with.

## Activation, through the maintained path

The first migration installed the machinery and wrote no live row, which left
activation waiting on the next unrelated write to each game. With the values
approved, that wait is gone. For every eligible Classic game this migration
touches the row so `fn_cash_game_floor_from_template` recomputes its promise,
then calls `fn_cash_apply_ruleset` to carry that promise onto the game's tables:
the same two steps any other ruleset change takes. Nothing writes `nit_game` or
`maintain_*` by hand, because a fresh table and a reconciled one must not be
able to disagree.

Each game's result is recorded in `ca_classic_vpip_activations`, and four
post-conditions **abort the whole transaction** rather than half-activate:

| Guard                                | Refuses                                                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `ACTIVATION_INCOMPLETE`              | an eligible game that does not carry the approved floor, window, rolling mode, grace and `vpip_floor_since` |
| `ACTIVATION_TABLES_INCOMPLETE`       | a live table of an eligible game that is not judging                                                        |
| `ACTIVATION_OVERREACH`               | anything outside the approved scope carrying the rolling floor                                              |
| `ACTIVATION_TOUCHED_OTHER_TEMPLATES` | a non-Classic game whose window or grace moved                                                              |

A retired club is skipped: `fn_guard_retired_club_mutation` makes its gameplay
records read-only, and writing to one would be refused. A Diamond cluster's
tables are projected by `fn_poker_diamond_project_cluster`, which
`fn_cash_apply_ruleset` hands off to, so the table-level post-condition is scoped
to non-Diamond clubs while the floor itself is written for every asset. Measured
before writing: 95 eligible games across 9 variants, 69 live tables, every one in
an active chips club.

**Nobody is judged on a hand played before the floor existed.** The trigger sets
`vpip_floor_since` only when it is absent, so plo5 and plo6 keep the instant
their 50 came on in October and every newly floored game starts counting at
activation. With a rolling thirty and a thirty-hand minimum, no seat can even be
warned until it has played thirty dealt hands after this commits.

## The player is told

`fn_cash_vpip_status` already returned the judged figure to the hero's own
tracker; it now also returns `warned`, `grace_hands` and `grace_remaining`, and
`HeroVpipTracker` prints the remaining grace on the felt as
"Hands To Correct Your VPIP". It uses the same label-and-count shape as the hit
and run clock beside it, in the column the tracker already owns, so no approved
artwork changes and the badge is **not** recoloured by whether the player is
passing: badge spec section 25 forbids that and says an eligibility indicator is
built separately. This is that, built separately.

## What was checked, and what was not

`scripts/ci/test-classic-vpip-floor.sh` now runs 25 assertions against a
throwaway Postgres, including the five correctness points Dan named:

- the new `fn_nit_status` shape has exactly one consumer. Nothing else in the
  database references it: no view, no policy, no other function, no dependent
  object, and it is revoked from `anon` and `authenticated` so no client can
  reach it. Its grants are asserted byte-identical before and after the DROP.
- the warning and the remaining grace reach the player (above), pinned in the
  law test.
- a reconnect, a move between tables of the same game, and a restart all keep
  the window, the warning and the grace: all of that state is rows, not engine
  memory.
- leaving and rejoining keeps the sample, the warning and the grace, and the
  grace still expires across it; an absence beyond the re-entry window starts
  clean.
- the stack goes back once, to the right player, in the right club, after the
  hand. This needed **no change**: `fn_cashout_seat_occupancy` keys a durable
  receipt on `occupancy_id` and returns the existing receipt rather than
  crediting twice, its idempotency key is `cashout:occupancy:<id>`, it holds the
  seat, table and profile rows `FOR UPDATE`, it derives the club from
  `tables.club_id`, and the dealing loop only calls it at a hand boundary
  (`mid_hand: false`).

**Honest limitation, unchanged and handed over.** The horse brain reads the new
policy by construction - its floor comes from `tableInfo.maintain_percent_min`
and its own figure from `fn_nit_status`, the function this changed - and
`vpipFloorMul` widens toward the floor from three hands on. That proves WIRING,
not successful adaptation. The measured fleet median on NLH Classic is 17.1
against a 20 floor, and `vpipFloorCallDown`'s own note records that the
multiplier cannot reach a high floor unaided, so horses will be evicted from NLH
Classic until the fleet widens. The approved floor is **not** lowered to
accommodate that. It is a HorseLogic strategy question, it belongs to the
horse-brain lane, and it is not expanded into here.
