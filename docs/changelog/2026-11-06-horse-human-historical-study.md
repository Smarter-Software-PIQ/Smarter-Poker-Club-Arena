# Private historical Horse review tooling

Historical review needs a reconciled hand population and original decision
inputs before it can support strategy changes. The new explicit offline
commands acquire receipted read-only sources, preserve exclusions by account
identity, separate game/rule/tournament contexts, and produce a private
hand-by-hand JSONL, readable per-street Markdown and indexed SQLite review artifacts.

Every recorded Horse decision retains prior public actions, available own
cards, the captured legal menu, actual execution origin and explicit missing
evidence. An independent Omaha high/low reference and exhaustive opposing-pair
high ceiling distinguish weak full houses from unbeatable holdings. Review
candidates carry legal alternatives and an implementation manifest naming the
existing policy owners and outstanding qualification/delivery evidence.

The maintained client-unit route runs the Python regression suite and compares
the independent reference with the production high/low evaluators on physical
deals. Source digest corruption, duplicate/orphan records, outcome leakage,
current-day batches, game boundaries and incomplete qualification are covered.

This is research tooling, not a live policy or strategy qualification. It does
not activate corrections, write production rows, infer missing private cards,
or certify complete historical coverage. Raw artifacts remain private and are
not included in the repository. Usage and qualification boundaries are in
`scripts/ops/HORSE-HUMAN-STUDY.md`.

The existing complaint replay dropped secondary boards, dead/individual ante
contributions, sitting-out flag combinations and captured deduction rules. It
now preserves those original public fields without inventing missing canonical
worker inputs. A regression failed on the omitted second board before the fix
and passes through the library and CLI afterward. Replay verdicts now identify
the checked-out-source, memory-disabled diagnostic and unavailable policy paths;
they do not claim original-runtime reproduction, strategic correctness or live
adoption. This library is consumed by offline measurement commands and tests,
not the serving action path.
