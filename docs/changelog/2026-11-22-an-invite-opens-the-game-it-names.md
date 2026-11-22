# 2026-11-22: an invite opens the game it names

Dan: "THE SHARE BUTTON FUNCTIONALITY INSIDE OF THE SPINS, SIT N GO'S,
SATELLITES HEADS UP AND MTT'S ISN'T WORKING PROPERLY ... FIX THIS WEIRD GLITCH
THAT IS HAPPENING WHEN THEY INVITE." The player: "The share link still doesn't
work either ... The crazy river is always on the table, even when you invite
someone. It doesn't open a new table." Her screenshot: a table with one player
at the top and a horse (crazy_river) in the bottom seat.

Client only. No engine change and no migration.

## What the trace found

Every invite button builds its link in `src/lib/share.ts`: a tournament is
`smarter.poker/t/<tournament id>`, a table is `smarter.poker/g/<table id>`
with `?i=` (the sender's club code) and `?invite=` (the Heads Up seat-hold
token). The World Hub pages for both exist and pass the parameters through
(read at World Hub `d6af92f9`). The defects were on the Club Arena side.

### 1. The in-app friend invite crossed its two parameters

`buildTableInviteDeepLink` (`src/services/NotificationService.ts`) wrote the
seat-hold token as `i` and the club code as `invite`. The table reads `i` as a
7 character club code and `invite` as the 16 to 64 character token, so it read
neither. For a Heads Up seat held for a named player, `fn_check_heads_up_seat_invite`
then answered `heads_up_invite_required`: the one friend the seat was held for
was refused, the five minute hold ran out, and a horse took the seat.

Fix: `i` is the club code and `invite` is the token, as in every shared link.

Why it shipped: the unit tests used made-up values (`tok+1`, `VIP99`, `abc`)
and asserted the crossed output as correct. Nothing fed the link back through
the reader. The law test uses the real shapes and round-trips them.

### 2. The club-join detour dropped the seat-hold token

`parseTableInviteParams` (`src/lib/mustMoveInviteRouting.ts`) built the return
path with `cluster` only. A friend who was not yet a member joined the club and
came back to the table without `invite`, and was refused the held seat.

Fix: the return path carries `invite`; the parsed result exposes `inviteToken`.

### 3. An invite sent from a tournament table named the table

Two rules disagreed on the table page. Invite To Game shared a pre-start Spin
or Heads Up as its table id; Invite Online Friend always sent the table id,
even from a running MTT. A table is not a tournament's address: a Spin and a
Sit & Go recycle their tables (the page's own bootstrap notes "Table
Unavailable" as the ordinary result of such a link) and a running MTT moves
the inviter between tables. The friend landed as a spectator at a felt with
other players seated, or on "Table Unavailable".

Fix: `tableInviteTarget` in `src/lib/share.ts` is the one decision for the
link, the share sheet and the in-app invite. A tournament table is shared as
its tournament. The single exception is a Heads Up seat held for a named
player, which is the table with its token.

### 4. A link to a game that had already filled led only to that game

A Spin, a Sit & Go, a Heads Up and a When Full satellite start when their
seats fill and the board then opens a new game under a new tournament id
(`TournamentRecurringService.ensureBoardOpen`, keyed on owner and name). Every
open board already holds one horse (`SEAT_FIRST_OPENING_HORSES = 1`, Dan
2026-11-08), a Heads Up starts the moment a person takes the other seat, and
the rest of a Spin arrives 3 to 7 minutes after a person sits. So a link is
stale within minutes. The friend who opened it got the tournament page of a
running game with a Watch button, or the running table itself, with the horse
drawn in the bottom seat because the viewer holds no seat. That is the
screenshot, and it is why "it doesn't open a new table".

Fix: `src/lib/nextOpenGame.ts` answers whether the linked game can still be
entered and, if not, which open game is the same board (same club and union,
format, stake, game type, seat count and satellite target; the same name
first). `TournamentDetails` shows "This Game Is Full And Already Started. A
New One Is Open Now." with Play New Game, which opens the new game's seats (or
its lobby for a registered Sit & Go). `InviteLandedLateOverlay` says the same
on the table for an arrival by invite link. With no open game the button reads
Browse Open Games. A player who holds an entry in the game sees neither.
Nothing is bought and nobody is seated by it.

### 5. An older tournament page took the focus off an invited table

`MultiTablePage` restores the tournament page a browser tab was reading in the
last 30 minutes and focuses it once the seat rebuild lands. For an arrival by
invite link that replaced the invited table with an older page. An arrival
that carries `i` or `invite` now keeps its table.

## Pinned by

`tests/an-invite-opens-the-game-it-names.law.test.ts`
(`docs/laws.d/an-invite-opens-the-game-it-names.md`). Updated in the same
commit, because they pinned the behaviour replaced here:
`tests/unit/notificationTableInviteDeepLink.test.ts`,
`tests/unit/TableInviteService.test.ts`,
`tests/unit/tableInviteRoutingAndHardening.test.tsx`,
`tests/unit/gameInviteLinkAndHeadsUpPrompt.test.ts`.

## Not changed here

- **A horse is in every open Spin and Heads Up, and a Heads Up starts when a
  person sits.** That is the engine's board rule (Dan 2026-11-08), not a link
  defect. Two friends can meet in a Spin or a 6 or 9 seat Sit & Go inside the
  3 to 7 minute hold. They cannot meet in a Heads Up that opened with a horse,
  and the "Specific Player" prompt only appears at a Heads Up table that is
  empty. A private game for two invited players needs an engine and SQL
  change and an owner decision.
- **Tournament links carry no club code.** `/t/<id>` has no `?i=`, and the
  World Hub page passes no query through, so a signed-in person who is not a
  member of the club gets no join step from a tournament link. Needs a World
  Hub change as well.
- `fn_check_heads_up_seat_invite` is asked by the client before the seat
  purchase; `fn_take_seat_and_buy_in` does not enforce the hold itself.
- Not run against production or in a browser. Verified by typecheck and unit
  tests only.
