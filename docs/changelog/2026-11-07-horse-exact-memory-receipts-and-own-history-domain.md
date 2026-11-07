# The exact public-memory read leaves a receipt, and own public history loads under its speed/ante domain

Two defects on the serving engine (release 40bc2467, booted 2026-11-07T16:31Z)
came in with #9693, which partitioned shared public Horse memory by original
speed and ante rules.

First, the completed-hand durable read moved from `readHorseOpponentProfiles`
to `readExactHorseOpponentProfiles` for every hand that carries its domain,
and that reader emitted no telemetry. `horse_exact_profiles` was read and
written (3,668 rows since boot) while the flush showed
`horse_opponent_memory_read_ok` = 0 for two hours, so the post-release proof
kit reported memory reads as absent. The exact reader now files its own
receipts: `horse_exact_memory_read_ok` with a `horse_exact_memory_read_ms_*`
latency bucket on a validated result, `horse_exact_memory_read_failed`,
`_timeout` and `_busy` classified by the same rules as the legacy reader
(the latency edge and failure classification are shared functions, not
copies), and `horse_exact_memory_read_invalid` when the database answered but
the rows failed receipt validation. The receipts are registered in the data
ledger, counted by `scripts/horse-measure/sql/activation.sql` (so the daily
scorecard sees them), and pinned by the live-layer receipt law.

Second, #9693 made `validWindow` refuse any own-history packet whose observer
context is version 2, while `ServerTableEngineTurns` now attaches the public
memory domain to every live decision context, so every live read context is
version 2. No horse received its own public history: `horse_observer_history_loaded`
and `horse_observer_history_refused` were both 0 on 40bc2467 against 37,696
and 26,703 per day on the previous release. The intent of #9693 stands: a hand
must prove its speed and ante before it enters a partitioned window. Each
`HorseOwnPublicHand` now carries `publicMemoryDomain`, read from
`hand_history.public_memory_domain` in the same bounded category select the
loader already makes. A version-2 context accepts a window only when every
hand's domain equals the context's domain; hands without a domain (history
before 2026-11-06) or with another domain are excluded by the loader, which
marks the window capped and files `horse_observer_history_domain_complete` or
`horse_observer_history_domain_partitioned`. A version-1 context is unchanged.
The installed v3 SQL reader is untouched; the domain is bound in the engine
and covered by the packet digest.

Tests: exact-memory receipt tests (ok, latency bucket, failed, timeout, busy
with the refusal identity kept for callers, invalid, no receipt without a
domain); loader tests for a version-2 load, exclusion of untagged, other-speed,
other-ante and malformed hands, unavailable category rows, an empty window and
a version-1 read; validator tests for version-2 acceptance, refusal of each
untagged or mismatched hand, digest coverage, cache delivery to a version-2
snapshot and worker learning from a version-2 packet; the data ledger and the
live-layer receipt law. This is an engine change; it activates at the next
certified 04:00 America/Chicago engine release.
