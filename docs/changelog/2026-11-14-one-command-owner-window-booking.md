# One-command owner window booking

Booking an off-cycle owner engine window was a 14-file hand edit (`docs/ENGINE-OWNER-WINDOW-CUTOVER-PLAYBOOK.md`, step 4). The November 14 booking was made with a throwaway script that hardcoded the previous window, its line numbers in the floor suite and the digests of the window before it.

`scripts/release/book-owner-engine-window.py` now does the whole edit. It takes the new window id, serving predecessor, content minimum, the three instants, the owner order, a changelog slug, the dated summary paragraph and the changelog body. It reads the current window id, predecessor and expiry from the release controls, computes every new file in memory, and writes all of them or none.

It refuses, writing nothing, when: the id is already booked; the notice lead is under 20 minutes; `notBefore` is outside 330 to 2940 seconds past the hour; the window is shorter than 420 seconds or longer than the floor policy's 21600; `notAfter` is not before the next 03:30 America/Chicago after `notBefore` (zoneinfo, so daylight time is handled); a SHA is not 40 hex; the owner order lacks a phrase the booking test pins or the predecessor SHA; the release controls disagree about the current window; or an expected occurrence count differs (the transaction script must name the current id 4 times and its predecessor 2 times).

The floor suite edit is structural, not by line number: the test that binds `floor.NOV7_OWNER_ID` is found by that assertion and demoted to literal digests; each test function is rewritten on its own, shifting `windows['windows'][-N]` by one until a `.pop()` chain starts and extending each chain; the new window's test is generated and named from the window id. The player notice file is rendered the same way as `scripts/generate-owner-maintenance-notices.mjs`, and the command first proves its rendering reproduces the committed file.

After writing, the command runs `tests/operations/engine-activation-floor.test.py` and prints PASS or FAIL; a failure exits 1. `--dry-run` prints the plan only. `--laws` also runs the three TypeScript laws.

Not automated: when the new notice overlaps a notice still being shown, earlier cases in `tests/a-booked-window-gives-players-notice.law.test.ts` may assert the opposite; the command warns and writes a narrower case, and the law must be run and edited by hand.

Proof is `tests/operations/book-owner-engine-window.test.py`, run by `tests/an-owner-engine-window-is-booked-by-one-command.law.test.ts`: it books one synthetic window and then a second on top of it in a disposable copy, runs the real floor suite after each, and exercises each refusal. No guard, reserve, existing window or runtime behaviour changes.
