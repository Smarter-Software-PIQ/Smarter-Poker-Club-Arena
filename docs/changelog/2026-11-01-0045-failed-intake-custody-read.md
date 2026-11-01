# Closed custody read for the failed 0045 intake

The existing scoped recovery reader now admits only `intake_staging_records` for
run `41339482095-1`, target/control
`0045d4c8a536c2b43259b3f400b5a8e7b0f8a33d`. The earlier installer failure
occurred after durable intake acknowledgement. A successful generic cleanup step
cannot prove remote staging removal: that deletion requires release completion.

This mode reads the maintained five-field intake intent/request, the existing
later release-result and activation-entry records, three exact systemd units,
and four fixed public staged source files. It reports missing and unproved
custody separately, verifies source hashes and directory/file ownership/modes,
and requires stable before/after file/directory identities and unit snapshots.
Under the verified root-owned 0700 per-run stage, writable public files or inner
directories report only actual modes and an owner-qualified boolean; their bytes
are not read or hashed. Private request/intent records still require strict 0600.
There is no intake-result producer; the export explicitly says `not_produced`.
No actor, request URL, raw result, source text, environment or arbitrary path is
exported. The mode cannot touch Inspector, Docker, health, business data,
cleanup, retry or release state. It does not certify current cleanup.

Each file is bounded to 64 KiB. Each systemctl metadata-only child has a one-second
read deadline and 2 KiB stdout cap with kill/drain; the operation has a 20-second
budget inside the existing 30-second transport and 4 KiB export bounds.
Existing modes and original fixed native scale bindings remain unchanged.

Qualification: 153 native Python cases pass locally, with four existing Linux-only
cases unavailable on macOS. Twelve added cases cover actual filesystem custody,
real hardlinked intake serialization, binding/refusal, source pins, stable reads,
export tampering and actual child timeout drainage. Linux execution without skips
remains a required hosted proof. The original systemctl source guard now names
exactly three metadata-only `show` property sets instead of two. No host read,
provider dispatch or cleanup was performed by this source preparation.

Policy receipt: canonical reader 2026-11-01T19:10:53.917Z, v2.9,
manifest `7c7f308e580f0e2b9170085bb3a454c89ff7234627570c74ab68f5e7846b5b52`.

Follow-up review preserves service-only fields for services and reads only the
five generic Unit properties for the path unit. The [systemd 255 D-Bus contract](https://www.freedesktop.org/software/systemd/man/255/org.freedesktop.systemd1.html)
places MainPID and ExecMainStatus on Service, while path objects also expose the
generic Unit interface. A real child regression supplies the five-property path
reply without service fields. Missing generic fields remain unproved. The
closed original-source pins are independently retained literals, so the required
production reader tests also work in the existing shallow main checkout.
