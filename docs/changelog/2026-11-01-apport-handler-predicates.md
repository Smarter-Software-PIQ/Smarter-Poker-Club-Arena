# Qualify the Apport handler predicates and log refusal

The protected context reader's live observation 41331470409 found the current root process in a Docker system-slice cgroup. The exact reviewed handler treats that cgroup as host-handling even with different namespaces. Its bounded current-owner core store was empty, while the trusted log-tail read returned unknown without identifying which read prerequisite failed. These facts do not identify the crashed process or its native callsite.

The same existing four-second observation now recognizes only canonical kernel-placeholder arguments for the exact Apport handler. It exports a closed profile and placeholder-presence booleans, never arguments. Duplicate options, literal values and unsupported forms remain unsupported. The namespace model remains conditional and does not assert actual forwarding.

A fixed no-follow, root-owned, non-writable, bounded and stable read hashes the canonical installed fileutils source. The core-store lookup now additionally requires the reviewed fileutils digest. That establishes the reviewed source default only; handler environment overrides and actual crash ownership remain unproven. No configuration, source text or core contents leave the reader.

Log refusal now has a closed reason such as missing, untrusted ancestry/file, changed read, bound or I/O failure. The existing trusted bounded tail may count additional exact handler early-exit messages without exporting text, command lines, identifiers or paths. Counts remain unattributed and nonexhaustive. Trust checks, two one-second Docker inspections, the half-second package query and the outer four-second deadline remain unchanged. There is no new subprocess, host write, capture mechanism or runtime change.

The maintained Python actual-command fixture covers supported and unsupported argument forms, missing/mismatched/untrusted fileutils, every closed log refusal and exact early-exit categories, plus malformed private export refusal. This is diagnostic qualification, not a native-crash repair or release certificate.
