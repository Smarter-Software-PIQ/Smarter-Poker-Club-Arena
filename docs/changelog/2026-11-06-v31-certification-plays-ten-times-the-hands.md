# V31 certification plays ten times the hands

Each V31 certification family now plays 50,000 duplicate pairs (100,000
hands) instead of 5,000 (`GtoV31CandidateEvaluation.ts` `TOTAL_PAIRS`).

Why: at 5,000 pairs the cash card rested on about 130 candidate decisions,
and single pots swung up to 85 bb. R7's league/cash verdict (dataset
187815b1, epoch 4) turned on two hands it played correctly and lost later in
the hand. With eight cards each judged at two standard errors, a candidate
that is exactly break-even fails at least one card about 1 time in 6 by
chance; a larger sample is how a real edge, or a real leak, shows instead.

Measured offline on R7's sealed cells at 10x (deal-seed mood clock,
EQUITY_GOVERNOR=off): paired cash 1,265 candidate decisions, se 0.634
(was 2.370); paired spin 1,632 decisions, se 0.132 (was 0.408). The eight
cards take about 40 minutes on a Mac Studio, inside the qualify job's
350-minute limit.

Unchanged: the database floor (hands >= 10,000), the 2-standard-error
verdict, zero illegal actions, truncations and mismatches, and a candidate
hit in every component.
