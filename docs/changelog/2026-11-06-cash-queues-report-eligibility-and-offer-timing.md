# Cash queues explain admission and measure offer delivery

A read-only audit covered all 195 nonclosed cash games, including classic,
must-move and Lightning games. Twelve waiting entries existed in six games;
all six tables were physically full. Eleven entries could not cover their
entry amount, and one of those entries was older than the offer door's
24-hour TTL. No stale pending move was consuming a running table's capacity.
These observations do not establish starvation at an open seat.

The audit did establish a misleading reader: fn_cash_game_waitlist_position
still counted expired entries and returned on_list=true indefinitely. It also
reported a number without the funding, reservation or offer-cap reason that
could prevent admission. The read-only function now applies the existing
entry TTL, existing wallet authority and live hold rules, reports the caller's
own reason and reservation, and gives the lobby the same effective queue total.
The reader does not alter queue rows, queue priority, seats, wallets or purchase rules.
The existing lobby panel prints the reason, including how to rejoin after
expiry. Existing clients remain compatible with the original fields.

The connected Join transaction also had a real admission defect: a waiting
entry older than 24 hours still satisfied its live-row uniqueness rule, so
selecting Join Game returned waitlisted without creating an eligible entry.
The original caller-bound Join now expires only that caller's aged waiting
entry before inserting the fresh request. Existing funding, membership,
game lock and live-hold checks remain in place. Its returned queue counts use
the same effective reader. Installation rewrites no existing player rows;
renewal happens only during the player's explicit request. Native PostgreSQL
reproduces the previous failed renewal, then executes the exact original
queue tail under the maintained migration and proves concurrent requests
create one fresh place. Earlier admission branches remain unchanged.

A malformed legacy offer timestamp could throw before validation and interrupt
that event's consumer. It now returns no deadline, allowing the next valid
offer through. Coverage includes the actual Supabase SDK/Phoenix consumer,
multiple mounted destinations, delayed readiness, funding/refusal/full/free
states, expired entries, private hold isolation, offer limits and maintenance
thaw. Native PostgreSQL executes the maintained SQL and its guarded lobby
rewrite in the existing required accounting lane.

Explicit offer receipt and visible buy-in now record reservation-to-stage and
remaining-hold timing in bounded first-party browser performance marks and through existing consent-aware analytics. Duplicate
and thawed deliveries do not record another stage. Optional analytics failures
cannot interrupt admission. The global listener loads diagnostics on demand and
captures the arrival clock before loading, preserving both first-paint cost and
the actual delivery measurement. The manual read-only cash-queue audit SQL also
shows historical queue-to-reservation timing and explicitly labels the latest
recorded seat-exit correlation, which is not proof that the exit caused an
offer. No monitoring, polling repair, scheduled audit or release loop is added.
