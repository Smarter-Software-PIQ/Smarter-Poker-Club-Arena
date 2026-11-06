# V31 certification: the mood hour is part of the deal, not the clock

The V31 certification card (`GtoV31CandidateEvaluation.ts`, run by
`gtoV31Evaluate.ts`) measured whatever UTC hour the job happened to run in.
The V9 hourly mood (`HorseLogic.moodOf`) reads the wall clock unless a decision
passes `decisionTimeMs`, and no certification decision did.

Evidence (R7, dataset 187815b1, epoch 4, engine 92e26a9f): league/cash
recorded -3.575 bb/100 (se 1.768), a loss by 0.04 bb/100, at 19:40Z.
Re-run offline with the sealed cash model (55596d5a...), the same seed and
`EQUITY_GOVERNOR=off`, the card reproduces to the last digit (-3.575 / 1.76796;
paired_replay +1.555 / 2.36986) only when the mood clock is pinned to hour 19.
Pinned to each of the 24 hours of that day: hours 0-11 give -2.885 (se 1.626),
a tie; hours 12-17 give -3.915 (se 1.782) and hours 18-23 give -3.575, both
losses. Same playbook, deals and engine: the verdict was the time of day.
The 132 hands in which the candidate itself acted net -220 bb at every hour;
only knock-on hands (horse memory) move with the hour.

- `HorseLeague.ts`: `LeagueMatchup.moodClock: 'deal_seed'` stamps every
  decision of a duplicate pair, both passes and both arms, with
  `dealMoodClockMs(handSeed)` (seconds 0-86,399 of a fixed day, the
  `jointMoodClockMs` formula). The hour is uniform over the day, like
  production play, and identical wherever and whenever the card runs. Unset
  keeps every existing card unchanged.
- `GtoV31CandidateEvaluation.ts`: every certification scenario, both kinds,
  sets `moodClock: 'deal_seed'`.
- `gtoV31Evaluate.ts`: refuses to run unless the equity load governor is off.
  The qualification job already exports `EQUITY_GOVERNOR=off`; a governed
  Monte Carlo would make verdicts depend on host load.
- `HorseLeagueDealMoodClock.test.ts`: every decision of a pair carries that
  deal's clock; the deal hours cover all 24; an unpinned card keeps the wall
  clock; a pinned card is identical at six spread wall-clock hours.

Certification verdicts recorded before this change (R7 epochs 1-4) are
immutable and unchanged. New epochs measure every hour of the day.
