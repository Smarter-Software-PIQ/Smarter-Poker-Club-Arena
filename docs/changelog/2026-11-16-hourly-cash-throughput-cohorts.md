# Cash throughput history follows the adopted hourly admission policy

The new hourly cash table caps, paced arrivals and hand-boundary closures change
the planned population independently of the existing occupancy curve and Lightning
arrival function. Neither previous fingerprint included those inputs, allowing
relative throughput to compare different admission policies as the same cohort.

The actual admission and closure RPC client and existing work-schedule health
evidence now share an explicit hourly policy contract. The existing catalog-only
policy RPC preserves its original base fingerprint and supplies a separate
fingerprint of all twelve hourly policy and directly connected guard definitions.
The collector selects the matching contract. It separates the newly adopting
engine before the first close activates caps, recognizes migration-first operation
and rollback to the exact original3529 policy, and fails closed on missing or
unknown fields. It does not include instance IDs, current hours or observed seats.

No population targets, admission enablement, financial operations, rate thresholds,
three-day baseline minimum or absolute silence protection changes. The original
population curve fingerprint remains unchanged. The original service-only RPC is
replaced atomically under its exact predecessor guard because PostgreSQL cannot
add OUT columns with CREATE OR REPLACE. The replacement refuses changed ownership,
ACLs, effective browser privileges or unreviewed source and explicitly retains
the postgres owner, stable definer metadata and service-only grant.

The maintained collector regression fails against the previous consumer and passes
with the adopted contract. The existing native hourly caps qualification also
installs the real producer and checks all twelve changed or missing definitions,
actual cap-curve and pacing changes, old base preservation and stable identity
across activation and rollback. Existing cap and closure tests remain in that same
CI path; no workflow or scheduler is added.

The shared protocol retains literal RpcName exports so the existing engine-door
extractor continues to discover both admission and closure prerequisites. The
actual consumer imports and re-exports those constants; no parser, workflow or
allowlist changes. A real extractor regression fails before and passes after.

The separate capacity census introduced by the later human-expansion migration
is also a required definition. Mutating that helper alone, without changing
its caller, reproduces the remaining gap before the twelfth input is included.
