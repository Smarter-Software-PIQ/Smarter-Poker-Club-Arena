# Preserve the guarantee promised by each Midway Free Buy schedule

The database guard checks the stored guarantee against the schedule after each new build or change to tournament terms. This covers a guarantee-only update to a correctly flagged Afternoon All-In Or Fold event. Started events retain their original terms.

The existing PostgreSQL rotation check exercises the production guard after the normalizing triggers. It covers wrong-format inserts and updates, the 500-chip guarantee, and unchanged terms for started events alongside the existing Horse and human registration funding cases. The successor migration installs after the original guard in daily maintenance.
