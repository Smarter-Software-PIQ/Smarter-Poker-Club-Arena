# The Classic floor judges thirty dealt hands, and warns before it boots

**Dan, 2026-11-10:** "FOR ALL CLASSIC GAMES THAT ARE .50/1.00 OR HIGHER, YOU
MUST ADD A NEW 20% VPIP ON THOSE GAMES, OR THE PLAYER GETS BOOTED." On the four
values that request left open he then ruled: humans and horses alike, a rolling
thirty dealt hands with a thirty-hand minimum, per-variant floors, and
warn-then-boot with a safe stack cashout. Action and Madness unchanged.

## What already existed

Almost all of it. The nit/VPIP rule has been live since
`20260825_nit_game_vpip_rules_are_enforced`: `tables.nit_game` is the master
switch, `maintain_percent_min` the floor and `maintain_hands` the sample
minimum; `fn_nit_check` judges, `fn_nit_evictions` lists, `fn_nit_status` and
`fn_cash_vpip_status` show, the horse brain steers by its own row, and the
dealing loop stands a seat up at a HAND BOUNDARY through `atomicCashout` with
`leaveMode: 'vpip_evicted'`, which writes Dan's two-hour bar (2026-09-05).
Horses were brought into scope by `20260827_horses_are_players_law`. Forced
blinds already could not count as voluntary: `deriveFlowFlags` sets VPIP from
the player's own `call` or `{bet,raise,all_in}`, and blind posts never reach the
action log.

So this was a configuration change plus two extensions, not a system. What
Classic lacked was a floor at all: `fn_cash_template_defaults` returns
`vpip_floor = 0` for Classic by design (Action is 30-40, Madness 60-70).

## The three changes

**1. Per-variant floors as config, not code.** `fn_cash_template_defaults` is
IMMUTABLE and cannot read a table, so it keeps returning the static template
promise. The Classic floor arrives in `fn_cash_game_floor_from_template`, the
one trigger that rewrites a game's promise on every write to `cash_games`.
Because `fn_cash_cluster_open_table` (new tables) and `fn_cash_apply_ruleset`
(existing tables) BOTH derive `nit_game`, `maintain_percent_min` and
`maintain_hands` from `ruleset_snapshot`, a floor written there reaches every
table the game will ever open, with no change to the creation path at all. That
is what makes the policy survive new tables and engine restarts instead of
decorating today's rows. Classic is identified by `cash_games.template_name`,
never by a display name, and `cash_games` holds cash clusters only, so no
tournament table can reach the rule.

**2. A rolling window, scoped so it cannot touch Action or Madness.** MAINTAIN
used to judge every hand of the sitting above a ten-hand minimum (cumulative,
Dan 2026-09-04). The new mode rides per game in
`ruleset_snapshot.vpip_rolling`, written only inside the Classic branch, so an
Action or Madness snapshot has no such key, reads `false`, and judges exactly as
it does today, ten-hand window included. `fn_nit_sample` is now the ONE sample
definition; `fn_nit_check`, `fn_nit_status`, `fn_cash_vpip_status` and the
enforcement all call it, so no reader can drift from the rule that boots.

**3. Warn, then boot.** `ca_nit_warnings` holds one open warning per sitting,
enforced by a partial unique index. Grace is spent in DEALT HANDS after the
warning, never wall clock, because the hand boundary is the only clock this path
has. Recovery at or above the floor clears the warning; a later lapse takes a
fresh FULL grace, never a shortened one. `fn_nit_enforce` is the live transition
the dealing loop calls at the boundary - it warns, it clears, and it returns a
seat only once that seat's grace is spent and it is still under. It is the rule,
not a net: nothing in it repairs a past outcome (CLAUDE.md 10.11, 10.12). With
`grace_hands = 0` it returns precisely what `collectNitEvictions` returned, so
Action and Madness keep booting on the spot.

## The floors, and the evidence under each

Measured over the three days to 2026-11-11, Classic by `template_name` at
bb >= 1, players with 30+ dealt hands, tournaments excluded:

| Variant    | Floor | p25  | Median | Basis                                        |
| ---------- | ----- | ---- | ------ | -------------------------------------------- |
| nlh        | 20    | 15.5 | 17.1   | Dan's value. Deliberately above the median.  |
| plo4       | 30    | 25.6 | 27.3   | At 20 it catches 4 of 122 and is inert.      |
| plo5       | 50    | 64.1 | 65.0   | Already in force; preserved, not lowered.    |
| plo6       | 50    | 64.0 | 64.8   | Already in force; preserved, not lowered.    |
| plo8       | 30    | -    | -      | PLO family; no 30-hand sample in the window. |
| flo8       | 25    | 22.8 | 25.3   | Fixed-limit Omaha hi-lo is played wide.      |
| flh        | 15    | 13.6 | 16.3   | Fixed-limit holdem is structurally tighter.  |
| short_deck | 20    | -    | -      | No 30-hand sample; judgment, not evidence.   |
| pineapple  | 25    | -    | -      | No 30-hand sample; judgment, not evidence.   |

NLH is 20 and was NOT lowered to suit the current fleet. Every value is one
`UPDATE public.ca_classic_vpip_floors` away, with no deploy.

## Two things worth knowing

**fn_nit_status gains columns, so it had to be dropped.** Postgres refuses
`CREATE OR REPLACE` on a changed return type for a set-returning function. It is
dropped and recreated inside the one transaction, and because a DROP takes the
ACL with it the grants are restored immediately after - `postgres=X`,
`service_role=X`, never anon or authenticated. The proof asserts the ACL is
byte-identical before and after. This was found by testing the migration
against a cluster that pre-created the OLD signatures; a fixture without them
applied clean and would have failed on production.

**The horse fleet will now be evicted from NLH Classic until it widens.** The
brain already reads the new policy by construction - its floor comes from
`tableInfo.maintain_percent_min` and its own figure from `fn_nit_status`, which
is the function this changed - and `vpipFloorMul` widens toward the floor from
three hands on. But the measured fleet sits at a 17.1 median against a 20 floor,
and `vpipFloorCallDown`'s own note records that the multiplier cannot reach a
high floor unaided. That is a HorseLogic strategy question, it belongs to the
horse-brain lane, and it is not expanded into here.

## Proof

`scripts/ci/test-classic-vpip-floor.sh` stands up a throwaway Postgres,
installs the old production signatures, applies the migration and asserts:
exactly thirty hands (29 unjudged, 30 judged), the threshold boundary (6/30 =
20.0 safe, 5/30 = 16.7 not), the rolling window against the cumulative one,
warn-without-boot, recovery clearing and a fresh full grace, no boot at 9 of 10
grace hands and a boot at 10, two concurrent passes booting exactly once,
blind-only orbits counting as dealt hands but never as VPIP, a reconnect keeping
the window and the warning and the grace, Action/Madness untouched, Classic
below 0.50/1.00 carrying no floor, and plo5's stronger 50 preserved. All fifteen
assertions hold. The text invariants are pinned by
`tests/the-classic-floor-warns-before-it-boots.law.test.ts`.
