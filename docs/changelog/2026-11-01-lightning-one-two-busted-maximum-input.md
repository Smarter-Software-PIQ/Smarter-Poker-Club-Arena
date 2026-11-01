# Lightning 1/2 Busted Horse Maximum Input

The boundary executor previously returned whenever the optional cluster auto-rebuy
setting was off. Even when enabled, its database target could remain the initial
buy-in. That prevented the owner's mandatory 1/2 horse maximum input from reaching
the separate zero-stack funding door.

The host now carries its actual small blind as a cost-filter hint. Released,
busted 1/2 horses enter the existing single attempt per player/hand even when the
discretionary cluster setting is off. The existing database RPC independently
reads actual horse identity and cash anchor stake after session checks; caller
hints never authorize funding. Its mandatory request targets the full legal
maximum. A remaining hard session cap smaller than that request refuses it in
full. Count limits, responsible gaming, stop/disconnect, session/hand/reservation,
pending purchase, wallet, freeze, accounting and deterministic purchase identity
remain authoritative. Humans and other stakes retain their settings.

One forward migration replaces only the existing function body/signature. Two
exact-byte external proof declarations preserve immutable Phase 10/12 migration
history and all other responsible-gaming/helper bans. They accept the old body
only before installation and require the exact qualified forward body afterward.

Qualification: the missing host data/disabled-config path failed two cases
before the repair, then the full engine seam passed 24 tests. Resolver law
passed 26 cases; migration version/install/horse financial guards passed 20.
The isolated PostgreSQL harness retained all ten Phase 12 sections and passed
the added maximum, hard-guard and exact history/body proof cases. Root/server
compilers and 1,822 source pins passed. The native extension retains the
existing Phase 12 reload fixture boundary. Installation remains pending in
the existing owning checkpoint. Source tests, a merged migration and a staged image do not establish
production installation or natural live funded behavior.
