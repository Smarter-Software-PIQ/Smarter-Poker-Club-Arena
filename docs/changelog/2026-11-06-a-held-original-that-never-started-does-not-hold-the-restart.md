# A Held Original That Never Started Does Not Hold The Restart (2026-11-06)

## What was stuck

Sunday Deep Stack Satellite 30 (a2a2c981, table 72417d9c, permit b7c07f7c,
hand 55620681) and Satellite 25 (fbb86b2a, table aed78e3f, hand 55430351) each
held an original that was reserved but never started: permit reserved, no
evidence, no hand snapshot, no hand history, no cards, no chips. The qualifier
boundary waited for every table to park, the held table never could, and the
satellites froze. #9560 and #9615 fix this inside the engine, but neither could
go live: release 42139090188-1 backed out with cards_in_air 11, and the serving
engine reported cards_in_air 2 at every break.

## Cause

The release certificate (`maintenance_certificate` in
`server/scripts/engine-release-transaction.sh`) refuses any `cards_in_air`
reason. A held original that never started is reported by the serving build
as cards_in_air, so the release that carries the rule that parks it can never
cut over: the fix waits on itself.

## Fix

`cards_in_air` is counted separately and handed to the drained-boundary
witness only (`engine-release-inflight-hands.py --drained-predecessor`, the
witness already used for the eed06fe5 drained cutover). It must prove no
tournament hand is moving, no incomplete snapshot was written in the 120 s
window and no recent Lightning hand is unsettled, with the engine's own
`handsInFlightTotal` present and zero. Only its exit 0 admits. Inside a
certified countdown nothing is dealt, so a cards_in_air table with nothing
moving holds no hand in the air, and a held original resumes from its durable
continuation on the successor. cards_in_air is not added to `BOUNDED_ONLY`,
the plain database branch still never admits it, and every non-bounded reason
beside it still refuses.

## Law

`tests/a-held-original-that-never-started-does-not-hold-the-restart.law.test.ts`
