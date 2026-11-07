# Natural add-on observer page-exit classification

The real spectator client sends a best-effort `/away` beacon during reload and teardown. The natural add-on observer now records and aborts that incidental request separately instead of failing its participation verdict. Suppression requires the exact HTTPS engine origin, POST `/away` without query parameters, a valid reserved observer ID, and a body containing only the exact observed table ID.

The beacon is never forwarded. The existing forbidden-participation classifier, financial RPC and table-write guards, socket guard, full-minute admission, real reconnect, counter increment and cleanup assertions remain unchanged. Malformed, foreign-table and extended-payload requests do not qualify for suppression. Focused regressions cover those boundaries and the route's abort-before-return behavior.
