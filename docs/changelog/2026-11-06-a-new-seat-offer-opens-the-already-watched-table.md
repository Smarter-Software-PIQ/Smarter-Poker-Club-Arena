# A new seat offer opens the already-watched table

Mikey reported remaining first on the PLO5 1/2 Madness waiting list while a
chair was visibly open. Production records show sixty-second reservations at
01:55:52 and 02:15:34 UTC on November 6 that expired without a buy-in. His
02:25:07 offer was purchased at 02:25:17 through ordinary play before this fix;
no player, queue, seat or wallet was manually changed by this task.

The client treated a table's first buy-in arrival as its only invitation for
the lifetime of that mounted table. If that admission returned waitlisted,
the latch stayed consumed. A later offer navigated to the same `?buyin=1`
URL, which the global listener could also discard as already open. The seat
was reserved in the database but the purchase sheet could remain closed.

The committed offer now travels with its reservation identity, player,
destination and expiry. The table consumes each live offer once after its
funding and authoritative roster arrive, closes the waiting-list modal and
opens the normal admission/buy-in path. A new offer remains actionable after
an earlier attempt or departure. Duplicate delivery and deadline extensions
do not open it again; expired, malformed, other-player and other-table offers
cannot fall through to the retained query string. Buy-in still requires the
player's confirmation and the existing server admission transaction.

An offer arriving before the earlier admission response also stays unconsumed
until that request settles. The request's own completion renders the pending
offer again, so the single-flight guard cannot silently discard it.

The regression failed on the original code. Tests execute the actual table
effect with React across same-table route updates, and the existing real
Supabase SDK/Phoenix fixture verifies delivery into that already-open route,
duplicate suppression, thaw, reload and expiry. Existing queue and buy-in
tests remain in the required client suite. This is a client change using
existing database and engine contracts; it needs no engine replacement.
