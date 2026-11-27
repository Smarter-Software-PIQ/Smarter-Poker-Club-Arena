# vpipFloorLimpFoldsToARaise: authority for the live switch

**State: LIVE ON since audit #206, 2026-11-27T16:31:28Z.** Evidence for switching this option on: **Evidence MET for the owner ruling it enforces; chips neutral** (2026-11-27, PLO-OWNER lead-8 lane preflop). The option is not a chips gain and does not claim one: it makes the owner's ruling hold. The rule it enforces (a floor limp, raised, never calls and never re-raises) is proven on real production nodes and on built tables of every floored game; off is byte for byte the decision it was; the cost is nil; the chips grades below are inside noise (the calls it removes neither won nor lost measurably). Default OFF in source (read `=== true`). Nothing in this change switches anything.

## The owner's orders it rests on (verbatim)

- 2026-11-17 14:34 America/Chicago: "Table VPIP must limp fold for a bb. smh nothing else if there vpip drops."
- 2026-11-17 18:38 America/Chicago: "its fine, with a 30 hand grace period, horses should be close to 40% with limp folds in the range. and if they aren't the get booted and replaced with a new horse." (The floor never buys a call of a raise to keep a Horse seated.)

## What was found

`vpipFloorLimpOnly` (on in production since 2026-11-18, audit #73) and `lightningVpipFloorLimpOnly` make the limp (`vpipFloorLimpOnlyStep`) and keep no memory of it. When the pot is then raised, "the unfloored decision stands": the whole preflop brain runs again on a hand it had just folded for one big blind, and it can call or re-raise.

Measured read-only, PLO4/PLO5 cash hands with a person, 2026-11-20 05:00Z to 2026-11-27 05:00Z. The engine marks a floor limp nowhere on the hand (the receipt `vpip_floor_limp_only_limp` is a daily counter; the stored node carries the floor and the window but not the Horse's own figure), so each Horse limp was re-decided at its recorded node with the Horse's own cards and no floor (5 seeds): the unfloored brain folding on all 5 while the live Horse called means the call was the floor's.

| game | table                | floor limps that faced a raise | folded | called | re-raised | called % |
| ---- | -------------------- | ------------------------------ | ------ | ------ | --------- | -------- |
| PLO5 | thirty-hand, 40%     | 2,144                          | 1,837  | 306    | 1         | 14.3%    |
| PLO4 | thirty-hand, 30%     | 63                             | 56     | 7      | 0         | 11.1%    |
| PLO5 | ten-hand, 25% or 40% | 129                            | 124    | 5      | 0         | 3.9%     |
| PLO4 | ten-hand, 25%        | 71                             | 67     | 4      | 0         | 5.6%     |

322 calls and 1 re-raise in seven days; the raise called was typically 4 to 6 big blinds (largest 22); the raiser was a person in 289. With no opponent record the replay folds 286 of the 322; with the raiser's own public record as of the decision loaded (60 of them replayed) 45 of 60 are the live call, by the measured-wide-raiser price (`maniac_pressure_preflop`, `v53_pressure_preflop`, `maniac_call_down`). So the floor was buying a call of a raise at one remove: it put a folded hand in the pot, and the price of a wide raiser then kept it there. Realised result of the 322 calls, relative to folding to the raise (public results only): -0.44 +/- 2.13 big blinds a call (against a person's raise -0.57 +/- 2.33, n 289).

## What it does

With the option on:

1. The limp `vpipFloorLimpOnlyStep` makes leaves the worker with a private mark on its decision (`vpipFloorLimp`), set by the option's frame around `HorseLogic.decide`. The mark exists only with the option on.
2. The table engine (`ServerTableEngineTurns`, `currentHandVpipFloorLimps`, cleared at the deal) and the Lightning hand host (one host is one hand) remember a Horse whose ACCEPTED call carried the mark, and hand it back to that Horse's later decisions of the same hand as `gs.ownVpipFloorLimpThisHand`.
3. A preflop decision of that Horse facing a raise made after the limp (`vpipFloorLimpFacesARaise`: the remembered limp, preflop, chips to call, the Horse's last voluntary action a call before any raise) is a fold, whatever the brain proposed (`vpipFloorLimpFoldsToARaiseStep`): inside the reference, where the floor's own steps act, guarded as a priced preflop refusal, and again at the frame around the decision should a later owner reopen it.

It covers every path that makes the limp with `vpipFloorLimpOnlyStep`: a floored cash table under `vpipFloorLimpOnly`, a ten-hand table when `vpipFloorLimpOnlyTenHandWindow` is on as well, and a Lightning pool under `lightningVpipFloorLimpOnly`. It makes no limp of its own, adds no floor to any game, leaves a limp the unfloored brain chose with the unfloored answer, and does nothing postflop. While `vpipFloorLimpOnlyTenHandWindow` is off the ten-hand tables stay on the old floor (the integrator's exception of 2026-11-18, `docs/horse-option-authority.d/vpipFloorLimpOnlyTenHandWindow.md`), where this option does not act.

The remembered limp is the Horse's own fact about its own action: no card, no opponent fact, never stored with the public node, and outside the policy sampling key (`validatedHorsePolicySamplingKey`), so carrying it resamples nothing.

Off (unset, false, a truthy non-boolean): no mark is set, the engine remembers nothing, and every decision is byte for byte and draw for draw the one it was.

## Receipts

`vpip_floor_limp_raised_fold` (the brain proposed a call or a re-raise; the decision is the fold), `vpip_floor_limp_raised_fold_kept` (the brain folded; the fold is guarded), `vpip_floor_limp_raised_fold_restored` (a later owner reopened the fold and the frame restored it; a count of how often the last guard was needed).

## Tests

`server/src/engine/aVpipFloorLimpFoldsToARaise.law.test.ts` (12 tests): 13 real production nodes (PLO4 and PLO5, thirty-hand and ten-hand tables, 12 calls and the re-raise; fixture written by `toComplaintFixture`: no user id, only the deciding Horse's own cards) fold on every seed and every style with the limp remembered, where the same brain with the option off calls or re-raises; built hold'em, PLO4, PLO5 and PLO6 tables (thirty-hand; ten-hand under the window option; a Lightning pool): 576 limp-then-raised decisions all fold; off (unset, false, truthy non-boolean), with or without the remembered limp, byte and draw identical; on with no remembered limp (a natural limp) identical to off; the mark only on the floor's own limp (never at an unfloored table, over the line, with no judged sample or with the option off); the sampling key; the relative cost.

Flag-off check (`scripts/ops/horse-flag-off-check.sh origin/main HEAD --set full`): 0 differences in 28,000 decisions (same action, amount, full decision JSON and receipts), base f2b854319ea9, head 1cdbf89e2c35.

## Measurement

### Floored mirror (chips)

The league seats no floored table, so the harness (`S7/l8-preflop/src/mirror-floor.mts`, lead-8 scratch) gives every Horse decision the table's floor, a thirty-hand window and an own judged VPIP under the line, and plays the engine's part of the option (it remembers a marked limp for the hand). Production's live option set plus `vpipFloorLimpOnly` in both arms; ON seats against OFF seats on duplicate deals, seats swapped each pair; Hybrid cash Horses with sandboxed memory. An own VPIP held under the line all session is the stress case: the floor limps every hand its step selects, about 2.6 floor limps per hand at six seats, far more than production.

| card                 | hands  | floor / own VPIP | raised floor limps, OFF: called (re-raised) | ON: folded       | ON minus OFF, bb/100 (SE) |
| -------------------- | ------ | ---------------- | ------------------------------------------- | ---------------- | ------------------------- |
| PLO5 6-max 100 bb    | 24,000 | 40% / 30%        | 1,975 (43) of 19,219                        | 19,141 of 19,141 | -3.90 (2.67)              |
| PLO5 heads-up 100 bb | 24,000 | 40% / 30%        | 68 (0) of 1,651                             | 1,651 of 1,651   | -1.77 (2.21)              |
| PLO5 6-max 300 bb    | 24,000 | 40% / 30%        | 1,974 (22) of 19,203                        | 19,110 of 19,110 | -1.77 (3.44)              |
| PLO4 6-max 100 bb    | 24,000 | 30% / 20%        | 1,984 (0) of 18,142                         | 18,112 of 18,112 | -0.24 (2.18)              |
| PLO4 heads-up 100 bb | 24,000 | 30% / 20%        | 72 (0) of 1,465                             | 1,465 of 1,465   | -0.25 (1.20)              |
| Hold'em 6-max 100 bb | 24,000 | 20% / 10%        | 5 (0) of 14,635                             | 14,635 of 14,635 | -0.09 (0.06)              |

No card is significantly different from zero (the largest is 1.5 standard errors); every card leans slightly negative, and the five PLO cards pooled by inverse variance give -0.96 +/- 0.87 bb/100 under this stress. The option only removes calls (and the rare re-raise); those calls are priced by the brain as worth making once the limp is in, so removing them is not expected to win chips, and it does not.

### Real hands

The 322 production calls returned -0.44 +/- 2.13 big blinds a call against folding (above). Folding them would have changed the Horses' result by +142 big blinds over seven days, inside noise.

### Cost

`S7/l8-preflop/src/speed-flr.mts`, the engine's own decide at the 2,546 real limp-then-raised nodes (machine load about 12): option on p50 0.15 / p95 0.84 / max 16.29 ms (none over 25 ms); off p50 0.18 / p95 0.85 / max 2.91 ms. The option adds one frame and one comparison; the law's relative-cost test bounds it at 2.5 times the same decisions off (measured about 1.0).

### Shadow

A counterfactual re-decision cannot show this option: it acts only on a limp the ENGINE remembered from an ACTED decision carrying the mark, and a decision acted with the option off carries none. So `shadow` / `on_shadow` rows re-decide nothing different; the option is trialled by switching it on and reading its receipts, and switched off again in about 30 seconds.

## Evidence rows

- The rule (0 calls, 0 re-raises of a raised floor limp with the option on; real nodes and every floored game): MET.
- Mechanism, scope, receipts (`HorseDataLedger.ts`), tests, off-identity, flag-off: MET.
- Cost: MET.
- Chips: no significant change in either direction (mirror cards above; real hands -0.44 +/- 2.13 bb a call). Not a gain.
- Audited replay (both PLO sets): run; no audited decision is a raised floor limp (0 changed).

## Prior anchor

- Baseline: none is used. The option prices nothing: the hand was a fold for one big blind before the floor bought the limp, and the owner's ruling is that the floor buys nothing else.
- Population weight: none. No population rate, fitted table or HUD row is read.
- Own record: not read. The decision reads the public action history and the Horse's own remembered limp only; no opponent record changes it.
- No unshown cards: none is read, live or in the evidence. The evidence replays use the public snapshot and the deciding Horse's own cards.

## What the activation row must contain

`option = 'vpipFloorLimpFoldsToARaise'`, `state = 'on'`, note `authority: vpipFloorLimpFoldsToARaise docs/horse-option-authority.d/vpipFloorLimpFoldsToARaise.md sha256 <the sha256 of this file as merged>`, written by `fn_ca_horse_option_switch_set` (service role, audited actor), on a build that carries this change (the engine must remember the limp: an older engine ignores the mark and the option does nothing). After switching on, `vpip_floor_limp_raised_fold` should fire at about the rate the calls were made (46 a day in hands with a person, 2026-11-20..27) and `vpip_floor_limp_raised_fold_restored` should stay at or near zero.

## Limits

The mirror is league self-play with the floor inputs injected, not a live floored table; its raisers are Horses, where production's were people in 289 of 322. The identification of a floor limp in the evidence is by replay (unfloored fold on 5 of 5 seeds), not by a recorded mark; the option itself uses a recorded mark and needs no such inference. The old floor on ten-hand tables (its call-down buys cold calls of raises as well) is not changed here.

## Replay

Machine-read (README.md, "The Replay row"); rows written by the scorer and copied unedited. Harness `S7/l8-preflop/src/node-replay-l8pf.ts` (the audited-node replay with the engine's part played: a preflop node of a floored table whose Horse limped an unraised pot and whose limp the unfloored brain folds on 5 of 5 seeds gets `ownVpipFloorLimpThisHand`).

- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 869; unjudged 0; set PLO-hand-audit-daily-2026-11-25T230000Z; scorer 5302af2ab3e; source placed verdict-only; arm FLR vs off; replayed 869 of 869
- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 2697; unjudged 0; set PLO-hand-audit-2026-11-20-to-24; scorer 5302af2ab3e; source placed verdict-only; arm FLR vs off; replayed 2697 of 2697

Neither audited set holds a raised floor limp (the audits grade decisions whose cards were shown, replayed with no opponent record), so the rows show no change and prove no chips; the option's evidence is the law on the real nodes above.

## Rollback

Set `vpipFloorLimpFoldsToARaise` to `off` via the `horse-option-switch` CLI (`fn_ca_horse_option_switch_set('vpipFloorLimpFoldsToARaise', 'off', '<actor>', '<reason>')`): within about 30 seconds no decision carries the mark; a limp already remembered in a hand in flight is forgotten at the next deal and is not read with the option off. No data migration.
