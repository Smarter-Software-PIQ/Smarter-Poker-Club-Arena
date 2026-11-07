# Purchase ownership proof separates preference writes

The late purchase response unit proof used one sequential mock and total call count for all RPCs. Selecting Tables also saves a page preference after a debounce, so a legitimate preference write could consume a purchase response or make two purchases appear to be three.

The fixture now routes purchase promises by RPC and requesting account, returns the actual applied-results shape for preference saves, and counts only purchase RPCs. It deliberately flushes the real pending tab preference while both purchases remain unresolved. All stale-account no-effect, busy-state, appearance, toast and request-identity assertions remain.

Controlled interleaving reproduces the old two-versus-three count failure before the fixture correction. No product source or production data changes. Hosted publication remains required.
