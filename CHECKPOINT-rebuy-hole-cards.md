# Tournament rebuy leaves the player without cards, 2026-11-10

Owner chat: Claude session 01BNteGbPgYYJ4bSdZa8mgdn (one owner message, 08:22 America/Chicago).
Scope: verify MichaelJordan's report from Monday Night Turbo (purchases and the hands he says he could not see), find the cause, fix it at the root and pin it. Client only, no engine change, no engine window. No chips moved.
Policies: root `CLAUDE.md` and `PUBLISHING.md` read in this session; the Mac canonical copies under `/Users/smarter.poker/Documents` were not readable (folder access refused).

## Findings

Recorded with their rows in `docs/changelog/2026-11-10-a-rebuy-is-taking-a-seat-again.md`: entry, two rebuys and one add-on (20 each, 80 in all); three clock-forced folds directly after the first rebuy; no forced fold after the second.

## Cause and fix

`onConfirmRebuy` in `src/pages/TablePage.tsx` restored the seat without clearing `leftSeatPendingRef`, which the bust had set through `applySeatRemoved`. The receipt now clears it and stamps the seat time.

## Local evidence before push

- `tests/a-rebuy-is-taking-a-seat-again.law.test.ts`: 6 of 6 pass; 4 of 6 fail on the page before the change.
- With it: `tests/law-registry.law.test.ts`, `tests/the-hero-always-holds-the-cards-they-were-dealt.law.test.ts`, `tests/unit/tournamentSeatCardArrival.test.ts`, `tests/unit/expiredSeatClears.test.ts`: 1,560 tests pass.
- `npx tsc --noEmit -p .`: no errors. Prettier and ESLint clean on the changed files.

## Limits

- Not reproduced in a browser against a live tournament (it would spend real chips, CLAUDE.md 11.5). The test runs the page's own functions, not a mounted page.
- Which of the two callers of `applySeatRemoved` set the latch on his page was not recorded; both end in the same state and the fix does not depend on which.
