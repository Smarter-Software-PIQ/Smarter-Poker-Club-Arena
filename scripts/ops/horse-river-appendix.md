# PLO river opportunity appendix

Generate a private appendix from a completed, hash-bound Horse study batch:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/ops/horse_river_appendix.py \
  --review /Volumes/SmarterArchives/agent-evidence/extreme-archive/YOUR-TASK/review \
  --output /Volumes/SmarterArchives/agent-evidence/extreme-archive/YOUR-TASK/river-opportunities
```

Or append `--river-opportunities` to the existing `horse-study-report.py --source ... --output ...` command. This creates `river-opportunities/` inside the new report after its base summary is finalized. The appendix binds that unchanged summary and decisions file by SHA-256. Future cutoff batches use the same route. No data acquisition, runtime activation or production write is performed by this appendix.

Inputs and output parent must be real, owner-private directories (0700); the output must not already exist. The CLI validates the source decision digest and refuses a source that changes during generation. Files are private (0600). Use authorized SSD paths. Output contains `per-decision-opportunities.jsonl.gz`, `individual-opportunity-reviews.md.gz` and `summary.json` with hashes and exact rule-context counts.

Coverage includes every known-own-card PLO4/5/6/8 river decision, including records with unavailable public nodes or evaluated ranks, which remain explicitly unknown. FLO8 and other variants are outside this appendix. Existing own ranks, high ceilings and suit-blocker diagnostics are reused. The maintained module does not depend on private supplemental low certificates or rerun rank enumerations. PLO8 own low facts remain available from the study review, while opposing low/share models remain unbound.

Each captured-bound candidate size uses incremental risk `B = raiseTo - heroStreetWager`, not the raise-to amount. It preserves cash/tournament, variant, Lightning/table, ante, asset and tournament stage/paid-place geometry. A diamond amount remains diamonds. Exact-context summaries do not combine these contexts. Sitting-out and folded seats are excluded from opponents; all-in opponents cannot supply fold equity.

The displayed `F_all > B/(P+B)` threshold assumes all B is matched whenever anyone continues, zero final share on continuation, no added future wager and no costs. `F_all` is the joint event that all opponents fold, not any individual's fold rate. Short calls/uncalled returns need their actual matched risk. If closing check has value Q, the analogous threshold is `(B+Q)/(P+B)`; Q is unknown. A positive conditional raise-versus-fold expression does not establish raising better than calling. Later actors, multiway dependence, split-low sharing, side pots, deductions and tournament prize utility remain explicit missing inputs.

No actual action is labeled a bluff; no fold probabilities, ranges, EV verdicts or optimal sizes are generated. Every record retains null bluff/recommendation fields, unresolved strategy verdict and false activation/GTO flags. These diagnostics organize what a response model must establish; they do not constitute that model.

Focused checks:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/ops -p test_horse_river_appendix.py -v
```

The existing Horse study test wrapper discovers this Python test. It covers raise risk, short-call assumptions, context/unknown preservation, outcome exclusion, private CLI input integrity and the real study CLI attachment path.
