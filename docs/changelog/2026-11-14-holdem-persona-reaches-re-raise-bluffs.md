# The Hold'em Persona Reaches Re-Raise Bluffs (Default Off)

Owner ruling 2026-11-13 (D3, option C): persona-specific 3-bets, squeezes and shallow four-bet reshoves, designed and tested, rollout gated. This is the build. Nothing changes in play: the option is off, and turning it on is a separate owner decision.

## What Was Missing

Every Horse has a Hold'em persona worked out from its id: one of four archetypes (LAG, TAG, Tricky, Nit) and a figure, `nlh3BetMix`, described as how often it 3-bets, squeezes and reshoves. Nothing read that figure. Before the flop every Horse re-raised as a bluff at the same rate, decided by a shared random draw that knows nothing about which Horse is acting.

## What Changed

A new option, `holdemPersonaReRaiseMix`, OFF by default. With it on, in two-card no-limit hold'em only (cash and tournament):

1. **3-bet bluff** (facing one open). The bluff still has the same probability rule as before, multiplied by the Horse's scale: its `nlh3BetMix` divided by 0.42143, the average under the id model. The scale runs from 0.52 (the tightest Nit) to 1.52 (the loosest LAG). The result is capped at certain.
2. **Squeeze bluff** (a raise and one or more callers). The same rule, at both places a squeeze bluff is decided: the older squeeze site, and in hold'em cash the chart block that also answers a called open.
3. **Four-bet all-in reshove at 26 to 35 big blinds** (facing a 3-bet). The value hands (77+, ATs+, KQs, AKo) shove as before. The bluff hands (A5s to A2s) shove with probability equal to the Horse's scale, capped at always. A bluff hand that does not shove does what it would do if it were not a bluff hand at all.

The decision uses the Horse's own number rather than the shared draw. That number is a hash of the Horse's id, the hand's public state (seat, dealer seat, stack and pot in quarter big blinds, players dealt in), its exact hole cards and a different salt for each of the three behaviours. The same Horse in the same spot with the same cards always gets the same answer; a different hand gives a different number.

Value 3-bets and value squeezes are not scaled. They are decided by a strength bar, not a mix, so the persona difference is carried by the bluffs.

## The Random Stream

- Option off (absent or false): no draw is added, removed or moved, and the comparison at each bluff site is the expression it was. The persona field is not built.
- Option on: the 3-bet bluff and the squeeze bluff still consume the shared draw at the same point and throw it away, so a decision the persona does not change leaves the stream exactly where it was. A decision the persona changes then draws its sizing differently, as any changed decision does. The reshove never drew and still does not.
- Omaha, short deck, pot limit, fixed limit, hi-lo, pineapple and All-In-Or-Fold never receive the field.

## What Is Declared, Not Hidden

- **The reshove bluff is reduced.** A Horse below the average shoves A5s to A2s less often and nobody shoves more, so with the option on the fleet shoves these hands less than today. The first design record said fleet frequencies were preserved; for the reshove that is not true of this build.
- **"The average is preserved" is a model figure.** The scale averages 1 across ids only if ids fall evenly across the persona buckets and every Horse meets these spots equally often. On the 900 synthetic ids used for measuring, the average scale is 1.00346. The real fleet's ids have not been read.
- **The cap.** Where the bluff probability times the scale would pass 1 it is held at 1. This is the only place the 3-bet bluff and the squeeze bluff can lose frequency. Each case is counted (`holdem_persona_3bet_bluff_capped_seen`, `holdem_persona_squeeze_bluff_capped_seen`) and the measuring tool reports the count.
- **No hands are added to make the total match** (owner instruction 2026-11-14). The A9s to A6s set is not built in any form. The size of the reshove reduction is to be measured before anything ships; the model's expected figure is 90.5 percent of today's bluff reshoves (LAG 100, TAG 95.1, Tricky 87.5, Nit 66.4).
- **Hand identity.** The state a decision receives carries no hand number, so "this hand" means public state plus cards. Two hands with the same Horse, cards, seats, stack and pot give the same number.
- **A changed counter counts comparisons, not actions.** The 3-bet and squeeze `_changed_seen` counters fire when the scaled comparison disagrees with the draw it replaced. The fold-equity test still runs after it and can refuse the bluff either way.

## Counters

Eight, all occurrence counters: `holdem_persona_3bet_bluff_eligible_seen`, `_changed_seen` and `_capped_seen`, the same three for `holdem_persona_squeeze_bluff`, and `holdem_persona_fourbet_reshove_eligible_seen` and `_changed_seen`. Eligible means the decision reached the comparison with the option on.

## Proof

- `server/src/engine/HorseHoldemPersonaReRaiseMix.test.ts` (20 tests):
  - Off: 5,064 preflop decisions across hold'em cash (100 and 26 to 35 big blinds), hold'em tournament, PLO4, PLO5, PLO6, short deck and fixed limit give the same action, amount and random-stream state whether the option is absent, false, or replaced by a control that says what today's rule is (the scale fixed at 1 and the Horse's number set to the draw itself).
  - On, other variants: 2,100 or so decisions, identical to off, no persona counter fires.
  - On, hold'em: every decision the persona did not change equals off, draw for draw. Over the same 150 spots for 40 Horses of each archetype the 3-bet bluff rate is LAG 17.8%, TAG 14.0%, Tricky 12.3%, Nit 8.5%. The same spot twice gives the same answer; across 40 stack depths the answer moves while the option-off answer does not.
  - Reshove: 20 Horses at scale 1 or more shove A5s to A2s 960 of 960 times; 20 Nits shove 654 of 960 and call the other 306; value hands always shove.
- A refused reshove bluff was compared against an engine with the bluff hands removed from the set: 306 of 306 the same action, amount and stream state (a call in the tested spot: button opens 2.2, big blind 3-bets to 7.5, 27 to 33 big blinds).
- Two deliberate breaks, each caught: dropping the discarded draw fails the draw-for-draw test; multiplying the option-off probability fails the off test.
- `server/src/engine/HorsePersona.holdemReRaiseScale.test.ts` recomputes 0.42143 from the archetype shares and ranges.
- Standing tests unchanged and passing with the option off: the opponent-exploit neutrality corpus, the style-read off digests, the cash and tournament frequency laws, the data ledger and the league-card law.

## Measuring It

`server/src/benchmark/HoldemPersonaReRaiseProbe.ts` (command line `server/scripts/holdem-persona-reraise-probe.ts`): 900 synthetic ids in exactly 225 LAG, 180 Tricky, 360 TAG and 135 Nit, 100 nine-handed tables, every seat rotation, preflop only, option on and option off on the same code. For each of the three behaviours it reports eligible and taken with a 95% Wilson interval: pooled, by archetype and by tenth of the fleet ordered by scale. For the 3-bet bluff and the squeeze bluff it also reports how often the cap bound. For the reshove it also reports by effective stack (25 to 26, 26 to 28, 28 to 30, 30 to 32, 32 to 35 big blinds), what a bluff hand that did not shove did instead (fold or call), and the expected rate from the model, so measured and expected can be compared.

The reshove's expected rate with the option on, as a share of today's bluff reshoves: 90.5 percent pooled; LAG 100, TAG 95.1, Tricky 87.5, Nit 66.4. That is an expected loss of 9.5 percent of bluff reshoves across the fleet. It is a model figure, not a measurement.

The reshove site is named 26 to 35 big blinds, but its existing condition is "more than 25, up to 35". The 25 to 26 row shows the part the name leaves out. That condition was not changed.

A smoke run only (2,700 hands per arm per cell, far too few to judge anything) shows the tool works:

- Cash 100 big blinds: 3-bet bluff 122 of 398 on (30.7%) against 122 of 389 off (31.4%), cap bound 9 times, all LAG; squeeze bluff 41 of 184 (22.3%) against 40 of 192 (20.8%), cap never bound; no reshove spots at this depth.
- Cash 20 to 40 big blinds: 3-bet bluff 95 of 741 (12.8%) against 87 of 743 (11.7%); reshove 13 of 15 on (86.7%) against 17 of 17 off; the two that did not shove were both Nits, one called and one folded.
- Tournament 20 to 40 big blinds: 3-bet bluff 138 of 587 (23.5%) against 134 of 599 (22.4%), cap bound 8 times; reshove 13 of 13 on and 9 of 9 off.

The full run has not been done. For the reshove it needs both of these (about 630,000 hands per arm each):

    cd server && MODE=cash DEPTH=20-40 HANDS=700 npx tsx scripts/holdem-persona-reraise-probe.ts
    cd server && MODE=tournament DEPTH=20-40 HANDS=700 npx tsx scripts/holdem-persona-reraise-probe.ts

League card `cash6_holdem_persona_reraise_mix` deals the option (six-handed cash). Not yet run.

## Limits

- Synthetic ids, Horses against Horses, no people. Nothing here shows how people respond to persona-scaled re-raises.
- No profit figure exists for any of the three behaviours.
- This is a preflop range change. Merging it off does not lift the range hold.
- Nothing is live until the option is turned on and an engine release carries it.
