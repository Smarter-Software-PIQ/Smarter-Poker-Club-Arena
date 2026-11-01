# Lossless native diagnostic capacity

Capture41320525372 exhausted512KiB after65535 D4 events at21.077seconds.
D5 keeps every absolute event sequence, tag and microsecond timestamp while
encoding the62 valid tags and absolute17-bit sequence in3 bytes, followed by a
canonical1–4-byte timestamp delta. Reserved tags/bits, gaps, overlong values,
partial records and existing pair/time/record bounds refuse. D1/D2/D3/D4 remain
decodable. SQL, snapshots, ACLs, batching and all existing caps remain unchanged.

For100000 events across the full45-million-microsecond clock, the conservative
whole-stream bound is502769bytes, below524288. A real compiled near-worst
100000-event/45-second fixture produced501982 D5 bytes and passed both independent
decoders; the exact original D4 C producer emitted800002bytes and both refused.
Native qualification requires the new source-bound D5 wire and explicit full
capacity/absolute-event proof. Connected capture and15-case behavior remain
separate unproved gates.
