# Preserve the reason a failed-cycle unit observation is unknown

The actual read at 2026-11-01T23:34:27Z proved the original refusal, source
bindings, empty release service and inactive intake path. Its intake service was
unknown. The reader had collapsed command failure, decoding, property validation
and process enumeration refusal into the same all-null packet, so that packet
could not establish which prerequisite failed.

The existing fixed reader now emits only a closed phase/reason pair. It separates
metadata read/decode/fields/state/source/PID validation from process enumeration
read/decode/shape validation. A successful observation is `complete/observed`;
unqualified source is `source/source_unproved`. The packet is version 2 and its
strict validator rejects old packets, unknown codes, inconsistent status pairs,
process phases for path units and native phases without qualified source.

No native command, source authority, read deadline, filesystem/process proof,
stable second read, or retry permission changes. Every unknown retains null proof
fields and unknown cgroup state. No raw native output, error text, PID, arbitrary
path or new probe is exported. A missing or collected unit never becomes empty
by inference. This diagnostic is not owner resolution or cleanup authority.

Regression coverage remains inside the existing 167 cases and fifteen-second
wrapper, including native command errors, malformed metadata/process replies,
private error suppression and packet-forgery refusals. The peer's generic
transaction byte-hash assertion and independent foreign historical-source refusal
are preserved. No historical source archive is carried by this branch.

Local validation: the six existing custody cases passed, then all 167 cases
passed through the unchanged fifteen-second wrapper (6.49 seconds inside Vitest;
7.56 seconds total). All 1,822 source pins passed. AST comparison independently
confirmed both native command calls, arguments, deadlines and bounds are
unchanged. This Python reader/test/documentation change has no compiler input;
no duplicate application build was run. Hosted/current-source readback remains
required before claiming the intake service's actual failure phase.
