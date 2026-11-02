# Incident evidence survives an engine outage

The explicit `restartIncident` read previously required successful public and
loopback engine health before reading Docker or kernel evidence. During the
November 2 outage, run 41465208615 stopped at `public_health_before`. That proves
a diagnostic failure, not an out-of-memory cause.

The existing reader now treats health as a recorded observation for this explicit
incident mode. Unavailable health has a null identity and a closed failure
category. Changing identities are reported as changed or different; missing
samples leave continuity unproven. No unavailable sample becomes a healthy
engine, a stable process, or release authority.

The configured SSH host pin, fixed command set, fifteen-minute completed window,
48-hour admission age, scope validation, capture limits, redaction and ephemeral
key cleanup remain enforced. Ordinary observations still require matching public
and loopback identities. This change adds no restart, deployment or financial
operation and does not alter any release gate.

A missing or unreadable current container log is recorded explicitly while the
remaining incident sources are collected. A stopped container's exit state is
retained without attempting to inspect a nonexistent current process. Core
metadata, absent logs and kernel findings retain their attribution limitations.

Regression protection runs through `tests/scopedRuntimeErrors.test.ts`, including
its native Python fixture: actual HTTP 502, malformed health identity, stopped
container subprocess, remote outage entry, pinned request transport, identity
changes, key cleanup, redaction and unchanged ordinary-health refusal. The outage
entry regression failed before the repair.

Publication is protected main followed by an explicit read through the existing
`production-integrity-audit.yml` workflow. Source merge is not live verification;
the incident census and engine root-cause repairs are separate unfinished work.
