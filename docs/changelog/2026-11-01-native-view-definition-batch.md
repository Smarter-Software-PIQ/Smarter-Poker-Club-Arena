# Bounded selected view definition metadata

Capture9 reached the unchanged schema-export deadline after101 view-definition
requests consumed7.869s. This establishes a relevant roundtrip cost, not an exact
historical root cause or a predicted saving. The earlier successful capture8 used
the same native binary but did not publish comparable subtype timings.

Batch only selected ordinary non-dummy views and materialized-view definition
SELECTs, preserving exact query/deparse/session/snapshot and stock render order,
ACLs and options. Deferred rules and unknown callers retain stock singletons.
Function, sequence and view caches share one total128-result/128MiB bound; an
occupied sibling cache forces a checked singleton. TYPE_NAME, sequence DATA,
D5 tags/events and512KiB/100000-record/45-second limits are unchanged.

The existing native qualification now covers135 views/materialized views,
including129 ordinary definitions, circular dummy/deferred views, quoted
cross-schema options/ACLs, exclusions and zero/one filters. The many-view cohort
requires exactly two network requests for130 definitions. The v4 capability binds
the new helper and requires actual SQL parity, dummy/deferred and compiled stock
singleton RED versus bounded reader GREEN; old receipts refuse. C faults include
result shape/null/empty/count/ordinal/caps, three-reader interleaving, partial
exit and SIGINT.

Local compiled stock/candidatePG17.11 SQL output matched in ten private Unix-only
cohorts; the cluster/data/socket were removed. This is Mac qualification, not
Linux/provider or connected capture proof. Focused Node22 tests and Python11
tests passed, root TypeScript passed, source inverse and1822 binding pins passed.
Protected delivery, actual Linux qualification and the original15 connected
cases remain separate required gates; no production query or retry was performed.
