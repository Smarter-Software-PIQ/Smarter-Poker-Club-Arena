# A read the page cancelled is not an error (2026-11-27)

Post-deploy e2e run 46063424139 failed "wires the live Player Record and
Statistics subpages without unsafe writes" (tests/e2e/production-club-members.spec.ts)
on one critical console error:
`[MemberAssignAgent.load] TypeError: Failed to fetch`. The run before
(46043849049) passed.

## Cause

The spec calls `page.reload()` on the Player Record right after returning to it
with `goForward()`, which remounts `MemberAssignAgent` and starts its load
(`fn_can_manage_club_assignments`, then the agents, members and profiles reads).
A reload cancels every fetch still in flight; supabase-js returns that as
`{ message: 'TypeError: Failed to fetch', code: '' }`. React never unmounts on a
document reload, so the component's version guard
(`src/components/club/MemberAssignAgent.tsx`, the `catch` in `load`) still
matched and the cancellation went to `reportError` as a genuine failure. It is
timing dependent: the read only fails when it is still in flight at the reload,
which is why the previous run passed.

## Fix

- `src/lib/leavingDocument.ts` records that the document is leaving
  (`beforeunload`, provisional for 10 s because the prompt can be cancelled;
  `pagehide`, until a `pageshow` restore) and exposes
  `wasCancelledByLeavingPage(error)`: true only for a transport-shaped error
  (no server code; Failed to fetch / Load failed / NetworkError / AbortError)
  while the document is leaving.
- `MemberAssignAgent.load` returns quietly for that case. Unmount still returns
  through the version guard; every other failure, including the same
  transport failure on a live page and any coded server refusal, is reported
  exactly as before. The assignment write path is unchanged: an unknown write
  outcome still keeps its retry.

## Tests

- `tests/unit/leavingDocument.test.ts` pins the lifecycle and the predicate.
- `tests/components/PlayerAssignAgent.test.tsx` adds: quiet during a reload,
  still reported on a live page, a coded refusal still reported while leaving.
  The first case fails without the component change.
