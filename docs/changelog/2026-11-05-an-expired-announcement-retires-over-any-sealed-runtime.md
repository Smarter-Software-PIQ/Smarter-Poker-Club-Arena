# An expired announcement retires itself over any sealed runtime (2026-11-05)

## What was stuck

Engine release run 42099609162-1 (target 57e0dd5b, the satellite and freeze
fixes) announced its break at 20:27:32Z over the sealed runtime 71087373,
froze at 20:29:32Z, refused its cutover because one Spin table still had a
hand in play, and was thawed by the serving engine at 20:33:10Z. Its unit then
restarted 222 times. Every later release refused with "fresh scheduled release
cannot compete with active runtime owner 42099609162-1" until the owner was
retired by hand at 23:03:14Z. Sunday Deep Stack Satellite 25 and Prime Time
Satellite 5 stayed frozen behind it.

## Cause

`engine-release-seal.py prove-expired-recovery-announcement`, the only path by
which an expired announced owner retires itself, required the sealed desired
runtime to be one historical build (`FAILED_ROUTINE_DESIRED` eed06fe5 and its
image), and `failed_routine_runtime` proved the serving container against that
same constant. Over any other sealed runtime the proof could never pass, so the
wrapper answered "announcement-only owner retained" forever.

## Fix

The proof now binds the runtime the seal itself records as desired: its exact
sha and image id (shape-checked, and never the owner's own target). The
serving container, image label, local and public health, idle maintenance and
the database terminal-owned-thaw proof are all checked against that runtime.
Every other gate is unchanged. `failed_routine_runtime` defaults to the
historical constants, so the routine-cycle proofs that are deliberately bound
to that predecessor behave exactly as before.

## Tests

`tests/operations/engine-activation-floor.test.py` runs the real recovery
wrapper and seal for both the historical runtime and a later sealed runtime
(71087373); the second case fails on the previous code and passes now.
`tests/operations/certified-checkpoint-contract.py` executes the amended
equality block.
