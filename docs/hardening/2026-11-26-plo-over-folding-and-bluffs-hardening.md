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

## P8: Heads-up flop over-folding to big bets came from a class cap, not the flop verdict

- **What broke:** heads-up on the PLO4 cash flop the Horses folded 72.9% to bets over 0.8 pot where people fold
  49.4% (plo4-audit, Nov 19 to 26). The first diagnosis blamed the flop verdict's stated bettor share
  (`omahaFlopFacingBetEv`). Checked before building: that option has been off since Nov 24 07:08Z, the audit split by
  its switch period gives 72.5% with it off and 73.4% with it on, and even an unblended people share inside it moves
  the replayed fold rate only from 71.3% to 70.3%. So no fix was built there. The replay of the 445 audited decisions
  puts 75 of 76 of these folds on the reference call-or-fold check (`v38_ev_fold`), with the V40 Omaha pressure cap
  (a fixed equity ceiling per made-hand class: one pair 0.28 plus 0.10 on the flop) cutting the equity in 53.
- **Root fix:** `omahaFlopPressureCapIsPriced` (default OFF). In exactly the spots the cap prices (heads-up flop,
  single bet), the call-or-fold check reads the equity against the bettor's range: the flop value region plus the
  people-only measured flop non-value share, moved by his own shown flop bets. It is a separate branch before the V40
  block. The block, and `v87DeepDiveDiscipline` inside it, run unchanged; only call vs fold can change.
- **Guards:** law anOmahaFlopPressureCapIsPriced (people-only fit filters, blend, record unit; on the audited decisions
  big people bets folded less, small bets not more, no raise added or removed; turn, river, raises, multiway, PLO6
  and tournaments identical; v87 on and off identical outside the scope and v87 receipts identical inside it; a
  source check that the branch sits before the V40 block and names nothing of v87). Cost law
  anOmahaFlopPressureCapPriceIsFast. The people fit's flop cells use their own random stream, so the turn and river
  cells it already served are byte-identical.
- **Lesson:** confirm which switch is live, and split the audit by the switch periods, before attributing a rate to
  an option.

## Release Discipline For All Of The Above

Every option ships default OFF with a flag-off check (0 differences), a shadow watch of at least 60 minutes
(breaker 0, errors 0, no decision over 50 ms), then a live switch. Fits use people only.
