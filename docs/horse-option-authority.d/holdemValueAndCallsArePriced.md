# holdemValueAndCallsArePriced: authority for the live switch

**State: OFF in source (read `=== true`), no switch row, unevaluated. Evidence NOT MET: no league and no replay of audited decisions has been run. Do not switch on.** Mechanism, scope, receipts, tests and off-identity are met.

Owner orders it rests on: 2026-11-17 11:49 America/Chicago (verbatim): "a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."; and of the same day, the size of a bet may only feed the range and the price. Built by the NLH price lane (builder D-FIX of the HORSE DECISIONS lane, lead session_01TLQer7J) on 2026-11-19 from Auditor D's report (hvh48-audit-01TLQer7J/D-nlh-cash/REPORT.md: 399 NLH cash hands with people, 3,891 Horse decisions, 2026-11-18/19).

## The defects it repairs (HorseLogic.ts, decidePostflop)

1. The value raise facing a wager was a random draw: `originalValueRaise = fastRandom() < 0.55 x aggression + checkRaiseFreq (+ an out-of-position boost)`, else a call, at a random size `0.7 + fastRandom() x 0.4` of (pot + call). The audit counted 27 monster flat calls (348 bb), among them 77 on 2h4s4d7h and JJ on 2cJh3h.
2. A strong made hand without the lead checked at the V11 initiative gate, at random under the slowplay mix (`params.slowplayFreq`, 0.10 to 0.32, up to 0.6 under `trapMultiplier`), and checked back in position as the aggressor (about 300 bb).
3. A call facing a wager was priced against a preflop band with respect multipliers, not against the range that made the wager (about 340 bb).
4. River thin bets and the 0.28-0.32 pot block bet (`v86_river_block_trap`) were made with no comparison against the check (164 bb).

## What it does

No-limit hold'em cash (`gameVariant` nlh, not a tournament, not short deck, not fixed limit, no bomb pot, not all-in-or-fold, one board), table and Lightning (a Lightning pool is in scope; nothing reads `publicMemoryDomain`), postflop, exactly one live opponent. Tournaments are out (another builder owns them). With more than one live opponent the decision is kept (receipt `holdem_priced_unpriced_multiway`).

The decision `decidePostflop` returns is priced inside the reference (`HorseLogic.holdemPricedReference`, before the maniac call-down and every later owner) by `server/src/engine/HorseHoldemValueAndCallsArePriced.ts`:

- **His line range.** Every two-card combination the dead cards allow, kept where its preflop score lies inside his band (`HorseMind.bandFor` on the preflop history: the engine's own range read; every combination when there is no band), then re-weighted street by street on the board of that street: a wager keeps his strongest `b (1 - beta)` and weakest `b x beta` (a raise half of each), a call keeps his strongest `(1 - f)`, a street of checks only is weighted by `HorseActionLinePosterior`'s move over that street for the combination's bucket. `b` is his measured share of spots checked to him that he bets, `f` his fold at the price he was laid (below), `beta` on the river the share that leaves a call of his wager indifferent, `s / (pot + 2s)` (his size feeds his range and nothing else), on the flop and turn the posterior's bluff share for his line. The order of strength is the posterior's bucket on that board (made above the board: trips or better, two pair with both cards; top pair or an overpair; a flush draw or an open-ended straight draw; a weaker pair or a gutshot; air) and then the made score; it is never read off the Horse's own cards.
- **Equity.** The Horse's equity against each combination: exact on the river; 12 sampled rivers on the turn, 8 sampled runouts on the flop, drawn by a private generator (mulberry32) seeded by the Horse's cards, the board and the pot. Nothing draws from `fastRandom`.
- **His response.** His fold at the price a wager lays him, `risk / (risk + pot)`, is his measured fold to a bet (`HorseOpponentExploit.statRead` posterior on his decayed counters, centred on the measured population cell `OPPONENT_EXPLOIT_ENVELOPE`, horse-population-2026-10-16) carried along the minimum-defence line from the price at which it was measured, `HOLDEM_PRICED_REFERENCE_PRICE = 0.337` (the mean price of the Horses' 334 postflop bets in Auditor D's slice), capped at 0.95 and never above the weak part of his range (a weaker pair or a gutshot, or air: he never folds top pair, a strong draw or better). The part of his range that continues is its strongest `(1 - f)`.
- **Values** (chips, counted from the decision; R realizes equity: 1 on the river and in position, 0.88 out of position on the flop and turn, the audit's stated figure):
  - fold 0; call `R eq (pot + c) - c`;
  - raise to T, or bet: `f pot + (1 - f) (R eq_cont (pot + a + d) - a)`, a the chips the Horse adds that he can match, d his call;
  - check: in position or after his action, `R eq pot`; out of position with him to act, `(1 - b) R eq_checkback pot + b max(0, call his bet, raise his bet)`, his bet at the measured mean size (price 0.337), made with his strongest `b (1 - beta)` and weakest `b x beta`.
  - Sizes priced: bets of 0.33, 0.5, 0.75 and 1 pot; raises to the wager plus 0.5, 0.75 and 1 of (pot + call); all in when within 1.5 such pots; each legalized by the engine's own `legalize` before it is priced, and made at exactly that legal amount.
- **The choice.** Facing a wager: the brain's fold, call or value raise becomes the option of highest value among fold, call and each value raise. A raise is priced only for a made hand whose equity against the part of his range that continues is above one half (a value raise); a raise the brain made without a made hand (a bluff raise) is kept (`holdem_priced_bluff_raise_kept`). The random value-raise gate is not drawn: in scope it returns the call for the priced reference to compare with every legal raise (`holdem_priced_value_raise_deferred`). Not facing a wager: a made hand's check or bet becomes the option of highest value among the check and each legal bet; on the flop and turn only when its equity against his line range is at least one half (`holdem_priced_not_value_kept` otherwise); on the river every made hand. A bet without a made hand (a bluff) is kept. A tie keeps the passive option.

Off (absent, false or a truthy non-boolean): `holdemPricedOpponent` answers 'out' before anything is read and the wrapper is not called; every decision is byte-identical (law test).

## Receipts

`holdem_priced_value_raise_deferred`, `holdem_priced_raise`, `holdem_priced_call`, `holdem_priced_fold`, `holdem_priced_bet`, `holdem_priced_check`, `holdem_priced_changed`, `holdem_priced_unpriced`, `holdem_priced_unpriced_multiway`, `holdem_priced_bluff_raise_kept`, `holdem_priced_not_value_kept` (all registered in HorseDataLedger.ts).

## Tests

`server/src/engine/HoldemValueAndCallsArePriced.law.test.ts` (registered in docs/laws.d), on 27 decisions rebuilt from the audit's flagged hands (`HoldemValueAndCallsArePriced.fixture.json`: the public node, the public line and the deciding Horse's own cards only; ids replaced), replayed with the production option set of 2026-11-19 and the live cash profile:

- off, false and a truthy non-boolean give identical replays on every fixture and every base profile;
- red off, green on: on each fixture the audit and this pricing agree on, the flagged action is taken on some seed with the option off and the audit's action class on every seed with it on (value raises: 77 on 2h4s4d7h, JJ on 2cJh3h, J3 trips; strong-hand checks that bet: 77 on 2h4s4d7h, JJ on Js3d9h, J3 trips in position, the turn nut flush, A9 two pair, Q9 straight; the river call of JQ that folded; three river thin or blocker bets that check; the A4 thin bet and the Q9 underbet agree but the off line does not reproduce them on these seeds);
- the fixtures where this pricing disagrees with the audit are pinned to the priced action, deterministic on every seed (see "Disagreements");
- more than one opponent, a tournament: the decision is unchanged; a Lightning pool is priced;
- no value-raise decision reads `fastRandom` with the option on: the pricing module never calls it (counted under a module mock), the deferral returns before the random gate in the source, and every value-raise fixture gives the same decision on every seed;
- the closed forms: the call and raise values, the fold capped by the weak part of the range, a raise only as a value raise, a tie keeping the passive option.

## Disagreements with the audit (stated, not hidden)

The audit's own range model (stated top-x ranges, a constant bluff share of f/(1+2f) of the pot fraction, people at 0.6 of it) and this one (his measured rates on the band and line) disagree on 10 of the 25 heads-up fixtures; each is pinned in the law at the priced action:

- river A7 two pair facing a river bet (audit raise; priced call: against the range that bet the river on 7c9s5s5dAh the equity of the part that would call a raise is below one half);
- turn KQ top pair and QQ overpair facing his raise (audit raise; priced call: against a raising range);
- river 66 (audit raise; priced call, the off line folds);
- river KQ check-back in position (audit bet; priced check: his turn raise leaves a range KQ trails);
- turn AT top pair facing a turn bet (audit call; priced fold);
- four dead-equity calls (TT, A8, A7, 66; audit fold; priced call). With beta at the indifference share the bluff-catcher's equity sits at the price (0.28 to 0.31 against prices of 0.25 to 0.27); the audit's people-bluff factor of 0.6 makes them folds. No counter measures how often a player bluffs, so the indifference share is used.

## Limits

- Heads-up only. The audit's two multiway fixtures (Q8 river fold with four live, Q9 three-way river call) are unchanged.
- Re-raises by him and rake are left out of every value alike; the call and the check realize equity with a fixed factor and win no chips on later streets.
- His fold to a raise is his fold to a bet at the raise's price (no fold-to-raise counter exists), capped by the weak part of the range he wagered with.
- The bucket order is a made-strength order; a draw's equity is not ordered inside its bucket.
- The check-back range after a street of checks uses the posterior's soft move, not his measured rates.
- The population cell is the Horses', not people's: against a person with no read the prior is the Horse figure.

## The VPIP floor (task item 5, reported only)

`vpipFloorLimpOnly` (on since 2026-11-18 20:18Z) closes the floor-driven preflop gap in this slice: every Horse NLH cash decision after the switch in Auditor D's slice (375) carried `vpipFloor` 0, so no ten-hand-window table (`vpipFloorLimpOnlyTenHandWindow`, its own option and authority file, the #11401 work) appears in it, and the 11 preflop mistakes after the switch were made with no floor at all (5 loose cold calls, 2 big-blind defends, 2 over-folds and 2 weak calls of re-raises): they come from the brain's own preflop continue bars, not from the floor. Nothing is duplicated here.

## Evaluation (owed)

League card declared, not run: `nlh_holdem_value_and_calls_are_priced` (`server/src/benchmark/HorseLeague.ts`; arm A the option on, arm B the brain). A PASS-BAR must be written before either is run.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-19 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it; Auditor D's decisions.csv is not a format the scorer reads)
