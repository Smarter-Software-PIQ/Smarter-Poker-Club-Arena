# The monitoring publisher installs its read-only emitter

The cash admission-policy SQL producer is installed, but its collector update
was only installed by an engine-control release. The collector already lives
outside that control generation and uses its own existing one-minute read-only
timer. Waiting for an engine replacement to publish these database gauges is
an unnecessary delivery dependency.

The existing Deploy Monitoring workflow now carries the authoritative collector
in its protected-main freshness check, checksum manifest and shipped payload.
After validating that payload and the host release predecessor, deploy.sh installs
the exact emitter atomically at its existing stable path. The installer uses the
same source lock as engine-control installation. It verifies the existing timer
is active and the existing oneshot points to that slot. It creates or modifies
no unit, schedule, credential or engine control, and does not start or stop a
service. The next existing collection reads the new file.

The workflow verifies the installed predecessor against protected source ancestry.
The installer compares that digest again under the source lock, allowing an exact
idempotent candidate but refusing a different intervening writer. It checks shell
syntax, fsyncs the staged bytes and destination directory, and verifies the result.
Unknown source, busy ownership, wrong unit wiring or an invalid candidate refuses
publication rather than changing another writer's result.

The retained monitoring deployment law checks the emitter is in every payload
boundary and before consumer reload. Its native Python fixture covers atomic
installation and exact replay, competing ownership, an advanced predecessor,
wrong service type/path, inactive timer, symlink refusal and malformed shell.
The payload assertion fails against the previous workflow and passes here.

After protected merge, follow the original Deploy Monitoring run and read its
receipt, installed file hash and naturally refreshed policy metrics. Verify the
engine's serving SHA and instance remain unchanged. Once the producer is visible,
PR #10590 may publish the same-policy consumer through that same monitoring route.
This does not activate the tournament or socket fixes inside the engine; those
retain their certified maintenance requirement.
