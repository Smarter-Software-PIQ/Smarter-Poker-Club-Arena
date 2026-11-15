# horsePlayStyles: authority for the live switch

Owner order of 2026-11-15 16:40 and 16:42 America/Chicago. Evidence NOT MET; the league evaluation of the two new styles is owed before the option is switched on.

## What it does

Every Horse has one playing style for life: tight, current or pressure. A third of the fleet each, by a hash of the Horse's id with a salt of its own (`HorsePlayStyle.horsePlayStyleFor`), independent of the four id-hash archetypes. Nothing is stored and nothing is written to production. An authored `profiles.horse_profile.persona.playStyle` holding one of the three names wins over the hash (read only; nothing writes it yet).

Omaha mapping (`HorseOmahaPlayStyle`, PLO4/PLO5 cash, high only, three seats or more). Every dial is a scale on a number the brain already has, inside 0.75 to 1.25. No new action, no new bet size.

| Dial (existing)                                                                        | Read at                                        | tight                                                 | current           | pressure in position    | pressure out of position |
| -------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------- | ----------------- | ----------------------- | ------------------------ |
| Preflop bars (StyleParams.tightness: first-in, call, 3-bet, 4-bet)                     | HorseLogic.decidePreflopV7Glue ctx `tightness` | x 1.20                                                | x 1               | x 0.88 (cutoff, button) | x 1                      |
| Preflop bluff volume (StyleParams.bluffFreq)                                           | same ctx `bluffFreq`                           | x 0.80                                                | x 1               | x 1.15                  | x 1                      |
| Preflop aggression (StyleParams.aggression: 3-bet and 4-bet bars)                      | same ctx `aggression`                          | x 1                                                   | x 1               | x 1.08                  | x 1                      |
| Postflop bluff and semi-bluff volume (StyleParams.bluffFreq)                           | HorseLogic.decidePostflop `params`             | x 0.80                                                | x 1               | x 1.15 (last to act)    | x 1                      |
| Postflop aggression (StyleParams.aggression: raise and barrel frequency)               | HorseLogic.decidePostflop `params`             | x 1                                                   | x 1               | x 1.10                  | x 1                      |
| Archetype gears (plo3BetMix, comboDrawAggro, trapFrequency, probeRate, riverBluffGear) | the two `ploPersona` reads in HorseLogic       | TAG Crusher band (its own band if it is a Nit Hunter) | its own archetype | LAG Shark band          | its own archetype        |
| Bet sizes                                                                              | not touched                                    | x 1                                                   | x 1               | x 1                     | x 1                      |

The archetype gears are today's four bands; the style only chooses which existing band the Horse reads, so a Horse is never tight by style and LAG by archetype. With the option off the archetypes are untouched.

Every style plays the current style in tournaments, in Lightning, at 50 bb effective or less, and in games with no mapping (Hold'em until its lane maps it, hi-lo, PLO6, bomb pots, All-In-Or-Fold, heads-up tables). The tight style also plays the current style at a table whose VPIP floor is above its expected VPIP of 24% (the floors in use are 30 and 50), so a tight Horse never plays tight in a 50% VPIP game.

The style dials act before the owner-ruled chain (omahaOwnBetRules, omahaOwnerRuledFinal, omahaTurnRiverRaiseNeedsNuts, omahaNoDrawRaiseOutOfPosition, omahaOopTurnCheckAfterFlopCall, the 3-bet and 4-bet range options, omahaNoCallColdFourBetWithoutPremium, omahaVpipFloorByLimp). Those rulings are final for every style.

`horsePlayStyleForce` is a league and test lever (it names the style of a seat; league seat ids are league-N). It is not boolean and is not a switchable option.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: horsePlayStyles docs/horse-option-authority.d/horsePlayStyles.md sha256 <digest>`). The option is not yet registered in the live switch: the switch migration must be regenerated to include it. The maintained rollback (switch row off, about 30 s) applies if harm is established.

The tight and pressure styles change how many hands a Horse opens and calls with. The owner's preflop range hold covers range changes; whether the order below lifts it for this option is to be recorded by the owner's lane before the switch row is written.

## The owner's orders it rests on (verbatim)

- 2026-11-15 16:40: "I THINK WE NEED TO HAVE 3 HORSE STYLES FOR PLO AND HOLDEM. PICK 3 STYLES THAT ARE WINNING STYLES, OF OF THEM BEING TIGHT, ONE OF THEM BEING EXACTLY HOW THEY ARE NOW, AND ONE OTHER STYLE. AND ASSIGN EACH HORSE THAT STYLE AFTER ITS BEEN CREATED"
- 2026-11-15 16:42: "I WANT YOU TO TAKE CONTROL OF THIS AND MAKE ALL 3 PERSONA'S AND RANDOMLY ASSIGN EACH HORSE A PLAYING TYPE. BUT THEY NEED TO BE WINNING STRATEGIES... OBVIOUSLY TIGHT HORSES SHOULDN'T PLAY 50% VPIP GAMES... PUT TOGETHER A PLAN AND EXECUTE ON THIS IDEA"

## Recorded hands and rulings it answers

None. It is an owner design order, not a hand complaint.

## Receipts

horse_play_style_tight_seen, horse_play_style_pressure_seen, horse_play_style_table_fallback_seen (ledger).

## Tests

HorsePlayStyle.test.ts, HorseOmahaPlayStyle.test.ts, and the style arms in HorseOmahaStrategyPrecedence.test.ts, HorseOmahaTurnRiverRaiseNeedsNuts.test.ts and HorseOmahaBigDrawAggression.test.ts.

## Measured (scratch, not an evaluation)

League harness, six seats, 100 bb, three styled seats against three seats of today's brain, 1,500 mirrored pairs, seed 5570001, 2026-11-15. No illegal action and no fallback in any run.

| Game | Style    | Dealt hands | VPIP  | PFR   | 3-bet | VPIP cutoff and button | VPIP other seats |
| ---- | -------- | ----------- | ----- | ----- | ----- | ---------------------- | ---------------- |
| PLO4 | tight    | 8,711       | 24.3% | 13.5% | 5.4%  | 22.8%                  | 25.1%            |
| PLO4 | current  | 8,725       | 27.9% | 16.4% | 8.8%  | 26.7%                  | 28.6%            |
| PLO4 | pressure | 8,725       | 28.4% | 16.6% | 9.4%  | 28.5%                  | 28.3%            |
| PLO5 | tight    | 8,716       | 24.5% | 15.3% | 8.1%  | 23.7%                  | 24.9%            |
| PLO5 | current  | 8,737       | 28.5% | 18.0% | 11.0% | 27.7%                  | 29.0%            |
| PLO5 | pressure | 8,737       | 29.0% | 18.6% | 12.5% | 29.6%                  | 28.7%            |

3-bet is the share of first decisions facing exactly one raise that re-raised. A hand in which the seat never acted (a walk) is not counted as dealt. The current style diverged from today's brain in 0 pairs.

## Evidence rows

- Mechanism, scope, visibility (receipts in HorseDataLedger.ts), tests: MET.
- Option unset or false, and the current style: decisions identical to today (league, plo4/plo5 x dev/horse, 150 pairs, seed 5560001: 0 divergent pairs on all four cells).
- Value, continuation, reach: NOT MET. No evaluation was run (evaluation NOT RUN). League cards plo4/plo5 \_horse_play_style_tight and \_pressure are declared and not run.

## Limits

- Whether tight and pressure win is not known: nothing here measures chips won.
- The tight style raises the 3-bet and 4-bet value bars together with the entry bars, so it re-raises less for value as well as as a bluff (measured 3-bet 5.4% against 8.8% in PLO4).
- The pressure style is close to current overall (about half a point of VPIP); its change is on the cutoff and the button (about two points).
- Hold'em has no mapping yet and plays current with the option on.
- The seat rotator's add-on behaviour still reads the id-hash archetype, not the style.
- Seating does not look at the style: a tight Horse can be seated at a floored table, where it plays current.
- The depth rule uses the stacks at the start of the hand (stack plus chips put in), read from the decision state.
