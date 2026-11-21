# fixedLimitPricedPreflop: authority for the live switch

Owner hold, not lifted. Evidence NOT MET: the option is off-only in the registry (`OPTION_SWITCH_OFF_ONLY`, status `hold`, source "owner preflop range hold", reason "changes a preflop range: held until the owner lifts it by name"). This file does not lift the hold and proposes no switch row.

## What it does

Fixed limit (flh, flo8), cash tables only. First in, the seat raises the reference share for its position (the small blind also completes a band); a blind facing exactly one raise turns a fold into a call when its realized equity against the opener's reference range covers the raw pot price (`server/src/engine/HorseFixedLimitPreflop.ts`; Fixed-Limit lane W5; `docs/changelog/2026-11-15-fixed-limit-priced-preflop-and-steal.md`).

## The order it rests on

None to switch it on. The owner preflop range hold stands until the owner lifts it by name.

## Receipts and tests

Receipts `fixed_limit_priced_first_in`, `fixed_limit_priced_blind_defence`. Law `server/src/engine/AFixedLimitPreflopIsPriced.law.test.ts`. League card `flh_priced_preflop` (`FIXED_LIMIT_HOLDEM_CARDS`, six seats, Horse mirror).

## Evidence rows (docs/HORSE-DECISION-CHANGE-EVIDENCE.md)

Horse-mirror league readings recorded in `docs/horse-league-fixed-limit.md` (arm A the option on, seed 20261115, 300 pairs each, 0 illegal actions):

| Seats | Setting                       | Diverged | bb/100 | Std. error |
| ----- | ----------------------------- | -------- | ------ | ---------- |
| 6     | Hybrid cash, deal-seeded mood | 30       | +1.11  | 1.24       |
| 6     | plain                         | 30       | -2.53  | 1.65       |
| 2     | plain                         | 109      | -1.50  | 6.35       |

None is significant. The eight evidence rows, table type by table type, are in `docs/horse-default-on.d/fixedLimitPricedPreflop.md` (the lane's offline evaluation: Value met at some cash table types, not measured at others; no ON row proposed there either). No scripted-field card measures this option.

- Horse mirror after the league memory fix (re-run 2026-11-21, seed 20261120, arm A the option on, 0 illegal actions, 0 truncated streets, 0 fallbacks): six seats, Hybrid cash with the deal-seeded mood clock, 2,000 pairs: 197 diverged, +0.26 +/- 0.54 bb/100; production personas, 600 pairs: 56 diverged, -1.35 +/- 1.07. Neither is significant.
- Replay on real audited decisions (README.md, "Replay bar"): NOT RUN.

## What is still owed before this file may say the evidence is met

1. The owner hold lifted by name. Evidence work does not lift it.
2. A significant league result (none of the three readings above resolves) and the cash table types the lane's file lists as not measured.
3. An audited fixed-limit-versus-people decision set. None is named in this repository, so no Replay row can be written by the committed scorer (`server/scripts/audited-decision-replay.ts`) for a fixed-limit option until a set of recorded fixed-limit decisions against people is extracted and audited. Counted read-only on 2026-11-21 at 15:10 UTC (production `hand_history`, `has_human`, every hand a person was dealt into; hands with a person are kept forever, so this is every such hand ever recorded): flh 0 hands; flo8 107 hands, all at one table between 2026-11-03 02:40 and 03:53 UTC, one person and five Horses. Against 230,155 flh and 81,351 flo8 Horse-only hands retained at the same moment. So no fixed-limit hold'em set against people can be extracted at all, and a fixed-limit Omaha hi-lo set would be 107 hands of a single person.
4. A PASS-BAR for that replay, declared here before it runs, then its run rows under "Replay".

## What the activation row must contain

`option = 'fixedLimitPricedPreflop'`, `state = 'on'`, note `authority: fixedLimitPricedPreflop docs/horse-option-authority.d/fixedLimitPricedPreflop.md sha256 <the sha256 of this file as merged>`, written by `fn_ca_horse_option_switch_set` by the Horse SWITCH lane only. Not before every item under "What is still owed" is recorded here and the status paragraph says the evidence is met.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-21 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it; no audited fixed-limit-versus-people decision set is named in the repository)
