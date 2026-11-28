# vpipFloorLimpOnlyTenHandWindow: authority for the live switch

**State: OFF (release default OFF in source; registered, never switched on).** Evidence MET for PLO5 only (2026-11-27, lead-8 lane tenhand): switch it on only with the game list `horse.vpipFloorTenHandWindowGame.plo5` = 1 published and accepted first, on a build that carries the game scope (section "Game scope"); with no game listed the switch would act in every game. PLO5 passes every declared bar (correctness; churn 0.52 and 0.56 evictions per table-hour against bars of 0.52 and 0.82; pool), its churn was accepted by the lead by name, and its audited replay rows are below. For hold'em, PLO4 and PLO6 the declared churn bar is not met (measurement of 2026-11-19 below): they stay unlisted until the owner or the lead accepts their rate by name. Mechanism, scope, receipts, tests and off-identity are MET, and the floor makes no raise and no call of a raise in any measured cell. Nothing in this change switches anything.

## The owner's orders it rests on (verbatim)

- 2026-11-17 14:34 America/Chicago: "Table VPIP must limp fold for a bb. smh nothing else if there vpip drops."
- 2026-11-17 18:38 America/Chicago: "its fine, with a 30 hand grace period, horses should be close to 40% with limp folds in the range. and if they aren't the get booted and replaced with a new horse."

## What it does

`vpipFloorLimpOnly` (on in production) leaves one kind of floored cash table on the old floor on purpose: a table KNOWN to be judged the Action or Madness way, the whole sitting at ten hands or fewer with no warning and no grace (`vpipFloorLimpOnlyTenHandTable` in `server/src/engine/HorseLogic.ts`; "known" needs the Horse's own judged row, which carries the policy window). There the floor still widens ranges and calls raises, and each decision fires `vpip_floor_limp_only_not_governed_ten_hand_window`.

With `vpipFloorLimpOnlyTenHandWindow` on TOGETHER WITH `vpipFloorLimpOnly`, such a table is governed like every other floored cash table (`vpipFloorLimpOnlyApplies` is true there): the floor no longer widens a preflop bar (`vpipFloorMul`), calls a raise (`vpipFloorCallDown`) or swaps an intent (`omahaVpipFloorByLimp`). Its one action is `vpipFloorLimpOnlyStep`, unchanged: a Horse whose own judged VPIP is under its line (`vpipLimpTargetFor` of the floor and window the table carries: 7 of 10 on a 40% table judged at ten) turns a preflop fold in a pot nobody has raised, for at most the big blind and less than its stack, into the limp or the small blind's completion, by the variant's own selection (`VPIP_FLOOR_LIMP_ONLY_VARIANTS`: the priced limps on hold'em and PLO4, every such fold on the others). Having limped and been raised, the unfloored decision stands. No straddled hand; no judged sample yet (under three hands) means no action. A Horse that still falls under the floor is evicted and replaced by the existing enforcement, which in this mode acts on the spot.

Alone (with `vpipFloorLimpOnly` off) it does nothing. It adds no threshold: the line, the selection and the pricing are those of `vpipFloorLimpOnly`. Scope is `vpipFloorLimpOnlyInScope`, unchanged: never a tournament, All-In-Or-Fold, a bomb pot or Lightning. The floor, the window, the eviction and the two-hour bar are untouched.

Default OFF in source (read `=== true`). Off (unset, false or a truthy non-boolean), every decision is the one it was, draw for draw, and the not-governed receipt fires as before.

## Where it would act (read-only production reads, 2026-11-19 about 18:30Z and 19:58Z)

17 floored cash tables carry this mode, all six-max, floor 40, window 10, club fade0000: hold'em 4, PLO4 3, PLO5 4, PLO6 3, PLO8 1, short deck 2. Twelve of them are the host tables of the "Lightning Games" (every hold'em and PLO4 one, three PLO5, two PLO6): a pool's hands are decided on the Lightning path, which this option never touches (`lightningVpipFloorLimpOnly` is the option there). That reading rests on the scope code and on the Lightning floor's own record (a Lightning anchor does not run a table's dealing loop); it was not traced per table. So the tables this option would act on today are five: "PLO5 0.10/0.25 Classic", "PLO6 0.10/0.25 Classic", "PLO8 0.25/0.50 Action" and the two short deck "Madness" tables. All five were empty at the first read; the PLO6 table dealt 90 hands in the two hours before the second. `vpip_floor_limp_only_not_governed_ten_hand_window` fired 20,683 times on 2026-11-19 up to the first read, against 172,805 `vpip_floor_limp_only_seen`. The hold'em and PLO4 rows below describe a table production does not have today; of the four variants it does have, PLO6 is the one over the churn bar.

## Measurement (declared before the run)

Audit archive `repairs/TENHAND`: `EVAL-DECLARATION.md` (sha256 2119e9e606158b61577a7edd719d56e4328dd7a9fc239f42023a7d6b02cfa0d4, written 2026-11-19T18:40Z before the runs), `EVAL-RESULTS.md`, raw files. The sitting simulator of `HorseVpipFloorLimpOnly.test-support.ts` in `sittingMode`: the whole sitting is the sample, judged at every hand boundary from hand ten, under 40% is an eviction on the spot and a fresh Horse takes the chair. "Today" is production's state for these tables (vpipFloorLimpOnly on, the table not governed, the old floor). Table-hour: 54 hands (the production figure the F-10 evaluation used).

Six Horses in self-play, 8 tables of 300 hands per cell (2,400 table hands):

| table (floor 40, sitting judged at ten) | selection | Horse VPIP today | Horse VPIP on | evictions today | evictions on | per table-hour on | Horses barred at once per table | floor chips bb per 100 Horse hands, today | on   | floor raises on | floor calls of a raise on (today) |
| --------------------------------------- | --------- | ---------------- | ------------- | --------------- | ------------ | ----------------- | ------------------------------- | ----------------------------------------- | ---- | --------------- | --------------------------------- |
| Hold'em                                 | priced    | 56.0%            | 51.2%         | 0               | 44           | 0.99              | 2.0                             | 106.5                                     | 26.4 | 0               | 0 (2,876)                         |
| PLO4                                    | priced    | 70.0%            | 51.9%         | 0               | 29           | 0.65              | 1.3                             | 111.2                                     | 25.7 | 0               | 0 (2,816)                         |
| PLO5                                    | every     | 69.9%            | 58.4%         | 0               | 23           | 0.52              | 1.0                             | 117.6                                     | 31.1 | 0               | 0 (3,092)                         |
| PLO6                                    | every     | 55.9%            | 53.0%         | 0               | 48           | 1.08              | 2.2                             | 142.3                                     | 26.0 | 0               | 0 (3,135)                         |
| PLO8                                    | every     | 55.9%            | 62.7%         | 0               | 10           | 0.23              | 0.5                             | 110.2                                     | 37.2 | 0               | 0 (2,448)                         |
| Short deck                              | every     | 57.3%            | 60.0%         | 0               | 6            | 0.14              | 0.3                             | 55.4                                      | 20.4 | 0               | 0 (1,757)                         |

One chair on the production spot mix, 8 chairs of 300 hands, a fresh Horse after every eviction (evictions; the rate for five Horse seats per table-hour): hold'em 12 (1.35), PLO4 15 (1.69), PLO5 5 (0.56), PLO6 20 (2.25), PLO8 7 (0.79), short deck 1 (0.11); today 0 in every cell. Horse VPIP on: 48.2%, 46.2%, 52.0%, 51.7%, 53.3%, 56.9%.

What the numbers say:

- The floor's cost falls by 35 to 116 big blinds per 100 Horse hands (to between 20 and 37), and every floor call of a raise and every floor raise is gone.
- Today's floor evicts no Horse in these runs. On, a six-Horse table loses a Horse between once every 55 minutes (PLO6) and once every seven hours (short deck); each eviction is a two-hour bar on that game for that Horse. 42% to 67% of the evictions fall at the sitting's tenth hand: a new Horse has no judged sample for its first three hands, the mode has no grace, and limping cannot enter the hands that already face a raise (44% to 62% of first decisions here).
- The pool is not exhausted: at most 2.2 Horses barred at once per table against 385 Horse members of the club (an upper bound on eligibility).
- Informational: on hold'em the selection 'every' evicted fewer than the shipped 'priced' (26 against 44 at the table, 9 against 12 for one chair) for 6.7 more big blinds per 100 hands; on PLO4, 27 against 29 and 7 against 15 for 10 more. The shipped selections were measured on thirty-hand tables and are not changed here.

Against the declared bars:

1. Correctness (0 floor raises, 0 floor calls of a raised pot on every cell with the option on, both models): MET.
2. Churn within what the owner's ruling was given for (at most 0.52 evictions per table-hour on the six-Horse model and 0.82 on the one-chair model, the highest measured on a thirty-hand table at 40%): PLO5 (0.52, 0.56), PLO8 (0.23, 0.79) and short deck (0.14, 0.11) pass; hold'em (0.99, 1.35), PLO4 (0.65, 1.69) and PLO6 (1.08, 2.25) do NOT.
3. Pool not exhausted: MET.

So the evidence for switching on is NOT MET as declared for every variant at once. Since 2026-11-27 the switch can be confined to games (section "Game scope" below); PLO5 alone passes the churn bar.

## Game scope (lead-8 lane tenhand, 2026-11-27)

Engine runtime settings `horse.vpipFloorTenHandWindowGame.nlh`, `.plo4`, `.plo5` (0 or 1, compiled default 0; `server/src/engine/HorseVpipFloorTenHandWindowGames.ts`). None set to 1: the switch acts in every game it acts in above (unchanged). Any set to 1: the switch is on only at a ten-hand table whose variant is listed and reads as off (today's exception) at every other table, PLO4, hold'em, PLO6, PLO8 and short deck included. One read site (`vpipFloorLimpOnlyTenHandWindowOn`), used by `vpipFloorLimpOnlyGovernsTenHandTable` and `vpipFloorLimpOnlyApplies`. The list never turns the switch on. Law: `server/src/engine/aVpipFloorTenHandWindowIsScopedByGame.law.test.ts`.

PLO5 against the declared bars: correctness MET; churn 0.52 (six-Horse) and 0.56 (one chair) per table-hour against bars of 0.52 and 0.82: MET; pool MET. Churn accepted by the lead by name (lead-8, 2026-11-26 11:45 PM Chicago, LEAD8-STATE: "end the exception for PLO5 ten-hand tables first, evictions 0.52 per table-hour, inside the accepted level"). Hold'em, PLO4 and PLO6 stay NOT MET on churn and must stay unlisted.

Order: a serving engine refuses a whole settings version that names a key it does not register, so `horse.vpipFloorTenHandWindowGame.plo5 = 1` is published only after a build with this scope serves on every engine host, and it is published and accepted BEFORE the switch row goes on (the switch tool does not check the scope; with no list the switch would act in every game).

## Cost (2026-11-27, lead-8 lane tenhand)

Engine's own `HorseLogic.decide` on the compiled build, the real PLO4/PLO5 floored preflop nodes of lane preflop (hands with a person, 2026-11-20 to 11-27; public actions and the deciding Horse's own cards only), each made a table KNOWN to be judged at ten hands (window 10, the Horse's own judged row 10 hands at 30%), production option set plus `vpipFloorLimpOnly`; host load about 17. Arms: today (switch off), on with no list, on with the list [plo5].

| game | arm             | spots | p50 ms | p95 ms | max ms | over 25 ms | over 50 ms |
| ---- | --------------- | ----- | ------ | ------ | ------ | ---------- | ---------- |
| PLO5 | today           | 4,786 | 0.22   | 0.96   | 2.80   | 0          | 0          |
| PLO5 | on, no list     | 4,786 | 0.19   | 0.94   | 3.23   | 0          | 0          |
| PLO5 | on, list [plo5] | 4,786 | 0.18   | 0.93   | 2.84   | 0          | 0          |
| PLO4 | today           | 284   | 0.58   | 1.66   | 3.08   | 0          | 0          |
| PLO4 | on, no list     | 284   | 1.38   | 9.19   | 24.65  | 0          | 0          |
| PLO4 | on, list [plo5] | 284   | 0.56   | 1.74   | 6.88   | 0          | 0          |

PLO5 is inside the bar (p95 <= 10 ms, max <= 25 ms, nothing over 50 ms). With the list [plo5] every PLO5 decision equals the switch on (4,786 of 4,786) and every PLO4 decision equals today (284 of 284). PLO4 on (the priced limp) is close to the bar on fewer than 500 spots: measure again before PLO4 is listed. On these nodes (limps and limps raised behind) no PLO5 action changes with the switch on, because today's old floor already limps and folds there through `omahaVpipFloorByLimp`; the receipts move from `vpip_floor_limp_only_not_governed_ten_hand_window` to `vpip_floor_limp_only_governed_ten_hand_window`. The decisions the switch changes are the old floor's widened opens and its call-downs of raises (`vpip_floor_call_down`), measured in the sitting model above.

## Prior anchor

None needed: the option prices nothing and reads no population or opponent statistic. It removes the old floor's widening (`vpipFloorMul`), call-down (`vpipFloorCallDown`) and intent swap (`omahaVpipFloorByLimp`) at ten-hand tables, which is the owner's ruling as written; the one action left is `vpipFloorLimpOnlyStep`, whose priced limp (hold'em, PLO4) is that of `vpipFloorLimpOnly` and uses no person-or-Horse prior. No hidden card is read.

## Receipts

`vpip_floor_limp_only_governed_ten_hand_window` (new: a ten-hand table governed by this option; fires beside `vpip_floor_limp_only_seen`), then the existing `vpip_floor_limp_only_limp`, `vpip_floor_limp_only_fold_kept`, `vpip_floor_limp_only_priced_out`. With this option on, `vpip_floor_limp_only_not_governed_ten_hand_window`, `vpip_floor_call_down` and the `omaha_vpip_floor_` receipts do not fire on these tables. With it off, `vpip_floor_limp_only_not_governed_ten_hand_window` fires as before.

## Tests

- `server/src/engine/HorseVpipFloorLimpOnlyTenHandWindow.test.ts`: the scope functions (both options needed, read `=== true`, never a tournament, All-In-Or-Fold, a bomb pot, Lightning or an unfloored table; a Classic table and a table whose window is not known are unchanged); off (unset, false, a truthy non-boolean, and the option alone) decides byte for byte and draw for draw as today on hold'em, PLO4, PLO5 and PLO6, with the old receipt; on: facing a raise or a re-raise the decision is the unfloored one on every hand, in an unraised pot a hand the unfloored brain folds limps for exactly the price to call and every other hand is unchanged, a limp raised behind is not called by the floor, at or over the line and with no judged sample nothing changes; the sitting model of the mode. The existing floor suites and `HorseVpipFloorLimpOnly.test.ts` pass unchanged.
- `server/src/engine/aVpipFloorLimpIsAReferenceReturn.guard.test.ts`: the ten-hand table guard case verifies that short-stack hold'em `chart_open_jam` limps produced with `vpipFloorLimpOnlyTenHandWindow` on (including under 6.67bb) pass `necessaryReferenceRouteGates` and `horsePhase6AttributionMismatch`, and that `referenceReturnShape` admits them only under the line on a floored cash table.

## Evidence rows

- Mechanism, scope, visibility (receipts in `HorseDataLedger.ts`), tests, off-identity: MET.
- No floor raise and no floor call of a raise with the option on: MET (measured, both models, six variants).
- Horse churn: measured offline and stated above; over the declared bar on hold'em, PLO4 and PLO6: NOT MET.
- Value and continuation in live play: NOT MEASURED (the league seats no floored table; refused matchups `<variant>_vpip_floor_limp_only_ten_hand_window`, 0 of 300 pairs diverged on each, seed 20261119).

## What the activation row must contain

`option = 'vpipFloorLimpOnlyTenHandWindow'`, `state = 'on'`, note `authority: vpipFloorLimpOnlyTenHandWindow docs/horse-option-authority.d/vpipFloorLimpOnlyTenHandWindow.md sha256 <the sha256 of this file as merged>`, written by `fn_ca_horse_option_switch_set` (service role, audited actor), with `vpipFloorLimpOnly` on, only on a build that carries the floor-limp reference admission of #11401 (`62520794347a`, merged on `main`: `HorsePhase6Attribution.vpipFloorLimpOnlyShape`), and only once the churn above has been accepted by the owner or the lead by name and the Replay bar below is met. Without that admission the limp this option makes was refused as `reference_shape` wherever the older call-down could not admit it and the engine folded the seat on the liveness fallback: before #11401, 128 of 718 limps over hold'em first-in spots at 5.85 to 100 big blinds (40% judged at ten) were refused, all on `chart_open_jam`; with #11401 merged, 0 of 718 (scratch check, 2026-11-19 14:32 Chicago, now pinned by the ten-hand table case in `server/src/engine/aVpipFloorLimpIsAReferenceReturn.guard.test.ts`). The `## Replay` section below is present and remains `NOT RUN`; the maintained rollback (the row off, about 30 s) restores today's floor on these tables exactly.

## Limits

Offline model, not a live table: six Horses with no reads and no human, preflop only; the one-chair spot mix was measured at a thirty-hand PLO5 table and applied to every variant; PLO8 and short deck run on the same six-seat blind-and-ante table (production short deck structure was not checked) and the limp's pricing model was never checked on hi-lo or short deck (they ship 'every', which prices nothing); the option base is the set production decided with at release 28372c9a plus `vpipFloorLimpOnly`, not the switch set production carries today; the table-hour of 54 hands was measured on a thirty-hand PLO5 table. Who fills a vacated chair and how fast was verified for thirty-hand tables only (audit archive `repairs/F-10/REPLACEMENT-MECHANIC.md`).

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 869; unjudged 0; set PLO-hand-audit-daily-2026-11-25T230000Z; scorer 5302af2ab3e; source placed verdict-only; arm TH vs off; replayed 869 of 869
- Replay: fixed 0; newlyWrong 0; changed 0; unchanged 2697; unjudged 0; set PLO-hand-audit-2026-11-20-to-24; scorer 5302af2ab3e; source placed verdict-only; arm TH vs off; replayed 2697 of 2697

What the rows mean (2026-11-27): no audited decision changes, because an audited node is replayed from the stored public node, which carries the table's floor and window but not the Horse's own judged row, so no audited table is KNOWN to be judged at ten hands (`vpipFloorLimpOnlyTenHandTable` needs that row) and the option has nothing to act on there. The audits hold no decision the option would have changed; what it changes is measured by the sitting model above and by the real-node run in "Cost" above.

## Rollback

If enabled, set `vpipFloorLimpOnlyTenHandWindow` to `off` via the `horse-option-switch` CLI (`fn_ca_horse_option_switch_set('vpipFloorLimpOnlyTenHandWindow', 'off', '<actor>', '<reason>')`) to restore the base brain within ~30s; zero data migration needed.
