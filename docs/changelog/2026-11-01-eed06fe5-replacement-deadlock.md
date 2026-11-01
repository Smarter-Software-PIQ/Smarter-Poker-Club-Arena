# 2026-11-01: why eed06fe5 cannot be replaced, measured

eed06fe5 has served since 2026-10-29 and restarts itself every 90 to 120 minutes
(heap about 4 GB, RSS about 11 GB before each crash; ten unplanned restarts between
2026-10-31 18:19 and 2026-11-01 08:16 UTC). Its replacement is merged (#9057, plus
#9095). No release has sealed since 2026-10-29. These are the three walls, each
read from production tonight.

## 1. Every intake made during play died at once (fixed by #9095)

The drained-boundary witness re-armed errexit inside its caller's `set +e`, so a
"not drained" answer killed the transaction before the break it should wait for.
Since #9095 (merged 05:46 UTC) an admitted request waits correctly: run 41283363258
(target e9f00025b) has waited from 07:17 UTC on.

## 2. The drained path can never open while stopped tournaments hold cards in the air

The census-free (drained) path needs the strict certificate: `readyForRestart`
true and zero unparked tables. At the 07:55 UTC owner-window break, /health
reported `unparkedReasons = {cards_in_air: 97, stopped_bank_custody_unwritten: 1}`
and the break thawed uncertified (break log: 98 unparked, never ready). Those are
the hands frozen mid-play by stop operation d44c4440 (the 89 stopped tournaments).
eed06fe5 cannot finish them, and the route that settles them (#8789/#8913) ships
only in the replacement. So the drained path stays shut on every break, owner or
daily, for as long as eed06fe5 holds those tables.

## 3. The checkpoint (census) path fits only in the first ~40 minutes after a crash

The census is admitted when heapUsed x 12 ms/MB fits 30300 ms, i.e. heap under
about 2525 MB. Measured after the 08:16 restart: 350 MB at 97 s, 1906-2200 MB at
20-35 min, 2416 MB at 08:53 (the notice minute), 2552 MB at 08:54. The 08:55
owner-window pass refused before requesting a notice (no break spent).

## What happened to tonight's request (owner window #9106, then the daily break)

- Run 41283363258 (target e9f00025b, containing #9057 and #9095) was admitted by
  the owner window at 07:05 UTC and staged a durable intake at 07:19.
- 07:55 UTC owner-window break: `cards_in_air: 97`, `stopped_bank_custody_unwritten: 1`;
  never certified; thawed cleanly. No cutover.
- 08:53 UTC: heap 2416 MB at the notice minute, 2552 MB a minute later; no notice
  was requested, so no break was spent.
- 09:42 UTC: eed06fe5 restarted on its own. At the 10:00 UTC daily break the heap
  was about 1.5 GB (inside the census allowance) and only 5 tables had cards in the
  air, but the break log shows `ready_for_restart_at` null and 5 unparked; it thawed
  with eed06fe5 still serving.
- The runner's transport to the host stayed silent from 07:19 to 10:09, reattached
  after the break, and ended `failed:reattach (exit 70)` when its wall clock ran out
  at 10:27. The host's own reasoning for 10:00 was therefore never streamed back;
  read `/var/lib/club-arena/engine-release-requests/41283363258-1*` on the host.

## What follows

- A release lands only if a break falls within about 35 minutes of an engine
  restart (census path), or after the stopped tables stop holding cards.
- Even inside the census allowance, 10:00 UTC did not cut over with 5 tables holding
  cards; whether the checkpoint route also needs the certificate is the next question
  to answer from the host record above.
- Forcing a restart to shrink the heap is forbidden (no MAIN signal/kill), and
  raising the census allowance was proposed and closed (#8918). Neither was done.
