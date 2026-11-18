# lightningVpipFloorLimpOnly: authority for the live switch

Owner ruling of 2026-11-18 10:52 America/Chicago. Evidence: mechanism, scope, receipts, tests and off-identity MET; value, cost and the floor actually reached in a pool NOT MEASURED (evaluation declared, not run).

## The owner's orders it rests on (verbatim)

- 2026-11-18 10:51 America/Chicago: "woowoo is currently playing lightning games plo5 1/2 these same features and functions need to be activated inside for those games as well for the horses if it hasn't already?"
- 2026-11-18 10:52 America/Chicago: "yes if a game requires a vpip horses must always follow"
- 2026-11-17 14:34 America/Chicago (how a floor is met): "Table VPIP must limp fold for a bb. smh nothing else if there vpip drops."
- 2026-10-23, migration `20261023230001`: "Lightning uses 40% minimum VPIP and a BB ante." (every Lightning Games row carries floor 40, window 10).

## What was wrong

The Lightning decision snapshot (`server/src/lightning/LightningHorse.ts`, `buildLightningHorseSnapshot`) carried no floor, no window and no own figure, so a Lightning Horse could not see the floor its game requires. Production, 2026-11-18, PLO5 1/2 Lightning since 11:46Z: 3,709 hands, 49 Horses, 19,842 dealt hands, VPIP 24.6%; 48 of 48 Horses with ten or more hands under 40%.

## What it does

The Lightning snapshot now carries, for a floored pool, `gameState.lightningVpipFloor = { floor, windowHands, own: { hands, vpipHands } }`: the host table's `maintain_percent_min` and `maintain_hands` (read as the table engine reads them, only with `nit_game` true) and the Horse's own count this pool sitting (`server/src/lightning/LightningHorseVpipLedger.ts`: hands dealt, hands voluntarily entered preflop by the `ca_hand_facts` definition; a limp that folds to a raise is entered; blinds, antes, a checked big blind and a walk are dealt and not entered). The field is not `vpipFloor`, so the table floor's widening (`vpipFloorMul`) and call-down (`vpipFloorCallDown`) still cannot fire in a pool in any switch state, and the field is outside the policy sampling key (`horseDecision/protocol.ts`), so carrying it changes no decision.

With the option on, a floored Lightning cash decision (not All-In-Or-Fold, not a tournament) has the one action of `vpipFloorLimpOnly` (`vpipFloorLimpOnlyStep`, the same per-variant selection `VPIP_FLOOR_LIMP_ONLY_VARIANTS`: PLO5 every fold under the line, PLO4 and hold'em the priced ones): a Horse under its line turns a preflop fold in a pot nobody has raised, for at most one big blind and less than its stack, into the limp or the small blind's completion. It never raises, never calls a raise, never re-raises and never acts postflop. Raised after the limp, the unfloored decision stands (limp-fold; the limp already counted).

The line. Lightning games are in the ten-hand mode (window 10, no grace), which judges the whole sitting once ten hands are dealt. So the judged sample is the hands dealt this sitting, never fewer than the window: with N = max(hands, window), the Horse is under its line while entered hands < ceil(floor x N) + `VPIP_LIMP_BUFFER_HANDS` (3). At 200 hands dealt that is 83 entered (41.5%); in the first ten hands it is 7. Fewer than three hands on the count: no action.

## Only a game that has a floor (owner 2026-11-18 11:03 America/Chicago, verbatim)

"NO, ONLY IF THE GAME HAS A VPIP, DON'T MAKE THEM VPIP REQUIRED IF THE GAME DOESN'T HAVE ONE!"

The host builds the field only when the host table runs the rule: `nit_game` true and `maintain_percent_min` above zero, read exactly as the table engine reads its floor (`ServerTableEngineBase.vpipFloor`). A pool whose game has no floor carries no field and its decisions are unchanged with the option on (pinned by test, and a zero floor is refused in the decision too).

## The ten-hand window

`vpipFloorLimpOnly` deliberately leaves a TABLE judged at ten hands on the old floor (`vpipFloorLimpOnlyTenHandTable`): at an Action or Madness table the floors ran up to 70 and limping tops out near 51%. A Lightning pool is also in the ten-hand mode, and this option does govern it, for three reasons: the pool floor is 40, inside what limping reaches; a pool has no "old floor" to stay on (the snapshot never carried one, so the alternative is no floor at all, which the owner ruled out); and the ten-hand mode judges the whole sitting, which is the sample the line above uses. What is not known is how many of a Horse's preflop turns in a pool are still unraised (at the Classic table it was 42.6%); the declared evaluation measures it (bar B3).

## How it interacts with vpipFloorLimpOnly

They never meet. `vpipFloorLimpOnly` governs floored cash TABLES and excludes Lightning in its own scope (`vpipFloorLimpOnlyInScope`, and it needs `vpipFloor > 0`, which a pool never carries). `lightningVpipFloorLimpOnly` governs floored Lightning POOLS and reads only `lightningVpipFloor`, which a table never carries. Either can be on or off without the other; with both on a pool decision is the one with this option alone (pinned by test). `omahaVpipFloorByLimp`, `lightningCheapEntryOmaha` and `lightningCheapEntryHoldem` are untouched: the cheap-entry options price a small-blind completion without reading the Horse's own VPIP and remain off-only under the preflop hold.

## What does NOT exist, and what the option therefore cannot do

No pool session is ended by the floor today, for a person or for a Horse. The rule that stands a player up (`fn_nit_enforce`, leave mode `vpip_evicted`, the two-hour bar) runs in a physical table's dealing loop; a Lightning anchor is parked and runs the sit-out clock alone (`ServerTableEngineDealing`, `sitOutOnly: true`; `ServerTableEngineBase.evictExpiredSitOuts`). Thirty days to 2026-11-18, every Lightning game: 0 pool sessions ended by the floor. This option makes the Horse follow the floor; it does not remove a Horse that still falls under it. Removal with the two-hour bar and fleet replacement must be built for every pool player alike (CLAUDE.md 10.5) and is a separate change with its own migration (design: audit archive `repairs/LIGHTNING/LIGHTNING-FLOOR-DESIGN.md`).

## Lightning mechanics that differ from a table

- No fixed chair: the count follows the pool session, not a seat.
- The early look. A Horse first asks its policy before its turn; a fold there is pressed at once. Under its line in an unraised pot the answer is now the limp, so the Horse waits for its turn and decides again on what happened in between (a raise in front: the unfloored decision, usually a fold on the ordinary clock). Horses under their line therefore fast-fold less; the pool's hands-per-hour effect is NOT MEASURED.
- The count is in engine memory. A process restart starts it again; the Horse then takes no floor action for three hands. When a pool judge exists the count must be replaced by the judge's own figure, as at a table.

## Receipts

`lightning_vpip_floor_limp_only_seen`, `lightning_vpip_floor_limp_only_limp`, `lightning_vpip_floor_limp_only_fold_kept`, `lightning_vpip_floor_limp_only_priced_out` (ledger). `vpip_floor_call_down` and the table `vpip_floor_limp_only_*` receipts never fire for a pool decision.

## Tests

`server/src/engine/HorseLightningVpipFloorLimpOnly.test.ts` (off: no decision and no draw changes with the field carried, option absent, false or non-boolean, and with `vpipFloorLimpOnly` on; the field is outside the sampling key; on: every unraised fold under the line becomes the limp, the small blind completes for half a big blind, a raised pot and a limp raised behind are the unfloored decision draw for draw, including the four recorded Lightning re-raised lines; nothing at or over the line, with no count, at a table or on All-In-Or-Fold). `server/src/lightning/LightningHorseVpipLedger.test.ts` (the count and its definition of an entered hand).

## Evidence rows

- Mechanism, scope, visibility (receipts), tests: MET.
- Option unset or false (or a truthy non-boolean): decisions identical to the base, draw for draw (test), and recorded decisions replay identically against main (lane report).
- Cost of the limps, VPIP actually reached per sitting, effect on pool speed, effect on the people in the pool: NOT MEASURED. Declared: audit archive `repairs/LIGHTNING/EVAL-DECLARATION-lightningVpipFloorLimpOnly.md`.
- `VPIP_LIMP_BUFFER_HANDS` = 3 was simulated on thirty-hand rolling windows at a table, not on a pool sitting.

## What the activation row must contain

`option = 'lightningVpipFloorLimpOnly'`, `state = 'on'`, note `authority: lightningVpipFloorLimpOnly docs/horse-option-authority.d/lightningVpipFloorLimpOnly.md sha256 <the sha256 of this file as merged>`, written by `fn_ca_horse_option_switch_set`, only after the serving engine build knows the option name and the switch-list migration that adds it is installed.
