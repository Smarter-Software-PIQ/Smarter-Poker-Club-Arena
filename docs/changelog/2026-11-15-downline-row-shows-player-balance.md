# Downline rows show the player balance under the fees

Owner request, 2026-11-15: "IN THE DOWNLINE TOTALS UNDER FEE'S, ADD PLAYER BALANCE UNDER IT."

On the player record (`MemberManagementPage`), each row of the Downline list
printed one figure: the fees the player generated. Each row now prints the
fees with the player's balance directly under it, each with a small label.

- The balance is `chip_balance` (exact text twin `chip_balance_text`), which
  `ca_club_member_downline_in_range` already returns. No database or engine
  change.
- Checked at 375px and 420px: no sideways overflow with seven-figure amounts.
- Pinned by `tests/components/playerCommandActionOwnership.test.tsx`.
