# Certified recovery keeps its exact millisecond announcement

The release caller serialized a millisecond announcement such as `.076` as
`.076000Z`. The installed registration RPC intentionally accepts at most three
fractional digits, so that request was refused before registration. The caller
now uses one integer-based UTC millisecond serializer for registration and its
terminal/refusal proof queries. The instant, operation identity, strict SQL
validation, one-POST rule, and unknown-outcome handling remain intact.

The existing private PostgreSQL qualification now invokes the maintained Python
caller against the unchanged service-role registration and proof RPCs. The old
caller reproduces `CERTIFIED_RECOVERY_REQUEST_INVALID` with `.076000Z`; the fixed
caller registers `.001`, `.076`, `.999`, and `.000`, preserves exact epoch
milliseconds and its durable request, and reads replay without a second POST.
The same SQL still rejects six fractional digits. Only transport, private clock,
and the root-owned file boundary are adapted for the unprivileged local fixture.
The existing publisher contract suite also uses a fractional announcement and
checks exact round trips plus rejection of non-integer serializer inputs.

This change requires the normal protected release-control delivery. It does not
modify an installed migration or retry the current production operation.
