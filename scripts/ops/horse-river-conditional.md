# Conditional Omaha river comparison

`horse_river_conditional.py` compares check-through with a finite legal bet menu under explicitly declared full opponent holdings and size-specific fold/call responses. It is offline arithmetic, not a solver, historical qualification, or runtime policy. It never invents ranges or response frequencies. All monetary numbers are integer chip units; output includes exact rational values and approximate JSON numbers.

Only heads-up, two-dealt-seat, single-board, closing-action river, high-only PLO4/5/6 cash is supported. No rake, fees, antes, dead chips, side pots, outstanding bet, bomb pot or all-in-or-fold structure. Nonzero raise probability is refused because continuation is unpriced. Tied odd pots require an odd-chip ownership model and are refused. Calling a bet beyond the opponent stack returns excess. Context assertions are validated for supported values, not independently authenticated.

Use a private SSD evidence directory (mode 0700) and a private regular input JSON file (mode 0600 or stricter). The CLI refuses symlink inputs, exposed permissions, inputs above 16 MiB, exposed output directories and existing output files. Neither cards nor assumptions are printed. The output input digest binds the complete declared request.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/ops/horse_river_conditional.py \
  --input /Volumes/SmarterArchives/agent-evidence/extreme-archive/YOUR-TASK/private/request.json \
  --output /Volumes/SmarterArchives/agent-evidence/extreme-archive/YOUR-TASK/private/result.json
```

Example input below is a synthetic assumption, not a historical opponent's private cards or a calibrated range:

```json
{
  "context": {
    "mode": "cash",
    "street": "river",
    "structure": "pot_limit",
    "boardCount": 1,
    "playersInHand": 2,
    "dealtCount": 2,
    "closingAction": true,
    "toCallUnits": 0,
    "rakeUnits": 0,
    "feesUnits": 0,
    "anteUnits": 0,
    "deadUnits": 0,
    "sidePots": false,
    "bombPot": false,
    "allInOrFold": false
  },
  "variant": "plo4",
  "hero": ["9c", "9d", "5s", "6s"],
  "board": ["Qh", "Qd", "2c", "3s", "9h"],
  "potUnits": 100,
  "heroStackUnits": 200,
  "opponentStackUnits": 200,
  "minimumBetUnits": 2,
  "betSizesUnits": [50],
  "range": [
    {
      "cards": ["Qc", "Qs", "Ac", "Kd"],
      "weight": 1,
      "responses": { "50": { "fold": 0.2, "call": 0.8, "raise": 0 } }
    }
  ]
}
```

In this deliberately synthetic losing-full-house versus quads example, check-through EV is zero and bet EV is -20 units. Changing the declared response to fold 0.4 / call 0.6 changes bet EV to +10. These assumed fold rates are not credible evidence that quads folds; the example illustrates sensitivity and why the response model must be justified. Use separate private requests/output paths for each scenario. Even a positive result remains conditional; it does not establish optimal real play.

Each range row requires the complete 4/5/6-card holding, positive weight, and one response distribution per bet size. Duplicate holdings and blocked cards are refused. Weights are normalized; probabilities must sum exactly to one as decimal rationals. Tiny decimal summation discrepancies are refused rather than silently normalized. A finite supplied range is an assumption about support, not proof of complete opponent coverage.

Focused validation:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/ops -p test_horse_river_conditional.py -v
```

The maintained Horse study test wrapper also discovers this Python test. Tests cover manually known showdown/economic cases, weighted ranges, response sensitivity, size/card/context refusals, short calls and private CLI behavior. They do not independently qualify the underlying evaluator, calibrate a response model or authorize activation. Every output retains `qualified`, `gtoVerified` and `activationAllowed` as false.

## Captured chip-rake comparison

The optional `costModel: "captured-chip-rake-v1"` binds `capturedOriginal.informationSet`
to its exact `informationSha256`, and requires `capturedDeductions` to equal the
original node's captured deduction configuration. Omit `context.rakeUnits` in this
mode: rake depends on each terminal pot, not a single constant. All other original
scope restrictions remain. Only two dealt, active seats, equal original investments,
zero ante/dead chips, a checked-to button on the river, chips with 0.01 units,
and high-only PLO4/5/6 are supported. BBJ collection must be inapplicable.

The finite terminal bridge uses the repository's installed root `esbuild` in memory
(no output bundle/cache), and calls `prepareJointPots`, `settleJointScores`, and
`applyJointDeductions`. It retains their uncalled refunds, heads-up rake-rate ceiling,
player-count cap, gross-pot odd-cent allocation, and subsequent single-board rake
scaling. It does not replace these with a split of the net pot. Source-file hashes,
original information hash, deductions and every terminal price are returned.

Only public amounts, seats and deduction rules enter that bridge. Full hypothetical
holdings remain in the independent Python Omaha evaluator. A hash validates supplied
bytes, not authenticity; `originalRuntimeAuthenticated`, `qualified`, `gtoVerified`
and `activationAllowed` stay false. Explicit range weights and size-specific responses
remain assumptions. Raises, facing bets, tournament utility, split-low, multiway,
antes/dead money and omitted original context remain refused.

For a captured Lightning cash river, select `costModel: "captured-lightning-bb-ante-v1"`. Supply the study decision's original `domain` and `ruleContext` inside `capturedOriginal` alongside its information set and hash. Set `context.dealtCount` to the original number dealt and `anteUnits` and `deadUnits` to the posted BB ante in cents. As with captured chip rake, omit `rakeUnits` and supply the captured deduction rules. The scorer checks the forced BB and dead ante against the contributing seat, preserves folded investments, requires exactly two live river players and a preceding check to the closing actor, and applies fees for the original number dealt. Other dead contributions, unresolved side-pot eligibility, and unpriced raises are refused. Opportunity-specific conditional results do not qualify a Lightning pack.

For high-only Omaha, an optional integer `observedWagerUnits` selects the recorded wager from the priced menu (zero for a check). The result gives the best priced alternatives and their expected advantage over that wager under the supplied range and size-specific responses. With captured costs, it also gives conservative outer bounds across fold/call responses using the same showdown class for each alternative. The observed size is caller supplied. Use an original action receipt to establish which size the Horse played. An upper bound measures uncertainty and cannot be booked as a loss.
