# League: the heads-up big blind flag is measured at 40bb as well as 80bb (HU-NLH-001)

Date: 2026-11-12

## Why

`huBbDefendsToPrice` (#9936, default OFF) is measured nightly by two cards,
`hu_bb_defends_to_price` and `human_hu_bb_defends_to_price`, both at 80bb.
V85 (2026-11-10) then widened the cash big blind, but only above
`V85_DEPTH_NONE_BB` (50bb). Its taper rests on a six-handed measurement at
40bb. Heads-up, the two changes leave this:

Real `HorseLogic.decide` at `a3f42a08`, live cash Hybrid persona, live default
flags, two dealt in, the big blind facing the small blind's open (169 classes,
combo weighted, four seeds a class):

| effective stack | open 2bb | open 2.5bb |
| --------------- | -------- | ---------- |
| 20bb to 50bb    | 58.7%    | 58.7%      |
| 55bb            | 36.6%    | 44.7%      |
| 65bb            | 28.9%    | 39.0%      |
| 80bb            | 19.7%    | 26.2%      |
| 100bb           | 18.6%    | 22.2%      |

(share of big blinds folded). At 50bb or less the answer does not read the
price: a 2bb, 2.5bb and 3bb open are folded to alike. A min-raise needs half
its opens to fold to profit with any two cards, and 50bb is the cash minimum
buy-in. The 80bb cards measure the flag where V85 already answers.

## What

- `hu_bb_defends_to_price_40bb`: the 80bb mirror card at `stackBB: 40`.
- `human_hu_bb_defends_to_price_40bb`: its human-field twin against
  `hu_wide_sb_aggressor_v1`, built by the same block as the 80bb twin.
- The flag default is **not** changed. No engine decision source is changed.

## Local measurement (development evidence, declared before the results)

`runMatchup`, 8 seeds (20261112 + 7919 i) x 12,500 pairs a card,
`EQUITY_GOVERNOR=off`, arm A flag on, arm B live defaults, A minus B:

| card               | hands   | bb/100         |
| ------------------ | ------- | -------------- |
| human field, 25bb  | 200,000 | +1.59 +/- 0.85 |
| human field, 40bb  | 200,000 | +2.90 +/- 1.30 |
| human field, 80bb  | 200,000 | +1.34 +/- 1.78 |
| horse mirror, 40bb | 200,000 | -1.32 +/- 0.84 |
| horse mirror, 80bb | 200,000 | +0.42 +/- 1.07 |

0 illegal actions and 0 truncated streets on every card. The declaration cut
the reading to the first four seeds if a seed ran past four minutes, which it
did because five cards shared two cores: on that cut the 40bb human card reads
+4.67 +/- 1.83 and the 40bb mirror -0.37 +/- 1.20. Both readings are given;
neither is held-out evidence, and the persona is a development persona.

Reading: against a small blind that opens wide and stabs, the flag earns at
40bb. Against a horse it leans negative at 40bb. That is not grounds to turn
the flag on, and it is the reason both 40bb cards go on the nightly set.

## Tests

- `HorseHuBbDefence.test.ts`: three cases pin the measured answer at live
  defaults (over half folded at 40bb at every open size, under a third at
  80bb, and the flag reading the price at 40bb).
- `HorseLeagueHumanFieldHeadsUp.test.ts`: the 40bb pair is on the card with
  the 80bb pair unchanged, both cards diverge at 40bb, the flag defaults off.
- `HorseLeagueHumanField.test.ts`: the new twin is in the expected list.
