# Genuine Realtime empty-selection migration

Capture 15's first differing native block was the retained subscription filter. Its captured function source exactly matches the genuine upstream migration 20260827120000, shipped in Realtime v2.134.11 (official release commit 5d8f423d7b5ce82a0be88f8859a831c07f1282c2, fix 8c0386cebe7a0518710f2058aec487f4d8202c1b). The old v2.134.10 fixture predates that migration.

Pin the official v2.134.11 immutable image, use its release paths and require its complete 83-entry tenant migration set, maximum 20260827120000, with sorted-version MD5 262da2efb4aa494a7d90cf451fc9cce5. Keep the separate control database, genuine service migration/seed operations and both authoritative catalog readbacks. No migration row or function definition is fabricated.

This corrects the proven filter-version mismatch only. Other schema block, default and privilege mismatches remain separately qualified; no production managed schema is changed and no exact composition check is relaxed. Local launcher/readback tests are not hosted native execution, complete schema readiness or the 15 connected UI cases.
