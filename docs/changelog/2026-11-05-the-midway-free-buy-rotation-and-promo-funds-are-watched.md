# The Midway Free Buy Rotation And Promo Funds Are Watched

Two things went unseen on 2026-11-05 until someone happened to look: Saturday's 8:30 AM Midway Morning Free Buy was never created (a stuck spawn claim) and Sunday's was created in the old PKO format; and the Midway promo wallet, which funds every Free Buy entry, was spending about 18,000 chips a day (mostly other promotions), roughly eight days of funds.

`fn_sp_midway_free_buy_watch()` (migration `20261105183114`) checks the five daily rotation slots starting in the next 48 hours (8:30 AM regular, 12:30 PM PKO, 4:30 PM All-In-Or-Fold, 8:30 PM Mystery Bounty, 12:30 AM PKO, Chicago time) and the promo wallet's runway at its last-7-day net spend:

| Rule                           | Warning                                                    | Critical (paged)                             |
| ------------------------------ | ---------------------------------------------------------- | -------------------------------------------- |
| `midway_free_buy_missing`      | a slot in the next 48 hours has no live event              | the slot starts within 12 hours              |
| `midway_free_buy_wrong_format` | the event is in the wrong format (players already entered) | no entries yet and it starts within 12 hours |
| `midway_promo_runway_low`      | under 30 days of promo funds                               | under 7 days                                 |

Events created before the rotation went live keep the PKO terms their players joined under and are not flagged. The items are appended to `fn_sp_digest_attention`, so they appear under Needs Your Attention in the 7:00 AM Daily Operations Digest and reach the Production Alerts fleet like every other rule, and `fn_sp_critical_scan` pages the critical ones by email and text within five minutes, once each. Both functions are patched in place against their exact live preimage.
