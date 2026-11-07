# Exercise the scheduled Afternoon Free Buy guarantee in PostgreSQL

The native Midway rotation check now attempts to build a zero-guarantee PKO in an Afternoon slot promising a 500-chip All-In Or Fold event. It installs the production schedule classifier and guard migration. It verifies that both a bad insert and a later bad update raise the specific schedule constraint and leave the stored rows intact. A correct 500-chip event is admitted, and a started event keeps the terms its entrants played under when its schedule link is restored.

The same isolated check continues to exercise Horse and human registration funding and ledger conservation. It runs through the existing tournament registration funding check. This change adds test coverage and makes no production data changes.
