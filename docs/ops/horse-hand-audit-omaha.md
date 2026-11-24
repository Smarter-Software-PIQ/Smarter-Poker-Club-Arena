# Horse hand audit (PLO4 / PLO5): every Horse decision in hands with people

`scripts/ops/horse-hand-audit-omaha.mjs` grades every decision a Horse (`profiles.is_horse = true`) made on every street of
every PLO4 and PLO5 cash hand that had a real person in it, and reports where the Horses lose and win chips against people.
It is read-only and meant to run daily.

```
node scripts/ops/horse-hand-audit-omaha.mjs                      # last 24 hours, people-only, markdown tables
node scripts/ops/horse-hand-audit-omaha.mjs --since 2026-11-23T06:00:00Z --until 2026-11-24T06:00:00Z --csv out/
node scripts/ops/horse-hand-audit-omaha.mjs --since ... --until ... --split-at 2026-11-24T07:08:52Z   # exit 1 if a leak got worse
node scripts/ops/horse-hand-audit-omaha.mjs --save-json rows.json   # then --from-json rows.json to re-grade offline
```

Flags: `--since/--until` (default the last 24 h, at most 8 days), `--games plo4,plo5`, `--people-only` (default) or `--all`,
`--split-at <ISO>`, `--min-hands <n>` (default 30), `--json`, `--csv <dir>` (decisions.csv, hands.csv, nodes.csv),
`--from-json <file>`, `--save-json <file>`, `--tables <file>`, `--sql`, `--supabase-workdir <dir>`.

Exit codes: **0** ok; **1** a HARD leak versus people (mistake type x street) is worse after `--split-at` than before
(at least 5 cases after, more than 5 bb/100 person-hands and 50% above the earlier window); **2** fewer hands than
`--min-hands`; **64** usage; **70** failure.

## Data and the shown-cards-only rule

- One SELECT per 6-hour chunk through `supabase db query --linked`, each behind `SET TRANSACTION READ ONLY` and a
  120 s statement timeout (the same route as `person-vs-horse-results.mjs`).
- **Hole cards leave the database only through the hand's showdown list**: the `hc` column is built by walking
  `hand_history.showdown` and reading `hole_cards -> user_id` only for entries whose `mucked` flag is false. Winner rows are
  selected without their hand cards. The parser checks the rule a second time (`shownCards`). A unit test fails the build if
  `hole_cards` is read anywhere else in the SQL or if a mucked player's cards are used.
- Consequence: a decision is graded exactly only when that Horse's cards were shown. Every fold, every uncontested bet and
  every mucked hand is graded at range level. No single fold can ever be called a mistake.
- Money per hand is recomputed from the action log (bet/raise/all-in are raise-to levels, calls and posts are increments,
  returns subtracted, antes dead, uncalled bets inferred and settled by pot_size). Never from `ca_hand_player_stat`.

## Tier A: exact (the Horse's cards were shown)

- Omaha-high evaluator (exactly two hole cards and three board cards), seeded Monte Carlo: a pool of random holdings per
  decision, each opponent's range a weighting of that pool, joint draws with card clashes redrawn, then a random runout.
- An opponent's range comes from his latest informative action: first wager (measured bettor table by game, street,
  line, size, heads-up/multiway), raise (raise cell), call of a first wager (caller table), call of a raise (his range
  truncated to the strongest share that continues against raises at the measured rate), no postflop action (a linear
  preflop width: the product of the measured frequencies of the preflop actions he took, ranked by a heuristic holding
  score). The measured tables are bundled (`horse-hand-audit-omaha-lib/range-tables.json`, version in the output).
- Options: fold = 0; call = R x equity x pot after call - call; check = R x equity x pot; bets of 33/66/100% pot and the
  size taken, pot raise and the raise taken = FE x pot + (1 - FE) x (R x equity when called x final pot - chips added).
  FE is the measured all-fold rate in the audited hands by game, street, size, heads-up/multiway and the field faced (a
  person among the responders or not, for grading only).
- Realisation R (assumed, one-street model): preflop 0.9 IP / 0.8 OOP, flop 1.0 / 0.9, turn 1.0 / 0.95, river 1.
- CORRECT when EV(best) - EV(taken) <= max(1 bb, 5% of the pot after the call); otherwise MISTAKE, cost = the gap.
- **HARD** mistakes lost against a passive or folding alternative (called too light, paid off, raise without price,
  non-nut turn/river raise, draw raised out of position, bluff without price, every preflop call/3-bet/4-bet/limp priced
  below fold or call) or are an in-position river check of a hand with at least 50% equity when called. **OPPORTUNITY**
  gaps (bets and raises not made) are an upper bound of the one-street model and are never added to chips lost.
- Hindsight equity against the opponents' actual shown hands is reported alongside, labelled hindsight.

## Tier B: range (cards not shown)

- Nodes: street x context (facing bet, facing raise, checked to or first) x position x size bucket x heads-up/multiway x
  facing a person or a Horse; preflop by raises faced.
- A node is never called an over-fold because its fold rate is above s/(1+s). Over-fold chips are estimated from what the
  bettors at that node actually hold when shown, measured in the window separately for person and Horse bettors (showdown
  bias corrected, shrunk toward the pooled table): the folded hands that would beat that range at the price. "Theoretical
  exploitability" (an any-two-cards bluff against the fold rate) is reported apart. No chip estimate on the flop (made-hand
  strength ignores draws); the turn estimate is rough.
- First-to-act nodes: bet frequency and how often a Horse bet took the pot at once against break-even.

## Tier C: results

Person and Horse net bb per hand, rake and BBJ, and the all-in luck adjustment where every live hand was shown and no one
acted after the last money went in before the river (exact runouts up to 1,200, else 1,500 seeded). Reported by person and
the person's preflop line, stake, day (America/Chicago), engine build and switch regime.

## Limits

Most Horse decisions are never shown; tier A is showdown-biased; preflop ranges are heuristic widths; the tables are refit
by `scripts/ops/omaha-facing-bet-range-fit.mjs` when it lands and the bundled copy should then follow it.
