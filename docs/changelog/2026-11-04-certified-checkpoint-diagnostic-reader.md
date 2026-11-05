# Certified checkpoint diagnostics stay readable

The retained-refusal reader rejected the certified EED checkpoint's 320-second
budget before it could return the original failure evidence. It now recognizes
`eed-240s-certified-release-v1` only for the full qualified EED predecessor,
with the producer's 320-second total and 260000-millisecond work bounds.
Unknown diagnostic values remain unknown. The exact final certified producer
hashes are admitted, with the previous pair retained for historical receipts.
Existing profiles, private-file custody, read-only projection and invocation
binding retain their checks.

Four focused regressions cover retained-file read/export without writes, wrong
or missing predecessor identity, invalid allocations, and unchanged ordinary
profile bounds. The retained-file case fails against the previous reader at
`invalid bounded diagnostic shell state`. The existing required wrapper now
expects all 196 reader cases, including the prior 192. Qualification and source
integration do not establish installation or live engine activation.
