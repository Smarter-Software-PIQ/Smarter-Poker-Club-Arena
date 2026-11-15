# The source-window law reads only files that can hold an offender (2026-11-15)

`tests/unit/noFixedSizeSourceWindows.test.ts` read all of about 6,000 test files one by one. On the shared Mac SSD, with other lanes' gates running (load 20-46), that took 30-92 s and timed out its 30 s budget. Every pre-push on the Mac then blocked on it: Lightning at 14:33Z, and Hand Analysis at 14:51Z and 15:15Z, each with every other test green.

An offender is a `.slice(` window in a suite that reads source (`readFileSync`), so a file without both strings cannot be one. The law now asks `git grep` (parallel, fixed strings, NUL-separated names; tracked and untracked files that are not gitignored; the same directories skipped) for the files holding both, and applies its unchanged rules to exactly those. It fails closed: without git, on a non-zero exit, when git writes anything to stderr (it skips an unreadable file with a warning and still exits 0), or when the search does not return the law file itself (which always holds both strings, so a search that misses it is broken), it falls back to the full scan.

Equivalence on today's tree: 1,612 files hold both strings by a full scan, and git grep returns exactly those 1,612, none missing and none extra. Time: 2.6 s at load 30. The budget is not raised and no rule changes; the scheduled CI job and the pull-request route are untouched.
