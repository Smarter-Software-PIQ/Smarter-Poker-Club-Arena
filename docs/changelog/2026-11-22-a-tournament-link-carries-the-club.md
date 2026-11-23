# 2026-11-22: a tournament link carries the club, and an in-app invite is sent by the server

Dan: "FINISH UP ANY AND ALL UNFINISHED WORK, AND THEN GO AHEAD AND FULLY BUILD,
FIX AND ENHANCE ALL OF THESE AND MAKE SURE THEY ARE FULLY WIRED IN AND TESTED
BEFORE CLAIMING SUCCESS." The two items PR #11772
(`2026-11-22-an-invite-opens-the-game-it-names.md`) left open.

Client, one migration, and a World Hub change (`pages/t/[id].js`). No engine
change.

## 1. A tournament link from a club you had not joined was a dead end

**What a player saw.** A friend opened a shared Spin, Sit & Go, Satellite,
Heads Up or MTT link while signed in but not yet a member of the club. They got
"Tournament Not Found" and Back To Clubs, and no way to register.

**Cause.** Three gaps in a row:

- `tournamentShareUrl` (`src/lib/share.ts`) built `smarter.poker/t/<id>` with
  no query, and `gameInviteUrl` dropped the club code for a tournament target
  even when the lobby or the table handed it one. A table link carried `?i=`;
  a tournament link never did.
- The World Hub page `pages/t/[id].js` passed no query on to Club Arena
  (`clubArenaTournamentPath(id)`), while `/g/` passes `i`, `cluster` and
  `invite`.
- A tournament is readable only inside its club (the RESTRICTIVE policy
  `poker_arena_tournament_access`, `fn_poker_can_read_games` over the club
  scope, migrations 20260908152947 and 20260910034411). For a non-member
  `getTournament` returns null and `TournamentDetails` drew "Tournament Not
  Found". With no code on the link there was nothing to offer instead.

**Fix.**

- `tournamentShareUrl(id, { origin, inviteCode, inviteToken })` spells the code
  as `i` through the same `withShareQueryParams` a table link uses, and
  `gameInviteUrl` passes it for a tournament. Every surface that shares a
  tournament now carries the sender's code: TournamentDetails, TournamentPage,
  TournamentLobbyCard (the lobby and satellites hand the card its club and
  union), TournamentBreakScreen, TournamentRankingCard, and, through
  `gameInviteUrl`, the lobby rows (LobbyTable, GameLobbyPanel) and the table's
  Invite To Game and Invite Online Friend.
- The code is the sender's own Share & Invite code for the tournament's club
  (`useTournamentSenderInviteCode`, `src/hooks/useSenderInviteCode.ts`): the
  hosting club when the sender is a member, else the sender's own club inside
  the tournament's union, else their own active club. It is read when the
  surface opens, so the tap still goes straight to the share sheet, and it is
  remembered per account and club for the session, so a lobby of cards asks
  once. A surface that has not read it yet shares the plain link, which still
  opens the game for a member.
- World Hub `/t/[id]` forwards `i` and `invite` through `/g/`'s own
  `sanitizeShareParams`. `cluster` is a cash game and is not forwarded; nothing
  else ever is. The preview card is unchanged.
- `TournamentDetails`, on its real route, reads `i` with
  `parseTournamentInviteParams` (beside `parseTableInviteParams` in
  `src/lib/mustMoveInviteRouting.ts`). A signed-in viewer who cannot read the
  tournament and arrived with a code sees `TournamentClubJoinGate`: Join Club &
  Open Tournament goes to `/i/<CODE>?next=/tournaments/<id>`, the same detour a
  table link takes (`clubInviteJoinPath`, now shared with
  `TableLoadFailureOverlay`). InviteCodePage carries `next` onto the club's
  join page and InvitePage returns there once the player is in (or at once for
  a member). The return path carries no `i`, so a member who still cannot open
  the tournament gets "Tournament Not Found", never the join step a second
  time. A member who opens the link lands on the tournament directly.
- A signed-out arrival keeps `i`: AuthGuard sends `pathname + search + hash` to
  sign-in, and the native app maps `/t/<id>?i=` to `/tournaments/<id>?i=`.

**Why it broke.** The `/t/` link was built on 2026-11-15 for the preview card
and for signed-out friends. The signed-in non-member was never walked through,
and nothing read a tournament link back through the reader.

## 2. The in-app invite never reached anyone

**What a player saw.** Invite Online Friend at a table, the Heads Up "Specific
Player" picker and Invite To Table on a profile answered "Could Not Send Invite
Right Now. Please Try Again." The friend received nothing.

**Cause.** `sendInAppTableInvite` (`src/services/TableInviteService.ts`)
inserted the friend's `notifications` row from the browser. Production does not
let the browser write into another player's inbox, deliberately: the World Hub
migration 20261020170027 records production's ACL as `authenticated` holding
SELECT and UPDATE on `public.notifications` and no INSERT, 20261020171316
refuses to install while any PERMISSIVE INSERT or ALL policy on it admits
PUBLIC, anon or authenticated ("Notifications must retain owner/service-only
INSERT under RLS"), and 20260421023031 dropped the last browser INSERT policy
because any player could write a fake system notice into anyone's feed. The
only INSERT policy this repository ever wrote is 20260310's `"Service can insert
notifications" FOR INSERT WITH CHECK (true)` with no TO clause, which, if it
were installed, would let anyone (and the publishable key) write any
notification to anyone. So the insert is refused where the policy is right and
would be a hole where it is not.

**Fix.** Migration `20261123013356_a_game_invite_is_sent_by_the_server_to_a_clubmate_or_friend`
adds `public.fn_send_game_invite`, SECURITY DEFINER, executable by
`authenticated` only. It reads the game from its own row and names it as the
share door does (a tournament as its tournament; a Heads Up seat held for a
named player as the table and its token), refuses a game the sender cannot see
(the RESTRICTIVE policies' own predicate) as `not_found`, sends only to an
accepted friend or a member of the game's club scope (`not_allowed`
otherwise), answers a repeat to the same friend and game inside 60 seconds with
the first invite, allows 30 per sender in 10 minutes (`rate_limited`), and
builds the title, the sentence (the sender's arena handle, never a real name)
and the link itself: `/hub/club-arena/<path>` with `i` only when it is the
sender's own code. Sends are logged in `smarter_private.ca_game_invite_sends`
(no foreign keys; each call prunes the sender's rows older than seven days). No
policy or grant on `notifications` changes. The client calls the RPC after its
local guards and reports success only when the server says it delivered.

**Why it broke.** The client insert was written against a policy that either
no longer existed or never should have. Its unit tests mocked
`from('notifications').insert` and so passed whatever the database would do.

## 3. Old notification rows

Rows written before #11772 with the crossed `i` / `invite` parameters carry
seat-hold tokens that lived five minutes, so they are inert. If the browser
insert was refused on production as the World Hub migrations record (item 2),
few or none were written at all; that was read from migration files, not from
production. Nothing to settle.

## Pinned by

`tests/a-tournament-link-carries-the-club.law.test.ts`
(`docs/laws.d/a-tournament-link-carries-the-club.md`): every `tournamentShareUrl`
call in `src/` passes the code; the lobby, table and in-app targets reach the
link with it; the native `/t/` link, sign-in and the club-join detour keep it,
and the return path drops it; the tournament page renders the join step; the
send goes through `fn_send_game_invite` and no client file writes a
`table_invite` row; the function's checks and grants. Each of these was run
red with its fix removed and green with it restored. Updated in the same commit
because they pinned the behaviour replaced here:
`tests/an-invite-opens-the-game-it-names.law.test.ts` (the tournament link now
carries `?i=`), `tests/unit/TableInviteService.test.ts` (the RPC, real uuids),
`tests/unit/lobbyCardInviteAndFrameLayout.test.tsx` (the lobby row's tournament
link carries the code), `tests/unit/tournamentLobbyPopupIsFullScreen.test.tsx`
(a fourth state, the club join, draws its Close control).

The migration installed on a throwaway local Postgres 16 with stubs of the
objects it reads (its probe passed), and 14 behaviour cases ran there in a
rolled-back transaction: signed out, a clubmate, a repeat, a friend outside
the club, a banned stranger, another player's code dropped, an MTT invited to
from its table, a Heads Up hold, own and foreign cash game, a game the sender
cannot see, a union clubmate, a malformed token, a self invite and the rate
limit. It was not run against production.

## Not changed here

- `FriendListPanel` writes a `friend_request` notification for another player
  from the browser the same way; it is refused on production too (its failure
  is only logged). Same fix shape, separate change.
- The World Hub signup path (`resolveSignupClubPath`) sends a brand new account
  that claimed an invite to the club's join page without the game as `next`,
  for table and tournament links alike. The sign-in path keeps the game.
- Visual: the join console reuses the spade console the table's join step uses;
  it was rendered in jsdom, not shot at 393 px.
