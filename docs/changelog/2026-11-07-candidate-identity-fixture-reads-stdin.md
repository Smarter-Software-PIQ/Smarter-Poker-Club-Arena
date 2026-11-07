# Candidate identity fixture consumes its input

The required client publication check could reject its valid candidate fixture because its mocked health reader exited without reading the producer pipe. Under pipefail, consumer-first scheduling can turn that closed pipe into a failed identity read. The real health reader consumes JSON.

The fixture now drains stdin before returning its controlled fields. The existing identity cases deliberately delay the producer to exercise this ordering, retaining exact-candidate success and wrong-label, health and version refusals. Runtime custody, pipefail and all backup or engine operations are unchanged.
