# Stall recovery requires sustained recorded dealing

The existing stall observer could resolve an episode after a single hand even
when the table stopped again. It could also resolve an episode merely because
the engine classified an intended wait. The original detection and incident
must survive both cases.

The maintained ingest now requires two exact-table hands after detection, with
the latest inside the existing stall threshold. Its receipt retains both hand
identities and timestamps and explicitly says the root cause is unverified.
An intended wait records explanatory evidence once per reason while preserving
the firing episode and its watch identity.

The existing required shard-7 PostgreSQL gate executes the changed original
ingest against private PostgreSQL 17. It reproduces the former single-hand false
recovery and checks stale, foreign, out-of-episode and duplicate evidence,
intended waits, successful sustained progress and atomic replay refusal.

This observer correction does not repair a stalled game. Engine custody and
recovery remain with the existing active owner. Deployment requires protected
merge, Apply Merged Migration, exact installed-source readback and production
observation. Source qualification is not live verification.
