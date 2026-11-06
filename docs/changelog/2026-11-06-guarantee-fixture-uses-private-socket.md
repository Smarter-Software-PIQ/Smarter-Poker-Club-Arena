# Guarantee funding fixture uses its private Unix socket

The required accounting fixture opened an unnecessary TCP listener on a
PID-derived port even though all clients use a unique Unix socket. An occupied
TCP port reproduces startup refusal before any financial assertions execute.
The original hosted failure cause remains unknown because its startup log was
discarded.

Use the existing bounty-only fixture pattern: reserve an OS-selected TCP port
for the duration of the proof and disable PostgreSQL TCP listening. This makes
accidental reintroduction of the listener fail the same maintained test. Include
the private PostgreSQL log in failure diagnostics before cleanup. All original
SQL, migration bytes, production-definition hashes and assertions stay intact.

The exact private PostgreSQL fixture passes with the TCP port occupied. This is
local accounting-test infrastructure only; it does not change production
funding, payouts, or installation policy.
