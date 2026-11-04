# 2026-11-04: new sign-ups in the daily digest, and 25 welcome-back chips

Owner request (Dan, 2026-11-04 08:53 Central), verbatim:

> INSIDE THE DAILY EMAIL, UNDER REAL PLAYER SIGN UPS, I WANT TO KNOW WHERE THEY
> CAME FROM, LIKE WHAT AGENT THEY WERE REFERRED BY AND THE NAME OF THE NEW
> PLAYERS, AND ALSO IF THEY ARE PART OF THE KINGS CLUB OR NOT. I WANT TO KNOW IF
> A "NEW SIGN UP" HAS JOINED THE KINGS CLUB, (OR ANY OTHER CLUB). IF PLAYER DO
> NOT PLAY A REAL HAND AFTER SIGNING UP, AND JOING AFTER 24 HOURS, THEY SHOULD
> RECEIVE A PUSH NOTIFICATION, EMAIL AND TEXT AWARDING THEM 25 FREE CHIPS FROM
> THE MIDWAY UNION FUNDED BY THE PROMO WALLET TO ANY AND ALL PLAYERS THAT DIDN'T
> PLAY LIVE AFTER 24 HOURS OF SIGN UP. (OBVIOUSLY IF THEY DIDN'T ADD A PHONE
> NUMBER WE CAN'T TEXT)

## What shipped here (migration `20261104145956`)

- `fn_sp_digest_signups(day)`: every real player who signed up that Chicago
  day, with the player's name, who referred them, the agent they sit under, the
  clubs they joined (KINGS CLUB flagged, plus whether the club is in the Midway
  Union) and whether they have played a hand yet. Also lists the welcome-back
  chips awarded that day and the players still waiting to join a club. The
  World Hub digest renders it as the "New Sign-Ups" card under Growth.
- `sp_signup_welcome_back_awards`: one row per player the promotion touched.
- `fn_sp_signup_welcome_back_run(limit, since)`: pays 25 chips from the Midway
  Union promo wallet (`union_wallets.promo_wallet`) through `fn_promo_disburse`
  to every real player who signed up 24+ hours ago (on or after the 2026-10-19
  launch) and has no hand on record, raises the in-app notification (mirrored
  to `push_outbox`), and returns the email and phone for the World Hub job to
  mail and text. The op_id is derived from the player id, so nobody is ever
  paid twice. A player not yet in a Midway Union club is kept as `no_club` and
  paid the moment they join.
- `fn_sp_signup_welcome_back_mark(user, channel, ok, detail)`: records what
  the email and text channels did.

The hourly job that calls the run function, sends the email (Resend) and the
text (Twilio), and the digest card, live in the World Hub repo.

## Qualification

Both functions were run against production as `pg_temp` copies. The digest
function returned the four 2026-11-03 sign-ups with the expected referrers,
agents and KINGS CLUB memberships in 0.1 s. The run function was probed inside
one self-aborting `DO` block (CLAUDE.md 11.5): with a limit of 3 it paid one
KINGS CLUB member 25 chips (union promo wallet 133,727.90 to 133,702.90, member
wallet 209.93 to 234.93, chip_ledger row written, notification row raised) and
recorded two players as `no_club`, and the whole transaction rolled back; the
wallet, the member balance and the notifications table were confirmed
unchanged afterwards.

At the time of writing 28 players qualify (20 of them in KINGS CLUB), so the
first run costs the promo wallet about 500 chips.

## Same-day follow-up (migration `20261104184347`)

The first live run (17:51 UTC) paid 21 players 525 chips, queued 21 pushes,
sent 21 emails and 10 texts, and recorded 7 players as waiting for a club. Two
corrections came out of the bug hunt that followed:

- The run scanned every clubless sign-up on every hour inside the same limit
  as new sign-ups; as that list grows it would starve newer players. A
  `no_club` player is now re-examined only once they hold an active Midway
  Union club membership. Read-only check against production: the old filter
  rescanned 7 players, the new one 0, with every paid award already sitting in
  a union club.
- Two overlapping runs could have paid a player twice (fn_promo_disburse checks its op_id before locking the wallet); the run now takes an advisory lock so runs serialize.
- A disbursement refused for any reason other than membership (promo wallet empty, a ledger refusal) was returned to the caller and stored nowhere; such players are now recorded as `failed`, retried every run, listed in the digest under "Could Not Be Paid", and the World Hub route answers 503 so the dispatcher pages after three failed hours.
- KINGS CLUB is recognised by its id as well as its name, so a rename cannot flip every sign-up to "not KINGS CLUB".
- The digest said "push sent" when the notification was raised. All 21 first
  pushes were skipped by the dispatcher as `no_subscription` (one player's
  device subscription had expired), so the digest now reports the real
  `push_outbox` outcome: sent, no device, failed, queued, or not raised.
