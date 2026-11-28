# 2026-11-28 - Reserve IPv6 Port in Release-Recovery Linux Kernel Fixture

## Summary

- Updated `LinuxKernelOwnerTests.FIXTURE` in `tests/operations/release-recovery-read.test.py` with `listen_v4()` so every IPv4 listener bound on `127.0.0.1` also reserves the matching port on `::` via a bound, never-listening `IPV6_V6ONLY` socket for the fixture's lifetime and closes the guard socket on teardown.
- Eliminates intermittent `listener ambiguous` (`unknown`) flakes when a port free on `127.0.0.1` is concurrently listening on `::1` in another process or test.
- Included serialized `evidence` in the `self.assertEqual(role, expected, json.dumps(evidence))` assertion message in `test_real_linux_main_and_child_listener_roles` (stage/code only, never host PID) so any future refusal reports its exact reason.

## Verification

- `python3 -m py_compile tests/operations/release-recovery-read.test.py`
- `npx vitest run tests/a-release-recovery-observation-reads-only-its-run.law.test.ts`
- `npx vitest run tests/law-registry.law.test.ts`
- `npx prettier --check docs/changelog/2026-11-28-release-recovery-fixture-ipv6-port.md`
