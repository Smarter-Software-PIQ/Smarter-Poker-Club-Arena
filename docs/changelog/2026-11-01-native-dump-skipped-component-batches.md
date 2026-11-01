# Keep omitted components out of function batch boundaries

Capture41277332701 passed native export qualification and used157080 compact
diagnostic bytes, below the unchanged512KiB cap. It then exhausted the remaining
whole-capture deadline after13090 records:5110 functions complete,241 function
network requests complete,19.93seconds in those requests. No UI case ran and
private candidate cleanup completed.

The batch scanner previously stopped at a non-function object before checking
whether it had any selected components. Skip zero-component objects first,
just as the owning dump loop does. Preserve every selected non-function boundary,
function OID/result order, stock PREPARE/EXECUTE/rendering/ACL behavior, snapshot,
128-result/128MiB limits, TLS and original45-second whole-capture deadline.
This removes a needless transport boundary; it does not prove that all observed
fragmentation or the historical timeout came from omitted objects.

The actual C result contract now exercises129 alternating function/omitted
non-function entries and requires one request. It fails with the original
reader (exit97), passes with the correction, and retains all six valid sizes
and nine malformed/error/order refusal modes. The same contract is invoked
in required Linux native qualification. Native SQL-byte parity, cleanup and
a subsequent successful connected capture remain required;0/15cases are proven.
