# Exact Ubuntu perf package qualification before host repair

The protected prerequisite read41356746716 proved `/usr/bin/perf` absent on
Ubuntu24.04, kernel6.8.0-147-generic. Existing readelf/systemd-run were available.
The actual engine remains unchanged; missing perf is not the native crash cause.

The first necessary qualification uses real Ubuntu24 APT in the existing
profiling workflow's isolated PR job. It requests only version6.8.0-147.147 of
linux-tools-common, linux-tools-6.8.0-147 and its generic package. The exact public
DEBs' control archives have no maintainer scripts. Runtime dependency versions,
installed hook/trigger behavior and the actual solver closure still require the
real Linux qualification. No production package profile is fabricated from a
Mac or from upstream source versions.

A closed plan parser rejects upgrades, removals, critical new libraries,
unknown dependencies, wrong tools versions, incomplete configuration and
ambiguous totals. The disposable fixture preserves normal APT hooks and uses
NEEDRESTART_MODE=l, records package/version/archive/control hashes, performs the
actual package installation, and requires running service identities unchanged.
It records the actual kernel honestly; it does not pretend the hosted VM runs
the production6.8 kernel. The receipt explicitly leaves production installation
and native cause qualification false.

The receipt preserves a closed failure phase/reason and actual child exit code
without APT output, configuration, environment or raw exception text. Exact
already-installed tools report that no fresh installation was exercised; any
installed target at a different version refuses instead of upgrading or
downgrading. Authentication flags explicitly disallow unauthenticated, weak or
insecure repository acceptance. Only identity-validated public DEBs, bounded to
64MiB total, accompany the receipt for exact control/script review; private logs
and host configuration are never artifacts.

This is the package qualification prerequisite only. No production installation
mode, package operation, recorder, Inspector call, system setting, engine signal
or restart is admitted by this draft. The final bounded same-operation installer
needs the reviewed real signed-package/hook/trigger profile and actual systemd
custody qualification. Existing controller bytes and all current manual modes
remain unchanged. Root owns review and provider operations.

The Ubuntu job also runs the maintained five-case native feasibility fixture using the exact installed6.8 tool binary, including actual PID1 fault attribution, control acknowledgements, DWARF decoding and finite cleanup. This does not substitute the hosted kernel for production6.8 or claim a production capture. The unchanged controller lifecycle already has separate genuine eight-case qualification.
