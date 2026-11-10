# tests/an-engine-release-in-flight-is-advisory.law.test.ts

The engine release in-flight answer is read-only and advisory: it is built from existing Stage and receiver run state, no workflow calls it, and it can never gate, dispatch, retry or cancel a release.
