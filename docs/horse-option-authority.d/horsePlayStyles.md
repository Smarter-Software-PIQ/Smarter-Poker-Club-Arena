# horsePlayStyles: authority for the live switch

Owner order of 2026-11-15 16:40 and 16:42 America/Chicago. League evaluation run 2026-11-16: neither new style is distinguishable from the current style against Horses (see below); no measurement against humans.

## What it does

Every Horse has one playing style for life: tight, current or pressure. A third of the fleet each, by a hash of the Horse's id with a salt of its own (`HorsePlayStyle.horsePlayStyleFor`), independent of the four id-hash archetypes. Nothing is stored and nothing is written to production. An authored `profiles.horse_profile.persona.playStyle` holding one of the three names wins over the hash (read only; nothing writes it yet).

Omaha mapping (`HorseOmahaPlayStyle`, PLO4/PLO5 cash, high only, three seats or more). Every dial is a scale on a number the brain already has, inside 0.75 to 1.25 (the 2026-11-16 tie-break band inside x1 to x2, the entry-bar credit inside 0 to 0.04 on the hand-strength scale). No new action, no new bet size.

| Dial (existing)                                                                                                                           | Read at                                                                                 | tight                                                                                                     | current           | pressure in position                                                | pressure out of position |
| ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------- | ------------------------ |
| Preflop entry bars (StyleParams.tightness: first in, limp, cold call, call of a re-raise)                                                 | HorseLogic.decidePreflopV7Glue ctx `tightness`                                          | x 1.15                                                                                                    | x 1               | x 0.75 (cutoff, button; the call bars stay at x 1 since 2026-11-16) | x 1                      |
| Preflop value re-raise bars (3-bet, 4-bet)                                                                                                | ctx `valueRaiseTightness`, HorsePreflop t53 / tv                                        | x 1                                                                                                       | x 1               | x 0.75 (2026-11-16; was x 0.90)                                     | x 1                      |
| Preflop bluff volume (StyleParams.bluffFreq)                                                                                              | same ctx `bluffFreq`                                                                    | x 0.80                                                                                                    | x 1               | x 1.20                                                              | x 1                      |
| Preflop aggression (StyleParams.aggression)                                                                                               | same ctx `aggression`                                                                   | x 1                                                                                                       | x 1               | x 1.10                                                              | x 1                      |
| Postflop bluff and semi-bluff volume                                                                                                      | HorseLogic.decidePostflop `params`                                                      | x 0.80                                                                                                    | x 1               | x 1.25 (last to act)                                                | x 1                      |
| Postflop aggression                                                                                                                       | HorseLogic.decidePostflop `params`                                                      | x 1                                                                                                       | x 1               | x 1.20                                                              | x 1                      |
| Continuation-bet frequency (`cbetFreqMult`)                                                                                               | HorseLogic.decidePostflop                                                               | x 1                                                                                                       | x 1               | x 1.25                                                              | x 1                      |
| EV engine aggression tie-break (a per-Horse seed in -0.12 to +0.12 BB; acts only among candidates priced within 0.12 BB of the best)      | HorseEvEngine.personallyIndifferent                                                     | own seed                                                                                                  | own seed          | +0.12, the top of the seed's range                                  | own seed                 |
| 2026-11-16: EV engine fold-equity prior (each opponent's EvOpponentModel.foldMul on the V38 bet candidates; the check is priced as today) | HorseLogic.decidePostflop V38 `models38`                                                | x 1                                                                                                       | x 1               | x 1.25 (last to act)                                                | x 1                      |
| 2026-11-16: EV engine indifference band for a candidate more aggressive than the best (0.12 BB), with the bias scaled with it             | HorseEvEngine.personallyIndifferent, HorsePersona.resolveIndifferenceTieBreak `bandMul` | x 1                                                                                                       | x 1               | x 2 (0.24 BB; bound x 2)                                            | x 1                      |
| 2026-11-16: preflop raise-bar credit (subtracted from the first-in open, isolation and value 3-bet bars, never a call bar)                | HorsePreflop tv / t53 ctx `styleEntryBarCredit`, call bars ctx `styleCallTightness`     | 0                                                                                                         | 0                 | 0.04 (cutoff, button; the bound)                                    | 0                        |
| Archetype gears (plo3BetMix, comboDrawAggro, trapFrequency, probeRate, riverBluffGear)                                                    | the two `ploPersona` reads in HorseLogic                                                | TAG Crusher band (its own if it is a Nit Hunter); elite re-raise mix the higher of its own and the band's | its own archetype | LAG Shark band                                                      | its own archetype        |
| Bet sizes                                                                                                                                 | not touched                                                                             | x 1                                                                                                       | x 1               | x 1                                                                 | x 1                      |

The archetype gears are today's four bands; the style only chooses which existing band the Horse reads, so a Horse is never tight by style and LAG by archetype. With the option off the archetypes are untouched.

Every style plays the current style in tournaments, in Lightning, at 50 bb effective or less, and in games with no mapping (Hold'em until its lane maps it, hi-lo, PLO6, bomb pots, All-In-Or-Fold, heads-up tables). The tight style also plays the current style at a table whose VPIP floor is above its expected VPIP (23% in PLO4, 24% in PLO5; the floors in use are 30 and 50), so a tight Horse never plays tight in a 50% VPIP game.

The style dials act before the owner-ruled chain (omahaOwnBetRules, omahaOwnerRuledFinal, omahaTurnRiverRaiseNeedsNuts, omahaNoDrawRaiseOutOfPosition, omahaOopTurnCheckAfterFlopCall, the 3-bet and 4-bet range options, omahaNoCallColdFourBetWithoutPremium, omahaVpipFloorByLimp). Those rulings are final for every style.

`horsePlayStyleForce` is a league and test lever (it names the style of a seat; league seat ids are league-N). It is not boolean and is not a switchable option.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: horsePlayStyles docs/horse-option-authority.d/horsePlayStyles.md sha256 <digest>`). The option is registered in the live switch (on and off; follow-up list migration 20261116073430 names it) and is OFF unless such a row is written. The maintained rollback (switch row off, about 30 s) applies if harm is established.

The tight and pressure styles change how many hands a Horse opens and calls with, so the option falls under the owner's preflop range hold. The owner's 16:42 order below lifts that hold for this option alone (Hand Analysis ruling, inbox 2026-11-16T03:06:28Z, B1). The lift is recorded in source, not in a note: `OPTION_SWITCH_PREFLOP_HOLD_LIFTED.horsePlayStyles` in server/src/engine/HorseOptionSwitch.ts cites the 16:42 text, OWNER-TEXT-20261115-1000-PLO-CHAT-VERBATIM.md and its full sha256 at the time it was read (7921dea5df9daf5992faacb5a585f2fa67e2ae1c878936f040a3e7b0eea58b39, 2026-11-16T03:22:11Z; the file is append-only, so its digest moves). Every other option under the preflop hold stays off-only (HorseOptionSwitchPreflopHoldLift.test.ts).

## The owner's orders it rests on (verbatim)

- 2026-11-15 16:40: "I THINK WE NEED TO HAVE 3 HORSE STYLES FOR PLO AND HOLDEM. PICK 3 STYLES THAT ARE WINNING STYLES, OF OF THEM BEING TIGHT, ONE OF THEM BEING EXACTLY HOW THEY ARE NOW, AND ONE OTHER STYLE. AND ASSIGN EACH HORSE THAT STYLE AFTER ITS BEEN CREATED"
- 2026-11-15 16:42: "I WANT YOU TO TAKE CONTROL OF THIS AND MAKE ALL 3 PERSONA'S AND RANDOMLY ASSIGN EACH HORSE A PLAYING TYPE. BUT THEY NEED TO BE WINNING STRATEGIES... OBVIOUSLY TIGHT HORSES SHOULDN'T PLAY 50% VPIP GAMES... PUT TOGETHER A PLAN AND EXECUTE ON THIS IDEA"

## Recorded hands and rulings it answers

None. It is an owner design order, not a hand complaint.

## Receipts

Per-style tracking (2026-11-16), one per decision with the option on (ledger): horse_play_style_tight, horse_play_style_current, horse_play_style_pressure (the style in force), and horse_play_style_fallback_current_floor_seen / \_tournament_seen / \_lightning_seen / \_short_stack_seen / \_unmapped_seen (a tight or pressure Horse forced to the current style by the table, with the reason). Results per style are read offline by joining the Horse id to `horsePlayStyleFor`: `node --import tsx server/scripts/horse-play-style-for.ts < ids.txt` prints `id<TAB>style` (no database access).

## Tests

HorsePlayStyles.law.test.ts (docs/laws.d/server-src-engine-HorsePlayStyles.md), HorsePlayStyle.test.ts, HorseOmahaPlayStyle.test.ts, and the style arms in HorseOmahaStrategyPrecedence.test.ts, HorseOmahaTurnRiverRaiseNeedsNuts.test.ts and HorseOmahaBigDrawAggression.test.ts.

## Measured: census (scratch, not an evaluation)

League harness, six seats, 100 bb, three styled seats against three seats of today's brain, every seat the live Hybrid cash profile, the 27 options sealed ON for the 2026-11-15 release on in both arms, 1,500 mirrored pairs, seed 5570001. No illegal action and no fallback.

| Game | Style    | Dealt hands | VPIP  | PFR   | 3-bets (count) | 3-bets as a share of hands played | VPIP cutoff and button | VPIP other seats |
| ---- | -------- | ----------- | ----- | ----- | -------------- | --------------------------------- | ---------------------- | ---------------- |
| PLO4 | tight    | 8,691       | 23.6% | 12.6% | 106            | 5.2%                              | 22.3%                  | 24.3%            |
| PLO4 | current  | 8,710       | 26.8% | 14.2% | 116            | 5%                                | 25.6%                  | 27.4%            |
| PLO4 | pressure | 8,709       | 27.7% | 14.4% | 131            | 5.4%                              | 28.8%                  | 27.2%            |
| PLO5 | tight    | 8,710       | 24.2% | 14.6% | 212            | 10.1%                             | 23.7%                  | 24.5%            |
| PLO5 | current  | 8,723       | 27.4% | 15.9% | 223            | 9.3%                              | 27.1%                  | 27.6%            |
| PLO5 | pressure | 8,723       | 28.4% | 16.2% | 246            | 9.9%                              | 30.5%                  | 27.4%            |

A hand in which the seat never acted (a walk) is not counted as dealt. The tight style makes slightly fewer 3-bets in total because its bluff re-raises are cut; with the bluffs off it re-raises every hand the current style re-raises (HorseOmahaPlayStyle.test.ts). The pressure entry scale is at its bound (0.75) and gives about 3.3 points of VPIP on the cutoff and button, short of the 4 to 6 aimed at. In-position bet rates when checked to were not visibly higher for the pressure style in the totals (flop 70.8% against 71.9% PLO4, 73.4% against 74.7% PLO5): most of those bets are decided by the EV engine, and a pressure Horse reaches the flop with a wider range.

## Measured: league evaluation (protocol declared first, personas-20261115/PROTOCOL.md)

Six seats, 100 bb cash, every seat the live Hybrid cash profile, the same 27 options on at every seat, seeds 5580001 to 5580003, source 2f732be6a43. Versus: 3 seats of the style against 3 seats of today's brain, 4,000 mirrored pairs per seed. Mixed: 2 tight, 2 current, 2 pressure, 4,000 deals per seed each played three times with the styles rotated. Figures are the style's bb/100 minus the current style's, with one standard error; 0 illegal actions, 0 truncated streets, 0 fallbacks in all 18 runs.

| Game | Layout | Style    | Seed 1       | Seed 2       | Seed 3       | Pooled       |
| ---- | ------ | -------- | ------------ | ------------ | ------------ | ------------ |
| PLO4 | versus | tight    | +0.62 ± 2.09 | +0.23 ± 1.99 | +0.90 ± 1.68 | +0.58 ± 1.11 |
| PLO4 | mixed  | tight    | -1.99 ± 3.90 | -0.78 ± 4.75 | -1.50 ± 3.80 | -1.42 ± 2.41 |
| PLO5 | versus | tight    | +2.44 ± 2.19 | +0.47 ± 2.46 | -2.38 ± 2.19 | +0.18 ± 1.32 |
| PLO5 | mixed  | tight    | -1.56 ± 4.73 | +7.43 ± 4.98 | +6.74 ± 5.35 | +4.20 ± 2.90 |
| PLO4 | versus | pressure | +0.49 ± 1.85 | +0.32 ± 1.68 | +1.64 ± 1.54 | +0.82 ± 0.98 |
| PLO4 | mixed  | pressure | -1.09 ± 4.84 | +4.01 ± 4.06 | +1.49 ± 3.72 | +1.47 ± 2.44 |
| PLO5 | versus | pressure | +1.30 ± 2.40 | -1.06 ± 2.33 | +0.45 ± 2.54 | +0.23 ± 1.40 |
| PLO5 | mixed  | pressure | +1.97 ± 5.52 | +9.07 ± 5.65 | +8.33 ± 6.06 | +6.46 ± 3.32 |

Verdict by the declared rule (losing = worse than current beyond two standard errors in any cell; winning = better beyond two in at least one and losing in none): tight EQUAL to current, pressure EQUAL to current. No cell is beyond two standard errors either way; the nearest is pressure on the PLO5 mixed table at +1.95. No dial was adjusted after the evaluation.

The league charges no rake and its field is Horses only: nothing here measures either style against human players, and a tight style gains nothing from rake it would save at a real table.

## Measured: second league evaluation of the pressure style (protocol declared first, personas2-20261116/PROTOCOL-2.md)

Source 71943e96604 (the 2026-11-16 in-position EV-engine bias: fold-equity prior x1.25, aggressive tie-break band x2, preflop entry-bar credit 0.03 on every entry bar). Same design as above, with the 32 options of activation-0106z/ON-LIST.txt on at every seat. Pressure bb/100 minus current, one standard error; 0 illegal actions, 0 truncated streets, 0 fallbacks in all 12 runs.

| Game | Layout | Seed 1        | Seed 2       | Seed 3       | Pooled       |
| ---- | ------ | ------------- | ------------ | ------------ | ------------ |
| PLO4 | versus | +3.16 ± 2.10  | +2.55 ± 2.20 | +3.53 ± 1.79 | +3.08 ± 1.18 |
| PLO4 | mixed  | +2.63 ± 4.75  | +5.56 ± 4.57 | +7.81 ± 4.33 | +5.33 ± 2.63 |
| PLO5 | versus | +1.72 ± 2.44  | +1.32 ± 2.26 | +1.48 ± 2.54 | +1.51 ± 1.40 |
| PLO5 | mixed  | +11.24 ± 5.60 | +1.17 ± 5.53 | +8.86 ± 5.80 | +7.09 ± 3.26 |

Verdict by the declared rule: pressure WINNING against current (no cell losing; PLO4 versus, PLO4 mixed and PLO5 mixed beyond two standard errors). No pull-back was needed. Against Horses only, no rake.

## Evidence rows

- Mechanism, scope, visibility (receipts in HorseDataLedger.ts), tests: MET.
- Option unset or false, and the current style: decisions identical to today (decision digest, plo4/plo5 x dev/horse, 150 pairs, seed 5560001: equal to the base on all four cells).
- Value: not worse than current beyond two standard errors in any of eight cells; not shown better. Against Horses only, no rake.
- Continuation, reach against humans: NOT MET. A live read is owed after the option is switched on.

## Limits

- Neither new style is shown to win more than the current style; they are shown not to lose to it at this sample (pooled standard errors 1.0 to 3.3 bb/100).
- (2f732be6 dials) The pressure style gave about 3.3 points of cutoff and button VPIP at the bound of its entry scale, under the 4 to 6 aimed at, and its extra in-position betting was not visible in the totals. The 2026-11-16 EV-engine bias answers this; see personas2-20261116 for its census and evaluation.
- The tight style cuts bluff re-raises, so its total 3-bet count is a little under current while its value re-raises are unchanged.
- Hold'em has no mapping yet and plays current with the option on.
- The seat rotator's add-on behaviour still reads the id-hash archetype, not the style.
- Seating does not look at the style: a tight Horse can be seated at a floored table, where it plays current. The seating change (horsePlayStyleTightSeating, default off) is written as a patch for the cash lane, which owns HorseFleetManager and HorseSessionRotator (personas2-20261116/seating.patch); it is not in source.
- The depth rule uses the stacks at the start of the hand (stack plus chips put in), read from the decision state.
- The committed league cards (plo4/plo5 `_horse_play_style_tight` and `_pressure`) play the live Hybrid profile (`hybridBaseline: true`, 2026-11-16), as the evaluation above did; before that date they used the retired production styles.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-19 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it)

## Rollback

If enabled, set `horsePlayStyles` to `off` via the `horse-option-switch` CLI (`fn_ca_horse_option_switch_set('horsePlayStyles', 'off', '<actor>', '<reason>')`) to restore the base brain within ~30s; zero data migration needed.
