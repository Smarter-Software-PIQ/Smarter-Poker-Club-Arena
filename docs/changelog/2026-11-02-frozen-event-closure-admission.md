# Additional frozen tournament closure admission

The November 1 owner request to remove all frozen events identified 19 stale events outside the existing reviewed170 closure manifest. The operator controller rejected those IDs before any network request, preventing their use of the maintained settlement and retirement path.

The additional manifest records exactly those 19 IDs, their observed last-hand timestamps, the source inventory SHA-256, and stable UUIDv5 operation IDs under the requesting chat's namespace. The original170 manifest and every existing operation ID remain unchanged. Equal-share actions select exactly one reviewed cohort and its recorded reason. Historical recovery and refund actions retain their original scope. No events are discovered or added dynamically.

The same controller still requires current sealed engine identity, live lease generation, acknowledged physical boundaries, a matching financial snapshot, rollback preview, canonical economic receipt validation and final runtime retirement. A merge does not request a stop or move money. The operator must recheck that an additional event remains stuck and has not naturally completed before its explicit request; existing ownership refuses competing requests atomically.

Changed source: `.github/scripts/tournament-original-recovery-control.mjs` original intent selection around lines200–260 and the equal-request reason around line650; the existing manual workflow describes both exact cohorts. No engine, database, payout formula, start hold or recurring job changed.

Validation: the additional-cohort regression failed before implementation with `Exact Original Recovery Identity Required`; after implementation all83 existing and new controller tests pass. The new test exercises all19 through admission, rollback preview and settlement receipts with an isolated transport, rejects changed generations and refuses their use of historical refund actions. Production settlement and removal remain pending; these tests do not certify a live payment or release.
