# PLO4/PLO5 Cash Over-Folding And Bluff Hardening (2026-11-26)

Each item below records what broke, why it kept breaking, the root fix, and the guard that stops it returning.
Scope: PLO4 and PLO5 cash, heads-up facing a bet and opening bets on the turn and river. PLO6 and Omaha
tournaments are untouched.

## P1: Horses over-folded facing turn and river bets (claimed fixed several times, kept returning)

- **What broke:** heads-up facing a turn or river bet, Horses folded far more often than a person's bets justify.
  WooWoo's semi-bluffs with blockers took small pots repeatedly.
- **Why it kept returning:**
  1. The non-value share the price used (`OMAHA_EV_PRIOR_BLUFF`) was fitted once on 41 to 179 hands, and later
     re-fits ran on tables that are 99.5% Horse. Horses bet tighter than people, so each re-fit pushed the share
     back down and the folds came back.
  2. The river model had a value region and a weakest-half bluff pool but no middle band, so the many people's
     bets that are neither nuts nor air were priced as hands the Horse loses to.
  3. Grading ran against Horse opponents, so a correct fix looked like a loss and was rolled back.
  4. Fixes sat in branches while cutovers failed, so "fixed" was never live.
- **Root fix:** `omahaFacingBetPriorIsPeopleMeasured` (HorseOmahaFacingBetPeoplePrior.ts): the share is fitted
  ONLY on people's bets that people answered and that were shown at showdown (no HUD rows, no unshown cards),
  blended to the balanced share by 30 pseudo-bets on thin cells, with three measured river regions
  (core, middle, bottom). The bettor's own shown record moves it.
- **Guards:**
  - Law `anOmahaFacingBetPriorIsPeopleMeasured` fails if the fit admits a Horse bet or answer, an unshown card,
    or if a bottom-only hand calls below the balanced share.
  - Law `anOmahaEquilibriumAnchorIsFast` holds the decision under its time budget.
  - Daily over-fold alarm (people-only fold rate against the measured break-even) so a regression is caught the
    next day, not by WooWoo.
  - The option reads only generated data from the people-only fit script; there is no hand-edited constant to drift.

## P2: The bettor's record moved the prior in the wrong unit (independent review)

- **What broke:** the per-opponent record counts a shown bet as value when it beats 80% of holdings; the prior
  it moved counts value as the price's value region. A bettor whose record matched people exactly still moved
  the share.
- **Root fix:** the fit emits `nonTop20` (people's share of shown bets not beating 80% of holdings) per cell; the
  record's Beta-binomial not-value rate over people's rate in that same unit multiplies the share and the river's
  non-core share.
- **Guard:** law case "a same-rate record leaves the share where people put it".

## P3: Three-region count computed eagerly on six-card hands (independent review)

- **What broke:** the river region split was an eager getter, so a PLO6 count paid for a computation outside the
  option's scope.
- **Root fix:** `regionsOf()` is a lazy method called only when the option prices three regions.
- **Guard:** law case "the three-region count is lazy".

## P4: Empty middle band priced as losses

- **What broke:** on boards where the value region reaches the weakest pool, the measured middle share had no
  holdings and was priced at zero equity.
- **Root fix:** an empty middle is priced with the value region (the conservative side).
- **Guard:** `middleEmpty` is part of the region result and the verdict branches on it explicitly.

## P5: The blocker river bluff was unreachable

- **What broke:** river opening bluffs with blockers were priced at the equilibrium fold rate, at which a blocker
  bluff never beats checking, so Horses never bluffed the river.
- **Root fix:** `omahaRiverBetFoldIsPeopleMeasured` prices fold equity from people's measured fold curve
  (HorseOmahaPeopleFoldTables.json), shrunk toward that curve by the opponent's own record; the blocker bluff is
  placed on every size it beats checking.
- **Guards:** `HorseOmahaRiverOpeningBet.realHands` law (bets placed, wrong bets bounded), PLO5 calling-station
  probe (a station must not profit from the bluff line).

## P6: Turn semi-bluff with zero equity

- **What broke:** a turn semi-bluff could pass with no called equity.
- **Root fix:** a semi-bluff requires its called value to reach checking and its price share
  (`OMAHA_TURN_SEMI_BLUFF_PRICE_SHARE`).
- **Guard:** law `anOmahaOpeningBluffIsPricedOnPeople`.

## P7: Two green PRs crossed and turned main red

- **What broke:** the option cost gate (#12112) and the people prior option (#12116) were each green on their own
  base and merged 14 minutes apart; neither CI run had seen the other, so main failed
  aPricedOptionProvesItsDecisionCost. A merge-job check also counted the window keeper job (which runs for the
  whole window) as a failing check, so migration PRs could never merge in the window.
- **Root fix:** #12151 gave the option its cost law; the bluff options got theirs (turn and river cost laws, one
  reasoned exemption), and the gate's self-test no longer assumes the exemption table is empty.
- **Guards:** lead-7's merge job runs the option gate laws (cost, shadow stage, replay record, switch lists,
  ledger, SecondLookIsNotLive) on current main merged with the PR head whenever main gained law, CI or option
  registry files after the PR's base, and skips the merge if they fail. The keeper job is excluded from the
  non-green count.

## Release Discipline For All Of The Above

Every option ships default OFF with a flag-off check (0 differences), a shadow watch of at least 60 minutes
(breaker 0, errors 0, no decision over 50 ms), then a live switch. Fits use people only.

## P10: The over-fold alarm watched six cells; the measured over-folds were in cells nobody watched

- **What broke:** the daily alarm of P1 counted only PLO heads-up turn and river. Measured on public actions,
  PLO5 cash, Nov 19 to 27, Horses against people: heads-up flop fold to a bet 51.0% (1,717) against 31.9% (1,443),
  to large bets 62.7% against 44.8%; multiway turn 76.6% (572) against 47.7% (199); multiway flop 66.0% (1,038)
  against 47.8% (318); PLO4 the same pattern. Hold'em had no over-fold alarm at all. Any of these could be fixed
  and come back without a line in the daily summary.
- **Why it kept returning:** an alarm scoped to the cell of the fix that was being built watches the fix, not the
  leak. And the alarm could not tell "this cell is over-folding because its fix is still OFF" from "this cell is
  over-folding although its fix is ON", so a real regression read like yesterday's known finding.
- **Root fix (scripts only, no decision code):** `scripts/ops/horse-plo-overfold-gate*.mjs` now has 120 cells: PLO5
  cash, PLO4 cash, the two pooled, Hold'em cash, Hold'em tournaments x flop / turn / river x heads-up / multiway x
  three bet sizes and an all-sizes row. Each cell's ceiling is, in order and named in the row: the people prior
  table's cell (heads-up its bluff share as a price, multiway its measured people fold share); else people's own
  fold rate in the cell over the trailing 14 days with its sample (people only, no HUD row); else minimum defence
  (s/(1+s) heads-up, (s/(1+s))^(1/k) for each of k players left multiway). Tested on the range and on the range
  pooled with the 3 days before, against one multiple-comparison-corrected bar.
- **Multiway is gated on fold-through, not on a people fold rate:** people over-call multiway (the Horse multiway
  turn calls today's engine folds lost 4.2 bb each over 31 days), so a multiway people fold rate is shown as
  information only. The gate is the fold-through of a person's first bet into Horses (everyone folds) against the
  pure-bluff break-even s/(1+s), by game, street, 3-way / 4-way+ and size, over 7 days. It is also shown beside every
  heads-up cell.
- **The regression signal:** `scripts/ops/horse-overfold-owner-map.json` names the option that owns each cell; the
  alarm reads that option's live state. A cell over its ceiling WITH ITS FIX ON for the whole tested window is
  breach-class: first in the alarm, first under Regressions in the daily summary, and never folded into the
  earlier fix-OFF finding as a repeat.
- **Guards:**
  - Law `anOverFoldAlarmWatchesEveryCell`: the owner map names only registered options (or awaited with a pull
    request), one owner per cell; the alarm keeps every cell, the three ceilings in order, and only reads.
  - `tests/unit/horsePloOverfoldGate.test.ts`: a synthetic over-fold fires in every cell under each of the three
    ceilings and every cell is quiet at its ceiling; a leak spread thin over three sizes fires on the all-sizes
    row; fix ON, ON for part of the window, OFF and no owner are told apart.
- **Honest limit:** an alarm is not a fix. A lower people fold rate is not proof that a Horse fold loses chips;
  the options named in the owner map carry their own chips grades.
