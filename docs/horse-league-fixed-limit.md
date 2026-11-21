# The league and fixed limit

Written 2026-11-20. This file says what the nightly duplicate league (`server/src/benchmark/HorseLeague.ts`) deals for fixed-limit games, how that is proven, what it still refuses and exactly what has to be built before each refused arm can become a card. `UNMEASURABLE_MATCHUPS` cites it.

## What is dealt

Fixed-limit hold'em (`flh`), cash, no ante, Horse seats only, stacks above 24 big blinds.

| Rule | Where the league gets it | The live table's own code |
| --- | --- | --- |
| Wager size: one big blind preflop and on the flop, two on the turn and river | `fixedLimitBetSize` through `leagueFixedLimitBounds` (`LeagueDecisionState.ts`) | `HandController.streetBetSize` |
| Four wagers a street (the big blind is the first preflop), then fold or call only | `isFixedLimitCapped` | `HandController.getAvailableActions`, `buildBettingState` |
| One legal amount for a bet or raise | `calculateBettingState(..., fixedLimit)` and `validateAction` | the same two functions |
| A wager on a capped street becomes a call or check | `substituteOnCappedStreet` | `ServerTableEngineTurns.scheduleHorseAction` |
| A deep stack's all in executes as the street's one bet or raise | `playHand`, fixed-limit branch | `HandController.clampToStructure` |
| `lastRaise` and `minRaise` sit at the street's wager and a raise never moves them | `runStreet` | `HandController.advanceStage`, `performAction` |
| The menu handed to the brain | `leagueFixedLimitActionState` | `HandController.getAuthoritativeActionState` |

Nothing is re-implemented: the league calls the functions the controller calls.

## Why the domain is this narrow

`leagueFixedLimitRefusal` refuses, and `playHand` throws, for anything outside it:

- **Stacks of 24 big blinds or less.** A fixed-limit hand costs one seat at most 4 + 4 + 8 + 8 = 24 big blinds. Above that no seat can be all in. At or below it a seat can go all in for less than a wager, and the rules for that short wager (completion below half a bet, reopening at half a bet or more: `fixedLimitStreetBounds.raiseSize`, `HandController.canReopenBetting`, uncalled excess when every opponent is all in) are not in the league's street loop.
- **Tournament context or an ante.** Neither is modelled for this structure in the league.
- **A field population, except the scripted fixed-limit field.** No population is calibrated for fixed limit, and the calibrated and pressure seats build a no-limit menu (`humanFieldDecision`, `pressureFieldDecision`). Since 2026-11-20 the one field a fixed-limit hand seats is `flh_scripted_field_v1`, whose seats are offered the controller's fixed-limit menu (below, "The scripted fixed-limit field").
- **`flo8`.** The league's settlement awards one high hand. Fixed-limit Omaha hi-lo splits the pot with a low half. A `flo8` hand still takes the league's old path (no-limit betting, high-only showdown), which is why every `flo8` arm stays refused.

## The proof

`server/src/benchmark/HorseLeagueFixedLimit.test.ts`:

1. Every league hand in the sample (120 heads-up, 120 six-max) is replayed action by action through a real `HandController` dealt the same cards. At every node: the same seat on the clock, the same street, pot, bet level, `minRaise`, `lastRaise`, board, per-seat stack, bet and investment, and the same recorded action history; the menu the brain received (legal actions, price to call, the one legal wager, the street unit, the cap flag, the small bet) equals the controller's authoritative menu; the controller accepts the league's action; the controller's final stacks equal the league's settlement seat by seat.
2. The structure read off the league's own actions (150 hands each, heads-up and six-max): unit by street, at most four wagers, fold and call only on a capped street, the pot equal to the chips put in, chips conserved, no seat losing more than 24 big blinds, no all in, zero illegal actions, zero truncated streets.
3. The refusals above.
4. The cards: on the card, inside the domain, arms that diverge, results the compute worker boundary accepts.

`ALeagueDecisionStateIsProductions.law.test.ts` now carries three fixed-limit nodes (six-max first in, heads-up facing the cap, six-max turn facing a bet and a raise): the league state equals, key by key, the request the real `ServerTableEngine.scheduleHorseAction` sends.

Mutation checks run on 2026-11-20 (file restored after each): pricing a turn wager at the small bet fails the replay and the structure tests; never reporting a street as capped fails both.

## What was measured on the legal game

`runMatchup`, Horse mirror, 100 big blinds, arm A the option on and arm B off. bb/100 is in big blinds, and a fixed-limit big blind is the small bet.

| Arm | Seats | Setting | Seed | Pairs | Diverged | bb/100 | Std. error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `fixedLimitPricedPreflop` | 6 | Hybrid cash, deal-seeded mood | 20261115 | 300 | 30 | 1.1111 | 1.2389 |
| `fixedLimitPricedPreflop` | 6 | plain | 20261115 | 300 | 30 | -2.5278 | 1.6539 |
| `fixedLimitPricedPreflop` | 2 | plain | 20261115 | 300 | 109 | -1.5 | 6.3543 |
| `fixedLimitRiverFullBetRead` | 2 | Hybrid cash, deal-seeded mood | 20261115 | 300 | 9 | 1.3333 | 1.1541 |
| `fixedLimitRiverFullBetRead` | 2 | plain | 20261115 | 300 | 7 | 1.3333 | 1.0530 |
| `fixedLimitCallIsNotACommitment` | 6 | plain | 20261115 | 300 | 1 | 0.1111 | 0.1111 |
| `fixedLimitCallIsNotACommitment` | 6 | Hybrid cash, deal-seeded mood | 20261115 | 300 | 1 | 0.2778 | 0.2778 |
| `fixedLimitCallIsNotACommitment` | 6 | Hybrid cash, deal-seeded mood | 20261120 | 2,000 | 1 | 0.0375 | 0.0375 |
| `fixedLimitCallIsNotACommitment` | 6 | production personas, deal-seeded mood | 20261120 | 600 | 2 | 0.25 | 0.1777 |
| `fixedLimitCallIsNotACommitment` | 2 | plain | 20261115 | 300 | 0 | 0 | 0 |
| `fixedLimitReadIgnoresProbes` | 6 | plain | 20261115 | 300 | 0 | 0 | 0 |
| `fixedLimitReadIgnoresProbes` | 2 | plain | 20261115 | 300 | 0 | 0 | 0 |
| `fixedLimitReadIgnoresProbes` | 6 | production personas, deal-seeded mood | 20261120 | 300 | 0 | 0 | 0 |
| `fixedLimitRiverStrongHandLeads` | 6 | plain | 20261115 | 300 | 0 | 0 | 0 |
| `fixedLimitRiverStrongHandLeads` | 2 | plain | 20261115 | 300 | 0 | 0 | 0 |
| `fixedLimitRiverStrongHandLeads` | 6 | production personas, deal-seeded mood | 20261120 | 300 | 1 | 0.1111 | 0.1111 |
| `fixedLimitRiverOneBetValueRaise` | 2 | plain | 20261115 | 300 | 0 | 0 | 0 |
| `fixedLimitRiverOneBetValueRaise` | 2 | production personas, deal-seeded mood | 20261120 | 300 | 0 | 0 | 0 |
| `fixedLimitStealVsTightBlinds` | 6 | plain | 20261115 | 300 | 0 | 0 | 0 |

Every run: 0 illegal actions, 0 truncated streets, 0 brain exception fallbacks. None of these is a verdict on an option. They show which arms a Horse mirror can and cannot move.

## The cards

`FIXED_LIMIT_HOLDEM_CARDS`: `flh_priced_preflop` (six seats, 2,000 pairs) and `flh_river_full_bet_read` (heads-up), both on the live cash Hybrid persona with the deal-seeded mood clock. They only measure. Both options stay default off: `fixedLimitPricedPreflop` is under the owner's preflop range hold and `fixedLimitRiverFullBetRead` is an opt-in arm production never sets. Since 2026-11-20 `FIXED_LIMIT_SCRIPTED_FIELD_CARDS` (six cards against the scripted field) are on the card too; see "The scripted fixed-limit field" below.

## The scripted fixed-limit field (built 2026-11-20)

`FixedLimitScriptedField.ts`, seated through the league's existing human-field mechanism: `LeagueMatchup.opponentPopulation = 'flh_scripted_field_v1'` and `LeagueMatchup.humanPersona` naming the script. `runHumanFieldMatchup` seats the hero Horse at seat 1 and the script in every other seat through `LeagueHumanField.seatPolicyOf`; `leagueFixedLimitRefusal` admits this field and no other in a fixed-limit hand, and `playHand` throws if a fixed-limit field seat has no script.

Invariants, each pinned in `server/src/benchmark/HorseLeagueFixedLimitField.test.ts`:

- A script reads its own cards and the public state only (`LeagueSeatSpot`), never calls the Horse brain and consumes no randomness, so the field is a pure function of the deal seed and the actions before it.
- It is offered the controller's own fixed-limit menu (`seatPolicyDecision` now takes `leagueActionState` for a fixed-limit hand) and answers only with an action on that menu, at the one legal wager. The league applies the answer unchanged.
- Hands with scripted seats replay through a real `HandController` (heads-up and six seats, 60 hands for each persona): at every node the menu the Horse or the script was offered equals `getAuthoritativeActionState`, the controller accepts every action, and its final stacks equal the league's settlement. Chips are conserved and no seat loses more than 24 big blinds.
- A card run twice on one seed returns the same result.

### The personas

| Persona | Rule | Source |
| --- | --- | --- |
| `flh_maniac_v1` | Bets or raises whenever a wager is on the menu, otherwise calls; never folds. Wager rate 1.0, fold rate 0.0. | This file, section 1 as first written ("bet or raise whenever one is legal, otherwise call, never fold"); the lane's "Sustained maniac (every hand, every bet)" and "scripted maniac who bets every checked street" (`docs/horse-default-on.d/fixedLimitBetsAreNeverProbes.md`). |
| `flh_tight_value_v1`, preflop | Raise or fold. First in raises the top 80% heads-up, 26% at up to six seats, 18% above; big blind unraised raises at percentile 0.85 or better, else checks; facing one raise re-raises at 0.94 (heads-up 0.85), calls at 0.82 (heads-up 0.50); facing two or more caps at 0.975, calls at 0.95. | `ExploiterLeague.ts` `regPreflop` / `openTop`, the repository's recorded tight-aggressive reference, with each no-limit size replaced by the one fixed-limit wager. Its 26% six-max first-in share is inside the "21-27 percent raiser" the lane recorded for its tight-value player (`docs/changelog/2026-11-14-fixed-limit-tight-reads.md`, T1). |
| `flh_tight_value_v1`, postflop | Value only, by made class (only a class the player's own cards improve on the board counts): bets or raises with two pair or better; puts in a third wager or more only with trips or better; calls one wager with a pair or better, two or more with two pair or better; otherwise checks or folds. No bluff, no draw. | **Design value.** No record in this repository states the lane's tight-value postflop thresholds (its scripts live in its evidence archive). |
| No-limit probe history script (warm-up only) | Preflop checks or calls, never raises; after the flop makes the minimum bet whenever checked to and calls any bet. Every such bet is a probe by the rule in `HorseOpponentExploit` (one big blind). | **Design value.** The lane's seeding (`AB-EVALUATION-2.md` 3.1 (b)) is not recorded here. |

Not built: the over-folding blinds script (`fixedLimitStealVsTightBlinds`), a passive river caller (`fixedLimitRiverStrongHandLeads`), a third opponent range, and the per-node table of changed decisions the Value row of `docs/HORSE-DECISION-CHANGE-EVIDENCE.md` requires. Until those exist, no card here meets that row.

### The no-limit probe history (`LeagueMatchup.probeHistoryHands`)

Before the first pair, each pass sandbox plays N no-limit hold'em hands at the same seats (hero on its own arm, the field on the probe script, learning on; `leagueProbeHistoryWarmup`). The test shows every field seat holds a non-zero pooled probe tally (`ctBets`, `ctProbes`) afterwards and a fresh sandbox holds none. Refused for any other field, with learning off, or with a spot selection.

### A league memory defect found and fixed

`playHand`'s settlement called `HorseMind.observe` without the hand's betting structure, so every fixed-limit bet a league hand completed was tallied as a probe, while production's accepted-hand learner passes `bettingStructureFor(variant)` (`workerRuntime.observeCompletedHandInMind`) and, with FIXED-LIMIT BETS ARE NEVER PROBES on, tallies none. The league now passes it. Measured on `flh_read_ignores_probes_vs_maniac` without a probe history (seed 20261115, 1,000 pairs): 320 pairs diverged before the fix, 0 after; 333 with the 300-hand history. The Horse-mirror fixed-limit counts recorded above were re-measured after the fix at seed 20261115, 300 pairs, and are unchanged (priced preflop 30, river full-bet read 9, call-is-not-a-commitment 1, strong hand leads 0, one-bet value raise 0, steal 0, read ignores probes 0). The fix did change the call-is-not-a-commitment card against the maniac (seed 20261115, 200 pairs: 13 diverged, +140.00 +/- 99.60 bb/100 before; 16 diverged, -86.00 +/- 21.43 after), so only results taken after the fix are reported below.

### The cards and what they measured

`FIXED_LIMIT_SCRIPTED_FIELD_CARDS`, on the live cash Hybrid persona with the deal-seeded mood clock:

Seeds 20261120 and 20261121, run with `npx tsx src/scripts/horseLeagueCard.ts`. bb/100 is arm A (option on) minus arm B (off), in big blinds; a fixed-limit big blind is the small bet. The first two cards ran on the working tree that became commit 95a9430a0, with the memory fix already applied; the other four ran at 95a9430a0.

| Card | Pairs per seed | Seed 20261120 | Seed 20261121 | Seeds together |
| --- | --- | --- | --- | --- |
| `flh_call_is_not_a_commitment_vs_maniac` (6 seats) | 12,000 | -28.02 +/- 7.30, 928 diverged | -21.35 +/- 8.10, 952 diverged | -24.68 +/- 5.45, z -4.53, SIGNIFICANT |
| `flh_call_is_not_a_commitment_vs_tight_value` (6 seats, harm control) | 50,000 | +0.02 +/- 0.01, 4 diverged | -0.02 +/- 0.03, 2 diverged | +0.00 +/- 0.02, not resolved |
| `flh_river_one_bet_value_raise_vs_maniac` (heads-up) | 15,000 | +1.13 +/- 0.25, 91 diverged | +1.67 +/- 0.28, 109 diverged | +1.40 +/- 0.19, z 7.38, SIGNIFICANT |
| `flh_river_one_bet_value_raise_vs_tight_value` (heads-up, harm control) | 45,000 | +0.04 +/- 0.05, 61 diverged | +0.10 +/- 0.05, 57 diverged | +0.07 +/- 0.04, not resolved |
| `flh_read_ignores_probes_vs_maniac` (6 seats, 300 no-limit hands first) | 10,000 | +226.30 +/- 24.58, 3,283 diverged | +231.46 +/- 24.76, 3,305 diverged | +228.88 +/- 17.44, z 13.12, SIGNIFICANT |
| `flh_read_ignores_probes_vs_tight_value` (6 seats, harm control) | 45,000 | -0.00 +/- 0.00, 1 diverged | 0.00 +/- 0.00, 0 diverged (INERT) | not resolved |

Every run had 0 illegal actions, 0 truncated streets and 0 brain exception fallbacks. Corrected actions came only from the hero Horse (2,091 to 2,503 per maniac run, 0 in every tight-value run); a script's answer is never corrected (pinned in the test). The solver stores were empty: the nightly worker hydrates them and these runs did not.

How to read these figures:

- `fixedLimitCallIsNotACommitment` LOSES against this field: -24.68 +/- 5.45 bb/100 across the two seeds, against the lane's +9.34 +/- 4.10 big bets per 100 hands for flh six seats against its maniac (`docs/horse-default-on.d/fixedLimitCallIsNotACommitment.md`). The fields are not the same. Here five maniacs cap almost every street, and the Horse's memory now reads them whole (the memory fix above). Before that fix the same card read +124.10 +/- 9.45 at the same seeds and sizes (+131.90 +/- 13.67 and +116.31 +/- 13.05). That number came from the defect and is withdrawn.
- `fixedLimitReadIgnoresProbes` changes about a third of the pairs against a maniac carrying a no-limit probe history. That is the case it was built for, and the lane measured it at 23.5 to 23.8 % of deals. Against the value-only player it changes almost nothing.
- These are measurements against scripted opponents with one favourable range and one value-only range. They are not a verdict on any option. None of them meets the Value row of `docs/HORSE-DECISION-CHANGE-EVIDENCE.md`, which needs at least three ranges and a per-node table.


## What is still refused, and what each needs

A hold'em arm that a Horse mirror changes in none or almost none of the pairs is not put on the card: it would read inert on most nights. Each needs a field that is not built.

### 1. Scripted fixed-limit fields: BUILT 2026-11-20 for the maniac and the tight-value player (see "The scripted fixed-limit field" below)

Still not built here: the over-folding blinds script for `fixedLimitStealVsTightBlinds` (no record in this repository gives its thresholds), a passive river caller that would make `fixedLimitRiverStrongHandLeads` measurable (0 of 3,000 pairs diverged against both built scripts), the per-node table of changed decisions the Value row of `docs/HORSE-DECISION-CHANGE-EVIDENCE.md` asks for (a `LeagueHandObserver` can record it), and a third opponent range. The design as first written is kept below for the record.

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

### 3. Hi-lo settlement (every `flo8` arm: `fixedLimitHiLoNutLowRiverBet`, `fixedLimitHiLoLowHalfFloor`, `fixedLimitOmahaNoPresumption`, and the `flo8` halves of the others)

Needed in `playHand` settlement: the qualifying low (eight or better, two hole cards and three board cards), the high and low halves per side pot, quartering, and the odd chip, exactly as `HandController` pays them. The proof is the same replay against a real `HandController` on `flo8`, plus `leagueDealsFixedLimit` admitting it. An alternative that needs no new settlement code exists in the repository: `Plo4PolicyLeague.playPlo4PolicyHand` drives a real `HandController` and already deals `flh` and `flo8` (`RemainingVariantPolicyLeague.ts`), but it is a hero-against-field league with a fresh memory sandbox per hand and its own contract, not the nightly card.

### 4. Short stacks

Only if a fixed-limit card ever needs stacks of 24 big blinds or less: carry `fixedLimitStreetBounds.raiseSize` (completion), the half-bet reopening rule of `canReopenBetting`, side pots and the uncalled excess into `runStreet`, and extend the replay test to short stacks. Until then the refusal stands.
