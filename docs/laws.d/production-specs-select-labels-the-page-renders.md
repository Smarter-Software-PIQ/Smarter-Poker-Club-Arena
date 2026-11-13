# tests/production-specs-select-labels-the-page-renders.law.test.ts

Every `[aria-label="..."]` selector in a `tests/e2e/production-*.spec.ts` file names a label the client source can render (a quoted literal or a `${...} suffix` template). A renamed or removed label turns the law red in Client Unit Tests before Post-Deploy E2E fails on production (alert 371597, #10290's Table Studio ledger).
