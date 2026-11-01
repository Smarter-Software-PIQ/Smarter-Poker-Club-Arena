# Horse measurement kit and pre-activation baselines (2026-11-01)

Commits the read-only measurement tools and the "before" baselines used for the
2026-10-31 / 2026-11-01 Hold'em horse work (V61-V74, rule 4), which until now
lived only in an ephemeral agent container:
`scripts/horse-measure/` (tools + README with the recorded preflop baselines)
and `docs/horse-measure/` (baseline reports, raw MCP results, and the
decision-engine checkpoint logs of 2026-10-30 and 2026-10-31). Every tool only
emits SELECT statements. No runtime code changes.
