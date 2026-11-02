# Private-safe exact native schema mismatch witness

Capture 14 reached exact service composition and refused a same-key, same-owner native block whose raw hash differed. The sanitized failure previously could not identify the differing block.

The existing comparator now retains up to 16 diagnostic rows behind its private Error identity and descriptor checks: native ordinal, key SHA256, closed object/schema tags, same-owner boolean, block SHA256 values, byte sizes and first differing byte offset. Unknown tags become OTHER. Names, owner strings, SQL, raw lines and error messages are not exported. Total/truncation distinguishes a bounded sample from all mismatches. The existing Python receipt reader validates every key, type, digest and bound within 16 KiB and returns UNKNOWN for invalid diagnostics.

Every exact key, owner and raw block equality requirement remains unchanged. This is diagnostic source only: it neither repairs the mismatching definition nor establishes schema readiness, product acceptance or any executed UI case. The immutable original tuple and existing provider route remain unchanged.
