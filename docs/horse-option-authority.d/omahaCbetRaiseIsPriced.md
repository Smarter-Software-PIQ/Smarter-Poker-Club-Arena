# omahaCbetRaiseIsPriced: Authority For The Live Switch

Built 2026-11-21 by EMERG lane CBET-DEFENCE (PLO-OWNER lead-2), lead rulings 2026-11-21 12:20 AM Chicago. It replaces, in its spot only, the stated raise row of the flop facing-bet verdict with a measured raising range.

## What It Does

PLO4/PLO5 cash (tables and Lightning), the flop (`server/src/engine/HorseOmahaCbetRaisePriced.ts`, called inside `omahaFlopFacingBetEv`'s raiser-range input). (i) Facing a raise of its own flop continuation bet, the Horse prices the call against the top W x rho of holdings on the flop (card removal; clamped to [0.02, 0.95]), rho = (the raiser's lifetime public raises facing a first flop c-bet + K x the population share for the players and c-bet size) / (his opportunities + K); it continues when EV(call) beats the fold. (ii) A heads-up bluff or semi-bluff c-bet (the v38 flop bet path) carries the raise branch rho(size) x the value of answer (i). Constants: `docs/horse-option-authority.d/omahaCbetRaiseIsPriced.CONSTANTS.md` (K 200, W 1.65, population table from public hands Nov 1-16).

Public information only: one provider for every opponent, no account, name or person/Horse flag; no record = the population share exactly. Receipts `omaha_cbet_raise_priced_range`, `omaha_cbet_raise_priced_branch`. Default OFF (read `=== true`), switchable live, scopable per game. PLO6, Hold'em and tournaments: no c-bet line, the option never acts.

## What Was Measured

Archive woowoo-48h-audit-01BNteGYgf repairs/EMERG/CBET-DEFENCE.md: an opponent raising every flop c-bet beats the serving Horses by +32.9 +- 10.1 bb/100 in PLO4 heads-up; the Horses fold hands with 0.46-0.52 equity at a 0.33 price. Grade: CRITERIA-CBET-DEFENCE.md (sha256 cfb19103ab6d361891944b161c1d40519c1ceb6c6e1acf573e16e7d7dfb46586).

- Evidence: NOT MET (development only; no grade run)
- Replay: NOT RUN (no replay of audited decisions has been run for this option; bench grade per CRITERIA-CBET-DEFENCE.md sha256 cfb19103ab6d361891944b161c1d40519c1ceb6c6e1acf573e16e7d7dfb46586 is pending)
