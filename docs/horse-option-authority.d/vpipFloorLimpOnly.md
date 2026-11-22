# vpipFloorLimpOnly: authority for the live switch

Owner ruling of 2026-11-17 14:34 America/Chicago (finding F-10 of the WooWoo 48-hour audit). Evidence: mechanism, scope, receipts, tests and off-identity MET; Horse churn (evictions) measured offline per variant (see "Which variants it governs, and the churn"); LIVE ON 2026-11-18T20:18:59Z (evidence `#57`, migration `20261118092009`, serving `f3e99378ccbb`, `8/8` workers at `+71s`), +3h 43m live read CLEAN 2026-11-19T00:01:59Z (`0` `option_switch_config_*`, receipts `seen 34,825`, `limp 2,463`, `fold_kept 1,353`, `priced_out 5`), confirmed ON in `2026-11-21T20:00Z` prod switch snapshot.

## What it does

On every floored cash table (every variant; except, on purpose, a table known to be judged the Action or Madness way at ten hands, see below; not tournaments, All-In-Or-Fold, bomb pots or Lightning) the table VPIP floor no longer widens a preflop bar (`vpipFloorMul`), calls a raise (`vpipFloorCallDown`) or swaps an intent (`omahaVpipFloorByLimp`): every decision is the one the same Horse makes at a table with no floor. The floor's one action (`vpipFloorLimpOnlyStep`): a Horse whose own judged VPIP is under its line (`vpipLimpTargetFor`: the floor plus `VPIP_LIMP_BUFFER_HANDS` hands of the judged window, 15 of 30 on a 40% table, 9 of 30 at 20%; the floor is read from the table) turns a preflop fold in a pot nobody has raised, at a price of at most the big blind and less than its stack, into the limp (the small blind's completion); the big blind checks free. Which folding hands limp is set per variant by measurement: every such fold on PLO5, PLO6 and the unmeasured variants, the priced ones on PLO4 and hold'em. Priced means (`vpipFloorLimpEv`, `vpipFloorLimpOnlySelects`; owner 2026-11-17 15:30: "DONT' MAKE ANY BLANKET RULES, EVERY DECISION NEEDS TO BE 100% INDEPENDANT AND DATA AND MATH DERRIVED AND BY RANGES, NEVER BLANKETS"): the expected value of limping this hand (equity against the ranges still to act, from each opponent's read or the measured population envelope; the engine's flop realization by position; the chance of a raise behind and the hand's own EV when raised, where the unfloored decision stands) must be at least minus the price times the share of the three-hand buffer the Horse still needs. Having limped and been raised, the unfloored decision stands. No straddled hand, no judged sample yet (under three hands): no action. The floor, window, warning, grace, eviction and the three-hand buffer are unchanged.

## Which variants it governs, and the churn

Every floored cash variant (`VPIP_FLOOR_LIMP_ONLY_VARIANTS` in `server/src/engine/HorseLogic.ts`, pinned by `HorseVpipFloorLimpOnly.test.ts`).

Owner rulings this rests on, besides the first: 2026-11-17 18:35 Chicago "lower the vpip down to 40% also" (the PLO5 and PLO6 Classic floors; another change sets them, this option reads whatever floor the table carries), and 18:38 "its fine, with a 30 hand grace period, horses should be close to 40% with limp folds in the range. and if they aren't the get booted and replaced with a new horse." So a Horse that limping cannot keep over the floor is evicted and replaced; the floor does not buy a call of a raise to prevent it.

Measured churn (audit archive `repairs/F-10/EVAL-RESULTS-E1D.md`, `EVAL-RESULTS-E1E.md`; today's floor evicts no Horse in the same runs). "One Horse" is a sitting on the production spot mix; "table" is six Horses in self-play, 2,400 table hands.

| table                                  | selection shipped | one Horse: sittings evicted of 8 / evictions per 100 Horse hands | table: evictions per 100 table hands | VPIP mean, one Horse / table | floor chips, bb per 100 hands (today) |
| -------------------------------------- | ----------------- | ---------------------------------------------------------------- | ------------------------------------ | ---------------------------- | ------------------------------------- |
| PLO5 40%                               | every             | 5 / 0.31                                                         | 0.33                                 | 41.7% / 47.0%                | 18.9 (70.0)                           |
| PLO6 40%                               | every             | 5 / 0.30                                                         | 0.96                                 | 43.4% / 45.3%                | 18.1 (115.6)                          |
| PLO5 50% (a table still carrying 50)   | every             | 8 / 1.03                                                         | 1.83                                 | 45.0% / 52.8%                | 22.4 (95.0)                           |
| PLO6 50%                               | every             | 8 / 1.30                                                         | 4.88                                 | 45.6% / 48.9%                | 20.1 (155.1)                          |
| PLO4 30%                               | priced            | 2 / 0.09                                                         | 0                                    | 35.4% / 37.9%                | 14.4 (53.3)                           |
| NLH 20%                                | priced            | 0 / 0                                                            | 0                                    | 29.8% / 31.9%                | 7.3 (27.6)                            |
| PLO8, FLO8, FLH, short deck, pineapple | every             | not measured                                                     | not measured                         | not measured                 | not measured                          |

The most VPIP limping can reach on the production spot mix is about 51% (57.4% of a Horse's first preflop decisions already face a raise, where the floor does nothing): comfortable against 20% and 30%, close against 40% (a 30-hand window falls under a 40% floor 8 to 9 times in 100 even at that ceiling), not enough against 50%. 'every' is shipped on PLO5/PLO6 because 'priced' evicts about twice as often there for 2 to 3 big blinds per 100 hands less; 'priced' on PLO4 and hold'em because the evictions are the same and it spends less.

Before switching on (operations, verified 2026-11-18 from source and a read-only production read; see `repairs/F-10/REPLACEMENT-MECHANIC.md`): an evicted Horse is cashed out by the ordinary seat cash-out with leave mode `vpip_evicted`, barred from that game (club + variant + stakes) for the rejoin window (two hours), and the fleet's 30-second seating cycle fills the chair with a Horse that is not barred.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: vpipFloorLimpOnly docs/horse-option-authority.d/vpipFloorLimpOnly.md sha256 <digest>`). With it on, `omahaVpipFloorByLimp` stands aside on the same tables (it can stay on; the two never act on one decision). The maintained rollback (switch row off, about 30 s) restores today's floor exactly.

## The owner's order it rests on (verbatim)

- 2026-11-17 14:34 America/Chicago: "Table VPIP must limp fold for a bb. smh nothing else if there vpip drops."

## Recorded hands and rulings it answers

Finding F-10 (1,228 decisions judged questionable or wrong); the floor's 981 calls of a raise in the journaled builds 28372c9a and 3529e866; hand 59518335 (the recorded table the tests rebuild). With the option on every one of those floor calls of a raise is the unfloored fold (E2b: 980 of 980), and the floor's limps remain.

## Receipts

`vpip_floor_limp_only_seen`, `vpip_floor_limp_only_limp`, `vpip_floor_limp_only_fold_kept`, `vpip_floor_limp_only_priced_out`, `vpip_floor_limp_only_not_governed_ten_hand_window` (ledger). With the option on, `vpip_floor_call_down` and the `omaha_vpip_floor_` receipts do not fire on governed tables.

## Where the ruling is NOT applied, on purpose

Integrator decision 2026-11-18: a table KNOWN to be judged the Action / Madness way (the sitting judged at ten hands or fewer, eviction with no warning and no grace) keeps today's floor with the option on, so there the floor still widens ranges and still calls raises. Reason: that mode was not measured, its floors run from 40% to 70% on existing tables, and limping tops out near 51% VPIP, so every Horse would be evicted every sitting. Each such decision fires `vpip_floor_limp_only_not_governed_ten_hand_window`. Games in that mode at the read of 2026-11-18: the FLH and FLO8 "Madness" games (no player seated) and the "Lightning Games" (a separate domain the option never touches). Whoever switches the option on accepts this.

It cannot leak onto a Classic table. "Known" needs the Horse's own judged row, which carries the policy window from `fn_nit_status`. When that read fails the engine falls back to `tables.maintain_hands` or ten; the option ignores that fallback: with no row the table is governed and the floor takes no action (no judged sample), which is the ruling failing safe. A variant key missing from `VPIP_FLOOR_LIMP_ONLY_VARIANTS` (for example `pineapple_holdem`) is governed with the selection 'every'.

## Tests

`server/src/engine/HorseVpipFloorLimpOnly.test.ts` (the priced mechanism on the four measured variants; the declared table; the line follows the floor the table carries; the floor never calls or raises in a raised pot on PLO5/PLO6 at 40% and 50%, PLO4 and hold'em; nothing changes at or above the line; option off is identical; a limp folded to a raise counts as VPIP in the sitting harness), `server/src/engine/AReferenceNodeRuleIsAReferenceReturn.law.test.ts` (`docs/laws.d/server-src-engine-AReferenceNodeRuleIsAReferenceReturn.md`), and `server/src/engine/aVpipFloorLimpIsAReferenceReturn.guard.test.ts` (reference-node return shape admits the limp); the existing floor suites (HorseOmahaVpipFloorByLimp, HorseVpipFloor, HorseVpipFloorCallDown, HorseVpipFloorDeepStackOff, aTightRaisersFoldIsNotBoughtBackByTheVpipFloor, HorseStoredNodeCarriesVpipFloor, HorsePublicActionNodeVpip) unchanged and passing.

## Evidence rows

- Mechanism, scope, visibility (receipts in HorseDataLedger.ts), tests: MET.
- Option unset or false (or a truthy non-boolean): decisions identical to the base, draw for draw (HorseVpipFloorLimpOnly.test.ts, PLO4/PLO5/PLO6/NLH, eight seeds each), and the existing floor suites pass unchanged.
- Horse churn: measured offline per variant on the declared sitting model and the full-table self-play (table above); accepted by the owner (18:38); value and continuation in live play: NOT MEASURED (the league seats no floored table).

## What the activation row must contain

`option = 'vpipFloorLimpOnly'`, `state = 'on'`, note `authority: vpipFloorLimpOnly docs/horse-option-authority.d/vpipFloorLimpOnly.md sha256 <the sha256 of this file as merged>`, written by `fn_ca_horse_option_switch_set` (service role, audited actor), after the follow-up option-switch migration of this change is installed.

## Limits

The price the floor pays per needed hand (the limp price times the share of the buffer still needed) is a builder's derivation, not measured; the raise sizes assumed behind a limp (a pot raise in pot limit, four big blinds plus one per caller in no limit) are a model; the raise-first-in rate stands for the raise over a limp. The spot mix was measured at the 50% PLO5 table and applied to the other variants; PLO8, FLO8, fixed-limit hold'em, short deck and pineapple were not measured at all. The eviction evaluation is offline (one Horse on that mix, and six Horses with no reads and no human), not a live table.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-19 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it)

## Rollback

Set `vpipFloorLimpOnly` to `off` via the `horse-option-switch` CLI (`fn_ca_horse_option_switch_set('vpipFloorLimpOnly', 'off', '<actor>', '<reason>')`) to restore the base brain within ~30s; zero data migration needed.
