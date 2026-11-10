# Held-out qualification preflight validates the plan boundary without reserving a partition

Any run of the real held-out workflow permanently reserves its target's
partition under its family anchor, even when the plan job refuses, so drift
between protected main and a registered plan could only be checked by a
hand-run checklist before each dispatch. The qualification CLI now accepts
`--plan --preflight`: it executes the same validation the real plan job
executes - registered-plan validation, the protected source and closure
digests, read-only provider inventory, anchor, reservation-state and
family-history checks, and the local frozen-identity digests - skipping only
the assertions that the current process is itself a run of the real workflow.
It prints a single JSON verdict line and exits zero only when everything a
real plan job would check, minus self-run identity, passes.

A new manual workflow, Horse Feature Ablation Preflight Dry Run, runs the same
operations tests as the real plan job and then the preflight from the selected
protected-main revision. It cannot reserve a partition: reservation accounting
is scoped to the real workflow's id in the family's provider anchor and to runs
of the real workflow file, and the preflight workflow shares no concurrency
group, name or run-name shape with it. The real `--plan` and cell paths are
unchanged; every preflight branch is gated on the explicit flag.

Validation exercises the preflight against structural fixtures: a matching
closure, family and inventory admit; a tampered closure file, a family anchor
that does not match the real inventory, and an existing reservation of the
target partition each refuse with the provider's own reasons; and the CLI
without the flag still refuses outside the provider exactly as before. No
registry, seed family, provider route or held-out seed changes.
