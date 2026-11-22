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

No pool session is ended by the floor today, for a person or for a Horse. The rule that stands a player up (`fn_nit_enforce`, leave mode `vpip_evicted`, the two-hour bar) runs in a physical table's dealing loop; a Lightning anchor is parked and runs the sit-out clock alone (`ServerTableEngineDealing`, `sitOutOnly: true`; `ServerTableEngineBase.evictExpiredSitOuts`). Thirty days to 2026-11-18, every Lightning game: 0 pool sessions ended by the floor. Until 2026-11-21 the pool sitting was judged once, at the switch-off, when the anchor became an ordinary table and its first eviction pass read every pool hand of the sitting; since migration `20261121152102` that table's sample starts at the switch-off (`fn_nit_sitting_since`). This option makes the Horse follow the floor; it does not remove a Horse that still falls under it. Removal with the two-hour bar and fleet replacement must be built for every pool player alike (CLAUDE.md 10.5) and is a separate change with its own migration (design: audit archive `repairs/LIGHTNING/LIGHTNING-FLOOR-DESIGN.md`).

## Lightning mechanics that differ from a table

- No fixed chair: the count follows the pool session, not a seat.
- The early look. A Horse first asks its policy before its turn; a fold there is pressed at once. Under its line in an unraised pot the answer is now the limp, so the Horse waits for its turn and decides again on what happened in between (a raise in front: the unfloored decision, usually a fold on the ordinary clock). Horses under their line therefore fast-fold less; the pool's hands-per-hour effect is NOT MEASURED.
- The count is in engine memory, in deal order. A hand is counted when it is over for the player: at its fold, or at settlement for everyone still in. That way the next hand a fast fold deals already sees it (review F1).
- A new sitting this process met from its first hand is judged from that hand: every prefix must hold the floor, ceil(floor x (hands + 1)), so a tight Horse reaches its first full window at the floor (review F3). A sitting carried over an engine restart (first seen within 120 s of the ledger's first activity; measured p99.9 gap between a Horse's dealt hands is 101 s) takes no floor action until the count holds `windowHands - 1` hands. That bounds a restart at nine unfloored hands per sitting.
- The window is the game's `vpip_window` when the rules carry it, else `tables.maintain_hands`, in fn_nit_policy's order (both are ten in every fast-table game today).
- When a pool judge exists, the count must be replaced by the judge's own figure, as at a table, and the line must follow the judge's mode. fn_nit_policy judges the whole sitting unless `vpip_rolling` is set; this line is rolling, so a Horse whose early sitting was tight could read under a whole-sitting judge (review F2).

## Receipts

`lightning_vpip_floor_limp_only_seen`, `lightning_vpip_floor_limp_only_limp`, `lightning_vpip_floor_limp_only_fold_kept`, `lightning_vpip_floor_limp_only_priced_out` (ledger). `vpip_floor_call_down` and the table `vpip_floor_limp_only_*` receipts never fire for a pool decision.

## Tests

`server/src/engine/HorseLightningVpipFloorLimpOnly.test.ts` (off: no decision and no draw changes with the field carried, option absent, false or non-boolean, and with `vpipFloorLimpOnly` on; the field is outside the sampling key; on: the line is the pool window projected with this hand, younger counts take no action, and a 25% Horse lands at 40-46% with every window at the floor and no catch-up run; when short, every unraised fold becomes the limp; one hand early, only priced limps; the small blind completes for half a big blind, a raised pot and a limp raised behind are the unfloored decision draw for draw, including the four recorded Lightning re-raised lines; nothing at or over the line, with no count, at a table or on All-In-Or-Fold). `server/src/lightning/LightningHorseVpipLedger.test.ts` (the count and its definition of an entered hand).

## Evidence rows

- Mechanism, scope, visibility (receipts), tests: MET.
- Option unset or false (or a truthy non-boolean): decisions identical to the base, draw for draw (test), and recorded decisions replay identically against main (lane report).
- Declared evaluation (audit archive `repairs/LIGHTNING/EVAL-DECLARATION-lightningVpipFloorLimpOnly.md`) run on journal-3: B0-B2 met, B6 INSUFFICIENT (118 sittings, 273 limp-eligible folds). For the redesigned line, the replay and its cost are in `repairs/LIGHTNING/EVAL-RESULTS.md`. Effect on pool speed and on the people in the pool: reported, no bar.

## The 28-minute live run of 2026-11-19 and why it was rolled back

Switched on 2026-11-19 18:27:30Z on engine build dfaa9717f826; rolled back to off at 18:55:37Z on two declared triggers.

Trigger 1, refused decisions. `/health` `liveHorseDecision.recoverableRequestErrors` rose from 0 (18:09Z) to 8, every one `DECIDE_FAST`, `invalid policy receipt: reference_shape`, the last at 18:38:22.516Z. Root cause: a hold'em stack of 15 big blinds or less that is folded to is answered on the route `chart_open_jam` (jam, check or fold). This option turned that fold into the limp inside the reference node, after the route had returned, and `HorsePhase6Attribution.referenceReturnShape` did not know that limp, so the receipt was refused and the engine folded the seat on the liveness fallback. Proven for the three refusals that reached a real turn: the only `horse_fallback` folds on any table between 15:00Z and 19:10Z are NLH 0.50/1.00 fast-table hands 60140196, 60140303 and 60140317 (one Horse on 8.92, 6.92 and 6.92 big blinds, non-blind seat, folded to, one big blind to call; the last at the `/health` timestamp to the millisecond). The other five left no action row and fit that Horse's early looks; only the engine log can show them. `omahaValueSizeIsUnreadable`, switched on at 18:16:58Z and left on, is not involved: the counter has not moved since. The PLO pools never had this defect (an Omaha decision is never on a chart route).

The fix (2026-11-19): `referenceReturnShape` admits exactly the limp `vpipFloorLimpOnlyStep` could produce for this option (and for `vpipFloorLimpOnly`, which had the same hole under 6.67 big blinds), from public facts and the request's options, with no draw. Tests: `server/src/engine/aVpipFloorLimpIsAReferenceReturn.guard.test.ts` and the law `server/src/engine/AReferenceNodeRuleIsAReferenceReturn.law.test.ts`. The option must not be switched on again on a build without that fix.

Trigger 2, pool pace. Declared: hands per 20 minutes within 15% of the baseline, trigger at 25%. Measured from production (`lightning_hand`, `hand_history`, `lightning_hand_player`; before = 17:47:30Z to 18:27:30Z, on = 18:27:30Z to 18:55:37Z, after = the 20 minutes from 18:55:37Z):

| Pool           | Hands per 20 min before / on / after | Change | Mean hand, s       | Horse VPIP %       | Early-look folds % | Flop seen %        | Flop with 3+ players % |
| -------------- | ------------------------------------ | ------ | ------------------ | ------------------ | ------------------ | ------------------ | ---------------------- |
| PLO4 0.25/0.50 | 113.5 / 72.6 / 123.0                 | -36%   | 15.0 / 23.0 / 15.2 | 24.7 / 43.0 / 25.1 | 72.6 / 55.5 / 72.8 | 33.9 / 52.9 / 34.1 | 5.3 / 12.7 / 2.4       |
| PLO4 0.50/1.00 | 85.0 / 63.3 / 106.0                  | -26%   | 21.9 / 30.0 / 16.7 | 28.1 / 44.4 / 25.4 | 71.5 / 55.1 / 72.7 | 38.8 / 59.6 / 34.9 | 2.4 / 13.5 / 3.8       |
| PLO5 1.00/2.00 | 103.0 / 79.0 / 123.0                 | -23%   | 16.8 / 28.4 / 19.0 | 27.0 / 44.1 / 26.1 | 72.3 / 57.7 / 73.0 | 35.0 / 64.9 / 44.7 | 1.0 / 18.9 / 3.3       |
| NLH 0.25/0.50  | 67.5 / 50.5 / 65.0                   | -25%   | 26.8 / 34.0 / 26.9 | 35.0 / 44.1 / 38.4 | 61.6 / 46.2 / 61.6 | 48.9 / 45.1 / 56.9 | 7.4 / 12.7 / 12.3      |
| NLH 0.50/1.00  | 177.5 / 147.2 / 175.0                | -17%   | 22.3 / 24.3 / 24.5 | 32.0 / 41.8 / 33.0 | 65.1 / 47.0 / 65.7 | 51.8 / 36.7 / 54.3 | 8.5 / 11.1 / 10.3      |
| NLH 1.00/2.00  | 77.0 / 68.3 / 80.0                   | -11%   | 22.2 / 23.4 / 22.0 | 37.3 / 43.3 / 38.8 | 63.4 / 49.4 / 60.7 | 56.5 / 43.8 / 52.5 | 11.0 / 18.8 / 6.3      |

The floor was met: Horse VPIP landed at 42-44% in every pool. The wait between hands that the pool records (`waited_ms`) moved little for Horses (median 2.0-2.6 s before, 2.0-3.6 s on, in every pool). One person played, in PLO5 1/2, only while the option was on and just after: 17 hands on (median wait 1.96 s, mean 6.79 s, 95th percentile 29.7 s), 16 hands after (1.23 s, 2.62 s, 7.8 s); there is no before figure for a person.

The lower hand rate is the floor itself, not a second fault. A fast-table pool deals at the speed its players come free. A Horse at its natural 25-28% in PLO folds 72% of its hands on the early look and is free within seconds; to hold 40% over every ten hands it must stay in at least 12 to 15 more hands of each hundred until its turn, and most of those limps see a flop (limped flops rose from 1-2% to 17-20% of PLO hands). In all six pools the measured rate on is within 15% of the baseline rate multiplied by (mean hand before / mean hand on), so the longer hands account for all of it. With the same Horses seated, a PLO pool whose Horses hold the floor by limp-fold cannot stay within 15% of the unfloored rate. The pace can be restored only by seating more Horses in a floored pool (a fill decision), not by this option.

Proposed pass bar for the next activation (the lead decides): (a) 0 refused decisions and 0 `horse_fallback` folds attributable to the option; (b) Horse VPIP per pool 40-46%; (c) per pool, hands per 20 minutes at least 85% of baseline x (mean hand before / mean hand on), which catches any slowdown the longer hands do not explain; (d) for people, median `waited_ms` at most 5 s and no pool with a person seated under 50% of its baseline hand rate (trigger). The raw 15%/25% bar is retired as unattainable for PLO by the ruling's own arithmetic.

## Subsequent live activations and rollbacks (2026-11-20)

- `2026-11-20T09:06:01Z` (audit `#157`, `HORSE SWITCH lane session_01TLQer7hwLjF5AX5cJ4iVM7`): `off -> on`. Rolled back at `2026-11-20T14:09:51Z` (audit `#158`, `on -> off`: Lightning dealt `0` hands since 04:58 Chicago; `HorseFleet: no available horses`, candidates `0`; hourly hands `174` at 03, `105` at 04, `0` at 05-08 vs `375-542` the night before with the option off).
- `2026-11-20T15:18:00Z` (audit `#159`, `HORSE SWITCH lane session_01TLQer7hwLjF5AX5cJ4iVM7`): `off -> on`. Rolled back at `2026-11-20T16:00:15Z` (audit `#160`, `on -> off`: `+40 day read: Lightning hands per player 13.0 (15:38-15:58Z) vs 16.0 the 20 min before (-19%) while yesterday same windows rose 15.5 -> 18.6 (+20%); vs yesterday same window 18.6 (-30%); hand length 23.7 s vs 18.1 s; trigger 25%`).
- Current state (verified `2026-11-22T03:30Z`, serving `c2d6e45e3bcc`): `off` on `8/8` workers (`option_switch_lightningVpipFloorLimpOnly_off_seen = 8`).

## What the activation row must contain

`option = 'lightningVpipFloorLimpOnly'`, `state = 'on'`, note `authority: lightningVpipFloorLimpOnly docs/horse-option-authority.d/lightningVpipFloorLimpOnly.md sha256 <the sha256 of this file as merged>`, written by `fn_ca_horse_option_switch_set`, only after the serving engine build knows the option name and the switch-list migration that adds it is installed.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-19 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it)

## Rollback

Set `lightningVpipFloorLimpOnly` to `off` via the `horse-option-switch` CLI (`fn_ca_horse_option_switch_set('lightningVpipFloorLimpOnly', 'off', '<actor>', '<reason>')`) to restore the base brain within ~30s; zero data migration needed.
