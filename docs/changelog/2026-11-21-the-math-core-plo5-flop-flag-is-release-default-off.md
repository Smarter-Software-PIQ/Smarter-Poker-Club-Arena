# The math core's PLO5 flop flag is classified release default off (2026-11-21)

`omahaMathCorePlo5Flop` moves from "decided by code" to `OPTION_SWITCH_RELEASE_DEFAULT_OFF`. Nothing changes for a decision: every read of the flag is `=== true`, so unset was and is off, and the flag alone is inert without `omahaMathCore`.

- **Why.** The option registry refuses the `shadow` state for an option whose release default is decided by code, and `on_shadow` then behaves exactly like `on`. Classified, the flag can take a `shadow` row: the Horse acts as today and the staged re-decision with the core is only recorded.
- **Database.** One generated switch-list migration (`20261121094723`) re-asserts the lists with the flag added to the shadow-capable options. No row is written by it.
- **Not an activation.** No switch row exists for any math core option. Rows are written by the lead only, after the core follow-up serves and its latency is re-measured on the serving build.
