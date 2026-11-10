# One owner-authorized cutover for the cash Horse action change

The owner chose "ASAP today (Recommended)" for the merged cash Horse action change #10350 (`63c92858`, `v85CashAction`): one single-use owner window that opens once Backup certifies, with this Claude agent as sole cutover custodian.

Window `2026-11-10-owner-asap-engine-2350z` admits one certified replacement of serving `840429a3` from 23:50 UTC November 10 to 05:00 UTC November 11. It starts after the separately booked database-only window ends at 23:30 UTC so the two never overlap, and the player notice (which shows the earliest active booking) switches to this cutover at 23:30 UTC. The existing single-use exception in `engine-release-transaction.sh`, `engine-release-seal.py` and `engine-release-activation-floor.py` is rebound to this window and predecessor exactly as the previous bookings were; the new host-script pair is the retained-refusal current pair and the previous pair joins the prior list.

This source change starts no release, installs no migration and creates no tournament-start hold. Qualification, the fresh Backup certificate with its full soak, schema equality, drain, freeze, proof, rollback, thaw and the post-seal Backup refresh are unchanged. Deployment and live verification remain separate.
