# Owner-ordered engine cutover without advance player notice, November 17, 2026

At 11:05 Chicago November 17 the owner assigned Claude session `session_01BNteGaEWc6gWKEopygU5zs` as dedicated engine custodian for the next qualified cutover and ordered, verbatim:

> For this release, execute the earliest qualified engine cutover without an advance player-warning announcement or notice countdown. Preserve safe hand completion, settlement, certification, admission, recovery and live verification.

This books the single-use owner engine window `2026-11-17-owner-no-notice-engine-2330z` with `scripts/release/book-owner-engine-window.py --no-advance-notice` (see `docs/changelog/2026-11-17-one-engine-release-without-advance-player-notice.md` for the mode):

- No `playerNoticeAt`, no client banner, no invented notice time. The window carries `ownerNoticeWaiver` with the owner's exact sentence.
- Admission 23:30 UTC November 17 through fixed 05:20 UTC November 18 (17:30 to 23:20 Chicago November 17).
- Predecessor: `28372c9a1750934d1c39839bc551b050da6f4b8d`. Content minimum: `ba6a272537260ff35f516a58fac20346d1f6423a` (#11183, Omaha Wave B).
- The custodian starts one Stage operation for the certified candidate containing everything merged through protected review before this booking merges. An item not merged by then is not delivered by this release.
- Hands still finish: the serving engine announces the last hand, every table completes and settles its hand, then the freeze begins. Certification (current-schema Backup copy, 1800-second soak), admission, the 285 s reserve, rollback, seal, thaw and post-seal Backup are unchanged.
- No guard, reserve, runtime strategy or SQL bytes change. No strategy option is switched on or off. horsePlayStyles, Pillar 2, R7/R8, leak maps and held-out datasets stay disabled. No migration rides the window.
