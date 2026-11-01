# Compact native export diagnostic wire

Capture41317855423 exhausted the unchanged512KiB diagnostic bound after43680
admitted records. D4 replaces repeated per-record headers/newlines with one
2-byte stream header and8-byte records. It preserves every event, tag, sequence
and microsecond timestamp, existing100000-record/45-second bounds and all SQL,
snapshot, ACL and metadata batching behavior. Legacy D1/D2/D3 decode remains.
The admitted43680-event prefix needs349442bytes in D4; total future capture size
and completion remain unproved.

Source-bound capability now requires D4-header2-record8. Actual compiled C
output must pass both independent decoders, including exact cap boundaries,
all closed subtypes, partial/corrupt frames, pairs and original refusal paths.
Old native manifests cannot certify the new transport.
