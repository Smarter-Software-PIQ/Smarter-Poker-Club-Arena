# A fixed-limit cap against an aggressive 3-bettor needs value, not just a clear call (opt-in)

Fixed-Limit lane, 2026-11-15. New `HorseDecideOpts.fixedLimitManiacCapNeedsValue`, read only as `=== true` (default off). Diagnosis: agent evidence `fixed-limit-01Gw7aDr/AH-V38-FIXED-LIMIT.md`. Implementation record: `AJ-MANIAC-CAP-VALUE.md`.

## The defect

When the Horse opens and an aggressive raiser 3-bets, V53 4-bets any hand whose V38 equity against the raiser's read range clears the required equity by 6 points. That bar was measured on a pot-sized PLO5 3-bet. In fixed limit the 4-bet is the preflop cap: the big blind is the first wager, so open, 3-bet and 4-bet make four. The cap is one small bet that the raiser calls and cannot answer, worth (2e − 1) small bets at equity e, which breaks even at e = 0.5.

In flh 6-max against an observed maniac's 3-bet (20 seeds a hand), V53 capped Q9o, J8o, 76s, 54s, 83o and 72o 112 of 120 times, with 0.30–0.46 equity. Each of those hands calls against an unknown 3-bettor.

## The change

With the option on, in a fixed-limit game (the betting structure) a V53 pressure raise that would be the preflop cap fires only when e ≥ 0.5 + m. Otherwise the hand calls. The margin m is not a chosen number. It is two standard errors of the equity estimate at the sample count n the decision drew:

- each of the n deals scores a pot share in [0, 1], so SE ≤ 0.5/√n;
- that gives m = 1/√n;
- n is read with `equitySampleSizeOfLastCall()` straight after the V38 pass, so it is the count after the load governor and the depth multiplier.

At full scale that is n = 360 for flh (m = 0.0527) and n = 176 for flo8 (m = 0.0754). See `HorseFixedLimitManiacCap.ts`.

## Receipts

`fixed_limit_maniac_cap_value_call_seen` in HorseDataLedger, noted only when the cap became the call. The league cannot deal fixed limit, so the option is a refused matchup (`UNMEASURABLE_MATCHUPS`) with its reason.

## Tests

`server/src/engine/AFixedLimitManiacCapNeedsValue.law.test.ts` (docs/laws.d entry) checks:

- the bar is 0.5 + 1/√n;
- with the option on, in flh 6-max facing a maniac 3-bet after the open, the six 0.30–0.46 hands call, AA and 99 cap, KQs caps in most seeds, and every cap is at or above the bar;
- with the option off, decisions are identical to the option unset, and the weak hands cap;
- the receipt fires exactly when the action changes, and only from cap to call;
- flh heads-up, flo8 at six seats and heads-up, an unknown 3-bettor, no-limit and pot-limit are unchanged.

## Switch

The option registers itself in the live switch registry through its ledger flag (release default off). The database lists ship as follow-up migration `20261116041907_horse_option_switch_fixed_limit_maniac_cap_value.sql` (stacked above the Fixed-Limit W4 list `20261116011129`; it equals that list plus this one name). Registering enables nothing. AB-EVALUATION-2.md section 3.8 (Fixed-Limit lane evidence): no harm in any of the nine predeclared cells, value not demonstrated, so the option stays OFF; an ON row would need demonstrated value first.
