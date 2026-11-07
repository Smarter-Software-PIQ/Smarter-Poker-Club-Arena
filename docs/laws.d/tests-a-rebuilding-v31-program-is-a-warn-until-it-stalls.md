# tests/a-rebuilding-v31-program-is-a-warn-until-it-stalls.law.test.ts

On 2026-11-07 Dan delegated the V31 restart-or-park decision with both solver
hosts on; it was decided RESTART as R8 (the plan Dan approved on 2026-11-06),
superseding the 13:06 UTC park. While no certified dataset is active,
gto_v31_program_state 'rebuilding' makes fn_audit_gto_v31_certified report one
warn naming the latest progress of every stage, and a Critical
(certified_v31_rebuild_stalled) once no stage has moved for stall_after (72 h).
Serving with no active dataset is a Critical in every state, counted on open
bindings only. certified_v31_missing stays for any other state.
