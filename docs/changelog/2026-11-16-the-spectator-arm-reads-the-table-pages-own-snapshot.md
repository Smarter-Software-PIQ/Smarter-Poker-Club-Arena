# The cutover spectator arms on the table page's own snapshot, not the lobby's

2026-11-16. Test-only change, one case in
`tests/e2e/production-live-table-realtime.spec.ts` ("an authenticated spectator
spans the original production engine replacement").

## What failed

The spectator check failed on three releases in a row: the 1806z window
(target `652726c8`, receiver run 43746143095), the 2245z window (`630a1096`,
run 43774434492) and the 0106z window (`3529e866`, run 43793755357). Each time
the spectator was admitted, then failed while arming, before any engine
replacement happened:

    expect(journal.transportIdsOpenAt(armedAt)).toEqual([initial.socketId]);
    expected [1], received [2]

The second job, "Bind spectator evidence to the original sealed release",
then failed only because the first job left neither a witness nor a
not-observed record.

## Why

The case picks its table from the club lobby. The lobby opens its own game
socket (socket 1) and pre-subscribes up to three visible cash tables, so it
can already have a SNAPSHOT for the chosen table. The case then loads the
table page in full, which closes socket 1 and opens the table page's own
socket (socket 2). The wait for "the first SNAPSHOT for this table" had no
time or socket bound, so it could return the lobby's old frame from socket 1.
At arming only socket 2 was open, which is correct, but `initial` named
socket 1, so the check failed. It failed safe: no false witness was written.

The other cases in the same file already bound this wait with
`since: navigationStartedAt`. This case did not.

## What the fix does

Just before the table navigation the case records the time and the sockets
already open. The initial SNAPSHOT must now be received after that time, on a
socket that was not already open then, so it can only come from the table
page's own socket. The polling, the 30-second timeout and the failure message
are the same as before.

No assertion was loosened. The check at arming (exactly the table page's
socket is open) and every later check on `initial.socketId` are unchanged.
They now test the right socket. Before, a stale `initial` could also have let
"the original socket closed" pass without any replacement.

## What it does not prove

- It does not prove spectator continuity across a replacement for
  `652726c8`, `630a1096` or `3529e866`. Those runs stopped before any
  replacement, so continuity for those releases stays unverified. The last
  real witness is receiver run 43717613638 (`7e8688d3`).
- It was not run against production here. The case only runs inside a real
  release, so the next receiver run is the first real test of this fix.
- No trace or journal from the three failed runs was kept, so the lobby frame
  on socket 1 is inferred from the code path, not seen directly.
