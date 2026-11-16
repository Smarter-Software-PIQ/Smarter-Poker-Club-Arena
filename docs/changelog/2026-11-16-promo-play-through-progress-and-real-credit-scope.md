# Promo play-through progress and real-credit scope

Continues #11019, #11022, #11029 and #11034 under the owner's complete Promo
Play Through assignment. Enforcement remains off until the remaining lifecycle,
agent/ticket, commission, signup and integrity rules are installed and verified.
This delivery does not activate the programme.

Two new PostgreSQL regressions reproduced real chips remaining locked: two
100-chip credits in one transaction into a wallet with 10 promo left, and a
cash stack belonging to another club. The existing deferred credit function now
subtracts the transaction's visible uncommitted real-credit legs together and
counts cash stacks in the grant's club only. Its existing lock order, exclusions,
tournament protection and source-only installation route stay intact.

The wallet page, personal wallet statement and cash-out sheet now show a shared
percentage ring, fees paid, total target, fees remaining, locked principal and
cashable chips from the authenticated database summary. Refreshes follow existing
balance/hand events and foreground recovery. Account/club changes and overlapping
reads reject stale responses; failed or malformed money reads say unavailable.

Players Management reads one bounded batch for its visible financial rows using
the existing roster access function. The member record shows the same full
figure. Neither API exposes the underlying grant table. The promo-send sheet
states the lock terms before sending.

Validation: native PostgreSQL 17 applies the real migrations and exercises both
failing-before/passing-after credit cases, existing 50 rules and summary access.
Focused React tests verify the displayed figures, malformed responses, failed
reads, stale account/club responses and refresh ordering. Required provider gates,
installation and publication evidence belong to the owning task checkpoint.
