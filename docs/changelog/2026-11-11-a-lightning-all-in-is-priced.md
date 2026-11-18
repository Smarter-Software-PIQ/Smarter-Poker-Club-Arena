# A Lightning all-in is priced (2026-11-11)

Production alert 376656 (`StatsAllInEquityCoverageLow`, 96.69%): every Lightning all-in
runout was written to `ca_hand_facts` owed an equity and given none, because the
Lightning host never priced a runout and the facts builder only read the hub cache that a
physical table's `all_in_equity` event fills. The host now prices the runout at
`ALL_IN_RUNOUT` with the physical engine's own worker pool and options and hands the
result to the hand's facts. Evidence:
`docs/production-alerts/evidence/376656-lightning-all-in-equity/README.md`.
