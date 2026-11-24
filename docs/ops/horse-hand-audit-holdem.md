# Horse hand audit, No-Limit Hold'em (daily, read-only)

`node scripts/ops/horse-hand-audit-holdem.mjs` grades every decision the Horses (profiles.is_horse = true) made in
No-Limit Hold'em hands that had a person in them, cash and tournaments (MTT, all-in-or-fold MTT, SNG, Spin,
heads-up SNG) reported apart. Short Deck, Pineapple, Omaha and fixed-limit are out of scope (game_variant = 'nlh'
only; bomb pots excluded).

Libraries: `horse-hand-audit-holdem-lib.mjs` (SQL, replay, range model, grading, nodes),
`horse-hand-audit-holdem-eval.mjs` (cards, 7-card evaluator, exact equity, weighted ranges),
`horse-hand-audit-holdem-report.mjs` (summary, Markdown, CSV, window comparison). Tests:
`tests/unit/horseHandAuditHoldem.test.ts`.

## Usage

```
node scripts/ops/horse-hand-audit-holdem.mjs                      # last 24 h, cash and tournaments
node scripts/ops/horse-hand-audit-holdem.mjs --mode cash --csv out/ --json
node scripts/ops/horse-hand-audit-holdem.mjs --since 2026-11-20T06:00:00Z --split-at 2026-11-24T06:07:29Z
node scripts/ops/horse-hand-audit-holdem.mjs --save-json raw.json ; ... --from-json raw.json
```

Flags: `--since/--until` (default the last 24 hours), `--mode cash|tournament|all`, `--people-only` (default) or
`--all` (Horse-only tables too), `--split-at` (compare after against before; default: against the same length of time
immediately before `--since`), `--json`, `--csv <dir>` (decisions.csv, hands.csv), `--from-json`, `--save-json`.

Exit codes: 0 clean; 1 a leak node is measurably worse than in the comparison window (same node, at least 30 spots
each side, two-proportion z of at least 2 in the leaking direction); 2 fewer than 50 person-hands in the range;
64 wrong argument; 70 failed read.

## Security and the shown-cards rule

- Every statement is one `WITH ... SELECT` (checked by `assertReadOnlySql`), sent behind
  `SET TRANSACTION READ ONLY; SET LOCAL statement_timeout = '60s';`, through `supabase db query --linked`, one
  six-hour chunk at a time. Nothing is written.
- Hole cards are read ONLY through the showdown list: `hole_cards -> (s->>'user_id')` for showdown seats whose
  `mucked` is the literal `false`. The SQL never selects `players[].cards`, `winners[].hand` or `summary`, and never
  iterates `hole_cards` itself. A unit test fails the build if that changes. Unshown cards (folded hands, mucked
  hands, uncalled bets) are never read for people or for Horses.
- Consequence: a decision can be graded exactly only when the cards it needs were shown; everything else is graded at
  range level, by node.

## Method

### Replay

Each hand is replayed from `hand_history.actions`; every decision row carries a `publicNode` snapshot taken before the
action (pot including all chips wagered, toCall, currentBet, per seat stack and street bet). Amounts: call = increment,
bet = size, raise and all_in = "raise to" street total (an all_in is a call when it does not exceed currentBet).
Net per seat = winners + returns - every chip put in (blinds, antes, increments). Hands whose chips do not balance
(invested - returned - winners - rake) are counted in the output's conservation check.

### A. Exact tier (Horse cards shown)

For each decision of a Horse whose cards were shown:

1. Opponent ranges are built from public actions only, street by street, starting from all 1,326 combos:
   - preflop: a raise keeps the top r of the current range, a call the band [r, r + c], a check all but the top r, where
     r and c are the measured raise and call shares at that node (unopened / vs limp / vs open / vs 3-bet / vs 4-bet+ /
     vs jam) by position group and, in tournaments, stack bucket (<12, 12-25, 25+ bb), from the window's own decisions;
     order by preflop strength (class equity against a random hand);
   - postflop: strength = mean percentile against all live combos over every runout (exact enumeration); a bet keeps the
     top q(1 - beta) and the bottom q _ beta, a check keeps the rest; facing a bet a call keeps the band
     [rho(1 - beta), 1 - f - rho _ beta] and a raise the top rho(1 - beta) plus the bluff band just above the fold line;
     q = fitted bet share, f = fitted fold prior (heads-up: HorseHoldemLateStreetPriors 2026-11-24.v3 by street, line and
     size; multiway: measured), rho = measured raise share, beta = the MEASURED bluff share of wagers for that format,
     bettor kind (people and Horses measured apart, for measurement only), street, line and size, from wagers shown at
     showdown (a shown wager is a bluff when the bettor's made-hand class has no showdown value; on flop and turn draws
     without a pair count), each level shrunk 10 spots toward the level above and the top toward s/(1+2s).
2. Equity: postflop, exact enumeration of every runout against every combo of each live opponent's range; preflop, a
   169 x 169 class matrix (Monte Carlo, 1,500 boards per pair, fixed seed, cached in the OS temp folder). Multiway
   equity = product of the heads-up equities (independence approximation).
3. Pricing, in chips relative to folding now (fold = 0):
   - check = R x eq x pot; call = R x eq x (pot + call) - call;
   - bet or raise to T = sum over which opponents continue of P(that set) x [nobody: pot; else
     R x prod(eq vs the continuing top 1 - f of each range) x (pot + risk + their calls) - risk], f = fitted fold prior
     (heads-up postflop), fold-to-raise prior, or the measured fold share at the node created (preflop, multiway);
   - R = 1 on the river or when no more betting is possible, else 0.92 in position / 0.85 out of position on the flop
     and turn, 0.90 / 0.80 preflop;
   - sizes priced: the size taken, 1/3, 2/3 and pot (unopened postflop), 3x (raises), 2.5 bb opens, 3x re-raises, and
     a jam at 25 bb or less; preflop raises above 60% of the stack are treated as a jam.
     Tournaments are priced in chips; a decision whose snapshot shows bubble pressure (near bubble or hand-for-hand, not
     in the money) or a final table carries "chip-EV may mislead" in decisions.csv.
4. Grade: CORRECT when EV(best) - EV(taken) <= max(0.5 bb, 5% of the pot); when both are wagers of different size,
   max(1 bb, 15% of the pot). Otherwise MISTAKE with cost = EV(best) - EV(taken) in bb, typed (called too light,
   folded too strong, bluff-raised turn or river without value, raised a draw out of position, random or unpriced
   bluff, missed value bet, bet into a stronger range (thin value), bet size wrong for the range, paid off a
   value-only line, stacked off with one pair deep, slow-play gave a free card, missed profitable bluff, preflop:
   3-bet that folds to a 4-bet, call of 3-bet or 4-bet out of position, loose cold-call, over-fold of blinds to a
   steal, short-stack push/fold error (chip-EV against measured ranges), fold to a non-all-in raise at a short stack).
   A correct decision's gain = EV(taken) - EV(fold or check), when positive.
5. Hindsight (labelled, never mixed in): the same pricing against the opponents' SHOWN cards (exact enumeration).

### B. Range tier (cards not shown)

Every Horse decision is counted in its node: format class x street x node x line x position x size bucket x
heads-up/multiway x stack bucket x the kind of the last bettor (person or Horse). Two costs are kept apart:

- THEORETICAL exploitability: facing a wager, fold f against the bluffer's break-even be = toCall / pot; when the
  95% interval of f lies above be + 0.02, a pure bluff takes pot x (f - be) per spot.
- ACTUAL cost against the bettors as they really bet (this one ranks the leaks): with the bettors' measured bluff
  share beta for that line and size, a bluff-catcher's call is worth EVbc = beta x (pot + toCall) - toCall.
  Folds beyond be cost (f - be) x EVbc only when EVbc > 0 (an over-fold against bettors who really bluff). When
  EVbc < 0 the calls are below the price and cost kappa x (-EVbc) per call, kappa = the share of shown calls on that
  street the exact tier graded called-too-light or paid-off. Preflop: the value the folded part of the range
  (weakest f of the line range) would have won by calling against the raiser's line range.
- Horse wagers: success w (everyone folded) against s/(1+s); "over-bluff" when the interval lies below, charged on the
  measured Horse bluff share; "bets print" (a strength) when above.
  A node needs 15 spots. Each unshown decision carries its node's verdict and its share of the node's cost.

### C. Results tier

Per hand: each person's net bb, the Horses' net bb, and, when every live hand was shown and no more betting was
possible, the all-in adjustment (each pot re-split by exact equity at the moment the money went in, scaled to the
pot after rake). Tournaments: chips in big blinds, plus people's entries, cashes, wins and finishing percentile from
tournament_players (prizes are chips or Diamonds, not money).

### Outputs

Coverage (hands, decisions per tier and format, per day, per person); per street and action: correct / mistakes /
bb lost / bb won (exact), leak-node decisions and estimated bb (range, actual and theoretical); the ranked leak list
versus people (actual chips) with example hands; theoretical exploitability beside actual cost; what the Horses do
well; results by format, stake, day, regime (switch events) and engine build; by person.

### Limits

Exact grades depend on the range model (measured frequencies, fitted priors, measured bluff shares) and on a fixed
realisation factor; selection: shown hands are hands that reached showdown. Range-tier costs are estimates. The
multiway equity product and the single-street look-ahead are approximations. Nothing here keys on whether an opponent
is a person or a Horse except the measurement split of bluff shares and the "versus people" filter of the report.
