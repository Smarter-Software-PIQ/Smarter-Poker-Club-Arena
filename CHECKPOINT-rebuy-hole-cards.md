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
- First hosted run on head `521e8803` failed `Client Unit Tests shard 2`: `tests/unit/mobileLobbyAndLeaveRealtime.test.tsx` pinned exactly two latch clears on the page. That pin is what this change replaces; it now requires three and names the rebuy receipt. All 272 test files that read `src/pages/TablePage.tsx` then pass locally (4,501 tests).
- `npx tsc --noEmit -p .`: no errors. Prettier and ESLint clean on the changed files.

## Limits

- Not reproduced in a browser against a live tournament (it would spend real chips, CLAUDE.md 11.5). The test runs the page's own functions, not a mounted page.
- Which of the two callers of `applySeatRemoved` set the latch on his page was not recorded; both end in the same state and the fix does not depend on which.

## 2026-11-11 continuation

- Owner direction (this chat, 03:34 and 07:10 Chicago): own #10335 through merge, publication and live verification; browser fixture for bust, paid rebuy, seat restoration and card delivery; no real chips; keep compensation separate and unissued.
- Mac policy read through Counselors `host_terminal` (`~/Documents/AGENTS.md` v2.9); folder grant denial respected.
- The shared probe blocker was repaired on main by #10353; main merged into the branch, harness updated for the cash bust-rebuy setters #10325 added. Head `1031a08f` green on all required checks.
- Browser fixture added (see changelog). Chromium 10/10 fixed; cases 1-4 fail on unfixed main (defect witness passes). WebKit case 1 not stable; gate is Chromium only.
- Found and recorded, not fixed: the tournament rebuy offer is dismissed by the engine's own seat exit depending on arrival order.
- Compensation: proposed 20 chips for rebuy 1, not issued pending the owner's choice.
