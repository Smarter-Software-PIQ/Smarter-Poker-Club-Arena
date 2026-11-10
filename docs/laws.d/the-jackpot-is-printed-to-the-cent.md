# tests/the-jackpot-is-printed-to-the-cent.law.test.ts

Every Bad Beat Jackpot chip amount is printed as it is stored: thousands
separators, both decimals, never a K/M suffix and never rounded or truncated
(Dan 2026-11-09: "no rounded numbers. use exact numbers 100% of the time").
The pool, the mini, each recorded payout and each recipient's share come
straight from the cent columns through `jackpotChips`; a projected payout uses
the payout RPC's own cent arithmetic (`jackpotTotalAtPercent`, `jackpotSplit`).
This takes the jackpot out of the 2026-09-09 forward-facing compact rule;
Diamond jackpots are whole by custody and unchanged.
