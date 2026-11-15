# fixedLimitBetsAreNeverProbes (#10930 built the switch; this file turns its source default on)

A process switch, not a decide option: `HorseMind.setFixedLimitBetsAreNeverProbes`, source default `FIXED_LIMIT_BETS_ARE_NEVER_PROBES_DEFAULT` in `server/src/engine/HorseMind.ts`, now `true` as a defect repair (the fixed-limit maniac recognition repair, "F1"). The switch and its law were merged default off in #10930; this pull request changes only the default. Evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md). The lane's records are in the agent evidence archive `extreme-archive/fixed-limit-01Gw7aDr/`: `L-ADAPTATION-DIAGNOSIS.md` (L), `N-ADAPTATION-FIX.md` (N), `Q-CROSS-FORMAT-CONTAMINATION.md` (Q), `U-HARNESS-VALIDATION.md` (U), `V-EVALUATION.md` and `V-TABLE-20261115T0440Z.md` (V). Money is in big bets per 100 hands.

## Mechanism

The probe rule (PROBE BETS ARE NOT AGGRESSION, 2026-11-08) counts a checked-to postflop first bet of at most one big blind or a fifth of the pot as a probe (`HorseOpponentExploit.ts:347`, `added <= Math.max(bigBlind, PROBE_BET_MAX_POT_SHARE * pot)`), tallies it in `OpponentStats.ctBets` / `ctProbes`, and takes the probe share back out of `betCheckedTo` when the read is made (`HorseMind.probeAdjusted`). In fixed limit every flop bet is one big blind and a turn or river bet is under a fifth of the pot once the pot passes ten big blinds, so the rule reads a fixed-limit bettor's ordinary bets as probes.

Values measured with the production memory feed (observe plus observeHandComplete) against a scripted maniac who bets every checked street (L section 0A and 1): probe share of his checked-to bets 76% (flh heads-up, 5,536 of 7,281 after 5,000 hands), 75% (flo8 heads-up), 100% (flh and flo8, six seats). His raw `betCheckedTo` of 0.78 to 0.86 becomes a read of 0.21 (heads-up) or 0.02 to 0.06 (six seats), under the `flh:hu` envelope edge (0.48) and under `POSTFLOP_MANIAC_MIN_BET_RATE` 0.55. So `isPostflopManiac`, `isAggressor`, the call-down respect shift, barrel narrowing, the V86 strip of line reads and the maniac call-down fold recovery never engage in flh or flo8, at 50, 200, 1,000 or 5,000 hands. At a river facing his bet (flh heads-up, 406 medium hands with true pot share 0.41 at a price of 0.139) the Horse's equity estimate is 0.200 and it folds 32.3%, against 0.448 and 6.9% with memory off (L section 2).

The change: with the switch on, `HorseMind.observe` counts no probe tally (neither `ctBets` nor `ctProbes`) for a hand whose betting structure is `fixed_limit`, so the bets stay whole in `betCheckedTo`. Pinned in `AFixedLimitBetIsNeverAProbe.law.test.ts`: the same scripted flh and flo8 heads-up maniac reads `betCheckedTo` at least 0.9 and `isPostflopManiac` within 100 hands with the switch on, and with it off reads exactly as before (ctBets 300, ctProbes 200, no maniac class).

## Input fidelity

There is no recorded production node with a maniac to replay: no person has played fixed limit since 2026-11-03 (Q section 2: one human ever, 107 flo8 hands, 2026-11-03 02:40Z to 03:53Z; flh 0), and the probe rule only reached the tallies after 2026-11-08. The evidence is a paired two-arm simulation (V), not a replay.

Carried as production runs it: memory on with the production feed (`observe` plus `observeHandComplete`, as `workerRuntime` does), `phase12Remaining` candidate, production rake, the switch turned on for every Horse of the switched arm (one shared memory sandbox, as a process-wide default makes it). The harness was validated against live Horse-only fixed-limit hands (U, segment 2026-11-14T06:27Z to 21:27Z, tolerance 5 points): VALID for flh preflop first-in, big-blind defence and the variant-pack replacement; flh river facing a bet and river betting at six seats; flo8 river facing a bet and river betting at six seats. NOT VALID: flh flop and turn, flo8 preflop, flop and turn; heads-up river (live samples under 100) not judged.

Supplied by hand: the opponents are scripts (sustained maniac, gear-changer switching between maniac and tight-value every 30 hands, tight-value), not recorded players; table sizes 2 and 6 only (live tables are mostly dealt 7 to 9); stacks reset to 100 big blinds each hand; durable opponent profiles start empty (no database hydration). The value row therefore counts only deals whose two arms first differ on a validated street ("validated portion"); totals are diagnostic.

## Value

The change acts on a read, not on one node, so the value is measured per paired deal over whole sessions (V, candidate 26b7604b, F1 alone switched on in arm A). Three opponent ranges, one of them value-only:

| Opponent (range)                         | flh 6 seats            | flo8 6 seats           | flh 2 seats (validated / diagnostic total) | flo8 2 seats (diagnostic only) |
| ---------------------------------------- | ---------------------- | ---------------------- | ------------------------------------------ | ------------------------------ |
| Sustained maniac (every hand, every bet) | +17.03 +/- 5.54        | +72.24 +/- 14.59       | -0.08 +/- 0.54 / +14.91 +/- 1.80           | +9.01 +/- 1.93                 |
| Gear-changer (maniac then value, by 30s) | +0.00 +/- 0.00         | +0.29 +/- 0.58         | +0.05 +/- 0.07 / +7.76 +/- 0.95            | +1.76 +/- 0.65                 |
| Tight-value (value only)                 | +0.00 (0 deals differ) | +0.00 (0 deals differ) | +0.00 (0 deals differ)                     | +0.00 (0 deals differ)         |

Deals: flh 6 seats 1,841 / 4,694 / 8,119; flo8 6 seats 685 / 2,367 / 4,107; flh 2 seats 5,153 / 8,908 / 21,912; flo8 2 seats 2,961 / 6,545 / 18,698. Pass rule declared before the runs (V section 0): harm if any validated cell is below -1 - 2 SE; none is. The only negative estimate, flh heads-up maniac -0.08 +/- 0.54, is the preflop-only validated portion and is within one standard error of zero; its diagnostic total is +14.91.

Sensitivity: positive against the wide range, zero against value only (a tight-value bettor's bet rate stays under the envelope with or without the probe discount, L section 4, so no read changes), and between zero and +0.29 against the gear-changer, which was the declared risk cell (a half-life-30 read lags each gear change). These are simulated values against scripted opponents, not production results.

## Continuation

The argument relies on no assumed fold, call or re-raise frequency: every continuation is played out in the paired deals by the scripts and the Horses. What is not measured from recorded hands is how a real person who plays like a maniac continues after a Horse that recognises him calls down more; no such person has played fixed limit here. The scripts never adapt to the Horse.

## Reach

Human-facing decisions that change today: none. Since 2026-11-03 no person has sat at a fixed-limit table (Q section 2), and no human record holds a probe tally (the tallies are memory only, rebuilt at each worker boot; Q section 1).

Horse-facing: fixed-limit tables run Horse against Horse in production (U: in the 15-hour reference segment, flh alone had 18,912 first-in decisions at dealt 7 to 9 and 8,036 at 5 to 6). With the default on, every Horse counts every opponent's fixed-limit bets whole. F1 alone against Horse opponents was not run; the all-fixes cells against Horses (F1 together with every other fixed-limit fix, so an upper bound on F1's share) changed the action log on 0.9% of flh and 3.5% of flo8 six-seat deals, at +0.18 +/- 0.09 and +0.22 +/- 0.20. Against the scripts with F1 alone: maniac 26.1% (flh 6) and 49.9% (flo8 6) of deals differ; tight-value 0%; gear-changer 0.1% and 1.4%. "Already that action in production" does not apply: the change is a read, and no single action is substituted.

No-limit and pot-limit reach: their counting is byte-identical (law test: tallies equal with the switch on, off and with no structure given). Because the tallies are pooled per player across games, a player who played fixed limit since the worker booted no longer has those bets in the probe share his no-limit read is discounted by; this is a correction of the contamination (fixed-limit bets inflated his probe share), it reaches only Horses today (878 Horses have fixed-limit profiles and all also play other games, Q section 2), and it was not measured separately.

## Scope

Gated in code to hands whose betting structure is `fixed_limit` (`bettingStructureFor`: flh and flo8), cash and tournament alike. Every path that counts takes the structure: the completed-hand learner and mind mirror (`workerRuntime.observeCompletedHandInMind`, from `riverCallContext.variant`), the in-decision observation (`HorseLogic.prepareOriginalReads`), the observer sandbox learner (`observerReads.learnPublic`) and the boot replay (`HorseMindHydrator`, from `hand_history.game_variant`; a row without a variant counts as before). Decision-level cases: flh and flo8 heads-up recognition with the switch on and the old counting with it off; a no-limit one-big-blind bet is still a probe; no-limit and pot-limit counting identical on, off and with no structure; both production paths hand the variant to the counter (`AFixedLimitBetIsNeverAProbe.law.test.ts`); the hydrator hands each replayed hand its structure (`HorseMindHydrator.test.ts`). Excluded: every no-limit and pot-limit hand (counting unchanged). Tournaments are reached by the code but are outside the evidence (cash only).

## Visibility

`fixed_limit_bet_not_a_probe_seen` (registered in `HorseDataLedger.ts`) fires for each checked-to postflop bet in a fixed-limit hand that is counted without a probe tally; with the default on it is expected to fire at every fixed-limit table, and its silence while fixed-limit tables run means the default is not in effect. On fixed-limit decisions, `opponent_read_probe_bets_discounted` should then fire only from a player's no-limit probe history (see Limits).

## Limits

- Offline only. The value is a paired simulation against scripted opponents; the harness is validated only for flh preflop and six-seat river play and flo8 six-seat river play. The heads-up maniac totals (+14.91 flh, +9.01 flo8) are on unvalidated streets and diagnostic only.
- No natural human witness exists: no person has played fixed limit since 2026-11-03, so live behaviour against a human maniac is unverified until one plays on a release that carries this.
- Tables of 7 to 9 dealt players, the most common live size, are not covered; tournaments are not in the evidence.
- F1 alone against Horse opponents was not measured; the all-fixes Horse cells bound it.
- Future counting only: nothing is reset, rewritten or replayed. The tallies are memory only and rebuilt at each worker boot through the hydrator, which applies the switch, so the release restart starts clean.
- Not repaired here (known, not built): the read-time direction. `probeAdjusted` applies a player's pooled probe share to every read, so his no-limit probe history still discounts his fixed-limit `betCheckedTo` (Q section 3, "F1b"). It matters only for a player who plays both; no human does today.
- The other fixed-limit defects found with this one (the commitment surcharge on a one-bet call, the hi-lo cap that drops the low half, the flo8 envelope edges, the V86 raise-width condition at six seats) are separate options and stay as they are; T2 (`FIXED_LIMIT_RIVER_BETS_ARE_VALUE_EVIDENCE_DEFAULT`) stays false and every #10930 decide option stays off.
- Rollback: `HorseMind.setFixedLimitBetsAreNeverProbes(false)` reproduces the old counting exactly (law test); in production that needs a source change, because the switch is not in the decide options.
