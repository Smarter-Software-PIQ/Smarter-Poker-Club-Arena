# omahaMathCore: authority for the live switch

Lane MATHCORE, 2026-11-19 (lead session 01TLQer8). Default OFF (`opts.omahaMathCore === true`). The lead switches it with A/delivery/activate.sh; nobody else.

## What It Does

In PLO4 and PLO5 cash (table and Lightning; never PLO6, owner 8:26 PM: "DON'T TOUCH PLO6"), high only, one board, pot limit, every street, the decision is the expected-value maximum over every legal action: fold, check, call, bet or raise at several sizes on the table's chip unit (unopened: 1/3, 1/2, 2/3 and full pot; facing a wager or preflop: half and full pot raise), and all-in where legal.

- fold = 0; check = equity x pot (net of rake)
- call = equity x (pot + call) (net) - call; players still to act behind fold at their public rate, else continue with their strongest share and add their call
- wager = P(everyone folds) x pot (net) + P(called) x (equity against the continuing ranges x final pot (net) - chips added)

Equity is exact Omaha high (two hole plus three board), Monte Carlo to the river against one range per live opponent with card removal, standard-error target 0.01 (lane EQUITY's equityVsRanges; the core's own exact sampler when it declines). Ranges are built from public information only (lead ruling 2026-11-19): a wager of share s of the pot is value from the top of a pool of concrete holdings and bluffs from the bottom at the break-even share s/(1+2s); a caller is the band between his public raise and fold frequencies; a checker is below the wager region; a preflop raiser is the top share of his public raise frequency by position and level; a caller preflop the band between raise and raise + call. Fold equity is the public response frequency to a Horse wager by street, line, size and players (person rows shrunk to the population, k + 20 pop / (n + 20)); preflop the public fold facing a Horse open, 3-bet or 4-bet by position.

The decision the owner rules produced is never an input, prior or tie-break: it stands only when the core throws (receipt `omahaMathCore.error`).

## Wiring

- HorseLogic decideInternal, graph node `wager_rules`: the node's whole result passes through `omahaMathCoreRule` (outermost owner; only `timing` follows and never changes the action).
- ServerTableEngineTurns commit door: an applied core decision (`mathCoreOwned`) is not re-decided by the commit-door wager rules or the short all-in call floor.
- responseValidation `omahaMathCoreAdmits`: a changed `wager_rules` action is admitted only under the gate the worker may have run (`omahaMathCoreGate`: the request option, the delivered switch row or the previous row), in scope on the request, with the decision's own applied receipt naming exactly that action, and legal on the request. Without the admission a changed action would be refused and the client's liveness fallback would check or fold.

## Tables (Public Information Only)

`server/src/engine/omahaMathCore/publicTables.v3.json`: lane RANGES' measured-ranges-public-v3 (source sha256 3bdd8ce18147098f040f05480ef69ee0695f9b0d8c2d77fd0c00ed68c7dd4c42; PLO4/PLO5 cash with a person, Nov 1 to Nov 19 6:49 PM Chicago; person names removed, user ids only). Every cell carries its provenance: `public_actions` (responses to wagers, wager frequency by line, preflop action frequencies, fold facing a Horse raise, VPIP/PFR, per-user public rows) or `showdown_only` (the share of a line's wagers shown at showdown that were not value, `shownNonValue`, the estimator the lead chose). The earlier v1 table (sha256 54ab0460, built partly from cards never shown) is not shipped. A law test pins that every cell the core loads has provenance `public_actions` or `showdown_only`.

## Known Interim Items (Stated, Not Hidden)

- A wager's range: value from the top of the pool, non-value from the bottom at the measured `shownNonValue` share of that line and size (the break-even share s/(1+2s) only where no cell has 20 shown hands), at the line's measured wager frequency (`INTERIM_WAGER_FREQUENCY` = 0.5 only where no cell exists; named in the receipt).
- No public realization measurement exists yet: no realization factor is applied (receipt says so).
- Postflop ranges do not yet carry the preflop action forward (each street's range is built on that street's public line).

## Receipts

`decision.omahaMathCore`: switch, applied, the chosen action and amount, the incoming decision (record only), error, and the core receipt: version, table version, street, price, pot, to call, each opponent's range label with its table key and n, the EV, equity, standard error, fold probability and fold source of every priced action, the choice, samples and milliseconds.

## Tests

`server/src/engine/omahaMathCore/OmahaMathCore.test.ts`: evaluator parity with PokerEngine.evaluateOmahaHand; argmax law; never fold when the call EV exceeds its sampling error; set and aces spots; the #60156608-type 5-bet law (a raise only when its EV beats the call); determinism; latency inside the 2 s minimum deadline; table provenance; recorded flop spots through HorseLogic.decide (hands 59790514, 59829906, 59811519, 59833259, 59852600, 59840990, 59869211, 59802550, 59806482, 59833693, 59848622, 59831538) with the final action equal to the core's choice and the validator admitting it; the admission needs the gate; OFF byte-identical; exception keeps the incoming decision; out of scope unchanged.

## Evaluation

Exact replay over every PLO4/PLO5 cash decision of the 48-hour dataset (base vs ON) and the Horse-vs-Horse league are run by lane PROVE (S/emerg/PROVE); their numbers are the evidence for switching. Hidden cards are used there for offline grading only.
