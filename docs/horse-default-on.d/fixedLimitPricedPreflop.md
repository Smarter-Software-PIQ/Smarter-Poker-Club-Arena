# fixedLimitPricedPreflop (W5, branch `agent/fixed-limit-preflop-steal-01Gw7aDr`; the pull request that adds this file)

OFF in source. An opt-in arm (read as `=== true`), fixed limit only (flh, flo8). This file records where the option stands against the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md). The proposal it supports: the source default stays OFF, and the option is switched ON live by a registry row (`fn_ca_horse_option_switch_set`) only after Hand Analysis's exact-head ACCEPT of the serving build and of this file. The companion option `fixedLimitStealVsTightBlinds` stays OFF: it is off-only in the registry by the steal hold (owner ruling 2026-11-14 21:30 Chicago, `OFF_ONLY_PATTERNS` /steal/i), its reach is NOT MET (decision-time reads not retained; ceiling 0 with today's profiles) and its value is NOT DEMONSTRATED (AB-EVALUATION-2.md 3.4).

Evidence folder: `/Volumes/SmarterArchives/agent-evidence/extreme-archive/fixed-limit-01Gw7aDr/` (lane evidence, not in the repository): `AA-PREFLOP-STEAL.md` (design, reference shares, the 2026-11-15 blind-defence fix), `AB-EVALUATION-2.md` section 3.4 (paired evaluation, predeclared rules 0.4/0.5/0.6/0.10/0.11/0.12), `r2/R2-REACH-CONTINUATION.md` and `r2/R2-METHOD.md` (recorded-hand replay).

## Mechanism

`HorseLogic` builds `fixedLimitPriced` for a fixed-limit preflop decision (no bomb pot, no all-in-or-fold, no straddle) when the option is on, and `HorsePreflop.decidePreflopV7` takes three paths from `HorseFixedLimitPreflop.ts`:

1. First in: the seat raises its reference share by players behind (flh 45 / 31 / 24 / 19 / 15 / 13 % for 2 / 3 / 4 / 5 / 6 / 7+ behind; flo8 38 / 28 / 22 / 18 / 15 / 13 %); the small blind folded to raises a band and completes a further band (flh 40 / 65 %, flo8 30 / 60 %); the heads-up button raises flh 85 % / flo8 70 %. Persona tightness moves a share by at most 5 % of itself. Receipt `fixed_limit_priced_first_in`.
2. Blind facing one raise: call when equity (hero bucket vs the opener's reference range, generated table) x realization (flh 0.65, flo8 0.55, calibrated to published defence widths at the raw price) x 0.85^(players behind) covers the RAW pot price call / (pot + call). Rake enters once, through the calibration (fix df1acb46: the earlier rake-deducted price counted rake twice). The option never turns a blind's continue into a fold. Receipt `fixed_limit_priced_blind_defence`.
3. Under the same option the phase12 pack's three round-3 first-in rules (open tightened, heads-up open, small blind steal) retain this reference in fixed limit (receipt reason `fixed_limit_priced_retains_<rule>`); the big-blind rule is no longer held (fix df1acb46).
   Pinned by `AFixedLimitPreflopIsPriced.law.test.ts` (24 tests at df1acb46, 6 failing before the fix), with production-shaped rake (10 %, cap, jackpot fee 0.6 bb) in the test tables.

## Input fidelity

The recorded-hand replay (`r2/R2-METHOD.md`) rebuilds each public node with `HorseComplaintReplay.stateAt` (seats, stacks, street bets, pot, legal actions, fixed bet size, cap flag, structure fixed_limit, blinds, dealer, history before the decision), applies the production card firewall (no hole cards on any seat; the Horse's own cards on the hero), installs the table's VPIP floor and window from the node and the seat's judged VPIP rebuilt from the recorded hands in time order, and serves the base options as production does (phase12Remaining 'candidate', the seven style options). Supplied by hand: (a) a Horse's own preflop cards when it folded (folded cards are not retained): imputed by rejection sampling from the deck, kept only when the OFF arm reproduces the recorded fold, never another seat's cards; (b) opponent memory empty per seed (P reads no opponent memory in its own predicate; F1 on and off give identical counts). Not reproduced: the worker's pooled public profiles, the authored persona under the hybrid dials, the deep second look, the decision hour, the phase13 joint policy, timing. The paired evaluation (AB-EVALUATION-2.md sections 0-2) uses harness C2, validated against live unfloored play class by class (one stated structural miss, flh 6-seat unfloored flop fold to a bet, which is not a preflop class).

## Value

AB-EVALUATION-2.md 3.4, code df1acb468d82 (this head's decision code), F1 on in both arms, 60 s cells, integrity ok in all 120 cells, recomputed independently. Validated portion in big bets per 100 hands +/- SE, P alone, at the target cells (horse, tv = tight value-only, tp = tight-passive, lp = loose-passive):

- flh 2 seats: horse +1.66 +/- 0.81, tv +1.80 +/- 0.35, tp +2.22 +/- 0.13, lp +0.63 +/- 0.40.
- flh 6: horse -0.20 +/- 0.77, tv +0.04 +/- 0.48, tp +1.25 +/- 0.33, lp +0.25 +/- 0.34.
- flh 9: horse -0.14 +/- 0.83, tv -0.83 +/- 0.54, tp +0.83 +/- 0.31, lp inert (0 deals differ).
- flo8 6: horse -1.60 +/- 1.13, tv +0.83 +/- 0.59, tp +1.08 +/- 0.33, lp +0.34 +/- 0.78.
- Non-target cells: flh 2 maniac -2.59 +/- 1.34 (harm line -3.68), flo8 6 unknown (memory off) -2.03 +/- 1.00, flo8 6 alwaysbet -1.14 +/- 3.04; inert at flh 9 vs alwaysbet, lp and maniac.
  Predeclared verdict: HARM none (no validated cell below -1 - 2 SE); mixed-sign rule 0.11 not triggered in either variant; pooled over the 15 target cells with variance +1.44 +/- 0.09 (z 16.5): PASS; without the heads-up flh cells +0.57 +/- 0.14 (informational). R1 value-only (tv) cells: flh 2 +1.80, flh 6 +0.04, flh 9 -0.83 +/- 0.54, flo8 6 +0.83: none harmful, one negative within 2 SE. Simulated totals against scripted opponents are not production gains.
  NOT MEASURED: floored tables (harness C2F is validated for flh 6 seats and most classes at flh 9 and flo8 6, but no cell was run on it; 1,530 of the 3,034 decisions the replay changes are on floored tables), and the tournament format (every cell is cash). Under the doc's rule this row is MET for unfloored cash tables only.

## Continuation

Measured from recorded hands (`r2/R2-REACH-CONTINUATION.md`, 1,845 Horse-only hands on 7e8688d3, public actions only; all Horse against Horse, no person has played fixed limit since 2026-11-03). Responses to a Horse's first-in raise (all fold / called / 3-bet): flh BTN 146: 14.4 / 58.9 / 26.7 %; CO 71: 16.9 / 59.2 / 23.9 %; EP/MP 152: 21.7 / 64.5 / 13.8 %; SB 354: 32.2 / 58.2 / 9.6 %; heads-up button 93: 23.7 / 59.1 / 17.2 %; flo8 BTN 32: 21.9 / 65.6 / 12.5 %; CO 34: 29.4 / 50.0 / 20.6 %; EP/MP 110: 15.5 / 52.7 / 31.8 %; SB 91: 57.1 / 35.2 / 7.7 %; heads-up button 22: 31.8 / 59.1 / 9.1 %. After the big blind calls one raise: the opener bets the flop 60.3 % (flh) / 79.5 % (flo8) and the big blind folds to that bet 32.1 % / 1.5 %. The paired evaluation plays every continuation out; no fold, call or 3-bet frequency is assumed. MET.

## Reach

Recorded-hand replay at this head (`r2/R2-REACH-CONTINUATION.md`, section "RE-MEASURED at the W5 delivery head"; 10 seeds, 10 imputations): A/A control 0 of 21,054 trials changed. 7,036 decisions in scope; 3,034 change in at least one trial (1,530 on floored tables); 9,000 of 70,076 trials change; 512 changed trials already equal the recorded production action. By spot: flh first-in folds (imputed) BTN 615 of 644, CO 637 of 718, EP/MP 805 of 1,436, almost all fold>raise; flh small blind first in 150 of 644 (raise>call 808, raise>fold 413, fold>call 232 trials: the stated complete band); flh heads-up button 17 of 126; flh big blind facing one raise ring 10 of 577, heads-up 12 of 93 (fold>call only); flo8 big blind ring 32 of 171, heads-up 8 of 22 (fold>call only); flo8 heads-up button 8 of 66 (call>fold 61: the reference does not limp); both small blinds facing a raise 0. No blind continue becomes a fold (0 trials). MET, with the imputation limit (recorded folds keep no cards).

## Scope

Gated in code to fixed-limit hold'em and Omaha hi-lo preflop (`flVariant` flh / flo8 from `bettingStructureFor`; two-card fixed limit not short deck), excluding bomb pots, all-in-or-fold and straddle hands; no-limit, pot-limit and every other variant are untouched (law: options passed false = absent; the off identity corpus in the PR). Cash: evaluated (3.4) and replayed. Tournament: the code path reaches fixed-limit tournament tables (no format gate), but no tournament cell was run: NOT MEASURED. Lightning: no fixed-limit Lightning tables exist.

## Visibility

Receipts registered in `HORSE_DATA_LEDGER` (FixedLimitAdaptation): `fixed_limit_priced_first_in`, `fixed_limit_priced_blind_defence`, and the pack reason `fixed_limit_priced_retains_<rule>`. The registry's own receipts `option_switch_fixedLimitPricedPreflop_<on|off|default>_seen` show which state each worker serves; silence of `fixed_limit_priced_first_in` while fixed-limit tables run means it is off.

## Limits

- Value is from scripted opponents and Horse identities with empty durable profiles; no person has played fixed limit since 2026-11-03, so nothing here measures a person's response.
- Floored tables and the tournament format are not evaluated (see Value and Scope). About half of the changed decisions in the replay are on floored tables.
- The heads-up flh cells dominate the pooled figure (smallest SE); without them the gain is +0.57 +/- 0.14.
- Negative non-harmful cells exist (flh 2 maniac, flh 9 tv, flo8 6 horse, flo8 6 with memory off); none crosses the predeclared harm or mixed-sign lines.
- Reach imputes a Horse's own folded preflop cards; it measures how many recorded folds today's brain would also fold that the option turns into another action, not the recorded hands themselves.
- The defence's opener range is the reference, not the opener's own read; realization factors are calibration, not measured.

## Carrying head

The W5 delivery head is `df1acb468d82` (W5 + the blind-defence fix) merged with origin/main `da0c64e38fd`, plus one commit that registers both options in the option switch registry (release default OFF, owner Fixed-Limit; `fixedLimitStealVsTightBlinds` off-only by the steal pattern) with the follow-up list migration `20261115212312_horse_option_switch_fixed_limit_preflop.sql`, and adds this file. The registration changes no decision. The paired evaluation ran on df1acb46 itself (worktree ca-w5c); the replay re-measure ran on the merged tree. If another flag-adding head merges first, the follow-up migration is regenerated on main before merge.

## OFF and rollback contract

- Source default OFF: with no row, every Horse decides exactly as main does today.
- ON and OFF, live: `SELECT public.fn_ca_horse_option_switch_set('fixedLimitPricedPreflop', 'on' | 'off', '<actor>', '<note>')` as service_role (audited in `ca_horse_style_switch_audit`); clearing the row returns to the source default. The main thread reads the table every 30 s and passes the switched options to every decision worker with each decision; a hand in progress takes the new value at its next decision.
- When a row may be written (Hand Analysis 2026-11-15 20:17:42Z item 4 as corrected 20:42:45Z): only after every serving engine instance (all workers, any canary) reports a build that carries `fixedLimitPricedPreflop`; never while an older build is still serving anywhere (mid-cutover); before any rollback to a build that does not carry the name, clear this row first, because one name an engine does not know makes its whole switched set invalid and every non-style option on that engine then runs at its release default.
- Nothing is persisted by the option: it changes preflop actions only, reads no stored profile and writes none.
- `fixedLimitStealVsTightBlinds` accepts only 'off' (off-only) until the owner lifts the steal hold by name.
