# Player Stats: mode-scoped, centred readouts (2026-11-27)

Dan, on `/hub/club-arena/stats`: "IT DOESN'T NEED TO SAY CASH INSIDE EACH BOX, AS
CASH GAMES IS ALREADY SELECTED AT THE TOP ... SAME THING WITH TOURNAMENTS ...
CHANGE BB/100 TO SAY BB/100 HANDS ... OPTIMIZE ANY AND ALL FRAMES, INCREASE FONT
SIZES AND REMOVE ANY AND ALL UNNECESSARY EXPLANATIONS (ADD A QUESTION MARK ICON)
IF ITS NEEDED. CENTER ANY AND ALL STATS INSIDE FRAMES AS WELL."

## Why the tag could go

The 2026-09-20 "Cash" tag on every StatRow existed because
`ca_player_stats_full` mixed cash-only money with all-hand rates in one payload.
The page now reads `ca_player_stats_overview_separated(_by_club)`, which filters
every hand with `(fact.tournament_id IS NULL) = (p_game_mode = 'cash')`. The
Cash Games / Tournaments switch is therefore the one true scope statement. The
`scope` prop is removed from `StatRow` (not hidden), and
`tests/components/stats-contract-truth.test.tsx` now pins both halves: the SQL
still separates the modes, and no box repeats the mode.

## What changed

- No "Cash" tag in any box; "Cash Hands" / "Cash Profit" / "Analysis Cash
  Result" read "Hands" / "Profit" / "Analysis Result".
- Tournaments: "Tournament Playing Statistics" / "Tournament Positions" /
  "Tournament Results" read "Playing Statistics" / "Positions" / "Results";
  "Review Hands", "Analyze Leaks"; the duplicate "Tournament Hands" row in
  Results is gone (Playing Statistics already shows Hands); the single-pill
  "Tournaments" section bar is not rendered when there is only one section.
- "BB/100" reads "BB/100 Hands" across the stats page and its panels.
- The mode notice, both tournament accounting notices, the ROI caption and the
  words "95% Confidence" moved behind the header's "?" (tutorial steps). The
  figures still say Estimated / Reconstructed in their labels.
- An unmeasured figure no longer repeats "Denominator Unavailable" under its
  own "Not Yet Measured".
- Every stat tile, headline box, Game Mix figure and Positions cell is centred;
  value and label sizes are larger; tournament stats use the same two-column
  tile grid as cash; a lone last tile spans the row; the Positions table fills
  its frame (club-engine.css made every table `display: block` below 640px).
