# 2026-11-10 - A Bad Booking Cannot Merge

The owner window `2026-11-10-owner-asap-engine-0440z` ran its pull request checks while its `playerNoticeAt` 2026-11-10T04:20:00Z was still in the future, then merged to main at 04:43:28Z - after its own notice instant. From that moment `scripts/ci/check-owner-window-notice-after-merge.mjs` (the 2026-11-07 "a booking cannot start in the past" rule, which judges every booked window against the moment it merged) failed inside "TypeScript compilation and repository checks" on every pull request in the repository, because main itself held the broken record. One bad booking record turned the required "TypeScript Check" red repo-wide.

`scripts/ci/check-owner-window-booking.mjs` now validates the booking in the booking pull request itself. It diffs `server/release/owner-maintenance-windows.json` against the pull request base and judges only the records the change ADDS or CHANGES (in `windows` and `databaseWindows` both):

- `playerNoticeAt`, `notBefore` and `notAfter` are required ISO timestamps;
- `playerNoticeAt` and `notBefore` must be at or after validation time, with a five-minute tolerance so an in-flight pull request does not flake while its checks run;
- `notBefore` is not before `playerNoticeAt`, and `notAfter` is after `notBefore`;
- a `certifiedRecoveryProfile` record (the certified emergency path) stays exempt, as in both existing booking laws.

Unchanged records are immutable history and are never re-judged, so a bad record that already reached main cannot turn this gate red on unrelated pull requests - that failure mode belongs to the after-merge backstop alone. The backstop stays exactly as it was: it is what catches a booking whose checks ran green before its notice instant and merged after it, and it still refuses tonight's record.

The gate runs as a step of "TypeScript compilation and repository checks" (the job whose success the required "TypeScript Check" asserts through `scripts/ci/fixture-native-gate.mjs`), before dependency install, with no dependencies of its own, together with its regression test:

- `tests/operations/owner-window-booking-gate.test.mjs` - tonight's exact record fails at its real merge instant; a future-dated booking passes; unchanged and merely reordered historical records are ignored; an edited historical record is re-judged; tolerance, ordering and structural boundaries; `databaseWindows` parity; the certified recovery exemption; the wiring of this very step; and the after-merge backstop's unchanged behavior.

Fail-before proof, run on the real repository: with the base set to the parent of merge `7019bbee1d78` (the 0440z booking), `node scripts/ci/check-owner-window-booking.mjs` exits 1 naming both the past `playerNoticeAt` and the past `notBefore`; tonight's record could not have merged through this gate at its merge instant.

Known limit, stated plainly: a pull request whose checks run while the notice is still minutes ahead and which merges after the notice instant passes this gate at check time, exactly as tonight. The gate closes the record-shape door (backdated or past notices, inverted ranges, broken structure) at booking time; the after-merge check remains the authority on the merge instant itself.
