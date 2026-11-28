# Table Chat shows real sender names (2026-11-28)

## What was wrong

At https://smarter.poker/hub/club-arena/table/e78717a2-294d-4b8f-a6ce-d42ec54b237f
every line in Table Chat showed the sender as "Player" (avatar "P"), although
the seats were named (kickerprof, OldCole, hustler_07 ...).

`src/hooks/useTableChat.ts` named a line once, when it arrived, with
`playersRef.current.find(p => p.id === m.user_id)?.name || 'Player'`, and
stored that string in the message. This happened at three places: history load,
the realtime insert and the optimistic send. Two cases always missed:

- history loads before the seat list arrives, so every historical line stored
  "Player" and kept it;
- a sender who has left the table, or an observer who chatted, is never in the
  seat list.

## The fix

The cause was the frozen name, so a line no longer stores one. A PLAYER line
keeps only `playerId`, and `resolveChatSenderNames` names it each time the hook
returns messages:

1. the current seat name, so names fill in as soon as the seats are known;
2. otherwise, the sender's public handle, read once per table session from
   `profiles` with `PLAYER_NAME_COLUMNS` and `playerDisplayName(row, 'arena')`.
   This is the same read `useSeatMoveAnnouncement` uses: public columns only
   (alias, then username), never a real name, under the existing RLS. The cache
   is held in memory only;
3. "Player" only when that read failed or found no row. A failed read is not
   retried in a loop.

System and Dealer lines are not changed. A horse is named like any other player,
by its seat or its profile; nothing reads `is_horse`. `ChatBubble`'s
`nameFromMessages` (the speaking-seat bubble) reads the resolved names too.
Chat styling is not touched.

## Pinned

`tests/unit/tableChatShowsRealNames.test.ts` covers four cases: history loaded
before the seats gets names once the seats arrive, a departed sender is named
from their profile, the fallback appears only when the read fails (with no
retry), and seat names outrank profile names while system and dealer lines stay
as they are.
