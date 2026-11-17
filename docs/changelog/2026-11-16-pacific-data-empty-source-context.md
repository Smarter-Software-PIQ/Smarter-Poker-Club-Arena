# Restored Pacific source context is nullable

The rake callback restores its custom source setting to an empty string. An adjacent SQL boolean guard did not make later UUID casts safe: PostgreSQL could evaluate the indexed lookup first and append a reporting failure during an ordinary non-rake fact or hand callback.

Both aggregate writers now normalize the setting with `nullif` at every UUID cast under exact installed-definition guards. Existing totals, original writers and service-role access remain intact. The attachment transaction barrier advances so a qualified finite rebuild includes older in-flight callbacks and their failure receipts; original attachment dates remain unchanged.

Native PostgreSQL reproduces the original empty-context failure, installs the correction, then invokes both ordinary callbacks after the rake wrapper restored its context. The correction adds no UUID failure and preserves exact aggregate fee, participant and club-hand increments. No production failure receipt is manually deleted.
