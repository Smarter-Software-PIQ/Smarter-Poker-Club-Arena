# 2026-11-21: the two priced hold'em options are locked off-only as measured harm

Antigravity Coordinator ruling of 2026-11-21 (owner delegation of 2026-11-20 15:01), on the scripted no-limit league field of PR #11634 (`a45b95a2f9f`, `docs/changelog/2026-11-21-holdem-scripted-no-limit-field.md`). Recipe 7.3, template #11567 (`fixedLimitCallIsNotACommitment`).

## What changed

- `server/src/engine/HorseOptionSwitch.ts`: two `OPTION_SWITCH_OFF_ONLY` entries with status `harm`.
  - `holdemCommittedNoPairIsPriced`: against its value-only harm control (card `nlh_committed_no_pair_is_priced_vs_value_barreler`) seed 20261120 `-0.20 +/- 0.10 bb/100` (z -2.02) and seed 20261121 `-0.22 +/- 0.10` (z -2.26), together `-0.21 +/- 0.07` (z -3.02), both seeds significant. Against the pot barreler not resolved (`-0.21 +/- 0.70`). No significant positive cell.
  - `holdemDangerBoardEquityIsPriced`: against the danger-board bettor (value and no-pair half-pot bets on four-flush/four-straight boards; card `nlh_danger_board_equity_is_priced_vs_danger_bettor`) `-7.31 +/- 1.11` (z -6.61) and `-8.49 +/- 1.19` (z -7.16), together `-7.90 +/- 0.81` (z -9.74). Its gain against the value-only control (`+2.33`, z +7.61) is the field most favourable to it. Same shape as `fixedLimitCallIsNotACommitment` (harm in one field, nothing that offsets it in the other). The known cause is its `n = 50` call-biased showdown sample of the bettor's range.
- `server/src/engine/horseDecision/everyUpgradeHasALiveSwitch.law.test.ts`: pins both as `harm`, with their sources and z values. Neither was on the "inconclusive or not yet evaluated" list, so nothing moved off it.
- `docs/horse-option-authority.d/holdemCommittedNoPairIsPriced.md` and `holdemDangerBoardEquityIsPriced.md`: state line now reads locked off-only as measured harm (still Evidence NOT MET; no switch row proposed).
- `supabase/migrations/20261121184749_horse_option_switch_holdem_priced_options_harm.sql`: generated with `gen-horse-option-switch-sql.ts --follow-up`; `-- registry:follows: 20261121042010_horse_option_switch_plo_dark_train` (newest list on main). Semantic block diff against that list: both options leave `shadow-options` and `on-shadow-options` and join `off-only-options`; nothing else changes. `scripts/ci/test-horse-option-switch-evidence-postgres.sh` lists regenerated with it.

## What did not change

No switch row was written (only the SWITCH lane writes rows; both options were OFF with no row). The option code stays in source, read `=== true`, release default off. Re-evaluating either option needs the lock lifted first in source and a new list.

## Timing

Prepared during the owner-window hold of booking #11640 (window 1906z). The PR waits, auto-merge off, until the custodian posts SEALED and installers are resumed in `COORDINATION-INBOX.md`.
