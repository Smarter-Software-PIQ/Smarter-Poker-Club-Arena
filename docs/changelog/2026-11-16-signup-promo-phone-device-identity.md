# Signup promo phone and device identity

Part of the owner's authorized Promo Play Through programme. The signup gift
keeps its existing lifetime award receipt and original idempotent credit door.
After programme activation, the credit transaction also reserves the account's
first server-verified phone and all known browser/app-install IDs. A unique
constraint prevents another account from using either identity. A refused gift
rolls back every reservation, including when the payment door returns a refusal.

The profile verification event records a private hash of the verified phone.
Later profile phone edits cannot replace that identity. Unverified or unknown
identities do not receive the free gift; signup, verification and play remain
available. Existing accounts without a captured verification need to confirm
their phone again for this gift. There is no retroactive award or lock. Browser
install identity uses the existing authenticated device sightings, with their
existing limitation that clearing browser storage creates a new install ID.
Phone uniqueness remains an independent durable guard.

The profile trigger requires the declared daily maintenance DDL window. The
feature stays inactive until the programme's go-live setting is set. There is
no new schedule, payment pipeline, campaign counter or repair process.

Verification: isolated PostgreSQL applies the real migration, compiles the
byte-bound current signup owner and runs its actual modified credit block.
Tests cover missing identity, duplicates, rollback, replay, concurrent claims,
profile edits and browser permissions. The credit door is an idempotent native
fixture; unrelated delivery emails and digest queries are outside this test.
Live installation and a natural gift receipt remain separate requirements.
