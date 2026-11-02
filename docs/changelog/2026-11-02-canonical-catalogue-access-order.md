# Canonical catalogue ACCESS ordering

Capture 29 retained exact keyed ACL rows but refused their different array
ordering. Read-only metadata identified ICU en-US production collation and a
default-collated computed kind expression; both isolated bootstraps use C.

The shared producer/observer now orders the three ACCESS identity keys with
explicit C collation. It preserves every row, permission, owner, canonical
JSONB encoding, original digest, restore mapping and strict parity assertion.
No database setting or production object changes.

The maintained query-contract regression requires the explicit ordering without
filters or dropped fields. Genuine PostgreSQL17 cross-locale qualification,
current-head native CI, protected merge, normal publication and a changed
full-schema/fifteen-case run remain required evidence. No connected pass is
claimed by this changelog.
