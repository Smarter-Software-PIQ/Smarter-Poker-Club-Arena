# Agent promo sends share a seven-day allowance

Each club downline can receive at most 50 chips from super-agent, agent and sub-agent promo wallets combined during any rolling 168 hours. Sends to player, agent and promo wallets consume the same allowance. Prior receipts immediately count; a different upline, role change or reclaim does not reset usage. Owner/co-owner/admin funding and unrelated wallet sources keep their existing rules.

The existing promo-send core checks the gross recipient history under its established club transaction mutex before any debit or credit. Exact retry receipts remain ahead of the check. A refused send reports the remaining allowance and changes no wallet or journal. Stale isolation snapshots fail closed, and new receipts use the admission time after lock acquisition. No scheduled reset, new balance store or engine replacement is required.

The retained PostgreSQL regression uses the real public wrapper, promo core and batch router. It covers split sends, exact cents, historical receipts, all roles/destinations, invalid amounts, authority refusals, retry intent, rollback and concurrent uplines. It runs in the existing accounting CI shard. The three sending surfaces explain the shared allowance.
