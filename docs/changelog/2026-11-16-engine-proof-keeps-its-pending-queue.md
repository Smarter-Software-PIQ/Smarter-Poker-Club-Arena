# The sealed engine keeps its pending verification

The exact engine event for sealed release43980481360-1 passed its provenance and gameplay checks, but GitHub canceled live-table job133702100338 before a runner executed any step: a higher-priority waiting request already owned the ordinary publication queue. Newer client publications can replace that queue's single pending job, so an immutable engine proof could disappear without testing the released engine.

Use the existing independent observation-queue pattern for a repository dispatch whose publication gate admitted a full engine SHA. Keep it in one static engine group, preserving serialization, fresh scoped principals, read-only table cases, exact serving identity and cleanup. Existing passive observation priorities and ordinary publication retargeting remain unchanged; stateful client browser checks retain their shared group. This changes verification ownership, not engine activation or its safeguards.

The maintained concurrency test evaluates the actual workflow expression and models the pending-slot displacement: it fails before the change, then proves ordinary publications replace only ordinary pending work while the admitted engine proof survives. No release, retry loop, publisher or schedule is added. A finite verification of the same sealed engine follows protected publication of this configuration; no engine replacement is needed.

Protected main independently corrected the required native Data fixture to qualify both retained UTC source dates for its fixed Pacific day. This delivery preserves that correction and its refusal assertions; production coverage rules are unchanged.

The native Pacific fixture qualifies its adjacent UTC source once. Its missing-source refusal runs immediately before that first load; the later public-screen assertion still runs afterward. This preserves the negative coverage check when concurrent fixture changes are integrated.
