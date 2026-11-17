# vpipFloorLimpOnly: authority for the live switch

Owner ruling of 2026-11-17 14:34 America/Chicago (finding F-10 of the WooWoo 48-hour audit). Evidence: mechanism, scope, receipts, tests and off-identity MET; eviction risk evaluated offline per variant (see "Which variants it governs"); a live read is owed after the release.

## What it does

On a floored cash table of a governed variant (not tournaments, All-In-Or-Fold, bomb pots or Lightning) the table VPIP floor no longer widens a preflop bar (`vpipFloorMul`), calls a raise (`vpipFloorCallDown`) or swaps an intent (`omahaVpipFloorByLimp`): every decision is the one the same Horse makes at a table with no floor. The floor's one action (`vpipFloorLimpOnlyStep`): a Horse whose own judged VPIP is under its line (`vpipLimpTargetFor`: the floor plus `VPIP_LIMP_BUFFER_HANDS` hands of the judged window, 9 of 30 on a 20% table) turns a preflop fold in a pot nobody has raised, at a price of at most the big blind and less than its stack, into the limp (the small blind's completion); the big blind checks free. Which folding hands limp is priced per decision (`vpipFloorLimpEv`, `vpipFloorLimpOnlySelects`; owner 2026-11-17 15:30: "DONT' MAKE ANY BLANKET RULES, EVERY DECISION NEEDS TO BE 100% INDEPENDANT AND DATA AND MATH DERRIVED AND BY RANGES, NEVER BLANKETS"): the expected value of limping this hand (equity against the ranges still to act, from each opponent's read or the measured population envelope; the engine's flop realization by position; the chance of a raise behind and the hand's own EV when raised, where the unfloored decision stands) must be at least minus the price times the share of the three-hand buffer the Horse still needs. Having limped and been raised, the unfloored decision stands. No straddled hand, no judged sample yet (under three hands): no action. The floor, window, warning, grace, eviction and the three-hand buffer are unchanged.

## Which variants it governs (declared, measured)

`VPIP_FLOOR_LIMP_ONLY_VARIANTS` in `server/src/engine/HorseLogic.ts`, pinned by `HorseVpipFloorLimpOnly.test.ts`: **hold'em (`nlh`, the 20% floor), priced selection, and nothing else.** On every other variant the option changes nothing: today's floor stands, byte for byte.

The table is the result of the declared evaluation (audit archive `repairs/F-10/EVAL-DECLARATION-E1D.md`, `EVAL-RESULTS-E1D.md`), run on two selections that both obey the ruling ('every': limp every unraised fold while under the line; 'priced': the rule above). Today's floor evicted 0 of 8 sittings on every table.

| table                                                  | one Horse, production spot mix (E1d): sittings evicted, every / priced | full table of Horses (E3): evictions in 8 tables x 300 hands, every / priced | most VPIP the ruling can reach (bound) | result                                              |
| ------------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------- |
| NLH 20%                                                | 0 of 8 / 0 of 8                                                        | 0 / 0                                                                        | 51.6%                                  | governed, priced                                    |
| PLO4 30%                                               | 2 of 8 / 2 of 8 (bar: at most 1)                                       | 0 / 0                                                                        | 49.8%                                  | left out: the two measurements disagree             |
| PLO5 50%                                               | 8 of 8 / 8 of 8                                                        | 44 / 81                                                                      | 50.7% (floor 50%, line 60%)            | left out: the ruling and the eviction rule conflict |
| PLO6 50%                                               | 8 of 8 / 8 of 8                                                        | 117 / 152                                                                    | 51.2% (floor 50%, line 60%)            | left out: the same conflict                         |
| PLO8, FLO8, fixed-limit hold'em, short deck, pineapple | not measured                                                           | not measured                                                                 | not measured                           | left out                                            |

The conflict on the 50% tables is arithmetic, not hand selection: on the production spot mix 57.4% of a Horse's first preflop decisions face a raise, where the ruling gives the floor nothing and the Horse's own decision continues 15.5% (PLO5) or 16.2% (PLO6) of the time. Limping every other hand reaches at most 50.7% / 51.2%, and a 30-hand window at that rate is under a 50% floor about 4 times in 10. Holding those floors needs a call of a raise (ruled out), or a lower floor, a longer window or grace (the owner does not change them). So on PLO5, PLO6 and PLO4 the floor's calls of raises that finding F-10 names remain as they are today; that is an owner decision this option cannot make.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: vpipFloorLimpOnly docs/horse-option-authority.d/vpipFloorLimpOnly.md sha256 <digest>`). With it on, `omahaVpipFloorByLimp` is untouched on PLO4/PLO5 (the option does not govern them). The maintained rollback (switch row off, about 30 s) restores today's floor exactly.

## The owner's order it rests on (verbatim)

- 2026-11-17 14:34 America/Chicago: "Table VPIP must limp fold for a bb. smh nothing else if there vpip drops."

## Recorded hands and rulings it answers

Finding F-10 (1,228 decisions judged questionable or wrong); the floor's 981 calls of a raise in the journaled builds 28372c9a and 3529e866; hand 59518335 (the recorded table the tests rebuild). Those decisions were taken at the 50% PLO5 table, which this option does NOT govern (see above): what it removes is the same behaviour at 20% hold'em tables (143 floor calls of a raised pot and 7 floor raises in 2,400 measured hands become 0).

## Receipts

vpip_floor_limp_only_seen, vpip_floor_limp_only_limp, vpip_floor_limp_only_fold_kept, vpip_floor_limp_only_priced_out (ledger). With the option on, vpip_floor_call_down does not fire on governed tables.

## Tests

server/src/engine/HorseVpipFloorLimpOnly.test.ts (the mechanism on every measured variant; the declared table; a left-out variant decides as with the option off; the floor never calls or raises in a raised pot; nothing changes above the line; option off is identical); the existing floor suites (HorseOmahaVpipFloorByLimp, HorseVpipFloor, HorseVpipFloorCallDown, HorseVpipFloorDeepStackOff, aTightRaisersFoldIsNotBoughtBackByTheVpipFloor, HorseStoredNodeCarriesVpipFloor, HorsePublicActionNodeVpip) unchanged and passing.

## Evidence rows

- Mechanism, scope, visibility (receipts in HorseDataLedger.ts), tests: MET.
- Option unset or false (or a truthy non-boolean): decisions identical to the base, draw for draw (HorseVpipFloorLimpOnly.test.ts, PLO4/PLO5/PLO6/NLH, eight seeds each), and the existing floor suites pass unchanged.
- Eviction risk: evaluated offline per variant on the declared sitting model and the full-table self-play (table above); value and continuation in live play: NOT MEASURED (the league seats no floored table).

## What the activation row must contain

`option = 'vpipFloorLimpOnly'`, `state = 'on'`, note `authority: vpipFloorLimpOnly docs/horse-option-authority.d/vpipFloorLimpOnly.md sha256 <the sha256 of this file as merged>`, written by `fn_ca_horse_option_switch_set` (service role, audited actor), after the follow-up option-switch migration of this change is installed.

## Limits

The price the floor pays per needed hand (the limp price times the share of the buffer still needed) is a builder's derivation, not measured; the raise sizes assumed behind a limp (four big blinds plus one per caller in no limit) are a model; the raise-first-in rate stands for the raise over a limp. The spot mix was measured at the 50% PLO5 table and applied to hold'em. The eviction evaluation is offline (one Horse on that mix, and six Horses with no reads and no human), not a live table.
