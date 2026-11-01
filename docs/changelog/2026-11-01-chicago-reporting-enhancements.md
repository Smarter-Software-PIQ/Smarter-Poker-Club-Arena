# Chicago Reporting Enhancements

Member ledger and performance screens share Club Data and Union Data's cached Chicago calendar. Date controls explain that DST is automatic. Calendar rollover remains based on the next local midnight; custom windows remain fixed.

The native reporting regression now overlays later migration definitions before running the actual RPC assertions. Its history scanner ignores comments and strings and refuses unqualified drops/renames. Multi-week, cutoff and open-ended fee windows compare against raw receipts.

A read-only live 30-day measurement found the fee helper took35.076 seconds scanning all raw receipts. The replacement uses existing UTC daily totals and subtracts only the partial timestamp edges, retaining standing-share rounding, fixed redemption timestamps, fee eligibility and Overall. The candidate SELECT plan took15.294 milliseconds; exact totals matched in one snapshot. Publication and installed verification are recorded in CHECKPOINT-stats-chicago.md.
