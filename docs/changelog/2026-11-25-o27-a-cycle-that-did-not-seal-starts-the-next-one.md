# O27: A Cycle That Did Not Seal Starts The Next One

## What Broke

On 2026-11-25 the engine missed every cycle from 04:00 to 22:00 Chicago. The 10:00
cycle was not even attempted: no Stage run was created between 13:32Z and 16:37Z, so
nothing reserved it, posted its readiness or recorded its outcome on #11599.

GitHub delivered 8 of Stage's 96 scheduled runs a day on 2026-11-24 and 2026-11-25, at
random times. Every cycle owner on 2026-11-25 was created by a push to main. After a
seal the chain holds by itself: the receiver starts "Backup after seal", and its
completion is admitted as the next cycle's election trigger (O24, O25). After a
kept-serving cycle, or a selected cycle whose receiver did not seal, nothing started the
next one. The 07:00 cycle kept serving, nobody pushed between 07:50 and 09:30, and the
10:00 cycle had no owner.

A kept-serving cycle also meant no new certification attempt until somebody merged a
server change, so a candidate refused for a noisy reason stayed refused for hours.

## The Fix

`stage-engine-release.yml` job `next-candidate-after-cycle` runs in the cycle owner's
own Stage run after its selection. It waits once, until the cycle start + 25 minutes
(after the +10 post-cutover migration window opens and the 04:15 nightly freeze
releases), reads live `/health`, and when the cycle did not seal it starts ONE Backup
certification of main on a fresh copy, titled `Backup after keep-serving <cycle>`
(`backup-engine.yml` input `after_cycle`, which only names the run). That run completes
about 60 to 70 minutes later, inside the next election window `[start + 50m, start +
150m)`, and Stage admits its successful first-attempt completion exactly like a push
Backup. Any certification from 25 to 124 minutes lands inside the window.

The decision is `scripts/release/next-candidate-after-cycle.py` (`plan`, `decide`). A
sealed cycle starts nothing (the post-seal Backup already does). An unreadable `/health`
after a kept-serving selection still starts it; after a selected cycle it is "could not
tell" and starts nothing (CLAUDE.md 10.86). The job can dispatch that one workflow and
nothing else, never selects, offers or advances a release, and fails out loud if the run
it dispatched does not appear.

## The Owner Is Told, Once, In Plain Words

Only the 04:30 `EngineCutoverMissed` page ever reached the owner; the other seven daily
cycles reached nobody. When the job decides a cycle did not seal, a last step sends one
Messenger line through `public.fn_ca_note_cycle_did_not_seal` (migration
`20261126031810`, shipped alone in `#12043` so it installs in a post-cutover window; until it exists the note step warns and the Backup is unaffected), for example: "Engine cutover at 10:00 PM CST did not happen: no new
build passed its test in time. The current engine keeps running, and the next build is
being tested for the 1:00 AM CST cutover." It is keyed by the cycle, so a replay sends
nothing; it goes in the reliability controller's existing owner conversation from its
existing platform sender; no push and no SMS. A cycle with nothing new to ship sends no
note. The note step holds the only secret in the job and cannot block the Backup above
it. Proven on PostgreSQL 16: first call sends, replay sends nothing, one conversation,
bad cycle or note refused, EXECUTE for `service_role` only.

## Hardening

- `tests/a-cycle-that-did-not-seal-starts-the-next-one.law.test.ts`: the target for
  every slot in CST and CDT, the bound and grace, the window arithmetic, the decision
  matrix, the job's single write and permissions, the Backup run name, and Stage
  admitting exactly that completion (failure, replay, other branch, other event and
  other titles refused).
- The Stage job inventory pins in
  `tests/daily-preparation-does-not-wait-for-a-punctual-cron.law.test.ts` and the exact
  `detect.if` pins in two other laws carry the new clause.
