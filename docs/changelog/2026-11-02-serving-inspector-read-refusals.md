# Preserve the failed boundary of the current-serving inspector read

The explicit kernel-only audit returned only `serving_role/evidence_unavailable` on run 41388457679. Its outer exception handler discarded the boundary that failed, preventing the recovery owner from distinguishing container, health, image, process and final binding evidence failures.

The existing reader now retains fixed reviewed stage and error codes in its existing sanitized refusal protocol. Commands, privileges, the shared eight-second deadline, current-runtime checks, optional kernel unknown semantics and response schema remain unchanged. It adds no Inspector connection, cleanup, retry or release authority. Original-operation history audit 41388295152 independently failed at `inspector_history/command_deadline`; this change does not certify that Inspector as closed.

Regression covers each initial and final evidence boundary, deadline and changed identity, sanitized transport round trips, and rejection of unreviewed fields/codes. The lost-boundary test fails on the preceding source. Production readback remains pending protected delivery; cleanup and the BB blind-level behavior still require separate proof.
