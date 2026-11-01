# Native filtered dependency fixture

Stock PostgreSQL17.11 reproduced the existing function-first fixture in the
order sequence, dependent function, independent function, sequence. Its required
independent-function-before-sequence assertion therefore failed. Rename that
synthetic independent function to aa_free so stock alphabetical function ordering
produces function, sequence, dependent function, sequence. Preserve all original
SQL equality, ordering, ACL and shared-cache assertions.

Closed qualification phases distinguish main/filtered dump I/O, exit, wire,
frame checks, each filter parity/order and three negative FD checks. No private
SQL, errors, names, identifiers or paths enter receipts. Failure phases retain
the first captured value. Actual Linux qualification remains required.
