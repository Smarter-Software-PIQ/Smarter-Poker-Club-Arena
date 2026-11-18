# tests/member-ledger-starts-on-today.law.test.ts

Owner direction November 11, 2026: every visit to the member Ledger Window defaults both From and To to the current day in America/Chicago. Leaving the page discards its range selection. Previously saved ranges must not restore.

Protection: `tests/components/playerCommandMetricScope.test.tsx` exercises the real component, including a saved old range and a return after Chicago midnight. `tests/e2e/production-club-members.spec.ts` checks the published page after confirming historical dates, router navigation and reload. The same law refuses any expectation in that spec of the Overall caption unless the spec pressed Overall first (stale expectations from #10579 failed Post-Deploy E2E, alert 371597).
