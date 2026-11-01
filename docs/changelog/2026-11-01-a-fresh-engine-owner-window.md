# 2026-11-01: an owner window can wait for a fresh engine

eed06fe5 restarts itself every 90-120 minutes. Within minutes of a start it has
re-adopted almost none of the tables it can never finish (stopped-tournament
originals and closed-Diamond tables that hold `cards_in_air`), and its heap is
inside the census allowance (1.5 GB 17 minutes after the 09:42 UTC restart,
against about 2.5 GB). Later it holds dozens of such tables and the census no
longer fits, so a :53/:55 window almost never lands in the moment the unchanged
certificate and census could both pass (see
`2026-11-01-eed06fe5-replacement-deadlock.md`).

`owner_window_reason` now honours an optional `withinSecondsOfEngineStart`
(integer, 30-600) on an owner window: the window grants its reason only while
the serving process's own `/health` `uptime` is at most that many seconds. An
absent, malformed or larger uptime grants nothing; a window without the field is
unchanged. The off-cycle break that follows still has every existing ceiling:
the 120 s notice, hand-boundary drain, durable freeze, the strict certificate,
the census re-read before the one-shot intent, the one-window-per-hour seal and
rollback. Nothing the certificate admits is widened, and no timer, watcher or
retry is added: the waiting release asks on the same pass it already makes.

Tests: `FreshEngineOwnerWindow` (3 cases) in
`tests/operations/engine-release-recovery-window.py`; the activation-floor test
exercises the field whenever the selected window carries it.
