# Bound actual native dump phase receipt timing

Actual41249622418 reached its existing export deadline at32760ms. Its last
recognized static marker was READING_DEPENDENCY_DATA. Native transport passed,
SIGINT was accepted and child close observed, but server cancellation ACK remains
unknown. Private cleanup completed. No full-schema or connected case passed.

Official PG17 source places dependency retrieval before additional ACL reads,
object sorting and object-definition generation. Later encoding, standard-string
and search-path markers include parameters which the prior static parser ignored.
Thus the earlier receipt cannot identify a slow dependency query. Function dump
source also prepares a catalogue query once and executes it per function; that
source fact alone proves no production timing or root cause.

The existing bounded stderr stream now records each closed phase's first observed
complete line with elapsed monotonic receipt time. Entries are unique, capped by
the fixed phase set and copied through a strict numeric/enum sanitizer. No raw
parameter, query, OID, name or SQL is retained in the receipt. Exact parameterized
post-sort markers map only to fixed phase names. Search-path format recognition
uses a linear scanner with an8192-character limit, avoiding nested regex work. Chunk-fragment assembly remains
within the existing64KiB private stderr cap and is cleared on every outcome.
Timing is reception of a progress line, not query completion or server ACK.

No native binary patch, per-object query probe, database activity witness, route,
timeout, ACL/schema omission, credential or readiness change is introduced. Source:
https://github.com/postgres/postgres/blob/REL_17_11/src/bin/pg_dump/pg_dump.c
All14 original cases and the active owner's additional history case remain
unproved; both fresh scenes must use the same verified immutable component tuple.
