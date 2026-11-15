# A fixed-limit bet is never a probe (process switch, source default off)

Fixed-Limit lane, 2026-11-14. Diagnosis: agent evidence `fixed-limit-01Gw7aDr/L-ADAPTATION-DIAGNOSIS.md` section 0A; implementation record: `N-ADAPTATION-FIX.md` section F1.

## The defect

PROBE BETS ARE NOT AGGRESSION (2026-11-08) reads a first postflop bet of at most one big blind or a fifth of the pot as a probe (`HorseOpponentExploit.probeBetIndexes`), counts it in `OpponentStats.ctProbes`, and takes the probe share back out of the aggressor read (`betCheckedTo`) at read time. In fixed limit every flop bet is one big blind and a turn or river bet is under a fifth of the pot once the pot passes ten big blinds, so 75 to 100 percent of a fixed-limit maniac's checked-to bets were counted as probes. His read fell from about 0.8 to 0.2 (heads-up) or 0.03 (six seats), under every maniac and aggressor threshold, so `isPostflopManiac`, `isAggressor`, the call-down respect shift, barrel narrowing and the V86 strip never engaged in flh or flo8.

## The change

`HorseMind.observe` takes the hand's betting structure (new last argument). With the process switch `HorseMind.setFixedLimitBetsAreNeverProbes(true)`, a fixed-limit hand adds no probe tally at all: neither `ctBets` nor `ctProbes`. Its bets therefore stay whole in `betCheckedTo`, and because the tallies are pooled per player across games, fixed-limit bets also stop diluting or inflating the same player's no-limit probe share. No-limit and pot-limit counting is unchanged (law test), and a no-limit one-big-blind bet is still a probe.

The structure reaches the counter on both production paths: the completed-hand learner (`workerRuntime.observeCompletedHandInMind`, from `riverCallContext.variant`, which every accepted-hand sender sets) and the in-decision observation (`HorseLogic.prepareOriginalReads`, from `gameState.bettingStructure` or the variant). The observer sandbox learner (`observerReads.learnPublic`) passes it from its context variant.

Future counting only: nothing already counted is reset, rewritten or replayed. Tallies counted before the switch is turned on stay as they are.

## Why a process switch and not a decide option

Counting happens outside a decision (the completed-hand learner) as well as at the top of one, and both paths share one per-action dedupe, so a per-decision option would count one hand two ways. The switch is one value for the process, `FIXED_LIMIT_BETS_ARE_NEVER_PROBES_DEFAULT = false`. Live requests carry no decide options, so turning it on in production is a source-default change under `docs/HORSE-DECISION-CHANGE-EVIDENCE.md` with its eight evidence rows. Nothing in this change turns it on, and the style live switch (`HorseStyleSwitch`) is not used.

## Stores

Reads and writes only the in-process `OpponentStats.ctBets` / `ctProbes` (HorseMind pooled stats, sandboxes included). Those tallies are memory only: `horse_mind_stats` rows (`upsert_horse_mind_stats`) do not carry them, the boot hydrate never sets them, and they travel to the worker's second look in the decision read frame (`probeTallies`, v11+) and to the style read's probe share (`HorseOpponentStyle`) at read time. Exploit counters, durable opponent profiles and hand history are not touched.

## Receipt

`fixed_limit_bet_not_a_probe_seen` (HorseDataLedger): a checked-to postflop bet in a fixed-limit hand counted without a probe tally.

## Tests

`server/src/engine/AFixedLimitBetIsNeverAProbe.law.test.ts` (docs/laws.d entry): the source default is off; a heads-up flh and flo8 maniac script reads as a postflop maniac within 100 hands with the switch on, and does not with it off; a no-limit probe is still a probe; no-limit counting is identical with the switch on, off or no structure given; both production paths hand the variant to the counter.
