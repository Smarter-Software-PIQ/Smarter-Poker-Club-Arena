# lightningVpipFloorLimpOnly: authority for the live switch

Owner ruling of 2026-11-18 10:52 America/Chicago. Evidence: mechanism, scope, receipts, tests and off-identity MET; the declared evaluation ran on the human-seated fast-table hands of 2026-11-18 and is INSUFFICIENT by its sufficiency bar (audit archive `repairs/LIGHTNING/EVAL-RESULTS.md`); the line was redesigned on 2026-11-19 (below) after that replay.

## The owner's orders it rests on (verbatim)

- 2026-11-18 10:51 America/Chicago: "woowoo is currently playing lightning games plo5 1/2 these same features and functions need to be activated inside for those games as well for the horses if it hasn't already?"
- 2026-11-18 10:52 America/Chicago: "yes if a game requires a vpip horses must always follow"
- 2026-11-17 14:34 America/Chicago (how a floor is met): "Table VPIP must limp fold for a bb. smh nothing else if there vpip drops."
- 2026-10-23, migration `20261023230001`: "Lightning uses 40% minimum VPIP and a BB ante." (every Lightning Games row carries floor 40, window 10).

## What was wrong

The Lightning decision snapshot (`server/src/lightning/LightningHorse.ts`, `buildLightningHorseSnapshot`) carried no floor, no window and no own figure, so a Lightning Horse could not see the floor its game requires. Production, 2026-11-18, PLO5 1/2 Lightning since 11:46Z: 3,709 hands, 49 Horses, 19,842 dealt hands, VPIP 24.6%; 48 of 48 Horses with ten or more hands under 40%.

## What it does

The Lightning snapshot now carries, for a floored pool, `gameState.lightningVpipFloor = { floor, windowHands, own: { hands, vpipHands, leavingEntered } }`: the host table's `maintain_percent_min` and `maintain_hands` (read as the table engine reads them, only with `nit_game` true) and the Horse's last `windowHands - 1` settled hands this pool sitting (`server/src/lightning/LightningHorseVpipLedger.ts`, `readWindow`: how many, how many entered, and whether the oldest of them was entered; hands dealt, hands voluntarily entered preflop by the `ca_hand_facts` definition; a limp that folds to a raise is entered; blinds, antes, a checked big blind and a walk are dealt and not entered). The field is not `vpipFloor`, so the table floor's widening (`vpipFloorMul`) and call-down (`vpipFloorCallDown`) still cannot fire in a pool in any switch state, and the field is outside the policy sampling key (`horseDecision/protocol.ts`), so carrying it changes no decision.

With the option on, a floored Lightning cash decision (not All-In-Or-Fold, not a tournament) has the one action of `vpipFloorLimpOnly` (`vpipFloorLimpOnlyStep`): a Horse that needs the limp (below) turns a preflop fold in a pot nobody has raised, for at most one big blind and less than its stack, into the limp or the small blind's completion. It never raises, never calls a raise, never re-raises and never acts postflop. Raised after the limp, the unfloored decision stands (limp-fold; the limp already counted).

The line (redesigned 2026-11-19). The first build judged the whole sitting plus a three-hand buffer, with PLO5's 'every' selection. A Horse that had sat 400 hands at 24.5% when the option came on was then 65 hands short and limped every unraised fold for about a hundred hands to catch up. The count also restarted with the process. The line is now the game's own window (`maintain_hands`, ten in every fast-table game), rolling and projected with this hand. Let need = ceil(floor x window); at 40% over ten hands that is 4. If folding this hand would leave the last ten hands with fewer than need entered, the limp is forced: it is the fewest limps that keep every window at the floor. If the window is exactly at need and an entered hand leaves at the next hand, the Horse may spend that limp one hand early, but only when the limp is priced (`vpipFloorLimpOnlySelects` at one hand short); otherwise it folds and the next hand is forced. That way the needed limps go to the better hands. Offline, at a natural 25% VPIP, the line lands at 44% when every fold is limpable and nearer 40% when fewer folds are unraised (test: 20 sittings of 400 hands, mean 40-46%, every window at least four entered, no catch-up run).

## Only a game that has a floor (owner 2026-11-18 11:03 America/Chicago, verbatim)

"NO, ONLY IF THE GAME HAS A VPIP, DON'T MAKE THEM VPIP REQUIRED IF THE GAME DOESN'T HAVE ONE!"

The host builds the field only when the host table runs the rule: `nit_game` true and `maintain_percent_min` above zero, read exactly as the table engine reads its floor (`ServerTableEngineBase.vpipFloor`). A pool whose game has no floor carries no field and its decisions are unchanged with the option on (pinned by test, and a zero floor is refused in the decision too).

## The ten-hand window

`vpipFloorLimpOnly` deliberately leaves a TABLE judged at ten hands on the old floor (`vpipFloorLimpOnlyTenHandTable`), where the old floor still widens and calls raises. A fast-table pool has no old floor (the snapshot never carried one, so `vpip_floor_call_down` cannot fire in a pool in any switch state: 0 fires in 1,704 replayed pool decisions, off and on). This option governs the pool with the limp alone, judged over the pool's ten-hand window as above. The ten-hand TABLES are a separate change (a default-off option of their own).

## How it interacts with vpipFloorLimpOnly

They never meet. `vpipFloorLimpOnly` governs floored cash TABLES and excludes Lightning in its own scope (`vpipFloorLimpOnlyInScope`, and it needs `vpipFloor > 0`, which a pool never carries). `lightningVpipFloorLimpOnly` governs floored Lightning POOLS and reads only `lightningVpipFloor`, which a table never carries. Either can be on or off without the other; with both on a pool decision is the one with this option alone (pinned by test). `omahaVpipFloorByLimp`, `lightningCheapEntryOmaha` and `lightningCheapEntryHoldem` are untouched: the cheap-entry options price a small-blind completion without reading the Horse's own VPIP and remain off-only under the preflop hold.

## What does NOT exist, and what the option therefore cannot do

No pool session is ended by the floor today, for a person or for a Horse. The rule that stands a player up (`fn_nit_enforce`, leave mode `vpip_evicted`, the two-hour bar) runs in a physical table's dealing loop; a Lightning anchor is parked and runs the sit-out clock alone (`ServerTableEngineDealing`, `sitOutOnly: true`; `ServerTableEngineBase.evictExpiredSitOuts`). Thirty days to 2026-11-18, every Lightning game: 0 pool sessions ended by the floor. This option makes the Horse follow the floor; it does not remove a Horse that still falls under it. Removal with the two-hour bar and fleet replacement must be built for every pool player alike (CLAUDE.md 10.5) and is a separate change with its own migration (design: audit archive `repairs/LIGHTNING/LIGHTNING-FLOOR-DESIGN.md`).

## Lightning mechanics that differ from a table

- No fixed chair: the count follows the pool session, not a seat.
- The early look. A Horse first asks its policy before its turn; a fold there is pressed at once. Under its line in an unraised pot the answer is now the limp, so the Horse waits for its turn and decides again on what happened in between (a raise in front: the unfloored decision, usually a fold on the ordinary clock). Horses under their line therefore fast-fold less; the pool's hands-per-hour effect is NOT MEASURED.
- The count is in engine memory. A process restart starts it again, and so does a new sitting: the Horse takes no floor action until the count holds `windowHands - 1` hands (nine in a ten-hand game), which bounds a restart at nine unfloored hands per sitting. When a pool judge exists, the count must be replaced by the judge's own figure, as at a table.

## Receipts

`lightning_vpip_floor_limp_only_seen`, `lightning_vpip_floor_limp_only_limp`, `lightning_vpip_floor_limp_only_fold_kept`, `lightning_vpip_floor_limp_only_priced_out` (ledger). `vpip_floor_call_down` and the table `vpip_floor_limp_only_*` receipts never fire for a pool decision.

## Tests

`server/src/engine/HorseLightningVpipFloorLimpOnly.test.ts` (off: no decision and no draw changes with the field carried, option absent, false or non-boolean, and with `vpipFloorLimpOnly` on; the field is outside the sampling key; on: the line is the pool window projected with this hand, younger counts take no action, and a 25% Horse lands at 40-46% with every window at the floor and no catch-up run; when short, every unraised fold becomes the limp; one hand early, only priced limps; the small blind completes for half a big blind, a raised pot and a limp raised behind are the unfloored decision draw for draw, including the four recorded Lightning re-raised lines; nothing at or over the line, with no count, at a table or on All-In-Or-Fold). `server/src/lightning/LightningHorseVpipLedger.test.ts` (the count and its definition of an entered hand).

## Evidence rows

- Mechanism, scope, visibility (receipts), tests: MET.
- Option unset or false (or a truthy non-boolean): decisions identical to the base, draw for draw (test), and recorded decisions replay identically against main (lane report).
- Declared evaluation (audit archive `repairs/LIGHTNING/EVAL-DECLARATION-lightningVpipFloorLimpOnly.md`) run on journal-3: B0-B2 met, B6 INSUFFICIENT (118 sittings, 273 limp-eligible folds). For the redesigned line, the replay and its cost are in `repairs/LIGHTNING/EVAL-RESULTS.md`. Effect on pool speed and on the people in the pool: reported, no bar.

## What the activation row must contain

`option = 'lightningVpipFloorLimpOnly'`, `state = 'on'`, note `authority: lightningVpipFloorLimpOnly docs/horse-option-authority.d/lightningVpipFloorLimpOnly.md sha256 <the sha256 of this file as merged>`, written by `fn_ca_horse_option_switch_set`, only after the serving engine build knows the option name and the switch-list migration that adds it is installed.
