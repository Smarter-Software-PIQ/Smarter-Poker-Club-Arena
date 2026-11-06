# A fresh stopped bank capture retains its cancelled preparation

A dealer correctly rewinds `handCount` when an attempted hand never starts and
releases that original permit through `fn_f06_cancel_prepared_hand`. Its stopped
bank capture then names the last completed hand. Mixed custody compared that
number with every permit, including the newer, acknowledged cancellation, and
refused the fresh original with `F06_STOPPED_BANK_ORIGINAL_CHANGED`.

`ServerTableEngineBase` now retains the exact successful cancellation binding and
copies it into the immutable bank capture after the original dealing writer has
joined. A lost acknowledgement retains the original permit and its positively
fenced cancellation intent instead of declaring success. SQL admits that intent
only when the exact immutable cancellation receipt proves its commit; an intent
whose RPC never committed remains refused. The forward migration
keeps the all-permit high-water fence: a capture may bridge only its exact local
watermark, with matching immutable preparation cancellation receipts for every
intervening permit under the same event, generation, lifecycle and allocator.
Later permits, other owners, missing receipts and changed completed hands still
refuse. Banks and completed-hand identity are unchanged. The frozen retained-hand
attestation predicate is unchanged; its later-permit refusal remains necessary.

The real dealer/permit/stop regression failed before the producer change. The
maintained native stopped-bank fixture, using the actual cancellation RPC, also
failed against the original SQL predicate. Focused current-source qualification
uses the existing historical native dependencies and the captured production
snapshot function, validates installation preimage/postimage and owner/ACL,
exercises multiple cancellations and rejection controls, and transfers the same
seven-second bank through native successor admission, completion and replay.
The new qualifier runs in the existing required F06 native route; no repair loop,
new publisher or production synthetic operation is introduced.

Local runtime tests and both TypeScript checks passed. Full maintained native
qualification and protected delivery are recorded in the owning task checkpoint.
This change does not establish the exact failing predicate for the historical
September 26 logs, which did not preserve the caller payload. It is not a claim
of installation, engine adoption or observed production handoff.
