# Read the fixed private original input without widening native job permissions

Capture 41365381288 stopped before private schema capture or native compilation:
the original-input reader returned its generic API refusal. The actual job token
had Actions read and Contents read. That old error did not retain the failing
route/status, so it cannot by itself establish which API rejected the request.
GitHub documents that draft-release visibility requires push access:
https://docs.github.com/en/rest/releases/releases#list-releases . The fixed draft
carrier still exists with the original asset; publishing it would violate its
privacy and would not be the repair.

Only the protected manual Schema Integrity Audit caller receives a new, isolated
GET-only input-read job with Contents write and Actions read. It checks out the
exact protected source without persistent credentials, receives no database
secret, installs no dependencies, and never runs application/schema/native or
candidate code. Its existing fixed reader admits the exact original run and
historical artifact metadata, requires the original API's positive 404, verifies
the unchanged unpublished draft/asset/uploader and original ZIP size/hash, then
rechecks carrier metadata. The job uploads those exact raw ZIP bytes and a closed
receipt as an immutable, one-day artifact in the same run/attempt.

The commonly reused native workflow retains Contents read and Actions read for
both PR and connected callers. Its protected caller supplies only the new job's
artifact-ID output. A pinned official download action receives that single
current-run artifact; there is no run/repository selector or credential override.
Before private capture, the input step adopts only the two owned regular files
through no-follow descriptors into mode 0600 after Actions normalizes permissions.
The reader then validates exact membership, protected caller,
repository, source, run and attempt; immutable historical metadata; original
source-run facts; the producer's admitted retention evidence; and raw ZIP bytes.
The same original bytes are rechecked/copied at their existing consumer. Current
run transfer provenance is recorded separately from original build provenance.
The receipt records the producer's observation, not a claim that a later release
state was independently reread by the native job.

The original artifact/run/SHA, 193,214,432-byte ZIP and SHA256
0646a9647cffb7d23d57c92bb0a0ae1e47ab7f6259eaf3a4ca54e41aa959cf0e
are unchanged. The repository remains public and the carrier remains an
unpublished draft; no release/asset update, new credential, personal identity,
publication path or production write is introduced. API errors now expose only
a closed fixed-route label and HTTP status, never error text or response bodies.

Local counterpart qualification used the genuinely retained original ZIP:
producer staging, current-run receipt admission and the consumer's exact copy
all passed with unchanged pins. Provider metadata was fixture data, not a new
Actions-access certificate. Nine focused retention tests cover context/attempt
mismatch, forged receipts, changed bytes, symlinks, API errors and token-free
redirects. Actual hosted transfer and all 15 connected UI cases remain pending.

Final local checks: TypeScript `--noEmit` passed; both maintained workflow/source
contract files passed all 726 cases; connected-driver tests passed all 12 and
native smoke-runner tests all 30. All 1,822 source pins and canonical policy
integrity passed. The added workflow assertions require the three actively
containing source bindings to carry the new test-file hash, plus two updated
child-binding hashes. Only those five source identities and explanatory audits
change; no financial SQL, fixture populations, assertions, historical evidence
or qualification state is restamped. The unrelated Schema Integrity Audit jobs
and their comments remain byte-identical to the protected base.

The first normal push refused the separate cash-native input manifest before expensive suites: its active test-file size/hash still referred to the base. Updated only that active identity with a source-only audit; all other manifest fields and historical qualification remain unchanged.
