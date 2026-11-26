# omahaMathCore: authority for the live switch

Lane MATHCORE, 2026-11-19 (lead session 01TLQer8). Default OFF (`opts.omahaMathCore === true`). The lead switches it with A/delivery/activate.sh; nobody else. Evidence NOT MET (grade of 2026-11-26, lead-7 lane grading, "What Was Measured" below): not ready for live shadow; the prior anchor fails (the response cells are 83% Horse play) and the maximum decision time is 45 ms against the 25 ms bar.

## What It Does

In PLO4 and PLO5 cash (table and Lightning; never PLO6, owner 8:26 PM: "DON'T TOUCH PLO6"), high only, one board, pot limit, every street, the decision is the expected-value maximum over every legal action: fold, check, call, bet or raise at several sizes on the table's chip unit (unopened: 1/3, 1/2, 2/3 and full pot; facing a wager or preflop: half and full pot raise), and all-in where legal.

- fold = 0; check = equity x pot (net of rake)
- call = equity x (pot + call) (net) - call; players still to act behind fold at their public rate, else continue with their strongest share and add their call
- wager = P(everyone folds) x pot (net) + P(called) x (equity against the continuing ranges x final pot (net) - chips added)

Equity is exact Omaha high (two hole plus three board), Monte Carlo to the river against one range per live opponent with card removal, standard-error target 0.01 (lane EQUITY's equityVsRanges; the core's own exact sampler when it declines). Ranges are built from public information only (lead ruling 2026-11-19): a wager of share s of the pot is value from the top of a pool of concrete holdings and bluffs from the bottom at the break-even share s/(1+2s); a caller is the band between his public raise and fold frequencies; a checker is below the wager region; a preflop raiser is the top share of his public raise frequency by position and level; a caller preflop the band between raise and raise + call. Fold equity is the public response frequency to a wager by street, line, size and players, pooled over every player; preflop the public fold facing an open, 3-bet or 4-bet by position. Identity-free (lane CORE-POOLED, owner 9:52 AM Nov 20 2026): no lookup accepts or derives a person/Horse label or a user id, every responder (persons and Horses alike) is priced by the same measured pooled cell, and the hero's own wagers are priced on the same cells (law OmahaMathCoreIdentityFree.law.test.ts).

The decision the owner rules produced is never an input, prior or tie-break: it stands only when the core throws (receipt `omahaMathCore.error`).

## Wiring

- HorseLogic decideInternal, graph node `wager_rules`: the node's whole result passes through `omahaMathCoreRule` (outermost owner; only `timing` follows and never changes the action).
- ServerTableEngineTurns commit door: an applied core decision (`mathCoreOwned`) is not re-decided by the commit-door wager rules or the short all-in call floor.
- responseValidation `omahaMathCoreAdmits`: a changed `wager_rules` action is admitted only under the gate the worker may have run (`omahaMathCoreGate`: the request option, the delivered switch row or the previous row), in scope on the request, with the decision's own applied receipt naming exactly that action, and legal on the request. Without the admission a changed action would be refused and the client's liveness fallback would check or fold.

## Tables (Public Information Only)

`server/src/engine/omahaMathCore/publicTables.v4-pooled.json` (lane CORE-POOLED, Nov 20 2026): lane RANGES' public extracts (PLO4/PLO5 cash with a person, Nov 1 to Nov 19 6:49 PM Chicago) re-measured with every player pooled: no person/Horse field, no table-composition field, no per-user rows. Every cell carries its provenance: `public_actions` (responses to wagers, wager frequency by line, preflop action frequencies, fold facing a raise, VPIP/PFR) or `showdown_only` (the share of a line's wagers shown at showdown that were not value, `shownNonValue`). Companions: `preflopTables.v2-pooled.json`, `playbookTexture.v2-pooled.json`, `preflopRealization.v2-pooled.json` (every-opponent cells only). Builders: lane CORE-POOLED build_pub.py / build_pf.py / build_tex.py (aggregates only). A law test pins that every cell the core loads has provenance `public_actions` or `showdown_only`, and OmahaMathCoreIdentityFree.law.test.ts that no table carries an identity key.

## Known Interim Items (Stated, Not Hidden)

- A wager's range: value from the top of the pool, non-value from the bottom at the measured `shownNonValue` share of that line and size (the break-even share s/(1+2s) only where no cell has 20 shown hands), at the line's measured wager frequency (`INTERIM_WAGER_FREQUENCY` = 0.5 only where no cell exists; named in the receipt).
- No public realization measurement exists yet: no realization factor is applied (receipt says so).
- Postflop ranges do not yet carry the preflop action forward (each street's range is built on that street's public line).

## Receipts

`decision.omahaMathCore`: switch, applied, the chosen action and amount, the incoming decision (record only), error, and the core receipt: version, table version, street, price, pot, to call, each opponent's range label with its table key and n, the EV, equity, standard error, fold probability and fold source of every priced action, the choice, samples and milliseconds.

## Tests

`server/src/engine/omahaMathCore/OmahaMathCore.test.ts`: evaluator parity with PokerEngine.evaluateOmahaHand; argmax law; never fold when the call EV exceeds its sampling error; set and aces spots; the #60156608-type 5-bet law (a raise only when its EV beats the call); determinism; latency inside the 2 s minimum deadline; table provenance; recorded flop spots through HorseLogic.decide (hands 59790514, 59829906, 59811519, 59833259, 59852600, 59840990, 59869211, 59802550, 59806482, 59833693, 59848622, 59831538) with the final action equal to the core's choice and the validator admitting it; the admission needs the gate; OFF byte-identical; exception keeps the incoming decision; out of scope unchanged.

## Evaluation

Exact replay over every PLO4/PLO5 cash decision of the 48-hour dataset (base vs ON) and the Horse-vs-Horse league are run by lane PROVE (S/emerg/PROVE); their numbers are the evidence for switching. Hidden cards are used there for offline grading only.

## Prior anchor

NOT MET (grade of 2026-11-26). The core has no per-opponent record: every responder is priced by the measured pooled public cells (fold to a wager by street, line, size and players; wager frequency by line; preflop action frequencies) of PLO4/PLO5 cash hands with a person, Nov 1 to Nov 19, every player pooled. Those cells are mostly Horse play: on a sample day (2026-11-12) 4,476 of 5,414 seat-hands in such hands (83%) were Horses. The equilibrium anchor (the break-even share s/(1+2s)) is used only where a cell has fewer than 20 shown hands. So the response model is anchored to the Horse field, which the rule forbids, and no opponent's own record can take over as it grows. A thin record cannot dominate (there is none), which is the only half of the rule that holds.

## What Was Measured (Grade 2026-11-26, Lead-7 Lane Grading)

Scope graded: `omahaMathCore` on with `omahaMathCorePlo5Flop` on (production already holds the street flag on; no other street flag and no `omahaMathCorePreflop`), so the core owns PLO5 cash flop decisions only; PLO4 and every other street are out of scope.

Method (lane grading, PLO-OWNER lead-7, 2026-11-26; scratch tools and every raw result in `$S7/grading/`, BUILD.md there). Production option set = the `ca_horse_style_switch` rows not off, read 2026-11-26 05:4xZ (55 rows; the seven style rows as the style switch applies them). Source: `origin/main` `211c4e9e`, whose engine files are unchanged since the serving build `d07cd7d7`.

- League mirror: the sparring bench (`SparringLeague.runSparringCell`) with the lifetime HUD learned per arm and deal (`SparringHud`, production's stored population priors), 100 bb, seed 20261126. Seat 0 is a Horse on the production option set; every other seat plays the arm (BASE = production, or production plus the option). Every arm plays the same deals; the figure is the paired same-deal change of seat 0's net, sign turned so that + means the option's seats won chips (bb/100 ± SE). Heads-up this is exactly ON against OFF; at six seats it is one OFF seat against five ON seats.
- Probes: the same bench with seat 0 scripted: always-caller (never bets or raises, calls every wager), over-folder (Horse, but folds to any wager without the top 15% preflop or 70% equity postflop), habitual 3-bettor (`threebet_every_open`), tight opener (Horse, but enters preflop only with the top 15%). Figure: the same paired change of seat 0's net with the sign turned (+ = the option's seats took more from the probe than production's seats did; a significant minus is an exploit), 4,000 hands per cell. Misleading lifetime record (HUD readers): a warm-up cell (seed 7, 3,000 hands, production arm) builds every seat's lifetime record while seat 0 plays one style; the measuring cell starts every arm's store from that export and seat 0 plays the opposite style.
- Real-hand replay: every tier-A (cards shown) Horse decision of the PLO hand audit (`$S6/hand-audit-plo/decisions.csv` 4,011 and `daily/2026-11-25T230000Z/decisions.csv` 1,216; 5,227 nodes in 1,064 hands), re-decided from the recorded public snapshot with the deciding Horse's own shown cards only (`hand_history.players[].cards` dropped on read, never used), real seat ids, mind on with an empty in-session memory, and the lifetime HUD packet production attaches (`buildHudPacket`, priors by stake) built from `opponent_hud_profiles` as read on 2026-11-26 (look-ahead stated: those public profiles also hold hands played after the decision). Seeds 1, 7, 42, majority action. Scored twice: by the committed scorer (`--placed`, verdict-only; row below, copied unedited) and on the audit's own EV table (its `options` column and tolerance rule, resizes included); the base arm reproduced the recorded action on 3,941 of 5,227 nodes. Strengths = the audit's "What the Horses do well" classes (section 5): 773 replayed decisions the base arm plays correctly in those classes.
- Speed: the engine's own `HorseLogic.decide` per decision on the same 5,227 real states (one seed, tsx build, Mac Studio at load 14 to 22), on the spots where the option applies.

Live shadow reconciliation (from `horse_brain_flush_receipts`, features `option_shadow_omahaMathCorePlo5Flop_{changed,same}_seen`; there is no `option_shadow_omahaMathCore_*` receipt, the shadow staged the street flag with the master as companion):

- 2026-11-23 04:34Z to 07:22Z, release `735299cd` (audit #189 shadow): 727 re-decisions, 155 changed = **21.3%**. Rolled back on the 195.8 ms trip (audit #190).
- 2026-11-24 13:28Z to 14:31Z, release `6c6aaa77` (audit #195 shadow): 291 re-decisions in those hours, 22 changed = 7.6% (284 and 7.39% inside the watch's own window).
- The "1,018 re-decisions / 17%" reading is 727 + 291 = 1,018 and 155 + 22 = 177 = 17.4%: the two shadows on two different builds pooled by a `--since` that covered both. It is not a measurement of any one build. Right numbers: 727 / 21.3% for `735299cd`, 284 / 7.4% for the build lineage now serving.

Chips (bb/100, + = the option's seats won more than production's on the same deals):

| cell              | game          | hands | option seats bb/100 vs production (± SE) | z     | hands parted | illegal + fallbacks |
| ----------------- | ------------- | ----- | ---------------------------------------- | ----- | ------------ | ------------------- |
| league mirror     | PLO5 heads-up | 12000 | -4.53 ± 5.53                             | -0.82 | 1834         | 0                   |
| league mirror     | PLO5 6-max    | 12000 | +5.09 ± 5.79                             | +0.88 | 2377         | 0                   |
| always-caller     | PLO5 6-max    | 4000  | -19.32 ± 30.98                           | -0.62 | 923          | 0                   |
| over-folder       | PLO5 6-max    | 4000  | +5.42 ± 7.44                             | +0.73 | 757          | 0                   |
| habitual 3-bettor | PLO5 6-max    | 4000  | -30.14 ± 39.26                           | -0.77 | 1665         | 0                   |
| always-caller     | PLO5 heads-up | 4000  | +29.25 ± 6.33                            | +4.62 | 521          | 0                   |
| over-folder       | PLO5 heads-up | 4000  | -0.62 ± 5.04                             | -0.12 | 361          | 0                   |
| habitual 3-bettor | PLO5 heads-up | 4000  | +14.73 ± 18.71                           | +0.79 | 930          | 0                   |
| tight opener      | PLO5 heads-up | 4000  | +3.08 ± 7.62                             | +0.40 | 197          | 0                   |
| league mirror     | PLO4 heads-up | 12000 | +0.00 ± 0.00                             | +0.00 | 0            | 0                   |
| league mirror     | PLO4 6-max    | 1500  | +0.00 ± 0.00                             | +0.00 | 0            | 0                   |

PLO4 is out of scope: the PLO4 heads-up (12,000 hands) and 6-max (1,500 hands) mirror cells part on 0 hands (table rows with 0 parted), so the option changes no PLO4 decision.

Probes (the 6-max tight-opener cell was not run, for wall time): no significant loss to any probe (all |z| < 1 except a gain: against the always-caller heads-up the core's seats took +29.3 ± 6.3 bb/100 more, z +4.6, from value bets it would otherwise check). The league mirror shows no significant change either way (heads-up -4.5 ± 5.5, 6-max +5.1 ± 5.8). Chips: met (no significant loss), but no significant gain in the mirror.

Real-hand replay (5,227 tier-A nodes): the core changed 119 decisions (all PLO5 flop), 51 of them resizes. Committed scorer: fixed 43, newly wrong 4. Audit EV table: fixed 58, newly wrong 0, still wrong 39, right to right 22, +2,770 bb on the audit model (47 of the 58 fixes are OPPORTUNITY-class, checks that become bets, where the audit says its one-street model over-rates bets; only 1 is a HARD mistake). Audit strengths: 2 of 773 protected decisions changed, 0 broken. Met.

Speed (PLO5 flop, 1,108 real spots, one seed): whole decision p50 6.5 ms, p95 9.8 ms, max 45.4 ms, 3 over 25 ms, 0 over 50 ms; added by the core p50 1.7 ms, p95 4.8 ms, max 30.2 ms. p95 and the 50 ms line are met; the 25 ms maximum is not. The serving-build gate of 2026-11-22 (V291) measured added p95 35 ms, and the 2026-11-23 shadow tripped at 195.8 ms.

Verdict: **NOT READY for live shadow.** Replay met and no chip loss shown, but the prior anchor fails by design (83% Horse-field response cells, no own-record takeover) and the maximum decision time is 45 ms against the 25 ms bar.

## Replay

- Replay: fixed 43; newlyWrong 4; changed 68; unchanged 5159; unjudged 15; set PLO audit tier A (cards shown) PLO4/PLO5 cash 2026-11-20..25; scorer 5302af2ab3e; source placed verdict-only; arm A vs off; replayed 5227 of 5227
