# tests/the-mac-push-runs-the-checks-like-ci.law.test.ts

On macOS the pre-push hook runs the checks on Node 22 with its own external-SSD TMPDIR and a built native evaluator, the way CI does.
