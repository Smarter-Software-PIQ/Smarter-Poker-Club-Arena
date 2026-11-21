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
- **A field population.** No field is calibrated for fixed limit, and the field seats are offered a no-limit menu (`humanFieldDecision`, `seatPolicyDecision`).
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

`FIXED_LIMIT_HOLDEM_CARDS`: `flh_priced_preflop` (six seats, 2,000 pairs) and `flh_river_full_bet_read` (heads-up), both on the live cash Hybrid persona with the deal-seeded mood clock. They only measure. Both options stay default off: `fixedLimitPricedPreflop` is under the owner's preflop range hold and `fixedLimitRiverFullBetRead` is an opt-in arm production never sets.

## What is still refused, and what each needs

A hold'em arm that a Horse mirror changes in none or almost none of the pairs is not put on the card: it would read inert on most nights. Each needs a field that is not built.

### 1. Scripted fixed-limit fields (for `fixedLimitCallIsNotACommitment`, `fixedLimitRiverStrongHandLeads`, `fixedLimitRiverOneBetValueRaise`, `fixedLimitStealVsTightBlinds`)

The lane measured these against scripted opponents (a maniac, a tight-value player, over-folding blinds) in a harness that lives outside the repository. To bring that into the league:

- `HorseLeague.ts`: a population id for scripted fixed-limit seats in `LeagueOpponentPopulation`, with `leagueFieldVariants` returning `['flh']` for it, and `leagueFixedLimitRefusal` admitting that population only.
- `HorseLeague.ts`, `seatPolicyDecision`: for a fixed-limit hand the spot's `legalActions`, `minRaiseTo` and `maxRaiseTo` come from `leagueActionState` (the controller's menu), never from the no-limit menu it builds today.
- A new `FixedLimitScriptedField.ts`: the seat policies as `LeagueSeatPolicy` functions. The maniac is fully specified by the menu (bet or raise whenever one is legal, otherwise call, never fold). The tight-value and over-folder scripts must be ported from the lane's archived definitions with their thresholds, not re-invented here.
- Cards run through the existing `runHumanFieldMatchup` (one hero Horse, arm A then arm B on the same deal against the same field).

Invariants: a scripted seat reads its own cards and the public state only; its answer goes through the same validation as a Horse's; the field is the same in both passes of a pair; a harm control (the Horse field and the tight-value field) is reported next to every value cell.

Tests: extend the real-controller replay in `HorseLeagueFixedLimit.test.ts` to hands with scripted seats (the menu comparison then reads `leagueActionState` at every node, since a scripted seat makes no brain call); a law that each script takes only menu actions; a pin that each new card diverges at an affordable sample.

Evidence note: the Value row of `docs/HORSE-DECISION-CHANGE-EVIDENCE.md` asks for the value at each changed node under at least three stated opponent ranges, one of them value-only, and does not count a single favourable range or an aggregate with no per-node table. So these cards need three fields and a per-node table of the changed decisions (a `LeagueHandObserver` can record the nodes).

### 2. A no-limit probe history (for `fixedLimitReadIgnoresProbes`)

The option acts only against a player whose pooled no-limit or pot-limit probe share is non-zero. A league card deals one variant into two fresh sandboxes, so that share is always zero. Needed: a card setting that plays a fixed number of no-limit hold'em hands into both pass sandboxes before the fixed-limit pairs (same seats, same seed, learning on), and a test that the probe share is non-zero when the fixed-limit hands start. Without it the arm is inert by construction.

### 3. Hi-lo settlement (every `flo8` arm: `fixedLimitHiLoNutLowRiverBet`, `fixedLimitHiLoLowHalfFloor`, `fixedLimitOmahaNoPresumption`, and the `flo8` halves of the others)

Needed in `playHand` settlement: the qualifying low (eight or better, two hole cards and three board cards), the high and low halves per side pot, quartering, and the odd chip, exactly as `HandController` pays them. The proof is the same replay against a real `HandController` on `flo8`, plus `leagueDealsFixedLimit` admitting it. An alternative that needs no new settlement code exists in the repository: `Plo4PolicyLeague.playPlo4PolicyHand` drives a real `HandController` and already deals `flh` and `flo8` (`RemainingVariantPolicyLeague.ts`), but it is a hero-against-field league with a fresh memory sandbox per hand and its own contract, not the nightly card.

### 4. Short stacks

Only if a fixed-limit card ever needs stacks of 24 big blinds or less: carry `fixedLimitStreetBounds.raiseSize` (completion), the half-bet reopening rule of `canReopenBetting`, side pots and the uncalled excess into `runStreet`, and extend the replay test to short stacks. Until then the refusal stands.
