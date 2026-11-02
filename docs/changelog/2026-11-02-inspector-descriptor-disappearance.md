# Inspector retirement preserves ownership through descriptor churn

The MAIN Inspector kernel census rejected every `readlink` error, including an
unrelated descriptor closing after enumeration. The transport then collapsed
that predicate into `outcome_unknown`. Receiver `41452708967-1` failed before
WebSocket creation, retained its durable claim and never activated its target.

The census now distinguishes ENOENT from other descriptor errors and verifies
every disappeared coordinate is still absent at final readback. Both complete
socket/owner snapshots, exact process identities, exclusive listener/client
ownership, descriptor limits and absolute deadlines remain required. Reuse,
permission failures, missing target ownership and changing sockets refuse.
The transport retains only the fixed kernel predicate code, never native paths.

The existing locked release transaction can record a distinct preattachment
refusal disposition for the exact original 08e attempt. It binds the original
claim/proposal/container, invocation, immutable source files, native journal
and terminal failure; proves all native units and other retained edges gone;
and observes the current runtime and database twice. The original process
requires a clientless kernel binding. A naturally replaced process requires
positive original-process death, exact predecessor image/source, a closed
Inspector, matching local/public identity and an idle database with fresh leader.
All successor metadata reads use the original shared deadline.

A separate immutable disposition precedes the ordinary entry-state gate. This
avoids a circular bootstrap requirement without an entry-gate bypass. Neither
the original claim nor failure is deleted, no positive native-close receipt is
created, and the original failed source cannot acquire another routine cycle.
Interruption after either receipt, before disposition or before seal CAS, retains
historical evidence and requalifies current state, including a natural process
replacement. No process restart, game operation or financial write is added.

The read-only canonical observer projects this typed disposition and reports a
closed refusal stage/code. Its 64 KiB bound and stable private-file requirements
remain unchanged; the earlier generic observer refusal's live cause is not yet
established. Diagnostics do not grant cleanup or retry authority.

Verification: focused kernel/transport regressions reproduce the availability
failure before the change and pass after it. Real filesystem recovery fixtures
cover retained native edges, contradictory journal facts, claim/health/database
drift, distinct receipts, interruption plus successor, duplicate recovery and
absolute deadline refusal. The existing required Linux fixture now closes a real
unrelated descriptor after enumeration in the pinned Node 22.23.2 container;
its native execution remains a hosted CI requirement. Local tests and source
changes do not establish production activation, SEALED receipt, thaw or gameplay.
