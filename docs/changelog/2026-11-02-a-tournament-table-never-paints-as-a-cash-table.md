# A tournament table never paints as a cash table on reconnect

Date: 2026-11-02.

After the 05:54:50 UTC engine restart, the Sunday Funday Late PKO table remounted with `isTournament: false` for a moment, until its `tables` row loaded. For that moment its top seats took the cash-game seat position, and jam_degen was drawn sitting on the felt.

A table id never changes kind. `src/lib/tableKindMemory.ts` remembers the kind once the row has loaded, keeping it in memory and in sessionStorage with every storage access guarded. `TablePage` uses that memory for its first paint. A table it has never seen still waits for the row, exactly as before.

Pinned by `tests/unit/tableKindMemory.test.ts`.
