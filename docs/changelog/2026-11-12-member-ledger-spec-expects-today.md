# Member ledger production spec expects today, not Overall

#10579 moved the member Ledger Window default to today's Chicago day but left two
`Recorded Activity` caption expectations in `tests/e2e/production-club-members.spec.ts`,
so Post-Deploy E2E failed every run (alert 371597, item 2). Both now expect the applied
today range, and `tests/member-ledger-starts-on-today.law.test.ts` refuses an Overall
expectation that is not preceded by pressing Overall.
