# 2026-11-11: horse tables are counted per variant

`HorseBrainVariantSilent` paged for plo8 at 04:32 UTC (row 376529) because the PLO8 Hi-Lo
Turbo completed at 04:02 and closed its last table. Nothing had failed. The rule could not
see whether the variant still had a table.

The engine now emits `poker_tables_with_horses_by_variant{variant}`. It counts live tables
with at least one horse holding chips, using the policy ledger's own variant label, and is
seeded at 0. The rule will be gated on it in a follow-up once an engine with this gauge is
serving.

Evidence: `docs/production-alerts/evidence/horse-brain-variant-silent-376529/README.md`.
