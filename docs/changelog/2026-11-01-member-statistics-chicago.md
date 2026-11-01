# Member statistics use Chicago calendar dates

The Member Management ledger and linked Player Statistics previously interpreted date-only filters at UTC midnight, including activity from the preceding Chicago evening. Both now use America/Chicago with IANA daylight-saving rules. Relative date presets and visible-page rollover follow Chicago midnight; date-only links retain their selected dates.

The reporting migration preserves the UTC aggregates and subtracts only partial-day timestamped edges. Cash fees, tournament fee receipts, jackpot and tournament results, transfers and downline fees use the same half-open Chicago window. Existing funded-club attribution, launch cutoff, business fee-counting cutoff, fixed redemption timestamps, standing-share rules, Overall totals, and access rules remain in place. No wallet, ledger or engine writes.

Validation: client date/DST regression and isolated PostgreSQL 17 executing captured installed RPCs and the migration. The old query reproduces the UTC mismatch; candidate covers ordinary days, spring 23-hour days, the 25-hour November 1 day, open bounds, fee shares/redemptions, and authorization. Publication and installation evidence are recorded in CHECKPOINT-stats-chicago.md.
