# Owner window for the cash styles schedule and the next-hand timing

Dan approved, verbatim, on 2026-11-05 13:11 (America/Chicago): "APPROVED — OPEN AN ADDITIONAL ENGINE RELEASE WINDOW TODAY AND DEPLOY THE RELEASE CONTAINING PR #9539 AT THE NEXT SAFE, COORDINATED OPPORTUNITY." He also directed that it be coordinated with the other release owners "so these approved changes reach production without competing for the same release slot."

PR #9539 merged at 18:38Z. Its receiver refused at 19:00Z because the earliest-safe window was already in use. The Lightning correction (#9553) then opened `2026-11-05-lightning-always-runs-1945z`, and that window is left exactly as it is.

This adds `2026-11-05-cash-styles-and-deal-timing-2045z`:

- Earliest-certified, from 20:45Z November 5 to 02:45Z November 6.
- Admits one activation of a target containing #9539.
- Opens an hour after the Lightning window, so the two releases never compete for one slot.

All guards are unchanged. No migration.
