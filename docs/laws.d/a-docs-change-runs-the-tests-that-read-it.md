# tests/a-docs-change-runs-the-tests-that-read-it.law.test.ts

A docs-only pull request runs, in the ungated compile job, every test that reads a docs/ path it changed whenever that test's suite is skipped, so a doc edit cannot turn main red unseen (#11791, 2026-11-22).
