# Free Buy Funding And Tickets Hold Under Concurrency; Cloud Pushes Keep Their Identity

Owner rules (2026-11-06): "closing registration funds each eligible first entry exactly once, including retries and concurrent requests"; five Free Buy tickets per player per gaming day, one per event.

`scripts/dev/test-free-buy-cutoff-postgres.sh` (CI accounting shard 2, #9751) proved the 20261106195136 cutoff cases one session at a time. It now ends with `scripts/dev/free-buy-cutoff/06_concurrency.py`, on the same throwaway cluster. Every racing session waits on a shared advisory lock that is released only once all of them are queued, so they start together:

- **Cutoff:** 16 simultaneous finalizations of a guaranteed all-in-or-fold event (G 500, C 37) and a non-guaranteed regular event (180 entries, C 25). One `free_buy_cutoff_funding` leg each; promo 463 and 180; no union bank overlay; pools 500 and 205.
- **Tickets:** production's `smarter_private.free_buy_ticket_redeem` (md5 3e7bad4f) and `free_buy_gaming_day` (7c1193f6), captured in `scripts/dev/free-buy-cutoff/ticket-functions.json`, over the ticket tables and index read straight from 20261105223835's own DDL. Seven simultaneous first entries by one player use exactly five tickets and two are refused `FREE_BUY_TICKETS_USED_TODAY`; two simultaneous entries by one player into one event use one ticket (`FREE_BUY_TICKET_ALREADY_USED_FOR_EVENT`); one entry replayed four times at once uses one ticket.

No `ci.yml` change: the CI step already runs the script.

`scripts/agent-push.sh` stripped `GH_TOKEN`/`GITHUB_TOKEN` unconditionally. On the Mac that is right (gh has its own login). In a cloud agent session the ambient token is the configured identity and gh has no stored login, so the pre-push merged-branch guard could not ask GitHub anything and blocked every push ("GitHub did not identify the trusted destination repository"). It now strips the ambient token only when `gh auth status` succeeds without it.
