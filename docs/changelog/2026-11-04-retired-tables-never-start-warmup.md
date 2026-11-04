# Retired tables never start warmup

A bookmarked table can reach `PersistentTableLayer` before the lazy route boundary. Its warmup started roster reads and an engine subscription even when that boundary subsequently removed the retired table. `warmTable` now refuses the existing exact retired-table cohort before preload, roster, token, socket, cache, or timer work. The persistent layer remains dynamically loaded and ordinary table warmup is unchanged.

The regression invokes the real warmup entry point with lowercase and uppercase retired IDs. Both cases failed before the source correction; existing ordinary-table warmup cases passed. After the correction, both retired cases and ordinary-table cases pass.

The bookmark observer now attributes outgoing socket activity only to `engine.smarter.poker`, matching its HTTP observation scope. It still observes per-table URLs and every outgoing multiplexed or legacy engine frame containing the retired ID. Diagnostic labels retain the engine origin and a sanitized route category, without credentials, query strings, or payloads. The earlier live artifact recorded only `table subscription`: its socket origin is UNKNOWN and no trace establishes attribution. The source warmup path is independently reproducible.

This client change does not establish financial settlement or engine retirement. Protected publication and live bookmark verification remain required.
