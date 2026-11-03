# Orphan priority exhaustion preserves ordinary admission

The exhausted-orphan alert now describes the actual discovery behavior: the priority lane stops after its existing failure cap, while ordinary budgeted admission remains eligible after cooldown. It no longer asserts that player seats or dealers were observed by this lease-only check. No admission cap, backoff, retry lane or payment behavior changes.

A connected regression runs GameServer.discoverRunningResumes after five recorded failures. During cooldown it admits nothing; after cooldown it offers the event to the existing admission owner. Both cases check the actual alert and once-per-streak deduplication. The two message assertions fail on the previous source; the existing priority cap remains covered independently.
