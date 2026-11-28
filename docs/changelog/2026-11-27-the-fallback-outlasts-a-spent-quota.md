# The Fallback Outlasts A Spent Quota

Lane: release-custody. Date: 2026-11-27.

## What Happened

`scripts/ops/cutover-operator-preparation.mjs` runs from the OpenClaw cron
`ca-cutover-operator-preparation` on the owner's Mac (33 and 41 minutes past
hours 0, 3, 6, ..., 21 America/Chicago). It gives a cutover cycle an owner by
sending one `prepare-daily-engine` dispatch when no Stage run can own the
cycle. Its run log for the 1:00 PM CST cycle on 2026-11-27:

- 12:33 and 12:41 CST: `UNKNOWN: the Stage run list could not be read ...;
sending, the election refuses a second owner`, then `SEND FAILED: Command
failed: gh api --method POST repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/dispatches -f event_type=prepare-daily-engine`.

## Cause

gh on the Mac uses the user login `Smarter-Poker`, and every agent on the Mac
draws on that user's one 5,000-an-hour REST quota (the exported token and gh's
own login were measured at 4725/5000 each with the same reset). Another lane
measured the shared quota at 0/5000 until 12:42 CST that day, so both firings
fell inside an exhausted quota and both the read and the send were refused.
The log kept only the first line of `error.message`; gh's stderr, which names
the rate limit, was discarded (CLAUDE.md 10.86: the reason was unnamed). The
1:00 PM cycle had another owner, so nothing was lost; a cycle with no owner
would have been.

## Fix

- Every gh failure is logged with the last meaningful line of gh's stderr,
  with anything shaped like a GitHub token redacted. A rate-limit refusal
  reads `RATE LIMITED until <HH:MM CST>`.
- Before the read the script asks `gh api rate_limit`, which GitHub documents
  as not counting against the REST quota. When fewer than two core calls
  remain (the read and the send) and the reset falls before the deadline, it
  waits once until the reset plus 5 s, then reads once and sends at most once.
- The deadline is the end of the cycle's preparation window (cutoff plus 20
  minutes, the window Stage elects in; a run created after it cannot own the
  cycle), less 60 s so the dispatched run is created inside the window.
- A reset after the deadline sends nothing, logs `RATE LIMITED until ...
after the deadline ...` and exits 4 (distinct from 0 and from 2, a failed
  send).
- An unreadable `rate_limit` behaves as before.
- A waiting instance holds a per-cycle lock in the temp directory, so the
  cron's second firing does not wait beside it and send a second dispatch
  (a second dispatch for a claimed cycle fails a receiver and raises a false
  release alert).
- The cron timeout rises from 120 s to 1080 s: the earliest firing is 3 min
  after the cutoff, so the longest wait is 20 - 1 - 3 = 16 min (960 s), plus
  the previous 120 s for the work.

## Not A Retry Loop

The script waits at most once per firing, makes one read and at most one
send, and never retries a failed call.

## Tests

`tests/every-cycle-gets-an-owner.law.test.ts` gains eight cases: the deadline,
a wait then exactly one read and one send, a second firing that defers to the
waiting one, a reset past the deadline that sends nothing, an unreadable
`rate_limit`, gh's stderr reason on a failed read and send, token redaction,
and the cron timeout covering the longest wait.

## Install

The custodian installs the merged script on the Mac and raises the installed
cron's timeout to 1080 s.
