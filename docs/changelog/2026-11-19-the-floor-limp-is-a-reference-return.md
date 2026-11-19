# The floor's limp is a reference return: a short hold'em stack is no longer folded on the fallback (2026-11-19)

## What happened

`lightningVpipFloorLimpOnly` was switched on in production at 2026-11-19 18:27:30Z and rolled back at 18:55:37Z. While it was on, `/health` `liveHorseDecision.recoverableRequestErrors` rose from 0 to 8, all `DECIDE_FAST`, all `invalid policy receipt: reference_shape`, the last at 18:38:22.516Z. A refused decision folds the seat on the liveness fallback.

## Cause (proven for the three refusals that reached a real turn)

The hand history holds every liveness fold as an action with origin `horse_fallback`. Between 15:00Z and 19:10Z there are three on all tables, all in the NLH 0.50/1.00 Lightning pool, all the same Horse: hands 60140196 (18:37:27.645Z), 60140303 (18:38:17.466Z) and 60140317 (18:38:22.516Z, the `/health` timestamp to the millisecond). In each the Horse had 8.92 or 6.92 big blinds, sat in a non-blind seat, was folded to, and owed one big blind.

A hold'em stack of 15 big blinds or less that is folded to is answered by the push/fold source, route `chart_open_jam`: jam, check or fold. The pool floor then turned that fold into the limp inside the reference node, after the route had returned. `HorsePhase6Attribution.referenceReturnShape` admitted a call on that route only through the older floor call-down (`vpipFloorCallDown`), which a pool never arms because a pool snapshot carries no table `vpipFloor`. The Horse's own legal limp was refused.

The other five refusals left no action row (a refused early look folds nothing). They fit the same Horse's early looks in the same minutes; only the engine log can show them.

`omahaValueSizeIsUnreadable` (switched on eleven minutes earlier and still on) is not the cause: it sizes a postflop bet or raise, and `reference_shape` exists only in the preflop receipt check. The counter has stayed at 8 since the rollback.

## The table option had the same hole

`vpipFloorLimpOnly` (on since 2026-11-18 20:18:59Z) reaches the call-down admission, but the call-down refuses a call above 15% of the stack, so the one-big-blind limp of a stack under 6.67 big blinds was refused the same way. Six liveness folds on "NLH 0.50/1 Classic Feeder" tables since it came on, none on 2026-11-17: hands 60022420, 60022464, 60033867, 60034175, 60074986, 60075065, three Horses on 5.85 to 6.35 big blinds, folded to, one big blind to call.

## What changed

- `referenceReturnShape` admits exactly the limp the limp-only step could produce (`vpipFloorLimpOnlyShape`): it asks `vpipFloorLimpOnlyStep`, in the reference node's own order (the table option first, else the pool option), whether a fold could become this call. Selection `every`, so nothing is priced: no equity draw, no RNG, no chart replay. Public facts and the request's own options only. With both options off the function returns false and every receipt is checked exactly as before.
- Guard test `aVpipFloorLimpIsAReferenceReturn.guard.test.ts`: the live shape end to end through `HorseLogic.decide` for the pool and for the table (failing before with `reference_shape`), the bounds of the admission, the small blind's completion at cent stakes, and option-off identity (decision, receipt, random stream).
- Law test `AReferenceNodeRuleIsAReferenceReturn.law.test.ts`: every assignment to the proposal inside the reference node is read from `HorseLogic.ts` and must be in the test's ledger, and every rule in the ledger is run over a grid of public states on every named route; whatever it makes of a fold while the route's gates hold must be admitted. A rule added to the reference node without its admission now fails in CI instead of folding Horses in production.

No behaviour of any Horse decision changes. No option changes state. No migration.

## Pool pace during the 28 minutes

Hands per 20 minutes, 40 minutes before against the 28 minutes on: PLO4 0.25/0.50 113.5 to 72.6, PLO4 0.50/1.00 85.0 to 63.3, PLO5 1/2 103.0 to 79.0, NLH 0.25/0.50 67.5 to 50.5, NLH 0.50/1.00 177.5 to 147.2, NLH 1/2 77.0 to 68.3. Horse VPIP went from 25-28% to 43-44% in the PLO pools and from 32-37% to 42-44% in hold'em; the share of Horse hands folded on the early look fell from 72% to 56% (PLO) and the mean hand grew by 8 to 12 seconds as more limped pots saw a flop. In every pool the lower hand rate is what the longer hands alone account for. Details and the proposed pass bar are in the authority file.
