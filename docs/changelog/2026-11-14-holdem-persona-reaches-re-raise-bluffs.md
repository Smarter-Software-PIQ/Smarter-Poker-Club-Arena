# The Hold'em Persona Reaches Re-Raise Bluffs (Default Off)

Owner ruling 2026-11-13 (D3, option C): persona-specific 3-bets, squeezes and shallow four-bet reshoves, designed and tested, rollout gated. This is the build. Nothing changes in play: the option is off, and turning it on is a separate owner decision.

## What Was Missing

Every Horse has a Hold'em persona worked out from its id: one of four archetypes (LAG, TAG, Tricky, Nit) and a figure, `nlh3BetMix`, described as how often it 3-bets, squeezes and reshoves. Nothing read that figure. Before the flop every Horse re-raised as a bluff at the same rate, decided by a shared random draw that knows nothing about which Horse is acting.

## What Changed

A new option, `holdemPersonaReRaiseMix`, OFF by default. With it on, in two-card no-limit hold'em only (cash and tournament):

1. **3-bet bluff** (facing one open). The bluff still has the same probability rule as before, multiplied by the Horse's scale: its `nlh3BetMix` divided by 0.42143, the average under the id model. The scale runs from 0.52 (the tightest Nit) to 1.52 (the loosest LAG). The result is capped at certain.
2. **Squeeze bluff** (a raise and one or more callers). The same rule, at both places a squeeze bluff is decided: the older squeeze site, and in hold'em cash the chart block that also answers a called open.
3. **Four-bet all-in reshove at 26 to 35 big blinds** (facing a 3-bet). The value hands (77+, ATs+, KQs, AKo) shove as before. The bluff hands (A5s to A2s) shove with probability equal to the Horse's scale, capped at always. A bluff hand that does not shove does what it would do if it were not a bluff hand at all.

Value 3-bets and value squeezes are not scaled. They are decided by a strength bar, not a mix, so the persona difference is carried by the bluffs.

## One Answer Per Hand

The decision uses the Horse's own number rather than the shared draw. The number is a hash of four things and nothing else: the Horse's id, the hand (table id and hand number), its exact hole cards, and a different salt for each of the three behaviours. Seat, stack and pot are not in it. So a Horse gets one number per behaviour for the whole hand, whatever the pot grows to, and a new number the next hand.

Where the hand comes from: the live decision worker works out the table id and hand number from the decision's own snapshot and hands them to the brain as `opts.mindPlanContext.hand`. It does this the same way for the fast decision and for the deeper second look. A retry of the turn carries the same table and hand. An exact replay feeds the recorded snapshot through the same worker code, so it works out the same value. A second field that holds the same pair, `opts.mindObservationHand`, is not used, because the second look is not given it. Request ids, decision keys and decision times are per turn, not per hand, and are not used.

The league card and the measuring tool supply a hand the same way. A caller that supplies none (an old direct or offline caller, or a live snapshot that names no allocated hand) gets a **fallback** that hashes seat, dealer seat, stack and pot instead. The fallback is not one answer per hand: it moves when the stack or pot moves, and a Horse whose seat, stack and pot repeat gets the same answer for the same cards. It is named a fallback in the code and counted (`holdem_persona_hand_identity_fallback_seen`), and that count is expected to be zero in live play.

Not run: an end-to-end exact replay of a recorded live decision with the option on. The claim that replay reproduces the hand rests on reading the worker and replay code, and on a test of the function that derives it.

## The Random Stream

- Option off (absent or false): no draw is added, removed or moved, and the comparison at each bluff site is the expression it was. The persona field is not built.
- Option on: the 3-bet bluff and the squeeze bluff still consume the shared draw at the same point and throw it away, so a decision the persona does not change leaves the stream exactly where it was. A decision the persona changes then draws its sizing differently, as any changed decision does. The reshove never drew and still does not.
- Omaha, short deck, pot limit, fixed limit, hi-lo and pineapple never receive the field. An All-In-Or-Fold hold'em table does receive it, because it is no-limit hold'em, but its code returns before any of the three places that read it, so nothing there changes.

## The Persona Never Bluffs A Tight Player More

Without a guard, a loose Horse would bluff an opener the Horses have read as tight up to 1.52 times as often, the opposite of the owner's direction on tight players. So with the persona option on, the brain asks the opponent-style read about the opener (or the re-raiser, at the reshove) itself. If the read classifies him as tight, the Horse's scale is held at 1 or below at all three places: the persona may lower a bluff there and never raise it.

This does not depend on the style option. It uses the same read and the same two classifiers the option `styleTightReRaiserRespect` uses (`tightOpenerRespect`, `tightReRaiserRespect`), and it holds with that option off, in shadow (its planned state) or on, and at every stack depth. It applies nothing of the style option: no bar moves, none of the style read's counters fire, no shadow record is written and no style-read time is booked. Its only effect is the cap. Counter: `holdem_persona_scale_held_by_style_seen`.

**The cap depends on the read being available.** With opponent memory off, no profile for the player, a presumed read or too little data for the read to be actionable, the opener is unknown, not tight, and the scale is not held.

## What Is Declared, Not Hidden

- **The reshove bluff is reduced.** A Horse below the average shoves A5s to A2s less often and nobody shoves more, so with the option on the fleet shoves these hands less than today. The first design record said fleet frequencies were preserved; for the reshove that is not true of this build. The model's expected figure is 90.5 percent of today's bluff reshoves (LAG 100, TAG 95.1, Tricky 87.5, Nit 66.4): an expected loss of 9.5 percent. That is a model figure, not a measurement.
- **No hands are added to make the total match** (owner instruction 2026-11-14). The A9s to A6s set is not built in any form.
- **The 3-bet and squeeze bluffs also lose frequency at high probabilities.** The average is preserved only while the probability times the largest scale stays at or below 1, that is, while the probability is below about 0.66. Above that, a Horse above the average cannot pass certain while a Horse below it still goes down. Where the probability is already 1, every Horse bluffs today and every below-average Horse bluffs less with the option on. The cap counters (`holdem_persona_3bet_bluff_capped_seen`, `holdem_persona_squeeze_bluff_capped_seen`) count only the capped Horse, not that loss. The measuring tool reports how many eligible spots are in that region and the expected and measured loss there. In the smoke run below it was 65 of 389 3-bet spots in cash at 100 big blinds and 35 of 599 in tournaments, 7 of them at a probability of 1.
- **"The average is preserved" is a model figure.** The scale averages 1 across ids only if ids fall evenly across the persona buckets and every Horse meets these spots equally often. On the 900 synthetic ids used for measuring, the average scale is 1.00346. The real fleet's ids have not been read.
- **A changed counter counts comparisons, not actions.** The 3-bet and squeeze `_changed_seen` counters fire when the scaled comparison disagrees with the draw it replaced. The fold-equity test still runs after it and can refuse the bluff either way.
- **The reshove site is named 26 to 35 big blinds, but its existing condition is "more than 25, up to 35".** That condition was not changed; the measuring tool has a 25 to 26 row for the part the name leaves out.

## Counters

Ten, all occurrence counters: `holdem_persona_3bet_bluff_eligible_seen`, `_changed_seen` and `_capped_seen`; the same three for `holdem_persona_squeeze_bluff`; `holdem_persona_fourbet_reshove_eligible_seen` and `_changed_seen`; `holdem_persona_scale_held_by_style_seen`; `holdem_persona_hand_identity_fallback_seen`.

## Proof

- `server/src/engine/HorseHoldemPersonaReRaiseMix.test.ts`:
  - **Off against main, by execution.** 5,864 preflop decisions in ten seeded runs (hold'em cash at 100 and at 26 to 35 big blinds, hold'em tournament, pot-limit hold'em, All-In-Or-Fold hold'em, PLO4, PLO5, PLO6, short deck, fixed limit) were recorded from the parent commit 8a8656b17b5, before the option existed: action, amount and random-stream state after each. With the option absent and with it false this branch reproduces every line. The recorded hold'em runs pass through the reshove site.
  - A second control (the persona injected at scale 1 with the consumed draw as its number) equals off on every one of those decisions, which shows the on path draws where the off path draws.
  - On, other variants and structures: identical to off; no persona site is reached; the All-In-Or-Fold run shows the field being built and never read.
  - On, hold'em: every decision the persona did not change equals off, draw for draw. Over the same 150 spots for 40 Horses of each archetype the 3-bet bluff rate orders LAG, TAG, Tricky, Nit.
  - One answer per hand: the same number at any stack depth and any draw within a hand; 40 different numbers for 40 consecutive hands; the same number for the fast look, the second look and a retry; the fallback used and counted when no hand is supplied.
  - Reshove: Horses at scale 1 or more shove A5s to A2s 960 of 960 times; 20 Nits shove about two thirds and call the rest; value hands always shove.
  - Tight players, through the real read (a tight opener held in the Horse's memory), with the style option off, in shadow and on: a loose Horse's scale is held at 1 on every comparison, so it fires a bluff only where the unscaled probability would allow it, and the held counter fires each time; a tight Horse is still scaled down; against openers not read as tight the scaled behaviour is unchanged; the style option's own counters and shadow records are identical with the persona option on and off; with opponent memory off nothing is held.
- `server/src/benchmark/HoldemPersonaReRaiseProbe.test.ts` validates the measuring tool: with every Horse at scale 1 and the draw as its number the paired difference is exactly zero for all three behaviours in three cells; with every Horse at 0.5 the reshove is taken half as often within its interval and the bluff comparisons fire at half the probability; "taken" is one definition for both arms; paired counts add up.
- A refused reshove bluff was compared (at the first head of this branch, before the per-hand number) against an engine with the bluff hands removed from the set: 306 of 306 the same action, amount and stream state (a call in the tested spot: button opens 2.2, big blind 3-bets to 7.5, 27 to 33 big blinds). In the smoke run, in play, one refused hand called and one folded.
- Deliberate breaks, each caught: dropping the discarded draw fails the draw-for-draw test; multiplying the option-off probability fails the off test against the recording from main.
- `server/src/engine/HorsePersona.holdemReRaiseScale.test.ts` recomputes 0.42143 from the archetype shares and ranges.
- Standing tests passing with the option off: the opponent-exploit neutrality corpus (its default run replays 5,023 decisions; the full corpus is 74,717, not the 74,915 the design record states), the style-read off digests, the data ledger and the league-card law.

## Measuring It

`server/src/benchmark/HoldemPersonaReRaiseProbe.ts` (command line `server/scripts/holdem-persona-reraise-probe.ts`): 900 synthetic ids in exactly 225 LAG, 180 Tricky, 360 TAG and 135 Nit, 100 nine-handed tables, every seat rotation, preflop only, every hand given a table id and hand number as in live play.

The main table is **paired**. The option-off run decides every spot a second time with the option on, from the same position in the random stream, and throws that second decision away. Each spot where the second look reaches a persona comparison is a pair: the same Horse, cards, state and draws, decided off and on. For each behaviour it reports taken off, taken on, changed up, changed down and the difference with 95% intervals: pooled, by archetype, by tenth of the fleet ordered by scale, and for the reshove by effective stack (25 to 26, 26 to 28, 28 to 30, 30 to 32, 32 to 35 big blinds). "Taken" means the final action in both arms; the persona's own verdict is a separate column. It also reports the cap count, the high-probability region described above with expected and measured loss, what a reshove bluff that stopped shoving did instead, and the expected rates worked out from the probabilities themselves.

A second table, labelled unpaired, compares a separate option-on run with the option-off run. Their random streams part at the first changed decision, so it is two samples rather than pairs.

A smoke run only (2,700 hands per arm per cell, far too few to judge anything), paired:

- Cash 100 big blinds: 3-bet bluff 122 of 389 off, 116 of 389 on (65 up, 71 down; difference -1.5 points, -7.4 to +4.3); squeeze bluff 40 of 192 off, 36 on; no reshove spots at this depth.
- Cash 20 to 40 big blinds: 3-bet bluff 87 of 743 off, 96 on; reshove 17 of 17 off, 15 of 17 on (expected for those Horses 87.7 percent).
- Tournament 20 to 40 big blinds: 3-bet bluff 134 of 599 off, 142 on; reshove 9 of 9 off and on.

The full run has not been done. Each of these is about 630,000 hands per arm:

    cd server && MODE=cash DEPTH=100 HANDS=700 npx tsx scripts/holdem-persona-reraise-probe.ts
    cd server && MODE=cash DEPTH=20-40 HANDS=700 npx tsx scripts/holdem-persona-reraise-probe.ts
    cd server && MODE=tournament DEPTH=20-40 HANDS=700 npx tsx scripts/holdem-persona-reraise-probe.ts

League card `cash6_holdem_persona_reraise_mix` deals the option (six-handed cash, 100 big blinds) and gives both arms a hand identity. It never reaches the reshove and its seats are the league's own ids. Not yet run.

## Limits

- Synthetic ids, Horses against Horses, no people. Nothing here shows how people respond to persona-scaled re-raises.
- The measuring tool decides with opponent memory off, so the tight-player hold is never exercised in the measurement. Its report says so in its header.
- The fallback counter fires on the fast decision only (the second look runs with counters off). The second look derives the hand from the same snapshot by the same function, so it cannot fall back when the fast decision did not.
- The league card stamps the hand on both arms, so neither arm is the plain league baseline: the brain's existing plan reader keys on the same context, and stamping one arm alone would make the arms differ by more than the option.
- No profit figure exists for any of the three behaviours.
- This is a preflop range change. Merging it off does not lift the range hold.
- Nothing is live until the option is turned on and an engine release carries it.
