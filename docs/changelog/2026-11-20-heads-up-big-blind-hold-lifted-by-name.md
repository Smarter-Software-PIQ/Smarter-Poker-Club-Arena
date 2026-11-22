# 2026-11-20 The owner preflop range hold is lifted by name for huBbDefendsUnreadToPrice (still default OFF)

Antigravity Coordinator (session_01UxDLnHu4P9fWx3X7Mp5FjM), heads-up lane work. Nothing is switched on by this change.

## Why

Heads-up, the Horse big blind folds about 57-59% to a 2-3bb open when it has no read on the opener (57.4% at 80bb, docs/changelog/2026-11-07-horse-hu-bb-defends-to-its-price.md; about 58.7% at 15-50bb, heads-up audit HU-NLH-001). A minimum raise profits with any two cards once the big blind folds more than half the time. The fix, `huBbDefendsUnreadToPrice` (HU-NLH-001d, 2026-11-15), has been on main default OFF and off-only: it changes a preflop range, so the switch refused `on` for it under the owner preflop range hold until the owner lifted the hold by name.

## Owner order

Dan's exact message of 2026-11-20 15:01 America/Chicago to the Antigravity Coordinator chat, about the Heads Up, Hold'em, PLO6, Lightning, Limit, Human vs Horse and Hand Analysis lanes:

> YOU OWN THIS CODE BASE AND ARE TO MAKE ANY AND ALL DECISIONS, CHANGES, UPGRADES, ENHANCEMENTS ETC. AND COORDIANTE WITH THE ENGINE CUT OVER, HORSE DECISIONS AND ON OFF SWITCH CHATS AS NEEDED.

Under that delegation the coordinator lifted the hold for `huBbDefendsUnreadToPrice` by name, alone.

## What changed

- `server/src/engine/HorseOptionSwitch.ts`: `huBbDefendsUnreadToPrice` leaves `OPTION_SWITCH_OFF_ONLY` and gains an entry in `OPTION_SWITCH_PREFLOP_HOLD_LIFTED` (owner text, the owner-text record's file name and sha256 as supplied by the coordinator; the record is in the evidence archive). It is also listed in `OPTION_SWITCH_RELEASE_DEFAULT_OFF`: its one read is `opts.huBbDefendsUnreadToPrice === true`, so its release default is off (it had reported 'code' while off-only). Its states are now `off`, `shadow`, `on_shadow`, `on`.
- `supabase/migrations/20261120210905_horse_option_switch_heads_up_big_blind_hold_lift.sql`: the database lists, written by `server/scripts/gen-horse-option-switch-sql.ts --follow-up` (version from `scripts/reserve-migration-version.sh`). Against the previous list migration the only difference is this one name: out of the off-only list, into the shadow and on_shadow lists. One transaction, `lock_timeout` 3s, three ALTERs on `public.ca_horse_style_switch` (one row per switched option), no live table. It adds no row and switches nothing. `scripts/ci/test-horse-option-switch-evidence-postgres.sh` carries the same lists.
- `server/src/engine/HorseOptionSwitchPreflopHoldLift.test.ts`: a new case for this lift (states, release default, the entry's owner text, file and digest; `huBbDefendsToPrice`, `huOpenerDefendsToPrice`, `huLimpDefendsToPrice` and the steal still off-only). One pin moved deliberately: the exact key list of the lift map now has three names.
- `docs/horse-option-authority.d/huBbDefendsUnreadToPrice.md`: new, status "Evidence NOT MET", Replay NOT RUN.

## What did not change

- No decision. With no switch row the option key is not passed and the source default (off) decides.
- `huBbDefendsToPrice` stays off-only: its declared evaluation did not support it (HU-NLH-001c, human field at 25-40bb +0.53 +/- 0.46 bb/100). `huOpenerDefendsToPrice`, `huLimpDefendsToPrice`, `huSmallBlindStealsVsTightBigBlind` (the steal hold) and every other held option are exactly as they were.
- No workflow, release script or engine release file.

## Evidence state

Not met; see the authority file. A league run made for this change (card `human_hu_bb_defends_unread_vs_minraise_40bb`, 12,000 pairs, 24,000 hands per seed, arm A on minus arm B off): seed 20261120 +16.48 +/- 3.71 bb/100, seed 20261121 +17.95 +/- 3.76 bb/100, 0 illegal actions, 0 truncated streets, 0 fallbacks. That is one scripted persona with reads held off, the case the option was written for; it is development evidence. Figures reported by the Heads Up lane, source file in the evidence archive (extreme-archive/hu-audit-01UxDLnM/round2/bbdef/RESULTS-HU-NLH-001d.md), not yet verified by the coordinator: +2.58 +/- 0.26 bb/100 cash with no read, +7.44 +/- 0.79 with two left in a tournament, and a 2026-11-17 league result of +15.28 +/- 3.38 bb/100 over 24,000 hands. No replay on real audited decisions is recorded.

## To switch it on later

The option's own citation (`authority: huBbDefendsUnreadToPrice <file> sha256 <digest>`) after the authority file states "Evidence MET" with run rows, and only once the serving engine is built from a commit that carries this registry and the migration above is installed. `shadow` can be set before that: it acts as off and records the counterfactual.
