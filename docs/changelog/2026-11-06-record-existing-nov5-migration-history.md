# Restore the installed November 5 migration history

The migration ledger gate on PR #9712 found nine installed November 5 versions absent from both repository indexes; the first two crossed the existing 24-hour grace period. These files recover the exact SQL from production migration history, with no added header or newline. The existing recording manifest binds all nine file hashes to `fn_ca_migration_text` results.

This change records already executed SQL. It does not install, replay, invoke or approve the historical payout, message or scheduled operations. The original files were absent from protected main when checked; no corresponding open recording PR was found. The installation caller is not established by migration history alone.

Read-only verification: all nine history hashes match; the live definer-exposure audit has no matching finding; the live undeclared-money-trigger reader has no matching finding. The relaunch/announcement award runners and receipt readers/writers deny browser execution. The owner announcement entry point and aggregate reach reader retain their existing authenticated access; campaign triggers deny browser execution. Existing source recording verification and regression suites remain authoritative. No checks, grace periods, credentials or production data are changed.

The all-files periodic-work regression was applying the new-migration comment rule to byte-exact historical recordings, unlike its maintained CLI, which already partitions recordings. It now recognizes only hash-matched manifest recordings; legacy prose and changed or unknown bytes remain strict. A changed-schedule regression pins that boundary. This does not authorize or invoke any historical schedule.

The installable-file regression likewise keeps existing unwrapped recording bytes intact through the hash-matched recording classifier, without extending either closed grandfather list. Ordinary and edited migrations still need the unchanged transaction envelope; the installer is unchanged and installed versions are never replayed.

The historical post-commit watchdog has source-wide alert suppression. The detector continues to identify that defect explicitly in a regression; only verified immutable recording bytes are excluded from the forward-introduction scan, consistent with the recording classifier. This records the installed defect, does not certify or replay it, and does not change its live behavior. Changed or unknown SQL still fails the guard.
