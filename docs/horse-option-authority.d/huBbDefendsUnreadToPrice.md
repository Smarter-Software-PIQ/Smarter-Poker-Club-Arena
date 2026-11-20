# huBbDefendsUnreadToPrice: authority for the live switch

Heads Up lane option HU-NLH-001d (2026-11-15), default OFF, read once as `opts.huBbDefendsUnreadToPrice === true`. It widens a big-blind preflop calling range, so it was registered off-only under the owner preflop range hold; that hold was lifted for this option alone on 2026-11-20 (see "Owner authority" below). The lift makes the switch accept `off`, `shadow`, `on_shadow` and `on`; it switches nothing on. Evidence NOT MET: no replay on real audited decisions is recorded, and the league and declared-evaluation results are not in this repository. **Do not switch on until its evidence rows are met.**

## Owner authority

Dan's exact message of 2026-11-20 15:01 America/Chicago to the Antigravity Coordinator chat, about the Heads Up, Hold'em, PLO6, Lightning, Limit, Human vs Horse and Hand Analysis lanes:

> YOU OWN THIS CODE BASE AND ARE TO MAKE ANY AND ALL DECISIONS, CHANGES, UPGRADES, ENHANCEMENTS ETC. AND COORDIANTE WITH THE ENGINE CUT OVER, HORSE DECISIONS AND ON OFF SWITCH CHATS AS NEEDED.

On that order the Antigravity Coordinator (session_01UxDLnHu4P9fWx3X7Mp5FjM) lifted the owner preflop range hold for huBbDefendsUnreadToPrice by name, alone. The lift is recorded in source: `OPTION_SWITCH_PREFLOP_HOLD_LIFTED.huBbDefendsUnreadToPrice` in server/src/engine/HorseOptionSwitch.ts (owner-text record `antigravity-coordinator-01UxDLnH/OWNER-TEXT-20261120-ANTIGRAVITY-COORDINATOR-VERBATIM.md`, sha256 `90351f60b2dbcd6f7ce541d137fe4139c988893abf074e49de6031e5e2d9013e`, read 2026-11-20T21:15:22Z, 1,595 bytes; the record is in the evidence archive, not in this repository). huBbDefendsToPrice, huOpenerDefendsToPrice, huLimpDefendsToPrice and every other owner preflop range hold entry stay off-only. The database lists are migration 20261120210905_horse_option_switch_heads_up_big_blind_hold_lift.sql, written by server/scripts/gen-horse-option-switch-sql.ts.

## The defect it answers

Heads-up, the Horse big blind folds about 57-59% to a 2-3bb open when it has no read on the opener: 57.4% at 80bb measured with the real HorseLogic.decide (docs/changelog/2026-11-07-horse-hu-bb-defends-to-its-price.md) and about 58.7% at 15-50bb (heads-up audit HU-NLH-001, docs/changelog/2026-11-15-heads-up-big-blind-defends-unread-to-price.md). A minimum raise profits with any two cards once the big blind folds more than half the time. The two-handed table never reaches the per-seat defence (V72 returns early under three dealt in) and falls to the V11 heads-up bars, which read neither the price nor the opener's width. Once a read on the opener engages, the live brain already adapts (fold 2.2% against a read every-button min-raiser), so the defect is a no-read defect.

## What it does

Code: server/src/engine/HorseHuBbDefence.ts (HU_BB_UNREAD_REALIZATION 0.7, HU_BB_UNREAD_MAX_STACK_BB 50, huBbUnreadRequiredEquity), server/src/engine/HorseLogic.ts (huBbUnreadPrice, the one read of the option), server/src/engine/HorsePreflop.ts (the call branch).

Heads-up no-limit hold'em, exactly two dealt in, the big blind facing the only open (no limp, no caller, opener not all in, open above 1.05bb and at most 6bb), 20-50bb effective, the opener with no engaged RFI/PFR read: a fold becomes a call when the class's all-in equity against the V70 heads-up reference open width (72% cash, 76% with an ante), times 0.7, covers the rake-aware pot odds. Cash, and a tournament only when its trusted context says exactly two players are left in the event and it is not a satellite. Widen-only and call-only: it never makes a fold, never changes a call or a raise, and never invents a raise. An engaged read, more than 50bb, three or more dealt in, a larger field, a satellite, a missing or untrusted tournament context, Omaha, short deck, pot and fixed limit, straddles, bomb pots and All-In-Or-Fold tables keep the option-off answer. Off (absent or false): no decision changes.

It supersedes huBbDefendsToPrice for the no-read case. That option was not supported by its declared evaluation (HU-NLH-001c: human field at 25-40bb +0.53 +/- 0.46 bb/100, not significant) and stays off-only under the owner preflop range hold.

## Receipts

hu_bb_defends_unread_to_price (server/src/engine/HorseDataLedger.ts, tag HuDefence): counted only for a call that is still the final decision, and only where every later layer of the branch would have folded.

## Tests

- server/src/engine/HorseHeadsUpBigBlindDefendsUnreadToPrice.law.test.ts (29 cases; docs/laws.d/server-src-engine-HorseHeadsUpBigBlindDefendsUnreadToPrice.md): default off and explicit false identical to unset; only fold to call; the price decides; 20-50bb only; a tournament only with two left, trusted and not a satellite; stands aside on an engaged read; out-of-scope tables; receipts equal changed final decisions; the brain reads the option once, as `=== true`.
- server/src/engine/HorseOptionSwitchPreflopHoldLift.test.ts: the lift entry (owner text, file, digest), the states `off`, `shadow`, `on_shadow`, `on`, release default off, and its heads-up siblings still off-only.

## Evidence rows

Rows of docs/HORSE-DECISION-CHANGE-EVIDENCE.md.

- Mechanism, scope, visibility (receipt), tests: MET (the changelogs and the law test above).
- Option unset or false changes nothing: MET (law test above).
- Value: NOT MET in this repository. The declared evaluation DECLARATION-HU-NLH-001d.md and its results RESULTS-HU-NLH-001d.md are in the evidence archive, not here. Figures reported by the Heads Up lane, source file in the evidence archive (extreme-archive/hu-audit-01UxDLnM/round2/bbdef/RESULTS-HU-NLH-001d.md), not yet verified by the coordinator: +2.58 +/- 0.26 bb/100 cash with no read, +7.44 +/- 0.79 bb/100 with two left in a tournament, and a 2026-11-17 league result of +15.28 +/- 3.38 bb/100 over 24,000 hands. The changelog of 2026-11-15 calls that evaluation development evidence only (scripted personas, a six-max-fitted calibrated profile, Horse mirrors, empty solver stores).
- Input fidelity, continuation, reach on recorded hands: NOT MET. No replay on real audited decisions is recorded (see Replay).

- League, run in this repository on 2026-11-20 (development evidence, one scripted persona, not a measurement against people): card human_hu_bb_defends_unread_vs_minraise_40bb through `runMatchup(card, 12000, seed)`, engine tree 95dae3848 plus this lift (which changes no decision), EQUITY_GOVERNOR=off, the unit-test database placeholders (no database is read). Arm A (option on) minus arm B (live default), duplicate deals:

  | seed     | pairs  | hands  | A minus B, bb/100 | standard error (per pair) | block standard error (40 blocks) | divergent pairs | illegal, truncated, corrected, fallbacks |
  | -------- | ------ | ------ | ----------------- | ------------------------- | -------------------------------- | --------------- | ---------------------------------------- |
  | 20261120 | 12,000 | 24,000 | +16.48            | 3.71                      | 3.11                             | 2,610           | 0, 0, 0, 0                               |
  | 20261121 | 12,000 | 24,000 | +17.95            | 3.76                      | 3.76                             | 2,592           | 0, 0, 0, 0                               |

  Each arm's own result against the field: seed 20261120 arm A +17.70 +/- 8.42, arm B +1.22 +/- 7.58 bb/100; seed 20261121 arm A +27.88 +/- 8.23, arm B +9.93 +/- 7.34 bb/100 (12,000 hands per arm). The persona raised all 12,000 unopened buttons in both runs. Both seeds were chosen before the runs and both are reported; no other run of this card was made at this size (a 200-pair timing run of seed 20261120 preceded them). This is the case the option was written for (a min-raiser who is never read), so it bounds the gain from above; it says nothing about harm against other opponents, deeper or shallower stacks inside 20-50bb, or the two-left tournament scope.

League card (server/src/benchmark/HorseLeague.ts): human_hu_bb_defends_unread_vs_minraise_40bb. Heads-up 40bb against the hu_minraise_every_button_v1 persona of the calibrated field, the live cash Hybrid persona, the deal-seeded mood clock, memoryLearning 'off' (every read stays at its empty prior), 12,000 pairs a night, arm A the option on and arm B the live default. There is no command-line wrapper; the entry point is `runMatchup(matchup, pairs, runSeed)`.

## What switch-on needs

1. The declared evaluation results and a league result for the card above, recorded in this file with seeds, pairs, bb/100 and standard error, from a named engine commit.
2. A replay on real audited heads-up decisions, off against on, written by server/scripts/audited-decision-replay.ts with `--row` and copied unedited under Replay. Production heads-up no-limit hold'em with people is mostly two-max tournaments, so the audited set must contain two-left tournament big-blind decisions.
3. The status paragraph changed to "Evidence MET" only then (server/src/engine/EveryHorseOptionRecordsItsReplay.law.test.ts refuses the claim without run rows).
4. A serving engine release that carries this registry. Until the engine in production is built from a commit that holds the lift, the database refuses an `on` row for this option.

`shadow` is available first: it passes nothing to the acted decision (the release default, off, acts) and records the counterfactual re-decision with the option on.

## Limits

- The reference open width is a population target, not a read; "unread" means no RFI or PFR statistic has engaged, not that no hands were seen.
- The 0.7 realisation is one constant for the bottom of the defending range.
- The league card measures one persona at one depth with reads held off for the whole card; it is not a measurement against people.
- The measured over-fold above was taken in cash configurations; the two-left tournament scope rests on the linear-payout argument and the lane's reported result, not on a result in this repository.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-20 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it)
