# Preserve one qualified generated control cache before strict admission

The protected read of failed intake 41316608416-1 observed canonical control
303d8cc7d38a97c3bcdc32a577b555232ad726bf with all 32 protected files exact and
`__pycache__` as its sole extra directory. The installer now checks only that
known generation under its existing engine/source locks before invoking its
unchanged strict validator. Other generations and unknown entries remain refused.

The packaged helper revalidates the exact manifest, protocol and every protected
source hash against immutable Git with inherited Git routing removed, lazy fetch
disabled and optional locks disabled. Only bounded regular, owned, non-writable
Python caches matching the current CPython tag/magic, source header and exact
marshal serialization of compiled protected source qualify. It never unmarshals
or executes cache contents. Positive native fixtures use CPython's actual cache
writer rather than manufacturing expected payloads.

A Linux `renameat2(RENAME_NOREPLACE)` preserves the complete cache in a private,
same-filesystem quarantine bound to the original control, owning run and entry
hashes. Its durable intent precedes the rename. Exact postchecks precede the
receipt and strict generation admission. An interrupted original run can verify
its exact intent/archive and save the original disposition once; a saved receipt
is returned unchanged. Unknown intents, recreated caches and prior refusals never
start another move or overwrite evidence.

Precommit races refuse without moving the cache. A root writer racing the final
check/rename cannot be excluded absolutely: the atomic rename can preserve its
changed cache, after which postchecks refuse and retain all moved bytes, intent
and bounded difference evidence. No control activation follows that refusal.
There is no rollback overwrite, unknown-file deletion, retry loop, lease, new
freeze or engine signal. Mac qualification uses its native exclusive-rename
primitive only for disposable files; required Linux CI must qualify the actual
Linux primitive. Local source tests are not live installation proof.
