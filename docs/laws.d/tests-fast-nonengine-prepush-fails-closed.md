# tests/fast-nonengine-prepush-fails-closed.law.test.ts

The fast non-engine local pre-push selector activates only when every changed path falls inside the strictly non-runtime ops/unit-test/docs/benchmark allowlist, keeps all static repo guards, server tsc, law-registry, and exact changed/companion tests active, and fails closed to the full unchanged pre-push suite on any mixed, runtime, migration, workflow, release, or unreadable diff.
