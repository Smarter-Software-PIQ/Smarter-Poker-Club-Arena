# Horse no-limit hold'em opens are drawn from a band, not a min-raise

Dan, 2026-10-31: "WHY ARE ALL HORSES MIN RAISING WHEN THEY ARE OPENING...
OPENING RANGES SHOULD BE RANDOMLY DONE, MIN RAISE TO 2.5-4X OPENING RANGES.
NOT ALWAYS THE MINIMUM RAISE POSSIBLE".

## Evidence

Production, 40 minutes of horse non-all-in raise-first-in opens: cash 1,319
opens, 726 (55%) at 2.05bb or less, median 2.00bb, mean 2.27bb; tournaments
3,841 opens, 1,125 at 2.05bb or less and 1,230 more at 2.05-2.30bb.

Reproduced through `HorseLogic.decide` (169 hand classes, every first-in seat,
five styles, four seeds; tournament states carry the live M state so the
Phase 6 atlas runs). A policy-graph trace plus a spy on the sizer showed one
owner sizing every open in every context: the reference node,
`decidePreflopV7`'s unopened branch. No later node (variant policy, Phase 7
tournament utility, joint policy, corrective policy, wager rules, the
premium-aggression rule) changed a single open amount. Two defects:

1. The V28 ladder drew 2.2-3.0bb (2.05-2.40 with an ante, 2.0-2.4 at 25bb),
   took 0.15 off in late position and multiplied by a persona dial down to
   0.88, so many draws fell under 2bb and were clamped to a min-raise.
2. `legalize` floors wagers to whole chips when the big blind is a whole
   number, so at a 1-chip big blind every 2.00-2.99bb draw became 2bb.

## Change

Dan, 2026-11-01, from a real player's complaint: "THE HORSES ARE NOT RAISING
MUCH IN THE CASH GAMES, THEY ARE LITERALLY MIN RAISING IN A CASH GAME THAT
DOESN'T HAPPEN. THEY ALWAYS RAISE A LITTLE MORE IN CASH GAMES (REAL PLAYERS
THAT IS)." So cash and tournaments are sized differently.

`server/src/engine/HorseNlhOpenSize.ts` owns the no-limit open size, called
from `decidePreflopV7` (V74, `opts.v74NlhOpenSizes`, default on; the explicit
off arm keeps the V28 ladder only for the recorded corpora). Bands, in open
units before limpers:

| seat                                | cash 100bb | cash ante | tournament no ante | tournament ante | tournament 25-40bb |
| ----------------------------------- | ---------- | --------- | ------------------ | --------------- | ------------------ |
| early                               | 2.8-3.5    | 2.6-3.2   | 2.3-3.0            | 2.2-2.7         | 2.1-2.5            |
| middle                              | 2.7-3.3    | 2.5-3.0   | 2.2-2.8            | 2.1-2.6         | 2.0-2.5            |
| cutoff                              | 2.5-3.1    | 2.5-2.9   | 2.2-2.7            | 2.0-2.5         | 2.0-2.4            |
| button                              | 2.5-3.0    | 2.5-2.8   | 2.0-2.5            | 2.0-2.4         | 2.0-2.3            |
| small blind (or a blind over limps) | 3.0-3.5    | 2.8-3.3   | 2.5-3.2            | 2.3-3.0         | 2.2-2.8            |
| heads-up button                     | 2.5-3.0    | 2.5-2.8   | 2.0-2.5            | 2.0-2.3         | 2.0-2.3            |

- Cash is never under 2.5bb, at any depth, whatever the persona dial or the
  chip grid (the floor is the band floor, rounded up onto the grid). A full
  ring (8+ dealt) adds 0.25 to the early band, deep cash (above 150bb
  effective) adds 0.25 / 0.5, nothing exceeds 4x. Cash at 25bb or less opens
  2.5-2.8bb.
- Tournaments deeper than 25bb open an exact min-raise 20% of the time and
  otherwise draw from the band; 25bb or less opens 2.0-2.3bb (a hard
  ceiling), so an open never commits a short stack. Push/fold and the
  tournament shove discipline are untouched.
- Each limper adds one open unit (big blind, or the straddle).
- The persona dial bends the draw inside the band (u^(1/dial)), never out.
- The draw consumes exactly three random values and never reads the cards.
- On a whole-chip grid the draw is rounded stochastically to a neighbouring
  chip, never below the band floor.

Untouched: pot-limit opens (the pot, Dan 2026-09-03), fixed limit, 3-bet and
4-bet sizes, the legacy v7-off ablation route, and
`HorseHoldemPremiumAggression` (its rule 2 only converts a passive premium
action, so it never resizes an open; its 3bb-plus-limpers conversion of a
passive premium over limpers is a fixed size other agents own).

Historical corpora (`HorseOpponentExploitNeutrality`, the V53 Omaha pressure
digests) run with `v74NlhOpenSizes: false`, like every later independent
policy. The Phase 6C replay fixture `e509c261e058` (a recorded 3-handed
button min-raise open, 100 at a 50 big blind) now replays as a deliberate
`diverged` on the size only; its inputs, route and atlas cell still agree.

## Before and after (through HorseLogic.decide)

169 hand classes, every first-in seat, five styles, four seeds; tournament
states carry the live M state.

| context                     | exact 2.00bb before | after | median before | after | mean before | after |
| --------------------------- | ------------------- | ----- | ------------- | ----- | ----------- | ----- |
| cash 6-max 100bb, 1-chip bb | 86.8%               | 0.0%  | 2.00          | 3.00  | 2.13        | 3.08  |
| cash 6-max 100bb, 2-chip bb | 39.4%               | 0.0%  | 2.50          | 3.00  | 2.37        | 2.97  |
| cash 6-max 100bb, 0.10 bb   | 6.6%                | 0.0%  | 2.60          | 3.00  | 2.57        | 2.94  |
| cash 9-max 100bb, 0.10 bb   | 7.4%                | 0.0%  | 2.60          | 3.00  | 2.58        | 3.03  |
| cash 6-max 200bb            | 0.1%                | 0.0%  | 2.80          | 3.40  | 2.77        | 3.31  |
| cash 6-max 20bb             | 54.5%               | 0.0%  | 2.00          | 2.60  | 2.11        | 2.63  |
| cash heads-up 100bb         | 5.0%                | 0.0%  | 2.50          | 2.80  | 2.51        | 2.74  |
| MTT 9-max 60bb, ante        | 30.0%               | 17.6% | 2.13          | 2.33  | 2.17        | 2.36  |
| MTT 9-max 60bb, no ante     | 3.5%                | 17.4% | 2.61          | 2.44  | 2.63        | 2.48  |
| MTT 9-max 30bb, ante        | 29.7%               | 17.6% | 2.13          | 2.18  | 2.18        | 2.23  |
| MTT 6-max 24bb, ante        | 34.5%               | 1.3%  | 2.09          | 2.12  | 2.15        | 2.13  |

Cash minimum after: 2.5bb in every context (3 chips at a 1-chip big blind).
Seat means after, cash 6-max 100bb at 0.10: UTG 3.11, HJ 2.98, CO 2.72,
BTN 2.78, SB 3.17. (The harness seeded each hand from the first letter of
its class, so ace and king hands shared random streams; that is why the
tournament exact-min share in the table reads 17.6%. Re-seeded from the whole
class, nine-handed 60bb ante tournaments open an exact min-raise 20.0% of the
time overall, 20.2% with QQ+/AK/AQs/JJ and 20.0% with every other hand; 100bb
no-ante 20.2% / 19.9%.)

Pinned by `server/src/engine/HorseNlhOpenSize.law.test.ts`.
