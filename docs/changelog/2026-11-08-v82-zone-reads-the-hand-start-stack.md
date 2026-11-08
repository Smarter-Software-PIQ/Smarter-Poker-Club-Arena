# The V82 Facing-Open Zone Reads the Stack the Hand Started With (2026-11-08)

V82 (`v70FacingOpenZone`, #9538) lets a two- or three-handed no-limit hold'em stack facing one sized open flat or raise instead of only jamming or folding. Its band is 15 to 22bb, counted as the stack behind plus the chips already in this street, both ends inclusive. The gate in `decidePreflopV7Core` read `effStackBB <= 15` on the chips behind only. A big blind that began the hand with 15.00 to 16.00bb has 14 to 15bb behind after posting, so it went back into jam-or-fold.

## Evidence

Live, serving release 40bc2467 (2026-11-07 16:31 to 21:36Z), big blind facing one sized open (V82 BB-only report):

| cell                 | call or raise                  | n     |
| -------------------- | ------------------------------ | ----- |
| heads-up 15-18bb     | 29.3% (95% CI 27.0-31.7)       | 1,445 |
| heads-up 18-22bb     | 51.0%                          | 2,487 |
| three-handed 15-18bb | 12.7% (mostly exactly 15.00bb) | 370   |

The complaint replay (`horse-complaint-replay.ts`) of five three-handed folds (84dd1c83, 64d4e91b, 76089692, 37dca1e1, 5263c30c) and five heads-up 15-18bb folds (5ea10c41, c11a976b, 2de9b93f, 84db2db7, 977bc91b) gave the same answer on 92e26a9f and on main. Every big blind that started at 15.00 to 15.58bb reached the push/fold node (`pushFoldNlh` true, `v77_seat_jam` receipt). The 16.5 to 17.8bb big blinds were already in the V82 zone and folded weak hands at the V34 big-blind floor. The engine source did not change on this path between the two releases. The lower live share is consistent with more traffic at the 15.00bb edge (the three-handed cell grew from n 83 to n 370, mostly at exactly 15.00bb), not with a new rule.

## Change

Facing action, two- and three-handed no-limit hold'em: jam-or-fold is `handStartBB <= 12`, or with the M layer `handStartBB x blind-clock scale < 15`. Here `handStartBB = stackBB + (currentBet - toCall) / bb`. The unopened V70 open, full ring, Omaha, short deck and fixed limit are unchanged. `v70FacingOpenZone: false` still keeps the legacy gate.

After the change, the replay of 76089692 calls 10/10. The other big blinds that started at 15.00 to 15.58bb now reach the V82 zone and fold only at the V34 floor with weak hands.

## Tests

- `server/src/engine/HorseV82HandStartDepth.law.test.ts` (law). For the reproduced states of 84dd1c83, 76089692, 64d4e91b and 5ea10c41: the V82 zone owns the big blind; the same big blind at 14.50bb stays jam-or-fold; the flag off keeps the legacy gate; 22.00bb is inside the band. Against the old source, all four reproduced states fail.
- `server/src/engine/HorseV82BbFacingOpen.controlled.test.ts`. This is CONTROLLED scenario coverage on constructed spots. It is not live evidence. It runs the real `HorseLogic.decide`, seeded, over all 169 classes. Call or raise short of all-in:

| cell                                                              | call or raise              |
| ----------------------------------------------------------------- | -------------------------- |
| heads-up tournament 15.00 / 18.00 / 22.00bb vs 2.2bb, 18bb vs 3bb | 47.2                       |
| heads-up cash 15.00 / 22.00bb vs 2.5bb                            | 47.2                       |
| three-handed tournament 15.00 / 18.00bb vs 2.2bb                  | 62.7 (plus 13.8 jams)      |
| three-handed tournament 18.00bb vs 3bb                            | 60.0                       |
| three-handed cash 15.00 / 22.00bb                                 | 47.5 / 59.1                |
| three-handed tournament 22.00bb                                   | 76.5, above the 66 ceiling |

The three-handed tournament 22.00bb cell has the same fold share as at 15 and 18bb (23.5%). At 22bb the 3-bets are no longer all-in, so they count as raises. The continue width there is the V72 big-blind continue width (the `def72` call bar), not the V82 gate. The test holds that cell to "engaged and not below the band". The cell is reported above the band, not tuned here.
