# huSmallBlindStealsVsTightBigBlind: authority for the live switch

Heads Up lane option D6 (2026-11-15, heads-up serving policy), default OFF in source, read once as `opts.huSmallBlindStealsVsTightBigBlind === true` (server/src/engine/HorseLogic.ts). It widens the heads-up small blind's first-in opening range, and its name matches the steal pattern of `OFF_ONLY_PATTERNS` in server/src/engine/HorseOptionSwitch.ts, so it is registered off-only (status `hold`, source `owner hold: blind steal; owner ruling 2026-11-14 21:30 Chicago (tight steal responses stay OFF)`; allowed states `off` only). Status: built, OFF, Evidence NOT MET. Its declared development evaluation was SUPPORTED (nit 40bb cash `+13.75 +/- 0.98` bb/100), and the exact-head review's test-only prerequisite (law cases pinning the fold-share estimate's three assumptions in server/src/engine/HorseHeadsUpSmallBlindStealsVsTightBigBlind.law.test.ts) is now satisfied (PR #11670, `64a9d8b8ba`), but the owner's 2026-11-14 steal ruling holds it off, no lift by name exists, and no replay on real audited decisions has been run. Missing, in order: the owner lifting the steal hold for this name; scorer-written Replay rows on the corrected replay history (#11556).

## What it does

Code: server/src/engine/HorseHuTightBigBlindSteal.ts (huTightFolderRead, huTightBigBlindSteal), server/src/engine/HorseMind.ts (huTightFolderReadOf), server/src/engine/HorseLogic.ts (scope gate and the one read), server/src/engine/HorsePreflop.ts (open bar).

Heads-up no-limit hold'em, exactly two dealt in, the small blind first in with no limper and no prior action, 20-150bb effective: when the big blind is a proven tight folder (at least 15 decayed holdem:hu hands, VPIP credibly at or below 0.6 of the heads-up population mean, no preflop statistic engaged high, no maniac width, the fast window not raising again) and his estimated fold share 1 - 2 x VPIP clears the largest heads-up open's break-even on folds alone (cash 3.5bb, tournament 2.5bb), every hand opens. Cash, and a tournament only when its trusted context says exactly two players are left and it is not a satellite. Widen-only (a would-be limp or fold becomes an open); no size or jam change, nothing facing action; three or more dealt, Omaha, short deck, pot and fixed limit, straddles, bomb pots and All-In-Or-Fold unchanged. Ledger: flag `huSmallBlindStealsVsTightBigBlind` (tag HuDefence).

## Receipts

hu_tight_big_blind_steal (server/src/engine/HorseDataLedger.ts): counted when the spot qualifies (every hand considered for the open), including hands that would have opened anyway and hands a later layer still does not open. It is not a count of changed decisions.

## Tests

- server/src/engine/HorseHeadsUpSmallBlindStealsVsTightBigBlind.law.test.ts (docs/laws.d/server-src-engine-HorseHeadsUpSmallBlindStealsVsTightBigBlind.md), including the exact-head review (0039d2bc, N5) law cases pinning the fold-share estimate's three assumptions.
- server/src/engine/HorseOptionSwitchPreflopHoldLift.test.ts: the steal stays off-only beside the huBbDefendsUnreadToPrice lift (docs/changelog/2026-11-20-heads-up-big-blind-hold-lifted-by-name.md).

## Evidence rows

Rows of docs/HORSE-DECISION-CHANGE-EVIDENCE.md. Nothing was run for this file; every number below is copied from the record named beside it.

- Mechanism, scope, receipt, tests: recorded (docs/changelog/2026-11-15-heads-up-small-blind-steals-vs-a-tight-big-blind.md).
- Value (development only): declared evaluation `hu-audit-01UxDLnM/round2/d68/DECLARATION-HU-D6.md`, results `round2/d68/RESULTS-HU-D6.md`, arm A (on) minus arm B (live), 25,000 pairs per cell per phase: nit 40bb cash `+13.75 +/- 0.98` development, `+12.64 +/- 0.88` confirmation; nit 100bb cash `+10.42 +/- 0.98` / `+11.13 +/- 1.21`; nit 30bb two left in a heads-up SNG `+17.89 +/- 1.04` / `+20.35 +/- 1.07`; fold-sb-defend-bb 40bb `+0.30 +/- 0.14` / `+0.30 +/- 0.23`; 100bb `+0.16 +/- 0.05` / `-0.15 +/- 0.13`; wide, calibrated, mirror and memory-off cells inert. Declared rule SUPPORTED. Scripted personas on the calibrated profile and Horse mirrors, not human play; no rake; measured without huBbDefendsUnreadToPrice (the two were never measured together) (same changelog).
- Owner authority: NOT MET. The steal hold (owner ruling 2026-11-14 21:30 Chicago) holds it off; the option's own changelog says "Not proposed for activation", and the 2026-11-20 lift changelog records the steal as unchanged.
- Review limits: MET (test-only prerequisite, 2026-11-21, PR #11670 `64a9d8b8ba`; docs/changelog/2026-11-21-hu-sb-steal-fold-share-assumptions-law.md). The exact-head review (Hand Analysis, 0039d2bc, N5) required a law case pinning the three assumptions of the fold-share estimate (posterior mean VPIP, half the counted hands as big blinds, walks and limped pots not separated) before any activation proposal; server/src/engine/HorseHeadsUpSmallBlindStealsVsTightBigBlind.law.test.ts now pins all three. This satisfies the test-only prerequisite only and does not lift the owner blind-steal hold or satisfy the Replay bar.
- Replay on real audited decisions: NOT MET (see Replay).

## Replay

Machine-read (README.md, "The Replay row").

- Replay: NOT RUN (off-only under the owner's 2026-11-14 steal hold; no audited-decision replay was scored, and any replay must use the corrected history of #11556, which removed forced posts from replayed preflop actionHistory)

## Rollback

If enabled, run `horse-option-switch.mjs set huSmallBlindStealsVsTightBigBlind off --rollback` (`fn_ca_horse_option_switch_set('huSmallBlindStealsVsTightBigBlind', 'off', '<actor>', '<reason>')`) to restore the base brain within ~30s; zero data migration needed.
