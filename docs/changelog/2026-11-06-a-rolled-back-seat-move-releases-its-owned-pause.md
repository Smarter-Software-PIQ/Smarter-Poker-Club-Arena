# A rolled-back seat move releases its owned pause

The 45-day PostgreSQL error census found 15 `55P03` records in the canonical
seat-move call chain. These are refusals, not fifteen independently proven
freezes. The caller at `tournamentSeatMoveRpc.ts:232` nevertheless treated lock
refusal, deadlock, serialization rollback and permission refusal as lost
responses. With no receipt, the real manager retained the request and source
pause, blocking later move planning.

Reuse `isRolledBackStatementError`, the existing transaction-response contract,
in the original move caller. Keep PostgREST's two pre-execution routing refusals,
the two identical attempts, receipt verification and request identity. A prior
unknown response remains unknown even after a definite refusal. Connection,
resource, cancellation, system and internal errors remain uncertain. The
manager's existing finally releases only its own move pause; retained break
custody remains independent. No database mutation, compensation or new timer.

Verification: nine new assertions failed before the correction (five transport,
four actual-manager boundary cases); 49 controls passed. After the correction,
88 tests across five focused suites pass, including prior-unknown identities,
uncertain SQLSTATE classes, mismatched receipts and pause ownership. The tests
exercise the actual manager and transport with controlled RPC responses; they
do not claim a production move or complete native transaction execution.
Existing required engine tests enforce these regressions. Source bindings:
1839 pins pass. Root/server compiler and protected publication are recorded in
the owning checkpoint; source verification is not serving-engine proof.
