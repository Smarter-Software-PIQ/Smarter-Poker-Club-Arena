# Player Management: Active Now moves as it happens, Live Now strip, table on the row, leaving is the last beat

Dan, 2026-11-12, after the Active Now default shipped (#10639): "GO AHEAD AND
FULLY BUILD, FIX AND ENHANCE ALL OF THESE." The five roster items, in one
change. The sixth (the certification fleet off KINGS CLUB) is its own change.

## What it does now

**Active Now reorders live.** The roster RPC serves the Active Now order at
read time. Between reads nothing re-read the roster (Dan, 2026-10-25: "once
every 180 seconds is fine, nothing sooner"), so a player who sat down or came
online stayed where the last read put them. The page now re-ranks the loaded
rows in place from two answers it already had reason to watch:

- the presence door, `watchProfilePresence` (`src/lib/profilePresence.ts`),
  re-asked once a minute for every loaded row in one batched call, which also
  feeds the row's Online word (previously one `useOnlineNow` per row; the law
  pin in `tests/presence-has-one-definition.law.test.ts` moved to
  `useLoadedPresence(` and `watchProfilePresence(`);
- the club's live seats, `src/lib/clubLiveSeats.ts` (new): the open seats of
  the club's members on waiting or running tables, read through PostgREST
  (`table_seats` with its table and the player's public profile), one read per
  club per minute on the same `PRESENCE_RECHECK_MS` clock, shared by every
  watcher, paused while the tab is hidden, re-asked right after each roster
  read. `table_seats` is not published to Realtime (14.5M writes), so a read is
  the honest signal; its cost is one indexed query (`idx_table_seats_club_active`)
  per open roster per minute, never a roster re-read.

`src/hooks/useRosterLiveOrder.ts` turns the two into `orderByActivity`:
seated, then online, then last active, ties in the server's order. The server
cursor is untouched, so paging on is unaffected. Under any other sort, or a
search, the server order stands.

**Live Now strip (item 4).** `src/components/club/LiveNowStrip.tsx`: every
seated member of the club, one chip per player with their newest table,
pinned above the roster whatever the sort, page or search. A seated player
beyond the loaded page is never out of sight. A chip tap opens the observer
view.

**The row names the table (item 5).** A seated row's status reads the table
and stakes (`Midnight Cash · 1/2`) instead of "At Table", and a tap on it opens
the observer view through the same `fn_get_table_watch_access` revalidation
the player record uses. The door is now one function,
`src/components/club/watchMemberTable.ts`, shared by the record's Watch At
Table shell (refactored onto it), the row chip and the strip. The row is
itself a button (open the record), so the chip is a nested `role="button"`
span that stops the click, not a nested `<button>`.

**Leaving is the last beat (item 3).** "Online" has one definition (flag AND a
heartbeat under five minutes, shared with the World Hub messenger and the
horses' cron heartbeat), and that definition is not narrowed. What changed is
that the tab that leaves now says so: on `pagehide` and on a native pause the
last visible tab of the account sends one offline beat through
`fn_update_presence` as a keepalive fetch (the `sendAwayBeacon` pattern), so a
closed app reads offline at once instead of up to five minutes later. "Last
tab" is a localStorage lease each beat stamps; several desktop windows are
allowed, so closing one while another is beating sends nothing. The next beat
(pageshow, visibility, native resume) marks the player online again.
`src/lib/presenceHeartbeat.ts` remains the only presence writer.

**Cosmetic (item 6).** The roster operations line no longer ends in a period;
the status words (table, Online, Seen) share the subline's size and weight.

## Tests

- `tests/unit/rosterLiveOrder.test.tsx`: the seat reader (both queries, dedupe,
  deleted tables skipped), the shared per-club watcher (one read per minute,
  shared answer, stops when unwatched), `orderByActivity` and `liveStateOf`,
  the strip.
- `tests/unit/playerManagementActiveNowLive.test.tsx`: the page re-ranks when
  a player comes online or sits down with no roster re-read, shows the strip,
  names the table on the row, opens the observer view from the chip after
  revalidating access, and reports a seat that is gone.
- `tests/unit/presenceHeartbeat.test.ts`: the leave beat (keepalive, same door,
  Bearer header), the sibling-tab lease, silence after sign-out, missing
  session, and the hook's pagehide/pageshow pair.
- `tests/presence-has-one-definition.law.test.ts`: pins moved to the batched
  watch.
