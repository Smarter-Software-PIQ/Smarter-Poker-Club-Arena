# Midway weekly proposal review and booking status

Schedule edits now have a maintained, read-only validation and full change-preview
workflow before source publication. Stable spreadsheet IDs preserve event identity;
invalid or ambiguous inputs are refused. The preview includes affected booked
contracts and recorded chip, ticket and satellite-seat refund impact without
moving funds. Required native CI invokes the validator and review regressions.

Creation qualification now uses production column defaults, NOT NULL and CHECK
constraints and actual relevant creation normalizers in trigger order, replacing
permissive inferred schema and capacity mocks. Its exclusions remain explicit.

The spreadsheet separates recurring-definition verification from actual booking
status and next published start, with an as-of timestamp. No prices, tournament
terms, running games, wallets, engine code or scheduled jobs change in this phase.

Required CI exposed two existing date-sensitive qualification fixtures at UTC
midnight. The tournament-pin test now fixes only its Date clock at local noon;
the isolated hand-review test separates atomic-publication data from retention
data, so historical receipts cannot age into a later case's zero-prune assertion.
The original retention fixture reproduces 31/32 checks, while isolation passes
32/32 with both production migration hashes unchanged. No product logic changes.
