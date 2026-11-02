# Bounded native type-name reads

Capture24 cleared the earlier catalogue-read timeout, then stopped at its native
dump deadline. Its retained diagnostics show105 completed type-name requests
taking8.278302seconds; they do not identify the final unfinished query's cause.

The pinned PostgreSQL17.11 reader batches at most128 exact type-name queries from
selected native function and aggregate signatures. Results populate the existing
TypeInfo cache and are cleared immediately, preserving stock SQL rendering,
snapshot, zero-OID behavior and the shared result/byte limits. No deadline,
server setting, schema exclusion or retry is added.

The maintained native qualification and v5 capability bind the helper, actual
stock SQL parity, request-count regression and mixed-cache boundaries. Hosted
qualification, a changed protected capture, full-schema restore and all fifteen
connected cases remain required; this note is not evidence that they passed.

The excluded cohort retains the existing zero-function enum while excluding all
type-name consumers. It must produce genuine object/query diagnostic frames,
preserve exact stock SQL, issue zero type-name requests and contain no excluded
type or function. Empty diagnostic streams remain refused.
