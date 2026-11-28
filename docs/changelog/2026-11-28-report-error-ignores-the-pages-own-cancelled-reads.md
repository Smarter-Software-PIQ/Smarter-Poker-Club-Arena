# The error reporter ignores the page's own cancelled reads

A reload or navigation away cancels every fetch still in flight, and each
loader's catch block receives "Failed to fetch" / "Load failed" / an
AbortError. #12264 taught one loader (MemberAssignAgent) to recognise that
through `src/lib/leavingDocument.ts`; every other loader on the player record
(transaction history, stats and the rest), and everywhere else in the app,
still logged its own cancellation as an error on reload.

`reportError` now decides it once, for every caller: a code-less transport
failure that arrives while the document is leaving (`beforeunload`, then
`pagehide`, until `pageshow`) is not reported. A network loss on a page that
is staying, and any error carrying a server code, still report exactly as
before.

- `src/utils/errorReporter.ts`: the check at the top of `reportError`.
- `tests/unit/reportErrorIgnoresThePagesOwnCancelledReads.test.ts`: dropped
  while leaving (three browser spellings), still reported while staying,
  server errors still reported while leaving, reported again after `pageshow`.
- `scripts/ci/entry-chunk.d/fix-report-error-ignores-the-pages-own-cancelled-reads.json`:
  `leavingDocument.ts` (about 90 lines, no imports) joins first paint with the
  reporter, so its listeners are registered before the first read.
