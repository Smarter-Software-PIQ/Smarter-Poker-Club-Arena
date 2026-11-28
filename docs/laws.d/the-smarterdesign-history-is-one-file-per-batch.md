# tests/the-smarterdesign-history-is-one-file-per-batch.law.test.ts

The #SmarterDesign batch history is one file per batch in `docs/club-operations/smarterdesign-history.d/YYYY-MM-DD-<batch>.md` (a real date, a lowercase slug, a level-two heading first, no conflict markers), printed in order by `scripts/smarterdesign-history.mjs`, so two lanes never conflict on it; the retired shared SMARTERDESIGN-HISTORY.md must not come back (`--rescue <slug>` moves a lane's lines into its own file during the merge).
