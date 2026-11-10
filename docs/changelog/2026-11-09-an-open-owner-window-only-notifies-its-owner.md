# An open owner window tells its release owner, and starts nothing

2026-11-09. Owner order: "Phase 3 must notify the release owner without dispatching."

## Why

A booked owner window did nothing until someone noticed it: the November 7
booking expired unused, and on November 8 the 18:20Z window sat idle for about
seventy minutes. The first Phase 3 build had Stage dispatch the explicit owner
selection itself and re-dispatch on new evidence. That broke the standing rule
that no timer, watcher or scheduled agent may initiate, retry or certify a
release.

## What changed

- `.github/workflows/owner-window-ready.yml` (new) runs on protected pushes and
  successful push Backup or prequalification completions. No timer.
- `scripts/ci/owner-window-ready.py` (new) decides read-only, reusing
  `scripts/ci/select-daily-engine.py`'s readers and selection unchanged. When the
  window is ready it opens or comments on one issue for the release owner, once
  per window and evidence.
- No release-control input changed: `stage-engine-release.yml` and
  `select-daily-engine.py` are as on main.
- Law: `tests/an-open-owner-window-only-notifies-its-owner.law.test.ts`.
