# Two remaining Midway migrations in the November 7 recovery freeze

Dan directed the Satellite 30 handoff to coordinate the six queued migrations with Claude's existing cutover. Production history already contains four versions. The database window `2026-11-07-midway-remaining-two-join` names the two remaining files in order, the corrected Midway build guard (20261106004812) followed by the scheduled guarantee (20261107041342).

Claude's release owner can submit the protected stage workflow with `request_database_break=false` for the independently announced Deployment Recovery freeze between 14:45 and 20:45 UTC on November 7. The installer reads migration history, checks the opening and commit reserves, and stops on the first refusal. This entry expires with the recovery window.
