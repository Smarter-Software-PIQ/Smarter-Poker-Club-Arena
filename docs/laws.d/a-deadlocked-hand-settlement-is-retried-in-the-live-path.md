# tests/a-deadlocked-hand-settlement-is-retried-in-the-live-path.law.test.ts

A deadlock, serialization failure or lock timeout that the stack settlement catches inside the atomic hand commit reaches the engine as the canonical `atomic_hand_rolled_back` envelope (with its SQLSTATE and commit hash), the only shape `handHistory.ts` retries in the live path, so a lock conflict one function deeper no longer parks a dealt hand for the resume door (production alerts 258600, 267092; migration 20261119141104, native proof `scripts/ci/test-a-deadlocked-hand-settlement-is-retried.sh`).
