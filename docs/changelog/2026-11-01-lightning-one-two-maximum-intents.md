# Lightning 1/2 Horse Maximum Intents

The pooled horse input previously required the legacy seat opt-in and omitted
small-blind metadata when pricing top-ups. The Classic 1/2 maximum policy could
therefore never reach Lightning, and its variant filter excluded other games.

The horse input now reads the actual anchor's cash/stake metadata and requests
the full legal maximum gap for every 1/2 horse through the unchanged original
Lightning top-up intent. Unknown/noncash metadata does not create this intent.
Inactive seats, zero stacks, unknown funding and insufficient full-gap wallets
remain refused. Other stakes retain their existing behavior. Each horse retains
its own hand/player idempotency key, session and funding path; requests remain
independent and concurrent. Zero-stack rebuys are a separate delivery.

Focused qualification: seven new cases failed against unchanged production,
then both suites passed 18 tests after the repair. Root and server TypeScript
compilers passed. The existing isolated PostgreSQL original-intent/funding qualification passed
81 assertions. Source bindings passed 1,822 pins and canonical policy parity
passed. Protected provider checks remain pending in the owning checkpoint. Source qualification
alone does not establish production installation or natural funded behavior.
