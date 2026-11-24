# huBbDefendsUnreadToPrice: authority for the live switch

**State: LIVE ON (2026-11-21T04:42:12Z, audit `#168`, evidence `#71`, HEADS UP lane Antigravity `29a711f2`, switch-on authority sha256 `e3eb6a05da8bc6053ace7d0c69dc29c65343d5ff703a652f028d761bc520813c`; default OFF in source, read once as `opts.huBbDefendsUnreadToPrice === true`).** Live read PASS (`2026-11-22T03:30Z`, serving `c2d6e45e3bcc`): `8/8` workers reporting `option_switch_huBbDefendsUnreadToPrice_on_seen`, `hu_bb_defends_unread_to_price` fired `45` times on `2026-11-21` UTC and `15` times on `2026-11-22` UTC (`60` total live fires), with `0` `option_switch_config_*`, `0` illegal actions, `0` brain fallbacks, and `0` `horse_error_log` rows. Heads Up lane option HU-NLH-001d (2026-11-15, PR #11032 `39af896fff33cfc9861e20351f47f0aca22f94ed`): it widens a big-blind preflop calling range, so it was registered off-only under the owner preflop range hold; that hold was lifted for this option alone on 2026-11-20 in PR #11538 (`5c58d3c12a927989ba9384319f445fac303e3e4b`; see "Owner authority" below). Evidence MET (2026-11-20): mechanism, scope, receipt and 29-case law test MET; declared evaluation `HU-NLH-001d` (`RESULTS-HU-NLH-001d.md`, sha256 `3cbf1bae94c83496a77b3f0505698eaba5347f8c9e09af5647316e11694811b7`) and three paired league runs on `human_hu_bb_defends_unread_vs_minraise_40bb` (`+15.28 +/- 3.38`, `+16.48 +/- 3.71`, `+17.95 +/- 3.76` bb/100, 0 illegal actions) MET; real-hand audited decision replays on `HU30D` (2,576 two-player NLH tournament Horse decisions: `changed 14`, `fixed 0`, `newlyWrong 0`, 14/14 priced `best = call` by Auditor E saving `+1.36 bb`) and `HU14D` (998 decisions: `changed 2`, `fixed 0`, `newlyWrong 0`) MET.

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
- Value: MET (development and paired-league evidence, bounded as stated under Limits).
  - Declared evaluation (`extreme-archive/hu-audit-01UxDLnM/round2/bbdef/DECLARATION-HU-NLH-001d.md`, sha256 `62a0d3f56ed99c5f6ad906dae732cd00c707ec8b73e3e4da86a349504853a443`, pre-run witness `DECLARATION-HU-NLH-001d.sha256` sha256 `e85f74842c5617178110c8582fcac99bce2a827e701752535b1d5da4602613bc`; `RESULTS-HU-NLH-001d.md`, sha256 `3cbf1bae94c83496a77b3f0505698eaba5347f8c9e09af5647316e11694811b7`; copied aggregates-only to `antigravity-coordinator-01UxDLnH/evidence/heads-up/`): cash no-read human field (`memoryLearning: 'off'`) `+2.58 +/- 0.26 bb/100` (36,000 hands across 25bb/40bb and three seeds, 0 illegal actions), two-left non-satellite tournament (`playersLeft: 2`) `+7.44 +/- 0.79 bb/100` (12,000 hands across 25bb/40bb), cash read-learning-on `+0.21 +/- 0.24 bb/100` (stands aside once reads engage), Horse mirror `-0.08 +/- 0.29 bb/100` (neutral, non-exploitable), and 80bb out-of-scope `0.00 +/- 0.00 bb/100` (0 divergent hands).
  - Production `public.horse_league_results` row `9233` (`run_date: 2026-11-17`, engine `28372c9a1750934d1c39839bc551b050da6f4b8d`, exported at `evidence/heads-up/horse_league_results_2026-11-17_heads_up.jsonl` sha256 `f7d863a7a39adc32120d9f551334cc877da3f625ad108a16a0dbbb42811f68de`) plus two 2026-11-20 runs on card `human_hu_bb_defends_unread_vs_minraise_40bb` through `runMatchup(card, 12000, seed)` (engine tree `95dae3848` plus the hold lift, `EQUITY_GOVERNOR=off`):

  | run / seed         | pairs  | hands  | A minus B, bb/100 | standard error (per pair) | block standard error (40 blocks) | divergent pairs | illegal, truncated, corrected, fallbacks |
  | ------------------ | ------ | ------ | ----------------- | ------------------------- | -------------------------------- | --------------- | ---------------------------------------- |
  | 2026-11-17 (#9233) | 12,000 | 24,000 | +15.28            | 3.38                      | 3.78                             | -               | 0, 0, 0, 0                               |
  | 20261120           | 12,000 | 24,000 | +16.48            | 3.71                      | 3.11                             | 2,610           | 0, 0, 0, 0                               |
  | 20261121           | 12,000 | 24,000 | +17.95            | 3.76                      | 3.76                             | 2,592           | 0, 0, 0, 0                               |

  Each arm's own result against the field on 2026-11-20: seed 20261120 arm A +17.70 +/- 8.42, arm B +1.22 +/- 7.58 bb/100; seed 20261121 arm A +27.88 +/- 8.23, arm B +9.93 +/- 7.34 bb/100 (12,000 hands per arm). The persona raised all 12,000 unopened buttons in both runs. Both seeds were chosen before the runs and both are reported; no other run of this card was made at this size (a 200-pair timing run of seed 20261120 preceded them). This is the case the option was written for (a min-raiser who is never read), so it bounds the gain from above.

- Input fidelity, continuation, reach on recorded hands: MET (`extreme-archive/hu-29a711f2-replay-20261120/`, aggregate copies in `antigravity-coordinator-01UxDLnH/evidence/heads-up/HU30D-REPLAY-SUMMARY.md` sha256 `3d921a943ade3e411b1f438513b02437ec09d30f4e0d9ca851a9545b9b5006fc`, `HU30D.voluntary.score.log` sha256 `e693e1b202dc7461bb07aa3902fcb9c339e5e99395fbe59813c8e7ebbac2d7e0`, `HU14D.voluntary.score.log` sha256 `57caf12620f507bc22768ae21e6c64b42bb4f58552eaeab53796b92f2ec4d48b`).
  - Re-decided from retained `publicNode` snapshots (`HorseComplaintReplay.stateAt` with voluntary-only `actionHistory` matching `HandController`, PR #11556 `f90f60b7c9b0`) and each Horse's own hole cards, opponent memory OFF (`replayAt` passes `mind: false`), live tournament hybrid profile over seeds `1,7,42`, base arm `off` equal to the 63 production switch rows of `2026-11-20T21:15Z`, audited by Auditor E's unmodified `analyze.mjs` and placed by `server/scripts/hvh48-audit-nodes.py --set E` (PR #11563 `d6b032d3204`).
  - Unedited scorer lines (`server/scripts/audited-decision-replay.ts --placed ... --line on`):
    - `HU30D` (3,390 hands across 106 two-player human NLH tournaments, `2026-10-21..2026-11-20`): `placed (verdict-only; 2576 audited decisions, 52 judged bad; joined by node: 2576 replayed, 0 not replayed, base reproduces the recorded action on 1704): arm on changed 14 (14 more aggressive, 0 more passive), resized 0, illegal 0, refused 0, errors 0; fixed 0, newly wrong 0, still wrong 0, ok to ok 0, unjudged 14; judged bad left unchanged 15; no bb (the audit declares no EV model); per receipt: hu_bb_defends_unread_to_price 14 changed / 0 fixed / 0 newly wrong.`
    - `HU14D` (2,298 hands across 58 two-player human NLH tournaments, `2026-11-06..2026-11-20`): `placed (verdict-only; 998 audited decisions, 16 judged bad; joined by node: 998 replayed, 0 not replayed, base reproduces the recorded action on 712): arm on changed 2 (2 more aggressive, 0 more passive), resized 0, illegal 0, refused 0, errors 0; fixed 0, newly wrong 0, still wrong 0, ok to ok 0, unjudged 2; judged bad left unchanged 7; no bb (the audit declares no EV model); per receipt: hu_bb_defends_unread_to_price 2 changed / 0 fixed / 0 newly wrong.`
  - Every one of the 14 changed decisions in `HU30D` (`14/14`) is preflop, two players left (`players_left == 2`), `20.05-49.00bb`, `fold -> call`, carries `hu_bb_defends_unread_to_price`, and is independently priced `best = 'call'` (`audit_eq 0.34-0.48 > audit_req_eq 0.20-0.30`) by Auditor E's range-equity model, saving `+1.36 bb` across the 9 recorded folds (`PF_FOLD_VS_RAISE_PRICED`, tagged `DEBATABLE` -> `unjudged` because single-minraise BB call EV is `+0.04..+0.40 bb < 1.5 bb`) and restoring the recorded `OK` call on the remaining 5 nodes.

League card (server/src/benchmark/HorseLeague.ts): human_hu_bb_defends_unread_vs_minraise_40bb. Heads-up 40bb against the hu_minraise_every_button_v1 persona of the calibrated field, the live cash Hybrid persona, the deal-seeded mood clock, memoryLearning 'off' (every read stays at its empty prior), 12,000 pairs a night, arm A the option on and arm B the live default. Command-line runner: `npx tsx src/scripts/horseLeagueCard.ts --card=human_hu_bb_defends_unread_vs_minraise_40bb --seed=20261120`.

## Activation and live verification

1. Migration `20261120210905_horse_option_switch_heads_up_big_blind_hold_lift.sql` installed in production (`fn_ca_horse_option_switch_states('huBbDefendsUnreadToPrice')` returns `['off', 'shadow', 'on_shadow', 'on']`).
2. Switched ON at `2026-11-21T04:42:12Z` (`public.ca_horse_style_switch_audit` id `#168`, `public.ca_horse_option_switch_evidence` id `#71`, `HEADS UP lane Antigravity 29a711f2`, citing `docs/horse-option-authority.d/huBbDefendsUnreadToPrice.md` sha256 `e3eb6a05da8bc6053ace7d0c69dc29c65343d5ff703a652f028d761bc520813c`).
3. Live verification (`2026-11-22T03:30Z`, serving `c2d6e45e3bcc8447168c3aa7e76fbb1fbd16f0aa`): `option_switch_huBbDefendsUnreadToPrice_on_seen = 8` (`8/8` workers), `hu_bb_defends_unread_to_price = 45` on `2026-11-21` UTC and `15` on `2026-11-22` UTC (`60` total live fires), `0` `option_switch_config_*`, `0` illegal actions, `0` brain fallbacks, `0` `horse_error_log` rows.

## Limits

- The reference open width is a population target, not a read; "unread" means no RFI or PFR statistic has engaged, not that no hands were seen. In replay (`replayAt` with `mind: false`), opponent memory is off for every hand, whereas live play stands aside once an opponent's RFI or PFR read engages.
- The 0.7 realisation is one constant for the bottom of the defending range.
- The league card measures one persona at one depth with reads held off for the whole card; it bounds the gain from above and is not a measurement against people.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: fixed 0; newlyWrong 0; changed 14; unchanged 2562; unjudged 14; set HU30D Hold'em 2-player tournaments 30d; scorer d6b032d3204; source placed verdict-only; arm on vs off; replayed 2576 of 2576
- Replay: fixed 0; newlyWrong 0; changed 2; unchanged 996; unjudged 2; set HU14D Hold'em 2-player tournaments 14d; scorer d6b032d3204; source placed verdict-only; arm on vs off; replayed 998 of 998

How the rows are produced (run from `server/` on the operations Mac; `ARCHIVE` is `/Volumes/SmarterArchives/agent-evidence/extreme-archive/hu-29a711f2-replay-20261120`, `SWITCH` is `/Volumes/SmarterArchives/agent-evidence/extreme-archive/horse-decisions-01UxDLnM/replay6/prod-switch-20261120T2115Z.json`):

1. Re-decide the placed two-player human NLH tournament nodes (`nodes_30d/E.job.json` and `nodes/E.job.json`, extracted via `scripts/horse-measure/sql/complaint-extract.sql`, audited by Auditor E's unmodified `analyze.mjs`, and placed by `server/scripts/hvh48-audit-nodes.py --set E`) on merged `main` (`#11556` `f90f60b7c9b0` + `#11563` `d6b032d3204`), off against `huBbDefendsUnreadToPrice` on:
   - `npx tsx scripts/audited-node-option-replay.ts --job $ARCHIVE/nodes_30d/E.job.json --switch $SWITCH --arms on=huBbDefendsUnreadToPrice --out $ARCHIVE/runs-f90f60b7/HU30D.replay.jsonl`
   - `npx tsx scripts/audited-node-option-replay.ts --job $ARCHIVE/nodes/E.job.json --switch $SWITCH --arms on=huBbDefendsUnreadToPrice --out $ARCHIVE/runs-f90f60b7/HU14D.replay.jsonl`
2. Score with the committed scorer (`--placed`, `--line on`, `--row on`) and copy the printed `- Replay:` rows unedited:
   - `npx tsx scripts/audited-decision-replay.ts --placed $ARCHIVE/nodes_30d/E.nodes.jsonl --replay $ARCHIVE/runs-f90f60b7/HU30D.replay.jsonl --line on --row on --set "HU30D Hold'em 2-player tournaments 30d"`
   - `npx tsx scripts/audited-decision-replay.ts --placed $ARCHIVE/nodes/E.nodes.jsonl --replay $ARCHIVE/runs-f90f60b7/HU14D.replay.jsonl --line on --row on --set "HU14D Hold'em 2-player tournaments 14d"`

## Rollback

Set `huBbDefendsUnreadToPrice` to `off` via the `horse-option-switch` CLI (`fn_ca_horse_option_switch_set('huBbDefendsUnreadToPrice', 'off', '<actor>', '<reason>')`) to restore the base brain within ~30s; zero data migration needed.

## Evidence check, 2026-11-24

Checked 2026-11-24: `antigravity-coordinator-01UxDLnH/evidence/heads-up/HU30D-REPLAY-SUMMARY.md` is present on the Mac's internal disk at `/Users/smarter.poker/Documents/Claude/antigravity-coordinator-01UxDLnH/evidence/heads-up/HU30D-REPLAY-SUMMARY.md`, with the sha256 this file states (`3d921a94...`). The archive entry `/Volumes/SmarterArchives/agent-evidence/antigravity-coordinator-01UxDLnH` is a link to a folder on a second archive volume that holds two files and no `evidence/` folder, which is why the ablation reported the summary missing. `HU30D.voluntary.score.log` and `HU14D.voluntary.score.log` are present, with the stated sha256, in `/Volumes/SmarterArchives/agent-evidence/extreme-archive/hu-29a711f2-replay-20261120/runs/`. The query was cited under `server/scripts/`; the committed file is `scripts/horse-measure/sql/complaint-extract.sql` (corrected above).

Independent result (`/Volumes/SmarterWork/agent-work/shared-capacity/plo-lead6-01BNteGX/holdem-ablation/HOLDEM-SWITCH-ABLATION.md` sections 2 and 5, build `b99bd306892c`): switching it off changes 0 of 10,800 replayed decisions (423 heads-up cash, 981 heads-up tournament states) and 0 on the real cash and tournament sets. Production telemetry shows it is reached (`hu_bb_defends_unread_to_price` 236 fires, 2026-11-21 to 2026-11-24), so it is not unreachable; no test set shows it changing an action. It is listed in `docs/ops/horse-dead-options-20261124.md`.
