# tests/one-checkout-at-a-time.law.test.ts

scripts/agent-workspace.sh creates every worktree inside a machine-wide checkout lock with a bounded wait and abandoned-lock takeover (2026-11-18: six concurrent full checkouts took the Mac to load 41 and left half-made trees).
