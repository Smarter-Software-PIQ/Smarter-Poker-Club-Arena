# Fit complete export diagnostics inside the existing channel cap

Capture41274039798 passed catalogue and read-only snapshot transport, then
refused TOTAL_BYTES at524289 bytes after17487 fixed-enum records. It retained
524271 admitted bytes and zero UI cases; private cleanup completed.

Replace only the verbose diagnostic wire with fixed12-byte D2 records: magic,
unsigned sequence, closed kind/edge/type tag, monotonic microseconds, terminator.
The Node consumer and credential-free Python qualifier decode the same exact
values. Keep legacy D1 reading, every cost/count/pair/order/time assertion and
512KiB/100000records/45seconds. Do not change SQL, selected schema, batching,
TLS, transactions, export deadlines or cleanup. No raw identifier or SQL enters
the channel. Native SQL-byte parity remains required before another capture.

Validation:46 focused Node/parser/dump-consumer tests pass, including40000
typed edges (480000bytes), partial frames, legacy-equivalent counters and
invalid tags/order/times. A compiled actual C producer is consumed by both
independent decoders. That same regression fails with the original producer;
the qualified C file was restored byte-for-byte afterward (SHA256
99f47dc8323125178a654566b1e2cbc43be48d8e8ae8c4224a3a635977ddb574).
Native full-source inverse, SQL-byte parity and fixture cleanup remain required
provider checks. No subsequent capture has been dispatched.
