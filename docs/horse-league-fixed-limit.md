# The league and fixed limit

Written 2026-11-20. This file says what the nightly duplicate league (`server/src/benchmark/HorseLeague.ts`) deals for fixed-limit games, how that is proven, what it still refuses and exactly what has to be built before each refused arm can become a card. `UNMEASURABLE_MATCHUPS` cites it.

## What is dealt

Fixed-limit hold'em (`flh`, since 2026-11-20) and fixed-limit Omaha hi-lo (`flo8`, since 2026-11-21), cash, no ante, Horse seats only (plus the scripted `flh` field for `flh`), stacks above 24 big blinds.

| Rule                                                                              | Where the league gets it                                                        | The live table's own code                                 |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Wager size: one big blind preflop and on the flop, two on the turn and river      | `fixedLimitBetSize` through `leagueFixedLimitBounds` (`LeagueDecisionState.ts`) | `HandController.streetBetSize`                            |
| Four wagers a street (the big blind is the first preflop), then fold or call only | `isFixedLimitCapped`                                                            | `HandController.getAvailableActions`, `buildBettingState` |
| One legal amount for a bet or raise                                               | `calculateBettingState(..., fixedLimit)` and `validateAction`                   | the same two functions                                    |
| A wager on a capped street becomes a call or check                                | `substituteOnCappedStreet`                                                      | `ServerTableEngineTurns.scheduleHorseAction`              |
| A deep stack's all in executes as the street's one bet or raise                   | `playHand`, fixed-limit branch                                                  | `HandController.clampToStructure`                         |
| `lastRaise` and `minRaise` sit at the street's wager and a raise never moves them | `runStreet`                                                                     | `HandController.advanceStage`, `performAction`            |
| The menu handed to the brain                                                      | `leagueFixedLimitActionState`                                                   | `HandController.getAuthoritativeActionState`              |
| Hi-lo showdown settlement (`flo8`): qualifying low, halves, quartering, odd cent  | `settleLeagueShowdown` (merged pot layers into `determineWinners`)              | `calculatePots`, `determineWinners`                       |

Nothing is re-implemented: the league calls the functions the controller calls.

## Why the domain is this narrow

`leagueFixedLimitRefusal` refuses, and `playHand` throws, for anything outside it:

- **Stacks of 24 big blinds or less.** A fixed-limit hand costs one seat at most 4 + 4 + 8 + 8 = 24 big blinds. Above that no seat can be all in. At or below it a seat can go all in for less than a wager, and the rules for that short wager (completion below half a bet, reopening at half a bet or more: `fixedLimitStreetBounds.raiseSize`, `HandController.canReopenBetting`, uncalled excess when every opponent is all in) are not in the league's street loop.
- **Tournament context or an ante.** Neither is modelled for this structure in the league.
- **A field population, except the scripted fixed-limit hold'em field on `flh`.** No population is calibrated for fixed limit, and the calibrated and pressure seats build a no-limit menu (`humanFieldDecision`, `pressureFieldDecision`). Since 2026-11-20 the one field a fixed-limit hand seats is `flh_scripted_field_v1` (qualified for `flh` only; its postflop rules score Hold'em hands), whose seats are offered the controller's fixed-limit menu (below, "The scripted fixed-limit field"). `flo8` seats Horses only.

## The proof

`server/src/benchmark/HorseLeagueFixedLimit.test.ts`:

1. Every league hand in the sample (`flh`: 120 heads-up, 120 six-max; `flo8`: 80 heads-up, 80 six-max) is replayed action by action through a real `HandController` dealt the same cards. At every node: the same seat on the clock, the same street, pot, bet level, `minRaise`, `lastRaise`, board, per-seat stack, bet and investment, and the same recorded action history; the menu the brain received (legal actions, price to call, the one legal wager, the street unit, the cap flag, the small bet) equals the controller's authoritative menu; the controller accepts the league's action; the controller's final stacks equal the league's settlement seat by seat (including `flo8` qualifying-low split showdowns).
2. The structure read off the league's own actions (`flh`: 150 hands each heads-up and six-max; `flo8`: 100 hands each heads-up and six-max): unit by street, at most four wagers, fold and call only on a capped street, the pot equal to the chips put in, chips conserved, no seat losing more than 24 big blinds, no all in, zero illegal actions, zero truncated streets.
3. The refusals above (both `flh` and `flo8`).
4. The cards (`FIXED_LIMIT_HOLDEM_CARDS`, `FIXED_LIMIT_OMAHA_HILO_CARDS`, `FIXED_LIMIT_SCRIPTED_FIELD_CARDS`): on the card, inside the domain, arms that diverge, results the compute worker boundary accepts.

`ALeagueDecisionStateIsProductions.law.test.ts` carries five fixed-limit nodes (three `flh`: six-max first in, heads-up facing the cap, six-max turn facing a bet and a raise; two `flo8`: six-max first in, heads-up turn facing a big bet and a raise): the league state equals, key by key, the request the real `ServerTableEngine.scheduleHorseAction` sends.

Mutation checks run on 2026-11-20 (file restored after each): pricing a turn wager at the small bet fails the replay and the structure tests; never reporting a street as capped fails both.

## What was measured on the legal game

`runMatchup`, Horse mirror, 100 big blinds, arm A the option on and arm B off. bb/100 is in big blinds, and a fixed-limit big blind is the small bet.

| Arm                               | Seats | Setting                               | Seed     | Pairs | Diverged | bb/100  | Std. error |
| --------------------------------- | ----- | ------------------------------------- | -------- | ----- | -------- | ------- | ---------- |
| `fixedLimitPricedPreflop`         | 6     | Hybrid cash, deal-seeded mood         | 20261115 | 300   | 30       | 1.1111  | 1.2389     |
| `fixedLimitPricedPreflop`         | 6     | plain                                 | 20261115 | 300   | 30       | -2.5278 | 1.6539     |
| `fixedLimitPricedPreflop`         | 2     | plain                                 | 20261115 | 300   | 109      | -1.5    | 6.3543     |
| `fixedLimitRiverFullBetRead`      | 2     | Hybrid cash, deal-seeded mood         | 20261115 | 300   | 9        | 1.3333  | 1.1541     |
| `fixedLimitRiverFullBetRead`      | 2     | plain                                 | 20261115 | 300   | 7        | 1.3333  | 1.0530     |
| `fixedLimitCallIsNotACommitment`  | 6     | plain                                 | 20261115 | 300   | 1        | 0.1111  | 0.1111     |
| `fixedLimitCallIsNotACommitment`  | 6     | Hybrid cash, deal-seeded mood         | 20261115 | 300   | 1        | 0.2778  | 0.2778     |
| `fixedLimitCallIsNotACommitment`  | 6     | Hybrid cash, deal-seeded mood         | 20261120 | 2,000 | 1        | 0.0375  | 0.0375     |
| `fixedLimitCallIsNotACommitment`  | 6     | production personas, deal-seeded mood | 20261120 | 600   | 2        | 0.25    | 0.1777     |
| `fixedLimitCallIsNotACommitment`  | 2     | plain                                 | 20261115 | 300   | 0        | 0       | 0          |
| `fixedLimitReadIgnoresProbes`     | 6     | plain                                 | 20261115 | 300   | 0        | 0       | 0          |
| `fixedLimitReadIgnoresProbes`     | 2     | plain                                 | 20261115 | 300   | 0        | 0       | 0          |
| `fixedLimitReadIgnoresProbes`     | 6     | production personas, deal-seeded mood | 20261120 | 300   | 0        | 0       | 0          |
| `fixedLimitRiverStrongHandLeads`  | 6     | plain                                 | 20261115 | 300   | 0        | 0       | 0          |
| `fixedLimitRiverStrongHandLeads`  | 2     | plain                                 | 20261115 | 300   | 0        | 0       | 0          |
| `fixedLimitRiverStrongHandLeads`  | 6     | production personas, deal-seeded mood | 20261120 | 300   | 1        | 0.1111  | 0.1111     |
| `fixedLimitRiverOneBetValueRaise` | 2     | plain                                 | 20261115 | 300   | 0        | 0       | 0          |
| `fixedLimitRiverOneBetValueRaise` | 2     | production personas, deal-seeded mood | 20261120 | 300   | 0        | 0       | 0          |
| `fixedLimitStealVsTightBlinds`    | 6     | plain                                 | 20261115 | 300   | 0        | 0       | 0          |

Every run: 0 illegal actions, 0 truncated streets, 0 brain exception fallbacks. None of these is a verdict on an option. They show which arms a Horse mirror can and cannot move.

### Fixed-limit Omaha hi-lo (`flo8`), measured 2026-11-21 on the legal game

`runMatchup`, Horse mirror, `flo8`, 100 big blinds, `EQUITY_GOVERNOR=off`, seed 20261115, 300 pairs, arm A the option on and arm B off. Every run had 0 illegal actions, 0 truncated streets, 0 corrected actions and 0 brain exception fallbacks.

| Arm                              | Seats | Setting                       | Pairs | Diverged | bb/100 | Std. error |
| -------------------------------- | ----- | ----------------------------- | ----- | -------- | ------ | ---------- |
| `fixedLimitOmahaNoPresumption`   | 2     | Hybrid cash, deal-seeded mood | 300   | 59       | +11.42 | 4.07       |
| `fixedLimitOmahaNoPresumption`   | 2     | plain                         | 300   | 64       | +11.83 | 4.05       |
| `fixedLimitPricedPreflop`        | 6     | Hybrid cash, deal-seeded mood | 300   | 68       | -0.44  | 1.88       |
| `fixedLimitPricedPreflop`        | 6     | plain                         | 300   | 56       | -3.43  | 1.76       |
| `fixedLimitRiverFullBetRead`     | 2     | Hybrid cash, deal-seeded mood | 300   | 5        | +0.33  | 1.20       |
| `fixedLimitRiverFullBetRead`     | 2     | plain                         | 300   | 5        | -1.33  | 1.77       |
| `fixedLimitHiLoNutLowRiverBet`   | 2     | Hybrid cash / plain           | 300   | 0 / 0    | 0.00   | 0.00       |
| `fixedLimitHiLoLowHalfFloor`     | 6     | Hybrid cash / plain           | 300   | 0 / 0    | 0.00   | 0.00       |
| `fixedLimitCallIsNotACommitment` | 6     | Hybrid cash / plain           | 300   | 0 / 0    | 0.00   | 0.00       |
| `fixedLimitRiverStrongHandLeads` | 6     | Hybrid cash / plain           | 300   | 0 / 0    | 0.00   | 0.00       |
| `fixedLimitStealVsTightBlinds`   | 6     | Hybrid cash / plain           | 300   | 0 / 0    | 0.00   | 0.00       |
| `fixedLimitReadIgnoresProbes`    | 6     | Hybrid cash / plain           | 300   | 0 / 0    | 0.00   | 0.00       |

## The cards

- `FIXED_LIMIT_HOLDEM_CARDS`: `flh_priced_preflop` (six seats, 2,000 pairs) and `flh_river_full_bet_read` (heads-up), both on the live cash Hybrid persona with the deal-seeded mood clock. They only measure. Both options stay default off: `fixedLimitPricedPreflop` is under the owner's preflop range hold and `fixedLimitRiverFullBetRead` is an opt-in arm production never sets.
- `FIXED_LIMIT_OMAHA_HILO_CARDS` (added 2026-11-21): `flo8_no_omaha_presumption` (heads-up, 2,000 pairs), `flo8_priced_preflop` (six seats, 2,000 pairs) and `flo8_river_full_bet_read` (heads-up), all on the live cash Hybrid persona with the deal-seeded mood clock. They only measure; every option stays default off. The other six `flo8` arms diverged in 0 of 300 pairs on the legal game and stay refused in `UNMEASURABLE_MATCHUPS` with their counts.
- `FIXED_LIMIT_SCRIPTED_FIELD_CARDS` (since 2026-11-20, nine cards since 2026-11-21): `flh` cards against the scripted field; see "The scripted fixed-limit field" below.

## The scripted fixed-limit field (built 2026-11-20)

`FixedLimitScriptedField.ts`, seated through the league's existing human-field mechanism: `LeagueMatchup.opponentPopulation = 'flh_scripted_field_v1'` and `LeagueMatchup.humanPersona` naming the script. `runHumanFieldMatchup` seats the hero Horse at seat 1 and the script in every other seat through `LeagueHumanField.seatPolicyOf`; `leagueFixedLimitRefusal` admits this field and no other in a fixed-limit hand, and `playHand` throws if a fixed-limit field seat has no script.

Invariants, each pinned in `server/src/benchmark/HorseLeagueFixedLimitField.test.ts`:

- A script reads its own cards and the public state only (`LeagueSeatSpot`), never calls the Horse brain and consumes no randomness, so the field is a pure function of the deal seed and the actions before it.
- It is offered the controller's own fixed-limit menu (`seatPolicyDecision` now takes `leagueActionState` for a fixed-limit hand) and answers only with an action on that menu, at the one legal wager. The league applies the answer unchanged.
- Hands with scripted seats replay through a real `HandController` (heads-up and six seats, 60 hands for each persona): at every node the menu the Horse or the script was offered equals `getAuthoritativeActionState`, the controller accepts every action, and its final stacks equal the league's settlement. Chips are conserved and no seat loses more than 24 big blinds.
- A card run twice on one seed returns the same result.

### The personas

| Persona                                                                     | Rule                                                                                                                                                                                                                                                                                                                    | Source                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flh_maniac_v1`                                                             | Bets or raises whenever a wager is on the menu, otherwise calls; never folds. Wager rate 1.0, fold rate 0.0.                                                                                                                                                                                                            | This file, section 1 as first written ("bet or raise whenever one is legal, otherwise call, never fold"); the lane's "Sustained maniac (every hand, every bet)" and "scripted maniac who bets every checked street" (`docs/horse-default-on.d/fixedLimitBetsAreNeverProbes.md`).                                                                   |
| `flh_tight_value_v1`, preflop                                               | Raise or fold. First in raises the top 80% heads-up, 26% at up to six seats, 18% above; big blind unraised raises at percentile 0.85 or better, else checks; facing one raise re-raises at 0.94 (heads-up 0.85), calls at 0.82 (heads-up 0.50); facing two or more caps at 0.975, calls at 0.95.                        | `ExploiterLeague.ts` `regPreflop` / `openTop`, the repository's recorded tight-aggressive reference, with each no-limit size replaced by the one fixed-limit wager. Its 26% six-max first-in share is inside the "21-27 percent raiser" the lane recorded for its tight-value player (`docs/changelog/2026-11-14-fixed-limit-tight-reads.md`, T1). |
| `flh_tight_value_v1`, postflop                                              | Value only, by made class (only a class the player's own cards improve on the board counts): bets or raises with two pair or better; puts in a third wager or more only with trips or better; calls one wager with a pair or better, two or more with two pair or better; otherwise checks or folds. No bluff, no draw. | **Design value.** No record in this repository states the lane's tight-value postflop thresholds (its scripts live in its evidence archive).                                                                                                                                                                                                       |
| No-limit probe history script (warm-up only)                                | Preflop checks or calls, never raises; after the flop makes the minimum bet whenever checked to and calls any bet. Every such bet is a probe by the rule in `HorseOpponentExploit` (one big blind).                                                                                                                     | **Design value.** The lane's seeding (`AB-EVALUATION-2.md` 3.1 (b)) is not recorded here.                                                                                                                                                                                                                                                          |
| `flh_passive_caller_v1` (2026-11-21), preflop                               | Never raises first in. Unraised it calls at percentile 0.40 or better, else folds (the big blind checks); facing one raise re-raises at 0.92, calls at 0.40; facing two or more calls at 0.60.                                                                                                                          | `ExploiterLeague.ts` `callingStation` ("Never folds after the flop; calls wide preflop; bets only strong hands"), the repository's one recorded passive-caller policy, bars unchanged, each no-limit size replaced by the one fixed-limit wager.                                                                                                   |
| `flh_passive_caller_v1`, postflop                                           | Never folds. Checked to, bets two pair or better, else checks; facing a wager raises only with a full house or better, else calls.                                                                                                                                                                                      | "Never folds after the flop" is `callingStation`'s. The two made-class bars are a **design value**: `callingStation` bets at a Monte Carlo equity of 0.75 and raises at 0.95, and a script here may consume no randomness, so each equity bar is replaced by a made class chosen here.                                                             |
| `flh_over_folding_blinds_v1` (2026-11-21), preflop                          | Never raises. First in calls the share tight-value opens (26% at up to six seats), else folds; the big blind checks its option; facing one raise calls at percentile 0.82 or better (heads-up 0.50), so a six-max blind folds to one raise 82% of the time; facing two or more calls at 0.95.                           | Bars: `FLH_TIGHT_VALUE_PREFLOP` (`ExploiterLeague.ts` `regPreflop` / `openTop`). Replacing every raise by a call is a **design value**. For scale, the published defence widths quoted in `HorseFixedLimitPreflop.ts` are 45 to 55 percent defended against an early raise and 75 to 85 against the button.                                        |
| `flh_over_folding_blinds_v1`, postflop                                      | Checks whenever it may and folds to every wager.                                                                                                                                                                                                                                                                        | **Design value.** No record in this repository states the lane's over-folder thresholds. It is the extreme over-folder, the steal's most favourable range. Why no frequency is mixed: see "The over-folder read and mixed frequencies" below.                                                                                                      |
| `flh_value_only_blinds_v1` (2026-11-21, steal harm control), preflop        | `flh_tight_value_v1`'s raise or fold.                                                                                                                                                                                                                                                                                   | `FLH_TIGHT_VALUE_PREFLOP` (`ExploiterLeague.ts` `regPreflop` / `openTop`).                                                                                                                                                                                                                                                                         |
| `flh_value_only_blinds_v1`, postflop                                        | Continues only with two pair or better: bets it when checked to, raises one wager with it (a third wager or more only with trips or better), folds everything else to a wager, one pair included.                                                                                                                       | **Design value.** No record states a value-only player's postflop continuation thresholds; the raise-again class is `flh_tight_value_v1`'s.                                                                                                                                                                                                        |
| `flh_preflop_defending_blinds_v1` (2026-11-21, steal harm control), preflop | Never raises. First in and facing two raises as `flh_over_folding_blinds_v1`; facing one raise calls at percentile 0.20 or better at three to six seats (80% defended), 0.12 heads-up (88%), 0.50 above six seats (50%).                                                                                                | The defence widths quoted in `HorseFixedLimitPreflop.ts` REFERENCES: "vs the button ~75-85%", "heads-up ~85-90%", "vs early ~45-55%", each at the middle of its range.                                                                                                                                                                             |
| `flh_preflop_defending_blinds_v1`, postflop                                 | Checks whenever it may and folds to every wager.                                                                                                                                                                                                                                                                        | **Design value**, as `flh_over_folding_blinds_v1`.                                                                                                                                                                                                                                                                                                 |

Built 2026-11-21: the per-node table of changed decisions the Value row of `docs/HORSE-DECISION-CHANGE-EVIDENCE.md` requires (`LeagueChangedNodeTable.ts`, below) and the two harm controls for the steal (`flh_value_only_blinds_v1`, `flh_preflop_defending_blinds_v1`). Still not built: any field that moves `fixedLimitRiverStrongHandLeads`.

### The over-folder read and mixed frequencies (found 2026-11-21)

`fixedLimitStealVsTightBlinds` acts only when every player behind has his own over-folder read: postflop fold to a bet engaged high on at least 15 decayed opportunities (`FIXED_LIMIT_STEAL_MIN_OPPS`), no preflop statistic engaged wide. The first form of the over-folding script (the tight-value raise-or-fold preflop, postflop continuing with two pair or better) never engaged it at seed 20261115: 0 of 10,000 pairs diverged, the reads printed at the gate during a 4,000-pair run were all empty (no statistic engaged), and the one counter row printed during a 2,500-pair run held 12.4 decayed fold opportunities. The cause read from the code, not separately measured: `HorseOpponentExploit.styleShiftReleased` ages an opportunity-gated statistic at the fast rate (half-life 8 hands) whenever a fast-window rate differs from the long one by 0.2, and a mixed frequency trips that by chance, so the long window never fills. The script as built has no mixed frequency (it never raises and always folds to a postflop wager); the three reads printed at the gate during a 3,000-pair run held 38.8 to 41.8 decayed opportunities, each engaged high. What this means for people is NOT MEASURED: how often a real over-folding player keeps 15 decayed opportunities is unknown, so the option's reach against people may be small. That is a property of the read, not a defect of the league, and it is recorded here for the Fixed-Limit lane; nothing in the engine was changed.

**Investigated 2026-11-21 (second pass): a stationary player trips the style-shift release by chance, and the release drains a sparse statistic. It is a defect against the release's stated intent, on a default-on path, and is NOT fixed here.**

What the code does (`HorseOpponentExploit.ts`). `decayAndAddOpportunityScoped` keeps a long-window opportunity-gated statistic (fold to a bet, river call, bet when checked to, rfi, three-bet, fold to a three-bet) at full weight on a hand that offered no such spot, unless `styleShiftReleased(row)` is true; then every long-window gated statistic ages at the fast rate (half-life 8 hands) on that hand whether or not it had the spot. `styleShiftReleased` is true when ANY of six fast-window rates (pfr, rfi, three-bet, bet when checked to, fold to a bet, river call) differs from its long-window rate by 0.2 or more on at least 3 decayed fast opportunities. Two things follow. First, the test compares two point estimates with no allowance for sampling noise, and a fast window of 3 to 11 decayed opportunities is noisy, so a player whose frequency never changes trips it by chance. Second, a release from any one statistic ages all of them: a stable preflop raiser's rfi noise drains his postflop fold sample.

What was measured (a simulation of the real functions, not of the league): a stationary player whose increments are drawn with fixed probabilities and fed to `decayAndAddOpportunityScoped` exactly as `HorseMind.observeExploitHand` feeds them, 4,000 hands, the first 1,000 dropped, six seeds pooled. "Released" is the share of hands on which `styleShiftReleased` was true before the update; "fold opps" is the decayed `foldToBetOpp`, and "at least 15" the share of hands on which it was at least `FIXED_LIMIT_STEAL_MIN_OPPS`.

| First in on | Raises first in | Faces a postflop bet on | Folds to it | Released (shipped rule) | Fold opps, mean | At least 15 | Same, release forced off: fold opps / at least 15 |
| ----------- | --------------- | ----------------------- | ----------- | ----------------------- | --------------- | ----------- | ------------------------------------------------- |
| no hands    | -               | 3% of hands             | 100%        | 0.0%                    | 34.2            | 100%        | 34.2 / 100%                                       |
| no hands    | -               | 10%                     | 70%         | 0.5%                    | 37.3            | 100%        | 43.1 / 100%                                       |
| 60%         | 26%             | 3%                      | 100%        | 2.5%                    | 11.7            | 22.5%       | 34.1 / 100%                                       |
| 60%         | 26%             | 3%                      | 70%         | 2.3%                    | 13.3            | 35.6%       | 35.6 / 100%                                       |
| 60%         | 26%             | 6%                      | 100%        | 2.1%                    | 20.7            | 84.7%       | 41.6 / 100%                                       |
| 60%         | 26%             | 10%                     | 70%         | 2.3%                    | 24.9            | 96.2%       | 43.1 / 100%                                       |
| 60%         | 50%             | 3%                      | 100%        | 4.4%                    | 7.7             | 2.2%        | 34.5 / 100%                                       |
| 60%         | 50%             | 6%                      | 70%         | 3.9%                    | 15.2            | 44.2%       | 41.5 / 100%                                       |

So a player who never changes, raises 26% of his first-in hands and faces a postflop bet on 3% of hands (a tight player who rarely sees a flop) keeps on average 11.7 decayed fold opportunities, at or above 15 on 22.5% of hands, against 34.1 and 100% with the release forced off. That is consistent with the 12.4 printed against the first over-folding script, whose six-seat preflop raised 26% of its first-in hands and folded the rest (its postflop opportunity rate was not measured). A pure fold frequency does not protect the statistic (the 100% rows): the release comes from the preflop raising. The 2026-11-06 ruling (`docs/changelog/2026-11-06-opportunity-scoped-decay-with-style-shift-release.md`) accepted releases on "about 5-7% of all updates for stable players" as the cost of the 0.2 / 3 rule; what it did not measure is that 2% to 4% of hands is enough to cut a rarely reached statistic to a third, which is the sample evaporation the opportunity-scoped decay exists to prevent.

Why it is not fixed in this change. Every Horse's live memory learns through this rule (`HorseMind.observeExploitHand` always passes `opportunityScoped = true`, live since 2026-11-06 by the owner's ruling), the durable profile learns through its SQL twin (`fn_horse_exploit_add`, migration 20261107022913, which must stay identical), and `styleShiftReleased` also gates the intra-session gear-shift engagement in `opponentExploitRead`. Any root fix (a release that requires the gap to exceed the fast window's sampling noise, or that ages only the statistic whose own window shifted) changes default-on reads of every opponent at every variant, needs the SQL twin changed in the same release, and re-opens a parameter the owner ruled on. It is reported to the coordinator with this evidence instead. Which live decisions it would change: every read that uses a long-window gated statistic of a stable player whose mixed frequencies trip the release, at every variant, Horses and people alike; the fixed-limit steal is one of them.

**Root fix built 2026-11-21 behind the option `styleShiftReleaseIsNoiseAware` (registered default OFF, so live play is unchanged):** a statistic releases only beyond its sampling noise and ages only itself (a moved pfr still ages every gated statistic), in `HorseOpponentExploit.ts` and in the SQL twin (migration 20261121171027). With it on, the stable 26% raiser above keeps 33.2 decayed fold opportunities (simulation, six seeds; release forced off 34.2), and the steal against the value-only blinds diverges on 84 and 68 of 20,000 pairs (+0.32 +/- 0.11 bb/100 over both seeds, z 2.96). Evidence and verdict: `docs/horse-option-authority.d/styleShiftReleaseIsNoiseAware.md`.

The simulation, for reproduction (run from server/ with `npx tsx`):

```ts
import {
  decayAndAddOpportunityScoped,
  styleShiftReleased,
  freshExploitCounters,
} from './src/engine/HorseOpponentExploit.ts';
// mulberry32; a stationary player: first in on share a (raises rr of those), faces a postflop bet on share q (folds p).
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function run(a: number, rr: number, q: number, p: number, seed: number) {
  const r = rng(seed),
    row = freshExploitCounters();
  let rel = 0,
    opp = 0,
    ge = 0,
    n = 0;
  for (let h = 0; h < 4000; h++) {
    const inc = freshExploitCounters();
    inc.hands = 1;
    inc.fHands = 1;
    if (r() < a) {
      inc.rfiOpp = 1;
      inc.fRfiOpp = 1;
      if (r() < rr) {
        inc.rfi = inc.fRfi = inc.pfr = inc.fPfr = 1;
      }
    }
    if (r() < q) {
      inc.foldToBetOpp = 1;
      inc.fFoldToBetOpp = 1;
      if (r() < p) {
        inc.foldToBet = 1;
        inc.fFoldToBet = 1;
      }
    }
    const released = styleShiftReleased(row);
    decayAndAddOpportunityScoped(row, inc);
    if (h >= 1000) {
      n++;
      if (released) rel++;
      opp += row.foldToBetOpp;
      if (row.foldToBetOpp >= 15) ge++;
    }
  }
  return { released: rel / n, foldOpps: opp / n, atLeast15: ge / n };
}
```

The "release forced off" column ran the same update with the row's fast hand count set below 3 for the one call, so `styleShiftReleased` answered false and every other field aged as shipped.

### The no-limit probe history (`LeagueMatchup.probeHistoryHands`)

Before the first pair, each pass sandbox plays N no-limit hold'em hands at the same seats (hero on its own arm, the field on the probe script, learning on; `leagueProbeHistoryWarmup`). The test shows every field seat holds a non-zero pooled probe tally (`ctBets`, `ctProbes`) afterwards and a fresh sandbox holds none. Refused for any other field, with learning off, or with a spot selection.

### A league memory defect found and fixed

`playHand`'s settlement called `HorseMind.observe` without the hand's betting structure, so every fixed-limit bet a league hand completed was tallied as a probe, while production's accepted-hand learner passes `bettingStructureFor(variant)` (`workerRuntime.observeCompletedHandInMind`) and, with FIXED-LIMIT BETS ARE NEVER PROBES on, tallies none. The league now passes it. Measured on `flh_read_ignores_probes_vs_maniac` without a probe history (seed 20261115, 1,000 pairs): 320 pairs diverged before the fix, 0 after; 333 with the 300-hand history. The Horse-mirror fixed-limit counts recorded above were re-measured after the fix at seed 20261115, 300 pairs, and are unchanged (priced preflop 30, river full-bet read 9, call-is-not-a-commitment 1, strong hand leads 0, one-bet value raise 0, steal 0, read ignores probes 0). The fix did change the call-is-not-a-commitment card against the maniac (seed 20261115, 200 pairs: 13 diverged, +140.00 +/- 99.60 bb/100 before; 16 diverged, -86.00 +/- 21.43 after), so only results taken after the fix are reported below.

### The cards and what they measured

`FIXED_LIMIT_SCRIPTED_FIELD_CARDS`, on the live cash Hybrid persona with the deal-seeded mood clock:

Seeds 20261120 and 20261121, run with `npx tsx src/scripts/horseLeagueCard.ts`. bb/100 is arm A (option on) minus arm B (off), in big blinds; a fixed-limit big blind is the small bet. The first two cards ran on the working tree that became commit 95a9430a0, with the memory fix already applied; the other four ran at 95a9430a0.

| Card                                                                                                       | Pairs per seed | Seed 20261120                         | Seed 20261121                         | Seeds together                                     |
| ---------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------- | ------------------------------------- | -------------------------------------------------- |
| `flh_call_is_not_a_commitment_vs_maniac` (6 seats)                                                         | 12,000         | -28.02 +/- 7.30, 928 diverged         | -21.35 +/- 8.10, 952 diverged         | -24.68 +/- 5.45, z -4.53, SIGNIFICANT              |
| `flh_call_is_not_a_commitment_vs_tight_value` (6 seats, harm control)                                      | 50,000         | +0.02 +/- 0.01, 4 diverged            | -0.02 +/- 0.03, 2 diverged            | +0.00 +/- 0.02, not resolved                       |
| `flh_river_one_bet_value_raise_vs_maniac` (heads-up)                                                       | 15,000         | +1.13 +/- 0.25, 91 diverged           | +1.67 +/- 0.28, 109 diverged          | +1.40 +/- 0.19, z 7.38, SIGNIFICANT                |
| `flh_river_one_bet_value_raise_vs_tight_value` (heads-up, harm control)                                    | 45,000         | +0.04 +/- 0.05, 61 diverged           | +0.10 +/- 0.05, 57 diverged           | +0.07 +/- 0.04, not resolved                       |
| `flh_read_ignores_probes_vs_maniac` (6 seats, 300 no-limit hands first)                                    | 10,000         | +226.30 +/- 24.58, 3,283 diverged     | +231.46 +/- 24.76, 3,305 diverged     | +228.88 +/- 17.44, z 13.12, SIGNIFICANT            |
| `flh_read_ignores_probes_vs_tight_value` (6 seats, harm control)                                           | 45,000         | -0.00 +/- 0.00, 1 diverged            | 0.00 +/- 0.00, 0 diverged (INERT)     | not resolved                                       |
| `flh_river_one_bet_value_raise_vs_passive_caller` (heads-up, third range; 2026-11-21)                      | 45,000         | +0.04 +/- 0.05, z 0.78, 60 diverged   | +0.11 +/- 0.04, z 2.83, 60 diverged   | +0.07 +/- 0.03, z 2.41, SIGNIFICANT (marginal)     |
| `flh_steal_vs_tight_blinds_vs_over_folding_blinds` (6 seats, favourable range; 2026-11-21)                 | 10,000         | +7.00 +/- 0.39, 388 diverged          | +6.68 +/- 0.39, 353 diverged          | +6.84 +/- 0.28, z 24.68, SIGNIFICANT               |
| `flh_river_strong_hand_leads_vs_passive_caller` (heads-up; measured 2026-11-21, NOT kept on the card)      | 20,000         | -0.01 +/- 0.01, 1 diverged            | 0.00 +/- 0.00, 0 diverged (INERT)     | not resolved, inert                                |
| `flh_steal_vs_tight_blinds_vs_preflop_defending_blinds` (6 seats, harm control; 2026-11-21)                | 10,000         | +6.41 +/- 0.62, z 10.40, 427 diverged | +6.18 +/- 0.59, z 10.42, 382 diverged | +6.29 +/- 0.43, z 14.72, SIGNIFICANT               |
| `flh_steal_vs_tight_blinds_vs_value_only_blinds` (6 seats, harm control; 2026-11-21, NOT kept on the card) | 20,000         | +0.03 +/- 0.02, z 1.31, 2 diverged    | +0.02 +/- 0.01, z 1.41, 2 diverged    | +0.02 +/- 0.01, z 1.84, not resolved, almost inert |

The three 2026-11-21 rows ran on the working tree of their pull request (base 5bfaa38d0, `server/src` as merged in it), sizes fixed before the runs from development probes at seed 20261115, which are reported here and not pooled: value raise against the passive caller 1 of 1,000 pairs diverged (-0.40 +/- 0.40); steal against the over-folding blinds 109 of 3,000 (+6.47 +/- 0.74); river lead against the passive caller 2 of 10,000 heads-up (0.00 +/- 0.03) and 0 of 4,000 at six seats. Block standard errors: value raise 0.05 and 0.03, steal 0.44 and 0.49. No sample was enlarged after a result.

The two steal harm controls (second pass of 2026-11-21) ran on the working tree of their pull request (base 8d01508d3, `server/src` as merged in it). Their sizes were fixed before the runs at seeds 20261120 and 20261121 from development probes at seed 20261115 (3,000 pairs each, reported here and not pooled): against the preflop-defending blinds +5.45 +/- 1.08, z 5.03, 121 diverged; against the value-only blinds 0 of 3,000 diverged. Block standard errors: preflop-defending 0.70 and 0.72, value-only 0.02 and 0.02. No sample was enlarged after a result.

Every run had 0 illegal actions, 0 truncated streets and 0 brain exception fallbacks. Corrected actions came only from the hero Horse (2,091 to 2,503 per maniac run, 0 in every tight-value run); a script's answer is never corrected (pinned in the test). The solver stores were empty: the nightly worker hydrates them and these runs did not.

How to read these figures:

- `fixedLimitCallIsNotACommitment` LOSES against this field: -24.68 +/- 5.45 bb/100 across the two seeds, against the lane's +9.34 +/- 4.10 big bets per 100 hands for flh six seats against its maniac (`docs/horse-default-on.d/fixedLimitCallIsNotACommitment.md`). The fields are not the same. Here five maniacs cap almost every street, and the Horse's memory now reads them whole (the memory fix above). Before that fix the same card read +124.10 +/- 9.45 at the same seeds and sizes (+131.90 +/- 13.67 and +116.31 +/- 13.05). That number came from the defect and is withdrawn.
- `fixedLimitReadIgnoresProbes` changes about a third of the pairs against a maniac carrying a no-limit probe history. That is the case it was built for, and the lane measured it at 23.5 to 23.8 % of deals. Against the value-only player it changes almost nothing.
- `fixedLimitRiverOneBetValueRaise` now has three ranges in aggregate: significant against the maniac (+1.40 +/- 0.19), not resolved against the value-only player (+0.07 +/- 0.04), and against the passive caller +0.07 +/- 0.03, which passes the two-standard-error rule only with the seeds together (one seed of two resolves alone). No cell is negative. The per-node table (below) puts 428 of its 458 changed pairs at the option's own node, positive in every range.
- `fixedLimitStealVsTightBlinds` wins against the extreme over-folder, as it must: that script folds to every postflop wager and 82% of its blinds. Its two harm controls: blinds that defend 80% of their hands against a raise and then fold every postflop wager still lose to the steal (+6.29 +/- 0.43), because every widened open that is called wins the pot with a postflop bet; the value-only blinds almost never let it act (2 of 20,000 pairs at each seed), because their fold read never fills (next section). No cell is negative. The option is under an owner hold that this measurement does not lift.
- `fixedLimitRiverStrongHandLeads` is not moved by a passive caller either (1 pair in 40,000 across the two seeds). The arm stays refused; the card used for the measurement is not kept, because it would read inert every night.
- These are measurements against scripted opponents. They are not a verdict on any option, and no option's authority file says "Evidence MET" on them: a fixed-limit option still has no replay on audited decisions against people, and none can be run (below, "People at fixed-limit tables").
- Each option's status, with these figures and what is still owed, is in `docs/horse-option-authority.d/<option>.md` (written 2026-11-21 for every fixed-limit option that is off in source).

### The other recorded mirror configurations, re-run after the memory fix (2026-11-21)

The league memory fix of 2026-11-20 was followed by a re-measurement of the Horse-mirror counts at seed 20261115, 300 pairs. The other mirror configurations, Hybrid cash at 2,000 pairs and production personas at 600 pairs, were re-run on 2026-11-21 at seed 20261120 for every fixed-limit hold'em option, on the working tree of that day's pull request (base 8d01508d3). Arm A the option on, bb/100 in big blinds; every run 0 illegal actions, 0 truncated streets, 0 brain exception fallbacks.

| Option                            | Seats | Hybrid cash, 2,000 pairs: diverged, bb/100 | Production personas, 600 pairs: diverged, bb/100 | Reading before the fix (same seed)                      |
| --------------------------------- | ----- | ------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------- |
| `fixedLimitPricedPreflop`         | 6     | 197, +0.26 +/- 0.54                        | 56, -1.35 +/- 1.07                               | none at these sizes                                     |
| `fixedLimitRiverFullBetRead`      | 2     | 53, +0.48 +/- 0.48                         | 9, +0.83 +/- 0.61                                | none at these sizes                                     |
| `fixedLimitCallIsNotACommitment`  | 6     | 1, +0.0375 +/- 0.0375                      | 2, +0.25 +/- 0.18                                | the same: 1, +0.0375 +/- 0.0375 and 2, +0.25 +/- 0.1777 |
| `fixedLimitReadIgnoresProbes`     | 6     | 0                                          | 0                                                | 0 of 300 (production personas)                          |
| `fixedLimitRiverStrongHandLeads`  | 6     | 7, -0.01 +/- 0.06                          | 2, -0.06 +/- 0.12                                | 1 of 300, +0.11 +/- 0.11 (production personas)          |
| `fixedLimitRiverOneBetValueRaise` | 2     | 3, +0.05 +/- 0.09                          | 0                                                | 0 of 300 (production personas)                          |
| `fixedLimitStealVsTightBlinds`    | 6     | 0                                          | 0                                                | none at these sizes                                     |

No reading that existed before the fix moved: the two configurations recorded before it at these sizes (`fixedLimitCallIsNotACommitment`) are identical, and the 300-pair production-persona readings stay inert or near it at 600. None is significant. So the default-on record of `fixedLimitBetsAreNeverProbes` (`docs/horse-default-on.d/fixedLimitBetsAreNeverProbes.md`), which rests on the lane's own harness and not on these rows, needs no update.

### The per-node table of changed decisions (built 2026-11-21)

`server/src/benchmark/LeagueChangedNodeTable.ts` is a read-only observer (`LeagueFieldPairObserver`, passed as `runMatchup`'s optional fifth argument; refused for a mirror card, absent on every card the nightly worker deals). In each pair it finds the first hero decision on which arm A and arm B disagree and books the pair's hero result (A minus B, big blinds) to that node: street, facing a wager or checked to, and the bets and raises already on the street. Everything before that decision is the same deal, field and history on both passes, so the booked difference is the value of the changed decision together with everything it caused. `npx tsx src/scripts/leagueChangedNodeTable.ts --card=<card> --seed=<seed> --pairs=<pairs>` from server/ prints the table and the card's own result, which equals what `horseLeagueCard.ts` prints for the same card, seed and size (checked on every run below). Pinned by `LeagueChangedNodeTable.test.ts`.

Tables: `fixedLimitRiverOneBetValueRaise` against its three ranges in `docs/horse-option-authority.d/fixedLimitRiverOneBetValueRaise.md`; `fixedLimitStealVsTightBlinds` against the over-folding and preflop-defending blinds in `docs/horse-option-authority.d/fixedLimitStealVsTightBlinds.md`.

### People at fixed-limit tables (counted 2026-11-21)

Counted read-only at 15:10 UTC from production `hand_history` (`has_human`: a person was dealt in; such hands are kept forever, Horse-only hands eight days): fixed-limit hold'em 0 hands with a person, ever; fixed-limit Omaha hi-lo 107 hands, all at one table between 2026-11-03 02:40 and 03:53 UTC, one person and five Horses. Horse-only hands retained at the same moment: 230,155 flh and 81,351 flo8. So an audited fixed-limit-versus-people decision set cannot be built for hold'em at all, and for hi-lo it would be 107 hands of one person. No fixed-limit option's Replay row can therefore leave NOT RUN until people play fixed limit here.

## What is still refused, and what each needs

A hold'em arm that a Horse mirror changes in none or almost none of the pairs is not put on the card: it would read inert on most nights. Each needs a field that is not built.

### 1. Scripted fixed-limit fields: BUILT 2026-11-20 for the maniac and the tight-value player (see "The scripted fixed-limit field" below)

Built 2026-11-21: the over-folding blinds script (`flh_over_folding_blinds_v1`) and the passive river caller (`flh_passive_caller_v1`, also the third opponent range for the one-bet value raise). The passive caller did not make `fixedLimitRiverStrongHandLeads` measurable (1 of 20,000 and 0 of 20,000 pairs diverged). The per-node table of changed decisions and the steal's two harm controls followed later that day (above). The design as first written is kept below for the record.

<details><summary>The design as written before it was built</summary>

Scripted fixed-limit fields (for `fixedLimitCallIsNotACommitment`, `fixedLimitRiverStrongHandLeads`, `fixedLimitRiverOneBetValueRaise`, `fixedLimitStealVsTightBlinds`)

The lane measured these against scripted opponents (a maniac, a tight-value player, over-folding blinds) in a harness that lives outside the repository. To bring that into the league:

- `HorseLeague.ts`: a population id for scripted fixed-limit seats in `LeagueOpponentPopulation`, with `leagueFieldVariants` returning `['flh']` for it, and `leagueFixedLimitRefusal` admitting that population only.
- `HorseLeague.ts`, `seatPolicyDecision`: for a fixed-limit hand the spot's `legalActions`, `minRaiseTo` and `maxRaiseTo` come from `leagueActionState` (the controller's menu), never from the no-limit menu it builds today.
- A new `FixedLimitScriptedField.ts`: the seat policies as `LeagueSeatPolicy` functions. The maniac is fully specified by the menu (bet or raise whenever one is legal, otherwise call, never fold). The tight-value and over-folder scripts must be ported from the lane's archived definitions with their thresholds, not re-invented here.
- Cards run through the existing `runHumanFieldMatchup` (one hero Horse, arm A then arm B on the same deal against the same field).

Invariants: a scripted seat reads its own cards and the public state only; its answer goes through the same validation as a Horse's; the field is the same in both passes of a pair; a harm control (the Horse field and the tight-value field) is reported next to every value cell.

Tests: extend the real-controller replay in `HorseLeagueFixedLimit.test.ts` to hands with scripted seats (the menu comparison then reads `leagueActionState` at every node, since a scripted seat makes no brain call); a law that each script takes only menu actions; a pin that each new card diverges at an affordable sample.

Evidence note: the Value row of `docs/HORSE-DECISION-CHANGE-EVIDENCE.md` asks for the value at each changed node under at least three stated opponent ranges, one of them value-only, and does not count a single favourable range or an aggregate with no per-node table. So these cards need three fields and a per-node table of the changed decisions (a `LeagueHandObserver` can record the nodes).

</details>

### 2. A no-limit probe history (for `fixedLimitReadIgnoresProbes`)

The option acts only against a player whose pooled no-limit or pot-limit probe share is non-zero. A league card deals one variant into two fresh sandboxes, so that share is always zero. Needed: a card setting that plays a fixed number of no-limit hold'em hands into both pass sandboxes before the fixed-limit pairs (same seats, same seed, learning on), and a test that the probe share is non-zero when the fixed-limit hands start. Without it the arm is inert by construction. BUILT 2026-11-20 as `LeagueMatchup.probeHistoryHands` (below); see the results there for whether the arm became measurable.

### 3. Hi-lo settlement and fixed-limit `flo8` betting: BUILT 2026-11-21

Hi-lo showdown settlement (`settleLeagueShowdown` via `determineWinners`, with merged equal-eligibility pot layers matching `calculatePots`) and `flo8` fixed-limit betting (`leagueDealsFixedLimit` admitting `flo8`) are both built and proven node by node against a real `HandController` in `HorseLeagueFixedLimit.test.ts`. Three `flo8` arms moved onto the card (`FIXED_LIMIT_OMAHA_HILO_CARDS`: `flo8_no_omaha_presumption`, `flo8_priced_preflop`, `flo8_river_full_bet_read`). The remaining `flo8` arms (`flo8_nut_low_river_bet`, `flo8_hilo_low_half_floor`, `flo8_river_strong_hand_leads`, `flo8_steal_vs_tight_blinds`, `flo8_read_ignores_probes`, plus `flo8_call_is_not_a_commitment` which is inert by scope) diverged in 0 of 300 pairs in a Horse mirror and stay refused until a scripted `flo8` field exists (the existing `flh_scripted_field_v1` scores Hold'em hands and stays scoped to `flh`).

### 4. Short stacks

Only if a fixed-limit card ever needs stacks of 24 big blinds or less: carry `fixedLimitStreetBounds.raiseSize` (completion), the half-bet reopening rule of `canReopenBetting`, side pots and the uncalled excess into `runStreet`, and extend the replay test to short stacks. Until then the refusal stands.
