# MTTs And Sit & Gos Open At 25/50

Owner November 5: opening blinds are 25/50 for MTTs and Sit & Gos. Spins keep
their separate rules. The existing tournament and schedule storage triggers
enforce the opening at creation and while an event has not started. The finite
migration updates advertised, unstarted events, their never-played prepared tables,
and active saved schedules. The existing table insertion trigger enforces the
same opening for new prepared tables, including callers with legacy defaults.

The same rule is used by client presets and authoring. The database remains
authoritative for existing clients, recurring/scheduled engine writers and
direct RPC callers. No new engine API or replacement is needed: the existing
manager loads the persisted ladder before launch.

Array indices, clocks, antes, breaks, entry/add-on cutoffs and later stakes are
retained. Early legacy stakes below 25/50 are floored so the ladder cannot step
down after its new opening. Started and terminal events, cash games, every Spin
ladder and funded Spin receipt are excluded. Existing clock policies continue.

Regression protection covers all MTT presets, SNG authoring, exact Spin preview
parity and caller input immutability. The required accounting CI also runs the
native PostgreSQL transition test against captured production clock functions:
it reproduces the old openings, installs the exact migration, verifies inserts
and authenticated/service updates, checks idempotency, and preserves excluded
events and schedules. Live publication and installation are recorded separately
in the owning task checkpoint.
