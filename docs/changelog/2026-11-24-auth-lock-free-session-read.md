# 2026-11-24: Every read in a tab failed while another tab held the sign-in lock

## What the player saw

New player GRANDmasterFLUSH (active super agent in Kings Club) opened his club
at 07:11Z and got "This Surface Could Not Load / Club Access Could Not Be
Verified". His membership was intact. After the first fix shipped, another
player's table socket and action submits failed the same way at 14:13Z.

## Evidence

- `client_error_events`: every supabase-js read in the tab (club access check,
  wallet, waitlists, presence, tickers) failed in the same minute with
  `AbortError: signal is aborted without reason`, code `20`.
- Edge logs for the device: raw `fetch` calls (`fn_report_client_errors`,
  `/auth/v1/health`) reached the server and returned 200 in that minute; no
  supabase-js read arrived at all. The network was fine; the reads were never
  sent.
- `auth.sessions`: one session, never refreshed. The project JWT lives 7 days.
- That message and code are exactly what auth-js `navigatorLock` produces when
  its 10 s acquire budget for the Web Lock `lock:smarter-poker-auth` runs out:
  it aborts its own `AbortController` with no reason.

## Why and how it broke

1. **The lock is shared by every tab.** The Hub (auth-js 2.112) and Club Arena
   (vendored auth-js 2.90.1) use one storage key, so every smarter.poker tab
   contends for one exclusive Web Lock.
2. **Upstream `getSession()` takes that lock for every read**, even when the
   stored session is valid and nothing will be refreshed. The lock only needs
   to serialise refresh-token rotation.
3. **supabase-js calls `getSession()` for the bearer token of every REST, RPC,
   storage, function and Realtime request**, and the app calls it directly in
   45 more places (table socket, action submit, wallet, guards).
4. When any other tab held the lock past 10 s, every one of those calls in
   this tab failed before sending, and `ClubWorkspaceContext` rendered the
   failed membership read as the fault card.
5. Diagnosis was slowed by a second defect: `withClubWorkspaceReadTimeout` only
   named its own deadline when the read threw, but supabase-js returns an
   aborted read as `{ error }`, so the club workspace's own timeouts also
   surfaced as an anonymous "signal is aborted without reason".

## Fixes (source, no workaround)

| PR      | Change                                                                                                                                                                                                                                                                                                     |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #11894  | `src/lib/supabase.ts`: the client's `accessToken` hook sends the stored token while it has more than 90 s left; otherwise `getSession()` refreshes under the lock. Covers requests even before the SDK has initialized.                                                                                    |
| this PR | Vendored auth-js (`scripts/ci/build-auth-initialization-recovery.py` → `vendor/supabase-auth-js/`): `getSession()` returns a still-valid stored session without the lock once the client has initialized. Fixes all 45 direct callers at the SDK, where they all land. Every refresh still takes the lock. |
| this PR | `src/contexts/clubWorkspaceReadTimeout.ts`: the workspace deadline is named `TimeoutError` whether the read throws or returns the abort.                                                                                                                                                                   |

## Hardening (each fails the build on regression)

- `tests/unit/supabaseRequestToken.test.ts`: with the lock held by another
  tab, a real-client read goes out with the stored token. Verified to fail
  (hang) with the hook removed.
- `tests/unit/authSessionReadWithoutLock.test.ts`: against both CommonJS and
  ES-module SDK builds, a valid session is returned while another tab holds the
  lock, and the lock is still used before initialization, near expiry and with
  separate user storage; a sign-out in another tab is seen immediately.
  Verified to fail on the previous archive.
- `tests/unit/clubWorkspaceReadTimeout.test.ts`: the workspace deadline is
  named for both abort shapes.
- `package-lock.json` pins the archive integrity; the generator verifies the
  upstream registry bytes and every preimage before writing.

## Not fixed here

The World Hub (`Smarter-Poker-World-Hub`) uses registry auth-js 2.112.4 with the
same storage key, so its own reads still take the shared lock and can still
hit this failure. Its own client needs the same change through its own
delivery route.

## Method for the next agent (owner standing order)

After a set of fixes: check everywhere for bugs, gaps, stubs, errors,
regressions and wiring issues; confirm each fix is a real source fix; then, for
each one, work out why and how it broke and harden it so it cannot regress (a
test, constraint or gate that fails the build). Prove each guard by running it
against the old code. Read production evidence after publish: here the first
fix was verified live and the error sink then showed the same abort from the
45 direct callers, which led to the SDK-level fix. Before pushing, run the
repo's ratchet and contract suites, not just the tests you wrote:
`discardedErrorReadRatchet` refused the first push of #11894 in CI.
