# The Client Stops Polling When Realtime Is Live

Client performance review, finding 10.

## Before

- The Table Studio (`ThemeSettingsModal`) re-read its ownership ledger and its
  saved appearance every two seconds, and only while their Realtime channels
  were SUBSCRIBED: the poll ran hardest exactly when it was least needed, and
  not at all while the channel was down.
- The sign-in pairing wait (`activeLogin`) polled `ca_pairing_requests` every
  2.5 s for its whole life, whatever its channel was doing.
- The club lobby's waitlist counts dropped to a one-minute poll as soon as the
  broadcast channel object existed, even if it never joined.
- The bust rebuy countdown ticked every 250 ms inside `LiveTablePage`, so each
  second of a rebuy window re-rendered the whole table (one per open table when
  multi-tabling) to change one number on one sheet.

## After

- One rule, in `src/lib/realtimeAwarePoll.ts` (React face
  `src/hooks/useRealtimeAwarePoll.ts`): a poll that backs up a realtime channel
  runs at its fast cadence while the channel is not SUBSCRIBED, drops to a 30 s
  safety cadence (or stops, with `slowMs: null`) while it is, and is fast again
  the moment it drops. The Studio reads (2 s / 30 s), the pairing wait
  (2.5 s / 30 s, plus one read on joining) and the waitlist counts (20 s / 60 s,
  plus one read on joining; moved to `src/lib/gameWaitlistWatch.ts`) use it.
- The bust rebuy seconds are counted by `SecondsUntil`
  (`src/components/table/SecondsUntil.tsx`) around the rebuy sheet in
  `TableModalsLayer`. `LiveTablePage` hands down the deadline only. The value
  shown is computed exactly as before (ceil of time left, floored at zero,
  re-read every 250 ms against the wall clock).

## What was left alone, and why

Every other `setInterval` beside a realtime channel was checked. Most are
display clocks. The data polls that remain read tables the `supabase_realtime`
publication does not carry (`table_seats`, `tables`, `tournaments`,
`tournament_players`, `wallet_transactions`; checked against
`pg_publication_tables` on 2026-11-27), so their channels answer SUBSCRIBED and
deliver nothing and the poll is the only path. `SessionSummaryHost`'s 3 s
settlement read is one of these: it reads `table_seats` / `wallet_transactions`
/ a Diamond receipt RPC, and its only "event" (`SEAT_CASHED_OUT`) comes from
`queuedCashoutWatcher`, itself a poll. It is bounded to three minutes while the
card shows an estimate.

## Guard

`tests/realtime-backed-polls-use-the-shared-rule.law.test.ts` counts every raw
`setInterval` in a client file that opens a realtime channel against an
inventory with reasons, and pins the shared-rule call sites. Unit tests:
`tests/unit/realtimeAwarePoll.test.tsx`, `tests/unit/gameWaitlistWatch.test.ts`,
`tests/unit/bustRebuyCountdownTicksInTheSheet.test.tsx`, plus cadence tests in
`ThemeSettingsModalHardening.test.tsx` and
`aLoginOnANewDeviceClaimsTheAccount.test.ts`.
