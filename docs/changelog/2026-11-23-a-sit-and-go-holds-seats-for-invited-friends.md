# 2026-11-23: A Sit & Go holds seats for your invited friends

Dan: "FINISH UP ANY AND ALL UNFINISHED WORK, AND THEN GO AHEAD AND FULLY BUILD,
FIX AND ENHANCE ALL OF THESE AND MAKE SURE THEY ARE FULLY WIRED IN AND TESTED
BEFORE CLAIMING SUCCESS." Invite To Game held seats for friends on Spins and
Heads Up (#11808, `2026-11-22-invite-to-game-holds-a-private-seat.md`); this is
the Sit & Go half.

## What a player saw

Invite To Game on a six or nine seat Sit & Go (an ordinary one, or a "Starts
When Full" satellite run as one, such as "Satellite Into Nightly 20K 9-Max SNG
Satellite") only shared the link. `fn_invite_to_private_game` (20261123013126)
refused every Sit & Go but Heads Up (`format_not_supported`), so nothing kept
the friend's seat: any person who registered took it, a board the union's daily
horse plan had preseeded to one seat short started the moment the inviter
registered, and a board chosen for a horse slot filled the friend's seat with a
horse and dealt. The friend arrived to a game that had already started.

## Cause

Not a broken line: the Sit & Go was left out. The Phase 1 changelog said "Six
and nine seat Sit & Gos start only when full, so a friend can already join one
through the link". That holds only while the field stays short, and the field
fills around the people in it.

## Design: the same hold, held in place

One mechanism, not a second: `private_game_holds`, the same token, ten minute
clock (every frozen second given back), admissions, Cancel and entry rule.

- **SQL** (`20261123071654_a_sit_and_go_holds_seats_for_invited_friends.sql`,
  ordinary, CREATE OR REPLACE FUNCTION only). `fn_invite_to_private_game` gains
  a Sit & Go branch for a persisted `sng-v1` board of 4 to 9 seats. The inviter
  chooses how many friends, at most seats - 1. Already registered: the seats
  are held in this game, bounded by its open seats. Not registered: the
  inviter is registered through the normal registration door
  (`fn_register_for_tournament_request`, normal price and receipt) in the same
  transaction, then the seats are held; a refused registration leaves no hold
  and no charge, and a game without room for the inviter and one friend is
  refused before any money moves. The hold is never exclusive in a Sit & Go:
  held seats are kept for the friends and every other seat stays open to
  anyone, a person or a horse. The game starts on its ordinary rule when every
  seat is taken, friends included; when the hold expires, is cancelled or the
  inviter unregisters (normal refund), it is an ordinary board again.
- **Why in place, not a copy.** A Sit & Go is a registration board that opens
  empty, and a satellite run as one is one board per target, created only by
  `fn_ensure_fixed_sng_satellite`. A copy from a browser door would be a second
  feeder outside that creator, and, because the hold cannot be exclusive, not
  private anyway.
- **Lock order.** The registration door takes its lanes and the entry boundary
  before the event row, so the not-registered path locks nothing before calling
  it, then decides again under the event row lock the door leaves held.
- **Enforcement.** No new trigger. `fn_private_game_entry_guard` (attached by
  the window migration 20261123013136) judges every new `tournament_players`
  row, which is what every Sit & Go registration door writes, a horse's
  included. Safe in either install order relative to that window file.
- **Engine.** `registerHorses`, which every Sit & Go horse entry passes, reads
  the hold before the union's daily horse plan and before any horse is picked:
  horses take only the seats neither taken nor held, none when that is none
  (recorded as a deliberate wait, so the past-start top-up does not back off or
  call it unfillable), and nobody on an unreadable answer. A guard refusal in
  the race stops the pass. `/health` publishes `privateSitAndGoHolds: 1`.
  Nothing reads `is_horse`.
- **Client.** Invite To Game on Sit & Go tournament pages, lobby cards, lobby
  rows and the lobby panel offers it when the serving engine says
  `privateSitAndGoHolds`, with a friend count on the same "Invite A Friend"
  console. A Sit & Go has no table before it starts, so the inviter lands on
  its tournament page ("Seats Held For Your Friends": time left, link, Share,
  Cancel Hold) and the link is the tournament link with the token. The friend
  sees "Your Seat Is Held" with Take Seat, which is admitted by the token and
  then registers through the page's ordinary Sign Up card. Every Sit & Go
  registration asks `fn_accept_private_game_invite` before paying, and a guard
  refusal is said plainly and not retried. The table menu of a Sit & Go exists
  only once it has started, so there is nothing to hold there; a Heads Up keeps
  its table-menu invite from #11808.

## How it is pinned

- `scripts/ci/test-private-game-holds-postgres.py` (CI: Private game holds):
  72 checks on a real PostgreSQL with the four migrations installed unchanged,
  including six and nine seat fields, horses filling only unheld seats, the
  field waiting for the friends, a stranger and a horse refused, expiry,
  Cancel, the inviter unregistering, the thaw credit, every refusal before
  money moves, and two red cases: before 20261123071654 a Sit & Go invite is
  refused; with the trigger removed a stranger and a horse take held seats.
- `server/src/services/aSeatHeldForAFriendIsNotGivenToAHorse.law.test.ts`
  (registry entry updated).
- `tests/unit/aSitAndGoHoldsASeatForAFriend.test.ts`.
