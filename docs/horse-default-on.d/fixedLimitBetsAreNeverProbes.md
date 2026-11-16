# fixedLimitBetsAreNeverProbes (#10930 built the switch; this file turns its source default on)

A process switch, not a decide option: `HorseMind.setFixedLimitBetsAreNeverProbes`, source default `FIXED_LIMIT_BETS_ARE_NEVER_PROBES_DEFAULT` in `server/src/engine/HorseMind.ts`, now `true` as a defect repair (the fixed-limit maniac recognition repair, "F1"). The switch and its law were merged default off in #10930; this pull request changes only the default. Evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md). The lane's records are in the agent evidence archive `extreme-archive/fixed-limit-01Gw7aDr/`: `L-ADAPTATION-DIAGNOSIS.md` (L), `N-ADAPTATION-FIX.md` (N), `Q-CROSS-FORMAT-CONTAMINATION.md` (Q), `U-HARNESS-VALIDATION.md` (U), `V-EVALUATION.md` and `V-TABLE-20261115T0440Z.md` (V), `W-F1-DEFAULT-ON-CELLS.md` (W: the three cells Hand Analysis asked for before this is served). Money is in big bets per 100 hands.

## Mechanism

Status: MET

The probe rule (PROBE BETS ARE NOT AGGRESSION, 2026-11-08) counts a checked-to postflop first bet of at most one big blind or a fifth of the pot as a probe (`HorseOpponentExploit.ts:347`, `added <= Math.max(bigBlind, PROBE_BET_MAX_POT_SHARE * pot)`), tallies it in `OpponentStats.ctBets` / `ctProbes`, and takes the probe share back out of `betCheckedTo` when the read is made (`HorseMind.probeAdjusted`). In fixed limit every flop bet is one big blind and a turn or river bet is under a fifth of the pot once the pot passes ten big blinds, so the rule reads a fixed-limit bettor's ordinary bets as probes.

Values measured with the production memory feed (observe plus observeHandComplete) against a scripted maniac who bets every checked street (L section 0A and 1): probe share of his checked-to bets 76% (flh heads-up, 5,536 of 7,281 after 5,000 hands), 75% (flo8 heads-up), 100% (flh and flo8, six seats). His raw `betCheckedTo` of 0.78 to 0.86 becomes a read of 0.21 (heads-up) or 0.02 to 0.06 (six seats), under the `flh:hu` envelope edge (0.48) and under `POSTFLOP_MANIAC_MIN_BET_RATE` 0.55. So `isPostflopManiac`, `isAggressor`, the call-down respect shift, barrel narrowing, the V86 strip of line reads and the maniac call-down fold recovery never engage in flh or flo8, at 50, 200, 1,000 or 5,000 hands. At a river facing his bet (flh heads-up, 406 medium hands with true pot share 0.41 at a price of 0.139) the Horse's equity estimate is 0.200 and it folds 32.3%, against 0.448 and 6.9% with memory off (L section 2).

The change: with the switch on, `HorseMind.observe` counts no probe tally (neither `ctBets` nor `ctProbes`) for a hand whose betting structure is `fixed_limit`, so the bets stay whole in `betCheckedTo`. Pinned in `AFixedLimitBetIsNeverAProbe.law.test.ts`: the same scripted flh and flo8 heads-up maniac reads `betCheckedTo` at least 0.9 and `isPostflopManiac` within 100 hands with the switch on, and with it off reads exactly as before (ctBets 300, ctProbes 200, no maniac class).

## Input fidelity

Status: MET

There is no recorded production node with a maniac to replay: no person has played fixed limit since 2026-11-03 (Q section 2: one human ever, 107 flo8 hands, 2026-11-03 02:40Z to 03:53Z; flh 0), and the probe rule only reached the tallies after 2026-11-08. The evidence is a paired two-arm simulation (V), not a replay.

Carried as production runs it: memory on with the production feed (`observe` plus `observeHandComplete`, as `workerRuntime` does), `phase12Remaining` candidate, production rake, the switch turned on for every Horse of the switched arm (one shared memory sandbox, as a process-wide default makes it). The harness was validated against live Horse-only fixed-limit hands (U, segment 2026-11-14T06:27Z to 21:27Z, tolerance 5 points): VALID for flh preflop first-in, big-blind defence and the variant-pack replacement; flh river facing a bet and river betting at six seats; flo8 river facing a bet and river betting at six seats. NOT VALID: flh flop and turn, flo8 preflop, flop and turn; heads-up river (live samples under 100) not judged.

Supplied by hand: the opponents are scripts (sustained maniac, gear-changer switching between maniac and tight-value every 30 hands, tight-value) or baseline Horses, not recorded players; table sizes 2, 6 and 9 (one 9-seat cell, W); cash tables plus one tournament-table cell (W: tournament flag, tournament game mode and hybrid profile, no rake; no blind levels or payout table); stacks reset to 100 big blinds each hand; durable opponent profiles start empty (no database hydration). The value row therefore counts only deals whose two arms first differ on a validated street ("validated portion"); totals are diagnostic. The 9-seat and tournament cells ran on a copy of the harness extended only by those two settings; at 2 and 6 seats cash the copy reproduces the original exactly (pinned: identical results on the same 400 deals, W). Their validated-street set is borrowed from flh 6 seats: the harness was validated against live hands only at 2 and 6 seats, and no fixed-limit tournament has ever been dealt.

## Value

Status: MET

The change acts on a read, not on one node, so the value is measured per paired deal over whole sessions (V, candidate 26b7604b, F1 alone switched on in arm A). Three opponent ranges, one of them value-only:

| Opponent (range)                         | flh 6 seats            | flo8 6 seats           | flh 2 seats (validated / diagnostic total) | flo8 2 seats (diagnostic only) |
| ---------------------------------------- | ---------------------- | ---------------------- | ------------------------------------------ | ------------------------------ |
| Sustained maniac (every hand, every bet) | +17.03 +/- 5.54        | +72.24 +/- 14.59       | -0.08 +/- 0.54 / +14.91 +/- 1.80           | +9.01 +/- 1.93                 |
| Gear-changer (maniac then value, by 30s) | +0.00 +/- 0.00         | +0.29 +/- 0.58         | +0.05 +/- 0.07 / +7.76 +/- 0.95            | +1.76 +/- 0.65                 |
| Tight-value (value only)                 | +0.00 (0 deals differ) | +0.00 (0 deals differ) | +0.00 (0 deals differ)                     | +0.00 (0 deals differ)         |

The three cells asked for before serving (W, same estimator, F1 alone):

| Cell                                      | Deals | Validated portion | Total (diagnostic) | Deals that differ |
| ----------------------------------------- | ----- | ----------------- | ------------------ | ----------------- |
| flh 6 seats, Horse opponents              | 4,487 | +0.00 +/- 0.00    | +0.00 +/- 0.00     | 0 (0.0%)          |
| flo8 6 seats, Horse opponents             | 1,929 | +0.00 +/- 0.00    | +0.00 +/- 0.00     | 1 (0.1%), net 0   |
| flh 9 seats, sustained maniac             | 1,607 | +3.36 +/- 3.77    | +18.19 +/- 9.33    | 483 (30.1%)       |
| flh 6 seats, tournament, sustained maniac | 1,507 | +24.57 +/- 7.18   | +24.48 +/- 11.96   | 430 (28.5%)       |

Deals: flh 6 seats 1,841 / 4,694 / 8,119; flo8 6 seats 685 / 2,367 / 4,107; flh 2 seats 5,153 / 8,908 / 21,912; flo8 2 seats 2,961 / 6,545 / 18,698. Pass rule declared before the runs (V section 0): harm if any validated cell is below -1 - 2 SE; none is, the three W cells included. The only negative estimate, flh heads-up maniac -0.08 +/- 0.54, is the preflop-only validated portion and is within one standard error of zero; its diagnostic total is +14.91.

Sensitivity: positive against the wide range, zero against value only (a tight-value bettor's bet rate stays under the envelope with or without the probe discount, L section 4, so no read changes), and between zero and +0.29 against the gear-changer, which was the declared risk cell (a half-life-30 read lags each gear change). These are simulated values against scripted opponents, not production results.

## Continuation

Status: MET

Met offline; the one part that is live-only (how a real person who plays like a maniac continues) is named here and under Limits. The argument relies on no assumed fold, call or re-raise frequency: every continuation is played out in the paired deals by the scripts and the Horses. What is not measured from recorded hands is how a real person who plays like a maniac continues after a Horse that recognises him calls down more; no such person has played fixed limit here. The scripts never adapt to the Horse.

## Reach

Status: MET

Human-facing decisions that change today: none. Since 2026-11-03 no person has sat at a fixed-limit table (Q section 2), and no human record holds a probe tally (the tallies are memory only, rebuilt at each worker boot; Q section 1).

Horse-facing: fixed-limit tables run Horse against Horse in production (U: in the 15-hour reference segment, flh alone had 18,912 first-in decisions at dealt 7 to 9 and 8,036 at 5 to 6). With the default on, every Horse counts every opponent's fixed-limit bets whole. F1 alone against Horse opponents (W): 0 of 4,487 flh and 1 of 1,929 flo8 six-seat deals differ, net +0.00 +/- 0.00 in both. Baseline Horses do not bet checked-to streets at a rate the probe discount was hiding, so counting their bets whole moves no read across an envelope; the all-fixes Horse cells (+0.18 +/- 0.09 flh, +0.22 +/- 0.20 flo8, 0.9% and 3.5% of deals) came from the other fixes. Against a sustained maniac at 9 seats 30.1% of flh deals differ, and in the tournament cell 28.5%. Against the scripts with F1 alone: maniac 26.1% (flh 6) and 49.9% (flo8 6) of deals differ; tight-value 0%; gear-changer 0.1% and 1.4%. "Already that action in production" does not apply: the change is a read, and no single action is substituted.

No-limit and pot-limit reach: their counting is byte-identical (law test: tallies equal with the switch on, off and with no structure given). Because the tallies are pooled per player across games, a player who played fixed limit since the worker booted no longer has those bets in the probe share his no-limit read is discounted by; this is a correction of the contamination (fixed-limit bets inflated his probe share), it reaches only Horses today (878 Horses have fixed-limit profiles and all also play other games, Q section 2), and it was not measured separately.

## Scope

Status: MET

Gated in code to hands whose betting structure is `fixed_limit` (`bettingStructureFor`: flh and flo8), cash and tournament alike. Every path that counts takes the structure: the completed-hand learner and mind mirror (`workerRuntime.observeCompletedHandInMind`, from `riverCallContext.variant`), the in-decision observation (`HorseLogic.prepareOriginalReads`), the observer sandbox learner (`observerReads.learnPublic`) and the boot replay (`HorseMindHydrator`, from `hand_history.game_variant`; a row without a variant counts as before). Decision-level cases: flh and flo8 heads-up recognition with the switch on and the old counting with it off; a no-limit one-big-blind bet is still a probe; no-limit and pot-limit counting identical on, off and with no structure; both production paths hand the variant to the counter (`AFixedLimitBetIsNeverAProbe.law.test.ts`); the hydrator hands each replayed hand its structure (`HorseMindHydrator.test.ts`). Excluded: every no-limit and pot-limit hand (counting unchanged). Cased offline: flh and flo8 cash at 2 and 6 seats (V), flh cash at 9 seats and an flh tournament table at 6 seats (W); flo8 at 9 seats and flo8 tournaments are reached by the same counter and not cased separately. The gate reads only the betting structure, so seat count and cash/tournament do not change what is counted.

## Visibility

Status: MET

`fixed_limit_bet_not_a_probe_seen` (registered in `HorseDataLedger.ts`) fires for each checked-to postflop bet in a fixed-limit hand that is counted without a probe tally; with the default on it is expected to fire at every fixed-limit table, and its silence while fixed-limit tables run means the default is not in effect. On fixed-limit decisions, `opponent_read_probe_bets_discounted` should then fire only from a player's no-limit probe history (see Limits).

## Limits

Status: MET

- Offline only. The value is a paired simulation against scripted opponents; the harness is validated only for flh preflop and six-seat river play and flo8 six-seat river play. The heads-up maniac totals (+14.91 flh, +9.01 flo8) are on unvalidated streets and diagnostic only.
- No natural human witness exists: no person has played fixed limit since 2026-11-03, so live behaviour against a human maniac is unverified until one plays on a release that carries this.
- One 9-seat cell (flh) and one tournament cell (flh, 6 seats, no blind levels or payout table) only; their validated-street set is borrowed from flh 6 seats, and no fixed-limit tournament has ever been dealt, so neither has a live counterpart.
- Future counting only: nothing is reset, rewritten or replayed. The tallies are memory only and rebuilt at each worker boot through the hydrator, which applies the switch, so the release restart starts clean.
- Not repaired here (known, not built): the read-time direction. `probeAdjusted` applies a player's pooled probe share to every read, so his no-limit probe history still discounts his fixed-limit `betCheckedTo` (Q section 3, "F1b"). It matters only for a player who plays both; no human does today.
- The other fixed-limit defects found with this one (the commitment surcharge on a one-bet call, the hi-lo cap that drops the low half, the flo8 envelope edges, the V86 raise-width condition at six seats) are separate options and stay as they are; T2 (`FIXED_LIMIT_RIVER_BETS_ARE_VALUE_EVIDENCE_DEFAULT`) stays false and every #10930 decide option stays off.
- Rollback: see the OFF and rollback contract below.

## Carrying head

The head that carries this flip is one commit on main `2e239dfa8850b663f9f5ee707279d32ef411d98d` (#10915), which contains `0f41689857159cfda83f500e048963ef2cf4cc97` (#10930 squash-merged at its accepted head `c596d06e`, all eight options off). It is `1d7e4e1f` (written on `94f9bf66`) carried onto that main without conflict; its changes to the eight other files are line-for-line the changes of `1d7e4e1f`, and this file differs from `1d7e4e1f`'s only by this section. Between `94f9bf66` and `0f416898` the files the switch reads through (`HorseMind.ts`, `HorseOpponentExploit.ts`, `HorseLogic.ts`, `HorseDataLedger.ts`, `horseDecision/workerRuntime.ts`, `services/HorseMindHydrator.ts`) are unchanged; main then added `AFixedLimitTournamentTablePlaysByItsLevel.law.test.ts` and changed `thePreRepairDiscountThroughTheWorker.test.ts`, and #10915 changed `HorseMind.ts`, `HorseLogic.ts` and `HorseDataLedger.ts` outside the probe tallies and added its own tests; all of these are run with the default on at this head. The offline values above were measured on snapshot `26b7604b`. The probe-counting block of `HorseMind.observe` (the gate `bettingStructure === 'fixed_limit' && HorseMind.fixedLimitBetsAreNeverProbes` and the tallies around it) is line-for-line identical there and at this head; main has since gained other Horse changes in `HorseMind.ts` and `HorseLogic.ts` (#10892, the pre-repair discount on the pooled public path; #10927, the long-horizon tight read; #10915, the style read kept through later steps; #10930's other options, all off), which the paired values did not include.

## OFF and rollback contract

This is a default-on defect repair with no runtime switch in production, by decision: the owner's 23:10 instruction rules out new process-level switches, so no environment variable, registry row, database setting or admin control turns it off.

- How it is turned off. (1) Release rollback: serving the previous sealed release (which has `FIXED_LIMIT_BETS_ARE_NEVER_PROBES_DEFAULT = false`, or predates the switch and counts the old way) turns it off at the restart; nothing else needs to change. (2) Source change: set `FIXED_LIMIT_BETS_ARE_NEVER_PROBES_DEFAULT = false` in `server/src/engine/HorseMind.ts` (or revert this pull request) and ship it in a release; `HorseDefaultOnNeedsEvidence` lets a false default stand without this file. (3) `HorseMind.setFixedLimitBetsAreNeverProbes(false)` turns it off inside one process; it has no production caller and is for tests, the offline harness and replay. Any OFF takes effect only at a release restart; until then the serving release counts as ON.
- What persists, and what OFF leaves behind. Nothing that this switch writes is persisted. The probe tallies (`OpponentStats.ctBets` / `ctProbes`) live only in decision-worker memory: `horse_mind_stats` has no probe column and no table stores a probe count or a probe-adjusted read (Q section 1). At every worker boot they are rebuilt from `horse_mind_stats` plus the hand-history replay tail, and the replay (`HorseMindHydrator`) passes each hand's betting structure to the counter, so it counts with whatever value the booting release has. After an OFF restart, the replayed fixed-limit hands are counted with probe tallies again, exactly as before this change; no reset, migration or recount is needed in either direction. The only lasting traces are the hands the Horses played while it was on (hand history, and the durable opponent profiles built from those actions, which are ordinary play records) and the `fixed_limit_bet_not_a_probe_seen` telemetry counts.
- Proof that OFF reproduces the old counting. The gate is `bettingStructure === 'fixed_limit' && HorseMind.fixedLimitBetsAreNeverProbes` (`HorseMind.ts`); with the switch false it is the code path main ran before this pull request. `AFixedLimitBetIsNeverAProbe.law.test.ts` pins it: with the switch off the flh and flo8 heads-up maniac counts `ctBets` 300 and `ctProbes` 200 and reads no maniac class (main's numbers), and no-limit and pot-limit tallies are identical with the switch on, off and with no structure given. Offline, arm B of every V and W cell is the switch off; on the 400-deal pin it gave the same results in both harness copies.
- How to see which state serves. `fixed_limit_bet_not_a_probe_seen` fires at every fixed-limit table that sees a checked-to postflop bet while it is on; silence while fixed-limit tables run means it is off.
